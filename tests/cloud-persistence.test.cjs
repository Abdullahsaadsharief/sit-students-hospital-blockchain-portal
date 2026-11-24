const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Ensure CI environments (e.g. GitHub Actions with no .env file) can load config.js cleanly
if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'ci-test-only-jwt-secret-32-chars-minimum-111111';
}
if (!process.env.SHARE_JWT_SECRET) {
    process.env.SHARE_JWT_SECRET = 'ci-test-only-share-secret-32-chars-minimum-222222';
}
if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
}

const {
    createCloudPersistence,
    parseServiceAccountFromConfig,
    splitBufferIntoChunks
} = require('../utils/cloudPersistence');

/**
 * In-memory Firestore mock supporting collections, documents, subcollections, set/get/delete
 */
function createMockFirestore() {
    const store = new Map(); // fullPath -> data object

    function makeDocRef(docPath) {
        return {
            async get() {
                const exists = store.has(docPath);
                return {
                    exists,
                    data: () => (exists ? store.get(docPath) : undefined)
                };
            },
            async set(data) {
                store.set(docPath, data);
            },
            async delete() {
                store.delete(docPath);
            },
            collection(subName) {
                return makeCollectionRef(`${docPath}/${subName}`);
            }
        };
    }

    function makeCollectionRef(colPath) {
        return {
            doc(docId) {
                return makeDocRef(`${colPath}/${docId}`);
            }
        };
    }

    return {
        collection(name) {
            return makeCollectionRef(name);
        },
        _store: store
    };
}

test('CloudPersistence: parseServiceAccountFromConfig parses Base64 and raw JSON safely', () => {
    const sampleCred = {
        type: 'service_account',
        project_id: 'sit-students-hospital',
        client_email: 'firebase-adminsdk@sit-students-hospital.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\\nFAKE_TEST_KEY\\n-----END PRIVATE KEY-----\\n'
    };

    const rawRes = parseServiceAccountFromConfig({
        FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(sampleCred)
    });
    assert.equal(rawRes.error, null);
    assert.equal(rawRes.credential.project_id, 'sit-students-hospital');
    assert.ok(rawRes.credential.private_key.includes('\nFAKE_TEST_KEY\n'));

    const b64Res = parseServiceAccountFromConfig({
        FIREBASE_SERVICE_ACCOUNT_BASE64: Buffer.from(JSON.stringify(sampleCred), 'utf8').toString('base64')
    });
    assert.equal(b64Res.error, null);
    assert.equal(b64Res.credential.client_email, sampleCred.client_email);

    const badRes = parseServiceAccountFromConfig({
        FIREBASE_SERVICE_ACCOUNT_JSON: '{not valid json'
    });
    assert.ok(badRes.error);
});

test('CloudPersistence: multi-chunk encrypted file round-trip & Render restart restoration', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sit-cloud-test-'));
    const uploadsDir = path.join(tmpDir, 'uploads');
    const dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    try {
        const mockFs = createMockFirestore();
        // Use small 16 KiB chunk size to exercise multi-chunk splitting and reassembly
        const cp = createCloudPersistence({
            config: {
                DATA_DIR: dataDir,
                UPLOADS_DIR: uploadsDir,
                DB_FILE_PATH: path.join(dataDir, 'database.json'),
                LEDGER_FILE_PATH: path.join(dataDir, 'ledger.json')
            },
            firestoreClient: mockFs,
            projectId: 'sit-students-hospital-test',
            chunkSizeBytes: 16 * 1024
        });

        assert.equal(cp.isEnabled(), true);
        assert.equal(cp.getStatus().mode, 'FIREBASE_FIRESTORE_PERSISTENT');

        // 55 KiB random ciphertext buffer => splits into 4 chunks (16+16+16+7 KiB)
        const encryptedPayload = crypto.randomBytes(55 * 1024);
        assert.equal(splitBufferIntoChunks(encryptedPayload, 16 * 1024).length, 4);

        const saveRes = await cp.saveEncryptedFile('REP-TEST9999_encrypted.bin', encryptedPayload);
        assert.equal(saveRes.savedToCloud, true);
        assert.equal(saveRes.backend, 'firestore');

        // Simulate ephemeral Render restart: local uploads/ directory does NOT contain the file
        const localFilePath = path.join(uploadsDir, 'REP-TEST9999_encrypted.bin');
        assert.equal(fs.existsSync(localFilePath), false);

        // ensureLocalEncryptedFile pulls and verifies SHA-256 from Firestore chunks
        const restored = await cp.ensureLocalEncryptedFile('REP-TEST9999_encrypted.bin');
        assert.equal(restored, true);
        assert.equal(fs.existsSync(localFilePath), true);
        assert.deepEqual(fs.readFileSync(localFilePath), encryptedPayload);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('CloudPersistence: hydrateOnStartup restores DB & ledger after ephemeral container wipe', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sit-hydrate-test-'));
    const uploadsDir = path.join(tmpDir, 'uploads');
    const dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    try {
        const mockFs = createMockFirestore();
        const cfg = {
            DATA_DIR: dataDir,
            UPLOADS_DIR: uploadsDir,
            DB_FILE_PATH: path.join(dataDir, 'database.json'),
            LEDGER_FILE_PATH: path.join(dataDir, 'ledger.json')
        };

        const cp = createCloudPersistence({
            config: cfg,
            firestoreClient: mockFs,
            projectId: 'sit-students-hospital-test',
            chunkSizeBytes: 8 * 1024
        });

        // First boot seeds initial state to Firestore
        const initialDb = {
            users: [{ id: 'usr_pat_1', name: 'Initial Patient' }],
            reports: [{ reportId: 'REP-SEED1' }],
            sharedLinks: [],
            auditLogs: [],
            prescriptions: [],
            labRequests: [],
            inquiries: [],
            reloadFromDisk() {}
        };
        const initialChain = {
            chain: [{ index: 0, hash: 'genesis' }, { index: 1, hash: 'blk1' }],
            reloadFromDisk() {}
        };

        const boot1 = await cp.hydrateOnStartup({ db: initialDb, blockchain: initialChain });
        assert.equal(boot1.seededCloud, true);

        // Rapid mutations via coalescing write queue
        cp.scheduleStateSync('database', {
            ...initialDb,
            reports: [{ reportId: 'REP-SEED1' }, { reportId: 'REP-NEW1' }]
        });
        cp.scheduleStateSync('database', {
            ...initialDb,
            users: [{ id: 'usr_pat_1', name: 'Initial Patient' }, { id: 'usr_pat_2', name: 'Persisted Patient' }],
            reports: [{ reportId: 'REP-SEED1' }, { reportId: 'REP-NEW1' }, { reportId: 'REP-NEW2' }]
        });
        cp.scheduleStateSync('ledger', [
            { index: 0, hash: 'genesis' },
            { index: 1, hash: 'blk1' },
            { index: 2, hash: 'blk2' }
        ]);
        await cp.flushAll();

        // Wipe local disk to simulate Render restart / sleep
        if (fs.existsSync(cfg.DB_FILE_PATH)) fs.unlinkSync(cfg.DB_FILE_PATH);
        if (fs.existsSync(cfg.LEDGER_FILE_PATH)) fs.unlinkSync(cfg.LEDGER_FILE_PATH);

        // Second boot hydrates completely from Firestore
        const reloadedDbState = {
            users: [],
            reports: [],
            reloadFromDisk() {
                const parsed = JSON.parse(fs.readFileSync(cfg.DB_FILE_PATH, 'utf8'));
                this.users = parsed.users;
                this.reports = parsed.reports;
            }
        };
        const reloadedChainState = {
            chain: [],
            reloadFromDisk() {
                this.chain = JSON.parse(fs.readFileSync(cfg.LEDGER_FILE_PATH, 'utf8'));
            }
        };

        const boot2 = await cp.hydrateOnStartup({ db: reloadedDbState, blockchain: reloadedChainState });
        assert.equal(boot2.hydrated, true);
        assert.equal(reloadedDbState.users.length, 2);
        assert.equal(reloadedDbState.reports.length, 3);
        assert.equal(reloadedDbState.reports[2].reportId, 'REP-NEW2');
        assert.equal(reloadedChainState.chain.length, 3);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('CloudPersistence: GCS bucket upload falls back cleanly to Firestore chunks on error', async () => {
    const mockFs = createMockFirestore();
    const failingBucket = {
        file() {
            return {
                async save() {
                    throw new Error('Bucket not enabled on Spark plan');
                }
            };
        }
    };

    const cp = createCloudPersistence({
        config: { FIREBASE_STORAGE_BUCKET: 'sit-students-hospital.firebasestorage.app' },
        firestoreClient: mockFs,
        storageBucket: failingBucket,
        projectId: 'sit-students-hospital-test'
    });

    const data = Buffer.from('encrypted-aes-256-gcm-bytes');
    const res = await cp.saveEncryptedFile('REP-FALLBACK_encrypted.bin', data);
    assert.equal(res.savedToCloud, true);
    assert.equal(res.backend, 'firestore');

    const loaded = await cp.loadEncryptedFile('REP-FALLBACK_encrypted.bin');
    assert.deepEqual(loaded, data);
});

test('CloudPersistence: real firebase-admin v13 modular SDK initializes cleanly with generated RSA key', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' }
    });

    const fakeServiceAccount = {
        type: 'service_account',
        project_id: 'sit-hospital-sdk-init-test',
        private_key_id: 'test-key-id',
        private_key: privateKey,
        client_email: 'firebase-adminsdk@sit-hospital-sdk-init-test.iam.gserviceaccount.com',
        client_id: '1234567890'
    };

    const cp = createCloudPersistence({
        config: {
            FIREBASE_SERVICE_ACCOUNT_BASE64: Buffer.from(JSON.stringify(fakeServiceAccount), 'utf8').toString('base64'),
            FIREBASE_STORAGE_BUCKET: ''
        }
    });

    const status = cp.getStatus();
    assert.equal(status.cloudEnabled, true, `Expected Firebase Admin SDK to initialize cleanly, got note: ${status.note}`);
    assert.equal(status.projectId, 'sit-hospital-sdk-init-test');
    assert.equal(status.mode, 'FIREBASE_FIRESTORE_PERSISTENT');

    // Clean up test Firebase app instance so Node exits promptly
    const { getApps, deleteApp } = require('firebase-admin/app');
    for (const app of getApps()) {
        if (app.name === 'sit-hospital-persistence') {
            await deleteApp(app);
        }
    }
});

test('CloudPersistence: debounced scheduleStateSync coalesces burst writes and flushes immediately via flushAll()', async () => {
    const mockFs = createMockFirestore();
    let manifestWrites = 0;
    const origCollection = mockFs.collection.bind(mockFs);
    mockFs.collection = (name) => {
        const col = origCollection(name);
        const origDoc = col.doc.bind(col);
        col.doc = (docId) => {
            const ref = origDoc(docId);
            if (name === 'sit_hospital_state' && docId === 'database') {
                const origSet = ref.set.bind(ref);
                ref.set = async (data) => {
                    manifestWrites++;
                    return origSet(data);
                };
            }
            return ref;
        };
        return col;
    };

    const cp = createCloudPersistence({
        config: {},
        firestoreClient: mockFs,
        projectId: 'sit-debounce-test',
        syncDebounceMs: 500,
        requireHydrationBeforeSync: false
    });

    for (let i = 1; i <= 5; i++) {
        cp.scheduleStateSync('database', { version: i, users: [], reports: [] });
    }
    assert.equal(manifestWrites, 0, 'Burst writes should be debounced rather than firing immediately');

    await cp.flushAll();
    assert.equal(manifestWrites, 1, 'flushAll() must coalesce all 5 burst writes into exactly 1 Firestore commit');

    const loaded = await cp.loadJsonState('database');
    assert.equal(loaded.version, 5);
});

test('CloudPersistence: pre-hydration startup persist() NEVER overwrites fresher Firestore state on redeploy', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sit-prehydrate-guard-'));
    const dataDir = path.join(tmpDir, 'data');
    const uploadsDir = path.join(tmpDir, 'uploads');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });

    try {
        const mockFs = createMockFirestore();
        const cfg = {
            DATA_DIR: dataDir,
            UPLOADS_DIR: uploadsDir,
            DB_FILE_PATH: path.join(dataDir, 'database.json'),
            LEDGER_FILE_PATH: path.join(dataDir, 'ledger.json')
        };

        // Existing cloud state already has 2 completed lab requests & 11 reports
        const writerCp = createCloudPersistence({
            config: cfg,
            firestoreClient: mockFs,
            projectId: 'sit-students-hospital',
            requireHydrationBeforeSync: false
        });
        await writerCp.saveJsonStateNow('database', {
            users: [{ id: 'usr_pat_01', name: 'John Doe' }],
            reports: [{ reportId: 'REP-SEED1' }, { reportId: 'REP-UPLOADED-1' }, { reportId: 'REP-UPLOADED-2' }],
            labRequests: [
                { requestId: 'LABREQ-201', status: 'COMPLETED', linkedReportId: 'REP-UPLOADED-1' },
                { requestId: 'LABREQ-202', status: 'COMPLETED', linkedReportId: 'REP-UPLOADED-2' }
            ]
        });
        await writerCp.saveJsonStateNow('ledger', [{ index: 0, hash: 'g' }, { index: 1, hash: 'b1' }, { index: 2, hash: 'b2' }]);

        // Simulate fresh Render container boot on redeploy
        const bootCp = createCloudPersistence({
            config: cfg,
            firestoreClient: mockFs,
            projectId: 'sit-students-hospital',
            syncDebounceMs: 20,
            requireHydrationBeforeSync: true
        });

        // Simulate stale repo database.json calling scheduleStateSync() BEFORE hydrateOnStartup()
        bootCp.scheduleStateSync('database', {
            users: [{ id: 'usr_pat_01', name: 'John Doe' }],
            reports: [{ reportId: 'REP-SEED1' }],
            labRequests: [
                { requestId: 'LABREQ-201', status: 'PENDING_UPLOAD' },
                { requestId: 'LABREQ-202', status: 'PENDING_UPLOAD' }
            ]
        });

        const liveDb = {
            users: [],
            reports: [],
            labRequests: [],
            reloadFromDisk() {
                const parsed = JSON.parse(fs.readFileSync(cfg.DB_FILE_PATH, 'utf8'));
                this.users = parsed.users;
                this.reports = parsed.reports;
                this.labRequests = parsed.labRequests;
            }
        };
        const liveChain = {
            chain: [],
            reloadFromDisk() {
                this.chain = JSON.parse(fs.readFileSync(cfg.LEDGER_FILE_PATH, 'utf8'));
            }
        };

        const res = await bootCp.hydrateOnStartup({ db: liveDb, blockchain: liveChain });
        await new Promise(r => setTimeout(r, 60));
        await bootCp.flushAll();

        assert.equal(res.hydrated, true);
        assert.equal(liveDb.reports.length, 3);
        assert.equal(liveDb.labRequests[0].status, 'COMPLETED');
        assert.equal(liveDb.labRequests[1].status, 'COMPLETED');

        // Verify Firestore itself was NOT overwritten by the pre-hydration stale call!
        const cloudDbAfterBoot = await bootCp.loadJsonState('database');
        assert.equal(cloudDbAfterBoot.reports.length, 3);
        assert.equal(cloudDbAfterBoot.labRequests[0].status, 'COMPLETED');
        assert.equal(cloudDbAfterBoot.labRequests[1].status, 'COMPLETED');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
