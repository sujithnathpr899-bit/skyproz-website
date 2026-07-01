import { db, parseJson } from './db.mjs';
import { searchContracts } from './contracts.mjs';
import { importAllSources } from './services/importer.mjs';
import { sendEmail, sendWhatsApp } from './services/notifications.mjs';

export function updateContractStatuses() {
  const expired = db.prepare(`UPDATE contracts SET status = 'expired', updated_at = CURRENT_TIMESTAMP
    WHERE deadline IS NOT NULL AND deadline < CURRENT_TIMESTAMP AND status IN ('open', 'closing_soon')`).run().changes;
  const closingSoon = db.prepare(`UPDATE contracts SET status = 'closing_soon', updated_at = CURRENT_TIMESTAMP
    WHERE deadline BETWEEN CURRENT_TIMESTAMP AND datetime('now', '+7 days') AND status = 'open'`).run().changes;
  db.prepare('DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP').run();
  return { expired, closing_soon: closingSoon };
}

function alertIsDue(alert) {
  if (!alert.last_sent_at) return true;
  const elapsed = Date.now() - new Date(alert.last_sent_at).valueOf();
  return elapsed >= (alert.frequency === 'weekly' ? 7 * 86400000 : alert.frequency === 'daily' ? 86400000 : 0);
}

export async function sendDueAlerts() {
  const alerts = db.prepare(`SELECT a.*, u.email, u.phone, u.plan, u.display_name
    FROM user_alerts a JOIN users u ON u.id = a.user_id WHERE a.is_active = 1 AND u.is_active = 1`).all();
  const summary = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  for (const alert of alerts) {
    if (!alertIsDue(alert)) { summary.skipped++; continue; }
    const filters = parseJson(alert.filters_json, {});
    filters.posted_after = alert.last_sent_at || new Date(Date.now() - 7 * 86400000).toISOString();
    filters.page_size = 20;
    const matches = searchContracts(filters).items;
    summary.processed++;
    if (!matches.length) { db.prepare('UPDATE user_alerts SET last_sent_at = CURRENT_TIMESTAMP WHERE id = ?').run(alert.id); continue; }
    const links = matches.map((contract) => `<li><a href="/contract-finder/contracts/${contract.slug}">${contract.title}</a> — ${contract.deadline || 'No deadline'}</li>`).join('');
    const channels = [];
    if (alert.email_enabled) channels.push(['email', () => sendEmail({ to: alert.email, subject: `${matches.length} new contract opportunities`, html: `<h2>${alert.name}</h2><ul>${links}</ul>` })]);
    if (alert.whatsapp_enabled && alert.plan === 'premium' && alert.phone) channels.push(['whatsapp', () => sendWhatsApp({ to: alert.phone, message: `${alert.name}: ${matches.length} new opportunities. Visit the Skyproz Contract Finder dashboard.` })]);
    for (const [channel, deliver] of channels) {
      const pending = matches.filter((contract) => !db.prepare('SELECT 1 FROM alert_deliveries WHERE alert_id = ? AND contract_id = ? AND channel = ?').get(alert.id, contract.id, channel));
      if (!pending.length) continue;
      let deliveryStatus = 'failed'; let deliveryError = null;
      try {
        const result = await deliver();
        deliveryStatus = result.delivered ? 'sent' : 'failed';
        deliveryError = result.reason || null;
        if (result.delivered) summary.sent++; else summary.failed++;
      } catch (error) {
        deliveryError = error.message; summary.failed++;
      }
      const record = db.prepare(`INSERT OR IGNORE INTO alert_deliveries(alert_id, contract_id, channel, status, error_message, sent_at)
        VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END)`);
      for (const contract of pending) record.run(alert.id, contract.id, channel, deliveryStatus, deliveryError, deliveryStatus);
    }
    db.prepare('UPDATE user_alerts SET last_sent_at = CURRENT_TIMESTAMP WHERE id = ?').run(alert.id);
  }
  return summary;
}

export async function runDailyJobs() {
  return {
    statuses: updateContractStatuses(),
    imports: await importAllSources(),
    alerts: await sendDueAlerts()
  };
}
