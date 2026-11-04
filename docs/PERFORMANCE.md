# Performance

## What was measurable here

The scene was built and rendered in a cloud container **without a GPU**:
Chromium's WebGL2 ran on SwiftShader (CPU rasteriser, 4 cores). Every number
below comes from that environment and is a *lower bound*; it says nothing
direct about the Windows PC that runs Personal OS, which could not be reached
from this session. Run the profile on the real machine (below) before choosing
a default profile.

| Measure (profile `still`) | Value |
|---|---|
| Build time (terrain, textures, villa, vegetation) | ~12 s on 4 CPU cores (yields to the host between stages) |
| Scene size (round 3) | ~14.1 M triangles, ~55 k instances, ~230 geometries, ~75 programs |
| One 640×360 still, incl. page load + build (SwiftShader) | 74–175 s (interiors fastest, sea-facing aerials slowest) |
| One 1920×1080 still (SwiftShader) | see `renders/stats.json` |

On a discrete GPU this triangle count is routine; the main per-frame costs are
the planar reflection pass (second scene render at 0.5–0.6× resolution),
GTAO, and alpha-tested foliage overdraw.

## Profiles (`src/villa/core/quality.js`)

| Profile | Target | Pixel ratio | MSAA | Shadows | AO | Reflections | Vegetation |
|---|---|---|---|---|---|---|---|
| `still` | offline approval stills | 1 | 4× | 4096 | full res, 24 spp | 0.6× | 100 % |
| `high` | desktop dGPU (RTX / RX) | ≤1.5 | 4× | 4096 | 0.75×, 16 spp | 0.5× | 100 % |
| `balanced` | iGPU (Radeon 780M, Iris Xe, Apple M) | 1 | 2× | 2048 | 0.5×, 12 spp | 0.35× | 60 % |
| `low` | weak GPUs | 0.85 | – | 1024 | – | – | 32 % |
| fallback | mobile, no WebGL2, software GL | – | – | – | – | – | 2D still |

`quality: 'auto'` reads the WebGL renderer string and picks one of these.

## Keeping the OS fast

- **Static shadows.** The sun and every shadow caster are static, so the
  shadow map is rendered once (`renderer.shadowMap.autoUpdate = false`).
- **Render on demand.** In backdrop mode a frame is drawn only on view change
  or resize; nothing animates unless explore mode is on and reduced motion is
  off. `pause()` stops all GPU work.
- **Layers.** Distant forest, far trees and settlements live on layer 2: the
  main camera draws them, the floor-reflection pass and shadow pass skip them.
- **LOD.** Trees beyond 85 m use low-card variants; rocks beyond 120 m use a
  low-detail mesh; the far forest is instanced canopy masses.

## Measuring on the real PC

Open the dev server with `?profile` to log build timings and per-frame stats
to the console, and `window.__villa.stats()` for draw calls and triangles.
