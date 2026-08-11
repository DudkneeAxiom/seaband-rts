/* QA harness: drives the real game in Chromium, captures console errors
   and screenshots. Usage: node tools/qa.mjs [scenario] */
import { chromium } from 'playwright';
import fs from 'fs';

const OUT = process.env.QA_OUT || '/tmp/claude-0/-home-user-seaband-rts/596e8234-72fc-559d-b926-c631e5408168/scratchpad/shots';
fs.mkdirSync(OUT, { recursive: true });
const URL = 'http://localhost:8080/index.html';

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

export async function launch(vp = 'phone') {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const cfg = VIEWPORTS[vp];
  if (!cfg) throw new Error('unknown viewport ' + vp);
  const ctx = await browser.newContext({ ...cfg, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  await page.goto(URL, { waitUntil: 'networkidle' });
  return { browser, page, errors };
}

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
