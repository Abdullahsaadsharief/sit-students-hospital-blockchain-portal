const fs = require('fs');
const path = require('path');
const solc = require('solc');
const { ethers } = require('ethers');
const dotenv = require('dotenv');

dotenv.config();

const CONTRACT_PATH = path.join(__dirname, '..', 'contracts', 'SITStudentsHospitalLedger.sol');
const ARTIFACT_PATH = path.join(__dirname, '..', 'contracts', 'SITStudentsHospitalLedger.compiled.json');
const ENV_PATH = path.join(__dirname, '..', '.env');

function compileContract() {
    const source = fs.readFileSync(CONTRACT_PATH, 'utf8');
    const input = {
        language: 'Solidity',
        sources: {
            'SITStudentsHospitalLedger.sol': { content: source }
        },
        settings: {
            optimizer: { enabled: true, runs: 200 },
            outputSelection: {
                '*': {
                    '*': ['abi', 'evm.bytecode.object']
                }
            }
        }
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    if (output.errors) {
        const fatal = output.errors.filter(e => e.severity === 'error');
        if (fatal.length > 0) {
            throw new Error(fatal.map(e => e.formattedMessage).join('\n'));
        }
    }

    const compiled = output.contracts['SITStudentsHospitalLedger.sol']['SITStudentsHospitalLedger'];
    const artifact = {
        contractName: 'SITStudentsHospitalLedger',
        compiledAt: new Date().toISOString(),
        abi: compiled.abi,
        bytecode: '0x' + compiled.evm.bytecode.object
    };
    fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2), 'utf8');
    return artifact;
}

function updateEnvAddress(contractAddress) {
    if (!fs.existsSync(ENV_PATH)) return;
    let content = fs.readFileSync(ENV_PATH, 'utf8');
    const regex = /^BLOCKCHAIN_CONTRACT_ADDRESS=.*$/m;
    if (regex.test(content)) {
        content = content.replace(regex, `BLOCKCHAIN_CONTRACT_ADDRESS=${contractAddress}`);
    } else {
        content += `\nBLOCKCHAIN_CONTRACT_ADDRESS=${contractAddress}\n`;
    }
    fs.writeFileSync(ENV_PATH, content, 'utf8');
}

async function main() {
    const compileOnly = process.argv.includes('--compile-only');
    console.log('[Blockchain Deploy] Compiling contracts/SITStudentsHospitalLedger.sol with solc...');
    const artifact = compileContract();
    console.log(`[Blockchain Deploy] ✓ Compiled successfully! Saved ABI & bytecode to contracts/SITStudentsHospitalLedger.compiled.json`);

    if (compileOnly) {
        return;
    }

    const rpcUrl = (process.env.BLOCKCHAIN_RPC_URL || '').trim();
    const privateKey = (process.env.BLOCKCHAIN_PRIVATE_KEY || '').trim();
    const networkName = (process.env.BLOCKCHAIN_NETWORK_NAME || 'Ethereum Sepolia Testnet').trim();
    const explorerUrl = (process.env.BLOCKCHAIN_EXPLORER_URL || 'https://sepolia.etherscan.io').trim().replace(/\/+$/, '');

    if (!rpcUrl || !privateKey) {
        console.error('\n[Blockchain Deploy] Missing BLOCKCHAIN_RPC_URL or BLOCKCHAIN_PRIVATE_KEY in .env.');
        console.error('Please add your free Alchemy/Infura Sepolia RPC URL and wallet private key to .env, then run:');
        console.error('  npm run deploy:blockchain\n');
        process.exit(1);
    }

    console.log(`[Blockchain Deploy] Connecting to ${networkName}...`);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const balance = await provider.getBalance(wallet.address);

    console.log(`[Blockchain Deploy] Deployer Address : ${wallet.address}`);
    console.log(`[Blockchain Deploy] Wallet Balance   : ${ethers.formatEther(balance)} ETH`);

    if (balance === 0n) {
        console.error('\n[Blockchain Deploy] Wallet has 0 Sepolia ETH! Claim free test ETH from Google Cloud Web3 Sepolia Faucet first.\n');
        process.exit(1);
    }

    console.log('[Blockchain Deploy] Broadcasting SITStudentsHospitalLedger deployment transaction...');
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const contract = await factory.deploy();
    await contract.waitForDeployment();

    const deployedAddress = await contract.getAddress();
    const deployTx = contract.deploymentTransaction();

    updateEnvAddress(deployedAddress);

    console.log('\n====================================================================');
    console.log(' ✓ SMART CONTRACT DEPLOYED LIVE ON BLOCKCHAIN!');
    console.log('====================================================================');
    console.log(` Network          : ${networkName}`);
    console.log(` Contract Address : ${deployedAddress}`);
    console.log(` Deploy Tx Hash   : ${deployTx ? deployTx.hash : 'N/A'}`);
    console.log(` Explorer Link    : ${explorerUrl}/address/${deployedAddress}`);
    console.log(' Updated .env with BLOCKCHAIN_CONTRACT_ADDRESS automatically.');
    console.log('====================================================================\n');
}

if (require.main === module) {
    main().catch(err => {
        console.error('[Blockchain Deploy Error]:', err.message);
        process.exit(1);
    });
}

module.exports = { compileContract };
