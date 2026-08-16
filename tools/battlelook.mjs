/* Eyes on the action.
 *
 * Not a check — a camera. It drives the real spine into a real battle through
 * the real UI (`intoBattle`), then shoots a burst across a broadside so the
 * things assertions cannot see are visible: how the ship sits in the water,
 * what a volley looks like leaving her side, whether a shot can be followed
 * across the sea, what a hit does. The whole naval-feel pass is judged on
 * these, so it takes the same sequence every time and writes the numbers that
 * frame it — camera distance, pitch, how much of the frame the ship fills —
 * beside the pictures.
 *
 *   node tools/battlelook.mjs [viewport] [tag]
 *
 * `tag` names the run (`before`, `after`, `camera2`…) so two passes can be put
 * side by side. Shots land in QA_OUT or shots/.
 */
import { launch, shot, sleep, ff, newVoyage, dismissModal, intoBattle, waitFor } from './qa.mjs';

const vp = process.argv[2] || 'desktop';
const tag = process.argv[3] || 'now';
const { browser, page, errors } = await launch(vp);
const G = (fn, a) => page.evaluate(fn, a);
const S = n => shot(page, `battle-${tag}-${vp}-${n}`);

await waitFor(page, () => {
  const l = document.getElementById('loading');
  return !!l && l.classList.contains('hidden');
}, 30000);
await sleep(400);
await newVoyage(page);
await dismissModal(page);

const foe = await intoBattle(page, { dist: 200 });
if (!foe) { console.log('could not get into an action'); await browser.close(); process.exit(1); }
console.log(`in action against ${foe.name} (${foe.cls})`);

/* Let the action settle into its own framing before the first picture: the
   camera eases into battle heat over a second or so, and a shot taken during
   that move is a photograph of the transition, not of the fight. */
await ff(page, 3);
await sleep(500);

const frame = () => G(() => {
  const g = window.__game, p = g.player, r = g.rig;
  const cam = r.cam;
  const e = (g.battle && g.battle.enemies || []).find(s => s.alive);
  /* How much of the frame does she fill? Project her waterline and a point at
     masthead height and measure the gap — "the ship has presence" is a number,
     not a feeling, and it is the number the reference is framed around. */
  const W = window.__worldToScreen;
  const rect = window.__renderer.domElement.getBoundingClientRect();
  let frac = null, onScreen = null, where = null, foeOn = null, foeAt = null;
  if (W) {
    const a = W(cam, p.x, 0, p.z, rect), b = W(cam, p.x, 8 + p.cls.masts * 7, p.z, rect);
    frac = Math.abs(b.y - a.y) / rect.height;
    onScreen = !a.behind && a.x > 0 && a.x < rect.width && a.y > 0 && a.y < rect.height;
    /* Where she sits in the frame, and whether the enemy is in it at all.
       Presence is not the only question: a hull that fills a sixth of the
       screen while parked in the bottom corner under the FIRE button is worse
       framing than the survey shot it replaced. */
    where = { x: +(a.x / rect.width).toFixed(2), y: +(a.y / rect.height).toFixed(2) };
    if (e) {
      const c = W(cam, e.x, 0, e.z, rect);
      foeOn = !c.behind && c.x > 0 && c.x < rect.width && c.y > 0 && c.y < rect.height;
      foeAt = { x: +(c.x / rect.width).toFixed(2), y: +(c.y / rect.height).toFixed(2) };
    }
  }
  return {
    dist: +r.distance.toFixed(0), pitch: +r.pitch.toFixed(2), heat: +r.heat.toFixed(2),
    fov: +cam.fov.toFixed(1), az: +r.azimuth.toFixed(2), yaw: +p.yaw.toFixed(2),
    camY: +cam.position.y.toFixed(0),
    spd: +p.speed.toFixed(1), thr: +p.throttle.toFixed(2),
    hull: Math.round(p.hullFrac * 100), shot: p.shot,
    foeD: e ? Math.round(Math.hypot(e.x - p.x, e.z - p.z)) : null,
    shipFrac: frac == null ? null : +frac.toFixed(3), onScreen, where, foeOn, foeAt,
  };
});

console.log('settled:', JSON.stringify(await frame()));
await S('01-settled');

/* Close to gun range under her own orders — the real helm, not a teleport. */
await G(() => {
  const g = window.__game, p = g.player;
  const e = (g.battle.enemies || []).find(s => s.alive);
  if (e) g.commandMove(e.x, e.z);
  p.throttle = 1;
});
for (let i = 0; i < 14; i++) {
  await ff(page, 1);
  const f = await frame();
  if (f.foeD != null && f.foeD < 190) break;
}
console.log('closed: ', JSON.stringify(await frame()));
await S('02-closed');

/* The broadside, shot as a burst. This is the sequence the whole pass is for:
   the muzzles, the smoke leaving her side, the shot crossing the water and
   whatever happens at the far end of it. */
const fired = await G(() => {
  const g = window.__game, p = g.player;
  const e = (g.battle.enemies || []).find(s => s.alive);
  if (!e) return null;
  // lay her broadside-on so a full battery bears, then give the order
  const b = Math.atan2(e.x - p.x, e.z - p.z);
  p.headingCmd = b - Math.PI / 2;
  return { d: Math.round(Math.hypot(e.x - p.x, e.z - p.z)) };
});
for (let i = 0; i < 10; i++) await ff(page, 1);
const volley = await G(() => {
  const g = window.__game, p = g.player;
  const e = (g.battle.enemies || []).find(s => s.alive);
  if (!e) return null;
  const before = p.shot;
  /* The real order, through the real path: mark her, let the game work out
     which side bears, then pull the trigger the button pulls. */
  g.target = e;
  g.fireSide = null;
  g.update(1 / 60);
  p.reload.port = 0; p.reload.stb = 0;
  g.playerFire();
  return { before, after: p.shot, side: g.fireSide,
    d: Math.round(Math.hypot(e.x - p.x, e.z - p.z)) };
});
console.log('volley:  ', JSON.stringify(volley), 'from', JSON.stringify(fired));
/* Six pictures across the two seconds after the order: muzzle, smoke, the
   shot in flight, and the far end. A single frame cannot show a volley. */
for (let i = 1; i <= 6; i++) {
  await ff(page, 1);
  await S(`03-volley-${i}`);
}
console.log('after:   ', JSON.stringify(await frame()));

/* And a picture of her under way, turning hard — where wake, heel and the
   camera's response to a turn all show at once. */
await G(() => {
  const g = window.__game, p = g.player;
  p.throttle = 1; p.dest = null; p.headingCmd = p.yaw + 2.2;
});
for (let i = 0; i < 6; i++) await ff(page, 1);
await S('04-turning');
console.log('turning: ', JSON.stringify(await frame()));

console.log(errors.length ? 'ERRORS: ' + [...new Set(errors)].slice(0, 4).join(' | ') : 'no console errors');
await browser.close();
process.exit(0);
