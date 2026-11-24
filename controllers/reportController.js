const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const config = require('../config');
const db = require('../models/db');
const blockchain = require('../blockchain/Blockchain');
const { ethereumClient } = require('../blockchain/ethereumClient');
const { computeSHA256, encryptBuffer, decryptBuffer, generatePseudonymousId, TamperDetectedError } = require('../utils/cryptoUtils');
const { canViewReport } = require('../utils/access');
const { validateUploadedFile, sanitizeDownloadFilename, ConcurrencySemaphore } = require('../utils/fileValidation');
const { atomicWriteBufferSync } = require('../utils/atomicWrite');
const { cloudPersistence } = require('../utils/cloudPersistence');
const { sanitizeUser } = require('../middleware/authMiddleware');
const { processReportOCR } = require('../utils/ocrHelper');
const { generateClinicalHighlights } = require('../utils/aiSummarizer');
const { generateMedicalReportPDF } = require('../utils/pdfGenerator');

// Prevents race-condition duplicate uploads from passing concurrently before DB/ledger write completes (F-07 / TC-16)
const inFlightSourceHashes = new Set();

// Caps concurrent heavy OCR + PDF synthesis jobs (F-11)
const ocrSemaphore = new ConcurrencySemaphore(config.MAX_CONCURRENT_OCR_JOBS);

/**
 * Upload a diagnostic medical report (Lab Staff & Admin ONLY).
 * Implements:
 * 1. Magic-byte signature validation (F-11)
 * 2. Strict Lab Request ID ownership & status validation (F-10)
 * 3. Source-bytes SHA-256 deduplication with concurrency lock (F-07)
 * 4. Bounded OCR + honest clinical summary without fabricated normals (F-08)
 * 5. Authenticated AES-256-GCM encryption & atomic file persistence (F-05)
 * 6. Local hash-chain + Live Ethereum EVM Smart Contract anchoring (F-09)
 */
async function uploadReport(req, res) {
    let reservedSourceHash = null;
    let writtenStoragePath = null;

    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please attach a medical report document (PDF, PNG, JPG, WEBP, or TXT).' });
        }

        const validation = validateUploadedFile(req.file);
        if (!validation.valid) {
            return res.status(validation.status).json({ success: false, message: validation.message });
        }

        const user = req.user;
        const {
            patientId,
            title,
            reportType,
            testDate,
            notes,
            manualTags,
            nodeId,
            labRequestId
        } = req.body || {};

        const targetPatient = db.findUserById(patientId);
        if (!targetPatient || targetPatient.role !== 'Patient') {
            return res.status(400).json({ success: false, message: 'Invalid patient selected.' });
        }

        // F-10: Strict labRequestId validation — never silently complete an arbitrary or mismatched order
        let validatedLabRequest = null;
        if (labRequestId && String(labRequestId).trim()) {
            const cleanReqId = String(labRequestId).trim();
            const reqRecord = db.findLabRequestById(cleanReqId);
            if (!reqRecord) {
                return res.status(400).json({
                    success: false,
                    message: `Lab request '${cleanReqId}' was not found.`
                });
            }
            if (reqRecord.patientId !== targetPatient.id) {
                return res.status(400).json({
                    success: false,
                    message: `Lab request '${cleanReqId}' belongs to a different patient and cannot be fulfilled with this upload.`
                });
            }
            if (reqRecord.status !== 'PENDING_UPLOAD') {
                return res.status(409).json({
                    success: false,
                    message: `Lab request '${cleanReqId}' is already marked '${reqRecord.status}' and cannot be completed twice.`
                });
            }
            validatedLabRequest = reqRecord;
        }

        const rawBuffer = req.file.buffer;

        // Step 1: Compute SHA-256 cryptographic hash of raw uploaded source bytes BEFORE any OCR/PDF
        const sourceHash = computeSHA256(rawBuffer);

        // Step 2: Atomic Duplicate Detection (checks in-flight set, DB sourceHash/reportHash, local ledger, and on-chain EVM)
        const existingBlock = blockchain.findBlockByAnyHash(sourceHash);
        const existingReport = db.findReportByAnyHash(sourceHash);
        const onChainDup = await ethereumClient.isHashAnchoredOnChain(sourceHash);

        if (inFlightSourceHashes.has(sourceHash) || existingBlock || existingReport || onChainDup === true) {
            const existingId = existingReport ? existingReport.reportId : (existingBlock ? existingBlock.data.reportId : 'ON_CHAIN_RECORD');
            db.logAudit(
                'DUPLICATE_REPORT_PREVENTED',
                user.name,
                `Duplicate upload rejected. Source SHA-256 ${sourceHash.slice(0, 16)}... matched ${existingId}`
            );

            return res.status(409).json({
                success: false,
                duplicateDetected: true,
                message: 'Duplicate medical report detected! A cryptographically identical report has already been anchored. Redundant upload prevented.',
                existingReportId: existingId,
                fileHash: sourceHash
            });
        }

        // Reserve this sourceHash synchronously before entering async OCR/PDF work
        inFlightSourceHashes.add(sourceHash);
        reservedSourceHash = sourceHash;

        // Step 3 & 4: Bounded OCR, De-identified Clinical Summary & Standardized PDF Generation
        const reportId = generatePseudonymousId('REP');
        const hostUrl = req.protocol + '://' + req.get('host');
        const verificationUrl = `${hostUrl}/verify.html?reportId=${reportId}`;
        const patientPseudonym = targetPatient.patientId || 'PT-' + targetPatient.id.slice(-4);
        const effectiveNodeId = nodeId || (user.role === 'Lab Staff' ? 'NODE-LAB-01' : 'NODE-HOSP-01');
        const effectiveTestDate = testDate || new Date().toISOString().split('T')[0];

        const {
            ocrResult,
            extractedKeywords,
            extractedCategories,
            aiHighlights,
            finalBuffer,
            finalMimeType,
            finalFileName,
            qrCodeDataUrl
        } = await ocrSemaphore.run(async () => {
            const ocrRes = await processReportOCR(rawBuffer, req.file.mimetype, notes);
            let kws = ocrRes.keywords || [];
            const cats = ocrRes.categories || [];
            if (manualTags) {
                const extra = String(manualTags).split(',').map(t => t.trim()).filter(Boolean).slice(0, 20);
                kws = Array.from(new Set([...kws, ...extra]));
            }

            const combinedText = [title, notes, ocrRes.rawSnippet, kws.join(', ')].filter(Boolean).join('\n');
            const highlights = await generateClinicalHighlights(combinedText, {
                title,
                patientPseudonym, // De-identified: never send patientName to external AI
                reportType
            });

            const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
                errorCorrectionLevel: 'H',
                margin: 2,
                color: { dark: '#0b132b', light: '#ffffff' }
            });

            let outBuf = rawBuffer;
            let outMime = req.file.mimetype;
            let outName = sanitizeDownloadFilename(req.file.originalname, `${reportId}.pdf`);

            try {
                const reportStub = {
                    reportId,
                    title: title || 'Clinical Diagnostic Report',
                    patientName: targetPatient.name,
                    patientPseudonym,
                    patientId: targetPatient.id,
                    age: targetPatient.age ?? null,
                    gender: targetPatient.gender || 'Not recorded',
                    uploadedBy: user.name,
                    nodeId: effectiveNodeId,
                    reportType: reportType || 'Diagnostic Investigation',
                    testDate: effectiveTestDate,
                    notes: notes || '',
                    clinicalImpression: highlights.diagnosticImpression,
                    aiHighlights: highlights,
                    testParameters: highlights.testParameters || [],
                    keywords: kws,
                    blockIndex: blockchain.chain.length,
                    sourceHash
                };
                const generatedPdf = await generateMedicalReportPDF(reportStub, hostUrl);
                if (generatedPdf && generatedPdf.length > 0) {
                    outBuf = generatedPdf;
                    outMime = 'application/pdf';
                    outName = `${reportId}_standardized.pdf`;
                }
            } catch (pdfErr) {
                console.warn('[Upload] Standardized PDF synthesis fallback:', pdfErr.message);
            }

            return {
                ocrResult: ocrRes,
                extractedKeywords: kws,
                extractedCategories: cats,
                aiHighlights: highlights,
                finalBuffer: outBuf,
                finalMimeType: outMime,
                finalFileName: outName,
                qrCodeDataUrl: qrDataUrl
            };
        });

        // Re-check labRequest status in case another request completed it while OCR ran
        if (validatedLabRequest) {
            const currentReq = db.findLabRequestById(validatedLabRequest.requestId);
            if (!currentReq || currentReq.status !== 'PENDING_UPLOAD') {
                return res.status(409).json({
                    success: false,
                    message: `Lab request '${validatedLabRequest.requestId}' was completed by another upload.`
                });
            }
        }

        // Step 5: Authenticated AES-256-GCM Encryption & Atomic Disk Write
        const finalDocumentHash = computeSHA256(finalBuffer);
        const encryptedBuffer = encryptBuffer(finalBuffer);
        const storageReference = `${reportId}_encrypted.bin`;
        const storagePath = path.join(config.UPLOADS_DIR, storageReference);
        atomicWriteBufferSync(storagePath, encryptedBuffer);
        writtenStoragePath = storagePath;

        // Step 6: Anchor on Live Ethereum EVM Smart Contract (if configured) + Local Hash-Chain
        const onChainResult = await ethereumClient.anchorReportOnChain({
            reportId,
            sourceHash,
            reportHash: finalDocumentHash,
            storageReference,
            reportType: reportType || 'Diagnostic Investigation',
            patientPseudonym,
            departmentNodeId: effectiveNodeId
        });

        const block = blockchain.addReportBlock({
            reportId,
            sourceHash,
            reportHash: finalDocumentHash,
            storageReference,
            reportType: reportType || 'Diagnostic Investigation',
            testDate: effectiveTestDate,
            patientPseudonym,
            patientId: targetPatient.id,
            onChain: onChainResult
        }, effectiveNodeId);

        // Step 7: Persist Metadata in Application Database
        const newReport = {
            reportId,
            patientId: targetPatient.id,
            patientName: targetPatient.name,
            patientPseudonym,
            uploadedBy: user.name,
            uploaderId: user.id,
            uploaderRole: user.role,
            title: String(title || 'Clinical Diagnostic Report').trim().slice(0, 200),
            reportType: String(reportType || 'Diagnostic Test').trim().slice(0, 120),
            testDate: effectiveTestDate,
            notes: typeof notes === 'string' ? notes.trim().slice(0, 2000) : '',
            keywords: extractedKeywords,
            categories: extractedCategories,
            aiHighlights,
            testParameters: aiHighlights.testParameters || [],
            clinicianReviewed: false,
            rawSnippet: ocrResult.rawSnippet || '',
            fileName: finalFileName,
            mimeType: finalMimeType,
            sourceHash,
            reportHash: finalDocumentHash,
            storageReference,
            fileSize: finalBuffer.length,
            encryptedSize: encryptedBuffer.length,
            qrCodeDataUrl,
            verificationUrl,
            blockIndex: block.index,
            blockHash: block.hash,
            onChain: onChainResult,
            linkedLabRequestId: validatedLabRequest ? validatedLabRequest.requestId : null,
            createdAt: new Date().toISOString(),
            status: onChainResult.anchoredOnChain ? 'ANCHORED_ON_ETHEREUM' : 'ANCHORED_ON_LOCAL_LEDGER'
        };

        db.addReport(newReport);

        // Complete ONLY the explicitly validated labRequestId (never auto-close arbitrary orders!)
        if (validatedLabRequest) {
            db.completeLabRequest(validatedLabRequest.requestId, reportId);
        }

        // Prevent cleanup in catch after successful commit
        writtenStoragePath = null;

        db.logAudit(
            'REPORT_UPLOADED',
            user.name,
            `Uploaded report ${reportId} for ${targetPatient.name}. Local Block #${block.index}${onChainResult.anchoredOnChain ? ` | On-Chain TX: ${onChainResult.txHash}` : ''}`
        );

        if (cloudPersistence.isEnabled()) {
            try {
                await cloudPersistence.saveEncryptedFile(storageReference, encryptedBuffer);
                await cloudPersistence.flushAll();
            } catch (cloudErr) {
                console.error('[Upload Controller] Cloud persistence sync warning:', cloudErr.message);
            }
        }

        return res.status(201).json({
            success: true,
            message: onChainResult.anchoredOnChain
                ? `Medical report encrypted (AES-256-GCM) and anchored on ${onChainResult.network} (TX: ${onChainResult.txHash.slice(0, 14)}...).`
                : 'Medical report encrypted (AES-256-GCM), anchored to local hash-chain ledger, and verification QR generated.',
            report: newReport,
            block: {
                index: block.index,
                hash: block.hash,
                previousHash: block.previousHash,
                timestamp: block.timestamp
            },
            onChain: onChainResult,
            ocrInfo: {
                extractedKeywords,
                categories: extractedCategories
            }
        });
    } catch (err) {
        if (writtenStoragePath && fs.existsSync(writtenStoragePath)) {
            try { fs.unlinkSync(writtenStoragePath); } catch (_) {}
        }
        console.error('[Upload Controller Error]:', err);
        return res.status(500).json({ success: false, message: 'Internal server error processing report.' });
    } finally {
        if (reservedSourceHash) {
            inFlightSourceHashes.delete(reservedSourceHash);
        }
    }
}

/**
 * Retrieve reports based on user role and query.
 * - Receptionist: 403 Denied (F-04 / TC-27)
 * - Lab Staff: 200 with empty list (upload-only privacy isolation, TC-27)
 * - Patient: own non-deleted reports only
 * - Doctor / Admin: hospital non-deleted reports (Admin access audited)
 */
function getReports(req, res) {
    const user = req.user;
    const { patientId, query } = req.query;

    if (user.role === 'Receptionist') {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Receptionist role is restricted to patient registration and billing.'
        });
    }

    if (user.role === 'Lab Staff') {
        return res.json({
            success: true,
            count: 0,
            reports: [],
            restrictedForLab: true,
            message: 'Lab Staff role is restricted to uploading diagnostic reports and processing lab orders.'
        });
    }

    if (user.role === 'Admin') {
        db.logAudit('ADMIN_CLINICAL_ACCESS', user.name, `Admin browsed clinical report list${patientId ? ` (patientId=${patientId})` : ''}`);
    }

    let reports;
    if (user.role === 'Patient') {
        reports = query
            ? db.searchReports(query, 'Patient', user.id)
            : db.getReportsForPatient(user.id);
    } else if (query) {
        reports = db.searchReports(query, user.role, patientId || null);
    } else if (patientId) {
        reports = db.getReportsForPatient(patientId);
    } else {
        reports = db.getAllReports();
    }

    return res.json({ success: true, count: reports.length, reports });
}

/**
 * Chronological Medical History Timeline
 */
function getPatientTimeline(req, res) {
    const user = req.user;
    if (user.role === 'Lab Staff' || user.role === 'Receptionist') {
        return res.status(403).json({
            success: false,
            message: `Access denied. Role '${user.role}' cannot view patient medical timelines.`
        });
    }

    let targetPatientId = req.params.patientId;
    if (user.role === 'Patient') {
        if (targetPatientId && targetPatientId !== user.id && targetPatientId !== user.patientId) {
            db.logAudit('UNAUTHORIZED_IDOR_BLOCKED', user.name, `Blocked Patient ${user.id} from viewing timeline for ${targetPatientId}`);
            return res.status(403).json({ success: false, message: 'Access denied. You can only view your own medical timeline.' });
        }
        targetPatientId = user.id;
    } else if (!targetPatientId) {
        return res.status(400).json({ success: false, message: 'Patient ID is required.' });
    }

    if (user.role === 'Admin') {
        db.logAudit('ADMIN_CLINICAL_ACCESS', user.name, `Admin viewed clinical timeline for ${targetPatientId}`);
    }

    const sortOrder = req.query.order === 'desc' ? 'desc' : 'asc';
    const timeline = db.getPatientTimeline(targetPatientId, sortOrder);
    const patient = db.findUserById(targetPatientId);

    return res.json({
        success: true,
        patient: patient ? sanitizeUser(patient, { includeBillNumber: false, includeContact: false }) : { id: targetPatientId, name: 'Unknown Patient' },
        count: timeline.length,
        timeline
    });
}

function getReportById(req, res) {
    const user = req.user;
    const report = db.findReportById(req.params.reportId);
    if (!report) {
        return res.status(404).json({ success: false, message: 'Report not found.' });
    }

    if (!canViewReport(user, report)) {
        if (user.role === 'Patient') {
            db.logAudit('UNAUTHORIZED_IDOR_BLOCKED', user.name, `Blocked Patient ${user.id} from viewing report ${report.reportId} belonging to ${report.patientId}`);
        }
        return res.status(403).json({
            success: false,
            message: 'Access denied. You are not authorized to view this diagnostic report.'
        });
    }

    if (user.role === 'Admin') {
        db.logAudit('ADMIN_CLINICAL_ACCESS', user.name, `Admin inspected report metadata ${report.reportId}`);
    }

    return res.json({ success: true, report });
}

async function downloadDecryptedReport(req, res) {
    try {
        const user = req.user;
        const report = db.findReportById(req.params.reportId);
        if (!report) {
            return res.status(404).json({ success: false, message: 'Report not found.' });
        }

        if (!canViewReport(user, report)) {
            if (user.role === 'Patient') {
                db.logAudit('UNAUTHORIZED_IDOR_BLOCKED', user.name, `Blocked Patient ${user.id} from downloading report ${report.reportId} belonging to ${report.patientId}`);
            }
            return res.status(403).json({
                success: false,
                message: 'Access denied. You are not authorized to download this medical report.'
            });
        }

        const filePath = path.join(config.UPLOADS_DIR, path.basename(report.storageReference));
        if (!fs.existsSync(filePath)) {
            await cloudPersistence.ensureLocalEncryptedFile(report.storageReference);
        }
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: 'Encrypted off-chain file not found.' });
        }

        const encryptedData = fs.readFileSync(filePath);
        let decryptedBuffer;
        try {
            decryptedBuffer = decryptBuffer(encryptedData);
        } catch (decErr) {
            if (decErr instanceof TamperDetectedError || decErr.isTampered) {
                db.logAudit('TAMPER_ALERT_ON_DOWNLOAD', user.name, `Report ${report.reportId} failed authenticated decryption during download!`);
                return res.status(400).json({
                    success: false,
                    tampered: true,
                    message: 'SECURITY ALERT: Authenticated decryption failed! The stored encrypted file has been tampered with or corrupted.'
                });
            }
            throw decErr;
        }

        const liveHash = computeSHA256(decryptedBuffer);
        if (liveHash !== report.reportHash) {
            db.logAudit('TAMPER_ALERT_ON_DOWNLOAD', user.name, `Report ${report.reportId} failed SHA-256 verification during download!`);
            return res.status(400).json({
                success: false,
                tampered: true,
                message: 'SECURITY ALERT: File hash does not match anchored ledger record! File has been tampered with or corrupted.'
            });
        }

        if (user.role === 'Admin') {
            db.logAudit('ADMIN_CLINICAL_ACCESS', user.name, `Admin decrypted and downloaded report ${report.reportId}`);
        } else {
            db.logAudit('REPORT_DECRYPTED', user.name, `Decrypted and accessed report ${report.reportId}`);
        }

        const isInline = req.query.inline === 'true';
        const dispositionType = isInline ? 'inline' : 'attachment';
        const safeFileName = sanitizeDownloadFilename(report.fileName, `${report.reportId}.pdf`);

        res.setHeader('Content-Type', report.mimeType || 'application/pdf');
        res.setHeader('Content-Disposition', `${dispositionType}; filename="${safeFileName}"`);
        res.setHeader('Content-Length', decryptedBuffer.length);
        res.setHeader('X-Blockchain-Verified', 'true');
        res.setHeader('X-Report-Hash', liveHash);

        return res.send(decryptedBuffer);
    } catch (err) {
        console.error('[Download Controller Error]:', err);
        return res.status(500).json({ success: false, message: 'Decryption failed.' });
    }
}

function searchReports(req, res) {
    const { q, patientId } = req.query;
    const user = req.user;

    if (user.role === 'Lab Staff' || user.role === 'Receptionist') {
        return res.status(403).json({
            success: false,
            message: `Access denied. Role '${user.role}' cannot search patient medical reports.`
        });
    }

    if (user.role === 'Admin') {
        db.logAudit('ADMIN_CLINICAL_ACCESS', user.name, `Admin searched clinical reports (query="${String(q || '').slice(0, 60)}")`);
    }

    const results = db.searchReports(q, user.role, user.role === 'Patient' ? user.id : (patientId || null));
    return res.json({
        success: true,
        query: q || '',
        count: results.length,
        results
    });
}

function updateReport(req, res) {
    try {
        const user = req.user;
        const { reportId } = req.params;
        const { notes, diagnosisStatus, prescription, followUpDate } = req.body || {};

        const existingReport = db.findReportById(reportId);
        if (!existingReport) {
            return res.status(404).json({ success: false, message: 'Report not found.' });
        }

        const nowIso = new Date().toISOString();
        const updates = {
            clinicianReviewed: true,
            clinicianReviewedBy: user.name,
            clinicianReviewedAt: nowIso
        };
        if (notes !== undefined) updates.notes = String(notes).slice(0, 2000);
        if (diagnosisStatus !== undefined) updates.diagnosisStatus = String(diagnosisStatus).slice(0, 120);
        if (prescription !== undefined) updates.prescription = String(prescription).slice(0, 2000);
        if (followUpDate !== undefined) updates.followUpDate = String(followUpDate).slice(0, 40);

        updates.doctorRemarks = {
            doctorName: user.name,
            doctorId: user.id,
            department: user.department || 'Attending Physician',
            hospital: user.hospital || 'SIT Students Hospital',
            updatedAt: nowIso,
            status: updates.diagnosisStatus || existingReport.diagnosisStatus || 'Reviewed & Verified'
        };

        const existingShared = Array.isArray(existingReport.sharedDoctorNotes) ? [...existingReport.sharedDoctorNotes] : [];
        existingShared.push({
            noteId: 'note_' + Date.now().toString(36),
            doctorName: user.name,
            doctorId: user.id,
            department: user.department || 'General Medicine',
            status: updates.diagnosisStatus || 'Reviewed & Prescribed',
            notes: updates.notes || 'Clinical evaluation completed.',
            prescription: updates.prescription || 'Continue prescribed treatment.',
            followUpDate: updates.followUpDate || '',
            updatedAt: nowIso
        });
        updates.sharedDoctorNotes = existingShared;

        if (existingReport.aiHighlights) {
            updates.aiHighlights = {
                ...existingReport.aiHighlights,
                clinicianReviewed: true
            };
        }

        const updated = db.updateReport(reportId, updates);
        db.logAudit('DOCTOR_CLINICAL_UPDATE', user.name, `Updated clinical evaluation for report ${reportId}`);

        return res.json({
            success: true,
            message: `Clinical notes and review updated by ${user.name}.`,
            report: updated
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to update report.' });
    }
}

/**
 * F-04: Soft-delete a medical report (Admin ONLY, mandatory non-empty reason).
 * Preserves the encrypted file and immutable blockchain block for auditability.
 */
function deleteReport(req, res) {
    try {
        const user = req.user;
        const { reportId } = req.params;
        const reason = typeof (req.body && req.body.reason) === 'string' ? req.body.reason.trim() : '';

        if (!reason || reason.length < 3 || reason.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'A documented reason (3-500 characters) is required to soft-delete a clinical report.'
            });
        }

        const report = db.findReportById(reportId);
        if (!report) {
            return res.status(404).json({
                success: false,
                message: `Report ${reportId} not found.`
            });
        }

        const softDeleted = db.softDeleteReport(reportId, {
            deletedBy: `${user.name} (${user.id})`,
            deleteReason: reason
        });

        db.logAudit(
            'REPORT_SOFT_DELETED',
            user.name,
            `Soft-deleted report ${reportId} ("${report.title}"). Encrypted archive & ledger block retained. Reason: ${reason}`
        );

        return res.json({
            success: true,
            message: `Report ${reportId} soft-deleted from active clinical views (encrypted evidence & blockchain anchor retained).`,
            reportId,
            deletedAt: softDeleted.deletedAt
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to soft-delete report.' });
    }
}

module.exports = {
    uploadReport,
    getReports,
    getPatientTimeline,
    getReportById,
    downloadDecryptedReport,
    searchReports,
    updateReport,
    deleteReport
};
