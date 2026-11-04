# Reference reconciliation

Photos decide the look. The spatial manifest and plan decide where things are.
Where they disagree, the plan wins on position and orientation and the photos win
on form and material. This file records every place where that rule had to be applied.

## Locked world frame

| | GLB / manifest | Three.js (this repo) |
|---|---|---|
| East | +X | +X |
| North (inland) | +Y | −Z |
| Up | +Z | +Y |
| Sea | −Y (south) | +Z |

The conversion happens once, in `src/villa/core/world.js` (`P(x, y, z)` / `toThree`). All plan
geometry is authored in GLB plan coordinates (`src/villa/architecture/plan.js`).

## Anchors (manifest → scene)

| Anchor | Manifest (x, y, z) | Built as |
|---|---|---|
| Main floor | z 18.0 | Deck / floor slab top at 18.00 m |
| Living | (−6, −3, 18) | L‑sofa + two dark stone drum tables centred on (−6, −3) |
| Workspace | (−11.7, 2.4, 18) | Single 4.2 m walnut desk centred on (−11.7, 2.4), three monitors |
| Dining | (6.55, −2.55, 18) | Round 2.24 m marble table centred on (6.55, −2.55), 8 chairs |
| Kitchen | (8.7, 3.4, 18) | Dark stone island centred on (8.7, 2.65), walnut tall‑unit wall at y 6.0 |
| Skylight | (−4.1, −0.6, 28.9) | Single oval opening (7.2 × 4.7 m) through L1 and roof; curb top at 28.95 m |
| Pool | (0, −12, 18) | Crescent infinity pool, centroid ≈ (0, −12.9), water at 17.96 m |
| Waterfall | (−9.1, −12.6, 13.3) | Spills from the pool's west tip (−10.15, −12.6); falls 18 → 8.7 m (mid‑height ≈ 13.3) |
| Firepit | (13.25, −18.65, 12.65) | Lower circular terrace, r 4.4 m, top at 12.65 m, centred exactly on the anchor |
| Entrance | (3, 13, 18) | Walnut pivot door at (3, 10.9); entry canopy (L1 bulge) reaches y 16.6; court centred (3, 21.5) |

## Decisions where references conflict

1. **Sun position.** Manifest: "subtle pale yellow sunset over sea toward southeast". Kept literally
   (azimuth 146°, elevation 6.5°) even though photos put the sun wherever the camera looks. Result: the
   sun is in frame only for south/south‑east‑facing views (interior hero, exterior hero, workspace).
2. **Waterfall side.** Several photos show the waterfall at the image centre/right under the pool.
   It is fixed at the west tip per manifest; it never moves between views.
3. **Firepit level.** Photo 04 and the attached terrace render show the firepit nearly level with the
   pool deck. The manifest puts it 5.35 m lower (12.65 m) and south‑east of the pool. Built at 12.65 m,
   reached by a 30‑riser stair cut into the cliff.
4. **Interior cameras.** The manifest only has elevated cut‑away cameras for 06–08. The shot briefs ask
   for human eye level, so 06–08 use eye height (19.62 m) at the positions in `core/anchors.js`.
5. **Brief 06 (lounge).** "Looking south/east … walnut workspace visible back north‑west" cannot be
   satisfied in one frame (the workspace is behind a south‑east‑looking camera). The lounge camera looks
   west‑south‑west instead (glass and sea on the left, workspace at right‑back). The separate
   `hero-interior` view covers "living room looking south‑east to the sea".
6. **Brief 07 (workspace).** The desk faces south so the screens face the user and the camera behind
   the chair; the walnut slat / shelving / stone wall is behind the desk at y 4.7.
7. **Brief 09 (roof).** The manifest camera sits south of the skylight looking north; the brief asks for a
   north‑west vantage looking south‑east. The brief was followed (pool glimpsed beyond the roof).
8. **Entry photo crop (09).** Its coastline is visible beyond the entry; per the README it must not be
   copied. The north view looks at the inland side with a hill behind; the sea is only glimpsed through
   the glazing.
9. **Upper level.** The skylight z = 28.9 implies a second storey (main 18.0 → L1 23.0 → roof 28.3).
   The photos show stacked curved slabs, so the house has a set‑back upper floor with sheer curtains;
   its rooms are not furnished (not part of any brief).
10. **Atrium.** "One oval roof/atrium opening": one shaft through L1 and the roof with a glass drum at
    the upper level and frameless glass at the roof curb. No second skylight anywhere.

## Not taken from the photos

- Exact slab count/profile, column positions, stair position and the north service core are design
  decisions made here (the photos do not agree with each other on them).
- Photo coastlines are not copied; the coast is a single procedural coastline with the sea to the south,
  a promontory under the villa, rocky islands to the south/south‑east and a distant city to the south‑east.
