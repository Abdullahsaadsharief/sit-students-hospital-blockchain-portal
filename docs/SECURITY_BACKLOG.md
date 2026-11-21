# Security & Production Readiness Backlog

The following items represent medium- and long-term production hardening work intentionally deferred beyond the current single-host Node.js architecture:

1. **Transactional Database Migration (F-12):** Migrate `data/database.json` and `data/ledger.json` to PostgreSQL (with unique constraints on `source_hash`, `report_hash`, `email`, `bill_number`, and `jti`, plus ACID transactions binding report creation and lab order completion).
2. **Durable Encrypted Object Storage (F-12):** Move `uploads/*.bin` from local filesystem storage to Cloud Object Storage (e.g., S3 / GCS / Cloudflare R2) with automated lifecycle policies and KMS envelope encryption.
3. **Care-Relationship Scoping for Doctors (F-04):** Scope Doctor read/write endpoints strictly to patients assigned to the doctor's department/care team, with an audited break-glass override for cross-wing consultations.
4. **Strict Content Security Policy (CSP):** Refactor remaining inline `onclick`/`onsubmit` handlers in `public/*.html` into external script event listeners so Helmet can enable a strict `script-src 'self'` Content Security Policy without `'unsafe-inline'`.
5. **Streaming Disk Uploads & Queue Workers (F-11):** Move Multer from bounded `memoryStorage` to streaming encrypted temp storage and offload Tesseract OCR to an isolated worker queue for high-concurrency hospital deployments.
6. **Multi-Factor Authentication (MFA) & Dual-Approval Admin Controls:** Require TOTP/WebAuthn MFA for Staff/Admin accounts and dual approval for role elevation and break-glass clinical access.
7. **Automated Backup Drills & External SIEM Forwarding:** Ship append-only audit logs to external immutable log storage and run scheduled restore drills.
