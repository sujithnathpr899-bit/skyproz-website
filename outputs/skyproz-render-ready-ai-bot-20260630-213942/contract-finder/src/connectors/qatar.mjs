import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'qatar', name: 'Qatar Procurement', country: 'Qatar', region: 'Middle East', sourceUrl: 'https://www.mof.gov.qa/', documentation: 'Qatar procurement connector for configured authority feeds.' }));
