import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'gem', name: 'GeM India', country: 'India', region: 'Asia', sourceUrl: 'https://bidplus.gem.gov.in/all-bids', documentation: 'GeM connector. Use only approved/public feeds or manually configured API access.' }));
