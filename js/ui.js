// DOM + input handling for the human player.
// Click = select/inspect only. Move, attack, embark, land and airlift are all
// drag-and-drop, so nothing happens by accident.

import { key, isAdjacent } from './hex.js';
import {
  UNITS, UPGRADES, FORT, TERRAIN,
  reachable, pathTo, moveStack, attackAll, canAttack, build, canBuild,
  recruit, canRecruit, embark, disembark, transportSpace, cargoCount,
  airMove, aircraftAt,
  ownUnits, playerIncome, cellCount, domainOf,
  startTurn, winner, surrender,
} from './rules.js';
import { aiTurnGen } from './ai.js';
import { initCanvas, pickHex, eventToCanvas, draw } from './render.js';
import { createGame } from './game.js';

const $ = id => document.getElementById(id);
const HUMAN = 0;

let game;
let view = { sel: null, reach: null, parents: null, attackable: null, drag: null };
let busy = false; // true while NPCs are taking their turns
let pendingDrag = null;

export function boot() {
  game = createGame();
  initCanvas($('map'), game);
  const map = $('map');
  map.addEventListener('mousedown', onMouseDown);
  map.addEventListener('mousemove', onMouseMove);
  map.addEventListener('mouseup', onMouseUp);
  map.addEventListener('mouseleave', cancelDrag);
  $('end-turn').addEventListener('click', endTurn);
  $('surrender').addEventListener('click', surrenderDialog);
  $('new-game').addEventListener('click', newGame);
  refresh();
  // Debug/test hook.
  window.__xenkor = {
    get game() { return game; },
    get view() { return view; },
    get busy() { return busy; },
  };
}

function newGame() {
  game = createGame();
  initCanvas($('map'), game);
  deselect();
  $('overlay').classList.add('hidden');
  refresh();
}

function deselect() {
  view = { sel: null, reach: null, parents: null, attackable: null, drag: null };
}

// Where can the stack on `cell` go / strike? Attack range includes any hex
// aircraft based here can reach, so the whole map is scanned.
function combatMaps(cell) {
  const { dists, parents } = reachable(game, cell, HUMAN);
  const attackable = new Set();
  for (const c of game.cells.values()) {
    if (canAttack(game, cell, c, HUMAN)) attackable.add(key(c.q, c.r));
  }
  return { reach: dists, parents, attackable };
}

function select(k) {
  view = { sel: k, reach: null, parents: null, attackable: null, drag: null };
  const cell = game.cells.get(k);
  if (canDragFrom(cell)) Object.assign(view, combatMaps(cell));
}

// ---------- drag & drop ----------

function canDragFrom(cell) {
  return ownUnits(cell, HUMAN).some(u => u.actions > 0) ||
    aircraftAt(cell, HUMAN).some(a => a.actions > 0);
}

function onMouseDown(ev) {
  if (busy || game.over || ev.button !== 0) return;
  const k = pickHex($('map'), game, ev);
  pendingDrag = k ? { from: k, x: ev.clientX, y: ev.clientY } : null;
}

function onMouseMove(ev) {
  if (!pendingDrag) return;
  if (!view.drag) {
    const moved = Math.hypot(ev.clientX - pendingDrag.x, ev.clientY - pendingDrag.y);
    if (moved < 6) return;
    const from = game.cells.get(pendingDrag.from);
    if (!canDragFrom(from)) { pendingDrag = null; return; }
    const maps = combatMaps(from);
    view = {
      sel: pendingDrag.from,
      reach: maps.reach, parents: maps.parents, attackable: maps.attackable,
      drag: { from: pendingDrag.from, active: true, point: { x: 0, y: 0 }, cur: null },
    };
  }
  view.drag.point = eventToCanvas($('map'), ev);
  view.drag.cur = pickHex($('map'), game, ev);
  draw($('map'), game, view);
}

function onMouseUp(ev) {
  if (view.drag?.active) {
    const fromK = view.drag.from;
    const toK = pickHex($('map'), game, ev);
    const maps = { reach: view.reach, parents: view.parents, attackable: view.attackable };
    view.drag = null;
    pendingDrag = null;
    resolveDrop(fromK, toK, maps);
    return;
  }
  pendingDrag = null;
  if (busy || game.over) return;
  const k = pickHex($('map'), game, ev);
  if (k) select(k); else deselect();
  refresh();
}

function cancelDrag() {
  pendingDrag = null;
  if (view.drag) {
    view.drag = null;
    refresh();
  }
}

function resolveDrop(fromK, toK, maps) {
  if (!toK || toK === fromK) { select(fromK); refresh(); return; }
  const from = game.cells.get(fromK);
  const to = game.cells.get(toK);
  const adj = isAdjacent(from, to);

  // Hostile target: every eligible arm fires (ground, bombardment, air).
  if (maps.attackable.has(toK)) {
    const res = attackAll(game, from, to, HUMAN);
    if (res.error) toast(res.error);
    else logRolls(res);
    afterAction(fromK);
    return;
  }

  // Friendly/neutral target: do everything that applies in one drag.
  const planesReady = aircraftAt(from, HUMAN).some(a => a.actions > 0);
  const airDest = (to.terrain !== 'sea' && to.owner === HUMAN && to.upgrade === 'airbase') ||
    (to.terrain === 'sea' && to.units.some(u => u.owner === HUMAN && u.type === 'carrier'));
  let acted = 0;
  let lastErr = null;

  if (planesReady && airDest) {
    const err = airMove(game, from, to, HUMAN);
    if (err) lastErr = err; else acted++;
  }
  if (adj && domainOf(from) === 'land' && to.terrain === 'sea' &&
      transportSpace(to, HUMAN) > 0) {
    const err = embark(game, from, to, HUMAN);
    if (err) lastErr = err; else acted++;
  }
  if (adj && from.terrain === 'sea' && to.terrain !== 'sea' && cargoCount(from, HUMAN) > 0) {
    const err = disembark(game, from, to, HUMAN);
    if (err) lastErr = err; else acted++;
  }
  if (!acted && maps.reach.has(toK)) {
    const err = moveStack(game, from, pathTo(maps.parents, fromK, toK), HUMAN);
    if (err) lastErr = err; else acted++;
  }

  if (!acted) {
    toast(lastErr ?? 'cannot move there');
    select(fromK);
    refresh();
    return;
  }
  afterAction(toK);
}

function afterAction(reselect) {
  checkGameOver();
  if (!game.over && reselect) select(reselect);
  else deselect();
  refresh();
}

function logRolls(res) {
  for (const r of res.rolls) {
    const line = `🎲 ${r.roll}+${UNITS[r.attacker].atk} = ${r.total} vs def ${r.defTotal} — ${r.outcome}`;
    game.log.push({ turn: game.turn, msg: line });
  }
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- turn sequencing ----------

async function endTurn() {
  if (busy || game.over) return;
  busy = true;
  deselect();
  refresh();
  for (let p = 1; p < game.players.length; p++) {
    if (!game.players[p].alive) continue;
    game.current = p;
    refresh();
    await sleep(350);
    startTurn(game, p);
    let steps = 0;
    for (const _ of aiTurnGen(game, p)) {
      steps++;
      refresh();
      if (checkGameOver()) { finishTurnLoop(); return; }
      // Human speed for the first moves, then accelerate so big turns stay snappy.
      await sleep(steps < 40 ? 120 : 30);
    }
    if (checkGameOver()) { finishTurnLoop(); return; }
  }
  game.current = 0;
  game.turn++;
  if (game.players[HUMAN].alive) startTurn(game, HUMAN);
  busy = false;
  refresh();
}

function finishTurnLoop() {
  game.current = 0;
  busy = false;
  refresh();
}

function checkGameOver() {
  const w = winner(game);
  if (!game.players[HUMAN].alive) {
    gameOver(false);
    return true;
  }
  if (w) {
    gameOver(w.id === HUMAN);
    return true;
  }
  return false;
}

function gameOver(won) {
  game.over = true;
  const ov = $('overlay');
  ov.classList.remove('hidden');
  ov.innerHTML = `
    <div class="modal">
      <h1>${won ? '🏆 Victory!' : '💀 Defeat'}</h1>
      <p>${won ? 'You are the last power standing.' : 'Your empire has fallen.'}</p>
      <button id="overlay-new">New Game</button>
    </div>`;
  $('overlay-new').addEventListener('click', newGame);
}

function surrenderDialog() {
  if (busy || game.over) return;
  const ov = $('overlay');
  const npcs = game.players.filter(p => !p.isHuman && p.alive);
  ov.classList.remove('hidden');
  ov.innerHTML = `
    <div class="modal">
      <h1>🏳️ Surrender</h1>
      <p>Cede your military units to which power?</p>
      <div id="cede-buttons">
        ${npcs.map(p => `<button data-p="${p.id}" style="background:${p.color}">${p.name}</button>`).join('')}
      </div>
      <button id="cancel-surrender">Cancel</button>
    </div>`;
  $('cancel-surrender').addEventListener('click', () => ov.classList.add('hidden'));
  for (const btn of ov.querySelectorAll('#cede-buttons button')) {
    btn.addEventListener('click', () => {
      surrender(game, HUMAN, Number(btn.dataset.p));
      gameOver(false);
      refresh();
    });
  }
}

// ---------- panels ----------

function refresh() {
  draw($('map'), game, view);
  const me = game.players[HUMAN];
  $('stats').textContent =
    `Turn ${game.turn}  ·  💰 ${me.money}  ·  +${playerIncome(game, HUMAN)}/turn`;
  renderPlayers();
  renderActions();
  renderHexInfo();
  renderLog();
  $('end-turn').disabled = busy || game.over;
}

function renderPlayers() {
  $('players').innerHTML = '<h3>Powers</h3>' + game.players.map(p => {
    const cells = cellCount(game, p.id);
    const cls = p.alive ? '' : ' class="dead"';
    const turnMark = busy && game.current === p.id ? ' ◀ playing' : '';
    return `<div${cls}><span class="dot" style="background:${p.color}"></span>` +
      `${p.name} — ${p.alive ? cells + ' hexes' : 'eliminated'}${turnMark}</div>`;
  }).join('');
}

// The action grid always shows every button in the same place; they only
// enable/disable, so nothing jumps around as you buy things.
function renderActions() {
  const act = $('actions');
  const cell = view.sel ? game.cells.get(view.sel) : null;
  const usable = cell && cell.owner === HUMAN && cell.terrain !== 'sea' && !busy && !game.over;
  const blocked = 'select one of your land hexes';

  let html = '<h3>Build</h3><div class="btn-grid">';
  for (const [what, b] of [...Object.entries(UPGRADES), ['fort', { ...FORT, emoji: '🧱' }]]) {
    const err = usable ? canBuild(game, cell, what, HUMAN) : blocked;
    html += `<button class="bbtn" data-build="${what}" ${err ? `disabled title="${err}"` : ''}>` +
      `${b.emoji} ${b.name}<span class="cost">${b.cost}</span></button>`;
  }
  html += '</div><h3>Recruit</h3><div class="btn-grid">';
  for (const [type, u] of Object.entries(UNITS)) {
    const err = usable ? canRecruit(game, cell, type, HUMAN) : blocked;
    html += `<button class="bbtn" data-recruit="${type}" ${err ? `disabled title="${err}"` : ''}>` +
      `${u.emoji} ${u.name}<span class="cost">${u.cost}</span></button>`;
  }
  html += '</div>';
  act.innerHTML = html;

  if (!usable) return;
  for (const btn of act.querySelectorAll('[data-build]')) {
    btn.addEventListener('click', () => {
      const err = build(game, cell, btn.dataset.build, HUMAN);
      if (err) toast(err);
      select(view.sel);
      refresh();
    });
  }
  for (const btn of act.querySelectorAll('[data-recruit]')) {
    btn.addEventListener('click', () => {
      const err = recruit(game, cell, btn.dataset.recruit, HUMAN);
      if (err) toast(err);
      select(view.sel);
      refresh();
    });
  }
}

function renderHexInfo() {
  const box = $('hexinfo');
  if (!view.sel) {
    box.innerHTML = '<h3>Hex</h3><p class="hint">Click a hex to select it. ' +
      'Drag a stack to move (white hexes) or attack (red rings — aircraft strike up to 6 hexes out). ' +
      'Drag onto an adjacent transport to embark, from a loaded fleet onto a shore to land, ' +
      'or drag aircraft to another air base or carrier to redeploy them.</p>';
    return;
  }
  const cell = game.cells.get(view.sel);
  const t = TERRAIN[cell.terrain];
  const ownerName = cell.terrain === 'sea' ? '—'
    : cell.owner === null ? 'Unclaimed'
    : `<span class="dot" style="background:${game.players[cell.owner].color}"></span>${game.players[cell.owner].name}`;
  let html = `<h3>${cell.terrain[0].toUpperCase() + cell.terrain.slice(1)}</h3>
    <p>Owner: ${ownerName}<br>Defense: ${t.defense + (cell.fort ? 3 : 0)} · Income: ${t.income}</p>`;
  const tags = [];
  if (cell.upgrade) tags.push(`${UPGRADES[cell.upgrade].emoji} ${UPGRADES[cell.upgrade].name}`);
  if (cell.fort) tags.push('🧱 fortified');
  if (tags.length) html += `<p>${tags.join(' · ')}</p>`;

  if (cell.units.length) {
    html += '<ul class="units">' + cell.units.map(u => {
      const d = UNITS[u.type];
      const cargo = u.cargo?.length ? ` (cargo: ${u.cargo.map(c => UNITS[c.type].emoji).join('')})` : '';
      return `<li><span class="dot" style="background:${game.players[u.owner].color}"></span>` +
        `${d.emoji} ${d.name} · ${u.hp}/${d.hp} hp · ${u.actions} act${cargo}</li>`;
    }).join('') + '</ul>';
  }
  box.innerHTML = html;
}

function renderLog() {
  const el = $('log');
  el.innerHTML = '<h3>Log</h3>' +
    game.log.slice(-40).map(l => `<div><b>T${l.turn}</b> ${l.msg}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}
