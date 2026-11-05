# Mounting the villa in Personal OS

The villa is a self-contained ES module (`src/villa/index.js`) with one runtime
dependency, `three`. It does not touch routing, state, data or any backend
service, and it is opt-in: nothing renders until the host calls `createVilla`.

> This repo could not be wired into Personal OS directly: the `personal-os`
> folder on the Windows PC was not reachable from the cloud session that built
> it. The steps below are what the Personal OS side needs; nothing here assumes
> its framework.

## 1. Add the module

Either copy `src/villa/` into the Personal OS frontend (for example
`src/environments/villa/`) or add this repo as a dependency:

```bash
npm install three@0.186.1
```

## 2. Mount as an opt-in backdrop

```js
import { createVilla } from './environments/villa/index.js';

let villa = null;

export async function enableVillaBackdrop(container) {
  villa = await createVilla(container, {
    quality: 'auto',          // 'still' | 'high' | 'balanced' | 'low' | 'auto'
    view: savedView ?? 'aerial',
    mode: 'backdrop',         // renders once, then idles (no background GPU load)
    fallbackBase: '/villa-stills/', // <view>.jpg used on mobile / no WebGL2
    onViewChange: (id) => saveView(id),
  });
}

export function disableVillaBackdrop() {
  villa?.dispose();
  villa = null;
}
```

- **Backdrop mode** renders a frame only when something changes (view, resize).
  With `prefers-reduced-motion` the water never animates and view changes cut
  instead of fly.
- **Explore mode** (`villa.setMode('explore')`): the canvas takes focus
  (`role="application"`); drag to look, W/S or ↑/↓ to walk, A/D to step sideways,
  ←/→ or Q/E to turn, Shift to walk faster, Esc to leave. Keys are read only from
  the focused canvas, never with Ctrl/Cmd/Alt, never during IME composition, and
  input is cleared when the window loses focus. Walking starts on the nearest
  terrace when entered from an aerial or sea view. Walls, glass, the pool and
  cliff edges are colliders. `options.onModeChange(mode)` reports changes;
  `setView()` always returns to backdrop mode.
- Call `villa.pause()` when the OS shows a heavy view over the backdrop and
  `villa.resume()` when it is visible again.

## 3. Container rules

- Put the container behind the OS layers (`position: fixed; inset: 0; z-index: 0`)
  and keep every OS panel above it. The villa never adds UI of its own.
- As a backdrop the canvas is `tabindex=-1` and `aria-hidden`, so it adds no
  tab stop and nothing for screen readers; it becomes focusable only in explore
  mode.
- Startup yields to the host between build stages and compiles shaders
  asynchronously; if anything fails, the module removes its canvas and shows the
  still instead.
- `dispose()` releases every GPU resource (including the shadow map and the GL
  context) and restores the three.js shader chunks it patched, so other three.js
  scenes in the host are unaffected.
- GPU context loss (sleep, driver reset) is recovered automatically.

## 4. Views

`villa.views` lists `{ id, label, key }` for: `aerial`, `seaward`, `entry`,
`west`, `east`, `lounge`, `workspace`, `dining`, `roof`, `hero-interior`,
`hero-exterior`. `villa.setView(id)` moves the camera; the demo host maps
keys 1–9, 0 and `-` and stores the view in the URL hash and `localStorage`.

## 5. Fallback stills

Ready-made 1920×1080 JPEGs of all 11 views ship in `public/renders/` (the demo
serves them at `./renders/`). Copy them to wherever `fallbackBase` points.

To regenerate them from the live scene (one build, every view from the same
world, 4 jittered frames averaged per still):

```bash
npm run stills -- --session --aa=4 --w=1920 --h=1080
```

Convert `renders/*.png` to JPEG and serve them at `fallbackBase`. They come from
the same scene and cameras, so the fallback matches the live view.
