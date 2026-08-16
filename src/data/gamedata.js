/* ===========================================================
   Commodore — world data
   The Vantu Shoals: a contested archipelago at the western
   edge of the Coruvian sea-lanes.
   =========================================================== */

/* `build` is how a faction's yards build, which is a different question from
   what colour they paint the result. It picks a set of construction details in
   shipFactory — deck fittings, topside work, sail plan — so six powers are six
   different objects rather than six recolours, and a player who cannot see
   colour can still tell an Admiralty patrol from a Tally lugger at range.
   A prize keeps the build she was made with; only her paint changes hands. */
export const FACTIONS = {
  freehold: {
    id: 'freehold',
    name: 'Vantu Freeholds',
    short: 'FREEHOLD',
    blurb: 'Island townships that answer to no crown. They sell salt, letters of marque, and silence.',
    hull: 0x8a6a4a, trim: 0xd9a441, sail: 0xe8dcc0, flag: 0x2f9b8e,
    build: 'island',
    hostileTo: [],
  },
  admiralty: {
    id: 'admiralty',
    name: 'Coruvian Admiralty',
    short: 'ADMIRALTY',
    blurb: 'A blue-water navy with long memory and longer guns. It calls these waters a province; the islands disagree.',
    hull: 0x3f4d63, trim: 0xc8b273, sail: 0xf0ece0, flag: 0x2b3f7a,
    build: 'naval',
    hostileTo: ['pirate'],
  },
  compact: {
    id: 'compact',
    name: 'Ambrine Compact',
    short: 'COMPACT',
    blurb: 'A merchant league of eleven counting-houses. Fast hulls, thin crews, excellent insurance.',
    hull: 0x9a7a52, trim: 0xe0c583, sail: 0xf3e9cf, flag: 0xb8862e,
    build: 'trader',
    hostileTo: [],
  },
  /* Harbour powers. Their influence is not a fleet but a set of places ships
     need in order to survive: deep channels, dry docks, pilots, fresh water.
     Whoever controls where a ship can safely stop controls the sea. */
  sable: {
    id: 'sable',
    name: 'The Sable League',
    short: 'SABLE',
    blurb: 'Nine fortified anchorages that agreed to stop fighting each other. They sell you the harbour, the pilot and the repair, and they decide who comes through the Sound.',
    // charcoal timber, pale stone upperworks, one crimson signal
    hull: 0x2f3339, trim: 0xa9a291, sail: 0xd6cfc0, flag: 0x8e2b28,
    build: 'heavy',
    hostileTo: ['pirate'],
  },
  /* Navigators. Their power is mobility and knowledge — charts, currents, reef
     passages — and none of it is mystical: it is generations of people who
     wrote down what they learned crossing water nobody else would. */
  veyra: {
    id: 'veyra',
    name: 'The Veyra Covenant',
    short: 'VEYRA',
    blurb: 'Island navigators bound by an old agreement to share what they know of the water. The sea does not belong to whoever claims it; it belongs to whoever can cross it.',
    // weathered blue-grey, sea-green trim, off-white canvas
    hull: 0x7f95a2, trim: 0x2f8f86, sail: 0xf2ece0, flag: 0x1f7f78,
    build: 'light',
    hostileTo: [],
  },
  pirate: {
    id: 'pirate',
    name: 'The Tally',
    short: 'TALLY',
    blurb: 'Not a fleet — an arrangement. They keep a running count of every ship they have taken.',
    hull: 0x4a3a34, trim: 0x8f2f2a, sail: 0xbfae95, flag: 0x8f2f2a,
    build: 'patchwork',
    hostileTo: ['admiralty', 'compact', 'freehold', 'player'],
  },
  player: {
    id: 'player',
    name: 'Your Colours',
    short: 'YOURS',
    blurb: '',
    hull: 0x7d5230, trim: 0xe6b25e, sail: 0xefe3c8, flag: 0xc94f2f,
    hostileTo: ['pirate'],
  },
};

/* ---------------- Hull classes ----------------
   speed: units/sec at full sail, best point of sail
   turn : degrees/sec at cruising speed
   draft: 0..1  — how much water she needs (shoals hurt deep hulls)
*/
export const HULLS = {
  cutter: {
    id: 'cutter', name: 'Cutter', masts: 1, len: 19.2, beam: 5.9,
    speed: 15.5, accel: 2.6, turn: 46, draft: 0.30,
    hull: 120, sails: 70, crewMax: 22, crewMin: 5, guns: 4, cargo: 24, value: 900,
    desc: 'Shallow, quick, and honest. One mast, four guns, and no room to hide.',
  },
  lugger: {
    id: 'lugger', name: 'Lugger', masts: 2, len: 24.3, beam: 7.2,
    speed: 15.0, accel: 2.3, turn: 40, draft: 0.40,
    hull: 175, sails: 95, crewMax: 34, crewMin: 8, guns: 8, cargo: 34, value: 1900,
    desc: 'Rigged for the chase. The Tally favour them because they catch what they see.',
  },
  dhow: {
    id: 'dhow', name: 'Coastal Dhow', masts: 2, len: 26.9, beam: 8.2,
    speed: 13.4, accel: 2.0, turn: 35, draft: 0.35,
    hull: 195, sails: 105, crewMax: 30, crewMin: 8, guns: 4, cargo: 70, value: 2100,
    desc: 'Freehold island trader. Carries more than she looks and swims over the reefs.',
  },
  fluyt: {
    id: 'fluyt', name: 'Fluyt', masts: 3, len: 33.3, beam: 10.5,
    speed: 11.0, accel: 1.5, turn: 25, draft: 0.62,
    hull: 300, sails: 140, crewMax: 30, crewMin: 10, guns: 4, cargo: 130, value: 3600,
    desc: 'A floating warehouse with a token battery. The Compact builds them by the dozen.',
  },
  brig: {
    id: 'brig', name: 'Brig', masts: 2, len: 34.6, beam: 10.2,
    speed: 13.0, accel: 1.8, turn: 30, draft: 0.58,
    hull: 380, sails: 160, crewMax: 62, crewMin: 16, guns: 16, cargo: 60, value: 6400,
    desc: 'The smallest hull that can genuinely be called a warship.',
  },
  frigate: {
    id: 'frigate', name: 'Frigate', masts: 3, len: 43.5, beam: 12.3,
    speed: 12.6, accel: 1.5, turn: 23, draft: 0.78,
    hull: 560, sails: 220, crewMax: 96, crewMin: 26, guns: 26, cargo: 80, value: 12800,
    desc: 'Admiralty patrol hull. Twenty-six guns and the standing orders to use them.',
  },
};

/* ---------------- Ammunition ---------------- */
export const AMMO = {
  round: { id: 'round', name: 'Round Shot', icon: '●', hull: 1.0, sail: 0.18, crew: 0.22, gun: 0.30,
           tip: 'Smashes hulls. Sinks ships.' },
  chain: { id: 'chain', name: 'Chain Shot', icon: '∞', hull: 0.16, sail: 1.0, crew: 0.20, gun: 0.10,
           tip: 'Cuts rigging. Stops runners.' },
  grape: { id: 'grape', name: 'Grapeshot', icon: '∴', hull: 0.10, sail: 0.22, crew: 1.0, gun: 0.45,
           tip: 'Sweeps the deck. Softens boarders.' },
};

/* ---------------- Trade goods ---------------- */
export const GOODS = {
  fish:   { id:'fish',   name:'Salt Fish', base: 14, icon:'≈', vol:1 },
  timber: { id:'timber', name:'Timber',    base: 22, icon:'▬', vol:1 },
  iron:   { id:'iron',   name:'Iron',      base: 42, icon:'■', vol:1 },
  cloth:  { id:'cloth',  name:'Sailcloth', base: 60, icon:'▦', vol:1 },
  spice:  { id:'spice',  name:'Pepper',    base: 110, icon:'✦', vol:1 },
};

/**
 * Tons burthen — how big she is, in one number you can compare.
 *
 * Derived from her own length and beam rather than written down beside them,
 * so it can never disagree with the hull that gets drawn: change the
 * dimensions and the tonnage follows. The shape of the formula is the old
 * builder's measure, which is a measure of *capacity* — which is why a fluyt
 * out-tons a brig while losing badly to her, and that is worth knowing at a
 * glance rather than being a surprise.
 *
 *   cutter 60 · lugger 113 · dhow 163 · brig 324 · fluyt 330 · frigate 592
 */
export const tonsOf = cls => (cls ? Math.round(cls.len * cls.beam * cls.beam * 0.09) : 0);

/* ---------------- Crew ranks ---------------- */
export const RANKS = {
  deckhand: { id:'deckhand', name:'Deckhand',  xp: 0,   wage: 2, sail:0.5, gun:0.4, fight:0.6, tier:0 },
  sailor:   { id:'sailor',   name:'Sailor',    xp: 40,  wage: 3, sail:1.0, gun:0.7, fight:0.9, tier:1 },
  gunner:   { id:'gunner',   name:'Gunner',    xp: 120, wage: 5, sail:0.7, gun:1.7, fight:1.0, tier:2 },
  marine:   { id:'marine',   name:'Marine',    xp: 120, wage: 5, sail:0.5, gun:0.8, fight:2.1, tier:2 },
  rigger:   { id:'rigger',   name:'Rigger',    xp: 120, wage: 5, sail:1.9, gun:0.6, fight:0.9, tier:2 },
  veteran:  { id:'veteran',  name:'Old Salt',  xp: 300, wage: 8, sail:1.6, gun:1.6, fight:1.9, tier:3 },
};
export const RANK_ORDER = ['deckhand','sailor','gunner','marine','rigger','veteran'];

/* ---------------- Officer roles ---------------- */
export const OFFICER_ROLES = {
  mate:      { id:'mate',      name:'First Mate',     effect:'+12% turning, +8% speed',       tip:'Keeps the watch honest.' },
  navigator: { id:'navigator', name:'Navigator',      effect:'+10% speed, reads shoal water',  tip:'Knows where the bottom comes up.' },
  gunner:    { id:'gunner',    name:'Master Gunner',  effect:'+20% reload, +15% accuracy',     tip:'Counts the seconds between broadsides.' },
  bosun:     { id:'bosun',     name:'Boatswain',      effect:'Repairs sails at sea',           tip:'Has opinions about your rigging.' },
  surgeon:   { id:'surgeon',   name:'Surgeon',        effect:'Saves 35% of crew losses',       tip:'Half a doctor is better than none.' },
  marine:    { id:'marine',    name:'Marine Officer', effect:'+25% boarding strength',         tip:'First over the rail, every time.' },
};

/* ---------------- Name pools (authored, not generated) ---------------- */
export const NAMES = {
  officer_first: ['Ilas','Marnie','Odo','Serrat','Kova','Bel','Tam','Rusa','Hevik','Anselo','Perrin','Yesa','Dorn','Muri','Calder','Sefa','Wick','Tamsin','Oren','Lissa'],
  officer_last:  ['Vantry','Okoye','Sallow','Marek','Duhan','Peir','Castellan','Nimm','Rask','Aldwin','Coruna','Faber','Sant','Orrey','Bexhall','Ivarn'],
  ship_freehold: ['Kite of Marasay','Reef Sister','Green Lantern','Salt Widow','Nine Fathom','Turnstone','Cousin Vell','Low Tide Bride'],
  ship_compact:  ['Ledger of Oosterhaven','Fair Return','Guilder','Prudent Wife','Amber Count','Two Percent','Warehouse Rose','Slow Interest'],
  ship_admiralty:['Coruna Ascendant','Vigil','Steadfast Escarra','Line of Battle','Warden of the Reach','Punctual','Admiral Rehn','Sentinel'],
  ship_pirate:   ['Long Answer','Debt Collector','Bad Weather','Tally Mark','Widow’s Portion','Hook & Halter','No Quarter Given','Third Name'],
  // Sable: harbour works, breakwaters, the machinery of a defended anchorage
  ship_sable:    ['Breakwater','Cold Mole','Chain of Greywake','Stone Arm','Harbour Watch','Deep Berth','Sound Warden','Slipway'],
  // Veyra: passages, stars, the practice of getting across water
  ship_veyra:    ['Long Passage','Reef Song','Star of the Bars','Wind-Read','Shoal Walker','Chartwright','Turning Tide','Way Between'],
  ship_player:   ['Marlin’s Debt'],
};

/* ---------------- World layout ----------------
   World is a square region, WORLD_SIZE units on a side, centred on 0,0.
   Islands are described by a set of blobs; the terrain builder turns
   them into geometry + a seabed depth map.
*/
export const WORLD_SIZE = 4200;

export const ISLANDS = [
  { // main island — home of Ilo Vantu
    id:'vantu', name:'Ilo Vantu', x: -420, z: 260, seed: 11,
    blobs:[ {x:0,z:0,r:250,h:78},{x:170,z:-120,r:170,h:52},{x:-160,z:130,r:150,h:44},{x:120,z:150,r:120,h:30} ],
    trees: 46, rocks: 14,
  },
  { // fishing hamlet island
    id:'marasay', name:'Marasay', x: 760, z: 720, seed: 23,
    blobs:[ {x:0,z:0,r:150,h:46},{x:-110,z:-90,r:105,h:30},{x:95,z:80,r:90,h:22} ],
    trees: 22, rocks: 9,
  },
  { // admiralty station on a steep rock
    id:'escarra', name:'Escarra Rock', x: 640, z: -760, seed: 37,
    blobs:[ {x:0,z:0,r:132,h:110},{x:100,z:70,r:88,h:44} ],
    trees: 8, rocks: 16,
  },
  { // the hidden cove island (discovery)
    id:'bellcurrent', name:'Bellcurrent', x: -1180, z: -980, seed: 51,
    blobs:[ {x:0,z:0,r:158,h:60},{x:130,z:60,r:110,h:38},{x:-90,z:110,r:96,h:26} ],
    trees: 18, rocks: 12,
  },
  /* THE IRON SOUND — Sable water.
     Steep dark rock in a line, so the sailing water between them is a set of
     narrow deep channels rather than open sea. The geography is the faction's
     argument: whoever holds these gates holds the traffic. */
  { id:'sablehead', ground:'iron', name:'Sable Head', x:-1500, z:-1360, seed: 83,
    blobs:[ {x:0,z:0,r:190,h:150},{x:150,z:120,r:120,h:96},{x:-130,z:90,r:104,h:72} ],
    trees: 5, rocks: 26,
  },
  /* The two outer islands stand further off Sable Head than they did.
     Narrow channels are the point of this water, but they were narrow enough
     that traffic could not use them: hulls making for Greywake milled about
     outside for six minutes together without finding the way in, and two
     drove ashore. Pushed 220m and 160m out along their own bearings from
     Sable Head, which opens the approach without moving the argument — these
     are still gates, and Greywake still sits behind them. */
  { id:'ironteeth', ground:'iron', name:'The Iron Teeth', x:-917, z:-1605, seed: 89,
    blobs:[ {x:0,z:0,r:132,h:128},{x:140,z:-70,r:96,h:88},{x:-120,z:-40,r:88,h:66} ],
    trees: 3, rocks: 22,
  },
  { id:'graithold', ground:'iron', name:'Graithold', x:-1847, z:-826, seed: 97,
    blobs:[ {x:0,z:0,r:160,h:118},{x:-110,z:110,r:110,h:74} ],
    trees: 6, rocks: 18,
  },

  /* THE GLASS REACH — Veyra water.
     Low scattered islands and sandbars, diagonally opposite the Sound. Nothing
     here is high enough to see over, so the route is the knowledge. */
  { id:'tideglassisle', ground:'pale', name:'Tideglass', x: 1480, z: 1330, seed: 103,
    blobs:[ {x:0,z:0,r:150,h:34},{x:130,z:90,r:96,h:22},{x:-120,z:70,r:88,h:18} ],
    trees: 26, rocks: 6,
  },
  { id:'glassbars', ground:'pale', name:'The Long Bars', x: 1120, z: 1560, seed: 109,
    blobs:[ {x:0,z:0,r:104,h:16},{x:150,z:-60,r:76,h:12},{x:-140,z:40,r:70,h:11} ],
    trees: 9, rocks: 4,
  },
  { id:'farbeacon', ground:'pale', name:'The Far Beacon', x: 1780, z: 980, seed: 113,
    blobs:[ {x:0,z:0,r:92,h:28},{x:90,z:80,r:64,h:15} ],
    trees: 7, rocks: 5,
  },

  { // scatter islets — pure scenery / tactical cover
    id:'thimble', name:'The Thimbles', x: 60, z: -180, seed: 67,
    blobs:[ {x:0,z:0,r:62,h:26},{x:120,z:70,r:44,h:16} ], trees: 6, rocks: 6,
  },
  { id:'gullstone', name:'Gullstone', x: -1050, z: 820, seed: 71,
    blobs:[ {x:0,z:0,r:88,h:40},{x:70,z:-70,r:52,h:20} ], trees: 8, rocks: 7,
  },
  { id:'spinecay', name:'The Spine', x: 1340, z: 120, seed: 83,
    blobs:[ {x:0,z:0,r:70,h:34},{x:-80,z:120,r:60,h:22},{x:60,z:-140,r:56,h:20} ], trees: 7, rocks: 9,
  },
];

/* Reefs: shallow ridges. Deep hulls run aground; cutters slip over. */
export const REEFS = [
  { x:-120, z: 520, r: 190, depth: 0.30 },
  { x: 300, z: 380, r: 150, depth: 0.34 },
  { x: 1030, z: 470, r: 210, depth: 0.28 },
  { x: 240, z:-420, r: 175, depth: 0.32 },
  { x:-760, z:-420, r: 230, depth: 0.26 },
  { x:-1420, z:-560, r: 165, depth: 0.30 },
  { x: 880, z:-300, r: 140, depth: 0.33 },
  { x:-520, z: 980, r: 190, depth: 0.30 },
  /* The Glass Reach is mostly reef: the passages are the point, and a captain
     who does not know them will find every one of these. */
  { x: 1310, z: 1150, r: 230, depth: 0.22 },
  { x: 1620, z: 1240, r: 200, depth: 0.24 },
  { x: 1290, z: 1520, r: 215, depth: 0.20 },
  { x: 1660, z: 1560, r: 185, depth: 0.26 },
  { x: 1000, z: 1290, r: 170, depth: 0.25 },
  { x: 1850, z: 1330, r: 160, depth: 0.28 },
  // and the Sound has ledges either side of its channels
  { x:-1320, z:-1180, r: 150, depth: 0.34 },
  { x:-1640, z:-1180, r: 140, depth: 0.33 },
];

/* Ports. `dockR` is the radius within which the DOCK prompt appears. */
export const PORTS = [
  {
    id:'ilovantu', name:'Ilo Vantu', faction:'freehold', island:'vantu',
    x:-190, z: 400, ang: 0.6, dockR: 88, size: 'major',
    tagline:'Free port of the Shoals',
    desc:'Three streets, eleven taverns, and a harbourmaster who has never once asked where cargo came from. Island timber goes out cheap, and so does pepper nobody has paid duty on.',
    services:['repair','market','crew','shipyard','tavern'],
    prices:{ fish:1.00, timber:0.74, iron:1.18, cloth:1.10, spice:0.90 },
  },
  {
    id:'marasay', name:'Marasay', faction:'freehold', island:'marasay',
    x: 680, z: 841, ang: 2.65, dockR: 74, size:'minor',
    tagline:'Fishing hamlet',
    desc:'Drying racks, a chapel, and one crane the whole village argues about. Salt fish for anyone who wants it; everything else has to come by sea.',
    services:['repair','market','crew'],
    prices:{ fish:0.54, timber:1.14, iron:1.20, cloth:1.16, spice:1.12 },
  },
  /* GREYWAKE — the Sable League's own harbour, and the most heavily built
     place in the Shoals. Everything a ship needs to survive is here, and it
     belongs to somebody. */
  {
    id:'greywake', name:'Greywake', faction:'sable', island:'sablehead',
    x:-1500, z:-1170, ang: 1.62, dockR: 96, size:'major', style:'fortified',
    tagline:'Gate of the Iron Sound',
    desc:'Two stone arms reach out and very nearly meet. Inside them: dry docks, chain gear, a cold harbour and more heavy timber than the rest of the Shoals put together. The League will repair anything that floats, and will decide what comes through the Sound.',
    services:['repair','market','crew','shipyard','tavern'],
    prices:{ fish:1.24, timber:0.72, iron:0.78, cloth:1.14, spice:1.22 },
  },
  /* TIDEGLASS — a Veyra lagoon inside the reef. Nothing about it is fortified;
     the reef is the wall, and knowing the way in is the gate. */
  {
    id:'tideglass', name:'Tideglass', faction:'veyra', island:'tideglassisle',
    x: 1480, z: 1150, ang: 4.71, dockR: 90, size:'major', style:'lagoon',
    tagline:'Inside the Glass Reach',
    desc:'Light piers on stilts, sailcloth over the waterfront, and a channel in through the reef that is marked by stakes and nothing else. They will re-rig you, shallow your draught and sell you the way through water that has drowned better captains.',
    services:['repair','market','crew','shipyard','tavern'],
    prices:{ fish:0.78, timber:1.18, iron:1.16, cloth:0.86, spice:0.94 },
  },
  {
    id:'escarra', name:'Fort Escarra', faction:'admiralty', island:'escarra',
    x: 742, z:-680, ang: 0.79, dockR: 74, size:'minor',
    tagline:'Admiralty station',
    desc:'A gun-cut rock with a signal mast. The Admiralty pays well for pirates and asks for receipts. Naval stores — iron and sailcloth — go for a song at the dockyard gate.',
    services:['repair','market','tavern'],
    prices:{ fish:1.22, timber:1.20, iron:0.70, cloth:0.74, spice:1.14 },
  },
];

/* Points of interest — discoveries */
export const POIS = [
  {
    id:'bellcove', name:'Bellcurrent Cove', x:-1100, z:-880, r: 95, kind:'cove',
    once:true,
    title:'A Bell Under Water',
    text:'A drowned chapel bell rings somewhere below the keel — a wreck, wedged in the reef, half a century old and never salvaged. Your crew go down with lines and come up grinning.',
  },
  {
    id:'lighthouse', name:'The Dead Lantern', x: 1420, z:-1120, r: 90, kind:'wreck',
    once:true,
    title:'The Dead Lantern',
    text:'An abandoned light on a bare stack. Somebody lived here recently: a cot, a chart table, and a ledger of every sail that passed. The last twelve entries are all the same ship.',
  },
];

/* Sea-lanes used by merchant traffic. Ports + waypoints. */
export const LANES = [
  { from:'ilovantu', to:'escarra', via:[{x:180,z:0}] },
  { from:'ilovantu', to:'marasay', via:[{x:180,z:640}] },
  { from:'marasay',  to:'escarra', via:[{x:980,z:120}] },
  { from:'ilovantu', to:'edge_w',  via:[{x:-1300,z:200}] },
  { from:'escarra',  to:'edge_n',  via:[{x:520,z:-1400}] },
];

export const EDGE_NODES = {
  edge_w:{ x:-1900, z: 120 }, edge_n:{ x: 340, z:-1780 },
  edge_e:{ x: 1860, z: 480 }, edge_s:{ x:-260, z: 1760 },
};

export const FISH_GROUNDS = [
  { x:-40, z: 760 }, { x: 980, z: 980 }, { x: 380, z: 600 }, { x:-820, z: 560 },
];
