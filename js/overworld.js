// Chess-Vania overworld: a tall branching board, fog of war, roaming packs,
// shops, villages, greed pockets and a creeping decay that eats the south.
// Pure logic. voyage.js paints it; campaign.js still runs the fights.

import { pieceById } from './pieces.js';

export const OW = {
  FILES: 11,
  VISION: 2,
  GRACE: 24,
  DECAY_EVERY: 3,
  DECAY_HP: 3,
};

export const TERRAIN = {
  FLOOR: 'floor',
  WALL: 'wall',
  CHASM: 'chasm',
  FROST: 'frost',
  EMBER: 'ember',
  FORT: 'fort',
  RAMP: 'ramp',
};

const WALKABLE = new Set([
  TERRAIN.FLOOR, TERRAIN.FROST, TERRAIN.EMBER, TERRAIN.FORT, TERRAIN.RAMP,
]);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function key(file, rank) {
  return `${file},${rank}`;
}

export function parseKey(s) {
  const [f, r] = s.split(',').map(Number);
  return { file: f, rank: r };
}

export function chebyshev(a, b) {
  return Math.max(Math.abs(a.file - b.file), Math.abs(a.rank - b.rank));
}

export function materialOf(type) {
  if (type === 'k') return 0;
  const def = pieceById(type);
  if (!def) return 1;
  return Math.max(1, Math.round((def.value || def.cost * 100) / 100));
}

export function armyMaterial(army) {
  return (army || []).reduce((sum, p) => sum + materialOf(p.type), 0);
}

export function bagMaterial(run) {
  return (run.bag || []).reduce((sum, p) => sum + materialOf(p.type), 0);
}

/** Green / yellow / red vs the player's current bag. */
export function threatTint(enemyMat, playerMat) {
  const p = Math.max(1, playerMat);
  const ratio = enemyMat / p;
  if (ratio <= 0.8) return 'safe';
  if (ratio <= 1.25) return 'even';
  return 'deadly';
}

export function biomeAt(rank, ranks) {
  const t = rank / Math.max(1, ranks - 1);
  if (t < 0.24) return 'wood';
  if (t < 0.52) return 'frost';
  if (t < 0.78) return 'peak';
  return 'gate';
}

function inBounds(world, file, rank) {
  return file >= 0 && rank >= 0 && file < world.files && rank < world.ranks;
}

export function cellAt(world, file, rank) {
  if (!inBounds(world, file, rank)) return null;
  return world.cells[rank][file];
}

export function isWalkable(world, file, rank) {
  const cell = cellAt(world, file, rank);
  if (!cell) return false;
  if (rank <= world.decayRank) return false;
  return WALKABLE.has(cell.terrain);
}

function occupier(world, file, rank) {
  if (world.player.file === file && world.player.rank === rank) return 'player';
  return world.packs.find((p) => !p.dead && p.file === file && p.rank === rank) || null;
}

function setTerrain(world, file, rank, terrain) {
  const cell = cellAt(world, file, rank);
  if (!cell) return;
  cell.terrain = terrain;
}

function carve(world, file, rank, radius = 0) {
  for (let dr = -radius; dr <= radius; dr++) {
    for (let df = -radius; df <= radius; df++) {
      const cell = cellAt(world, file + df, rank + dr);
      if (!cell) continue;
      const biome = biomeAt(rank + dr, world.ranks);
      cell.terrain = biome === 'frost' ? TERRAIN.FROST
        : biome === 'peak' && world.rng() < 0.12 ? TERRAIN.EMBER
        : TERRAIN.FLOOR;
      cell.biome = biome;
    }
  }
}

function paintBiomeFloors(world) {
  for (let r = 0; r < world.ranks; r++) {
    const biome = biomeAt(r, world.ranks);
    for (let f = 0; f < world.files; f++) {
      const cell = world.cells[r][f];
      cell.biome = biome;
      if (cell.terrain === TERRAIN.WALL || cell.terrain === TERRAIN.CHASM) continue;
      if (cell.terrain === TERRAIN.RAMP || cell.terrain === TERRAIN.FORT) continue;
      if (biome === 'frost') cell.terrain = TERRAIN.FROST;
      else if (biome === 'peak' && cell.terrain === TERRAIN.FLOOR && world.rng() < 0.1) {
        cell.terrain = TERRAIN.EMBER;
      }
    }
  }
}

function themeFor(biome) {
  if (biome === 'frost') return 'ice';
  if (biome === 'peak') return 'fire';
  if (biome === 'gate') return 'court';
  return 'court';
}

const LOOT_COMMON = ['p', 'f', 'w', 'n', 'b'];
const LOOT_RARE = ['c', 'h', 'g', 'r', 'i', 'l', 'd', 'x', 'v', 'squirrel'];
const LOOT_EPIC = ['s', 't', 'm', 'y', 'crossbow', 'reaper', 'lodestone', 'q'];
const LOOT_LEGEND = ['a', 'basilisk', 'colossus'];
const RELIC_CACHE = [
  'muster', 'cavalry', 'brand', 'deepfreeze', 'surgeon', 'secondwind',
  'quiver', 'filings', 'ironcrown', 'prospector',
];

const ARCHETYPES = {
  levy:   { name: 'Wandering Levy', roam: 'k', hunt: 3, pool: ['p', 'p', 'p', 'w', 'f'] },
  riders: { name: 'Outriders', roam: 'n', hunt: 6, pool: ['n', 'n', 'c', 'p', 'p'] },
  frost:  { name: 'Rime Band', roam: 'k', hunt: 3, pool: ['i', 'i', 'g', 'f', 'w'] },
  pyre:   { name: 'Cinder Host', roam: 'b', hunt: 4, pool: ['l', 'x', 'd', 'p', 'p'] },
  tower:  { name: 'Siege Column', roam: 'r', hunt: 4, pool: ['r', 'b', 'h', 'p'] },
  skull:  { name: 'Skull Camp', roam: 'n', hunt: 7, pool: ['s', 't', 'y', 'q', 'n'] },
  court:  { name: 'Royal Outriders', roam: 'n', hunt: 5, pool: ['n', 'b', 'r', 'h', 'p'] },
  gate:   { name: 'The Gate Watch', roam: 'k', hunt: 5, pool: ['r', 'q', 'h', 'n', 'b'] },
};

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function pickArchetype(biome, tier, danger) {
  if (tier === 'boss') {
    if (biome === 'frost') return 'frost';
    if (biome === 'peak') return 'pyre';
    return 'gate';
  }
  if (danger > 0.74) {
    if (biome === 'frost' || biome === 'gate') return 'skull';
    if (biome === 'peak') return 'pyre';
    return 'riders';
  }
  if (tier === 'elite') {
    if (biome === 'frost') return 'frost';
    if (biome === 'peak') return 'pyre';
    if (biome === 'gate') return 'court';
    return 'tower';
  }
  if (biome === 'frost') return 'frost';
  if (biome === 'peak') return 'pyre';
  if (biome === 'gate') return 'court';
  return danger < 0.22 ? 'levy' : 'riders';
}

function buildArmy(rng, power, arch) {
  const spec = ARCHETYPES[arch] || ARCHETYPES.levy;
  const army = [{ type: 'k' }];
  let spent = 0;
  let guard = 0;
  while (spent < power && army.length < 8) {
    const type = pick(rng, spec.pool);
    const cost = materialOf(type);
    if (cost > power && army.length > 1) {
      guard++;
      if (guard > 12) break;
      continue;
    }
    if (spent + cost > power + 3 && army.length > 2) break;
    army.push({ type });
    spent += cost;
    guard++;
    if (guard > 16) break;
  }
  if (army.length < 3) army.push({ type: 'p' }, { type: 'p' });
  return army;
}

function packName(arch, tier) {
  const spec = ARCHETYPES[arch] || ARCHETYPES.levy;
  if (tier === 'boss') return spec.name === 'The Gate Watch' ? 'The Gate Watch' : `Lord of the ${spec.name}`;
  if (tier === 'elite') return spec.name;
  return spec.name;
}

function placePack(world, file, rank, power, tier, archOverride = null) {
  const cell = cellAt(world, file, rank);
  if (!cell || !WALKABLE.has(cell.terrain)) return null;
  if (occupier(world, file, rank)) return null;
  const biome = cell.biome;
  const danger = rank / Math.max(1, world.ranks - 1);
  const arch = archOverride || pickArchetype(biome, tier, danger);
  const spec = ARCHETYPES[arch] || ARCHETYPES.levy;
  const pack = {
    id: `pack-${world.packs.length}`,
    file,
    rank,
    roam: spec.roam,
    huntRange: spec.hunt,
    tier,
    biome,
    arch,
    theme: themeFor(biome),
    name: packName(arch, tier),
    army: buildArmy(world.rng, power, arch),
    hunting: 0,
    dead: false,
    skull: arch === 'skull' || danger > 0.7,
  };
  world.packs.push(pack);
  return pack;
}

function rollLoot(rng, danger, act) {
  const gold = 5 + Math.floor(rng() * 5) + Math.floor(danger * (14 + act * 6));
  const roll = rng();
  let piece = null;
  let relic = null;
  if (danger > 0.78 && roll < 0.22) {
    relic = pick(rng, RELIC_CACHE);
  } else if (danger > 0.7 && roll < 0.38) {
    piece = pick(rng, LOOT_LEGEND);
  } else if (danger > 0.5 && roll < 0.55) {
    piece = pick(rng, LOOT_EPIC);
  } else if (danger > 0.28 && roll < 0.7) {
    piece = pick(rng, roll < 0.35 ? LOOT_RARE : LOOT_COMMON);
  } else if (roll < 0.75) {
    piece = pick(rng, danger > 0.35 ? LOOT_RARE : LOOT_COMMON);
  }
  return {
    gold,
    piece,
    relic,
    skull: danger > 0.58 || Boolean(relic) || LOOT_EPIC.includes(piece) || LOOT_LEGEND.includes(piece),
  };
}

function emptyFloor(world, pred) {
  const hits = [];
  for (let r = 0; r < world.ranks; r++) {
    for (let f = 0; f < world.files; f++) {
      const cell = world.cells[r][f];
      if (!WALKABLE.has(cell.terrain)) continue;
      if (occupier(world, f, r)) continue;
      if (cell.poi) continue;
      if (pred && !pred(cell, f, r)) continue;
      hits.push({ file: f, rank: r, cell });
    }
  }
  return hits;
}

/**
 * A tall strip with a northward spine and branching greed pockets.
 * Rank 0 is south (the start); high ranks are north (the ramp).
 */
export function generateWorld(rng, act = 1) {
  const files = OW.FILES;
  const ranks = 32 + act * 6;
  const cells = [];
  for (let r = 0; r < ranks; r++) {
    const row = [];
    for (let f = 0; f < files; f++) {
      row.push({
        terrain: TERRAIN.WALL,
        biome: biomeAt(r, ranks),
        poi: null,
        loot: null,
      });
    }
    cells.push(row);
  }
  const world = {
    files,
    ranks,
    act,
    rng,
    cells,
    packs: [],
    player: { file: Math.floor(files / 2), rank: 1, leader: 'k' },
    explored: new Set(),
    visible: new Set(),
    decayRank: -1,
    turns: 0,
    grace: OW.GRACE,
    pending: null,
  };

  // Spine: drunken walk north. Keep a memory of the spine so the north can
  // choke down to a single file — you should not be able to walk around the gate.
  let x = Math.floor(files / 2);
  const spine = new Array(ranks);
  const pockets = [];
  for (let y = 0; y < ranks; y++) {
    if (rng() < 0.42) x += rng() < 0.5 ? -1 : 1;
    x = Math.max(2, Math.min(files - 3, x));
    spine[y] = x;
    const wide = y > ranks - 9 ? 0 : (rng() < 0.45 ? 1 : 0);
    carve(world, x, y, wide);
    if (y > 4 && y < ranks - 8 && rng() < 0.36) {
      const dir = rng() < 0.5 ? -1 : 1;
      const len = 4 + Math.floor(rng() * 5);
      let bx = x;
      let by = y;
      for (let i = 0; i < len; i++) {
        bx += dir;
        if (rng() < 0.35) by += 1;
        if (bx < 1 || bx > files - 2 || by < 1 || by > ranks - 3) break;
        carve(world, bx, by, rng() < 0.3 ? 1 : 0);
      }
      pockets.push({ file: bx, rank: by, depth: len, mouth: y });
    }
  }

  // Turn leftover walls beside floor into chasms so combat boards get holes.
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) {
      const cell = cells[r][f];
      if (cell.terrain !== TERRAIN.WALL) continue;
      let near = false;
      for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = cellAt(world, f + df, r + dr);
        if (n && WALKABLE.has(n.terrain)) { near = true; break; }
      }
      if (near && rng() < 0.55) cell.terrain = TERRAIN.CHASM;
    }
  }

  paintBiomeFloors(world);

  // Pinch the last stretch into a corridor. A wide north is how a king
  // walked around every pack and touched the ramp for free.
  for (let y = ranks - 8; y < ranks; y++) {
    const sx = spine[y] ?? x;
    for (let f = 0; f < files; f++) {
      if (Math.abs(f - sx) <= 1) continue;
      const cell = cells[y][f];
      if (WALKABLE.has(cell.terrain) && cell.poi !== 'ramp') {
        cell.terrain = rng() < 0.7 ? TERRAIN.CHASM : TERRAIN.WALL;
        cell.poi = null;
        cell.loot = null;
      }
    }
  }

  // Start clearing so the first view is not a corridor of walls.
  carve(world, world.player.file, world.player.rank, 1);
  setTerrain(world, world.player.file, world.player.rank, TERRAIN.FLOOR);

  // Ramp at the north end of the spine — and a boss sitting on it.
  const rampFile = spine[ranks - 2] ?? x;
  carve(world, rampFile, ranks - 2, 0);
  const rampCell = cellAt(world, rampFile, ranks - 2);
  rampCell.terrain = TERRAIN.RAMP;
  rampCell.poi = 'ramp';

  const villageSpots = emptyFloor(world, (_c, _f, r) => r >= 2 && r <= 6);
  if (villageSpots.length) {
    const v = pick(rng, villageSpots);
    v.cell.poi = 'village';
    v.cell.terrain = TERRAIN.FORT;
  }
  const shopSpots = emptyFloor(world, (_c, _f, r) => r >= 9 && r <= ranks - 10);
  if (shopSpots.length) {
    const s = pick(rng, shopSpots);
    s.cell.poi = 'shop';
    s.cell.terrain = TERRAIN.FORT;
  }
  const midVillage = emptyFloor(world, (c, _f, r) => (c.biome === 'frost' || c.biome === 'peak') && r > 10 && r < ranks - 10);
  if (midVillage.length) {
    const v = pick(rng, midVillage);
    v.cell.poi = 'village';
    v.cell.terrain = TERRAIN.FORT;
  }

  // Greed nodes: every pocket end is a cache, and the deeper/later it is
  // the more it pays — and the nastier the camp sitting on it.
  for (const pocket of pockets) {
    const cell = cellAt(world, pocket.file, pocket.rank);
    if (!cell || !WALKABLE.has(cell.terrain) || cell.poi) continue;
    const danger = Math.min(1, pocket.rank / ranks * 0.65 + pocket.depth / 10 * 0.45);
    cell.poi = 'loot';
    cell.loot = rollLoot(rng, danger, act);
    const guardPower = Math.round(6 + danger * (16 + act * 5));
    const guardTier = danger > 0.7 ? 'elite' : danger > 0.45 ? 'elite' : 'trash';
    const arch = danger > 0.68 ? 'skull' : null;
    placePack(world, pocket.file, pocket.rank, guardPower, guardTier, arch);
  }

  // Spine patrols. These are the wilderness — they hunt, they sit on the
  // road, and walking north means meeting them.
  const used = new Set(world.packs.map((p) => key(p.file, p.rank)));
  const patrolRanks = [6, 10, 14, 18, 22, 26, ranks - 10, ranks - 6];
  for (const ry of patrolRanks) {
    const y = Math.max(5, Math.min(ranks - 4, ry + (rng() < 0.5 ? 0 : 1)));
    const f = spine[y] ?? x;
    if (used.has(key(f, y))) continue;
    if (chebyshev({ file: f, rank: y }, world.player) < 5) continue;
    used.add(key(f, y));
    const t = y / ranks;
    const power = Math.round(5 + t * (14 + act * 6) + rng() * 3);
    const tier = t > 0.82 ? 'elite' : t > 0.55 ? 'elite' : 'trash';
    placePack(world, f, y, power, tier);
  }

  // Gate boss on the ramp. You do not stroll off Act 1.
  placePack(world, rampFile, ranks - 2, 18 + act * 6, 'boss', 'gate');

  let caches = 0;
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) {
      if (cells[r][f].poi === 'loot') caches++;
    }
  }
  if (caches < 3) {
    const spots = emptyFloor(world, (_c, f, r) => r >= 8 && r < ranks - 4 && Math.abs(f - (spine[r] ?? x)) >= 2);
    for (const s of spots) {
      if (caches >= 4) break;
      const danger = Math.max(0.4, s.rank / ranks);
      s.cell.poi = 'loot';
      s.cell.loot = rollLoot(rng, danger, act);
      caches++;
      placePack(world, s.file, s.rank, Math.round(8 + danger * 14), danger > 0.55 ? 'elite' : 'trash');
    }
  }

  // Fill any thin maps so the road is never empty.
  let extra = 0;
  for (let y = 8; y < ranks - 3 && world.packs.length < 14 && extra < 8; y += 3) {
    const f = spine[y] ?? x;
    if (used.has(key(f, y))) continue;
    if (chebyshev({ file: f, rank: y }, world.player) < 5) continue;
    const placed = placePack(world, f, y, Math.round(6 + (y / ranks) * 12), y / ranks > 0.55 ? 'elite' : 'trash');
    if (placed) {
      used.add(key(f, y));
      extra++;
    }
  }

  revealAround(world, world.player.file, world.player.rank, OW.VISION);
  return world;
}

export function revealAround(world, file, rank, radius = OW.VISION) {
  world.visible = new Set();
  for (let r = rank - radius; r <= rank + radius; r++) {
    for (let f = file - radius; f <= file + radius; f++) {
      if (!inBounds(world, f, r)) continue;
      if (Math.max(Math.abs(f - file), Math.abs(r - rank)) > radius) continue;
      const k = key(f, r);
      world.explored.add(k);
      world.visible.add(k);
    }
  }
}

export function visionOf(world, file, rank) {
  return world.visible.has(key(file, rank));
}

export function exploredOf(world, file, rank) {
  return world.explored.has(key(file, rank));
}

/** Chess-like steps on the overworld. Knights jump walls; sliders need floor. */
export function movesFor(world, file, rank, type, {
  capturePlayer = false, selfPack = null, attackPacks = false,
} = {}) {
  const dest = [];
  const seen = new Set();
  const add = (f, r) => {
    if (!inBounds(world, f, r)) return false;
    const k = key(f, r);
    if (seen.has(k)) return false;
    if (!isWalkable(world, f, r)) return false;
    const who = occupier(world, f, r);
    if (who === 'player') {
      if (!capturePlayer) return false;
    } else if (who && who !== selfPack) {
      if (!attackPacks) return false;
      seen.add(k);
      dest.push({ file: f, rank: r });
      return false;
    }
    seen.add(k);
    dest.push({ file: f, rank: r });
    return true;
  };

  const def = pieceById(type);
  if (def?.pawn) {
    add(file, rank + 1, false);
    return dest;
  }

  const leaps = def?.leaps || (def?.slides ? null : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]);
  if (leaps) {
    for (const [df, dr] of leaps) add(file + df, rank + dr);
  }
  if (def?.slides) {
    for (const [df, dr] of def.slides) {
      for (let i = 1; i < 16; i++) {
        const f = file + df * i;
        const r = rank + dr * i;
        if (!inBounds(world, f, r)) break;
        if (!isWalkable(world, f, r)) break;
        const who = occupier(world, f, r);
        if (who === 'player') {
          if (capturePlayer) add(f, r);
          break;
        }
        if (who && who !== selfPack) {
          if (attackPacks) add(f, r);
          break;
        }
        if (!add(f, r)) break;
      }
    }
  }
  return dest;
}

export function playerMoves(world) {
  return movesFor(world, world.player.file, world.player.rank, world.player.leader, {
    attackPacks: true,
  });
}

function applyPoi(world, file, rank) {
  const cell = cellAt(world, file, rank);
  if (!cell?.poi) return null;
  if (cell.poi === 'shop') return { type: 'shop' };
  if (cell.poi === 'village') {
    if (cell.spent) return null;
    cell.spent = true;
    return { type: 'village', biome: cell.biome };
  }
  if (cell.poi === 'ramp') return { type: 'ramp' };
  if (cell.poi === 'loot' && cell.loot) {
    const loot = cell.loot;
    cell.loot = null;
    cell.poi = null;
    return { type: 'loot', loot };
  }
  return null;
}

function advanceDecay(world) {
  if (world.turns <= world.grace) return null;
  if ((world.turns - world.grace) % OW.DECAY_EVERY !== 0) return null;
  world.decayRank += 1;
  world.packs = world.packs.filter((p) => p.dead || p.rank > world.decayRank);
  if (world.player.rank <= world.decayRank) {
    return { type: 'decay' };
  }
  return { type: 'decay-tick', rank: world.decayRank };
}

function chaseOrWander(world, pack) {
  const player = world.player;
  const sees = chebyshev(pack, player) <= (pack.huntRange || OW.VISION + 1);
  if (sees) pack.hunting = 4;
  else if (pack.hunting > 0) pack.hunting -= 1;

  const moves = movesFor(world, pack.file, pack.rank, pack.roam, {
    capturePlayer: true,
    selfPack: pack,
  });
  if (!moves.length) return null;

  const ontoPlayer = moves.find((m) => m.file === player.file && m.rank === player.rank);
  if (ontoPlayer && (sees || pack.hunting > 0)) return ontoPlayer;

  if (sees || pack.hunting > 0) {
    let best = null;
    let bestD = chebyshev(pack, player);
    for (const m of moves) {
      if (m.file === player.file && m.rank === player.rank) continue;
      const d = chebyshev(m, player);
      if (d < bestD) { bestD = d; best = m; }
    }
    if (best) return best;
  }

  return pick(world.rng, moves.filter((m) => !(m.file === player.file && m.rank === player.rank)))
    || pick(world.rng, moves);
}

export function stepEnemies(world) {
  const events = [];
  for (const pack of world.packs) {
    if (pack.dead) continue;
    if (pack.rank <= world.decayRank) { pack.dead = true; continue; }
    const dest = chaseOrWander(world, pack);
    if (!dest) continue;
    const hitPlayer = dest.file === world.player.file && dest.rank === world.player.rank;
    pack.file = dest.file;
    pack.rank = dest.rank;
    if (hitPlayer) {
      events.push({ type: 'combat', pack, aggressor: 'enemy' });
      break;
    }
  }
  return events;
}

/**
 * Move the leader, then every pack. Returns the first event the UI must handle.
 */
export function movePlayer(world, file, rank) {
  const legal = playerMoves(world);
  if (!legal.some((m) => m.file === file && m.rank === rank)) {
    return { ok: false, reason: 'illegal' };
  }
  const pack = world.packs.find((p) => !p.dead && p.file === file && p.rank === rank);
  world.player.file = file;
  world.player.rank = rank;
  world.turns += 1;
  revealAround(world, file, rank, OW.VISION);

  if (pack) {
    return { ok: true, event: { type: 'combat', pack, aggressor: 'player' } };
  }

  const poi = applyPoi(world, file, rank);
  if (poi) return { ok: true, event: poi };

  const decay = advanceDecay(world);
  const enemyEvents = stepEnemies(world);
  const combat = enemyEvents.find((e) => e.type === 'combat');
  if (combat) return { ok: true, event: combat };
  if (decay?.type === 'decay') return { ok: true, event: decay };
  return { ok: true, event: decay || null };
}

export function leadersInBag(run) {
  const types = new Set(['k']);
  for (const item of run.bag || []) types.add(item.type);
  return [...types];
}

export function setLeader(world, type, run) {
  if (!leadersInBag(run).includes(type)) return false;
  world.player.leader = type;
  return true;
}

export function villageRecruit(biome) {
  if (biome === 'frost') return { type: 'i', gold: 5, name: 'a Rime' };
  if (biome === 'peak') return { type: 'l', gold: 5, name: 'a Flame' };
  if (biome === 'gate') return { type: 'h', gold: 6, name: 'a Champion' };
  return { type: 'w', gold: 3, name: 'a Wazir' };
}

/**
 * Build a fight encounter from the overworld tile the clash happened on.
 * Mountains/chasms become holes; frost and ember come with the biome.
 */
export function clashEncounter(world, pack, run, aggressor) {
  const files = Math.min(8, 6 + Math.min(2, world.act - 1));
  const ranks = Math.min(8, 6 + Math.min(2, world.act - 1));
  const originFile = world.player.file - Math.floor(files / 2);
  const originRank = world.player.rank - Math.floor(ranks / 2);
  const terrain = {};
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) {
      const owF = originFile + f;
      const owR = originRank + r;
      const cell = cellAt(world, owF, owR);
      const combatName = `${String.fromCharCode(97 + f)}${r + 1}`;
      if (!cell || cell.terrain === TERRAIN.WALL || cell.terrain === TERRAIN.CHASM
        || owR <= world.decayRank) {
        terrain[combatName] = 'block';
      } else if (cell.terrain === TERRAIN.FROST) {
        terrain[combatName] = 'frost';
      } else if (cell.terrain === TERRAIN.EMBER) {
        terrain[combatName] = 'fire';
      } else if (cell.terrain === TERRAIN.FORT) {
        terrain[combatName] = 'fort';
      }
    }
  }

  // Always leave a south rank to stand on, or the loadout has nowhere to put a king.
  for (let f = 0; f < files; f++) {
    delete terrain[`${String.fromCharCode(97 + f)}1`];
  }

  // a1 is south on a variant board; a{ranks} is north. Enemies stand north.
  const enemySquares = [];
  for (let n = ranks; n >= ranks - 1 && n >= 1; n--) {
    for (let f = 0; f < files; f++) {
      const name = `${String.fromCharCode(97 + f)}${n}`;
      if (terrain[name] === 'block') continue;
      enemySquares.push(name);
    }
  }
  if (enemySquares.length < 2) {
    for (let f = 0; f < files; f++) {
      const name = `${String.fromCharCode(97 + f)}${ranks}`;
      delete terrain[name];
      if (!enemySquares.includes(name)) enemySquares.push(name);
    }
  }
  const enemy = [];
  const pieces = pack.army.slice();
  for (let i = 0; i < pieces.length && i < enemySquares.length; i++) {
    enemy.push({ type: pieces[i].type, at: enemySquares[i] });
  }

  const mat = armyMaterial(pack.army);
  const supply = Math.max(4, bagMaterial(run) + 4);
  return {
    id: pack.id,
    kind: 'fight',
    name: pack.name,
    blurb: aggressor === 'enemy'
      ? 'They caught you. They move first.'
      : 'You struck first.',
    files,
    ranks,
    supply,
    deploy: Math.max(2, (run.bag || []).length),
    enemy,
    terrain,
    theme: pack.theme,
    tier: pack.tier || 'trash',
    firstMover: aggressor === 'enemy' ? 'b' : 'w',
    ai: pack.tier === 'boss' ? { depth: 5, slip: 0, budget: 1400 }
      : pack.tier === 'elite' ? { depth: 4, slip: 0.04, budget: 800 }
      : { depth: 3, slip: 0.1, budget: 450 },
    clock: pack.tier === 'boss' ? 38 : pack.tier === 'elite' ? 30 : 24,
    packId: pack.id,
    aggressor,
    material: mat,
  };
}

export function bumpFromPack(world, pack) {
  const options = playerMoves(world).filter((m) => {
    return !(m.file === pack.file && m.rank === pack.rank);
  });
  const south = options.filter((m) => m.rank < world.player.rank);
  const pickFrom = south.length ? south : options;
  if (!pickFrom.length) return;
  const dest = pickFrom[0];
  world.player.file = dest.file;
  world.player.rank = dest.rank;
  revealAround(world, dest.file, dest.rank, OW.VISION);
}

export function nextActWorld(rng, act) {
  return generateWorld(rng, act);
}
