const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

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
