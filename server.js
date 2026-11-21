const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Load and validate strict runtime configuration BEFORE loading DB/controllers
const config = require('./config');

const { authenticate, optionalAuthenticate, authorizeRoles } = require('./middleware/authMiddleware');
const upload = require('./middleware/uploadMiddleware');
const { ethereumClient } = require('./blockchain/ethereumClient');

const authController = require('./controllers/authController');
const adminController = require('./controllers/adminController');
const reportController = require('./controllers/reportController');
const qrController = require('./controllers/qrController');
const shareController = require('./controllers/shareController');
const blockchainController = require('./controllers/blockchainController');

const app = express();
const PORT = config.PORT;

app.disable('x-powered-by');
if (config.TRUST_PROXY !== false) {
    app.set('trust proxy', config.TRUST_PROXY);
}

// Security Headers (Helmet)
app.use(helmet({
    contentSecurityPolicy: false, // Inline event handlers exist across legacy HTML templates; tracked in SECURITY_BACKLOG.md
    crossOriginEmbedderPolicy: false
}));

// Allow-listed CORS (same-origin allowed; cross-origin requires CORS_ORIGINS allow-list)
app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true); // Same-origin or non-browser API client
        if (config.CORS_ORIGINS.includes(origin)) return cb(null, true);
        if (config.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
            return cb(null, true);
        }
        return cb(null, false);
    },
    credentials: false
}));

// Bounded body parsers (reduced from 30mb to 1mb; binary files use multipart/multer)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Prevent caching of clinical/auth API responses in browser/proxy caches
app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
});

// Prevent referrer leakage & indexing on shared report pages/endpoints (F-13)
app.use(['/shared.html', '/shared', '/api/share'], (req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
});

// ==========================================
// RATE LIMITERS (Brute-Force, Spam & DoS Protection)
// ==========================================
const loginIpLimiter = rateLimit({
    windowMs: config.LOGIN_RATE_LIMIT_WINDOW_MS,
    max: Math.max(config.LOGIN_RATE_LIMIT_MAX * 4, 20),
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { success: false, message: 'Too many login attempts from this IP. Please try again later.' }
});

const loginIdentifierLimiter = rateLimit({
    windowMs: config.LOGIN_RATE_LIMIT_WINDOW_MS,
    max: config.LOGIN_RATE_LIMIT_MAX,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    keyGenerator: (req) => {
        const body = req.body || {};
        const ident = String(body.identifier || body.email || body.billNumber || body.userId || req.ip || 'anon').trim().toLowerCase();
        return `ident:${ident}`;
    },
    message: { success: false, message: 'Too many failed sign-in attempts for this account. Please wait 15 minutes or contact Reception/Admin.' }
});

const inquiryLimiter = rateLimit({
    windowMs: config.INQUIRY_RATE_LIMIT_WINDOW_MS,
    max: config.INQUIRY_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { success: false, message: 'Too many helpdesk inquiries submitted. Please try again later.' }
});

const verifyLimiter = rateLimit({
    windowMs: config.VERIFY_RATE_LIMIT_WINDOW_MS,
    max: config.VERIFY_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { success: false, message: 'Verification rate limit exceeded. Please wait before checking again.' }
});

const uploadLimiter = rateLimit({
    windowMs: config.UPLOAD_RATE_LIMIT_WINDOW_MS,
    max: config.UPLOAD_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { success: false, message: 'Upload rate limit exceeded. Please wait before uploading more files.' }
});

// Explicit registry of intentionally public API endpoints (verified by automated route-guard test)
const PUBLIC_API_ROUTES = new Set([
    'GET /healthz',
    'GET /api/config/public',
    'POST /api/auth/login',
    'POST /api/reception/inquiries',
    'GET /api/verify/:reportId',
    'POST /api/verify/check-file/:reportId',
    'GET /api/share/view',
    'GET /api/share/download'
]);

if (config.DEMO_MODE) {
    PUBLIC_API_ROUTES.add('GET /api/auth/demo-accounts');
    PUBLIC_API_ROUTES.add('POST /api/auth/demo-login');
}

// ==========================================
// 0. HEALTH CHECK & PUBLIC WEBSITE PAGES
// ==========================================
app.get('/healthz', (req, res) => {
    const eth = ethereumClient.getStatus();
    return res.json({
        ok: true,
        status: 'healthy',
        demoMode: config.DEMO_MODE,
        blockchainMode: eth.mode
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));
app.get('/home', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));
app.get('/portal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/reception', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reception.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'public', 'about.html')));
app.get('/departments', (req, res) => res.sendFile(path.join(__dirname, 'public', 'departments.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, 'public', 'contact.html')));

app.use(express.static(path.join(__dirname, 'public'), { index: false, extensions: ['html'] }));

// Evaluation Demo Kit static files ONLY mounted in DEMO_MODE
if (config.DEMO_MODE) {
    app.use('/demo-reports', express.static(path.join(__dirname, 'sample_reports_for_demo')));
}

// ==========================================
// 1. AUTHENTICATION & PUBLIC CONFIG ROUTES
// ==========================================
app.get('/api/config/public', authController.getPublicConfig);
app.get('/api/auth/users', authenticate, authorizeRoles('Doctor', 'Lab Staff', 'Receptionist', 'Admin'), authController.getAllUsers);
app.post('/api/auth/login', loginIpLimiter, loginIdentifierLimiter, authController.login);
app.post('/api/auth/change-password', authenticate, authController.changePassword);
app.get('/api/auth/me', authenticate, authController.getCurrentUser);

if (config.DEMO_MODE) {
    app.get('/api/auth/demo-accounts', authController.getDemoAccounts);
    app.post('/api/auth/demo-login', authController.demoLogin);
}

// ==========================================
// 1.1 ADMIN USER MANAGEMENT & AI CONFIG (Admin ONLY)
// ==========================================
app.get('/api/admin/users', authenticate, authorizeRoles('Admin'), adminController.getConsortiumUsers);
app.post('/api/admin/users', authenticate, authorizeRoles('Admin'), adminController.registerUser);
app.delete('/api/admin/users/:userId', authenticate, authorizeRoles('Admin'), adminController.deleteUser);
app.get('/api/admin/ai-config', authenticate, authorizeRoles('Admin'), adminController.getAiConfig);
app.post('/api/admin/ai-config', authenticate, authorizeRoles('Admin'), adminController.updateAiConfig);
app.delete('/api/admin/ai-config', authenticate, authorizeRoles('Admin'), adminController.resetAiConfig);

// ==========================================
// 1.2 RECEPTIONIST DESK, BILLING & HELPDESK INQUIRIES
// ==========================================
app.get('/api/reception/patients', authenticate, authorizeRoles('Receptionist', 'Admin'), adminController.getReceptionPatients);
app.post('/api/reception/patients', authenticate, authorizeRoles('Receptionist', 'Admin'), adminController.registerPatientAtReception);
app.post('/api/reception/patients/:patientId/reset-access-code', authenticate, authorizeRoles('Receptionist', 'Admin'), adminController.resetPatientAccessCode);
app.get('/api/reception/patients/:patientId/bill-pdf', authenticate, authorizeRoles('Receptionist', 'Admin', 'Patient'), adminController.downloadReceptionBillPDF);

app.get('/api/reception/inquiries', authenticate, authorizeRoles('Receptionist', 'Admin'), adminController.getReceptionInquiries);
app.post('/api/reception/inquiries', inquiryLimiter, adminController.createReceptionInquiry);
app.put('/api/reception/inquiries/:ticketId/resolve', authenticate, authorizeRoles('Receptionist', 'Admin'), adminController.resolveReceptionInquiry);

// ==========================================
// 1.3 DOCTOR PRESCRIPTIONS (INCLUDING F-15 UPLOAD) & LAB QUEUE
// ==========================================
app.get('/api/prescriptions', authenticate, authorizeRoles('Doctor', 'Patient', 'Admin'), adminController.getPrescriptions);
app.post('/api/prescriptions', authenticate, authorizeRoles('Doctor', 'Admin'), adminController.createPrescription);
app.post('/api/prescriptions/upload', authenticate, authorizeRoles('Doctor', 'Admin'), uploadLimiter, upload.singleUpload('prescriptionFile'), adminController.uploadPrescriptionAttachment);
app.get('/api/prescriptions/:prescriptionId/pdf', authenticate, authorizeRoles('Doctor', 'Patient', 'Admin'), adminController.downloadPrescriptionPDF);
app.get('/api/prescriptions/:prescriptionId/attachment', authenticate, authorizeRoles('Doctor', 'Patient', 'Admin'), adminController.downloadPrescriptionAttachment);

app.get('/api/lab-requests', authenticate, authorizeRoles('Lab Staff', 'Doctor', 'Receptionist', 'Admin'), adminController.getLabRequests);

// ==========================================
// 2. DIAGNOSTIC REPORTS ROUTES (Strict RBAC)
// ==========================================
app.post('/api/reports/upload', authenticate, authorizeRoles('Lab Staff', 'Admin'), uploadLimiter, upload.singleUpload('reportFile'), reportController.uploadReport);
app.put('/api/reports/:reportId', authenticate, authorizeRoles('Doctor', 'Admin'), reportController.updateReport);
app.delete('/api/reports/:reportId', authenticate, authorizeRoles('Admin'), reportController.deleteReport);

app.get('/api/reports', authenticate, authorizeRoles('Patient', 'Doctor', 'Lab Staff', 'Admin'), reportController.getReports);
app.get('/api/reports/search', authenticate, authorizeRoles('Patient', 'Doctor', 'Admin'), reportController.searchReports);
app.get('/api/reports/timeline/:patientId', authenticate, authorizeRoles('Patient', 'Doctor', 'Admin'), reportController.getPatientTimeline);
app.get('/api/reports/:reportId', authenticate, authorizeRoles('Patient', 'Doctor', 'Admin'), reportController.getReportById);
app.get('/api/reports/:reportId/download', authenticate, authorizeRoles('Patient', 'Doctor', 'Admin'), reportController.downloadDecryptedReport);

// ==========================================
// 3. QR CODE ANTI-FORGERY & VERIFICATION
// ==========================================
app.get('/api/qr/:reportId', authenticate, authorizeRoles('Patient', 'Doctor', 'Admin'), qrController.getReportQRCode);
app.get('/api/verify/:reportId', verifyLimiter, optionalAuthenticate, qrController.verifyReportIntegrity);
app.post('/api/verify/check-file/:reportId', verifyLimiter, optionalAuthenticate, upload.singleUpload('testFile'), qrController.verifyReportIntegrity);

// Non-destructive tamper simulation routes ONLY mounted in DEMO_MODE (destructive tamper-file route REMOVED!)
if (config.DEMO_MODE) {
    app.post('/api/verify/simulate-tamper/:reportId', authenticate, authorizeRoles('Admin'), qrController.simulateTamperInMemory);
    app.post('/api/verify/reset-tamper/:reportId', authenticate, authorizeRoles('Admin'), qrController.resetTamperInMemory);
}

// ==========================================
// 4. TIME-EXPIRING REVOCABLE SHARE LINKS
// ==========================================
app.get('/api/share', authenticate, authorizeRoles('Patient', 'Doctor', 'Admin'), shareController.listShareLinks);
app.post('/api/share/create', authenticate, authorizeRoles('Patient', 'Doctor', 'Admin'), shareController.createExpiringShareLink);
app.post('/api/share/:jti/revoke', authenticate, authorizeRoles('Patient', 'Doctor', 'Admin'), shareController.revokeShareLink);
app.get('/api/share/view', shareController.getSharedReport);
app.get('/api/share/download', shareController.downloadSharedReportFile);

// ==========================================
// 5. BLOCKCHAIN & AUDIT ROUTES
// ==========================================
app.get('/api/blockchain/ledger', authenticate, authorizeRoles('Admin'), blockchainController.getBlockchainLedger);
app.get('/api/blockchain/verify', authenticate, authorizeRoles('Admin'), blockchainController.verifyBlockchain);
app.get('/api/blockchain/stats', authenticate, authorizeRoles('Doctor', 'Lab Staff', 'Receptionist', 'Admin'), blockchainController.getSystemStats);
app.get('/api/blockchain/audit-logs', authenticate, authorizeRoles('Admin'), blockchainController.getAuditLogs);

if (config.DEMO_MODE) {
    app.post('/api/blockchain/tamper-demo', authenticate, authorizeRoles('Admin'), blockchainController.simulateTamper);
    app.post('/api/blockchain/restore', authenticate, authorizeRoles('Admin'), blockchainController.restoreLedger);
}

// API 404 & SPA fallback
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, message: `API route not found: ${req.method} ${req.path}` });
    }
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Centralized error handler (never leaks raw stack traces in production)
app.use((err, req, res, next) => {
    console.error('[Express Error]:', err.message);
    const status = err.statusCode || err.status || 500;
    return res.status(status).json({
        success: false,
        message: status >= 500 ? 'Internal server error.' : err.message
    });
});

app.PUBLIC_API_ROUTES = PUBLIC_API_ROUTES;

if (require.main === module) {
    app.listen(PORT, () => {
        const eth = ethereumClient.getStatus();
        console.log('================================================================');
        console.log('🏥 SIT Students Hospital Portal — Hardened Security Build v2.0');
        console.log(`🔒 Security Mode:    ${config.DEMO_MODE ? 'DEMO_MODE (Synthetic Academic Demo)' : 'HARDENED (Real Auth Required)'}`);
        console.log(`⛓️  Blockchain Mode:  ${eth.mode}`);
        console.log(`🌐 Public Website:   http://localhost:${PORT}`);
        console.log(`🔐 Staff/Patient:    http://localhost:${PORT}/portal`);
        console.log(`🩺 Reception Desk:   http://localhost:${PORT}/reception`);
        console.log(`🔍 QR Verification:  http://localhost:${PORT}/verify.html`);
        console.log('================================================================');
    });
}

module.exports = app;
