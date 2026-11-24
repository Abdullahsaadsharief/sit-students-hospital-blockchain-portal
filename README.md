# SIT Students Hospital Portal — Hardened Medical Document, Prescription & Blockchain Verification System

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org)
[![Encryption](https://img.shields.io/badge/Encryption-AES--256--GCM-emerald.svg)](#)
[![Blockchain](https://img.shields.io/badge/Blockchain-Ethereum%20Sepolia%20Live-blue.svg)](https://sepolia.etherscan.io/address/0xE37266F644210b73d25b281866533a6E922F9Ea5)
[![Persistence](https://img.shields.io/badge/Persistence-Firebase%20Firestore-orange.svg)](#)
[![Live Demo](https://img.shields.io/badge/Live%20Site-Render-0d9488.svg)](https://sit-students-hospital-portal.onrender.com/)

A centralized single-hospital electronic medical document, laboratory report, and doctor prescription management system for **SIT Students Hospital**, featuring **authenticated AES-256-GCM file encryption**, **SHA-256 source-file deduplication**, **revocable time-expiring share links**, **QR anti-forgery verification**, **Firebase Firestore persistent cloud storage**, **de-identified Google Gemini 3.x clinical summarization** (with offline NLP fallback), and **live Ethereum Sepolia smart contract anchoring** (`contracts/SITStudentsHospitalLedger.sol`).

---

## Live Deployment & Verification Links

| Service | Live URL |
| --- | --- |
| **Main Hospital Website** | https://sit-students-hospital-portal.onrender.com/ |
| **Staff & Patient Portal Login** | https://sit-students-hospital-portal.onrender.com/portal |
| **Reception & Billing Desk** | https://sit-students-hospital-portal.onrender.com/reception |
| **Public QR / Report Integrity Verifier** | https://sit-students-hospital-portal.onrender.com/verify.html |
| **Live System Health & Mode Check** | https://sit-students-hospital-portal.onrender.com/healthz |
| **Public Runtime Config (Blockchain & Storage)** | https://sit-students-hospital-portal.onrender.com/api/config/public |
| **Ethereum Sepolia Smart Contract (Etherscan)** | https://sepolia.etherscan.io/address/0xE37266F644210b73d25b281866533a6E922F9Ea5 |

> **Deployed Smart Contract:** `0xE37266F644210b73d25b281866533a6E922F9Ea5` (Ethereum Sepolia Testnet)  
> **Cloud Persistence:** Firebase Firestore (`sit-students-hospital`) — persists database, local hash-chain ledger, and AES-256-GCM encrypted report/prescription files across Render restarts and sleeps.

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
5. **Firebase Cloud Persistence & De-identified Clinical AI:**
   - `utils/cloudPersistence.js` synchronizes `database.json`, `ledger.json`, and encrypted `.bin` files to Firebase Firestore (Spark Free Tier compatible via gzip + safe chunking, with automatic startup hydration guard and optional `FIREBASE_STORAGE_BUCKET` support).
   - `utils/aiSummarizer.js` supports live de-identified **Google Gemini 3.x Flash** (`gemini-3.8-flash` / `gemini-3.5-flash-lite`) clinical summarization with built-in local offline NLP fallback.

---

## Live Demo & Judge Evaluation Cheat Sheet

> **Synthetic Demo Notice:** The credentials below are **synthetic evaluation accounts** enabled only when `DEMO_MODE=true`. In hardened production mode (`DEMO_MODE=false`), all demo accounts and one-click login buttons are disabled (`404`), and newly registered accounts always use unique temporary passwords or 8-character single-use access codes.

### 1. Hospital Admin
| Field | Value |
| --- | --- |
| **Name** | Hospital IT Admin |
| **Email** | `admin@sithospital.org` |
| **Password** | `<Your BOOTSTRAP_ADMIN_PASSWORD set in Render / .env>` *(One-click **Hospital IT Admin** demo button also works on `/portal`)* |

### 2. Receptionist (Front Desk & Billing)
| Field | Value |
| --- | --- |
| **Name** | Priya Nair |
| **Email** | `reception@sithospital.org` |
| **Password** | `password123` *(Login at `/reception` or `/portal` — one-click demo button also available)* |

### 3. Lab Staff (Diagnostic Report Upload & Blockchain Anchoring)
| Field | Value |
| --- | --- |
| **Name** | Alex Smith (Central Pathology Lab) |
| **Email** | `alex.lab@sithospital.org` |
| **Password** | `password123` |

### 4. Doctors (Cross-Departmental View & Prescriptions)
| Department | Name | Email | Password |
| --- | --- | --- | --- |
| Cardiology & General Medicine | Dr. Sarah Rao | `dr.sarah@sithospital.org` | `password123` |
| Orthopedics & Trauma | Dr. Rajesh Nair | `dr.rajesh@sithospital.org` | `password123` |
| Pulmonology & Respiratory Care | Dr. Ananya Sen | `dr.ananya@sithospital.org` | `password123` |
| Neurology & Spine Care | Dr. Vikram Mehta | `dr.vikram@sithospital.org` | `password123` |

### 5. Patients *(Can sign in with Email, Bill Number, OR UHID + Password)*
| Patient | Bill Number | UHID | Email | Password |
| --- | --- | --- | --- | --- |
| John Doe | `BILL-2026-1001` | `PT-9901` | `john.doe@sit.ac.in` | `password123` |
| Meera Patel | `BILL-2026-1002` | `PT-9902` | `meera.patel@sit.ac.in` | `password123` |
| Robert Chen | `BILL-2026-1003` | `PT-9903` | `robert.chen@sit.ac.in` | `password123` |
| Ayesha Khan | `BILL-2026-1004` | `PT-9904` | `ayesha.khan@sit.ac.in` | `password123` |
| Sandeep R | `BILL-2026-1006` | `PT-9906` | `sandeep.r.1006@sit.ac.in` | `password123` |

### Sample Report IDs for Quick QR / Integrity Verification (`/verify.html`)
| Report ID | Patient & Investigation | Blockchain Proof |
| --- | --- | --- |
| `REP-27A32017` | Ayesha Khan — Complete Blood Count (CBC) & Absolute Eosinophil Count (`LABREQ-202`) | [Verify Live](https://sit-students-hospital-portal.onrender.com/verify.html?reportId=REP-27A32017) • [Sepolia TX](https://sepolia.etherscan.io/tx/0x587afffbeb5e0948b68323b36ad856d08d07c658d01c36b95ec1b53083766598) |
| `REP-3FABE924` | John Doe — Fasting & Postprandial Blood Glucose Follow-up (`LABREQ-201`) | [Verify Live](https://sit-students-hospital-portal.onrender.com/verify.html?reportId=REP-3FABE924) • [Sepolia TX](https://sepolia.etherscan.io/tx/0xfda1422d5af41d60bb6a835c7d8d7b08601400afd2a576ee4153058205f3af9b) |
| `REP-7A91F2C4` | John Doe — Blood Glucose & HbA1c *(Pre-seeded)* | [Verify Live](https://sit-students-hospital-portal.onrender.com/verify.html?reportId=REP-7A91F2C4) |
| `REP-8D44B190` | John Doe — Lumbosacral Spine X-Ray *(Pre-seeded)* | [Verify Live](https://sit-students-hospital-portal.onrender.com/verify.html?reportId=REP-8D44B190) |
| `REP-3C55A701` | Meera Patel — Lipid Panel *(Pre-seeded)* | [Verify Live](https://sit-students-hospital-portal.onrender.com/verify.html?reportId=REP-3C55A701) |
| `REP-2D44C119` | Ayesha Khan — Spirometry *(Pre-seeded)* | [Verify Live](https://sit-students-hospital-portal.onrender.com/verify.html?reportId=REP-2D44C119) |

### Recommended Live Security Walkthrough for Judges / Viva
1. **Secure Patient Onboarding:** Register a new patient at `/reception` → Reception generates a unique Bill Number + **8-character One-Time Access Code** (valid 72h, never `password123`).
2. **Mandatory Personal Password Setup:** Sign in as that new patient with Bill Number + Access Code → the portal enforces setting a personal `>= 10`-character password immediately and invalidates the single-use code.
3. **Real Ethereum Anchoring & Duplicate Rejection:** Sign in as Lab Staff (`alex.lab@sithospital.org`) → upload a fresh PDF/JPG report → confirm the live Ethereum Sepolia transaction on [Etherscan](https://sepolia.etherscan.io/address/0xE37266F644210b73d25b281866533a6E922F9Ea5), then re-upload the exact same file to demonstrate **`HTTP 409 Conflict` SHA-256 duplicate prevention**.
4. **Live On-Chain Ledger & Cloud Persistence:** Sign in as Admin → open **Hospital Ledger** to show **`LIVE_EVM_ONCHAIN (Ethereum Sepolia Testnet)`** + clickable Etherscan TX links, and open `/healthz` to show **`FIREBASE_FIRESTORE_PERSISTENT`** active.

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
- **Academic Evaluation Demo Mode (local presentation with one-click demo buttons & non-destructive tamper demo):**
  ```bash
  npm run start:demo
  ```

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

### 6. Run the Automated Security, API & Cloud Persistence Test Suite (46 Tests)
```bash
npm test
```

---

## Project Team (Dept. of CSE, SIT Tumakuru)
- **Abdullah Saad Sharief** (`1SI24CS003`)
- **Harsh Kumar Singh** (`1SI24CS064`)
- **H Abhishek** (`1SI25CS404`)
- **Project Guide:** Mrs. Nidhi L. G., Assistant Professor, Dept. of CSE, Siddaganga Institute of Technology

---

## Documentation
- [Route Authorization Matrix](docs/ROUTE_AUTHZ_TABLE.md)
- [Security & Architecture Decisions](docs/SECURITY_DECISIONS.md)
- [Security Remediation Changelog](docs/SECURITY_CHANGES.md)
- [Production Readiness Backlog](docs/SECURITY_BACKLOG.md)
- [Ethereum Smart Contract Deployment Guide](contracts/README.md)
