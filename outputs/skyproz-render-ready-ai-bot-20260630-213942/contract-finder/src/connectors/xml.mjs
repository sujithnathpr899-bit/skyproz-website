import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'xml', name: 'Generic XML Feed', category: 'private', parserType: 'xml', documentation: 'Configurable XML connector for procurement feeds.' }));
