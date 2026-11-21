const fs = require('fs');
const path = require('path');
const config = require('../config');

let ethersLib = null;
try {
    ethersLib = require('ethers');
} catch (_) {
    ethersLib = null;
}

const CONTRACT_ABI = [
    'function anchorDiagnosticReport(string _reportId, string _sourceHash, string _reportHash, string _storageReference, string _reportType, string _patientPseudonym, string _departmentNodeId) external returns (bool)',
    'function verifyReportIntegrity(string _reportId, string _liveComputedHash) external view returns (bool isAuthentic, string anchoredHash, uint256 anchoredAt)',
    'function isHashAlreadyAnchored(string _hash) external view returns (bool)',
    'function getTotalAnchoredReports() external view returns (uint256)',
    'function hospitalAdmin() external view returns (address)',
    'event ReportAnchored(string indexed reportId, string sourceHash, string reportHash, string patientPseudonym, string departmentNodeId, uint256 timestamp)'
];

class EthereumBlockchainClient {
    constructor() {
        this.provider = null;
        this.wallet = null;
        this.contract = null;
        this.initialized = false;
        this.initError = null;
        this.init();
    }

    init() {
        this.provider = null;
        this.wallet = null;
        this.contract = null;
        this.initialized = false;
        this.initError = null;

        if (!ethersLib) {
            this.initError = 'ethers package not installed';
            return;
        }
        if (!config.BLOCKCHAIN_RPC_URL || !config.BLOCKCHAIN_CONTRACT_ADDRESS) {
            this.initError = 'BLOCKCHAIN_RPC_URL and BLOCKCHAIN_CONTRACT_ADDRESS not set in .env';
            return;
        }

        try {
            this.provider = new ethersLib.JsonRpcProvider(config.BLOCKCHAIN_RPC_URL);
            if (config.BLOCKCHAIN_PRIVATE_KEY) {
                this.wallet = new ethersLib.Wallet(config.BLOCKCHAIN_PRIVATE_KEY, this.provider);
                this.contract = new ethersLib.Contract(config.BLOCKCHAIN_CONTRACT_ADDRESS, CONTRACT_ABI, this.wallet);
            } else {
                // Read-only verification mode
                this.contract = new ethersLib.Contract(config.BLOCKCHAIN_CONTRACT_ADDRESS, CONTRACT_ABI, this.provider);
            }
            this.initialized = true;
        } catch (err) {
            this.initError = err.message;
        }
    }

    isEnabled() {
        return Boolean(this.initialized && this.contract);
    }

    canWrite() {
        return Boolean(this.initialized && this.contract && this.wallet);
    }

    getStatus() {
        return {
            onChainEnabled: this.isEnabled(),
            canWriteOnChain: this.canWrite(),
            networkName: config.BLOCKCHAIN_NETWORK_NAME,
            contractAddress: config.BLOCKCHAIN_CONTRACT_ADDRESS || null,
            explorerUrl: config.BLOCKCHAIN_EXPLORER_URL,
            contractExplorerLink: config.BLOCKCHAIN_CONTRACT_ADDRESS
                ? `${config.BLOCKCHAIN_EXPLORER_URL}/address/${config.BLOCKCHAIN_CONTRACT_ADDRESS}`
                : null,
            mode: this.canWrite()
                ? `LIVE_EVM_ONCHAIN (${config.BLOCKCHAIN_NETWORK_NAME})`
                : this.isEnabled()
                    ? `READ_ONLY_EVM (${config.BLOCKCHAIN_NETWORK_NAME})`
                    : 'LOCAL_HASH_CHAIN_FALLBACK',
            note: this.initError || null
        };
    }

    async isHashAnchoredOnChain(hash) {
        if (!this.isEnabled() || !hash) return null;
        try {
            return Boolean(await this.contract.isHashAlreadyAnchored(hash));
        } catch (err) {
            console.warn('[EthereumClient] On-chain duplicate query failed, falling back to local ledger:', err.message);
            return null;
        }
    }

    async anchorReportOnChain(payload) {
        if (!this.canWrite()) {
            return {
                anchoredOnChain: false,
                reason: this.initError || 'On-chain signer not configured'
            };
        }

        try {
            const tx = await this.contract.anchorDiagnosticReport(
                payload.reportId,
                payload.sourceHash || payload.reportHash,
                payload.reportHash,
                payload.storageReference,
                payload.reportType || 'Diagnostic Report',
                payload.patientPseudonym || 'PT-ANON',
                payload.departmentNodeId || 'NODE-LAB-01'
            );
            const receipt = await tx.wait(1);
            return {
                anchoredOnChain: true,
                network: config.BLOCKCHAIN_NETWORK_NAME,
                contractAddress: config.BLOCKCHAIN_CONTRACT_ADDRESS,
                txHash: receipt.hash || tx.hash,
                ethBlockNumber: receipt.blockNumber,
                explorerTxUrl: `${config.BLOCKCHAIN_EXPLORER_URL}/tx/${receipt.hash || tx.hash}`
            };
        } catch (err) {
            console.warn('[EthereumClient] On-chain anchoring failed:', err.message);
            return {
                anchoredOnChain: false,
                error: err.message
            };
        }
    }

    async verifyReportOnChain(reportId, liveHash) {
        if (!this.isEnabled()) {
            return { checkedOnChain: false };
        }
        try {
            const [isAuthentic, anchoredHash, anchoredAt] = await this.contract.verifyReportIntegrity(reportId, liveHash);
            return {
                checkedOnChain: true,
                onChainAuthentic: Boolean(isAuthentic),
                onChainAnchoredHash: anchoredHash,
                onChainAnchoredAt: Number(anchoredAt) ? new Date(Number(anchoredAt) * 1000).toISOString() : null,
                network: config.BLOCKCHAIN_NETWORK_NAME,
                contractAddress: config.BLOCKCHAIN_CONTRACT_ADDRESS,
                contractExplorerLink: `${config.BLOCKCHAIN_EXPLORER_URL}/address/${config.BLOCKCHAIN_CONTRACT_ADDRESS}`
            };
        } catch (err) {
            return {
                checkedOnChain: false,
                note: 'Report not yet anchored on external EVM contract (verified on local hash-chain).'
            };
        }
    }
}

const ethereumClient = new EthereumBlockchainClient();

module.exports = {
    ethereumClient,
    CONTRACT_ABI
};
