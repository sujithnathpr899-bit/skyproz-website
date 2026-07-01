import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'afdb', name: 'African Development Bank', country: 'Worldwide', region: 'International', sourceUrl: 'https://www.afdb.org/en/projects-and-operations/procurement', documentation: 'AfDB procurement connector for configured opportunity feeds.' }));
