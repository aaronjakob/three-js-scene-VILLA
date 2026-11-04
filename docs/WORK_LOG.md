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
