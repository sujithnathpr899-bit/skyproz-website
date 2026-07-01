import { db, parseJson } from './db.mjs';
import { searchContracts } from './contracts.mjs';
import { runProcurementBot } from './services/procurement-bot.mjs';
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
  return elapsed >= (alert.frequency === 'weekly' ? 7 * 86400000 : alert.frequency === 'daily' ? 86400000 : alert.frequency === 'hourly' ? 3600000 : 0);
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

export function removeExpiredContracts() {
  return db.prepare("UPDATE contracts SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE deadline IS NOT NULL AND deadline < CURRENT_TIMESTAMP AND status IN ('open','closing_soon')").run().changes;
}

export function generateAnalyticsSnapshot(period = 'weekly') {
  const metrics = {
    total_contracts: db.prepare('SELECT COUNT(*) AS count FROM contracts').get().count,
    open_contracts: db.prepare("SELECT COUNT(*) AS count FROM contracts WHERE status IN ('open','closing_soon')").get().count,
    import_success_rate: db.prepare(`SELECT ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / MAX(COUNT(*), 1), 2) AS value FROM import_runs`).get().value || 0,
    average_import_duration_ms: db.prepare("SELECT ROUND(AVG(duration_ms), 0) AS value FROM import_runs WHERE status = 'completed'").get().value || 0,
    duplicate_rate: db.prepare(`SELECT ROUND(100.0 * SUM(CASE WHEN duplicate_key IS NOT NULL THEN 1 ELSE 0 END) / MAX(COUNT(*), 1), 2) AS value FROM contracts`).get().value || 0,
    top_countries: db.prepare('SELECT country, COUNT(*) AS count FROM contracts GROUP BY country ORDER BY count DESC LIMIT 10').all(),
    top_industries: db.prepare('SELECT industry, COUNT(*) AS count FROM contracts GROUP BY industry ORDER BY count DESC LIMIT 10').all(),
    top_sources: db.prepare('SELECT source_name, COUNT(*) AS count FROM contracts GROUP BY source_name ORDER BY count DESC LIMIT 10').all(),
    most_valuable_contracts: db.prepare('SELECT id, slug, title, budget_value, currency FROM contracts WHERE budget_value IS NOT NULL ORDER BY budget_value DESC LIMIT 10').all(),
    import_errors: db.prepare("SELECT connector_key, source_id, error_message, started_at FROM import_runs WHERE status = 'failed' ORDER BY started_at DESC LIMIT 10").all()
  };
  db.prepare('INSERT INTO analytics_snapshots(period, metrics_json) VALUES (?, ?)').run(period, JSON.stringify(metrics));
  return metrics;
}

export function cleanupLogs() {
  const audit = db.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', '-180 days')").run().changes;
  const runs = db.prepare("DELETE FROM scheduler_runs WHERE completed_at IS NOT NULL AND completed_at < datetime('now', '-180 days')").run().changes;
  const queue = db.prepare("DELETE FROM import_queue WHERE status IN ('completed','failed','skipped') AND updated_at < datetime('now', '-30 days')").run().changes;
  return { audit, scheduler_runs: runs, queue };
}

export function optimizeDatabase() {
  db.exec('PRAGMA optimize;');
  return { optimized: true };
}

async function trackedJob(jobType, fn) {
  const started = Date.now();
  const run = db.prepare("INSERT INTO scheduler_runs(job_type, status) VALUES (?, 'running')").run(jobType);
  const id = Number(run.lastInsertRowid);
  try {
    const result = await fn();
    db.prepare(`UPDATE scheduler_runs SET status = 'completed', duration_ms = ?, result_json = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(Date.now() - started, JSON.stringify(result), id);
    return { run_id: id, job_type: jobType, ...result };
  } catch (error) {
    db.prepare(`UPDATE scheduler_runs SET status = 'failed', duration_ms = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(Date.now() - started, error.message, id);
    throw error;
  }
}

export async function runHourlyJobs() {
  return trackedJob('hourly', async () => ({
    bot: await runProcurementBot({ schedule: 'hourly', jobType: 'hourly' }),
    alerts: await sendDueAlerts()
  }));
}

export async function runDailyJobs() {
  return trackedJob('daily', async () => ({
    bot: await runProcurementBot({ schedule: 'daily', jobType: 'daily' }),
    statuses: updateContractStatuses(),
    expired: removeExpiredContracts(),
    alerts: await sendDueAlerts()
  }));
}

export async function runWeeklyJobs() {
  return trackedJob('weekly', async () => ({
    bot: await runProcurementBot({ schedule: 'weekly', jobType: 'weekly' }),
    duplicates_removed: (await import('./contracts.mjs')).removeDuplicateContracts(),
    optimized: optimizeDatabase(),
    analytics: generateAnalyticsSnapshot('weekly')
  }));
}

export async function runMonthlyJobs() {
  return trackedJob('monthly', async () => ({
    analytics: generateAnalyticsSnapshot('monthly'),
    cleanup: cleanupLogs()
  }));
}

export async function runSchedulerJob(jobType = 'daily') {
  if (jobType === 'hourly') return runHourlyJobs();
  if (jobType === 'weekly') return runWeeklyJobs();
  if (jobType === 'monthly') return runMonthlyJobs();
  return runDailyJobs();
}

export function schedulerHealth() {
  return {
    scheduler: db.prepare('SELECT * FROM scheduler_runs ORDER BY started_at DESC LIMIT 5').all(),
    imports: db.prepare('SELECT * FROM import_runs ORDER BY started_at DESC LIMIT 5').all(),
    database: { ok: true, contracts: db.prepare('SELECT COUNT(*) AS count FROM contracts').get().count },
    storage: { ok: true },
    queue: db.prepare("SELECT status, COUNT(*) AS count FROM import_queue GROUP BY status").all()
  };
}
