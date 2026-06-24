// NPC turn logic: economic build-up, then expansion and assault.
// Implemented as a generator yielding after each visible action, so the UI
// can animate NPC turns at human speed. aiTurn() drains it for headless use.

import { key, neighbors, hexDistance } from './hex.js';
import {
  UNITS, MAX_UNITS_PER_HEX, AIR_RANGE,
  build, canBuild, recruit, canRecruit, attackHex, moveStack, defenseOf,
  enemyUnits, blockingUnits, ownUnits, isCoastal, domainOf,
  reachable, pathTo, embark, disembark, airStrike, aircraftAt,
} from './rules.js';

// Multi-source BFS over land from every cell matching `isSource`.
function landDistanceField(game, isSource) {
  const dist = new Map();
  let frontier = [];
  for (const cell of game.cells.values()) {
    if (cell.terrain !== 'sea' && isSource(cell)) {
      dist.set(key(cell.q, cell.r), 0);
      frontier.push(cell);
    }
  }
  let d = 1;
  while (frontier.length) {
    const next = [];
    for (const cell of frontier) {
      for (const n of neighbors(game.cells, cell)) {
        const k = key(n.q, n.r);
        if (n.terrain === 'sea' || dist.has(k)) continue;
        dist.set(k, d);
        next.push(n);
      }
    }
    frontier = next;
    d++;
  }
  return dist;
}

function ownedCells(game, p) {
  return [...game.cells.values()].filter(c => c.owner === p);
}

function* aiBuild(game, p, distEnemy) {
  const pl = game.players[p];
  const mine = ownedCells(game, p);
  const reserve = 15;

  // Farms on farmland are the best payback in the game.
  for (const cell of mine) {
    if (cell.terrain !== 'farmland' || cell.upgrade) continue;
    if (pl.money - 10 < reserve) break;
    if (!build(game, cell, 'farm', p)) yield 'build';
  }

  // Barracks field infantry (as factories field mechs). Without one the army
  // can't grow, so the first barracks is an early priority; add more with size.
  const wantBarracks = 1 + Math.floor(mine.length / 8);
  if (mine.filter(c => c.upgrade === 'barracks').length < wantBarracks && pl.money >= 30 + reserve) {
    const spot = mine
      .filter(c => !c.upgrade && (distEnemy.get(key(c.q, c.r)) ?? 99) >= 2)
      .sort((a, b) => (distEnemy.get(key(a.q, a.r)) ?? 99) - (distEnemy.get(key(b.q, b.r)) ?? 99))[0]
      ?? mine.find(c => !c.upgrade);
    if (spot && !build(game, spot, 'barracks', p)) yield 'build';
  }

  // One factory early, more as the empire grows.
  const factories = mine.filter(c => c.upgrade === 'factory').length;
  const wantFactories = 1 + Math.floor(mine.length / 18);
  if (factories < wantFactories && pl.money >= 50 + reserve) {
    const safe = mine
      .filter(c => !c.upgrade && (distEnemy.get(key(c.q, c.r)) ?? 99) >= 3)
      .sort((a, b) => (distEnemy.get(key(b.q, b.r)) ?? 99) - (distEnemy.get(key(a.q, a.r)) ?? 99))[0];
    if (safe && !build(game, safe, 'factory', p)) yield 'build';
  }

  // A port to mount amphibious invasions once the economy is moving.
  const hasPort = mine.some(c => c.upgrade === 'port');
  if (!hasPort && pl.money >= 30 + reserve && game.turn > 5) {
    const coastal = mine.find(c => isCoastal(game, c) && !canBuild(game, c, 'port', p));
    if (coastal && !build(game, coastal, 'port', p)) yield 'build';
  }

  // Air power once the empire can afford it: an air base stocked with aircraft.
  const airbases = mine.filter(c => c.upgrade === 'airbase');
  if (!airbases.length && mine.length >= 15 && pl.money >= 40 + 60 + reserve) {
    const safe = mine
      .filter(c => !c.upgrade && (distEnemy.get(key(c.q, c.r)) ?? 99) >= 3)
      .sort((a, b) => (distEnemy.get(key(a.q, a.r)) ?? 99) - (distEnemy.get(key(b.q, b.r)) ?? 99))[0];
    if (safe && !build(game, safe, 'airbase', p)) yield 'build';
  }
  for (const ab of mine.filter(c => c.upgrade === 'airbase')) {
    let guard = 3;
    while (guard-- && aircraftAt(ab, p).length < 3 && pl.money >= 30 + reserve) {
      if (recruit(game, ab, 'aircraft', p)) break;
      yield 'recruit';
    }
  }

  // Fortify mountains near the front.
  if (pl.money >= 20 + reserve) {
    const spot = mine.find(c =>
      c.terrain === 'mountains' && !c.fort && (distEnemy.get(key(c.q, c.r)) ?? 99) <= 3);
    if (spot && !build(game, spot, 'fort', p)) yield 'build';
  }

  // Spend the rest on troops at the frontline — but keep the army proportional
  // to the empire, or every hex saturates and the war can never be decided.
  const armySize = [...game.cells.values()]
    .reduce((s, c) => s + c.units.filter(u => u.owner === p).length, 0);
  const armyCap = 15 + Math.floor(mine.length / 3);
  if (armySize >= armyCap) return;
  // Troops can only be raised at military buildings now: mechs at factories,
  // infantry at barracks. Spend forward — fill the cells closest to the enemy.
  const prod = mine
    .filter(c => (c.upgrade === 'barracks' || c.upgrade === 'factory') && c.units.length < MAX_UNITS_PER_HEX)
    .sort((a, b) => (distEnemy.get(key(a.q, a.r)) ?? 99) - (distEnemy.get(key(b.q, b.r)) ?? 99));
  let guard = 24;
  while (pl.money >= 10 && prod.length && guard--) {
    const cell = prod[0];
    if (cell.units.length >= MAX_UNITS_PER_HEX) { prod.shift(); continue; }
    const type = cell.upgrade === 'factory' ? 'mech' : 'basic';
    if (type === 'mech' && pl.money < 40 + reserve) { prod.shift(); continue; }
    if (recruit(game, cell, type, p)) prod.shift(); // can't recruit here right now
    else yield 'recruit';                            // recruited; keep filling this cell
  }
}

// BFS over sea from every sea hex adjacent to enemy coast.
function seaDistanceField(game, isTargetLand) {
  const dist = new Map();
  let frontier = [];
  for (const cell of game.cells.values()) {
    if (cell.terrain !== 'sea') continue;
    if (neighbors(game.cells, cell).some(n => n.terrain !== 'sea' && isTargetLand(n))) {
      dist.set(key(cell.q, cell.r), 0);
      frontier.push(cell);
    }
  }
  let d = 1;
  while (frontier.length) {
    const next = [];
    for (const cell of frontier) {
      for (const n of neighbors(game.cells, cell)) {
        const k = key(n.q, n.r);
        if (n.terrain !== 'sea' || dist.has(k)) continue;
        dist.set(k, d);
        next.push(n);
      }
    }
    frontier = next;
    d++;
  }
  return dist;
}

// Air strikes: soften the most weakly defended enemy hex in range.
function* aiAir(game, p) {
  const bases = [...game.cells.values()]
    .filter(c => aircraftAt(c, p).some(a => a.actions > 0));
  for (const base of bases) {
    let guard = 6;
    while (guard--) {
      const planes = aircraftAt(base, p).filter(a => a.actions > 0);
      if (!planes.length) break;
      let best = null, bd = Infinity;
      for (const c of game.cells.values()) {
        if (!enemyUnits(c, p).length || hexDistance(base, c) > AIR_RANGE) continue;
        const d = defenseOf(game, c, p);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best) break;
      const chance = Math.max(0, 6 + UNITS.aircraft.atk - bd) / 6;
      if (chance <= 0 || (chance < 0.34 && game.turn <= 30)) break;
      if (airStrike(game, base, best, p).error) break;
      yield 'airstrike';
    }
  }
}

// Amphibious operations: the spec's answer to land chokepoint stalemates.
function* aiNaval(game, p) {
  const pl = game.players[p];
  const mine = ownedCells(game, p);
  const port = mine.find(c => c.upgrade === 'port');
  if (!port) return;

  const seaStacks = [...game.cells.values()]
    .filter(c => c.terrain === 'sea' && ownUnits(c, p).length);
  const myNavy = seaStacks.flatMap(c => ownUnits(c, p));
  const transports = myNavy.filter(u => u.type === 'transport');
  const warships = myNavy.filter(u => u.type === 'warship');

  // Build an invasion fleet once the treasury allows.
  if (pl.money >= 150) {
    if (transports.length < 2 && !recruit(game, port, 'transport', p)) yield 'recruit';
    if (warships.length < 2 && !recruit(game, port, 'warship', p)) yield 'recruit';
    // Marines mustered at the port, embarked next turn.
    let guard = 3;
    while (guard-- && pl.money >= 60 && port.units.length < MAX_UNITS_PER_HEX &&
           !canRecruit(game, port, 'basic', p)) {
      if (!recruit(game, port, 'basic', p)) yield 'recruit';
    }
  }

  // Sail toward any enemy coast; land only where it is undefended,
  // bombarding defenders with warships when needed.
  const isEnemyCoast = c => c.owner !== null && c.owner !== p && game.players[c.owner].alive;
  const isLandingZone = c => isEnemyCoast(c) && !blockingUnits(c, p).length &&
    c.units.length < MAX_UNITS_PER_HEX;
  const seaDist = seaDistanceField(game, isEnemyCoast);

  for (let sc of seaStacks) {
    const transportsHere = ownUnits(sc, p).filter(u => u.type === 'transport');
    if (!transportsHere.length) continue;
    const loaded = transportsHere.some(t => t.cargo.length);

    if (!loaded) {
      // Pick up troops from an adjacent friendly shore.
      const src = neighbors(game.cells, sc)
        .filter(n => n.terrain !== 'sea' && n.owner === p &&
          ownUnits(n, p).some(u => UNITS[u.type].domain === 'land' && u.actions > 0))
        .sort((a, b) => ownUnits(b, p).length - ownUnits(a, p).length)[0];
      if (src && !embark(game, src, sc, p)) yield 'embark';
      continue;
    }

    // Loaded: land at a beachhead, bombard a defended one, or sail closer.
    let guard = 4;
    while (guard--) {
      const zone = neighbors(game.cells, sc).find(n => n.terrain !== 'sea' && isLandingZone(n));
      if (zone) {
        if (!disembark(game, sc, zone, p)) yield 'land';
        break;
      }
      const defended = neighbors(game.cells, sc)
        .find(n => n.terrain !== 'sea' && isEnemyCoast(n) && blockingUnits(n, p).length);
      if (defended && ownUnits(sc, p).some(u => u.type === 'warship' && u.actions > 0)) {
        const res = attackHex(game, sc, defended, p);
        if (!res.error) yield 'bombard';
        if (res.error) break;
        continue;
      }
      const here = seaDist.get(key(sc.q, sc.r)) ?? Infinity;
      const { dists, parents } = reachable(game, sc, p);
      let best = null, bd = here;
      for (const k of dists.keys()) {
        const sd = seaDist.get(k);
        if (sd !== undefined && sd < bd) { bd = sd; best = k; }
      }
      if (!best) break;
      const path = pathTo(parents, key(sc.q, sc.r), best);
      if (!path || moveStack(game, sc, path, p)) break;
      sc = game.cells.get(best);
      yield 'sail';
    }
  }
}

function* aiMoveAttack(game, p, distTarget) {
  const stacks = [...game.cells.values()]
    .filter(c => domainOf(c) === 'land' && ownUnits(c, p).some(u => u.actions > 0 && UNITS[u.type].domain === 'land'));

  for (let cell of stacks) {
    let guard = 24;
    while (guard--) {
      const movers = ownUnits(cell, p).filter(u => u.actions > 0 && UNITS[u.type].domain === 'land');
      if (!movers.length) break;

      // Attack an adjacent defended hex if the odds are tolerable.
      const targets = neighbors(game.cells, cell)
        .filter(n => n.terrain !== 'sea' && blockingUnits(n, p).length)
        .sort((a, b) => defenseOf(game, a, p) - defenseOf(game, b, p));
      if (targets.length) {
        const t = targets[0];
        const bestAtk = Math.max(...movers.map(u => UNITS[u.type].atk));
        const chance = Math.max(0, 6 + bestAtk - defenseOf(game, t, p)) / 6;
        const outnumber = movers.length >= 2 * enemyUnits(t, p).length;
        // Grow bolder as the game drags on, so sieges break instead of stalling.
        const desperate = game.turn > 30 && chance > 0 && movers.length >= enemyUnits(t, p).length;
        if (chance >= 0.34 || (outnumber && chance > 0) || desperate) {
          const res = attackHex(game, cell, t, p);
          if (res.error) break;
          yield 'attack';
          // If cleared, walk in.
          if (!blockingUnits(t, p).length) {
            if (!moveStack(game, cell, [key(t.q, t.r)], p)) {
              cell = t;
              yield 'move';
            }
          }
          continue;
        }
        break; // hold position rather than suicide
      }

      // Otherwise advance one hex toward the nearest enemy or neutral land.
      const here = distTarget.get(key(cell.q, cell.r)) ?? 99;
      const options = neighbors(game.cells, cell)
        .filter(n => n.terrain !== 'sea' && !blockingUnits(n, p).length &&
          n.units.length + movers.length <= MAX_UNITS_PER_HEX)
        .sort((a, b) => (distTarget.get(key(a.q, a.r)) ?? 99) - (distTarget.get(key(b.q, b.r)) ?? 99));
      const step = options[0];
      if (!step || (distTarget.get(key(step.q, step.r)) ?? 99) >= here) break;
      if (moveStack(game, cell, [key(step.q, step.r)], p)) break;
      cell = step;
      yield 'move';
    }
  }
}

export function* aiTurnGen(game, p) {
  if (!game.players[p].alive) return;
  const distEnemy = landDistanceField(game, c =>
    c.owner !== null && c.owner !== p && game.players[c.owner].alive);
  const distTarget = landDistanceField(game, c => c.owner !== p);
  yield* aiBuild(game, p, distEnemy);
  yield* aiAir(game, p);
  yield* aiNaval(game, p);
  yield* aiMoveAttack(game, p, distTarget);
}

export function aiTurn(game, p) {
  for (const _ of aiTurnGen(game, p)) { /* drain */ }
}
