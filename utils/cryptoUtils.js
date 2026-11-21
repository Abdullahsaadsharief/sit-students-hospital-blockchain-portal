const crypto = require('crypto');
const config = require('../config');

const V2_MAGIC = Buffer.from('HCv2', 'ascii'); // 4 bytes
const V2_VERSION = Buffer.from([0x02]);        // 1 byte
const GCM_IV_LENGTH = 12;                      // 12 bytes recommended for AES-256-GCM
const GCM_TAG_LENGTH = 16;                     // 16-byte authentication tag
const LEGACY_CBC_IV_LENGTH = 16;

class TamperDetectedError extends Error {
    constructor(message = 'Authenticated decryption failed: ciphertext or tag was modified.') {
        super(message);
        this.name = 'TamperDetectedError';
        this.isTampered = true;
    }
}

/**
 * Computes SHA-256 cryptographic hash (fingerprint) of a file or string buffer
 */
function computeSHA256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Checks whether an encrypted buffer uses the authenticated AES-256-GCM v2 format
 */
function isV2Encrypted(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < (V2_MAGIC.length + V2_VERSION.length + GCM_IV_LENGTH + GCM_TAG_LENGTH)) {
        return false;
    }
    return buffer.subarray(0, 4).equals(V2_MAGIC) && buffer[4] === 0x02;
}

/**
 * Encrypts a raw buffer using authenticated AES-256-GCM (v2 format):
 * [4B 'HCv2'] [1B 0x02] [12B IV] [16B AuthTag] [Ciphertext]
 */
function encryptBuffer(buffer, keyBuf = config.ENCRYPTION_KEY_BUF) {
    const safeKey = Buffer.isBuffer(keyBuf) && keyBuf.length === 32
        ? keyBuf
        : crypto.createHash('sha256').update(String(keyBuf)).digest();

    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', safeKey, iv);
    const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([V2_MAGIC, V2_VERSION, iv, authTag, ciphertext]);
}

/**
 * Decrypts either:
 *   1. Authenticated AES-256-GCM v2 payload (throws TamperDetectedError on integrity mismatch)
 *   2. Legacy AES-256-CBC v1 payload using LEGACY_ENCRYPTION_KEY (for existing unmigrated fixtures)
 */
function decryptBuffer(encryptedBuffer, keyBuf = config.ENCRYPTION_KEY_BUF) {
    if (!Buffer.isBuffer(encryptedBuffer) || encryptedBuffer.length < LEGACY_CBC_IV_LENGTH + 1) {
        throw new TamperDetectedError('Encrypted file is empty or truncated.');
    }

    if (isV2Encrypted(encryptedBuffer)) {
        const safeKey = Buffer.isBuffer(keyBuf) && keyBuf.length === 32
            ? keyBuf
            : crypto.createHash('sha256').update(String(keyBuf)).digest();

        const ivStart = 5;
        const tagStart = ivStart + GCM_IV_LENGTH;
        const ctStart = tagStart + GCM_TAG_LENGTH;

        const iv = encryptedBuffer.subarray(ivStart, tagStart);
        const authTag = encryptedBuffer.subarray(tagStart, ctStart);
        const ciphertext = encryptedBuffer.subarray(ctStart);

        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', safeKey, iv);
            decipher.setAuthTag(authTag);
            return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        } catch (err) {
            throw new TamperDetectedError('AES-256-GCM authentication tag mismatch: stored file has been tampered with or corrupted.');
        }
    }

    // Legacy v1 AES-256-CBC fallback for pre-migration files
    try {
        const legacyKey = crypto.createHash('sha256').update(String(config.LEGACY_ENCRYPTION_KEY)).digest();
        const iv = encryptedBuffer.subarray(0, LEGACY_CBC_IV_LENGTH);
        const ciphertext = encryptedBuffer.subarray(LEGACY_CBC_IV_LENGTH);
        const decipher = crypto.createDecipheriv('aes-256-cbc', legacyKey, iv);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (err) {
        throw new TamperDetectedError('Legacy AES-256-CBC decryption failed: file corrupted or modified.');
    }
}

/**
 * Generates pseudonymous report ID (e.g., REP-8F3A29B1)
 */
function generatePseudonymousId(prefix = 'REP') {
    const randHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${prefix}-${randHex}`;
}

module.exports = {
    computeSHA256,
    encryptBuffer,
    decryptBuffer,
    isV2Encrypted,
    generatePseudonymousId,
    TamperDetectedError
};
