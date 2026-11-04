# Coastal Villa — immersive environment for Personal OS

A cliffside villa on a rocky coast, built entirely in code with Three.js:
terrain, sea, sky, architecture, pool and waterfall, furniture, vegetation and
lighting are generated at start-up. No 3D models, textures, HDRIs or photos are
downloaded.

It is an **opt-in** environment: Personal OS mounts it with `createVilla()` as a
backdrop or a walkable place, and every OS workflow stays directly reachable.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL. Keys `1`–`9`, `0`, `-` switch views; `E` toggles walk mode
(drag to look, WASD / arrows to move, Shift to walk faster, Esc to stop). The
current view is kept in the URL hash, so back/forward and reload work.

Render the approval stills from the live scene (headless Chromium):

```bash
npm run stills -- --w=1920 --h=1080
```

## Layout

| Path | What |
|---|---|
| `src/villa/index.js` | Public API: `createVilla(container, options)` |
| `src/villa/core/` | World frame (GLB → Three.js), anchors + camera rig data, quality profiles, noise |
| `src/villa/architecture/` | Plan curves (single source of truth), slabs, glazing, walls, stair, pool, waterfall, firepit terrace, entry court, driveway |
| `src/villa/interior/` | Living, workspace, dining, kitchen, entry furnishings and warm lights |
| `src/villa/landscape/` | Terrain/coastline, ocean, rocks, distant city, trees, shrubs, vines, roof garden |
| `src/villa/materials/` | Procedural textures (travertine, walnut, marble, bouclé, stone, cobbles, foliage) and materials |
| `src/villa/render/` | Sky/atmosphere, HDR pipeline (GTAO, bloom, grade), planar reflections |
| `src/villa/explore/` | View transitions, walk mode, collisions |
| `scripts/render-stills.mjs` | Renders stills through the real app in headless Chromium |
| `docs/` | Integration, reference reconciliation, work log, performance |

## Docs

- [Integration with Personal OS](docs/INTEGRATION.md)
- [Reference reconciliation (plan vs. photos)](docs/RECONCILIATION.md)
- [Work log and review scores](docs/WORK_LOG.md)
- [Performance](docs/PERFORMANCE.md)
