# Work log

## Session context (2026‑11‑04)

- Personal OS (`C:\Users\aaron\…\personal-os`) is on the Windows PC "arabam". It is
  listed for Remote Control but was **not offered to this cloud session**, and no
  Personal OS repo exists on GitHub. Its README / AUDIT / ARCHITECTURE / WORK_LOG /
  Design Library docs and git status could therefore not be read, and no Personal OS
  file was changed. The villa was built here as a standalone, framework‑agnostic
  module with a small mount API (`docs/INTEGRATION.md`).
- The GLB (`Coastal_Villa_Schematic_Blockout.glb`) and the nine blockout screenshots
  were not part of the upload; the spatial manifest (anchors + cameras), the labelled
  plan (inside the contact sheet) and the shot briefs were. The manifest's anchors are
  used verbatim.
- No GPU in the container: all stills come from Chromium WebGL2 on SwiftShader.

## Rounds

### Round 0 — environment calibration (sky, sea, terrain only)
- Sun glare blown out, sea milky and visibly tiled, hills a uniform wall, shadow
  streaks from an infinite shadow tube. Fixed: lower sun lobe energy, GPU‑generated
  tileable wave‑slope map (4 layers + swell), ridged/valley terrain, shadow camera
  depth range covering the whole tube.

### Round 1 — first full scene, 11 views at 640×360 (self‑review)
Found and fixed while the round was rendering:
- Trees ~2× too large, too dark, sparse crowns → species rescaled, foliage albedo
  raised, card density up, per‑instance tints made near‑white (variation only).
- Distant canopy blobs and hillside houses leaked next to the villa → exclusion radii.
- 19 M triangles; software render took minutes per frame → LOD tree variants beyond
  85 m, low‑detail far rocks, fewer canopy masses, layer‑2 culling for the reflection
  pass, static shadow map (11 M triangles).
- Ocean shader failed to compile (`flat` is reserved in GLSL ES 3.0).
- Rocks read as pale foam → darker limestone, cavity AO, embedded deeper, fewer.
- Plinth under the terraces read as a smooth silo → rough limestone face with the
  same procedural rock shader as the cliffs.
- Slab edges too thin vs. photos → L1 0.85 m, roof 0.8 m, deck 0.75 m, larger bevels.
- Trees hid the pool/waterfall in exterior views → no trees in any exterior camera
  sightline (shrubs remain).
- Vines formed a curtain over the north wall and dotted veils over the glass → vines
  only on sea‑facing edges, rebuilt as dense edge cushions with a few tendrils.
- Leopard‑spot pattern on lit horizontal surfaces (shadow acne at a 9° sun + pore
  contrast in the travertine) → normal‑offset bias, calmer travertine/roughness.
- Interiors lit like outdoors (unoccluded sky IBL) → interior IBL falloff away from
  the glass + warm bounce, applied to every built‑in material.
- Sun disc + glitter bloomed into a white glare indoors → lower sun energy, bloom
  threshold 2.4.
- Dining camera stood inside the kitchen wall → moved; roof camera pulled back to
  show the roof sweep and the pool beyond.

### Round 2 — full set at 640×360, first blind reviews
Three independent visual reviewers (architecture/materials, layout consistency,
light/colour/nature) saw only the photo references, the plan and the renders.

| Reviewer emphasis | Realism | Light & colour | Architecture | Layout | Vegetation & water | Overall |
|---|---|---|---|---|---|---|
| Architecture & materials | 3.5 | 4.0 | 3.5 | 6.0 | 4.0 | **4.2** |
| Layout consistency | 3.5 | 3.0 | 4.5 | 6.5 | 3.0 | **4.1** |
| Light, colour, nature | 3.5 | 3.5 | 4.0 | 6.0 | 3.5 | **4.1** |

A code reviewer scored OS-integration readiness **4/10** (global key capture,
no blur handling, incomplete dispose, no context-loss recovery, walk mode spawning
underwater from sea views, GPU regexes, accessibility).

All agreed programme placement was correct and stable in every view (no mirroring,
swapping or duplicates). Fixes made for round 3:
- Pool rebuilt as a crescent spanning the south facade (x −14.4…14.4, centroid
  (0, −12.4)); deck edge now derived from the pool curve; waterfall spills from
  the south‑west lip nearest the manifest anchor, wider, three layers, mist, larger
  plunge pool.
- Clipping: nothing grows inside the pool or under slabs; firepit terrace seated
  into the rock.
- Atrium: one open oval shaft from the living‑room ceiling to the sky, stone‑lined
  and planted; no glass lid or upper‑floor drum.
- Slabs: thin plates over a recessed soffit body (knife edge), LED coves in the
  recess; upper floor clear‑glazed with furnished suites; drapes removed.
- North facade: limestone cladding, walnut brise‑soleil, warm canopy downlights.
- Interior: centre‑anchored furniture boxes were sinking half into the floor
  (desk pedestal, island panels, kitchen units) → fixed; three columns removed;
  27" monitors on short arms; tub dining chairs; 2700 K LEDs at lower intensity
  (no white clipping); warmer ceiling with a cove; floor glare reduced; workspace
  and dining cameras reframed to include the walnut wall and kitchen.
- Light/grade: sun lowered to 5.5° with a pale‑yellow disc, +⅔ stop exposure,
  warm gain, less blue in the shadows; brighter olive foliage; mip‑alpha
  compensation so distant trees keep their crowns; low‑detail tree ring to 650 m
  replaces the dome‑shaped canopy masses near the ridge; sea layers modulated to
  hide tiling; darker limestone cliff under the villa.
- Integration: all code‑review BUG items fixed (see commit "Harden embedding").

### Round 3 — full set at 640×360, fresh blind reviewers

| Reviewer emphasis | Realism | Light & colour | Architecture | Layout | Vegetation & water | Overall |
|---|---|---|---|---|---|---|
| Architecture & materials | 4.0 | 5.0 | 4.0 | 7.0 | 5.0 | **5.0** |
| Layout consistency | 4.0 | 4.0 | 5.0 | 7.0 | 4.0 | **4.8** |
| Light, colour, nature | 3.5 | 3.5 | 4.0 | 6.0 | 3.5 | **4.1** |

Mean 4.6 (round 2: 4.1). Every reviewer again confirmed correct, stable programme
placement (no mirroring, swapping, duplicates). Remaining criticism and what was done
before the final set:
- Pool ends were sharp "boat bows" → rounded ends; deck edge follows them.
- Ground under the cantilevers read as a flat dark lawn → rock/soil under the house,
  banded darker limestone on the cliff, boulders allowed under the pool.
- Down-facing soffits were near black (environment lower hemisphere) → bounce from
  a sunlit deck/sea tone.
- Stair seemed to cross the firepit platform → it now lands on the terrace; loose
  cushion "teeth" removed from the curved bench.
- Marble read as contour lines → ridged‑noise veining; furniture boxes had 0–1 UVs
  per face (stretched walnut) → metre‑scaled box projection.
- Kitchen lacked appliances → two black‑glass ovens, induction hob, bronze hood.
- Plants filled foreground frames (workspace, entry, west) → potted plant moved; no
  trees within 26 m or shrubs within 13 m in front of any exterior lens.
- Exposure inconsistent between views → per‑view exposure compensation (as a
  photographer would meter each shot), eased during transitions; clearer air,
  bluer sea, narrower glitter path.
- Aerial never showed the sea → reframed from the north‑west over the roof toward
  the pool, sea and south‑east skyline (see RECONCILIATION.md).
- Entry tree hid the door → camera offset east; brighter entry hall; planted canopy.
- Driveway read as a pale mound behind the roof → darker setts.

Not addressed (would need more than this session): true sculpted rock geometry for
the cliff (it is a heightfield + instanced boulders), higher‑resolution foliage, an
L‑sofa that reads as an L from the lounge camera, kitchen dressing variety.
