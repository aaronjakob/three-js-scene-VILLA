// Render approval stills from the live scene (same code path as the app).
// Usage: node scripts/render-stills.mjs [--views=aerial,seaward] [--w=1920] [--h=1080]
//        [--out=renders] [--quality=still] [--url=http://127.0.0.1:5173/]
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node-tools/node_modules/playwright');
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const ALL = ['aerial', 'seaward', 'entry', 'west', 'east', 'lounge', 'workspace', 'dining', 'roof', 'hero-interior', 'hero-exterior'];
const views = args.views ? args.views.split(';') : ALL;
const W = Number(args.w ?? 1920);
const H = Number(args.h ?? 1080);
const out = path.resolve(args.out ?? 'renders');
const quality = args.quality ?? 'still';
const extra = args.extra ?? '';
// --aa=N: supersample each still with N jittered frames (session mode)
const aa = Math.max(1, Number(args.aa ?? 1));
await mkdir(out, { recursive: true });

let server = null;
let base = args.url;
if (!base) {
  server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5179', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VILLA_NO_HMR: '1' },
  });
  server.stderr.on('data', (d) => process.stderr.write(d));
  base = 'http://127.0.0.1:5179/';
  const deadline = Date.now() + 30000;
  for (;;) {
    try { if ((await fetch(base)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error('vite did not start');
    await new Promise((r) => setTimeout(r, 300));
  }
}

// --session: build the scene once and render every view from the same page
// (one build, one shadow map / probe capture; identical world for all views)
const session = args.session === 'true';
const fileFor = (vname, cam) => path.join(out, `${cam ? vname + '_' + cam.replace(/[^0-9a-z-]+/gi, '_') : vname}.png`);

const browser = await playwright.chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = [];
try {
  if (session) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    const t0 = Date.now();
    const [v0, c0] = views[0].split('@');
    await page.goto(`${base}?still&view=${v0}&w=${W}&h=${H}&quality=${quality}${c0 ? '&cam=' + c0 : ''}${extra ? '&' + extra : ''}`);
    await page.waitForFunction(() => window.__villaReady === true || !!window.__villaError, null, { timeout: 1800000, polling: 1000 });
    const err = await page.evaluate(() => window.__villaError);
    if (err) throw new Error(`page error: ${err}\n${logs.slice(-20).join('\n')}`);
    console.log(`build+first frame: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    for (let i = 0; i < views.length; i++) {
      const [vname, cam] = views[i].split('@');
      const t1 = Date.now();
      const data = await page.evaluate(({ vname, cam, first, aa }) => {
        const V = window.__villa;
        if (!first) {
          if (cam) V.setFreeCamera(cam.split(',').map(Number));
          else V.setView(vname, { instant: true });
          if (aa > 1) return V.captureAA(aa);
          V.renderNow(0);
        } else if (aa > 1) return V.captureAA(aa);
        return document.querySelector('canvas').toDataURL('image/png');
      }, { vname, cam, first: i === 0, aa });
      const file = fileFor(vname, cam);
      await writeFile(file, Buffer.from(data.split(',')[1], 'base64'));
      const secs = ((Date.now() - (i === 0 ? t0 : t1)) / 1000).toFixed(1);
      results.push({ view: views[i], file, secs });
      console.log(`${views[i]}: ${secs}s`);
    }
    const errs = logs.filter((l) => (/error/i.test(l) && !/Mismatch/.test(l)) || /\[villa\]/.test(l));
    if (errs.length) console.log(errs.slice(0, 20).join('\n'));
    await page.close();
  }
  for (const view of session ? [] : views) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    const t0 = Date.now();
    // a "view" may be "name@x,y,z,tx,ty,tz,fov" for free debug cameras
    const [vname, cam] = view.split('@');
    await page.goto(`${base}?still&view=${vname}&w=${W}&h=${H}&quality=${quality}${cam ? '&cam=' + cam : ''}${extra ? '&' + extra : ''}`);
    try {
      await page.waitForFunction(() => window.__villaReady === true || !!window.__villaError, null, { timeout: 900000, polling: 500 });
    } catch (e) {
      console.error(`[${view}] timeout`, logs.slice(-20).join('\n'));
      await page.close();
      continue;
    }
    const err = await page.evaluate(() => window.__villaError);
    if (err) { console.error(`[${view}] error: ${err}`); console.error(logs.slice(-20).join('\n')); await page.close(); continue; }
    const data = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      return c.toDataURL('image/png');
    });
    const stats = await page.evaluate(() => window.__villa.stats());
    const buf = Buffer.from(data.split(',')[1], 'base64');
    const file = fileFor(vname, cam);
    await writeFile(file, buf);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    results.push({ view, file, secs, stats });
    console.log(`${view}: ${secs}s  ${JSON.stringify(stats)}`);
    const errs = logs.filter((l) => /error|warn/i.test(l));
    if (errs.length) console.log(errs.slice(0, 12).join('\n'));
    await page.close();
  }
} finally {
  await browser.close();
  server?.kill();
}
await writeFile(path.join(out, 'stats.json'), JSON.stringify(results, null, 2));
