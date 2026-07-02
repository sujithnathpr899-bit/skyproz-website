const GROUP_KEYWORDS = {
  'Government & Multilateral': ['tender', 'rfp', 'procurement', 'maintenance', 'industrial services'],
  Energy: ['oil and gas', 'offshore', 'industrial maintenance', 'shutdown maintenance', 'rope access'],
  EPC: ['epc', 'construction', 'industrial maintenance', 'protective coating', 'mechanical services'],
  Marine: ['marine maintenance', 'ship repair', 'offshore', 'industrial cleaning', 'rope access'],
  Renewables: ['wind turbine maintenance', 'blade inspection', 'solar maintenance', 'high access'],
  Facilities: ['facility management', 'high rise maintenance', 'facade cleaning', 'building maintenance']
};

function slug(value) {
  return String(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function template(name, group, options = {}) {
  return {
    id: `${slug(group)}-${slug(name)}`,
    name,
    group,
    region: options.region || 'Global',
    country: options.country || 'Worldwide',
    source_type: options.source_type || (group === 'Government & Multilateral' ? 'government' : 'private'),
    connector_key: options.connector_key || (group === 'Government & Multilateral' ? 'json' : 'enterprise_portal'),
    source_format: 'requires_configuration',
    source_url: null,
    api_url: null,
    is_active: false,
    template_status: 'requires_configuration',
    health_status: 'requires_configuration',
    last_successful_sync: null,
    failure_reason: 'Configure an official API, RSS, XML, JSON, CSV feed, or permitted public procurement endpoint before testing.',
    import_statistics: { imported: 0, updated: 0, skipped: 0, failures: 0 },
    ai_relevance_score: null,
    ai_relevance_status: 'calculated_after_import',
    duplicate_detection: 'enabled_after_configuration',
    supported_source_types: ['REST API', 'RSS', 'XML', 'JSON', 'CSV', 'Official supplier portal'],
    capabilities: {
      health_monitoring: true,
      last_successful_sync: true,
      failure_reason: true,
      import_statistics: true,
      ai_relevance_score: true,
      duplicate_detection: true
    },
    recommended_keywords: options.keywords || GROUP_KEYWORDS[group] || GROUP_KEYWORDS['Government & Multilateral'],
    compliance_note: 'Template only. No unsupported endpoint is hard-coded and no authenticated or restricted content is scraped.'
  };
}

export const connectorExpansionTemplates = [
  template('UNOPS', 'Government & Multilateral', { connector_key: 'json' }),
  template('Inter-American Development Bank', 'Government & Multilateral', { connector_key: 'json', region: 'Americas' }),
  template('OECD procurement', 'Government & Multilateral', { connector_key: 'json', region: 'Europe' }),
  template('UK Find a Tender', 'Government & Multilateral', { connector_key: 'uk', country: 'United Kingdom', region: 'Europe' }),
  template('NATO public procurement', 'Government & Multilateral', { connector_key: 'json', region: 'Europe' }),
  template('World Bank', 'Government & Multilateral', { connector_key: 'worldbank' }),
  template('ADB', 'Government & Multilateral', { connector_key: 'adb', region: 'Asia Pacific' }),
  template('AfDB', 'Government & Multilateral', { connector_key: 'afdb', region: 'Africa' }),
  template('EIB', 'Government & Multilateral', { connector_key: 'eib', region: 'Europe' }),

  template('ADNOC', 'Energy', { country: 'United Arab Emirates', region: 'Middle East' }),
  template('Saudi Aramco', 'Energy', { country: 'Saudi Arabia', region: 'Middle East' }),
  template('QatarEnergy', 'Energy', { country: 'Qatar', region: 'Middle East' }),
  template('Shell', 'Energy'),
  template('BP', 'Energy'),
  template('Chevron', 'Energy'),
  template('ExxonMobil', 'Energy'),
  template('TotalEnergies', 'Energy'),
  template('Equinor', 'Energy', { region: 'Europe' }),
  template('PETRONAS', 'Energy', { country: 'Malaysia', region: 'Asia' }),

  template('Bechtel', 'EPC'),
  template('Fluor', 'EPC'),
  template('Worley', 'EPC'),
  template('Petrofac', 'EPC'),
  template('Technip Energies', 'EPC'),
  template('Saipem', 'EPC'),
  template('TechnipFMC', 'EPC'),
  template('KBR', 'EPC'),
  template('Larsen & Toubro', 'EPC', { country: 'India', region: 'Asia' }),

  template('Drydocks World', 'Marine', { country: 'United Arab Emirates', region: 'Middle East' }),
  template('Damen', 'Marine', { region: 'Europe' }),
  template('Keppel', 'Marine', { country: 'Singapore', region: 'Asia' }),
  template('Hyundai Heavy Industries', 'Marine', { country: 'South Korea', region: 'Asia' }),
  template('Samsung Heavy Industries', 'Marine', { country: 'South Korea', region: 'Asia' }),
  template('Cochin Shipyard', 'Marine', { country: 'India', region: 'Asia' }),
  template('Mazagon Dock', 'Marine', { country: 'India', region: 'Asia' }),

  template('GE Vernova', 'Renewables'),
  template('Vestas', 'Renewables', { region: 'Europe' }),
  template('Siemens Gamesa', 'Renewables', { region: 'Europe' }),
  template('Ørsted', 'Renewables', { region: 'Europe' }),
  template('Suzlon', 'Renewables', { country: 'India', region: 'Asia' }),
  template('ABB', 'Renewables', { region: 'Europe' }),
  template('Hitachi Energy', 'Renewables'),

  template('CBRE', 'Facilities'),
  template('JLL', 'Facilities'),
  template('Cushman & Wakefield', 'Facilities'),
  template('ISS', 'Facilities'),
  template('Sodexo', 'Facilities'),
  template('Mitie', 'Facilities', { country: 'United Kingdom', region: 'Europe' }),
  template('EMCOR', 'Facilities'),
  template('Emrill', 'Facilities', { country: 'United Arab Emirates', region: 'Middle East' }),
  template('Farnek', 'Facilities', { country: 'United Arab Emirates', region: 'Middle East' })
];

export function listConnectorTemplates() {
  return connectorExpansionTemplates.map((item) => ({ ...item }));
}
