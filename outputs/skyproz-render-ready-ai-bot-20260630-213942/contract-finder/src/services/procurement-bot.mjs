import { config } from '../config.mjs';
import { db, parseJson, serializeContract } from '../db.mjs';
import { removeDuplicateContracts, updateContract } from '../contracts.mjs';
import { importAllSources } from './importer.mjs';
import { sendEmail, sendTelegram, sendWhatsApp } from './notifications.mjs';

function textFor(contract) {
  return [
    contract.title,
    contract.description,
    contract.translated_description,
    contract.industry,
    contract.contract_type,
    contract.buyer_name,
    contract.country,
    ...(Array.isArray(contract.tags) ? contract.tags : [])
  ].filter(Boolean).join(' ').toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function listKeywords({ activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE is_active = 1' : '';
  return db.prepare(`SELECT * FROM procurement_keywords ${where} ORDER BY service_category, keyword`).all()
    .map((row) => ({ ...row, countries: parseJson(row.countries_json, []) }));
}

export function createKeyword(input, userId = null) {
  const keyword = String(input.keyword || '').trim().toLowerCase();
  if (!keyword) throw Object.assign(new Error('Keyword is required'), { status: 400 });
  const result = db.prepare(`INSERT INTO procurement_keywords(keyword, service_category, business_unit, weight, countries_json, is_active, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    keyword,
    String(input.service_category || 'Industrial Services').trim(),
    String(input.business_unit || 'Industrial Services').trim(),
    Number(input.weight || 8),
    JSON.stringify(input.countries || []),
    Number(input.is_active !== false),
    userId
  );
  return db.prepare('SELECT * FROM procurement_keywords WHERE id = ?').get(result.lastInsertRowid);
}

export function updateKeyword(id, input) {
  db.prepare(`UPDATE procurement_keywords SET keyword = COALESCE(?, keyword), service_category = COALESCE(?, service_category),
    business_unit = COALESCE(?, business_unit), weight = COALESCE(?, weight), countries_json = COALESCE(?, countries_json),
    is_active = COALESCE(?, is_active), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(
      input.keyword ? String(input.keyword).trim().toLowerCase() : null,
      input.service_category ?? null,
      input.business_unit ?? null,
      input.weight === undefined ? null : Number(input.weight),
      input.countries ? JSON.stringify(input.countries) : null,
      input.is_active === undefined ? null : Number(Boolean(input.is_active)),
      id
    );
  return db.prepare('SELECT * FROM procurement_keywords WHERE id = ?').get(id);
}

export function deleteKeyword(id) {
  return db.prepare('DELETE FROM procurement_keywords WHERE id = ?').run(id).changes;
}

export function detectLanguage(contract) {
  const text = `${contract.title || ''} ${contract.description || ''}`;
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  if (/[\u0900-\u097f]/.test(text)) return 'hi';
  if (/[\u0d00-\u0d7f]/.test(text)) return 'ml';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  if (/[\u0400-\u04ff]/.test(text)) return 'ru';
  const ascii = text.replace(/[^\x00-\x7f]/g, '').length;
  return text.length && ascii / text.length < 0.85 ? 'unknown' : 'en';
}

function translatedDescription(contract, language) {
  if (language === 'en') return contract.description || '';
  return `[Translation pending from ${language}] ${contract.description || ''}`;
}

function urgencyFor(deadline) {
  if (!deadline) return 'Unknown';
  const days = Math.ceil((new Date(deadline).valueOf() - Date.now()) / 86400000);
  if (days < 0) return 'Expired';
  if (days <= 3) return 'Critical';
  if (days <= 10) return 'High';
  if (days <= 30) return 'Medium';
  return 'Normal';
}

function countryRisk(country = '') {
  const value = country.toLowerCase();
  if (/united kingdom|europe|canada|australia|new zealand|singapore|united states/.test(value)) return 'Standard';
  if (/india|united arab emirates|saudi|qatar|oman|kuwait|bahrain|malaysia|indonesia/.test(value)) return 'Normal commercial review';
  if (/worldwide|international/.test(value)) return 'Depends on project country';
  return 'Enhanced review recommended';
}

function opportunityValue(contract) {
  const budget = Number(contract.budget_value || 0);
  if (budget > 0) return `${contract.currency || ''} ${budget.toLocaleString()}`.trim();
  if (/framework|long term|multi year|annual/i.test(`${contract.title} ${contract.description}`)) return 'Potential recurring value';
  return 'Not disclosed';
}

function recommendedAction(score, urgency) {
  if (score >= 85 && ['Critical', 'High'].includes(urgency)) return 'Review immediately and prepare bid/no-bid decision today.';
  if (score >= 85) return 'Assign owner and begin qualification with source documents.';
  if (score >= 70) return 'Review scope, eligibility and commercial value.';
  if (score >= 50) return 'Monitor and save if geography or buyer is strategic.';
  return 'Low priority unless requested by management.';
}

export function analyzeOpportunity(contract, keywords = listKeywords({ activeOnly: true })) {
  const haystack = textFor(contract);
  const matches = [];
  const serviceWeights = new Map();
  const businessWeights = new Map();
  for (const keyword of keywords) {
    if (!haystack.includes(keyword.keyword.toLowerCase())) continue;
    matches.push(keyword.keyword);
    serviceWeights.set(keyword.service_category, (serviceWeights.get(keyword.service_category) || 0) + Number(keyword.weight || 1));
    businessWeights.set(keyword.business_unit, (businessWeights.get(keyword.business_unit) || 0) + Number(keyword.weight || 1));
  }
  const matchingServices = [...serviceWeights.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const businessUnit = [...businessWeights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Industrial Services';
  const language = detectLanguage(contract);
  const urgency = urgencyFor(contract.deadline);
  let score = 10 + Math.min(60, [...serviceWeights.values()].reduce((sum, value) => sum + value, 0));
  if (/rfq|rfp|eoi|tender|bid|procurement|contract/i.test(`${contract.title} ${contract.contract_type}`)) score += 5;
  if (/industrial|marine|offshore|energy|oil|gas|wind|facility|maintenance|construction|ship/i.test(`${contract.industry} ${contract.description}`)) score += 10;
  if (Number(contract.budget_value || 0) >= config.bot.highValueBudget) score += 8;
  if (['Critical', 'High', 'Medium'].includes(urgency)) score += 7;
  if (contract.source_url) score += 3;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    language,
    translated_description: translatedDescription(contract, language),
    matched_keywords: unique(matches),
    matching_services: matchingServices,
    suggested_business_unit: businessUnit,
    estimated_opportunity_value: opportunityValue(contract),
    submission_urgency: urgency,
    country_risk: countryRisk(contract.country),
    recommended_action: recommendedAction(score, urgency),
    ai_score: score,
    opportunity_score: score,
    opportunity_label: score >= 85 ? 'Excellent Match' : score >= 70 ? 'High Match' : score >= 50 ? 'Potential Match' : 'Low Match',
    ai_priority: score >= 85 ? 'High' : score >= 70 ? 'Medium' : 'Low',
    ai_category: matchingServices[0] || contract.ai_category || contract.industry || 'General Procurement',
    tags: unique([...(contract.tags || []), ...matchingServices, ...matches])
  };
}

function analyzeContracts(contractIds) {
  const ids = unique(contractIds.map(Number).filter(Boolean));
  const keywords = listKeywords({ activeOnly: true });
  const analyzed = [];
  for (const id of ids) {
    const contract = serializeContract(db.prepare('SELECT * FROM contracts WHERE id = ?').get(id));
    if (!contract) continue;
    const intelligence = analyzeOpportunity(contract, keywords);
    analyzed.push(updateContract(id, intelligence));
  }
  return analyzed.filter(Boolean);
}

function shouldNotify(rule, contract) {
  if (!rule.is_active) return false;
  if (Number(contract.ai_score || contract.opportunity_score || 0) < Number(rule.min_score || 0)) return false;
  if (rule.min_budget && Number(contract.budget_value || 0) < Number(rule.min_budget)) return false;
  const countries = parseJson(rule.countries_json, []);
  if (countries.length && !countries.includes(contract.country)) return false;
  return true;
}

async function createNotifications(contracts, botRunId) {
  const rules = db.prepare('SELECT * FROM bot_notification_rules WHERE is_active = 1').all();
  const admins = db.prepare("SELECT * FROM users WHERE role = 'admin' AND is_active = 1").all();
  let created = 0;
  for (const contract of contracts) {
    for (const rule of rules) {
      if (!shouldNotify(rule, contract)) continue;
      const title = `${contract.ai_priority || 'High'} match: ${contract.title}`;
      const message = `${contract.country || 'Worldwide'} | ${contract.ai_score || contract.opportunity_score}% | ${contract.recommended_action || 'Review opportunity.'}`;
      for (const admin of admins) {
        const exists = db.prepare(`SELECT 1 FROM dashboard_notifications
          WHERE user_id = ? AND contract_id = ? AND title = ? AND created_at > datetime('now', '-7 days')`)
          .get(admin.id, contract.id, title);
        if (!exists && rule.dashboard_enabled) {
          db.prepare(`INSERT INTO dashboard_notifications(user_id, contract_id, title, message, severity, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?)`).run(admin.id, contract.id, title, message, contract.ai_score >= 85 ? 'critical' : 'warning', JSON.stringify({ bot_run_id: botRunId, rule_id: rule.id }));
          created++;
        }
        if (rule.email_enabled) await sendEmail({ to: admin.email, subject: title, html: `<p>${message}</p><p><a href="${config.appOrigin}/contract-finder/contracts/${contract.slug}">Open in Contract Finder</a></p>` }).catch(() => null);
        if (rule.whatsapp_enabled && admin.phone) await sendWhatsApp({ to: admin.phone, message: `${title}\n${message}\n${config.appOrigin}/contract-finder/contracts/${contract.slug}` }).catch(() => null);
      }
      if (rule.telegram_enabled) await sendTelegram({ message: `${title}\n${message}\n${config.appOrigin}/contract-finder/contracts/${contract.slug}` }).catch(() => null);
    }
  }
  return created;
}

function logBot(runId, level, message, metadata = {}, sourceId = null) {
  db.prepare('INSERT INTO bot_logs(bot_run_id, source_id, level, message, metadata_json) VALUES (?, ?, ?, ?, ?)')
    .run(runId, sourceId, level, message, JSON.stringify(metadata));
}

export async function runProcurementBot({ schedule = 'hourly', jobType = schedule } = {}) {
  const started = Date.now();
  const run = db.prepare("INSERT INTO bot_runs(job_type, status) VALUES (?, 'running')").run(jobType);
  const botRunId = Number(run.lastInsertRowid);
  try {
    logBot(botRunId, 'info', 'AI procurement bot started', { schedule });
    const importResults = await importAllSources({ schedule, concurrency: config.bot.importConcurrency, retries: config.bot.retryAttempts });
    const contractIds = unique(importResults.flatMap((result) => result.contract_ids || []));
    const analyzedContracts = analyzeContracts(contractIds);
    const duplicatesRemoved = removeDuplicateContracts();
    const highMatches = analyzedContracts.filter((contract) => Number(contract.ai_score || contract.opportunity_score || 0) >= config.bot.highScoreThreshold);
    const notificationsCreated = await createNotifications(highMatches, botRunId);
    for (const result of importResults.filter((item) => !item.ok)) logBot(botRunId, 'error', result.error || 'Source import failed', result, result.source_id || null);
    const summary = {
      imports: importResults,
      analyzed_contracts: analyzedContracts.length,
      duplicates_removed: duplicatesRemoved,
      high_value_matches: highMatches.length,
      notifications_created: notificationsCreated
    };
    db.prepare(`UPDATE bot_runs SET status = 'completed', completed_at = CURRENT_TIMESTAMP, duration_ms = ?,
      sources_checked = ?, contracts_imported = ?, contracts_updated = ?, high_value_matches = ?,
      notifications_created = ?, result_json = ? WHERE id = ?`)
      .run(
        Date.now() - started,
        importResults.length,
        importResults.reduce((sum, result) => sum + Number(result.imported || 0), 0),
        importResults.reduce((sum, result) => sum + Number(result.updated || 0), 0),
        highMatches.length,
        notificationsCreated,
        JSON.stringify(summary),
        botRunId
      );
    return { run_id: botRunId, status: 'completed', ...summary };
  } catch (error) {
    logBot(botRunId, 'error', error.message, {});
    db.prepare("UPDATE bot_runs SET status = 'failed', completed_at = CURRENT_TIMESTAMP, duration_ms = ?, error_message = ? WHERE id = ?")
      .run(Date.now() - started, error.message, botRunId);
    throw error;
  }
}

export function botStatus(userId = null) {
  return {
    latest_run: db.prepare('SELECT * FROM bot_runs ORDER BY started_at DESC LIMIT 1').get() || null,
    recent_runs: db.prepare('SELECT * FROM bot_runs ORDER BY started_at DESC LIMIT 10').all(),
    keywords: db.prepare('SELECT COUNT(*) AS count FROM procurement_keywords WHERE is_active = 1').get().count,
    unread_notifications: userId ? db.prepare('SELECT COUNT(*) AS count FROM dashboard_notifications WHERE user_id = ? AND is_read = 0').get(userId).count : 0,
    notifications: userId ? db.prepare(`SELECT n.*, c.slug FROM dashboard_notifications n
      LEFT JOIN contracts c ON c.id = n.contract_id WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 20`).all(userId) : [],
    ai_match_distribution: db.prepare(`SELECT
      CASE WHEN ai_score >= 85 THEN 'High' WHEN ai_score >= 70 THEN 'Medium' WHEN ai_score >= 50 THEN 'Potential' ELSE 'Low' END AS bucket,
      COUNT(*) AS count FROM contracts GROUP BY bucket ORDER BY count DESC`).all(),
    top_buyers: db.prepare("SELECT buyer_name, COUNT(*) AS count FROM contracts WHERE buyer_name IS NOT NULL AND buyer_name <> '' GROUP BY buyer_name ORDER BY count DESC LIMIT 10").all(),
    newest_opportunities: db.prepare('SELECT id, slug, title, country, ai_score, ai_priority, created_at FROM contracts ORDER BY created_at DESC LIMIT 10').all(),
    logs: db.prepare('SELECT * FROM bot_logs ORDER BY created_at DESC LIMIT 20').all()
  };
}
