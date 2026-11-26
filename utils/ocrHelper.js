const Tesseract = require('tesseract.js');
const path = require('path');

// Common clinical terms and keywords dictionary for categorization
const MEDICAL_KEYWORDS_MAP = {
    'Blood Sugar / Diabetes': ['blood sugar', 'glucose', 'fasting blood sugar', 'fbs', 'ppbs', 'hba1c', 'diabetes', 'insulin', 'glycemic'],
    'Hematology / CBC': ['hemoglobin', 'wbc', 'white blood cell', 'rbc', 'platelet', 'hematocrit', 'erythrocyte', 'cbc', 'anemia'],
    'Radiology / Orthopedic': ['fracture', 'x-ray', 'mri', 'ct scan', 'ultrasound', 'bone', 'lumbar', 'spine', 'joint', 'trauma', 'displacement'],
    'Cardiovascular': ['ecg', 'electrocardiogram', 'troponin', 'cholesterol', 'triglycerides', 'lipid', 'hdl', 'ldl', 'blood pressure', 'hypertension', 'arrhythmia'],
    'Renal / Kidney': ['creatinine', 'urea', 'bun', 'uric acid', 'kidney', 'renal', 'gfr', 'urine protein'],
    'Hepatic / Liver': ['bilirubin', 'sgot', 'sgpt', 'alt', 'ast', 'alkaline phosphatase', 'liver function', 'lft', 'albumin'],
    'Respiratory': ['pneumonia', 'chest x-ray', 'bronchitis', 'pulmonary', 'copd', 'asthma', 'lung'],
    'Endocrine': ['thyroid', 'tsh', 't3', 't4', 'vitamin d', 'calcium']
};

/**
 * Extracts recognized medical tags and keywords from raw clinical text
 * @param {string} rawText 
 * @returns {Array<{ category: string, keyword: string }>}
 */
function extractMedicalKeywords(rawText) {
    if (!rawText) return [];
    const textLower = rawText.toLowerCase();
    const matchedTags = new Set();
    const matchedCategories = new Set();

    for (const [category, keywords] of Object.entries(MEDICAL_KEYWORDS_MAP)) {
        for (const kw of keywords) {
            // Whole word or boundary regex
            const regex = new RegExp(`\\b${kw}\\b`, 'i');
            if (regex.test(textLower)) {
                matchedTags.add(kw.charAt(0).toUpperCase() + kw.slice(1));
                matchedCategories.add(category);
            }
        }
    }

    return {
        keywords: Array.from(matchedTags),
        categories: Array.from(matchedCategories),
        rawSnippet: rawText.slice(0, 300).trim()
    };
}

/**
 * Lightweight structural validation for image buffers BEFORE sending to Tesseract WASM.
 * Prevents truncated/corrupted PNG/JPEG/WEBP uploads from triggering fatal Leptonica worker crashes (DoS).
 */
function isStructurallyValidImageBuffer(buf, mimeType = '') {
    if (!Buffer.isBuffer(buf) || buf.length < 16) return false;
    const mime = String(mimeType || '').toLowerCase();

    // PNG structural check: must contain valid length-bounded IHDR, at least one IDAT, and terminating IEND chunk
    const isPng = mime.includes('png') ||
        (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47);
    if (isPng) {
        if (buf.length < 33) return false;
        let offset = 8;
        let hasIhdr = false;
        let hasIdat = false;
        let hasIend = false;
        while (offset + 12 <= buf.length) {
            const chunkLen = buf.readUInt32BE(offset);
            const chunkType = buf.subarray(offset + 4, offset + 8).toString('ascii');
            const nextOffset = offset + 12 + chunkLen;
            if (nextOffset > buf.length || chunkLen > 50 * 1024 * 1024) {
                return false; // Truncated chunk payload or corrupt length
            }
            if (chunkType === 'IHDR') {
                if (chunkLen !== 13) return false;
                const width = buf.readUInt32BE(offset + 8);
                const height = buf.readUInt32BE(offset + 12);
                if (width === 0 || height === 0 || width > 20000 || height > 20000) return false;
                hasIhdr = true;
            } else if (chunkType === 'IDAT') {
                hasIdat = true;
            } else if (chunkType === 'IEND') {
                hasIend = true;
                break;
            }
            offset = nextOffset;
        }
        return hasIhdr && hasIdat && hasIend;
    }

    // JPEG structural check: must start with SOI (FF D8) and contain EOI (FF D9)
    const isJpeg = mime.includes('jpeg') || mime.includes('jpg') ||
        (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF);
    if (isJpeg) {
        if (buf.length < 100) return false;
        let hasEoi = false;
        for (let i = buf.length - 2; i >= 2; i--) {
            if (buf[i] === 0xFF && buf[i + 1] === 0xD9) {
                hasEoi = true;
                break;
            }
        }
        return hasEoi;
    }

    // WEBP structural check: RIFF header size must fit inside buffer
    const isWebp = mime.includes('webp') ||
        (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP');
    if (isWebp) {
        const declaredSize = buf.readUInt32LE(4) + 8;
        return declaredSize >= 20 && declaredSize <= buf.length;
    }

    return true;
}

/**
 * Performs OCR on image buffer using Tesseract.js with structural pre-check & worker error isolation
 * @param {Buffer|string} inputBufferOrPath 
 * @param {string} mimeType 
 * @param {string} [hintText] Optional hint text from doctor/lab staff notes
 * @returns {Promise<{ extractedText: string, keywords: string[], categories: string[] }>}
 */
async function processReportOCR(inputBufferOrPath, mimeType = '', hintText = '') {
    let extractedText = '';

    // If text hint was provided in metadata or user description, include it
    if (hintText) {
        extractedText += hintText + ' ';
    }

    // Try Tesseract OCR on images (PNG, JPEG, WEBP)
    const isImage = mimeType.startsWith('image/') ||
                   (typeof inputBufferOrPath === 'string' && /\.(png|jpe?g|bmp|webp)$/i.test(inputBufferOrPath));

    if (isImage) {
        const bufferLooksValid = !Buffer.isBuffer(inputBufferOrPath) ||
            isStructurallyValidImageBuffer(inputBufferOrPath, mimeType);

        if (!bufferLooksValid) {
            console.warn('[OCR Engine] Skipping Tesseract OCR: uploaded image buffer is truncated or structurally malformed.');
        } else {
            let worker = null;
            let timeoutHandle = null;
            try {
                let workerReject = null;
                const workerErrorPromise = new Promise((_, reject) => {
                    workerReject = reject;
                });

                worker = await Tesseract.createWorker('eng', 1, {
                    logger: () => {},
                    errorHandler: (workerErr) => {
                        const errObj = workerErr instanceof Error ? workerErr : new Error(String(workerErr || 'OCR worker error'));
                        if (workerReject) workerReject(errObj);
                    }
                });

                const ocrPromise = worker.recognize(inputBufferOrPath);
                const timeoutPromise = new Promise((_, reject) => {
                    timeoutHandle = setTimeout(() => reject(new Error('OCR Timeout')), 12000);
                    if (typeof timeoutHandle.unref === 'function') timeoutHandle.unref();
                });

                const result = await Promise.race([ocrPromise, workerErrorPromise, timeoutPromise]);
                if (result && result.data && result.data.text) {
                    extractedText += ' ' + result.data.text;
                }
            } catch (err) {
                console.warn('[OCR Engine] Tesseract recognition fallback:', err.message);
                // Non-fatal fallback: use text buffer strings if any
                if (Buffer.isBuffer(inputBufferOrPath)) {
                    const asciiGuess = inputBufferOrPath.toString('utf8', 0, Math.min(2048, inputBufferOrPath.length));
                    extractedText += ' ' + asciiGuess.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ');
                }
            } finally {
                if (timeoutHandle) clearTimeout(timeoutHandle);
                if (worker) {
                    try { await worker.terminate(); } catch (_) {}
                }
            }
        }
    } else {
        // PDF or plain document stream inspection
        if (Buffer.isBuffer(inputBufferOrPath)) {
            const raw = inputBufferOrPath.toString('latin1');
            // Extract text tokens from PDF streams: Tj and TJ operators
            const tjMatches = raw.match(/\(([^()]+)\)\s*Tj/g) || [];
            const tjText = tjMatches.map(m => m.replace(/^\(|\)\s*Tj$/g, '').replace(/\\([()\\])/g, '$1').trim()).filter(Boolean).join(' ');

            const tjArrayMatches = raw.match(/\[(.*?)\]\s*TJ/g) || [];
            const arrayText = tjArrayMatches.map(arr => {
                const parts = arr.match(/\(([^()]+)\)/g) || [];
                return parts.map(p => p.slice(1, -1).replace(/\\([()\\])/g, '$1').trim()).filter(Boolean).join(' ');
            }).filter(Boolean).join(' ');

            let combinedPdfText = [tjText, arrayText].filter(Boolean).join(' ');

            // Only inspect raw stream runs if standard text operators yielded nothing
            if (!combinedPdfText.trim()) {
                const asciiMatches = raw.match(/[A-Za-z0-9][A-Za-z0-9\s.,:%/\-–]{4,}[A-Za-z0-9]/g) || [];
                const pdfKeywords = new Set([
                    'stream', 'endstream', 'endobj', 'Font', 'Type', 'Subtype', 'Widths',
                    'Filter', 'FlateDecode', 'Length', 'Pages', 'Catalog', 'Producer', 'Root',
                    'AcroForm', 'Contents', 'CropBox', 'MediaBox', 'Parent', 'Resources'
                ]);
                const cleanAscii = asciiMatches
                    .filter(w => {
                        const trimmed = w.trim();
                        if (pdfKeywords.has(trimmed) || /^\s*\/[a-zA-Z]+/.test(w)) return false;
                        // Filter out hex dumps or postscript operator sequences (e.g. "re scn cm")
                        if (/^[0-9a-fA-F\s]{6,}$/.test(trimmed)) return false;
                        if (/\b(re|cm|scn|cs|gs|Do|BT|ET|rg|RG)\b/.test(trimmed)) return false;
                        // Must have at least one vowel to resemble human language
                        return /[aeiou]/i.test(trimmed);
                    })
                    .slice(0, 30)
                    .join(' ');

                combinedPdfText = cleanAscii;
            }

            if (combinedPdfText.trim()) {
                extractedText += ' ' + combinedPdfText.replace(/\s+/g, ' ');
            }
        }
    }

    const { keywords, categories, rawSnippet } = extractMedicalKeywords(extractedText);

    return {
        extractedText: extractedText.trim(),
        keywords,
        categories,
        rawSnippet
    };
}

module.exports = {
    processReportOCR,
    extractMedicalKeywords,
    MEDICAL_KEYWORDS_MAP
};
