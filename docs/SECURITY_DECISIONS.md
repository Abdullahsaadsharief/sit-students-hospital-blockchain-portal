# Security & Architecture Decisions — SIT Students Hospital Portal

This document records the explicit security and engineering choices made during the security hardening remediation (Findings F-01 through F-15).

## 1. Authentication & Patient Access Flow (F-01, F-05)
- **Staff & Admin Login:** Password-verified login (`scrypt` + 16-byte random salt + `crypto.timingSafeEqual`). ID-only login (`userId` alone) is permanently removed from `/api/auth/login`.
- **Patient Login (Bill Number + 8-Character One-Time Access Code):**
  - Sequential bill numbers alone (`BILL-2026-1001`) are guessable and no longer grant access.
  - At patient registration (or Receptionist reset), the server generates a cryptographic 8-character unambiguous access code (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`), stores only its `scrypt` hash (`accessCodeHash`), sets a 72-hour expiry, and displays it once on the OPD Bill Slip.
  - On first sign-in with `Bill Number + Access Code`, the code is immediately consumed (`accessCodeUsed = true`) and `mustChangePassword = true` gates all clinical APIs (`403 PASSWORD_CHANGE_REQUIRED`) until the patient sets a personal password (`>= 10` characters).
  - Subsequent logins use `Bill Number + Personal Password`.
- **Academic Demo Isolation (`DEMO_MODE`):**
  - Default `DEMO_MODE=false`. Seeded demo accounts (`isDemoAccount: true`) cannot sign in when `DEMO_MODE=false`.
  - When `DEMO_MODE=true` is set explicitly (refused in `NODE_ENV=production` unless `ALLOW_PUBLIC_DEMO=true`), one-click demo endpoints (`/api/auth/demo-accounts`, `/api/auth/demo-login`) and non-destructive tamper simulations are enabled for academic viva evaluation.

## 2. Cryptographic Storage & Secret Management (F-05, F-13)
- **Fail-Closed Startup:** `config.js` refuses to start when `JWT_SECRET`, `SHARE_JWT_SECRET`, or `ENCRYPTION_KEY` are missing, weak, duplicated, or match known repository defaults.
- **Authenticated Encryption (AES-256-GCM v2):** All new uploads and migrated files use `HCv2` (`4B magic + 1B version + 12B IV + 16B authTag + ciphertext`). Any bit flip throws `TamperDetectedError`, returning `MISMATCH` on verification and `400` on download.
- **Zero Query-String Session Tokens:** `authenticate` accepts Bearer tokens exclusively in the `Authorization: Bearer` header. Protected PDF downloads and previews fetch via `Authorization` header into in-memory `Blob` URLs.
- **Revocable Share Links:** Share JWTs contain only `{ jti, reportId }` (zero PII), enforce a `1..1440` minute bound, are never stored raw in `database.json`, and support immediate revocation via `POST /api/share/:jti/revoke`.

## 3. Clinical & Operational Integrity (F-04, F-06, F-07, F-08, F-10, F-15)
- **Strict Role Boundaries:** `authorizeRoles` has no implicit Admin bypass. Receptionists are denied all clinical report, timeline, search, prescription, QR, and share endpoints (`403`).
- **Soft-Delete Retention:** Routine report deletion is removed from Doctors and Lab Staff. Admin soft-delete (`DELETE /api/reports/:id`) requires a documented reason and preserves both the encrypted file and the blockchain anchor.
- **No Fabricated Clinical Data:** Empty/invalid medicine lists are rejected (`400`) instead of substituting Paracetamol. Unparsed diagnostic documents emit `testParameters: []` with an explicit disclaimer instead of fabricated normal/NABH claims.
- **Doctor Prescription Document Upload (F-15):** Doctors and Admins can upload signed/scanned prescription documents (`POST /api/prescriptions/upload`), validated by magic bytes and encrypted with AES-256-GCM, downloadable via `GET /api/prescriptions/:prescriptionId/attachment`.
- **Source-Hash Deduplication & Order Binding:** Duplicate detection hashes raw upload bytes (`sourceHash`) before OCR/PDF generation, guards concurrent requests via an in-flight lock set, and validates `labRequestId` ownership and pending status without auto-closing unrelated orders.

## 4. Real Ethereum EVM Blockchain Integration (F-09)
- `contracts/SITStudentsHospitalLedger.sol` is compiled via `solc` (`scripts/deploy-contract.js`) and invoked at runtime by `blockchain/ethereumClient.js` (`ethers` v6) whenever `BLOCKCHAIN_RPC_URL` and `BLOCKCHAIN_CONTRACT_ADDRESS` are configured.
- When external EVM credentials are not configured yet, the application operates transparently on the local tamper-evident hash-chain (`data/ledger.json`) and exposes its exact mode honestly in `/api/config/public`, `/api/blockchain/ledger`, and the UI.
