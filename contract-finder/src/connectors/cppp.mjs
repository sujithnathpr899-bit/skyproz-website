import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'cppp', name: 'CPPP India', country: 'India', region: 'Asia', sourceUrl: 'https://eprocure.gov.in/eprocure/app', documentation: 'Central Public Procurement Portal connector. Use approved feeds or configured API access.' }));
