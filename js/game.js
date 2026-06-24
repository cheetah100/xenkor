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

const ROSTER = [
  { name: 'You',     color: '#42a5f5', isHuman: true },
  { name: 'Crimson', color: '#ef5350', isHuman: false },
  { name: 'Violet',  color: '#ab47bc', isHuman: false },
  { name: 'Amber',   color: '#ffa726', isHuman: false },
  { name: 'Jade',    color: '#26a69a', isHuman: false },
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
