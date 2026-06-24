# Xenkor — Game Specification

## Overview

Xenkor is a turn-based hex strategy game for up to 5 players (1 human + 4 NPC initially). Players expand across a procedurally generated map, building economies and military forces, competing for territorial dominance. The last player with cells on the board wins.

> This document describes the rules as implemented. Where it once differed from
> the code, the code is now authoritative and this spec has been updated to match.

---

## The Map

### Hex Grid
The board consists of large hexagonal cells of two primary types: **Land** and **Sea**.

### Terrain Types
| Terrain | Base Income | Base Defense | Farm yield |
|---------|------------|-------------|------------|
| Farmland | 1 | 1 | +3 |
| Mountains | 1 | 3 | +1 |
| Desert | 0 | 0 | — (no farms) |
| Sea | 0 | 0 | — |

Unimproved land earns only a small trickle; the real economy comes from farms and
factories built on it (see **Economy**). Terrain also sets a hex's base defense and
how much a farm built on it yields.

### Map Generation
- Maps are procedurally generated with coherent landmasses (continents) separated by seas
- Continents are connected by land bridges — narrow hex connections forming natural chokepoints
- Terrain is distributed across continents: farmland, mountains, and desert

### Starting Positions
- Each player begins with three basic combat units on a single starting hex, which already holds a **barracks** so infantry can be raised from turn 1
- Starting positions are distributed across the map to ensure reasonable separation
- Each player starts with **25** money

---

## Economy

### Income
Unimproved land earns a small trickle so a player can never be locked out of
recovering; **farms and factories are the real economy**, stacking on top of the
land's base. Every turn, each player earns income from the land, improvements, and
economic units they control:

| Source | Income/Turn |
|--------|-------------|
| Farmland / mountain hex (base) | 1 |
| Desert hex (base) | 0 |
| Farm on farmland | +3 (4 total) |
| Farm on mountains | +1 (2 total) |
| Factory | +5 (on top of the land base) |

### Maximum Hex Income
Because a hex holds at most one upgrade (see **Static Assets**), the most a single
hex can earn is:
- Factory on farmland/mountains = base 1 + **5** = **6/turn**
- Farm on farmland = base 1 + **3** = **4/turn**

A factory yields the most raw income per hex and is required for mechanised units;
a farm on farmland has the fastest payback.

---

## Static Assets

Static assets are built on land hexes and can be **captured** by enemy military units, changing ownership rather than being destroyed — with one exception: **mechanised units and aircraft can raze a hex's improvement** outright (see **Razing Improvements** under Combat). Fortifications are captured, never razed.

### One Upgrade Per Cell
A land hex holds **at most one upgrade**: a farm, barracks, factory, port, or air
base. A **farm** is the only upgradeable improvement: it can be replaced by any
other upgrade later (paying the new upgrade's full cost; the old farm is
discarded). Every other improvement is **terminal** — to change a barracks,
factory, port, or air base you must **raze** it first, which guards against
accidentally overwriting a military building. A **fortification** is separate and
stacks with the upgrade.

### Farms
- Built on farmland or mountain hexes only (not desert)
- Earns income each turn based on terrain type (farmland +3, mountains +1, on top of the land's base)

### Barracks
- Lets a hex **build infantry** (basic combat units) — as does a port (for marines)
- Can be built on any land hex

### Factories
- Earns +5 income per turn
- **Required** to build mechanised combat units and SAM batteries
- Can be built on any land hex

### Fortifications
- Maximum **1 fortification per hex**
- Adds **+3 defense** to the hex (stacks with terrain defense and any upgrade)
- Can be built on any land hex

### Ports
- Built on coastal hexes (land hexes adjacent to sea)
- Enables production of naval units: transports, warships, carriers
- Also musters **infantry** (marines) directly, like a barracks — so a coastal assault force can be raised at the water's edge

### Air Bases
- Can be built on any land hex
- **Required** to build aircraft; houses and rearms them between strikes

### Scorched Earth
- A player may **raze their own improvement** to deny it to an advancing enemy
- Only allowed on a hex you still own **and have at least one unit standing on** — you can't torch ground you've already lost or abandoned
- Costs nothing and the hex stays yours; the improvement is simply destroyed (fortifications are not affected)

---

## Defense Values

| Terrain | Base | + Fortification |
|---------|------|-----------------|
| Farmland | 1 | 4 |
| Mountains | 3 | 6 |
| Desert | 0 | 3 |
| Sea | 0 | — |

A fortified mountain hex (defense 6) is the most defensible position in the game.
The strongest **defending unit** in a hex adds its defense modifier on top (see
**Combat**).

---

## Military Units

Each unit has hit points (HP), an attack modifier, a defense modifier, and a number
of actions per turn.

### Land Units

| Unit | Cost | Actions | HP | Atk | Def | Notes |
|------|------|---------|----|-----|-----|-------|
| Infantry (basic) | 10 | 3 | 2 | 1 | 1 | Built at a barracks or port |
| Mechanised | 40 | 5 | 4 | 3 | 2 | Requires a factory to build |
| SAM battery | 30 | 2 | 2 | 0 | 1 | Anti-air (no ground attack); requires a factory |

### Naval Units

| Unit | Cost | Actions | HP | Atk | Def | Notes |
|------|------|---------|----|-----|-----|-------|
| Warship | 35 | 5 | 3 | 3 | 2 | Combat unit; protects fleet; bombards shore; anti-air |
| Carrier | 60 | 3 | 3 | 0 | 1 | Mobile air base; deck space for 3 aircraft |
| Transport | 20 | 3 | 2 | 0 | 0 | Carries land units; capturable |

### Air Units

| Unit | Cost | Actions | HP | Atk | Def | Notes |
|------|------|---------|----|-----|-----|-------|
| Aircraft | 30 | 2 | 2 | 3 | 0 | Based at an air base or carrier; strikes within range 6 |

### Stacking
- Maximum **9 military units per hex** (land or sea)
- A hex can contain mixed unit types within the 9-unit cap

### Transport / Carrier Capacity
- 1 transport carries either **3 infantry** or **1 mechanised unit** (3 cargo slots)
- 1 carrier carries **3 aircraft**

---

## Build Costs

### Buildings
| Building | Cost |
|----------|------|
| Farm | 10 |
| Barracks | 30 |
| Factory | 50 |
| Fortification | 20 |
| Port | 30 |
| Air base | 40 |

### Payback Periods (income buildings)
| Asset | Cost | Income/Turn | Payback |
|-------|------|-------------|---------|
| Farm (farmland) | 10 | 3 | ~3 turns |
| Farm (mountains) | 10 | 1 | 10 turns |
| Factory | 50 | 5 | 10 turns |

---

## Combat

### Resolution
Combat is resolved with dice and modifiers:

- **Attacker rolls** 1d6 + the attacking unit's attack modifier
- Must **exceed** the defender's defense total (terrain + fortification + strongest defending unit's defense modifier)
- **Success**: the hex takes 1 hit
- **Failure**: the attacker takes 1 hit (loses HP; destroyed at 0)

### Actions
Each turn, military units spend actions on **movement** or **attacks** in any combination (see the unit tables for actions per turn). A unit's actions refresh at the start of its owner's turn.

Moving into most hexes costs **1 action**, but entering a **mountain** hex costs **2** — the rough terrain that makes mountains so defensible also slows advances through them. Reachable-move highlighting accounts for this double cost.

### Hit Allocation
A hit landed on a hex is absorbed in a fixed order so warships screen the fleet:
**warship → carrier → mechanised → infantry → aircraft → transport.**
Each hit costs 1 HP; a unit reduced to 0 HP is destroyed/sunk or captured (see below).

### Land Combat
- Units attack adjacent hexes
- Multiple friendly units can attack the same hex in one turn (coordinated assault)
- Attackers must fight through defending military units before capturing static assets

### Naval Combat
- Naval units engage using the same dice system as land combat
- Sea hexes have no terrain defense modifier — combat is purely unit vs unit
- A hex containing both warships and transports: **warships must be cleared before transports can be captured**

### Air Strikes
- Aircraft strike **any enemy hex within range 6** of their base — they do not move hex by hex
- A failed strike costs the aircraft 1 HP: planes are lost to flak
- Aircraft **sink** ships but can never board or capture
- Aircraft can join an adjacent ground/naval assault in the same action (coordinated)

### Anti-Air (Warships & SAM Batteries)
- A **warship** (at sea) or a **SAM battery** (on land) automatically engages aircraft striking **any hex within one of it** — its own hex or an adjacent one — so it shields the units and assets around it
- Each covering unit fires once per incoming sortie: it hits on **1d6 + its anti-air rating beating 6** (warship rating 3 ≈ a coin flip; SAM rating 4 ≈ two-in-three), and a hit costs the plane 1 HP — two hits down it
- Anti-air is **free and reactive** (it costs the firing unit no actions) and fires in addition to the target's own flak; stacking anti-air units makes their airspace deadly to aircraft
- A **SAM battery** is a dedicated air-defense unit: built at a factory like a mechanised unit, it has **no ground attack** of its own and is fragile, so it needs other units to protect it from being overrun

### Shore Bombardment
- Warships may **bombard** an adjacent land hex, destroying defenders
- Bombardment can never capture or board, and warships can never enter land

### Razing Improvements
- A successful hit from a **mechanised unit** (ground assault) or an **aircraft** (air strike) can **raze the target hex's improvement** — farm, factory, barracks, port, or air base — destroying it outright
- Razing works **even while the hex's defenders still stand**: the hit lands on the structure instead of a unit, bypassing the normal "clear the units before touching the assets" rule
- While an improvement remains, mech/air hits raze it first; once it's gone, further hits fall on the defending units as usual
- Only mechs and aircraft can raze. Infantry, warships (bombardment), and capturable units cannot — they leave improvements intact to be **captured**
- **Fortifications cannot be razed**, only captured. Razing an improvement does not capture the hex

### Capture vs Destroy
| Asset/Unit | Outcome when defeated |
|------------|----------------------|
| Infantry unit | Destroyed |
| Mechanised unit | Destroyed |
| Warship | Sunk |
| Carrier | Sunk (any aircraft aboard go down with it) |
| Aircraft | Shot down (sunk in air/naval combat; captured only if caught grounded on a captured hex) |
| Transport | Captured (flag swaps) |
| Farm / Factory / Barracks / Port / Air base | Captured by infantry; **razed** by mech/air |
| Fortification | Captured (flag swaps) |

Boarding (the flag-swap of a capturable unit) happens only in adjacent same-domain
surface combat. Air strikes and shore bombardment can only sink, never capture.

### Captured Transports
- When a transport is captured, its flag swaps immediately
- Any land units aboard also swap flag — fully operational for the captor from the next turn

---

## Naval & Air Mechanics

### Ports
- Required to build any naval unit
- Built on coastal land hexes (adjacent to sea)
- New naval units appear on a free adjacent sea hex

### Fleet Composition
A sea hex can contain up to 9 naval units in any mix of warships, carriers, and
transports. Warships provide cover — attackers must neutralise warships (then
carriers) before targeting transports.

### Amphibious Operations
- Transports move land units across sea hexes; units embark from an adjacent coast and disembark onto an adjacent, undefended coast
- Losing warship escort leaves transports vulnerable — warships (5 actions) can outrun transports (3 actions)

### Carrier Air Power
- A carrier is a mobile air base: aircraft strike and redeploy from it exactly as from a land air base
- Carriers are slower than warships (3 actions vs 5); a sunk carrier takes its planes down with it

### Grounded Aircraft
- Parked aircraft cannot hold ground: enemies can walk past them into the hex
- Aircraft caught on the ground when a hex is captured change flags with the hex

---

## Win / Loss Conditions

### Elimination
- A player is eliminated once they hold **no production buildings** — that is, every **barracks, factory, port, and air base** they owned has been **captured or razed**. Farms and bare land do not stave off defeat; without a production building a player can no longer field forces and is finished.
- **Conquest spoils:** whoever takes that last production building **inherits the fallen power's remaining land and forces** — every surviving unit (and its cargo) defects to the conqueror where it stands, and all the leftover land and farms change to their flag. Inherited units have already spent their turn, so they can't act again until the conqueror's next turn. This gives the victor an immediate windfall instead of letting the spoils evaporate.
- If a player is finished off with **no conqueror** (for example, by razing their own last building), there is no one to inherit: their remaining units scatter and their land falls **neutral**.

### Surrender
- A player may **surrender early** before being fully eliminated
- On surrender, the player **cedes their military units to another player** of their choosing
- The surrendering player's land becomes unowned (contested) — it must be physically occupied by the recipient

### Victory
- The last player still holding a production building wins

---

## Design Notes

- **Improvements drive the economy** — bare land yields only a trickle, so every player must build farms and factories and then defend them; an undeveloped frontier is nearly worthless, but the trickle ensures a beaten player can still claw back
- **Land bridges** between continents are critical chokepoints — controlling them shapes land-based strategy
- **Factories** serve dual purpose (income + mech production) making them high-value targets
- **Razing vs capturing** — mechs and aircraft wreck enemy improvements without holding the ground, denying an economy you can't occupy; infantry instead take assets intact, so the choice of arm shapes whether you cripple or seize
- **Naval supremacy** enables amphibious strikes on any coastline — a player winning on land remains vulnerable without naval defense
- **Air power** projects force up to 6 hexes from any base or carrier, but planes attrit on failed strikes — air superiority is spent, not free; aircraft can also gut an enemy's economy by razing improvements from range
- **Anti-air** is the counter to air power — warships shield the fleet and coastline, while **SAM batteries** extend that umbrella over inland hexes; either makes the airspace around it costly to bomb, and stacking them can shred an attacking air wing
- **Captured transports with cargo** can swing the game — naval escort is critical
- **Fortified mountains** (defense 6) are the most defensible positions and anchor defensive lines
- **Desert** is economically worthless (no farms) but fortifiable — can form part of a defensive perimeter
- **Surrender diplomacy** adds a political layer — weaker players choose who benefits from their collapse, potentially countering a runaway leader
