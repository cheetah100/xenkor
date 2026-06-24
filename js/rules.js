// Game constants and mechanics, per xenkor-spec.md.
// UI-free so the same rules drive the browser game and headless tests.

import { key, neighbors, isAdjacent, hexDistance } from './hex.js';

// Unimproved land earns a small trickle (farmland/mountains 1, desert 0) so a
// player can never be locked out of recovering; farms and factories stack on top.
export const TERRAIN = {
  farmland:  { income: 1, defense: 1 },
  mountains: { income: 1, defense: 3 },
  desert:    { income: 0, defense: 0 },
  sea:       { income: 0, defense: 0 },
};

// A cell holds at most ONE upgrade, but it can be replaced later by paying the
// new upgrade's full cost. Fortification is separate and stacks with it.
export const UPGRADES = {
  farm:     { cost: 10, name: 'Farm',     emoji: '🌾' },
  barracks: { cost: 30, name: 'Barracks', emoji: '🏰' },
  factory:  { cost: 50, name: 'Factory',  emoji: '🏭' },
  port:     { cost: 30, name: 'Port',     emoji: '⚓' },
  airbase:  { cost: 40, name: 'Air base', emoji: '🛫' },
};
export const FORT = { cost: 20, name: 'Fortification' };
export const AIR_RANGE = 6;
// Warships throw up anti-air fire over any hex within one of them: each engages an
// attacking plane on 1d6 + its `aa` rating beating this number (rating 3 → needs 4+).
export const FLAK_RANGE = 1;
const FLAK_EVASION = 6;

// Units with an `aa` rating throw up anti-air fire at planes within FLAK_RANGE.
export const UNITS = {
  basic:     { name: 'Infantry',   cost: 10, actions: 3, hp: 2, atk: 1, def: 1, domain: 'land', emoji: '🪖' },
  mech:      { name: 'Mechanised', cost: 40, actions: 5, hp: 4, atk: 3, def: 2, domain: 'land', emoji: '🚜' },
  sam:       { name: 'SAM battery', cost: 30, actions: 2, hp: 2, atk: 0, def: 1, domain: 'land', emoji: '🚀', aa: 4 },
  warship:   { name: 'Warship',    cost: 35, actions: 5, hp: 3, atk: 3, def: 2, domain: 'sea',  emoji: '🚢', aa: 3 },
  carrier:   { name: 'Carrier',    cost: 60, actions: 3, hp: 3, atk: 0, def: 1, domain: 'sea',  emoji: '🛳️', capacity: 3 },
  transport: { name: 'Transport',  cost: 20, actions: 3, hp: 2, atk: 0, def: 0, domain: 'sea',  emoji: '⛴️', capturable: true, capacity: 3 },
  aircraft:  { name: 'Aircraft',   cost: 30, actions: 2, hp: 2, atk: 3, def: 0, domain: 'air',  emoji: '✈️' },
};

export const MAX_UNITS_PER_HEX = 9;
// When a hex takes a hit, units soak it in this order (warships screen the fleet).
const HIT_PRIORITY = ['warship', 'carrier', 'mech', 'basic', 'sam', 'aircraft', 'transport'];
// Cargo slots: 1 transport carries 3 infantry, OR 1 mechanised, OR 1 SAM battery.
export const CARGO_SLOTS = { basic: 1, mech: 3, sam: 3 };

let nextUnitId = 1;
export function makeUnit(type, owner) {
  const def = UNITS[type];
  return { id: nextUnitId++, type, owner, hp: def.hp, actions: 0, cargo: def.capacity ? [] : undefined };
}

export function domainOf(cell) {
  return cell.terrain === 'sea' ? 'sea' : 'land';
}

export function isCoastal(game, cell) {
  return cell.terrain !== 'sea' && neighbors(game.cells, cell).some(n => n.terrain === 'sea');
}

export function farmIncome(cell) {
  return cell.terrain === 'farmland' ? 3 : cell.terrain === 'mountains' ? 1 : 0;
}

// Per-turn income from a single owned land cell: the terrain's base trickle plus
// whatever a farm or factory adds on top.
export function cellIncome(cell) {
  let n = TERRAIN[cell.terrain].income;
  if (cell.upgrade === 'farm') n += farmIncome(cell);
  else if (cell.upgrade === 'factory') n += 5;
  return n;
}

export function playerIncome(game, p) {
  let total = 0;
  for (const cell of game.cells.values()) {
    if (cell.owner === p) total += cellIncome(cell);
  }
  return total;
}

export function cellCount(game, p) {
  let n = 0;
  for (const cell of game.cells.values()) if (cell.owner === p) n++;
  return n;
}

export function defenseOf(game, cell, attacker) {
  const defenders = cell.units.filter(u => u.owner !== attacker);
  let d = TERRAIN[cell.terrain].defense + (cell.fort ? 3 : 0);
  d += Math.max(0, ...defenders.map(u => UNITS[u.type].def));
  return d;
}

export function enemyUnits(cell, p) {
  return cell.units.filter(u => u.owner !== p);
}

// Enemy units that bar entry to a hex. Parked aircraft can't hold ground:
// you can walk in past them (and capture them with the hex).
export function blockingUnits(cell, p) {
  return cell.units.filter(u => u.owner !== p && u.type !== 'aircraft');
}

export function ownUnits(cell, p) {
  return cell.units.filter(u => u.owner === p);
}

export function log(game, msg) {
  game.log.push({ turn: game.turn, msg });
  if (game.log.length > 300) game.log.shift();
}

export function startTurn(game, p) {
  const income = playerIncome(game, p);
  game.players[p].money += income;
  for (const cell of game.cells.values()) {
    for (const u of cell.units) {
      if (u.owner === p) u.actions = UNITS[u.type].actions;
      for (const c of u.cargo ?? []) if (c.owner === p) c.actions = UNITS[c.type].actions;
    }
  }
}

// ---------- Building & recruiting ----------

export function canBuild(game, cell, what, p) {
  const pl = game.players[p];
  if (cell.owner !== p || cell.terrain === 'sea') return 'not your land';
  if (what === 'fort') {
    if (pl.money < FORT.cost) return 'not enough money';
    if (cell.fort) return 'already fortified';
    return null;
  }
  if (pl.money < UPGRADES[what].cost) return 'not enough money';
  if (cell.upgrade === what) return 'already built';
  // Only a farm (or empty land) can be upgraded in place; any other improvement
  // must be razed first, so you can't accidentally overwrite a barracks/factory.
  if (cell.upgrade && cell.upgrade !== 'farm') {
    return `raze the ${UPGRADES[cell.upgrade].name.toLowerCase()} first`;
  }
  if (what === 'farm' && cell.terrain === 'desert') return 'no farms on desert';
  if (what === 'port' && !isCoastal(game, cell)) return 'must be coastal';
  return null;
}

export function build(game, cell, what, p) {
  const err = canBuild(game, cell, what, p);
  if (err) return err;
  if (what === 'fort') {
    game.players[p].money -= FORT.cost;
    cell.fort = true;
    log(game, `${game.players[p].name} fortified a hex.`);
  } else {
    game.players[p].money -= UPGRADES[what].cost;
    const replaced = cell.upgrade;
    cell.upgrade = what;
    log(game, `${game.players[p].name} ` +
      (replaced ? `replaced a ${UPGRADES[replaced].name.toLowerCase()} with` : 'built') +
      ` a ${UPGRADES[what].name.toLowerCase()}.`);
  }
  return null;
}

// Scorched earth: a player may raze their own improvement to deny it to an
// advancing enemy — but only on a hex they still hold and have a unit standing on.
export function canRazeOwn(game, cell, p) {
  if (cell.owner !== p || cell.terrain === 'sea') return 'not your land';
  if (!cell.upgrade) return 'no improvement to raze';
  if (ownUnits(cell, p).length < 1) return 'needs a unit on the hex';
  return null;
}

export function razeOwn(game, cell, p) {
  const err = canRazeOwn(game, cell, p);
  if (err) return err;
  const razed = cell.upgrade;
  cell.upgrade = null;
  log(game, `${game.players[p].name} razed their own ${UPGRADES[razed].name.toLowerCase()}.`);
  checkElimination(game, p);
  return null;
}

// Sea hex next to a port cell where a new naval unit can appear.
export function navalSpawnCell(game, cell, p) {
  let best = null;
  for (const n of neighbors(game.cells, cell)) {
    if (n.terrain !== 'sea') continue;
    if (enemyUnits(n, p).length) continue;
    if (n.units.length >= MAX_UNITS_PER_HEX) continue;
    if (!best || n.units.length < best.units.length) best = n;
  }
  return best;
}

export function canRecruit(game, cell, type, p) {
  const def = UNITS[type];
  if (cell.owner !== p || cell.terrain === 'sea') return 'not your land';
  if (game.players[p].money < def.cost) return 'not enough money';
  if (type === 'basic' && cell.upgrade !== 'barracks' && cell.upgrade !== 'port') {
    return 'requires a barracks or port';
  }
  if ((type === 'mech' || type === 'sam') && cell.upgrade !== 'factory') return 'requires a factory';
  if (type === 'aircraft' && cell.upgrade !== 'airbase') return 'requires an air base';
  if (def.domain === 'sea') {
    if (cell.upgrade !== 'port') return 'requires a port';
    if (!navalSpawnCell(game, cell, p)) return 'no free sea hex adjacent';
  } else if (cell.units.length >= MAX_UNITS_PER_HEX) {
    return 'hex is full (9 units)';
  }
  return null;
}

export function recruit(game, cell, type, p) {
  const err = canRecruit(game, cell, type, p);
  if (err) return err;
  game.players[p].money -= UNITS[type].cost;
  const unit = makeUnit(type, p);
  const target = UNITS[type].domain === 'sea' ? navalSpawnCell(game, cell, p) : cell;
  target.units.push(unit);
  log(game, `${game.players[p].name} recruited a ${UNITS[type].name.toLowerCase()}.`);
  return null;
}

// ---------- Movement ----------

export function captureCell(game, cell, p) {
  if (cell.terrain === 'sea' || cell.owner === p) return;
  const prev = cell.owner;
  cell.owner = p;
  // Aircraft caught on the ground change flags with the hex.
  for (const u of cell.units) {
    if (u.owner !== p && u.type === 'aircraft') {
      log(game, `${game.players[p].name} captured a grounded aircraft!`);
      u.owner = p;
      u.actions = 0;
    }
  }
  const stuff = [];
  if (cell.upgrade) stuff.push(`a ${UPGRADES[cell.upgrade].name.toLowerCase()}`);
  if (cell.fort) stuff.push('a fortification');
  if (prev !== null) {
    log(game, `${game.players[p].name} captured a hex from ${game.players[prev].name}` +
      (stuff.length ? ` with ${stuff.join(', ')}` : '') + '.');
    checkElimination(game, prev, p);
  }
}

// Movement-point cost to enter a cell. Mountains cost double.
export function moveCost(cell) {
  return cell.terrain === 'mountains' ? 2 : 1;
}

// Dijkstra over cells a stack in `from` can reach. Returns {dists, parents}.
// Entering a mountain costs 2 movement points, every other terrain costs 1.
export function reachable(game, from, p) {
  const dists = new Map(), parents = new Map();
  const dom = domainOf(from);
  const movers = ownUnits(from, p).filter(u => u.actions > 0 && UNITS[u.type].domain === dom);
  if (!movers.length) return { dists, parents };
  const maxSteps = Math.max(...movers.map(u => u.actions));
  const fromKey = key(from.q, from.r);
  dists.set(fromKey, 0);
  // Non-uniform step cost means a plain BFS can't guarantee shortest paths, so
  // relax frontier cells until no cheaper route is found (queue stays tiny).
  const queue = [from];
  while (queue.length) {
    const cell = queue.shift();
    const base = dists.get(key(cell.q, cell.r));
    for (const n of neighbors(game.cells, cell)) {
      if (domainOf(n) !== dom) continue;
      if (blockingUnits(n, p).length) continue;
      const k = key(n.q, n.r);
      const nd = base + moveCost(n);
      if (nd > maxSteps) continue;
      if (dists.has(k) && dists.get(k) <= nd) continue;
      dists.set(k, nd);
      parents.set(k, key(cell.q, cell.r));
      queue.push(n);
    }
  }
  dists.delete(fromKey);
  return { dists, parents };
}

export function pathTo(parents, fromKey, toKey) {
  const path = [];
  let k = toKey;
  while (k !== undefined && k !== fromKey) {
    path.unshift(k);
    k = parents.get(k);
  }
  return k === fromKey ? path : null;
}

// Move every unit of p in `from` that has enough actions along path (array of cell keys).
export function moveStack(game, from, path, p) {
  const steps = path.length;
  const dom = domainOf(from);
  const cost = path.reduce((sum, k) => sum + moveCost(game.cells.get(k)), 0);
  let movers = ownUnits(from, p).filter(u => u.actions >= cost && UNITS[u.type].domain === dom);
  const dest = game.cells.get(path[steps - 1]);
  const room = MAX_UNITS_PER_HEX - dest.units.length;
  if (room <= 0) return 'destination is full';
  movers = movers.slice(0, room);
  if (!movers.length) return 'no units can move that far';
  for (const u of movers) {
    from.units.splice(from.units.indexOf(u), 1);
    u.actions -= cost;
  }
  for (const k of path) {
    const cell = game.cells.get(k);
    if (cell.terrain !== 'sea') captureCell(game, cell, p);
  }
  dest.units.push(...movers);
  return null;
}

// ---------- Combat ----------

function pickDefender(cell, p) {
  const defenders = enemyUnits(cell, p);
  for (const type of HIT_PRIORITY) {
    const u = defenders.find(d => d.type === type);
    if (u) return u;
  }
  return null;
}

// One successful hit lands on the hex: damage, then destroy/sink or capture.
// Boarding (flag-swap) only happens in adjacent surface combat; air strikes
// and shore bombardment can only sink, never capture.
function applyHit(game, to, p, canCapture, canRaze) {
  // Mech and air firepower can raze the hex's improvement outright — even with
  // its defenders still standing — instead of the hit landing on a unit.
  if (canRaze && to.upgrade) {
    const razed = to.upgrade;
    to.upgrade = null;
    log(game, `${game.players[p].name} razed a ${UPGRADES[razed].name.toLowerCase()}.`);
    // Razing the hex's last production building wipes the owner out, same as
    // capture — and the attacker inherits their remaining land and forces.
    checkElimination(game, to.owner, p);
    return `razed ${UPGRADES[razed].name}`;
  }
  const d = pickDefender(to, p);
  d.hp--;
  if (d.hp > 0) return 'hit';
  if (canCapture && UNITS[d.type].capturable) {
    d.owner = p;
    d.hp = UNITS[d.type].hp;
    d.actions = 0;
    for (const c of d.cargo ?? []) c.owner = p;
    return `captured ${UNITS[d.type].name}` + (d.cargo?.length ? ' with cargo!' : '');
  }
  const owner = d.owner;
  to.units.splice(to.units.indexOf(d), 1);
  const sankCargo = d.cargo?.length;
  checkElimination(game, owner, p);
  return `${UNITS[d.type].capturable ? 'sank' : 'destroyed'} ${UNITS[d.type].name}` +
    (sankCargo ? ' and its cargo' : '');
}

// Every unit of p in `from` with an action attacks `to` once (coordinated assault).
export function attackHex(game, from, to, p) {
  if (!isAdjacent(from, to)) return { error: 'not adjacent' };
  // Warships may bombard adjacent land hexes; no other cross-domain attacks.
  const bombard = domainOf(from) === 'sea' && domainOf(to) === 'land';
  if (!bombard && domainOf(from) !== domainOf(to)) {
    return { error: 'land units cannot attack ships' };
  }
  const results = { rolls: [], error: null };
  const attackers = ownUnits(from, p).filter(u =>
    u.actions > 0 && UNITS[u.type].atk > 0 && UNITS[u.type].domain !== 'air' &&
    (!bombard || u.type === 'warship'));
  if (!attackers.length) return { error: 'no units with actions left' };
  if (!enemyUnits(to, p).length) return { error: 'nothing to attack' };
  for (const a of attackers) {
    if (!enemyUnits(to, p).length) break;
    a.actions--;
    const defTotal = defenseOf(game, to, p);
    const roll = 1 + Math.floor(game.rng() * 6);
    const total = roll + UNITS[a.type].atk;
    if (total > defTotal) {
      // Boarding only in same-domain surface combat (not bombardment); mechs can
      // raze the hex's improvement.
      const outcome = applyHit(game, to, p, !bombard, a.type === 'mech');
      results.rolls.push({ roll, total, defTotal, success: true, outcome, attacker: a.type });
    } else {
      a.hp--;
      let outcome = 'repelled';
      if (a.hp <= 0) {
        from.units.splice(from.units.indexOf(a), 1);
        outcome = `attacker ${UNITS[a.type].name} destroyed`;
      }
      results.rolls.push({ roll, total, defTotal, success: false, outcome, attacker: a.type });
    }
  }
  const wins = results.rolls.filter(r => r.success).length;
  log(game, `${game.players[p].name} attacked: ${wins}/${results.rolls.length} hits.`);
  recordFx(game, {
    kind: bombard ? 'bombard' : 'attack',
    from: key(from.q, from.r), to: key(to.q, to.r), attacker: p,
    shots: results.rolls.length, hits: wins,
  });
  return results;
}

// Combat events for the UI to animate. Cleared by the renderer as it consumes them.
export function recordFx(game, ev) {
  (game.fx ??= []).push(ev);
}

// Can this stack attack that hex at all (ground, bombardment or air strike)?
export function canAttack(game, from, to, p) {
  if (!enemyUnits(to, p).length) return false;
  if (hexDistance(from, to) <= AIR_RANGE &&
      aircraftAt(from, p).some(a => a.actions > 0)) return true;
  if (!isAdjacent(from, to)) return false;
  // Same-domain surface combat needs a unit that can actually fight —
  // transports (attack 0) carry cargo but never attack.
  if (domainOf(from) === domainOf(to)) {
    return ownUnits(from, p).some(u =>
      u.actions > 0 && UNITS[u.type].atk > 0 && UNITS[u.type].domain !== 'air');
  }
  return domainOf(from) === 'sea' && domainOf(to) === 'land' &&
    ownUnits(from, p).some(u => u.type === 'warship' && u.actions > 0);
}

// ---------- Aircraft ----------

// p's aircraft based in this cell: parked on land, or aboard carriers at sea.
export function aircraftAt(cell, p) {
  const parked = cell.units.filter(u => u.owner === p && u.type === 'aircraft');
  const aboard = cell.units
    .filter(u => u.owner === p && u.type === 'carrier')
    .flatMap(c => c.cargo);
  return [...parked, ...aboard];
}

function removeAircraft(cell, plane) {
  const i = cell.units.indexOf(plane);
  if (i >= 0) { cell.units.splice(i, 1); return; }
  for (const u of cell.units) {
    const j = u.cargo?.indexOf(plane) ?? -1;
    if (j >= 0) { u.cargo.splice(j, 1); return; }
  }
}

// Hexes within FLAK_RANGE of the struck hex (where anti-air units can reach it).
function flakCellsAround(game, to) {
  return [...game.cells.values()].filter(c => hexDistance(c, to) <= FLAK_RANGE);
}

// Every ready aircraft based at `from` strikes `to` (any hex within range 6).
// A failed strike costs the aircraft 1 hp; nearby enemy warships add anti-air fire.
export function airStrike(game, from, to, p) {
  if (hexDistance(from, to) > AIR_RANGE) return { error: 'out of aircraft range' };
  const planes = aircraftAt(from, p).filter(a => a.actions > 0);
  if (!planes.length) return { error: 'no aircraft ready' };
  if (!enemyUnits(to, p).length) return { error: 'nothing to attack' };
  const results = { rolls: [], error: null };
  const flakCells = flakCellsAround(game, to);
  // Cells holding an enemy anti-air unit that will engage the incoming planes.
  const flakGuns = flakCells.filter(c => c.units.some(u => u.owner !== p && UNITS[u.type].aa));
  let downedByFlak = 0, flakHits = 0;
  for (const a of planes) {
    if (!enemyUnits(to, p).length) break;
    a.actions--;
    const defTotal = defenseOf(game, to, p);
    const roll = 1 + Math.floor(game.rng() * 6);
    const total = roll + UNITS.aircraft.atk;
    if (total > defTotal) {
      // Aircraft sink ships and raze improvements; they can't board or capture.
      const outcome = applyHit(game, to, p, false, true);
      results.rolls.push({ roll, total, defTotal, success: true, outcome, attacker: 'aircraft' });
    } else {
      a.hp--;
      let outcome = 'repelled';
      if (a.hp <= 0) {
        removeAircraft(from, a);
        outcome = 'aircraft shot down';
      }
      results.rolls.push({ roll, total, defTotal, success: false, outcome, attacker: 'aircraft' });
    }
    // Enemy anti-air units (warships, SAM batteries) covering the target engage
    // the plane — free, reactive fire.
    if (a.hp > 0) {
      const guns = flakCells.flatMap(c => c.units).filter(u => u.owner !== p && UNITS[u.type].aa);
      for (const g of guns) {
        if (1 + Math.floor(game.rng() * 6) + UNITS[g.type].aa > FLAK_EVASION) {
          a.hp--; flakHits++;
          if (a.hp <= 0) { removeAircraft(from, a); downedByFlak++; break; }
        }
      }
    }
  }
  const wins = results.rolls.filter(r => r.success).length;
  let line = `${game.players[p].name} launched an air strike: ${wins}/${results.rolls.length} hits.`;
  if (downedByFlak) line += ` 🎯 Anti-air fire downed ${downedByFlak} aircraft!`;
  else if (flakHits) line += ` Anti-air fire hit the attackers.`;
  log(game, line);
  recordFx(game, {
    kind: 'air', from: key(from.q, from.r), to: key(to.q, to.r), attacker: p,
    shots: results.rolls.length, hits: wins, sorties: planes.length,
    flak: flakGuns.length
      ? { cells: flakGuns.map(c => key(c.q, c.r)), hits: flakHits, downed: downedByFlak }
      : null,
  });
  return results;
}

// Relocate ready aircraft from one base to another (own air base, or own
// carrier with deck space) within range. Costs 1 action.
export function airMove(game, from, to, p) {
  if (hexDistance(from, to) > AIR_RANGE) return 'out of aircraft range';
  let planes = aircraftAt(from, p).filter(a => a.actions > 0);
  if (!planes.length) return 'no aircraft ready';
  let moved = 0;
  if (to.terrain !== 'sea') {
    if (to.owner !== p || to.upgrade !== 'airbase') return 'needs your air base';
    for (const a of planes) {
      if (to.units.length >= MAX_UNITS_PER_HEX) break;
      removeAircraft(from, a);
      a.actions--;
      to.units.push(a);
      moved++;
    }
  } else {
    const carriers = to.units.filter(u => u.owner === p && u.type === 'carrier');
    if (!carriers.length) return 'needs your carrier';
    for (const a of planes) {
      const c = carriers.find(c => c.cargo.length < UNITS.carrier.capacity);
      if (!c) break;
      removeAircraft(from, a);
      a.actions--;
      c.cargo.push(a);
      moved++;
    }
  }
  if (!moved) return 'no room at the destination';
  log(game, `${game.players[p].name} redeployed ${moved} aircraft.`);
  return null;
}

// Coordinated assault: ground/naval attack if adjacent, plus air strike if in
// range. One drag, every eligible arm fires.
export function attackAll(game, from, to, p) {
  const parts = [];
  if (isAdjacent(from, to)) parts.push(attackHex(game, from, to, p));
  if (enemyUnits(to, p).length && aircraftAt(from, p).some(a => a.actions > 0)) {
    parts.push(airStrike(game, from, to, p));
  }
  const rolls = parts.flatMap(r => r.rolls ?? []);
  if (rolls.length) return { rolls, error: null };
  return { rolls: [], error: parts.map(r => r.error).find(Boolean) ?? 'nothing to attack' };
}

// ---------- Transports ----------

function freeSlots(t) {
  return UNITS.transport.capacity - t.cargo.reduce((s, c) => s + CARGO_SLOTS[c.type], 0);
}

export function transportSpace(cell, p) {
  return cell.units
    .filter(u => u.owner === p && u.type === 'transport')
    .reduce((s, t) => s + freeSlots(t), 0);
}

// Load p's land units from `land` onto p's transports in adjacent `sea`.
export function embark(game, land, sea, p) {
  if (!isAdjacent(land, sea) || sea.terrain !== 'sea') return 'invalid';
  const transports = sea.units.filter(u => u.owner === p && u.type === 'transport');
  if (!transports.length) return 'no transport there';
  // Infantry first: they pack tighter.
  const movers = ownUnits(land, p)
    .filter(u => UNITS[u.type].domain === 'land' && u.actions > 0)
    .sort((a, b) => CARGO_SLOTS[a.type] - CARGO_SLOTS[b.type]);
  let loaded = 0;
  for (const u of movers) {
    const t = transports.find(t => freeSlots(t) >= CARGO_SLOTS[u.type]);
    if (!t) continue;
    land.units.splice(land.units.indexOf(u), 1);
    u.actions--;
    t.cargo.push(u);
    loaded++;
  }
  if (!loaded) return 'no room aboard';
  log(game, `${game.players[p].name} embarked ${loaded} unit(s).`);
  return null;
}

export function cargoCount(cell, p) {
  return cell.units
    .filter(u => u.owner === p && u.type === 'transport')
    .reduce((s, t) => s + t.cargo.length, 0);
}

// Unload all cargo from p's transports in `sea` onto adjacent `land`.
export function disembark(game, sea, land, p) {
  if (!isAdjacent(sea, land) || land.terrain === 'sea') return 'invalid';
  if (blockingUnits(land, p).length) return 'landing zone is defended — clear it first';
  const transports = sea.units.filter(u => u.owner === p && u.type === 'transport' && u.cargo.length);
  let unloaded = 0;
  for (const t of transports) {
    while (t.cargo.length && land.units.length < MAX_UNITS_PER_HEX) {
      const u = t.cargo.pop();
      u.actions = Math.max(0, u.actions - 1);
      land.units.push(u);
      unloaded++;
    }
  }
  if (!unloaded) return 'nothing to unload';
  captureCell(game, land, p);
  log(game, `${game.players[p].name} landed ${unloaded} unit(s).`);
  return null;
}

// ---------- Elimination / victory / surrender ----------

// Production buildings whose loss decides the game. Farms (pure economy) and bare
// land don't count: a player is finished once every one of these is captured or razed.
export const MILITARY_BUILDINGS = ['barracks', 'factory', 'port', 'airbase'];

export function militaryBuildingCount(game, p) {
  let n = 0;
  for (const cell of game.cells.values()) {
    if (cell.owner === p && MILITARY_BUILDINGS.includes(cell.upgrade)) n++;
  }
  return n;
}

// `by` is the player who took the last production building, if any. They inherit
// the fallen power's remaining land and forces; with no conqueror (e.g. a player
// razing their own last building) the remnants simply scatter.
export function checkElimination(game, p, by = null) {
  if (p === null || p === undefined) return;
  const pl = game.players[p];
  if (!pl.alive || militaryBuildingCount(game, p) > 0) return;
  pl.alive = false;
  const heir = (by !== null && by !== undefined && by !== p && game.players[by].alive) ? by : null;
  for (const cell of game.cells.values()) {
    if (cell.owner === p) cell.owner = heir;        // heir === null => neutral land
    if (heir === null) {
      cell.units = cell.units.filter(u => u.owner !== p);
      for (const u of cell.units) if (u.cargo) u.cargo = u.cargo.filter(c => c.owner !== p);
    } else {
      // Defectors change flags where they stand; they can't act again this turn.
      for (const u of cell.units) {
        if (u.owner === p) { u.owner = heir; u.actions = 0; }
        for (const c of u.cargo ?? []) if (c.owner === p) { c.owner = heir; c.actions = 0; }
      }
    }
  }
  log(game, heir === null
    ? `☠️ ${pl.name} has been eliminated!`
    : `☠️ ${pl.name} has fallen — their remaining land and forces defect to ${game.players[heir].name}!`);
}

export function winner(game) {
  const alive = game.players.filter(pl => pl.alive);
  return alive.length === 1 ? alive[0] : null;
}

// Surrendering player cedes units to `to`; their land becomes unowned (contested).
export function surrender(game, p, to) {
  const pl = game.players[p];
  pl.alive = false;
  for (const cell of game.cells.values()) {
    if (cell.owner === p) cell.owner = null;
    for (const u of cell.units) {
      if (u.owner === p) u.owner = to;
      for (const c of u.cargo ?? []) if (c.owner === p) c.owner = to;
    }
  }
  log(game, `🏳️ ${pl.name} surrendered, ceding their military to ${game.players[to].name}.`);
}
