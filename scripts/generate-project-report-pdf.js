const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const ROOT = path.resolve(__dirname, '..');
const OUT_PDF = path.join(ROOT, 'docs', 'SIT_Students_Hospital_Project_Report.pdf');

const ARTIFACT_IMG_DIR = 'C:/Users/abdul/.gemini/antigravity/brain/c6c30912-7ac9-4cb4-9850-cfd38bdf7392/.user_uploaded';
const IMAGES = {
    hero: path.join(ROOT, 'public', 'images', 'hero-hospital.jpg'),
    pipeline: path.join(ROOT, 'public', 'images', 'report', 'fig_6_1_implementation_pipeline.png'),
    dashboard: path.join(ROOT, 'public', 'images', 'report', 'fig_7_1_results_dashboard.png'),
    etherscan: path.join(ARTIFACT_IMG_DIR, 'media_1795504375225_d0ee7b44.jpg'),
    firestore: path.join(ARTIFACT_IMG_DIR, 'media_1795505322801_f522143d.png'),
    labQueue: path.join(ARTIFACT_IMG_DIR, 'media_1795503485452_757e9a9f.jpg')
};

const COLORS = {
    navy: '#162d4c',
    navyDark: '#0f1f36',
    teal: '#0d9488',
    tealSoft: '#f0fdfa',
    tealBorder: '#99f6e4',
    blue: '#0369a1',
    blueSoft: '#f0f9ff',
    amber: '#92400e',
    amberSoft: '#fffbeb',
    amberBorder: '#fcd34d',
    green: '#065f46',
    greenSoft: '#ecfdf5',
    slate900: '#0f172a',
    slate700: '#334155',
    slate500: '#64748b',
    slate200: '#e2e8f0',
    slate100: '#f8fafc',
    white: '#ffffff'
};

function generateReportPDF() {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 56, bottom: 56, left: 48, right: 48 },
            bufferPages: true,
            info: {
                Title: 'SIT Students Hospital Portal — Comprehensive Project Development Report',
                Author: 'Abdullah Saad Sharief, Harsh Kumar Singh, H Abhishek (SIT Tumakuru)',
                Subject: '5th Semester Mini Project Report — Blockchain & Cloud Medical Document Portal'
            }
        });

        const outStream = fs.createWriteStream(OUT_PDF);
        doc.pipe(outStream);

        const pageW = doc.page.width;
        const pageH = doc.page.height;
        const left = 48;
        const contentW = pageW - 96;
        const bottomLimit = pageH - 64;

        function ensureSpace(neededHeight) {
            if (doc.y + neededHeight > bottomLimit) {
                doc.addPage();
            }
        }

        function sectionHeading(num, title) {
            ensureSpace(52);
            doc.moveDown(0.5);
            const y = doc.y;
            doc.rect(left, y, 4, 20).fill(COLORS.teal);
            doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.navy)
                .text(`${num}. ${title}`, left + 12, y + 2, { width: contentW - 12 });
            doc.moveTo(left, y + 24).lineTo(left + contentW, y + 24).strokeColor(COLORS.slate200).lineWidth(1).stroke();
            doc.y = y + 32;
        }

        function subHeading(title) {
            ensureSpace(28);
            doc.moveDown(0.25);
            doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLORS.blue)
                .text(title, left, doc.y, { width: contentW });
            doc.moveDown(0.2);
        }

        function bodyPara(text) {
            doc.font('Helvetica').fontSize(9.4).fillColor(COLORS.slate700)
                .text(text, left, doc.y, { width: contentW, align: 'justify', lineGap: 2.5 });
            doc.moveDown(0.35);
        }

        function bulletItem(lead, text) {
            ensureSpace(26);
            const y = doc.y;
            doc.circle(left + 5, y + 5, 2.2).fill(COLORS.teal);
            doc.font('Helvetica-Bold').fontSize(9.2).fillColor(COLORS.slate900)
                .text(`${lead}: `, left + 14, y, { width: contentW - 14, continued: true, lineGap: 2 });
            doc.font('Helvetica').fontSize(9.2).fillColor(COLORS.slate700)
                .text(text, { lineGap: 2 });
            doc.moveDown(0.22);
        }

        function calloutBox(title, lines, bg = COLORS.tealSoft, border = COLORS.teal, titleColor = COLORS.navy) {
            const textLines = Array.isArray(lines) ? lines : [lines];
            doc.font('Helvetica').fontSize(8.8);
            let h = 24;
            for (const ln of textLines) {
                h += doc.heightOfString(ln, { width: contentW - 24, lineGap: 2 }) + 3;
            }
            h += 8;
            ensureSpace(h + 8);
            const y = doc.y;
            doc.roundedRect(left, y, contentW, h, 4).fillAndStroke(bg, COLORS.slate200);
            doc.rect(left, y, 4, h).fill(border);
            doc.font('Helvetica-Bold').fontSize(9.5).fillColor(titleColor)
                .text(title, left + 12, y + 7, { width: contentW - 22 });
            let cy = y + 22;
            doc.font('Helvetica').fontSize(8.8).fillColor(COLORS.slate700);
            for (const ln of textLines) {
                const lh = doc.heightOfString(ln, { width: contentW - 24, lineGap: 2 });
                doc.text(ln, left + 12, cy, { width: contentW - 24, lineGap: 2 });
                cy += lh + 3;
            }
            doc.y = y + h + 8;
        }

        function drawTable(headers, rows, colWidths) {
            const rowPadY = 5;
            const rowPadX = 6;
            const headerH = 22;

            function renderHeader() {
                ensureSpace(headerH + 24);
                const y = doc.y;
                doc.rect(left, y, contentW, headerH).fill(COLORS.navy);
                let cx = left;
                doc.font('Helvetica-Bold').fontSize(8.3).fillColor(COLORS.white);
                headers.forEach((h, idx) => {
                    doc.text(h, cx + rowPadX, y + 6, { width: colWidths[idx] - rowPadX * 2 });
                    cx += colWidths[idx];
                });
                doc.y = y + headerH;
            }

            renderHeader();

            rows.forEach((row, rIdx) => {
                doc.font('Helvetica').fontSize(8.1);
                let maxH = 14;
                row.forEach((cell, idx) => {
                    const ch = doc.heightOfString(String(cell), { width: colWidths[idx] - rowPadX * 2, lineGap: 1.5 });
                    if (ch > maxH) maxH = ch;
                });
                const rowH = maxH + rowPadY * 2;
                if (doc.y + rowH > bottomLimit) {
                    doc.addPage();
                    renderHeader();
                }
                const y = doc.y;
                doc.rect(left, y, contentW, rowH).fill(rIdx % 2 === 0 ? COLORS.white : COLORS.slate100);
                doc.rect(left, y, contentW, rowH).strokeColor(COLORS.slate200).lineWidth(0.5).stroke();

                let cx = left;
                row.forEach((cell, idx) => {
                    doc.font(idx === 0 ? 'Helvetica-Bold' : 'Helvetica')
                        .fontSize(8.1)
                        .fillColor(idx === 0 ? COLORS.slate900 : COLORS.slate700)
                        .text(String(cell), cx + rowPadX, y + rowPadY, {
                            width: colWidths[idx] - rowPadX * 2,
                            lineGap: 1.5
                        });
                    cx += colWidths[idx];
                });
                doc.y = y + rowH;
            });
            doc.moveDown(0.5);
        }

        function embedFigure(imgPath, caption, maxH = 220) {
            if (!imgPath || !fs.existsSync(imgPath)) return;
            ensureSpace(maxH + 38);
            const y = doc.y;
            const boxH = maxH + 26;
            doc.roundedRect(left, y, contentW, boxH, 5).fillAndStroke(COLORS.slate100, COLORS.slate200);
            try {
                doc.image(imgPath, left + 10, y + 8, {
                    fit: [contentW - 20, maxH - 8],
                    align: 'center',
                    valign: 'center'
                });
            } catch (err) {
                doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.slate500)
                    .text(`[Image could not be embedded: ${path.basename(imgPath)}]`, left + 16, y + 20);
            }
            doc.font('Helvetica-Bold').fontSize(8.2).fillColor(COLORS.navy)
                .text(caption, left + 10, y + maxH + 6, { width: contentW - 20, align: 'center' });
            doc.y = y + boxH + 10;
        }

        // =====================================================================
        // PAGE 1 — ACADEMIC COVER PAGE
        // =====================================================================
        doc.rect(0, 0, pageW, 190).fill(COLORS.navy);
        doc.rect(0, 190, pageW, 6).fill(COLORS.teal);

        doc.font('Helvetica-Bold').fontSize(10).fillColor('#99f6e4')
            .text('SIDDAGANGA INSTITUTE OF TECHNOLOGY (SIT), TUMAKURU', left, 42, { width: contentW, align: 'center' });
        doc.font('Helvetica').fontSize(9.5).fillColor('#cbd5e1')
            .text('Department of Computer Science & Engineering  •  5th Semester (3rd Year) Mini Project', left, 58, { width: contentW, align: 'center' });

        doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.white)
            .text('SIT Students Hospital Portal', left, 92, { width: contentW, align: 'center' });
        doc.font('Helvetica').fontSize(12).fillColor('#e2e8f0')
            .text('Centralized Medical Document, Prescription & Live Ethereum Blockchain Verification System', left, 122, { width: contentW, align: 'center' });
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#5eead4')
            .text('COMPREHENSIVE DEVELOPMENT REPORT, TIMELINE, SECURITY AUDIT & CLOUD DEPLOYMENT BACKUP', left, 154, { width: contentW, align: 'center' });

        doc.y = 216;
        if (fs.existsSync(IMAGES.hero)) {
            doc.roundedRect(left, doc.y, contentW, 175, 6).fillAndStroke(COLORS.slate100, COLORS.slate200);
            doc.image(IMAGES.hero, left + 8, doc.y + 8, { fit: [contentW - 16, 159], align: 'center', valign: 'center' });
            doc.y += 188;
        }

        // Key metrics banner strip
        const metrics = [
            { val: '40 Commits', lbl: 'Oct 5 – Nov 24, 2026' },
            { val: '15 / 15 Fixed', lbl: 'Security Audit Findings' },
            { val: '46 / 46 Pass', lbl: 'Automated CI Tests' },
            { val: 'Live On-Chain', lbl: 'Ethereum Sepolia EVM' }
        ];
        const mW = (contentW - 18) / 4;
        const mY = doc.y;
        metrics.forEach((m, i) => {
            const mx = left + i * (mW + 6);
            doc.roundedRect(mx, mY, mW, 50, 5).fillAndStroke(COLORS.blueSoft, COLORS.slate200);
            doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.navy).text(m.val, mx + 4, mY + 10, { width: mW - 8, align: 'center' });
            doc.font('Helvetica').fontSize(7.8).fillColor(COLORS.slate500).text(m.lbl, mx + 4, mY + 29, { width: mW - 8, align: 'center' });
        });
        doc.y = mY + 64;

        // Project Team & Guide box
        const metaY = doc.y;
        doc.roundedRect(left, metaY, contentW, 122, 6).fillAndStroke(COLORS.slate100, COLORS.slate200);
        doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.navy).text('PROJECT TEAM MEMBERS', left + 16, metaY + 12);
        doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.slate700)
            .text('• Abdullah Saad Sharief   (1SI24CS003)', left + 16, metaY + 30)
            .text('• Harsh Kumar Singh       (1SI24CS064)', left + 16, metaY + 46)
            .text('• H Abhishek                  (1SI25CS404)', left + 16, metaY + 62);

        doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.navy).text('FACULTY SUPERVISION', left + 270, metaY + 12);
        doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.slate700)
            .text('Project Guide: Mrs. Nidhi L. G.', left + 270, metaY + 30)
            .text('Asst. Professor, Dept. of CSE, SIT', left + 270, metaY + 46)
            .text('Panel Convener: Dr. R. Sumathi', left + 270, metaY + 62);

        doc.moveTo(left + 16, metaY + 84).lineTo(left + contentW - 16, metaY + 84).strokeColor(COLORS.slate200).stroke();
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.teal)
            .text('Live Website: https://sit-students-hospital-portal.onrender.com/', left + 16, metaY + 92)
            .text('Ethereum Sepolia Contract: 0xE37266F644210b73d25b281866533a6E922F9Ea5   |   Storage: Firebase Firestore', left + 16, metaY + 105);

        doc.y = metaY + 138;
        doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.slate500)
            .text('Report Backup Generated: November 25, 2026  •  GitHub: github.com/Abdullahsaadsharief/sit-students-hospital-blockchain-portal', left, doc.y, { width: contentW, align: 'center' });

        // =====================================================================
        // PAGE 2 — EXECUTIVE SUMMARY, ARCHITECTURE & SYSTEM FIGURES
        // =====================================================================
        doc.addPage();
        sectionHeading('1', 'Executive Summary & Project Objectives');
        bodyPara(
            'The SIT Students Hospital Portal is a full-stack electronic medical record, laboratory report, OPD billing, and doctor prescription management platform engineered specifically for a unified single-hospital workflow across four internal clinical wings (Cardiology & General Medicine, Central Pathology & Radiology Lab, Pulmonology & Respiratory Care, and Orthopedics & Neuro). The system eliminates fragmented paper records, accidental duplicate diagnostic uploads, report forgery, and weak role separation by pairing authenticated off-chain encryption with live Ethereum blockchain verification and persistent cloud storage.'
        );

        bulletItem('Authenticated Off-Chain Encryption (AES-256-GCM v2)', 'All diagnostic PDFs and doctor prescription scans are encrypted at rest with random 12-byte IVs and 16-byte authentication tags (HCv2 format). Any 1-bit ciphertext modification is detected immediately.');
        bulletItem('Live Ethereum Sepolia Smart Contract Anchoring', 'SITStudentsHospitalLedger.sol is compiled via solc and deployed live on Ethereum Sepolia Testnet at 0xE37266F644210b73d25b281866533a6E922F9Ea5. Only pseudonymous Report IDs and SHA-256 fingerprints are stored on-chain (zero patient PII).');
        bulletItem('SHA-256 Source Deduplication (HTTP 409)', 'Raw uploaded file bytes are hashed before OCR/PDF processing and checked against an in-flight concurrency lock, database, local hash-chain, and the live Ethereum smart contract to block redundant uploads.');
        bulletItem('Persistent Cloud Vault (Firebase Firestore)', 'Automatically persists database.json, ledger.json, and chunked AES-256-GCM encrypted files to Firebase Firestore (sit-students-hospital, Free Spark tier) with a strict startup hydration guard so Render container restarts never lose data.');
        bulletItem('De-identified Clinical AI (Google Gemini 3.x Flash)', 'Upgraded to gemini-3.8-flash / gemini-3.5-flash-lite using de-identified pseudonymous patient IDs, backed by an offline deterministic clinical NLP rule parser.');
        bulletItem('Strict 5-Role RBAC & Automated Verification', 'Admin, Doctor, Lab Staff, Receptionist, and Patient boundaries are enforced at middleware, controller, and data layers — verified by 46 / 46 passing automated tests in local and GitHub Actions CI environments.');

        sectionHeading('2', 'System Architecture & Implementation Pipeline');
        bodyPara(
            'The platform follows a stateless cloud web-server pattern hosted on Render (Node.js + Express 5 + Helmet + Gzip compression), backed by three specialized external layers: (1) Ethereum Sepolia via Alchemy RPC for immutable cryptographic report anchoring, (2) Firebase Cloud Firestore for durable encrypted off-chain storage and state hydration, and (3) Google Gemini 3.x Flash for optional de-identified clinical summaries.'
        );

        embedFigure(IMAGES.pipeline, 'Figure 1: End-to-End Implementation Pipeline (Upload -> SHA-256 Dedupe -> OCR/AI -> AES-256-GCM -> Blockchain & QR)', 195);
        embedFigure(IMAGES.dashboard, 'Figure 2: Clinical Portal & Verification Results Architecture Overview', 195);

        // =====================================================================
        // SECTION 3 — COMPLETE CHRONOLOGICAL DEVELOPMENT TIMELINE
        // =====================================================================
        sectionHeading('3', 'Complete Chronological Development Timeline (40 Git Commits)');
        bodyPara(
            'Every development phase below is compiled directly from verified repository commit logs spanning October 5, 2026 through November 24, 2026 — capturing how the project evolved from an initial Phase-2 prototype into a hardened, publicly deployed blockchain and cloud hospital system.'
        );

        drawTable(
            ['Phase & Date', 'Key Commits', 'Major Features & Milestones Delivered'],
            [
                [
                    'Phase 1\nOct 5 – Oct 8, 2026',
                    '3bdc047, 271fd91,\nfafdd36, 727eeb4,\n80e348a, 2e9da83',
                    'Initial Express backend, local hash-chain ledger, mandatory login gate, PDFKit generation with scannable QR codes, live PDF preview modal, Hybrid AI clinical summarizer + Admin AI Gateway card, and public hospital landing page with facility showcases.'
                ],
                [
                    'Phase 2\nOct 26 – Oct 27, 2026',
                    'f6491dc, 0669f20,\nb90acde, 8fff634,\n8fbd273',
                    '20-slide Phase-2 SIT presentation deck, Chapter 6 & 7 report figures, dedicated evaluation demo reports kit, automatic PDF standardization embedding anti-forgery QR codes at bottom of uploaded reports, and cryptographic formula audit.'
                ],
                [
                    'Phase 3\nNov 5 – Nov 12, 2026',
                    '123d874, 1e42f4e,\n6e032c5',
                    'Complete UX redesign for SIT Students Hospital single-hospital 4-wing workflow (32 files); launched dedicated Reception & Billing Desk (/reception) for front-desk patient registration and OPD billing.'
                ],
                [
                    'Phase 4\nNov 20 – Nov 21, 2026',
                    'e47ee18, 770bfdb,\nfbc688b, d9ab233,\nbfa4138, 65cbb76',
                    'Added downloadable OPD Bill PDFs, Doctor Checkup & Prescription Pad, Pending Lab Orders Queue, Doctor Patient Selection Gate, About/Departments/Contact pages, Solidity smart contract (SITStudentsHospitalLedger.sol), Contact Helpdesk -> Reception inbox, and initial IDOR patches.'
                ],
                [
                    'Phase 5\nNov 21, 2026',
                    '4e4f2ee\n(50 files, +8,556 LOC)',
                    'Full Security Hardening (F-01 through F-15): scrypt password hashing, 8-char one-time Patient Access Codes + forced password setup, AES-256-GCM v2 authenticated encryption + migration script, F-15 Doctor prescription scan upload, ethers v6 + solc EVM integration, 38 automated tests, GitHub Actions CI, and Render blueprint.'
                ],
                [
                    'Phase 6\nNov 24 (Morning)',
                    'Sepolia Live Deploy\n(0xE37266...9Ea5)',
                    'Deployed web app live to Render (sit-students-hospital-portal.onrender.com), set up Alchemy Sepolia RPC + MetaMask test wallet, deployed SITStudentsHospitalLedger.sol on Ethereum Sepolia, and confirmed first live on-chain report anchoring transaction on Sepolia Etherscan (Block #12201078).'
                ],
                [
                    'Phase 7\nNov 24 (Afternoon)',
                    'df871bc, 3d57079,\n051828b, ecfe71b,\n55edd46, 092a1b5,\n2adb992',
                    'Built Firebase Firestore persistent cloud vault (gzip + 600 KiB chunking + startup hydration guard), migrated to firebase-admin v13 modular SDK, fixed Demo Admin login collision, added Express gzip + 7d image caching + debounced cloud sync, upgraded Gemini AI to 3.8/3.5 Flash, fixed Light Mode contrast across all pages, updated README, and fixed CI env isolation (46/46 passing).'
                ]
            ],
            [92, 118, contentW - 210]
        );

        // =====================================================================
        // SECTION 4 — SECURITY AUDIT REMEDIATIONS (F-01..F-15)
        // =====================================================================
        sectionHeading('4', 'Security Audit Findings & Remediations (F-01 to F-15)');
        bodyPara(
            'Prior to live deployment, the entire application underwent a structured 15-point security and clinical integrity audit. Every identified vulnerability was fixed and locked down with automated regression tests:'
        );

        drawTable(
            ['ID', 'Vulnerability / Audit Finding', 'Implemented Hardening Fix'],
            [
                ['F-01', 'ID-only & bill-only account takeover', 'Removed quick-login bypasses from /api/auth/login; enforced scrypt hashing, 8-char single-use Patient Access Codes (72h TTL) + mandatory password setup, brute-force 429 lockouts, and DEMO_MODE isolation.'],
                ['F-02', 'Unauthenticated PII & bill exposure', 'Protected /api/auth/users, /api/reception/*, /api/qr/:id, and /api/blockchain/stats with JWT+RBAC; stripped all PII from anonymous /api/verify/:id responses.'],
                ['F-03', 'Public destructive file tamper route', 'Deleted /api/verify/tamper-file/:id; replaced with DEMO_MODE-only, Admin-only non-destructive in-memory tamper simulation.'],
                ['F-04', 'Broken role boundaries & Admin bypass', 'Removed implicit Admin bypass in authorizeRoles; blocked Receptionist (403) across all clinical APIs; replaced deletion with Admin-only documented soft-delete.'],
                ['F-05', 'Plain-text passwords & static AES key', 'Migrated credentials to scrypt + timingSafeEqual; added fail-closed secret validation in config.js; upgraded encryption to authenticated AES-256-GCM v2 (HCv2).'],
                ['F-06', 'Empty medicines inventing Paracetamol', 'Strict validation rejects missing/empty medicine lists (HTTP 400); eliminated fabricated medication defaults in records and PDFs.'],
                ['F-07', 'Duplicate hash mismatch (source vs PDF)', 'Hashed raw uploaded source bytes (sourceHash) before OCR/PDF synthesis; added in-flight concurrency lock + DB/ledger/on-chain duplicate checks.'],
                ['F-08', 'Fabricated normal & NABH AI claims', 'Removed fabricated parameters/NABH claims; added mandatory clinical review disclaimer, clinicianReviewed: false, and de-identified pseudonyms for Gemini AI.'],
                ['F-09', 'Disconnected local ledger vs Solidity', 'Wired SITStudentsHospitalLedger.sol via solc + ethers v6 (ethereumClient.js) and deployed live to Ethereum Sepolia Testnet with transparent fallback reporting.'],
                ['F-10', 'Unvalidated lab order auto-completion', 'Enforced labRequestId existence, patient ownership, and PENDING_UPLOAD status validation; stopped auto-closing unrelated pending orders.'],
                ['F-11', 'Extension-only upload & unbounded OCR', 'Added magic-byte signature validation (fileValidation.js), 1 MB JSON cap, upload rate limits, and ConcurrencySemaphore capping parallel OCR jobs.'],
                ['F-12', 'Fragile JSON writes & destructive restore', 'Added atomic temp-file+rename writes with 5 rolling .bak backups, startup recovery, non-destructive restore, and Firebase Firestore cloud persistence.'],
                ['F-13', 'Query-string JWTs & non-revocable links', 'Rejected ?token= on auth routes; switched PDF views to Authorization-header Blob fetches; stripped PII from share JWTs; added Referrer-Policy: no-referrer & instant /revoke.'],
                ['F-14', 'No automated tests or CI pipeline', 'Implemented 46 automated tests (tests/api.test.cjs + tests/cloud-persistence.test.cjs) and GitHub Actions CI (.github/workflows/test.yml).'],
                ['F-15', 'Missing Doctor prescription scan upload', 'Added POST /api/prescriptions/upload & GET /api/prescriptions/:id/attachment with magic-byte validation, AES-256-GCM encryption, and RBAC scoping.']
            ],
            [36, 154, contentW - 190]
        );

        // =====================================================================
        // SECTION 5 — MISTAKES, REAL ENGINEERING CHALLENGES & LESSONS LEARNED
        // =====================================================================
        sectionHeading('5', 'Mistakes, Real Bugs Encountered & Engineering Solutions');
        bodyPara(
            'During live cloud deployment, blockchain integration, and testing, we encountered ten real-world distributed systems, SDK, security, and UI bugs. Documenting each mistake, its exact root cause, and the verified fix provides complete traceability for academic viva review:'
        );

        drawTable(
            ['#', 'Issue / Mistake Encountered', 'Root Cause & Verified Engineering Solution'],
            [
                ['1', 'Render stayed in LOCAL_HASH_CHAIN_FALLBACK after contract deploy', 'Root Cause: Render masked empty env fields with dots; BLOCKCHAIN_CONTRACT_ADDRESS was still blank from an earlier paste. Fix: Verified via /api/config/public, populated contract address & CORS_ORIGINS, removed conflicting PORT -> confirmed LIVE_EVM_ONCHAIN.'],
                ['2', 'Uploaded reports vanished after Render redeploy, yet re-upload returned 409 Duplicate', 'Root Cause: Render Free Tier resets container disk on redeploy/sleep, while Ethereum Sepolia permanently retained the uploaded file hash on-chain. Fix: Built Firebase Firestore persistent vault (utils/cloudPersistence.js) storing gzipped state + chunked encrypted binaries.'],
                ['3', 'Firebase Cloud Storage required Blaze billing card vs. free requirement', 'Root Cause: Firebase Cloud Storage buckets require Blaze billing (credit card), while Supabase pauses after 7 days idle. Fix: Engineered chunked binary vault directly on Free Spark Cloud Firestore (1 GB, no card, no 7-day auto-pause) with plug-in FIREBASE_STORAGE_BUCKET support for future scaling.'],
                ['4', 'firebase-admin v13 crashed with Cannot read properties of undefined (reading find)', 'Root Cause: firebase-admin v13 removed legacy admin.apps in favor of modular sub-packages. Fix: Migrated to firebase-admin/app (getApps, initializeApp, cert), firebase-admin/firestore (getFirestore), and firebase-admin/storage + added RSA SDK init unit test.'],
                ['5', 'Completed lab orders reverted to PENDING_UPLOAD after redeploy despite Firebase', 'Root Cause: Startup race — require("./models/db") executed new Database().init() synchronously before hydrateOnStartup(), arming a 1s debounce timer with stale repo database.json that overwrote Firestore! Fix: Added readyForWrites hydration gate + constructor sync suppression + redeploy regression test.'],
                ['6', 'Demo Admin one-click button showed "Demo account unavailable"', 'Root Cause: BOOTSTRAP_ADMIN_EMAIL=admin@sithospital.org matched seeded usr_adm_01 and flipped isDemoAccount=false. Fix: Preserved isDemoAccount=true for seeded accounts in DEMO_MODE=true while keeping DEMO_MODE=false hardened + added regression test.'],
                ['7', 'Gemini API key stayed Offline with yellow "endpoints busy" warning', 'Root Cause: Google deprecated gemini-2.5-flash & gemini-2.0-flash (404), and adminController left AI_EXTERNAL_PROCESSING=false on activation. Fix: Upgraded to Gemini 3.8 Flash / 3.5 Flash-Lite (confirmed live in 1.6s) + enabled runtime Admin opt-in activation.'],
                ['8', 'Light Mode had unreadable white/pastel text on white cards', 'Root Cause: Hardcoded dark-theme inline colors (#f8fafc, #fef3c7, #cbd5e1, #e2e8f0) broke Light Mode readability across AI Gateway, Ledger, Verification, and Shared pages. Fix: Replaced inline colors with semantic Light/Dark CSS classes while preserving Dark Mode 100%.'],
                ['9', 'Noticeable page lag & high CPU on Render Free Tier (0.1 vCPU)', 'Root Cause: ~5 MB uncompressed images, zero gzip compression, zero static cache headers, and un-debounced 5x disk backups + Firestore syncs on every audit log. Fix: Added Express compression, 7d /images cache, loading="lazy", lighter audit writes, and 1s debounced Firestore sync.'],
                ['10', 'GitHub Actions CI failed on npm test despite 46/46 passing locally', 'Root Cause: tests/cloud-persistence.test.cjs loaded config.js without test secrets; local runs read .env while CI runners have no .env. Fix: Added ephemeral CI test-only defaults when .env is absent -> 46/46 green on Ubuntu CI.']
            ],
            [22, 162, contentW - 184]
        );

        // =====================================================================
        // SECTION 6 — LIVE CLOUD & BLOCKCHAIN DEPLOYMENT EVIDENCE
        // =====================================================================
        sectionHeading('6', 'Live Deployment Evidence (Ethereum Sepolia, Firebase & Render)');
        bodyPara(
            'The figures below capture real production artifacts from our deployed infrastructure: confirmed on-chain smart contract execution on Ethereum Sepolia Etherscan, live Firebase Cloud Firestore persistence (Spark tier, nam5), and the live Render clinical portal.'
        );

        embedFigure(IMAGES.etherscan, 'Figure 3: Live Ethereum Sepolia Etherscan — Contract 0xE37266...9Ea5 Confirmed anchorDiagnosticReport Transaction (Block #12201078)', 205);
        embedFigure(IMAGES.firestore, 'Figure 4: Live Firebase Cloud Firestore (sit-students-hospital, Free Spark Plan, nam5) Provisioned for Persistent Cloud Vault', 195);
        embedFigure(IMAGES.labQueue, 'Figure 5: Live Render Portal — Lab Staff Pending Lab Test Orders Queue & Cryptographic Anchoring Workflow', 185);

        ensureSpace(130);
        subHeading('Confirmed On-Chain Transactions & Persisted Reports');
        drawTable(
            ['Record / Milestone', 'Identifier', 'Ethereum Sepolia Transaction Hash / Explorer Proof'],
            [
                ['Smart Contract Deploy', '0xE37266F644210b73d25b281866533a6E922F9Ea5', '0xb1c629faaab234fd71693fc7cdd2ddd4bb827fdf9ff45c61f7c5787f9418197a'],
                ['Ayesha Khan — CBC & AEC', 'REP-27A32017 (LABREQ-202 COMPLETED)', '0x587afffbeb5e0948b68323b36ad856d08d07c658d01c36b95ec1b53083766598'],
                ['John Doe — Blood Glucose', 'REP-3FABE924 (LABREQ-201 COMPLETED)', '0xfda1422d5af41d60bb6a835c7d8d7b08601400afd2a576ee4153058205f3af9b']
            ],
            [122, 150, contentW - 272]
        );

        // =====================================================================
        // SECTION 7 — NEW CAPABILITIES, KEY LEARNINGS & FUTURE SCOPE
        // =====================================================================
        sectionHeading('7', 'What Was Built New, Key Technical Learnings & Future Scope');

        subHeading('Key Technical Learnings');
        bulletItem('Privacy-First Blockchain Design', 'Learned why healthcare blockchains must keep medical files off-chain (encrypted via AES-256-GCM) and anchor only pseudonymous IDs + SHA-256 hashes on-chain to avoid leaking PII forever on a public ledger.');
        bulletItem('Authenticated Cryptography vs. Confidentiality-Only Encryption', 'Observed firsthand how AES-256-GCM authentication tags catch single-bit ciphertext tampering before decryption finishes, improving on legacy AES-256-CBC.');
        bulletItem('Distributed Startup Ordering on Ephemeral Cloud Hosts', 'Learned how subtle module-load side effects can create race conditions against remote databases on container cold starts, and how explicit hydration gates + coalescing queues guarantee durability.');
        bulletItem('Defense-in-Depth RBAC & Automated Verification', 'Combining middleware authentication, role allow-lists, per-record ownership helpers, and an automated Express route-guard test guarantees no endpoint is accidentally left public.');
        bulletItem('Production Resiliency & Graceful Fallbacks', 'Built dual-mode fallbacks across blockchain (Ethereum Sepolia -> local hash-chain), storage (Firebase GCS -> chunked Firestore -> local disk), and AI (Gemini 3.x Flash -> offline local NLP).');

        subHeading('Automated Verification Summary (46 / 46 Passing)');
        calloutBox(
            'Verified Automated Test Suites (npm test — Local Windows & GitHub Actions Ubuntu CI)',
            [
                '• Suite 1 — Audit Regression Suite: 20 / 20 PASS (Auth, RBAC role matrix, PII stripping, duplicate 409, F-15 Rx upload).',
                '• Suite 2 — Hardened Auth, Crypto & Integrity: 14 / 14 PASS (scrypt, 8-char access codes, 429 lockout, AES-GCM tamper, share revoke).',
                '• Suite 3 — Demo Mode, Migration, Solidity & Route Audit: 5 / 5 PASS (solc compile, CBC->GCM migration, gzip, route-guard scan).',
                '• Suite 4 — Firebase Cloud Persistence: 7 / 7 PASS (multi-chunk round-trip, Render wipe restore, v13 SDK init, debounce, hydration guard).'
            ],
            COLORS.greenSoft,
            COLORS.teal,
            COLORS.green
        );

        subHeading('Future Production Scope');
        bulletItem('Transactional Database & Object Storage', 'Migrate JSON state snapshots to PostgreSQL with ACID constraints and enable Firebase Cloud Storage / S3 (FIREBASE_STORAGE_BUCKET) for multi-gigabyte radiology imaging.');
        bulletItem('Care-Team Scoping, MFA & Strict CSP', 'Restrict Doctors to assigned care teams with break-glass auditing, add TOTP/WebAuthn MFA for Staff/Admin, and externalize inline HTML handlers to enforce strict Content Security Policy.');

        // =====================================================================
        // SECTION 8 — QUICK EVALUATION & DEMO REFERENCE APPENDIX
        // =====================================================================
        sectionHeading('8', 'Appendix — Live Demo & Viva Evaluation Quick Reference');
        bodyPara(
            'The synthetic demo accounts below are active only when DEMO_MODE=true for academic evaluation (one-click login cards are available on /portal and /reception). Newly registered patients always receive a unique Bill Number and an 8-character One-Time Access Code.'
        );

        drawTable(
            ['Role', 'Account Name', 'Login Identifier (Email / Bill / UHID)', 'Demo Password'],
            [
                ['Admin', 'Hospital IT Admin', 'admin@sithospital.org (or 1-click Demo)', 'Render env secret'],
                ['Receptionist', 'Priya Nair', 'reception@sithospital.org (/reception)', 'password123'],
                ['Lab Staff', 'Alex Smith', 'alex.lab@sithospital.org', 'password123'],
                ['Doctor (Cardio)', 'Dr. Sarah Rao', 'dr.sarah@sithospital.org', 'password123'],
                ['Doctor (Ortho)', 'Dr. Rajesh Nair', 'dr.rajesh@sithospital.org', 'password123'],
                ['Doctor (Pulmo)', 'Dr. Ananya Sen', 'dr.ananya@sithospital.org', 'password123'],
                ['Doctor (Neuro)', 'Dr. Vikram Mehta', 'dr.vikram@sithospital.org', 'password123'],
                ['Patient 1', 'John Doe', 'john.doe@sit.ac.in | BILL-2026-1001 | PT-9901', 'password123'],
                ['Patient 2', 'Meera Patel', 'meera.patel@sit.ac.in | BILL-2026-1002 | PT-9902', 'password123'],
                ['Patient 3', 'Robert Chen', 'robert.chen@sit.ac.in | BILL-2026-1003 | PT-9903', 'password123'],
                ['Patient 4', 'Ayesha Khan', 'ayesha.khan@sit.ac.in | BILL-2026-1004 | PT-9904', 'password123'],
                ['Patient 5', 'Sandeep R', 'sandeep.r.1006@sit.ac.in | BILL-2026-1006 | PT-9906', 'password123']
            ],
            [80, 92, 232, contentW - 404]
        );

        calloutBox(
            'Recommended 4-Step Live Viva Demonstration Flow',
            [
                '1. Reception (/reception): Register a brand-new patient -> show OPD Bill PDF + 8-char One-Time Access Code (72h expiry).',
                '2. Patient First Login (/portal): Sign in with Bill Number + Access Code -> demonstrate forced personal 10+ char password setup.',
                '3. Lab Staff Upload (/portal): Upload a fresh PDF/JPG -> show real Ethereum Sepolia TX on Etherscan -> re-upload same file to trigger HTTP 409 Duplicate Rejection.',
                '4. Admin Ledger & Health (/portal & /healthz): Show LIVE_EVM_ONCHAIN (Ethereum Sepolia Testnet) + FIREBASE_FIRESTORE_PERSISTENT + verify REP-27A32017 on /verify.html.'
            ],
            COLORS.amberSoft,
            '#f59e0b',
            COLORS.amber
        );

        // Add consistent running headers/footers on all content pages (pages 2..N) without triggering page breaks
        const range = doc.bufferedPageRange();
        const totalPages = range.count;
        for (let i = 1; i < totalPages; i++) {
            doc.switchToPage(i);
            const savedBottom = doc.page.margins.bottom;
            doc.page.margins.bottom = 0;

            doc.font('Helvetica').fontSize(7.8).fillColor(COLORS.slate500)
                .text('SIT Students Hospital Portal — Comprehensive Development Report & Backup Dossier', left, 22, { width: contentW - 85, lineBreak: false });
            doc.text('Dept. of CSE, SIT', left + contentW - 85, 22, { width: 85, align: 'right', lineBreak: false });
            doc.moveTo(left, 35).lineTo(left + contentW, 35).strokeColor(COLORS.slate200).lineWidth(0.5).stroke();

            doc.moveTo(left, pageH - 40).lineTo(left + contentW, pageH - 40).strokeColor(COLORS.slate200).lineWidth(0.5).stroke();
            doc.font('Helvetica').fontSize(7.8).fillColor(COLORS.slate500)
                .text('Live Portal: https://sit-students-hospital-portal.onrender.com/  •  Sepolia: 0xE37266...9Ea5', left, pageH - 31, { width: contentW - 75, lineBreak: false });
            doc.text(`Page ${i + 1} of ${totalPages}`, left + contentW - 75, pageH - 31, { width: 75, align: 'right', lineBreak: false });

            doc.page.margins.bottom = savedBottom;
        }

        doc.end();
        outStream.on('finish', () => resolve({ path: OUT_PDF, pages: totalPages }));
        outStream.on('error', reject);
    });
}

generateReportPDF()
    .then(res => console.log(`[Report PDF] Generated successfully: ${res.path} (${res.pages} pages)`))
    .catch(err => {
        console.error('[Report PDF Error]:', err);
        process.exit(1);
    });
