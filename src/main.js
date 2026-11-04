import { createVilla } from './villa/index.js';

// Minimal host used for development and for rendering approval stills.
// Personal OS mounts the same module via createVilla(container, options).
const params = new URLSearchParams(location.search);
window.addEventListener('error', (e) => { window.__villaError = String(e.message || e); });
window.addEventListener('unhandledrejection', (e) => { window.__villaError = String(e.reason?.stack || e.reason); });
const still = params.has('still');
const container = document.getElementById('villa');
const nav = document.getElementById('views');

function viewFromHash() {
  const m = /view=([\w-]+)/.exec(location.hash);
  return m ? m[1] : null;
}

let saved = null;
try { saved = localStorage.getItem('villa:view'); } catch {}

const opts = {
  quality: params.get('quality') ?? (still ? 'still' : 'auto'),
  view: params.get('view') ?? viewFromHash() ?? saved ?? 'aerial',
  animate: !still,
  debug: params.has('debug'),
  profile: params.has('profile'),
  // dev: ?ov=ao:0,msaa:0 overrides individual quality settings
  overrides: params.get('ov') ? Object.fromEntries(params.get('ov').split(',').map((kv) => { const [k, v] = kv.split(':'); return [k, isNaN(+v) ? v : +v]; })) : undefined,
  camera: params.get('cam') ? params.get('cam').split(',').map(Number) : undefined,
  preserveDrawingBuffer: still,
  onViewChange: (id) => {
    for (const b of nav.querySelectorAll('button')) b.setAttribute('aria-current', String(b.dataset.view === id));
    try { localStorage.setItem('villa:view', id); } catch {}
  },
};
if (still) {
  document.body.classList.add('still');
  opts.width = Number(params.get('w') ?? 1920);
  opts.height = Number(params.get('h') ?? 1080);
}

const villa = await createVilla(container, opts);
window.__villa = villa;

for (const v of villa.views) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.view = v.id;
  b.setAttribute('aria-label', v.label);
  b.setAttribute('aria-current', String(v.id === villa.view));
  b.addEventListener('click', () => go(v.id));
  nav.appendChild(b);
}

function go(id, push = true) {
  villa.setView(id);
  if (push && !still) history.pushState({ view: id }, '', `#view=${id}`);
}

window.addEventListener('popstate', () => {
  const id = viewFromHash();
  if (id) go(id, false);
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const v = villa.views.find((x) => x.key === e.key);
  if (v && villa.mode !== 'explore') { go(v.id); return; }
  if (e.key === 'e' || e.key === 'E') {
    villa.setMode(villa.mode === 'explore' ? 'backdrop' : 'explore');
  } else if (e.key === 'Escape' && villa.mode === 'explore') {
    villa.setMode('backdrop');
  }
});

if (still) {
  // compile programs, then render the final frame once and flag readiness
  const t0 = performance.now();
  villa.renderer.compile(villa.scene, villa.camera);
  if (opts.profile) console.log(`[villa] compile ${(performance.now() - t0).toFixed(0)} ms`);
  villa.renderNow(0);
  if (opts.profile) console.log(`[villa] frame ${JSON.stringify(villa.stats())}`);
  window.__villaReady = true;
}
