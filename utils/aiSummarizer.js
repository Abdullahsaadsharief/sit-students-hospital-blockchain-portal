const { GoogleGenAI } = require('@google/genai');
const config = require('../config');

const CLINICAL_DISCLAIMER = 'Automated summary, not clinical advice; requires clinician review.';

/**
 * Offline Clinical Rule-based NLP Extractor
 * Operates 100% locally without transmitting patient data externally.
 * Strictly never fabricates normal results or certification claims (F-08).
 */
function extractOfflineClinicalHighlights(rawText, metadata = {}) {
    const text = (rawText || '').trim();
    const textLower = text.toLowerCase();

    const keyFindings = [];
    const abnormalFlags = [];
    const testParameters = [];

    const labPatterns = [
        { name: 'Fasting Blood Glucose', regex: /(?:glucose|fbs|fasting\s*sugar)[^\d]*(\d+(?:\.\d+)?)\s*(mg\/dl)?/i, normalMax: 100, normalMin: 70, unit: 'mg/dL' },
        { name: 'Post-Prandial Glucose', regex: /(?:ppbs|post\s*prandial)[^\d]*(\d+(?:\.\d+)?)\s*(mg\/dl)?/i, normalMax: 140, normalMin: 80, unit: 'mg/dL' },
        { name: 'HbA1c Glycated Hemoglobin', regex: /(?:hba1c|glycated\s*hemoglobin)[^\d]*(\d+(?:\.\d+)?)\s*(%)?/i, normalMax: 5.7, normalMin: 4.0, unit: '%' },
        { name: 'Total Hemoglobin', regex: /(?:hemoglobin|hb)[^\d]*(\d+(?:\.\d+)?)\s*(g\/dl)?/i, normalMax: 17.5, normalMin: 12.0, unit: 'g/dL' },
        { name: 'Total Leukocyte Count (WBC)', regex: /(?:wbc|leukocyte)[^\d]*(\d+(?:,\d+)?|\d+)/i, normalMax: 11000, normalMin: 4000, unit: '/mcL' },
        { name: 'Platelet Count', regex: /(?:platelet)[^\d]*(\d+(?:,\d+)?|\d+)/i, normalMax: 450000, normalMin: 150000, unit: '/mcL' },
        { name: 'Serum Creatinine', regex: /(?:creatinine)[^\d]*(\d+(?:\.\d+)?)\s*(mg\/dl)?/i, normalMax: 1.2, normalMin: 0.6, unit: 'mg/dL' },
        { name: 'Blood Urea Nitrogen', regex: /(?:bun|urea)[^\d]*(\d+(?:\.\d+)?)\s*(mg\/dl)?/i, normalMax: 20, normalMin: 7, unit: 'mg/dL' }
    ];

    for (const p of labPatterns) {
        const match = text.match(p.regex);
        if (match) {
            const valNum = parseFloat(match[1].replace(/,/g, ''));
            if (Number.isNaN(valNum)) continue;

            keyFindings.push(`${p.name}: ${match[1]} ${p.unit}`);

            const isHigh = valNum > p.normalMax;
            const isLow = valNum < p.normalMin;
            const isAbnormal = isHigh || isLow;

            testParameters.push({
                parameter: p.name,
                value: `${match[1]} ${p.unit}`,
                ref: `${p.normalMin} - ${p.normalMax} ${p.unit}`,
                status: isHigh ? 'HIGH' : isLow ? 'LOW' : 'NORMAL',
                isAbnormal
            });

            if (isHigh) {
                abnormalFlags.push(`Elevated ${p.name} (${match[1]} ${p.unit}) - Above reference threshold (${p.normalMax} ${p.unit})`);
            } else if (isLow) {
                abnormalFlags.push(`Low ${p.name} (${match[1]} ${p.unit}) - Below reference threshold (${p.normalMin} ${p.unit})`);
            }
        }
    }

    if (textLower.includes('fracture')) {
        abnormalFlags.push('Radiological term "fracture" identified in text — requires radiologist confirmation.');
        keyFindings.push('Text references a fracture finding');
        testParameters.push({
            parameter: 'Cortical Bone Finding (Text Match)',
            value: 'Fracture Mentioned',
            ref: 'Verify on Source Image',
            status: 'ABNORMAL',
            isAbnormal: true
        });
    }
    if (textLower.includes('cardiomegaly')) {
        abnormalFlags.push('Text references "cardiomegaly" — requires clinician confirmation.');
        keyFindings.push('Cardiomegaly noted in source text');
        testParameters.push({
            parameter: 'Cardiac Silhouette (Text Match)',
            value: 'Cardiomegaly Mentioned',
            ref: 'Verify on Source Image',
            status: 'ABNORMAL',
            isAbnormal: true
        });
    }
    if (textLower.includes('infiltrate') || textLower.includes('consolidation') || textLower.includes('pneumonia')) {
        abnormalFlags.push('Pulmonary opacity / consolidation terms detected — requires clinician review.');
        keyFindings.push('Pulmonary parenchymal terms detected in source text');
        testParameters.push({
            parameter: 'Pulmonary Parenchyma (Text Match)',
            value: 'Opacity / Consolidation Mentioned',
            ref: 'Verify on Source Image',
            status: 'ABNORMAL',
            isAbnormal: true
        });
    }

    let diagnosticImpression;
    let recommendedAction;

    if (testParameters.length === 0) {
        // F-08: NEVER invent "Completed & Certified", "Within Established Limits", or "NABH Reference Range"
        diagnosticImpression = 'No results could be extracted automatically; review the source document.';
        recommendedAction = 'Clinician review of the original diagnostic document is required.';
        keyFindings.length = 0;
        keyFindings.push('No structured measurements could be extracted automatically; review the source document.');
    } else if (abnormalFlags.length > 0) {
        diagnosticImpression = `Automated parser flagged ${abnormalFlags.length} potentially out-of-range value(s). Verify against the source document.`;
        recommendedAction = 'Clinician verification and clinical correlation required before treatment decisions.';
    } else {
        diagnosticImpression = `Extracted ${testParameters.length} measurement(s) within standard text-rule intervals. Verify against the original lab reference range.`;
        recommendedAction = 'Pending attending physician review and sign-off.';
    }

    return {
        testParameters: testParameters.slice(0, 5),
        keyFindings: keyFindings.slice(0, 5),
        abnormalFlags: abnormalFlags.length > 0
            ? abnormalFlags
            : (testParameters.length > 0 ? ['No automated out-of-range flags triggered (pending clinician review)'] : ['Unextracted — review original document']),
        diagnosticImpression,
        recommendedAction,
        disclaimer: CLINICAL_DISCLAIMER,
        clinicianReviewed: false,
        aiEngine: 'Local Clinical Rule Engine (Offline)',
        analyzedAt: new Date().toISOString()
    };
}

/**
 * Hybrid Clinical AI Summarizer
 * Only invokes Google Gemini if BOTH AI_EXTERNAL_PROCESSING=true AND GEMINI_API_KEY is configured.
 * Sends pseudonymous patient ID (never full patientName) to external AI providers.
 */
async function generateClinicalHighlights(rawText, metadata = {}) {
    const apiKey = process.env.GEMINI_API_KEY;
    const allowExternal = config.AI_EXTERNAL_PROCESSING === true;

    if (!allowExternal || !apiKey) {
        return extractOfflineClinicalHighlights(rawText, metadata);
    }

    try {
        const ai = new GoogleGenAI({ apiKey });

        // Privacy protection: pass only pseudonymous ID, never patient full name
        const safePseudonym = metadata.patientPseudonym || 'PT-ANON';

        const prompt = `You are assisting a hospital clinician by summarizing OCR/text from a diagnostic report.
Do NOT invent or assume any test parameters or normal values that are not explicitly written in the text below.
If no numeric or explicit clinical measurements are present, return an empty array for "testParameters" and state that no results could be extracted automatically.

REPORT METADATA (DE-IDENTIFIED):
Title: ${metadata.title || 'Diagnostic Report'}
Patient Reference: ${safePseudonym}
Report Category: ${metadata.reportType || 'Clinical Investigation'}

RAW REPORT CONTENT / OCR SCAN:
"""
${(rawText || '').slice(0, 3500)}
"""

Return a valid JSON object matching this exact schema:
{
  "testParameters": [
    {
      "parameter": "Parameter name explicitly found in text",
      "value": "Observed measurement with unit explicitly found in text",
      "ref": "Reference interval if stated, else 'See source'",
      "status": "NORMAL or HIGH or LOW or ABNORMAL",
      "isAbnormal": true
    }
  ],
  "keyFindings": ["Concise bullets grounded strictly in the provided text"],
  "abnormalFlags": ["Only abnormal results explicitly present in the text"],
  "diagnosticImpression": "1-2 sentence neutral summary requiring clinician confirmation",
  "recommendedAction": "1 sentence noting clinician verification is required"
}`;

        const preferred = process.env.GEMINI_ACTIVE_MODEL || 'gemini-2.5-flash';
        const CANDIDATE_MODELS = [preferred, 'gemini-2.5-flash', 'gemini-2.0-flash'].filter((v, i, a) => a.indexOf(v) === i);
        let response = null;
        let usedModel = null;
        let lastErr = null;

        for (const model of CANDIDATE_MODELS) {
            try {
                response = await ai.models.generateContent({
                    model,
                    contents: prompt,
                    config: {
                        responseMimeType: 'application/json',
                        temperature: 0.1,
                        maxOutputTokens: 1200
                    }
                });
                if (response && response.text) {
                    usedModel = model;
                    break;
                }
            } catch (mErr) {
                lastErr = mErr;
            }
        }

        if (!response || !response.text) {
            throw lastErr || new Error('No candidate Gemini model responded.');
        }

        const responseText = (response.text || '').trim();
        let parsed = null;
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                parsed = JSON.parse(jsonMatch[0]);
            } catch (_) {}
        }
        if (!parsed) {
            parsed = JSON.parse(responseText.replace(/```json/gi, '').replace(/```/g, '').trim());
        }

        let testParameters = [];
        if (Array.isArray(parsed.testParameters) && parsed.testParameters.length > 0) {
            testParameters = parsed.testParameters.slice(0, 5).map(p => ({
                parameter: String(p.parameter || 'Measurement').slice(0, 45),
                value: String(p.value || 'See source').slice(0, 25),
                ref: String(p.ref || 'See source').slice(0, 25),
                status: String(p.status || (p.isAbnormal ? 'ABNORMAL' : 'OBSERVED')).toUpperCase().slice(0, 15),
                isAbnormal: Boolean(p.isAbnormal)
            }));
        }

        return {
            testParameters,
            keyFindings: Array.isArray(parsed.keyFindings) && parsed.keyFindings.length > 0
                ? parsed.keyFindings.map(String)
                : ['No structured findings extracted automatically; review source document.'],
            abnormalFlags: Array.isArray(parsed.abnormalFlags) && parsed.abnormalFlags.length > 0
                ? parsed.abnormalFlags.map(String)
                : ['Pending clinician verification against original document.'],
            diagnosticImpression: parsed.diagnosticImpression || 'Automated summary pending clinician review.',
            recommendedAction: parsed.recommendedAction || 'Clinician review of the original document is required.',
            disclaimer: CLINICAL_DISCLAIMER,
            clinicianReviewed: false,
            aiEngine: `Google Gemini (${usedModel}) — De-identified External Summary`,
            analyzedAt: new Date().toISOString()
        };
    } catch (err) {
        console.warn('[AI Summarizer] External AI unavailable, using offline rule parser:', err.message);
        const fallback = extractOfflineClinicalHighlights(rawText, metadata);
        fallback.aiEngine = 'Local Clinical Rule Engine (Offline Fallback)';
        return fallback;
    }
}

async function testGeminiApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
        throw new Error('Please provide a valid, non-empty Google Gemini API key.');
    }
    const cleanKey = apiKey.trim();
    const ai = new GoogleGenAI({ apiKey: cleanKey });

    let availableModels = [];
    try {
        const pager = await ai.models.list({ config: { pageSize: 50 } });
        for await (const m of pager) {
            const rawName = m.name ? m.name.replace(/^models\//, '') : '';
            if (rawName) availableModels.push(rawName);
        }
    } catch (listErr) {
        const msg = String(listErr.message || '');
        if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid') || msg.includes('PERMISSION_DENIED') || msg.includes('INVALID_ARGUMENT')) {
            throw new Error('Google Gemini API key was rejected as invalid by Google AI Studio.');
        }
    }

    const PREFERRED_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
    const candidates = availableModels.length > 0
        ? PREFERRED_MODELS.filter(m => availableModels.includes(m)).concat(availableModels.filter(m => m.includes('flash') && !PREFERRED_MODELS.includes(m)))
        : PREFERRED_MODELS;

    let activeModel = candidates[0] || 'gemini-2.5-flash';
    let testSuccess = false;
    let lastError = null;

    for (const model of candidates.slice(0, 3)) {
        try {
            const response = await ai.models.generateContent({
                model,
                contents: 'Connection check: reply OK',
                config: { maxOutputTokens: 5 }
            });
            if (response) {
                activeModel = model;
                testSuccess = true;
                break;
            }
        } catch (genErr) {
            lastError = genErr;
            const errMsg = String(genErr.message || '');
            if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('PERMISSION_DENIED')) {
                throw new Error('Google Gemini API key was rejected as invalid by Google AI Studio.');
            }
        }
    }

    process.env.GEMINI_ACTIVE_MODEL = activeModel;

    if (testSuccess) {
        return {
            success: true,
            activeModel,
            message: `Cloud connection to Google Gemini (${activeModel}) confirmed.`
        };
    }

    const lastMsg = lastError ? String(lastError.message || '') : '';
    if (availableModels.length > 0 || lastMsg.includes('503') || lastMsg.includes('429')) {
        return {
            success: true,
            activeModel,
            warning: 'API key authenticated, though cloud endpoints are currently busy; offline fallback remains available.',
            message: `API Key verified for Google Gemini (${activeModel}).`
        };
    }

    throw lastError || new Error('Could not establish connection to Google Gemini.');
}

module.exports = {
    generateClinicalHighlights,
    extractOfflineClinicalHighlights,
    testGeminiApiKey,
    CLINICAL_DISCLAIMER
};
