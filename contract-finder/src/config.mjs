import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(moduleDir, '..');
const env = globalThis.process?.env || {};
const isProduction = env.NODE_ENV === 'production' || env.RENDER === 'true';
const defaultAppOrigin = env.RENDER_EXTERNAL_URL || 'http://127.0.0.1:8787';

function booleanEnv(value, fallback = false) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

export const config = {
  nodeEnv: env.NODE_ENV || 'development',
  isProduction,
  port: Number(env.PORT || 8787),
  host: env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1'),
  databasePath: path.resolve(rootDir, env.DATABASE_PATH || './data/contract-finder.db'),
  companySiteDir: env.COMPANY_SITE_DIR ? path.resolve(env.COMPANY_SITE_DIR) : path.resolve(rootDir, '..', 'outputs'),
  appOrigin: env.APP_ORIGIN || defaultAppOrigin,
  sessionSecret: env.SESSION_SECRET || 'development-only-change-this-secret',
  cookieSecure: booleanEnv(env.COOKIE_SECURE, isProduction),
  ai: {
    apiUrl: env.AI_API_URL || 'https://api.openai.com/v1/chat/completions',
    apiKey: env.AI_API_KEY || '',
    model: env.AI_MODEL || ''
  },
  email: {
    resendApiKey: env.RESEND_API_KEY || '',
    from: env.EMAIL_FROM || 'Skyproz Contract Finder <alerts@skyproz.in>'
  },
  whatsapp: {
    accessToken: env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    apiVersion: env.WHATSAPP_API_VERSION || 'v23.0'
  },
  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN || '',
    chatId: env.TELEGRAM_CHAT_ID || ''
  },
  bot: {
    importConcurrency: Number(env.BOT_IMPORT_CONCURRENCY || 4),
    retryAttempts: Number(env.BOT_RETRY_ATTEMPTS || 2),
    highScoreThreshold: Number(env.BOT_HIGH_SCORE_THRESHOLD || 75),
    highValueBudget: Number(env.BOT_HIGH_VALUE_BUDGET || 100000),
    defaultCountries: (env.BOT_COUNTRIES || '').split(',').map((value) => value.trim()).filter(Boolean),
    schedulerEnabled: env.BOT_SCHEDULER_ENABLED === 'true',
    schedulerIntervalMinutes: Number(env.BOT_SCHEDULER_INTERVAL_MINUTES || 60)
  },
  cronSecret: env.CRON_SECRET || 'development-cron-secret'
};

export function validateProductionConfig() {
  if (!config.isProduction) return;
  const missing = [];
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || config.sessionSecret === 'development-only-change-this-secret') missing.push('SESSION_SECRET');
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 24 || config.cronSecret === 'development-cron-secret') missing.push('CRON_SECRET');
  if (!config.appOrigin.startsWith('https://')) missing.push('APP_ORIGIN or RENDER_EXTERNAL_URL must be HTTPS');
  if (!config.cookieSecure) missing.push('COOKIE_SECURE=true');
  if (missing.length) throw new Error(`Production environment is not ready: ${missing.join(', ')}`);
}
