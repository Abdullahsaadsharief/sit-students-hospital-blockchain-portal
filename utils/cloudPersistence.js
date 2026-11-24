const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const defaultConfig = require('../config');
const { atomicWriteBufferSync } = require('./atomicWrite');

const STATE_COLLECTION = 'sit_hospital_state';
const FILES_COLLECTION = 'sit_hospital_encrypted_files';
const CHUNKS_SUBCOLLECTION = 'chunks';
const CHUNK_SIZE_BYTES = 600 * 1024; // 600 KiB raw Bytes per Firestore chunk (< 1 MiB limit with safe headroom)

let firebaseAppMod = null;
let firebaseFirestoreMod = null;
let firebaseStorageMod = null;
try {
    firebaseAppMod = require('firebase-admin/app');
    firebaseFirestoreMod = require('firebase-admin/firestore');
    firebaseStorageMod = require('firebase-admin/storage');
} catch (_) {
    firebaseAppMod = null;
    firebaseFirestoreMod = null;
    firebaseStorageMod = null;
}

function sha256Hex(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sanitizeStorageFileName(fileName) {
    const base = path.basename(String(fileName || '').trim());
    if (!base || base === '.' || base === '..') {
        throw new Error('Invalid storage file name');
    }
    return base;
}

function parseServiceAccountFromConfig(cfg) {
    const rawBase64 = (cfg.FIREBASE_SERVICE_ACCOUNT_BASE64 || '').trim();
    const rawJson = (cfg.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
    const rawPath = (cfg.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();

    let jsonString = null;
    if (rawBase64) {
        try {
            jsonString = Buffer.from(rawBase64, 'base64').toString('utf8');
        } catch (err) {
            return { error: `Invalid FIREBASE_SERVICE_ACCOUNT_BASE64: ${err.message}` };
        }
    } else if (rawJson) {
        jsonString = rawJson;
    } else if (rawPath) {
        const resolved = path.resolve(cfg.ROOT_DIR || process.cwd(), rawPath);
        if (!fs.existsSync(resolved)) {
            return { error: `FIREBASE_SERVICE_ACCOUNT_PATH file not found: ${rawPath}` };
        }
        jsonString = fs.readFileSync(resolved, 'utf8');
    } else {
        return { credential: null, error: null };
    }

    try {
        const parsed = JSON.parse(jsonString);
        if (!parsed || typeof parsed !== 'object') {
            return { error: 'Firebase service account JSON must be an object' };
        }
        if (typeof parsed.private_key === 'string') {
            parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
        }
        if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
            return { error: 'Firebase service account JSON is missing project_id, client_email, or private_key' };
        }
        return { credential: parsed, error: null };
    } catch (err) {
        return { error: `Failed to parse Firebase service account JSON: ${err.message}` };
    }
}

function splitBufferIntoChunks(buffer, chunkSize = CHUNK_SIZE_BYTES) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    if (buf.length === 0) {
        return [Buffer.alloc(0)];
    }
    const chunks = [];
    for (let offset = 0; offset < buf.length; offset += chunkSize) {
        chunks.push(buf.subarray(offset, Math.min(offset + chunkSize, buf.length)));
    }
    return chunks;
}

function toNodeBuffer(val) {
    if (Buffer.isBuffer(val)) return val;
    if (val instanceof Uint8Array) return Buffer.from(val);
    if (typeof val === 'string') return Buffer.from(val, 'base64');
    if (val && typeof val.toUint8Array === 'function') return Buffer.from(val.toUint8Array());
    if (val && val._bytes instanceof Uint8Array) return Buffer.from(val._bytes);
    return Buffer.alloc(0);
}

function createCloudPersistence({
    config = defaultConfig,
    firestoreClient = null,
    storageBucket = null,
    projectId = null,
    chunkSizeBytes = CHUNK_SIZE_BYTES
} = {}) {
    let firestore = firestoreClient;
    let bucket = storageBucket;
    let detectedProjectId = projectId;
    let initError = null;
    let enabled = Boolean(firestore);

    // Track coalesced serialized state sync queues per key ('database', 'ledger')
    const syncQueues = new Map();
    const pendingInFlightPromises = new Set();

    function initFromConfig() {
        if (firestore) {
            enabled = true;
            return;
        }

        const { credential, error } = parseServiceAccountFromConfig(config);
        if (error) {
            initError = error;
            enabled = false;
            console.warn(`[CloudPersistence] Disabled: ${error}`);
            return;
        }
        if (!credential) {
            enabled = false;
            initError = null;
            return;
        }
        if (!firebaseAppMod || !firebaseFirestoreMod) {
            initError = 'firebase-admin package is not installed';
            enabled = false;
            console.warn(`[CloudPersistence] Disabled: ${initError}`);
            return;
        }

        try {
            const appName = 'sit-hospital-persistence';
            const existingApps = typeof firebaseAppMod.getApps === 'function' ? firebaseAppMod.getApps() : [];
            let app = existingApps.find(a => a && a.name === appName);
            if (!app) {
                const appOptions = {
                    credential: firebaseAppMod.cert(credential)
                };
                if (config.FIREBASE_STORAGE_BUCKET) {
                    appOptions.storageBucket = config.FIREBASE_STORAGE_BUCKET;
                }
                app = firebaseAppMod.initializeApp(appOptions, appName);
            }
            firestore = firebaseFirestoreMod.getFirestore(app);
            detectedProjectId = credential.project_id;
            if (config.FIREBASE_STORAGE_BUCKET && firebaseStorageMod) {
                try {
                    bucket = firebaseStorageMod.getStorage(app).bucket(config.FIREBASE_STORAGE_BUCKET);
                } catch (bucketErr) {
                    console.warn('[CloudPersistence] Optional Storage bucket init warning (falling back to Firestore chunks):', bucketErr.message);
                    bucket = null;
                }
            }
            enabled = true;
            initError = null;
        } catch (err) {
            initError = err.message;
            enabled = false;
            console.error('[CloudPersistence] Firebase Admin initialization failed:', err.message);
        }
    }

    initFromConfig();

    function isEnabled() {
        return Boolean(enabled && firestore);
    }

    function getStatus() {
        return {
            cloudEnabled: isEnabled(),
            backend: isEnabled()
                ? (bucket ? 'firebase_storage_and_firestore' : 'firebase_firestore')
                : 'local_disk_only',
            projectId: detectedProjectId || null,
            storageBucketConfigured: Boolean(bucket && config.FIREBASE_STORAGE_BUCKET),
            mode: isEnabled()
                ? (bucket ? 'FIREBASE_STORAGE_AND_FIRESTORE' : 'FIREBASE_FIRESTORE_PERSISTENT')
                : 'LOCAL_EPHEMERAL_DISK',
            note: initError || null
        };
    }

    async function writeChunkedDoc(collectionName, docId, rawBuffer, extraMeta = {}) {
        const docRef = firestore.collection(collectionName).doc(docId);
        const existingSnap = await docRef.get();
        const previousRevisionId = existingSnap.exists ? (existingSnap.data() || {}).revisionId : null;
        const previousChunkCount = existingSnap.exists ? Number((existingSnap.data() || {}).chunkCount || 0) : 0;

        const revisionId = `rev_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
        const chunks = splitBufferIntoChunks(rawBuffer, chunkSizeBytes);
        const checksum = sha256Hex(rawBuffer);

        // Write all chunks of the new revision FIRST so readers never observe partial data
        for (let i = 0; i < chunks.length; i++) {
            const chunkId = `${revisionId}_${String(i).padStart(4, '0')}`;
            await docRef.collection(CHUNKS_SUBCOLLECTION).doc(chunkId).set({
                revisionId,
                index: i,
                byteLength: chunks[i].length,
                data: Buffer.from(chunks[i])
            });
        }

        // Atomically switch manifest to the completed revision
        await docRef.set({
            version: 2,
            revisionId,
            chunkCount: chunks.length,
            totalBytes: rawBuffer.length,
            sha256: checksum,
            updatedAt: new Date().toISOString(),
            ...extraMeta
        });

        // Best-effort cleanup of previous revision chunks
        if (previousRevisionId && previousRevisionId !== revisionId && previousChunkCount > 0) {
            for (let i = 0; i < previousChunkCount; i++) {
                const oldChunkId = `${previousRevisionId}_${String(i).padStart(4, '0')}`;
                try {
                    await docRef.collection(CHUNKS_SUBCOLLECTION).doc(oldChunkId).delete();
                } catch (_) {}
            }
        }

        return { revisionId, chunkCount: chunks.length, totalBytes: rawBuffer.length, sha256: checksum };
    }

    async function readChunkedDoc(collectionName, docId) {
        const docRef = firestore.collection(collectionName).doc(docId);
        const snap = await docRef.get();
        if (!snap.exists) return null;

        const meta = snap.data() || {};
        const chunkCount = Number(meta.chunkCount || 0);
        const revisionId = meta.revisionId;
        if (!revisionId || chunkCount <= 0) {
            return null;
        }

        const buffers = [];
        for (let i = 0; i < chunkCount; i++) {
            const chunkId = `${revisionId}_${String(i).padStart(4, '0')}`;
            const chunkSnap = await docRef.collection(CHUNKS_SUBCOLLECTION).doc(chunkId).get();
            if (!chunkSnap.exists) {
                throw new Error(`Missing Firestore chunk ${chunkId} for ${collectionName}/${docId}`);
            }
            const chunkData = chunkSnap.data() || {};
            buffers.push(toNodeBuffer(chunkData.data));
        }

        const combined = Buffer.concat(buffers);
        if (meta.sha256 && sha256Hex(combined) !== meta.sha256) {
            throw new Error(`Checksum mismatch reconstructing ${collectionName}/${docId} from Firestore`);
        }

        return { buffer: combined, meta };
    }

    async function saveJsonStateNow(stateKey, jsonObject) {
        if (!isEnabled()) return false;
        const jsonBuf = Buffer.from(JSON.stringify(jsonObject), 'utf8');
        const gzipped = zlib.gzipSync(jsonBuf);
        await writeChunkedDoc(STATE_COLLECTION, stateKey, gzipped, {
            encoding: 'gzip',
            uncompressedBytes: jsonBuf.length
        });
        return true;
    }

    async function loadJsonState(stateKey) {
        if (!isEnabled()) return null;
        const result = await readChunkedDoc(STATE_COLLECTION, stateKey);
        if (!result) return null;
        const { buffer, meta } = result;
        const rawJsonBuf = meta.encoding === 'gzip' ? zlib.gunzipSync(buffer) : buffer;
        return JSON.parse(rawJsonBuf.toString('utf8'));
    }

    /**
     * Coalescing serialized write queue: ensures rapid successive mutations to 'database' or 'ledger'
     * never race or write stale snapshots out of order.
     */
    function scheduleStateSync(stateKey, payloadSnapshot) {
        if (!isEnabled()) return;

        // Deep-clone synchronously at call time so later mutations cannot mutate an in-flight snapshot
        let cloned;
        try {
            cloned = JSON.parse(JSON.stringify(payloadSnapshot));
        } catch (err) {
            console.warn(`[CloudPersistence] Failed to snapshot ${stateKey}:`, err.message);
            return;
        }

        let entry = syncQueues.get(stateKey);
        if (!entry) {
            entry = { latest: null, running: false, promise: null };
            syncQueues.set(stateKey, entry);
        }
        entry.latest = cloned;

        if (!entry.running) {
            entry.running = true;
            const runLoop = (async () => {
                while (entry.latest !== null) {
                    const nextSnapshot = entry.latest;
                    entry.latest = null;
                    try {
                        await saveJsonStateNow(stateKey, nextSnapshot);
                    } catch (err) {
                        console.error(`[CloudPersistence] Failed to sync ${stateKey} to Firestore:`, err.message);
                    }
                }
                entry.running = false;
                entry.promise = null;
            })();
            entry.promise = runLoop;
            pendingInFlightPromises.add(runLoop);
            runLoop.finally(() => pendingInFlightPromises.delete(runLoop));
        }
    }

    async function flushAll() {
        const active = Array.from(pendingInFlightPromises);
        if (active.length > 0) {
            await Promise.allSettled(active);
        }
    }

    /**
     * Persists an AES-256-GCM encrypted report or prescription attachment to Firebase.
     * Uses Firebase Cloud Storage if FIREBASE_STORAGE_BUCKET is configured; otherwise stores
     * chunked raw Bytes in Firestore (100% Spark Free Tier compatible).
     */
    async function saveEncryptedFile(storageReference, encryptedBuffer) {
        if (!isEnabled()) return { savedToCloud: false, reason: 'disabled' };
        const safeName = sanitizeStorageFileName(storageReference);
        const buf = Buffer.isBuffer(encryptedBuffer) ? encryptedBuffer : Buffer.from(encryptedBuffer);
        const checksum = sha256Hex(buf);

        if (bucket) {
            try {
                const gcsPath = `encrypted-vault/${safeName}`;
                await bucket.file(gcsPath).save(buf, {
                    resumable: false,
                    metadata: {
                        contentType: 'application/octet-stream',
                        metadata: { sha256: checksum }
                    }
                });
                await firestore.collection(FILES_COLLECTION).doc(safeName).set({
                    version: 2,
                    fileName: safeName,
                    storageBackend: 'gcs',
                    gcsPath,
                    totalBytes: buf.length,
                    sha256: checksum,
                    updatedAt: new Date().toISOString()
                });
                return { savedToCloud: true, backend: 'gcs', fileName: safeName };
            } catch (gcsErr) {
                console.warn(`[CloudPersistence] GCS upload fallback to Firestore chunks for ${safeName}:`, gcsErr.message);
            }
        }

        await writeChunkedDoc(FILES_COLLECTION, safeName, buf, {
            fileName: safeName,
            storageBackend: 'firestore'
        });
        return { savedToCloud: true, backend: 'firestore', fileName: safeName };
    }

    async function loadEncryptedFile(storageReference) {
        if (!isEnabled()) return null;
        const safeName = sanitizeStorageFileName(storageReference);
        const docRef = firestore.collection(FILES_COLLECTION).doc(safeName);
        const snap = await docRef.get();
        if (!snap.exists) return null;

        const meta = snap.data() || {};
        if (meta.storageBackend === 'gcs' && bucket && meta.gcsPath) {
            const [downloaded] = await bucket.file(meta.gcsPath).download();
            if (meta.sha256 && sha256Hex(downloaded) !== meta.sha256) {
                throw new Error(`Checksum mismatch downloading ${safeName} from Firebase Storage`);
            }
            return downloaded;
        }

        const res = await readChunkedDoc(FILES_COLLECTION, safeName);
        return res ? res.buffer : null;
    }

    /**
     * Ensures an encrypted file exists in local config.UPLOADS_DIR, pulling it from Firebase
     * if Render's ephemeral disk restarted since the upload.
     */
    async function ensureLocalEncryptedFile(storageReference) {
        if (!storageReference) return false;
        const safeName = sanitizeStorageFileName(storageReference);
        const localPath = path.join(config.UPLOADS_DIR, safeName);
        if (fs.existsSync(localPath)) {
            return true;
        }
        if (!isEnabled()) {
            return false;
        }

        try {
            const cloudBuffer = await loadEncryptedFile(safeName);
            if (!cloudBuffer || cloudBuffer.length === 0) {
                return false;
            }
            atomicWriteBufferSync(localPath, cloudBuffer);
            return true;
        } catch (err) {
            console.error(`[CloudPersistence] Failed to restore encrypted file ${safeName} from Firebase:`, err.message);
            return false;
        }
    }

    /**
     * Hydrates local disk + in-memory DB & Blockchain from Firebase Firestore on server startup.
     * If Firebase has no saved state yet (first boot), uploads the initial state + seed encrypted files.
     */
    async function hydrateOnStartup({ db, blockchain }) {
        if (!isEnabled()) {
            return { hydrated: false, reason: 'disabled' };
        }

        console.log(`[CloudPersistence] Connecting to Firebase Firestore (project: ${detectedProjectId})...`);
        const [remoteLedger, remoteDb] = await Promise.all([
            loadJsonState('ledger'),
            loadJsonState('database')
        ]);

        let restoredLedger = false;
        let restoredDb = false;

        if (Array.isArray(remoteLedger) && remoteLedger.length > 0) {
            atomicWriteBufferSync(config.LEDGER_FILE_PATH, Buffer.from(JSON.stringify(remoteLedger, null, 2), 'utf8'));
            blockchain.reloadFromDisk();
            restoredLedger = true;
        }

        if (remoteDb && typeof remoteDb === 'object' && Array.isArray(remoteDb.users) && Array.isArray(remoteDb.reports)) {
            atomicWriteBufferSync(config.DB_FILE_PATH, Buffer.from(JSON.stringify(remoteDb, null, 2), 'utf8'));
            db.reloadFromDisk();
            restoredDb = true;
        }

        if (restoredDb || restoredLedger) {
            console.log(
                `[CloudPersistence] ✓ Restored persistent hospital state from Firebase Firestore ` +
                `(${db.users.length} users, ${db.reports.length} reports, ${blockchain.chain.length} ledger blocks).`
            );
            return {
                hydrated: true,
                restoredDb,
                restoredLedger,
                users: db.users.length,
                reports: db.reports.length,
                blocks: blockchain.chain.length
            };
        }

        // First boot with an empty Firestore database: upload current baseline state & local encrypted files
        console.log('[CloudPersistence] First boot detected — backing up initial database, ledger, and encrypted files to Firebase Firestore...');
        await saveJsonStateNow('ledger', blockchain.chain);
        await saveJsonStateNow('database', {
            users: db.users,
            reports: db.reports,
            sharedLinks: db.sharedLinks,
            auditLogs: db.auditLogs,
            prescriptions: db.prescriptions,
            labRequests: db.labRequests,
            inquiries: db.inquiries
        });

        let syncedFiles = 0;
        if (fs.existsSync(config.UPLOADS_DIR)) {
            const files = fs.readdirSync(config.UPLOADS_DIR).filter(f => f.endsWith('.bin'));
            for (const fileName of files) {
                try {
                    const buf = fs.readFileSync(path.join(config.UPLOADS_DIR, fileName));
                    await saveEncryptedFile(fileName, buf);
                    syncedFiles++;
                } catch (err) {
                    console.warn(`[CloudPersistence] Initial file backup skipped for ${fileName}:`, err.message);
                }
            }
        }

        console.log(`[CloudPersistence] ✓ Initial baseline synced to Firebase Firestore (${syncedFiles} encrypted files).`);
        return { hydrated: false, seededCloud: true, syncedFiles };
    }

    return {
        isEnabled,
        getStatus,
        scheduleStateSync,
        flushAll,
        saveJsonStateNow,
        loadJsonState,
        saveEncryptedFile,
        loadEncryptedFile,
        ensureLocalEncryptedFile,
        hydrateOnStartup
    };
}

const cloudPersistence = createCloudPersistence();

module.exports = {
    cloudPersistence,
    createCloudPersistence,
    parseServiceAccountFromConfig,
    splitBufferIntoChunks,
    CHUNK_SIZE_BYTES
};
