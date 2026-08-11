/* HUD layout audit: measures every visible control across viewports and
   reports anything that overflows the screen, overlaps another control,
   or is smaller than a comfortable touch target. */
import { launch, sleep, ff, VIEWPORTS } from './qa.mjs';

const TARGETS = [
  '#topbar', '#compass', '#leftstack', '#shipstatus', '#speedctl', '#actions',
  '#fleetbar', '#targetcard', '#hint', '#objective', '#paused-badge', '#objptr',
  '.act-btn.fire', '.act-btn.board', '.act-btn.dock', '.tc-close',
  '#ammo-strip', '.fleet-btn', '.spd', '#btn-menu',
];
const MIN_TAP = 44;

let bad = 0;
for (const vp of Object.keys(VIEWPORTS)) {
  const { browser, page } = await launch(vp);
  await sleep(900);
  await page.click('#btn-new');
  await sleep(1200);
  // force the busiest possible HUD: target + board + dock + fleet + hint + objective
  await page.evaluate(() => {
    const g = window.__game;
    g.player.x = -190; g.player.z = 400; g.player.speed = 0;
    const pir = g.ships.find(s => s.faction === 'pirate' && s.alive);
    if (pir) {
      pir.x = g.player.x + 24; pir.z = g.player.z + 4; pir.speed = 0;
      pir.sails = pir.sailMax * 0.2; pir.hostileToPlayer = true;
      g.selectTarget(pir);
    }
    const con = g.ships.find(s => s.role === 'merchant');
    if (con) { con.faction = 'player'; con.role = 'consort'; con.formSlot = 1; g.fleet.push(con); }
  });
  await ff(page, 1.5);
  await page.evaluate(() => {
    window.__hint && window.__hint();
  });
  // Two passes, because a hint and the objective chip are never lit together:
  //   A = a hint is up (the objective chip is muted, as hint() does)
  //   B = no hint, the objective chip is showing
  const poses = {
    A: () => {
      window.__ui.setObjective('Two ships under your flag. Use the fleet orders and take something bigger.');
      window.__ui.hint('Her rigging is gone. Come alongside, take way off, and <b>BOARD</b>.', 0);
    },
    B: () => {
      window.__ui.hideHint();
      window.__ui.setObjective('Hunt a Tally raider: black hull, red trim, a red flag. Follow the arrow, then tap her to mark her.');
    },
  };

  const measure = (args) => {
    const [sel, MIN] = args;
    const W = window.innerWidth, H = window.innerHeight;
    const boxes = [];
    for (const s of sel) {
      for (const n of document.querySelectorAll(s)) {
        const r = n.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || +cs.opacity < 0.05 || cs.visibility === 'hidden') continue;
        boxes.push({ sel: s, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    const problems = [];
    for (const b of boxes) {
      if (b.x < -1 || b.y < -1 || b.x + b.w > W + 1 || b.y + b.h > H + 1) {
        problems.push(`OFFSCREEN ${b.sel} [${b.x},${b.y} ${b.w}x${b.h}] vs ${W}x${H}`);
      }
      if (/btn|tab|\.spd|close/.test(b.sel) && (b.w < MIN || b.h < MIN)) {
        problems.push(`SMALL TAP ${b.sel} ${b.w}x${b.h}`);
      }
    }
    // pairwise overlap between distinct panels
    // controls that live inside a panel are expected to sit on it
    const panels = boxes.filter(b => !/\.(act|fleet)-btn|\.spd|\.tc-close|#ammo-strip|#btn-menu|#compass|#shipstatus|#speedctl/.test(b.sel));
    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        const a = panels[i], b = panels[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 6 && oy > 6) problems.push(`OVERLAP ${a.sel} x ${b.sel} (${ox}x${oy}px)`);
      }
    }
    const nt = document.getElementById('notices');
    const dbg = { notices: nt.className, top: getComputedStyle(nt).top,
                  card: document.getElementById('targetcard').className,
                  hintCls: document.getElementById('hint').className };
    return { W, H, boxes, problems, dbg };
  };

  let res = null;
  const allProblems = [];
  for (const key of ['A', 'B']) {
    await page.evaluate(poses[key]);
    await sleep(220);
    await page.evaluate(poses[key]);
    await sleep(220);
    const r = await page.evaluate(measure, [TARGETS, MIN_TAP]);
    if (key === 'A') res = r;
    for (const p of r.problems) allProblems.push(`[${key}] ${p}`);
  }

  console.log(`\n== ${vp}  ${res.W}x${res.H} ==`);
  for (const b of res.boxes) console.log(`   ${b.sel.padEnd(16)} ${String(b.x).padStart(5)},${String(b.y).padStart(4)}  ${b.w}x${b.h}`);
  const uniq = [...new Set(allProblems)];
  if (uniq.length) { bad += uniq.length; uniq.forEach(p => console.log('   !! ' + p)); }
  else console.log('   clean');
  await browser.close();
}
console.log(`\n${bad} layout problems`);
process.exit(bad ? 1 : 0);
