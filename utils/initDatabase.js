const fs = require('fs');
const config = require('../config');
const db = require('../models/db');
const blockchain = require('../blockchain/Blockchain');

async function main() {
    console.log('[Init Database] Generating synthetic demo database & hash-chain...');
    await db.seedInitialData();
    console.log('[Init Database] Database and ledger generated.');
    console.log('[Init Database] Data dir:', config.DATA_DIR);
    console.log('[Init Database] Reports count:', db.getAllReports().length);
    console.log('[Init Database] Blockchain ledger length:', blockchain.chain.length);
    console.log('[Init Database] Blockchain validity check:', blockchain.isChainValid());

    const files = fs.readdirSync(config.UPLOADS_DIR);
    console.log('[Init Database] Encrypted files in uploads directory:', files.length);

    process.exit(0);
}

main().catch(err => {
    console.error('[Init Database] Error:', err);
    process.exit(1);
});
