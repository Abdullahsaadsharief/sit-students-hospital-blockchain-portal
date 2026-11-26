# SIT Students Hospital Portal — Continuation Project Report (Part 2)

> **Continuation of Previous Project Report:** Direct continuation of [SIT_Students_Hospital_Project_Report.pdf](./SIT_Students_Hospital_Project_Report.pdf) (Commit `c7ee8f8`, November 25, 2026) covering all post-deployment clinical fixes, UI refinements, adversarial bug testing, and security remediations completed after live Render & Ethereum Sepolia deployment.

---

## Document Metadata & Role Attribution

| Field | Details |
| :--- | :--- |
| **Institution** | Siddaganga Institute of Technology (SIT), Tumakuru — Dept. of CSE (5th Semester Mini Project) |
| **Continuation Scope** | Post-commit `c7ee8f8` (`788412a` -> `2130a37`, November 25 – November 26, 2026) |
| **Continuation Development, Clinical Fixes & Bug Remediation** | **Abdullah Saad Sharief (`1SI24CS003`)** |
| **Bug Testing & Adversarial Security QA** | **Harsh Kumar Singh (`1SI24CS064`)** — Designed & executed the 25-case Jenkins Adversarial Bug-Hunter Pipeline (`BUG-001`–`BUG-025`) |
| **Project Team** | Abdullah Saad Sharief (`1SI24CS003`), Harsh Kumar Singh (`1SI24CS064`), H Abhishek (`1SI25CS404`) |
| **Faculty Supervision** | Project Guide: Mrs. Nidhi L. G. (Asst. Prof., Dept. of CSE, SIT) \| Panel Convener: Dr. R. Sumathi |
| **Live Production URL** | https://sit-students-hospital-portal.onrender.com/ |
| **Ethereum Sepolia Contract** | `0xE37266F644210b73d25b281866533a6E922F9Ea5` |
| **GitHub Repository** | https://github.com/Abdullahsaadsharief/sit-students-hospital-blockchain-portal |

---

## 1. Continuation Executive Summary (Post-Deployment Phase 8 & 9)

Following commit `c7ee8f8` (when the original 8-page Comprehensive Project Development Report was generated and the application was live on Render, Ethereum Sepolia Testnet, and Firebase Firestore), two major post-deployment engineering milestones were completed:

1. **Post-Launch Clinical Usability, Cloud Persistence & UI Refinements (Commits `788412a` – `8d3ff5f`, Nov 25, 2026) — Authored by Abdullah Saad Sharief (`1SI24CS003`):**
   - Added safe Lab Test Orders Queue removal (`DELETE /api/lab-requests/:requestId`) with 3-layer mis-click/double-click protection and duplicate pending lab order prevention.
   - Overhauled Prescription PDF download reliability (60-second Blob keep-alive, toast/spinner feedback, inline `#prescriptionPdfModal` preview/print modal, and non-overlapping dynamic PDFKit layout).
   - Implemented permanent **AES-256-GCM encrypted Gemini API key persistence** inside Firebase Firestore (`utils/aiConfigStore.js`) so Admin-configured AI keys survive Render restarts/redeploys.
   - Enhanced `/portal` login navigation by making the SIT Students Hospital logo link directly back to `/` and adding a dedicated **Receptionist Sign-In** tab beside Patient sign-in.
   - Designed and integrated custom SIT Students Hospital SVG and ICO browser tab favicons (`public/favicon.svg`, `public/favicon.ico`) across all 9 HTML pages.

2. **Adversarial Bug Testing by Harsh Kumar Singh (`1SI24CS064`) & Complete 20-Bug Security Remediation by Abdullah Saad Sharief (`1SI24CS003`) (Commit `2130a37`, Nov 26, 2026):**
   - **Bug Testing by Harsh Kumar Singh (`1SI24CS064`):** Built and ran a 25-case Jenkins CI Adversarial Bug-Hunter Pipeline (`sit-hospital-bug-hunter`, `BUG-001` through `BUG-025`) targeting cryptographic bypasses, authentication edge cases, input type coercion, audit logging gaps, blockchain Genesis & PoW verification, Solidity smart contract guards, async upload race conditions, Express 5 dot-path routing, and a **Critical** malformed-PNG OCR server-crash DoS vulnerability.
   - **Baseline Result (Bug Discovery):** `5 / 25 PASS`, `20 / 25 FAIL` (exposing 20 confirmed defects: 1 Critical, 2 High, 14 Medium, 3 Low).
   - **Complete Remediation (Abdullah Saad Sharief, `1SI24CS003`):** Patched all 20 defects across 12 files (`285 insertions, 62 deletions`) while engineering full backwards compatibility for existing live Firebase Firestore ledger blocks and deployed Sepolia smart contract ABIs — ensuring zero UI regressions.
   - **Verified Post-Fix Results:** **25 / 25** Adversarial Bug-Hunter Tests PASS (`100%`), **49 / 49** Project Automated Tests (`npm test`) PASS (`100%`), and Live Render verification confirmed **15 / 15** live Firebase blockchain blocks remain `isChainValid: true`.

---

## 2. Chronological Commit Log Since Previous PDF (`c7ee8f8..2130a37`)

| Commit | Date | Scope & Files | Author / Attribution | Summary of Changes |
| :--- | :--- | :--- | :--- | :--- |
| `788412a` | 2026-11-25 | 6 files (+226 / -17) | Abdullah Saad Sharief (`1SI24CS003`) | Safe Lab Test Orders Queue removal (`DELETE /api/lab-requests/:requestId`) with 3-layer mis-click/double-click protection, duplicate pending order guard, RBAC route table update, and regression tests. |
| `eff049d` | 2026-11-25 | 10 files (+728 / -147) | Abdullah Saad Sharief (`1SI24CS003`) | Reliable Prescription PDF download + inline preview/print modal (`#prescriptionPdfModal`), dynamic non-overlapping PDFKit prescription layout, and encrypted Firebase Firestore Gemini API key store (`utils/aiConfigStore.js`) with unit tests. |
| `fd0b518` | 2026-11-25 | 2 files (+33 / -6) | Abdullah Saad Sharief (`1SI24CS003`) | Wired `savePersistedAiConfig` hook in `controllers/adminController.js` and added persistent cloud-saved status badge in the Admin AI Gateway UI. |
| `cbcd52b` | 2026-11-25 | 2 files (+89 / -3) | Abdullah Saad Sharief (`1SI24CS003`) | Linked `/portal` login brand logo directly to homepage (`/`) and added dedicated Receptionist Sign-In tab beside Patient Sign-In. |
| `8d3ff5f` | 2026-11-25 | 11 files (+46 / -0) | Abdullah Saad Sharief (`1SI24CS003`) | Added custom SIT Students Hospital `public/favicon.svg` and `public/favicon.ico` and linked across all 9 HTML pages to replace the default browser globe icon. |
| `2130a37` | 2026-11-26 | 12 files (+285 / -62) | Testing: Harsh Kumar Singh (`1SI24CS064`)<br>Fixes: Abdullah Saad Sharief (`1SI24CS003`) | Patched all 20 failing adversarial bug-hunter findings (`BUG-001`–`BUG-025`) across crypto, auth, share links, blockchain PoW/Genesis/canonical hashing, Solidity guards, TOCTOU upload race, Express dot-paths, license alignment, and Tesseract OCR DoS protection. |

---

## 3. Detailed Breakdown of Post-Launch Clinical & UI Fixes (`788412a`–`8d3ff5f`)

### 3.1 Safe Lab Test Orders Queue Removal & Duplicate Order Guard (`788412a`)
- **Problem Observed Live:** During live clinical walkthroughs, duplicate `PENDING_UPLOAD` lab orders (e.g., `LABREQ-864775` and `LABREQ-759691` for Rohan Kulkarni's Complete Blood Count) accumulated in the Lab Staff queue with no safe way for staff to cancel redundant pending requests.
- **Solution Built:**
  - Added `DELETE /api/lab-requests/:requestId` restricted to `Doctor`, `Lab Staff`, `Receptionist`, and `Admin` — strictly allowing removal of `PENDING_UPLOAD` orders while permanently blocking deletion of `COMPLETED` / blockchain-anchored reports (HTTP `409`).
  - Built **3-layer mis-click & double-click protection** in `public/js/app.js`: (1) two-step confirmation UI (`Remove` -> `Confirm Remove?`), (2) 700 ms anti-double-click cooldown arming delay so an accidental rapid double-click can never trigger confirmation, and (3) in-flight request lock (`disabled` state) to prevent duplicate delete requests.
  - Added duplicate pending order guard on order creation to stop repeated submissions of identical pending investigations for the same patient.

### 3.2 Prescription PDF Download Overhaul & Inline Preview Modal (`eff049d`)
- **Problem Observed Live:** Clicking **Download Prescription PDF** produced silent failures or overlapping PDF text on longer prescriptions, and intermittent fetch errors appeared on checkup submission.
- **Solution Built:**
  - Replaced short-lived Blob URL revocation with a **60-second Blob keep-alive**, visible button spinner feedback, and explicit status toasts.
  - Added `#prescriptionPdfModal` so patients and doctors can **Preview, Print, or Download** verified prescriptions inline inside the portal.
  - Re-engineered `utils/pdfGenerator.js` prescription layout to compute dynamic Y-coordinates based on actual text heights so multi-medicine prescriptions and clinical notes never overlap.

### 3.3 Permanent AES-256-GCM Encrypted Gemini API Key Storage (`eff049d`, `fd0b518`)
- **Problem Observed Live:** Because Render Free Tier spins down idle containers and resets ephemeral disk storage, Admin-entered Gemini API keys had to be re-entered after every server restart.
- **Solution Built:**
  - Created `utils/aiConfigStore.js` storing the Gemini API key encrypted with **AES-256-GCM** inside Firebase Firestore (`sit_hospital_state/ai_config`, with local encrypted fallback).
  - Auto-hydrates on server startup via `server.js` and persists immediately whenever Admin activates or rotates the key in `controllers/adminController.js` — keeping the key permanent across Render restarts until Admin explicitly updates or revokes it.

### 3.4 Portal Navigation UX & Custom SIT Hospital Browser Favicon (`cbcd52b`, `8d3ff5f`)
- Made the SIT Students Hospital emblem & brand header on `/portal` a clickable link returning directly to `/`.
- Added a dedicated **Receptionist Sign-In** tab beside Patient Sign-In inside `/portal` for faster front-desk access alongside `/reception`.
- Authored a bespoke hospital shield/cross vector favicon (`public/favicon.svg` + `public/favicon.ico`) and linked it across all 9 HTML pages (`index.html`, `home.html`, `reception.html`, `about.html`, `departments.html`, `contact.html`, `verify.html`, `shared.html`, `presentation.html`).

---

## 4. Adversarial Bug Testing by Harsh Kumar Singh (`1SI24CS064`) & Full Remediation by Abdullah Saad Sharief (`1SI24CS003`)

### 4.1 Jenkins Adversarial Bug-Hunter Pipeline Overview
- **Tester:** **Harsh Kumar Singh (`1SI24CS064`)**
- **Pipeline:** `sit-hospital-bug-hunter` (Jenkins Declarative Pipeline executing `tests/bug-hunter.test.cjs` with `node --test` against an isolated ephemeral server instance and static code/Solidity analyzers).
- **Coverage:** 25 targeted exploit and defect-reproduction tests (`BUG-001`..`BUG-025`) across 5 suites:
  1. Password & Crypto Edge-Case Exploits (`BUG-001`, `BUG-002`)
  2. Blockchain & Proof-of-Work Integrity Gaps (`BUG-012` – `BUG-015`)
  3. Static Code, Solidity Smart Contract & Repo Hygiene Audits (`BUG-016` – `BUG-018`, `BUG-020` – `BUG-024`)
  4. Live API & Security Exploit Reproductions (`BUG-003` – `BUG-010`, `BUG-019`)
  5. `DEMO_MODE` Tamper Bounds & Malformed PNG Crash DoS (`BUG-011`, `BUG-025`)

### 4.2 Complete 25-Case Bug-Hunter Audit & Fix Matrix (`BUG-001` – `BUG-025`)

| Bug ID | Severity | File | Test Case (Harsh Kumar Singh) | Before | Remediation Implemented (Abdullah Saad Sharief) | After |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `BUG-001` | **HIGH** | `utils/passwords.js` | Non-hex hash tail (`scrypt$...$zzzz`) causing 0-byte `timingSafeEqual` bypass | FAIL | Strictly validates positive integer scrypt parameters and even-length hexadecimal salt/hash strings (>= 32 bytes) before `Buffer.from(..., 'hex')`. | **PASS** |
| `BUG-002` | **HIGH** | `utils/passwords.js` | Empty derived hash tail (`scrypt$...$aa$`) | PASS | Already hardened against empty hash tail; retained & reinforced by strict regex check. | **PASS** |
| `BUG-003` | MEDIUM | `controllers/authController.js` | 10-space whitespace-only password accepted in `change-password` | FAIL | Enforced `newPassword.trim().length < 10` rejection returning HTTP `400`. | **PASS** |
| `BUG-004` | MEDIUM | `controllers/authController.js` | Reusing exact current password accepted in `change-password` | FAIL | Checked `verifyPassword(newPassword, user.passwordHash)` and returned HTTP `400` on password reuse. | **PASS** |
| `BUG-005` | MEDIUM | `controllers/authController.js` | `GET /api/auth/users?role=Doctor` ignored `?role=` query filter | FAIL | Added optional case-insensitive `req.query.role` filtering while preserving unfiltered UI responses. | **PASS** |
| `BUG-006` | MEDIUM | `controllers/shareController.js` | Boolean `durationMinutes: true` coerced to `1` via `Number(true)` | FAIL | Rejected non-numeric booleans/null/blank strings; accepts only finite integers or `/^\d+$/` strings in `1..1440`. | **PASS** |
| `BUG-007` | LOW | `controllers/shareController.js` | Array `durationMinutes: [60]` coerced to `60` via `Number([60])` | FAIL | Explicitly rejected arrays (`typeof` guard) with HTTP `400`. | **PASS** |
| `BUG-008` | **HIGH** | `controllers/shareController.js` | Tampered `.bin` file on `/api/share/download` must return `400 Tamper`, not `403` | PASS | Already handled by AES-256-GCM integrity verification returning HTTP `400`. | **PASS** |
| `BUG-009` | MEDIUM | `controllers/shareController.js` | `/api/share/download` wrote zero audit log entries | FAIL | Added `db.logAudit('SHARED_LINK_DOWNLOADED', ...)` on every decrypted shared report download. | **PASS** |
| `BUG-010` | MEDIUM | `controllers/blockchainController.js` | `/api/blockchain/ledger` must return defined `nodes` array | PASS | Already fixed earlier (`nodes` array properly returned). | **PASS** |
| `BUG-011` | MEDIUM | `controllers/blockchainController.js` | `POST /api/blockchain/tamper-demo` with `blockIndex: 0` coerced via `|| 1` to block `1` | FAIL | Replaced `parseInt(...) || 1` with explicit `Number.isInteger` parsing so `blockIndex: 0` cleanly returns HTTP `400`. | **PASS** |
| `BUG-012` | MEDIUM | `blockchain/Blockchain.js` | `isChainValid()` started at `i = 1`, missing Genesis block (`chain[0]`) tampering | FAIL | Updated validation loop to start at `i = 0`, validating Genesis integrity & link continuity for `i > 0`. | **PASS** |
| `BUG-013` | MEDIUM | `blockchain/Blockchain.js` | `isChainValid()` accepted forged unmined blocks lacking PoW leading zeros | FAIL | Added Proof-of-Work prefix verification (`'0'.repeat(this.difficulty)`) for mined blocks (`i > 0`). | **PASS** |
| `BUG-014` | MEDIUM | `blockchain/Blockchain.js` | `simulateTampering(NaN)` crashed with unhandled `TypeError` | FAIL | Guarded with `!Number.isInteger(blockIndex)` to throw a clean validation `Error`. | **PASS** |
| `BUG-015` | LOW | `blockchain/Block.js` | `calculateHash()` depended on JSON object key insertion order | FAIL | Added recursive sorted-key `canonicalStringify()` for `calculateHash()` + `calculateLegacyHash()` fallback for pre-existing live Firebase/ledger blocks. | **PASS** |
| `BUG-016` | MEDIUM | `contracts/SITStudentsHospitalLedger.sol` | `anchorDiagnosticReport` lacked empty-string `require()` guards | FAIL | Added `require(bytes(_reportId).length > 0)`, `_sourceHash`, and `_reportHash` checks; verified clean `solc` compile. | **PASS** |
| `BUG-017` | MEDIUM | `contracts/SITStudentsHospitalLedger.sol` | `authorizeDepartmentNode` allowed authorizing `address(0)` | FAIL | Added `require(nodeAddress != address(0), ...)` guard. | **PASS** |
| `BUG-018` | MEDIUM | `contracts/SITStudentsHospitalLedger.sol` | `verifyReportIntegrity` ignored `sourceHash` | FAIL | Updated `verifyReportIntegrity` to validate against either `reportHash` or `sourceHash` while preserving exact ABI signatures. | **PASS** |
| `BUG-019` | MEDIUM | `controllers/adminController.js` | `POST /api/reception/patients` accepted duplicate caller-supplied `patientId` (UHID) | FAIL | Added caller-supplied `patientId`/`billNumber` support with HTTP `409 Conflict` duplicate UHID rejection. | **PASS** |
| `BUG-020` | **HIGH** | `controllers/reportController.js` | Async TOCTOU race: awaited on-chain RPC before locking `inFlightSourceHashes` | FAIL | Reserved `inFlightSourceHashes.add(sourceHash)` synchronously *before* `await ethereumClient.isHashAnchoredOnChain(...)`, with cleanup in `finally`. | **PASS** |
| `BUG-021` | **HIGH** | `controllers/reportController.js` | Inline defense-in-depth RBAC guard inside `uploadReport` | PASS | Already present inside `reportController.js`. | **PASS** |
| `BUG-022` | **HIGH** | `models/db.js` | Atomic temp-file rename (`atomicWriteJsonSync`) in `persist()` | PASS | Already implemented via `utils/atomicFile.js`. | **PASS** |
| `BUG-023` | MEDIUM | `server.js` | Express 5 `res.sendFile()` 404s under dot-prefixed workspaces (e.g., `.jenkins`) | FAIL | Passed `{ dotfiles: 'allow' }` on explicit hardcoded HTML `res.sendFile(...)` routes without exposing arbitrary dotfiles. | **PASS** |
| `BUG-024` | LOW | `package.json` | `"license": "ISC"` mismatch against `LICENSE` (`MIT`) | FAIL | Updated `package.json` `"license"` field to `"MIT"`. | **PASS** |
| `BUG-025` | **CRITICAL** | `utils/ocrHelper.js` | Uploading truncated/malformed PNG crashed entire `server.js` via Tesseract WASM (DoS) | FAIL | Added PNG/JPEG/WEBP structural chunk validation (`IHDR`/`IDAT`/`IEND`, `SOI`/`EOI`, RIFF bounds) before OCR and replaced global `Tesseract.recognize()` with isolated per-call `createWorker()` + `errorHandler` + `finally { worker.terminate() }`. | **PASS** |

---

## 5. Verification Results (Local CI, Bug-Hunter & Live Production)

### 5.1 Automated Verification Suites (Commit `2130a37`)
- **Harsh Kumar Singh's Adversarial Bug-Hunter Suite (`bug-hunter.test.cjs`):** **25 / 25 PASSED** (0 failed, 0 skipped, 6.19s)
- **Full Project Regression & Security Suite (`npm test`):** **49 / 49 PASSED** (0 failed, 0 skipped, 12.30s) — expanded from 46 tests in Part 1 to 49 tests (+3 new regression tests for lab queue removal, prescription PDF generation, and encrypted Gemini key cloud persistence).
- **Solidity Smart Contract Compilation (`solc`):** Compiled `SITStudentsHospitalLedger.sol` with 0 errors (10 ABI functions, 10,072 bytecode chars, backwards-compatible ABI with live Sepolia contract `0xE37266F644210b73d25b281866533a6E922F9Ea5`).

### 5.2 Live Render Production Verification (`https://sit-students-hospital-portal.onrender.com`, Nov 26, 2026)
- `GET /healthz`: **HTTP 200** — `ok: true`, `LIVE_EVM_ONCHAIN (Ethereum Sepolia Testnet)`, `FIREBASE_FIRESTORE_PERSISTENT`.
- UI Routes (`/`, `/portal`, `/reception`, `/favicon.svg`): **All HTTP 200** — zero UI or static-asset regressions.
- Live Firebase Firestore Blockchain Ledger (`/api/blockchain/ledger`): **15 / 15 blocks `isChainValid: true`** — proving canonical-hash + legacy-hash verification preserved 100% of existing live blocks without hash invalidation.
- Live Role Filtering (`/api/auth/users?role=Doctor`): **HTTP 200** — returned `4 / 4` Doctors out of `15` total users, confirming commit `2130a37` live in production.
- Patient Portal APIs (`/api/reports`, `/api/prescriptions`): **HTTP 200** — all existing reports and prescriptions accessible without error.
