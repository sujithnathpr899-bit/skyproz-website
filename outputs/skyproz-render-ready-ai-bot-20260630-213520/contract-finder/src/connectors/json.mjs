import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'json', name: 'Generic JSON Feed', category: 'private', parserType: 'json', documentation: 'Configurable JSON or REST feed connector using parser_config field mappings.' }));
