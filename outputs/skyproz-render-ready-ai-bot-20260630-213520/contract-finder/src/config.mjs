import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(moduleDir, '..');
const env = globalThis.process?.env || {};

export const config = {
  port: Number(env.PORT || 8787),
  host: env.HOST || '127.0.0.1',
  databasePath: path.resolve(rootDir, env.DATABASE_PATH || './data/contract-finder.db'),
  companySiteDir: env.COMPANY_SITE_DIR ? path.resolve(env.COMPANY_SITE_DIR) : path.resolve(rootDir, '..', 'outputs'),
  appOrigin: env.APP_ORIGIN || 'http://127.0.0.1:8787',
  sessionSecret: env.SESSION_SECRET || 'development-only-change-this-secret',
  cookieSecure: env.COOKIE_SECURE === 'true',
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
