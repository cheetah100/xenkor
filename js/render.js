// Canvas rendering of the map.

import { toPixel, fromPixel, key } from './hex.js';
import { UPGRADES } from './rules.js';

export const HEX_SIZE = 24;
const TERRAIN_COLORS = {
  farmland: '#6f9f4e',
  mountains: '#8d8073',
  desert: '#d6bd7d',
  sea: '#33608f',
};

let offsetX = 0, offsetY = 0;

export function getOffset() {
  return { offsetX, offsetY };
}

export function initCanvas(canvas, game) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of game.cells.values()) {
    const { x, y } = toPixel(c.q, c.r, HEX_SIZE);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pad = HEX_SIZE * 1.5;
  offsetX = -minX + pad;
  offsetY = -minY + pad;
  canvas.width = Math.ceil(maxX - minX + pad * 2);
  canvas.height = Math.ceil(maxY - minY + pad * 2);
}

// Event coords -> canvas-space pixel coords.
export function eventToCanvas(canvas, ev) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((ev.clientX - rect.left) * canvas.width) / rect.width,
    y: ((ev.clientY - rect.top) * canvas.height) / rect.height,
  };
}

export function pickHex(canvas, game, ev) {
  const { x, y } = eventToCanvas(canvas, ev);
  const [q, r] = fromPixel(x - offsetX, y - offsetY, HEX_SIZE);
  const k = key(q, r);
  return game.cells.has(k) ? k : null;
}

export function cellCenter(cell) {
  const { x, y } = toPixel(cell.q, cell.r, HEX_SIZE);
  return { x: x + offsetX, y: y + offsetY };
}

function hexPath(ctx, cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 180) * (60 * i - 30);
    const x = cx + size * Math.cos(ang);
    const y = cy + size * Math.sin(ang);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function mix(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
  const ch = sh => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export function draw(canvas, game, view) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b2a3a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const cell of game.cells.values()) {
    const { x: cx, y: cy } = cellCenter(cell);
    const k = key(cell.q, cell.r);

    // Terrain, tinted toward the owner's colour across the whole cell.
    let fill = TERRAIN_COLORS[cell.terrain];
    if (cell.owner !== null) fill = mix(fill, game.players[cell.owner].color, 0.45);
    hexPath(ctx, cx, cy, HEX_SIZE - 0.6);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = '#00000033';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Fortification: a stone wall ringing the cell.
    if (cell.fort) {
      hexPath(ctx, cx, cy, HEX_SIZE - 3);
      ctx.strokeStyle = '#bfb29a';
      ctx.lineWidth = 4;
      ctx.stroke();
      hexPath(ctx, cx, cy, HEX_SIZE - 3);
      ctx.strokeStyle = '#5f5443';
      ctx.lineWidth = 4;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (view.reach?.has(k)) {
      hexPath(ctx, cx, cy, HEX_SIZE - 0.6);
      ctx.fillStyle = '#ffffff2e';
      ctx.fill();
    }
    if (view.attackable?.has(k)) {
      hexPath(ctx, cx, cy, HEX_SIZE - 3);
      ctx.strokeStyle = '#ff1744';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (view.sel === k) {
      hexPath(ctx, cx, cy, HEX_SIZE - 1.5);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Terrain marker
    if (cell.terrain === 'mountains') {
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#00000055';
      ctx.fillText('▲▲', cx, cy + (cell.upgrade ? 8 : 0));
    }

    if (cell.upgrade) {
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(UPGRADES[cell.upgrade].emoji, cx, cy - 7);
    }

    // Unit badges, grouped by owner (hexes can briefly hold two flags).
    const byOwner = new Map();
    for (const u of cell.units) byOwner.set(u.owner, (byOwner.get(u.owner) ?? 0) + 1);
    let bi = 0;
    for (const [owner, count] of byOwner) {
      const bx = cx + (bi === 0 ? 0 : 13) - (byOwner.size > 1 ? 7 : 0);
      const by = cy + 9;
      ctx.beginPath();
      ctx.arc(bx, by, 8, 0, Math.PI * 2);
      ctx.fillStyle = game.players[owner].color;
      ctx.fill();
      ctx.strokeStyle = '#000000cc';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(String(count), bx, by + 0.5);
      bi++;
    }
  }

  // Drag arrow.
  if (view.drag?.active) {
    const from = game.cells.get(view.drag.from);
    const { x: x1, y: y1 } = cellCenter(from);
    const { x: x2, y: y2 } = view.drag.point;
    const hostile = view.drag.cur && view.attackable?.has(view.drag.cur);
    ctx.strokeStyle = ctx.fillStyle = hostile ? '#ff1744' : '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 12 * Math.cos(ang - 0.4), y2 - 12 * Math.sin(ang - 0.4));
    ctx.lineTo(x2 - 12 * Math.cos(ang + 0.4), y2 - 12 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
  }
}
