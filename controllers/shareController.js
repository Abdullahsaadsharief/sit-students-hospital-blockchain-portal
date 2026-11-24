const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../models/db');
const { computeSHA256, decryptBuffer, TamperDetectedError } = require('../utils/cryptoUtils');
const { canShareReport } = require('../utils/access');
const { sanitizeDownloadFilename } = require('../utils/fileValidation');
const { cloudPersistence } = require('../utils/cloudPersistence');

const MIN_SHARE_MINUTES = 1;
const MAX_SHARE_MINUTES = 1440; // 24 hours max

/**
 * Create a time-expiring, revocable share link (Patient own report, Doctor, or Admin ONLY).
 * Receptionist & Lab Staff are rejected with 403 (F-04 / TC-09).
 */
function createExpiringShareLink(req, res) {
    try {
        const user = req.user;
        const { reportId, durationMinutes, recipientDoctor } = req.body || {};

        const report = db.findReportById(reportId);
        if (!report) {
            return res.status(404).json({ success: false, message: 'Report not found.' });
        }

        if (!canShareReport(user, report)) {
            db.logAudit('UNAUTHORIZED_SHARE_BLOCKED', user.name, `Blocked ${user.role} (${user.id}) from creating share link for report ${reportId}`);
            return res.status(403).json({
                success: false,
                message: 'Access denied. You are not authorized to share this medical report.'
            });
        }

        // Strict duration bounds validation: 1..1440 minutes
        const parsedDuration = Number(durationMinutes !== undefined ? durationMinutes : 60);
        if (!Number.isInteger(parsedDuration) || parsedDuration < MIN_SHARE_MINUTES || parsedDuration > MAX_SHARE_MINUTES) {
            return res.status(400).json({
                success: false,
                message: `durationMinutes must be an integer between ${MIN_SHARE_MINUTES} and ${MAX_SHARE_MINUTES} (24 hours max).`
            });
        }

        const expiresInSeconds = parsedDuration * 60;
        const jti = `shr_${crypto.randomBytes(12).toString('hex')}`;

        // Minimal JWT payload: NO patientName, NO notes, NO PII inside the token
        const token = jwt.sign(
            {
                jti,
                reportId: report.reportId
            },
            config.SHARE_JWT_SECRET,
            {
                algorithm: 'HS256',
                expiresIn: expiresInSeconds
            }
        );

        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
        const hostUrl = req.protocol + '://' + req.get('host');
        const shareUrl = `${hostUrl}/shared.html?token=${encodeURIComponent(token)}`;

        const cleanRecipient = typeof recipientDoctor === 'string' && recipientDoctor.trim()
            ? recipientDoctor.trim().slice(0, 120)
            : 'Consulting Specialist';

        // Store ONLY revocable metadata keyed by jti (NEVER store raw JWT token!)
        db.addSharedLink({
            jti,
            reportId: report.reportId,
            patientId: report.patientId,
            reportTitle: report.title,
            recipientDoctor: cleanRecipient,
            createdBy: user.id,
            createdByName: user.name,
            durationMinutes: parsedDuration,
            expiresAt,
            revokedAt: null,
            revokedBy: null,
            createdAt: new Date().toISOString()
        });

        db.logAudit(
            'TIME_EXPIRING_LINK_CREATED',
            user.name,
            `Created revocable share link (${jti}) for ${report.reportId} valid for ${parsedDuration} min(s) (Expires: ${expiresAt})`
        );

        return res.status(201).json({
            success: true,
            message: `Time-expiring share link generated (Valid for ${parsedDuration} minutes).`,
            jti,
            token,
            shareUrl,
            expiresAt,
            durationMinutes: parsedDuration,
            expiresInSeconds
        });
    } catch (err) {
        console.error('[Share Link Error]:', err);
        return res.status(500).json({ success: false, message: 'Failed to create share link.' });
    }
}

/**
 * List share links visible to the authenticated caller (for revocation management UI)
 */
function listShareLinks(req, res) {
    const links = db.getSharedLinksForUser(req.user);
    return res.json({
        success: true,
        count: links.length,
        links
    });
}

/**
 * Immediately revoke a share link by jti (F-13)
 */
function revokeShareLink(req, res) {
    const user = req.user;
    const { jti } = req.params;

    const link = db.findSharedLinkByJti(jti);
    if (!link) {
        return res.status(404).json({ success: false, message: 'Share link record not found.' });
    }

    const canRevoke = (
        user.role === 'Admin' ||
        link.createdBy === user.id ||
        (user.role === 'Patient' && link.patientId === user.id)
    );
    if (!canRevoke) {
        return res.status(403).json({ success: false, message: 'Access denied. You cannot revoke this share link.' });
    }

    const updated = db.revokeSharedLink(jti, user.name);
    db.logAudit('SHARED_LINK_REVOKED', user.name, `Revoked share link ${jti} for report ${link.reportId}`);

    return res.json({
        success: true,
        message: 'Share link immediately revoked.',
        link: updated
    });
}

function _verifyShareTokenAndRecord(token) {
    const decoded = jwt.verify(token, config.SHARE_JWT_SECRET, { algorithms: ['HS256'] });
    const link = db.findSharedLinkByJti(decoded.jti);
    if (!link) {
        return { errorStatus: 403, status: 'REVOKED', message: 'SECURITY ACCESS DENIED: Share link record is no longer active.' };
    }
    if (link.revokedAt) {
        return { errorStatus: 403, status: 'REVOKED', message: 'SECURITY ACCESS DENIED: This secure sharing link has been revoked by the patient or hospital.' };
    }
    const report = db.findReportById(decoded.reportId);
    if (!report) {
        return { errorStatus: 404, status: 'NOT_FOUND', message: 'Referenced medical report is no longer available.' };
    }
    return { decoded, link, report };
}

function getSharedReport(req, res) {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
        return res.status(400).json({ success: false, message: 'No access token provided.' });
    }

    try {
        const result = _verifyShareTokenAndRecord(token);
        if (result.errorStatus) {
            return res.status(result.errorStatus).json({
                success: false,
                status: result.status,
                message: result.message
            });
        }

        const { decoded, link, report } = result;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const remainingSeconds = Math.max(0, decoded.exp - nowSeconds);

        db.logAudit(
            'SHARED_LINK_ACCESSED',
            `External Viewer (${link.recipientDoctor})`,
            `Accessed shared report ${report.reportId} via link ${link.jti}. Time remaining: ${remainingSeconds}s`
        );

        return res.json({
            success: true,
            status: 'VALID',
            remainingSeconds,
            expiresAt: new Date(decoded.exp * 1000).toISOString(),
            report: {
                reportId: report.reportId,
                title: report.title,
                reportType: report.reportType,
                patientName: report.patientName,
                patientPseudonym: report.patientPseudonym,
                testDate: report.testDate,
                notes: report.notes,
                keywords: report.keywords,
                categories: report.categories,
                fileName: report.fileName,
                fileSize: report.fileSize,
                blockIndex: report.blockIndex,
                blockHash: report.blockHash,
                rawSnippet: report.rawSnippet
            },
            context: {
                recipientDoctor: link.recipientDoctor,
                accessContext: 'doctor_consultation_time_limited'
            }
        });
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            db.logAudit('EXPIRED_LINK_ACCESS_REJECTED', 'External Visitor', `Expired share token rejected (Expired at: ${err.expiredAt})`);
            return res.status(403).json({
                success: false,
                status: 'EXPIRED',
                message: 'SECURITY ACCESS DENIED: This secure sharing link has expired.',
                expiredAt: err.expiredAt
            });
        }

        return res.status(401).json({
            success: false,
            status: 'INVALID_TOKEN',
            message: 'SECURITY ACCESS DENIED: Invalid or tampered access token signature.'
        });
    }
}

async function downloadSharedReportFile(req, res) {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
        return res.status(400).json({ success: false, message: 'Missing token.' });
    }

    try {
        const result = _verifyShareTokenAndRecord(token);
        if (result.errorStatus) {
            return res.status(result.errorStatus).json({ success: false, status: result.status, message: result.message });
        }

        const { report } = result;
        const filePath = path.join(config.UPLOADS_DIR, path.basename(report.storageReference));
        if (!fs.existsSync(filePath)) {
            await cloudPersistence.ensureLocalEncryptedFile(report.storageReference);
        }
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: 'Storage file not found.' });
        }

        const encryptedData = fs.readFileSync(filePath);
        let decryptedBuffer;
        try {
            decryptedBuffer = decryptBuffer(encryptedData);
        } catch (decErr) {
            if (decErr instanceof TamperDetectedError || decErr.isTampered) {
                return res.status(400).json({ success: false, tampered: true, message: 'SECURITY ALERT: Encrypted document failed authentication check.' });
            }
            throw decErr;
        }

        const liveHash = computeSHA256(decryptedBuffer);
        if (liveHash !== report.reportHash) {
            return res.status(400).json({ success: false, tampered: true, message: 'SECURITY ALERT: File hash mismatch.' });
        }

        const safeFileName = sanitizeDownloadFilename(report.fileName, `${report.reportId}.pdf`);
        res.setHeader('Content-Type', report.mimeType || 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
        res.setHeader('Content-Length', decryptedBuffer.length);
        return res.send(decryptedBuffer);
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Access Denied: Expired or invalid token.' });
    }
}

module.exports = {
    createExpiringShareLink,
    listShareLinks,
    revokeShareLink,
    getSharedReport,
    downloadSharedReportFile
};
