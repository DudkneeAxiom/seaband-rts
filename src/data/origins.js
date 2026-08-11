/* ===========================================================
   Salt & Tally — where a captain comes from.

   Five questions asked before the first sail is set. Each answer
   is a real modifier, not flavour: standing with a faction, coin
   in the strongbox, hands on the deck, and a captain's own
   competence at working a ship, laying a gun and holding a rail.

   The fourth answer also decides who wronged you, which is the
   spine the story hangs on. The fifth decides what you want out
   of it, which is how the story ends.
   =========================================================== */

/* Effect grammar — every field is optional:
     coin        n            added to the strongbox
     standing    {fac: n}     faction standing
     capt        {sail|gun|fight|trade: f}   captain's own skill, as a fraction
     crew        {rank: n}    hands aboard at the start
     provisions  n
     shot        n
     hull        f            fraction of hull repaired above the default
     nemesis     id           the name you are owed an answer by
     ambition    id           what you are sailing for
     trait       {name, tip}  shown on the captain's sheet
*/

export const ORIGIN_STEPS = [
  {
    id: 'birth',
    kicker: 'YOUR PEOPLE',
    prompt: 'Where were you born?',
    lede: 'The Shoals take all comers. They just remember where you came in from.',
    options: [
      {
        id: 'shore',
        label: 'On the Vantu shore',
        text: 'A stilt house over green water, and a tide that came in under the floor twice a day. You could read a channel before you could read.',
        trait: { name: 'Islander', tip: 'The Freeholds count you one of their own.' },
        fx: { standing: { freehold: 12 }, capt: { sail: 0.12 }, crew: { sailor: 1 } },
      },
      {
        id: 'counting',
        label: 'Above an Ambrine counting-house',
        text: 'Ink, tallow, and the smell of somebody else’s cargo coming up through the floorboards. You learned what a thing is worth before you learned what it is.',
        trait: { name: 'Counting-house Born', tip: 'Numbers hold no terror for you.' },
        fx: { standing: { compact: 12 }, coin: 180, capt: { trade: 0.08 } },
      },
      {
        id: 'lowerdeck',
        label: 'On the Admiralty’s lower deck',
        text: 'Between the guns, to a gunner’s wife, in a ship that was three weeks from a shore anyone would call home.',
        trait: { name: 'Powder-Born', tip: 'A gun deck has never frightened you.' },
        fx: { standing: { admiralty: 12 }, capt: { gun: 0.12 }, crew: { gunner: 1 } },
      },
    ],
  },
  {
    id: 'youth',
    kicker: 'YOUR CHILDHOOD',
    prompt: 'What did they put in your hands?',
    lede: 'Every household in the Shoals hands a child something. It is usually a warning.',
    options: [
      {
        id: 'net',
        label: 'A net',
        text: 'You worked the shallows before you were tall enough to see over the gunwale, and you learned where the water goes thin.',
        trait: { name: 'Shoalwise', tip: 'You read thin water. Grounding costs you far less.' },
        fx: { capt: { sail: 0.10 }, provisions: 14 },
      },
      {
        id: 'ledger',
        label: 'A ledger',
        text: 'Columns, and a clear understanding of what happens to a family that gets them wrong.',
        trait: { name: 'Sharp Pencil', tip: 'Harbours quote you a better number.' },
        fx: { capt: { trade: 0.12 }, coin: 120 },
      },
      {
        id: 'cutlass',
        label: 'A cutlass',
        text: 'Your household had enemies and no illusions about them. You were taught the short answer early.',
        trait: { name: 'Hard Hands', tip: 'You are worth two on a boarding rail.' },
        fx: { capt: { fight: 0.14 }, crew: { marine: 1 } },
      },
    ],
  },
  {
    id: 'berth',
    kicker: 'YOUR FIRST BERTH',
    prompt: 'Where did you get your first berth?',
    lede: 'Nobody is given a deck. You are given a corner of one and told to be useful.',
    options: [
      {
        id: 'boy',
        label: 'Ship’s boy on a Compact fluyt',
        text: 'Four years of carrying other men’s cargo across other men’s water, and being paid at the end of it in most of what you were promised.',
        fx: { capt: { trade: 0.08 }, coin: 110, provisions: 10, standing: { compact: 5 } },
      },
      {
        id: 'powder',
        label: 'Powder monkey on a frigate',
        text: 'You could serve a gun before you could shave, and you have never once flinched at the sound.',
        fx: { capt: { gun: 0.14 }, shot: 12 },
      },
      {
        id: 'oar',
        label: 'An oar in a Freehold smuggler',
        text: 'Night work. No lights, no names, and a very good understanding of which reefs will take a keel off.',
        fx: { capt: { sail: 0.14 }, standing: { freehold: 6 }, hull: 0.12 },
      },
    ],
  },
  {
    id: 'wrong',
    kicker: 'WHAT PUT YOU HERE',
    prompt: 'And then it went wrong.',
    lede: 'Nobody buys a tired cutter and thirteen hands because things were going well.',
    options: [
      {
        id: 'taken',
        label: 'The Tally took the ship under you',
        text: 'They took her in an afternoon, without hurrying. The man who decided you could go on breathing did not trouble to learn your name.',
        trait: { name: 'Left Breathing', tip: 'Corran Vell does not know you are coming.' },
        fx: { nemesis: 'vell', capt: { fight: 0.10 }, crew: { marine: 1 } },
      },
      {
        id: 'pressed',
        label: 'You were pressed, and you walked',
        text: 'Eleven months on a ship you never chose, and one dark night at Escarra you chose otherwise. There is paper with your name on it and a price underneath.',
        trait: { name: 'Marked Deserter', tip: 'The Admiralty has not forgotten. Somebody is collecting.' },
        fx: { nemesis: 'duhan', standing: { admiralty: -18 }, crew: { veteran: 1 } },
      },
      {
        id: 'sank',
        label: 'You backed a cargo and it went down',
        text: 'Everything you had, under sixty fathoms. The man who wrote the insurance found a clause, and then found better company.',
        trait: { name: 'Owed', tip: 'Ovar Nimm has your money and his freedom.' },
        fx: { nemesis: 'nimm', capt: { trade: 0.10 }, coin: 60 },
      },
    ],
  },
  {
    id: 'want',
    kicker: 'WHY YOU SAIL',
    prompt: 'So what do you want?',
    lede: 'Say it plainly. You will be asked again, by people with guns.',
    options: [
      {
        id: 'clear',
        label: 'To sail out from under what I owe',
        text: 'Money first, and quiet after. You would take a dull passage over a glorious one every day of the week.',
        fx: { ambition: 'clear', coin: 90 },
      },
      {
        id: 'settle',
        label: 'To finish what the Tally started',
        text: 'You did not buy this ship to carry cloth. You bought her because she has four guns.',
        fx: { ambition: 'settle', shot: 10, capt: { gun: 0.06 } },
      },
      {
        id: 'known',
        label: 'To be a name people say carefully',
        text: 'There are two hundred captains in these islands and nobody can name six. You intend to fix that.',
        fx: { ambition: 'known', capt: { fight: 0.06 } },
      },
    ],
  },
];

/* What each ambition is worth, mechanically. */
export const AMBITIONS = {
  clear: {
    id: 'clear', name: 'Clear the Debt',
    tip: 'Contracts and salvage pay you a fifth again.',
    line: 'to get out from under what you owe',
  },
  settle: {
    id: 'settle', name: 'Settle the Account',
    tip: 'Half again the prestige for every Tally hull you put down.',
    line: 'to finish what the Tally started',
  },
  known: {
    id: 'known', name: 'Make a Name',
    tip: 'A quarter more prestige from everything — and the Tally hear of you sooner.',
    line: 'to be a name people say carefully',
  },
};

/* The three people the fourth question can leave you owing an answer.
   Each is a real, named, findable ship. */
export const NEMESES = {
  vell: {
    id: 'vell', name: 'Corran Vell', ship: 'Third Name', classId: 'lugger',
    chapter: 'The Man Who Let You Live',
    open: 'A Freehold pilot puts a mug down and says he saw the <i>Third Name</i> two days ago, standing east with her sweeps out. Corran Vell still has the ship he took from under you. He has painted over the name.',
    brief: 'Find <b>Corran Vell</b> in the lugger <i>Third Name</i> and take your answer.',
    kill: 'Vell goes over the rail still arguing. You look for the old name under the new paint and find it, three coats down, exactly where you knew it would be.',
    crew: { marine: 5, veteran: 3, gunner: 3 },
  },
  duhan: {
    id: 'duhan', name: 'Hesk Duhan', ship: 'Debt Collector', classId: 'lugger',
    chapter: 'The Price on Your Head',
    open: 'The harbourmaster is careful not to look at you while he says it. A lugger called the <i>Debt Collector</i> has been asking after a deserter by your description. Hesk Duhan takes Admiralty bounties and is not fussy about delivering them alive.',
    brief: 'Find <b>Hesk Duhan</b> in the <i>Debt Collector</i> before he finds you.',
    kill: 'Duhan had your name written down twice, in two hands, on two different warrants. You put both over the side and watch the ink go.',
    crew: { marine: 6, veteran: 3, gunner: 2 },
  },
  nimm: {
    id: 'nimm', name: 'Ovar Nimm', ship: 'Widow’s Portion', classId: 'lugger',
    chapter: 'The Man Who Found a Clause',
    open: 'A Compact clerk sells you the position for four coins and looks relieved to be rid of it. Ovar Nimm fences for the Tally now, out of a lugger called the <i>Widow’s Portion</i>, which is the kind of joke he would make.',
    brief: 'Find <b>Ovar Nimm</b> in the <i>Widow’s Portion</i> and get it back.',
    kill: 'Nimm offers you a settlement while his deck is on fire. You take the strongbox and leave the clause with him.',
    crew: { marine: 4, veteran: 3, gunner: 4 },
  },
};

/* ---------------------------------------------------------------
   The story spine. Six chapters, always present, driven by state
   the game already keeps. `done` is a pure predicate — nothing is
   awarded twice because completion is checked, not remembered.
   --------------------------------------------------------------- */
export const CHAPTERS = [
  {
    id: 'stores',
    title: 'Ship’s Stores',
    obj: () => 'Make <b>Ilo Vantu</b> and dock. Shot and provisions before anything else.',
    done: g => !!g.hintState.docked,
    close: () => 'The harbour takes your money and gives you back a ship that will not embarrass you. That is all a harbour is for.',
    coin: 0, prestige: 2,
  },
  {
    id: 'purse',
    title: 'A Purse of Your Own',
    open: () => 'The harbourmaster keeps a board of small work nobody important wants. Take something off it. Nobody in these islands has ever been given a reputation; they have all been carried, one cargo at a time.',
    obj: () => 'Take a cargo run from the <b>harbourmaster</b> and see it through.',
    done: g => g.quests.some(q => q.kind === 'cargo' && q.done),
    close: () => 'Cargo delivered, signed for, paid. It is not much of a living, but it is the first money you have made under your own colours.',
    coin: 120, prestige: 4,
  },
  {
    id: 'blood',
    title: 'First Blood',
    open: () => 'Carrying pays slowly and the Tally are not slow. There is one working the water off Ilo Vantu right now — black topsides, red trim, and a captain who has never once been made to answer for it.',
    obj: () => 'Find a <b>Tally</b> raider and put her down. Black hull, red trim.',
    done: g => g.stats.sunk + g.stats.captured >= 1,
    close: () => 'One Tally hull fewer. The islands notice that sort of thing faster than they notice anything good you do.',
    coin: 180, prestige: 8,
  },
  {
    id: 'consort',
    title: 'A Second Deck',
    open: () => 'Sinking them is satisfying and stupid. A hull on the bottom is worth salvage; a hull under your flag is worth a fleet. Cut the next one’s rigging instead, take the way off her, and go aboard.',
    obj: () => 'Cut a ship’s rigging, board her, and keep her. Two hulls under one flag.',
    done: g => g.fleet.length > 1,
    close: () => 'You look astern and there is a ship there, flying your colours, keeping station because somebody aboard her decided you were worth following.',
    coin: 220, prestige: 10,
  },
  {
    id: 'nemesis',
    title: g => (NEMESES[g.origin.nemesis] || NEMESES.vell).chapter,
    obj: g => (NEMESES[g.origin.nemesis] || NEMESES.vell).brief,
    open: g => (NEMESES[g.origin.nemesis] || NEMESES.vell).open,
    done: g => !!g.nemesisDown,
    close: g => (NEMESES[g.origin.nemesis] || NEMESES.vell).kill,
    coin: 700, prestige: 22,
    onOpen: g => g.spawnNemesis(),
  },
  {
    id: 'sant',
    title: 'The Long Answer',
    obj: () => 'Sink or take the brig <i>Long Answer</i> and her captain, <b>Mireya Sant</b>.',
    open: () => 'There is a name above the one you just crossed off. Mireya Sant keeps a tally cut into her mainmast and the brig <i>Long Answer</i> under her feet, and every Tally captain in the Shoals sails on her word. She has heard about you now. She is not hurrying.',
    done: g => !!g.santDown,
    coin: 1600, prestige: 30,
    onOpen: g => g.spawnSant(),
  },
];

/* The epilogue is keyed to what you said you wanted. */
export const ENDINGS = {
  clear: {
    title: 'Paid in Full',
    text: 'You settle every account you have in one afternoon at Ilo Vantu and find, standing on the quay with nothing owing, that you have no idea what to do next.<br><br>The ship is still there. The wind is still doing what it does. You go and find a cargo.',
  },
  settle: {
    title: 'The Account is Closed',
    text: 'You had the whole speech ready and never gave it. The Shoals do not hand out endings, only quieter mornings.<br><br>Your people are alive, your ships are yours, and there is nobody left out there who is looking for you specifically. It will do.',
  },
  known: {
    title: 'A Name Said Carefully',
    text: 'They know you at every quay in the Shoals now — the Freeholds, the Compact, and the Admiralty clerk who writes your name with a small, careful hand.<br><br>Two hundred captains in these islands. People can name one.',
  },
};

/* ---------------------------------------------------------------
   Display: the chips under each option are generated from the
   effects themselves, so what a player is promised and what a
   player is given cannot drift apart.
   --------------------------------------------------------------- */
const FAC_SHORT = { freehold: 'Freehold', admiralty: 'Admiralty', compact: 'Compact' };
const SKILL_NAME = { sail: 'Seamanship', gun: 'Gunnery', fight: 'Boarding', trade: 'Haggling' };
const RANK_NAME = { deckhand: 'deckhand', sailor: 'sailor', gunner: 'gunner', marine: 'marine', veteran: 'old salt' };

export function originChips(fx) {
  const out = [];
  if (fx.coin) out.push({ t: `◆ ${fx.coin}`, good: true });
  for (const k in fx.capt || {}) {
    out.push({ t: `${SKILL_NAME[k]} +${Math.round(fx.capt[k] * 100)}%`, good: true });
  }
  for (const k in fx.crew || {}) {
    const n = fx.crew[k];
    out.push({ t: `+${n} ${RANK_NAME[k]}${n > 1 ? 's' : ''}`, good: true });
  }
  for (const k in fx.standing || {}) {
    const v = fx.standing[k];
    out.push({ t: `${FAC_SHORT[k]} ${v > 0 ? '+' : ''}${v}`, good: v > 0 });
  }
  if (fx.provisions) out.push({ t: `+${fx.provisions} provisions`, good: true });
  if (fx.shot) out.push({ t: `+${fx.shot} shot`, good: true });
  if (fx.hull) out.push({ t: `+${Math.round(fx.hull * 100)}% hull`, good: true });
  if (fx.ambition) out.push({ t: AMBITIONS[fx.ambition].tip, good: true });
  if (fx.nemesis) out.push({ t: `A name: ${NEMESES[fx.nemesis].name}`, good: false });
  return out;
}

/* ---------------- captain names ---------------- */
export const CAPTAIN_NAMES = {
  first: ['Ista', 'Rhone', 'Vek', 'Aunis', 'Corr', 'Mirral', 'Sable', 'Tesk', 'Ordo', 'Wren',
    'Halla', 'Brannoc', 'Ysolde', 'Kettering', 'Nis', 'Pell', 'Ravel', 'Suri', 'Thane', 'Orvo'],
  last: ['Arrowsmith', 'Kell', 'Danaway', 'Sarn', 'Whitlow', 'Marrow', 'Ocaster', 'Brine',
    'Vantry', 'Halloran', 'Ebbsworth', 'Quillon', 'Ferrow', 'Stanhope', 'Lomas', 'Grail'],
};

/** Look up an option object from a step id and an option id. */
export function findOption(stepId, optId) {
  const step = ORIGIN_STEPS.find(s => s.id === stepId);
  return step ? step.options.find(o => o.id === optId) : null;
}

/** Merge every chosen answer into one effect block, plus the traits picked up
    along the way. The summary screen and the game both read this, so what a
    captain is shown at the quayside is exactly what they sail with. */
export function sumOrigin(picks) {
  const fx = { coin: 0, standing: {}, capt: {}, crew: {}, provisions: 0, shot: 0, hull: 0 };
  const traits = [];
  for (const step of ORIGIN_STEPS) {
    const o = findOption(step.id, picks[step.id]);
    if (!o) continue;
    if (o.trait) traits.push(o.trait);
    const e = o.fx || {};
    fx.coin += e.coin || 0;
    fx.provisions += e.provisions || 0;
    fx.shot += e.shot || 0;
    fx.hull += e.hull || 0;
    for (const k in e.standing || {}) fx.standing[k] = (fx.standing[k] || 0) + e.standing[k];
    for (const k in e.capt || {}) fx.capt[k] = (fx.capt[k] || 0) + e.capt[k];
    for (const k in e.crew || {}) fx.crew[k] = (fx.crew[k] || 0) + e.crew[k];
    if (e.nemesis) fx.nemesis = e.nemesis;
    if (e.ambition) fx.ambition = e.ambition;
  }
  fx.traits = traits;
  return fx;
}

/** A complete random captain, for the player who wants to be at sea now. */
export function rollOrigin(rnd = Math.random) {
  const picks = {};
  for (const s of ORIGIN_STEPS) picks[s.id] = s.options[(rnd() * s.options.length) | 0].id;
  return picks;
}
export function rollCaptainName(rnd = Math.random) {
  const f = CAPTAIN_NAMES.first, l = CAPTAIN_NAMES.last;
  return `${f[(rnd() * f.length) | 0]} ${l[(rnd() * l.length) | 0]}`;
}
