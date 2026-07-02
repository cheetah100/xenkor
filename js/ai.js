// NPC turn logic: economic build-up, then expansion and assault.
// Implemented as a generator yielding after each visible action, so the UI
// can animate NPC turns at human speed. aiTurn() drains it for headless use.

import { key, neighbors, hexDistance } from './hex.js';
import {
  UNITS, UPGRADES, MAX_UNITS_PER_HEX, AIR_RANGE, MILITARY_BUILDINGS,
  build, canBuild, recruit, canRecruit, attackHex, moveStack, defenseOf,
  enemyUnits, blockingUnits, ownUnits, isCoastal, domainOf,
  reachable, pathTo, embark, disembark, airStrike, airMove, aircraftAt,
  flakCover, flakHitChance,
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

// Balanced temperament for players without one (the human, when tests drive
// them with the same AI). See the ROSTER in game.js for what each knob skews.
const DEFAULT_TRAITS = { aggression: 1, mechs: 1, air: 1, navy: 1, forts: 1, horde: 1, flank: 1 };

function traitsOf(game, p) {
  return game.players[p].traits ?? DEFAULT_TRAITS;
}

function armyCapOf(game, p, nCells) {
  return Math.floor((15 + nCells / 3) * traitsOf(game, p).horde);
}

// The single enemy production building the whole war effort converges on. One
// objective at a time wins local superiority and opens a breach; spreading
// along the entire front just razes as fast as the enemy rebuilds, and the war
// never ends. Prefer near AND soft: the nearest building is usually the shared
// chokepoint fortress, which replenishes its garrison in place faster than
// dice can clear it — go around and breach where the wall is thin.
function objectiveField(game, p) {
  const fromMine = landDistanceField(game, c => c.owner === p);
  const T = traitsOf(game, p);
  let objective = null, bs = Infinity;
  for (const c of game.cells.values()) {
    if (c.owner === null || c.owner === p || !game.players[c.owner].alive) continue;
    if (!MILITARY_BUILDINGS.includes(c.upgrade)) continue;
    const d = fromMine.get(key(c.q, c.r)) ?? Infinity;
    // flank low: straight at the nearest building, walls be damned.
    // flank high: swing wide for whatever is weakly held.
    const score = d + T.flank * (2 * defenseOf(game, c, p) + enemyUnits(c, p).length);
    if (score < bs) { bs = score; objective = c; }
  }
  return objective && landDistanceField(game, c => c === objective);
}

function* aiBuild(game, p, distEnemy) {
  const pl = game.players[p];
  const mine = ownedCells(game, p);
  const T = traitsOf(game, p);
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

  // Air power once the empire can afford it: air bases stocked with aircraft,
  // scaling with the empire — a rich late-game power fields a real air force.
  const airbases = mine.filter(c => c.upgrade === 'airbase');
  const wantAirbases = Math.round((1 + Math.floor(mine.length / 20)) * T.air);
  if (airbases.length < wantAirbases && mine.length >= Math.round(15 / T.air) &&
      pl.money >= 40 + 60 + reserve) {
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

  // Air defense: once a rival visibly flies planes (airbase on the map, planes
  // parked or at sea on a deck — all public information), screen the empire
  // with SAM batteries. They muster at a factory and guard it, or march out
  // with a field army as its anti-air umbrella.
  const rivalAir = [...game.cells.values()].some(c =>
    (c.owner !== null && c.owner !== p && game.players[c.owner].alive && c.upgrade === 'airbase') ||
    c.units.some(u => u.owner !== p && game.players[u.owner].alive &&
      (u.type === 'aircraft' || (u.type === 'carrier' && u.cargo.length > 0))));
  if (rivalAir && pl.money >= 30 + reserve) {
    const sams = [...game.cells.values()]
      .flatMap(c => c.units).filter(u => u.owner === p && u.type === 'sam').length;
    if (sams < Math.round(Math.min(3, 1 + Math.floor(mine.length / 12)) * T.forts)) {
      const fac = mine.find(c => c.upgrade === 'factory' && c.units.length < MAX_UNITS_PER_HEX);
      if (fac && !recruit(game, fac, 'sam', p)) yield 'recruit';
    }
  }

  // Fortify near the front: mountains always pay; a real turtle walls up its
  // production buildings too, while a warlord barely bothers at all.
  if (pl.money >= 20 + reserve) {
    const near = c => (distEnemy.get(key(c.q, c.r)) ?? 99) <= 3 * T.forts;
    const spot = mine.find(c => !c.fort && near(c) &&
      (c.terrain === 'mountains' || (T.forts >= 1.5 && MILITARY_BUILDINGS.includes(c.upgrade))));
    if (spot && !build(game, spot, 'fort', p)) yield 'build';
  }

  // Spend the rest on troops at the frontline — but keep the army proportional
  // to the empire, or every hex saturates and the war can never be decided.
  // Mechs are exempt up to their own quota: they're the siege-breakers (attack
  // 3, and their hits raze), and an infantry horde without them can never crack
  // a fortified front — that's how wars used to stall forever.
  const myUnits = [...game.cells.values()].flatMap(c => c.units.filter(u => u.owner === p));
  let mechs = myUnits.filter(u => u.type === 'mech').length;
  const wantMechs = Math.max(2, Math.floor((mine.length / 6) * T.mechs));
  const full = myUnits.length >= armyCapOf(game, p, mine.length);
  if (full && mechs >= wantMechs) return;
  // Troops can only be raised at military buildings now: mechs at factories,
  // infantry at barracks. Factories first, then spend forward, closest to the
  // enemy. At the army cap, only factories keep producing (mechs to quota).
  const prod = mine
    .filter(c => (c.upgrade === 'barracks' || c.upgrade === 'factory') && c.units.length < MAX_UNITS_PER_HEX)
    .filter(c => !full || c.upgrade === 'factory')
    .sort((a, b) =>
      (b.upgrade === 'factory') - (a.upgrade === 'factory') ||
      (distEnemy.get(key(a.q, a.r)) ?? 99) - (distEnemy.get(key(b.q, b.r)) ?? 99));
  let guard = 24;
  while (pl.money >= 10 && prod.length && guard--) {
    const cell = prod[0];
    if (cell.units.length >= MAX_UNITS_PER_HEX) { prod.shift(); continue; }
    const type = cell.upgrade === 'factory' ? 'mech' : 'basic';
    if (type === 'mech' && (pl.money < 40 + reserve || (full && mechs >= wantMechs))) {
      prod.shift();
      continue;
    }
    if (recruit(game, cell, type, p)) prod.shift(); // can't recruit here right now
    else { if (type === 'mech') mechs++; yield 'recruit'; }
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

// What one successful air hit on this hex is worth: razing its improvement
// outright, or damage to whichever defender soaks it. Production buildings
// score a premium — destroying them is how wars actually end.
function airHitValue(cell, p) {
  if (cell.upgrade) {
    return UPGRADES[cell.upgrade].cost + (MILITARY_BUILDINGS.includes(cell.upgrade) ? 15 : 0);
  }
  return Math.max(...enemyUnits(cell, p).map(u => UNITS[u.type].cost / UNITS[u.type].hp));
}

// Net expected value of one sortie against `t`: expected damage minus expected
// aircraft attrition (a missed strike costs 1 hp, and every covering anti-air
// gun gets a shot). The same arithmetic a player does by eye — a lone SAM
// deters strikes on worthless hexes, but is worth eating losses over when a
// factory sits under its umbrella.
function strikeValue(game, p, t) {
  const def = defenseOf(game, t, p);
  const pHit = Math.max(0, Math.min(1, (6 + UNITS.aircraft.atk - def) / 6));
  const hpValue = UNITS.aircraft.cost / UNITS.aircraft.hp;
  const expectedLoss = (1 - pHit) +
    flakCover(game, t, p).guns.reduce((s, g) => s + flakHitChance(g), 0);
  return pHit * airHitValue(t, p) - expectedLoss * hpValue;
}

// Air strikes: hit the best-value target in range, paying attrition only when
// the prize justifies it. Late in the war the bar drops so air power keeps
// pressing instead of going passive.
function* aiAir(game, p) {
  const bases = [...game.cells.values()]
    .filter(c => aircraftAt(c, p).some(a => a.actions > 0));
  // The bar drops as the war drags: a long stalemate means the remaining
  // targets are hard ones, and grinding a fortified wall down from the air
  // beats letting the air force sit out the siege. An air-minded power gets
  // there sooner.
  const T = traitsOf(game, p);
  const floor = game.turn > 60 / T.air ? -12 : game.turn > 30 / T.air ? -5 : 0;
  for (const base of bases) {
    let guard = 8;
    while (guard--) {
      if (!aircraftAt(base, p).some(a => a.actions > 0)) break;
      let best = null, bv = floor;
      for (const c of game.cells.values()) {
        if (!enemyUnits(c, p).length || hexDistance(base, c) > AIR_RANGE) continue;
        const v = strikeValue(game, p, c);
        if (v > bv) { bv = v; best = c; }
      }
      if (!best) break;
      if (airStrike(game, base, best, p).error) break;
      yield 'airstrike';
    }
  }
}

// Amphibious operations: the spec's answer to land chokepoint stalemates.
function* aiNaval(game, p) {
  const pl = game.players[p];
  const mine = ownedCells(game, p);
  const T = traitsOf(game, p);
  const port = mine.find(c => c.upgrade === 'port');
  if (!port) return;

  const seaStacks = [...game.cells.values()]
    .filter(c => c.terrain === 'sea' && ownUnits(c, p).length);
  const myNavy = seaStacks.flatMap(c => ownUnits(c, p));
  const transports = myNavy.filter(u => u.type === 'transport');
  const warships = myNavy.filter(u => u.type === 'warship');

  // Build an invasion fleet once the treasury allows — a seafaring power
  // starts sooner and floats more of everything.
  const wantShips = Math.round(2 * T.navy);
  if (pl.money >= 150 / T.navy) {
    if (transports.length < wantShips && !recruit(game, port, 'transport', p)) yield 'recruit';
    if (warships.length < wantShips && !recruit(game, port, 'warship', p)) yield 'recruit';
    // Marines mustered at the port, embarked next turn — but under the same
    // army cap as land recruiting, or the port inflates the horde forever.
    const armySize = [...game.cells.values()]
      .reduce((s, c) => s + c.units.filter(u => u.owner === p).length, 0);
    let guard = 3;
    while (guard-- && pl.money >= 60 && port.units.length < MAX_UNITS_PER_HEX &&
           armySize + (3 - guard) <= armyCapOf(game, p, mine.length) &&
           !canRecruit(game, port, 'basic', p)) {
      if (!recruit(game, port, 'basic', p)) yield 'recruit';
    }
  }

  // Carriers, once rich and flying planes: mobile air bases to project power
  // over the sea instead of funnelling everything through the land bridges.
  const carriers = myNavy.filter(u => u.type === 'carrier');
  if (pl.money >= 200 / T.navy && carriers.length < Math.max(1, Math.round(T.navy)) &&
      mine.some(c => c.upgrade === 'airbase')) {
    if (!recruit(game, port, 'carrier', p)) yield 'recruit';
  }

  // Fly ready aircraft out to any carrier with deck space in range.
  for (const sc of seaStacks) {
    const deckSpace = ownUnits(sc, p).some(u =>
      u.type === 'carrier' && u.cargo.length < UNITS.carrier.capacity);
    if (!deckSpace) continue;
    const src = mine.find(c => c.upgrade === 'airbase' &&
      hexDistance(c, sc) <= AIR_RANGE &&
      aircraftAt(c, p).some(a => a.actions > 0));
    if (src && !airMove(game, src, sc, p)) yield 'airlift';
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

  // Sail carrier groups toward an enemy coast until their air wing covers it
  // (planes range 6; holding a couple of hexes off keeps the deck harder to hit).
  for (let sc of [...game.cells.values()].filter(c =>
    c.terrain === 'sea' && ownUnits(c, p).some(u => u.type === 'carrier' && u.cargo.length))) {
    let guard = 4;
    while (guard--) {
      const here = seaDist.get(key(sc.q, sc.r)) ?? Infinity;
      if (here <= 2) break;
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

function* aiMoveAttack(game, p, distTarget, distThreat) {
  const T = traitsOf(game, p);
  const stacks = [...game.cells.values()]
    .filter(c => domainOf(c) === 'land' && ownUnits(c, p).some(u => u.actions > 0 && UNITS[u.type].domain === 'land'));

  for (let cell of stacks) {
    let guard = 24;
    while (guard--) {
      const movers = ownUnits(cell, p).filter(u => u.actions > 0 && UNITS[u.type].domain === 'land');
      if (!movers.length) break;

      // Attack an adjacent defended hex if the odds are tolerable. Production
      // buildings come first: capturing or razing them is what ends the war.
      const targets = neighbors(game.cells, cell)
        .filter(n => n.terrain !== 'sea' && blockingUnits(n, p).length)
        .sort((a, b) =>
          MILITARY_BUILDINGS.includes(b.upgrade) - MILITARY_BUILDINGS.includes(a.upgrade) ||
          defenseOf(game, a, p) - defenseOf(game, b, p));
      if (targets.length) {
        const t = targets[0];
        const bestAtk = Math.max(...movers.map(u => UNITS[u.type].atk));
        const chance = Math.max(0, 6 + bestAtk - defenseOf(game, t, p)) / 6;
        const outnumber = movers.length >= 2 * enemyUnits(t, p).length;
        // A production building is worth pressing at any odds (a mech hit razes
        // it outright); grow bolder as the game drags on, so sieges break
        // instead of stalling into a frozen front. Temperament sets the bar:
        // a warlord attacks at odds a turtle would never take.
        const valuable = MILITARY_BUILDINGS.includes(t.upgrade);
        const desperate = game.turn > 30 / T.aggression && chance > 0 &&
          movers.length >= enemyUnits(t, p).length;
        if (chance >= 0.34 / T.aggression ||
            ((outnumber || valuable || game.turn > 50 / T.aggression) && chance > 0) ||
            desperate) {
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

      // Garrison: a small stack on one of our production buildings stands its
      // ground while enemy troops are close — losing every building is losing
      // the game, and recruits spawning here keep the post manned. A full field
      // army marches regardless; parking it would freeze the whole offensive.
      if (cell.owner === p && MILITARY_BUILDINGS.includes(cell.upgrade) &&
          movers.length <= 3 && (distThreat.get(key(cell.q, cell.r)) ?? 99) <= 4) {
        break;
      }

      // Otherwise advance one hex toward the objective. Any room counts:
      // moveStack spills as many units forward as fit and leaves the rest, so
      // a column keeps flowing instead of gridlocking behind its own full stacks.
      const here = distTarget.get(key(cell.q, cell.r)) ?? 99;
      const options = neighbors(game.cells, cell)
        .filter(n => n.terrain !== 'sea' && !blockingUnits(n, p).length &&
          n.units.length < MAX_UNITS_PER_HEX)
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
  // Early on, expand into anything unowned; once the map is carved up, converge
  // the whole army on one enemy production building at a time — the objective
  // that actually ends the war — instead of smearing along the entire front.
  const march = (game.turn > 25 ? objectiveField(game, p) : null)
    ?? landDistanceField(game, c => c.owner !== p);
  // Threat field for garrisons: distance to enemy *troops*, not enemy-coloured
  // land — a border post with no army in sight has nothing to garrison against.
  const distThreat = landDistanceField(game, c =>
    c.units.some(u => u.owner !== p && game.players[u.owner].alive &&
      UNITS[u.type].domain === 'land'));
  yield* aiBuild(game, p, distEnemy);
  yield* aiAir(game, p);
  yield* aiNaval(game, p);
  yield* aiMoveAttack(game, p, march, distThreat);
}

export function aiTurn(game, p) {
  for (const _ of aiTurnGen(game, p)) { /* drain */ }
}
