// Game construction and turn sequencing.

import { generateMap } from './mapgen.js';
import { makeUnit, startTurn, log, UNITS } from './rules.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each NPC power has a temperament: multipliers on the AI's decision thresholds
// (1.0 everywhere = the balanced default the test-driven human also uses).
// Personalities change what a power WANTS, never what it CAN do — everyone pays
// the same costs and rolls the same dice. The asymmetry is what breaks the
// mirror-match stalemates identical AIs grind into; it also means some powers
// will simply tend to win or lose more often, which is intended.
//   aggression: attack-odds bar and how early desperation sets in
//   mechs/air/navy: appetite for each arm (quotas, bases, fleets, carriers)
//   forts: fortification radius and whether buildings get walls too
//   horde: army-size cap
//   flank: objective choice — low goes straight at the nearest enemy building,
//          high swings around to hit soft targets
const ROSTER = [
  { name: 'You',     color: '#42a5f5', isHuman: true },
  { name: 'Crimson', color: '#ef5350', isHuman: false, // warlord: attack, always
    traits: { aggression: 1.5, mechs: 1.4, air: 0.8, navy: 0.8, forts: 0.5, horde: 1.2, flank: 0.7 } },
  { name: 'Violet',  color: '#ab47bc', isHuman: false, // air marshal: wins the sky first
    traits: { aggression: 1.0, mechs: 0.9, air: 1.7, navy: 0.8, forts: 1.0, horde: 0.9, flank: 1.2 } },
  { name: 'Amber',   color: '#ffa726', isHuman: false, // admiral: the sea is a highway
    traits: { aggression: 1.0, mechs: 0.9, air: 1.0, navy: 1.8, forts: 0.8, horde: 0.9, flank: 1.5 } },
  { name: 'Jade',    color: '#26a69a', isHuman: false, // turtle: outlast, then overwhelm
    traits: { aggression: 0.6, mechs: 1.0, air: 1.0, navy: 0.7, forts: 1.8, horde: 1.3, flank: 1.0 } },
];

export function createGame(seed = (Math.random() * 2 ** 31) | 0) {
  const rng = mulberry32(seed);
  const { cells, starts } = generateMap(rng);

  const players = ROSTER.map((r, id) => ({ ...r, id, money: 25, alive: true }));
  const game = { seed, rng, cells, players, current: 0, turn: 1, log: [], over: false, fx: [] };

  starts.forEach((cell, i) => {
    cell.owner = i;
    // Each capital starts with a barracks so infantry can be raised from turn 1;
    // without it the opening has no army production and wars never get going.
    cell.upgrade = 'barracks';
    for (let n = 0; n < 3; n++) {
      const u = makeUnit('basic', i);
      u.actions = UNITS.basic.actions;
      cell.units.push(u);
    }
    players[i].startKey = `${cell.q},${cell.r}`;
  });

  log(game, `A new world (seed ${seed}). Five powers awaken. You are blue.`);
  startTurn(game, 0);
  return game;
}
