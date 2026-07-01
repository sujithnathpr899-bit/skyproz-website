import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'eib', name: 'European Investment Bank', country: 'Worldwide', region: 'International', sourceUrl: 'https://www.eib.org/en/about/procurement', documentation: 'EIB procurement connector for configured procurement feed access.' }));
