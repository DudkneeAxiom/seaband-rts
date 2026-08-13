/* ===========================================================
   The people who live here.

   A port used to be a row of buttons. This is the layer that
   makes it a place: authored characters who were here before
   you arrived, want things that have nothing to do with you,
   and remember what you did.

   Data only. Runtime state — what you have done to these
   people and what they think of you — lives in sim/social.js,
   because a save should carry the *relationship*, never the
   character sheet. Edit anyone here and every save picks the
   change up on load.
   =========================================================== */

/* ---------------- what a port is ----------------
   Two ports, deliberately opposed. Ilo Vantu sells you anything and asks
   nothing; Escarra asks everything and sells you very little. If a player
   cannot tell those two apart without reading the sign, this pass failed. */
export const PORT_IDENTITY = {
  ilovantu: {
    role: 'Free port',
    line: 'Eleven taverns and a harbourmaster who has never once asked where cargo came from.',
    exports: ['timber', 'spice'],
    imports: ['iron', 'cloth'],
    tone: 'loud, cheerful, entirely for sale',
    problem: 'Somebody is taking cargo off the Thimbles road, and nobody official cares.',
    prosperity: 3, security: 1,
    banner: '#2f9b8e',
    /* One thing you can only get here, and only if the right person likes you. */
    boon: {
      id: 'kesk_book',
      from: 'kesk',
      need: 'trusted',
      name: 'The Harbourmaster’s Book',
      desc: 'Kesk lets you read the pages he keeps out of the ledger: which water the Admiralty does not watch.',
    },
  },
  escarra: {
    role: 'Admiralty station',
    line: 'A stone mole, a signal mast, and more paperwork than powder.',
    exports: ['iron'],
    imports: ['fish', 'timber', 'spice'],
    tone: 'quiet, correct, under-supplied',
    problem: 'The station is short of hands and the Tally have worked that out.',
    prosperity: 2, security: 4,
    banner: '#2b3f7a',
    boon: {
      id: 'rouve_marque',
      from: 'rouve',
      need: 'trusted',
      name: 'A Letter of Marque',
      desc: 'Rouve puts your name to the Admiralty’s own paper. Their quarrels become work you are paid for.',
    },
  },
};

/* ---------------- the people ----------------

   `lines` are what they say, keyed by how well they know you. Short: this is
   a sailing game, not a visual novel. `hidden` is what you have to earn —
   ambitions and allegiances are not printed on anybody's forehead. */
export const NOTABLES = [
  /* ---- Ilo Vantu ---- */
  {
    id: 'kesk', port: 'ilovantu', name: 'Doro Kesk', title: 'Harbourmaster',
    at: 'harbour', faction: 'freehold', age: 'late', seed: 4411,
    traits: ['pragmatic', 'opportunistic', 'unhurried'],
    blurb: 'Runs the quay, the ledger, and the version of the ledger he shows people.',
    bio: 'Thirty years on this quay. He has signed for cargo out of every power in the Shoals and remembers which of them paid late.',
    hidden: {
      ambition: 'To retire to the hill above the harbour and never look at water again.',
      problem: 'Admiralty auditors are due in the spring and his books will not survive them.',
    },
    lines: {
      cold: 'Berth’s eight a night. Pay Halda, not me.',
      known: 'Captain. Your name turns up in my book more than it used to. That is usually good.',
      warm: 'Between us — half of what comes over this quay never happened. You are getting to be one of the halves I like.',
    },
  },
  {
    id: 'marroq', port: 'ilovantu', name: 'Ines Marroq', title: 'Merchant Factor',
    at: 'market', faction: 'freehold', age: 'mid', seed: 8123,
    traits: ['ambitious', 'proud', 'suspicious'],
    blurb: 'Buys pepper by the hold and sells it by the ounce.',
    bio: 'Came up from a two-boat family and now moves more spice than the rest of the Shoals together. She is not popular. She is not trying to be.',
    hidden: {
      ambition: 'To own the pepper road outright, from the Reach to the Thimbles.',
      problem: 'Four cargoes gone past the Thimbles in a season. She does not believe in that much bad luck.',
    },
    lines: {
      cold: 'If you are selling, show me. If you are talking, I am busy.',
      known: 'You again. Good — you at least arrive when you say you will.',
      warm: 'I have started writing your name against cargo before I have asked you. Do not make me regret the habit.',
    },
  },
  {
    id: 'sar', port: 'ilovantu', name: 'Aleti Sar', title: 'Free Trader',
    at: 'tavern', faction: 'freehold', age: 'mid', seed: 2277,
    traits: ['charming', 'cautious', 'loyal'],
    blurb: 'Moves goods that would rather not be counted.',
    bio: 'Sails the Quiet Account, a lugger with a very ordinary name, and has never once been caught with anything aboard.',
    /* She is the one who leaves the menus: see WORLD_CAPTAINS. */
    sails: { ship: 'Quiet Account', classId: 'lugger' },
    hidden: {
      ambition: 'A quiet network from here to the Glass Reach, and nobody to answer to.',
      problem: 'Escarra’s customs officer has her name and is two manifests from proving it.',
    },
    lines: {
      cold: 'I sell fish. Ask anyone.',
      known: 'You have the look of somebody who does not read other people’s cargo manifests. I like that.',
      warm: 'If I ever need a hull nobody expects, Captain, I would rather it were yours.',
    },
  },
  {
    id: 'crane', port: 'ilovantu', name: 'Halda Crane', title: 'Dockmaster',
    at: 'crew', faction: 'freehold', age: 'late', seed: 6602,
    traits: ['stern', 'loyal', 'traditional'],
    blurb: 'Decides who works this quay and who does not.',
    bio: 'Bosun for twenty years before her knee went. Every hand you hire here has been looked over by her first.',
    hidden: {
      ambition: 'To see both her sons crewed on ships that come home.',
      problem: 'Somebody has been pressing her people off the quay at night.',
    },
    lines: {
      cold: 'Hands are hands. Take who I give you.',
      known: 'I will give you the steady ones. Do not waste them.',
      warm: 'My best go to captains who bring them back. That is you, so far.',
    },
  },
  {
    id: 'pell', port: 'ilovantu', name: 'Teodor Pell', title: 'Keeper of the Eleven',
    at: 'tavern', faction: 'freehold', age: 'mid', seed: 9310,
    traits: ['generous', 'superstitious', 'talkative'],
    blurb: 'Keeps the largest of the eleven taverns and all of the gossip.',
    bio: 'Pours for everyone and repeats most of it. He believes the sea listens and will not let anyone whistle indoors.',
    hidden: {
      ambition: 'To hear, once, a story worth closing the room for.',
      problem: 'He owes Aleti Sar more than the room is worth.',
    },
    lines: {
      cold: 'Sit where you like. Do not whistle.',
      known: 'Captain! Same as before? Sit down, there is talk worth hearing.',
      warm: 'Your table, that one. And no, you are not paying for the first.',
    },
  },

  /* ---- Fort Escarra ---- */
  {
    id: 'rouve', port: 'escarra', name: 'Sabine Rouve', title: 'Commodore',
    at: 'harbour', faction: 'admiralty', age: 'mid', seed: 1505,
    traits: ['honorable', 'stern', 'idealistic'],
    blurb: 'Commands the station, such as it is.',
    bio: 'Given a stone mole, two sloops and a signal mast, and told to hold the eastern approaches. She has not complained in writing.',
    hidden: {
      ambition: 'A squadron of her own, and orders that come from the sea rather than a desk.',
      problem: 'She is four crews short and the Tally have counted.',
    },
    lines: {
      cold: 'State your business with the station, Captain.',
      known: 'You keep turning up where the Tally have been. The Admiralty notices that eventually. I notice it now.',
      warm: 'I have written your name in a despatch. Twice. Do not embarrass me.',
    },
  },
  {
    id: 'fell', port: 'escarra', name: 'Ossian Fell', title: 'Customs Officer',
    at: 'harbour', faction: 'admiralty', age: 'young', seed: 7788,
    traits: ['suspicious', 'proud', 'vindictive'],
    blurb: 'Reads manifests the way other people read weather.',
    bio: 'Young, thorough, and certain that half the Shoals is a smuggling operation with a flag on it. He is not entirely wrong.',
    hidden: {
      ambition: 'A posting somewhere that matters, earned by catching somebody who matters.',
      problem: 'Somebody inside Escarra is selling the station’s manifests.',
    },
    lines: {
      cold: 'Your hold. I will see it now, if it is all the same to you.',
      known: 'Your papers are in order. They usually are. I have not stopped looking.',
      warm: 'I would take your word over most people’s manifests. Do not make that a mistake.',
    },
  },
  {
    id: 'vey', port: 'escarra', name: 'Corin Vey', title: 'Master Shipwright',
    at: 'yard', faction: 'admiralty', age: 'late', seed: 3344,
    traits: ['traditional', 'proud', 'generous'],
    blurb: 'Repairs Admiralty hulls and grumbles about their lines.',
    bio: 'Forty years in yards from here to the Reach. He can tell which yard built a hull by the way she takes a sea.',
    hidden: {
      ambition: 'To build one ship to his own drawing before his hands go.',
      problem: 'The Admiralty will fund repairs and nothing else, ever.',
    },
    lines: {
      cold: 'She will be ready when she is ready.',
      known: 'You look after her. That is rarer than you would think.',
      warm: 'Come and see the drawing sometime. Nobody else has.',
    },
  },
  {
    id: 'idd', port: 'escarra', name: 'Wrenna Idd', title: 'Surgeon',
    at: 'crew', faction: 'admiralty', age: 'mid', seed: 5150,
    traits: ['idealistic', 'stern', 'pragmatic'],
    blurb: 'Keeps the station’s people alive on very little.',
    bio: 'Trained inland, came to sea for a year, and has stayed eleven. She takes anyone, colours or no colours.',
    hidden: {
      ambition: 'A proper infirmary at Escarra instead of two rooms and an argument.',
      problem: 'She is out of nearly everything and the requisitions go unanswered.',
    },
    lines: {
      cold: 'If they are bleeding, bring them in. If not, I am busy.',
      known: 'You bring your people back alive more often than most. I keep count.',
      warm: 'Whatever I have is yours, Captain. You have earned that twice over.',
    },
  },
  {
    id: 'duhl', port: 'escarra', name: 'Emeric Duhl', title: 'Retired Navigator',
    at: 'tavern', faction: 'admiralty', age: 'late', seed: 2020,
    traits: ['traditional', 'superstitious', 'charming'],
    blurb: 'Sits by the window and watches water he is no longer allowed on.',
    bio: 'Navigated for the Admiralty thirty years and knows the Glass Reach better than the charts do. Nobody will sign a man his age.',
    hidden: {
      ambition: 'To stand off the Glass Reach one more time before he dies.',
      problem: 'Every captain he asks is polite about it.',
    },
    lines: {
      cold: 'Mind the bar, Captain. I am only sitting.',
      known: 'You have been east lately. I can tell by how you came in.',
      warm: 'When you go to the Reach — and you will — there is a channel I would show you.',
    },
  },
];

/* ---------------- who cannot stand whom ----------------
   Not a family tree. Four edges are enough to make a town feel wired
   together, and every one of them is something a player can be caught in. */
export const TIES = [
  { a: 'marroq', b: 'sar', kind: 'suspects', line: 'Marroq is certain Sar is behind her lost cargo.' },
  { a: 'pell', b: 'sar', kind: 'owes', line: 'Pell owes Sar more than the Eleven is worth.' },
  { a: 'fell', b: 'sar', kind: 'hunts', line: 'Fell has Sar’s name and wants the proof.' },
  { a: 'rouve', b: 'fell', kind: 'restrains', line: 'Rouve keeps Fell off her own people.' },
  { a: 'crane', b: 'kesk', kind: 'trusts', line: 'Crane has kept Kesk’s quay honest for years.' },
  { a: 'idd', b: 'rouve', kind: 'trusts', line: 'Idd will say to Rouve what nobody else will.' },
];

/* ---------------- named officers ----------------
   Three of the tavern's officers are people rather than modifiers. They keep
   the ordinary officer fields — role, skill, wage, hire — so every system
   that already handles an officer handles these unchanged. */
export const NAMED_OFFICERS = [
  {
    id: 'mercer', name: 'Elias Mercer', epithet: 'Three Knots',
    role: 'navigator', skill: 3, seed: 4242, port: 'ilovantu',
    traits: ['superstitious', 'loyal', 'drinks'],
    bio: 'Claims he crossed the White Current twice in one winter. Most sailors assume the first trip damaged his memory.',
    ambition: 'To find the wreck of the Saint Cordelia.',
    arc: 'cordelia',
  },
  {
    id: 'holt', name: 'Vera Holt', epithet: null,
    role: 'bosun', skill: 2, seed: 8686, port: 'escarra',
    traits: ['pragmatic', 'blunt', 'rational'],
    bio: 'Ran a shore infirmary until the Admiralty closed it. Has no patience for charms, bones, or anything nailed above a door.',
    ambition: 'To never again watch a crew die of something she could have fixed.',
    arc: null,
  },
  {
    id: 'ndour', name: 'Kasim Ndour', epithet: 'Longshot',
    role: 'gunner', skill: 3, seed: 3131, port: 'ilovantu',
    traits: ['proud', 'patient', 'exacting'],
    bio: 'Served a gun on a Covenant privateer and has opinions about everyone else’s. Will not fire at a range he considers wasteful.',
    ambition: 'One clean shot at the ship that took his brother.',
    arc: null,
  },
];

/* Officers who cannot share a deck quietly. One pair is enough to prove it. */
export const OFFICER_FRICTION = [
  {
    a: 'mercer', b: 'holt',
    text: '<b>Vera Holt:</b> “If Mercer hangs another bundle of bones over my door I am putting it in the sea.”'
      + '<br><br><b>Elias Mercer:</b> “And when the sea takes her, Captain, do not say I did not warn you.”',
    options: [
      { id: 'mercer', label: 'Leave the bones where they are', to: 'mercer' },
      { id: 'holt', label: 'The door stays clear', to: 'holt' },
      { id: 'both', label: 'Both of you, enough', to: null },
    ],
  },
];

export const NOTABLE_BY_ID = Object.fromEntries(NOTABLES.map(n => [n.id, n]));
export function notablesAt(portId) { return NOTABLES.filter(n => n.port === portId); }
export function tiesFor(id) { return TIES.filter(t => t.a === id || t.b === id); }
