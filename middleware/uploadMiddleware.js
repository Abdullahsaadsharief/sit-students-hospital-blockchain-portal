const path = require('path');
const multer = require('multer');

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt']);
const ALLOWED_MIMES = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'text/plain'
]);

const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: {
        fileSize: MAX_UPLOAD_BYTES,
        files: 1
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const mime = String(file.mimetype || '').toLowerCase();

        // Both extension AND MIME type must be allow-listed (magic bytes verified in controller)
        if (ALLOWED_EXTENSIONS.has(ext) && ALLOWED_MIMES.has(mime)) {
            return cb(null, true);
        }

        const err = new Error('Unsupported file type. Only PDF, PNG, JPG, WEBP, and TXT files with matching MIME types are allowed.');
        err.statusCode = 415;
        return cb(err);
    }
});

/**
 * Wraps multer.single(fieldName) so upload errors return structured 413/415/400 JSON instead of 500 HTML.
 */
function singleUpload(fieldName) {
    const mw = upload.single(fieldName);
    return (req, res, next) => {
        mw(req, res, (err) => {
            if (!err) return next();
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(413).json({
                        success: false,
                        message: 'Uploaded file exceeds the 25 MB maximum size limit.'
                    });
                }
                return res.status(400).json({
                    success: false,
                    message: `Upload error: ${err.message}`
                });
            }
            const status = err.statusCode || 415;
            return res.status(status).json({
                success: false,
                message: err.message || 'Unsupported upload format.'
            });
        });
    };
}

upload.singleUpload = singleUpload;
module.exports = upload;
