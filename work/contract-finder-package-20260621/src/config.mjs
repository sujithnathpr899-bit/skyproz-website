import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(moduleDir, '..');
const env = globalThis.process?.env || {};

export const config = {
  port: Number(env.PORT || 8787),
  host: env.HOST || '127.0.0.1',
  databasePath: path.resolve(rootDir, env.DATABASE_PATH || './data/contract-finder.db'),
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
  cronSecret: env.CRON_SECRET || 'development-cron-secret'
};
