import { config } from '../config.mjs';
import { db, serializeContract } from '../db.mjs';

const TASK_PROMPTS = {
  summary: 'Write a concise executive summary in 4 bullet points.',
  requirements: 'Extract mandatory supplier requirements as a JSON array of short strings.',
  checklist: 'Create a document preparation checklist as a JSON array of short strings.',
  deadlines: 'Highlight all dates and deadline risks in short bullet points.',
  proposal: 'Create a practical proposal outline with section headings and short guidance.'
};

function fallback(contract, task) {
  if (task === 'summary') return `${contract.title}\nIndustry: ${contract.industry}\nLocation: ${contract.country}\nDeadline: ${contract.deadline || 'Not stated'}`;
  if (task === 'requirements') return ['Review the complete source notice', 'Confirm supplier eligibility', 'Validate technical capability', 'Prepare commercial documentation'];
  if (task === 'checklist') return ['Company profile', 'Technical proposal', 'Commercial proposal', 'Certifications and licenses', 'Past-performance evidence'];
  if (task === 'deadlines') return `Submission deadline: ${contract.deadline || 'Not stated'}. Verify timezone and clarification deadlines on the source page.`;
  return '1. Executive summary\n2. Understanding of requirements\n3. Technical approach\n4. Safety and quality plan\n5. Team and experience\n6. Delivery schedule\n7. Commercial response';
}

export async function runAiTask(contractId, task) {
  if (!TASK_PROMPTS[task]) throw Object.assign(new Error('Unsupported AI task'), { status: 400 });
  const contract = serializeContract(db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId));
  if (!contract) throw Object.assign(new Error('Contract not found'), { status: 404 });
  let result;
  if (!config.ai.apiKey || !config.ai.model) {
    result = fallback(contract, task);
  } else {
    const response = await fetch(config.ai.apiUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.ai.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.ai.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You are a procurement analyst. Never invent requirements. Clearly label uncertainty.' },
          { role: 'user', content: `${TASK_PROMPTS[task]}\n\nContract:\n${JSON.stringify(contract)}` }
        ]
      })
    });
    if (!response.ok) throw Object.assign(new Error(`AI provider returned ${response.status}`), { status: 502 });
    const payload = await response.json();
    result = payload.choices?.[0]?.message?.content || fallback(contract, task);
    if (task === 'requirements' || task === 'checklist') {
      try { result = JSON.parse(String(result).replace(/^```json\s*|\s*```$/g, '')); } catch { result = [String(result)]; }
    }
  }
  const columns = {
    summary: 'ai_summary', requirements: 'ai_requirements_json', checklist: 'ai_checklist_json', proposal: 'ai_proposal_outline'
  };
  if (columns[task]) {
    const stored = Array.isArray(result) ? JSON.stringify(result) : String(result);
    db.prepare(`UPDATE contracts SET ${columns[task]} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(stored, contractId);
  }
  return { task, result, generated_by: config.ai.apiKey && config.ai.model ? 'provider' : 'local-fallback' };
}
