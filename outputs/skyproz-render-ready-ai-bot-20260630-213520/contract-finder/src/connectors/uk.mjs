import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'uk', name: 'UK Contracts Finder', country: 'United Kingdom', region: 'Europe', sourceUrl: 'https://www.contractsfinder.service.gov.uk/', documentation: 'UK Contracts Finder connector for configured API/feed access.' }));
