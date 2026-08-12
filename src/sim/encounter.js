/* ===========================================================
   Encounters — what happens when two hostile fleets touch.

   The campaign layer no longer starts a gunfight because somebody sailed
   into range. Contact stops the world and asks the captain a question, and
   the answer decides whether there is a battle at all. Everything here is
   rules: no DOM, no three.js, so it can be reasoned about and tested on its
   own. `src/ui/encounter.js` draws whatever this returns.
   =========================================================== */
import { strength } from '../ships/ai.js';
import { angDiff, clamp, clamp01 } from '../core/util.js';
import { FACTIONS } from '../data/gamedata.js';

/** How near a hostile has to come before the world stops and asks. */
export const CONTACT_R = 78;
/** Inside this she is committed and closing; the HUD says so. */
export const PURSUIT_R = 900;

/* ---------------------------------------------------------------
   Reading the situation
   --------------------------------------------------------------- */

/** Every hull on her side of the fight, not just the one that caught you. */
export function enemyBand(game, lead) {
  const band = [lead];
  for (const s of game.ships) {
    if (s === lead || !s.alive || s.captured) continue;
    if (game.fleet.includes(s) || s.isPlayer) continue;
    if (s.faction !== lead.faction) continue;
    // close enough to be part of the same action rather than a separate sail
    if (Math.hypot(s.x - lead.x, s.z - lead.z) > 340) continue;
    band.push(s);
    if (band.length >= 5) break;
  }
  return band;
}

/**
 * The weather gauge: who is upwind.
 *
 * It is the oldest tactical question under sail — the windward ship chooses
 * the range and can bear down when she likes, the leeward one is waiting.
 * Here it decides deployment in the battle that follows, so the encounter
 * screen tells you about it before you commit.
 */
export function weatherGauge(game, lead) {
  const p = game.player;
  const toEnemy = Math.atan2(lead.x - p.x, lead.z - p.z);
  // upwind is the direction the wind comes FROM
  const upwind = game.windAng;
  return Math.abs(angDiff(toEnemy, upwind)) < Math.PI / 2 ? 'them' : 'you';
}

/** A plain-language reading of the odds, in the words a sailing master uses. */
export function verdictFor(ratio) {
  if (ratio >= 2.6) return { tier: 0, word: 'No contest', tone: 'good' };
  if (ratio >= 1.5) return { tier: 1, word: 'You are the heavier', tone: 'good' };
  if (ratio >= 0.85) return { tier: 2, word: 'An even thing', tone: '' };
  if (ratio >= 0.5) return { tier: 3, word: 'They have the weight', tone: 'bad' };
  return { tier: 4, word: 'They will eat you', tone: 'bad' };
}

/* ---------------------------------------------------------------
   Building the encounter
   --------------------------------------------------------------- */

/**
 * Everything the encounter screen and the battle after it need to know.
 * Built once, at contact, and carried through to the battle so deployment
 * can reflect how the meeting actually happened.
 */
export function buildEncounter(game, lead) {
  const p = game.player;
  const enemies = enemyBand(game, lead);
  const allies = game.fleet.filter(s => s.alive && !s.captured);
  const theirs = enemies.reduce((n, s) => n + strength(s), 0);
  const mine = allies.reduce((n, s) => n + strength(s), 0);
  const ratio = mine / Math.max(1, theirs);
  const gauge = weatherGauge(game, lead);

  const enc = {
    lead,
    enemies,
    allies,
    faction: lead.faction,
    factionName: (FACTIONS[lead.faction] || {}).short || lead.faction,
    theirs: Math.round(theirs),
    mine: Math.round(mine),
    ratio,
    verdict: verdictFor(ratio),
    gauge,
    // where the world stopped: the battle happens here, on this water
    x: (p.x + lead.x) / 2,
    z: (p.z + lead.z) / 2,
    // how the meeting came about, which decides who starts where
    how: lead.target === p ? 'intercepted' : 'closed',
    fledAndFailed: false,
    theirCrew: enemies.reduce((n, s) => n + s.crewTotal, 0),
    theirGuns: enemies.reduce((n, s) => n + s.gunsPort + s.gunsStb, 0),
    myCrew: allies.reduce((n, s) => n + s.crewTotal, 0),
    myGuns: allies.reduce((n, s) => n + s.gunsPort + s.gunsStb, 0),
  };
  enc.options = optionsFor(game, enc);
  return enc;
}

/* ---------------------------------------------------------------
   The choices
   --------------------------------------------------------------- */

/**
 * What this captain can actually say, given who she is and who they are.
 *
 * Not every button, every time. An option that is always there is furniture;
 * one that appears because of something you did is a reward. Each carries the
 * reason it is available, so the screen can show why without a second table.
 */
export function optionsFor(game, enc) {
  const p = game.player;
  const out = [];

  out.push({ id: 'fight', label: 'FIGHT', sub: 'Clear for action' });
  out.push({ id: 'flee', label: 'ATTEMPT TO FLEE', sub: 'Crowd on sail and run' });

  const pirates = enc.faction === 'pirate';
  const cargo = p.cargoUsed || 0;

  /* A raider is in it for the cargo. Give her the cargo and she has what she
     came for — expensive, and always available when you have something to
     give, because a captain with a hold full of fish should not have to die
     for it. */
  if (pirates && cargo > 0) {
    out.push({
      id: 'cargo', label: 'SURRENDER CARGO',
      sub: `Hand over ${cargo} of hold and be let go`,
    });
  }

  /* Coin instead of cargo, if you have coin and she is the sort to take it. */
  if (pirates && game.coin >= 120 && cargo <= 0) {
    out.push({ id: 'bribe', label: 'BUY THEM OFF', sub: `◆${bribeCost(game, enc)} to sheer off` });
  }

  /* Standing with the faction whose ship this is. A patrol that knows your
     colours has no reason to board you. */
  if (!pirates) {
    const standing = game.standing[enc.faction] || 0;
    if (standing >= 20 && game.infamy < 40) {
      out.push({
        id: 'colours', label: 'SHOW YOUR COLOURS',
        sub: `${enc.factionName} standing ${Math.round(standing)}`,
      });
    }
  }

  /* Reputation, used as reputation. A name earned in the shoals is worth
     something when a smaller ship is deciding whether to try you. */
  if (game.prestige >= 40 && enc.ratio >= 1.25 && !enc.lead.nemesisId) {
    out.push({
      id: 'parley', label: 'STAND THEM OFF',
      sub: `They know the name — prestige ${Math.round(game.prestige)}`,
    });
  }

  /* And the other side of it: if you plainly outweigh her, invite her to
     strike before anybody is killed over it. */
  if (enc.ratio >= 2.2 && !enc.lead.nemesisId) {
    out.push({ id: 'demand', label: 'DEMAND THEIR SURRENDER', sub: 'You have the weight of metal' });
  }

  return out;
}

export function bribeCost(game, enc) {
  return Math.round(clamp(60 + enc.theirs * 2.2, 60, 900));
}

/* ---------------------------------------------------------------
   Running
   --------------------------------------------------------------- */

/**
 * The odds of getting clear, and every term that went into them.
 *
 * Returned in full rather than as a single number, because the player is
 * about to gamble on it and a hidden roll is not a decision. The screen shows
 * the two or three terms that matter most.
 */
export function fleeChance(game, enc) {
  const p = game.player;
  const terms = [];

  // the slowest ship in your fleet is the speed of your fleet
  const mySpeed = Math.min(...enc.allies.map(s => s.cls.speed * (0.45 + 0.55 * s.sailFrac)));
  const theirSpeed = Math.max(...enc.enemies.map(s => s.cls.speed * (0.45 + 0.55 * s.sailFrac)));
  const speedEdge = clamp((mySpeed - theirSpeed) / 6, -0.45, 0.45);
  terms.push({
    label: mySpeed >= theirSpeed ? 'You are the faster' : 'They are the faster',
    v: speedEdge,
  });

  // canvas: a ship with her rigging cut does not run
  const rig = enc.allies.reduce((n, s) => Math.min(n, s.sailFrac), 1);
  const rigEdge = (rig - 0.8) * 0.5;
  terms.push({ label: rig > 0.85 ? 'Rigging sound' : 'Rigging cut about', v: rigEdge });

  // seamanship, and anyone aboard who knows how to use it
  const skill = p.crewSkill('sail');
  const skillEdge = (skill - 1) * 0.35 + (p.hasOfficer('sailing') ? 0.08 : 0);
  terms.push({ label: skill >= 1 ? 'A handy crew' : 'A green crew', v: skillEdge });

  // the weather gauge: running from windward is far easier than from leeward
  const gaugeEdge = enc.gauge === 'you' ? 0.10 : -0.12;
  terms.push({ label: enc.gauge === 'you' ? 'You hold the weather gauge' : 'They hold the weather gauge', v: gaugeEdge });

  // a fleet runs as slowly as its worst sailer, and there are more of you to see
  const dragEdge = -(enc.allies.length - 1) * 0.05;
  if (enc.allies.length > 1) terms.push({ label: `${enc.allies.length} ships to get clear`, v: dragEdge });

  const chance = clamp01(0.45 + terms.reduce((n, t) => n + t.v, 0));
  return { chance, terms };
}

/** Roll it. Nothing hidden: the caller is handed the number it rolled against. */
export function resolveFlee(game, enc) {
  const { chance, terms } = fleeChance(game, enc);
  const roll = Math.random();
  return { escaped: roll < chance, chance, roll, terms };
}

/**
 * Whether a demand or a parley is taken seriously.
 *
 * Deliberately legible: weight of metal and reputation against her nerve. A
 * ship with a name of her own — a nemesis — never takes either, and the
 * screen does not offer them.
 */
export function talkChance(game, enc, kind) {
  if (enc.lead.nemesisId) return 0;
  const base = kind === 'demand' ? 0.22 : 0.30;
  const weight = clamp((enc.ratio - 1) * 0.22, -0.25, 0.45);
  const name = clamp01(game.prestige / 260) * 0.28;
  const dread = clamp01(game.infamy / 200) * (kind === 'demand' ? 0.18 : -0.10);
  const nerve = enc.faction === 'pirate' ? -0.06 : 0.04;
  return clamp01(base + weight + name + dread + nerve);
}
