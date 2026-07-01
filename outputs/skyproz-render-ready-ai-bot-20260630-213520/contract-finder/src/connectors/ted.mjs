import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'ted', name: 'TED Europe', country: 'European Union', region: 'Europe', sourceUrl: 'https://ted.europa.eu/', documentation: 'EU TED connector. Configure an approved TED API/search endpoint and field mappings in Admin.' }));
