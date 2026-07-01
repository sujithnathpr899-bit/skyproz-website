import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'sam', name: 'SAM.gov USA', country: 'United States', region: 'North America', sourceUrl: 'https://sam.gov/', documentation: 'SAM.gov connector. Requires a valid SAM.gov API URL and key in the configured source URL.' }));
