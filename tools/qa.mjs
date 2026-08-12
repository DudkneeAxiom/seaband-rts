/* QA harness: drives the real game in Chromium, captures console errors
   and screenshots. Usage: node tools/qa.mjs [scenario] */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { serve, isUp } from './serve.mjs';

// screenshots land beside the repo unless QA_OUT says otherwise, so a clone
// on any machine writes somewhere that exists
const OUT = process.env.QA_OUT
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = +(process.env.PORT || 8080);
const URL = `http://localhost:${PORT}/index.html`;

export const VIEWPORTS = {
  // iPhone 14-class landscape
  phone: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  // portrait
  phoneP: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  // small/older phone landscape (iPhone SE)
  small: { viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  tablet: { viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

/* Any suite can be run on its own: if nothing is serving the game, this starts
   a server and keeps it for the life of the process. One less thing to remember
   than "did I leave http-server running in the other terminal". */
let ownServer = null;
async function ensureServer() {
  if (ownServer || await isUp(PORT)) return;
  ownServer = await serve(PORT);
}

export async function launch(vp = 'phone') {
  await ensureServer();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox',
      // the audio suite has to hear something, and there is no thumb here to
      // satisfy the gesture requirement before the context will start
      '--autoplay-policy=no-user-gesture-required'],
  });
  const cfg = VIEWPORTS[vp];
  if (!cfg) throw new Error('unknown viewport ' + vp);
  const ctx = await browser.newContext({ ...cfg, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  /* Kill entrance animations for the duration of a QA run. Under software GL
     the document timeline does not advance — every animation sits at its first
     frame, playState "running", currentTime 0 — so anything that fades in from
     opacity 0 (the modal card, the sheet) stays invisible forever. Screenshots
     of a story scene were coming back as an empty dimmed screen. Without the
     animations the elements render in their settled state, which is the state
     worth looking at anyway.

     As an init script rather than a style tag, because several suites reload
     the page to test the save, and a style tag does not survive navigation —
     which would have quietly put the animations back for the rest of the run. */
  await page.addInitScript(() => {
    const kill = () => {
      const st = document.createElement('style');
      st.textContent = '*, *::before, *::after { animation: none !important; }';
      (document.head || document.documentElement).appendChild(st);
    };
    if (document.head) kill();
    else document.addEventListener('DOMContentLoaded', kill, { once: true });
  });
  /* QA_SLOW=6 runs the browser at a sixth speed.
     Three separate flakes have now passed on this machine and failed on a
     hosted runner, every one of them a fixed sleep that was long enough here
     and not there. This makes that difference reproducible instead of
     something you find out about from CI twenty minutes later. */
  if (process.env.QA_SLOW) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: +process.env.QA_SLOW });
  }
  await page.goto(URL, { waitUntil: 'networkidle' });
  return { browser, page, errors };
}

/** Let go of the server this process started, so node can exit. */
export function stopServer() { if (ownServer) { ownServer.close(); ownServer = null; } }
process.on('exit', () => { if (ownServer) ownServer.close(); });

export async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  return `${OUT}/${name}.png`;
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Advance the real simulation without waiting on the renderer. */
export async function ff(page, seconds, step = 1 / 30) {
  await page.evaluate(([sec, st]) => {
    const g = window.__game;
    const n = Math.round(sec / st);
    for (let i = 0; i < n; i++) {
      g.update(st);
      const p = g.player;
      if (p) g.rig.update(st, { x: p.x, z: p.z, yaw: p.yaw, speed: p.speed }, null, 0);
    }
  }, [seconds, step]);
  await sleep(120);
}

/** Start a voyage the way a player does: tap NEW VOYAGE, answer the questions,
    read the opening scene, and get on with it. `picks` names the answers to
    give ({birth:'shore', …}); anything unnamed is rolled. */
export async function newVoyage(page, picks = null) {
  await page.click('#btn-new');
  await waitFor(page, () => !document.getElementById('origin').classList.contains('hidden'));
  if (picks) {
    for (const opt of Object.values(picks)) {
      await page.click(`.og-opt[data-opt="${opt}"]`);
      await sleep(180);
    }
  }
  // rolls whatever is still unanswered; gone once every question has an answer
  if (await page.isVisible('#og-skip')) { await page.click('#og-skip'); await sleep(250); }
  await page.click('.og-go');
  // the opening scene: wait for it, then dismiss it like a player would
  await waitFor(page, () => !document.getElementById('modal').classList.contains('hidden'));
  await page.click('#modal-actions .btn');
  await sleep(300);
}

/** Tap through any scene that has come up, the way a player would before
    reaching for a button. Returns whether there was one. */
export async function dismissModal(page) {
  if (!await page.isVisible('#modal-actions .btn')) return false;
  await page.click('#modal-actions .btn');
  await sleep(320);
  return true;
}

/** Poll for a condition in the page. Fixed sleeps lie on a software renderer.
    `arg` is passed through to the page, since the predicate is serialised and
    cannot close over anything out here. */
export async function waitFor(page, fn, ms = 9000, arg = undefined) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return true;
    if (Date.now() - t0 > ms) return false;
    await sleep(120);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const vp = process.argv[2] || 'phone';
  const { browser, page, errors } = await launch(vp);
  await sleep(1500);
  await shot(page, `title-${vp}`);
  await page.click('#btn-new');
  await sleep(4000);
  await shot(page, `sea-${vp}`);
  const state = await page.evaluate(() => {
    const g = window.__game;
    if (!g) return { err: 'no game' };
    return {
      ships: g.ships.length, player: g.player && g.player.name, coin: g.coin,
      pos: g.player ? [Math.round(g.player.x), Math.round(g.player.z)] : null,
      fps: 'n/a',
    };
  });
  console.log('STATE', JSON.stringify(state));
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  await browser.close();
}
