// Combat animation + sound. Camera zooms onto the fight, planes fly to their
// targets, hits flash and shake, and short synthesized sounds play. All purely
// presentational — driven by the combat events rules.js records in game.fx.

import { cellCenter, draw } from './render.js';

export const fx = { animations: true, sound: true };

// ---------- sound (WebAudio, no asset files) ----------

let actx = null;
function audio() {
  if (!fx.sound) return null;
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return null; }
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function tone(type, f0, f1, dur, gain = 0.2) {
  const ac = audio();
  if (!ac) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, ac.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), ac.currentTime + dur);
  g.gain.setValueAtTime(gain, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  o.connect(g).connect(ac.destination);
  o.start();
  o.stop(ac.currentTime + dur);
}

function noise(dur, gain = 0.25, hp = 400) {
  const ac = audio();
  if (!ac) return;
  const n = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(ac.destination);
  src.start();
}

const sfx = {
  boom() { tone('triangle', 140, 40, 0.35, 0.3); noise(0.3, 0.3, 250); },
  gun() { for (let i = 0; i < 3; i++) setTimeout(() => noise(0.07, 0.2, 800), i * 70); },
  plane() { tone('sawtooth', 220, 180, 0.5, 0.08); },
  splash() { noise(0.4, 0.22, 500); tone('sine', 300, 120, 0.3, 0.12); },
  miss() { noise(0.05, 0.1, 1200); },
};

// ---------- animation ----------

// ~60fps frame loop. setTimeout (not requestAnimationFrame) so it also advances
// in headless/background tabs, which keeps NPC turns moving and lets tests run.
const FRAME = 16;
const raf = (ms, onFrame) => new Promise(res => {
  const start = Date.now();
  (function step() {
    const t = Math.min(1, (Date.now() - start) / ms);
    onFrame(t);
    if (t < 1) setTimeout(step, FRAME); else res();
  })();
});

const lerp = (a, b, t) => a + (b - a) * t;

// Play one combat event. Returns a promise that resolves when it's done.
// `redraw` repaints the map with the current view (camera + effects).
export async function playCombat(canvas, game, view, ev, speed = 1) {
  const from = game.cells.get(ev.from);
  const to = game.cells.get(ev.to);
  if (!from || !to) return;
  if (!fx.animations) { // sound only, no camera work
    if (ev.hits) (ev.kind === 'air' ? sfx.boom : sfx.gun)(); else sfx.miss();
    return;
  }
  const a = cellCenter(from);
  const b = cellCenter(to);
  const focus = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const redraw = () => draw(canvas, game, view);
  const Z = 2.4;
  const D = ms => Math.max(60, ms / speed);

  // Start camera centred on the map, then zoom toward the fight.
  view.camera = { scale: 1, x: canvas.width / 2, y: canvas.height / 2, shake: 0 };
  view.effects = [];
  await raf(D(260), t => {
    view.camera.scale = lerp(1, Z, t);
    view.camera.x = lerp(canvas.width / 2, focus.x, t);
    view.camera.y = lerp(canvas.height / 2, focus.y, t);
    redraw();
  });

  if (ev.kind === 'air') {
    sfx.plane();
    const planes = Math.min(3, ev.sorties || 1);
    const fxPlanes = Array.from({ length: planes }, (_, i) => ({
      type: 'plane', x1: a.x, y1: a.y, x2: b.x, y2: b.y, t: 0, delay: i * 0.12,
    }));
    view.effects = fxPlanes;
    await raf(D(560), t => {
      for (const p of fxPlanes) p.t = Math.max(0, Math.min(1, (t - p.delay) / (1 - p.delay)));
      redraw();
    });
  } else {
    sfx.gun();
    view.effects = [{ type: 'tracer', x1: a.x, y1: a.y, x2: b.x, y2: b.y, t: 0, hit: ev.hits > 0 }];
    await raf(D(360), t => { view.effects[0].t = t; redraw(); });
  }

  // Impact.
  if (ev.hits > 0) {
    if (to.terrain === 'sea') sfx.splash(); else sfx.boom();
  } else {
    sfx.miss();
  }
  view.effects = [{ type: 'blast', x: b.x, y: b.y, t: 0, hit: ev.hits > 0 }];
  await raf(D(380), t => {
    view.effects[0].t = t;
    view.camera.shake = ev.hits > 0 ? (1 - t) * 7 : 0;
    redraw();
  });

  // Zoom back out.
  view.effects = [];
  view.camera.shake = 0;
  await raf(D(220), t => {
    view.camera.scale = lerp(Z, 1, t);
    view.camera.x = lerp(focus.x, canvas.width / 2, t);
    view.camera.y = lerp(focus.y, canvas.height / 2, t);
    redraw();
  });
  view.camera = null;
  view.effects = [];
  redraw();
}
