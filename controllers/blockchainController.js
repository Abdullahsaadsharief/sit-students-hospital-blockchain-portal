const config = require('../config');
const blockchain = require('../blockchain/Blockchain');
const { ethereumClient } = require('../blockchain/ethereumClient');
const db = require('../models/db');

function getBlockchainLedger(req, res) {
    const chainValidation = blockchain.isChainValid();
    return res.json({
        success: true,
        chainLength: blockchain.chain.length,
        isChainValid: chainValidation.isValid,
        validationDetails: chainValidation,
        ethereum: ethereumClient.getStatus(),
        chain: blockchain.chain,
        nodes: blockchain.nodeNodes
    });
}

function verifyBlockchain(req, res) {
    const result = blockchain.isChainValid();
    db.logAudit(
        'BLOCKCHAIN_INTEGRITY_AUDIT',
        req.user.name,
        `Full local hash-chain integrity verification: ${result.isValid ? 'VALID' : 'BROKEN'}`
    );
    return res.json({
        success: true,
        isValid: result.isValid,
        details: result,
        ethereum: ethereumClient.getStatus()
    });
}

/**
 * DEMO_MODE ONLY: Non-destructive in-memory block tamper simulation
 */
function simulateTamper(req, res) {
    if (!config.DEMO_MODE) {
        return res.status(404).json({ success: false, message: 'Not found.' });
    }
    try {
        const { blockIndex, maliciousHash } = req.body || {};
        const hasExplicitIndex = blockIndex !== undefined && blockIndex !== null && blockIndex !== '';
        const targetIndex = hasExplicitIndex ? Number(blockIndex) : 1;

        if (!Number.isInteger(targetIndex) || targetIndex <= 0 || targetIndex >= blockchain.chain.length) {
            return res.status(400).json({ success: false, message: 'Block index does not exist in chain or cannot tamper Genesis block.' });
        }

        const tamperedBlock = blockchain.simulateTampering(targetIndex, maliciousHash);
        const validation = blockchain.isChainValid();

        db.logAudit(
            'DEMO_BLOCK_TAMPERED',
            req.user.name,
            `Non-destructive tamper simulation injected into Block #${targetIndex} (disk ledger untouched).`
        );

        return res.json({
            success: true,
            tamperedBlockIndex: targetIndex,
            message: `Block #${targetIndex} hash tampered in memory! Chain verification now detects broken integrity.`,
            tamperedBlock,
            validationAfterTampering: validation
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Tamper simulation failed.' });
    }
}

/**
 * DEMO_MODE ONLY: Non-destructively restores only simulated-tamper blocks (NEVER calls db.seedInitialData()!)
 */
function restoreLedger(req, res) {
    if (!config.DEMO_MODE) {
        return res.status(404).json({ success: false, message: 'Not found.' });
    }
    const { restoredCount, validation } = blockchain.restoreSimulatedTampering();
    db.logAudit('DEMO_LEDGER_RESTORED', req.user.name, `Restored ${restoredCount} simulated-tamper block(s) non-destructively.`);
    return res.json({
        success: true,
        restoredCount,
        message: 'Ledger restored from pre-simulation snapshot without modifying database records.',
        isValid: validation.isValid
    });
}

function getSystemStats(req, res) {
    const allReports = db.getAllReports();
    const allUsers = db.getAllUsers();
    const auditLogs = db.getAuditLogs();
    const chainValidation = blockchain.isChainValid();

    const duplicatesPrevented = auditLogs.filter(l => l.action === 'DUPLICATE_REPORT_PREVENTED').length;
    const verifiedChecks = auditLogs.filter(l => l.action === 'ANTI_FORGERY_VERIFICATION').length;

    return res.json({
        success: true,
        stats: {
            totalReports: allReports.length,
            totalBlocks: blockchain.chain.length,
            totalPatients: allUsers.filter(u => u.role === 'Patient').length,
            totalDoctors: allUsers.filter(u => u.role === 'Doctor').length,
            totalLabStaff: allUsers.filter(u => u.role === 'Lab Staff').length,
            activeNodes: blockchain.nodeNodes.length,
            duplicatesPrevented,
            verifiedChecks,
            isBlockchainValid: chainValidation.isValid
        },
        ethereum: ethereumClient.getStatus(),
        nodes: blockchain.nodeNodes
    });
}

function getAuditLogs(req, res) {
    return res.json({
        success: true,
        logs: db.getAuditLogs()
    });
}

module.exports = {
    getBlockchainLedger,
    verifyBlockchain,
    simulateTamper,
    restoreLedger,
    getSystemStats,
    getAuditLogs
};
