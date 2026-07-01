import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'canadabuys', name: 'CanadaBuys', country: 'Canada', region: 'North America', sourceUrl: 'https://canadabuys.canada.ca/', documentation: 'CanadaBuys connector for configured public opportunity feeds.' }));
