import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'ungm', name: 'UNGM', country: 'Worldwide', region: 'International', sourceUrl: 'https://www.ungm.org/', documentation: 'UN Global Marketplace connector for configured API/feed access.' }));
