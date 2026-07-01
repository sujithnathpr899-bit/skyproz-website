import { config } from '../config.mjs';

export async function sendEmail({ to, subject, html }) {
  if (!config.email.resendApiKey) return { delivered: false, reason: 'RESEND_API_KEY is not configured' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.email.resendApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: config.email.from, to: [to], subject, html })
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}: ${await response.text()}`);
  return { delivered: true, provider: 'resend', response: await response.json() };
}

export async function sendWhatsApp({ to, message }) {
  const { accessToken, phoneNumberId, apiVersion } = config.whatsapp;
  if (!accessToken || !phoneNumberId) return { delivered: false, reason: 'WhatsApp Cloud API is not configured' };
  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: message } })
  });
  if (!response.ok) throw new Error(`WhatsApp provider returned ${response.status}: ${await response.text()}`);
  return { delivered: true, provider: 'meta', response: await response.json() };
}

export async function sendTelegram({ chatId = config.telegram.chatId, message }) {
  const { botToken } = config.telegram;
  if (!botToken || !chatId) return { delivered: false, reason: 'Telegram bot is not configured' };
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: false })
  });
  if (!response.ok) throw new Error(`Telegram provider returned ${response.status}: ${await response.text()}`);
  return { delivered: true, provider: 'telegram', response: await response.json() };
}
