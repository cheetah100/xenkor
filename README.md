# Xenkor

A turn-based hex strategy game in the browser — you against four NPC powers.
Base rules are in [xenkor-spec.md](xenkor-spec.md); see "House rules" below for
where the implementation has since evolved past the spec.

## Run

No build step, no dependencies. Serve the folder and open it:

```sh
npm start            # python3 -m http.server 8000
# then open http://localhost:8000
```

(Any static file server works; ES modules just need to be served over HTTP.)

## How to play

- **Click** a hex to select and inspect it. Clicking never moves units.
- **Drag** a stack to act — everything is explicit drag-and-drop:
  - onto a white-highlighted hex to **move** (capturing land along the way)
  - onto a red-ringed hex to **attack** (1d6 + attack vs terrain + fort + unit
    defense, per unit action) — aircraft join in up to 6 hexes out
  - onto an adjacent sea hex holding your transport to **embark**
  - from a loaded fleet onto a shore to **land**
  - from an air base or carrier to another of yours to **redeploy aircraft**
- **Build / recruit** with the sidebar buttons when one of your land hexes is
  selected. Mechanised units need a factory; naval units need a port;
  aircraft need an air base.
- **End Turn** lets the four NPCs play out their moves at watchable speed.
  Combat is animated — the camera zooms in on each fight, aircraft fly to their
  targets, hits flash and shake the screen, with synthesized battle sounds.
  Toggle **🎬 FX** and **🔊 Sound** in the header (FX off = sound only and
  instant turns). Last power holding territory wins. You can also surrender and
  choose which NPC inherits your army.

## House rules (changes from the original spec)

- **One upgrade per cell**: farm | factory | port | air base. A cell's upgrade
  can be replaced later by paying the new upgrade's full cost. Fortification
  is separate and stacks with the upgrade.
- **Aircraft** (cost 30) are housed at air bases and strike any enemy hex
  within **range 6** — they don't move hex by hex. Failed strikes cost the
  aircraft hp: planes are lost to flak. Aircraft caught on the ground when a
  hex is captured change flags. Parked aircraft can't hold ground: enemies can
  walk in past them.
- **Carriers** (cost 60, port-built) are mobile air bases: slower than a
  warship (3 actions vs 5), deck space for 3 aircraft, which strike and
  redeploy exactly as from a land base. A sunk carrier takes its planes down.
- **Warships can bombard** adjacent land hexes, destroying defenders, but can
  never capture or enter land.

## Code layout

| File | Role |
|------|------|
| [js/rules.js](js/rules.js) | All game mechanics (UI-free) |
| [js/mapgen.js](js/mapgen.js) | Procedural continents, land bridges, terrain |
| [js/ai.js](js/ai.js) | NPC economy, offensives, amphibious invasions (step generator for animation) |
| [js/game.js](js/game.js) | Game construction, seeded RNG, turn start |
| [js/render.js](js/render.js) | Canvas drawing, camera zoom, combat effects |
| [js/anim.js](js/anim.js) | Combat animation sequencing + WebAudio sounds |
| [js/ui.js](js/ui.js) | Drag-and-drop input, panels, turn sequencing |

Combat is decoupled from animation: `rules.js` records each fight as an event
in `game.fx` (from/to/kind/hits); the UI drains that queue and plays each one.

## Tests

```sh
npm test             # headless rules/AI simulation (full AI-vs-AI games)
```

Browser tests — serve the repo and open the page, then read the console:

- `test/auto.html` — UI smoke test (drag-to-move/attack, build, recruit, turns); `AUTOTEST` lines.
- `test/anim.html` — combat animation checks (zoom, plane flight, blast, shake); `ANIM` lines.
