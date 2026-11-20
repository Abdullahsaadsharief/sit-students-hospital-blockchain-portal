const fs = require('fs');
const path = require('path');
const { SAMPLE_USERS, createSeedReports } = require('../utils/seedData');
const blockchain = require('../blockchain/Blockchain');

const DB_FILE_PATH = path.join(__dirname, '..', 'data', 'database.json');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

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

    init() {
        const dataDir = path.dirname(DB_FILE_PATH);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        if (!fs.existsSync(UPLOADS_DIR)) {
            fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        }

        if (fs.existsSync(DB_FILE_PATH)) {
            try {
                const data = JSON.parse(fs.readFileSync(DB_FILE_PATH, 'utf8'));
                this.users = (data.users || []).map(u => ({ password: 'password123', ...u }));
                this.reports = data.reports || [];
                this.sharedLinks = data.sharedLinks || [];
                this.auditLogs = data.auditLogs || [];
                this.prescriptions = data.prescriptions || [];
                this.labRequests = data.labRequests || [];
                this.inquiries = data.inquiries || [];

                // Ensure Receptionist account and patient billNumbers exist in loaded DB
                let dbUpdated = false;
                const defaultBills = {
                    'PT-9901': { billNumber: 'BILL-2026-1001', assignedDoctor: 'Dr. Sarah Rao (Cardiology & General Medicine)', visitReason: 'Glycemic Profile, Spine X-Ray & CBC Follow-up', billAmount: '₹ 450' },
                    'PT-9902': { billNumber: 'BILL-2026-1002', assignedDoctor: 'Dr. Sarah Rao (Cardiology & General Medicine)', visitReason: 'Lipid Profile & Thyroid TSH Screening', billAmount: '₹ 600' },
                    'PT-9903': { billNumber: 'BILL-2026-1003', assignedDoctor: 'Dr. Sarah Rao (Cardiology & General Medicine)', visitReason: '12-Lead ECG, Troponin-I & Stress Echo', billAmount: '₹ 850' },
                    'PT-9904': { billNumber: 'BILL-2026-1004', assignedDoctor: 'Dr. Ananya Sen (Pulmonology & Respiratory Care)', visitReason: 'Pulmonary Spirometry & IgE Allergen Screen', billAmount: '₹ 500' }
                };
                this.users.forEach((u, idx) => {
                    if (u.role === 'Patient' && !u.billNumber) {
                        const def = defaultBills[u.patientId] || {
                            billNumber: `BILL-2026-${1001 + idx}`,
                            assignedDoctor: 'Dr. Sarah Rao (Cardiology & General Medicine)',
                            visitReason: 'General OPD Consultation & Diagnostics',
                            billAmount: '₹ 350'
                        };
                        u.billNumber = def.billNumber;
                        u.receptionId = def.billNumber;
                        u.assignedDoctor = u.assignedDoctor || def.assignedDoctor;
                        u.visitReason = u.visitReason || def.visitReason;
                        u.billAmount = u.billAmount || def.billAmount;
                        dbUpdated = true;
                    }
                });
                if (!this.users.some(u => u.role === 'Receptionist')) {
                    const recSeed = SAMPLE_USERS.find(u => u.role === 'Receptionist') || {
                        id: 'usr_rec_01',
                        name: 'Priya Nair',
                        email: 'reception@sithospital.org',
                        password: 'password123',
                        role: 'Receptionist',
                        designation: 'Senior OPD Receptionist & Billing Executive',
                        department: 'Front Desk & Patient Registration (Counter 1)',
                        hospital: 'SIT Students Hospital',
                        nodeId: 'NODE-PHARM-01'
                    };
                    this.users.push({ password: 'password123', ...recSeed });
                    dbUpdated = true;
                }

                // Ensure multi-doctor sharedDoctorNotes array exists on reports
                this.reports.forEach(r => {
                    if (!Array.isArray(r.sharedDoctorNotes) || r.sharedDoctorNotes.length === 0) {
                        const baseDoc = r.doctorRemarks || {
                            doctorName: 'Dr. Sarah Rao, MD',
                            doctorId: 'usr_doc_01',
                            department: 'Cardiology & General Medicine',
                            updatedAt: r.testDate || '2026-09-15'
                        };
                        r.sharedDoctorNotes = [
                            {
                                noteId: 'note_init_1',
                                doctorName: baseDoc.doctorName,
                                doctorId: baseDoc.doctorId || 'usr_doc_01',
                                department: baseDoc.department || 'General Medicine',
                                status: r.diagnosisStatus || baseDoc.status || 'Reviewed & Authenticated',
                                notes: r.clinicalImpression || r.notes || 'Reviewed clinical findings.',
                                prescription: r.prescription || 'Continue prescribed outpatient therapy.',
                                updatedAt: baseDoc.updatedAt || r.createdAt || new Date().toISOString()
                            }
                        ];
                        // Add a second collaborating doctor note on John Doe's first report to showcase Multi-Doctor Shared View
                        if (r.reportId === 'REP-7A91F2C4') {
                            r.sharedDoctorNotes.push({
                                noteId: 'note_init_2',
                                doctorName: 'Dr. Rajesh Nair, MS',
                                doctorId: 'usr_doc_02',
                                department: 'Orthopedics & Trauma Wing',
                                status: 'Cross-Department Clearance',
                                notes: 'Reviewed glycemic profile (HbA1c 7.4%) prior to lumbar physical therapy. Cleared for supervised physiotherapy.',
                                prescription: 'Tab. Metformin 500mg BD + Calcium & Vitamin D3 supplementation.',
                                updatedAt: '2026-09-03T11:20:00Z'
                            });
                        }
                        dbUpdated = true;
                    }
                });

                // Seed initial Doctor OPD Checkup Prescriptions if empty
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
                            vitals: 'BP: 132/84 mmHg | Pulse: 78 bpm | Temp: 98.4 °F | Weight: 74 kg',
                            symptoms: 'Mild fatigue, increased thirst (polydipsia), and lower back stiffness.',
                            diagnosis: 'Stage-2 Type 2 Diabetes Mellitus with Mild Lumbar Spondylosis',
                            medicines: [
                                { name: 'Tab. Metformin Sustained Release 500mg', dosage: '1 - 0 - 1', duration: '30 Days', instructions: 'After Meals' },
                                { name: 'Tab.Shelcal-500 (Calcium + Vit D3)', dosage: '0 - 1 - 0', duration: '30 Days', instructions: 'After Lunch' },
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
                            vitals: 'BP: 116/74 mmHg | SpO2: 98% | Pulse: 82 bpm | Temp: 98.2 °F',
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
                    dbUpdated = true;
                }

                // Seed initial Pending Lab Requests for Lab Staff queue if empty
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
                    dbUpdated = true;
                }

                if (dbUpdated) {
                    this.persist();
                }
            } catch (err) {
                console.warn('[Database] Read error, resetting db:', err.message);
                this.seedInitialData();
            }
        } else {
            this.seedInitialData();
        }

        // If reports were empty, seed them
        if (this.reports.length === 0) {
            this.seedInitialData();
        }
    }

    async seedInitialData() {
        console.log('[Database] Seeding initial users and clinical records with authentic PDFs...');
        this.users = [...SAMPLE_USERS];
        const seedReports = await createSeedReports(UPLOADS_DIR);

        // Reset blockchain ledger to ensure 100% cryptographic consensus with the new PDF hashes
        blockchain.chain = [blockchain.createGenesisBlock()];
        blockchain.chain[0].mineBlock(blockchain.difficulty);

        // Anchor seed reports to the blockchain ledger
        for (const rep of seedReports) {
            const block = blockchain.addReportBlock({
                reportId: rep.reportId,
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
        this.auditLogs = [
            {
                id: 'log_01',
                action: 'SYSTEM_INITIALIZATION',
                details: 'Healthcare Consortium Blockchain Ledger and Database Initialized with Authentic Diagnostic Reports',
                timestamp: new Date().toISOString(),
                actor: 'Consortium SuperAdmin'
            }
        ];
        this.persist();
        console.log(`[Database] Seeded ${this.reports.length} authentic PDF reports anchored on blockchain!`);
        return this.reports;
    }

    persist() {
        try {
            const payload = {
                users: this.users,
                reports: this.reports,
                sharedLinks: this.sharedLinks,
                auditLogs: this.auditLogs,
                prescriptions: this.prescriptions,
                labRequests: this.labRequests,
                inquiries: this.inquiries
            };
            fs.writeFileSync(DB_FILE_PATH, JSON.stringify(payload, null, 2), 'utf8');
        } catch (e) {
            console.error('[Database] Failed to persist:', e.message);
        }
    }

    // --- Users ---
    findUserById(id) {
        return this.users.find(u => u.id === id);
    }

    findUserByEmail(email) {
        return this.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    }

    addUser(userData) {
        if (!userData.id) {
            const prefix = userData.role === 'Doctor' ? 'usr_doc' : userData.role === 'Patient' ? 'usr_pat' : userData.role === 'Lab Staff' ? 'usr_lab' : 'usr_adm';
            userData.id = `${prefix}_${Date.now().toString(36)}`;
        }
        if (!userData.password) {
            userData.password = 'password123';
        }
        if (!userData.createdAt) {
            userData.createdAt = new Date().toISOString();
        }
        this.users.push(userData);
        this.persist();
        return userData;
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
    getAllReports() {
        return this.reports;
    }

    findReportById(id) {
        return this.reports.find(r => r.reportId === id || r.id === id);
    }

    findReportByHash(hash) {
        return this.reports.find(r => r.reportHash === hash);
    }

    getReportsForPatient(patientId) {
        return this.reports.filter(r => r.patientId === patientId || r.patientPseudonym === patientId);
    }

    /**
     * Chronological Timeline: returns reports sorted by testDate ascending/descending
     */
    getPatientTimeline(patientId, sortOrder = 'asc') {
        const patientReports = this.getReportsForPatient(patientId);
        return patientReports.sort((a, b) => {
            const dateA = new Date(a.testDate || a.createdAt);
            const dateB = new Date(b.testDate || b.createdAt);
            return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
        });
    }

    /**
     * Search reports by keyword / clinical tag / text query
     */
    searchReports(query, role = 'Doctor', patientId = null) {
        const q = (query || '').toLowerCase().trim();
        let list = this.reports;

        if (role === 'Patient' && patientId) {
            list = list.filter(r => r.patientId === patientId);
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
        const idx = this.reports.findIndex(r => r.reportId === reportId);
        if (idx !== -1) {
            this.reports[idx] = { ...this.reports[idx], ...updates };
            this.persist();
            return this.reports[idx];
        }
        return null;
    }

    deleteReport(reportId) {
        const index = this.reports.findIndex(r => r.reportId === reportId || r.id === reportId);
        if (index !== -1) {
            const removed = this.reports.splice(index, 1)[0];
            this.persist();
            return removed;
        }
        return null;
    }

    // --- Time-Expiring Shared Access Links ---
    addSharedLink(linkData) {
        this.sharedLinks.push(linkData);
        this.persist();
        return linkData;
    }

    findSharedLinkByToken(token) {
        return this.sharedLinks.find(l => l.token === token);
    }

    // --- Audit Logs ---
    logAudit(action, actor, details) {
        const entry = {
            id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            action,
            actor,
            details,
            timestamp: new Date().toISOString()
        };
        this.auditLogs.unshift(entry);
        if (this.auditLogs.length > 200) {
            this.auditLogs.pop();
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
        return this.prescriptions.find(p => p.prescriptionId === prescriptionId);
    }

    addPrescription(rxData) {
        this.prescriptions.unshift(rxData);
        this.persist();
        return rxData;
    }

    // --- Lab Test Requests Queue (Doctor / Reception -> Lab Staff) ---
    getLabRequests() {
        return this.labRequests;
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

    // --- Patient Helpdesk Inquiries (From /contact.html -> Reception Desk) ---
    getInquiries() {
        return this.inquiries;
    }

    addInquiry(inqData) {
        this.inquiries.unshift(inqData);
        this.persist();
        return inqData;
    }

    resolveInquiry(ticketId) {
        const item = this.inquiries.find(i => i.ticketId === ticketId);
        if (item) {
            item.status = 'RESOLVED';
            this.persist();
        }
        return item;
    }
}

const dbInstance = new Database();
module.exports = dbInstance;
