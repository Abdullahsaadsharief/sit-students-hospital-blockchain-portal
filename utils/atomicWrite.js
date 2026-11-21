const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Atomically writes a binary Buffer to disk via temp file + rename (Windows-safe retry).
 */
function atomicWriteBufferSync(filePath, buffer) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
        fs.writeFileSync(tmpPath, buffer);
        let lastErr = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                fs.renameSync(tmpPath, filePath);
                return;
            } catch (err) {
                lastErr = err;
                if (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EACCES') {
                    throw err;
                }
            }
        }
        throw lastErr;
    } catch (err) {
        try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch (_) {}
        throw err;
    }
}

/**
 * Rotates rolling backups (.bak.1 .. .bak.N) and atomically writes JSON to disk.
 */
function atomicWriteJsonSync(filePath, data, { maxBackups = 5 } = {}) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Rotate existing backups before overwriting target
    if (maxBackups > 0 && fs.existsSync(filePath)) {
        try {
            for (let i = maxBackups; i >= 2; i--) {
                const older = `${filePath}.bak.${i}`;
                const newer = `${filePath}.bak.${i - 1}`;
                if (fs.existsSync(newer)) {
                    fs.copyFileSync(newer, older);
                }
            }
            fs.copyFileSync(filePath, `${filePath}.bak.1`);
        } catch (bakErr) {
            // Backup rotation should never break primary atomic save, but log warning
            console.warn(`[AtomicWrite] Backup rotation warning for ${path.basename(filePath)}:`, bakErr.message);
        }
    }

    const serialized = JSON.stringify(data, null, 2);
    atomicWriteBufferSync(filePath, Buffer.from(serialized, 'utf8'));
}

module.exports = {
    atomicWriteBufferSync,
    atomicWriteJsonSync
};
