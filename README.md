# SIT Students Hospital Portal — Hardened Medical Document, Prescription & Blockchain Verification System

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org)
[![Encryption](https://img.shields.io/badge/Encryption-AES--256--GCM-emerald.svg)](#)
[![Blockchain](https://img.shields.io/badge/Blockchain-Ethereum%20EVM%20%2B%20Hash--Chain-blue.svg)](#)

A centralized single-hospital electronic medical document, laboratory report, and doctor prescription management system for **SIT Students Hospital**, featuring **authenticated AES-256-GCM file encryption**, **SHA-256 source-file deduplication**, **revocable time-expiring share links**, **QR anti-forgery verification**, and **live Ethereum EVM smart contract anchoring** (`contracts/SITStudentsHospitalLedger.sol`) with transparent local hash-chain fallback.

---

## Core Security & Clinical Capabilities

1. **Hardened Credential & Patient Onboarding Auth:**
   - Salted `scrypt` password hashing (`crypto.scryptSync` + `timingSafeEqual`) with brute-force lockout protection (`express-rate-limit`).
   - Receptionists register patients and issue a **Bill Number + 8-Character One-Time Access Code** (72-hour expiry, single-use), followed by mandatory personal password creation (`>= 10` characters).
   - No ID-only or bill-number-only login bypasses; Bearer tokens are accepted strictly in the `Authorization` header (never URL query strings).
2. **Strict Role-Based Access Control (RBAC):**
   - **Patient:** Own reports, prescriptions, bills, and revocable share links only.
   - **Doctor:** Clinical reports, timelines, structured medicine prescriptions (validated — no auto-invented defaults), and encrypted prescription document uploads (`POST /api/prescriptions/upload`).
   - **Lab Staff:** Lab test order queue and diagnostic report uploads with magic-byte validation, SHA-256 deduplication (`409 Conflict`), and strict `labRequestId` verification. Zero browsing of unrelated patient records.
   - **Receptionist:** Patient registration, billing PDFs, access-code resets, and helpdesk inquiries only. Blocked (`403`) from all clinical reports, prescriptions, and share links.
   - **Admin:** User enrollment/removal, audit logs, blockchain explorer, AI gateway config, and reason-documented soft-deletion of clinical reports.
3. **Authenticated File Encryption & Tamper Evidence:**
   - All newly uploaded diagnostic reports and prescription attachments are encrypted at rest with **AES-256-GCM** (`utils/cryptoUtils.js`, `HCv2` authenticated format).
   - Public QR verification (`GET /api/verify/:reportId`) confirms document authenticity (`MATCH` / `MISMATCH`) while protecting patient privacy (zero PII disclosed to unauthenticated callers).
4. **Live Ethereum EVM Smart Contract Integration (Sepolia Testnet):**
   - Includes `contracts/SITStudentsHospitalLedger.sol` compiled with `solc` and wired via `ethers` v6 (`blockchain/ethereumClient.js`).
   - Anchors pseudonymous Report IDs, `sourceHash`, and `reportHash` on-chain (zero PII on-chain).
   - When `BLOCKCHAIN_RPC_URL` / `BLOCKCHAIN_CONTRACT_ADDRESS` are not configured, runs transparently in `LOCAL_HASH_CHAIN_FALLBACK` mode (`data/ledger.json`) and displays actual runtime mode honestly in the UI and API.

---

## Quick Start

### 1. Install Dependencies
```bash
npm ci
```

### 2. Generate Secure Environment Secrets (Hardened Mode)
```bash
npm run setup
```
This creates a local `.env` file (never committed to Git) with random 256-bit `JWT_SECRET`, `SHARE_JWT_SECRET`, `ENCRYPTION_KEY`, and a generated non-demo `BOOTSTRAP_ADMIN_PASSWORD`.

### 3. Run the Server
- **Hardened Mode (default — requires real credentials, demo bypasses disabled):**
  ```bash
  npm start
  ```
- **Academic Evaluation Demo Mode (local presentation with synthetic accounts & non-destructive tamper demo):**
  ```powershell
  $env:DEMO_MODE="true"; npm start
  ```
  *(On macOS/Linux: `DEMO_MODE=true npm start`)*

### 4. Connect & Deploy to Ethereum Sepolia Testnet (Real Blockchain)
See [`contracts/README.md`](contracts/README.md) for full details:
1. Add `BLOCKCHAIN_RPC_URL` (Alchemy/Infura Sepolia URL) and `BLOCKCHAIN_PRIVATE_KEY` (funded test wallet) to `.env`.
2. Deploy the Solidity smart contract:
   ```bash
   npm run deploy:blockchain
   ```
3. Restart `npm start` — uploads are now anchored on Ethereum Sepolia and verifiable on Etherscan!

### 5. Migrate Existing Legacy Encrypted Files (Optional)
```bash
npm run migrate:encryption -- --dry-run
npm run migrate:encryption
```

### 6. Run the Automated Security & API Test Suite
```bash
npm test
```

---

## Documentation
- [Route Authorization Matrix](docs/ROUTE_AUTHZ_TABLE.md)
- [Security & Architecture Decisions](docs/SECURITY_DECISIONS.md)
- [Security Remediation Changelog](docs/SECURITY_CHANGES.md)
- [Production Readiness Backlog](docs/SECURITY_BACKLOG.md)
- [Ethereum Smart Contract Deployment Guide](contracts/README.md)
