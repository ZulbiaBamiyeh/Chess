// Relics: the synergy layer.
//
// The piece registry gave the game variety, but variety is not a build. Every
// piece stood alone, so "my run" was just a list of things I had bought. A
// relic changes a RULE, and because relics key off piece properties — leaper,
// slider, pawn, cost — owning one makes you want particular pieces, and owning
// two makes you want a particular kind of army. That is where builds come from.
//
// Effects come in two flavours:
//
//   `run`    — read by the run layer: supply, deploy, prices, gold, healing,
//              per-piece supply discounts, start-of-fight statuses.
//   `token`  — a string pushed into the engine's modifier list, which the
//              generator and make-move already consult by name. Adding a
//              rule-bending relic is usually one token plus one `includes`.
//
// Nothing here reaches into run state directly, so the book stays data.

import { PIECES, RARITY } from './pieces.js';

/** Derived tags, so relics can talk about kinds of piece rather than lists. */
export function tagsOf(id) {
  const def = PIECES[id];
  if (!def) return [];
  const tags = [];
  if (def.pawn) tags.push('pawn');
  if (def.leaps && !def.slides) tags.push('leaper');
  if (def.slides) tags.push('slider');
  if (def.hopper) tags.push('hopper');
  if (def.ice) tags.push('frost');
  if (def.paintsFire) tags.push('fire');
  if (def.wisp || def.sapper) tags.push('martyr');
  if (def.royal) tags.push('royal');
  if (def.shoots) tags.push('ranged');
  if (def.raises) tags.push('reaper');
  if (def.aura) tags.push('banner');
  if (def.swaps) tags.push('courier');
  if (def.cost >= 6) tags.push('heavy');
  if (def.cost <= 2 && !def.royal) tags.push('cheap');
  return tags;
}

export const hasTag = (id, tag) => tagsOf(id).includes(tag);

/**
 * @typedef {object} Relic
 * @property {string} id
 * @property {string} name
 * @property {string} blurb      what it does, in the player's words
 * @property {string} rarity
 * @property {string} [archetype] the build it points at, shown in the UI
 * @property {number} [supply]   flat supply change every fight
 * @property {number} [deploy]   flat deploy change every fight
 * @property {number} [clock]    extra turns on the fight clock
 * @property {number} [goldPerFight]
 * @property {number} [goldPerLoss]  gold when one of your pieces dies
 * @property {number} [healPerFight]
 * @property {number} [shopDiscount] 0..1
 * @property {number} [extraDrops]   extra choices in a drop
 * @property {string[]} [tokens]     engine modifier tokens
 * @property {{tag: string, amount: number}} [discount] supply discount by tag
 * @property {{tag: string}} [shieldTag] these pieces start each fight shielded
 * @property {boolean} [freePawn]    a free pawn every fight, outside the cap
 * @property {boolean} [secondWind]  survive lethal once per run
 */

/** @type {Record<string, Relic>} */
export const RELICS = {
  // ---------------------------------------------------------------- swarm
  muster: {
    id: 'muster', name: 'Muster Roll', rarity: RARITY.COMMON, archetype: 'Swarm',
    blurb: 'One more piece in every fight. One less supply to equip it.',
    deploy: 1, supply: -1,
  },
  pressgang: {
    id: 'pressgang', name: 'Press Gang', rarity: RARITY.COMMON, archetype: 'Swarm',
    blurb: 'A free pawn joins every fight, over and above your limit.',
    freePawn: true,
  },
  levy: {
    id: 'levy', name: 'Levy Writ', rarity: RARITY.RARE, archetype: 'Swarm',
    blurb: 'Pawns cost no supply at all.',
    discount: { tag: 'pawn', amount: 9 },
  },
  tide: {
    id: 'tide', name: 'Tide of Bodies', rarity: RARITY.EPIC, archetype: 'Swarm',
    blurb: 'Two more pieces every fight, at the price of five supply.',
    deploy: 2, supply: -5,
  },

  // -------------------------------------------------------------- quality
  warrant: {
    id: 'warrant', name: "Champion's Warrant", rarity: RARITY.COMMON, archetype: 'Few and Fine',
    blurb: 'Three more supply. One fewer body to spend it on.',
    supply: 3, deploy: -1,
  },
  heavystandard: {
    id: 'heavystandard', name: 'Heavy Standard', rarity: RARITY.RARE, archetype: 'Few and Fine',
    blurb: 'Every piece costing six or more walks in shielded — two of them, at the cost of a body.',
    shieldTag: { tag: 'heavy' }, deploy: -1,
  },
  commission: {
    id: 'commission', name: 'Gilded Commission', rarity: RARITY.EPIC, archetype: 'Few and Fine',
    blurb: 'Seven more supply. Two fewer pieces.',
    supply: 7, deploy: -2,
  },

  // ---------------------------------------------------------------- frost
  deepfreeze: {
    id: 'deepfreeze', name: 'Deep Freeze', rarity: RARITY.RARE, archetype: 'Frost',
    blurb: 'Your Rime freezes on the diagonals too — everything beside her stops.',
    tokens: ['deepfreeze'],
  },
  icebound: {
    id: 'icebound', name: 'Icebound Cloak', rarity: RARITY.COMMON, archetype: 'Frost',
    blurb: 'Nothing of yours can be frozen. Not by them, not by the ground.',
    tokens: ['icebound'],
  },
  rimewalk: {
    id: 'rimewalk', name: 'Rimewalker Boots', rarity: RARITY.RARE, archetype: 'Frost',
    blurb: 'Frost tiles hold no fear — your pieces stand on ice and shrug.',
    tokens: ['icebound'],
  },

  // ----------------------------------------------------------------- fire
  brand: {
    id: 'brand', name: 'Everburning Brand', rarity: RARITY.RARE, archetype: 'Fire',
    blurb: 'The fire you leave burns a turn longer.',
    tokens: ['everburn'], supply: 1,
  },
  ashboots: {
    id: 'ashboots', name: 'Ash Boots', rarity: RARITY.COMMON, archetype: 'Fire',
    blurb: 'Your pieces walk through fire unharmed. Theirs do not.',
    tokens: ['ashboots'],
  },
  pyroclast: {
    id: 'pyroclast', name: 'Pyroclast', rarity: RARITY.EPIC, archetype: 'Fire',
    blurb: 'Every slider lays fire on the path it travels, and fire-starters cost two less.',
    tokens: ['pyre'], discount: { tag: 'fire', amount: 2 },
  },

  // --------------------------------------------------------------- leaper
  cavalry: {
    id: 'cavalry', name: 'Cavalry Standard', rarity: RARITY.RARE, archetype: 'Cavalry',
    blurb: 'Everything that leaps costs one less supply. The carts stay behind.',
    discount: { tag: 'leaper', amount: 1 }, supply: -1,
  },
  farrier: {
    id: 'farrier', name: "Farrier's Charm", rarity: RARITY.COMMON, archetype: 'Cavalry',
    blurb: 'Two of your leapers walk in shielded, at the cost of a body and a point of supply.',
    shieldTag: { tag: 'leaper' }, deploy: -1, supply: -1,
  },

  // --------------------------------------------------------------- martyr
  vengefulash: {
    id: 'vengefulash', name: 'Vengeful Ash', rarity: RARITY.RARE, archetype: 'Martyr',
    blurb: 'Whatever takes one of your pieces is frozen where it stands. Bring one more body.',
    tokens: ['vengefulash'], deploy: 1,
  },
  bonetithe: {
    id: 'bonetithe', name: 'Bone Tithe', rarity: RARITY.COMMON, archetype: 'Martyr',
    blurb: 'Six gold for every piece of yours that falls, and two more supply to spend.',
    goldPerLoss: 6, supply: 2,
  },

  // -------------------------------------------------------------- economy
  seal: {
    id: 'seal', name: "Merchant's Seal", rarity: RARITY.COMMON, archetype: 'Coin',
    blurb: 'A quarter off everything in every shop.',
    shopDiscount: 0.25,
  },
  tithebox: {
    id: 'tithebox', name: 'Tithe Box', rarity: RARITY.COMMON, archetype: 'Coin',
    blurb: 'Six gold after every fight you win.',
    goldPerFight: 6,
  },
  prospector: {
    id: 'prospector', name: "Prospector's Lens", rarity: RARITY.RARE, archetype: 'Coin',
    blurb: 'The dead leave more behind — an extra piece on every drop.',
    extraDrops: 1,
  },

  // -------------------------------------------------------------- sustain
  surgeon: {
    id: 'surgeon', name: 'Field Surgeon', rarity: RARITY.COMMON, archetype: 'Endure',
    blurb: 'Three HP back after every fight.',
    healPerFight: 3,
  },
  ironcrown: {
    id: 'ironcrown', name: 'Iron Crown', rarity: RARITY.RARE, archetype: 'Endure',
    blurb: 'Your king walks in shielded. The first blow only knocks it aside.',
    shieldTag: { tag: 'royal' },
  },
  secondwind: {
    id: 'secondwind', name: 'Second Wind', rarity: RARITY.EPIC, archetype: 'Endure',
    blurb: 'The first time a run would end, you live on a single hit point instead.',
    secondWind: true,
  },

  // ---------------------------------------------------------- reanimation
  // The army grows out of the fight instead of the loadout. Every trade the
  // raiser wins is worth double, so the plan is to survive contact and then
  // never stop trading.
  charnel: {
    id: 'charnel', name: 'Charnel Writ', rarity: RARITY.COMMON, archetype: 'Reanimation',
    blurb: 'Reanimators cost three less supply.',
    discount: { tag: 'reaper', amount: 3 },
  },
  gravecall: {
    id: 'gravecall', name: 'Gravecall', rarity: RARITY.RARE, archetype: 'Reanimation',
    blurb: 'Everything that rises for you rises shielded.',
    tokens: ['gravecall'],
  },
  massgrave: {
    id: 'massgrave', name: 'Mass Grave', rarity: RARITY.EPIC, archetype: 'Reanimation',
    blurb: 'Your pawns raise the dead as well. Every trade they win adds a body.',
    tokens: ['massgrave'], deploy: 1,
  },

  // --------------------------------------------------------------- volley
  // A shooter can never be traded off by the thing it kills, so the whole
  // plan is to build a firing line and make the enemy walk into it.
  quiver: {
    id: 'quiver', name: 'Deep Quiver', rarity: RARITY.COMMON, archetype: 'Volley',
    blurb: 'Anything that shoots costs three less supply.',
    discount: { tag: 'ranged', amount: 3 },
  },
  pavise: {
    id: 'pavise', name: 'Pavise', rarity: RARITY.RARE, archetype: 'Volley',
    blurb: 'Two of your shooters walk in shielded, at the cost of a body.',
    shieldTag: { tag: 'ranged' }, deploy: -1,
  },
  longshot: {
    id: 'longshot', name: 'Longshot', rarity: RARITY.EPIC, archetype: 'Volley',
    blurb: 'Your shooters reach the long 3–1 leap as well as the knight’s.',
    tokens: ['longshot'],
  },

  // ------------------------------------------------------------ formation
  // Banners reward keeping the army together — the opposite instinct to the
  // spread-out board most of these pieces want.
  drillground: {
    id: 'drillground', name: 'Drill Ground', rarity: RARITY.COMMON, archetype: 'Formation',
    blurb: 'Banners cost two less, and you bring one more body to carry them.',
    discount: { tag: 'banner', amount: 2 }, deploy: 1, supply: -1,
  },
  phalanx: {
    id: 'phalanx', name: 'Phalanx Drill', rarity: RARITY.RARE, archetype: 'Formation',
    blurb: 'Your banners carry two squares, not one. The whole block moves.',
    tokens: ['wideaura'],
  },
  oathstone: {
    id: 'oathstone', name: 'Oathstone', rarity: RARITY.EPIC, archetype: 'Formation',
    blurb: 'Friends beside a banner also leap like knights.',
    tokens: ['knightaura'],
  },

  // ---------------------------------------------------------------- relay
  relay: {
    id: 'relay', name: 'Relay Order', rarity: RARITY.COMMON, archetype: 'Relay',
    blurb: 'Couriers cost two less, and you bring one more body for them to move.',
    discount: { tag: 'courier', amount: 2 }, deploy: 1,
  },
  postroad: {
    id: 'postroad', name: 'Post Road', rarity: RARITY.RARE, archetype: 'Relay',
    blurb: 'Your couriers can trade places with the king itself. No net holds it.',
    tokens: ['kingswap'],
  },

  // ---------------------------------------------------------------- tempo
  horn: {
    id: 'horn', name: "Herald's Horn", rarity: RARITY.COMMON, archetype: 'Tempo',
    blurb: 'Three more turns on every clock.',
    clock: 3,
  },
  writ: {
    id: 'writ', name: 'Promotion Writ', rarity: RARITY.RARE, archetype: 'Tempo',
    blurb: 'Your pawns promote a rank sooner.',
    tokens: ['pioneer'],
  },
};

export const RELIC_IDS = Object.keys(RELICS);
export const relicById = (id) => RELICS[id] || null;

/** Relics the player does not already own, optionally filtered by rarity. */
export function relicPool(owned, rarity = null) {
  const have = new Set(owned || []);
  return RELIC_IDS
    .filter((id) => !have.has(id))
    .filter((id) => !rarity || RELICS[id].rarity === rarity);
}

/** Sums every numeric effect across the relics a run owns. */
export function relicTotals(owned) {
  const totals = {
    supply: 0, deploy: 0, clock: 0, goldPerFight: 0, goldPerLoss: 0,
    healPerFight: 0, shopDiscount: 0, extraDrops: 0,
    freePawn: false, secondWind: false,
    tokens: [], discounts: [], shieldTags: [],
  };
  for (const id of owned || []) {
    const relic = RELICS[id];
    if (!relic) continue;
    for (const key of ['supply', 'deploy', 'clock', 'goldPerFight', 'goldPerLoss',
      'healPerFight', 'shopDiscount', 'extraDrops']) {
      if (relic[key]) totals[key] += relic[key];
    }
    if (relic.freePawn) totals.freePawn = true;
    if (relic.secondWind) totals.secondWind = true;
    if (relic.tokens) totals.tokens.push(...relic.tokens);
    if (relic.discount) totals.discounts.push(relic.discount);
    if (relic.shieldTag) totals.shieldTags.push(relic.shieldTag.tag);
  }
  return totals;
}

/** Supply cost of a piece after relic discounts, never below zero. */
export function discountedCost(owned, pieceId) {
  const base = PIECES[pieceId]?.cost ?? 0;
  let cost = base;
  for (const d of relicTotals(owned).discounts) {
    if (hasTag(pieceId, d.tag)) cost -= d.amount;
  }
  return Math.max(0, cost);
}
