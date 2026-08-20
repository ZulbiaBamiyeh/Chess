// Encounters, shop tables, kings and map layout. Pure data plus helpers —
// run.js owns the mutable run.

import { PIECES, RARITY, shopPool, pieceCost } from './pieces.js';
import { TILE, parseSquare } from './chess.js';

export const START_HP = 18;
export const START_GOLD = 3;
export const REST_HEAL = 7;
export const REST_GOLD = 1;
export const FORAGE_GOLD = 3;
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
// The clock only started ending fights in this pass (tickClock never used to
// return true), which pushed the numbers up: these are meant to be felt on a
// slow, careful line, not on a normal one.
export const TURN_CLOCK = { trash: 24, elite: 30, boss: 38 };

export const STARTING_BAG = ['p', 'p', 'p'];

export const LOSS_HP = { trash: 3, elite: 6, boss: 8 };
export const FORFEIT_HP = { trash: 2, elite: 3, boss: 4 };
/** HP charged to take back a ply in a run fight. A fallen king cannot be undone. */
export const UNDO_HP = 3;

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

  duck: {
    id: 'duck',
    name: 'Duck',
    blurb: 'Drop a yellow duck on an empty square after every move of yours — '
      + 'yours or theirs, nothing can land on it or pass through it.',
    cost: 9,
    sprite: 'king-duck',
  },
  sentinel: {
    id: 'sentinel',
    name: 'Sentinel',
    blurb: 'You may deploy with their king already in check — everyone else has to leave it be.',
    cost: 7,
    sprite: 'king-sentinel',
  },
  vanguard: {
    id: 'vanguard',
    name: 'Vanguard',
    blurb: 'Your king may also leap two squares in a straight line, clearing '
      + 'whatever stands between.',
    cost: 9,
    sprite: 'king-vanguard',
  },
  icebound: {
    id: 'icebound',
    name: 'Palisade',
    blurb: 'Nothing of yours can be frozen. Not by them, not by the ground.',
    cost: 6,
    sprite: 'king-icebound',
  },
  longshot: {
    id: 'longshot',
    name: 'Marksman',
    blurb: 'Your shooters reach the long 3–1 leap as well as the knight’s.',
    cost: 6,
    sprite: 'king-longshot',
  },
  rampart: {
    id: 'rampart',
    name: 'Rampart',
    blurb: 'Every piece that starts a fight beside your king walks in shielded.',
    cost: 8,
    sprite: 'king-rampart',
  },
  anchor: {
    id: 'anchor',
    name: 'Anchor',
    blurb: 'Your single most expensive piece on the board starts each fight shielded.',
    cost: 7,
    sprite: 'king-anchor',
  },
  formation: {
    id: 'formation',
    name: 'Formation',
    blurb: 'Your pawns start every fight shielded.',
    cost: 7,
    sprite: 'king-formation',
  },
  provisioner: {
    id: 'provisioner',
    name: 'Provisioner',
    blurb: 'A levy pawn appears on a free home square at the start of every fight.',
    cost: 6,
    sprite: 'king-provisioner',
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    blurb: 'Your king may also leap like a knight.',
    cost: 5,
    sprite: 'king-ranger',
  },
  broker: {
    id: 'broker',
    name: 'Broker',
    blurb: 'Whenever you capture, that square becomes a fort for the rest of the fight.',
    cost: 7,
    sprite: 'king-broker',
  },
  convalescent: {
    id: 'convalescent',
    name: 'Convalescent',
    blurb: 'At the end of each of your turns, your king is shielded.',
    cost: 6,
    sprite: 'king-convalescent',
  },
  steadfast: {
    id: 'steadfast',
    name: 'Steadfast',
    blurb: 'Your king cannot be frozen or burned.',
    cost: 8,
    sprite: 'king-steadfast',
  },
  nomad: {
    id: 'nomad',
    name: 'Nomad',
    blurb: 'Your king may step onto blocked tiles, clearing them.',
    cost: 8,
    sprite: 'king-nomad',
  },
  financier: {
    id: 'financier',
    name: 'Financier',
    blurb: 'The first capture you make each fight shields the capturer.',
    cost: 5,
    sprite: 'king-financier',
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
    files: 6, ranks: 6, supply: 8, ai: AI.easy, theme: 'court',
    enemy: [
      { type: 'k', at: 'd6' },
      { type: 'p', at: 'c6' },
      { type: 'p', at: 'e6' },
    ],
  },
  alley: {
    id: 'alley', kind: 'fight', tier: 'trash', act: 1,
    pool: 'easy',
    name: 'The Alley', blurb: 'A tight yard. A wazir and a pawn, no room to hide.',
    files: 6, ranks: 6, supply: 8, ai: AI.easy, theme: 'court',
    enemy: [
      { type: 'k', at: 'c6' },
      { type: 'w', at: 'd6' },
      { type: 'p', at: 'b6' },
    ],
  },
  courtyard: {
    id: 'courtyard', kind: 'fight', tier: 'trash', act: 1,
    pool: 'hard',
    name: 'The Courtyard', blurb: 'Frost across the middle.',
    files: 6, ranks: 6, supply: 12, ai: AI.mid, theme: 'ice',
    enemy: [
      { type: 'k', at: 'c6' },
      { type: 'p', at: 'b6' },
      { type: 'p', at: 'd6' },
      { type: 'n', at: 'e6' },
    ],
    terrain: { c4: TILE.FROST, b4: TILE.FROST, d4: TILE.FROST },
  },
  paddock: {
    id: 'paddock', kind: 'fight', tier: 'trash', act: 1,
    pool: 'hard',
    name: 'The Paddock', blurb: 'Camels in a small yard.',
    files: 6, ranks: 6, supply: 13, ai: AI.easy, theme: 'camel',
    enemy: [
      { type: 'k', at: 'c6' },
      { type: 'c', at: 'a5' },
      { type: 'p', at: 'd6' },
    ],
  },
  crossing: {
    id: 'crossing', kind: 'fight', tier: 'trash', act: 1,
    pool: 'hard',
    name: 'The Frozen Lake',
    blurb: 'The ice is thin down the middle. Whoever steps on it closes that lane behind them.',
    files: 6, ranks: 6, supply: 12, ai: AI.mid, theme: 'ice',
    enemy: [
      { type: 'k', at: 'd6' },
      { type: 'p', at: 'b6' },
      { type: 'n', at: 'e6' },
    ],
    // Four glass panes across the middle row, not all six — the flanks
    // (a3, f3) stay open on purpose, so a bad crossing costs a lane, not
    // the whole board. Break enough of them and the two sides are still
    // pushed toward whichever gap is left, which is the point.
    terrain: {
      b3: TILE.GLASS, c3: TILE.GLASS, d3: TILE.GLASS, e3: TILE.GLASS,
    },
  },
  pond: {
    id: 'pond', kind: 'fight', tier: 'elite', act: 1,
    name: 'The Duck', blurb: 'After every move you must park the yellow duck on an empty square.',
    files: 6, ranks: 6, supply: 12, ai: AI.mid, theme: 'duck',
    rules: { duckChess: true },
    duckAt: 'c3',
    enemy: [
      { type: 'k', at: 'c6' },
      { type: 'n', at: 'e6' },
      { type: 'd', at: 'a5' },
      { type: 'p', at: 'd6' },
    ],
  },
  outpost: {
    id: 'outpost', kind: 'fight', tier: 'elite', act: 1,
    name: 'Camel Outpost', blurb: 'Blocked corners and a long-striding camel.',
    files: 6, ranks: 6, supply: 13, ai: AI.mid, theme: 'camel',
    enemy: [
      { type: 'k', at: 'c6' },
      { type: 'c', at: 'a5' },
      { type: 'p', at: 'd6' },
      { type: 'w', at: 'e6' },
    ],
    terrain: { a6: TILE.BLOCK, e2: TILE.BLOCK, a2: TILE.BLOCK, e5: TILE.BLOCK },
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
    files: 7, ranks: 6, supply: 15, ai: AI.mid, theme: 'flame',
    enemy: [
      { type: 'k', at: 'd6' },
      { type: 'l', at: 'c5' },
      { type: 'p', at: 'e6' },
    ],
  },
  flock: {
    id: 'flock', kind: 'fight', tier: 'trash', act: 2,
    pool: 'easy',
    name: 'The Flock', blurb: 'Ducks in a corridor.',
    files: 7, ranks: 6, supply: 14, ai: AI.mid, theme: 'duck',
    enemy: [
      { type: 'k', at: 'd6' },
      { type: 'd', at: 'b5' },
      { type: 'd', at: 'e5' },
      { type: 'p', at: 'c6' },
    ],
    terrain: { a4: TILE.BLOCK, f4: TILE.BLOCK },
  },
  flame: {
    id: 'flame', kind: 'fight', tier: 'elite', act: 2,
    name: 'Flame Demon', blurb: 'Fire bishops. Their path burns.',
    files: 7, ranks: 6, supply: 16, ai: AI.hard, theme: 'flame',
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
    files: 7, ranks: 6, supply: 15, ai: AI.hard, theme: 'court',
    enemy: [
      { type: 'k', at: 'd6' },
      { type: 's', at: 'e6' },
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
    files: 7, ranks: 7, supply: 18, ai: AI.hard, theme: 'wisp',
    enemy: [
      { type: 'k', at: 'd7' },
      { type: 'y', at: 'c5' },
      { type: 'i', at: 'e6' },
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
    files: 6, ranks: 6, supply: 7, ai: AI.easy, theme: 'court',
    enemy: [{ type: 'k', at: 'c6' }, { type: 'p', at: 'b6' }, { type: 'p', at: 'd6' }],
  },
  ford: {
    id: 'ford', kind: 'fight', tier: 'trash', act: 1, pool: 'easy',
    name: 'The Ford', blurb: 'A wazir holding the crossing.',
    files: 6, ranks: 6, supply: 8, ai: AI.easy, theme: 'court',
    terrain: { c4: TILE.BLOCK, c5: TILE.BLOCK },
    enemy: [{ type: 'k', at: 'c6' }, { type: 'w', at: 'b6' }, { type: 'p', at: 'd6' }],
  },
  // Hard pool: everything after.
  bailey: {
    id: 'bailey', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Bailey', blurb: 'A rook on an open file.',
    files: 6, ranks: 6, supply: 12, ai: AI.mid, theme: 'court',
    enemy: [{ type: 'k', at: 'c6' }, { type: 'r', at: 'a6' }, { type: 'p', at: 'd6' }],
  },
  scree: {
    id: 'scree', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Scree', blurb: 'Broken ground, and a zebra that ignores it.',
    files: 6, ranks: 6, supply: 12, ai: AI.mid, theme: 'camel',
    terrain: { b4: TILE.BLOCK, d4: TILE.BLOCK },
    enemy: [{ type: 'k', at: 'c6' }, { type: 'z', at: 'e6' }, { type: 'p', at: 'b6' }],
  },
  sinkhole: {
    id: 'sinkhole', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Sinkhole', blurb: 'The middle of the board simply is not there any more.',
    files: 6, ranks: 6, supply: 13, ai: AI.mid, theme: 'grave',
    // Most rooms with terrain drop one or two lone walls as an obstacle to
    // route around. This is the other kind — an actually dramatic hole, a
    // 2×2 pit dead centre. A wider version of this (a row spanning four or
    // more of the six files) measured badly: it squeezed every crossing
    // down to one file on each flank, and that narrow a chokepoint made the
    // fight easy to wall off and stall out on repetition far more than any
    // other room in the book. A compact pit leaves both flanks two files
    // wide, which reads just as dramatic and doesn't wall the board in
    // half. Kept rare on purpose: if every room looked like this it would
    // stop reading as a landmark.
    terrain: {
      c4: TILE.BLOCK, d4: TILE.BLOCK, c3: TILE.BLOCK, d3: TILE.BLOCK,
    },
    enemy: [{ type: 'k', at: 'c6' }, { type: 'b', at: 'b6' }, { type: 'p', at: 'e6' }],
  },
  rookery: {
    id: 'rookery', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Rookery', blurb: 'A hopper wants a crowd. Do not give it one.',
    files: 6, ranks: 6, supply: 12, ai: AI.mid, theme: 'court',
    enemy: [{ type: 'k', at: 'c6' }, { type: 'g', at: 'b6' }, { type: 'p', at: 'd6' }, { type: 'p', at: 'e6' }],
  },
  cloister: {
    id: 'cloister', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Cloister', blurb: 'Two bishops on opposite colours.',
    files: 6, ranks: 6, supply: 11, ai: AI.mid, theme: 'court',
    enemy: [{ type: 'k', at: 'c6' }, { type: 'b', at: 'b6' }, { type: 'b', at: 'e6' }, { type: 'p', at: 'd6' }],
  },
  shallows: {
    id: 'shallows', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Shallows', blurb: 'A drake in the doorway. You cannot take it.',
    files: 6, ranks: 6, supply: 13, ai: AI.mid, theme: 'duck',
    enemy: [{ type: 'k', at: 'c6' }, { type: 'd', at: 'c5' }, { type: 'p', at: 'b6' }, { type: 'p', at: 'd6' }],
  },
  kennels: {
    id: 'kennels', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Kennels', blurb: 'Two knights, and they are quicker than they look.',
    files: 6, ranks: 6, supply: 13, ai: AI.mid, theme: 'court',
    enemy: [{ type: 'k', at: 'c6' }, { type: 'n', at: 'b6' }, { type: 'n', at: 'd6' }],
  },
  toll: {
    id: 'toll', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Toll House', blurb: 'A fort square they will not leave.',
    files: 6, ranks: 6, supply: 13, ai: AI.mid, theme: 'court',
    terrain: { c5: TILE.FORT },
    enemy: [{ type: 'k', at: 'c6' }, { type: 'f', at: 'c5' }, { type: 'r', at: 'e6' }],
  },
  dunes: {
    id: 'dunes', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Dunes', blurb: 'Camels. They will be behind you before you see it.',
    files: 6, ranks: 6, supply: 12, ai: AI.mid, theme: 'camel',
    enemy: [{ type: 'k', at: 'c6' }, { type: 'c', at: 'a6' }, { type: 'c', at: 'f6' }, { type: 'p', at: 'd6' }],
  },
  chapel: {
    id: 'chapel', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Chapel', blurb: 'Frost down the aisle.',
    files: 6, ranks: 6, supply: 13, ai: AI.mid, theme: 'ice',
    terrain: { c3: TILE.FROST, c4: TILE.FROST, c5: TILE.FROST },
    enemy: [{ type: 'k', at: 'c6' }, { type: 'b', at: 'b6' }, { type: 'p', at: 'd6' }, { type: 'p', at: 'e6' }],
  },
  quarry: {
    id: 'quarry', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Quarry', blurb: 'A warden that shrugs off the first blow.',
    files: 6, ranks: 6, supply: 14, ai: AI.mid, theme: 'court',
    enemy: [{ type: 'k', at: 'c6' }, { type: 'v', at: 'c5' }, { type: 'p', at: 'b6' }, { type: 'p', at: 'd6' }],
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
    files: 7, ranks: 6, supply: 17, ai: AI.mid, theme: 'flame',
    enemy: [{ type: 'k', at: 'd6' }, { type: 'l', at: 'c6' }, { type: 'p', at: 'e6' }],
  },
  drift: {
    id: 'drift', kind: 'fight', tier: 'trash', act: 2, pool: 'easy',
    name: 'The Drift', blurb: 'Frost, and something patient standing in it.',
    files: 7, ranks: 6, supply: 17, ai: AI.mid, theme: 'ice',
    terrain: { c4: TILE.FROST, d4: TILE.FROST, e4: TILE.FROST },
    enemy: [{ type: 'k', at: 'd6' }, { type: 'i', at: 'd5' }, { type: 'p', at: 'f6' }],
  },
  forge: {
    id: 'forge', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Forge', blurb: 'Live coals across the floor.',
    files: 7, ranks: 6, supply: 14, ai: AI.mid, theme: 'flame',
    terrain: { c4: TILE.FIRE, d4: TILE.FIRE },
    enemy: [{ type: 'k', at: 'c6' }, { type: 'l', at: 'e6' }, { type: 'n', at: 'b6' }, { type: 'p', at: 'd6' }],
  },
  reliquary: {
    id: 'reliquary', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Reliquary', blurb: 'A princess guarding something valuable.',
    files: 7, ranks: 6, supply: 14, ai: AI.mid, theme: 'court',
    enemy: [{ type: 'k', at: 'c6' }, { type: 's', at: 'd6' }, { type: 'p', at: 'b6' }, { type: 'p', at: 'e6' }],
  },
  sappers: {
    id: 'sappers', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Sappers', blurb: 'Do not take the one with the fuse.',
    files: 7, ranks: 6, supply: 14, ai: AI.mid, theme: 'flame',
    enemy: [{ type: 'k', at: 'c6' }, { type: 'x', at: 'c5' }, { type: 'x', at: 'd5' }, { type: 'r', at: 'e6' }],
  },
  glacier: {
    id: 'glacier', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Glacier', blurb: 'Half the board is ice.',
    files: 7, ranks: 6, supply: 15, ai: AI.mid, theme: 'ice',
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
    files: 7, ranks: 6, supply: 15, ai: AI.mid, theme: 'court',
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
    files: 7, ranks: 6, supply: 15, ai: AI.mid, theme: 'wisp',
    enemy: [{ type: 'k', at: 'c6' }, { type: 'y', at: 'c5' }, { type: 'b', at: 'e6' }, { type: 'p', at: 'b6' }],
  },
  emberfield: {
    id: 'emberfield', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Ember Field', blurb: 'Two flames, and the floor is already alight.',
    files: 7, ranks: 6, supply: 16, ai: AI.mid, theme: 'flame',
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
    name: 'The Rime Guard',
    blurb: 'Two rimes and a field of ice — and the cold keeps spreading. Bring something that leaps.',
    files: 8, ranks: 8, supply: 20, ai: AI.boss, theme: 'ice',
    terrain: { c5: TILE.FROST, d5: TILE.FROST, e5: TILE.FROST, f5: TILE.FROST },
    // A fresh row freezes over every six plies — three full rounds — and
    // freezes whatever it catches standing there. Slow enough to plan
    // around, relentless enough that camping in one place stops being safe.
    bossScript: { blizzard: { period: 6 } },
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
    files: 7, ranks: 7, supply: 19, ai: AI.mid, theme: 'flame',
    terrain: { c5: TILE.FIRE, d5: TILE.FIRE },
    enemy: [{ type: 'k', at: 'c7' }, { type: 'l', at: 'e7' }, { type: 'r', at: 'a7' }, { type: 'p', at: 'd7' }],
  },
  spire: {
    id: 'spire', kind: 'fight', tier: 'trash', act: 3, pool: 'easy',
    name: 'The Spire Steps', blurb: 'Narrow, and they hold the high ground.',
    files: 7, ranks: 7, supply: 20, ai: AI.mid, theme: 'court',
    terrain: { c4: TILE.BLOCK, e4: TILE.BLOCK },
    enemy: [{ type: 'k', at: 'd7' }, { type: 'q', at: 'd6' }, { type: 'p', at: 'c7' }, { type: 'p', at: 'e7' }],
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
    name: 'The Conflagration',
    blurb: 'It sets the board alight and walks through it — and calls down fire of its own '
      + 'on marked ground. Watch for the warning, and be somewhere else.',
    files: 8, ranks: 8, supply: 24, ai: AI.boss, theme: 'flame',
    terrain: { c5: TILE.FIRE, d5: TILE.FIRE, e5: TILE.FIRE, f5: TILE.FIRE },
    // Marks a cross around your king every eight plies, burns it two plies
    // later. This boss already fields a full army over static fire — eight
    // gives a full round to actually deal with whatever the board is doing
    // before the sky joins in, rather than stacking both pressures at once.
    bossScript: { meteor: { period: 8, delay: 2 } },
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

  // ===================================================================
  // Rooms that teach the new rules. Each of the four — shooting, raising,
  // the banner's aura, the courier's swap — gets a small, quiet room in
  // act 1 where it is the only thing happening, then shows up mixed into
  // the later acts once you know what it does.
  // ===================================================================

  // ---- act 1 --------------------------------------------------------
  butts: {
    id: 'butts', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Butts', blurb: 'It kills at a distance and never steps forward.',
    files: 6, ranks: 6, supply: 13, ai: AI.easy, theme: 'volley',
    enemy: [
      { type: 'k', at: 'c6' }, { type: 'crossbow', at: 'b6' }, { type: 'p', at: 'd6' },
    ],
  },
  paupers: {
    id: 'paupers', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: "Pauper's Field", blurb: 'What it kills does not stay dead.',
    files: 6, ranks: 6, supply: 13, ai: AI.easy, theme: 'grave',
    enemy: [
      { type: 'k', at: 'c6' }, { type: 'reaper', at: 'c5' }, { type: 'p', at: 'a6' },
    ],
  },
  paradeground: {
    id: 'paradeground', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Parade Ground', blurb: 'They march in a block. Break the block.',
    files: 6, ranks: 6, supply: 12, ai: AI.easy, theme: 'banner',
    enemy: [
      { type: 'k', at: 'c6' }, { type: 'banner', at: 'c5' },
      { type: 'w', at: 'b6' }, { type: 'w', at: 'd6' },
    ],
  },
  towpath: {
    id: 'towpath', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Towpath', blurb: 'Nothing there is where it started.',
    files: 6, ranks: 6, supply: 11, ai: AI.easy, theme: 'court',
    enemy: [
      { type: 'k', at: 'd6' }, { type: 'courier', at: 'c6' },
      { type: 'n', at: 'e6' }, { type: 'p', at: 'b6' }, { type: 'p', at: 'f6' },
    ],
  },
  warren: {
    id: 'warren', kind: 'fight', tier: 'trash', act: 1, pool: 'hard',
    name: 'The Warren', blurb: 'They land where nothing should reach.',
    files: 6, ranks: 6, supply: 12, ai: AI.easy, theme: 'beast',
    enemy: [
      { type: 'k', at: 'd6' }, { type: 'squirrel', at: 'b6' },
      { type: 'squirrel', at: 'f6' }, { type: 'p', at: 'd5' },
    ],
  },
  drillyard: {
    id: 'drillyard', kind: 'fight', tier: 'elite', act: 1,
    name: 'The Drill Yard', blurb: 'A standard, and everything under it moving as one.',
    files: 6, ranks: 6, supply: 12, ai: AI.mid, theme: 'banner',
    enemy: [
      { type: 'k', at: 'd6' }, { type: 'banner', at: 'd5' },
      { type: 'r', at: 'a6' }, { type: 'w', at: 'c6' }, { type: 'w', at: 'e6' },
      { type: 'f', at: 'c5' },
    ],
  },

  // ---- act 2 --------------------------------------------------------
  palisade: {
    id: 'palisade', kind: 'fight', tier: 'trash', act: 2, pool: 'easy',
    name: 'The Palisade', blurb: 'A firing line behind a wall. Get around it.',
    files: 7, ranks: 6, supply: 14, ai: AI.mid, theme: 'volley',
    terrain: { c4: TILE.BLOCK, d4: TILE.BLOCK, e4: TILE.BLOCK },
    enemy: [
      { type: 'k', at: 'd6' }, { type: 'crossbow', at: 'c6' },
      { type: 'crossbow', at: 'e6' }, { type: 'p', at: 'b6' }, { type: 'p', at: 'f6' },
    ],
  },
  ossuary: {
    id: 'ossuary', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Ossuary', blurb: 'Every piece you lose here changes sides.',
    files: 7, ranks: 6, supply: 15, ai: AI.mid, theme: 'grave',
    enemy: [
      { type: 'k', at: 'd6' }, { type: 'reaper', at: 'c5' },
      { type: 'reaper', at: 'e5' }, { type: 'g', at: 'a6' }, { type: 'p', at: 'g6' },
    ],
  },
  stables: {
    id: 'stables', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Stables', blurb: 'Knight and camel in the same body, twice over.',
    files: 7, ranks: 6, supply: 15, ai: AI.mid, theme: 'beast',
    enemy: [
      { type: 'k', at: 'd6' }, { type: 'gnu', at: 'b6' }, { type: 'gnu', at: 'f6' },
      { type: 'p', at: 'c5' }, { type: 'p', at: 'e5' },
    ],
  },
  relaystation: {
    id: 'relaystation', kind: 'fight', tier: 'trash', act: 2, pool: 'hard',
    name: 'The Relay', blurb: 'The dangerous one is never where you left it.',
    files: 7, ranks: 6, supply: 15, ai: AI.mid, theme: 'court',
    enemy: [
      { type: 'k', at: 'd6' }, { type: 'courier', at: 'c6' },
      { type: 'courier', at: 'e6' }, { type: 't', at: 'g6' }, { type: 'p', at: 'd5' },
    ],
  },
  longbarrow: {
    id: 'longbarrow', kind: 'fight', tier: 'elite', act: 2,
    name: 'The Long Barrow', blurb: 'It raises them shielded. Kill it first.',
    files: 8, ranks: 7, supply: 18, ai: AI.hard, theme: 'grave',
    enemy: [
      { type: 'k', at: 'd7' }, { type: 'reaper', at: 'd6' },
      { type: 'dragon', at: 'g7' }, { type: 'guard', at: 'c7' },
      { type: 'guard', at: 'e7' }, { type: 'p', at: 'b7' },
    ],
  },
  enfilade: {
    id: 'enfilade', kind: 'fight', tier: 'elite', act: 2,
    name: 'The Enfilade', blurb: 'Three shooters and a wall of fire between you.',
    files: 8, ranks: 7, supply: 18, ai: AI.hard, theme: 'volley',
    terrain: { c4: TILE.FIRE, e4: TILE.FIRE, g4: TILE.FIRE },
    enemy: [
      { type: 'k', at: 'd7' }, { type: 'crossbow', at: 'b7' },
      { type: 'crossbow', at: 'd6' }, { type: 'crossbow', at: 'f7' },
      { type: 'p', at: 'h7' },
    ],
  },

  // ---- act 3 --------------------------------------------------------
  charnelhouse: {
    id: 'charnelhouse', kind: 'fight', tier: 'trash', act: 3, pool: 'easy',
    name: 'The Charnel House', blurb: 'It has been raising them a long time.',
    files: 8, ranks: 7, supply: 19, ai: AI.hard, theme: 'grave',
    enemy: [
      { type: 'k', at: 'd7' }, { type: 'reaper', at: 'c6' },
      { type: 'horse', at: 'f7' }, { type: 'guard', at: 'b7' },
      { type: 'guard', at: 'e6' }, { type: 'p', at: 'g7' },
    ],
  },
  crestline: {
    id: 'crestline', kind: 'fight', tier: 'trash', act: 3, pool: 'hard',
    name: 'The Crest Line', blurb: 'Dragons on the high ground.',
    files: 8, ranks: 8, supply: 21, ai: AI.hard, theme: 'court',
    enemy: [
      { type: 'k', at: 'd8' }, { type: 'dragon', at: 'b8' },
      { type: 'horse', at: 'f8' }, { type: 'guard', at: 'c7' },
      { type: 'guard', at: 'e7' }, { type: 'p', at: 'g8' },
    ],
  },
  menagerie: {
    id: 'menagerie', kind: 'fight', tier: 'trash', act: 3, pool: 'hard',
    name: 'The Menagerie', blurb: 'Every leap there is, in one room.',
    files: 8, ranks: 8, supply: 21, ai: AI.hard, theme: 'beast',
    enemy: [
      { type: 'k', at: 'd8' }, { type: 'gnu', at: 'b8' },
      { type: 'squirrel', at: 'f8' }, { type: 'z', at: 'g8' },
      { type: 'c', at: 'c8' }, { type: 'p', at: 'd7' },
    ],
  },
  marshalcy: {
    id: 'marshalcy', kind: 'fight', tier: 'elite', act: 3,
    name: 'The Marshalcy', blurb: 'Two standards. Everything under them moves like a king.',
    files: 8, ranks: 8, supply: 22, ai: AI.hard, theme: 'banner',
    enemy: [
      { type: 'k', at: 'd8' }, { type: 'banner', at: 'c7' },
      { type: 'banner', at: 'f7' }, { type: 'r', at: 'a8' },
      { type: 'r', at: 'h8' }, { type: 'guard', at: 'd7' },
      { type: 'guard', at: 'e7' },
    ],
  },
  gravetide: {
    id: 'gravetide', kind: 'fight', tier: 'boss', act: 3, boss: true,
    name: 'The Grave Tide',
    blurb: 'It does not need an army. It takes yours — and the ground along with it, '
      + 'the edges of the board swallowed a ring at a time.',
    files: 8, ranks: 8, supply: 24, ai: AI.boss, theme: 'grave',
    terrain: { d5: TILE.FORT, e5: TILE.FORT },
    // The outer ring gives way every eight plies, then the next ring in —
    // stopping well short of closing the board, but a piece parked on the
    // edge too long does not get a warning first.
    bossScript: { shrink: { period: 8, floor: 4 } },
    enemy: [
      { type: 'k', at: 'd8' }, { type: 'reaper', at: 'c8' },
      { type: 'reaper', at: 'e8' }, { type: 'dragon', at: 'g8' },
      { type: 'banner', at: 'd7' }, { type: 'guard', at: 'b8' },
      { type: 'guard', at: 'f8' },
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
      { label: 'All the way down', detail: '−12 HP. Whatever is at the bottom is epic.',
        effects: [{ hp: -12 }, { gain: 'random-epic' }] },
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
      { label: 'Force the locked cabinet', detail: 'An epic piece. The lock takes 8 HP to break.',
        effects: [{ hp: -8 }, { gain: 'random-epic' }] },
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

  // Rooms built around the newer pieces — each one is a chance to be handed
  // the seed of a build you were not already committed to.
  gravedigger: {
    id: 'gravedigger', name: 'The Gravedigger',
    text: 'He is filling a hole in, not digging one out. He does not look up. '
      + '"There is always more work," he says. "You could take some of it off me."',
    choices: [
      { label: 'Take the shovel', detail: 'A Reanimator joins you. It costs you something to carry (−3 HP).',
        effects: [{ gain: 'reaper' }, { hp: -3 }] },
      { label: 'Pay him to stop', detail: '−25 gold. He gives you back what he found (+6 HP).',
        effects: [{ gold: -25 }, { heal: 6 }] },
      { label: 'Walk on', detail: 'It is not your hole.', effects: [] },
    ],
  },
  archer: {
    id: 'archer', name: 'The Long Shot',
    text: 'A crossbow leans against a tree with nobody near it, still spanned. '
      + 'Whoever left it there did not come back for it.',
    choices: [
      { label: 'Take the bow', detail: 'A Crossbow joins the bag.',
        effects: [{ gain: 'crossbow' }] },
      { label: 'Sell the mechanism', detail: '+28 gold for the parts.',
        effects: [{ gold: 28 }] },
      { label: 'Leave it spanned', detail: 'Something is coming back for it.', effects: [] },
    ],
  },
  standardbearer: {
    id: 'standardbearer', name: 'The Standard Bearer',
    text: 'A colour party of one, still holding the pole upright, still marching '
      + 'in a formation that has nobody left in it.',
    choices: [
      { label: 'Fall in behind', detail: 'A Banner joins you, and one more body every fight.',
        effects: [{ gain: 'banner' }, { deploy: 1 }] },
      { label: 'Take the pole', detail: 'A Banner joins the bag. Nothing else.',
        effects: [{ gain: 'banner' }] },
      { label: 'Let them march', detail: 'Some things should be allowed to finish.', effects: [] },
    ],
  },
  postmaster: {
    id: 'postmaster', name: 'The Post Road',
    text: 'A relay station with the horses long gone and the ledgers still open. '
      + 'Someone has written, in a very steady hand, every route out of here.',
    choices: [
      { label: 'Learn the routes', detail: 'A Courier joins the bag, and two more supply.',
        effects: [{ gain: 'courier' }, { supply: 2 }] },
      { label: 'Burn the ledgers', detail: '+30 gold from whoever wanted them gone.',
        effects: [{ gold: 30 }] },
      { label: 'Close the door', detail: 'Leave the routes for the next one through.', effects: [] },
    ],
  },
  menagerist: {
    id: 'menagerist', name: 'The Menagerist',
    text: 'Cages, mostly empty, and a keeper who is very keen to be rid of what '
      + 'is still in them. "It jumps," she says, unhelpfully.',
    choices: [
      { label: 'Take the big one', detail: 'A Gnu joins the bag (−2 HP getting it out).',
        effects: [{ gain: 'gnu' }, { hp: -2 }] },
      { label: 'Take the quick one', detail: 'A Squirrel joins the bag.',
        effects: [{ gain: 'squirrel' }] },
      { label: 'Open every cage', detail: '+20 gold from the keeper, who runs.',
        effects: [{ gold: 20 }] },
    ],
  },
  drillsergeant: {
    id: 'drillsergeant', name: 'The Old Sergeant',
    text: 'He watches your army walk past and says nothing for a long time. '
      + 'Then: "They move like a crowd. I could make them move like a line."',
    choices: [
      { label: 'Let him drill them', detail: '−20 gold. One more body in every fight, for good.',
        effects: [{ gold: -20 }, { deploy: 1 }] },
      { label: 'Ask for his own kit', detail: 'A Guard joins the bag, free.',
        effects: [{ gain: 'guard' }] },
      { label: 'March past', detail: 'You have somewhere to be.', effects: [] },
    ],
  },

  // Every room above leaves a free "walk away" on the table. These don't,
  // on purpose — the road only goes one way and every way costs something.
  // A run that never takes a real risk should still feel that absence.
  tollkeeper: {
    id: 'tollkeeper', name: 'The Toll Bridge',
    text: 'One stone bridge, one man sitting in the middle of it with a spear '
      + 'across his knees. "Toll," he says. "Coin or blood. Everybody pays one."',
    choices: [
      { label: 'Pay in coin', detail: '−18 gold.', effects: [{ gold: -18 }] },
      { label: 'Pay in blood', detail: '−6 HP.', effects: [{ hp: -6 }] },
      { label: 'Force the bridge', detail: 'You get across. It costs more than either toll (−28 gold, −4 HP).',
        effects: [{ gold: -28 }, { hp: -4 }] },
    ],
  },
  ledger: {
    id: 'ledger', name: 'The Standing Debt',
    text: 'Someone has been keeping a ledger on you since before you knew this '
      + 'road existed. "It is due," the collector says, not unkindly. "Pick the page."',
    choices: [
      { label: 'Settle in coin', detail: '−32 gold.', effects: [{ gold: -32 }] },
      { label: 'Settle in kind', detail: 'Drop a piece of your choice.', effects: [{ lose: 'choose' }] },
      { label: 'Settle in years', detail: '−3 maximum HP, permanently.', effects: [{ maxHp: -3 }] },
    ],
  },
  hightable: {
    id: 'hightable', name: 'The High Table', minAct: 3,
    text: 'Not the shell game — the real one, played for a seat at the table '
      + 'and everything on it. "Sit down," the dealer says. "Or don\'t. Nobody\'s forcing you."',
    choices: [
      { label: 'Sit down', detail: 'One in six, a legendary piece. Otherwise you lose your priciest piece to the house.',
        gamble: { odds: 0.18, win: [{ gain: 'random-legendary' }], lose: [{ lose: 'priciest' }] }, effects: [] },
      { label: "Don't", detail: 'You keep your seat empty and your bag intact.', effects: [] },
    ],
  },
  scale: {
    id: 'scale', name: 'The Broken Scale',
    text: 'A relic-monger with no relics left to sell, only the tools to remake '
      + 'what you already carry. "It will cost you something real," she warns. "It always does."',
    choices: [
      { label: 'Widen the ranks', detail: '−4 HP, permanently. +1 piece in every fight.',
        effects: [{ maxHp: -4 }, { deploy: 1 }] },
      { label: 'Deepen the stores', detail: '−4 HP, permanently. +3 supply in every fight.',
        effects: [{ maxHp: -4 }, { supply: 3 }] },
      { label: 'Keep what you have', detail: 'She shrugs and packs up her tools.', effects: [] },
    ],
  },
  plaguecart: {
    id: 'plaguecart', name: 'The Plague Cart',
    text: 'Still warm, still loaded, and nobody is coming back for it. Whatever '
      + 'took the driver did not take the cargo.',
    choices: [
      { label: 'Take what it carries', detail: 'Gain a rare piece. Whatever got the driver leaves its mark on you too (−6 HP).',
        effects: [{ gain: 'random-rare' }, { hp: -6 }] },
      { label: 'Burn it where it stands', detail: 'No risk, no take. +6 HP from warming yourself at the fire.',
        effects: [{ heal: 6 }] },
    ],
  },
  beggar: {
    id: 'beggar', name: 'The Man on the Road',
    text: 'He has not eaten in a while and he is not going to pretend otherwise. '
      + '"I have nothing to trade you," he says. "I am only asking."',
    choices: [
      { label: 'Feed him', detail: '−12 gold. Nothing else happens — that was the point.',
        effects: [{ gold: -12 }] },
      { label: 'Take his measure instead', detail: '+15 gold from whatever he still has. −3 HP; he does not go quietly.',
        effects: [{ gold: 15 }, { hp: -3 }] },
      { label: 'Walk past', detail: 'He is still there when the road bends.', effects: [] },
    ],
  },
  cairn: {
    id: 'cairn', name: 'The Cairn',
    text: 'A stack of stones with a name under every one, and space left for more. '
      + 'Someone has been adding to it for a long time. It is not clear who buries whom.',
    choices: [
      { label: 'Add a stone', detail: 'Drop a piece of your choice. The cairn pays for it (+38 gold).',
        effects: [{ lose: 'choose' }, { gold: 38 }] },
      { label: 'Take a stone instead', detail: '−5 HP prising one loose. Gain a common piece someone left buried with it.',
        effects: [{ hp: -5 }, { gain: 'random-common' }] },
      { label: 'Leave it standing', detail: 'Some debts are not yours.', effects: [] },
    ],
  },
  fasttrack: {
    id: 'fasttrack', name: 'The Shortcut',
    text: 'A gap in the hedge that was not on the map, going the right direction. '
      + 'Shortcuts on this road are never free — the only question is what they take.',
    choices: [
      { label: 'Take it', detail: 'Skip straight past the next room\'s worth of walking — recover 9 HP for the time saved. '
        + 'You come out the other side lighter (−15 gold, whoever was watching the gap was not watching for free).',
        effects: [{ heal: 9 }, { gold: -15 }] },
      { label: 'Keep to the road', detail: 'Slower, but yours.', effects: [] },
    ],
  },

  // ===================================================================
  // Rooms that hand over something rare. A run is a story about the two
  // or three pieces you built it around, so these are the beats where
  // you actually get one — and every one of them is priced like it.
  // ===================================================================
  quarryface: {
    id: 'quarryface', name: 'The Loadstone Face',
    text: 'A seam of black rock that the picks are all stuck to. The foreman '
      + 'pries one loose and it drags his hand back with it. "It pulls," he says. '
      + '"Whole cartloads. Take a piece if you can carry it."',
    choices: [
      { label: 'Cut a piece loose', detail: 'A Lodestone joins the bag. −5 HP; it fights you the whole way.',
        effects: [{ gain: 'lodestone' }, { hp: -5 }] },
      { label: 'Take the stuck picks', detail: 'Good iron, badly wanted elsewhere. +26 gold.',
        effects: [{ gold: 26 }] },
      { label: 'Leave the seam', detail: 'It is still pulling when you are out of sight.', effects: [] },
    ],
  },
  grove: {
    id: 'grove', name: 'The Petrified Grove', minAct: 3,
    text: 'Every tree here is stone, and so is everything that was walking '
      + 'between them. Something at the centre is still moving, slowly, and it '
      + 'has been alone a very long time.',
    choices: [
      { label: 'Walk in and meet it', detail: 'A Basilisk follows you out. It costs you badly (−9 HP, −2 maximum HP).',
        effects: [{ gain: 'basilisk' }, { hp: -9 }, { maxHp: -2 }] },
      { label: 'Chip the statues for stone', detail: '+34 gold, and nothing follows you.',
        effects: [{ gold: 34 }] },
      { label: 'Go around the grove', detail: 'A long way around, but a way around.', effects: [] },
    ],
  },
  giant: {
    id: 'giant', name: 'The Fallen Giant', minAct: 3,
    text: 'It came down some time before the road did, and the road was built '
      + 'around it rather than through. Close up you can see the plates still '
      + 'fit, and that it is not obviously dead.',
    choices: [
      { label: 'Wake it', detail: 'A Colossus joins you. Getting it upright costs 30 gold and 6 HP.',
        cost: 30, effects: [{ gain: 'colossus' }, { hp: -6 }] },
      { label: 'Strip the plating', detail: 'Armour enough to sell twice over. +40 gold.',
        effects: [{ gold: 40 }] },
      { label: 'Let it lie', detail: 'It has earned that much.', effects: [] },
    ],
  },
  siegetrain: {
    id: 'siegetrain', name: 'The Siege Train',
    text: 'Wagons in a line, all facing a wall that is not there any more. The '
      + 'crews left the tubes behind because the tubes are the heavy part.',
    choices: [
      { label: 'Take a tube', detail: 'A Bombard joins the bag. −3 HP loading it.',
        effects: [{ gain: 'bombard' }, { hp: -3 }] },
      { label: 'Take the powder', detail: 'Sells well and travels badly. +24 gold, −2 HP.',
        effects: [{ gold: 24 }, { hp: -2 }] },
      { label: 'Take the horses', detail: 'One more piece in every fight, for good.',
        effects: [{ deploy: 1 }] },
    ],
  },
  forgemouth: {
    id: 'forgemouth', name: 'The Crucible',
    text: 'A furnace kept lit by nobody, hot enough to melt what you are carrying '
      + 'into something that was never yours. The smith\'s note says only: BETTER, '
      + 'NOT MORE.',
    choices: [
      { label: 'Feed it a piece', detail: 'It comes back out one rarity higher. Costs 20 gold and 4 HP.',
        cost: 20, effects: [{ upgrade: true }, { hp: -4 }] },
      { label: 'Bank the fire', detail: 'Warm work for a night. +10 gold, +5 HP.',
        effects: [{ gold: 10 }, { heal: 5 }] },
      { label: 'Let it go out', detail: 'Somebody will relight it.', effects: [] },
    ],
  },
  reliquarydoor: {
    id: 'reliquarydoor', name: 'The Sealed Reliquary', minAct: 3,
    text: 'A door with no handle and a slot at chest height, worn smooth. '
      + 'Whatever is behind it has been paid for many times and collected once.',
    choices: [
      { label: 'Pay the slot', detail: 'Costs 80 gold. Something legendary is behind that door.',
        cost: 80, effects: [{ gain: 'random-legendary' }] },
      { label: 'Force the door', detail: 'It opens. So does something in you (−11 HP), '
        + 'but you take a rare piece and 15 gold out with you.',
        effects: [{ hp: -11 }, { gain: 'random-rare' }, { gold: 15 }] },
      { label: 'Leave it sealed', detail: 'It has waited this long.', effects: [] },
    ],
  },
  hollowcrown: {
    id: 'hollowcrown', name: 'The Hollow Crown',
    text: 'A crown on a cushion in an empty tent, sized for nobody in particular. '
      + 'It has clearly been worn, and recently, and the tent has clearly been '
      + 'left in a hurry.',
    choices: [
      { label: 'Put it on', detail: 'A king you do not own joins the bag. It takes 4 maximum HP to wear.',
        effects: [{ king: 'random' }, { maxHp: -4 }] },
      { label: 'Sell the stones', detail: '+30 gold, and the tent stays empty.', effects: [{ gold: 30 }] },
      { label: 'Leave the tent', detail: 'Whoever ran had a reason.', effects: [] },
    ],
  },
  duellist: {
    id: 'duellist', name: 'The Duellist',
    text: 'She has been waiting at this crossing for someone worth the trouble, '
      + 'and has decided that you are. "One piece of yours against one of mine," '
      + 'she says. "Mine is better. That is rather the point."',
    choices: [
      { label: 'Put a piece up', detail: 'Even odds. Win and an epic piece is yours; lose and she keeps what you staked.',
        gamble: { odds: 0.5, win: [{ gain: 'random-epic' }], lose: [{ lose: 'choose' }] }, effects: [] },
      { label: 'Buy her off', detail: '−22 gold. She lets the crossing go.', effects: [{ gold: -22 }] },
      { label: 'Refuse and walk', detail: 'She lets you, and watches the whole way.', effects: [] },
    ],
  },
  drownedcart: {
    id: 'drownedcart', name: 'The Drowned Cart',
    text: 'A merchant\'s cart in the ford, up to the axles, with the merchant '
      + 'nowhere and the strongbox still roped down. The water is moving faster '
      + 'than it looks.',
    choices: [
      { label: 'Go in for the box', detail: 'A rare piece and 18 gold. The ford takes 7 HP for it.',
        effects: [{ hp: -7 }, { gain: 'random-rare' }, { gold: 18 }] },
      { label: 'Cut the horse free', detail: 'It is still alive under there. +2 maximum HP for the trouble, and it heals you 4.',
        effects: [{ maxHp: 2 }, { heal: 4 }] },
      { label: 'Ford it further down', detail: 'Dry, and slower.', effects: [] },
    ],
  },
  understudy: {
    id: 'understudy', name: 'The Understudy',
    text: 'A clerk copying out the movements of every piece she has ever seen, '
      + 'in a hand far too good for the job. "I can teach one of yours to move '
      + 'like something else," she says. "It will not thank you."',
    choices: [
      { label: 'Have one taught', detail: 'A piece of your choice becomes one rarity better. Costs 15 gold.',
        cost: 15, effects: [{ upgrade: true }] },
      { label: 'Buy a copy of her notes', detail: '−18 gold, +2 supply in every fight, permanently.',
        cost: 18, effects: [{ supply: 2 }] },
      { label: 'Leave her to it', detail: 'She does not look up.', effects: [] },
    ],
  },
  jester: {
    id: 'jester', name: "The Jester's Wager", minAct: 3,
    text: 'A jester in motley juggles chess pieces carved from glass, humming off-key. '
      + '"Give me your finest," they grin, already eyeing your best piece, "and I\'ll '
      + 'give you back whatever the dice allow. Could be silver. Could be gold. Could '
      + 'be a Pawn with a funny little hat."',
    choices: [
      { label: 'Take the wager',
        detail: 'They take your priciest piece. One in six, a legendary back — otherwise a common.',
        effects: [{ lose: 'priciest' }],
        gamble: { odds: 0.16, win: [{ gain: 'random-legendary' }], lose: [{ gain: 'random-common' }] } },
      { label: 'Keep your hands in your pockets', detail: 'Walk on.', effects: [] },
    ],
  },
  lookingglass: {
    id: 'lookingglass', name: 'The Looking-Glass',
    text: 'A mirror leans against the wall, propped on a chair that should not hold '
      + 'its weight. The reflection is a half-step behind you, and it is smiling '
      + 'before you do. "Show it something worth having," it says, "and I will make '
      + 'it real. Once."',
    choices: [
      { label: 'Show it a piece', detail: 'A piece of your choice is copied exactly, rarity and all. Costs 20 gold.',
        cost: 20, effects: [{ duplicate: true }] },
      { label: 'Turn the mirror to the wall', detail: 'Some things should not be doubled.', effects: [] },
    ],
  },
  crowfeast: {
    id: 'crowfeast', name: 'The Crow Feast',
    text: 'A tree black with crows, and under it a wrapped bundle that used to be someone. '
      + 'One of them tilts its head. "Leave the best of what you carry," it says, quite clearly. '
      + '"We will leave you something that was never yours."',
    choices: [
      { label: 'Leave your finest',
        detail: 'They take your priciest piece. Half the time an epic comes back; otherwise the crows keep both.',
        effects: [{ lose: 'priciest' }],
        gamble: { odds: 0.5, win: [{ gain: 'random-epic' }], lose: [] } },
      { label: 'Throw them gold instead', detail: '−20 gold. They scatter, and you take a rare from the bundle.',
        cost: 20, effects: [{ gain: 'random-rare' }] },
      { label: 'Walk wide of the tree', detail: 'The bundle stays where it is.', effects: [] },
    ],
  },
  saintiron: {
    id: 'saintiron', name: 'The Saint in the Tree', minAct: 2,
    text: 'A sword is grown through an oak, hilt out, the way a saint is supposed to be buried. '
      + 'It is not a sword. Up close it is a piece, and it is better than anything you brought.',
    choices: [
      { label: 'Pull it free', detail: 'An epic piece joins the bag. The oak takes 6 HP for the privilege.',
        effects: [{ gain: 'random-epic' }, { hp: -6 }] },
      { label: 'Leave an offering', detail: '−12 gold. The tree gives you 8 HP back, and nothing else.',
        cost: 12, effects: [{ heal: 8 }] },
      { label: 'Let it rust', detail: 'Saints can wait.', effects: [] },
    ],
  },
  lastlesson: {
    id: 'lastlesson', name: 'The Last Lesson', minAct: 2,
    text: 'A master with no students left, sitting on a folding stool in the road. '
      + '"I have one lesson," she says. "It is not a cheap one. It is also not a long one."',
    choices: [
      { label: 'Pay for the lesson', detail: '−35 gold. An epic piece, taught in an afternoon.',
        cost: 35, effects: [{ gain: 'random-epic' }] },
      { label: 'Offer a piece as tuition', detail: 'Leave a piece of your choice. Take an epic in its place.',
        effects: [{ lose: 'choose' }, { gain: 'random-epic' }] },
      { label: 'Decline', detail: 'She folds the stool and does not argue.', effects: [] },
    ],
  },
  blackcandle: {
    id: 'blackcandle', name: 'The Black Candle', minAct: 2,
    text: 'A candle of black wax, already lit, in a room with no other light. '
      + '"Blow it out and take what it was burning for," says nobody in particular. '
      + '"Or sit with it. Sitting is safer. Sitting is also poorer."',
    choices: [
      { label: 'Blow it out',
        detail: 'One in five, a legendary. Otherwise −9 HP and nothing else.',
        gamble: { odds: 0.2, win: [{ gain: 'random-legendary' }], lose: [{ hp: -9 }] },
        effects: [] },
      { label: 'Sit with it', detail: 'Recover 10 HP in the quiet.', effects: [{ heal: 10 }] },
      { label: 'Leave it burning', detail: 'Someone else will want the dark more.', effects: [] },
    ],
  },
  hollowtree: {
    id: 'hollowtree', name: 'The Hollow Oak', minAct: 3,
    text: 'The trunk is a doorway. Cold air comes out of it, and a sound like a bag being opened. '
      + 'You can reach in as far as you like. The oak does not care how much of you it keeps.',
    choices: [
      { label: 'Reach in', detail: 'An epic piece. −4 HP; something in there bites.',
        effects: [{ gain: 'random-epic' }, { hp: -4 }] },
      { label: 'Go in after it', detail: 'A legendary. −10 HP and −2 maximum HP. The oak is not a gentle teacher.',
        effects: [{ gain: 'random-legendary' }, { hp: -10 }, { maxHp: -2 }] },
      { label: 'Stopper the hollow', detail: '+16 gold from whoever wanted it shut.', effects: [{ gold: 16 }] },
    ],
  },
  longodds: {
    id: 'longodds', name: 'The Long Odds', minAct: 2,
    text: 'A crooked table, a single card face-down, and a man missing three fingers. '
      + '"Turn it," he says. "Big prize under a bad card. Nothing under a good one. '
      + 'Your call which is which — I stopped being able to tell a while ago."',
    choices: [
      { label: 'Turn the card',
        detail: 'One in six, a legendary. Otherwise −10 HP and your priciest piece, gone.',
        gamble: { odds: 0.16, win: [{ gain: 'random-legendary' }], lose: [{ hp: -10 }, { lose: 'priciest' }] },
        effects: [] },
      { label: 'Leave the table', detail: 'Some tables you just walk past.', effects: [] },
    ],
  },
  bloodletter: {
    id: 'bloodletter', name: 'The Bloodletter', minAct: 2,
    text: 'A physician with clean hands and a dirty table. "Vigour for value," she '
      + 'says, already rolling a sleeve. "I have done this before. You will not enjoy '
      + 'it. You will not regret it either."',
    choices: [
      { label: 'Give her a vein', detail: '−3 max HP, permanently. +30 gold.',
        effects: [{ maxHp: -3 }, { gold: 30 }] },
      { label: 'Give her more', detail: '−8 max HP, permanently. A legendary piece.',
        effects: [{ maxHp: -8 }, { gain: 'random-legendary' }] },
      { label: 'Keep your blood', detail: 'She shrugs, unsurprised.', effects: [] },
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
  grave: ['reaper', 'guard'],
  volley: ['crossbow', 'f'],
  banner: ['banner', 'guard'],
  beast: ['gnu', 'squirrel', 'z'],
};

export const SHOP_WEIGHTS = {
  1: { common: 82, rare: 18, epic: 0, legendary: 0 },
  2: { common: 48, rare: 36, epic: 16, legendary: 0 },
  3: { common: 22, rare: 38, epic: 28, legendary: 12 },
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
function pickEvent(rng, seen, act = 1) {
  const all = Object.values(EVENTS).filter((e) => (e.minAct || 1) <= act);
  const fresh = all.filter((e) => !seen.has(e.id));
  const pool = fresh.length ? fresh : (all.length ? all : Object.values(EVENTS));
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
            name: act === 1 ? 'The Masked Stall' : act === 2 ? 'The Masked Armoury' : 'The Masked Reliquary',
            blurb: 'The same hooded figure. Gold, and sometimes blood.',
            next: [],
          };
        } else if (kind === 'event') {
          const ev = pickEvent(rng, seenEvents, act);
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
