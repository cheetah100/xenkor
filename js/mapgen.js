// Procedural map: continents grown from seeds, land bridges, terrain patches.

import { key, axialRange, hexDistance, neighbors, hexLine } from './hex.js';

function blankCell(q, r) {
  return { q, r, terrain: 'sea', owner: null, upgrade: null, fort: false, units: [] };
}

function farthestPoints(pool, n, rng) {
  const picked = [pool[Math.floor(rng() * pool.length)]];
  while (picked.length < n) {
    let best = null, bd = -1;
    for (const c of pool) {
      const d = Math.min(...picked.map(s => hexDistance(c, s)));
      if (d > bd) { bd = d; best = c; }
    }
    picked.push(best);
  }
  return picked;
}

function growContinent(cells, seed, idx, target, rng) {
  seed.terrain = 'farmland';
  seed.continent = idx;
  const blob = [seed];
  for (let n = 1; n < target; n++) {
    const frontier = [];
    for (const c of blob) {
      for (const nb of neighbors(cells, c)) {
        if (nb.terrain !== 'sea' || nb.continent !== undefined) continue;
        // Keep at least one sea hex between continents.
        if (neighbors(cells, nb).some(x => x.continent !== undefined && x.continent !== idx)) continue;
        frontier.push(nb);
      }
    }
    if (!frontier.length) break;
    const pick = frontier[Math.floor(rng() * frontier.length)];
    pick.terrain = 'farmland';
    pick.continent = idx;
    blob.push(pick);
  }
  return blob;
}

// Connect all continents with narrow desert land bridges (spanning tree).
function buildBridges(cells, groups) {
  const connected = new Set([0]);
  while (connected.size < groups.length) {
    let best = { d: Infinity };
    for (const i of connected) {
      for (let j = 0; j < groups.length; j++) {
        if (connected.has(j)) continue;
        for (const a of groups[i]) {
          for (const b of groups[j]) {
            const d = hexDistance(a, b);
            if (d < best.d) best = { d, a, b, j };
          }
        }
      }
    }
    for (const [q, r] of hexLine(best.a, best.b)) {
      const c = cells.get(key(q, r));
      if (c && c.terrain === 'sea') {
        c.terrain = 'desert';
        c.bridge = true;
      }
    }
    connected.add(best.j);
  }
}

function growPatch(cells, group, terrain, size, rng) {
  const candidates = group.filter(c => c.terrain === 'farmland');
  if (!candidates.length) return;
  const seed = candidates[Math.floor(rng() * candidates.length)];
  const patch = [seed];
  seed.terrain = terrain;
  for (let n = 1; n < size; n++) {
    const frontier = [];
    for (const c of patch) {
      for (const nb of neighbors(cells, c)) {
        if (nb.continent === c.continent && nb.terrain === 'farmland') frontier.push(nb);
      }
    }
    if (!frontier.length) break;
    const pick = frontier[Math.floor(rng() * frontier.length)];
    pick.terrain = terrain;
    patch.push(pick);
  }
}

export function generateMap(rng, { radius = 12, continents = 4, players = 5 } = {}) {
  const cells = new Map();
  for (const [q, r] of axialRange(radius)) cells.set(key(q, r), blankCell(q, r));
  const all = [...cells.values()];

  const seeds = farthestPoints(all, continents, rng);
  const target = Math.floor((all.length * 0.55) / continents);
  const groups = seeds.map((s, i) => growContinent(cells, s, i, target, rng));

  buildBridges(cells, groups);

  for (const g of groups) {
    growPatch(cells, g, 'mountains', Math.max(4, Math.floor(g.length * 0.20)), rng);
    growPatch(cells, g, 'mountains', Math.max(3, Math.floor(g.length * 0.08)), rng);
    growPatch(cells, g, 'desert', Math.max(3, Math.floor(g.length * 0.10)), rng);
  }

  // Starting positions: well separated, on farmland where possible.
  const land = all.filter(c => c.terrain !== 'sea' && !c.bridge);
  let starts = farthestPoints(land, players, rng);
  starts = starts.map(s => {
    if (s.terrain === 'farmland') return s;
    const swap = neighbors(cells, s).find(n => n.terrain === 'farmland');
    return swap ?? s;
  });

  return { cells, starts };
}
