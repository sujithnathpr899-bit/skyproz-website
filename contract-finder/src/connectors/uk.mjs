import { createConnector, connectorDefinition } from './base.mjs';

const connector = createConnector(connectorDefinition({
  key: 'uk',
  name: 'UK Find a Tender',
  country: 'United Kingdom',
  region: 'Europe',
  sourceUrl: 'https://www.find-tender.service.gov.uk/',
  itemsPath: 'releases',
  documentation: 'Official UK Find a Tender OCDS API connector using /api/1.0/ocdsReleasePackages.'
}));

function first(value) {
  return Array.isArray(value) ? value.find(Boolean) : value;
}

function documentUrl(release = {}) {
  const docs = [
    ...(release.tender?.documents || []),
    ...((release.contracts || []).flatMap((contract) => contract.documents || [])),
    ...((release.awards || []).flatMap((award) => award.documents || []))
  ];
  return docs.find((doc) => doc.url)?.url || (release.id ? `https://www.find-tender.service.gov.uk/Notice/${release.id}` : 'https://www.find-tender.service.gov.uk/');
}

function deliveryCountry(release = {}) {
  const award = first(release.awards || []);
  const item = first(award?.items || []);
  const address = first(item?.deliveryAddresses || []);
  return address?.countryName || address?.country || 'United Kingdom';
}

function classification(release = {}) {
  const award = first(release.awards || []);
  const item = first(award?.items || []);
  const cpv = first(item?.additionalClassifications || []);
  return cpv?.description || award?.mainProcurementCategory || 'Procurement';
}

function value(release = {}) {
  const contractValue = first(release.contracts || [])?.value;
  const tenderValue = release.tender?.value;
  return contractValue || tenderValue || {};
}

function localStatus(release = {}) {
  const raw = String(release.tender?.status || first(release.tag) || '').toLowerCase();
  if (raw === 'active' || raw === 'planning' || raw === 'tender') return 'open';
  if (raw === 'complete' || raw === 'award' || raw === 'contract') return 'awarded';
  if (raw === 'cancelled' || raw === 'unsuccessful') return 'cancelled';
  if (raw === 'withdrawn' || raw === 'terminated') return 'expired';
  return 'open';
}

const baseNormalize = connector.normalize;
connector.normalize = (item, source = {}) => {
  const contract = baseNormalize(item, source);
  const amount = value(item);
  const contractPeriod = first(item.contracts || [])?.period;
  const tenderPeriod = item.tender?.tenderPeriod;
  return {
    ...contract,
    external_id: item.id || item.ocid || contract.external_id,
    title: item.tender?.title || `UK Find a Tender notice ${item.id || ''}`.trim(),
    description: item.tender?.description || contract.description,
    source_name: source.name || connector.name,
    source_url: documentUrl(item),
    country: deliveryCountry(item),
    region: source.region || 'Europe',
    buyer_name: item.buyer?.name || first((item.parties || []).filter((party) => (party.roles || []).includes('buyer')))?.name || '',
    industry: classification(item),
    contract_type: item.tender?.procurementMethodDetails || item.tender?.procurementMethod || first(item.tag) || 'Tender',
    buyer_type: 'government',
    budget_value: Number(amount.amountGross || amount.amount || 0) || null,
    currency: amount.currency || null,
    deadline: tenderPeriod?.endDate || contractPeriod?.endDate || null,
    posted_date: item.date || contract.posted_date,
    tags: ['UK Find a Tender', ...(item.tag || []), item.tender?.status].filter(Boolean),
    status: localStatus(item),
    verified: true,
    duplicate_key: item.ocid ? `uk-fts:${item.ocid}:${item.id || ''}` : undefined,
    source_metadata: item
  };
};

export default connector;
