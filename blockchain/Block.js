const crypto = require('crypto');

/**
 * Deterministic canonical JSON serialization (sorts object keys recursively)
 * so identical payloads always hash identically regardless of property insertion order.
 */
function canonicalStringify(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(item => (item === undefined ? 'null' : canonicalStringify(item))).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    const entries = [];
    for (const key of keys) {
        if (value[key] === undefined) continue;
        entries.push(`${JSON.stringify(key)}:${canonicalStringify(value[key])}`);
    }
    return `{${entries.join(',')}}`;
}

/**
 * Block data structure representing an immutable ledger entry
 */
class Block {
    /**
     * @param {number} index - Block height/sequence number
     * @param {string} timestamp - ISO timestamp
     * @param {object} data - Medical report blockchain metadata
     *   - reportId: pseudonymous report identifier (e.g. REP-8F3A29B1)
     *   - reportHash: SHA-256 digest of original diagnostic file
     *   - storageReference: pointer/UUID to off-chain encrypted file
     *   - institutionNode: Node identity (e.g. 'Apex Hospital Node', 'Central Lab Node')
     *   - uploaderRole: 'Doctor' | 'Lab Staff' | 'Hospital Admin'
     *   - metadata: non-sensitive metadata (e.g. reportType, testDate)
     * @param {string} previousHash - SHA-256 hash of the previous block
     */
    constructor(index, timestamp, data, previousHash = '') {
        this.index = index;
        this.timestamp = timestamp;
        this.data = data;
        this.previousHash = previousHash;
        this.nonce = 0;
        this.hash = this.calculateHash();
    }

    /**
     * Calculates canonical SHA-256 cryptographic hash of the block contents
     * @returns {string} Hexadecimal block hash
     */
    calculateHash() {
        const payload = this.index +
            this.previousHash +
            this.timestamp +
            canonicalStringify(this.data) +
            this.nonce;
        return crypto.createHash('sha256').update(payload).digest('hex');
    }

    /**
     * Legacy non-sorted JSON hash retained ONLY for verifying pre-existing persisted blocks
     * mined before canonical JSON serialization was introduced.
     */
    calculateLegacyHash() {
        const payload = this.index +
            this.previousHash +
            this.timestamp +
            JSON.stringify(this.data) +
            this.nonce;
        return crypto.createHash('sha256').update(payload).digest('hex');
    }

    /**
     * Lightweight proof-of-authority / consensus simulation for permissioned nodes
     * @param {number} difficulty 
     */
    mineBlock(difficulty = 2) {
        const target = Array(difficulty + 1).join('0');
        while (this.hash.substring(0, difficulty) !== target) {
            this.nonce++;
            this.hash = this.calculateHash();
        }
    }
}

module.exports = Block;
