const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/plantcare',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',
  appEnv: process.env.APP_ENV ?? 'development',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
  r2AccountId: process.env.R2_ACCOUNT_ID ?? '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  r2BucketName: process.env.R2_BUCKET_NAME ?? 'plantcare-photos',
  r2PublicUrl: process.env.R2_PUBLIC_URL ?? '',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
};

module.exports = { config };
