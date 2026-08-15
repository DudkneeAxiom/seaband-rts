/* Take the Helm: the questionnaire, what it does to a captain, and the story
   spine it feeds. Everything here goes through the real UI or the real rules. */
import { launch, sleep, ff, shot } from './qa.mjs';

const { browser, page, errors } = await launch('phone');
const log = [];
const ok = (m, c) => log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);
/* This machine renders in software, so fixed sleeps are a coin toss.
   Wait for the thing itself. */
const until = async (fn, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() - t0 > ms) return false;
    await sleep(120);
  }
};
const modalUp = () => until(() => !document.getElementById('modal').classList.contains('hidden'));
/* A chapter closes when the guns are quiet, which may be a few seconds after
   the deed — so run the world on rather than assuming an instant scene. */
/** Why the last wait gave up, for a failure that explains itself. */
let lastStall = null;
const ffUntilModal = async (max = 45) => {
  /* If one is still up, this returns instantly on the stale scene and every
     chapter after it reads the wrong card — which is exactly how this suite
     failed under load, reporting chapter one's title six chapters later.
     A scene has to be closed before we can wait for the next one. */
  const stale = await page.evaluate(() => !document.getElementById('modal').classList.contains('hidden'));
  if (stale) await dismiss();
  /* And give it the quiet it insists on. A scene never interrupts a fight, and
     "a fight" includes any hostile within 420 — so one raider loitering nearby
     holds the whole story indefinitely and this waits forty-five seconds for a
     card that was never going to come. The suite is testing whether the deed
     closes the chapter, not whether the game is polite about timing. */
  const quiet = () => page.evaluate(() => {
    const g = window.__game;
    for (const s of g.ships) {
      if (s.isPlayer || g.fleet.includes(s)) continue;
      if (s.nemesisId || s.isSant) continue;          // the story's own quarry stays
      s.x = 9e4; s.z = 9e4; s.hostileToPlayer = false; s.target = null;
    }
    g.combatHeat = 0;
  });
  for (let t = 0; t < max; t += 3) {
    // held for the whole wait, not set once: the world keeps its traffic topped
    // up, and a freshly spawned raider closing inside 420 puts the story back
    // on hold — forty-five seconds is plenty of time for that to happen
    await quiet();
    await ff(page, 3);
    if (await page.evaluate(() => !document.getElementById('modal').classList.contains('hidden'))) return true;
  }
  /* Say why. A scene that never came leaves the previous card's text in the
     DOM, so every assertion downstream reports the wrong title and none of
     them says what actually went wrong. */
  lastStall = await page.evaluate(() => {
    const g = window.__game, ch = g.currentChapter;
    return {
      chapter: g.chapter, id: ch && ch.id, done: ch ? !!ch.done(g) : null,
      sheet: !document.getElementById('sheet').classList.contains('hidden'),
      boardings: g.boardings.length, engaged: g.engaged, gameOver: g.gameOver,
    };
  });
  return false;
};
/* Dismiss it the way a player does, and make sure it went. The story will not
   advance while a scene is open, so a dismiss that quietly failed stalls
   everything after it — a fixed sleep here was not proof of anything. */
const dismiss = async () => {
  /* Wait for a scene with a button on it before reaching for the button. A
     single isVisible() at the wrong instant reports nothing there, and then
     this returns without clicking and leaves the scene standing — which the
     next wait reads as its own card. */
  const ready = await until(() => {
    const m = document.getElementById('modal');
    return !m.classList.contains('hidden') && !!document.querySelector('#modal-actions .btn');
  }, 4000);
  if (!ready) return false;
  await page.click('#modal-actions .btn');
  return until(() => document.getElementById('modal').classList.contains('hidden'), 6000);
};

await sleep(1000);
await page.click('#btn-new');
await sleep(700);

/* ---- the flow appears and asks the first question ---- */
const q1 = await page.evaluate(() => ({
  open: !document.getElementById('origin').classList.contains('hidden'),
  prompt: document.querySelector('.og-prompt')?.textContent,
  opts: [...document.querySelectorAll('.og-opt')].length,
  chips: [...document.querySelectorAll('.og-opt .og-chip')].map(c => c.textContent),
  dots: document.querySelectorAll('#og-dots i').length,
  titleGone: document.getElementById('title').classList.contains('out'),
}));
ok(`the questionnaire opens on the first question ("${q1.prompt}")`, q1.open && q1.opts === 3);
ok(`every option states what it does (${q1.chips.length} effects shown)`, q1.chips.length >= 6);
ok('the title screen steps aside', q1.titleGone);
await shot(page, 'origin-q1');

/* ---- tap through every question with known answers ---- */
const STEPS = ['birth', 'youth', 'berth', 'wrong', 'want'];
// tapped by their visible label — the flow is what a thumb sees
const LABELS = {
  birth: 'On the Admiralty’s lower deck',
  youth: 'A cutlass',
  berth: 'Powder monkey on a frigate',
  wrong: 'The Tally took the ship under you',
  want: 'To finish what the Tally started',
};
for (const s of STEPS) {
  await page.evaluate(label => {
    const card = [...document.querySelectorAll('.og-opt')]
      .find(c => c.querySelector('.og-lbl').textContent === label);
    card.click();
  }, LABELS[s]);
  await sleep(260);
}

/* ---- the summary adds up ---- */
const sum = await page.evaluate(() => ({
  ledger: [...document.querySelectorAll('.og-lrow')].map(r => r.textContent),
  traits: [...document.querySelectorAll('.og-trait b')].map(t => t.textContent),
  history: [...document.querySelectorAll('.og-hrow .og-hv')].map(t => t.textContent),
  name: document.querySelector('.og-input')?.value,
  go: !!document.querySelector('.og-go'),
}));
ok(`the summary lists all five answers (${sum.history.length})`, sum.history.length === 5);
ok(`traits accumulate (${sum.traits.join(', ')})`, sum.traits.includes('Powder-Born')
  && sum.traits.includes('Hard Hands') && sum.traits.includes('Left Breathing'));
ok(`the ledger totals the effects (${sum.ledger.length} lines)`, sum.ledger.length >= 5);
ok(`a captain is named (${sum.name})`, !!sum.name && sum.name.includes(' '));
await shot(page, 'origin-summary');

/* ---- rerolling the name changes it, and the field is editable ---- */
const before = sum.name;
await page.click('.og-dice');
await sleep(200);
await page.fill('.og-input', 'Vek Danaway');
await sleep(120);
const named = await page.evaluate(() => document.querySelector('.og-input').value);
ok(`the name rerolls and can be typed over (${before} -> ${named})`, named === 'Vek Danaway');

/* ---- MAKE SAIL starts the voyage with exactly what was promised ---- */
await page.click('.og-go');
await modalUp();
const started = await page.evaluate(() => {
  const g = window.__game, p = g.player;
  return {
    captain: g.origin.captain,
    picks: g.origin.picks,
    nemesis: g.origin.nemesis,
    ambition: g.origin.ambition,
    coin: g.coin,
    admiralty: g.standing.admiralty,
    shot: p.shot,
    crew: { ...p.crew },
    capt: { ...p.capt },
    modal: !document.getElementById('modal').classList.contains('hidden'),
    modalTitle: document.getElementById('modal-title').textContent,
    hudUp: !document.getElementById('hud').classList.contains('hidden'),
  };
});
ok(`the captain carries her name into the game (${started.captain})`, started.captain === 'Vek Danaway');
ok(`the answers are the ones given (${JSON.stringify(started.picks)})`,
  started.picks.birth === 'lowerdeck' && started.picks.want === 'settle');
ok(`"born on the lower deck" is worth Admiralty standing (${started.admiralty})`, started.admiralty === 12);
// 16 base + 12 for the powder monkey + 10 for going to sea to settle it
ok(`a powder monkey starts with more shot (${started.shot})`, started.shot === 38);
// 1 base + 1 for the cutlass + 1 for what the Tally did
ok(`a cutlass upbringing puts marines aboard (${started.crew.marine})`, started.crew.marine === 3);
// 12 lower deck + 14 powder monkey + 6 ambition
ok(`gunnery accumulates across three answers (+${Math.round(started.capt.gun * 100)}%)`,
  Math.abs(started.capt.gun - 0.32) < 0.001);
ok(`the fourth answer names an enemy (${started.nemesis})`, started.nemesis === 'vell');
ok(`the opening scene is the captain's own (${started.modalTitle})`, started.modal && started.modalTitle === 'Vek Danaway');
ok('the HUD is up behind it', started.hudUp);
await shot(page, 'origin-opening');

/* ---- the captain's skill is real, not decorative ---- */
const skill = await page.evaluate(() => {
  const g = window.__game, p = g.player;
  const withCapt = p.crewSkill('gun');
  const saved = p.capt; p.capt = null;
  const without = p.crewSkill('gun');
  p.capt = saved;
  return { withCapt, without };
});
ok(`gunnery skill is actually raised (${skill.without.toFixed(2)} -> ${skill.withCapt.toFixed(2)})`,
  skill.withCapt > skill.without * 1.2);

/* ---- haggling moves harbour prices ---- */
const prices = await page.evaluate(() => {
  const m = window.__game.market;
  const h = m.haggle;
  m.haggle = 0;
  const plain = { buy: m.buyPrice('ilovantu', 'iron'), sell: m.sellPrice('ilovantu', 'iron') };
  m.haggle = 0.3;
  const sharp = { buy: m.buyPrice('ilovantu', 'iron'), sell: m.sellPrice('ilovantu', 'iron') };
  m.haggle = h;
  return { plain, sharp };
});
ok(`a haggler buys cheaper and sells dearer (${prices.plain.buy}/${prices.plain.sell} -> ${prices.sharp.buy}/${prices.sharp.sell})`,
  prices.sharp.buy < prices.plain.buy && prices.sharp.sell > prices.plain.sell);

/* ---- shoal-wise halves grounding damage ---- */
const shoal = await page.evaluate(() => {
  const p = window.__game.player;
  const h0 = p.hull; p.shoalwise = false;
  p.damage(10, 'round', null, true);
  const plain = h0 - p.hull;
  p.hull = h0; p.shoalwise = true;
  p.damage(10 * 0.35, 'round', null, true);
  const wise = h0 - p.hull;
  p.hull = h0; p.shoalwise = window.__game.origin.picks.youth === 'net';
  return { plain, wise };
});
ok(`shoal-wise captains take less off a reef (${shoal.plain.toFixed(1)} -> ${shoal.wise.toFixed(1)})`,
  shoal.wise < shoal.plain * 0.6);

/* ---- ambition changes what a fight is worth ---- */
const worth = await page.evaluate(() => {
  const g = window.__game;
  const a = g.origin.ambition;
  g.origin.ambition = 'clear'; const clear = { coin: g.coinMult, pres: g.prestigeMult(true) };
  g.origin.ambition = 'settle'; const settle = { coin: g.coinMult, pres: g.prestigeMult(true) };
  g.origin.ambition = 'known'; const known = { coin: g.coinMult, pres: g.prestigeMult(false) };
  g.origin.ambition = a;
  return { clear, settle, known };
});
ok(`"clear the debt" pays more coin (x${worth.clear.coin})`, worth.clear.coin === 1.2);
ok(`"settle the account" pays more prestige for a pirate (x${worth.settle.pres})`, worth.settle.pres === 1.5);
ok(`"make a name" pays more prestige for everything (x${worth.known.pres})`, worth.known.pres === 1.25);

/* ---- the story spine: objective, chapters, the named enemy ---- */
await dismiss();
ok('dismissing the opening scene lets the world run', !(await page.evaluate(() => window.__game.paused)));
const story = await page.evaluate(() => {
  const g = window.__game;
  return {
    chapter: g.chapter,
    title: g.chapterText(g.currentChapter, 'title'),
    obj: document.getElementById('obj-text').innerHTML,
    total: window.__chapters,
  };
});
ok(`the voyage opens on chapter one ("${story.title}")`, story.chapter === 0 && /Ilo Vantu/.test(story.obj));

/* Dock, and the first chapter closes with its own scene.
   Through the game's own `enterPort` — the call the DOCK button makes — rather
   than by setting `hintState.docked` by hand. The chapter names Ilo Vantu and
   now checks for Ilo Vantu, so a fabricated "docked somewhere" flag no longer
   stands for having been there; and faking the flag was the thing this repo's
   own rules tell you not to do. */
await page.evaluate(() => {
  const g = window.__game;
  const port = g.PORTS.find(p => p.id === 'ilovantu');
  g.player.x = port.x; g.player.z = port.z; g.player.speed = 0;
  g.enterPort(port);
  g.leavePort();
  document.getElementById('sheet').classList.add('hidden');
  g.paused = false;
});
await ffUntilModal();
const ch1 = await page.evaluate(() => ({
  chapter: window.__game.chapter,
  title: document.getElementById('modal-title').textContent,
  text: document.getElementById('modal-text').textContent,
  open: !document.getElementById('modal').classList.contains('hidden'),
  paused: window.__game.paused,
}));
ok(`making port closes chapter one ("${ch1.title}", chapter ${ch1.chapter}, open ${ch1.open}${lastStall ? ', stalled ' + JSON.stringify(lastStall) : ''})`,
  ch1.open && ch1.chapter === 1 && ch1.title === 'Ship’s Stores');
ok('and the scene previews what comes next', /purse|harbourmaster/i.test(ch1.text));
ok('the world holds still while you read', ch1.paused);
await shot(page, 'origin-chapter');

// run the spine forward to the personal chapter
await dismiss();
await page.evaluate(() => {
  const g = window.__game;
  g.chapter = 4;                       // the chapter that is about your enemy
  const ch = g.currentChapter;
  if (ch.onOpen) ch.onOpen(g);
});
await sleep(400);
const nem = await page.evaluate(() => {
  const g = window.__game;
  const s = g.ships.find(x => x.nemesisId);
  return {
    title: g.chapterText(g.currentChapter, 'title'),
    obj: g.chapterText(g.currentChapter, 'obj'),
    ship: s && s.name, captain: s && s.captainName, hostile: s && s.faction,
    reserved: g.reservedNames(),
    dupes: g.ships.filter(x => x.name === (s && s.name)).length,
  };
});
ok(`the enemy your past named is a real ship (${nem.captain} in the ${nem.ship})`,
  nem.ship === 'Third Name' && nem.captain === 'Corran Vell' && nem.hostile === 'pirate');
ok(`the chapter is titled for him ("${nem.title}")`, /Let You Live/.test(nem.title));
ok('no random hull steals her name', nem.dupes === 1 && nem.reserved.includes('Third Name'));

// sink him, and the story moves on
await page.evaluate(() => {
  const g = window.__game;
  const s = g.ships.find(x => x.nemesisId);
  g.onKill(s, g.player);
});
await ffUntilModal();
const after = await page.evaluate(() => ({
  down: window.__game.nemesisDown,
  chapter: window.__game.chapter,
  title: document.getElementById('modal-title').textContent,
  text: document.getElementById('modal-text').textContent,
}));
ok('putting him down closes his chapter', after.down && after.chapter === 5);
ok(`and hands you the last name ("${after.title}")`, /Long Answer|Sant/.test(after.text));

/* ---- the ending is the one you asked for ---- */
await dismiss();
await page.evaluate(() => { window.__game.santDown = true; });
await ffUntilModal();
const end = await page.evaluate(() => ({
  over: window.__game.storyOver,
  title: document.getElementById('modal-title').textContent,
  text: document.getElementById('modal-text').textContent,
}));
ok(`"settle the account" gets its own ending ("${end.title}")`,
  end.over && end.title === 'The Account is Closed');
ok('and the epilogue names the captain', /Vek Danaway/.test(end.text));
await shot(page, 'origin-ending');

/* ---- it all survives a save and reload ---- */
await dismiss();
await page.evaluate(() => window.__game.save());
await sleep(400);
await page.reload();
await sleep(1600);
await page.click('#btn-continue');
await sleep(1600);
const reloaded = await page.evaluate(() => {
  const g = window.__game;
  return {
    captain: g.origin.captain, picks: g.origin.picks, chapter: g.chapter,
    over: g.storyOver, capt: g.player.capt.gun, haggle: g.market.haggle,
    originOpen: !document.getElementById('origin').classList.contains('hidden'),
  };
});
ok(`the captain survives a reload (${reloaded.captain}, chapter ${reloaded.chapter})`,
  reloaded.captain === 'Vek Danaway' && reloaded.over === true);
ok(`her skills are rebuilt from the answers (+${Math.round(reloaded.capt * 100)}% gunnery)`,
  Math.abs(reloaded.capt - 0.32) < 0.001);
ok(`and so is the haggling the harbour sees (${reloaded.haggle})`, reloaded.haggle === 0);
ok('continuing does not ask the questions again', !reloaded.originOpen);

/* ---- the skip is there for a player in a hurry ---- */
await page.evaluate(() => { try { localStorage.clear(); } catch (e) { void e; } });
await page.reload();
await sleep(1500);
await page.click('#btn-new');
await sleep(600);
await page.click('#og-skip');
await sleep(400);
const skipped = await page.evaluate(() => ({
  answered: document.querySelectorAll('.og-hrow').length,
  go: !!document.querySelector('.og-go'),
}));
ok('SKIP rolls a whole captain and jumps to the summary', skipped.answered === 5 && skipped.go);

/* ---- and you can go back and change your mind ---- */
await page.evaluate(() => document.querySelectorAll('.og-hrow')[1].click());
await sleep(300);
const back = await page.evaluate(() => ({
  prompt: document.querySelector('.og-prompt')?.textContent,
  marked: document.querySelectorAll('.og-opt.on').length,
}));
ok(`tapping an answer on the summary goes back to it ("${back.prompt}")`,
  /hands/.test(back.prompt || '') && back.marked === 1);

/* ---- the whole flow fits a small phone in both poses ---- */
for (const [w, h, pose] of [[667, 375, 'a small landscape phone'], [390, 844, 'portrait']]) {
  await page.setViewportSize({ width: w, height: h });
  await sleep(500);
  const fit = await page.evaluate(() => {
    const inner = document.getElementById('og-inner');
    const wide = [...document.querySelectorAll('.og-opt, .og-hrow, .og-lrow, .og-go')]
      .filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).length;
    const small = [...document.querySelectorAll('.og-opt, .og-nav, .og-go, .og-dice')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.height < 40 || r.width < 40; }).length;
    return { wide, small, scrollable: inner.scrollHeight >= inner.clientHeight,
      overflowX: document.documentElement.scrollWidth <= window.innerWidth + 1 };
  });
  ok(`the questions fit ${pose} without spilling sideways`, fit.wide === 0 && fit.overflowX);
  ok(`and every control there is still thumb-sized on ${pose}`, fit.small === 0);
}
// and MAKE SAIL is reachable, not stranded off the bottom
await page.click('#og-skip');
await sleep(350);
const reach = await page.evaluate(async () => {
  const go = document.querySelector('.og-go');
  go.scrollIntoView({ block: 'end' });
  await new Promise(r => setTimeout(r, 200));
  const r = go.getBoundingClientRect();
  return r.bottom <= window.innerHeight + 1 && r.top >= 0;
});
ok('MAKE SAIL can always be scrolled to', reach);

/* ---- a chapter closes on the deed it names, and on nothing else ----

   Reported: the story "feels random and just like a pop up after completing
   normal gameplay". Three of the six chapters were closing on something other
   than what they described, and the early three at that — the ones a new
   captain meets:

     "Make Ilo Vantu and dock"                closed on docking anywhere
     "Find a Tally raider — black hull"       closed on taking any hull at all
     "board her, and keep her"                closed on any second ship

   So taking a Compact trader printed "One Tally hull fewer", and putting into
   Marasay closed a chapter that had asked for Ilo Vantu. A story that fires on
   deeds you did not do is a story that reads as a pop-up watching you play. */
const spine = await page.evaluate(async () => {
  const O = await import('/src/data/origins.js');
  const g = window.__game;
  const CH = O.CHAPTERS;
  const ch = id => CH.find(c => c.id === id);
  const clean = () => {
    g.hintState = {};
    g.stats = { sunk: 0, captured: 0, broadsides: 0, distance: 0, crewLost: 0, tally: 0 };
    g.quests = [];
    while (g.fleet.length > 1) g.fleet.pop();
  };
  const ask = (id, set) => { clean(); set(); return !!ch(id).done(g); };
  const out = {
    storesWrongPort: ask('stores', () => { g.hintState.docked = 1; g.hintState.port_marasay = 1; }),
    storesRightPort: ask('stores', () => { g.hintState.docked = 1; g.hintState.port_ilovantu = 1; }),
    bloodAnyHull: ask('blood', () => { g.stats.captured = 1; g.stats.sunk = 1; }),
    bloodTally: ask('blood', () => { g.stats.tally = 1; }),
    consortBought: ask('consort', () => { g.fleet.push(g.player); }),
    consortTaken: ask('consort', () => { g.fleet.push(g.player); g.stats.captured = 1; }),
  };
  clean();
  return out;
});
ok(`"Make Ilo Vantu and dock" wants Ilo Vantu (elsewhere ${spine.storesWrongPort ? 'CLOSES IT' : 'does not'}, `
  + `Ilo Vantu ${spine.storesRightPort ? 'does' : 'DOES NOT'})`,
  !spine.storesWrongPort && spine.storesRightPort);
ok(`"Find a Tally raider" wants a Tally (any hull ${spine.bloodAnyHull ? 'CLOSES IT' : 'does not'}, `
  + `a Tally ${spine.bloodTally ? 'does' : 'DOES NOT'})`,
  !spine.bloodAnyHull && spine.bloodTally);
ok(`"board her, and keep her" wants her boarded (a second hull alone `
  + `${spine.consortBought ? 'CLOSES IT' : 'does not'}, one taken ${spine.consortTaken ? 'does' : 'DOES NOT'})`,
  !spine.consortBought && spine.consortTaken);


console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 6).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
