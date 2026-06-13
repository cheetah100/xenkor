# Xenkor — Game Specification

## Overview

Xenkor is a turn-based hex strategy game for up to 5 players (1 human + 4 NPC initially). Players expand across a procedurally generated map, building economies and military forces, competing for territorial dominance. The last player with cells on the board wins.

---

## The Map

### Hex Grid
The board consists of large hexagonal cells of two primary types: **Land** and **Sea**.

### Terrain Types
| Terrain | Base Income/Turn | Base Defense |
|---------|-----------------|--------------|
| Farmland | 3 | 1 |
| Mountains | 1 | 3 |
| Desert | 0 | 0 |
| Sea | 0 | 0 |

### Map Generation
- Maps are procedurally generated with coherent landmasses (continents) separated by seas
- Continents are connected by land bridges — narrow hex connections forming natural chokepoints
- Terrain is distributed across continents: farmland, mountains, and desert

### Starting Positions
- Each player begins with units placed on the map
- Starting positions are distributed across the map to ensure reasonable separation

---

## Economy

### Income
Every turn, each player earns income from all cells and assets they control:

| Source | Income/Turn |
|--------|-------------|
| Farmland hex (base) | 3 |
| Mountains hex (base) | 1 |
| Desert hex (base) | 0 |
| Farm on farmland | +3 |
| Farm on mountains | +1 |
| Factory | +5 |
| Fishing vessel | +3 |

### Maximum Hex Income
- Farmland + 3 farms + factory = **17/turn**
- Mountains + 3 farms + factory = **9/turn**

---

## Static Assets

Static assets are built on land hexes and can be **captured** by enemy military units. They are never destroyed, only changing ownership.

### Farms
- Built on farmland or mountain hexes only (not desert)
- Maximum **3 farms per hex**
- Earns income each turn based on terrain type

### Factories
- Maximum **1 factory per hex**
- Earns +5 income per turn
- **Required** to build mechanised combat units
- Can be built on any land hex

### Fortifications
- Maximum **1 fortification per hex**
- Adds **+3 defense** to the hex (stacks with terrain defense)
- Can be built on any land hex

### Ports
- Built on coastal hexes (land hexes adjacent to sea)
- Enables production of naval units: fishing vessels, transports, warships

---

## Defense Values

| Terrain | Base | + Fortification |
|---------|------|-----------------|
| Farmland | 1 | 4 |
| Mountains | 3 | 6 |
| Desert | 0 | 3 |
| Sea | 0 | — |

A fortified mountain hex (defense 6) is the most defensible position in the game.

---

## Military Units

### Land Units

| Unit | Actions/Turn | Notes |
|------|-------------|-------|
| Basic combat | 3 | Standard infantry |
| Mechanised | 5 | Requires factory to build; faster, higher HP |

### Naval Units

| Unit | Actions/Turn | Notes |
|------|-------------|-------|
| Warship | 5 | Combat unit; protects fleet |
| Transport | 3 | Carries land units; capturable |
| Fishing vessel | 1 | Economic unit; capturable |

### Stacking
- Maximum **9 military units per hex** (land or sea)
- A hex can contain mixed unit types within the 9-unit cap

### Transport Capacity
- 1 transport carries either:
  - **3 basic combat units**, or
  - **1 mechanised unit**

---

## Build Costs

### Buildings
| Building | Cost |
|----------|------|
| Farm | 10 |
| Factory | 50 |
| Fortification | 20 |
| Port | 30 |

### Units
| Unit | Cost |
|------|------|
| Basic combat | 10 |
| Mechanised | 40 |
| Warship | 35 |
| Transport | 20 |
| Fishing vessel | 15 |

### Payback Periods (Buildings)
| Asset | Cost | Income/Turn | Payback |
|-------|------|-------------|---------|
| Farm (farmland) | 10 | 3 | ~3 turns |
| Farm (mountains) | 10 | 1 | 10 turns |
| Factory | 50 | 5 | 10 turns |
| Fishing vessel | 15 | 3 | 5 turns |

---

## Combat

### Resolution
Combat is resolved with dice and modifiers:

- **Attacker rolls** 1d6 + attack modifier
- Must beat the **defender's defense total** (terrain + fortification + unit defense modifier)
- **Success**: defender takes 1 hit (loses HP)
- **Failure**: attacker takes 1 hit (loses HP)

### Actions
Each turn, military units spend actions on **movement** or **attacks** in any combination:

- Basic combat: 3 actions
- Mechanised: 5 actions
- Warship: 5 actions
- Transport: 3 actions
- Fishing vessel: 1 action

### Land Combat
- Units attack adjacent hexes
- Multiple friendly units can attack the same hex in one turn (coordinated assault)
- Attackers must fight through defending military units before capturing static assets

### Naval Combat
- Naval units engage using the same dice system as land combat
- Sea hexes have no terrain defense modifier — combat is purely unit vs unit
- A hex containing both warships and transports: **warships must be cleared before transports can be captured**

### Capture vs Destroy
| Asset/Unit | Outcome when defeated |
|------------|----------------------|
| Basic combat unit | Destroyed |
| Mechanised unit | Destroyed |
| Warship | Destroyed |
| Transport | Captured (flag swaps) |
| Fishing vessel | Captured (flag swaps) |
| Farm | Captured (flag swaps) |
| Factory | Captured (flag swaps) |
| Fortification | Captured (flag swaps) |

### Captured Transports
- When a transport is captured, its flag swaps immediately
- Any land units aboard also swap flag — fully operational for the captor from the next turn

---

## Naval Mechanics

### Ports
- Required to build any naval unit
- Built on coastal land hexes (adjacent to sea)

### Fleet Composition
A sea hex can contain up to 9 naval units in any mix of:
- Warships (combat)
- Transports (logistics)
- Fishing vessels (economic)

Warships provide cover — attackers must neutralise warships before targeting transports or fishing vessels.

### Amphibious Operations
- Transports move land units across sea hexes
- Land units disembark onto coastal land hexes
- Losing warship escort leaves transports vulnerable — warships (5 actions) can outrun transports (3 actions)

---

## Win / Loss Conditions

### Elimination
- A player who controls **zero cells** is eliminated

### Surrender
- A player may **surrender early** before being fully eliminated
- On surrender, the player may **cede their military units to another player** of their choosing
- Static assets (farms, factories) become contested — must be physically occupied by the recipient

### Victory
- Last player with cells on the board wins

---

## Design Notes

- **Land bridges** between continents are critical chokepoints — controlling them shapes land-based strategy
- **Factories** serve dual purpose (income + mech production) making them high-value targets
- **Naval supremacy** enables amphibious strikes on any coastline — a player winning on land remains vulnerable without naval defense
- **Captured transports with cargo** can swing the game — naval escort is critical
- **Fortified mountains** (defense 6) are the most defensible positions and anchor defensive lines
- **Desert** is economically worthless but fortifiable — can form part of a defensive perimeter
- **Surrender diplomacy** adds a political layer — weaker players choose who benefits from their collapse, potentially countering a runaway leader
