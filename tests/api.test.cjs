const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const PROJECT_DIR = path.resolve(__dirname, '..');
const SOURCE_DATA_DIR = path.join(PROJECT_DIR, 'data');
const SOURCE_UPLOADS_DIR = path.join(PROJECT_DIR, 'uploads');
const DEMO_DUP_PDF = path.join(PROJECT_DIR, 'sample_reports_for_demo', '00_TEST_DUPLICATE_REJECTION_Fasting_Blood_Sugar.pdf');

const TEST_JWT_SECRET = 'test-only-jwt-secret-32-chars-minimum-123456';
const TEST_SHARE_SECRET = 'test-only-share-secret-32-chars-minimum-987654';
const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
const TEST_ADMIN_EMAIL = 'real.admin@sithospital.org';
const TEST_ADMIN_PASSWORD = 'StrongAdminPass!2026';

async function freePort() {
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', resolve);
    });
    const port = probe.address().port;
    await new Promise((resolve, reject) => probe.close(err => (err ? reject(err) : resolve())));
    return port;
}

function makeTempFixture() {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-test-'));
    const dataDir = path.join(tmpRoot, 'data');
    const uploadsDir = path.join(tmpRoot, 'uploads');
    fs.cpSync(SOURCE_DATA_DIR, dataDir, { recursive: true });
    fs.cpSync(SOURCE_UPLOADS_DIR, uploadsDir, { recursive: true });
    return { tmpRoot, dataDir, uploadsDir };
}

function tokenFor(userId, extraClaims = {}, secret = TEST_JWT_SECRET) {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const payload = {
        id: userId,
        exp: Math.floor(Date.now() / 1000) + 600,
        ...extraClaims
    };
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
    const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
    return `${unsigned}.${signature}`;
}

async function startServer(envOverrides = {}) {
    const fixture = makeTempFixture();
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const env = {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        DATA_DIR: fixture.dataDir,
        UPLOADS_DIR: fixture.uploadsDir,
        JWT_SECRET: TEST_JWT_SECRET,
        SHARE_JWT_SECRET: TEST_SHARE_SECRET,
        ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
        LEGACY_ENCRYPTION_KEY: 'med-blockchain-sec-key-32bytes!',
        DEMO_MODE: 'false',
        ALLOW_PUBLIC_DEMO: 'false',
        AI_EXTERNAL_PROCESSING: 'false',
        GEMINI_API_KEY: '',
        BLOCKCHAIN_RPC_URL: '',
        BLOCKCHAIN_CONTRACT_ADDRESS: '',
        FIREBASE_SERVICE_ACCOUNT_BASE64: '',
        FIREBASE_SERVICE_ACCOUNT_JSON: '',
        FIREBASE_SERVICE_ACCOUNT_PATH: '',
        FIREBASE_STORAGE_BUCKET: '',
        BOOTSTRAP_ADMIN_EMAIL: TEST_ADMIN_EMAIL,
        BOOTSTRAP_ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
        LOGIN_RATE_LIMIT_MAX: '5',
        INQUIRY_RATE_LIMIT_MAX: '5',
        ...envOverrides
    };

    const child = spawn(process.execPath, ['server.js'], {
        cwd: PROJECT_DIR,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    child.stderr.on('data', c => { stderr += c.toString(); });

    const deadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`Server exited early (${child.exitCode}): ${stderr}`);
        }
        try {
            const res = await fetch(`${baseUrl}/healthz`);
            if (res.ok) {
                ready = true;
                break;
            }
        } catch (_) {}
        await new Promise(r => setTimeout(r, 120));
    }

    if (!ready) {
        child.kill();
        throw new Error(`Server failed to become healthy within 15s.\n${stderr}`);
    }

    async function requestJson(route, options = {}) {
        const response = await fetch(`${baseUrl}${route}`, options);
        const contentType = response.headers.get('content-type') || '';
        const body = contentType.includes('application/json')
            ? await response.json()
            : await response.arrayBuffer();
        return { response, body };
    }

    async function stop() {
        if (child.exitCode === null) {
            child.kill();
            await Promise.race([
                new Promise(resolve => child.once('exit', resolve)),
                new Promise(resolve => setTimeout(resolve, 2500))
            ]);
        }
        fs.rmSync(fixture.tmpRoot, { recursive: true, force: true });
    }

    return { baseUrl, fixture, requestJson, stop };
}

// ============================================================================
// SUITE 1: ALL 20 INDEPENDENT SECURITY AUDIT REGRESSION CASES (DEMO_MODE=false)
// ============================================================================
describe('Audit Regression Suite (20/20 required)', () => {
    let srv;
    let seedDb;

    before(async () => {
        srv = await startServer({ LOGIN_RATE_LIMIT_MAX: '50' });
        seedDb = JSON.parse(fs.readFileSync(path.join(srv.fixture.dataDir, 'database.json'), 'utf8'));
    });

    after(async () => {
        if (srv) await srv.stop();
    });

    test('01. public user directory must require authentication', async () => {
        const { response } = await srv.requestJson('/api/auth/users');
        assert.equal(response.status, 401);
    });

    test('02. account ID alone must not create an Admin session', async () => {
        const { response } = await srv.requestJson('/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ userId: 'usr_adm_01' })
        });
        assert.equal(response.status, 401);
    });

    test('03. reception directory must be restricted to Receptionist and Admin', async () => {
        const { response } = await srv.requestJson('/api/reception/patients');
        assert.equal(response.status, 401);
    });

    test('04. public QR verification must not reveal patient identity', async () => {
        const { response, body } = await srv.requestJson(`/api/verify/${encodeURIComponent(seedDb.reports[0].reportId)}`);
        assert.equal(response.status, 200);
        assert.equal(body.isAuthentic, true);
        assert.equal(body.patientName, undefined);
        assert.equal(body.patientPseudonym, undefined);
        assert.equal(body.reportType, undefined);
    });

    test('05. patient cannot read another patient\'s report', async () => {
        const patient = seedDb.users.find(u => u.role === 'Patient');
        const otherReport = seedDb.reports.find(r => r.patientId !== patient.id);
        const { response } = await srv.requestJson(`/api/reports/${encodeURIComponent(otherReport.reportId)}`, {
            headers: { authorization: `Bearer ${tokenFor(patient.id)}` }
        });
        assert.equal(response.status, 403);
    });

    test('06. Doctor can save a prescription with medicine details', async () => {
        const { response, body } = await srv.requestJson('/api/prescriptions', {
            method: 'POST',
            headers: { authorization: `Bearer ${tokenFor('usr_doc_01')}`, 'content-type': 'application/json' },
            body: JSON.stringify({
                patientId: 'usr_pat_01',
                symptoms: 'Audit fixture symptom',
                diagnosis: 'Audit fixture diagnosis',
                medicines: [{ name: 'Audit fixture medicine', dosage: '1-0-0', duration: '1 day', instructions: 'With food' }]
            })
        });
        assert.equal(response.status, 201);
        assert.equal(body.prescription.medicines[0].name, 'Audit fixture medicine');
        assert.equal(body.prescription.doctorId, 'usr_doc_01');
    });

    test('07. prescription with no medicines must be rejected instead of inventing a medication', async () => {
        const { response, body } = await srv.requestJson('/api/prescriptions', {
            method: 'POST',
            headers: { authorization: `Bearer ${tokenFor('usr_doc_02')}`, 'content-type': 'application/json' },
            body: JSON.stringify({ patientId: 'usr_pat_01', symptoms: 'Audit fixture only', diagnosis: 'Audit fixture only', medicines: [] })
        });
        assert.equal(response.status, 400);
        assert.notEqual(body.prescription?.medicines?.[0]?.name, 'Tab. Paracetamol 650mg');
    });

    test('08. Receptionist must not create a share link for a patient report', async () => {
        const { response } = await srv.requestJson('/api/share/create', {
            method: 'POST',
            headers: { authorization: `Bearer ${tokenFor('usr_rec_01')}`, 'content-type': 'application/json' },
            body: JSON.stringify({ reportId: seedDb.reports[0].reportId, durationMinutes: 10, recipientDoctor: 'Audit fixture' })
        });
        assert.equal(response.status, 403);
    });

    test('09. public bill PDF route must require authorization', async () => {
        const patient = seedDb.users.find(u => u.role === 'Patient');
        const { response } = await srv.requestJson(`/api/reception/patients/${encodeURIComponent(patient.id)}/bill-pdf`);
        assert.equal(response.status, 401);
    });

    test('10. Doctor cannot upload a diagnostic report file', async () => {
        const { response } = await srv.requestJson('/api/reports/upload', {
            method: 'POST',
            headers: { authorization: `Bearer ${tokenFor('usr_doc_01')}` }
        });
        assert.equal(response.status, 403);
    });

    test('11. Doctor can upload a prescription document (F-15) and only authorized roles can download it', async () => {
        const form = new FormData();
        form.set('prescriptionFile', new Blob(['Synthetic prescription fixture'], { type: 'text/plain' }), 'prescription-fixture.txt');
        form.set('patientId', 'usr_pat_01');
        const { response, body } = await srv.requestJson('/api/prescriptions/upload', {
            method: 'POST',
            headers: { authorization: `Bearer ${tokenFor('usr_doc_01')}` },
            body: form
        });
        assert.equal(response.status, 201);
        assert.ok(body.prescription?.prescriptionId);
        assert.ok(body.attachment?.sha256);

        // Patient 1 (owner) can download attachment; Patient 2 gets 403; Receptionist gets 403
        const rxId = body.prescription.prescriptionId;
        const ownDl = await srv.requestJson(`/api/prescriptions/${encodeURIComponent(rxId)}/attachment`, {
            headers: { authorization: `Bearer ${tokenFor('usr_pat_01')}` }
        });
        assert.equal(ownDl.response.status, 200);
        assert.equal(Buffer.from(ownDl.body).toString('utf8'), 'Synthetic prescription fixture');

        const otherDl = await srv.requestJson(`/api/prescriptions/${encodeURIComponent(rxId)}/attachment`, {
            headers: { authorization: `Bearer ${tokenFor('usr_pat_02')}` }
        });
        assert.equal(otherDl.response.status, 403);

        const recDl = await srv.requestJson(`/api/prescriptions/${encodeURIComponent(rxId)}/attachment`, {
            headers: { authorization: `Bearer ${tokenFor('usr_rec_01')}` }
        });
        assert.equal(recDl.response.status, 403);
    });

    test('12. re-uploading identical diagnostic bytes must be rejected as a duplicate (409)', async () => {
        const payload = Buffer.from('Synthetic audit fixture only: HbA1c 9.2 percent.');
        async function uploadOnce() {
            const form = new FormData();
            form.set('patientId', 'usr_pat_01');
            form.set('title', 'Synthetic audit fixture');
            form.set('reportType', 'Audit Fixture');
            form.set('reportFile', new Blob([payload], { type: 'text/plain' }), 'audit-fixture.txt');
            return srv.requestJson('/api/reports/upload', {
                method: 'POST',
                headers: { authorization: `Bearer ${tokenFor('usr_lab_01')}` },
                body: form
            });
        }
        const first = await uploadOnce();
        assert.equal(first.response.status, 201);
        const second = await uploadOnce();
        assert.equal(second.response.status, 409);
        assert.equal(second.body.duplicateDetected, true);
    });

    const ROLE_USERS = [
        ['Patient', 'usr_pat_01'],
        ['Doctor', 'usr_doc_01'],
        ['Lab Staff', 'usr_lab_01'],
        ['Receptionist', 'usr_rec_01'],
        ['Admin', 'usr_adm_01']
    ];

    test('13. role matrix: only Admin can read account administration', async () => {
        const actual = [];
        for (const [role, userId] of ROLE_USERS) {
            const { response } = await srv.requestJson('/api/admin/users', { headers: { authorization: `Bearer ${tokenFor(userId)}` } });
            actual.push([role, response.status]);
        }
        assert.deepEqual(actual, [['Patient', 403], ['Doctor', 403], ['Lab Staff', 403], ['Receptionist', 403], ['Admin', 200]]);
    });

    test('14. role matrix: only Doctor/Admin can enter the prescription creation flow', async () => {
        const actual = [];
        for (const [role, userId] of ROLE_USERS) {
            const { response } = await srv.requestJson('/api/prescriptions', {
                method: 'POST',
                headers: { authorization: `Bearer ${tokenFor(userId)}`, 'content-type': 'application/json' },
                body: JSON.stringify({})
            });
            actual.push([role, response.status]);
        }
        assert.deepEqual(actual, [['Patient', 403], ['Doctor', 400], ['Lab Staff', 403], ['Receptionist', 403], ['Admin', 400]]);
    });

    test('15. role matrix: diagnostic upload is limited to Lab Staff/Admin', async () => {
        const actual = [];
        for (const [role, userId] of ROLE_USERS) {
            const { response } = await srv.requestJson('/api/reports/upload', { method: 'POST', headers: { authorization: `Bearer ${tokenFor(userId)}` } });
            actual.push([role, response.status]);
        }
        assert.deepEqual(actual, [['Patient', 403], ['Doctor', 403], ['Lab Staff', 400], ['Receptionist', 403], ['Admin', 400]]);
    });

    test('16. role matrix: patient registration is limited to Receptionist/Admin', async () => {
        const actual = [];
        for (const [role, userId] of ROLE_USERS) {
            const { response } = await srv.requestJson('/api/reception/patients', {
                method: 'POST',
                headers: { authorization: `Bearer ${tokenFor(userId)}`, 'content-type': 'application/json' },
                body: JSON.stringify({})
            });
            actual.push([role, response.status]);
        }
        assert.deepEqual(actual, [['Patient', 403], ['Doctor', 403], ['Lab Staff', 403], ['Receptionist', 400], ['Admin', 400]]);
    });

    test('17. role matrix: lab request queue is available to authorized staff, not Patients', async () => {
        const actual = [];
        for (const [role, userId] of ROLE_USERS) {
            const { response } = await srv.requestJson('/api/lab-requests', { headers: { authorization: `Bearer ${tokenFor(userId)}` } });
            actual.push([role, response.status]);
        }
        assert.deepEqual(actual, [['Patient', 403], ['Doctor', 200], ['Lab Staff', 200], ['Receptionist', 200], ['Admin', 200]]);
    });

    test('18. role matrix: prescription reads are patient-scoped and staff-gated', async () => {
        const actual = [];
        for (const [role, userId] of ROLE_USERS) {
            const { response, body } = await srv.requestJson('/api/prescriptions', { headers: { authorization: `Bearer ${tokenFor(userId)}` } });
            actual.push([role, response.status]);
            if (role === 'Patient' && response.ok) assert.ok(body.prescriptions.every(rx => rx.patientId === userId));
        }
        assert.deepEqual(actual, [['Patient', 200], ['Doctor', 200], ['Lab Staff', 403], ['Receptionist', 403], ['Admin', 200]]);
    });

    test('19. role matrix: report list keeps Patients scoped and rejects Receptionist clinical browsing', async () => {
        const actual = [];
        for (const [role, userId] of ROLE_USERS) {
            const { response, body } = await srv.requestJson('/api/reports', { headers: { authorization: `Bearer ${tokenFor(userId)}` } });
            actual.push([role, response.status]);
            if (role === 'Patient' && response.ok) assert.ok(body.reports.every(r => r.patientId === userId));
            if (role === 'Lab Staff' && response.ok) assert.equal(body.reports.length, 0);
            if (role === 'Doctor' && response.ok) assert.ok(body.reports.length > 0);
            if (role === 'Admin' && response.ok) assert.ok(body.reports.length > 0);
        }
        assert.deepEqual(actual, [['Patient', 200], ['Doctor', 200], ['Lab Staff', 200], ['Receptionist', 403], ['Admin', 200]]);
    });

    test('20. role matrix: only Admin can inspect the local ledger', async () => {
        const actual = [];
        for (const [role, userId] of ROLE_USERS) {
            const { response } = await srv.requestJson('/api/blockchain/ledger', { headers: { authorization: `Bearer ${tokenFor(userId)}` } });
            actual.push([role, response.status]);
        }
        assert.deepEqual(actual, [['Patient', 403], ['Doctor', 403], ['Lab Staff', 403], ['Receptionist', 403], ['Admin', 200]]);
    });
});

// ============================================================================
// SUITE 2: DEEP SECURITY HARDENING, CRYPTO, WORKFLOW & BLOCKCHAIN TESTS
// ============================================================================
describe('Hardened Auth, RBAC, Crypto, Clinical Integrity & Blockchain Suite', () => {
    let srv;
    let seedDb;

    before(async () => {
        srv = await startServer({ LOGIN_RATE_LIMIT_MAX: '5', INQUIRY_RATE_LIMIT_MAX: '3' });
        seedDb = JSON.parse(fs.readFileSync(path.join(srv.fixture.dataDir, 'database.json'), 'utf8'));
    });

    after(async () => {
        if (srv) await srv.stop();
    });

    test('startup refuses missing or weak/default secrets when DEMO_MODE=false', () => {
        const bad = spawnSync(process.execPath, ['server.js'], {
            cwd: PROJECT_DIR,
            env: {
                ...process.env,
                DEMO_MODE: 'false',
                JWT_SECRET: 'med-blockchain-jwt-super-secret-key-2026',
                SHARE_JWT_SECRET: 'short',
                ENCRYPTION_KEY: 'med-blockchain-sec-key-32bytes!'
            },
            encoding: 'utf8'
        });
        assert.notEqual(bad.status, 0);
        assert.match(bad.stderr, /FATAL CONFIGURATION ERROR/);
    });

    test('startup refuses NODE_ENV=production with DEMO_MODE=true without ALLOW_PUBLIC_DEMO=true', () => {
        const bad = spawnSync(process.execPath, ['server.js'], {
            cwd: PROJECT_DIR,
            env: {
                ...process.env,
                NODE_ENV: 'production',
                DEMO_MODE: 'true',
                ALLOW_PUBLIC_DEMO: 'false'
            },
            encoding: 'utf8'
        });
        assert.notEqual(bad.status, 0);
        assert.match(bad.stderr, /ALLOW_PUBLIC_DEMO=true/);
    });

    test('query-string ?token= is strictly rejected (401) on authenticated routes', async () => {
        const tok = tokenFor('usr_adm_01');
        const { response } = await srv.requestJson(`/api/reports?token=${encodeURIComponent(tok)}`);
        assert.equal(response.status, 401);
    });

    test('demo-only & destructive tamper routes return 404 when DEMO_MODE=false', async () => {
        const adm = { authorization: `Bearer ${tokenFor('usr_adm_01')}` };
        const checks = [
            await srv.requestJson('/api/auth/demo-accounts'),
            await srv.requestJson('/api/auth/demo-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'usr_adm_01' }) }),
            await srv.requestJson(`/api/verify/tamper-file/${seedDb.reports[0].reportId}`, { method: 'POST' }),
            await srv.requestJson(`/api/verify/simulate-tamper/${seedDb.reports[0].reportId}`, { method: 'POST', headers: adm }),
            await srv.requestJson('/api/blockchain/tamper-demo', { method: 'POST', headers: adm }),
            await srv.requestJson('/api/blockchain/restore', { method: 'POST', headers: adm })
        ];
        for (const c of checks) {
            assert.equal(c.response.status, 404);
        }
    });

    test('brute-force login lockout triggers 429 after 5 failed attempts for same identifier', async () => {
        for (let i = 0; i < 5; i++) {
            const r = await srv.requestJson('/api/auth/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ identifier: 'lockout.target@sithospital.org', password: 'wrong-password' })
            });
            assert.equal(r.response.status, 401);
            assert.equal(r.body.message, 'Invalid credentials.');
        }
        const sixth = await srv.requestJson('/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier: 'lockout.target@sithospital.org', password: 'wrong-password' })
        });
        assert.equal(sixth.response.status, 429);
    });

    test('Bootstrap Admin login, Patient registration with 8-char One-Time Access Code, forced password setup, replay rejection & code reset', async () => {
        // 1. Real bootstrap Admin login succeeds when DEMO_MODE=false (demo accounts rejected)
        const demoAttempt = await srv.requestJson('/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier: 'dr.sarah@sithospital.org', password: 'password123' })
        });
        assert.equal(demoAttempt.response.status, 401);

        const adminLogin = await srv.requestJson('/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
        });
        assert.equal(adminLogin.response.status, 200);
        const adminTok = adminLogin.body.token;

        // 2. Register new patient -> receives one-time 8-char access code; no password/hash leaked
        const reg = await srv.requestJson('/api/reception/patients', {
            method: 'POST',
            headers: { authorization: `Bearer ${adminTok}`, 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Test Patient Hardened', age: 23, gender: 'Female', bloodGroup: 'A+' })
        });
        assert.equal(reg.response.status, 201);
        assert.equal(reg.body.patient.password, undefined);
        assert.equal(reg.body.patient.passwordHash, undefined);
        assert.equal(reg.body.patient.accessCodeHash, undefined);
        assert.equal(reg.body.oneTimeAccessCode.length, 8);

        const billNumber = reg.body.patient.billNumber;
        const accessCode = reg.body.oneTimeAccessCode;
        const patientId = reg.body.patient.id;

        // 3. Bill number alone MUST fail (401)
        const billOnly = await srv.requestJson('/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ billNumber })
        });
        assert.equal(billOnly.response.status, 401);

        // 4. Bill number + 8-char one-time access code succeeds with mustChangePassword=true
        const firstLogin = await srv.requestJson('/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ billNumber, accessCode })
        });
        assert.equal(firstLogin.response.status, 200);
        assert.equal(firstLogin.body.mustChangePassword, true);
        const tempToken = firstLogin.body.token;

        // 5. Replaying the same one-time access code MUST fail (401)
        const replay = await srv.requestJson('/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ billNumber, accessCode })
        });
        assert.equal(replay.response.status, 401);

        // 6. Clinical API blocked with 403 PASSWORD_CHANGE_REQUIRED until password is set
        const blocked = await srv.requestJson('/api/reports', {
            headers: { authorization: `Bearer ${tempToken}` }
        });
        assert.equal(blocked.response.status, 403);
        assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');

        // 7. Set personal password -> bumps tokenVersion, invalidates old tempToken, returns working freshToken
        const pwChange = await srv.requestJson('/api/auth/change-password', {
            method: 'POST',
            headers: { authorization: `Bearer ${tempToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({ newPassword: 'PatientPersonalPass!2026' })
        });
        assert.equal(pwChange.response.status, 200);
        const freshToken = pwChange.body.token;

        // Old token rejected after version bump
        const oldTokCheck = await srv.requestJson('/api/reports', {
            headers: { authorization: `Bearer ${tempToken}` }
        });
        assert.equal(oldTokCheck.response.status, 401);

        // Fresh token works
        const unlocked = await srv.requestJson('/api/reports', {
            headers: { authorization: `Bearer ${freshToken}` }
        });
        assert.equal(unlocked.response.status, 200);

        // 8. Reset access code revokes patient's active session immediately
        const resetRes = await srv.requestJson(`/api/reception/patients/${encodeURIComponent(patientId)}/reset-access-code`, {
            method: 'POST',
            headers: { authorization: `Bearer ${adminTok}` }
        });
        assert.equal(resetRes.response.status, 200);
        assert.equal(resetRes.body.oneTimeAccessCode.length, 8);

        const revokedAfterReset = await srv.requestJson('/api/reports', {
            headers: { authorization: `Bearer ${freshToken}` }
        });
        assert.equal(revokedAfterReset.response.status, 401);
    });

    test('Receptionist is denied (403) across EVERY clinical endpoint', async () => {
        const recHeaders = { authorization: `Bearer ${tokenFor('usr_rec_01')}` };
        const repId = seedDb.reports[0].reportId;
        const endpoints = [
            `/api/reports`,
            `/api/reports/search?q=glucose`,
            `/api/reports/timeline/usr_pat_01`,
            `/api/reports/${encodeURIComponent(repId)}`,
            `/api/reports/${encodeURIComponent(repId)}/download`,
            `/api/qr/${encodeURIComponent(repId)}`,
            `/api/prescriptions`
        ];
        for (const ep of endpoints) {
            const { response } = await srv.requestJson(ep, { headers: recHeaders });
            assert.equal(response.status, 403, `Receptionist must get 403 on ${ep}`);
        }
    });

    test('Share links: duration bounds, zero PII in JWT, immediate revocation & no-referrer headers', async () => {
        const patHeaders = { authorization: `Bearer ${tokenFor('usr_pat_01')}`, 'content-type': 'application/json' };
        const ownRep = seedDb.reports.find(r => r.patientId === 'usr_pat_01');

        // Reject out-of-range duration
        const badDur = await srv.requestJson('/api/share/create', {
            method: 'POST',
            headers: patHeaders,
            body: JSON.stringify({ reportId: ownRep.reportId, durationMinutes: 10080 })
        });
        assert.equal(badDur.response.status, 400);

        // Create valid share link
        const created = await srv.requestJson('/api/share/create', {
            method: 'POST',
            headers: patHeaders,
            body: JSON.stringify({ reportId: ownRep.reportId, durationMinutes: 30, recipientDoctor: 'Dr. Consultant' })
        });
        assert.equal(created.response.status, 201);
        const { jti, token } = created.body;

        // Verify JWT payload contains NO patientName / notes
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
        assert.equal(payload.patientName, undefined);
        assert.equal(payload.notes, undefined);
        assert.equal(payload.jti, jti);

        // Verify view succeeds & sets Referrer-Policy: no-referrer
        const view1 = await srv.requestJson(`/api/share/view?token=${encodeURIComponent(token)}`);
        assert.equal(view1.response.status, 200);
        assert.equal(view1.response.headers.get('referrer-policy'), 'no-referrer');

        // Revoke immediately
        const rev = await srv.requestJson(`/api/share/${encodeURIComponent(jti)}/revoke`, {
            method: 'POST',
            headers: patHeaders
        });
        assert.equal(rev.response.status, 200);

        // Subsequent view & download MUST fail with 403 REVOKED
        const view2 = await srv.requestJson(`/api/share/view?token=${encodeURIComponent(token)}`);
        assert.equal(view2.response.status, 403);
        assert.equal(view2.body.status, 'REVOKED');

        const dl2 = await srv.requestJson(`/api/share/download?token=${encodeURIComponent(token)}`);
        assert.equal(dl2.response.status, 403);
    });

    test('Soft-delete: Doctor/Lab denied (403), Admin needs reason (400), preserves encrypted file & ledger block', async () => {
        const rep = seedDb.reports[1];
        const docDel = await srv.requestJson(`/api/reports/${encodeURIComponent(rep.reportId)}`, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${tokenFor('usr_doc_01')}`, 'content-type': 'application/json' },
            body: JSON.stringify({ reason: 'Unauthorized attempt' })
        });
        assert.equal(docDel.response.status, 403);

        const labDel = await srv.requestJson(`/api/reports/${encodeURIComponent(rep.reportId)}`, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${tokenFor('usr_lab_01')}`, 'content-type': 'application/json' },
            body: JSON.stringify({ reason: 'Unauthorized attempt' })
        });
        assert.equal(labDel.response.status, 403);

        const noReason = await srv.requestJson(`/api/reports/${encodeURIComponent(rep.reportId)}`, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${tokenFor('usr_adm_01')}`, 'content-type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.equal(noReason.response.status, 400);

        const okDel = await srv.requestJson(`/api/reports/${encodeURIComponent(rep.reportId)}`, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${tokenFor('usr_adm_01')}`, 'content-type': 'application/json' },
            body: JSON.stringify({ reason: 'Duplicate entry superseded by corrected lab result' })
        });
        assert.equal(okDel.response.status, 200);

        // Hidden from active API
        const getAfter = await srv.requestJson(`/api/reports/${encodeURIComponent(rep.reportId)}`, {
            headers: { authorization: `Bearer ${tokenFor('usr_doc_01')}` }
        });
        assert.equal(getAfter.response.status, 404);

        // Encrypted file still exists on disk!
        assert.ok(fs.existsSync(path.join(srv.fixture.uploadsDir, rep.storageReference)));
    });

    test('Spoofed magic bytes (.pdf containing plain text) rejected with 415; unparsed text never fabricates normal results', async () => {
        const spoofForm = new FormData();
        spoofForm.set('patientId', 'usr_pat_01');
        spoofForm.set('title', 'Spoofed PDF');
        spoofForm.set('reportFile', new Blob(['Not actually a PDF binary'], { type: 'application/pdf' }), 'fake.pdf');
        const spoofRes = await srv.requestJson('/api/reports/upload', {
            method: 'POST',
            headers: { authorization: `Bearer ${tokenFor('usr_lab_01')}` },
            body: spoofForm
        });
        assert.equal(spoofRes.response.status, 415);

        // Upload valid plain text with NO numeric values -> must NOT fabricate normal parameters or NABH claims
        const noNumForm = new FormData();
        noNumForm.set('patientId', 'usr_pat_01');
        noNumForm.set('title', 'Qualitative Lab Note');
        noNumForm.set('reportType', 'General Note');
        noNumForm.set('reportFile', new Blob(['Qualitative observation only, see clinician note.'], { type: 'text/plain' }), 'qualitative.txt');
        const okRes = await srv.requestJson('/api/reports/upload', {
            method: 'POST',
            headers: { authorization: `Bearer ${tokenFor('usr_lab_01')}` },
            body: noNumForm
        });
        assert.equal(okRes.response.status, 201);
        assert.deepEqual(okRes.body.report.testParameters, []);
        assert.equal(okRes.body.report.clinicianReviewed, false);
        assert.match(okRes.body.report.aiHighlights.disclaimer, /not clinical advice/i);
        assert.doesNotMatch(JSON.stringify(okRes.body.report), /NABH|Completed & Certified|Within Established Limits/i);
    });

    test('Concurrent duplicate uploads produce exactly one 201 and one 409; seeded demo duplicate file returns 409', async () => {
        const uniqueBuf = Buffer.from(`Concurrent upload race check ${Date.now()}`);
        function sendUpload() {
            const form = new FormData();
            form.set('patientId', 'usr_pat_02');
            form.set('title', 'Concurrent Race Test');
            form.set('reportType', 'Biochemistry');
            form.set('reportFile', new Blob([uniqueBuf], { type: 'text/plain' }), 'race-test.txt');
            return srv.requestJson('/api/reports/upload', {
                method: 'POST',
                headers: { authorization: `Bearer ${tokenFor('usr_lab_01')}` },
                body: form
            });
        }
        const [r1, r2] = await Promise.all([sendUpload(), sendUpload()]);
        const statuses = [r1.response.status, r2.response.status].sort();
        assert.deepEqual(statuses, [201, 409]);

        if (fs.existsSync(DEMO_DUP_PDF)) {
            const dupBytes = fs.readFileSync(DEMO_DUP_PDF);
            const dupForm = new FormData();
            dupForm.set('patientId', 'usr_pat_01');
            dupForm.set('title', 'Seeded Duplicate Check');
            dupForm.set('reportFile', new Blob([dupBytes], { type: 'application/pdf' }), 'dup.pdf');
            const dupRes = await srv.requestJson('/api/reports/upload', {
                method: 'POST',
                headers: { authorization: `Bearer ${tokenFor('usr_lab_01')}` },
                body: dupForm
            });
            assert.equal(dupRes.response.status, 409);
        }
    });

    test('labRequestId validation rejects unknown/wrong-patient/completed orders and never auto-closes unrelated orders', async () => {
        const wrongPatientForm = new FormData();
        wrongPatientForm.set('patientId', 'usr_pat_02'); // LABREQ-201 belongs to usr_pat_01
        wrongPatientForm.set('labRequestId', 'LABREQ-201');
        wrongPatientForm.set('title', 'Mismatched Order');
        wrongPatientForm.set('reportFile', new Blob(['Mismatch order test content 1'], { type: 'text/plain' }), 'mismatch.txt');
        const wrongRes = await srv.requestJson('/api/reports/upload', {
            method: 'POST',
            headers: { authorization: `Bearer ${tokenFor('usr_lab_01')}` },
            body: wrongPatientForm
        });
        assert.equal(wrongRes.response.status, 400);

        // Upload WITHOUT labRequestId for usr_pat_01 -> must NOT auto-complete LABREQ-201
        const unlinkedForm = new FormData();
        unlinkedForm.set('patientId', 'usr_pat_01');
        unlinkedForm.set('title', 'Unlinked Upload');
        unlinkedForm.set('reportFile', new Blob(['Unlinked report content 2'], { type: 'text/plain' }), 'unlinked.txt');
        const unlinkedRes = await srv.requestJson('/api/reports/upload', {
            method: 'POST',
            headers: { authorization: `Bearer ${tokenFor('usr_lab_01')}` },
            body: unlinkedForm
        });
        assert.equal(unlinkedRes.response.status, 201);

        const queueAfter = await srv.requestJson('/api/lab-requests', {
            headers: { authorization: `Bearer ${tokenFor('usr_lab_01')}` }
        });
        const req201 = queueAfter.body.labRequests.find(r => r.requestId === 'LABREQ-201');
        assert.equal(req201.status, 'PENDING_UPLOAD');
    });

    test('AES-256-GCM authenticated encryption detects ciphertext tampering cleanly (MISMATCH on verify, 400 on download)', async () => {
        const form = new FormData();
        form.set('patientId', 'usr_pat_03');
        form.set('title', 'GCM Integrity Test');
        form.set('reportFile', new Blob(['GCM tamper check content: Hemoglobin 13.5 g/dL'], { type: 'text/plain' }), 'gcm.txt');
        const up = await srv.requestJson('/api/reports/upload', {
            method: 'POST',
            headers: { authorization: `Bearer ${tokenFor('usr_lab_01')}` },
            body: form
        });
        assert.equal(up.response.status, 201);
        const rep = up.body.report;

        // Flip 1 byte inside the stored AES-256-GCM encrypted file on disk
        const encPath = path.join(srv.fixture.uploadsDir, rep.storageReference);
        const raw = fs.readFileSync(encPath);
        assert.equal(raw.subarray(0, 4).toString('ascii'), 'HCv2');
        raw[raw.length - 5] ^= 0xFF;
        fs.writeFileSync(encPath, raw);

        // Verification MUST report MISMATCH (200), never 500
        const ver = await srv.requestJson(`/api/verify/${encodeURIComponent(rep.reportId)}`);
        assert.equal(ver.response.status, 200);
        assert.equal(ver.body.status, 'MISMATCH');
        assert.equal(ver.body.isAuthentic, false);

        // Download MUST report 400 tampered, never 500
        const dl = await srv.requestJson(`/api/reports/${encodeURIComponent(rep.reportId)}/download`, {
            headers: { authorization: `Bearer ${tokenFor('usr_pat_03')}` }
        });
        assert.equal(dl.response.status, 400);
        assert.equal(dl.body.tampered, true);
    });

    test('Helpdesk inquiries require auth to read/resolve, validate inputs, and enforce rate limits', async () => {
        const anonRead = await srv.requestJson('/api/reception/inquiries');
        assert.equal(anonRead.response.status, 401);

        const badInq = await srv.requestJson('/api/reception/inquiries', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: '', message: '' })
        });
        assert.equal(badInq.response.status, 400);

        for (let i = 0; i < 2; i++) {
            const ok = await srv.requestJson('/api/reception/inquiries', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: `Student ${i}`, contact: '+91 99999 00000', department: 'General OPD', message: 'Need bill assistance' })
            });
            assert.equal(ok.response.status, 201);
        }
        // 4th total POST hits INQUIRY_RATE_LIMIT_MAX=3
        const limited = await srv.requestJson('/api/reception/inquiries', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Rate Test', message: 'Should be 429' })
        });
        assert.equal(limited.response.status, 429);
    });
});

// ============================================================================
// SUITE 3: DEMO_MODE NON-DESTRUCTIVE FLOW, MIGRATION & SOLIDITY COMPILATION
// ============================================================================
describe('DEMO_MODE, Encryption Migration, Route Guard Audit & Solidity Compiler', () => {
    test('DEMO_MODE=true enables synthetic demo login & non-destructive tamper simulation without mutating disk files', async () => {
        const demoSrv = await startServer({ DEMO_MODE: 'true' });
        try {
            const cfg = await demoSrv.requestJson('/api/config/public');
            assert.equal(cfg.body.demoMode, true);

            const accounts = await demoSrv.requestJson('/api/auth/demo-accounts');
            assert.equal(accounts.response.status, 200);
            assert.ok(accounts.body.accounts.length > 0);

            const login = await demoSrv.requestJson('/api/auth/demo-login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ userId: 'usr_adm_01' })
            });
            assert.equal(login.response.status, 200);
            const admTok = login.body.token;

            const dbData = JSON.parse(fs.readFileSync(path.join(demoSrv.fixture.dataDir, 'database.json'), 'utf8'));
            const rep = dbData.reports[0];
            const encPath = path.join(demoSrv.fixture.uploadsDir, rep.storageReference);
            const beforeHash = crypto.createHash('sha256').update(fs.readFileSync(encPath)).digest('hex');

            // Activate in-memory tamper simulation
            const sim = await demoSrv.requestJson(`/api/verify/simulate-tamper/${encodeURIComponent(rep.reportId)}`, {
                method: 'POST',
                headers: { authorization: `Bearer ${admTok}` }
            });
            assert.equal(sim.response.status, 200);

            // Verify sees MISMATCH while disk file bytes remain 100% IDENTICAL!
            const verTampered = await demoSrv.requestJson(`/api/verify/${encodeURIComponent(rep.reportId)}`);
            assert.equal(verTampered.body.status, 'MISMATCH');
            const afterHash = crypto.createHash('sha256').update(fs.readFileSync(encPath)).digest('hex');
            assert.equal(afterHash, beforeHash, 'Encrypted file on disk must NEVER be mutated by demo tamper');

            // Reset restores MATCH
            const rst = await demoSrv.requestJson(`/api/verify/reset-tamper/${encodeURIComponent(rep.reportId)}`, {
                method: 'POST',
                headers: { authorization: `Bearer ${admTok}` }
            });
            assert.equal(rst.response.status, 200);
            const verRestored = await demoSrv.requestJson(`/api/verify/${encodeURIComponent(rep.reportId)}`);
            assert.equal(verRestored.body.status, 'MATCH');
        } finally {
            await demoSrv.stop();
        }
    });

    test('DEMO_MODE=true preserves usr_adm_01 demo login even when BOOTSTRAP_ADMIN_EMAIL=admin@sithospital.org, and gzips HTML', async () => {
        const demoSrv = await startServer({
            DEMO_MODE: 'true',
            BOOTSTRAP_ADMIN_EMAIL: 'admin@sithospital.org',
            BOOTSTRAP_ADMIN_PASSWORD: TEST_ADMIN_PASSWORD
        });
        try {
            const demoAdmin = await demoSrv.requestJson('/api/auth/demo-login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ userId: 'usr_adm_01' })
            });
            assert.equal(demoAdmin.response.status, 200, 'usr_adm_01 one-click demo login must remain available in DEMO_MODE');
            assert.equal(demoAdmin.body.user.role, 'Admin');

            const realAdmin = await demoSrv.requestJson('/api/auth/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'admin@sithospital.org', password: TEST_ADMIN_PASSWORD })
            });
            assert.equal(realAdmin.response.status, 200, 'Bootstrap password login must also work');

            const compressedRes = await fetch(`${demoSrv.baseUrl}/portal`, {
                headers: { 'Accept-Encoding': 'gzip' }
            });
            assert.equal(compressedRes.status, 200);
            assert.equal(compressedRes.headers.get('content-encoding'), 'gzip');
        } finally {
            await demoSrv.stop();
        }
    });

    test('migrate-encryption script upgrades legacy CBC files to AES-256-GCM v2 idempotently', () => {
        const fixture = makeTempFixture();
        try {
            const res1 = spawnSync(process.execPath, ['scripts/migrate-encryption.js'], {
                cwd: PROJECT_DIR,
                env: {
                    ...process.env,
                    DATA_DIR: fixture.dataDir,
                    UPLOADS_DIR: fixture.uploadsDir,
                    JWT_SECRET: TEST_JWT_SECRET,
                    SHARE_JWT_SECRET: TEST_SHARE_SECRET,
                    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
                    LEGACY_ENCRYPTION_KEY: 'med-blockchain-sec-key-32bytes!',
                    DEMO_MODE: 'false'
                },
                encoding: 'utf8'
            });
            assert.equal(res1.status, 0, res1.stderr);
            const summary1 = JSON.parse(res1.stdout.slice(res1.stdout.indexOf('{')));
            assert.equal(summary1.hashMismatch, 0);
            assert.equal(summary1.errors.length, 0);

            // Second run must be 100% idempotent (migrated: 0)
            const res2 = spawnSync(process.execPath, ['scripts/migrate-encryption.js'], {
                cwd: PROJECT_DIR,
                env: {
                    ...process.env,
                    DATA_DIR: fixture.dataDir,
                    UPLOADS_DIR: fixture.uploadsDir,
                    JWT_SECRET: TEST_JWT_SECRET,
                    SHARE_JWT_SECRET: TEST_SHARE_SECRET,
                    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
                    LEGACY_ENCRYPTION_KEY: 'med-blockchain-sec-key-32bytes!',
                    DEMO_MODE: 'false'
                },
                encoding: 'utf8'
            });
            assert.equal(res2.status, 0, res2.stderr);
            const summary2 = JSON.parse(res2.stdout.slice(res2.stdout.indexOf('{')));
            assert.equal(summary2.migrated, 0);
            assert.equal(summary2.alreadyV2, summary1.totalReports);
        } finally {
            fs.rmSync(fixture.tmpRoot, { recursive: true, force: true });
        }
    });

    test('Solidity smart contract SITStudentsHospitalLedger.sol compiles cleanly via solc', () => {
        const { compileContract } = require('../scripts/deploy-contract');
        const artifact = compileContract();
        assert.ok(Array.isArray(artifact.abi) && artifact.abi.length > 0, 'Contract ABI must be non-empty');
        assert.ok(typeof artifact.bytecode === 'string' && artifact.bytecode.startsWith('0x') && artifact.bytecode.length > 100, 'Bytecode must be compiled');
    });

    test('Every Express /api/* route is either authenticated or explicitly registered in PUBLIC_API_ROUTES', () => {
        const fixture = makeTempFixture();
        try {
            const checkScript = `
                const app = require('./server');
                const stack = (app.router && app.router.stack) || (app._router && app._router.stack) || [];
                const unguarded = [];
                for (const layer of stack) {
                    if (!layer.route || !layer.route.path) continue;
                    const p = layer.route.path;
                    if (!String(p).startsWith('/api/')) continue;
                    const methods = Object.keys(layer.route.methods).filter(m => layer.route.methods[m]);
                    const hasAuth = layer.route.stack.some(s => s.name === 'authenticate');
                    for (const m of methods) {
                        const key = m.toUpperCase() + ' ' + p;
                        if (!hasAuth && !app.PUBLIC_API_ROUTES.has(key)) {
                            unguarded.push(key);
                        }
                    }
                }
                console.log(JSON.stringify({ unguarded, totalPublic: app.PUBLIC_API_ROUTES.size }));
            `;
            const out = spawnSync(process.execPath, ['-e', checkScript], {
                cwd: PROJECT_DIR,
                env: {
                    ...process.env,
                    DATA_DIR: fixture.dataDir,
                    UPLOADS_DIR: fixture.uploadsDir,
                    JWT_SECRET: TEST_JWT_SECRET,
                    SHARE_JWT_SECRET: TEST_SHARE_SECRET,
                    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
                    DEMO_MODE: 'false'
                },
                encoding: 'utf8'
            });
            assert.equal(out.status, 0, out.stderr);
            const lines = out.stdout.trim().split(/\r?\n/);
            const parsed = JSON.parse(lines[lines.length - 1]);
            assert.deepEqual(parsed.unguarded, [], `Unguarded API routes detected: ${parsed.unguarded.join(', ')}`);
        } finally {
            fs.rmSync(fixture.tmpRoot, { recursive: true, force: true });
        }
    });
});
