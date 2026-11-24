const fs = require('fs');
const path = require('path');
const config = require('../config');
const Block = require('./Block');
const { atomicWriteJsonSync } = require('../utils/atomicWrite');
const { cloudPersistence } = require('../utils/cloudPersistence');

/**
 * Tamper-Evident Local Hash-Chain Ledger for Medical Report Anchoring
 * Works standalone as a local hash-chain AND pairs with live Ethereum EVM anchoring via ethereumClient.
 */
class Blockchain {
    constructor() {
        this.chain = [];
        this.difficulty = 2;
        this._suppressCloudSync = false;
        this.tamperSnapshots = new Map(); // Non-destructive backup of blocks modified during DEMO_MODE tamper demo
        this.nodeNodes = [
            { id: 'NODE-HOSP-01', name: 'SIT Hospital - Medicine & Cardio Wing', type: 'Hospital Wing' },
            { id: 'NODE-LAB-01', name: 'SIT Hospital - Central Pathology Lab', type: 'Diagnostic Lab' },
            { id: 'NODE-CLINIC-01', name: 'SIT Hospital - Ortho & Pulmonology Wing', type: 'Specialty Wing' },
            { id: 'NODE-PHARM-01', name: 'SIT Hospital - Reception & Pharmacy Desk', type: 'Front Desk' }
        ];
        this.loadChain();
    }

    get ledgerFilePath() {
        return config.LEDGER_FILE_PATH;
    }

    createGenesisBlock() {
        return new Block(
            0,
            '2026-10-01T00:00:00.000Z',
            {
                message: 'Genesis Block - SIT Students Hospital Internal Document & Lab Ledger Initialized',
                network: 'SIT Students Hospital Record Network v2.0',
                nodes: this.nodeNodes.map(n => n.name)
            },
            '0000000000000000000000000000000000000000000000000000000000000000'
        );
    }

    _hydrateBlocks(parsed) {
        return parsed.map(b => {
            const block = new Block(b.index, b.timestamp, b.data, b.previousHash);
            block.hash = b.hash;
            block.nonce = b.nonce;
            return block;
        });
    }

    /**
     * Loads ledger from disk. Refuses to silently overwrite a corrupted existing ledger;
     * attempts recovery from rolling .bak files before failing.
     */
    loadChain() {
        const filePath = this.ledgerFilePath;
        const dataDir = path.dirname(filePath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    this.chain = this._hydrateBlocks(parsed);
                    return;
                }
                throw new Error('Ledger JSON is empty or not an array');
            } catch (e) {
                console.error('[Blockchain] Primary ledger file corrupt or unreadable:', e.message);
                // Attempt automatic recovery from rolling backups
                for (let i = 1; i <= 5; i++) {
                    const bakPath = `${filePath}.bak.${i}`;
                    if (fs.existsSync(bakPath)) {
                        try {
                            const bakParsed = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
                            if (Array.isArray(bakParsed) && bakParsed.length > 0) {
                                console.warn(`[Blockchain] Recovered ledger from backup ${path.basename(bakPath)}.`);
                                this.chain = this._hydrateBlocks(bakParsed);
                                this.saveChain();
                                return;
                            }
                        } catch (_) {}
                    }
                }
                throw new Error(`[Blockchain] Fatal: Cannot parse ${filePath} and no valid backup exists (${e.message})`);
            }
        }

        // Only initialize a fresh Genesis block when no ledger file exists on disk
        const genesis = this.createGenesisBlock();
        genesis.mineBlock(this.difficulty);
        this.chain = [genesis];
        this.saveChain();
    }

    /**
     * Reloads ledger from disk without triggering an immediate redundant cloud write
     * (used during Firebase Firestore startup hydration).
     */
    reloadFromDisk() {
        this._suppressCloudSync = true;
        try {
            this.loadChain();
        } finally {
            this._suppressCloudSync = false;
        }
    }

    /**
     * Atomically persists chain to disk with rolling backups and schedules cloud sync if configured
     */
    saveChain() {
        atomicWriteJsonSync(this.ledgerFilePath, this.chain, { maxBackups: 5 });
        if (!this._suppressCloudSync) {
            cloudPersistence.scheduleStateSync('ledger', this.chain);
        }
    }

    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }

    /**
     * Mines and appends a new block for a medical report, recording both sourceHash and reportHash
     * plus optional live EVM on-chain anchoring receipt.
     */
    addReportBlock(reportPayload, nodeId = 'NODE-HOSP-01') {
        const latestBlock = this.getLatestBlock();
        const selectedNode = this.nodeNodes.find(n => n.id === nodeId) || this.nodeNodes[0];

        const blockData = {
            reportId: reportPayload.reportId,
            sourceHash: reportPayload.sourceHash || reportPayload.reportHash,
            reportHash: reportPayload.reportHash,
            storageReference: reportPayload.storageReference,
            reportType: reportPayload.reportType,
            testDate: reportPayload.testDate || new Date().toISOString().split('T')[0],
            patientPseudonym: reportPayload.patientPseudonym || 'PT-' + String(reportPayload.patientId || 'ANON').slice(-4),
            institutionNode: selectedNode.name,
            nodeId: selectedNode.id,
            recordedAt: new Date().toISOString()
        };

        if (reportPayload.onChain && reportPayload.onChain.anchoredOnChain) {
            blockData.onChain = {
                network: reportPayload.onChain.network,
                contractAddress: reportPayload.onChain.contractAddress,
                txHash: reportPayload.onChain.txHash,
                ethBlockNumber: reportPayload.onChain.ethBlockNumber,
                explorerTxUrl: reportPayload.onChain.explorerTxUrl
            };
        }

        const newBlock = new Block(
            this.chain.length,
            new Date().toISOString(),
            blockData,
            latestBlock.hash
        );

        newBlock.mineBlock(this.difficulty);
        this.chain.push(newBlock);
        this.saveChain();
        return newBlock;
    }

    /**
     * Finds block matching either sourceHash or reportHash (Duplicate Detection)
     */
    findBlockByHash(sha256Hash) {
        if (!sha256Hash) return null;
        const target = String(sha256Hash).toLowerCase();
        for (let i = 1; i < this.chain.length; i++) {
            const d = this.chain[i].data;
            if (!d) continue;
            if (
                (d.reportHash && String(d.reportHash).toLowerCase() === target) ||
                (d.sourceHash && String(d.sourceHash).toLowerCase() === target)
            ) {
                return this.chain[i];
            }
        }
        return null;
    }

    findBlockBySourceHash(sha256Hash) {
        if (!sha256Hash) return null;
        const target = String(sha256Hash).toLowerCase();
        for (let i = 1; i < this.chain.length; i++) {
            const d = this.chain[i].data;
            if (d && d.sourceHash && String(d.sourceHash).toLowerCase() === target) {
                return this.chain[i];
            }
        }
        return null;
    }

    findBlockByAnyHash(sha256Hash) {
        return this.findBlockByHash(sha256Hash);
    }

    findBlockByReportId(reportId) {
        for (let i = 1; i < this.chain.length; i++) {
            if (this.chain[i].data && this.chain[i].data.reportId === reportId) {
                return this.chain[i];
            }
        }
        return null;
    }

    /**
     * Full chain verification: checks cryptographic linkages and recomputed block hashes
     */
    isChainValid() {
        for (let i = 1; i < this.chain.length; i++) {
            const currentBlock = this.chain[i];
            const previousBlock = this.chain[i - 1];

            if (currentBlock.hash !== currentBlock.calculateHash()) {
                return {
                    isValid: false,
                    error: `Tampering detected at Block #${currentBlock.index}! Recalculated hash does not match block hash.`,
                    brokenBlockIndex: currentBlock.index
                };
            }

            if (currentBlock.previousHash !== previousBlock.hash) {
                return {
                    isValid: false,
                    error: `Broken chain link at Block #${currentBlock.index}! previousHash (${currentBlock.previousHash.slice(0, 16)}...) does not match Block #${previousBlock.index} hash (${previousBlock.hash.slice(0, 16)}...).`,
                    brokenBlockIndex: currentBlock.index
                };
            }
        }
        return { isValid: true };
    }

    /**
     * Non-destructive Tamper Simulation (DEMO_MODE ONLY):
     * Snapshots original block data in memory before altering it so restoreSimulatedTampering()
     * cleanly reverts ONLY the tampered block without resetting or losing any real data.
     */
    simulateTampering(blockIndex, fakeHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') {
        if (blockIndex <= 0 || blockIndex >= this.chain.length) {
            throw new Error('Invalid block index for tamper demonstration');
        }
        const block = this.chain[blockIndex];
        if (!this.tamperSnapshots.has(blockIndex)) {
            this.tamperSnapshots.set(blockIndex, JSON.parse(JSON.stringify(block.data)));
        }
        block.data.reportHash = fakeHash;
        block.data.tampered = true;
        // Keep in-memory simulation without destroying persisted valid ledger on disk
        return block;
    }

    /**
     * Non-destructively restores any blocks altered by simulateTampering()
     */
    restoreSimulatedTampering() {
        let restoredCount = 0;
        for (const [idx, originalData] of this.tamperSnapshots.entries()) {
            if (this.chain[idx]) {
                this.chain[idx].data = JSON.parse(JSON.stringify(originalData));
                restoredCount++;
            }
        }
        this.tamperSnapshots.clear();
        return {
            restoredCount,
            validation: this.isChainValid()
        };
    }

    repairOrReset() {
        return this.restoreSimulatedTampering().validation;
    }
}

const blockchainInstance = new Blockchain();
module.exports = blockchainInstance;
