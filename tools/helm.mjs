/* The compass, and playing at a desk. Both are read off the running game
   rather than assumed: a card that lies about north is worse than no card. */
import { launch, sleep, shot, newVoyage, waitFor, dismissModal, intoBattle, leaveBattle } from './qa.mjs';

const { browser, page, errors } = await launch('desktop');
const log = [];
const ok = (m, c) => log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);
const G = (fn, arg) => page.evaluate(fn, arg);

await sleep(900);
await newVoyage(page);
await G(() => {
  const g = window.__game, p = g.player;
  p.x = 120; p.z = 60; p.dest = null; p.throttle = 1;
  for (const s of g.ships) if (!s.isPlayer && !g.fleet.includes(s)) { s.x += 3000; s.z += 3000; }
});
await sleep(500);

/* ---------- north is measured off the camera, not assumed ---------- */
const bearings = await G(() => {
  const g = window.__game, u = window.__hud, p = g.player;
  const ws = window.__worldToScreen;
  const rect = { width: window.innerWidth, height: window.innerHeight };
  const wrap = a => Math.abs(((a % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
  const out = [];
  // at every camera angle, does each point of the compass land where that
  // direction really appears on screen? Projected, not derived.
  for (const az of [-0.62, 0.0, 1.4, 3.0, 4.6]) {
    g.rig.azimuth = az;
    g.rig.focus.set(p.x, 0, p.z);
    g.rig.update(0.016, { x: p.x, z: p.z, yaw: p.yaw, speed: 0 }, null, 0);
    g.rig.cam.updateMatrixWorld(true);
    u.measureNorth();
    // measured from the middle of the view, which is what the card speaks for
    const c = g.rig.focus;
    const o = ws(g.rig.cam, c.x, 0, c.z, rect);
    // close in, a rigid card and the projection should agree exactly
    let worst = 0, which = '';
    // far out, perspective skews the apparent bearing — but it must never
    // put a point of the compass on the wrong side of the card
    let far = 0;
    for (const [name, bearing] of [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2]]) {
      const card = u.screenBearing(bearing) * Math.PI / 180;
      for (const [R, into] of [[24, 'near'], [140, 'far']]) {
        const q = ws(g.rig.cam, c.x + Math.sin(bearing) * R, 0, c.z + Math.cos(bearing) * R, rect);
        const err = wrap(Math.atan2(q.x - o.x, -(q.y - o.y)) - card);
        if (into === 'near') { if (err > worst) { worst = err; which = name; } }
        else far = Math.max(far, err);
      }
    }
    out.push({ az, worst: +worst.toFixed(3), which, far: +far.toFixed(2), spin: u.spin });
  }
  return out;
});
console.log('\n camera az   worst point   error   at 140m   card runs');
for (const r of bearings) {
  console.log(`  ${String(r.az).padStart(6)}   ${String(r.which || '-').padStart(11)}   ${String(r.worst).padStart(5)}   ${String(r.far).padStart(7)}   ${r.spin > 0 ? 'clockwise' : 'widdershins'}`);
}
// A tilted camera squashes the ground plane, so a rigid rose cannot line up
// with every direction at once; the card is the best rigid fit, and this is
// the residual skew that leaves.
ok(`every point of the compass lands within a needle's width of where it really is (worst ${Math.max(...bearings.map(b => b.worst)).toFixed(3)} rad at any camera angle)`,
  bearings.every(b => b.worst < 0.30));
ok(`and perspective never throws one onto the wrong side of the card (worst ${Math.max(...bearings.map(b => b.far)).toFixed(2)} rad out at 140m)`,
  bearings.every(b => b.far < Math.PI / 4));

/* ---------- the needles say what the ship is doing ---------- */
const needles = await G(() => {
  const g = window.__game, u = window.__hud, p = g.player;
  p.yaw = 1.2; g.windAng = 2.6;
  p.dest = { x: p.x + 300, z: p.z - 300 };            // north-east of here
  u.updateCompass(p);
  const deg = id => {
    const t = document.getElementById(id).getAttribute('transform') || '';
    const m = t.match(/rotate\(([-\d.]+)/);
    return m ? +m[1] : null;
  };
  const want = b => u.screenBearing(b);
  return {
    bow: deg('cmp-bow'), bowWant: +want(p.yaw).toFixed(1),
    wind: deg('cmp-wind'), windWant: +want(g.windAng).toFixed(1),
    course: deg('cmp-course'), courseWant: +want(Math.atan2(300, -300)).toFixed(1),
    courseShown: !document.getElementById('cmp-course').classList.contains('hidden'),
    readout: document.getElementById('wind-label').textContent,
  };
});
const near = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180) < 1.5;
ok(`the needle follows your bow (${needles.bow}° vs ${needles.bowWant}°)`, near(needles.bow, needles.bowWant));
ok(`the wind mark follows the wind (${needles.wind}°)`, near(needles.wind, needles.windWant));
ok(`the course chevron follows the course you set (${needles.course}°)`,
  needles.courseShown && near(needles.course, needles.courseWant));
ok(`and the readout gives a heading in degrees ("${needles.readout}")`, /\d{3}°/.test(needles.readout));

/* ---------- no course, no chevron ---------- */
const noCourse = await G(() => {
  const g = window.__game, u = window.__hud;
  g.player.dest = null;
  const real = g.objectiveMarker;
  g.objectiveMarker = () => null;                  // and nothing else to steer for
  u.updateCompass(g.player);
  const hidden = document.getElementById('cmp-course').classList.contains('hidden');
  g.objectiveMarker = real;
  // with no course of your own it falls back to whatever the voyage is pointing at
  u.updateCompass(g.player);
  const backAgain = !document.getElementById('cmp-course').classList.contains('hidden');
  return { hidden, backAgain };
});
ok('with nothing to steer for the chevron goes away', noCourse.hidden);
ok('and with no course of your own it shows where the voyage is pointing', noCourse.backAgain);

/* ---------- the cardinals stay the right way up ---------- */
const letters = await G(() => {
  const els = [...document.querySelectorAll('#cmp-letters text')];
  const cx = 50, cy = 50;
  return els.map(t => ({
    ch: t.textContent,
    rotated: !!t.getAttribute('transform'),
    r: +Math.hypot(+t.getAttribute('x') - cx, +t.getAttribute('y') - cy).toFixed(1),
  }));
});
ok(`N E S W ride the card without turning over (${letters.map(l => l.ch).join('')})`,
  letters.length === 4 && letters.every(l => !l.rotated && Math.abs(l.r - 30.5) < 0.6));
await shot(page, 'helm-compass');

/* =====================  playing at a desk  ===================== */
await G(() => { window.__game.storyOver = false; window.__game.chapter = 0; });
const key = async (k, ms = 130) => { await page.keyboard.down(k); await sleep(ms); await page.keyboard.up(k); };
/* This renderer runs at about eight frames a second, so a fixed hold can span
   no frames at all. Hold until the thing actually moves, or give up. */
const hold = async (k, fn, ms = 4000, arg) => {
  await page.keyboard.down(k);
  const t0 = Date.now();
  let out = false;
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn, arg)) { out = true; break; }
    await sleep(90);
  }
  await page.keyboard.up(k);
  await sleep(120);
  return out;
};

/* ---------- the helm ---------- */
const helm = await G(() => {
  const p = window.__game.player;
  p.dest = { x: p.x + 400, z: p.z }; p.headingCmd = null; p.yaw = 0;
  return { yaw: p.yaw, hadDest: !!p.dest };
});
await hold('ArrowRight', () => (window.__game.player.headingCmd || 0) > 0.02);
const turned = await G(() => {
  const p = window.__game.player;
  return { heading: p.headingCmd, dest: !!p.dest };
});
ok(`the arrow keys put the helm over (${(turned.heading || 0).toFixed(2)} rad)`, turned.heading > 0.02);
ok('and taking the helm cancels the course you tapped', !turned.dest && helm.hadDest);

await G(() => { window.__game.player.throttle = 0.5; });
await hold('ArrowUp', () => window.__game.player.throttle > 0.62);
const madeSail = await G(() => window.__game.player.throttle);
await hold('ArrowDown', () => window.__game.player.throttle < 0.4);
const tookIn = await G(() => window.__game.player.throttle);
ok(`W and S make and take in sail (0.50 -> ${madeSail.toFixed(2)} -> ${tookIn.toFixed(2)})`,
  madeSail > 0.6 && tookIn < madeSail - 0.15);

await page.keyboard.press('h');
await sleep(200);
ok('H heaves her to', await G(() => window.__game.player.throttle === 0 && !window.__game.player.dest));

/* ---------- the view ---------- */
const az0 = await G(() => window.__game.rig.azimuth);
await hold('q', a => Math.abs(window.__game.rig.azimuth - a) > 0.15, 4000, az0);
const az1 = await G(() => window.__game.rig.azimuth);
ok(`Q and E swing the view (${az0.toFixed(2)} -> ${az1.toFixed(2)})`, Math.abs(az1 - az0) > 0.15);
const z0 = await G(() => window.__game.rig.targetDistance);
await hold('x', z => window.__game.rig.targetDistance < z - 4, 4000, z0);
const z1 = await G(() => window.__game.rig.targetDistance);
ok(`Z and X zoom (${Math.round(z0)} -> ${Math.round(z1)})`, z1 < z0);
await page.keyboard.press('c');
await sleep(200);
const squared = await G(() => {
  const g = window.__game;
  return Math.abs(((g.rig.azimuth - (Math.PI + g.player.yaw)) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
});
ok(`C squares the view on your heading (${squared.toFixed(3)} rad off)`, squared < 0.02);

/* ---------- fighting ---------- */
await G(() => {
  const g = window.__game, p = g.player;
  p.shot = 60; p.reload.stb = 0; p.reload.port = 0;
  const pir = g.ships.find(s => s.faction === 'pirate') || g.spawnNPC('pirate');
  pir.x = p.x + 100; pir.z = p.z; pir.hostileToPlayer = true; pir.alive = true;
  p.yaw = 0;                       // she is abeam to starboard
  g.update(0.05);
});
await sleep(300);
await page.keyboard.press('Tab');
await sleep(300);
const tabbed = await G(() => window.__game.target && window.__game.target.name);
ok(`Tab marks the nearest sail (${tabbed})`, !!tabbed);

await page.keyboard.press('2');
await sleep(150);
ok('2 loads chain', await G(() => window.__game.player.ammo === 'chain'));
await page.keyboard.press('1');
/* The strip belongs to the action. Guns are cold on the campaign layer, so
   there is no ammunition to choose out there and nothing to show — the
   shortcut still loads the shot, and this checks the strip reflects it where
   the strip exists. She is held alongside so this tests the shortcut and not
   the pirate's navigation. */
await G(() => {
  const g = window.__game, p = g.player;
  if (g.target) { g.target.x = p.x + 100; g.target.z = p.z; g.target.speed = 0; }
  g.ctx.combatLive = true;
  g.update(0.05);
});
await waitFor(page, () => document.querySelectorAll('.ammo-btn').length === 3);
const ammoUi = await G(() => ({
  ammo: window.__game.player.ammo,
  strip: document.querySelectorAll('.ammo-btn').length,
  lit: [...document.querySelectorAll('.ammo-btn.on')].map(b => b.dataset.ammo),
}));
ok(`1 loads round shot, and the strip shows it (${ammoUi.strip} buttons, lit: ${ammoUi.lit.join() || 'none'})`,
  ammoUi.ammo === 'round' && ammoUi.lit.length === 1 && ammoUi.lit[0] === 'round');

/* Put the flag back. combatLive was forced true to photograph the strip and
   stayed true — a state real play cannot reach on the campaign layer, and
   under it a staged raider takes up a gunnery station 105m off and never
   makes contact, so the battle below never opened. It hid for months because
   Tab used to start a chase and the player's own motion produced the
   contact; one tap only marks now, and the standoff became permanent. */
await G(() => { const g = window.__game; g.ctx.combatLive = false; g.update(0.05); });

/* Guns are live inside a battle instance and nowhere else, so the keyboard
   test has to be in one: sail into contact, take the encounter, clear for
   action, and then try the key. */
const foe = await intoBattle(page);
/* Pose, press and read in one breath. The enemy keeps her own station between
   evaluates — a frame or two of her sailing was enough, on the wrong wind, to
   carry her out of the arc after the pose and before the key landed. The
   dispatched event still walks the real keydown listener; the CDP keyboard
   path is exercised by every other key on this page. */
const spaceFire = await G(() => {
  const g = window.__game, p = g.player, t = g.target;
  if (t) { t.x = p.x + 90; t.z = p.z; t.speed = 0; p.yaw = 0; p.speed = 0; }
  p.reload.stb = 0; p.reload.port = 0;
  g.update(0.05);                       // fireSide settles from the pose
  const before = p.shot, side = g.fireSide;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
  return { before, after: p.shot, side };
});
ok(`Space fires the battery that bears in action (${foe && foe.name}: ${spaceFire.before} -> ${spaceFire.after} shot, ${spaceFire.side})`,
  spaceFire.after < spaceFire.before);

await page.keyboard.press('Escape');
await sleep(250);
ok('Escape lets her go', !(await G(() => !!window.__game.target)));

/* Out of the action before the rest of the keys. F puts into port and M opens
   the log, and neither has anything to say from the middle of a fleet action
   in open water — the checks that follow are campaign-layer checks. */
await leaveBattle(page);

/* ---------- time ---------- */
await page.keyboard.press('p');
await sleep(200);
const paused = await G(() => ({ speed: window.__game.speed, badge: !document.getElementById('paused-badge').classList.contains('hidden') }));
ok(`P pauses, and the badge shows it (speed ${paused.speed})`, paused.speed === 0 && paused.badge);
await page.keyboard.press(']');
await sleep(150);
await page.keyboard.press(']');
await sleep(150);
ok(`] makes time run on (speed ${await G(() => window.__game.speed)})`, await G(() => window.__game.speed === 2));
await page.keyboard.press('[');
await sleep(150);
ok('[ slows it again', await G(() => window.__game.speed === 1));

/* ---------- harbour ---------- */
await G(() => {
  const g = window.__game, p = g.player, port = g.PORTS[0];
  p.x = port.x; p.z = port.z; p.speed = 0; p.dest = null; p.throttle = 0; p.headingCmd = p.yaw;
  for (const s of g.ships) if (!s.isPlayer && Math.hypot(s.x - port.x, s.z - port.z) < 700) s.x += 2600;
  g.update(0.05);
});
await sleep(500);
await dismissModal(page);
await waitFor(page, () => !!window.__game.dockablePort);
await page.keyboard.press('f');
await sleep(700);
ok('F puts into port', await G(() => !document.getElementById('sheet').classList.contains('hidden')));
await page.keyboard.press('Escape');
await sleep(500);
ok('Escape closes the screen', await G(() => document.getElementById('sheet').classList.contains('hidden')));
await page.keyboard.press('m');
await sleep(600);
ok('M opens the log', await G(() => /Log/.test(document.getElementById('sheet-title').textContent)));

/* ---------- the keys are documented from the bindings themselves ---------- */
await G(() => {
  const b = [...document.querySelectorAll('#sheet-tabs .tab')].find(x => /HELM/.test(x.textContent));
  if (b) b.click();
});
await sleep(400);
const doc = await G(() => ({
  rows: document.querySelectorAll('.keyrow').length,
  caps: [...document.querySelectorAll('.keyrow kbd')].map(k => k.textContent),
}));
ok(`the helm page lists every binding (${doc.rows} rows, ${doc.caps.length} keys)`, doc.rows >= 14);
await shot(page, 'helm-keys');
await page.keyboard.press('Escape');
await sleep(400);

/* ---------- a keypress must not reach through a screen ---------- */
const throughGlass = await G(() => {
  const g = window.__game;
  g.player.shot = 40;
  window.__ui.hint('x', 10);
  return g.player.shot;
});
await page.keyboard.press('m');
await sleep(600);
const before = await G(() => ({ shot: window.__game.player.shot, throttle: window.__game.player.throttle }));
await page.keyboard.press(' ');
await key('ArrowRight', 300);
const after = await G(() => ({ shot: window.__game.player.shot, throttle: window.__game.player.throttle }));
ok('keys do not reach the ship through an open screen',
  after.shot === before.shot && after.throttle === before.throttle);
await page.keyboard.press('Escape');
await sleep(400);
void throughGlass;

/* ---------- and typing a captain's name must not sail the ship ---------- */
await G(() => { try { localStorage.clear(); } catch (e) { void e; } });
await page.reload();
await sleep(1500);
await page.click('#btn-new');
await waitFor(page, () => !document.getElementById('origin').classList.contains('hidden'));
await page.click('#og-skip');
await sleep(400);
await page.click('.og-input');
await page.keyboard.press('Control+a');
await page.keyboard.type('Wade Sparrow');
await sleep(200);
const typed = await G(() => document.querySelector('.og-input').value);
ok(`typing a name types a name (${typed})`, typed === 'Wade Sparrow');

console.log('');
console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 6).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
