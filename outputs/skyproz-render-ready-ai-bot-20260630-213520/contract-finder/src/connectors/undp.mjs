import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'undp', name: 'UNDP', country: 'Worldwide', region: 'International', sourceUrl: 'https://procurement-notices.undp.org/', documentation: 'UNDP procurement connector for configured procurement notices.' }));
