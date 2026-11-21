const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { SAMPLE_USERS, createSeedReports } = require('../utils/seedData');
const blockchain = require('../blockchain/Blockchain');
const { hashPassword, isScryptHash } = require('../utils/passwords');
const { atomicWriteJsonSync } = require('../utils/atomicWrite');

const SEEDED_DEMO_IDS = new Set(SAMPLE_USERS.map(u => u.id));

class Database {
    constructor() {
        this.users = [];
        this.reports = [];
        this.sharedLinks = [];
        this.auditLogs = [];
        this.prescriptions = [];
        this.labRequests = [];
        this.inquiries = [];
        this.init();
    }

    get dbFilePath() {
        return config.DB_FILE_PATH;
    }

    get uploadsDir() {
        return config.UPLOADS_DIR;
    }

    init() {
        const dataDir = path.dirname(this.dbFilePath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        if (!fs.existsSync(this.uploadsDir)) {
            fs.mkdirSync(this.uploadsDir, { recursive: true });
        }

        if (fs.existsSync(this.dbFilePath)) {
            let data = null;
            try {
                data = JSON.parse(fs.readFileSync(this.dbFilePath, 'utf8'));
            } catch (err) {
                console.error('[Database] Primary database.json unreadable:', err.message);
                // Attempt backup recovery before failing — never silently overwrite existing data with demo seeds
                for (let i = 1; i <= 5; i++) {
                    const bakPath = `${this.dbFilePath}.bak.${i}`;
                    if (fs.existsSync(bakPath)) {
                        try {
                            data = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
                            console.warn(`[Database] Recovered database from ${path.basename(bakPath)}.`);
                            break;
                        } catch (_) {}
                    }
                }
                if (!data) {
                    throw new Error(`[Database] Fatal: ${this.dbFilePath} is corrupted and no readable backup exists (${err.message})`);
                }
            }

            this.users = Array.isArray(data.users) ? data.users : [];
            this.reports = Array.isArray(data.reports) ? data.reports : [];
            this.sharedLinks = Array.isArray(data.sharedLinks) ? data.sharedLinks : [];
            this.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
            this.prescriptions = Array.isArray(data.prescriptions) ? data.prescriptions : [];
            this.labRequests = Array.isArray(data.labRequests) ? data.labRequests : [];
            this.inquiries = Array.isArray(data.inquiries) ? data.inquiries : [];

            let dbUpdated = false;

            // Phase 1.2: Migrate any legacy plain-text passwords to scrypt passwordHash and strip plain-text field
            for (const u of this.users) {
                if (typeof u.password === 'string' && u.password.length > 0) {
                    if (!isScryptHash(u.passwordHash)) {
                        u.passwordHash = hashPassword(u.password);
                    }
                    delete u.password;
                    dbUpdated = true;
                }
                if (typeof u.isDemoAccount !== 'boolean' && SEEDED_DEMO_IDS.has(u.id)) {
                    u.isDemoAccount = true;
                    dbUpdated = true;
                }
                if (typeof u.tokenVersion !== 'number') {
                    u.tokenVersion = 0;
                    dbUpdated = true;
                }
                if (typeof u.mustChangePassword !== 'boolean') {
                    u.mustChangePassword = false;
                    dbUpdated = true;
                }
                if (typeof u.disabled !== 'boolean') {
                    u.disabled = false;
                    dbUpdated = true;
                }
            }

            // Ensure every existing report has sourceHash populated (fallback to reportHash for pre-existing seed PDFs)
            for (const r of this.reports) {
                if (!r.sourceHash && r.reportHash) {
                    r.sourceHash = r.reportHash;
                    dbUpdated = true;
                }
            }

            // Strip any raw JWT tokens from legacy sharedLinks records
            for (const link of this.sharedLinks) {
                if (link.token) {
                    delete link.token;
                    dbUpdated = true;
                }
                if (!link.jti) {
                    link.jti = 'legacy_' + crypto.randomBytes(6).toString('hex');
                    dbUpdated = true;
                }
            }

            if (this._ensureBootstrapAdmin()) {
                dbUpdated = true;
            }

            if (dbUpdated) {
                this.persist();
            }
        } else {
            // Fresh empty data directory
            if (config.DEMO_MODE) {
                this.seedInitialData();
            } else {
                this._ensureBootstrapAdmin();
                this.persist();
            }
        }
    }

    /**
     * Ensures a non-demo Hospital Admin exists when BOOTSTRAP_ADMIN_EMAIL & BOOTSTRAP_ADMIN_PASSWORD are configured.
     * In production with DEMO_MODE=false, refuses to run without at least one active non-demo Admin.
     */
    _ensureBootstrapAdmin() {
        let updated = false;
        const email = config.BOOTSTRAP_ADMIN_EMAIL;
        const password = config.BOOTSTRAP_ADMIN_PASSWORD;

        if (email && password) {
            if (password.length < 12) {
                console.error('[FATAL CONFIG] BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters long.');
                process.exit(1);
            }
            const existing = this.users.find(u => u.email && u.email.toLowerCase() === email);
            if (existing) {
                if (existing.isDemoAccount || existing.role !== 'Admin') {
                    existing.role = 'Admin';
                    existing.isDemoAccount = false;
                    existing.disabled = false;
                    existing.mustChangePassword = false;
                    existing.passwordHash = hashPassword(password);
                    delete existing.password;
                    updated = true;
                }
            } else {
                this.users.push({
                    id: 'usr_adm_bootstrap',
                    name: 'Hospital IT Admin',
                    email,
                    passwordHash: hashPassword(password),
                    role: 'Admin',
                    institution: 'SIT Students Hospital Administration',
                    hospital: 'SIT Students Hospital',
                    isDemoAccount: false,
                    mustChangePassword: false,
                    disabled: false,
                    tokenVersion: 0,
                    createdAt: new Date().toISOString()
                });
                updated = true;
            }
        }

        const hasNonDemoAdmin = this.users.some(u => u.role === 'Admin' && !u.isDemoAccount && !u.disabled);
        if (!config.DEMO_MODE && !hasNonDemoAdmin) {
            if (config.NODE_ENV === 'production') {
                console.error('[FATAL CONFIG] Production mode with DEMO_MODE=false requires a non-demo Admin account.');
                console.error('Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (>=12 chars) in environment variables.');
                process.exit(1);
            } else {
                console.warn('[SECURITY NOTICE] Running with DEMO_MODE=false and no non-demo Admin account. Set BOOTSTRAP_ADMIN_EMAIL & BOOTSTRAP_ADMIN_PASSWORD in .env to enable Admin login.');
            }
        }

        return updated;
    }

    async seedInitialData() {
        console.log('[Database] Seeding synthetic demo users and clinical records...');
        const defaultDemoPassHash = hashPassword('Demo@SIT2026!');

        this.users = SAMPLE_USERS.map(u => ({
            ...u,
            passwordHash: u.passwordHash || defaultDemoPassHash,
            isDemoAccount: true,
            mustChangePassword: false,
            disabled: false,
            tokenVersion: 0,
            createdAt: u.createdAt || new Date().toISOString()
        }));

        const seedReports = await createSeedReports(this.uploadsDir);

        blockchain.chain = [blockchain.createGenesisBlock()];
        blockchain.chain[0].mineBlock(blockchain.difficulty);

        for (const rep of seedReports) {
            const block = blockchain.addReportBlock({
                reportId: rep.reportId,
                sourceHash: rep.sourceHash || rep.reportHash,
                reportHash: rep.reportHash,
                storageReference: rep.storageReference,
                reportType: rep.reportType,
                testDate: rep.testDate,
                patientPseudonym: rep.patientPseudonym,
                patientId: rep.patientId
            }, rep.nodeId || (rep.uploaderRole === 'Doctor' ? 'NODE-HOSP-01' : 'NODE-LAB-01'));

            rep.blockIndex = block.index;
            rep.blockHash = block.hash;
        }

        this.reports = seedReports;

        if (!this.prescriptions || this.prescriptions.length === 0) {
            this.prescriptions = [
                {
                    prescriptionId: 'RX-2026-101',
                    patientId: 'usr_pat_01',
                    patientName: 'John Doe',
                    patientUhid: 'PT-9901',
                    billNumber: 'BILL-2026-1001',
                    doctorId: 'usr_doc_01',
                    doctorName: 'Dr. Sarah Rao, MD',
                    department: 'Cardiology & General Medicine',
                    vitals: 'BP: 132/84 mmHg | Pulse: 78 bpm | Temp: 98.4 F | Weight: 74 kg',
                    symptoms: 'Mild fatigue, increased thirst (polydipsia), and lower back stiffness.',
                    diagnosis: 'Stage-2 Type 2 Diabetes Mellitus with Mild Lumbar Spondylosis',
                    medicines: [
                        { name: 'Tab. Metformin Sustained Release 500mg', dosage: '1 - 0 - 1', duration: '30 Days', instructions: 'After Meals' },
                        { name: 'Tab. Shelcal-500 (Calcium + Vit D3)', dosage: '0 - 1 - 0', duration: '30 Days', instructions: 'After Lunch' },
                        { name: 'Gel Volini / Diclofenac Topical', dosage: 'Apply BD', duration: '7 Days', instructions: 'Lower Back' }
                    ],
                    advice: 'Avoid refined sugar and deep-fried foods. 30 minutes brisk morning walk daily.',
                    labTestOrdered: 'Fasting & Postprandial Blood Glucose Follow-up',
                    followUpDate: '2026-12-05',
                    createdAt: '2026-10-12T10:30:00.000Z'
                },
                {
                    prescriptionId: 'RX-2026-102',
                    patientId: 'usr_pat_04',
                    patientName: 'Ayesha Khan',
                    patientUhid: 'PT-9904',
                    billNumber: 'BILL-2026-1004',
                    doctorId: 'usr_doc_03',
                    doctorName: 'Dr. Ananya Sen, MD',
                    department: 'Pulmonology & Respiratory Care',
                    vitals: 'BP: 116/74 mmHg | SpO2: 98% | Pulse: 82 bpm | Temp: 98.2 F',
                    symptoms: 'Dry nocturnal cough and wheezing after exposure to classroom dust.',
                    diagnosis: 'Mild Persistent Allergic Bronchial Asthma',
                    medicines: [
                        { name: 'Inhaler Budesonide + Formoterol 200/6 mcg', dosage: '1 Puff - 0 - 1 Puff', duration: '30 Days', instructions: 'Rinse Mouth After Use' },
                        { name: 'Tab. Montelukast + Levocetirizine 10/5mg', dosage: '0 - 0 - 1', duration: '10 Days', instructions: 'At Bedtime' }
                    ],
                    advice: 'Use warm water for drinking; avoid cold beverages and dusty environments.',
                    labTestOrdered: 'Complete Blood Count (CBC) & Eosinophil Count',
                    followUpDate: '2026-11-28',
                    createdAt: '2026-10-15T14:15:00.000Z'
                }
            ];
        }

        if (!this.labRequests || this.labRequests.length === 0) {
            this.labRequests = [
                {
                    requestId: 'LABREQ-201',
                    patientId: 'usr_pat_01',
                    patientName: 'John Doe',
                    patientUhid: 'PT-9901',
                    billNumber: 'BILL-2026-1001',
                    requestedBy: 'Dr. Sarah Rao (Cardiology & General Medicine)',
                    testTitle: 'Fasting & Postprandial Blood Glucose Follow-up',
                    reportType: 'Pathology / Biochemistry',
                    priority: 'Routine OPD',
                    status: 'PENDING_UPLOAD',
                    createdAt: '2026-10-12T10:35:00.000Z'
                },
                {
                    requestId: 'LABREQ-202',
                    patientId: 'usr_pat_04',
                    patientName: 'Ayesha Khan',
                    patientUhid: 'PT-9904',
                    billNumber: 'BILL-2026-1004',
                    requestedBy: 'Dr. Ananya Sen (Pulmonology Wing)',
                    testTitle: 'Complete Blood Count (CBC) & Absolute Eosinophil Count',
                    reportType: 'Hematology',
                    priority: 'Priority OPD',
                    status: 'PENDING_UPLOAD',
                    createdAt: '2026-10-15T14:20:00.000Z'
                }
            ];
        }

        this.auditLogs = [
            {
                id: 'log_01',
                action: 'SYSTEM_INITIALIZATION',
                details: 'SIT Students Hospital Demo Database and Hash-Chain Initialized (Synthetic Data)',
                timestamp: new Date().toISOString(),
                actor: 'System Initializer'
            }
        ];

        this._ensureBootstrapAdmin();
        this.persist();
        console.log(`[Database] Seeded ${this.reports.length} synthetic PDF reports.`);
        return this.reports;
    }

    persist() {
        const payload = {
            users: this.users,
            reports: this.reports,
            sharedLinks: this.sharedLinks,
            auditLogs: this.auditLogs,
            prescriptions: this.prescriptions,
            labRequests: this.labRequests,
            inquiries: this.inquiries
        };
        atomicWriteJsonSync(this.dbFilePath, payload, { maxBackups: 5 });
    }

    // --- Users ---
    findUserById(id) {
        return this.users.find(u => u.id === id);
    }

    findUserByEmail(email) {
        if (!email) return undefined;
        const clean = String(email).trim().toLowerCase();
        return this.users.find(u => u.email && u.email.toLowerCase() === clean);
    }

    addUser(userData) {
        const record = { ...userData };
        if (!record.id) {
            const prefix = record.role === 'Doctor' ? 'usr_doc'
                : record.role === 'Patient' ? 'usr_pat'
                : record.role === 'Lab Staff' ? 'usr_lab'
                : record.role === 'Receptionist' ? 'usr_rec'
                : 'usr_adm';
            record.id = `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
        }
        if (record.password && !record.passwordHash) {
            record.passwordHash = hashPassword(record.password);
        }
        delete record.password;

        if (typeof record.tokenVersion !== 'number') record.tokenVersion = 0;
        if (typeof record.mustChangePassword !== 'boolean') record.mustChangePassword = false;
        if (typeof record.disabled !== 'boolean') record.disabled = false;
        if (typeof record.isDemoAccount !== 'boolean') record.isDemoAccount = false;
        if (!record.createdAt) record.createdAt = new Date().toISOString();

        this.users.push(record);
        this.persist();
        return record;
    }

    updateUser(userId, updates) {
        const idx = this.users.findIndex(u => u.id === userId);
        if (idx === -1) return null;
        const next = { ...this.users[idx], ...updates };
        delete next.password;
        this.users[idx] = next;
        this.persist();
        return next;
    }

    bumpTokenVersion(userId) {
        const user = this.findUserById(userId);
        if (!user) return null;
        user.tokenVersion = (Number(user.tokenVersion) || 0) + 1;
        this.persist();
        return user;
    }

    deleteUser(userId) {
        const index = this.users.findIndex(u => u.id === userId);
        if (index !== -1) {
            const removed = this.users.splice(index, 1)[0];
            this.persist();
            return removed;
        }
        return null;
    }

    getAllUsers() {
        return this.users;
    }

    // --- Reports ---
    getAllReports({ includeDeleted = false } = {}) {
        if (includeDeleted) return this.reports;
        return this.reports.filter(r => !r.deletedAt);
    }

    findReportById(id, { includeDeleted = false } = {}) {
        const found = this.reports.find(r => r.reportId === id || r.id === id);
        if (!found) return null;
        if (!includeDeleted && found.deletedAt) return null;
        return found;
    }

    findReportByHash(hash, { includeDeleted = false } = {}) {
        if (!hash) return null;
        const target = String(hash).toLowerCase();
        return this.reports.find(r => {
            if (!includeDeleted && r.deletedAt) return false;
            return (
                (r.reportHash && String(r.reportHash).toLowerCase() === target) ||
                (r.sourceHash && String(r.sourceHash).toLowerCase() === target)
            );
        }) || null;
    }

    findReportBySourceHash(hash, { includeDeleted = false } = {}) {
        if (!hash) return null;
        const target = String(hash).toLowerCase();
        return this.reports.find(r => {
            if (!includeDeleted && r.deletedAt) return false;
            return r.sourceHash && String(r.sourceHash).toLowerCase() === target;
        }) || null;
    }

    findReportByAnyHash(hash, opts = {}) {
        return this.findReportByHash(hash, opts);
    }

    getReportsForPatient(patientId) {
        return this.reports.filter(r =>
            !r.deletedAt && (r.patientId === patientId || r.patientPseudonym === patientId)
        );
    }

    getPatientTimeline(patientId, sortOrder = 'asc') {
        const patientReports = this.getReportsForPatient(patientId);
        return [...patientReports].sort((a, b) => {
            const dateA = new Date(a.testDate || a.createdAt);
            const dateB = new Date(b.testDate || b.createdAt);
            return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
        });
    }

    searchReports(query, role = 'Doctor', patientId = null) {
        if (role === 'Receptionist' || role === 'Lab Staff') {
            return [];
        }
        const q = (query || '').toLowerCase().trim();
        let list = this.getAllReports();

        if (role === 'Patient' && patientId) {
            list = list.filter(r => r.patientId === patientId);
        } else if (patientId) {
            list = list.filter(r => r.patientId === patientId || r.patientPseudonym === patientId);
        }

        if (!q) return list;

        return list.filter(r => {
            const titleMatch = r.title && r.title.toLowerCase().includes(q);
            const notesMatch = r.notes && r.notes.toLowerCase().includes(q);
            const patientMatch = r.patientName && r.patientName.toLowerCase().includes(q);
            const tagMatch = r.keywords && r.keywords.some(k => k.toLowerCase().includes(q));
            const categoryMatch = r.categories && r.categories.some(c => c.toLowerCase().includes(q));
            const reportIdMatch = r.reportId && r.reportId.toLowerCase().includes(q);
            return titleMatch || notesMatch || patientMatch || tagMatch || categoryMatch || reportIdMatch;
        });
    }

    addReport(reportData) {
        this.reports.unshift(reportData);
        this.persist();
        return reportData;
    }

    updateReport(reportId, updates) {
        const idx = this.reports.findIndex(r => r.reportId === reportId && !r.deletedAt);
        if (idx !== -1) {
            this.reports[idx] = { ...this.reports[idx], ...updates };
            this.persist();
            return this.reports[idx];
        }
        return null;
    }

    /**
     * Soft-deletes a report while preserving encrypted storage file and immutable blockchain block (F-04)
     */
    softDeleteReport(reportId, { deletedBy, deleteReason }) {
        const idx = this.reports.findIndex(r => (r.reportId === reportId || r.id === reportId) && !r.deletedAt);
        if (idx === -1) return null;
        this.reports[idx] = {
            ...this.reports[idx],
            deletedAt: new Date().toISOString(),
            deletedBy,
            deleteReason
        };
        this.persist();
        return this.reports[idx];
    }

    // --- Time-Expiring Shared Access Links (keyed by jti, never storing raw JWT) ---
    addSharedLink(linkData) {
        const { token, ...safeRecord } = linkData;
        this.sharedLinks.unshift(safeRecord);
        this.persist();
        return safeRecord;
    }

    findSharedLinkByJti(jti) {
        if (!jti) return null;
        return this.sharedLinks.find(l => l.jti === jti) || null;
    }

    revokeSharedLink(jti, revokedBy) {
        const link = this.findSharedLinkByJti(jti);
        if (!link) return null;
        link.revokedAt = new Date().toISOString();
        link.revokedBy = revokedBy;
        this.persist();
        return link;
    }

    getSharedLinksForUser(user) {
        if (!user) return [];
        if (user.role === 'Admin') return this.sharedLinks;
        if (user.role === 'Patient') {
            return this.sharedLinks.filter(l => l.patientId === user.id || l.createdBy === user.id);
        }
        if (user.role === 'Doctor') {
            return this.sharedLinks.filter(l => l.createdBy === user.id);
        }
        return [];
    }

    // --- Audit Logs ---
    logAudit(action, actor, details) {
        const entry = {
            id: 'log_' + Date.now() + '_' + crypto.randomBytes(2).toString('hex'),
            action,
            actor,
            details,
            timestamp: new Date().toISOString()
        };
        this.auditLogs.unshift(entry);
        if (this.auditLogs.length > 500) {
            this.auditLogs.length = 500;
        }
        this.persist();
        return entry;
    }

    getAuditLogs() {
        return this.auditLogs;
    }

    // --- Doctor OPD Checkup Prescriptions ---
    getPrescriptions(patientId = null) {
        if (patientId) {
            return this.prescriptions.filter(p => p.patientId === patientId || p.patientUhid === patientId);
        }
        return this.prescriptions;
    }

    findPrescriptionById(prescriptionId) {
        return this.prescriptions.find(p => p.prescriptionId === prescriptionId) || null;
    }

    addPrescription(rxData) {
        this.prescriptions.unshift(rxData);
        this.persist();
        return rxData;
    }

    updatePrescription(prescriptionId, updates) {
        const idx = this.prescriptions.findIndex(p => p.prescriptionId === prescriptionId);
        if (idx === -1) return null;
        this.prescriptions[idx] = { ...this.prescriptions[idx], ...updates };
        this.persist();
        return this.prescriptions[idx];
    }

    // --- Lab Test Requests Queue ---
    getLabRequests() {
        return this.labRequests;
    }

    findLabRequestById(requestId) {
        return this.labRequests.find(r => r.requestId === requestId) || null;
    }

    addLabRequest(reqData) {
        this.labRequests.unshift(reqData);
        this.persist();
        return reqData;
    }

    completeLabRequest(requestId, reportId) {
        const item = this.labRequests.find(r => r.requestId === requestId);
        if (item) {
            item.status = 'COMPLETED';
            item.linkedReportId = reportId;
            item.completedAt = new Date().toISOString();
            this.persist();
        }
        return item;
    }

    // --- Patient Helpdesk Inquiries ---
    getInquiries() {
        return this.inquiries;
    }

    addInquiry(inqData) {
        this.inquiries.unshift(inqData);
        this.persist();
        return inqData;
    }

    resolveInquiry(ticketId, resolvedBy = 'Receptionist') {
        const item = this.inquiries.find(i => i.ticketId === ticketId);
        if (item) {
            item.status = 'RESOLVED';
            item.resolvedAt = new Date().toISOString();
            item.resolvedBy = resolvedBy;
            this.persist();
        }
        return item;
    }
}

const dbInstance = new Database();
module.exports = dbInstance;
