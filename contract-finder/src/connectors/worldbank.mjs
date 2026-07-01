import { createConnector, connectorDefinition } from './base.mjs';
const connector = createConnector(connectorDefinition({
  key: 'worldbank',
  name: 'World Bank',
  country: 'Worldwide',
  region: 'International',
  sourceUrl: 'https://projects.worldbank.org/en/projects-operations/procurement',
  itemsPath: 'procnotices',
  fieldMap: {
    external_id: 'id',
    title: 'bid_description',
    description: 'notice_text',
    country: 'project_ctry_name',
    industry: 'procurement_group',
    contract_type: 'procurement_method_name',
    deadline: 'submission_deadline_date',
    posted_date: 'submission_date',
    buyer_name: 'contact_organization',
    tags: 'notice_type'
  },
  documentation: 'World Bank procurement connector for configured API/feed access.'
}));

const baseNormalize = connector.normalize;
connector.normalize = (item, source = {}) => {
  const contract = baseNormalize(item, source);
  const id = item.id || contract.external_id;
  return {
    ...contract,
    title: item.bid_description || item.project_name || contract.title,
    description: String(item.notice_text || item.bid_description || contract.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    source_url: id ? `https://projects.worldbank.org/en/projects-operations/procurement-detail/${encodeURIComponent(id)}` : contract.source_url,
    country: item.project_ctry_name || contract.country,
    industry: item.procurement_group || contract.industry,
    contract_type: item.procurement_method_name || item.notice_type || contract.contract_type,
    buyer_name: item.contact_organization || contract.buyer_name,
    tags: [item.notice_type, item.procurement_method_code, item.procurement_group].filter(Boolean)
  };
};

export default connector;
