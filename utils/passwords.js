const crypto = require('crypto');

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

// Precomputed dummy scrypt hash for constant-time rejection of unknown users
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
const DUMMY_DERIVED = crypto.scryptSync('dummy-timing-shield-value', DUMMY_SALT, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
}).toString('hex');
const DUMMY_HASH = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${DUMMY_SALT}$${DUMMY_DERIVED}`;

/**
 * Hashes a password or access code using Node's built-in crypto.scrypt with a random 16-byte salt
 */
function hashPassword(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') {
        throw new Error('Password must be a non-empty string.');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(plaintext, salt, KEY_LEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P
    }).toString('hex');
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived}`;
}

function isScryptHash(value) {
    return typeof value === 'string' && value.startsWith('scrypt$');
}

/**
 * Verifies a plaintext password/code against an scrypt hash using timingSafeEqual
 */
function verifyPassword(plaintext, storedHash) {
    if (typeof plaintext !== 'string' || !plaintext || !isScryptHash(storedHash)) {
        return false;
    }
    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
        return false;
    }
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = parts[4];
    const expectedHex = parts[5];

    if (!N || !r || !p || !salt || !expectedHex) return false;

    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const actualBuf = crypto.scryptSync(plaintext, salt, expectedBuf.length, { N, r, p });
    if (actualBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

/**
 * Constant-time dummy comparison for non-existent accounts to mitigate timing enumeration
 */
function verifyAgainstDummy(plaintext) {
    return verifyPassword(String(plaintext || 'x'), DUMMY_HASH);
}

/**
 * Generates an unambiguous 8-character one-time patient access code (e.g. K7M9P4X2)
 */
function generateAccessCode(length = 8) {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // Excludes 0, O, 1, I, L
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
}

/**
 * Generates a strong random 14-character temporary password for new staff accounts
 */
function generateTemporaryPassword(length = 14) {
    const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%&*';
    const all = upper + lower + digits + symbols;
    const chars = [
        upper[crypto.randomInt(upper.length)],
        lower[crypto.randomInt(lower.length)],
        digits[crypto.randomInt(digits.length)],
        symbols[crypto.randomInt(symbols.length)]
    ];
    for (let i = chars.length; i < length; i++) {
        chars.push(all[crypto.randomInt(all.length)]);
    }
    // Fisher-Yates shuffle
    for (let i = chars.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
}

module.exports = {
    hashPassword,
    isScryptHash,
    verifyPassword,
    verifyAgainstDummy,
    generateAccessCode,
    generateTemporaryPassword
};
