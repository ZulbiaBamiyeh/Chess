// Encounters, shop stock and king passives. Pure data plus a few helpers —
// run.js owns the mutable run, this file is the book it reads.

import { PIECES, RARITY, shopPool, pieceCost } from './pieces.js';
import { TILE } from './chess.js';

export const START_HEARTS = 3;
export const START_GOLD = 2;

export const STARTING_BAG = ['p', 'p', 'p', 'n', 'f', 'w'];

export const KING_PASSIVES = {
  aegis: {
    id: 'aegis',
    name: 'Aegis',
    blurb: 'Your king enters each fight shielded — the first hit knocks it aside.',
    cost: 7,
  },
  dash: {
    id: 'dash',
    name: 'Dash',
    blurb: 'Your king may leap two squares orthogonally.',
    cost: 6,
  },
  tithe: {
    id: 'tithe',
    name: 'Tithe',
    blurb: 'Each capture you make pays 1 extra gold.',
    cost: 5,
  },
  command: {
    id: 'command',
    name: 'Command',
    blurb: 'Friendly pieces that start next to your king are shielded.',
    cost: 8,
  },
};

export const ENCOUNTERS = [
  {
    id: 'gate',
    kind: 'fight',
    name: 'The Gate',
    blurb: 'A sentry and two attendants. Four squares on a side.',
    files: 4,
    ranks: 4,
    supply: 6,
    ai: { depth: 2, slip: 0.28, budget: 220 },
    enemy: [
      { type: 'k', at: 'c4' },
      { type: 'p', at: 'b4' },
      { type: 'f', at: 'd4' },
    ],
  },
  {
    id: 'alley',
    kind: 'fight',
    name: 'The Alley',
    blurb: 'A tight 5×3 board. Three pieces, no room to hide.',
    files: 5,
    ranks: 3,
    supply: 5,
    ai: { depth: 3, slip: 0.16, budget: 350 },
    enemy: [
      { type: 'k', at: 'c3' },
      { type: 'n', at: 'e3' },
    ],
  },
  { id: 'shop-1', kind: 'shop', name: 'Wayside Stall', blurb: 'A folding table and a bag of pieces.' },
  {
    id: 'courtyard',
    kind: 'fight',
    name: 'The Courtyard',
    blurb: 'Frost across the middle. Step carefully.',
    files: 5,
    ranks: 5,
    supply: 8,
    ai: { depth: 3, slip: 0.1, budget: 500 },
    enemy: [
      { type: 'k', at: 'c5' },
      { type: 'p', at: 'b5' },
      { type: 'p', at: 'd5' },
      { type: 'n', at: 'e5' },
    ],
    terrain: { c3: TILE.FROST, b3: TILE.FROST, d3: TILE.FROST },
  },
  {
    id: 'outpost',
    kind: 'fight',
    name: 'Camel Outpost',
    blurb: 'Blocked corners and a long-striding camel.',
    files: 5,
    ranks: 5,
    supply: 9,
    ai: { depth: 3, slip: 0.06, budget: 650 },
    enemy: [
      { type: 'k', at: 'c5' },
      { type: 'c', at: 'a4' },
      { type: 'p', at: 'd5' },
      { type: 'w', at: 'e5' },
    ],
    terrain: { a5: TILE.BLOCK, e1: TILE.BLOCK, a1: TILE.BLOCK, e4: TILE.BLOCK },
  },
  { id: 'shop-2', kind: 'shop', name: 'The Armoury', blurb: 'Heavier stock. Spend what you took.' },
  {
    id: 'keep',
    kind: 'fight',
    name: 'The Keep',
    blurb: 'A fort in the centre and a rook that wants it.',
    files: 6,
    ranks: 6,
    supply: 12,
    ai: { depth: 4, slip: 0.04, budget: 900 },
    enemy: [
      { type: 'k', at: 'd6' },
      { type: 'r', at: 'a6' },
      { type: 'b', at: 'f6' },
      { type: 'p', at: 'c5' },
      { type: 'f', at: 'e5' },
    ],
    terrain: { c3: TILE.FORT, d3: TILE.FORT, c4: TILE.FORT, d4: TILE.FORT },
  },
  {
    id: 'throne',
    kind: 'fight',
    name: 'The Throne',
    blurb: 'Their queen brought friends. Take the king.',
    files: 6,
    ranks: 6,
    supply: 14,
    boss: true,
    ai: { depth: 5, slip: 0, budget: 1400 },
    enemy: [
      { type: 'k', at: 'd6' },
      { type: 'q', at: 'c6' },
      { type: 'g', at: 'f5' },
      { type: 'n', at: 'b5' },
      { type: 'p', at: 'e6' },
    ],
    terrain: { b3: TILE.FROST, e3: TILE.FROST, a4: TILE.BLOCK, f4: TILE.BLOCK },
  },
];

export function encounterById(id) {
  return ENCOUNTERS.find((e) => e.id === id) || null;
}

export function fightNodes() {
  return ENCOUNTERS.filter((e) => e.kind === 'fight');
}

/** Squares the player may deploy onto. Last rank, plus the one above on taller boards. */
export function homeSquares(files, ranks) {
  const rows = ranks <= 4 ? 1 : 2;
  const out = [];
  for (let i = 0; i < rows; i++) {
    const r = ranks - 1 - i;
    for (let f = 0; f < files; f++) out.push(r * 16 + f);
  }
  return out;
}

export function enemySquares(encounter) {
  return new Set((encounter.enemy || []).map((p) => p.at));
}

const RARITY_WEIGHT = {
  [RARITY.COMMON]: 52,
  [RARITY.UNCOMMON]: 28,
  [RARITY.RARE]: 15,
  [RARITY.LEGENDARY]: 5,
};

export function weightedPiece(rng, allowed) {
  const pool = shopPool().filter((p) => !allowed || allowed.has(p.rarity));
  let total = 0;
  const bag = [];
  for (const p of pool) {
    const w = RARITY_WEIGHT[p.rarity] || 0;
    if (w <= 0) continue;
    bag.push({ p, w });
    total += w;
  }
  if (!total) return null;
  let roll = rng() * total;
  for (const { p, w } of bag) {
    roll -= w;
    if (roll <= 0) return p;
  }
  return bag[bag.length - 1].p;
}

export function supplyUpgradeCost(bought) {
  return 5 + bought * 4;
}

export function slotUpgradeCost(rarity) {
  if (rarity === RARITY.UNCOMMON) return 6;
  if (rarity === RARITY.RARE) return 9;
  if (rarity === RARITY.LEGENDARY) return 12;
  return 8;
}

export function pieceBounty(type) {
  return pieceCost(type);
}

export { PIECES };
