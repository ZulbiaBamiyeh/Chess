// Data-driven piece registry. Classic six plus a small fairy set the run
// draws from. The engine looks up movement here; the AI reads `value`; the
// loadout and shop read `cost` and `rarity`.

export const RARITY = {
  COMMON: 'common',
  RARE: 'rare',
  EPIC: 'epic',
  LEGENDARY: 'legendary',
  UNIQUE: 'unique',
};

/** Commons are uncapped. Rare / epic / legendary are slot-limited. */
export const SLOT_CAPS = {
  common: Infinity,
  rare: 3,
  epic: 2,
  legendary: 1,
};

const N = [[1, 2], [1, -2], [-1, 2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1]];
const B = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const R = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const K = [...B, ...R];
const C = [[1, 3], [1, -3], [-1, 3], [-1, -3], [3, 1], [3, -1], [-3, 1], [-3, -1]];
const ALFIL = [[2, 2], [2, -2], [-2, 2], [-2, -2]];
const DABBABA = [[2, 0], [-2, 0], [0, 2], [0, -2]];

/** @typedef {'common'|'uncommon'|'rare'|'legendary'|'unique'} Rarity */

/**
 * @typedef {object} PieceDef
 * @property {string} id
 * @property {string} name
 * @property {string} [blurb]
 * @property {number} cost          supply points to deploy
 * @property {Rarity} rarity
 * @property {number} value         AI centipawns
 * @property {string} sprite        basename of the hand-drawn art
 * @property {number} [hue]         extra hue-rotate so fairy pieces read apart
 * @property {number[][]} [leaps]   [file, rank] jumps
 * @property {number[][]} [slides]  [file, rank] rays
 * @property {number[][]} [hopper]  grasshopper-style hop rays
 * @property {boolean} [pawn]
 * @property {boolean} [royal]
 * @property {boolean} [cannotCapture]
 * @property {boolean} [paintsFire]
 * @property {boolean} [ice]
 * @property {boolean} [wisp]
 * @property {boolean} [shop]
 */

/** @type {Record<string, PieceDef>} */
export const PIECES = {
  p: {
    id: 'p', name: 'Pawn', blurb: 'Steps forward, takes diagonally.',
    cost: 1, rarity: RARITY.COMMON, value: 100, sprite: 'pawn', pawn: true,
  },
  n: {
    id: 'n', name: 'Knight', blurb: 'The familiar 2–1 leap.',
    cost: 3, rarity: RARITY.COMMON, value: 320, sprite: 'knight', leaps: N,
  },
  b: {
    id: 'b', name: 'Bishop', blurb: 'Slides on the diagonals.',
    cost: 3, rarity: RARITY.COMMON, value: 330, sprite: 'bishop', slides: B,
  },
  r: {
    id: 'r', name: 'Rook', blurb: 'Slides on the files and ranks.',
    cost: 5, rarity: RARITY.RARE, value: 500, sprite: 'rook', slides: R,
  },
  q: {
    id: 'q', name: 'Queen', blurb: 'Bishop and rook in one body.',
    cost: 9, rarity: RARITY.EPIC, value: 900, sprite: 'queen', slides: K,
  },
  k: {
    id: 'k', name: 'King', blurb: 'One step any way. Capture it and the fight ends.',
    cost: 0, rarity: RARITY.UNIQUE, value: 20000, sprite: 'king', leaps: K, royal: true,
  },
  f: {
    id: 'f', name: 'Ferz', blurb: 'A single diagonal step.',
    cost: 2, rarity: RARITY.COMMON, value: 150, sprite: 'ferz', leaps: B,
  },
  w: {
    id: 'w', name: 'Wazir', blurb: 'A single orthogonal step.',
    cost: 2, rarity: RARITY.COMMON, value: 160, sprite: 'wazir', leaps: R,
  },
  c: {
    id: 'c', name: 'Camel', blurb: 'The long 3–1 leap. Jumps anything.',
    cost: 3, rarity: RARITY.RARE, value: 280, sprite: 'camel', leaps: C,
  },
  h: {
    id: 'h', name: 'Champion', blurb: 'Wazir, alfil and dabbaba — short and long.',
    cost: 5, rarity: RARITY.RARE, value: 420, sprite: 'king', hue: 168,
    leaps: [...R, ...ALFIL, ...DABBABA],
  },
  s: {
    id: 's', name: 'Princess', blurb: 'Bishop plus knight.',
    cost: 7, rarity: RARITY.EPIC, value: 780, sprite: 'bishop', hue: 280, leaps: N, slides: B,
  },
  t: {
    id: 't', name: 'Empress', blurb: 'Rook plus knight.',
    cost: 8, rarity: RARITY.EPIC, value: 850, sprite: 'rook', hue: 155, leaps: N, slides: R,
  },
  a: {
    id: 'a', name: 'Amazon', blurb: 'Queen plus knight. A problem.',
    cost: 12, rarity: RARITY.LEGENDARY, value: 1250, sprite: 'queen', hue: 318, leaps: N, slides: K,
  },
  g: {
    id: 'g', name: 'Hopper', blurb: 'Hops the first piece it meets, lands just beyond.',
    cost: 4, rarity: RARITY.RARE, value: 300, sprite: 'hopper', hopper: K,
  },
  d: {
    id: 'd', name: 'Drake', blurb: 'A living wall. Cannot capture, and cannot be taken.',
    cost: 2, rarity: RARITY.RARE, value: 220, sprite: 'drake', leaps: K,
    cannotCapture: true, uncapturable: true,
  },
  i: {
    id: 'i', name: 'Rime',
    blurb: 'One step any way. Freezes enemies beside her — and herself with them.',
    cost: 5, rarity: RARITY.EPIC, value: 420, sprite: 'ice', leaps: K, ice: true,
  },
  l: {
    id: 'l', name: 'Flame', blurb: 'A bishop whose path burns for a turn.',
    cost: 5, rarity: RARITY.EPIC, value: 480, sprite: 'firebishop', slides: B, paintsFire: true,
  },
  y: {
    id: 'y', name: 'Wisp', blurb: 'If it is taken, the taker dies with it.',
    cost: 4, rarity: RARITY.LEGENDARY, value: 380, sprite: 'wisp', leaps: B, wisp: true,
  },
};

// `e` is reserved in some FENs; Empress uses `t` (for "tower-knight") so a
// placement string never collides with en-passant `-` parsing.

const CLASSIC_IDS = new Set(['p', 'n', 'b', 'r', 'q', 'k']);

export function pieceById(id) {
  return PIECES[id] || null;
}

export function isClassicType(id) {
  return CLASSIC_IDS.has(id);
}

export function isRoyal(id) {
  return Boolean(PIECES[id]?.royal);
}

export function pieceCost(id) {
  return PIECES[id]?.cost ?? 0;
}

export function pieceValue(id) {
  return PIECES[id]?.value ?? 0;
}

export function rarityOf(id) {
  return PIECES[id]?.rarity ?? RARITY.COMMON;
}

export function shopPool() {
  return Object.values(PIECES).filter((p) => p.rarity !== RARITY.UNIQUE && p.shop !== false);
}

export function isQueenLike(id) {
  return id === 'q' || id === 't' || id === 'a';
}

/** Offsets in 0x88 (`dr * 16 + df`) for a list of [file, rank] vectors. */
export function toOffsets(vectors) {
  const out = new Array(vectors.length);
  for (let i = 0; i < vectors.length; i++) {
    out[i] = vectors[i][1] * 16 + vectors[i][0];
  }
  return out;
}

// Precomputed so the generator never rebuilds them.
for (const def of Object.values(PIECES)) {
  if (def.leaps) def.leapOff = toOffsets(def.leaps);
  if (def.slides) def.slideOff = toOffsets(def.slides);
  if (def.hopper) def.hopperOff = toOffsets(def.hopper);
}

export const PROMOTE_TO = ['q', 'r', 'b', 'n'];
export { N as KNIGHT_VECTORS, B as BISHOP_VECTORS, R as ROOK_VECTORS, K as KING_VECTORS };
