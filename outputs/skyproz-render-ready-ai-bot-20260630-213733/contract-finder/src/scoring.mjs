const CATEGORY_RULES = [
  ['Rope Access', ['rope access', 'abseil', 'work at height', 'height access', 'difficult access']],
  ['Industrial Painting', ['painting', 'coating', 'paint', 'surface preparation', 'corrosion protection']],
  ['Blasting', ['blasting', 'sandblast', 'grit blast', 'abrasive blast']],
  ['NDT', ['ndt', 'non destructive', 'ultrasonic', 'radiography', 'magnetic particle', 'dye penetrant']],
  ['Marine', ['marine', 'offshore', 'ship', 'vessel', 'hull', 'jetty', 'port']],
  ['Wind Turbine', ['wind turbine', 'blade', 'nacelle', 'wind farm', 'tower inspection']],
  ['High Rise', ['high rise', 'high-rise', 'facade', 'building exterior', 'tower']],
  ['Glass Cleaning', ['glass cleaning', 'window cleaning', 'curtain wall']],
  ['Inspection', ['inspection', 'survey', 'condition assessment', 'audit']],
  ['Shutdown', ['shutdown', 'turnaround', 'outage', 'plant maintenance']],
  ['Building Maintenance', ['building maintenance', 'facility maintenance', 'facilities management']],
  ['Industrial Cleaning', ['industrial cleaning', 'tank cleaning', 'silo cleaning']],
  ['Oil & Gas', ['oil and gas', 'oil & gas', 'refinery', 'petrochemical', 'pipeline']],
  ['Power Plant', ['power plant', 'thermal plant', 'substation', 'boiler', 'turbine hall']],
  ['Renewable Energy', ['renewable', 'solar', 'wind energy', 'hydro']],
  ['Structural Repair', ['structural repair', 'steel repair', 'concrete repair', 'structural maintenance']],
  ['Facade', ['facade', 'cladding', 'building envelope']],
  ['Scaffolding Alternative', ['scaffold', 'scaffolding alternative', 'no scaffolding']]
];

const SKYPROZ_KEYWORDS = [
  'rope access', 'inspection', 'maintenance', 'painting', 'coating', 'ndt', 'marine', 'offshore',
  'wind turbine', 'facade', 'glass cleaning', 'industrial cleaning', 'shutdown', 'technical consultancy',
  'manpower', 'height', 'structural repair', 'oil', 'gas', 'power plant', 'renewable'
];

function textFor(input) {
  return [
    input.title, input.description, input.industry, input.contract_type, input.buyer_name,
    input.country, ...(Array.isArray(input.tags) ? input.tags : [])
  ].filter(Boolean).join(' ').toLowerCase();
}

export function categorizeContract(input) {
  const haystack = textFor(input);
  const matches = [];
  for (const [name, keywords] of CATEGORY_RULES) {
    const score = keywords.reduce((total, keyword) => total + (haystack.includes(keyword) ? 1 : 0), 0);
    if (score > 0) matches.push({ name, score });
  }
  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return {
    primary: matches[0]?.name || input.industry || 'General Procurement',
    tags: matches.map((match) => match.name)
  };
}

export function scoreOpportunity(input) {
  const haystack = textFor(input);
  let score = 15;
  const matchedKeywords = SKYPROZ_KEYWORDS.filter((keyword) => haystack.includes(keyword));
  score += Math.min(42, matchedKeywords.length * 7);
  if (/industrial|marine|offshore|renewable|power|oil|gas|construction|infrastructure/i.test(input.industry || '')) score += 12;
  if (/government|public/i.test(input.buyer_type || '')) score += 5;
  if (input.budget_value && Number(input.budget_value) > 0) score += Number(input.budget_value) >= 100000 ? 10 : 5;
  if (input.deadline) {
    const days = Math.ceil((new Date(input.deadline).valueOf() - Date.now()) / 86400000);
    if (days >= 14 && days <= 90) score += 12;
    else if (days > 90) score += 6;
    else if (days > 0) score += 3;
  }
  if (/india|united arab emirates|saudi|qatar|singapore|united kingdom|europe|canada|australia/i.test(input.country || '')) score += 4;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    label: score >= 85 ? 'Excellent Match' : score >= 65 ? 'Good Match' : score >= 45 ? 'Potential Match' : 'Low Match',
    matched_keywords: matchedKeywords
  };
}

export function enrichContractIntelligence(input) {
  const category = categorizeContract(input);
  const scoring = scoreOpportunity(input);
  const tags = new Set([...(Array.isArray(input.tags) ? input.tags : []), ...category.tags, ...scoring.matched_keywords]);
  return {
    ...input,
    ai_category: input.ai_category || category.primary,
    opportunity_score: input.opportunity_score ?? scoring.score,
    opportunity_label: input.opportunity_label || scoring.label,
    tags: [...tags].filter(Boolean)
  };
}
