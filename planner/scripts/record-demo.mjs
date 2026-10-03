// Records the README demo: plans a route, builds the bundle, rides it on the pod.
// Writes:
//   public/demo.trb                 bundled sample route for the "Try the demo route" button
//   ../docs/img/demo-app.gif        whole app (plan → build → ride)
//   ../docs/img/demo-pod.gif        just the round display during the ride
//
// Usage: npm run demo:record   (the npm script builds first; this file serves dist/, drives your installed
// Google Chrome headlessly via playwright-core — no browser download).
// Needs network access: Valhalla routing + OpenFreeMap tiles.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import gifenc from 'gifenc'; // CommonJS

const { GIFEncoder, applyPalette, quantize } = gifenc;

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const imgDir = resolve(root, '../docs/img');
const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;

// Central Jakarta: Jl. Medan Merdeka Barat → Cikini. Public roads, roundabout + U-turn.
const FROM = '-6.1754,106.8227';
const TO = '-6.1925,106.8405';

const APP_W = 1200;
const APP_H = 760;
const APP_GIF_W = 640;
const SIM_MULT = '30';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[demo]', ...a);

async function startServer() {
  // Run vite's own entry with node (not via npx) so kill() reaches the server process itself.
  const vite = resolve(root, 'node_modules/vite/bin/vite.js');
  const proc = spawn(process.execPath, [vite, 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    if (proc.exitCode !== null) throw new Error(`vite preview exited (${proc.exitCode}); is port ${PORT} taken?`);
    try {
      if ((await fetch(BASE)).ok) return proc;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  proc.kill();
  throw new Error('vite preview did not start');
}

/** Collects frames with real timestamps so GIF delays match what happened. */
class Recorder {
  frames = [];
  running = false;
  constructor(grab, minIntervalMs) {
    this.grab = grab;
    this.min = minIntervalMs;
  }
  async start() {
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        const t = Date.now();
        try {
          this.frames.push({ t, data: await this.grab() });
        } catch {
          /* page busy navigating */
        }
        await sleep(Math.max(0, this.min - (Date.now() - t)));
      }
    })();
  }
  async stop() {
    this.running = false;
    await this.loop;
  }
  /** Mark a pause: the next frame is held longer in the GIF (used to skip waiting). */
}

function encodeGif(frames, w, h, { colors = 128, maxDelay = 1500, minDelay = 40 } = {}) {
  const gif = GIFEncoder();
  frames.forEach((f, i) => {
    const next = frames[i + 1];
    let delay = next ? next.t - f.t : 2500;
    delay = Math.min(maxDelay, Math.max(minDelay, delay));
    const palette = quantize(f.rgba, colors);
    gif.writeFrame(applyPalette(f.rgba, palette), w, h, { palette, delay });
  });
  gif.finish();
  return gif.bytes();
}

async function main() {
  mkdirSync(imgDir, { recursive: true });
  log('serving dist/ …');
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
    });
    const ctx = await browser.newContext({ viewport: { width: APP_W, height: APP_H }, acceptDownloads: true, colorScheme: 'dark' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log('page error:', e.message));

    const appRec = new Recorder(() => page.screenshot({ type: 'jpeg', quality: 85 }), 350);

    log('plan: route via URL waypoints');
    await page.goto(`${BASE}?from=${FROM}&to=${TO}`);
    await page.waitForFunction(() => document.querySelectorAll('.marker').length === 2, null, { timeout: 30000 });
    await sleep(2500); // tiles
    await appRec.start();
    await sleep(1200);
    await page.click('#btn-route');
    await page.waitForSelector('#build-group:not([hidden])', { timeout: 30000 });
    await sleep(2500);

    log('plan: build bundle (renders snapshots)');
    await page.click('#btn-build');
    await page.waitForFunction(() => /built in|failed/.test(document.getElementById('build-result').textContent), null, { timeout: 180000 });
    const result = await page.textContent('#build-result');
    if (/failed/.test(result)) throw new Error(result);
    log(result);
    await page.evaluate(() => document.getElementById('thumbs').scrollIntoView({ block: 'end' }));
    await sleep(2500);

    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download')]);
    await download.saveAs(resolve(root, 'public/demo.trb'));
    log('saved public/demo.trb');

    log('pod: ride');
    await page.click('#btn-preview');
    await page.waitForFunction(() => !!document.querySelector('#debug dd:nth-of-type(2)')?.textContent, null, { timeout: 15000 });
    await page.selectOption('#sel-mult', SIM_MULT);
    await sleep(800);

    const podRec = new Recorder(
      () =>
        page.evaluate(() => {
          const c = document.getElementById('pod');
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let s = '';
          for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
          return btoa(s);
        }),
      120,
    );
    await podRec.start();
    await page.click('#btn-play');

    // A wrong turn partway through, so the off-route screen shows up…
    // …about halfway along the route.
    await page.waitForFunction(
      () => {
        const m = (document.querySelector('#debug dd:nth-of-type(3)')?.textContent ?? '').match(/^#(\d+)\/(\d+)/);
        return !!m && Number(m[1]) >= Math.ceil(Number(m[2]) / 2) && document.querySelector('#debug dd:nth-of-type(2)')?.textContent === 'FAR';
      },
      null,
      { timeout: 120000 },
    );
    await sleep(1500);
    await page.click('#btn-detour');
    await page.waitForFunction(() => /^YES/.test(document.querySelector('#debug dd:nth-of-type(9)')?.textContent ?? ''), null, { timeout: 60000 });
    await sleep(1500);
    await page.click('#btn-detour'); // head back
    log('off-route shown; rejoining');

    await page.waitForFunction(() => document.querySelector('#debug dd:nth-of-type(2)')?.textContent === 'ARRIVED', null, { timeout: 180000 });
    await sleep(2500);
    await podRec.stop();
    await appRec.stop();
    log(`captured ${appRec.frames.length} app frames, ${podRec.frames.length} pod frames`);

    // Pod GIF: raw canvas pixels.
    const podFrames = podRec.frames.map((f) => ({ ...f, rgba: Uint8Array.from(Buffer.from(f.data, 'base64')) }));
    writeFileSync(resolve(imgDir, 'demo-pod.gif'), encodeGif(podFrames, 240, 240, { colors: 128 }));

    // App GIF: decode + downscale screenshots in a helper page.
    const helper = await ctx.newPage();
    const appH = Math.round((APP_H * APP_GIF_W) / APP_W);
    const appFrames = [];
    for (const f of appRec.frames) {
      const b64 = await helper.evaluate(
        async ([jpeg, w, h]) => {
          const blob = await (await fetch(`data:image/jpeg;base64,${jpeg}`)).blob();
          const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
          const c = new OffscreenCanvas(w, h);
          const x = c.getContext('2d');
          x.drawImage(bmp, 0, 0);
          const d = x.getImageData(0, 0, w, h).data;
          let s = '';
          for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
          return btoa(s);
        },
        [f.data.toString('base64'), APP_GIF_W, appH],
      );
      appFrames.push({ ...f, rgba: Uint8Array.from(Buffer.from(b64, 'base64')) });
    }
    writeFileSync(resolve(imgDir, 'demo-app.gif'), encodeGif(appFrames, APP_GIF_W, appH, { colors: 128 }));
    log('wrote docs/img/demo-app.gif and docs/img/demo-pod.gif');
  } finally {
    await browser?.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
