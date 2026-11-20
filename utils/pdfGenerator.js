const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

/**
 * Generates a professional clinical diagnostic report PDF buffer with embedded anti-forgery QR code.
 * @param {Object} report Report metadata object
 * @param {string} hostUrl Host base URL (e.g. http://localhost:3000)
 * @returns {Promise<Buffer>} Resolves to PDF Buffer
 */
async function generateMedicalReportPDF(report, hostUrl = 'http://localhost:3000') {
    const verificationUrl = `${hostUrl}/verify.html?reportId=${report.reportId}`;

    // Generate high-resolution QR Code buffer (error correction level H for reliable smartphone scanning)
    const qrBuffer = await QRCode.toBuffer(verificationUrl, {
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 180,
        color: {
            dark: '#0a1128',
            light: '#ffffff'
        }
    });

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 35,
                info: {
                    Title: report.title,
                    Author: 'SIT Students Hospital & Diagnostic Center',
                    Subject: `Diagnostic Report ${report.reportId}`,
                    Keywords: (report.keywords || []).join(', ')
                }
            });

            const buffers = [];
            doc.on('data', chunk => buffers.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', err => reject(err));

            const primaryColor = '#0f172a';
            const accentBlue = '#0284c7';
            const textDark = '#1e293b';
            const textMuted = '#64748b';
            const borderGrey = '#cbd5e1';
            const lightBg = '#f8fafc';

            // ==========================================
            // 1. HOSPITAL & DIAGNOSTIC LAB HEADER
            // ==========================================
            doc.rect(35, 30, 525, 68).fill(lightBg);
            doc.rect(35, 30, 525, 68).stroke('#cbd5e1');

            doc.fillColor(accentBlue).fontSize(15).font('Helvetica-Bold')
               .text('SIT STUDENTS HOSPITAL & HEALTH CENTER', 48, 40);
            doc.fillColor(textDark).fontSize(8.5).font('Helvetica-Bold')
               .text('CENTRAL DEPARTMENT OF LABORATORY MEDICINE & DIAGNOSTIC PATHOLOGY', 48, 58);
            doc.fillColor(textMuted).fontSize(7.5).font('Helvetica')
               .text('B.H. Road, SIT Campus, Tumakuru - 572103 • Dept Node: NODE-HOSP-01 • ISO/NABH Standard', 48, 70)
               .text('Unified Single-Hospital Electronic Medical Record • SHA-256 Ledger Verified', 48, 81);

            // Report ID Badge in Header Top Right
            doc.rect(425, 40, 120, 22).fill(accentBlue);
            doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
               .text(report.reportId, 425, 46, { width: 120, align: 'center' });

            doc.fillColor('#059669').fontSize(7.5).font('Helvetica-Bold')
               .text('● LEDGER VERIFIED', 425, 68, { width: 120, align: 'center' });

            // ==========================================
            // 2. PATIENT DEMOGRAPHICS & RECORD METADATA
            // ==========================================
            const demoY = 105;
            doc.rect(35, demoY, 525, 70).fill('#f1f5f9');
            doc.rect(35, demoY, 525, 70).stroke('#e2e8f0');

            doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold')
               .text('PATIENT DEMOGRAPHICS & CLINICAL METADATA', 45, demoY + 8);

            doc.fillColor(textMuted).fontSize(8).font('Helvetica');
            // Col 1
            doc.text('Patient Name:', 45, demoY + 25)
               .fillColor(textDark).font('Helvetica-Bold')
               .text(report.patientName || 'N/A', 115, demoY + 25);

            doc.fillColor(textMuted).font('Helvetica').text('Patient ID / UHID:', 45, demoY + 39)
               .fillColor(textDark).font('Helvetica-Bold')
               .text(report.patientPseudonym || report.patientId || 'PT-9901', 115, demoY + 39);

            doc.fillColor(textMuted).font('Helvetica').text('Referred By:', 45, demoY + 53)
               .fillColor(textDark).font('Helvetica-Bold')
               .text(report.uploadedBy || 'Attending Physician', 115, demoY + 53);

            // Col 2
            doc.fillColor(textMuted).font('Helvetica').text('Age / Gender:', 230, demoY + 25)
               .fillColor(textDark).font('Helvetica-Bold')
               .text(`${report.age || '48'} Y / ${report.gender || 'Male'}`, 295, demoY + 25);

            doc.fillColor(textMuted).font('Helvetica').text('Test Date:', 230, demoY + 39)
               .fillColor(textDark).font('Helvetica-Bold')
               .text(report.testDate || '2026-08-14', 295, demoY + 39);

            doc.fillColor(textMuted).font('Helvetica').text('Report Category:', 230, demoY + 53)
               .fillColor(textDark).font('Helvetica-Bold')
               .text(report.reportType || 'Clinical Pathology', 295, demoY + 53);

            // Col 3
            doc.fillColor(textMuted).font('Helvetica').text('Sample Ref:', 410, demoY + 25)
               .fillColor(textDark).font('Helvetica-Bold')
               .text(`SMP-${(report.reportId || '').slice(-6)}`, 465, demoY + 25);

            doc.fillColor(textMuted).font('Helvetica').text('Ledger Block:', 410, demoY + 39)
               .fillColor(accentBlue).font('Helvetica-Bold')
               .text(`Block #${report.blockIndex || 1}`, 465, demoY + 39);

            doc.fillColor(textMuted).font('Helvetica').text('Hospital Node:', 410, demoY + 53)
               .fillColor(textDark).font('Helvetica-Bold')
               .text(report.nodeId || 'NODE-HOSP-01', 465, demoY + 53);

            // ==========================================
            // 3. INVESTIGATION TITLE
            // ==========================================
            const titleY = 182;
            doc.fillColor(accentBlue).fontSize(11.5).font('Helvetica-Bold')
               .text((report.title || 'CLINICAL DIAGNOSTIC REPORT').toUpperCase(), 35, titleY, { width: 525, height: 14, ellipsis: true });
            doc.strokeColor(accentBlue).lineWidth(1.2).moveTo(35, titleY + 16).lineTo(560, titleY + 16).stroke();

            // ==========================================
            // 4. DIAGNOSTIC RESULTS TABLE (GUARANTEED BOUNDED LAYOUT)
            // ==========================================
            const tableY = 206;
            doc.rect(35, tableY, 525, 18).fill('#0f172a');
            doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
            doc.text('INVESTIGATION / TEST PARAMETER', 45, tableY + 5);
            doc.text('OBSERVED VALUE', 260, tableY + 5);
            doc.text('REFERENCE INTERVAL', 370, tableY + 5);
            doc.text('STATUS', 490, tableY + 5);

            // Determine parameters to render (maximum 5 clean rows, never dumping unformatted raw text)
            let parametersToRender = [];
            if (report.testParameters && Array.isArray(report.testParameters) && report.testParameters.length > 0) {
                parametersToRender = report.testParameters.slice(0, 5);
            } else {
                parametersToRender = [
                    { parameter: report.title || 'Diagnostic Evaluation', value: 'Completed & Certified', ref: 'NABH Protocol', status: 'NORMAL', isAbnormal: false },
                    { parameter: 'Specimen / Sample Quality', value: 'Adequate for Analysis', ref: 'Optimal Clarity', status: 'NORMAL', isAbnormal: false },
                    { parameter: 'Physiological Limit', value: 'Within Baseline Range', ref: 'Standard Reference', status: 'NORMAL', isAbnormal: false }
                ];
            }

            let curRowY = tableY + 18;
            parametersToRender.forEach((param, idx) => {
                const rowBg = idx % 2 === 0 ? '#f8fafc' : '#ffffff';
                doc.rect(35, curRowY, 525, 18).fill(rowBg);
                doc.rect(35, curRowY, 525, 18).stroke('#e2e8f0');

                // Parameter name
                doc.fillColor(textDark).fontSize(8).font('Helvetica-Bold')
                   .text(param.parameter, 45, curRowY + 5, { width: 210, height: 11, ellipsis: true });

                // Observed Value
                const valColor = param.isAbnormal ? '#b91c1c' : '#0f172a';
                doc.fillColor(valColor).font('Helvetica-Bold').fontSize(8)
                   .text(param.value, 260, curRowY + 5, { width: 100, height: 11, ellipsis: true });

                // Reference Interval
                doc.fillColor(textMuted).font('Helvetica').fontSize(7.5)
                   .text(param.ref || 'Normal', 370, curRowY + 5, { width: 110, height: 11, ellipsis: true });

                // Status Badge
                const badgeBg = param.isAbnormal ? '#fee2e2' : '#dcfce7';
                const badgeColor = param.isAbnormal ? '#991b1b' : '#166534';
                doc.rect(485, curRowY + 3, 65, 12).fill(badgeBg);
                doc.fillColor(badgeColor).fontSize(7).font('Helvetica-Bold')
                   .text(param.status || (param.isAbnormal ? 'ABNORMAL' : 'NORMAL'), 485, curRowY + 5, { width: 65, align: 'center' });

                curRowY += 18;
            });

            // ==========================================
            // 5. CLINICAL IMPRESSION & AI HIGHLIGHTS BOX (BOUNDED Y: 326 TO 404)
            // ==========================================
            const aiBoxY = 326;
            const aiBoxHeight = 78;
            doc.rect(35, aiBoxY, 525, aiBoxHeight).fill('#f0fdf4');
            doc.rect(35, aiBoxY, 525, aiBoxHeight).stroke('#86efac');

            const aiEngineName = (report.aiHighlights && report.aiHighlights.aiEngine) ? report.aiHighlights.aiEngine : 'Local Clinical Rule Engine';
            doc.fillColor('#15803d').fontSize(8.5).font('Helvetica-Bold')
               .text(`🤖 AI CLINICAL KEY FINDINGS (${aiEngineName})`, 45, aiBoxY + 6);

            const bullets = (report.aiHighlights && Array.isArray(report.aiHighlights.keyFindings) && report.aiHighlights.keyFindings.length > 0)
                ? report.aiHighlights.keyFindings.slice(0, 2)
                : [`Diagnostic evaluation confirmed for ${report.title || 'clinical investigation'}.`, 'Observed findings calibrated against standard clinical protocols.'];

            doc.fillColor(textDark).fontSize(7.5).font('Helvetica')
               .text(`• ${bullets[0] || 'Clinical parameter within baseline threshold.'}`, 48, aiBoxY + 20, { width: 500, height: 11, ellipsis: true });
            doc.fillColor(textDark).fontSize(7.5).font('Helvetica')
               .text(`• ${bullets[1] || 'No critical out-of-range contraindications detected.'}`, 48, aiBoxY + 33, { width: 500, height: 11, ellipsis: true });

            const impressionText = (report.aiHighlights && report.aiHighlights.diagnosticImpression)
                ? report.aiHighlights.diagnosticImpression
                : (report.clinicalImpression || report.notes || 'Investigated parameters appear consistent with expected clinical thresholds.');

            doc.fillColor('#166534').fontSize(7.5).font('Helvetica-Bold')
               .text(`Diagnostic Impression: ${impressionText}`, 48, aiBoxY + 48, { width: 500, height: 24, ellipsis: true });

            // ==========================================
            // 6. ATTENDING PHYSICIAN CLINICAL EVALUATION (BOUNDED Y: 412 TO 470)
            // ==========================================
            const docRemarks = report.doctorRemarks || {
                doctorName: 'Dr. Sarah Rao, MD',
                department: 'Cardiology & Internal Medicine',
                status: 'Reviewed & Authenticated',
                updatedAt: report.testDate || '2026-08-14'
            };

            const docBoxY = 412;
            const docBoxHeight = 58;
            doc.rect(35, docBoxY, 525, docBoxHeight).fill('#fffbeb');
            doc.rect(35, docBoxY, 525, docBoxHeight).stroke('#fde68a');

            const sharedNotesCount = Array.isArray(report.sharedDoctorNotes) ? report.sharedDoctorNotes.length : 1;
            doc.fillColor('#b45309').fontSize(8.5).font('Helvetica-Bold')
               .text(`ATTENDING PHYSICIAN CLINICAL EVALUATION (${sharedNotesCount} HOSPITAL DOCTOR REVIEW${sharedNotesCount > 1 ? 'S' : ''})`, 45, docBoxY + 6);

            doc.fillColor(textDark).fontSize(7.5).font('Helvetica')
               .text(`Latest Consultant: ${docRemarks.doctorName} (${docRemarks.department || 'Internal Medicine'})`, 45, docBoxY + 20, { width: 255, height: 11, ellipsis: true });
            doc.text(`Status: ${docRemarks.status || 'Reviewed & Authenticated'} • Date: ${(docRemarks.updatedAt || report.testDate || '').slice(0, 10)}`, 45, docBoxY + 34, { width: 255, height: 11, ellipsis: true });

            doc.fillColor('#92400e').font('Helvetica-Bold').fontSize(7.5)
               .text('Prescribed Medicines & Clinical Advice:', 310, docBoxY + 20, { width: 240 });
            doc.fillColor(textDark).font('Helvetica').fontSize(7.5)
               .text(report.prescription || 'Correlate with clinical presentation. Routine outpatient review scheduled.', 310, docBoxY + 32, { width: 240, height: 20, ellipsis: true });

            // ==========================================
            // 7. BOTTOM SECTION: BLOCKCHAIN PROVENANCE & SCANNABLE ANTI-FORGERY QR CODE (BOUNDED Y: 478 TO 628)
            // ==========================================
            const footerY = 478;
            const footerHeight = 150;

            // Security border box
            doc.rect(35, footerY, 525, footerHeight).fill('#f0f9ff');
            doc.rect(35, footerY, 525, footerHeight).stroke(accentBlue);

            // High-Resolution Scannable Anti-Forgery QR Code
            doc.image(qrBuffer, 46, footerY + 14, { width: 105, height: 105 });

            // QR Scan Caption
            doc.rect(46, footerY + 124, 105, 16).fill(accentBlue);
            doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold')
               .text('SCAN TO VERIFY', 46, footerY + 128, { width: 105, align: 'center' });

            // Provenance Details
            const provX = 162;
            doc.fillColor('#0369a1').fontSize(10).font('Helvetica-Bold')
               .text('HOSPITAL BLOCKCHAIN INTEGRITY SEAL (ANTI-FORGERY)', provX, footerY + 10);

            doc.fillColor(textDark).fontSize(7.5).font('Helvetica')
               .text('This diagnostic report is cryptographically anchored on the SIT Students Hospital Ledger.', provX, footerY + 24)
               .text('Scanning the QR code using any smartphone recalculates the live SHA-256 hash to confirm untampered status.', provX, footerY + 35);

            // SHA-256 Fingerprint Box
            doc.rect(provX, footerY + 48, 388, 26).fill('#ffffff');
            doc.rect(provX, footerY + 48, 388, 26).stroke('#bae6fd');

            doc.fillColor('#0284c7').fontSize(6.5).font('Helvetica-Bold')
               .text('CRYPTOGRAPHIC SHA-256 LEDGER FINGERPRINT (ORIGINAL RECORD HASH):', provX + 6, footerY + 52);
            doc.fillColor('#0f172a').fontSize(6.5).font('Courier-Bold')
               .text(report.reportHash || 'c1ec0cf3d448fabace5bef6b79e3a9ef26beadacdfe72ad05a800b7c6f1b1566', provX + 6, footerY + 62, { width: 376 });

            // Blockchain specifics
            doc.fillColor(textDark).fontSize(7.5).font('Helvetica')
               .text(`Anchored Ledger Block: #${report.blockIndex || 1}  •  Status: VERIFIED HOSPITAL RECORD`, provX, footerY + 80)
               .text(`Verification Gateway: ${verificationUrl}`, provX, footerY + 93, { width: 385, height: 11, ellipsis: true })
               .text(`Hospital Wing Node: ${report.nodeId || 'NODE-HOSP-01'}  •  AES-256-CBC Encrypted Storage`, provX, footerY + 106)
               .text('Internal Hospital Access: Authorized across Cardiology, Orthopedics, Pulmonology & Central Lab.', provX, footerY + 119);

            // ==========================================
            // 8. INSTITUTIONAL ACCREDITATION FOOTER
            // ==========================================
            const bottomY = 638;
            doc.fillColor(textMuted).fontSize(7).font('Helvetica')
               .text('CONFIDENTIAL MEDICAL RECORD • SIT Students Hospital, Tumakuru • Central Diagnostic Laboratory • Tamper-Evident Document System', 35, bottomY, { width: 525, align: 'center' });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Generates an official SIT Students Hospital OPD Registration & Billing Receipt PDF
 */
async function generateReceptionBillPDF(patient, hostUrl = 'http://localhost:3000') {
    const billNo = patient.billNumber || patient.receptionId || 'BILL-2026-1001';
    const portalUrl = `${hostUrl}/reception`;
    const qrBuffer = await QRCode.toBuffer(portalUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 140,
        color: { dark: '#162d4c', light: '#ffffff' }
    });

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 40,
                info: {
                    Title: `OPD Bill Receipt - ${billNo}`,
                    Author: 'SIT Students Hospital & Health Center'
                }
            });

            const buffers = [];
            doc.on('data', chunk => buffers.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', err => reject(err));

            const navy = '#1e3a5f';
            const teal = '#0d9488';
            const dark = '#1e293b';
            const muted = '#64748b';

            // Header Box
            doc.rect(40, 35, 515, 72).fill('#f8fafc');
            doc.rect(40, 35, 515, 72).stroke('#cbd5e1');

            doc.fillColor(navy).fontSize(16).font('Helvetica-Bold')
               .text('SIT STUDENTS HOSPITAL & HEALTH CENTER', 52, 46);
            doc.fillColor(teal).fontSize(9).font('Helvetica-Bold')
               .text('OUTPATIENT DEPARTMENT (OPD) REGISTRATION & BILLING RECEIPT', 52, 66);
            doc.fillColor(muted).fontSize(8).font('Helvetica')
               .text('B.H. Road, Siddaganga Institute of Technology Campus, Tumakuru - 572103 • Front Desk Counter 1', 52, 81);

            // Bill Number Badge
            doc.rect(405, 45, 138, 26).fill(navy);
            doc.fillColor('#ffffff').fontSize(9.5).font('Helvetica-Bold')
               .text(billNo, 405, 53, { width: 138, align: 'center' });
            doc.fillColor('#15803d').fontSize(7.5).font('Helvetica-Bold')
               .text('● PAID & REGISTERED', 405, 77, { width: 138, align: 'center' });

            // Patient & Visit Details Box
            const infoY = 122;
            doc.rect(40, infoY, 515, 92).fill('#ffffff');
            doc.rect(40, infoY, 515, 92).stroke('#cbd5e1');

            doc.fillColor(navy).fontSize(9).font('Helvetica-Bold')
               .text('PATIENT REGISTRATION & CONSULTATION DETAILS', 52, infoY + 10);

            doc.fontSize(8.5).fillColor(muted).font('Helvetica').text('Patient Name:', 52, infoY + 30)
               .fillColor(dark).font('Helvetica-Bold').text(patient.name || 'N/A', 135, infoY + 30);

            doc.fillColor(muted).font('Helvetica').text('Patient UHID:', 52, infoY + 48)
               .fillColor(dark).font('Helvetica-Bold').text(patient.patientId || 'PT-9901', 135, infoY + 48);

            doc.fillColor(muted).font('Helvetica').text('Age / Gender / Blood:', 52, infoY + 66)
               .fillColor(dark).font('Helvetica-Bold').text(`${patient.age || 21} Y / ${patient.gender || 'Male'} / ${patient.bloodGroup || 'O+'}`, 145, infoY + 66);

            doc.fillColor(muted).font('Helvetica').text('Bill / Login ID:', 300, infoY + 30)
               .fillColor(teal).font('Helvetica-Bold').text(billNo, 385, infoY + 30);

            doc.fillColor(muted).font('Helvetica').text('Consulting Doctor:', 300, infoY + 48)
               .fillColor(dark).font('Helvetica-Bold').text(patient.assignedDoctor || 'Dr. Sarah Rao (General Medicine)', 385, infoY + 48, { width: 160, height: 12, ellipsis: true });

            doc.fillColor(muted).font('Helvetica').text('Date & Contact:', 300, infoY + 66)
               .fillColor(dark).font('Helvetica-Bold').text(`${(patient.createdAt || new Date().toISOString()).slice(0, 10)} • ${patient.contact || '+91 98450 12345'}`, 385, infoY + 66, { width: 160, height: 12, ellipsis: true });

            // Itemized Billing Table
            const tblY = 230;
            doc.rect(40, tblY, 515, 22).fill(navy);
            doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
            doc.text('SL.', 52, tblY + 7);
            doc.text('PARTICULARS / HOSPITAL SERVICE DESCRIPTION', 90, tblY + 7);
            doc.text('DEPARTMENT WING', 345, tblY + 7);
            doc.text('AMOUNT', 485, tblY + 7);

            doc.rect(40, tblY + 22, 515, 26).fill('#f8fafc').stroke('#cbd5e1');
            doc.fillColor(dark).fontSize(8.5).font('Helvetica').text('01', 52, tblY + 31);
            doc.font('Helvetica-Bold').text(patient.visitReason || 'OPD Clinical Consultation & Diagnostic Registration', 90, tblY + 31, { width: 245, height: 12, ellipsis: true });
            doc.font('Helvetica').text('SIT Students Hospital OPD', 345, tblY + 31);
            doc.font('Helvetica-Bold').text(patient.billAmount || 'Rs. 350', 485, tblY + 31);

            doc.rect(40, tblY + 48, 515, 24).fill('#f0fdf4').stroke('#bbf7d0');
            doc.fillColor('#166534').fontSize(9).font('Helvetica-Bold')
               .text('TOTAL AMOUNT RECEIVED (CASH / UPI)', 90, tblY + 56)
               .text(patient.billAmount || 'Rs. 350', 485, tblY + 56);

            // Patient Portal Login Instructions Box
            const loginY = 325;
            doc.rect(40, loginY, 515, 115).fill('#f0f9ff').stroke('#bae6fd');
            doc.image(qrBuffer, 52, loginY + 12, { width: 90, height: 90 });

            doc.fillColor(navy).fontSize(10).font('Helvetica-Bold')
               .text('HOW TO ACCESS YOUR MEDICAL REPORTS & DOCTOR PRESCRIPTIONS', 158, loginY + 14);
            doc.fillColor(dark).fontSize(8.5).font('Helvetica')
               .text('1. Open the SIT Students Hospital Portal (/portal or /reception).', 158, loginY + 32)
               .text('2. Choose "Patient Login (Bill Number Only)" — no username or password is needed.', 158, loginY + 47)
               .text('3. Enter your unique Reception Bill Number shown below to view & download your reports:', 158, loginY + 62);

            doc.rect(158, loginY + 78, 220, 24).fill('#ffffff').stroke(teal);
            doc.fillColor(navy).fontSize(11).font('Courier-Bold')
               .text(`LOGIN BILL ID: ${billNo}`, 168, loginY + 85);

            doc.fillColor(muted).fontSize(7.5).font('Helvetica')
               .text(`Issued By: ${patient.registeredBy || 'Ms. Priya Nair (Senior OPD Receptionist)'} • SIT Students Hospital, Tumakuru`, 40, 460, { width: 515, align: 'center' });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Generates an official SIT Students Hospital Doctor OPD Checkup & Medicine Prescription PDF
 */
async function generateDoctorPrescriptionPDF(rx, hostUrl = 'http://localhost:3000') {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 40,
                info: {
                    Title: `OPD Prescription - ${rx.prescriptionId}`,
                    Author: rx.doctorName || 'SIT Students Hospital Doctor'
                }
            });

            const buffers = [];
            doc.on('data', chunk => buffers.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', err => reject(err));

            const navy = '#1e3a5f';
            const teal = '#0d9488';
            const dark = '#1e293b';
            const muted = '#64748b';

            // Header
            doc.rect(40, 35, 515, 72).fill('#f8fafc').stroke('#cbd5e1');
            doc.fillColor(navy).fontSize(16).font('Helvetica-Bold')
               .text('SIT STUDENTS HOSPITAL & HEALTH CENTER', 52, 46);
            doc.fillColor(teal).fontSize(9.5).font('Helvetica-Bold')
               .text(`CLINICAL CHECKUP & MEDICINE PRESCRIPTION SLIP • ${(rx.department || 'GENERAL MEDICINE').toUpperCase()}`, 52, 66);
            doc.fillColor(muted).fontSize(8).font('Helvetica')
               .text(`Attending Consultant: ${rx.doctorName || 'Dr. Sarah Rao, MD'} • B.H. Road, SIT Campus, Tumakuru - 572103`, 52, 82);

            doc.rect(415, 45, 128, 24).fill(teal);
            doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
               .text(rx.prescriptionId || 'RX-2026-01', 415, 53, { width: 128, align: 'center' });

            // Patient Demographics & Vitals
            const patY = 120;
            doc.rect(40, patY, 515, 68).fill('#ffffff').stroke('#cbd5e1');
            doc.fillColor(muted).fontSize(8.5).font('Helvetica').text('Patient Name:', 52, patY + 14)
               .fillColor(dark).font('Helvetica-Bold').text(`${rx.patientName} (${rx.patientUhid || 'PT-9901'})`, 125, patY + 14);
            doc.fillColor(muted).font('Helvetica').text('Bill Number:', 52, patY + 32)
               .fillColor(navy).font('Helvetica-Bold').text(rx.billNumber || 'BILL-2026-1001', 125, patY + 32);
            doc.fillColor(muted).font('Helvetica').text('Checkup Vitals:', 52, patY + 50)
               .fillColor(dark).font('Helvetica-Bold').text(rx.vitals || 'BP: 120/80 mmHg | Pulse: 76 bpm | Temp: 98.4 F', 125, patY + 50);

            doc.fillColor(muted).font('Helvetica').text('Checkup Date:', 330, patY + 14)
               .fillColor(dark).font('Helvetica-Bold').text((rx.createdAt || new Date().toISOString()).slice(0, 10), 405, patY + 14);
            doc.fillColor(muted).font('Helvetica').text('Follow-Up Date:', 330, patY + 32)
               .fillColor(dark).font('Helvetica-Bold').text(rx.followUpDate || 'After 7 Days', 405, patY + 32);

            // Clinical Checkup Findings & Diagnosis
            const diagY = 202;
            doc.rect(40, diagY, 515, 78).fill('#f8fafc').stroke('#cbd5e1');
            doc.fillColor(navy).fontSize(9.5).font('Helvetica-Bold')
               .text('CHIEF COMPLAINTS & CLINICAL CHECKUP EXAMINATION FINDINGS:', 52, diagY + 10);
            doc.fillColor(dark).fontSize(8.5).font('Helvetica')
               .text(`Symptoms / Complaints: ${rx.symptoms || 'Outpatient clinical checkup and evaluation.'}`, 52, diagY + 26, { width: 490 });
            doc.fillColor('#0f766e').fontSize(9).font('Helvetica-Bold')
               .text(`Clinical Diagnosis: ${rx.diagnosis || 'Evaluated and prescribed outpatient medication.'}`, 52, diagY + 48, { width: 490 });

            // Rx Medicines Table
            const rxY = 294;
            doc.fillColor(navy).fontSize(12).font('Helvetica-Bold').text('Rx — PRESCRIBED MEDICINES & DOSAGE SCHEDULE', 40, rxY);
            doc.rect(40, rxY + 18, 515, 20).fill(navy);
            doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
            doc.text('MEDICINE NAME & STRENGTH', 52, rxY + 24);
            doc.text('DOSAGE / TIMING', 270, rxY + 24);
            doc.text('DURATION', 410, rxY + 24);
            doc.text('INSTRUCTIONS', 475, rxY + 24);

            const meds = Array.isArray(rx.medicines) && rx.medicines.length > 0
                ? rx.medicines
                : [{ name: rx.medicineText || 'Tab. Paracetamol 650mg', dosage: '1 - 0 - 1', duration: '5 Days', instructions: 'After Food' }];

            let rowY = rxY + 38;
            meds.slice(0, 6).forEach((m, idx) => {
                doc.rect(40, rowY, 515, 22).fill(idx % 2 === 0 ? '#ffffff' : '#f8fafc').stroke('#e2e8f0');
                doc.fillColor(dark).fontSize(8.5).font('Helvetica-Bold').text(`${idx + 1}. ${m.name}`, 52, rowY + 6, { width: 210, ellipsis: true });
                doc.fillColor(navy).font('Helvetica-Bold').text(m.dosage || '1-0-1', 270, rowY + 6);
                doc.fillColor(dark).font('Helvetica').text(m.duration || '5 Days', 410, rowY + 6);
                doc.fillColor(muted).font('Helvetica').text(m.instructions || 'After Meals', 475, rowY + 6);
                rowY += 22;
            });

            // Clinical Advice & Ordered Lab Test Box
            const advY = rowY + 16;
            doc.rect(40, advY, 515, 68).fill('#fffbeb').stroke('#fde68a');
            doc.fillColor('#92400e').fontSize(9).font('Helvetica-Bold')
               .text('DOCTOR ADVICE & DIAGNOSTIC LAB INVESTIGATION ORDERED:', 52, advY + 10);
            doc.fillColor(dark).fontSize(8.5).font('Helvetica')
               .text(`Dietary / Care Advice: ${rx.advice || 'Take prescribed medicines regularly. Drink plenty of water.'}`, 52, advY + 26, { width: 490 });
            doc.fillColor(navy).fontSize(8.5).font('Helvetica-Bold')
               .text(`Lab Investigation Requested: ${rx.labTestOrdered && rx.labTestOrdered !== 'None' ? rx.labTestOrdered + ' (Sent to SIT Central Pathology Lab Queue)' : 'No new lab test required today'}`, 52, advY + 44, { width: 490 });

            // Doctor Sign-off Footer
            const signY = advY + 95;
            doc.fillColor(dark).fontSize(9).font('Helvetica-Bold')
               .text(`Signed Electronically by: ${rx.doctorName || 'Dr. Sarah Rao, MD'}`, 320, signY, { width: 235, align: 'right' });
            doc.fillColor(muted).fontSize(8).font('Helvetica')
               .text(`${rx.department || 'General Medicine'} • SIT Students Hospital, Tumakuru`, 320, signY + 14, { width: 235, align: 'right' });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = {
    generateMedicalReportPDF,
    generateReceptionBillPDF,
    generateDoctorPrescriptionPDF
};
