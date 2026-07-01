import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'csv', name: 'Generic CSV Feed', category: 'private', parserType: 'csv', documentation: 'Configurable CSV connector for exported procurement data.' }));
