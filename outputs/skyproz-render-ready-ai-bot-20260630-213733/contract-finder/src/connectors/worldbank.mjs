import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'worldbank', name: 'World Bank', country: 'Worldwide', region: 'International', sourceUrl: 'https://projects.worldbank.org/en/projects-operations/procurement', documentation: 'World Bank procurement connector for configured API/feed access.' }));
