const fs = require('fs');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const config = require('../config');
const db = require('../models/db');
const blockchain = require('../blockchain/Blockchain');
const { ethereumClient } = require('../blockchain/ethereumClient');
const { computeSHA256, decryptBuffer, TamperDetectedError } = require('../utils/cryptoUtils');
const { canViewReport } = require('../utils/access');

// Non-destructive in-memory tamper simulation flags (DEMO_MODE ONLY — never modifies files on disk!)
const simulatedTamperedReports = new Set();

function getLocalNetworkIp() {
    try {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
    } catch (_) {}
    return 'localhost';
}

/**
 * Authenticated QR Code retrieval for a report (F-02 / F-04)
 */
async function getReportQRCode(req, res) {
    try {
        const { reportId } = req.params;
        const report = db.findReportById(reportId);
        if (!report) {
            return res.status(404).json({ success: false, message: 'Report not found.' });
        }

        if (!canViewReport(req.user, report)) {
            return res.status(403).json({ success: false, message: 'Access denied. You are not authorized to access this report QR.' });
        }

        const port = config.PORT;
        const lanIp = getLocalNetworkIp();
        const hostUrl = req.protocol + '://' + req.get('host');
        const isLocalHostReq = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
        const scanUrl = (isLocalHostReq && lanIp && lanIp !== 'localhost')
            ? `http://${lanIp}:${port}/verify.html?reportId=${encodeURIComponent(reportId)}`
            : `${hostUrl}/verify.html?reportId=${encodeURIComponent(reportId)}`;
        const verificationUrl = `${hostUrl}/verify.html?reportId=${encodeURIComponent(reportId)}`;

        const qrDataUrl = await QRCode.toDataURL(scanUrl, {
            errorCorrectionLevel: 'H',
            margin: 2,
            width: 320,
            color: { dark: '#080d1a', light: '#ffffff' }
        });

        return res.json({
            success: true,
            reportId,
            verificationUrl,
            scanUrl,
            qrCodeDataUrl: qrDataUrl,
            qrDataUrl,
            anchoredHash: report.reportHash,
            reportHash: report.reportHash,
            sourceHash: report.sourceHash || report.reportHash,
            blockIndex: report.blockIndex,
            patientName: report.patientName,
            patientPseudonym: report.patientPseudonym,
            title: report.title,
            testDate: report.testDate,
            reportType: report.reportType,
            onChain: report.onChain || null,
            status: report.status || 'ANCHORED_ON_BLOCKCHAIN'
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Error generating QR code.' });
    }
}

/**
 * Live Anti-Forgery Verification Endpoint (F-02, F-03, F-05, F-09):
 * - Anonymous callers receive ONLY minimal authenticity verdict (zero patient PII or clinical metadata!).
 * - Authorized logged-in viewers (canViewReport) receive full clinical verification metadata.
 * - Catches AES-256-GCM TamperDetectedError cleanly as MISMATCH.
 * - Cross-checks Ethereum EVM smart contract when configured.
 */
async function verifyReportIntegrity(req, res) {
    try {
        const { reportId } = req.params;
        const report = db.findReportById(reportId);
        if (!report) {
            return res.status(404).json({
                success: false,
                status: 'NOT_FOUND',
                message: `Report ID '${reportId}' not found.`
            });
        }

        const block = blockchain.findBlockByReportId(reportId) || blockchain.chain[report.blockIndex];
        if (!block || !block.data) {
            return res.status(404).json({
                success: false,
                status: 'BLOCKCHAIN_RECORD_MISSING',
                message: 'No corresponding ledger anchor found for this report.'
            });
        }

        const anchoredHash = block.data.reportHash || report.reportHash;
        const anchoredSourceHash = block.data.sourceHash || report.sourceHash || anchoredHash;

        let liveHash = null;
        let fileSource = 'Off-Chain Encrypted Storage';
        let isMatch = false;
        let tamperReason = null;

        if (req.file && req.file.buffer) {
            liveHash = computeSHA256(req.file.buffer);
            fileSource = 'Directly Provided File Upload';
            isMatch = (
                liveHash.toLowerCase() === String(anchoredHash).toLowerCase() ||
                liveHash.toLowerCase() === String(anchoredSourceHash).toLowerCase()
            );
        } else if (config.DEMO_MODE && simulatedTamperedReports.has(report.reportId)) {
            // Non-destructive in-memory tamper simulation (files on disk remain 100% untouched)
            liveHash = '0000000000000000000000000000000000000000000000000000000000tamper';
            fileSource = 'Simulated In-Memory Tamper (Demo Mode — Disk Untouched)';
            isMatch = false;
            tamperReason = 'DEMO_MODE non-destructive tamper simulation active for this report.';
        } else {
            const filePath = path.join(config.UPLOADS_DIR, path.basename(report.storageReference));
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({
                    success: false,
                    status: 'STORAGE_FILE_MISSING',
                    message: 'Off-chain encrypted document file is missing.'
                });
            }

            const encryptedData = fs.readFileSync(filePath);
            try {
                const decryptedBuffer = decryptBuffer(encryptedData);
                liveHash = computeSHA256(decryptedBuffer);
                isMatch = (liveHash.toLowerCase() === String(anchoredHash).toLowerCase());
            } catch (decErr) {
                if (decErr instanceof TamperDetectedError || decErr.isTampered) {
                    liveHash = 'DECRYPTION_AUTH_TAG_FAILED';
                    isMatch = false;
                    tamperReason = 'AES-256-GCM authenticated decryption failed — stored ciphertext was modified.';
                } else {
                    throw decErr;
                }
            }
        }

        // Cross-verify against live Ethereum EVM contract if connected
        const onChainVerification = await ethereumClient.verifyReportOnChain(
            report.reportId,
            liveHash && liveHash.length === 64 ? liveHash : anchoredHash
        );
        if (onChainVerification.checkedOnChain && !onChainVerification.onChainAuthentic) {
            isMatch = false;
        }

        const isAuthorizedRichViewer = Boolean(req.user && canViewReport(req.user, report));

        db.logAudit(
            'ANTI_FORGERY_VERIFICATION',
            req.user ? req.user.name : 'Public QR Verifier',
            `Verification check on ${reportId}: ${isMatch ? 'MATCH' : 'MISMATCH'}`
        );

        const verificationMessage = isMatch
            ? 'MATCH: The diagnostic document matches its anchored SHA-256 cryptographic fingerprint.'
            : (tamperReason || 'MISMATCH: Cryptographic fingerprint differs from the anchored record! Document integrity check failed.');

        // Strict public minimal response (F-02): ZERO PII / clinical metadata for unauthenticated callers
        const payload = {
            success: true,
            status: isMatch ? 'MATCH' : 'MISMATCH',
            isAuthentic: isMatch,
            reportId: report.reportId,
            anchoredAt: block.timestamp,
            blockIndex: block.index,
            onChainVerification,
            verificationMessage
        };

        // Include clinical details ONLY if the caller presented a valid Bearer JWT authorized to view this report
        if (isAuthorizedRichViewer) {
            payload.patientName = report.patientName;
            payload.patientPseudonym = report.patientPseudonym;
            payload.reportType = report.reportType;
            payload.testDate = report.testDate;
            payload.fileSource = fileSource;
            payload.liveComputedHash = liveHash;
            payload.anchoredBlockchainHash = anchoredHash;
            payload.blockchainDetails = {
                blockIndex: block.index,
                blockHash: block.hash,
                previousHash: block.previousHash,
                timestamp: block.timestamp,
                institutionNode: block.data.institutionNode,
                onChain: block.data.onChain || report.onChain || null
            };
        }

        return res.json(payload);
    } catch (err) {
        console.error('[Verification Controller Error]:', err);
        return res.status(500).json({ success: false, message: 'Verification error.' });
    }
}

/**
 * DEMO_MODE ONLY: Non-destructive in-memory tamper simulation (never mutates encrypted files on disk!)
 */
function simulateTamperInMemory(req, res) {
    if (!config.DEMO_MODE) {
        return res.status(404).json({ success: false, message: 'Not found.' });
    }
    const { reportId } = req.params;
    const report = db.findReportById(reportId);
    if (!report) {
        return res.status(404).json({ success: false, message: 'Report not found.' });
    }

    simulatedTamperedReports.add(report.reportId);
    db.logAudit('DEMO_TAMPER_SIMULATED_IN_MEMORY', req.user.name, `Activated non-destructive in-memory tamper simulation for ${reportId} (disk file unchanged)`);

    return res.json({
        success: true,
        tampered: true,
        nonDestructive: true,
        reportId: report.reportId,
        message: `Non-destructive tamper simulation activated for ${reportId} (stored encrypted file on disk was NOT modified). Re-run verification to observe MISMATCH.`
    });
}

function resetTamperInMemory(req, res) {
    if (!config.DEMO_MODE) {
        return res.status(404).json({ success: false, message: 'Not found.' });
    }
    const { reportId } = req.params;
    simulatedTamperedReports.delete(reportId);
    db.logAudit('DEMO_TAMPER_SIMULATION_RESET', req.user.name, `Cleared in-memory tamper simulation for ${reportId}`);

    return res.json({
        success: true,
        tampered: false,
        reportId,
        message: `Tamper simulation cleared for ${reportId}.`
    });
}

module.exports = {
    getReportQRCode,
    verifyReportIntegrity,
    simulateTamperInMemory,
    resetTamperInMemory
};
