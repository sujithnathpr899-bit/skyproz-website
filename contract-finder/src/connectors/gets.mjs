import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'gets', name: 'GETS New Zealand', country: 'New Zealand', region: 'Oceania', sourceUrl: 'https://www.gets.govt.nz/', documentation: 'New Zealand GETS connector for configured opportunity feeds.' }));
