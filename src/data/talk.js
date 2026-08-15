/* ===========================================================
   How you answer, and who takes it well.

   Every notable used to offer the same four buttons, and pressing
   one printed a paragraph at you. The choice the player never had
   was the interesting one: not *what* to ask, but *how to speak to
   this particular person*.

   A manner is a way of talking. Which manners are on offer depends
   on where you are standing and how well they know you — two or
   three for a stranger at a counter, four for a friend in a tavern
   — and whether one lands is decided by the traits already written
   into `notables.js`. Kesk is pragmatic and unhurried; Marroq is
   proud and suspicious. Speak bluntly to both and one thanks you
   for it while the other decides you are rude. Same button, two
   people, and the difference is theirs rather than the button's.

   Data only. The conversation itself is in ui/sheet.js and what it
   does to a relationship is in sim/social.js.
   =========================================================== */

/**
 * The ways of speaking.
 *
 * `need` gates a manner behind a tier; `at` gates it to a place. Ordered by
 * priority — the conversation offers the first four that qualify, so a manner
 * added here without a gate becomes everyone's fourth option and pushes the
 * situational ones off the card. Keep the gated ones last.
 */
export const MANNERS = [
  {
    id: 'plain', label: 'Speak plainly', tip: 'No ceremony, no flattery.',
    say: 'You put it straight, without dressing it up.',
  },
  {
    id: 'courteous', label: 'Pay your respects', tip: 'Their house, their rules.',
    say: 'You give them the courtesy of their standing before you ask for anything.',
  },
  {
    id: 'business', label: 'Talk business', tip: 'What is in it for the pair of you.',
    say: 'You put it as a matter of trade: what you want, and what it is worth.',
  },
  {
    id: 'press', label: 'Press them', tip: 'They are not saying everything.', need: 'acquainted',
    say: 'You let the pause run on, and do not fill it.',
  },
  {
    id: 'drink', label: 'Stand them a drink', tip: '◆12, and an hour of their evening.',
    at: 'tavern', coin: 12,
    say: 'You put a cup in front of them and one in front of yourself.',
  },
];

/**
 * What each manner does to each sort of person.
 *
 * Keyed manner → trait → the line they answer with. Only the traits that
 * actually have a view are listed; anyone else shrugs and gives the manner's
 * `flat` line, which is worth nothing either way. That is deliberate — a
 * character who has an opinion about everything has no character.
 */
export const REACTIONS = {
  plain: {
    flat: 'Fair enough.',
    likes: {
      pragmatic: 'Good. I have not got the afternoon for the other way of asking.',
      blunt: 'At last. Everyone else takes ten minutes to say that.',
      rational: 'Plainly put and plainly answered. That is the whole of it.',
      stern: 'You do not waste words. I will not waste yours.',
      honorable: 'Straight question. You will get a straight answer from me.',
      unhurried: 'No, that is the right way round. Sit down.',
    },
    dislikes: {
      proud: 'You might work up to it, Captain.',
      traditional: 'There is a way these things are done. That was not it.',
      exacting: 'Blunt is not the same as clear. Ask me properly.',
    },
  },
  courteous: {
    flat: 'Kind of you to say.',
    likes: {
      proud: 'You know who you are speaking to. Not everyone troubles.',
      traditional: 'Manners. I had begun to think they went out with sail.',
      honorable: 'Courtesy costs nothing and buys a good deal. Ask away.',
      generous: 'Well. Sit down, you are not in a hurry either.',
      exacting: 'Correctly done. I notice when it is not.',
    },
    dislikes: {
      blunt: 'Get on with it.',
      rational: 'You want something. Say what.',
      opportunistic: 'Save the speech. Nobody is buying it.',
    },
  },
  business: {
    flat: 'That is one way to put it.',
    likes: {
      opportunistic: 'Now you are talking a language I keep accounts in.',
      ambitious: 'Everyone here wants a favour. You want a deal. Better.',
      pragmatic: 'Costs and returns. Yes. Go on.',
      exacting: 'Terms first, then the handshake. Quite right.',
    },
    dislikes: {
      idealistic: 'Not everything on this water has a price on it.',
      honorable: 'I am not a stall, Captain.',
      superstitious: 'You reckon a thing to the penny and the sea hears you do it.',
    },
  },
  press: {
    flat: 'Hm. Perhaps.',
    likes: {
      talkative: 'Since you ask — and nobody ever does —',
      charming: 'You are hard to lie to. That is a rare and irritating gift.',
      loyal: 'You have earned the rest of it. Not everyone would get it.',
      drinks: 'Ah, you want the long version. Then I want another cup.',
    },
    dislikes: {
      suspicious: 'That is a great many questions from somebody I have known five minutes.',
      cautious: 'I would rather not, if it is all the same.',
      proud: 'I say what I mean to say. You may take that or leave it.',
      vindictive: 'Careful. I remember who pushes.',
    },
  },
  drink: {
    flat: 'Your health, Captain.',
    likes: {
      drinks: 'Now that is the first sensible thing anyone has said to me today.',
      talkative: 'Sit, sit. You will not get away in under an hour.',
      superstitious: 'Pour a splash out first. For the ones still out there.',
      generous: 'You did not have to. I will not forget that you did.',
      unhurried: 'There. Now we can talk properly.',
    },
    dislikes: {
      stern: 'Not on duty, and not from a captain who wants something.',
      idealistic: 'Buy me a drink after you have done something worth toasting.',
      exacting: 'I do not drink with people I am still weighing up.',
    },
  },
};

/**
 * The manners available to this person, in this place, at this standing.
 *
 * Four is the most a card should ask of a thumb, and which four matters. The
 * first version simply took the first four that qualified, in list order —
 * so standing somebody a drink was offered to a stranger in a tavern and then
 * **vanished for the rest of the game** the moment you became acquainted,
 * because `press` unlocked above it and pushed it off the end. The one manner
 * that belongs to a particular room was the one you lost by getting to know
 * people.
 *
 * So the ones that are conditional — a place you are standing in, a standing
 * you earned — are kept first, because they are what makes this conversation
 * unlike the last one; the plain three fill whatever room is left. Output
 * stays in list order so the card does not reshuffle under a thumb.
 */
export function mannersFor(who, S, place, cap = 4) {
  const open = MANNERS.filter(m =>
    (!m.need || S.atLeast(who.id, m.need)) && (!m.at || place === m.at));
  const special = open.filter(m => m.need || m.at);
  const plain = open.filter(m => !m.need && !m.at);
  const keep = new Set([...special, ...plain].slice(0, cap));
  return open.filter(m => keep.has(m));
}

/**
 * How this person takes being spoken to that way.
 *
 * Their traits are checked in the order they are written, so the first one
 * that has a view wins — which makes the trait list in `notables.js` a
 * priority order as well as a description, and means Marroq's pride answers
 * before her suspicion does.
 */
export function reactionTo(who, mannerId) {
  const r = REACTIONS[mannerId];
  if (!r) return { how: 'flat', line: '…', trait: null };
  for (const t of who.traits) {
    if (r.likes[t]) return { how: 'warm', line: r.likes[t], trait: t };
    if (r.dislikes[t]) return { how: 'cool', line: r.dislikes[t], trait: t };
  }
  return { how: 'flat', line: r.flat, trait: null };
}
