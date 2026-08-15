/* HUD layout audit: measures every visible control across viewports and
   reports anything that overflows the screen, overlaps another control,
   or is smaller than a comfortable touch target. */
import { launch, sleep, ff, newVoyage, dismissModal, waitFor, VIEWPORTS } from './qa.mjs';

const TARGETS = [
  '#topbar', '#compass', '#leftstack', '#shipstatus', '#speedctl', '#actions',
  '#fleetbar', '#targetcard', '#hint', '#objective', '#paused-badge', '#objptr',
  /* The three panels the audit could not see. #pursuit and #targetcard were
     pinned to the same corner at the same height and drew straight over one
     another for as long as the pursuit panel has existed; neither this list
     nor any assertion ever looked. A tester's screenshot found it. */
  '#pursuit', '#battlebar', '#notices',
  '.act-btn.fire', '.act-btn.board', '.act-btn.dock', '.tc-close',
  '#ammo-strip', '.fleet-btn', '.spd', '#btn-menu',
];
const MIN_TAP = 44;

let bad = 0;
for (const vp of Object.keys(VIEWPORTS)) {
  const { browser, page } = await launch(vp);
  await sleep(900);
  await newVoyage(page);
  /* The opening scene is a modal, and a modal holds the world: no simulation
     runs, so nothing recomputes who is chasing you and the HUD has nothing
     new to draw. Every other suite closes it; this one never did, which is
     why its screen was empty and its verdict meaningless. */
  await dismissModal(page);
  /* Force the busiest HUD there is, and check afterwards that it is actually
     up. This staged a hostile twenty-four metres off, which is inside contact
     range: the encounter opened, the target was cleared, the world paused,
     and the audit spent five viewports measuring an empty screen while
     reporting no overlaps. It is the pursuit panel and the target card that
     collide, and neither was ever on screen to be measured. */
  const staged = await page.evaluate(() => {
    const g = window.__game, p = g.player;
    p.x = -190; p.z = 400; p.speed = 0;
    /* Close enough to be committed and closing, far enough that she does not
       come aboard us mid-measurement and stop the world. */
    let pir = g.ships.find(s => s.faction === 'pirate' && s.alive && !g.fleet.includes(s));
    for (let i = 0; i < 20 && !pir; i++) pir = g.spawnNPC('pirate');
    if (pir) {
      pir.x = p.x + 260; pir.z = p.z + 40; pir.speed = 6;
      pir.sails = pir.sailMax;
      pir.hostileToPlayer = true; pir.target = p; pir.chaseHold = 0; pir.fleeing = false;
      g.selectTarget(pir);
    }
    g.encounterCooling = 900;      // no contact while we are measuring
    let con = g.ships.find(s => s.role === 'merchant' && !g.fleet.includes(s));
    if (!con) con = g.ships.find(s => !s.isPlayer && s.alive && !g.fleet.includes(s) && s !== pir);
    if (con) {
      con.faction = 'player'; con.role = 'consort'; con.formSlot = 1;
      con.x = p.x + 40; con.z = p.z + 30;
      g.fleet.push(con);
    }
    return { pir: !!pir, con: !!con };
  });

  /* Hold the pose while the tape measure is out, and let the world turn over
     enough to notice her. A raider chasing a fleet of two may decide she is
     outmatched and break off, which is the AI being right and the panel
     correctly going away — but this is a layout audit, and what these look
     like when they are up is the whole question. */
  const hold = () => page.evaluate(() => {
    const g = window.__game;
    const pir = g.ships.find(s => s.faction === 'pirate' && s.alive && !g.fleet.includes(s));
    if (pir) {
      pir.hostileToPlayer = true; pir.target = g.player;
      pir.fleeing = false; pir.chaseHold = 0;
    }
    g.encounterCooling = 900;
  });
  await hold();
  await ff(page, 1);
  await hold();

  /* And wait for the HUD to draw rather than sleeping and hoping: ff()
     advances the simulation, the panels are redrawn by the render loop, and
     at software-GL frame rates a couple of hundred milliseconds can be no
     frames at all. */
  await waitFor(page, () => {
    const seen = id => {
      const n = document.getElementById(id);
      return !!n && !n.classList.contains('hidden') && n.getBoundingClientRect().width > 1;
    };
    return seen('targetcard') && seen('fleetbar') && seen('pursuit');
  }, 20000);
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
        boxes.push({ sel: s, node: n, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
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
        /* A panel sitting inside another panel is not two things colliding,
           it is one thing containing the other — which is exactly what the
           fleet bar does in the left-hand column on a narrow screen. The
           selector list above was approximating this rule; ask the DOM. */
        if (a.node.contains(b.node) || b.node.contains(a.node)) continue;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 6 && oy > 6) problems.push(`OVERLAP ${a.sel} x ${b.sel} (${ox}x${oy}px)`);
      }
    }
    const nt = document.getElementById('notices');
    const dbg = { notices: nt.className, top: getComputedStyle(nt).top,
                  card: document.getElementById('targetcard').className,
                  hintCls: document.getElementById('hint').className };
    // nodes cannot cross back out of the page, and nothing outside wants them
    return { W, H, boxes: boxes.map(({ node, ...b }) => b), problems, dbg };
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

  /* A clean sheet is only worth anything if the sheet was full. */
  const up = await page.evaluate(() => {
    const seen = id => {
      const n = document.getElementById(id);
      return !!n && !n.classList.contains('hidden') && n.getBoundingClientRect().width > 1;
    };
    const g = window.__game;
    return {
      pursuit: seen('pursuit'), target: seen('targetcard'), fleet: seen('fleetbar'),
      why: `mode ${g.mode}, pursuit ${g.pursuit ? 'set' : 'none'}, target `
        + `${g.target ? g.target.name : 'none'}, fleet ${g.fleet.length}, paused ${g.paused}`,
    };
  });
  const missing = ['pursuit', 'target', 'fleet'].filter(k => !up[k]);
  if (missing.length) {
    bad++;
    console.log(`\n   !! NOTHING TO MEASURE: ${missing.join(', ')} never came up — ${up.why}`);
  }

  console.log(`\n== ${vp}  ${res.W}x${res.H} ==  staged ${JSON.stringify(staged)}`);
  for (const b of res.boxes) console.log(`   ${b.sel.padEnd(16)} ${String(b.x).padStart(5)},${String(b.y).padStart(4)}  ${b.w}x${b.h}`);
  const uniq = [...new Set(allProblems)];
  if (uniq.length) { bad += uniq.length; uniq.forEach(p => console.log('   !! ' + p)); }
  else console.log('   clean');
  await browser.close();
}
console.log(`\n${bad} layout problems`);
process.exit(bad ? 1 : 0);
