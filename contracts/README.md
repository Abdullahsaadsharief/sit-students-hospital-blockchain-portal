# SITStudentsHospitalLedger Smart Contract

This directory contains `SITStudentsHospitalLedger.sol`, a Solidity `^0.8.20` smart contract engineered for **SIT Students Hospital** to anchor pseudonymous medical report SHA-256 hashes on an Ethereum-compatible (EVM) blockchain (e.g., **Ethereum Sepolia Testnet**).

## Zero-PII On-Chain Privacy Model
Only pseudonymous metadata and cryptographic fingerprints are stored on-chain:
- `reportId` (e.g. `REP-7A91F2C4`)
- `sourceHash` (SHA-256 of the originally uploaded lab file — prevents re-upload duplicates on-chain)
- `reportHash` (SHA-256 of the encrypted standardized PDF document)
- `storageReference` (opaque encrypted file identifier)
- `reportType`, `patientPseudonym` (`PT-9901`), `departmentNodeId` (`NODE-LAB-01`)

**No patient names, phone numbers, diagnoses, or raw files are ever written to the blockchain.**

## Compiling Locally (Offline)
```bash
node scripts/deploy-contract.js --compile-only
```
This compiles `SITStudentsHospitalLedger.sol` using `solc` and outputs `contracts/SITStudentsHospitalLedger.compiled.json`.

## Deploying to Ethereum Sepolia Testnet
1. Create a free Ethereum Sepolia RPC URL on [Alchemy](https://www.alchemy.com) or [Infura](https://www.infura.io).
2. Create a dedicated MetaMask wallet for testing and fund it with free Sepolia test ETH from a Sepolia faucet.
3. Add these variables to your `.env` file:
   ```env
   BLOCKCHAIN_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY
   BLOCKCHAIN_PRIVATE_KEY=0xYOUR_DEDICATED_TESTNET_PRIVATE_KEY
   BLOCKCHAIN_NETWORK_NAME=Ethereum Sepolia Testnet
   BLOCKCHAIN_EXPLORER_URL=https://sepolia.etherscan.io
   ```
4. Deploy the contract:
   ```bash
   npm run deploy:blockchain
   ```
5. The script automatically compiles the contract, deploys it to Sepolia, prints the Etherscan contract URL, and writes `BLOCKCHAIN_CONTRACT_ADDRESS=0x...` into `.env`.
6. Restart the server (`npm start`). Every newly uploaded lab report is automatically anchored on-chain via `blockchain/ethereumClient.js` AND verified during QR verification (`/api/verify/:reportId`).

## Runtime Fallback Behavior
If `BLOCKCHAIN_RPC_URL` or `BLOCKCHAIN_CONTRACT_ADDRESS` is unset, the server transparently operates in `LOCAL_HASH_CHAIN_FALLBACK` mode using `data/ledger.json` and reports this honestly in `/api/config/public`, `/api/blockchain/ledger`, and the portal UI.
