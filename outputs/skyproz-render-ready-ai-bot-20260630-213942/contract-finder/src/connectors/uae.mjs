import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'uae', name: 'UAE Procurement', country: 'United Arab Emirates', region: 'Middle East', sourceUrl: 'https://u.ae/', documentation: 'UAE procurement connector for configured public or authority-specific feeds.' }));
