const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

const ROOT_DIR = __dirname;

const REJECTED_DEFAULT_SECRETS = new Set([
    'med-blockchain-jwt-super-secret-key-2026',
    'med-blockchain-share-link-secret-key-2026',
    'med-blockchain-sec-key-32bytes!',
    'password123',
    'changeme',
    'secret'
]);

const LEGACY_CBC_DEFAULT_KEY = 'med-blockchain-sec-key-32bytes!';

const NODE_ENV = (process.env.NODE_ENV || 'development').trim();
const DEMO_MODE = String(process.env.DEMO_MODE || 'false').toLowerCase() === 'true';
const ALLOW_PUBLIC_DEMO = String(process.env.ALLOW_PUBLIC_DEMO || 'false').toLowerCase() === 'true';
const AI_EXTERNAL_PROCESSING = String(process.env.AI_EXTERNAL_PROCESSING || 'false').toLowerCase() === 'true';

// Refuse unsafe production + demo combination unless explicitly acknowledged
if (NODE_ENV === 'production' && DEMO_MODE && !ALLOW_PUBLIC_DEMO) {
    console.error('[FATAL CONFIG] Refusing to start: NODE_ENV=production with DEMO_MODE=true requires ALLOW_PUBLIC_DEMO=true (synthetic demo data only).');
    process.exit(1);
}

if (NODE_ENV === 'production' && DEMO_MODE && ALLOW_PUBLIC_DEMO) {
    console.warn('====================================================================');
    console.warn(' ⚠️  PUBLIC DEMO MODE ACTIVE — SYNTHETIC DATA ONLY (NO REAL PATIENTS)');
    console.warn('====================================================================');
}

function parseEncryptionKey(rawKey) {
    if (!rawKey || typeof rawKey !== 'string') return null;
    const trimmed = rawKey.trim();
    if (REJECTED_DEFAULT_SECRETS.has(trimmed)) return null;

    // 64 hex chars => 32 bytes
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return Buffer.from(trimmed, 'hex');
    }
    // Base64 decoding to 32 bytes
    try {
        const buf = Buffer.from(trimmed, 'base64');
        if (buf.length === 32 && buf.toString('base64').replace(/=+$/, '') === trimmed.replace(/=+$/, '')) {
            return buf;
        }
    } catch (_) {}
    return null;
}

function validateJwtSecret(name, value) {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed.length < 32) return null;
    if (REJECTED_DEFAULT_SECRETS.has(trimmed)) return null;
    return trimmed;
}

let JWT_SECRET = validateJwtSecret('JWT_SECRET', process.env.JWT_SECRET);
let SHARE_JWT_SECRET = validateJwtSecret('SHARE_JWT_SECRET', process.env.SHARE_JWT_SECRET);
let ENCRYPTION_KEY_BUF = parseEncryptionKey(process.env.ENCRYPTION_KEY);

const configErrors = [];

if (!JWT_SECRET) {
    if (DEMO_MODE) {
        JWT_SECRET = crypto.randomBytes(32).toString('hex');
        console.warn('[CONFIG WARNING] DEMO_MODE=true: Using ephemeral random JWT_SECRET for this session.');
    } else {
        configErrors.push('JWT_SECRET must be set (>= 32 chars, not a known default). Run "npm run setup" to generate .env.');
    }
}

if (!SHARE_JWT_SECRET) {
    if (DEMO_MODE) {
        SHARE_JWT_SECRET = crypto.randomBytes(32).toString('hex');
        console.warn('[CONFIG WARNING] DEMO_MODE=true: Using ephemeral random SHARE_JWT_SECRET for this session.');
    } else {
        configErrors.push('SHARE_JWT_SECRET must be set (>= 32 chars, distinct from JWT_SECRET, not a known default). Run "npm run setup".');
    }
}

if (JWT_SECRET && SHARE_JWT_SECRET && JWT_SECRET === SHARE_JWT_SECRET) {
    configErrors.push('JWT_SECRET and SHARE_JWT_SECRET must be different secrets.');
}

if (!ENCRYPTION_KEY_BUF) {
    if (DEMO_MODE) {
        ENCRYPTION_KEY_BUF = crypto.createHash('sha256').update(LEGACY_CBC_DEFAULT_KEY).digest();
        console.warn('[CONFIG WARNING] DEMO_MODE=true: Using demo fallback ENCRYPTION_KEY. Do NOT use with real patient data.');
    } else {
        configErrors.push('ENCRYPTION_KEY must be set to 32 random bytes (64 hex chars or base64). Run "npm run setup".');
    }
}

if (configErrors.length > 0) {
    console.error('\n[FATAL CONFIGURATION ERROR] Refusing to start server with missing or weak secrets:');
    configErrors.forEach(err => console.error(`  - ${err}`));
    console.error('\nRun "npm run setup" to generate a secure .env file, or set DEMO_MODE=true for local academic demo.\n');
    process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(ROOT_DIR, 'data');

const UPLOADS_DIR = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(ROOT_DIR, 'uploads');

const LEGACY_ENCRYPTION_KEY = process.env.LEGACY_ENCRYPTION_KEY || LEGACY_CBC_DEFAULT_KEY;

const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const TRUST_PROXY = process.env.TRUST_PROXY === 'true'
    ? true
    : (process.env.TRUST_PROXY && !Number.isNaN(Number(process.env.TRUST_PROXY))
        ? Number(process.env.TRUST_PROXY)
        : false);

const config = {
    ROOT_DIR,
    NODE_ENV,
    PORT: Number(process.env.PORT) || 3000,
    DEMO_MODE,
    ALLOW_PUBLIC_DEMO,
    AI_EXTERNAL_PROCESSING,
    DATA_DIR,
    UPLOADS_DIR,
    DB_FILE_PATH: path.join(DATA_DIR, 'database.json'),
    LEDGER_FILE_PATH: path.join(DATA_DIR, 'ledger.json'),
    JWT_SECRET,
    SHARE_JWT_SECRET,
    ENCRYPTION_KEY_BUF,
    LEGACY_ENCRYPTION_KEY,
    REJECTED_DEFAULT_SECRETS,
    CORS_ORIGINS,
    TRUST_PROXY,

    // Bootstrap Admin (required when DEMO_MODE=false and no non-demo admin exists)
    BOOTSTRAP_ADMIN_EMAIL: (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase(),
    BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD || '',

    // Real EVM Blockchain Configuration (Ethereum Sepolia / Local Hardhat / Polygon Amoy)
    BLOCKCHAIN_RPC_URL: (process.env.BLOCKCHAIN_RPC_URL || '').trim(),
    BLOCKCHAIN_PRIVATE_KEY: (process.env.BLOCKCHAIN_PRIVATE_KEY || '').trim(),
    BLOCKCHAIN_CONTRACT_ADDRESS: (process.env.BLOCKCHAIN_CONTRACT_ADDRESS || '').trim(),
    BLOCKCHAIN_NETWORK_NAME: (process.env.BLOCKCHAIN_NETWORK_NAME || 'Ethereum Sepolia Testnet').trim(),
    BLOCKCHAIN_EXPLORER_URL: (process.env.BLOCKCHAIN_EXPLORER_URL || 'https://sepolia.etherscan.io').trim().replace(/\/+$/, ''),

    // Firebase Cloud Persistence (Free Spark Firestore + Optional Blaze Cloud Storage)
    FIREBASE_SERVICE_ACCOUNT_BASE64: (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '').trim(),
    FIREBASE_SERVICE_ACCOUNT_JSON: (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim(),
    FIREBASE_SERVICE_ACCOUNT_PATH: (process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim(),
    FIREBASE_STORAGE_BUCKET: (process.env.FIREBASE_STORAGE_BUCKET || '').trim(),

    // Rate limiting & concurrency controls (overridable via env for tests)
    LOGIN_RATE_LIMIT_MAX: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
    LOGIN_RATE_LIMIT_WINDOW_MS: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    INQUIRY_RATE_LIMIT_MAX: Number(process.env.INQUIRY_RATE_LIMIT_MAX) || 5,
    INQUIRY_RATE_LIMIT_WINDOW_MS: Number(process.env.INQUIRY_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000,
    VERIFY_RATE_LIMIT_MAX: Number(process.env.VERIFY_RATE_LIMIT_MAX) || 60,
    VERIFY_RATE_LIMIT_WINDOW_MS: Number(process.env.VERIFY_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    UPLOAD_RATE_LIMIT_MAX: Number(process.env.UPLOAD_RATE_LIMIT_MAX) || 30,
    UPLOAD_RATE_LIMIT_WINDOW_MS: Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    MAX_CONCURRENT_OCR_JOBS: Number(process.env.MAX_CONCURRENT_OCR_JOBS) || 2
};

module.exports = config;
