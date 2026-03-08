const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { config } = require('./config');
const { z } = require('zod');
const { authMiddleware, signToken } = require('./auth');
const { query, withTransaction, pool } = require('./db');
const { generateDiagnosis } = require('./services/diagnosisService');
const { buildCareTasksFromDiagnosis } = require('./services/carePlanService');
const { mapProgressRow } = require('./services/progressService');
const { uploadImageFromDataUrl } = require('./services/storageService');
const {
  queueNotificationsForUpcomingTasks,
  markQueuedNotificationsAsSent,
} = require('./services/schedulerService');

const app = express();
app.use(cors({
  origin: '*',
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(express.json({ limit: '5mb' }));

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(6),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const plantSchema = z.object({
  name: z.string().min(1),
  speciesGuess: z.string().min(1),
  location: z.string().min(1),
  lightLevel: z.enum(['low', 'medium', 'high']),
});

const diagnoseSchema = z.object({
  imageUrl: z.string().min(10), // accepts data URLs, file://, content://, or https://
  note: z.string().optional(),
  context: z.string().min(5),
  language: z.enum(['es', 'en', 'pt']).optional().default('es'),
});

function mapPlant(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    speciesGuess: row.species_guess,
    location: row.location,
    lightLevel: row.light_level,
    colorRgb: row.color_rgb ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTask(row) {
  return {
    id: row.id,
    plantId: row.plant_id,
    title: row.title,
    details: row.details,
    scheduledFor: row.scheduled_for,
    status: row.status,
    priority: row.priority,
    category: row.category,
  };
}

function mapDiagnosis(row) {
  return {
    id: row.id,
    plantId: row.plant_id,
    severity: row.severity,
    confidence: Number(row.confidence),
    summary: row.summary,
    detectedIssues: row.detected_issues,
    recommendations: row.recommendations,
    createdAt: row.created_at,
  };
}

app.get('/health', async (_req, res) => {
  const result = await query('SELECT NOW() AS now');
  res.json({ ok: true, dbTime: result.rows[0].now });
});

app.post('/auth/register', async (req, res) => {
  try {
    const { email, name, password } = registerSchema.parse(req.body);
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) {
      return res.status(409).json({ message: 'El email ya está registrado' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email, name, passwordHash],
    );
    const token = signToken(rows[0]);
    return res.status(201).json({ token, user: rows[0] });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (!rows.length) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }
    const token = signToken(rows[0]);
    return res.json({ token, user: { id: rows[0].id, email: rows[0].email, name: rows[0].name } });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.use(authMiddleware);

app.get('/plants', async (req, res) => {
  const sql = `SELECT * FROM plants WHERE user_id = $1 ORDER BY created_at DESC`;
  const { rows } = await query(sql, [req.user.id]);
  res.json(rows.map(mapPlant));
});

app.post('/plants', async (req, res) => {
  try {
    const payload = plantSchema.parse(req.body);
    const sql = `
      INSERT INTO plants (user_id, name, species_guess, location, light_level)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const { rows } = await query(sql, [
      req.user.id,
      payload.name,
      payload.speciesGuess,
      payload.location,
      payload.lightLevel,
    ]);
    res.status(201).json(mapPlant(rows[0]));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.get('/plants/:plantId', async (req, res) => {
  const plantSql = `SELECT * FROM plants WHERE id = $1 AND user_id = $2`;
  const { rows: plantRows } = await query(plantSql, [req.params.plantId, req.user.id]);
  if (!plantRows.length) {
    return res.status(404).json({ message: 'Planta no encontrada' });
  }

  const [diagResult, tasksResult] = await Promise.all([
    query(`SELECT * FROM diagnoses WHERE plant_id = $1 ORDER BY created_at DESC LIMIT 10`, [req.params.plantId]),
    query(
      `SELECT * FROM care_tasks WHERE plant_id = $1 AND scheduled_for >= NOW() - INTERVAL '7 days' ORDER BY scheduled_for ASC`,
      [req.params.plantId],
    ),
  ]);

  return res.json({
    plant: mapPlant(plantRows[0]),
    diagnoses: diagResult.rows.map(mapDiagnosis),
    tasks: tasksResult.rows.map(mapTask),
  });
});

app.patch('/plants/:plantId/color', async (req, res) => {
  const schema = z.object({ colorRgb: z.string().regex(/^\d{1,3},\d{1,3},\d{1,3}$/) });
  try {
    const { colorRgb } = schema.parse(req.body);
    const { rows } = await query(
      `UPDATE plants SET color_rgb = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
      [colorRgb, req.params.plantId, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ message: 'Planta no encontrada' });
    return res.json(mapPlant(rows[0]));
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get('/plants/:plantId/photos', async (req, res) => {
  const ownership = await query('SELECT id FROM plants WHERE id = $1 AND user_id = $2', [
    req.params.plantId,
    req.user.id,
  ]);
  if (!ownership.rows.length) {
    return res.status(404).json({ message: 'Planta no encontrada' });
  }
  const result = await query(
    `SELECT id, plant_id, image_url, note, context, captured_at
     FROM plant_photos
     WHERE plant_id = $1
     ORDER BY captured_at DESC`,
    [req.params.plantId],
  );
  return res.json(
    result.rows.map((row) => ({
      id: row.id,
      plantId: row.plant_id,
      imageUrl: row.image_url,
      note: row.note,
      context: row.context,
      capturedAt: row.captured_at,
    })),
  );
});

app.post('/plants/:plantId/photos', async (req, res) => {
  const schema = z.object({
    imageUrl: z.string().url().or(z.string().startsWith('file://')).or(z.string().startsWith('content://')),
    note: z.string().optional(),
    context: z.string().optional(),
  });
  try {
    const payload = schema.parse(req.body);
    const ownership = await query('SELECT id FROM plants WHERE id = $1 AND user_id = $2', [
      req.params.plantId,
      req.user.id,
    ]);
    if (!ownership.rows.length) {
      return res.status(404).json({ message: 'Planta no encontrada' });
    }
    const inserted = await query(
      `INSERT INTO plant_photos (plant_id, image_url, note, context)
       VALUES ($1, $2, $3, $4)
       RETURNING id, plant_id, image_url, note, context, captured_at`,
      [req.params.plantId, payload.imageUrl, payload.note ?? null, payload.context ?? null],
    );
    return res.status(201).json({
      id: inserted.rows[0].id,
      plantId: inserted.rows[0].plant_id,
      imageUrl: inserted.rows[0].image_url,
      note: inserted.rows[0].note,
      context: inserted.rows[0].context,
      capturedAt: inserted.rows[0].captured_at,
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post('/plants/:plantId/diagnose', async (req, res) => {
  try {
    const payload = diagnoseSchema.parse(req.body);

    const txResult = await withTransaction(async (client) => {
      const plantCheck = await client.query(
        'SELECT * FROM plants WHERE id = $1 AND user_id = $2',
        [req.params.plantId, req.user.id],
      );
      if (!plantCheck.rows.length) {
        throw new Error('Planta no encontrada');
      }
      const plant = plantCheck.rows[0];

      // Upload to R2 if it's a data URL; otherwise use the URL as-is
      let storedImageUrl = payload.imageUrl;
      if (payload.imageUrl.startsWith('data:')) {
        const key = `plants/${plant.id}/${Date.now()}.jpg`;
        try {
          storedImageUrl = await uploadImageFromDataUrl(payload.imageUrl, key);
        } catch (err) {
          console.warn('R2 upload failed, storing data URL as fallback:', err.message);
        }
      }

      const photoInsert = await client.query(
        `INSERT INTO plant_photos (plant_id, image_url, note, context)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [plant.id, storedImageUrl, payload.note ?? null, payload.context],
      );

      const diagnosisData = await generateDiagnosis({
        context: payload.context,
        note: payload.note,
        imageUrl: payload.imageUrl, // send original data URL to Gemini
        plant,
        language: payload.language,
      });

      const diagnosisInsert = await client.query(
        `INSERT INTO diagnoses
         (plant_id, photo_id, severity, confidence, summary, detected_issues, recommendations, raw_json)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
         RETURNING *`,
        [
          plant.id,
          photoInsert.rows[0].id,
          diagnosisData.severity,
          diagnosisData.confidence,
          diagnosisData.summary,
          JSON.stringify(diagnosisData.detectedIssues),
          JSON.stringify(diagnosisData.recommendations),
          JSON.stringify(diagnosisData),
        ],
      );

      await client.query(
        `UPDATE care_plans
         SET status = 'archived', ended_at = NOW()
         WHERE plant_id = $1 AND status = 'active'`,
        [plant.id],
      );

      const versionResult = await client.query(
        'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM care_plans WHERE plant_id = $1',
        [plant.id],
      );
      const nextVersion = Number(versionResult.rows[0].next_version);

      const carePlanInsert = await client.query(
        `INSERT INTO care_plans (plant_id, diagnosis_id, version, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING *`,
        [plant.id, diagnosisInsert.rows[0].id, nextVersion],
      );

      const taskDrafts = await buildCareTasksFromDiagnosis(diagnosisData, plant, payload.language);
      const generatedTasks = [];
      for (const task of taskDrafts) {
        const taskInsert = await client.query(
          `INSERT INTO care_tasks
           (plant_id, care_plan_id, title, details, scheduled_for, status, priority, category)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
           RETURNING *`,
          [
            plant.id,
            carePlanInsert.rows[0].id,
            task.title,
            task.details,
            task.scheduledFor,
            task.priority,
            task.category,
          ],
        );
        generatedTasks.push(taskInsert.rows[0]);
        await client.query(
          'INSERT INTO task_logs (task_id, status, note) VALUES ($1, $2, $3)',
          [taskInsert.rows[0].id, 'pending', 'Task creada automáticamente por plan'],
        );
      }

      await queueNotificationsForUpcomingTasks(client);

      return {
        diagnosis: diagnosisInsert.rows[0],
        generatedTasks,
      };
    });

    res.status(201).json({
      diagnosis: mapDiagnosis(txResult.diagnosis),
      generatedTasks: txResult.generatedTasks.map(mapTask),
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.get('/dashboard', async (req, res) => {
  const [plantsResult, dueTasksResult, criticalResult] = await Promise.all([
    query('SELECT * FROM plants WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]),
    query(
      `SELECT t.* FROM care_tasks t
       JOIN plants p ON p.id = t.plant_id
       WHERE p.user_id = $1
         AND t.status = 'pending'
         AND t.scheduled_for <= NOW() + INTERVAL '48 hours'
       ORDER BY t.scheduled_for ASC`,
      [req.user.id],
    ),
    query(
      `SELECT p.name AS plant_name, d.summary
       FROM diagnoses d
       JOIN plants p ON p.id = d.plant_id
       WHERE p.user_id = $1
         AND d.severity = 'high'
         AND d.created_at >= NOW() - INTERVAL '7 days'
       ORDER BY d.created_at DESC
       LIMIT 5`,
      [req.user.id],
    ),
  ]);

  res.json({
    plants: plantsResult.rows.map(mapPlant),
    dueTasks: dueTasksResult.rows.map(mapTask),
    criticalAlerts: criticalResult.rows.map((row) => `${row.plant_name}: ${row.summary}`),
  });
});

app.get('/tasks/today', async (req, res) => {
  const sql = `
    SELECT t.* FROM care_tasks t
    JOIN plants p ON p.id = t.plant_id
    WHERE p.user_id = $1
      AND t.scheduled_for < date_trunc('day', NOW()) + INTERVAL '1 day'
      AND (
        t.status = 'pending'
        OR t.scheduled_for >= date_trunc('day', NOW())
      )
    ORDER BY t.scheduled_for ASC, t.priority DESC
  `;
  const { rows } = await query(sql, [req.user.id]);
  res.json(rows.map(mapTask));
});

app.patch('/tasks/:taskId/status', async (req, res) => {
  const schema = z.object({ status: z.enum(['pending', 'done', 'skipped']) });
  try {
    const payload = schema.parse(req.body);
    const sql = `
      UPDATE care_tasks t
      SET status = $1
      FROM plants p
      WHERE t.id = $2
        AND p.id = t.plant_id
        AND p.user_id = $3
      RETURNING t.*;
    `;
    const { rows } = await query(sql, [payload.status, req.params.taskId, req.user.id]);
    if (!rows.length) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    await query('INSERT INTO task_logs (task_id, status, note) VALUES ($1, $2, $3)', [
      rows[0].id,
      payload.status,
      'Actualización manual desde app',
    ]);
    return res.json(mapTask(rows[0]));
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get('/progress', async (req, res) => {
  const sql = `
    SELECT
      p.id AS plant_id,
      COUNT(t.id) FILTER (WHERE t.scheduled_for >= NOW() - INTERVAL '7 days') AS tasks_total_last_7_days,
      COUNT(t.id) FILTER (WHERE t.status = 'done' AND t.scheduled_for >= NOW() - INTERVAL '7 days') AS tasks_done_last_7_days
    FROM plants p
    LEFT JOIN care_tasks t ON t.plant_id = p.id
    WHERE p.user_id = $1
    GROUP BY p.id
    ORDER BY p.created_at DESC;
  `;
  const { rows } = await query(sql, [req.user.id]);
  res.json(rows.map(mapProgressRow));
});

app.post('/scheduler/run', async (_req, res) => {
  const queued = await queueNotificationsForUpcomingTasks(pool);
  const sent = await markQueuedNotificationsAsSent(pool);
  res.json({
    queued: queued.length,
    sent: sent.length,
  });
});

module.exports = { app };
