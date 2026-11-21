const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { isV2Encrypted, decryptBuffer, encryptBuffer, computeSHA256 } = require('../utils/cryptoUtils');

function migrateEncryption({ dryRun = false, dataDir = config.DATA_DIR, uploadsDir = config.UPLOADS_DIR } = {}) {
    const dbPath = path.join(dataDir, 'database.json');
    if (!fs.existsSync(dbPath)) {
        throw new Error(`Database file not found at ${dbPath}`);
    }

    const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const reports = Array.isArray(dbData.reports) ? dbData.reports : [];

    const summary = {
        dryRun,
        totalReports: reports.length,
        alreadyV2: 0,
        migrated: 0,
        missing: 0,
        hashMismatch: 0,
        errors: []
    };

    for (const rep of reports) {
        if (!rep.storageReference) continue;
        const filePath = path.join(uploadsDir, path.basename(rep.storageReference));
        if (!fs.existsSync(filePath)) {
            summary.missing++;
            summary.errors.push(`${rep.reportId}: file missing (${rep.storageReference})`);
            continue;
        }

        const rawEnc = fs.readFileSync(filePath);
        if (isV2Encrypted(rawEnc)) {
            summary.alreadyV2++;
            continue;
        }

        try {
            const plaintext = decryptBuffer(rawEnc);
            const liveHash = computeSHA256(plaintext);
            if (rep.reportHash && liveHash.toLowerCase() !== String(rep.reportHash).toLowerCase()) {
                summary.hashMismatch++;
                summary.errors.push(`${rep.reportId}: SHA-256 mismatch before migration (refused to overwrite)`);
                continue;
            }

            if (!dryRun) {
                const v2Buffer = encryptBuffer(plaintext);
                const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
                fs.writeFileSync(tmpPath, v2Buffer);
                fs.renameSync(tmpPath, filePath);
            }
            summary.migrated++;
        } catch (err) {
            summary.errors.push(`${rep.reportId}: ${err.message}`);
        }
    }

    return summary;
}

if (require.main === module) {
    const dryRun = process.argv.includes('--dry-run');
    const summary = migrateEncryption({ dryRun });
    console.log('[migrate-encryption] Summary:', JSON.stringify(summary, null, 2));
    if (summary.hashMismatch > 0 || summary.errors.length > 0) {
        process.exit(1);
    }
}

module.exports = { migrateEncryption };
