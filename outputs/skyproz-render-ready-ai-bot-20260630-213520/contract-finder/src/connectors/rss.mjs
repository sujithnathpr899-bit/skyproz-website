import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'rss', name: 'Generic RSS Feed', category: 'private', parserType: 'rss', documentation: 'Configurable RSS connector for public opportunity feeds.' }));
