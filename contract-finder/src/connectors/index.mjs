import ted from './ted.mjs';
import sam from './sam.mjs';
import uk from './uk.mjs';
import gem from './gem.mjs';
import cppp from './cppp.mjs';
import canadabuys from './canadabuys.mjs';
import austender from './austender.mjs';
import gets from './gets.mjs';
import gebiz from './gebiz.mjs';
import uae from './uae.mjs';
import etimad from './etimad.mjs';
import qatar from './qatar.mjs';
import ungm from './ungm.mjs';
import worldbank from './worldbank.mjs';
import adb from './adb.mjs';
import afdb from './afdb.mjs';
import eib from './eib.mjs';
import unicef from './unicef.mjs';
import undp from './undp.mjs';
import rss from './rss.mjs';
import privateRss from './private-rss.mjs';
import enterprisePortal from './enterprise-portal.mjs';
import json from './json.mjs';
import xml from './xml.mjs';
import csv from './csv.mjs';

const connectors = [ted, sam, uk, gem, cppp, canadabuys, austender, gets, gebiz, uae, etimad, qatar, ungm, worldbank, adb, afdb, eib, unicef, undp, rss, privateRss, enterprisePortal, json, xml, csv];
export const connectorRegistry = new Map(connectors.map((connector) => [connector.key, connector]));

export function listConnectors() {
  return connectors.map(({ key, name, category, documentation }) => ({ key, name, category, documentation }));
}

export function getConnector(key, fallback = 'json') {
  return connectorRegistry.get(key) || connectorRegistry.get(fallback);
}
