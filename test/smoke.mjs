// Headless smoke test: play full AI-vs-AI games and check invariants.

import { createGame } from '../js/game.js';
import { aiTurn } from '../js/ai.js';
import {
  startTurn, winner, cellCount, playerIncome, makeUnit, attackHex,
  airStrike, airMove, aircraftAt, build, attackAll,
  MAX_UNITS_PER_HEX, UNITS, UPGRADES, AIR_RANGE,
} from '../js/rules.js';
import { neighbors, hexDistance } from '../js/hex.js';

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.error('FAIL:', msg);
  }
}

function checkInvariants(game, label) {
  for (const cell of game.cells.values()) {
    check(cell.units.length <= MAX_UNITS_PER_HEX, `${label}: >9 units on a hex`);
    check(cell.upgrade === null || cell.upgrade in UPGRADES, `${label}: bad upgrade ${cell.upgrade}`);
    if (cell.terrain === 'sea') {
      check(cell.owner === null, `${label}: sea hex has an owner`);
      check(cell.upgrade === null && !cell.fort, `${label}: sea hex has buildings`);
      // Aircraft at sea live aboard carriers, never loose on the water.
      check(cell.units.every(u => UNITS[u.type].domain === 'sea'), `${label}: non-naval unit at sea`);
    } else {
      check(cell.units.every(u => UNITS[u.type].domain !== 'sea'), `${label}: naval unit on land`);
    }
    for (const u of cell.units) {
      check(u.hp > 0, `${label}: dead unit on board`);
      check(game.players[u.owner].alive, `${label}: unit owned by eliminated player`);
    }
  }
  for (const p of game.players) {
    check(p.money >= 0, `${label}: negative money for ${p.name}`);
  }
}

function playGame(seed, maxTurns = 120) {
  const game = createGame(seed);
  // The "human" plays too, driven by the same AI, so the whole rule set gets exercised.
  for (let turn = 0; turn < maxTurns && !winner(game); turn++) {
    for (let p = 0; p < game.players.length; p++) {
      if (!game.players[p].alive) continue;
      if (!(turn === 0 && p === 0)) startTurn(game, p); // creation already started P0 turn 1
      aiTurn(game, p);
      checkInvariants(game, `seed ${seed} turn ${turn} player ${p}`);
      if (winner(game)) break;
    }
    game.turn++;
  }
  const alive = game.players.filter(p => p.alive);
  const w = winner(game);
  const incomes = game.players.map(p => playerIncome(game, p.id));
  console.log(
    `seed ${seed}: ${game.turn} turns, alive=${alive.map(p => p.name).join(',')}` +
    (w ? ` — WINNER ${w.name}` : ' — no winner yet') +
    ` | incomes ${incomes.join('/')}`
  );
  check(alive.length >= 1, `seed ${seed}: everyone died`);
  return game;
}

// Map sanity across several seeds.
for (const seed of [1, 42, 1337, 90210, 7]) {
  const game = createGame(seed);
  const all = [...game.cells.values()];
  const land = all.filter(c => c.terrain !== 'sea');
  check(land.length > all.length * 0.3, `seed ${seed}: too little land (${land.length}/${all.length})`);
  check(land.length < all.length * 0.8, `seed ${seed}: too little sea`);
  const starts = game.players.map(p => all.find(c => c.owner === p.id));
  check(starts.every(Boolean), `seed ${seed}: missing start position`);
  check(starts.every(c => c.units.length === 3), `seed ${seed}: start should have 3 units`);

  // All land must be connected (land bridges), so any land unit can reach any enemy.
  const seen = new Set();
  const stack = [land[0]];
  seen.add(land[0]);
  while (stack.length) {
    const c = stack.pop();
    for (const n of neighbors(game.cells, c)) {
      if (n.terrain !== 'sea' && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  check(seen.size === land.length,
    `seed ${seed}: land not fully connected (${seen.size}/${land.length})`);
}

// --- Mechanics: warship shore bombardment ---
{
  const game = createGame(5);
  const sea = [...game.cells.values()].find(c =>
    c.terrain === 'sea' && neighbors(game.cells, c).some(n => n.terrain !== 'sea'));
  const shore = neighbors(game.cells, sea).find(n => n.terrain !== 'sea');
  shore.owner = 1;
  shore.fort = false;
  shore.units = [makeUnit('basic', 1)];
  const ws = makeUnit('warship', 0);
  sea.units = [ws];

  // Land units must not be able to attack ships.
  shore.units[0].actions = 3;
  check(attackHex(game, shore, sea, 1).error, 'land unit attacked a ship');

  // Warships bombard until the defender dies; they can never capture the hex.
  for (let i = 0; i < 50 && shore.units.length; i++) {
    ws.actions = 5;
    const res = attackHex(game, sea, shore, 0);
    check(!res.error, `bombardment errored: ${res.error}`);
    ws.hp = UNITS.warship.hp; // shore battery counterfire shouldn't end the test
  }
  check(shore.units.length === 0, 'bombardment never cleared the shore');
  check(shore.owner === 1, 'bombardment must not capture the hex');
}

// --- Mechanics: upgrade transitions ---
{
  const game = createGame(11);
  const cell = [...game.cells.values()].find(c => c.terrain === 'farmland');
  cell.owner = 0;
  game.players[0].money = 200;
  check(build(game, cell, 'farm', 0) === null, 'farm built');
  check(build(game, cell, 'farm', 0) !== null, 'same upgrade twice rejected');
  check(build(game, cell, 'factory', 0) === null, 'farm upgraded to factory');
  check(cell.upgrade === 'factory', 'upgrade replaced');
  check(game.players[0].money === 200 - 10 - 50, 'paid full cost of each');
}

// --- Mechanics: aircraft strike, attrition and redeployment ---
{
  const game = createGame(6);
  const land = [...game.cells.values()].filter(c => c.terrain !== 'sea');
  const base = land[0];
  base.owner = 0;
  base.upgrade = 'airbase';
  const target = land.find(c => {
    const d = hexDistance(base, c);
    return d > 1 && d <= AIR_RANGE;
  });
  target.owner = 1;
  target.units = [makeUnit('basic', 1), makeUnit('basic', 1)];
  const far = land.find(c => hexDistance(base, c) > AIR_RANGE);

  const planes = [makeUnit('aircraft', 0), makeUnit('aircraft', 0)];
  base.units.push(...planes);
  check(airStrike(game, base, target, 0).error, 'strike without actions rejected');
  for (let i = 0; i < 60 && target.units.length && aircraftAt(base, 0).length; i++) {
    for (const a of aircraftAt(base, 0)) a.actions = UNITS.aircraft.actions;
    const res = airStrike(game, base, target, 0);
    check(!res.error, `air strike errored: ${res.error}`);
  }
  check(target.units.length === 0 || aircraftAt(base, 0).length === 0,
    'air war should end in destruction one way or the other');
  check(target.owner === 1, 'air strike must not capture the hex');
  if (far) {
    for (const a of aircraftAt(base, 0)) a.actions = UNITS.aircraft.actions;
    check(airStrike(game, base, far, 0).error === 'out of aircraft range', 'range 6 enforced');
  }
}

// --- Mechanics: carrier as mobile air base ---
{
  const game = createGame(8);
  const sea = [...game.cells.values()].find(c =>
    c.terrain === 'sea' && neighbors(game.cells, c).some(n => n.terrain !== 'sea'));
  const shore = neighbors(game.cells, sea).find(n => n.terrain !== 'sea');
  shore.owner = 0;
  shore.upgrade = 'airbase';
  const plane = makeUnit('aircraft', 0);
  plane.actions = UNITS.aircraft.actions;
  shore.units = [plane];
  const carrier = makeUnit('carrier', 0);
  sea.units = [carrier];
  check(UNITS.carrier.actions < UNITS.warship.actions, 'carrier slower than warship');

  check(airMove(game, shore, sea, 0) === null, 'plane flies to carrier');
  check(carrier.cargo.includes(plane), 'plane aboard carrier');
  // Strike from the carrier deck.
  const victim = neighbors(game.cells, sea).find(n => n !== shore && n.terrain !== 'sea')
    ?? shore;
  if (victim !== shore) {
    victim.owner = 1;
    victim.units = [makeUnit('basic', 1)];
    plane.actions = UNITS.aircraft.actions;
    const res = airStrike(game, sea, victim, 0);
    check(!res.error && res.rolls.length === 1, 'carrier-based strike launched');
  }
  // Capacity: 3 planes max.
  carrier.cargo.length = 0;
  for (let i = 0; i < 3; i++) carrier.cargo.push(makeUnit('aircraft', 0));
  const extra = makeUnit('aircraft', 0);
  extra.actions = 2;
  shore.units = [extra];
  check(airMove(game, shore, sea, 0) !== null, 'carrier deck capacity enforced');
}

// Full games.
for (const seed of [1, 42, 1337]) playGame(seed);

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll smoke tests passed.');
