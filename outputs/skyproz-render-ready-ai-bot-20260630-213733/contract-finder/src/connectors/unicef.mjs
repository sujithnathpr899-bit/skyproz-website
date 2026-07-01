import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'unicef', name: 'UNICEF', country: 'Worldwide', region: 'International', sourceUrl: 'https://www.unicef.org/supply/procurement-opportunities', documentation: 'UNICEF procurement connector for configured tender feed access.' }));
