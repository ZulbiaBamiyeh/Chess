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
const ZEBRA = [[2, 3], [2, -3], [-2, 3], [-2, -3], [3, 2], [3, -2], [-3, 2], [-3, -2]];
/** Every square exactly two away — the alfil, dabbaba and knight rings. */
const DIST2 = [...ALFIL, ...DABBABA, ...N];

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
 * @property {boolean} [sapper]   blast on being captured
 * @property {boolean} [shielded] enters the fight already shielded
 * @property {number[][]} [shoots] captures at these offsets without moving
 * @property {boolean} [raises]   what it kills rises again on its side
 * @property {boolean} [aura]     lends adjacent friendlies a king step
 * @property {boolean} [swaps]    trades places with friendly pieces
 * @property {boolean} [pull]     drags enemies two squares away one square closer
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
    cost: 11, rarity: RARITY.EPIC, value: 900, sprite: 'queen', slides: K,
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
    cost: 4, rarity: RARITY.RARE, value: 420, sprite: 'champion',
    leaps: [...R, ...ALFIL, ...DABBABA],
  },
  s: {
    id: 's', name: 'Princess', blurb: 'Bishop plus knight.',
    cost: 8, rarity: RARITY.EPIC, value: 780, sprite: 'princess', leaps: N, slides: B,
  },
  t: {
    id: 't', name: 'Empress', blurb: 'Rook plus knight.',
    cost: 9, rarity: RARITY.EPIC, value: 850, sprite: 'empress', leaps: N, slides: R,
  },
  a: {
    id: 'a', name: 'Amazon', blurb: 'Queen plus knight. A problem.',
    cost: 17, rarity: RARITY.LEGENDARY, value: 1250, sprite: 'amazon', leaps: N, slides: K,
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
    cost: 5, rarity: RARITY.EPIC, value: 440, sprite: 'ice', leaps: K, ice: true,
  },
  l: {
    id: 'l', name: 'Flame', blurb: 'A bishop whose path burns for a turn.',
    cost: 4, rarity: RARITY.EPIC, value: 440, sprite: 'firebishop', slides: B, paintsFire: true,
  },
  y: {
    id: 'y', name: 'Wisp', blurb: 'If it is taken, the taker dies with it.',
    cost: 3, rarity: RARITY.LEGENDARY, value: 340, sprite: 'wisp', leaps: B, wisp: true,
  },
  z: {
    id: 'z', name: 'Zebra', blurb: 'The 3–2 leap. Lands where nothing else can reach.',
    cost: 3, rarity: RARITY.RARE, value: 270, sprite: 'zebra', leaps: ZEBRA,
  },
  m: {
    id: 'm', name: 'Nightrider',
    blurb: 'Repeats the knight leap in a line until something blocks it.',
    cost: 6, rarity: RARITY.EPIC, value: 620, sprite: 'nightrider', slides: N,
  },
  x: {
    id: 'x', name: 'Sapper',
    blurb: 'One orthogonal step. Take it and the blast kills the captor and all around it.',
    cost: 3, rarity: RARITY.EPIC, value: 300, sprite: 'sapper', leaps: R, sapper: true,
  },
  v: {
    id: 'v', name: 'Warden', blurb: 'One step any way, and it walks into the fight shielded.',
    cost: 4, rarity: RARITY.RARE, value: 370, sprite: 'warden', leaps: K, shielded: true,
  },

  // ---- bodies -----------------------------------------------------------
  // Cheap, honest pieces. The swarm archetype had nothing between a 1-supply
  // pawn and a 3-supply knight worth filling a deploy slot with.
  guard: {
    id: 'guard', name: 'Guard', san: 'Gd', blurb: 'One step any way. No tricks, just a body that fights.',
    cost: 2, rarity: RARITY.RARE, value: 270, sprite: 'guard', leaps: K,
  },

  // ---- leapers ----------------------------------------------------------
  gnu: {
    id: 'gnu', name: 'Gnu', san: 'Gn', blurb: 'Knight and camel in one. Nothing on the board is safe from it.',
    cost: 6, rarity: RARITY.RARE, value: 520, sprite: 'gnu', leaps: [...N, ...C],
  },
  squirrel: {
    id: 'squirrel', name: 'Squirrel', san: 'Sq',
    blurb: 'Leaps to any square exactly two away. Sixteen of them.',
    cost: 4, rarity: RARITY.RARE, value: 450, sprite: 'squirrel', leaps: DIST2,
  },

  // ---- sliders ----------------------------------------------------------
  horse: {
    id: 'horse', name: 'Dragon Horse', san: 'Dh', blurb: 'A bishop that also steps sideways. It sees every square.',
    cost: 5, rarity: RARITY.RARE, value: 520, sprite: 'horse', leaps: R, slides: B,
  },
  dragon: {
    id: 'dragon', name: 'Dragon King', san: 'Dk', blurb: 'A rook that also steps on the diagonals.',
    cost: 9, rarity: RARITY.EPIC, value: 800, sprite: 'dragon', leaps: B, slides: R,
  },

  // ---- new rules --------------------------------------------------------
  banner: {
    id: 'banner', name: 'Banner', san: 'Bn',
    blurb: 'One orthogonal step. Every friend standing beside it also moves a king’s step.',
    cost: 5, rarity: RARITY.RARE, value: 300, sprite: 'banner', leaps: R, aura: true,
  },
  courier: {
    id: 'courier', name: 'Courier', san: 'Co',
    blurb: 'Slides on the diagonals, and trades places with a friend instead of stopping at one.',
    cost: 4, rarity: RARITY.RARE, value: 360, sprite: 'courier', slides: B, swaps: true,
  },
  crossbow: {
    id: 'crossbow', name: 'Crossbow', san: 'Xb',
    blurb: 'Steps one square diagonally. Kills at a knight’s leap without ever moving.',
    cost: 7, rarity: RARITY.EPIC, value: 470, sprite: 'crossbow', leaps: B, shoots: N,
  },
  reaper: {
    id: 'reaper', name: 'Reanimator', san: 'Rn',
    blurb: 'Steps one square any way. Whatever it kills gets up again on your side.',
    cost: 8, rarity: RARITY.EPIC, value: 560, sprite: 'reaper', leaps: K, raises: true,
  },

  // ---- the pull ---------------------------------------------------------
  // Every other piece in the book answers "where can I go". This one answers
  // "where do I make you go", which is a different question and the reason
  // it exists: it turns every hazard already on the board — fire, ice, a
  // sapper, your own firing lines — into something you can drag them onto
  // rather than wait for them to walk into.
  lodestone: {
    id: 'lodestone', name: 'Lodestone', san: 'Ld',
    blurb: 'Steps one square any way. Every enemy two squares off in a straight line, '
      + 'with the gap between clear, is dragged one square closer.',
    cost: 7, rarity: RARITY.EPIC, value: 500, sprite: 'lodestone', leaps: K, pull: true,
  },

  // ---- legendaries ------------------------------------------------------
  // There were two in the whole book (Amazon, Wisp), so "a legendary dropped"
  // almost always meant the same piece twice. These are built to be worth the
  // one slot a run gets, and to want completely different armies around them.
  basilisk: {
    id: 'basilisk', name: 'Basilisk', san: 'Bs',
    blurb: 'Slides on the diagonals, and everything orthogonally beside where it stops '
      + 'freezes — itself included.',
    cost: 9, rarity: RARITY.LEGENDARY, value: 760, sprite: 'basilisk',
    slides: B, ice: true,
  },
  colossus: {
    id: 'colossus', name: 'Colossus', san: 'Cl',
    blurb: 'A slow, enormous body: one step any way, and it enters the fight shielded. '
      + 'Whatever takes the shield off is standing next to a Colossus.',
    cost: 8, rarity: RARITY.LEGENDARY, value: 690, sprite: 'colossus',
    leaps: [...K, ...DABBABA], shielded: true,
  },

  // ---- ranged -----------------------------------------------------------
  bombard: {
    id: 'bombard', name: 'Bombard', san: 'Bd',
    blurb: 'Steps one square orthogonally. Kills anything exactly two squares away '
      + 'in a straight line, without moving.',
    cost: 6, rarity: RARITY.RARE, value: 430, sprite: 'bombard',
    leaps: R, shoots: DABBABA,
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
  if (def.shoots) def.shootOff = toOffsets(def.shoots);
}

export const PROMOTE_TO = ['q', 'r', 'b', 'n'];
export { N as KNIGHT_VECTORS, B as BISHOP_VECTORS, R as ROOK_VECTORS, K as KING_VECTORS };
