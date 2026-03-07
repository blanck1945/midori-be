# Midori — Backend

REST API for **Midori**, an AI-powered plant care app. Upload a photo of your plant and get an instant diagnosis powered by Gemini, along with a personalized care plan.

## What it does

- **Auth** — passwordless login via email (dev-login), JWT-based sessions
- **Plants** — create and manage your plant collection
- **AI Diagnosis** — sends plant photos to Gemini for visual health analysis (detects issues, severity, confidence score)
- **Care plans** — Gemini generates a personalized task schedule based on each diagnosis (watering, inspection, fertilizing, recovery)
- **Progress tracking** — 7-day adherence stats per plant
- **Photo storage** — images uploaded to Cloudflare R2
- **Notifications** — cron job queues task reminders every 5 minutes
- **Garden colors** — stores the dominant color extracted from each plant photo to power the dynamic garden background in the frontend

## Tech stack

| Layer | Tech |
|---|---|
| Runtime | Node.js |
| Framework | Express 5 |
| Database | PostgreSQL (Neon / Railway) |
| AI | Google Gemini (`gemini-2.0-flash`) |
| Storage | Cloudflare R2 (S3-compatible) |
| Auth | JWT (`jsonwebtoken`) |
| Validation | Zod |
| Scheduler | node-cron |
| Tests | Vitest + Supertest |

## API endpoints

```
POST   /auth/dev-login           Login or register by email
GET    /dashboard                Plants + due tasks + critical alerts
GET    /plants                   List user's plants
POST   /plants                   Create a plant
GET    /plants/:id               Plant detail with diagnoses and tasks
POST   /plants/:id/diagnose      AI diagnosis + care plan generation
PATCH  /plants/:id/color         Save dominant color (r,g,b) from plant photo
GET    /plants/:id/photos        Plant photo history
GET    /tasks/today              Tasks scheduled for today
PATCH  /tasks/:id/status         Mark task as done / skipped
GET    /progress                 7-day adherence per plant
GET    /health                   Health check
```

## Environment variables

Copy `.env.example` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing tokens |
| `APP_ENV` | `development` or `production` |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `GEMINI_MODEL` | Model to use (default: `gemini-2.0-flash`) |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_BUCKET_NAME` | R2 bucket name |
| `R2_PUBLIC_URL` | Public URL of the R2 bucket |
| `FRONTEND_URL` | Allowed CORS origin (e.g. `https://midori-fr.pages.dev`) |

## Running locally

```bash
npm install
npm run dev
```

The server starts at `http://localhost:4000`.

The database schema is applied automatically on startup via `initDb.js` — no manual migrations needed.

## Deploying to Railway

1. Connect this repo in Railway
2. Add all environment variables from the table above
3. Railway uses `npm start` → `node src/server.js`

The app will auto-migrate the database on first boot.
