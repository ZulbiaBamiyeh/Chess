// Encounters, shop tables, kings and map layout. Pure data plus helpers —
// run.js owns the mutable run.

import { PIECES, RARITY, shopPool, pieceCost } from './pieces.js';
import { TILE, parseSquare } from './chess.js';

export const START_HP = 18;
export const START_GOLD = 4;
export const REST_HEAL = 7;
export const REST_GOLD = 3;
export const FORAGE_GOLD = 9;
export const TRAIN_COST = 6;

// A camp isn't one fixed room, so it shouldn't read like one — same choices
// every time, but the map tooltip and the room's own name vary per visit.
const REST_NAMES = [
  { name: 'A Quiet Square', blurb: 'Rest, forage, or train — your call.' },
  { name: 'Dead Coals', blurb: 'Someone camped here first. Rest, forage, or train.' },
  { name: 'The Watch Fire', blurb: 'Still burning. Rest, forage, or train.' },
  { name: 'A Sheltered Corner', blurb: 'Out of the wind, at least. Rest, forage, or train.' },
  { name: 'The Last Mile Marker', blurb: 'Someone carved a name into it. Rest, forage, or train.' },
];
export const TURN_CLOCK = { trash: 10, elite: 14, boss: 18 };

export const STARTING_BAG = ['p', 'p', 'p', 'n', 'f', 'w'];

export const LOSS_HP = { trash: 3, elite: 6, boss: 8 };
export const FORFEIT_HP = { trash: 2, elite: 3, boss: 4 };

export const PLAIN_KING = {
  id: 'plain',
  name: 'Plain',
  blurb: 'One step any way. No extra gift.',
  cost: 0,
  sprite: 'king',
};

export function kingDef(id) {
  if (!id || id === 'plain') return PLAIN_KING;
  return KING_PASSIVES[id] || PLAIN_KING;
}

export const KING_PASSIVES = {
  aegis: {
    id: 'aegis',
    name: 'Aegis',
    blurb: 'Your king enters each fight shielded — the first hit knocks it aside.',
    cost: 8,
    sprite: 'king-aegis',
  },
  pioneer: {
    id: 'pioneer',
    name: 'Pioneer',
    blurb: 'Your pieces promote one rank sooner.',
    cost: 7,
    sprite: 'king-pioneer',
  },
  court: {
    id: 'court',
    name: 'Court',
    blurb: 'Queens, empresses and amazons also leap like knights.',
    cost: 9,
    sprite: 'king-court',
  },
  pyre: {
    id: 'pyre',
    name: 'Pyre',
    blurb: 'Your sliders leave fire on the path they travel.',
    cost: 9,
    sprite: 'king-pyre',
  },
  hoarfrost: {
    id: 'hoarfrost',
    name: 'Hoarfrost',
    blurb: 'Enemies that start the fight next to your king are frozen.',
    cost: 7,
    sprite: 'king-hoarfrost',
  },
};

const AI = {
  easy: { depth: 3, slip: 0.1, budget: 450 },
  mid: { depth: 4, slip: 0.04, budget: 800 },
  hard: { depth: 5, slip: 0, budget: 1400 },
  boss: { depth: 6, slip: 0, budget: 2400 },
};

/** Encounter book. `theme` drives drops; `tier` drives HP loss and map slots. */
export const ENCOUNTERS = {
  gate: {
    id: 'gate', kind: 'fight', tier: 'trash', act: 1,
    pool: 'easy',
    name: 'The Gate', blurb: 'A sentry and two attendants.',
    files: 4, ranks: 4, supply: 6, ai: AI.easy, theme: 'court',
    enemy: [
      { type: 'k', at: 'c4' },
      { type: 'p', at: 'b4' },
      { type: 'f', at: 'd4' },
    ],
  },
  alley: {
    id: 'alley', kind: 'fight', tier: 'trash', act: 1,
    pool: 'easy',
    name: 'The Alley', blurb: 'A tight 5×3. Three pieces, no room to hide.',
    files: 5, ranks: 3, supply: 5, ai: AI.easy, theme: 'court',
    enemy: [
      { type: 'k', at: 'c3' },
      { type: 'n', at: 'e3' },
    ],
  },
  courtyard: {
    id: 'courtyard', kind: 'fight', tier: 'trash', act: 1,
    pool: 'hard',
    name: 'The Courtyard', blurb: 'Frost across the middle.',
    files: 5, ranks: 5, supply: 8, ai: AI.mid, theme: 'ice',
    enemy: [
      { type: 'k', at: 'c5' },
      { type: 'p', at: 'b5' },
      { type: 'p', at: 'd5' },
      { type: 'n', at: 'e5' },
    ],
    terrain: { c3: TILE.FROST, b3: TILE.FROST, d3: TILE.FROST },
  },
  paddock: {
    id: 'paddock', kind: 'fight', tier: 'trash', act: 1,
    pool: 'hard',
    name: 'The Paddock', blurb: 'Camels in a small yard.',
    files: 5, ranks: 4, supply: 7, ai: AI.easy, theme: 'camel',
    enemy: [
      { type: 'k', at: 'c4' },
      { type: 'c', at: 'a3' },
      { type: 'p', at: 'd4' },
    ],
  },
  pond: {
    id: 'pond', kind: 'fight', tier: 'elite', act: 1,
    name: 'The Duck', blurb: 'After every move you must park the yellow duck on an empty square.',
    files: 5, ranks: 5, supply: 8, ai: AI.mid, theme: 'duck',
    rules: { duckChess: true },
    duckAt: 'c3',
    enemy: [
      { type: 'k', at: 'c5' },
      { type: 'n', at: 'e5' },
      { type: 'd', at: 'a4' },
      { type: 'p', at: 'd5' },
    ],
  },
  outpost: {
    id: 'outpost', kind: 'fight', tier: 'elite', act: 1,
    name: 'Camel Outpost', blurb: 'Blocked corners and a long-striding camel.',
    files: 5, ranks: 5, supply: 9, ai: AI.mid, theme: 'camel',
    enemy: [
      { type: 'k', at: 'c5' },
      { type: 'c', at: 'a4' },
      { type: 'p', at: 'd5' },
      { type: 'w', at: 'e5' },
    ],
    terrain: { a5: TILE.BLOCK, e1: TILE.BLOCK, a1: TILE.BLOCK, e4: TILE.BLOCK },
  },
  icebox: {
    id: 'icebox', kind: 'fight', tier: 'elite', act: 1,
    name: 'The Icebox', blurb: 'A rime piece and a drake holding the door.',
    files: 6, ranks: 6, supply: 11, ai: AI.mid, theme: 'ice',
    enemy: [
      { type: 'k', at: 'd6' },
      { type: 'i', at: 'c5' },
      { type: 'd', at: 'e5' },
      { type: 'p', at: 'b6' },
    ],
    terrain: { b3: TILE.FROST, e3: TILE.FROST, c3: TILE.BLOCK, d3: TILE.BLOCK },
  },
  steward: {
    id: 'steward', kind: 'fight', tier: 'boss', act: 1, boss: true,
    name: 'The Steward', blurb: 'A full board. A thin army. Take the king.',
    files: 8, ranks: 8, supply: 16, ai: AI.hard, theme: 'court',
    enemy: [
      { type: 'k', at: 'e8' },
      { type: 'r', at: 'a8' },
      { type: 'n', at: 'b8' },
      { type: 'p', at: 'd7' },
      { type: 'p', at: 'e7' },
      { type: 'p', at: 'f7' },
    ],
    terrain: { c6: TILE.BLOCK, f6: TILE.BLOCK },
  },
  cinders: {
    id: 'cinders', kind: 'fight', tier: 'trash', act: 2,
    pool: 'easy',
    name: 'Cinder Lane', blurb: 'Flame on a short file.',
    files: 5, ranks: 5, supply: 9, ai: AI.mid, theme: 'flame',
    enemy: [
      { type: 'k', at: 'c5' },
      { type: 'l', at: 'b4' },
      { type: 'p', at: 'd5' },
    ],
  },
  flock: {
    id: 'flock', kind: 'fight', tier: 'trash', act: 2,
    pool: 'easy',
    name: 'The Flock', blurb: 'Ducks in a corridor.',
    files: 6, ranks: 4, supply: 8, ai: AI.mid, theme: 'duck',
    enemy: [
      { type: 'k', at: 'd4' },
      { type: 'd', at: 'b3' },
      { type: 'd', at: 'e3' },
      { type: 'p', at: 'c4' },
    ],
    terrain: { a2: TILE.BLOCK, f2: TILE.BLOCK },
  },
  flame: {
    id: 'flame', kind: 'fight', tier: 'elite', act: 2,
    name: 'Flame Demon', blurb: 'Fire bishops. Their path burns.',
    files: 6, ranks: 6, supply: 14, ai: AI.hard, theme: 'flame',
    enemy: [
      { type: 'k', at: 'd6' },
      { type: 'l', at: 'c6' },
      { type: 'l', at: 'e5' },
      { type: 'l', at: 'b5' },
      { type: 'p', at: 'd5' },
    ],
    terrain: { a3: TILE.BLOCK, f3: TILE.BLOCK },
  },
  vault: {
    id: 'vault', kind: 'fight', tier: 'elite', act: 2,
    name: 'The Vault', blurb: 'Walls, a hopper, a princess.',
    files: 6, ranks: 6, supply: 13, ai: AI.hard, theme: 'court',
    enemy: [
      { type: 'k', at: 'd6' },
      { type: 's', at: 'f6' },
      { type: 'g', at: 'a5' },
      { type: 'r', at: 'a6' },
    ],
    terrain: { b3: TILE.BLOCK, c3: TILE.BLOCK, d4: TILE.FORT, e3: TILE.BLOCK },
  },
  warden: {
    id: 'warden', kind: 'fight', tier: 'boss', act: 2, boss: true,
    name: 'The Warden', blurb: 'An 8×8 keep. A duck on the gate and fire in the yard.',
    files: 8, ranks: 8, supply: 20, ai: AI.boss, theme: 'flame',
    enemy: [
      { type: 'k', at: 'e8' },
      { type: 'q', at: 'd8' },
      { type: 'l', at: 'c8' },
      { type: 'd', at: 'e6' },
      { type: 'n', at: 'b8' },
      { type: 'p', at: 'c7' },
      { type: 'p', at: 'd7' },
      { type: 'p', at: 'e7' },
    ],
    terrain: { b5: TILE.BLOCK, g5: TILE.BLOCK, d4: TILE.FORT },
  },
  hush: {
    id: 'hush', kind: 'fight', tier: 'trash', act: 3,
    pool: 'easy',
    name: 'The Hush', blurb: 'A wisp floats over a short board.',
    files: 5, ranks: 5, supply: 10, ai: AI.hard, theme: 'wisp',
    enemy: [
      { type: 'k', at: 'c5' },
      { type: 'y', at: 'b3' },
      { type: 'i', at: 'd4' },
    ],
  },
  nave: {
    id: 'nave', kind: 'fight', tier: 'elite', act: 3,
    name: 'The Nave', blurb: 'Empress and hopper in a walled aisle.',
    files: 7, ranks: 7, supply: 16, ai: AI.hard, theme: 'court',
    enemy: [
      { type: 'k', at: 'd7' },
      { type: 't', at: 'a7' },
      { type: 'g', at: 'g5' },
      { type: 'b', at: 'f7' },
      { type: 'p', at: 'c6' },
    ],
    terrain: { c4: TILE.BLOCK, e4: TILE.BLOCK, d3: TILE.FORT },
  },
  throne: {
    id: 'throne', kind: 'fight', tier: 'boss', act: 3, boss: true,
    name: 'The Throne', blurb: 'A full chessboard. Their court, their fire, their king.',
    files: 8, ranks: 8, supply: 24, ai: AI.boss, theme: 'flame',
    enemy: [
      { type: 'k', at: 'e8' },
      { type: 'q', at: 'd8' },
      { type: 'l', at: 'c8' },
      { type: 'l', at: 'f8' },
      { type: 'r', at: 'a8' },
      { type: 'n', at: 'b8' },
      { type: 'y', at: 'g7' },
      { type: 'p', at: 'c7' },
      { type: 'p', at: 'd7' },
      { type: 'p', at: 'e7' },
      { type: 'p', at: 'f7' },
    ],
    terrain: { b5: TILE.BLOCK, g5: TILE.BLOCK },
  },
// ---------------------------------------------------------------- act 1
  // Easy pool: the first floor of an act draws from here, so a run never
  // opens on something that can end it.
  hedge: {
    id: 'hedge', kind: 'fight', tier: 'trash', act: 1, pool: 'easy',
    name: 'The Hedge', blurb: 'Two spearmen and nowhere to hide.',
    files: 4, ranks: 4, supply: 5, ai: AI.easy, theme: 'court',
    enemy: [{ type: 'k', at: 'b4' }, { type: 'p', at: 'a4' }, { type: 'p', at: 'c4' }],
  },
  ford: {
    id: 'ford', kind: 'fight', tier: 'trash', act: 1, pool: 'easy',
    name: 'The Ford', blurb: 'A wazir holding the crossing.',
    files: 5, ranks: 4, supply: 6, ai: AI.easy, theme: 'court',
    terrain: { c2: TILE.BLOCK, c3: TILE.BLOCK },
    enemy: [{ type: 'k', at: 'c4' }, { type: 'w', at: 'b4' }, { type: 'p', at: 'd4' }],
  },
  // Hard pool: everything after.
  bailey: {
    id: 'bailey', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Bailey', blurb: 'A rook on an open file.',
    files: 5, ranks: 5, supply: 8, ai: AI.mid, theme: 'court',
    enemy: [{ type: 'k', at: 'c5' }, { type: 'r', at: 'a5' }, { type: 'p', at: 'd5' }],
  },
  scree: {
    id: 'scree', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Scree', blurb: 'Broken ground, and a zebra that ignores it.',
    files: 5, ranks: 5, supply: 8, ai: AI.mid, theme: 'camel',
    terrain: { b3: TILE.BLOCK, d3: TILE.BLOCK },
    enemy: [{ type: 'k', at: 'c5' }, { type: 'z', at: 'e5' }, { type: 'p', at: 'b5' }],
  },
  rookery: {
    id: 'rookery', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Rookery', blurb: 'A hopper wants a crowd. Do not give it one.',
    files: 5, ranks: 5, supply: 8, ai: AI.mid, theme: 'court',
    enemy: [{ type: 'k', at: 'c5' }, { type: 'g', at: 'b5' }, { type: 'p', at: 'd5' }, { type: 'p', at: 'e5' }],
  },
  cloister: {
    id: 'cloister', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Cloister', blurb: 'Two bishops on opposite colours.',
    files: 6, ranks: 5, supply: 9, ai: AI.mid, theme: 'court',
    enemy: [{ type: 'k', at: 'c5' }, { type: 'b', at: 'b5' }, { type: 'b', at: 'e5' }, { type: 'p', at: 'd5' }],
  },
  shallows: {
    id: 'shallows', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Shallows', blurb: 'A drake in the doorway. You cannot take it.',
    files: 5, ranks: 5, supply: 9, ai: AI.mid, theme: 'duck',
    enemy: [{ type: 'k', at: 'c5' }, { type: 'd', at: 'c4' }, { type: 'p', at: 'b5' }, { type: 'p', at: 'd5' }],
  },
  kennels: {
    id: 'kennels', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Kennels', blurb: 'Two knights, and they are quicker than they look.',
    files: 5, ranks: 5, supply: 9, ai: AI.mid, theme: 'court',
    enemy: [{ type: 'k', at: 'c5' }, { type: 'n', at: 'a5' }, { type: 'n', at: 'e5' }],
  },
  toll: {
    id: 'toll', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Toll House', blurb: 'A fort square they will not leave.',
    files: 5, ranks: 5, supply: 9, ai: AI.mid, theme: 'court',
    terrain: { c4: TILE.FORT },
    enemy: [{ type: 'k', at: 'c5' }, { type: 'f', at: 'c4' }, { type: 'r', at: 'e5' }],
  },
  dunes: {
    id: 'dunes', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Dunes', blurb: 'Camels. They will be behind you before you see it.',
    files: 6, ranks: 5, supply: 10, ai: AI.mid, theme: 'camel',
    enemy: [{ type: 'k', at: 'c5' }, { type: 'c', at: 'a5' }, { type: 'c', at: 'f5' }, { type: 'p', at: 'd5' }],
  },
  chapel: {
    id: 'chapel', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Chapel', blurb: 'Frost down the aisle.',
    files: 5, ranks: 5, supply: 9, ai: AI.mid, theme: 'ice',
    terrain: { c2: TILE.FROST, c3: TILE.FROST, c4: TILE.FROST },
    enemy: [{ type: 'k', at: 'c5' }, { type: 'b', at: 'b5' }, { type: 'p', at: 'd5' }, { type: 'p', at: 'e5' }],
  },
  quarry: {
    id: 'quarry', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Quarry', blurb: 'A warden that shrugs off the first blow.',
    files: 5, ranks: 5, supply: 10, ai: AI.mid, theme: 'court',
    enemy: [{ type: 'k', at: 'c5' }, { type: 'v', at: 'c4' }, { type: 'p', at: 'b5' }, { type: 'p', at: 'd5' }],
  },
  // Act 1 elites and bosses.
  shepherd: {
    id: 'shepherd', kind: 'fight', tier: 'elite', act: 1,
    name: 'The Shepherd', blurb: 'A wall of drakes and something behind it.',
    files: 6, ranks: 6, supply: 11, ai: AI.hard, theme: 'duck',
    enemy: [
      { type: 'k', at: 'c6' }, { type: 'd', at: 'b5' }, { type: 'd', at: 'd5' },
      { type: 'r', at: 'e6' }, { type: 'p', at: 'c5' },
    ],
  },
  marshal: {
    id: 'marshal', kind: 'fight', tier: 'boss', act: 1, boss: true,
    name: 'The Marshal', blurb: 'A full board and a queen who knows what to do with it.',
    files: 8, ranks: 8, supply: 16, ai: AI.boss, theme: 'court',
    terrain: { d5: TILE.BLOCK, e5: TILE.BLOCK },
    enemy: [
      { type: 'k', at: 'd8' }, { type: 'q', at: 'e8' }, { type: 'n', at: 'c8' },
      { type: 'b', at: 'f8' }, { type: 'p', at: 'c7' }, { type: 'p', at: 'd7' },
      { type: 'p', at: 'e7' },
    ],
  },
  quartermaster: {
    id: 'quartermaster', kind: 'fight', tier: 'boss', act: 1, boss: true,
    name: 'The Quartermaster', blurb: 'Camels, a champion, and a fort he never leaves.',
    files: 8, ranks: 8, supply: 16, ai: AI.boss, theme: 'camel',
    terrain: { d8: TILE.FORT, d4: TILE.BLOCK, e4: TILE.BLOCK },
    enemy: [
      { type: 'k', at: 'd8' }, { type: 'h', at: 'e8' }, { type: 'c', at: 'b8' },
      { type: 'c', at: 'g8' }, { type: 'p', at: 'c7' }, { type: 'p', at: 'e7' },
      { type: 'p', at: 'f7' },
    ],
  },

  // ---------------------------------------------------------------- act 2
  brazier: {
    id: 'brazier', kind: 'fight', tier: 'trash', act: 2, pool: 'easy',
    name: 'The Brazier', blurb: 'It burns the ground behind it.',
    files: 5, ranks: 5, supply: 10, ai: AI.mid, theme: 'flame',
    enemy: [{ type: 'k', at: 'c5' }, { type: 'l', at: 'b5' }, { type: 'p', at: 'd5' }],
  },
  drift: {
    id: 'drift', kind: 'fight', tier: 'trash', act: 2, pool: 'easy',
    name: 'The Drift', blurb: 'Frost, and something patient standing in it.',
    files: 5, ranks: 5, supply: 10, ai: AI.mid, theme: 'ice',
    terrain: { b3: TILE.FROST, c3: TILE.FROST, d3: TILE.FROST },
    enemy: [{ type: 'k', at: 'c5' }, { type: 'i', at: 'c4' }, { type: 'p', at: 'e5' }],
  },
  forge: {
    id: 'forge', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Forge', blurb: 'Live coals across the floor.',
    files: 6, ranks: 6, supply: 12, ai: AI.mid, theme: 'flame',
    terrain: { c4: TILE.FIRE, d4: TILE.FIRE },
    enemy: [{ type: 'k', at: 'c6' }, { type: 'l', at: 'e6' }, { type: 'n', at: 'b6' }, { type: 'p', at: 'd6' }],
  },
  reliquary: {
    id: 'reliquary', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Reliquary', blurb: 'A princess guarding something valuable.',
    files: 6, ranks: 6, supply: 12, ai: AI.mid, theme: 'court',
    enemy: [{ type: 'k', at: 'c6' }, { type: 's', at: 'd6' }, { type: 'p', at: 'b6' }, { type: 'p', at: 'e6' }],
  },
  sappers: {
    id: 'sappers', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Sappers', blurb: 'Do not take the one with the fuse.',
    files: 6, ranks: 6, supply: 12, ai: AI.mid, theme: 'flame',
    enemy: [{ type: 'k', at: 'c6' }, { type: 'x', at: 'c5' }, { type: 'x', at: 'd5' }, { type: 'r', at: 'e6' }],
  },
  glacier: {
    id: 'glacier', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Glacier', blurb: 'Half the board is ice.',
    files: 6, ranks: 6, supply: 13, ai: AI.mid, theme: 'ice',
    terrain: { b4: TILE.FROST, c4: TILE.FROST, d4: TILE.FROST, e4: TILE.FROST },
    enemy: [{ type: 'k', at: 'c6' }, { type: 'i', at: 'b6' }, { type: 'b', at: 'e6' }, { type: 'p', at: 'd6' }],
  },
  gallery: {
    id: 'gallery', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Gallery', blurb: 'Long lines and two rooks to use them.',
    files: 7, ranks: 6, supply: 13, ai: AI.mid, theme: 'court',
    enemy: [{ type: 'k', at: 'd6' }, { type: 'r', at: 'a6' }, { type: 'r', at: 'g6' }, { type: 'p', at: 'd5' }],
  },
  menagerie: {
    id: 'menagerie', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Menagerie', blurb: 'One of everything, and none of it familiar.',
    files: 6, ranks: 6, supply: 13, ai: AI.mid, theme: 'camel',
    enemy: [
      { type: 'k', at: 'c6' }, { type: 'c', at: 'a6' }, { type: 'z', at: 'f6' },
      { type: 'g', at: 'd6' },
    ],
  },
  wardroom: {
    id: 'wardroom', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Wardroom', blurb: 'Two wardens, both shielded.',
    files: 6, ranks: 6, supply: 13, ai: AI.mid, theme: 'court',
    enemy: [{ type: 'k', at: 'c6' }, { type: 'v', at: 'b5' }, { type: 'v', at: 'd5' }, { type: 'p', at: 'e6' }],
  },
  causeway: {
    id: 'causeway', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Causeway', blurb: 'One road through, and they are sitting on it.',
    files: 7, ranks: 6, supply: 13, ai: AI.mid, theme: 'court',
    terrain: { b4: TILE.BLOCK, c4: TILE.BLOCK, e4: TILE.BLOCK, f4: TILE.BLOCK },
    enemy: [{ type: 'k', at: 'd6' }, { type: 'q', at: 'd5' }, { type: 'p', at: 'c6' }, { type: 'p', at: 'e6' }],
  },
  hollow: {
    id: 'hollow', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Hollow', blurb: 'A wisp. Whatever takes it dies with it.',
    files: 6, ranks: 6, supply: 13, ai: AI.mid, theme: 'wisp',
    enemy: [{ type: 'k', at: 'c6' }, { type: 'y', at: 'c5' }, { type: 'b', at: 'e6' }, { type: 'p', at: 'b6' }],
  },
  emberfield: {
    id: 'emberfield', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Ember Field', blurb: 'Two flames, and the floor is already alight.',
    files: 6, ranks: 6, supply: 14, ai: AI.mid, theme: 'flame',
    terrain: { c3: TILE.FIRE, d3: TILE.FIRE },
    enemy: [{ type: 'k', at: 'c6' }, { type: 'l', at: 'a6' }, { type: 'l', at: 'f6' }, { type: 'p', at: 'd6' }],
  },
  hoard: {
    id: 'hoard', kind: 'fight', tier: 'elite', act: 2,
    name: 'The Hoard', blurb: 'An empress, and she forks from range.',
    files: 7, ranks: 7, supply: 15, ai: AI.hard, theme: 'court',
    terrain: { d4: TILE.BLOCK },
    enemy: [
      { type: 'k', at: 'd7' }, { type: 't', at: 'e7' }, { type: 'n', at: 'b7' },
      { type: 'p', at: 'c6' }, { type: 'p', at: 'e6' },
    ],
  },
  rimeguard: {
    id: 'rimeguard', kind: 'fight', tier: 'boss', act: 2, boss: true,
    name: 'The Rime Guard', blurb: 'Two rimes and a field of ice. Bring something that leaps.',
    files: 8, ranks: 8, supply: 20, ai: AI.boss, theme: 'ice',
    terrain: { c5: TILE.FROST, d5: TILE.FROST, e5: TILE.FROST, f5: TILE.FROST },
    enemy: [
      { type: 'k', at: 'd8' }, { type: 'i', at: 'c7' }, { type: 'i', at: 'e7' },
      { type: 'r', at: 'a8' }, { type: 'b', at: 'g8' }, { type: 'p', at: 'd7' },
      { type: 'p', at: 'f8' },
    ],
  },
  collector: {
    id: 'collector', kind: 'fight', tier: 'boss', act: 2, boss: true,
    name: 'The Collector', blurb: 'He keeps one of everything, and he uses all of it.',
    files: 8, ranks: 8, supply: 20, ai: AI.boss, theme: 'court',
    enemy: [
      { type: 'k', at: 'd8' }, { type: 's', at: 'c8' }, { type: 't', at: 'e8' },
      { type: 'c', at: 'a8' }, { type: 'g', at: 'h8' }, { type: 'p', at: 'd7' },
      { type: 'p', at: 'e7' },
    ],
  },

  // ---------------------------------------------------------------- act 3
  ossuary: {
    id: 'ossuary', kind: 'fight', tier: 'trash', act: 3, pool: 'easy',
    name: 'The Ossuary', blurb: 'Quiet, and far too well defended.',
    files: 6, ranks: 6, supply: 14, ai: AI.mid, theme: 'wisp',
    enemy: [{ type: 'k', at: 'c6' }, { type: 'y', at: 'c5' }, { type: 'r', at: 'e6' }, { type: 'p', at: 'b6' }],
  },
  soot: {
    id: 'soot', kind: 'fight', tier: 'trash', act: 3, pool: 'easy',
    name: 'The Soot Yard', blurb: 'Burnt already, and burning again.',
    files: 6, ranks: 6, supply: 14, ai: AI.mid, theme: 'flame',
    terrain: { c4: TILE.FIRE, d4: TILE.FIRE },
    enemy: [{ type: 'k', at: 'c6' }, { type: 'l', at: 'e6' }, { type: 'r', at: 'a6' }, { type: 'p', at: 'd6' }],
  },
  spire: {
    id: 'spire', kind: 'fight', tier: 'trash', act: 3, pool: 'easy',
    name: 'The Spire Steps', blurb: 'Narrow, and they hold the high ground.',
    files: 5, ranks: 7, supply: 14, ai: AI.mid, theme: 'court',
    terrain: { b4: TILE.BLOCK, d4: TILE.BLOCK },
    enemy: [{ type: 'k', at: 'c7' }, { type: 'q', at: 'c6' }, { type: 'p', at: 'b7' }, { type: 'p', at: 'd7' }],
  },
  nightwatch: {
    id: 'nightwatch', kind: 'fight', tier: 'trash', act: 3, pool: 'hard',
    name: 'The Nightwatch', blurb: 'A nightrider. It leaps, and then it leaps again.',
    files: 7, ranks: 7, supply: 16, ai: AI.hard, theme: 'court',
    enemy: [{ type: 'k', at: 'd7' }, { type: 'm', at: 'd6' }, { type: 'p', at: 'c7' }, { type: 'p', at: 'e7' }],
  },
  crucible: {
    id: 'crucible', kind: 'fight', tier: 'trash', act: 3, pool: 'hard',
    name: 'The Crucible', blurb: 'Flame and sappers. Everything here explodes.',
    files: 7, ranks: 7, supply: 16, ai: AI.hard, theme: 'flame',
    enemy: [
      { type: 'k', at: 'd7' }, { type: 'l', at: 'b7' }, { type: 'x', at: 'd6' },
      { type: 'x', at: 'e6' }, { type: 'p', at: 'f7' },
    ],
  },
  frostgate: {
    id: 'frostgate', kind: 'fight', tier: 'trash', act: 3, pool: 'hard',
    name: 'The Frost Gate', blurb: 'Ice across the whole approach.',
    files: 7, ranks: 7, supply: 17, ai: AI.hard, theme: 'ice',
    terrain: { b4: TILE.FROST, c4: TILE.FROST, d4: TILE.FROST, e4: TILE.FROST, f4: TILE.FROST },
    enemy: [{ type: 'k', at: 'd7' }, { type: 'i', at: 'c6' }, { type: 'r', at: 'a7' }, { type: 'b', at: 'g7' }],
  },
  parliament: {
    id: 'parliament', kind: 'fight', tier: 'trash', act: 3, pool: 'hard',
    name: 'The Parliament', blurb: 'A princess and an empress, arguing.',
    files: 7, ranks: 7, supply: 17, ai: AI.hard, theme: 'court',
    enemy: [{ type: 'k', at: 'd7' }, { type: 's', at: 'b7' }, { type: 't', at: 'f7' }, { type: 'p', at: 'd6' }],
  },
  lantern: {
    id: 'lantern', kind: 'fight', tier: 'trash', act: 3, pool: 'hard',
    name: 'The Lantern Court', blurb: 'Wisps everywhere. Take nothing you cannot spare.',
    files: 7, ranks: 7, supply: 17, ai: AI.hard, theme: 'wisp',
    enemy: [
      { type: 'k', at: 'd7' }, { type: 'y', at: 'c6' }, { type: 'y', at: 'e6' },
      { type: 'r', at: 'g7' }, { type: 'p', at: 'b7' },
    ],
  },
  bulwark: {
    id: 'bulwark', kind: 'fight', tier: 'trash', act: 3, pool: 'hard',
    name: 'The Bulwark', blurb: 'Wardens behind walls. Bring something that leaps.',
    files: 7, ranks: 7, supply: 17, ai: AI.hard, theme: 'court',
    terrain: { c5: TILE.BLOCK, d5: TILE.BLOCK, e5: TILE.BLOCK },
    enemy: [
      { type: 'k', at: 'd7' }, { type: 'v', at: 'c6' }, { type: 'v', at: 'e6' },
      { type: 'q', at: 'g7' },
    ],
  },
  stable: {
    id: 'stable', kind: 'fight', tier: 'trash', act: 3, pool: 'hard',
    name: 'The Long Stable', blurb: 'Camels and zebras. Nothing lands where you expect.',
    files: 8, ranks: 7, supply: 18, ai: AI.hard, theme: 'camel',
    enemy: [
      { type: 'k', at: 'd7' }, { type: 'c', at: 'a7' }, { type: 'c', at: 'h7' },
      { type: 'z', at: 'f7' }, { type: 'p', at: 'd6' },
    ],
  },
  furnace: {
    id: 'furnace', kind: 'fight', tier: 'trash', act: 3, pool: 'hard',
    name: 'The Furnace', blurb: 'The floor is on fire and they do not mind.',
    files: 7, ranks: 7, supply: 18, ai: AI.hard, theme: 'flame',
    terrain: { c4: TILE.FIRE, d4: TILE.FIRE, e4: TILE.FIRE },
    enemy: [
      { type: 'k', at: 'd7' }, { type: 'l', at: 'b7' }, { type: 'l', at: 'f7' },
      { type: 'q', at: 'd6' },
    ],
  },
  vigil: {
    id: 'vigil', kind: 'fight', tier: 'trash', act: 3, pool: 'hard',
    name: 'The Vigil', blurb: 'A fort they hold and a queen behind it.',
    files: 7, ranks: 7, supply: 18, ai: AI.hard, theme: 'court',
    terrain: { d6: TILE.FORT },
    enemy: [
      { type: 'k', at: 'd7' }, { type: 'v', at: 'd6' }, { type: 'q', at: 'f7' },
      { type: 'n', at: 'b7' },
    ],
  },
  procession: {
    id: 'procession', kind: 'fight', tier: 'trash', act: 3, pool: 'hard',
    name: 'The Procession', blurb: 'Rank after rank of them.',
    files: 8, ranks: 7, supply: 18, ai: AI.hard, theme: 'court',
    enemy: [
      { type: 'k', at: 'd7' }, { type: 'r', at: 'a7' }, { type: 'b', at: 'c7' },
      { type: 'b', at: 'f7' }, { type: 'n', at: 'h7' }, { type: 'p', at: 'd6' },
      { type: 'p', at: 'e6' },
    ],
  },
  keeper: {
    id: 'keeper', kind: 'fight', tier: 'elite', act: 3,
    name: 'The Keeper', blurb: 'An amazon. Twelve points of trouble, with an escort.',
    files: 7, ranks: 7, supply: 18, ai: AI.hard, theme: 'court',
    enemy: [
      { type: 'k', at: 'd7' }, { type: 'a', at: 'd6' }, { type: 'p', at: 'c7' },
      { type: 'p', at: 'e7' },
    ],
  },
  hierophant: {
    id: 'hierophant', kind: 'fight', tier: 'elite', act: 3,
    name: 'The Hierophant', blurb: 'Nightriders on an open board.',
    files: 8, ranks: 8, supply: 19, ai: AI.hard, theme: 'court',
    enemy: [
      { type: 'k', at: 'd8' }, { type: 'm', at: 'c7' }, { type: 'm', at: 'f7' },
      { type: 'r', at: 'a8' }, { type: 'p', at: 'd7' },
    ],
  },
  conflagration: {
    id: 'conflagration', kind: 'fight', tier: 'boss', act: 3, boss: true,
    name: 'The Conflagration', blurb: 'It sets the board alight and walks through it.',
    files: 8, ranks: 8, supply: 24, ai: AI.boss, theme: 'flame',
    terrain: { c5: TILE.FIRE, d5: TILE.FIRE, e5: TILE.FIRE, f5: TILE.FIRE },
    enemy: [
      { type: 'k', at: 'd8' }, { type: 'l', at: 'c8' }, { type: 'l', at: 'f8' },
      { type: 'a', at: 'e8' }, { type: 'x', at: 'd7' }, { type: 'p', at: 'b8' },
      { type: 'p', at: 'g8' },
    ],
  },
  archivist: {
    id: 'archivist', kind: 'fight', tier: 'boss', act: 3, boss: true,
    name: 'The Archivist', blurb: 'Every piece you have met, all at once.',
    files: 8, ranks: 8, supply: 24, ai: AI.boss, theme: 'court',
    terrain: { d5: TILE.BLOCK, e5: TILE.BLOCK },
    enemy: [
      { type: 'k', at: 'd8' }, { type: 'a', at: 'e8' }, { type: 'm', at: 'c8' },
      { type: 't', at: 'g8' }, { type: 'i', at: 'b8' }, { type: 'y', at: 'd7' },
      { type: 'p', at: 'e7' }, { type: 'p', at: 'f7' },
    ],
  },
};

/**
 * Random rooms — the `?` nodes, lifted in shape from Slay the Spire: a short
 * scene and two or three choices, most of them a trade rather than a gift.
 *
 * Every choice returns a plain list of effects that run.js applies, so an event
 * can never reach into run state directly and the whole book stays data.
 * Effects: gold, hp, maxHp, heal, gain (piece id), lose (piece id or 'choose'),
 * supply, deploy, removeCost.
 */
export const EVENTS = {
  idol: {
    id: 'idol', name: 'The Gilded Rook',
    text: 'A rook cast in gold sits alone on a plinth, in a room that has clearly '
      + 'killed people. There is a pressure plate under it.',
    choices: [
      { label: 'Take it', detail: '+35 gold. The room takes its due (−4 HP).',
        effects: [{ gold: 35 }, { hp: -4 }] },
      { label: 'Leave it', detail: 'Nothing ventured.', effects: [] },
    ],
  },
  cleric: {
    id: 'cleric', name: 'The Field Chaplain',
    text: 'A chaplain is boiling water over a fire and does not look up. '
      + '"Wounds or weight," he says. "I can take one."',
    choices: [
      { label: 'Heal', detail: 'Pay 20 gold, recover 10 HP.', cost: 20, effects: [{ heal: 10 }] },
      { label: 'Lighten the bag', detail: 'Pay 30 gold, drop a piece of your choice.',
        cost: 30, effects: [{ lose: 'choose' }] },
      { label: 'Move on', detail: 'He goes back to the water.', effects: [] },
    ],
  },
  ooze: {
    id: 'ooze', name: 'The Rust Pool',
    text: 'Something has been dissolving armour in this puddle for a long time. '
      + 'There is a shape at the bottom that might be a piece.',
    choices: [
      { label: 'Reach in', detail: '−3 HP. Take whatever your hand closes on.',
        effects: [{ hp: -3 }, { gain: 'random-common' }] },
      { label: 'Reach deeper', detail: '−7 HP. Something better is down there.',
        effects: [{ hp: -7 }, { gain: 'random-rare' }] },
      { label: 'Keep your arm', detail: 'Walk away dry.', effects: [] },
    ],
  },
  wing: {
    id: 'wing', name: 'The Winged Statue',
    text: 'A statue of a knight mid-leap, wings half-finished. The plinth reads: '
      + 'LEAVE WHAT YOU DO NOT NEED.',
    choices: [
      { label: 'Make an offering', detail: '−5 HP, and drop a piece of your choice.',
        effects: [{ hp: -5 }, { lose: 'choose' }] },
      { label: 'Pray instead', detail: '+12 gold from the offering bowl.', effects: [{ gold: 12 }] },
    ],
  },
  quartermistress: {
    id: 'quartermistress', name: 'The Quartermistress',
    text: 'A woman with a ledger looks your baggage train up and down and sniffs. '
      + '"You are carrying it wrong," she says. "I can fix that. Once."',
    choices: [
      { label: 'Wider train', detail: 'Pay 40 gold. +1 piece in every fight, permanently.',
        cost: 40, effects: [{ deploy: 1 }] },
      { label: 'Deeper stores', detail: 'Pay 40 gold. +2 supply in every fight, permanently.',
        cost: 40, effects: [{ supply: 2 }] },
      { label: 'Decline', detail: 'She shrugs and writes something down.', effects: [] },
    ],
  },
  wager: {
    id: 'wager', name: 'The Shell Game',
    text: 'Three cups, one pawn, and a man whose hands you cannot follow. '
      + '"Double or nothing," he says, already shuffling.',
    choices: [
      { label: 'Play', detail: 'Half the time you double 25 gold. Half the time you do not.',
        gamble: { odds: 0.5, win: [{ gold: 25 }], lose: [{ gold: -25 }] }, effects: [] },
      { label: 'Tip the table', detail: 'Take 10 gold in the confusion. −2 HP when he objects.',
        effects: [{ gold: 10 }, { hp: -2 }] },
      { label: 'Walk on', detail: 'You have seen this one.', effects: [] },
    ],
  },
  deserter: {
    id: 'deserter', name: 'The Deserter',
    text: 'A soldier sitting against a wall with his colours torn off. '
      + '"I am not going back," he says. "But I will come with you, if you feed me."',
    choices: [
      { label: 'Feed him', detail: 'Pay 25 gold. He joins the bag.',
        cost: 25, effects: [{ gain: 'random-rare' }] },
      { label: 'Take his kit', detail: '+18 gold. He does not stop you.', effects: [{ gold: 18 }] },
      { label: 'Leave him', detail: 'He is still sitting there when you look back.', effects: [] },
    ],
  },
  forgefire: {
    id: 'forgefire', name: 'The Banked Fire',
    text: 'A forge still warm from someone else. You could put something in it. '
      + 'It would not come out the same.',
    choices: [
      { label: 'Feed the fire', detail: 'Drop a piece of your choice, take 45 gold for the metal.',
        effects: [{ lose: 'choose' }, { gold: 45 }] },
      { label: 'Warm yourself', detail: 'Recover 8 HP by the coals.', effects: [{ heal: 8 }] },
    ],
  },
  serpent: {
    id: 'serpent', name: 'The Long Adder',
    text: 'It is coiled on a strongbox and it is in no hurry. '
      + '"Take it," it says, eventually. "I only want a little."',
    choices: [
      { label: 'Take the box', detail: '+50 gold. −2 maximum HP, permanently.',
        effects: [{ gold: 50 }, { maxHp: -2 }] },
      { label: 'Refuse', detail: 'It seems almost relieved.', effects: [] },
    ],
  },
  mapmaker: {
    id: 'mapmaker', name: 'The Mapmaker',
    text: 'He is drawing the road you just walked, and he has it wrong. '
      + '"Corrections are free," he says. "Advice costs."',
    choices: [
      { label: 'Buy advice', detail: 'Pay 15 gold, recover 6 HP and take 5 gold of scrap.',
        cost: 15, effects: [{ heal: 6 }, { gold: 5 }] },
      { label: 'Correct his map', detail: 'He pays you 20 gold for the trouble.',
        effects: [{ gold: 20 }] },
    ],
  },
  armoury: {
    id: 'armoury', name: 'The Abandoned Armoury',
    text: 'Racks and racks of it, all rusted to the wall except one shelf, '
      + 'which someone has kept clean.',
    choices: [
      { label: 'Take from the clean shelf', detail: 'Gain a rare piece. −5 HP prising it loose.',
        effects: [{ hp: -5 }, { gain: 'random-rare' }] },
      { label: 'Strip the rusted racks', detail: 'Gain two common pieces.',
        effects: [{ gain: 'random-common' }, { gain: 'random-common' }] },
      { label: 'Take the door instead', detail: '+22 gold for good iron.', effects: [{ gold: 22 }] },
    ],
  },
  wellspring: {
    id: 'wellspring', name: 'The Wellspring',
    text: 'Cold, clear, and far too deep for a well this old. '
      + 'Your reflection is slower than you are.',
    choices: [
      { label: 'Drink', detail: 'Recover 12 HP.', effects: [{ heal: 12 }] },
      { label: 'Bathe', detail: '+3 maximum HP, permanently, and heal to full.',
        effects: [{ maxHp: 3 }, { heal: 99 }] },
      { label: 'Look longer', detail: 'Something down there gives you 30 gold to stop.',
        effects: [{ gold: 30 }, { hp: -3 }] },
    ],
  },
};

export const EVENT_IDS = Object.keys(EVENTS);

export const THEME_DROPS = {
  court: ['n', 'f', 'r', 's'],
  camel: ['c', 'w'],
  ice: ['i', 'd'],
  flame: ['l'],
  duck: ['d'],
  wisp: ['y', 'i'],
};

export const SHOP_WEIGHTS = {
  1: { common: 70, rare: 24, epic: 6, legendary: 0 },
  2: { common: 50, rare: 30, epic: 16, legendary: 4 },
  3: { common: 35, rare: 28, epic: 25, legendary: 12 },
};

export const DROP_CHANCE = { trash: 0.18, elite: 0.42, boss: 1 };

const ACT_LAYOUT = [
  { col: 0, rows: ['trash', 'trash', 'trash'] },
  { col: 1, rows: ['trash', 'shop', 'event'] },
  { col: 2, rows: ['elite', 'rest', 'event', 'shop'] },
  { col: 3, rows: ['event', 'rest', 'trash'] },
  { col: 4, rows: ['shop', 'elite', 'event'] },
  { col: 5, rows: ['rest', 'event', 'shop'] },
  { col: 6, rows: ['elite', 'rest'] },
  { col: 7, rows: ['boss'] },
];

/**
 * Draws an encounter for one map slot.
 *
 * Two rules, both borrowed from Slay the Spire. The opening floor draws from
 * the `easy` pool so a run never dies to its first fight, and every act draws
 * WITHOUT replacement — with one act-3 fight in the book the old picker put the
 * same room on the map four times over.
 */
function pickEncounter(rng, act, tier, drawn, wantEasy) {
  const all = Object.values(ENCOUNTERS).filter((e) => e.act === act && e.tier === tier);
  const wanted = tier === 'trash' && wantEasy
    ? all.filter((e) => e.pool === 'easy')
    : (tier === 'trash' ? all.filter((e) => e.pool !== 'easy') : all);

  const pools = [wanted, all, Object.values(ENCOUNTERS).filter((e) => e.tier === tier)];
  for (const pool of pools) {
    const fresh = pool.filter((e) => !drawn.has(e.id));
    if (fresh.length) {
      const pick = fresh[Math.floor(rng() * fresh.length)];
      drawn.add(pick.id);
      return pick;
    }
  }
  // Every room of this tier is already on the map — reuse rather than fail.
  const fallback = pools.find((p) => p.length) || Object.values(ENCOUNTERS);
  return fallback[Math.floor(rng() * fallback.length)];
}

/** Draws an unseen event for this act where possible. */
function pickEvent(rng, seen) {
  const all = Object.values(EVENTS);
  const fresh = all.filter((e) => !seen.has(e.id));
  const pool = fresh.length ? fresh : all;
  const pick = pool[Math.floor(rng() * pool.length)];
  seen.add(pick.id);
  return pick;
}

/**
 * Seeded Slay-the-Spire-style map: 3 acts, branching columns, a boss at the end.
 */
export function generateMap(rng) {
  const acts = [];
  for (let act = 1; act <= 3; act++) {
    const nodes = [];
    const cols = [];
    const drawn = new Set();
    const seenEvents = new Set();
    for (const layer of ACT_LAYOUT) {
      const col = [];
      layer.rows.forEach((kind, row) => {
        const id = `a${act}-c${layer.col}-r${row}`;
        let node;
        if (kind === 'shop') {
          node = {
            id, act, col: layer.col, row, kind: 'shop',
            name: act === 1 ? 'Wayside Stall' : act === 2 ? 'The Armoury' : 'The Reliquary',
            blurb: 'Spend what you took.',
            next: [],
          };
        } else if (kind === 'event') {
          const ev = pickEvent(rng, seenEvents);
          node = {
            id, act, col: layer.col, row, kind: 'event',
            eventId: ev.id,
            name: '?', blurb: 'Something is waiting here.',
            next: [],
          };
        } else if (kind === 'rest') {
          const pick = REST_NAMES[Math.floor(rng() * REST_NAMES.length)];
          node = {
            id, act, col: layer.col, row, kind: 'rest',
            name: pick.name, blurb: pick.blurb,
            next: [],
          };
        } else {
          const enc = pickEncounter(rng, act, kind, drawn, layer.col === 0);
          node = {
            id, act, col: layer.col, row,
            kind: 'fight',
            tier: enc.tier,
            boss: Boolean(enc.boss),
            encounterId: enc.id,
            name: enc.name,
            blurb: enc.blurb,
            next: [],
          };
        }
        nodes.push(node);
        col.push(node);
      });
      cols.push(col);
    }
    for (let c = 0; c < cols.length - 1; c++) {
      linkFloors(cols[c], cols[c + 1], rng);
    }
    acts.push({ act, nodes, startId: cols[0][0].id });
  }
  return { acts };
}

/** Rooms on the first floor of an act — the opening fork. */
export function firstRooms(act) {
  return (act?.nodes || []).filter((n) => n.col === 0);
}

function linkFloors(here, there, rng) {
  const xOf = (node, col) => (col.length === 1 ? 0.5 : node.row / Math.max(1, col.length - 1));

  for (const node of here) {
    const x = xOf(node, here);
    const ranked = there.slice().sort((a, b) => (
      Math.abs(xOf(a, there) - x) - Math.abs(xOf(b, there) - x)
    ));
    const nearby = ranked.filter((n) => Math.abs(xOf(n, there) - x) <= 0.55);
    const pool = nearby.length ? nearby : ranked.slice(0, Math.min(3, ranked.length));
    let count;
    if (pool.length === 1) count = 1;
    else if (here.length === 1) count = Math.min(pool.length, there.length);
    else count = rng() < 0.18 ? 1 : rng() < 0.82 ? 2 : Math.min(3, pool.length);
    count = Math.max(1, Math.min(count, pool.length));
    node.next = pool.slice(0, count).map((n) => n.id);
  }

  const parents = new Map(there.map((n) => [n.id, 0]));
  for (const node of here) {
    for (const id of node.next) parents.set(id, (parents.get(id) || 0) + 1);
  }
  for (const dest of there) {
    if (parents.get(dest.id)) continue;
    const parent = here.slice().sort((a, b) => (
      Math.abs(xOf(a, here) - xOf(dest, there)) - Math.abs(xOf(b, here) - xOf(dest, there))
    ))[0];
    parent.next.push(dest.id);
  }
}

export function findNode(map, id) {
  for (const act of map.acts) {
    const node = act.nodes.find((n) => n.id === id);
    if (node) return node;
  }
  return null;
}

export function encounterFor(node) {
  if (!node || node.kind !== 'fight') return null;
  return ENCOUNTERS[node.encounterId] || null;
}

export function homeSquares(files, ranks) {
  const rows = ranks <= 4 ? 1 : 2;
  const out = [];
  for (let i = 0; i < rows; i++) {
    const r = ranks - 1 - i;
    for (let f = 0; f < files; f++) out.push(r * 16 + f);
  }
  return out;
}

export function freeHomeSquares(encounter) {
  const blocked = new Set();
  if (encounter.terrain) {
    for (const [name, tile] of Object.entries(encounter.terrain)) {
      if (tile === TILE.BLOCK) blocked.add(parseSquare(name, encounter.ranks));
    }
  }
  const taken = new Set(
    (encounter.enemy || []).map((p) => parseSquare(p.at, encounter.ranks)),
  );
  return homeSquares(encounter.files, encounter.ranks)
    .filter((sq) => !blocked.has(sq) && !taken.has(sq));
}

export function weightedPiece(rng, allowed, act = 1) {
  const weights = SHOP_WEIGHTS[act] || SHOP_WEIGHTS[1];
  const pool = shopPool().filter((p) => !allowed || allowed.has(p.rarity));
  let total = 0;
  const bag = [];
  for (const p of pool) {
    const w = weights[p.rarity] || 0;
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
  if (rarity === RARITY.RARE) return 6;
  if (rarity === RARITY.EPIC) return 9;
  if (rarity === RARITY.LEGENDARY) return 12;
  return 8;
}

export { PIECES, RARITY };
