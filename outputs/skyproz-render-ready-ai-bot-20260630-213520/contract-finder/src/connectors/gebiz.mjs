import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'gebiz', name: 'GeBIZ Singapore', country: 'Singapore', region: 'Asia', sourceUrl: 'https://www.gebiz.gov.sg/', documentation: 'Singapore GeBIZ connector for configured tender feeds.' }));
