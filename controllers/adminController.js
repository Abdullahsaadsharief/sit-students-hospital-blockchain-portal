const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const db = require('../models/db');
const { sanitizeUser } = require('../middleware/authMiddleware');
const { hashPassword, generateAccessCode, generateTemporaryPassword } = require('../utils/passwords');
const { canViewPrescription, canViewPatientBill } = require('../utils/access');
const { computeSHA256, encryptBuffer, decryptBuffer, TamperDetectedError } = require('../utils/cryptoUtils');
const { validateUploadedFile, sanitizeDownloadFilename } = require('../utils/fileValidation');
const { atomicWriteBufferSync } = require('../utils/atomicWrite');
const { cloudPersistence } = require('../utils/cloudPersistence');
const { testGeminiApiKey } = require('../utils/aiSummarizer');
const { generateReceptionBillPDF, generateDoctorPrescriptionPDF } = require('../utils/pdfGenerator');

const ENV_FILE_PATH = path.join(config.ROOT_DIR, '.env');
const ACCESS_CODE_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

const ALLOWED_INQUIRY_DEPARTMENTS = new Set([
    'General OPD',
    'OPD Inquiry',
    'Cardiology & General Medicine',
    'Orthopedics & Trauma',
    'Pulmonology & Respiratory Care',
    'Neurology & Spine Care',
    'Central Pathology Lab',
    'Billing & Reception Desk',
    'Appointments & Registration',
    'Medical Reports & Portal Support'
]);

function syncEnvFile(key, value) {
    try {
        let content = '';
        if (fs.existsSync(ENV_FILE_PATH)) {
            content = fs.readFileSync(ENV_FILE_PATH, 'utf8');
        }
        const safeVal = String(value || '').replace(/[\r\n]/g, '');
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(content)) {
            content = content.replace(regex, `${key}=${safeVal}`);
        } else {
            content = content ? `${content.trimEnd()}\n${key}=${safeVal}\n` : `${key}=${safeVal}\n`;
        }
        fs.writeFileSync(ENV_FILE_PATH, content, 'utf8');
    } catch (e) {
        console.warn('[Admin Controller] Could not sync .env file:', e.message);
    }
}

function getConsortiumUsers(req, res) {
    try {
        const users = db.getAllUsers();
        const stats = {
            total: users.length,
            doctors: users.filter(u => u.role === 'Doctor').length,
            patients: users.filter(u => u.role === 'Patient').length,
            labStaff: users.filter(u => u.role === 'Lab Staff').length,
            receptionists: users.filter(u => u.role === 'Receptionist').length,
            admins: users.filter(u => u.role === 'Admin').length
        };

        return res.json({
            success: true,
            stats,
            users: users.map(u => sanitizeUser(u, { includeBillNumber: true, includeContact: true }))
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to retrieve hospital users.' });
    }
}

function registerUser(req, res) {
    try {
        const {
            name,
            email,
            password,
            role,
            department,
            hospital,
            doctorLicense,
            patientId,
            age,
            gender,
            bloodGroup,
            contact,
            designation,
            laboratory,
            labLicense,
            nodeId
        } = req.body || {};

        if (!name || !String(name).trim() || !email || !String(email).trim() || !role) {
            return res.status(400).json({ success: false, message: 'Name, email, and role are required fields.' });
        }

        const validRoles = ['Doctor', 'Patient', 'Lab Staff', 'Receptionist', 'Admin'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ success: false, message: `Invalid role specified. Must be one of: ${validRoles.join(', ')}` });
        }

        const existing = db.findUserByEmail(email);
        if (existing) {
            return res.status(409).json({ success: false, message: `A user with email '${email}' is already registered.` });
        }

        let initialPassword = null;
        let mustChangePassword = true;
        if (password && String(password).trim()) {
            const p = String(password).trim();
            if (p.length < 10) {
                return res.status(400).json({ success: false, message: 'Initial password must be at least 10 characters.' });
            }
            initialPassword = p;
        } else {
            initialPassword = generateTemporaryPassword(14);
        }

        const timestamp = Date.now().toString(36);
        const newUser = {
            name: String(name).trim().slice(0, 120),
            email: String(email).trim().toLowerCase().slice(0, 150),
            passwordHash: hashPassword(initialPassword),
            mustChangePassword,
            isDemoAccount: false,
            disabled: false,
            tokenVersion: 0,
            role,
            nodeId: nodeId || (role === 'Doctor' ? 'NODE-HOSP-01' : role === 'Lab Staff' ? 'NODE-LAB-01' : role === 'Receptionist' ? 'NODE-PHARM-01' : null),
            createdAt: new Date().toISOString()
        };

        let oneTimeAccessCode = null;
        if (role === 'Doctor') {
            newUser.id = `usr_doc_${timestamp}`;
            newUser.department = department || 'General Medicine';
            newUser.hospital = hospital || 'SIT Students Hospital';
            newUser.license = doctorLicense || `MC-2026-${crypto.randomInt(1000, 9999)}`;
        } else if (role === 'Patient') {
            const existingPatients = db.getAllUsers().filter(u => u.role === 'Patient');
            const { suggestedBillNumber, suggestedPatientId } = getNextPatientIdentifiers(existingPatients);
            newUser.id = `usr_pat_${timestamp}`;
            newUser.patientId = (patientId && String(patientId).trim()) ? String(patientId).trim().toUpperCase() : suggestedPatientId;
            newUser.billNumber = (req.body.billNumber && String(req.body.billNumber).trim()) ? String(req.body.billNumber).trim().toUpperCase() : suggestedBillNumber;
            newUser.receptionId = newUser.billNumber;
            newUser.assignedDoctor = req.body.assignedDoctor || 'Not assigned';
            newUser.visitReason = req.body.visitReason || 'OPD Consultation';
            newUser.billAmount = req.body.billAmount || 'Rs. 350';
            newUser.age = parseInt(age, 10) || null;
            newUser.gender = gender || 'Unspecified';
            newUser.bloodGroup = bloodGroup || 'Not recorded';
            newUser.contact = contact ? String(contact).trim() : '';

            oneTimeAccessCode = generateAccessCode(8);
            newUser.accessCodeHash = hashPassword(oneTimeAccessCode);
            newUser.accessCodeExpiresAt = new Date(Date.now() + ACCESS_CODE_TTL_MS).toISOString();
            newUser.accessCodeUsed = false;
        } else if (role === 'Receptionist') {
            newUser.id = `usr_rec_${timestamp}`;
            newUser.designation = designation || 'OPD Receptionist & Billing Executive';
            newUser.department = department || 'Front Desk & Patient Registration';
            newUser.hospital = 'SIT Students Hospital';
            newUser.nodeId = 'NODE-PHARM-01';
        } else if (role === 'Lab Staff') {
            newUser.id = `usr_lab_${timestamp}`;
            newUser.designation = designation || 'Clinical Lab Technologist';
            newUser.laboratory = laboratory || 'SIT Hospital Central Pathology Lab';
            newUser.license = labLicense || `LAB-TECH-${crypto.randomInt(100, 999)}`;
        } else if (role === 'Admin') {
            newUser.id = `usr_adm_${timestamp}`;
            newUser.institution = 'SIT Students Hospital Administration';
        }

        const created = db.addUser(newUser);

        db.logAudit(
            'USER_REGISTERED',
            req.user ? req.user.name : 'System Admin',
            `Admin enrolled new ${role}: ${created.name} (ID: ${created.id})`
        );

        const responsePayload = {
            success: true,
            message: `New ${role} account created for ${created.name}. Share the one-time credential securely; password change is required on first sign-in.`,
            user: sanitizeUser(created, { includeBillNumber: true, includeContact: true }),
            temporaryPassword: initialPassword
        };
        if (oneTimeAccessCode) {
            responsePayload.oneTimeAccessCode = oneTimeAccessCode;
            responsePayload.accessCodeExpiresAt = created.accessCodeExpiresAt;
        }

        return res.status(201).json(responsePayload);
    } catch (err) {
        return res.status(500).json({ success: false, message: 'User registration failed.' });
    }
}

function deleteUser(req, res) {
    try {
        const { userId } = req.params;
        const target = db.findUserById(userId);
        if (!target) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        if (target.id === req.user.id) {
            return res.status(400).json({ success: false, message: 'Cannot delete the currently logged in admin account.' });
        }

        db.bumpTokenVersion(userId);
        db.deleteUser(userId);

        db.logAudit(
            'USER_DELETED',
            req.user.name,
            `Admin removed user account: ${target.name} (${target.role}, ID: ${target.id})`
        );

        return res.json({
            success: true,
            message: `User '${target.name}' removed from hospital directory.`
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'User removal failed.' });
    }
}

function getAiConfig(req, res) {
    const key = process.env.GEMINI_API_KEY;
    const hasKey = Boolean(key && key.trim());
    const maskedKey = hasKey ? `${key.trim().slice(0, 6)}...${key.trim().slice(-4)}` : null;
    const externalEnabled = config.AI_EXTERNAL_PROCESSING === true;

    return res.json({
        success: true,
        hasKey,
        externalProcessingEnabled: externalEnabled,
        maskedKey,
        activeEngine: (hasKey && externalEnabled)
            ? `Google Gemini (${process.env.GEMINI_ACTIVE_MODEL || 'gemini-2.5-flash'}) — De-identified`
            : 'Local Clinical Rule Engine (Offline)',
        status: (hasKey && externalEnabled) ? 'ONLINE_AI' : 'OFFLINE_FALLBACK'
    });
}

async function updateAiConfig(req, res) {
    try {
        const { apiKey } = req.body || {};
        if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
            return res.status(400).json({ success: false, message: 'Please provide a valid Google Gemini API key.' });
        }

        const cleanKey = apiKey.trim();
        const testResult = await testGeminiApiKey(cleanKey);

        process.env.GEMINI_API_KEY = cleanKey;
        syncEnvFile('GEMINI_API_KEY', cleanKey);

        db.logAudit(
            'AI_GATEWAY_CONFIGURED',
            req.user.name,
            `Admin verified Google Gemini API key (Model: ${testResult.activeModel}; externalProcessing=${config.AI_EXTERNAL_PROCESSING})`
        );

        const maskedKey = `${cleanKey.slice(0, 6)}...${cleanKey.slice(-4)}`;
        return res.json({
            success: true,
            message: config.AI_EXTERNAL_PROCESSING
                ? (testResult.message || 'Google Gemini API key verified and activated.')
                : 'Google Gemini API key verified and saved. Note: AI_EXTERNAL_PROCESSING=false in environment, so clinical uploads stay local until explicitly enabled.',
            activeEngine: config.AI_EXTERNAL_PROCESSING
                ? `Google Gemini (${testResult.activeModel})`
                : 'Local Clinical Rule Engine (External AI Disabled by Policy)',
            status: config.AI_EXTERNAL_PROCESSING ? 'ONLINE_AI' : 'OFFLINE_FALLBACK',
            externalProcessingEnabled: config.AI_EXTERNAL_PROCESSING,
            maskedKey,
            warning: testResult.warning || null
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: `Verification failed: ${err.message}`
        });
    }
}

function resetAiConfig(req, res) {
    try {
        delete process.env.GEMINI_API_KEY;
        syncEnvFile('GEMINI_API_KEY', '');

        db.logAudit('AI_GATEWAY_RESET', req.user.name, 'Admin reset AI Gateway to Local Clinical Rule Engine (Offline)');

        return res.json({
            success: true,
            message: 'AI Gateway reverted to Local Clinical Rule Engine (Offline).',
            activeEngine: 'Local Clinical Rule Engine (Offline)',
            status: 'OFFLINE_FALLBACK',
            maskedKey: null
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to reset AI config.' });
    }
}

function getNextPatientIdentifiers(existingPatients) {
    let maxBill = 1000;
    let maxUhid = 9900;
    const usedBills = new Set();
    const usedUhids = new Set();

    for (const p of existingPatients) {
        if (p.billNumber) {
            usedBills.add(String(p.billNumber).toUpperCase());
            const m = String(p.billNumber).match(/(\d+)$/);
            if (m) maxBill = Math.max(maxBill, Number(m[1]));
        }
        if (p.patientId) {
            usedUhids.add(String(p.patientId).toUpperCase());
            const m = String(p.patientId).match(/(\d+)$/);
            if (m) maxUhid = Math.max(maxUhid, Number(m[1]));
        }
    }

    let nextBillNum = maxBill + 1;
    while (usedBills.has(`BILL-2026-${nextBillNum}`)) nextBillNum++;

    let nextUhidNum = maxUhid + 1;
    while (usedUhids.has(`PT-${nextUhidNum}`)) nextUhidNum++;

    return {
        nextIndex: nextBillNum,
        suggestedBillNumber: `BILL-2026-${nextBillNum}`,
        suggestedPatientId: `PT-${nextUhidNum}`
    };
}

function getReceptionPatients(req, res) {
    try {
        const users = db.getAllUsers();
        const patients = users
            .filter(u => u.role === 'Patient')
            .map(p => sanitizeUser(p, { includeBillNumber: true, includeContact: true }));
        const doctors = users
            .filter(u => u.role === 'Doctor')
            .map(d => sanitizeUser(d, { includeBillNumber: false, includeContact: false }));
        const { suggestedBillNumber, suggestedPatientId } = getNextPatientIdentifiers(patients);

        return res.json({
            success: true,
            patients,
            doctors,
            suggestedBillNumber,
            suggestedPatientId
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to load reception patient directory.' });
    }
}

function registerPatientAtReception(req, res) {
    try {
        const {
            name,
            age,
            gender,
            bloodGroup,
            contact,
            assignedDoctor,
            visitReason,
            billAmount,
            customBillNumber,
            customPatientId
        } = req.body || {};

        if (!name || !String(name).trim()) {
            return res.status(400).json({ success: false, message: 'Patient full name is required.' });
        }

        const existingPatients = db.getAllUsers().filter(u => u.role === 'Patient');
        const { nextIndex, suggestedBillNumber, suggestedPatientId } = getNextPatientIdentifiers(existingPatients);

        const billNumber = (customBillNumber && String(customBillNumber).trim())
            ? String(customBillNumber).trim().toUpperCase()
            : suggestedBillNumber;

        const patientId = (customPatientId && String(customPatientId).trim())
            ? String(customPatientId).trim().toUpperCase()
            : suggestedPatientId;

        const duplicateBill = existingPatients.find(p =>
            (p.billNumber && p.billNumber.toUpperCase() === billNumber) ||
            (p.patientId && p.patientId.toUpperCase() === billNumber)
        );
        if (duplicateBill) {
            return res.status(409).json({
                success: false,
                message: `Bill / Reception ID '${billNumber}' is already assigned to patient ${duplicateBill.name}.`
            });
        }

        // Generate 8-character single-use Patient Access Code (72h expiry) — never password123!
        const oneTimeAccessCode = generateAccessCode(8);
        const accessCodeExpiresAt = new Date(Date.now() + ACCESS_CODE_TTL_MS).toISOString();
        const unguessableFallbackPass = generateTemporaryPassword(20);

        const timestamp = Date.now().toString(36);
        const cleanSlug = String(name).trim().toLowerCase().replace(/[^a-z0-9]/g, '.');
        const newPatient = {
            id: `usr_pat_${timestamp}_${crypto.randomBytes(2).toString('hex')}`,
            name: String(name).trim().slice(0, 120),
            email: `${cleanSlug}.${nextIndex}.${crypto.randomBytes(2).toString('hex')}@sit.ac.in`,
            passwordHash: hashPassword(unguessableFallbackPass),
            accessCodeHash: hashPassword(oneTimeAccessCode),
            accessCodeExpiresAt,
            accessCodeUsed: false,
            mustChangePassword: true,
            isDemoAccount: false,
            disabled: false,
            tokenVersion: 0,
            role: 'Patient',
            patientId,
            billNumber,
            receptionId: billNumber,
            age: parseInt(age, 10) || null,
            gender: gender || 'Not recorded',
            bloodGroup: bloodGroup || 'Not recorded',
            contact: contact ? String(contact).trim().slice(0, 50) : '',
            assignedDoctor: assignedDoctor || 'Dr. Sarah Rao (Cardiology & General Medicine)',
            visitReason: visitReason || 'General OPD Consultation',
            billAmount: billAmount || 'Rs. 350',
            registeredBy: `${req.user.name} (${req.user.role})`,
            hospital: 'SIT Students Hospital',
            createdAt: new Date().toISOString()
        };

        const created = db.addUser(newPatient);

        if (req.body.initialLabTest && req.body.initialLabTest !== 'None') {
            db.addLabRequest({
                requestId: `LABREQ-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
                patientId: created.id,
                patientName: created.name,
                patientUhid: created.patientId,
                billNumber: created.billNumber,
                requestedBy: `${created.assignedDoctor} (via Reception Desk)`,
                testTitle: String(req.body.initialLabTest).trim().slice(0, 150),
                reportType: 'Pathology / Biochemistry',
                priority: 'Routine OPD',
                status: 'PENDING_UPLOAD',
                createdAt: new Date().toISOString()
            });
        }

        db.logAudit(
            'PATIENT_REGISTERED_AT_RECEPTION',
            req.user.name,
            `Registered patient ${created.name} (UHID: ${created.patientId}, Bill: ${created.billNumber}) with 72h one-time access code`
        );

        return res.status(201).json({
            success: true,
            message: `Patient ${created.name} registered! Bill ID: ${created.billNumber}. Give the one-time access code to the patient.`,
            patient: sanitizeUser(created, { includeBillNumber: true, includeContact: true }),
            oneTimeAccessCode,
            accessCodeExpiresAt
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to register patient at reception.' });
    }
}

/**
 * Receptionist / Admin issues a fresh 8-char one-time access code and invalidates existing sessions
 */
function resetPatientAccessCode(req, res) {
    try {
        const { patientId } = req.params;
        const patient = db.getAllUsers().find(u =>
            u.role === 'Patient' && (u.id === patientId || u.patientId === patientId)
        );
        if (!patient) {
            return res.status(404).json({ success: false, message: 'Patient account not found.' });
        }

        const oneTimeAccessCode = generateAccessCode(8);
        const accessCodeExpiresAt = new Date(Date.now() + ACCESS_CODE_TTL_MS).toISOString();
        const nextVersion = (Number(patient.tokenVersion) || 0) + 1;

        db.updateUser(patient.id, {
            accessCodeHash: hashPassword(oneTimeAccessCode),
            accessCodeExpiresAt,
            accessCodeUsed: false,
            mustChangePassword: true,
            tokenVersion: nextVersion
        });

        db.logAudit(
            'PATIENT_ACCESS_CODE_RESET',
            req.user.name,
            `Issued new 72h one-time access code for ${patient.name} (${patient.billNumber}); prior sessions revoked.`
        );

        return res.json({
            success: true,
            message: `New one-time access code generated for ${patient.name}. Valid for 72 hours.`,
            patientId: patient.id,
            billNumber: patient.billNumber,
            oneTimeAccessCode,
            accessCodeExpiresAt
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to reset patient access code.' });
    }
}

async function downloadReceptionBillPDF(req, res) {
    try {
        const { patientId } = req.params;
        const users = db.getAllUsers();
        const patient = users.find(u =>
            u.role === 'Patient' && (
                u.id === patientId ||
                u.patientId === patientId ||
                (u.billNumber && u.billNumber.toLowerCase() === String(patientId).toLowerCase())
            )
        );

        if (!patient) {
            return res.status(404).json({ success: false, message: 'Patient bill record not found.' });
        }

        if (!canViewPatientBill(req.user, patient)) {
            db.logAudit('UNAUTHORIZED_BILL_ACCESS_BLOCKED', req.user.name, `Blocked ${req.user.role} (${req.user.id}) from downloading bill for ${patient.id}`);
            return res.status(403).json({ success: false, message: 'Access denied. You are not authorized to download this bill.' });
        }

        const hostUrl = req.protocol + '://' + req.get('host');
        const pdfBuffer = await generateReceptionBillPDF(patient, hostUrl, null);
        const safeBill = sanitizeDownloadFilename(`SIT_Hospital_OPD_Bill_${patient.billNumber || patient.patientId || 'BILL'}.pdf`, 'SIT_Hospital_OPD_Bill.pdf');

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeBill}"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        return res.send(pdfBuffer);
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to generate Bill PDF.' });
    }
}

function getPrescriptions(req, res) {
    try {
        const user = req.user;
        if (user.role === 'Admin') {
            db.logAudit('ADMIN_CLINICAL_ACCESS', user.name, 'Admin viewed prescription registry');
        }
        const patientId = user.role === 'Patient' ? user.id : (req.query.patientId || null);
        const list = db.getPrescriptions(patientId);
        return res.json({ success: true, count: list.length, prescriptions: list });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to fetch prescriptions.' });
    }
}

/**
 * Doctor Creates an OPD Clinical Checkup & Medicine Prescription Slip (+ Optional Lab Test Request).
 * Strictly validates medicines list and clinical fields — NEVER invents Paracetamol or defaults (F-06).
 */
function createPrescription(req, res) {
    try {
        const user = req.user;
        const {
            patientId,
            vitals,
            symptoms,
            diagnosis,
            medicines,
            advice,
            labTestOrdered,
            labReportType,
            followUpDate
        } = req.body || {};

        const targetPatient = db.findUserById(patientId);
        if (!targetPatient || targetPatient.role !== 'Patient') {
            return res.status(400).json({ success: false, message: 'Please select a valid registered patient.' });
        }

        const cleanSymptoms = typeof symptoms === 'string' ? symptoms.trim().slice(0, 1000) : '';
        const cleanDiagnosis = typeof diagnosis === 'string' ? diagnosis.trim().slice(0, 1000) : '';
        if (!cleanSymptoms && !cleanDiagnosis) {
            return res.status(400).json({ success: false, message: 'At least clinical symptoms or diagnosis must be provided.' });
        }

        if (!Array.isArray(medicines) || medicines.length === 0 || medicines.length > 20) {
            return res.status(400).json({
                success: false,
                message: 'A valid non-empty medicines list (1 to 20 medicines) is required.'
            });
        }

        const validatedMeds = [];
        for (let i = 0; i < medicines.length; i++) {
            const m = medicines[i];
            if (!m || typeof m !== 'object') {
                return res.status(400).json({ success: false, message: `Medicine #${i + 1} must be an object with name, dosage, and duration.` });
            }
            const mName = typeof m.name === 'string' ? m.name.trim() : '';
            const mDosage = typeof m.dosage === 'string' ? m.dosage.trim() : '';
            const mDuration = typeof m.duration === 'string' ? m.duration.trim() : '';
            const mInstructions = typeof m.instructions === 'string' ? m.instructions.trim() : '';

            if (!mName || mName.length > 150) {
                return res.status(400).json({ success: false, message: `Medicine #${i + 1} requires a valid name (1-150 chars).` });
            }
            if (!mDosage || mDosage.length > 100) {
                return res.status(400).json({ success: false, message: `Medicine #${i + 1} requires a valid dosage (1-100 chars).` });
            }
            if (!mDuration || mDuration.length > 80) {
                return res.status(400).json({ success: false, message: `Medicine #${i + 1} requires a valid duration (1-80 chars).` });
            }
            if (mInstructions.length > 200) {
                return res.status(400).json({ success: false, message: `Medicine #${i + 1} instructions cannot exceed 200 characters.` });
            }

            validatedMeds.push({
                name: mName,
                dosage: mDosage,
                duration: mDuration,
                instructions: mInstructions || 'As directed'
            });
        }

        const prescriptionId = `RX-2026-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        const newRx = {
            prescriptionId,
            patientId: targetPatient.id,
            patientName: targetPatient.name,
            patientUhid: targetPatient.patientId || null,
            billNumber: targetPatient.billNumber || null,
            doctorId: user.id,
            doctorName: user.name,
            department: user.department || 'General Medicine',
            vitals: typeof vitals === 'string' && vitals.trim() ? vitals.trim().slice(0, 300) : null,
            symptoms: cleanSymptoms || null,
            diagnosis: cleanDiagnosis || null,
            medicines: validatedMeds,
            advice: typeof advice === 'string' && advice.trim() ? advice.trim().slice(0, 1000) : null,
            labTestOrdered: typeof labTestOrdered === 'string' && labTestOrdered.trim() ? labTestOrdered.trim().slice(0, 200) : 'None',
            followUpDate: typeof followUpDate === 'string' && followUpDate.trim() ? followUpDate.trim().slice(0, 40) : null,
            attachment: null,
            createdAt: new Date().toISOString()
        };

        db.addPrescription(newRx);

        let createdLabRequest = null;
        if (newRx.labTestOrdered && newRx.labTestOrdered !== 'None') {
            createdLabRequest = db.addLabRequest({
                requestId: `LABREQ-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
                patientId: targetPatient.id,
                patientName: targetPatient.name,
                patientUhid: targetPatient.patientId || null,
                billNumber: targetPatient.billNumber || null,
                requestedBy: `${user.name} (${user.department || 'Hospital Doctor'})`,
                testTitle: newRx.labTestOrdered,
                reportType: labReportType || 'Pathology / Biochemistry',
                priority: 'Doctor Ordered',
                status: 'PENDING_UPLOAD',
                createdAt: new Date().toISOString()
            });
        }

        db.logAudit(
            'DOCTOR_CHECKUP_PRESCRIPTION',
            user.name,
            `Doctor wrote checkup prescription ${prescriptionId} for ${targetPatient.name}${createdLabRequest ? ' and ordered lab test: ' + newRx.labTestOrdered : ''}`
        );

        return res.status(201).json({
            success: true,
            message: `Clinical Checkup & Prescription (${prescriptionId}) saved for ${targetPatient.name}.`,
            prescription: newRx,
            labRequest: createdLabRequest
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to create prescription.' });
    }
}

/**
 * F-15: Doctor / Admin uploads a signed prescription document (PDF/PNG/JPG/WEBP/TXT).
 * Can attach to an existing prescriptionId OR create a standalone attached prescription record for the patient.
 */
async function uploadPrescriptionAttachment(req, res) {
    let writtenPath = null;
    try {
        const user = req.user;
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please attach a prescription file (field: prescriptionFile).' });
        }

        const validation = validateUploadedFile(req.file);
        if (!validation.valid) {
            return res.status(validation.status).json({ success: false, message: validation.message });
        }

        const { patientId, prescriptionId, symptoms, diagnosis, notes } = req.body || {};
        const targetPatient = db.findUserById(patientId);
        if (!targetPatient || targetPatient.role !== 'Patient') {
            return res.status(400).json({ success: false, message: 'A valid registered patientId is required.' });
        }

        let targetRx = null;
        if (prescriptionId) {
            targetRx = db.findPrescriptionById(String(prescriptionId).trim());
            if (!targetRx) {
                return res.status(404).json({ success: false, message: 'Referenced prescriptionId not found.' });
            }
            if (targetRx.patientId !== targetPatient.id) {
                return res.status(400).json({ success: false, message: 'Prescription does not belong to the specified patient.' });
            }
        }

        const rawBuffer = req.file.buffer;
        const sha256 = computeSHA256(rawBuffer);
        const encryptedBuffer = encryptBuffer(rawBuffer);
        const attachmentId = `RXDOC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const storageReference = `${attachmentId}_encrypted.bin`;
        const storagePath = path.join(config.UPLOADS_DIR, storageReference);

        atomicWriteBufferSync(storagePath, encryptedBuffer);
        writtenPath = storagePath;

        const safeFileName = sanitizeDownloadFilename(req.file.originalname, `${attachmentId}.pdf`);
        const attachmentMeta = {
            attachmentId,
            storageReference,
            fileName: safeFileName,
            mimeType: req.file.mimetype,
            fileSize: rawBuffer.length,
            encryptedSize: encryptedBuffer.length,
            sha256,
            uploadedBy: user.name,
            uploaderId: user.id,
            uploadedAt: new Date().toISOString()
        };

        let savedRx;
        if (targetRx) {
            savedRx = db.updatePrescription(targetRx.prescriptionId, { attachment: attachmentMeta });
        } else {
            const newPrescriptionId = `RX-2026-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            savedRx = db.addPrescription({
                prescriptionId: newPrescriptionId,
                patientId: targetPatient.id,
                patientName: targetPatient.name,
                patientUhid: targetPatient.patientId || null,
                billNumber: targetPatient.billNumber || null,
                doctorId: user.id,
                doctorName: user.name,
                department: user.department || 'General Medicine',
                vitals: null,
                symptoms: typeof symptoms === 'string' && symptoms.trim() ? symptoms.trim().slice(0, 1000) : null,
                diagnosis: typeof diagnosis === 'string' && diagnosis.trim() ? diagnosis.trim().slice(0, 1000) : 'Attached prescription document',
                medicines: [],
                advice: typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 1000) : null,
                labTestOrdered: 'None',
                followUpDate: null,
                documentType: 'UPLOADED_PRESCRIPTION_DOCUMENT',
                attachment: attachmentMeta,
                createdAt: new Date().toISOString()
            });
        }

        db.logAudit(
            'PRESCRIPTION_DOCUMENT_UPLOADED',
            user.name,
            `Doctor uploaded encrypted prescription attachment ${attachmentId} for prescription ${savedRx.prescriptionId} (Patient: ${targetPatient.name})`
        );

        if (cloudPersistence.isEnabled()) {
            try {
                await cloudPersistence.saveEncryptedFile(storageReference, encryptedBuffer);
                await cloudPersistence.flushAll();
            } catch (cloudErr) {
                console.error('[Admin Controller] Prescription cloud persistence sync warning:', cloudErr.message);
            }
        }

        return res.status(201).json({
            success: true,
            message: `Prescription document encrypted and attached to ${savedRx.prescriptionId}.`,
            prescription: savedRx,
            attachment: attachmentMeta
        });
    } catch (err) {
        if (writtenPath && fs.existsSync(writtenPath)) {
            try { fs.unlinkSync(writtenPath); } catch (_) {}
        }
        return res.status(500).json({ success: false, message: 'Failed to upload prescription document.' });
    }
}

async function downloadPrescriptionAttachment(req, res) {
    try {
        const { prescriptionId } = req.params;
        const rx = db.findPrescriptionById(prescriptionId);
        if (!rx) {
            return res.status(404).json({ success: false, message: 'Prescription not found.' });
        }

        if (!canViewPrescription(req.user, rx)) {
            db.logAudit('UNAUTHORIZED_IDOR_BLOCKED', req.user.name, `Blocked attempt by ${req.user.role} (${req.user.id}) to download prescription attachment ${prescriptionId}`);
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        if (!rx.attachment || !rx.attachment.storageReference) {
            return res.status(404).json({ success: false, message: 'No uploaded attachment found for this prescription.' });
        }

        const filePath = path.join(config.UPLOADS_DIR, path.basename(rx.attachment.storageReference));
        if (!fs.existsSync(filePath)) {
            await cloudPersistence.ensureLocalEncryptedFile(rx.attachment.storageReference);
        }
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: 'Encrypted attachment file missing on disk.' });
        }

        const encryptedData = fs.readFileSync(filePath);
        let decryptedBuffer;
        try {
            decryptedBuffer = decryptBuffer(encryptedData);
        } catch (decErr) {
            if (decErr instanceof TamperDetectedError || decErr.isTampered) {
                return res.status(400).json({ success: false, tampered: true, message: 'SECURITY ALERT: Prescription attachment failed authenticated decryption.' });
            }
            throw decErr;
        }

        const liveHash = computeSHA256(decryptedBuffer);
        if (rx.attachment.sha256 && liveHash !== rx.attachment.sha256) {
            return res.status(400).json({ success: false, tampered: true, message: 'SECURITY ALERT: Prescription attachment hash mismatch.' });
        }

        if (req.user.role === 'Admin') {
            db.logAudit('ADMIN_CLINICAL_ACCESS', req.user.name, `Admin downloaded prescription attachment ${prescriptionId}`);
        }

        const safeFileName = sanitizeDownloadFilename(rx.attachment.fileName, `${rx.prescriptionId}_attachment.pdf`);
        res.setHeader('Content-Type', rx.attachment.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
        res.setHeader('Content-Length', decryptedBuffer.length);
        return res.send(decryptedBuffer);
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to download prescription attachment.' });
    }
}

async function downloadPrescriptionPDF(req, res) {
    try {
        const { prescriptionId } = req.params;
        const rx = db.findPrescriptionById(prescriptionId);
        if (!rx) {
            return res.status(404).json({ success: false, message: 'Prescription not found.' });
        }

        if (!canViewPrescription(req.user, rx)) {
            db.logAudit('UNAUTHORIZED_IDOR_BLOCKED', req.user.name, `Blocked attempt by ${req.user.role} (${req.user.id}) to download prescription ${prescriptionId}`);
            return res.status(403).json({ success: false, message: 'Access denied. You can only download authorized prescriptions.' });
        }

        if (req.user.role === 'Admin') {
            db.logAudit('ADMIN_CLINICAL_ACCESS', req.user.name, `Admin downloaded prescription PDF ${prescriptionId}`);
        }

        const pdfBuffer = await generateDoctorPrescriptionPDF(rx);
        const safeName = sanitizeDownloadFilename(`SIT_Hospital_Prescription_${rx.prescriptionId}.pdf`, 'SIT_Hospital_Prescription.pdf');

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        return res.send(pdfBuffer);
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to generate prescription PDF.' });
    }
}

function getLabRequests(req, res) {
    try {
        const requests = db.getLabRequests();
        return res.json({ success: true, count: requests.length, labRequests: requests });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to load lab requests.' });
    }
}

function getReceptionInquiries(req, res) {
    try {
        return res.json({ success: true, inquiries: db.getInquiries() });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to load inquiries.' });
    }
}

function createReceptionInquiry(req, res) {
    try {
        const { name, contact, department, message } = req.body || {};
        const cleanName = typeof name === 'string' ? name.trim() : '';
        const cleanContact = typeof contact === 'string' ? contact.trim() : '';
        const cleanMessage = typeof message === 'string' ? message.trim() : '';
        const rawDept = typeof department === 'string' ? department.trim() : 'General OPD';

        if (!cleanName || cleanName.length > 100) {
            return res.status(400).json({ success: false, message: 'Name is required and must be 100 characters or fewer.' });
        }
        if (cleanContact.length > 100) {
            return res.status(400).json({ success: false, message: 'Contact field must be 100 characters or fewer.' });
        }
        if (!cleanMessage || cleanMessage.length > 2000) {
            return res.status(400).json({ success: false, message: 'Message is required and must be 2000 characters or fewer.' });
        }

        const safeDept = ALLOWED_INQUIRY_DEPARTMENTS.has(rawDept) ? rawDept : 'General OPD';
        const ticketId = `INQ-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        const inquiry = db.addInquiry({
            ticketId,
            name: cleanName,
            contact: cleanContact,
            department: safeDept,
            message: cleanMessage,
            status: 'OPEN',
            createdAt: new Date().toISOString()
        });

        db.logAudit('HELPDESK_INQUIRY_RECEIVED', inquiry.name, `Submitted inquiry ${ticketId} for ${inquiry.department}`);
        return res.status(201).json({ success: true, inquiry });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to submit inquiry.' });
    }
}

function resolveReceptionInquiry(req, res) {
    try {
        const { ticketId } = req.params;
        const resolved = db.resolveInquiry(ticketId, req.user.name);
        if (!resolved) {
            return res.status(404).json({ success: false, message: 'Inquiry ticket not found.' });
        }
        db.logAudit('HELPDESK_INQUIRY_RESOLVED', req.user.name, `Resolved helpdesk ticket ${ticketId}`);
        return res.json({ success: true, inquiry: resolved });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to resolve inquiry.' });
    }
}

module.exports = {
    getConsortiumUsers,
    registerUser,
    deleteUser,
    getAiConfig,
    updateAiConfig,
    resetAiConfig,
    getReceptionPatients,
    registerPatientAtReception,
    resetPatientAccessCode,
    downloadReceptionBillPDF,
    getPrescriptions,
    createPrescription,
    uploadPrescriptionAttachment,
    downloadPrescriptionAttachment,
    downloadPrescriptionPDF,
    getLabRequests,
    getReceptionInquiries,
    createReceptionInquiry,
    resolveReceptionInquiry
};
