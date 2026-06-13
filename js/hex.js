// Axial coordinate hex math (pointy-top).

export const SQRT3 = Math.sqrt(3);

export const DIRS = [
  [1, 0], [1, -1], [0, -1],
  [-1, 0], [-1, 1], [0, 1],
];

export function key(q, r) {
  return q + ',' + r;
}

export function* axialRange(R) {
  for (let q = -R; q <= R; q++) {
    const lo = Math.max(-R, -q - R);
    const hi = Math.min(R, -q + R);
    for (let r = lo; r <= hi; r++) yield [q, r];
  }
}

export function hexDistance(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function neighbors(cells, cell) {
  const out = [];
  for (const [dq, dr] of DIRS) {
    const c = cells.get(key(cell.q + dq, cell.r + dr));
    if (c) out.push(c);
  }
  return out;
}

export function isAdjacent(a, b) {
  return hexDistance(a, b) === 1;
}

function hexRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}

export function hexLine(a, b) {
  const N = hexDistance(a, b);
  const out = [];
  for (let i = 0; i <= N; i++) {
    const t = N ? i / N : 0;
    out.push(hexRound(a.q + (b.q - a.q) * t, a.r + (b.r - a.r) * t));
  }
  return out;
}

// Pointy-top pixel conversion.
export function toPixel(q, r, size) {
  return {
    x: size * (SQRT3 * q + (SQRT3 / 2) * r),
    y: size * 1.5 * r,
  };
}

export function fromPixel(x, y, size) {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, r);
}
