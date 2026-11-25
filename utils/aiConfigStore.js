const fs = require('fs');
const path = require('path');
const defaultConfig = require('../config');
const { encryptBuffer, decryptBuffer } = require('./cryptoUtils');
const { atomicWriteJsonSync } = require('./atomicWrite');
const { cloudPersistence: defaultCloudPersistence } = require('./cloudPersistence');

const AI_CONFIG_STATE_KEY = 'ai_config';

function getLocalAiConfigPath(cfg = defaultConfig) {
    return path.join(cfg.DATA_DIR, 'ai_config.json');
}

function loadLocalAiConfig(cfg = defaultConfig) {
    try {
        const filePath = getLocalAiConfigPath(cfg);
        if (!fs.existsSync(filePath)) return null;
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
        console.warn('[AI Config Store] Could not read local ai_config.json:', err.message);
        return null;
    }
}

/**
 * Applies a persisted (AES-256-GCM encrypted) AI config record into runtime config & process.env.
 * Never logs or exposes plaintext API keys.
 */
function applyPersistedAiConfig(record, { config = defaultConfig, env = process.env } = {}) {
    if (!record || typeof record !== 'object') {
        return { applied: false, reason: 'empty_record' };
    }

    if (record.mode === 'OFFLINE_FALLBACK' || record.externalProcessingEnabled === false) {
        delete env.GEMINI_API_KEY;
        delete env.GEMINI_ACTIVE_MODEL;
        env.AI_EXTERNAL_PROCESSING = 'false';
        config.AI_EXTERNAL_PROCESSING = false;
        return { applied: true, mode: 'OFFLINE_FALLBACK' };
    }

    if (record.mode === 'ONLINE_AI' && typeof record.encryptedApiKey === 'string' && record.encryptedApiKey.trim()) {
        try {
            const encryptedBuf = Buffer.from(record.encryptedApiKey, 'base64');
            const decryptedKey = decryptBuffer(encryptedBuf, config.ENCRYPTION_KEY_BUF).toString('utf8').trim();
            if (!decryptedKey) {
                return { applied: false, reason: 'empty_decrypted_key' };
            }
            const activeModel = (typeof record.activeModel === 'string' && record.activeModel.trim())
                ? record.activeModel.trim()
                : 'gemini-3.8-flash';
            env.GEMINI_API_KEY = decryptedKey;
            env.GEMINI_ACTIVE_MODEL = activeModel;
            env.AI_EXTERNAL_PROCESSING = 'true';
            config.AI_EXTERNAL_PROCESSING = true;
            return { applied: true, mode: 'ONLINE_AI', activeModel };
        } catch (err) {
            console.warn('[AI Config Store] Could not decrypt saved Gemini API key (ENCRYPTION_KEY may have rotated):', err.message);
            return { applied: false, reason: 'decryption_failed' };
        }
    }

    return { applied: false, reason: 'unrecognized_record' };
}

/**
 * Encrypts the Gemini API key with AES-256-GCM (using ENCRYPTION_KEY) and persists it to
 * local DATA_DIR/ai_config.json AND Firebase Firestore (sit_hospital_state/ai_config) so it
 * survives Render restarts/redeploys permanently until changed or reset by an Admin.
 */
async function savePersistedAiConfig(
    { apiKey = null, externalProcessingEnabled = false, activeModel = null, updatedBy = 'Admin' } = {},
    { config = defaultConfig, cloudPersistence = defaultCloudPersistence } = {}
) {
    const cleanKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    const isOnline = Boolean(cleanKey && externalProcessingEnabled);

    const record = {
        version: 1,
        mode: isOnline ? 'ONLINE_AI' : 'OFFLINE_FALLBACK',
        externalProcessingEnabled: isOnline,
        activeModel: isOnline ? (activeModel || 'gemini-3.8-flash') : null,
        encryptedApiKey: isOnline
            ? encryptBuffer(Buffer.from(cleanKey, 'utf8'), config.ENCRYPTION_KEY_BUF).toString('base64')
            : null,
        updatedAt: new Date().toISOString(),
        updatedBy: String(updatedBy || 'Admin').slice(0, 120)
    };

    let savedLocally = false;
    try {
        if (!fs.existsSync(config.DATA_DIR)) {
            fs.mkdirSync(config.DATA_DIR, { recursive: true });
        }
        atomicWriteJsonSync(getLocalAiConfigPath(config), record, { maxBackups: 0 });
        savedLocally = true;
    } catch (err) {
        console.warn('[AI Config Store] Failed to persist local ai_config.json:', err.message);
    }

    let savedToCloud = false;
    if (cloudPersistence && typeof cloudPersistence.isEnabled === 'function' && cloudPersistence.isEnabled()) {
        try {
            savedToCloud = await cloudPersistence.saveJsonStateNow(AI_CONFIG_STATE_KEY, record);
        } catch (err) {
            console.error('[AI Config Store] Failed to sync encrypted AI config to Firebase Firestore:', err.message);
        }
    }

    return { savedLocally, savedToCloud, mode: record.mode, activeModel: record.activeModel };
}

/**
 * Hydrates persisted encrypted AI Gateway configuration on server startup.
 * Priority: Firebase Firestore -> Local DATA_DIR/ai_config.json -> Environment Variables (.env / Render Env).
 */
async function hydrateAiConfigOnStartup({
    config = defaultConfig,
    cloudPersistence = defaultCloudPersistence,
    env = process.env
} = {}) {
    let record = null;
    let source = null;

    if (cloudPersistence && typeof cloudPersistence.isEnabled === 'function' && cloudPersistence.isEnabled()) {
        try {
            const remote = await cloudPersistence.loadJsonState(AI_CONFIG_STATE_KEY);
            if (remote && typeof remote === 'object' && remote.mode) {
                record = remote;
                source = 'firebase_firestore';
                try {
                    if (!fs.existsSync(config.DATA_DIR)) {
                        fs.mkdirSync(config.DATA_DIR, { recursive: true });
                    }
                    atomicWriteJsonSync(getLocalAiConfigPath(config), record, { maxBackups: 0 });
                } catch (_) {}
            }
        } catch (err) {
            console.warn('[AI Config Store] Could not load persisted AI config from Firebase Firestore:', err.message);
        }
    }

    if (!record) {
        const local = loadLocalAiConfig(config);
        if (local && local.mode) {
            record = local;
            source = 'local_disk';
        }
    }

    if (!record) {
        return { hydrated: false, source: 'environment_defaults' };
    }

    const applied = applyPersistedAiConfig(record, { config, env });
    if (applied.applied) {
        console.log(
            `[AI Gateway] ✓ Restored persisted AI configuration from ${source} ` +
            `(Mode: ${applied.mode}${applied.activeModel ? ', Model: ' + applied.activeModel : ''}).`
        );
    }
    return { hydrated: applied.applied, source, ...applied };
}

module.exports = {
    AI_CONFIG_STATE_KEY,
    getLocalAiConfigPath,
    loadLocalAiConfig,
    applyPersistedAiConfig,
    savePersistedAiConfig,
    hydrateAiConfigOnStartup
};
