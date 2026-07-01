import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'austender', name: 'AusTender', country: 'Australia', region: 'Oceania', sourceUrl: 'https://www.tenders.gov.au/', documentation: 'AusTender connector for configured ATM/tender feeds.' }));
