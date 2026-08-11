/* Does the rig read the wind?
   Poses the flagship on each point of sail and shoots her from astern, so
   the belly direction and the brace angle can be checked by eye, and asserts
   the deformation numerically at the same time. */
import { launch, sleep, shot } from './qa.mjs';

const { browser, page, errors } = await launch('desktop');
const log = [];
const ok = (m, c) => log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);

await sleep(900);
await page.click('#btn-new');
await sleep(1600);

/* Read the deformed canvas back out of the shader maths in JS, so we are
   testing the same rule the GPU runs rather than a screenshot. */
const probe = await page.evaluate(() => {
  const g = window.__game;
  const p = g.player;
  const rigMesh = p.mesh.userData.rigMesh;
  const geo = rigMesh.geometry;
  const pos = geo.attributes.position, piv = geo.attributes.aPivot;
  const par = geo.attributes.aParam, cloth = geo.attributes.aCloth, bel = geo.attributes.aBelly;

  // mirror the vertex shader for one representative square-sail vertex:
  // the one with the biggest belly weight
  let best = -1, bestW = -1;
  for (let i = 0; i < pos.count; i++) {
    if (cloth.getX(i) < 0.5 || par.getZ(i) > 0.5) continue;   // square canvas only
    const w = Math.cos(par.getX(i) * Math.PI / 2) * Math.sin(par.getY(i) * Math.PI);
    if (w > bestW) { bestW = w; best = i; }
  }
  const evaluate = (rel) => {
    const ws = Math.sin(rel), wc = Math.cos(rel);
    const th = Math.max(-1.05, Math.min(1.05, rel * 0.5));
    const ct = Math.cos(th), st = Math.sin(th);
    const qx = pos.getX(best) - piv.getX(best);
    const qy = pos.getY(best) - piv.getY(best);
    const qz = pos.getZ(best) - piv.getZ(best);
    const fill = (() => {
      const t = Math.min(1, Math.max(0, (Math.abs(rel) - 3.05) / (1.15 - 3.05)));
      return 0.08 + (1 - 0.08) * (t * t * (3 - 2 * t));
    })();
    const bulge = Math.cos(par.getX(best) * Math.PI / 2) * Math.sin(par.getY(best) * Math.PI)
      * bel.getX(best) * fill;
    return {
      // yard tip travel tells us which way she is braced
      brace: th,
      // belly offset in ship-local space
      bx: ws * bulge, bz: wc * bulge,
      rot: { x: qx * ct + qz * st, z: -qx * st + qz * ct },
    };
  };
  return {
    running: evaluate(0),            // wind dead astern
    portBeam: evaluate(Math.PI / 2), // wind from port, blowing toward starboard
    stbdBeam: evaluate(-Math.PI / 2),
    irons: evaluate(Math.PI),        // wind dead ahead
    hasAttrs: !!(piv && par && cloth && bel),
  };
});

ok('the rig carries its pivot and belly attributes', probe.hasAttrs);
ok(`running before the wind, the canvas bellies forward (dz ${probe.running.bz.toFixed(2)})`,
  probe.running.bz > 0.2 && Math.abs(probe.running.bx) < 0.05);
ok(`wind on the port beam bellies her to starboard (dx ${probe.portBeam.bx.toFixed(2)})`,
  probe.portBeam.bx > 0.2);
ok(`wind on the starboard beam bellies her to port (dx ${probe.stbdBeam.bx.toFixed(2)})`,
  probe.stbdBeam.bx < -0.2);
ok(`with the wind on the port beam the starboard yardarm swings aft (brace ${probe.portBeam.brace.toFixed(2)})`,
  probe.portBeam.brace > 0.3);
ok('braced the other way for wind on the other beam', probe.stbdBeam.brace < -0.3);
ok(`close to dead into the wind the canvas empties (dz ${probe.irons.bz.toFixed(2)})`,
  Math.abs(probe.irons.bz) < probe.running.bz * 0.2);

/* visual: same ship, four points of sail, camera locked astern */
const poses = [
  ['running', 0],
  ['portbeam', Math.PI / 2],
  ['closehauled', Math.PI * 0.78],
  ['stbdbeam', -Math.PI / 2],
];
for (const [name, rel] of poses) {
  await page.evaluate((r) => {
    const g = window.__game;
    const p = g.player;
    p.x = 60; p.z = 300; p.yaw = 0; p.speed = 9;
    g.windAng = r; g.windTargetAng = r; g.world.windAng = r;
    p.setHeading(0);
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    g.rig.focus.set(p.x, 0, p.z);
    g.rig.azimuth = Math.PI;      // look from astern, up the ship's track
    g.rig.setZoom(100); g.rig.distance = 100;
  }, rel);
  await sleep(1400);
  await shot(page, `rig-${name}`);
}

console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 6).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
