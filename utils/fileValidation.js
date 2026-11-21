const path = require('path');

/**
 * Validates file signature (magic bytes) against extension and declared MIME type.
 * Prevents extension/MIME spoofing attacks (F-11).
 */
function validateUploadedFile(file) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
        return { valid: false, status: 400, message: 'Uploaded file is empty or missing.' };
    }

    const buf = file.buffer;
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();

    const isPdfSig = buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-';
    const isPngSig = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;
    const isJpegSig = buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    const isWebpSig = buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';

    // Plain text check: no NUL bytes and predominantly printable UTF-8 characters
    const isPlainTextSig = !buf.includes(0x00) && !isPdfSig && !isPngSig && !isJpegSig && !isWebpSig;

    const rules = {
        '.pdf': { mimes: ['application/pdf'], match: isPdfSig, label: 'PDF' },
        '.png': { mimes: ['image/png'], match: isPngSig, label: 'PNG' },
        '.jpg': { mimes: ['image/jpeg', 'image/jpg'], match: isJpegSig, label: 'JPEG' },
        '.jpeg': { mimes: ['image/jpeg', 'image/jpg'], match: isJpegSig, label: 'JPEG' },
        '.webp': { mimes: ['image/webp'], match: isWebpSig, label: 'WEBP' },
        '.txt': { mimes: ['text/plain'], match: isPlainTextSig, label: 'TXT' }
    };

    const rule = rules[ext];
    if (!rule) {
        return { valid: false, status: 415, message: `Unsupported file extension '${ext || 'none'}'. Allowed: PDF, PNG, JPG, WEBP, TXT.` };
    }

    if (!rule.mimes.includes(mime)) {
        return { valid: false, status: 415, message: `MIME type '${mime}' does not match file extension '${ext}'.` };
    }

    if (!rule.match) {
        return { valid: false, status: 415, message: `File signature (magic bytes) does not match declared ${rule.label} format.` };
    }

    return { valid: true, detectedType: rule.label };
}

/**
 * Sanitizes filenames for safe Content-Disposition headers (prevents header injection / path traversal)
 */
function sanitizeDownloadFilename(name, fallback = 'document.pdf') {
    const base = path.basename(String(name || fallback));
    const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
    return cleaned.slice(0, 120) || fallback;
}

/**
 * Simple in-process concurrency semaphore for capping heavy OCR/PDF jobs
 */
class ConcurrencySemaphore {
    constructor(maxConcurrent = 2) {
        this.maxConcurrent = Math.max(1, maxConcurrent);
        this.active = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.active < this.maxConcurrent) {
            this.active++;
            return;
        }
        await new Promise(resolve => this.queue.push(resolve));
        this.active++;
    }

    release() {
        this.active = Math.max(0, this.active - 1);
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            next();
        }
    }

    async run(fn) {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}

module.exports = {
    validateUploadedFile,
    sanitizeDownloadFilename,
    ConcurrencySemaphore
};
