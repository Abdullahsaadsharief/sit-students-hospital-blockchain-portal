const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

/**
 * Generates a standardized clinical diagnostic report PDF buffer with embedded anti-forgery QR code.
 * Never fabricates normal measurements, NABH/ISO certifications, or premature ledger verification (F-08).
 */
async function generateMedicalReportPDF(report, hostUrl = 'http://localhost:3000') {
    const verificationUrl = `${hostUrl}/verify.html?reportId=${report.reportId}`;

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
                    Title: report.title || 'Diagnostic Report',
                    Author: 'SIT Students Hospital & Health Center',
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
            const lightBg = '#f8fafc';

            // 1. HOSPITAL & DIAGNOSTIC LAB HEADER
            doc.rect(35, 30, 525, 68).fill(lightBg);
            doc.rect(35, 30, 525, 68).stroke('#cbd5e1');

            doc.fillColor(accentBlue).fontSize(15).font('Helvetica-Bold')
                .text('SIT STUDENTS HOSPITAL & HEALTH CENTER', 48, 40);
            doc.fillColor(textDark).fontSize(8.5).font('Helvetica-Bold')
                .text('CENTRAL DEPARTMENT OF LABORATORY MEDICINE & DIAGNOSTIC PATHOLOGY', 48, 58);
            doc.fillColor(textMuted).fontSize(7.5).font('Helvetica')
                .text(`B.H. Road, SIT Campus, Tumakuru - 572103 • Dept Node: ${report.nodeId || 'NODE-LAB-01'}`, 48, 70)
                .text('Hospital Electronic Medical Record • SHA-256 Cryptographic Fingerprint Document', 48, 81);

            // Report ID Badge (honest status: never falsely claims verified before anchoring)
            doc.rect(425, 40, 120, 22).fill(accentBlue);
            doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
                .text(report.reportId || 'REPORT', 425, 46, { width: 120, align: 'center' });

            const anchorBadgeText = report.blockHash ? 'HASH ANCHORED' : 'RECORD GENERATED';
            doc.fillColor(report.blockHash ? '#059669' : '#64748b').fontSize(7.5).font('Helvetica-Bold')
                .text(`● ${anchorBadgeText}`, 425, 68, { width: 120, align: 'center' });

            // 2. PATIENT DEMOGRAPHICS & RECORD METADATA
            const demoY = 105;
            doc.rect(35, demoY, 525, 70).fill('#f1f5f9');
            doc.rect(35, demoY, 525, 70).stroke('#e2e8f0');

            doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold')
                .text('PATIENT DEMOGRAPHICS & CLINICAL METADATA', 45, demoY + 8);

            doc.fillColor(textMuted).fontSize(8).font('Helvetica');
            doc.text('Patient Name:', 45, demoY + 25)
                .fillColor(textDark).font('Helvetica-Bold')
                .text(report.patientName || 'Not recorded', 115, demoY + 25);

            doc.fillColor(textMuted).font('Helvetica').text('Patient ID / UHID:', 45, demoY + 39)
                .fillColor(textDark).font('Helvetica-Bold')
                .text(report.patientPseudonym || report.patientId || 'Not recorded', 115, demoY + 39);

            doc.fillColor(textMuted).font('Helvetica').text('Uploaded By:', 45, demoY + 53)
                .fillColor(textDark).font('Helvetica-Bold')
                .text(report.uploadedBy || 'Hospital Staff', 115, demoY + 53);

            doc.fillColor(textMuted).font('Helvetica').text('Age / Gender:', 230, demoY + 25)
                .fillColor(textDark).font('Helvetica-Bold')
                .text(`${report.age != null ? report.age + ' Y' : 'N/A'} / ${report.gender || 'Not recorded'}`, 295, demoY + 25);

            doc.fillColor(textMuted).font('Helvetica').text('Test Date:', 230, demoY + 39)
                .fillColor(textDark).font('Helvetica-Bold')
                .text(report.testDate || 'Not recorded', 295, demoY + 39);

            doc.fillColor(textMuted).font('Helvetica').text('Report Category:', 230, demoY + 53)
                .fillColor(textDark).font('Helvetica-Bold')
                .text(report.reportType || 'Diagnostic Investigation', 295, demoY + 53);

            doc.fillColor(textMuted).font('Helvetica').text('Sample Ref:', 410, demoY + 25)
                .fillColor(textDark).font('Helvetica-Bold')
                .text(`SMP-${(report.reportId || '000000').slice(-6)}`, 465, demoY + 25);

            doc.fillColor(textMuted).font('Helvetica').text('Ledger Block:', 410, demoY + 39)
                .fillColor(accentBlue).font('Helvetica-Bold')
                .text(report.blockIndex ? `Block #${report.blockIndex}` : 'Pending Anchor', 465, demoY + 39);

            doc.fillColor(textMuted).font('Helvetica').text('Hospital Node:', 410, demoY + 53)
                .fillColor(textDark).font('Helvetica-Bold')
                .text(report.nodeId || 'NODE-LAB-01', 465, demoY + 53);

            // 3. INVESTIGATION TITLE
            const titleY = 182;
            doc.fillColor(accentBlue).fontSize(11.5).font('Helvetica-Bold')
                .text((report.title || 'CLINICAL DIAGNOSTIC REPORT').toUpperCase(), 35, titleY, { width: 525, height: 14, ellipsis: true });
            doc.strokeColor(accentBlue).lineWidth(1.2).moveTo(35, titleY + 16).lineTo(560, titleY + 16).stroke();

            // 4. DIAGNOSTIC RESULTS TABLE (Never invents normal parameters if none were extracted)
            const tableY = 206;
            doc.rect(35, tableY, 525, 18).fill('#0f172a');
            doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
            doc.text('INVESTIGATION / TEST PARAMETER', 45, tableY + 5);
            doc.text('OBSERVED VALUE', 260, tableY + 5);
            doc.text('REFERENCE INTERVAL', 370, tableY + 5);
            doc.text('STATUS', 490, tableY + 5);

            const parametersToRender = (report.testParameters && Array.isArray(report.testParameters))
                ? report.testParameters.slice(0, 5)
                : [];

            let curRowY = tableY + 18;
            if (parametersToRender.length === 0) {
                doc.rect(35, curRowY, 525, 32).fill('#fffbeb');
                doc.rect(35, curRowY, 525, 32).stroke('#fde68a');
                doc.fillColor('#92400e').fontSize(8).font('Helvetica-Bold')
                    .text('No structured results could be extracted automatically from the source upload.', 45, curRowY + 6, { width: 425 });
                doc.fillColor('#78350f').fontSize(7.5).font('Helvetica')
                    .text('Clinician must review the original uploaded diagnostic document directly before clinical interpretation.', 45, curRowY + 18, { width: 425 });
                doc.rect(480, curRowY + 10, 70, 12).fill('#fef3c7');
                doc.fillColor('#92400e').fontSize(6.5).font('Helvetica-Bold')
                    .text('UNEXTRACTED', 480, curRowY + 12, { width: 70, align: 'center' });
            } else {
                parametersToRender.forEach((param, idx) => {
                    const rowBg = idx % 2 === 0 ? '#f8fafc' : '#ffffff';
                    doc.rect(35, curRowY, 525, 18).fill(rowBg);
                    doc.rect(35, curRowY, 525, 18).stroke('#e2e8f0');

                    doc.fillColor(textDark).fontSize(8).font('Helvetica-Bold')
                        .text(param.parameter || 'Measurement', 45, curRowY + 5, { width: 210, height: 11, ellipsis: true });

                    const valColor = param.isAbnormal ? '#b91c1c' : '#0f172a';
                    doc.fillColor(valColor).font('Helvetica-Bold').fontSize(8)
                        .text(param.value || 'See source', 260, curRowY + 5, { width: 100, height: 11, ellipsis: true });

                    doc.fillColor(textMuted).font('Helvetica').fontSize(7.5)
                        .text(param.ref || 'See source', 370, curRowY + 5, { width: 110, height: 11, ellipsis: true });

                    const badgeBg = param.isAbnormal ? '#fee2e2' : '#e0f2fe';
                    const badgeColor = param.isAbnormal ? '#991b1b' : '#075985';
                    doc.rect(485, curRowY + 3, 65, 12).fill(badgeBg);
                    doc.fillColor(badgeColor).fontSize(7).font('Helvetica-Bold')
                        .text(param.status || (param.isAbnormal ? 'ABNORMAL' : 'OBSERVED'), 485, curRowY + 5, { width: 65, align: 'center' });

                    curRowY += 18;
                });
            }

            // 5. AUTOMATED SUMMARY BOX (WITH MANDATORY CLINICAL DISCLAIMER)
            const aiBoxY = 326;
            const aiBoxHeight = 80;
            doc.rect(35, aiBoxY, 525, aiBoxHeight).fill('#f8fafc');
            doc.rect(35, aiBoxY, 525, aiBoxHeight).stroke('#cbd5e1');

            const aiEngineName = (report.aiHighlights && report.aiHighlights.aiEngine)
                ? report.aiHighlights.aiEngine
                : 'Automated Text Parser';
            doc.fillColor('#0369a1').fontSize(8).font('Helvetica-Bold')
                .text(`AUTOMATED SUMMARY (${aiEngineName}) — NOT CLINICAL ADVICE; REQUIRES CLINICIAN REVIEW`, 45, aiBoxY + 6, { width: 505 });

            const bullets = (report.aiHighlights && Array.isArray(report.aiHighlights.keyFindings) && report.aiHighlights.keyFindings.length > 0)
                ? report.aiHighlights.keyFindings.slice(0, 2)
                : ['No results could be extracted automatically; review the source document.'];

            doc.fillColor(textDark).fontSize(7.5).font('Helvetica')
                .text(`• ${bullets[0]}`, 48, aiBoxY + 22, { width: 500, height: 11, ellipsis: true });
            if (bullets[1]) {
                doc.text(`• ${bullets[1]}`, 48, aiBoxY + 35, { width: 500, height: 11, ellipsis: true });
            }

            const impressionText = (report.aiHighlights && report.aiHighlights.diagnosticImpression)
                ? report.aiHighlights.diagnosticImpression
                : (report.clinicalImpression || 'Pending clinician review of source document.');

            doc.fillColor('#334155').fontSize(7.5).font('Helvetica-Bold')
                .text(`Automated Note: ${impressionText}`, 48, aiBoxY + 50, { width: 500, height: 24, ellipsis: true });

            // 6. ATTENDING PHYSICIAN CLINICAL EVALUATION
            const docRemarks = report.doctorRemarks || null;
            const docBoxY = 414;
            const docBoxHeight = 56;
            doc.rect(35, docBoxY, 525, docBoxHeight).fill('#fffbeb');
            doc.rect(35, docBoxY, 525, docBoxHeight).stroke('#fde68a');

            const sharedNotesCount = Array.isArray(report.sharedDoctorNotes) ? report.sharedDoctorNotes.length : (docRemarks ? 1 : 0);
            doc.fillColor('#b45309').fontSize(8.5).font('Helvetica-Bold')
                .text(`ATTENDING PHYSICIAN CLINICAL EVALUATION (${sharedNotesCount} CLINICIAN REVIEW${sharedNotesCount === 1 ? '' : 'S'})`, 45, docBoxY + 6);

            if (docRemarks) {
                doc.fillColor(textDark).fontSize(7.5).font('Helvetica')
                    .text(`Consultant: ${docRemarks.doctorName} (${docRemarks.department || 'Hospital Physician'})`, 45, docBoxY + 20, { width: 255, height: 11, ellipsis: true });
                doc.text(`Status: ${docRemarks.status || 'Reviewed'} • Date: ${(docRemarks.updatedAt || report.testDate || '').slice(0, 10)}`, 45, docBoxY + 34, { width: 255, height: 11, ellipsis: true });
            } else {
                doc.fillColor('#92400e').fontSize(7.5).font('Helvetica')
                    .text('Status: Pending Attending Physician Review & Sign-Off', 45, docBoxY + 24, { width: 255 });
            }

            doc.fillColor('#92400e').font('Helvetica-Bold').fontSize(7.5)
                .text('Clinician Notes & Advice:', 310, docBoxY + 20, { width: 240 });
            doc.fillColor(textDark).font('Helvetica').fontSize(7.5)
                .text(report.prescription || 'Not recorded — awaiting clinician review.', 310, docBoxY + 32, { width: 240, height: 20, ellipsis: true });

            // 7. INTEGRITY & ANTI-FORGERY QR CODE
            const footerY = 478;
            const footerHeight = 150;
            doc.rect(35, footerY, 525, footerHeight).fill('#f0f9ff');
            doc.rect(35, footerY, 525, footerHeight).stroke(accentBlue);

            doc.image(qrBuffer, 46, footerY + 14, { width: 105, height: 105 });
            doc.rect(46, footerY + 124, 105, 16).fill(accentBlue);
            doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold')
                .text('SCAN TO VERIFY', 46, footerY + 128, { width: 105, align: 'center' });

            const provX = 162;
            doc.fillColor('#0369a1').fontSize(10).font('Helvetica-Bold')
                .text('CRYPTOGRAPHIC INTEGRITY SEAL & VERIFICATION QR', provX, footerY + 10);

            doc.fillColor(textDark).fontSize(7.5).font('Helvetica')
                .text('Scan the QR code to verify whether this report matches its anchored SHA-256 fingerprint.', provX, footerY + 24)
                .text('Public verification confirms document authenticity only and hides personal health data.', provX, footerY + 35);

            doc.rect(provX, footerY + 48, 388, 26).fill('#ffffff');
            doc.rect(provX, footerY + 48, 388, 26).stroke('#bae6fd');

            doc.fillColor('#0284c7').fontSize(6.5).font('Helvetica-Bold')
                .text('SOURCE UPLOAD SHA-256 FINGERPRINT:', provX + 6, footerY + 52);
            doc.fillColor('#0f172a').fontSize(6.5).font('Courier-Bold')
                .text(report.sourceHash || report.reportHash || 'Computed on anchoring', provX + 6, footerY + 62, { width: 376 });

            doc.fillColor(textDark).fontSize(7.5).font('Helvetica')
                .text(`Ledger Block: ${report.blockIndex ? '#' + report.blockIndex : 'Assigned at Anchoring'}  •  Storage: AES-256-GCM Encrypted`, provX, footerY + 80)
                .text(`Verification Endpoint: ${verificationUrl}`, provX, footerY + 93, { width: 385, height: 11, ellipsis: true })
                .text(`Hospital Wing Node: ${report.nodeId || 'NODE-LAB-01'}`, provX, footerY + 106)
                .text('Note: Official diagnostic interpretation must be signed by an attending physician.', provX, footerY + 119);

            const bottomY = 638;
            doc.fillColor(textMuted).fontSize(7).font('Helvetica')
                .text('CONFIDENTIAL MEDICAL RECORD • SIT Students Hospital, Tumakuru • Tamper-Evident Document System', 35, bottomY, { width: 525, align: 'center' });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Generates an official SIT Students Hospital OPD Registration & Billing Receipt PDF.
 * Prints the 8-character One-Time Access Code if provided during registration/reset.
 */
async function generateReceptionBillPDF(patient, hostUrl = 'http://localhost:3000', oneTimeAccessCode = null) {
    const billNo = patient.billNumber || patient.receptionId || 'Not recorded';
    const portalUrl = `${hostUrl}/portal`;
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

            doc.rect(40, 35, 515, 72).fill('#f8fafc');
            doc.rect(40, 35, 515, 72).stroke('#cbd5e1');

            doc.fillColor(navy).fontSize(16).font('Helvetica-Bold')
                .text('SIT STUDENTS HOSPITAL & HEALTH CENTER', 52, 46);
            doc.fillColor(teal).fontSize(9).font('Helvetica-Bold')
                .text('OUTPATIENT DEPARTMENT (OPD) REGISTRATION & BILLING RECEIPT', 52, 66);
            doc.fillColor(muted).fontSize(8).font('Helvetica')
                .text('B.H. Road, Siddaganga Institute of Technology Campus, Tumakuru - 572103 • Front Desk Counter 1', 52, 81);

            doc.rect(405, 45, 138, 26).fill(navy);
            doc.fillColor('#ffffff').fontSize(9.5).font('Helvetica-Bold')
                .text(billNo, 405, 53, { width: 138, align: 'center' });
            doc.fillColor('#15803d').fontSize(7.5).font('Helvetica-Bold')
                .text('● REGISTERED', 405, 77, { width: 138, align: 'center' });

            const infoY = 122;
            doc.rect(40, infoY, 515, 92).fill('#ffffff');
            doc.rect(40, infoY, 515, 92).stroke('#cbd5e1');

            doc.fillColor(navy).fontSize(9).font('Helvetica-Bold')
                .text('PATIENT REGISTRATION & CONSULTATION DETAILS', 52, infoY + 10);

            doc.fontSize(8.5).fillColor(muted).font('Helvetica').text('Patient Name:', 52, infoY + 30)
                .fillColor(dark).font('Helvetica-Bold').text(patient.name || 'Not recorded', 135, infoY + 30);

            doc.fillColor(muted).font('Helvetica').text('Patient UHID:', 52, infoY + 48)
                .fillColor(dark).font('Helvetica-Bold').text(patient.patientId || 'Not recorded', 135, infoY + 48);

            doc.fillColor(muted).font('Helvetica').text('Age / Gender / Blood:', 52, infoY + 66)
                .fillColor(dark).font('Helvetica-Bold').text(`${patient.age ?? 'N/A'} Y / ${patient.gender || 'Not recorded'} / ${patient.bloodGroup || 'N/A'}`, 145, infoY + 66);

            doc.fillColor(muted).font('Helvetica').text('Bill / Login ID:', 300, infoY + 30)
                .fillColor(teal).font('Helvetica-Bold').text(billNo, 385, infoY + 30);

            doc.fillColor(muted).font('Helvetica').text('Consulting Doctor:', 300, infoY + 48)
                .fillColor(dark).font('Helvetica-Bold').text(patient.assignedDoctor || 'Not recorded', 385, infoY + 48, { width: 160, height: 12, ellipsis: true });

            doc.fillColor(muted).font('Helvetica').text('Date & Contact:', 300, infoY + 66)
                .fillColor(dark).font('Helvetica-Bold').text(`${(patient.createdAt || new Date().toISOString()).slice(0, 10)} • ${patient.contact || 'Not recorded'}`, 385, infoY + 66, { width: 160, height: 12, ellipsis: true });

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

            // Secure Patient Portal Login Instructions Box (Bill Number + 8-char Access Code)
            const loginY = 325;
            doc.rect(40, loginY, 515, 130).fill('#f0f9ff').stroke('#bae6fd');
            doc.image(qrBuffer, 52, loginY + 18, { width: 90, height: 90 });

            doc.fillColor(navy).fontSize(10).font('Helvetica-Bold')
                .text('SECURE PATIENT PORTAL ACCESS (TWO-FACTOR REGISTRATION)', 158, loginY + 14);
            doc.fillColor(dark).fontSize(8.5).font('Helvetica')
                .text('1. Open the SIT Students Hospital Portal (/portal).', 158, loginY + 32)
                .text('2. Select "Patient Login" and enter your Bill Number + 8-Char Access Code (or your password).', 158, loginY + 47)
                .text('3. On first sign-in, you will be prompted to set a private personal password.', 158, loginY + 62);

            doc.rect(158, loginY + 80, 175, 26).fill('#ffffff').stroke(teal);
            doc.fillColor(navy).fontSize(9.5).font('Courier-Bold')
                .text(`BILL ID: ${billNo}`, 166, loginY + 88);

            doc.rect(343, loginY + 80, 200, 26).fill('#fffbeb').stroke('#f59e0b');
            doc.fillColor('#92400e').fontSize(9).font('Courier-Bold')
                .text(
                    oneTimeAccessCode ? `ACCESS CODE: ${oneTimeAccessCode}` : 'ACCESS CODE: Issued at Desk',
                    351,
                    loginY + 88
                );

            doc.fillColor(muted).fontSize(7.5).font('Helvetica')
                .text(`Issued By: ${patient.registeredBy || 'SIT Hospital Reception Desk'} • Valid 72h for first-time activation`, 40, 470, { width: 515, align: 'center' });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Generates an official SIT Students Hospital Doctor OPD Checkup & Medicine Prescription PDF.
 * Never fabricates default medicines, UHIDs, or vitals (F-06).
 */
async function generateDoctorPrescriptionPDF(rx) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 40,
                info: {
                    Title: `OPD Prescription - ${rx.prescriptionId || 'RX'}`,
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

            doc.rect(40, 35, 515, 72).fill('#f8fafc').stroke('#cbd5e1');
            doc.fillColor(navy).fontSize(16).font('Helvetica-Bold')
                .text('SIT STUDENTS HOSPITAL & HEALTH CENTER', 52, 46);
            doc.fillColor(teal).fontSize(9.5).font('Helvetica-Bold')
                .text(`CLINICAL CHECKUP & MEDICINE PRESCRIPTION SLIP • ${(rx.department || 'CLINICAL DEPARTMENT').toUpperCase()}`, 52, 66);
            doc.fillColor(muted).fontSize(8).font('Helvetica')
                .text(`Attending Consultant: ${rx.doctorName || 'Not recorded'} • B.H. Road, SIT Campus, Tumakuru - 572103`, 52, 82);

            doc.rect(415, 45, 128, 24).fill(teal);
            doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
                .text(rx.prescriptionId || 'RX', 415, 53, { width: 128, align: 'center' });

            const patY = 120;
            doc.rect(40, patY, 515, 68).fill('#ffffff').stroke('#cbd5e1');
            doc.fillColor(muted).fontSize(8.5).font('Helvetica').text('Patient Name:', 52, patY + 14)
                .fillColor(dark).font('Helvetica-Bold').text(`${rx.patientName || 'Not recorded'} (${rx.patientUhid || 'Not recorded'})`, 125, patY + 14);
            doc.fillColor(muted).font('Helvetica').text('Bill Number:', 52, patY + 32)
                .fillColor(navy).font('Helvetica-Bold').text(rx.billNumber || 'Not recorded', 125, patY + 32);
            doc.fillColor(muted).font('Helvetica').text('Checkup Vitals:', 52, patY + 50)
                .fillColor(dark).font('Helvetica-Bold').text(rx.vitals || 'Not recorded', 125, patY + 50);

            doc.fillColor(muted).font('Helvetica').text('Checkup Date:', 330, patY + 14)
                .fillColor(dark).font('Helvetica-Bold').text((rx.createdAt || new Date().toISOString()).slice(0, 10), 405, patY + 14);
            doc.fillColor(muted).font('Helvetica').text('Follow-Up Date:', 330, patY + 32)
                .fillColor(dark).font('Helvetica-Bold').text(rx.followUpDate || 'Not recorded', 405, patY + 32);

            const diagY = 202;
            doc.rect(40, diagY, 515, 78).fill('#f8fafc').stroke('#cbd5e1');
            doc.fillColor(navy).fontSize(9.5).font('Helvetica-Bold')
                .text('CHIEF COMPLAINTS & CLINICAL EXAMINATION FINDINGS:', 52, diagY + 10);
            doc.fillColor(dark).fontSize(8.5).font('Helvetica')
                .text(`Symptoms / Complaints: ${rx.symptoms || 'Not recorded'}`, 52, diagY + 26, { width: 490 });
            doc.fillColor('#0f766e').fontSize(9).font('Helvetica-Bold')
                .text(`Clinical Diagnosis: ${rx.diagnosis || 'Not recorded'}`, 52, diagY + 48, { width: 490 });

            const rxY = 294;
            doc.fillColor(navy).fontSize(12).font('Helvetica-Bold').text('Rx — PRESCRIBED MEDICINES & DOSAGE SCHEDULE', 40, rxY);
            doc.rect(40, rxY + 18, 515, 20).fill(navy);
            doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
            doc.text('MEDICINE NAME & STRENGTH', 52, rxY + 24);
            doc.text('DOSAGE / TIMING', 270, rxY + 24);
            doc.text('DURATION', 410, rxY + 24);
            doc.text('INSTRUCTIONS', 475, rxY + 24);

            const meds = Array.isArray(rx.medicines) ? rx.medicines : [];
            let rowY = rxY + 38;
            if (meds.length === 0) {
                doc.rect(40, rowY, 515, 24).fill('#fffbeb').stroke('#fde68a');
                doc.fillColor('#92400e').fontSize(8.5).font('Helvetica-Bold')
                    .text('No medicines recorded in structured form (see attached prescription document if applicable).', 52, rowY + 7);
                rowY += 24;
            } else {
                meds.slice(0, 12).forEach((m, idx) => {
                    doc.rect(40, rowY, 515, 22).fill(idx % 2 === 0 ? '#ffffff' : '#f8fafc').stroke('#e2e8f0');
                    doc.fillColor(dark).fontSize(8.5).font('Helvetica-Bold').text(`${idx + 1}. ${m.name || 'Not recorded'}`, 52, rowY + 6, { width: 210, ellipsis: true });
                    doc.fillColor(navy).font('Helvetica-Bold').text(m.dosage || 'Not recorded', 270, rowY + 6);
                    doc.fillColor(dark).font('Helvetica').text(m.duration || 'Not recorded', 410, rowY + 6);
                    doc.fillColor(muted).font('Helvetica').text(m.instructions || 'Not recorded', 475, rowY + 6, { width: 75, ellipsis: true });
                    rowY += 22;
                });
            }

            const advY = rowY + 16;
            doc.rect(40, advY, 515, 68).fill('#fffbeb').stroke('#fde68a');
            doc.fillColor('#92400e').fontSize(9).font('Helvetica-Bold')
                .text('DOCTOR ADVICE & DIAGNOSTIC LAB INVESTIGATION ORDERED:', 52, advY + 10);
            doc.fillColor(dark).fontSize(8.5).font('Helvetica')
                .text(`Dietary / Care Advice: ${rx.advice || 'Not recorded'}`, 52, advY + 26, { width: 490 });
            doc.fillColor(navy).fontSize(8.5).font('Helvetica-Bold')
                .text(`Lab Investigation Requested: ${rx.labTestOrdered && rx.labTestOrdered !== 'None' ? rx.labTestOrdered + ' (Sent to SIT Central Pathology Lab Queue)' : 'None'}`, 52, advY + 44, { width: 490 });

            const signY = advY + 95;
            doc.fillColor(dark).fontSize(9).font('Helvetica-Bold')
                .text(`Signed Electronically by: ${rx.doctorName || 'Attending Physician'}`, 320, signY, { width: 235, align: 'right' });
            doc.fillColor(muted).fontSize(8).font('Helvetica')
                .text(`${rx.department || 'SIT Students Hospital'} • Tumakuru`, 320, signY + 14, { width: 235, align: 'right' });

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
