const { z } = require('zod');
const { config } = require('../config');

const diagnosisSchema = z.object({
  severity: z.enum(['low', 'medium', 'high']),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(10),
  detectedIssues: z.array(z.string()).min(1),
  recommendations: z.array(z.string()).min(2),
});

function heuristicDiagnosis({ context, note }) {
  const text = `${context ?? ''} ${note ?? ''}`.toLowerCase();
  const issues = [];

  if (text.includes('amarill')) issues.push('Posible exceso de riego o falta de nutrientes');
  if (text.includes('mancha') || text.includes('hongo')) issues.push('Posible infección fúngica');
  if (text.includes('seca') || text.includes('marron')) issues.push('Estrés hídrico');
  if (text.includes('bicho') || text.includes('plaga')) issues.push('Posible plaga activa');
  if (!issues.length) issues.push('Estrés general por ambiente o riego');

  const severity = text.includes('plaga') || text.includes('hongo') ? 'high' : issues.length > 1 ? 'medium' : 'low';

  return {
    severity,
    confidence: severity === 'high' ? 0.72 : 0.62,
    summary:
      severity === 'high'
        ? 'Se detectan signos de estrés severo con posible infección o plaga.'
        : 'Se observan signos de estrés moderado que requieren ajuste de cuidado.',
    detectedIssues: issues,
    recommendations: [
      'Aislar la planta y revisar anverso y reverso de hojas.',
      'Ajustar riego: evitar encharcamiento y verificar humedad de sustrato.',
      'Mejorar ventilación y mantener luz indirecta brillante.',
      'Tomar nueva foto en 48-72h para reevaluar evolución.',
    ],
  };
}

// Extract base64 data and mime type from a data URL
function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Formato de imagen inválido');
  return { mimeType: match[1], data: match[2] };
}

async function callGeminiForDiagnosis({ context, note, imageUrl, plant }) {
  const prompt = [
    'Sos un experto en fitopatología para uso doméstico.',
    `Planta: ${plant.name}. Especie estimada: ${plant.species_guess}.`,
    `Ubicación: ${plant.location}. Nivel de luz: ${plant.light_level}.`,
    `Contexto del usuario: ${context ?? ''}. Nota: ${note ?? ''}.`,
    'Analizá la imagen y devolvé SOLO un JSON válido sin markdown con los campos:',
    'severity (low|medium|high), confidence (0..1), summary (string), detectedIssues (array), recommendations (array).',
    'Sé específico con acciones concretas de cuidado y recuperación.',
  ].join(' ');

  const parts = [{ text: prompt }];

  if (imageUrl) {
    const { mimeType, data } = parseDataUrl(imageUrl);
    parts.push({ inline_data: { mime_type: mimeType, data } });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: { response_mime_type: 'application/json', temperature: 0.2 },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini error: ${text}`);
  }

  const data = await response.json();
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('Respuesta vacía de Gemini');

  return JSON.parse(content);
}

async function generateDiagnosis(input) {
  let rawResult;
  if (config.geminiApiKey) {
    try {
      rawResult = await callGeminiForDiagnosis(input);
    } catch (err) {
      console.warn('Gemini falló, usando heurística:', err.message);
      rawResult = heuristicDiagnosis(input);
    }
  } else {
    rawResult = heuristicDiagnosis(input);
  }

  return diagnosisSchema.parse(rawResult);
}

module.exports = { generateDiagnosis, diagnosisSchema };
