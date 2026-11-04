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
- **Explore mode** (`villa.setMode('explore')`): drag to look, WASD / arrows to
  walk at eye height, Shift to walk faster, Esc to leave. Walls, glass, the pool
  and cliff edges are colliders.
- Call `villa.pause()` when the OS shows a heavy view over the backdrop and
  `villa.resume()` when it is visible again.

## 3. Container rules

- Put the container behind the OS layers (`position: fixed; inset: 0; z-index: 0`)
  and keep every OS panel above it. The villa never adds UI of its own.
- The canvas is focusable (`tabindex=0`) only so keyboard walking works in
  explore mode; the OS keeps normal focus order otherwise.

## 4. Views

`villa.views` lists `{ id, label, key }` for: `aerial`, `seaward`, `entry`,
`west`, `east`, `lounge`, `workspace`, `dining`, `roof`, `hero-interior`,
`hero-exterior`. `villa.setView(id)` moves the camera; the demo host maps
keys 1–9, 0 and `-` and stores the view in the URL hash and `localStorage`.

## 5. Fallback stills

Render the approval/fallback stills from the live scene:

```bash
npm run stills -- --w=1920 --h=1080
```

Convert `renders/*.png` to JPEG and serve them at `fallbackBase`. They come from
the same scene and cameras, so the fallback matches the live view.
