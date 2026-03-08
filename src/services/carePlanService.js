const { config } = require('../config');

// Argentina is UTC-3
const ART_OFFSET_HOURS = -3;

function toARTHour(utcDate) {
  return (utcDate.getUTCHours() + 24 + ART_OFFSET_HOURS) % 24;
}

// Returns the next date where the local ART hour is within [targetHour, targetHour+1)
// and at least minDaysFromNow days from now
function nextScheduledDate(fromDate, minDaysFromNow, targetHourART) {
  const d = new Date(fromDate);
  d.setUTCDate(d.getUTCDate() + minDaysFromNow);
  // Set time so that ART hour == targetHourART → UTC = targetHourART - ART_OFFSET
  d.setUTCHours(targetHourART - ART_OFFSET_HOURS, 0, 0, 0);
  return d;
}

function buildFallbackTasks(diagnosis, plantId) {
  const now = new Date();
  const tasks = [
    {
      plantId,
      title: 'Inspección visual',
      details: 'Revisá hojas (frente/reverso), tallos y sustrato. Registrá cambios visibles.',
      scheduledFor: nextScheduledDate(now, 0, 10).toISOString(), // today 10:00 ART
      priority: 4,
      category: 'inspection',
    },
    {
      plantId,
      title: 'Riego',
      details: 'Regá solo si los primeros 2-3 cm del sustrato están secos.',
      scheduledFor: nextScheduledDate(now, 3, 17).toISOString(), // in 3 days 17:00 ART
      priority: 3,
      category: 'watering',
    },
    {
      plantId,
      title: 'Reevaluación con nueva foto',
      details: 'Tomá nueva foto y comparar evolución para ajustar el plan.',
      scheduledFor: nextScheduledDate(now, 7, 10).toISOString(), // in 7 days 10:00 ART
      priority: 3,
      category: 'inspection',
    },
  ];

  if (diagnosis.severity === 'high') {
    tasks.unshift({
      plantId,
      title: 'Acción urgente de recuperación',
      details: 'Retirá hojas muy dañadas y aislá la planta para evitar contagio.',
      scheduledFor: nextScheduledDate(now, 0, 17).toISOString(), // today 17:00 ART
      priority: 5,
      category: 'recovery',
    });
  }

  return tasks;
}

const LANGUAGE_NAMES = { es: 'español', en: 'English', pt: 'português' };

async function callGeminiForCarePlan(diagnosis, plant, language = 'es') {
  const now = new Date();
  const nowART = now.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const langName = LANGUAGE_NAMES[language] ?? 'español';

  const prompt = `You are an expert in domestic plant care. Generate a personalized care plan. Respond ONLY in ${langName}. All text fields (title, details) MUST be written in ${langName}.

Planta: ${plant.name}
Especie: ${plant.species_guess}
Ubicación: ${plant.location}
Nivel de luz: ${plant.light_level}
Fecha/hora actual (Argentina UTC-3): ${nowART}
Fecha UTC actual: ${now.toISOString()}

Diagnóstico:
- Severidad: ${diagnosis.severity}
- Resumen: ${diagnosis.summary}
- Problemas detectados: ${diagnosis.detectedIssues.join(', ')}
- Recomendaciones: ${diagnosis.recommendations.join(', ')}

Generá entre 4 y 7 tareas de cuidado con scheduledFor en ISO UTC teniendo en cuenta:
- Tareas de riego (category: "watering"): programalas entre las 17:00-18:00 hora Argentina (20:00-21:00 UTC). Frecuencia: cada 3 días si luz media/alta, cada 4-5 días si luz baja.
- Tareas de inspección (category: "inspection"): programalas entre las 10:00-11:00 hora Argentina (13:00-14:00 UTC). Frecuencia: cada 3 días.
- Si severidad es "high": incluí una tarea de recuperación urgente hoy.
- Fertilización (category: "fertilizing"): solo si es relevante, cada 2 semanas.

Devolvé SOLO un array JSON válido sin markdown. Cada objeto debe tener:
{
  "title": string (corto, descriptivo),
  "details": string (instrucciones concretas de qué hacer),
  "scheduledFor": string (ISO 8601 en UTC),
  "priority": number (1-5, donde 5 es máxima urgencia),
  "category": "watering" | "inspection" | "fertilizing" | "recovery" | "other"
}
Ordenar por scheduledFor ascendente.`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { response_mime_type: 'application/json', temperature: 0.3 },
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

  const tasks = JSON.parse(content);
  if (!Array.isArray(tasks)) throw new Error('Gemini no devolvió un array');

  return tasks.map((t) => ({
    plantId: plant.id,
    title: String(t.title),
    details: String(t.details),
    scheduledFor: String(t.scheduledFor),
    priority: Number(t.priority) || 3,
    category: ['watering', 'inspection', 'fertilizing', 'recovery', 'other'].includes(t.category)
      ? t.category
      : 'other',
  }));
}

async function buildCareTasksFromDiagnosis(diagnosis, plant, language = 'es') {
  if (config.geminiApiKey) {
    try {
      return await callGeminiForCarePlan(diagnosis, plant, language);
    } catch (err) {
      console.warn('Gemini falló para care plan, usando fallback:', err.message);
    }
  }
  return buildFallbackTasks(diagnosis, plant.id);
}

module.exports = { buildCareTasksFromDiagnosis };
