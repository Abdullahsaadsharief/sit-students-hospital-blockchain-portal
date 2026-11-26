const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const ROOT = path.resolve(__dirname, '..');
const OUT_PDF = path.join(ROOT, 'docs', 'SIT_Students_Hospital_Continuation_Report_Part2.pdf');

const ARTIFACT_IMG_DIR = 'C:/Users/abdul/.gemini/antigravity/brain/c6c30912-7ac9-4cb4-9850-cfd38bdf7392/.user_uploaded';
const IMAGES = {
    labQueueIssue: path.join(ARTIFACT_IMG_DIR, 'media_1795591716921_c3377680.jpg'),
    rxErrorIssue: path.join(ARTIFACT_IMG_DIR, 'media_1795591474363_0bf11142.jpg'),
    portalLoginUx: path.join(ARTIFACT_IMG_DIR, 'media_1795604065189_6efc2f5a.jpg')
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
    red: '#991b1b',
    redSoft: '#fef2f2',
    purple: '#5b21b6',
    purpleSoft: '#f5f3ff',
    slate900: '#0f172a',
    slate700: '#334155',
    slate500: '#64748b',
    slate200: '#e2e8f0',
    slate100: '#f8fafc',
    white: '#ffffff'
};

function generateContinuationPDF() {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 56, bottom: 56, left: 48, right: 48 },
            bufferPages: true,
            info: {
                Title: 'SIT Students Hospital Portal — Continuation Report (Part 2): Post-Deployment Fixes & Adversarial Bug Remediation',
                Author: 'Abdullah Saad Sharief (1SI24CS003) | Bug Testing by Harsh Kumar Singh (1SI24CS064)',
                Subject: 'Continuation of Project Development Report after Commit c7ee8f8 & Live Render Deployment'
            }
        });

        const outStream = fs.createWriteStream(OUT_PDF);
        doc.pipe(outStream);

        const pageW = doc.page.width;
        const pageH = doc.page.height;
        const left = 48;
        const contentW = pageW - 96;
        const bottomLimit = pageH - 50;

        function ensureSpace(neededHeight) {
            if (doc.y + neededHeight > bottomLimit) {
                doc.addPage();
            }
        }

        function sectionHeading(num, title) {
            doc.font('Helvetica-Bold').fontSize(13.5);
            const titleH = doc.heightOfString(`${num}. ${title}`, { width: contentW - 12 });
            ensureSpace(titleH + 30);
            doc.moveDown(0.3);
            const y = doc.y;
            doc.rect(left, y, 4, titleH + 4).fill(COLORS.teal);
            doc.font('Helvetica-Bold').fontSize(13.5).fillColor(COLORS.navy)
                .text(`${num}. ${title}`, left + 12, y + 1, { width: contentW - 12 });
            doc.moveTo(left, y + titleH + 7).lineTo(left + contentW, y + titleH + 7).strokeColor(COLORS.slate200).lineWidth(1).stroke();
            doc.y = y + titleH + 14;
        }

        function subHeading(title) {
            ensureSpace(26);
            doc.moveDown(0.22);
            doc.font('Helvetica-Bold').fontSize(10.2).fillColor(COLORS.blue)
                .text(title, left, doc.y, { width: contentW });
            doc.moveDown(0.18);
        }

        function bodyPara(text) {
            doc.font('Helvetica').fontSize(9.2).fillColor(COLORS.slate700)
                .text(text, left, doc.y, { width: contentW, align: 'justify', lineGap: 2.3 });
            doc.moveDown(0.32);
        }

        function bulletItem(lead, text) {
            ensureSpace(24);
            const y = doc.y;
            doc.circle(left + 5, y + 5, 2.2).fill(COLORS.teal);
            doc.font('Helvetica-Bold').fontSize(9.0).fillColor(COLORS.slate900)
                .text(`${lead}: `, left + 14, y, { width: contentW - 14, continued: true, lineGap: 2 });
            doc.font('Helvetica').fontSize(9.0).fillColor(COLORS.slate700)
                .text(text, { lineGap: 2 });
            doc.moveDown(0.2);
        }

        function calloutBox(title, lines, bg = COLORS.tealSoft, border = COLORS.teal, titleColor = COLORS.navy) {
            const textLines = Array.isArray(lines) ? lines : [lines];
            doc.font('Helvetica').fontSize(8.4);
            let h = 22;
            for (const ln of textLines) {
                h += doc.heightOfString(ln, { width: contentW - 24, lineGap: 1.7 }) + 2.5;
            }
            h += 6;
            ensureSpace(h + 6);
            const y = doc.y;
            doc.roundedRect(left, y, contentW, h, 4).fillAndStroke(bg, COLORS.slate200);
            doc.rect(left, y, 4, h).fill(border);
            doc.font('Helvetica-Bold').fontSize(9.1).fillColor(titleColor)
                .text(title, left + 12, y + 6, { width: contentW - 22 });
            let cy = y + 20;
            doc.font('Helvetica').fontSize(8.4).fillColor(COLORS.slate700);
            for (const ln of textLines) {
                const lh = doc.heightOfString(ln, { width: contentW - 24, lineGap: 1.7 });
                doc.text(ln, left + 12, cy, { width: contentW - 24, lineGap: 1.7 });
                cy += lh + 2.5;
            }
            doc.y = y + h + 6;
        }

        function drawTable(headers, rows, colWidths, options = {}) {
            const fontSize = options.fontSize || 7.9;
            const rowPadY = options.rowPadY || 4.5;
            const rowPadX = options.rowPadX || 5;

            doc.font('Helvetica-Bold').fontSize(fontSize + 0.1);
            let maxHdrH = 11;
            headers.forEach((h, idx) => {
                const hh = doc.heightOfString(String(h), { width: colWidths[idx] - rowPadX * 2, lineGap: 1.2 });
                if (hh > maxHdrH) maxHdrH = hh;
            });
            const headerH = maxHdrH + 10;

            function renderHeader() {
                ensureSpace(headerH + 22);
                const y = doc.y;
                doc.rect(left, y, contentW, headerH).fill(COLORS.navy);
                let cx = left;
                doc.font('Helvetica-Bold').fontSize(fontSize + 0.1).fillColor(COLORS.white);
                headers.forEach((h, idx) => {
                    doc.text(h, cx + rowPadX, y + 5, { width: colWidths[idx] - rowPadX * 2, lineGap: 1.2 });
                    cx += colWidths[idx];
                });
                doc.y = y + headerH;
            }

            renderHeader();

            rows.forEach((row, rIdx) => {
                let maxH = 12;
                row.forEach((cell, idx) => {
                    const isBoldCell = idx === 0 || (options.highlightStatusCols && options.highlightStatusCols.includes(idx)) || options.severityCol === idx;
                    doc.font(isBoldCell ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
                    const ch = doc.heightOfString(String(cell), { width: colWidths[idx] - rowPadX * 2, lineGap: 1.4 });
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
                    const cellStr = String(cell);
                    let fill = idx === 0 ? COLORS.slate900 : COLORS.slate700;
                    let font = idx === 0 ? 'Helvetica-Bold' : 'Helvetica';

                    if (options.highlightStatusCols && options.highlightStatusCols.includes(idx)) {
                        font = 'Helvetica-Bold';
                        if (cellStr.startsWith('PASS')) fill = COLORS.green;
                        else if (cellStr.startsWith('FAIL')) fill = COLORS.red;
                    }
                    if (options.severityCol === idx) {
                        font = 'Helvetica-Bold';
                        if (cellStr === 'CRITICAL') fill = COLORS.red;
                        else if (cellStr === 'HIGH') fill = COLORS.amber;
                        else if (cellStr === 'MEDIUM') fill = COLORS.blue;
                        else fill = COLORS.slate500;
                    }

                    doc.font(font)
                        .fontSize(fontSize)
                        .fillColor(fill)
                        .text(cellStr, cx + rowPadX, y + rowPadY, {
                            width: colWidths[idx] - rowPadX * 2,
                            lineGap: 1.4
                        });
                    cx += colWidths[idx];
                });
                doc.y = y + rowH;
            });
            doc.moveDown(0.28);
        }

        function embedFigure(imgPath, caption, maxH = 195) {
            if (!imgPath || !fs.existsSync(imgPath)) return;
            ensureSpace(maxH + 36);
            const y = doc.y;
            const boxH = maxH + 26;
            doc.roundedRect(left, y, contentW, boxH, 5).fillAndStroke(COLORS.slate100, COLORS.slate200);
            try {
                doc.image(imgPath, left + 10, y + 7, {
                    fit: [contentW - 20, maxH - 6],
                    align: 'center',
                    valign: 'center'
                });
            } catch (err) {
                doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.slate500)
                    .text(`[Image could not be embedded: ${path.basename(imgPath)}]`, left + 16, y + 20);
            }
            doc.font('Helvetica-Bold').fontSize(8.0).fillColor(COLORS.navy)
                .text(caption, left + 10, y + maxH + 5, { width: contentW - 20, align: 'center' });
            doc.y = y + boxH + 8;
        }

        // =====================================================================
        // PAGE 1 — CONTINUATION REPORT COVER PAGE
        // =====================================================================
        doc.rect(0, 0, pageW, 205).fill(COLORS.navy);
        doc.rect(0, 205, pageW, 6).fill(COLORS.teal);

        doc.font('Helvetica-Bold').fontSize(10).fillColor('#99f6e4')
            .text('SIDDAGANGA INSTITUTE OF TECHNOLOGY (SIT), TUMAKURU', left, 38, { width: contentW, align: 'center' });
        doc.font('Helvetica').fontSize(9.5).fillColor('#cbd5e1')
            .text('Department of Computer Science & Engineering  •  5th Semester (3rd Year) Mini Project', left, 54, { width: contentW, align: 'center' });

        // Continuation Pill Badge (single crisp line)
        const pillW = 390;
        const pillX = (pageW - pillW) / 2;
        doc.roundedRect(pillX, 74, pillW, 20, 10).fill('#0f766e');
        doc.font('Helvetica-Bold').fontSize(8.2).fillColor(COLORS.white)
            .text('CONTINUATION OF PREVIOUS PROJECT REPORT  •  PART 2 (POST-COMMIT c7ee8f8)', pillX, 80, { width: pillW, align: 'center' });

        doc.font('Helvetica-Bold').fontSize(21).fillColor(COLORS.white)
            .text('SIT Students Hospital Portal', left, 106, { width: contentW, align: 'center' });
        doc.font('Helvetica').fontSize(11.5).fillColor('#e2e8f0')
            .text('Post-Deployment Clinical Upgrades, UI Refinements & Adversarial Bug Remediation', left, 134, { width: contentW, align: 'center' });
        doc.font('Helvetica-Bold').fontSize(9.2).fillColor('#5eead4')
            .text('POST-LAUNCH ENGINEERING LOG  •  BUG TESTING BY HARSH KUMAR SINGH (1SI24CS064)  •  FIXES BY ABDULLAH SAAD SHARIEF (1SI24CS003)', left, 164, { width: contentW, align: 'center' });

        doc.y = 228;

        // Continuation Overview Banner
        calloutBox(
            'Scope: Continuation After Previous Project Report (Commit c7ee8f8 -> Commit 2130a37)',
            [
                'This report is the direct continuation of SIT_Students_Hospital_Project_Report.pdf (generated at commit c7ee8f8 on November 25, 2026).',
                'It documents every feature enhancement, clinical workflow fix, UI polish, adversarial bug discovery, and security patch completed after the portal was committed and went live on Render, Ethereum Sepolia Testnet, and Firebase Firestore (6 new commits: 788412a through 2130a37).'
            ],
            COLORS.tealSoft,
            COLORS.teal,
            COLORS.navy
        );

        // 4 Key Metric Cards
        const metrics = [
            { val: '6 New Commits', lbl: 'Post-c7ee8f8 (Nov 25-26)' },
            { val: '20 / 20 Fixed', lbl: 'Adversarial Bugs Patched' },
            { val: '25/25 + 49/49', lbl: 'Bug-Hunter & CI Tests PASS' },
            { val: '15 / 15 Valid', lbl: 'Live Firebase Chain Intact' }
        ];
        const mW = (contentW - 18) / 4;
        const mY = doc.y + 4;
        metrics.forEach((m, i) => {
            const mx = left + i * (mW + 6);
            doc.roundedRect(mx, mY, mW, 54, 5).fillAndStroke(COLORS.blueSoft, COLORS.slate200);
            doc.font('Helvetica-Bold').fontSize(11.5).fillColor(COLORS.navy).text(m.val, mx + 4, mY + 11, { width: mW - 8, align: 'center' });
            doc.font('Helvetica').fontSize(7.6).fillColor(COLORS.slate500).text(m.lbl, mx + 4, mY + 32, { width: mW - 8, align: 'center' });
        });
        doc.y = mY + 70;

        // Clear Role Attribution Box (dynamic heights so zero overlap!)
        const attrY = doc.y;
        const attrTextW = contentW - 28;
        const devDesc = 'Abdullah Saad Sharief (1SI24CS003) — Implemented all post-deployment clinical fixes (lab queue safe removal, prescription PDF overhaul, encrypted Firestore Gemini API key persistence, portal navigation & custom favicon), analyzed all 25 test cases, and engineered all 20 bug-hunter security & reliability fixes (commits 788412a to 2130a37) with live Render verification.';
        const qaDesc = 'Harsh Kumar Singh (1SI24CS064) — Conducted adversarial security and reliability bug testing using a 25-case Jenkins Bug-Hunter Pipeline (BUG-001 through BUG-025), capturing 20 concrete edge-case, cryptographic, blockchain, Solidity, concurrency, and OCR DoS crash bugs against the repository.';

        doc.font('Helvetica').fontSize(9.0);
        const devDescH = doc.heightOfString(devDesc, { width: attrTextW, lineGap: 2 });
        const qaDescH = doc.heightOfString(qaDesc, { width: attrTextW, lineGap: 2 });
        const attrH = 30 + 15 + devDescH + 12 + 15 + qaDescH + 12;

        doc.roundedRect(left, attrY, contentW, attrH, 6).fillAndStroke(COLORS.amberSoft, COLORS.amberBorder);
        doc.rect(left, attrY, 5, attrH).fill('#f59e0b');
        doc.font('Helvetica-Bold').fontSize(10.0).fillColor(COLORS.amber)
            .text('CONTRIBUTION & AUTHORSHIP ATTRIBUTION (PART 2 CONTINUATION)', left + 16, attrY + 11, { width: attrTextW });

        let ay = attrY + 30;
        doc.font('Helvetica-Bold').fontSize(9.1).fillColor(COLORS.slate900)
            .text('Continuation Development, Post-Launch Fixes & All 20 Bug Remediations:', left + 16, ay, { width: attrTextW });
        ay += 14;
        doc.font('Helvetica').fontSize(9.0).fillColor(COLORS.slate700)
            .text(devDesc, left + 16, ay, { width: attrTextW, lineGap: 2 });
        ay += devDescH + 11;

        doc.font('Helvetica-Bold').fontSize(9.1).fillColor(COLORS.slate900)
            .text('Bug Testing by Harsh Kumar Singh (1SI24CS064):', left + 16, ay, { width: attrTextW });
        ay += 14;
        doc.font('Helvetica').fontSize(9.0).fillColor(COLORS.slate700)
            .text(qaDesc, left + 16, ay, { width: attrTextW, lineGap: 2 });

        doc.y = attrY + attrH + 14;

        // Project Team & Guide Box (matching Part 1 style)
        const metaY = doc.y;
        doc.roundedRect(left, metaY, contentW, 122, 6).fillAndStroke(COLORS.slate100, COLORS.slate200);
        doc.font('Helvetica-Bold').fontSize(9.8).fillColor(COLORS.navy).text('PROJECT TEAM MEMBERS', left + 16, metaY + 12);
        doc.font('Helvetica').fontSize(9.3).fillColor(COLORS.slate700)
            .text('• Abdullah Saad Sharief   (1SI24CS003)  [Lead Fixes & Continuation]', left + 16, metaY + 30)
            .text('• Harsh Kumar Singh       (1SI24CS064)  [Adversarial Bug Testing]', left + 16, metaY + 46)
            .text('• H Abhishek                  (1SI25CS404)  [Project Team Member]', left + 16, metaY + 62);

        doc.font('Helvetica-Bold').fontSize(9.8).fillColor(COLORS.navy).text('FACULTY SUPERVISION', left + 310, metaY + 12);
        doc.font('Helvetica').fontSize(9.3).fillColor(COLORS.slate700)
            .text('Project Guide: Mrs. Nidhi L. G.', left + 310, metaY + 30)
            .text('Asst. Professor, Dept. of CSE, SIT', left + 310, metaY + 46)
            .text('Panel Convener: Dr. R. Sumathi', left + 310, metaY + 62);

        doc.moveTo(left + 16, metaY + 84).lineTo(left + contentW - 16, metaY + 84).strokeColor(COLORS.slate200).stroke();
        doc.font('Helvetica-Bold').fontSize(8.3).fillColor(COLORS.teal)
            .text('Live Website: https://sit-students-hospital-portal.onrender.com/  (Commit 2130a37 LIVE)', left + 16, metaY + 92)
            .text('Ethereum Sepolia Contract: 0xE37266F644210b73d25b281866533a6E922F9Ea5   |   Cloud DB: Firebase Firestore', left + 16, metaY + 105);

        doc.y = metaY + 138;
        doc.font('Helvetica').fontSize(8.4).fillColor(COLORS.slate500)
            .text('Continuation Report Generated: November 26, 2026  •  GitHub: github.com/Abdullahsaadsharief/sit-students-hospital-blockchain-portal', left, doc.y, { width: contentW, align: 'center' });

        // =====================================================================
        // PAGE 2 — CONTINUATION COMMIT LOG & POST-LAUNCH CLINICAL FIXES
        // =====================================================================
        doc.addPage();
        sectionHeading('1', 'Continuation Timeline (Commits 788412a to 2130a37)');
        bodyPara(
            'The previous report (SIT_Students_Hospital_Project_Report.pdf, commit c7ee8f8) documented the first 40 commits through initial Render, Ethereum Sepolia, and Firebase Firestore deployment. Once the portal went live and real clinical end-to-end walkthroughs and adversarial testing began, six targeted engineering commits were authored, tested, and shipped to production:'
        );

        drawTable(
            ['Commit & Date', 'Scope', 'Attribution', 'Engineering Milestone Delivered'],
            [
                [
                    '788412a\nNov 25, 2026',
                    '6 files\n+226 / -17',
                    'Abdullah Saad Sharief\n(1SI24CS003)',
                    'Added safe Pending Lab Test Orders Queue removal (DELETE /api/lab-requests/:requestId) with 3-layer double-click/mis-click protection, duplicate pending lab order guard, and automated regression tests.'
                ],
                [
                    'eff049d\nNov 25, 2026',
                    '10 files\n+728 / -147',
                    'Abdullah Saad Sharief\n(1SI24CS003)',
                    'Fixed Prescription PDF downloads (60s Blob keep-alive, toast + spinner, #prescriptionPdfModal preview/print modal, non-overlapping PDFKit layout) and engineered AES-256-GCM encrypted Gemini API key cloud persistence (utils/aiConfigStore.js).'
                ],
                [
                    'fd0b518\nNov 25, 2026',
                    '2 files\n+33 / -6',
                    'Abdullah Saad Sharief\n(1SI24CS003)',
                    'Wired savePersistedAiConfig() hook in controllers/adminController.js and added live cloud-persisted status indicator in the Admin AI Gateway card so saved keys survive Render restarts.'
                ],
                [
                    'cbcd52b\nNov 25, 2026',
                    '2 files\n+89 / -3',
                    'Abdullah Saad Sharief\n(1SI24CS003)',
                    'Made the /portal login logo clickable to return directly to the public hospital homepage (/) and added a dedicated Receptionist Sign-In tab alongside Patient Sign-In.'
                ],
                [
                    '8d3ff5f\nNov 25, 2026',
                    '11 files\n+46 / -0',
                    'Abdullah Saad Sharief\n(1SI24CS003)',
                    'Created custom SIT Students Hospital vector SVG and ICO browser tab favicons (public/favicon.svg, public/favicon.ico) and linked them across all 9 HTML pages.'
                ],
                [
                    '2130a37\nNov 26, 2026',
                    '12 files\n+285 / -62',
                    'Testing: Harsh Kumar Singh (1SI24CS064)\nFixes: Abdullah Saad Sharief (1SI24CS003)',
                    'Patched all 20 failing adversarial bug-hunter tests (BUG-001 to BUG-025): scrypt hex guard, password rules, role filter, share link validation & audit, Genesis/PoW/canonical hashing, Solidity guards, TOCTOU lock, dot-path routing, MIT license, and OCR crash-DoS shield.'
                ]
            ],
            [72, 56, 114, contentW - 242],
            { fontSize: 7.7 }
        );

        sectionHeading('2', 'Post-Deployment Clinical Fixes, Cloud AI Persistence & UI Refinements');
        bodyPara(
            'All five post-launch functional and UX enhancements below were engineered by Abdullah Saad Sharief (1SI24CS003) directly in response to live production usage on Render (sit-students-hospital-portal.onrender.com):'
        );

        subHeading('2.1 Safe Lab Orders Queue Removal & 3-Layer Mis-Click Protection (788412a)');
        bodyPara(
            'During live clinical walkthroughs, duplicate pending lab orders (for example, two identical Complete Blood Count orders LABREQ-864775 and LABREQ-759691 for patient Rohan Kulkarni) could accumulate in the Pending Lab Test Orders Queue without a safe removal mechanism. We implemented DELETE /api/lab-requests/:requestId (RBAC-restricted to Doctor, Lab Staff, Receptionist, and Admin) that allows deleting only PENDING_UPLOAD requests while returning HTTP 409 Conflict if anyone attempts to remove an already-uploaded or blockchain-anchored report.'
        );
        bulletItem('3-Layer Accidental Double-Click Guard', 'Clicking "Remove" first enters a confirmation state with a 700 ms cooldown lock so an accidental rapid double-click cannot confirm deletion, followed by an in-flight disabled lock while the API call executes.');
        bulletItem('Duplicate Pending Order Prevention', 'Added server-side duplicate pending order checks in controllers/adminController.js so doctors and receptionists cannot accidentally queue identical pending tests back-to-back.');

        embedFigure(IMAGES.labQueueIssue, 'Figure 1: Live Render Lab Queue Screenshot Showing Duplicate Pending CBC Orders (LABREQ-864775 & LABREQ-759691) Resolved by Commit 788412a', 195);

        subHeading('2.2 Prescription PDF Download Fix, Preview Modal & Encrypted Gemini Key Vault (eff049d, fd0b518)');
        bodyPara(
            'Live patient testing revealed silent download stalls on "Download Prescription PDF", occasional checkup submission fetch errors, and loss of the Admin Gemini API key whenever Render spun down idle containers. Two architectural upgrades resolved all three issues permanently:'
        );
        bulletItem('Prescription PDF Reliability & Inline Modal', 'Added a 60-second Blob URL keep-alive, active button spinner + toast confirmation, a new inline #prescriptionPdfModal (Preview / Print / Download), full-width patient prescription cards, and dynamic height calculation in utils/pdfGenerator.js so multi-medicine prescriptions never overlap.');
        bulletItem('Permanent Encrypted Gemini API Key Persistence', 'Built utils/aiConfigStore.js to encrypt the Admin-entered Gemini API key using AES-256-GCM and persist it in Firebase Firestore (sit_hospital_state/ai_config). On every Render cold start, server.js hydrates and decrypts the key automatically — eliminating repeated re-uploads.');

        embedFigure(IMAGES.rxErrorIssue, 'Figure 2: Live Doctor Checkup & Prescription Testing Capture Leading to Prescription PDF Overhaul & Preview Modal (Commit eff049d)', 195);

        subHeading('2.3 Portal Login UX Enhancements & Custom SIT Hospital Browser Favicon (cbcd52b, 8d3ff5f)');
        bodyPara(
            'To improve navigation and institutional branding across the deployed Render site, the SIT Students Hospital emblem on /portal was converted into a direct homepage link (/), a dedicated Receptionist Sign-In tab was added alongside Patient Sign-In, and custom vector SVG + ICO favicons (public/favicon.svg, public/favicon.ico) were added to all 9 HTML pages to replace the default browser globe tab icon.'
        );

        embedFigure(IMAGES.portalLoginUx, 'Figure 3: Live /portal Login Screen Highlighting Brand Header Logo Navigation, Tab Bar & Browser Favicon Upgrade (Commits cbcd52b & 8d3ff5f)', 190);

        // =====================================================================
        // SECTION 3 — ADVERSARIAL BUG TESTING BY HARSH KUMAR SINGH (1SI24CS064)
        // =====================================================================
        sectionHeading('3', 'Adversarial Bug Testing by Harsh Kumar Singh (1SI24CS064)');
        bodyPara(
            'Following deployment, Harsh Kumar Singh (1SI24CS064) conducted dedicated adversarial security and reliability testing against the repository using a Jenkins CI Bug-Hunter Pipeline ("sit-hospital-bug-hunter"). Unlike standard happy-path functional tests, this 25-case test suite (BUG-001 through BUG-025) specifically probed for cryptographic bypasses, server-crashing malformed uploads, asynchronous concurrency race conditions, blockchain verification loopholes, Solidity input gaps, and input coercion flaws.'
        );

        calloutBox(
            'Adversarial Bug-Hunter Test Run Summary (Bug Testing by Harsh Kumar Singh, 1SI24CS064)',
            [
                '• Test Harness: Jenkins Declarative Pipeline executing tests/bug-hunter.test.cjs (Node.js native test runner) across 5 adversarial suites.',
                '• Baseline Run (Initial Bug Discovery):  5 / 25 PASSED   |   20 / 25 FAILED  (Confirmed 20 Real Bugs: 1 Critical, 2 High, 14 Medium, 3 Low).',
                '• Post-Remediation Run (After Fixes by Abdullah Saad Sharief, 1SI24CS003 — Commit 2130a37):  25 / 25 PASSED (100%)   |   0 FAILED.',
                '• Regression Safety Verification:  49 / 49 Project CI Tests (npm test) PASSED   |   15 / 15 Live Firebase Blockchain Blocks VALID.'
            ],
            COLORS.purpleSoft,
            COLORS.purple,
            COLORS.purple
        );

        subHeading('Severity Distribution of Bugs Discovered & Patched');
        drawTable(
            ['Severity Tier', 'Total Tested', 'Already Secure (Baseline PASS)', 'Bugs Found by Harsh Kumar Singh (FAIL)', 'Fixed by Abdullah Saad Sharief', 'Final Status'],
            [
                ['CRITICAL', '1', '0', '1 (BUG-025: Malformed PNG OCR Server Crash DoS)', '1 / 1 Fixed', 'PASS (100%)'],
                ['HIGH', '6', '4 (BUG-002, 008, 021, 022)', '2 (BUG-001 Crypto Bypass, BUG-020 Async Race)', '2 / 2 Fixed', 'PASS (100%)'],
                ['MEDIUM', '15', '1 (BUG-010 Ledger Nodes)', '14 (Auth, Share, Ledger PoW/Genesis, Solidity, Dot-Path)', '14 / 14 Fixed', 'PASS (100%)'],
                ['LOW', '3', '0', '3 (BUG-007 Array Coercion, BUG-015 Key Order, BUG-024 MIT)', '3 / 3 Fixed', 'PASS (100%)'],
                ['TOTAL', '25', '5 (20%)', '20 Confirmed Defects (80%)', '20 / 20 Fixed', '25 / 25 PASS']
            ],
            [62, 54, 108, 134, 72, contentW - 430],
            { fontSize: 7.7, highlightStatusCols: [5], severityCol: 0 }
        );

        // =====================================================================
        // SECTION 4 — COMPLETE 25-CASE BUG-HUNTER AUDIT & REMEDIATION MATRIX
        // =====================================================================
        doc.addPage();
        sectionHeading('4', 'Complete 25-Case Bug-Hunter Remediation Matrix (BUG-001 to BUG-025)');
        bodyPara(
            'Every single test case from Harsh Kumar Singh\'s Jenkins adversarial suite is catalogued below alongside its baseline result, root cause, and the verified remediation engineered by Abdullah Saad Sharief (1SI24CS003) in commit 2130a37:'
        );

        drawTable(
            ['ID', 'Sev.', 'Target File', 'Bug / Test Case (Harsh Kumar Singh)', 'Before', 'Fix Implemented (Abdullah Saad Sharief)', 'After'],
            [
                ['BUG-001', 'HIGH', 'utils/passwords.js', 'Non-hex derived hash tail caused 0-byte Buffer timingSafeEqual bypass', 'FAIL', 'Validated scrypt integer params & strict even-length hex (>=32B) before Buffer.from(..., "hex").', 'PASS'],
                ['BUG-002', 'HIGH', 'utils/passwords.js', 'Empty derived hash tail must be rejected', 'PASS', 'Already rejected empty hash tail; further reinforced by strict hex regex guard.', 'PASS'],
                ['BUG-003', 'MEDIUM', 'authController.js', '10-space whitespace-only password accepted in change-password', 'FAIL', 'Added newPassword.trim().length < 10 check returning HTTP 400.', 'PASS'],
                ['BUG-004', 'MEDIUM', 'authController.js', 'Reusing exact current password accepted in change-password', 'FAIL', 'Checked verifyPassword(newPassword, user.passwordHash) and rejected reuse with HTTP 400.', 'PASS'],
                ['BUG-005', 'MEDIUM', 'authController.js', 'GET /api/auth/users?role=Doctor ignored ?role= query filter', 'FAIL', 'Added optional case-insensitive ?role= filtering while keeping unfiltered UI responses intact.', 'PASS'],
                ['BUG-006', 'MEDIUM', 'shareController.js', 'Boolean durationMinutes: true coerced to 1 via Number(true)', 'FAIL', 'Accepted only finite integers or clean /^\\d+$/ strings in range 1..1440; rejected booleans (400).', 'PASS'],
                ['BUG-007', 'LOW', 'shareController.js', 'Array durationMinutes: [60] coerced to 60 via Number([60])', 'FAIL', 'Explicitly rejected array/object/null durationMinutes with HTTP 400.', 'PASS'],
                ['BUG-008', 'HIGH', 'shareController.js', 'Tampered .bin file on share download must return 400 Tamper', 'PASS', 'Already detected by AES-256-GCM auth tag verification returning HTTP 400.', 'PASS'],
                ['BUG-009', 'MEDIUM', 'shareController.js', 'GET /api/share/download wrote zero audit log entries', 'FAIL', 'Added db.logAudit("SHARED_LINK_DOWNLOADED", ...) on every decrypted shared download.', 'PASS'],
                ['BUG-010', 'MEDIUM', 'blockchainController.js', 'GET /api/blockchain/ledger must return defined nodes array', 'PASS', 'Already fixed in prior milestone; returns active department nodes array.', 'PASS'],
                ['BUG-011', 'MEDIUM', 'blockchainController.js', 'tamper-demo with blockIndex: 0 coerced via "|| 1" to tamper block 1', 'FAIL', 'Replaced "|| 1" coercion with strict Number.isInteger check so blockIndex: 0 returns HTTP 400.', 'PASS'],
                ['BUG-012', 'MEDIUM', 'Blockchain.js', 'isChainValid() started at i=1, missing Genesis block tampering', 'FAIL', 'Validated starting at i=0 so Genesis tampering is detected; checked prev links for i>0.', 'PASS'],
                ['BUG-013', 'MEDIUM', 'Blockchain.js', 'isChainValid() accepted unmined forged block lacking PoW zeros', 'FAIL', 'Enforced Proof-of-Work leading zero prefix ("0".repeat(difficulty)) for mined blocks.', 'PASS'],
                ['BUG-014', 'MEDIUM', 'Blockchain.js', 'simulateTampering(NaN) crashed with unhandled TypeError', 'FAIL', 'Added !Number.isInteger(blockIndex) validation throwing a clean Error instead of TypeError.', 'PASS'],
                ['BUG-015', 'LOW', 'Block.js', 'calculateHash() depended on JSON key insertion order', 'FAIL', 'Implemented recursive sorted-key canonicalStringify() + legacy hash fallback for existing blocks.', 'PASS'],
                ['BUG-016', 'MEDIUM', 'SITStudentsHospitalLedger.sol', 'anchorDiagnosticReport lacked empty-string require() guards', 'FAIL', 'Added require(bytes(_reportId/_sourceHash/_reportHash).length > 0) guards; verified solc build.', 'PASS'],
                ['BUG-017', 'MEDIUM', 'SITStudentsHospitalLedger.sol', 'authorizeDepartmentNode allowed authorizing address(0)', 'FAIL', 'Added require(nodeAddress != address(0), ...) check in Solidity contract.', 'PASS'],
                ['BUG-018', 'MEDIUM', 'SITStudentsHospitalLedger.sol', 'verifyReportIntegrity checked only reportHash, ignoring sourceHash', 'FAIL', 'Updated verifyReportIntegrity to match either reportHash or sourceHash (same ABI).', 'PASS'],
                ['BUG-019', 'MEDIUM', 'adminController.js', 'Reception registration ignored duplicate custom patientId (UHID)', 'FAIL', 'Supported custom patientId/billNumber and rejected duplicate UHID with HTTP 409 Conflict.', 'PASS'],
                ['BUG-020', 'HIGH', 'reportController.js', 'Async TOCTOU race: awaited RPC before adding inFlightSourceHashes', 'FAIL', 'Synchronously checked & reserved inFlightSourceHashes BEFORE awaiting isHashAnchoredOnChain().', 'PASS'],
                ['BUG-021', 'HIGH', 'reportController.js', 'uploadReport must include inline defense-in-depth RBAC guard', 'PASS', 'Already implemented inside reportController.js.', 'PASS'],
                ['BUG-022', 'HIGH', 'models/db.js', 'persist() must use atomic temp-file rename (atomicWriteJsonSync)', 'PASS', 'Already implemented via utils/atomicFile.js.', 'PASS'],
                ['BUG-023', 'MEDIUM', 'server.js', 'res.sendFile() 404s under dot-prefixed paths like .jenkins', 'FAIL', 'Passed { dotfiles: "allow" } on explicit hardcoded HTML res.sendFile routes only.', 'PASS'],
                ['BUG-024', 'LOW', 'package.json', 'package.json declared "ISC" instead of "MIT" matching LICENSE', 'FAIL', 'Updated package.json license field to "MIT".', 'PASS'],
                ['BUG-025', 'CRITICAL', 'utils/ocrHelper.js', 'Uploading truncated/malformed PNG crashed server.js via Tesseract DoS', 'FAIL', 'Added PNG/JPEG/WEBP chunk structure validator + isolated Tesseract createWorker() with errorHandler & terminate().', 'PASS']
            ],
            [40, 40, 86, 114, 33, 153, 33],
            { fontSize: 6.75, rowPadY: 2.5, rowPadX: 3.5, highlightStatusCols: [4, 6], severityCol: 1 }
        );

        calloutBox(
            'Zero-Breakage Live Compatibility Engineering (Protecting Existing Firebase Data & Sepolia Contract)',
            [
                '1. Live Firebase Ledger Compatibility (BUG-012, BUG-013, BUG-015): All 15 existing blocks persisted in Firebase Firestore were mined with unsorted JSON.stringify() payloads. By adopting deterministic sorted-key canonicalStringify() for all newly mined blocks while allowing calculateLegacyHash() verification on pre-existing blocks, BUG-015 passed 100% AND all 15 live production ledger blocks remained VALID without breaking history.',
                '2. Smart Contract ABI Continuity (BUG-016, BUG-017, BUG-018): All three Solidity hardening guards compiled cleanly via solc (10 ABI functions) while keeping identical external function signatures so the live Ethereum Sepolia contract (0xE37266F644210b73d25b281866533a6E922F9Ea5) continues operating without disruption.',
                '3. Critical Remote DoS Elimination (BUG-025): Previously, uploading a 29-byte truncated PNG with a valid PNG header caused Tesseract.js WASM to throw an uncaught worker exception that killed the entire Node.js server. Pre-validating PNG (IHDR/IDAT/IEND), JPEG (SOI/EOI), and WEBP RIFF structures plus isolating Tesseract in a dedicated worker with an explicit errorHandler completely neutralizes the crash vector.'
            ],
            COLORS.greenSoft,
            COLORS.teal,
            COLORS.green
        );

        // =====================================================================
        // SECTION 5 — POST-FIX TEST VERIFICATION & LIVE PRODUCTION AUDIT
        // =====================================================================
        sectionHeading('5', 'Post-Fix Automated Test Runs & Live Render Production Verification');
        bodyPara(
            'Before closing this continuation phase, commit 2130a37 was verified across three independent layers: (1) re-execution of Harsh Kumar Singh\'s complete 25-test Jenkins bug-hunter suite, (2) execution of the full 49-test project automated regression suite (npm test), and (3) live HTTPS probing of the auto-deployed Render production portal and Firebase Firestore database.'
        );

        drawTable(
            ['Verification Gate', 'Command / Target', 'Verified Result', 'Key Technical Proof'],
            [
                [
                    '1. Adversarial Bug-Hunter Suite\n(Harsh Kumar Singh, 1SI24CS064)',
                    'node --test bug-hunter.test.cjs\n(BUG-001 through BUG-025)',
                    'PASS\n25 / 25 (100%)',
                    'Improved from 5/25 baseline to 25/25 GREEN in 6.19s (0 failed, 0 skipped), including Critical BUG-025 OCR DoS survival test.'
                ],
                [
                    '2. Full Project Test Suite\n(Security, API & Cloud CI)',
                    'npm test\n(api.test.cjs + cloud-persistence)',
                    'PASS\n49 / 49 (100%)',
                    'Expanded from 46/46 in Part 1 to 49/49 GREEN in 12.30s (+3 new tests covering lab queue removal, Rx PDFs & encrypted Gemini key persistence).'
                ],
                [
                    '3. Solidity Smart Contract\n(HospitalLedger.sol)',
                    'solc compiler verification\n(BUG-016, 017, 018)',
                    'PASS\n0 Errors',
                    'Compiled cleanly (10 ABI functions, 10,072 bytecode chars) with zero ABI regressions against live Sepolia deployment.'
                ],
                [
                    '4. Live Render Health & UI\n(sit-students-hospital-portal)',
                    'GET /healthz, /, /portal,\n/reception, /favicon.svg',
                    'PASS\nAll HTTP 200',
                    'Confirmed LIVE_EVM_ONCHAIN (Ethereum Sepolia Testnet) + FIREBASE_FIRESTORE_PERSISTENT + custom SVG favicon active.'
                ],
                [
                    '5. Live Firebase Ledger & APIs\n(Production Data Integrity)',
                    'GET /api/blockchain/ledger,\n/api/auth/users?role=Doctor,\n/api/reports, /api/prescriptions',
                    'PASS\n15 / 15 VALID',
                    'All 15 live Firestore blocks verified isChainValid: true; ?role=Doctor returned 4/4 Doctors confirming commit 2130a37 live; zero UI/API regressions.'
                ]
            ],
            [126, 114, 70, contentW - 310],
            { fontSize: 7.3, rowPadY: 3.0, highlightStatusCols: [2] }
        );

        calloutBox(
            'Jenkins Re-Run & Fork Synchronization Note',
            [
                '• Production Repository (Updated with Commit 2130a37): https://github.com/Abdullahsaadsharief/sit-students-hospital-blockchain-portal (branch: main)',
                '• Re-running Harsh Kumar Singh\'s "sit-hospital-bug-hunter" Jenkins pipeline against main (or syncing harshkumarsingh400-droid/sit-students-hospital-blockchain-portal from upstream main) turns all 25 / 25 bug-hunter tests GREEN while preserving 100% UI, Sepolia blockchain, and Firebase Firestore functionality.'
            ],
            COLORS.blueSoft,
            COLORS.blue,
            COLORS.navy
        );

        // Add consistent running headers/footers on pages 2..N without triggering extra pages
        const range = doc.bufferedPageRange();
        const totalPages = range.count;
        for (let i = 1; i < totalPages; i++) {
            doc.switchToPage(i);
            const savedBottom = doc.page.margins.bottom;
            doc.page.margins.bottom = 0;

            doc.font('Helvetica').fontSize(7.6).fillColor(COLORS.slate500)
                .text('SIT Students Hospital Portal — Continuation Report (Part 2)  •  Post-Commit c7ee8f8 & Bug Remediation', left, 22, { width: contentW - 85, lineBreak: false });
            doc.text('Dept. of CSE, SIT', left + contentW - 85, 22, { width: 85, align: 'right', lineBreak: false });
            doc.moveTo(left, 35).lineTo(left + contentW, 35).strokeColor(COLORS.slate200).lineWidth(0.5).stroke();

            doc.moveTo(left, pageH - 40).lineTo(left + contentW, pageH - 40).strokeColor(COLORS.slate200).lineWidth(0.5).stroke();
            doc.font('Helvetica').fontSize(7.6).fillColor(COLORS.slate500)
                .text('Fixes: Abdullah Saad Sharief (1SI24CS003)  •  Bug Testing: Harsh Kumar Singh (1SI24CS064)', left, pageH - 31, { width: contentW - 75, lineBreak: false });
            doc.text(`Page ${i + 1} of ${totalPages}`, left + contentW - 75, pageH - 31, { width: 75, align: 'right', lineBreak: false });

            doc.page.margins.bottom = savedBottom;
        }

        doc.end();
        outStream.on('finish', () => resolve({ path: OUT_PDF, pages: totalPages }));
        outStream.on('error', reject);
    });
}

generateContinuationPDF()
    .then(res => console.log(`[Continuation Report PDF] Generated successfully: ${res.path} (${res.pages} pages)`))
    .catch(err => {
        console.error('[Continuation Report PDF Error]:', err);
        process.exit(1);
    });
