import { createConnector, connectorDefinition } from './base.mjs';
export default createConnector(connectorDefinition({ key: 'adb', name: 'Asian Development Bank', country: 'Worldwide', region: 'International', sourceUrl: 'https://www.adb.org/projects/tenders', documentation: 'ADB tender connector for configured procurement feed access.' }));
