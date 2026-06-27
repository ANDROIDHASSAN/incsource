import { Router } from 'express';
import { STATE_CITIES, ZONES, METROS, STATES } from '../data/indiaGeo.js';

export const geoRouter = Router();

// Full India geography for the location filters (states → cities, zones, metros).
geoRouter.get('/', (_req, res) => {
  res.json({
    states: STATES.map((name) => ({ name, zone: zoneOf(name), cities: STATE_CITIES[name] })),
    zones: Object.entries(ZONES).map(([name, states]) => ({ name, states })),
    metros: METROS,
  });
});

function zoneOf(state) {
  for (const [zone, states] of Object.entries(ZONES)) if (states.includes(state)) return zone;
  return null;
}
