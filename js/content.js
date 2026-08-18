// Encounters, shop tables, kings and map layout. Pure data plus helpers —
// run.js owns the mutable run.

import { PIECES, RARITY, shopPool, pieceCost } from './pieces.js';
import { TILE, parseSquare } from './chess.js';

export const START_HP = 18;
export const START_GOLD = 4;
export const REST_HEAL = 7;
export const REST_GOLD = 3;
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
    name: 'The Alley', blurb: 'A tight 5×3. Three pieces, no room to hide.',
    files: 5, ranks: 3, supply: 5, ai: AI.easy, theme: 'court',
    enemy: [
      { type: 'k', at: 'c3' },
      { type: 'n', at: 'e3' },
    ],
  },
  courtyard: {
    id: 'courtyard', kind: 'fight', tier: 'trash', act: 1,
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
};

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
  { col: 1, rows: ['trash', 'shop', 'trash'] },
  { col: 2, rows: ['elite', 'rest', 'trash', 'shop'] },
  { col: 3, rows: ['trash', 'rest', 'trash'] },
  { col: 4, rows: ['shop', 'elite', 'trash'] },
  { col: 5, rows: ['rest', 'trash', 'shop'] },
  { col: 6, rows: ['elite', 'rest'] },
  { col: 7, rows: ['boss'] },
];

function pickEncounter(rng, act, tier) {
  const pool = Object.values(ENCOUNTERS).filter((e) => e.act === act && e.tier === tier);
  if (!pool.length) return Object.values(ENCOUNTERS).find((e) => e.tier === tier);
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Seeded Slay-the-Spire-style map: 3 acts, branching columns, a boss at the end.
 */
export function generateMap(rng) {
  const acts = [];
  for (let act = 1; act <= 3; act++) {
    const nodes = [];
    const cols = [];
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
        } else if (kind === 'rest') {
          node = {
            id, act, col: layer.col, row, kind: 'rest',
            name: 'A Quiet Square', blurb: `Camp. Take ${REST_GOLD} gold.`,
            next: [],
          };
        } else {
          const enc = pickEncounter(rng, act, kind);
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
