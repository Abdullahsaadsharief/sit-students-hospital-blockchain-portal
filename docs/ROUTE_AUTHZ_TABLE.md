# API Route Authorization Table

Every API route registered in `server.js` is either authenticated via `Authorization: Bearer <JWT>` (`authenticate` middleware) or explicitly listed in `app.PUBLIC_API_ROUTES`.

| Method & Path | Auth | Allowed Roles / Policy | Notes |
| :--- | :---: | :--- | :--- |
| `GET /healthz` | Public | Anyone | Liveness check (`{ ok, status, demoMode, blockchainMode }`) |
| `GET /api/config/public` | Public | Anyone | Exposes `demoMode` flag & non-sensitive Ethereum mode/address |
| `POST /api/auth/login` | Public | Anyone (rate-limited) | Credential login (Staff email+password; Patient bill+accessCode/password) |
| `GET /api/auth/demo-accounts` | Public (`DEMO_MODE` only) | Mounted only if `DEMO_MODE=true` | Returns `404` when `DEMO_MODE=false` |
| `POST /api/auth/demo-login` | Public (`DEMO_MODE` only) | Mounted only if `DEMO_MODE=true` | Returns `404` when `DEMO_MODE=false` |
| `GET /api/auth/me` | Bearer JWT | Any active user | Allowed while `mustChangePassword=true` |
| `POST /api/auth/change-password` | Bearer JWT | Any active user | Bumps `tokenVersion`, clears `mustChangePassword`, issues fresh JWT |
| `GET /api/auth/users` | Bearer JWT | `Doctor`, `Lab Staff`, `Receptionist`, `Admin` | Minimal fields for Doctor/Lab; full contact/bill for Receptionist/Admin |
| `GET /api/admin/users` | Bearer JWT | `Admin` | Strips all secret hashes |
| `POST /api/admin/users` | Bearer JWT | `Admin` | Generates random temp password (and 8-char access code for Patients) |
| `DELETE /api/admin/users/:userId` | Bearer JWT | `Admin` | Bumps `tokenVersion`, cannot self-delete |
| `GET /api/admin/ai-config` | Bearer JWT | `Admin` | Masked key status & `AI_EXTERNAL_PROCESSING` policy flag |
| `POST /api/admin/ai-config` | Bearer JWT | `Admin` | Verifies Gemini key & updates `.env` |
| `DELETE /api/admin/ai-config` | Bearer JWT | `Admin` | Reverts to offline local clinical rule parser |
| `GET /api/reception/patients` | Bearer JWT | `Receptionist`, `Admin` | Reception patient directory |
| `POST /api/reception/patients` | Bearer JWT | `Receptionist`, `Admin` | Issues Bill Number + one-time 8-char Access Code (72h TTL) |
| `POST /api/reception/patients/:patientId/reset-access-code` | Bearer JWT | `Receptionist`, `Admin` | Issues fresh 8-char Access Code & invalidates old sessions |
| `GET /api/reception/patients/:patientId/bill-pdf` | Bearer JWT | `Receptionist`, `Admin`, `Patient` (own only) | Enforces `canViewPatientBill` |
| `POST /api/reception/inquiries` | Public | Anyone (rate-limited) | Strict length & department validation |
| `GET /api/reception/inquiries` | Bearer JWT | `Receptionist`, `Admin` | Helpdesk inbox |
| `PUT /api/reception/inquiries/:ticketId/resolve` | Bearer JWT | `Receptionist`, `Admin` | Marks ticket resolved (`404` if missing) |
| `GET /api/prescriptions` | Bearer JWT | `Doctor`, `Patient` (own), `Admin` | `Lab Staff` and `Receptionist` denied (`403`) |
| `POST /api/prescriptions` | Bearer JWT | `Doctor`, `Admin` | Strict medicines validation (1-20 entries, zero defaults) |
| `POST /api/prescriptions/upload` | Bearer JWT | `Doctor`, `Admin` (rate-limited) | F-15 encrypted prescription document upload with magic-byte check |
| `GET /api/prescriptions/:prescriptionId/pdf` | Bearer JWT | `Doctor`, `Patient` (own), `Admin` | Enforces `canViewPrescription` |
| `GET /api/prescriptions/:prescriptionId/attachment` | Bearer JWT | `Doctor`, `Patient` (own), `Admin` | Authenticated decryption + SHA-256 check |
| `GET /api/lab-requests` | Bearer JWT | `Lab Staff`, `Doctor`, `Receptionist`, `Admin` | `Patient` denied (`403`) |
| `DELETE /api/lab-requests/:requestId` | Bearer JWT | `Lab Staff`, `Doctor`, `Admin` | Removes queue entry only (preserves uploaded reports & blockchain anchors); `Patient`/`Receptionist` denied (`403`) |
| `POST /api/reports/upload` | Bearer JWT | `Lab Staff`, `Admin` (rate-limited) | Magic bytes, `sourceHash` dedupe lock, `labRequestId` check, AES-256-GCM, EVM anchor |
| `GET /api/reports` | Bearer JWT | `Patient` (own), `Doctor`, `Lab Staff` (`[]`), `Admin` | `Receptionist` denied (`403`) |
| `GET /api/reports/search` | Bearer JWT | `Patient` (own), `Doctor`, `Admin` | `Receptionist` & `Lab Staff` denied (`403`) |
| `GET /api/reports/timeline/:patientId` | Bearer JWT | `Patient` (own), `Doctor`, `Admin` | `Receptionist` & `Lab Staff` denied (`403`) |
| `GET /api/reports/:reportId` | Bearer JWT | `Patient` (own), `Doctor`, `Admin` | Enforces `canViewReport` |
| `GET /api/reports/:reportId/download` | Bearer JWT | `Patient` (own), `Doctor`, `Admin` | Enforces `canViewReport`, AES-256-GCM + SHA-256 check |
| `PUT /api/reports/:reportId` | Bearer JWT | `Doctor`, `Admin` | Marks `clinicianReviewed: true` |
| `DELETE /api/reports/:reportId` | Bearer JWT | `Admin` | Soft-delete requiring documented `reason`; retains file & block |
| `GET /api/qr/:reportId` | Bearer JWT | `Patient` (own), `Doctor`, `Admin` | Enforces `canViewReport` |
| `GET /api/verify/:reportId` | Public / Optional JWT | Anyone (rate-limited) | Public returns minimal verdict (zero PII); authorized JWT gets rich details |
| `POST /api/verify/check-file/:reportId` | Public / Optional JWT | Anyone (rate-limited) | Compares uploaded file hash against `sourceHash` & `reportHash` |
| `POST /api/verify/simulate-tamper/:reportId` | Bearer JWT (`DEMO_MODE` only) | `Admin` | Non-destructive in-memory simulation (`404` when `DEMO_MODE=false`) |
| `POST /api/verify/reset-tamper/:reportId` | Bearer JWT (`DEMO_MODE` only) | `Admin` | Clears in-memory simulation (`404` when `DEMO_MODE=false`) |
| `GET /api/share` | Bearer JWT | `Patient` (own), `Doctor` (own), `Admin` | Lists issued share links for revocation |
| `POST /api/share/create` | Bearer JWT | `Patient` (own), `Doctor`, `Admin` | Enforces `canShareReport`, `1..1440` min duration, `jti` tracking |
| `POST /api/share/:jti/revoke` | Bearer JWT | Creator, Patient owner, or `Admin` | Immediately revokes share token |
| `GET /api/share/view` | Share JWT (`?token=`) | Valid unrevoked Share JWT | Verifies `SHARE_JWT_SECRET`, `jti` revocation, and report status |
| `GET /api/share/download` | Share JWT (`?token=`) | Valid unrevoked Share JWT | Streams decrypted PDF with `Referrer-Policy: no-referrer` |
| `GET /api/blockchain/ledger` | Bearer JWT | `Admin` | Local hash-chain + live Ethereum connection metadata |
| `GET /api/blockchain/verify` | Bearer JWT | `Admin` | Full hash-chain audit |
| `GET /api/blockchain/stats` | Bearer JWT | `Doctor`, `Lab Staff`, `Receptionist`, `Admin` | Operational counts + Ethereum status |
| `GET /api/blockchain/audit-logs` | Bearer JWT | `Admin` | System audit trail |
| `POST /api/blockchain/tamper-demo` | Bearer JWT (`DEMO_MODE` only) | `Admin` | Non-destructive in-memory block tamper (`404` when `DEMO_MODE=false`) |
| `POST /api/blockchain/restore` | Bearer JWT (`DEMO_MODE` only) | `Admin` | Restores snapshotted block without resetting DB (`404` when `DEMO_MODE=false`) |
