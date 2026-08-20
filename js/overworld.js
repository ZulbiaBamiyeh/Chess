// Chess-Vania overworld: a tall branching board, fog of war, roaming packs,
// shops, villages, greed pockets and a creeping decay that eats the south.
// Pure logic. voyage.js paints it; campaign.js still runs the fights.

import { pieceById } from './pieces.js';

export const OW = {
  FILES: 11,
  VISION: 3,
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

/** The piece that actually represents a side: their most valuable non-king body. */
export function keyPieceType(army) {
  const best = (army || []).filter((p) => p.type !== 'k')
    .sort((a, b) => materialOf(b.type) - materialOf(a.type))[0];
  return best?.type || 'p';
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
  const pack = (world.packs || []).find((p) => !p.dead && p.file === file && p.rank === rank);
  if (pack) return pack;
  return (world.npcs || []).find((n) => n.file === file && n.rank === rank) || null;
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
  levy: {
    names: ['Wandering Levy', 'Pressed Footmen', 'A Tax Cohort'],
    blurb: 'Farmers with spears, told to walk north and not ask why.',
    roam: 'k', hunt: 3, stance: 'hostile',
    pool: ['p', 'p', 'p', 'w', 'f'],
  },
  thieves: {
    names: ["Thieves' Raid", 'A Cutpurse Band', 'Night Haul'],
    blurb: 'They work the south road and vanish when a real army comes.',
    roam: 'n', hunt: 5, stance: 'hostile',
    pool: ['p', 'n', 'f', 'w', 's'],
  },
  scouts: {
    names: ['Cavalry Scouts', 'Outrider Screen', 'The Fast Wing'],
    blurb: 'Horses and camels, sent ahead to find you before you find them.',
    roam: 'n', hunt: 6, stance: 'hostile',
    pool: ['n', 'n', 'c', 'p', 'p'],
  },
  horde: {
    names: ['The Golden Horde', 'Khaganate Riders', 'A Tribute Host'],
    blurb: 'A travelling court of horse and gold. They take what the road offers.',
    roam: 'n', hunt: 5, stance: 'hostile',
    pool: ['n', 'c', 'h', 'p', 'p', 'f'],
  },
  frost: {
    names: ['Rime Band', 'Hoarfrost Choir', 'A Cold Company'],
    blurb: 'They walk the ice and leave the ground frozen behind them.',
    roam: 'k', hunt: 3, stance: 'hostile',
    pool: ['i', 'i', 'g', 'f', 'w'],
  },
  pyre: {
    names: ['Cinder Host', 'Ember Column', 'A Brand March'],
    blurb: 'Ash on the cloaks. The path they take still smokes.',
    roam: 'b', hunt: 4, stance: 'hostile',
    pool: ['l', 'x', 'd', 'p', 'p'],
  },
  tower: {
    names: ['Siege Column', 'A Slow Battery', 'The Rolling Keep'],
    blurb: 'They do not chase far. They do not need to — they fill the road.',
    roam: 'r', hunt: 3, stance: 'hostile',
    pool: ['r', 'b', 'h', 'p'],
  },
  skull: {
    names: ['Skull Camp', 'A Bone Court', 'The Black Cache'],
    blurb: 'They sit on the best loot in the wild. They will come for you.',
    roam: 'n', hunt: 7, stance: 'hostile',
    pool: ['s', 't', 'y', 'q', 'n'],
  },
  court: {
    names: ['Royal Outriders', 'A Prince\'s Wing', 'The Banner Hunt'],
    blurb: 'Someone important sent them. They hunt like they have to come home with you.',
    roam: 'n', hunt: 5, stance: 'hostile',
    pool: ['n', 'b', 'r', 'h', 'p'],
  },
  gate: {
    names: ['The Gate Watch'],
    blurb: 'The ramp is theirs. There is no talking past them.',
    roam: 'k', hunt: 5, stance: 'hostile',
    pool: ['r', 'q', 'h', 'n', 'b'],
  },
  watch: {
    names: ['A Hired Watch', 'Chest Wardens', 'Keepers of the Hole', 'A Quiet Guard'],
    blurb: 'Paid to sit on a cache. They will not chase you, and they will not strike first.',
    roam: 'k', hunt: 0, stance: 'docile',
    pool: ['p', 'p', 'w', 'f', 'n'],
  },
  caravan: {
    names: ['A Merchant Guard', 'Caravan Watch', 'A Toll Camp'],
    blurb: 'They hold a stretch of road, not a grudge. Walk around, or make it a fight.',
    roam: 'k', hunt: 0, stance: 'docile',
    pool: ['p', 'n', 'w', 'f'],
  },
};

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function pickArchetype(biome, tier, danger, rng, role = 'road') {
  if (tier === 'boss') {
    if (biome === 'frost') return 'frost';
    if (biome === 'peak') return 'pyre';
    return 'gate';
  }
  if (role === 'cache') {
    if (danger < 0.4) return 'watch';
    const r = rng();
    if (r < 0.68) return 'watch';
    if (r < 0.86) return 'thieves';
    return 'skull';
  }
  if (role === 'road' && danger < 0.55 && rng() < 0.14) return 'caravan';
  // The south is levy-and-pawns country. Scouts and thieves wait until the
  // board has actually climbed.
  if (danger < 0.4) return 'levy';
  if (danger > 0.74) {
    if (biome === 'frost' || biome === 'gate') return 'skull';
    if (biome === 'peak') return 'pyre';
    return rng() < 0.5 ? 'horde' : 'scouts';
  }
  if (tier === 'elite') {
    if (biome === 'frost') return 'frost';
    if (biome === 'peak') return 'pyre';
    if (biome === 'gate') return 'court';
    return rng() < 0.5 ? 'tower' : 'horde';
  }
  if (biome === 'frost') return 'frost';
  if (biome === 'peak') return 'pyre';
  if (biome === 'gate') return rng() < 0.5 ? 'court' : 'scouts';
  if (danger < 0.22) return rng() < 0.55 ? 'levy' : 'thieves';
  return rng() < 0.5 ? 'scouts' : 'thieves';
}

function packPower(rank, ranks, act, rng) {
  const t = rank / Math.max(1, ranks - 1);
  // Until well up the board, they field what you field: two or three pawns.
  if (t < 0.4) return rng() < 0.55 ? 2 : 3;
  if (t < 0.55) return 4 + Math.floor(rng() * 3);
  return Math.round(6 + t * (12 + act * 5) + rng() * 3);
}

function buildArmy(rng, power, arch) {
  const spec = ARCHETYPES[arch] || ARCHETYPES.levy;
  const army = [{ type: 'k' }];
  if (power <= 3) {
    const n = Math.max(2, Math.min(3, power));
    for (let i = 0; i < n; i++) army.push({ type: 'p' });
    return army;
  }
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

function packName(spec, tier, rng) {
  const names = spec.names || [spec.name || 'A Company'];
  if (tier === 'boss') {
    if (names[0] === 'The Gate Watch') return 'The Gate Watch';
    return `Lord of the ${names[0]}`;
  }
  return pick(rng, names);
}

function placePack(world, file, rank, power, tier, opts = {}) {
  const cell = cellAt(world, file, rank);
  if (!cell || !WALKABLE.has(cell.terrain)) return null;
  if (occupier(world, file, rank)) return null;
  const biome = cell.biome;
  const danger = rank / Math.max(1, world.ranks - 1);
  const role = opts.role || 'road';
  const arch = opts.arch || pickArchetype(biome, tier, danger, world.rng, role);
  const spec = ARCHETYPES[arch] || ARCHETYPES.levy;
  const stance = spec.stance || 'hostile';
  const pack = {
    id: `pack-${world.packs.length}`,
    file,
    rank,
    roam: spec.roam,
    huntRange: stance === 'docile' ? 0 : spec.hunt,
    tier,
    biome,
    arch,
    theme: themeFor(biome),
    name: packName(spec, tier, world.rng),
    blurb: spec.blurb || '',
    stance,
    army: buildArmy(world.rng, power, arch),
    hunting: 0,
    dead: false,
    skull: stance === 'hostile' && (arch === 'skull' || danger > 0.7),
  };
  world.packs.push(pack);
  return pack;
}

/** "King · Pawn ×3 · Knight" — what they actually brought. */
export function packRoster(army) {
  const counts = new Map();
  const order = [];
  for (const p of army || []) {
    if (!counts.has(p.type)) order.push(p.type);
    counts.set(p.type, (counts.get(p.type) || 0) + 1);
  }
  return order.map((type) => {
    const n = counts.get(type);
    const name = type === 'k' ? 'King' : (pieceById(type)?.name || type);
    return n > 1 ? `${name} ×${n}` : name;
  }).join(' · ');
}

export function packCard(pack, playerMat) {
  const mat = armyMaterial(pack.army);
  const docile = pack.stance === 'docile';
  return {
    name: pack.name,
    blurb: pack.blurb || '',
    stance: docile ? 'docile' : 'hostile',
    stanceLine: docile
      ? 'Docile. They will not strike first.'
      : pack.tier === 'boss'
        ? 'Hostile. They hold the ramp.'
        : 'Hostile. They hunt if they see you.',
    roster: packRoster(pack.army),
    material: mat,
    tint: threatTint(mat, playerMat),
  };
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
    npcs: [],
    scene: 'overworld',
    furthestRank: 1,
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
    // A wider south so the opening is a glade, not a one-file trench.
    const wide = y > ranks - 9 ? 0 : (y < 12 ? 1 : (rng() < 0.5 ? 1 : 0));
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

  // Start clearing so the first view is a little glade, not a trench of walls.
  carve(world, world.player.file, world.player.rank, 2);
  setTerrain(world, world.player.file, world.player.rank, TERRAIN.FLOOR);

  // Ramp at the north end of the spine — and a boss sitting on it.
  const rampFile = spine[ranks - 2] ?? x;
  carve(world, rampFile, ranks - 2, 0);
  const rampCell = cellAt(world, rampFile, ranks - 2);
  rampCell.terrain = TERRAIN.RAMP;
  rampCell.poi = 'ramp';

  placeTown(world, rng, (_c, _f, r) => r >= 2 && r <= 7, 'wood');
  placeTown(world, rng, (c, _f, r) => (c.biome === 'frost' || c.biome === 'peak') && r > 12 && r < ranks - 10);
  const shopSpots = emptyFloor(world, (_c, _f, r) => r >= 10 && r <= ranks - 10);
  if (shopSpots.length) {
    const s = pick(rng, shopSpots);
    s.cell.poi = 'shop';
    s.cell.terrain = TERRAIN.FORT;
  }
  const shrineSpots = emptyFloor(world, (_c, _f, r) => r >= 3 && r <= 9);
  if (shrineSpots.length) {
    pick(rng, shrineSpots).cell.poi = 'shrine';
  }
  const signSpots = emptyFloor(world, (_c, _f, r) => r >= 4 && r <= 12);
  if (signSpots.length) {
    pick(rng, signSpots).cell.poi = 'sign';
  }

  // Wandering "?" events: a handful of STS-style rooms scattered the length
  // of the act, so the road is not just fights, shops and caches.
  const eventSpots = emptyFloor(world, (_c, _f, r) => r >= 3 && r <= ranks - 6);
  const numEvents = Math.min(eventSpots.length, 4 + Math.floor(rng() * 3));
  for (let i = 0; i < numEvents; i++) {
    const idx = Math.floor(rng() * eventSpots.length);
    const [spot] = eventSpots.splice(idx, 1);
    spot.cell.poi = 'event';
  }

  // Greed nodes: every pocket end is a cache, and the deeper/later it is
  // the more it pays — and the nastier the camp sitting on it.
  for (const pocket of pockets) {
    const cell = cellAt(world, pocket.file, pocket.rank);
    if (!cell || !WALKABLE.has(cell.terrain) || cell.poi) continue;
    const danger = Math.min(1, pocket.rank / ranks * 0.65 + pocket.depth / 10 * 0.45);
    cell.poi = 'loot';
    cell.loot = rollLoot(rng, danger, act);
    const guardPower = packPower(pocket.rank, ranks, act, rng);
    const guardTier = danger > 0.7 ? 'elite' : danger > 0.52 ? 'elite' : 'trash';
    placePack(world, pocket.file, pocket.rank, guardPower, guardTier, { role: 'cache' });
  }

  // Spine patrols. These are the wilderness — they hunt, they sit on the
  // road, and walking north means meeting them.
  const used = new Set(world.packs.map((p) => key(p.file, p.rank)));
  const patrolRanks = [12, 16, 20, 24, 28, ranks - 10, ranks - 6];
  for (const ry of patrolRanks) {
    const y = Math.max(11, Math.min(ranks - 4, ry + (rng() < 0.5 ? 0 : 1)));
    const f = spine[y] ?? x;
    if (used.has(key(f, y))) continue;
    if (chebyshev({ file: f, rank: y }, world.player) < 8) continue;
    used.add(key(f, y));
    const t = y / ranks;
    const power = packPower(y, ranks, act, rng);
    const tier = t > 0.82 ? 'elite' : t > 0.62 ? 'elite' : 'trash';
    placePack(world, f, y, power, tier, { role: 'road' });
  }

  // Gate boss on the ramp. You do not stroll off Act 1.
  placePack(world, rampFile, ranks - 2, 18 + act * 6, 'boss', { arch: 'gate' });

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
      placePack(world, s.file, s.rank, packPower(s.rank, ranks, act, rng), danger > 0.62 ? 'elite' : 'trash', { role: 'cache' });
    }
  }

  // Fill any thin maps so the road is never empty.
  let extra = 0;
  for (let y = 12; y < ranks - 3 && world.packs.length < 14 && extra < 8; y += 3) {
    const f = spine[y] ?? x;
    if (used.has(key(f, y))) continue;
    if (chebyshev({ file: f, rank: y }, world.player) < 5) continue;
    const placed = placePack(world, f, y, packPower(y, ranks, act, rng), y / ranks > 0.62 ? 'elite' : 'trash', { role: 'road' });
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
      if (attackPacks && who.army) {
        seen.add(k);
        dest.push({ file: f, rank: r });
      }
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
          if (attackPacks && who.army) add(f, r);
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
    return { type: 'village', biome: cell.biome, name: cell.townName, seed: cell.townSeed };
  }
  if (cell.poi === 'shrine') return { type: 'shrine', spent: Boolean(cell.spent) };
  if (cell.poi === 'sign') return { type: 'sign', spent: Boolean(cell.spent) };
  if (cell.poi === 'event') { cell.poi = null; return { type: 'event' }; }
  if (cell.poi === 'exit') return { type: 'exit' };
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
  const docile = pack.stance === 'docile' || pack.huntRange === 0;
  const sees = !docile && chebyshev(pack, player) <= (pack.huntRange || OW.VISION + 1);
  if (sees) pack.hunting = 4;
  else if (pack.hunting > 0) pack.hunting -= 1;

  const moves = movesFor(world, pack.file, pack.rank, pack.roam, {
    capturePlayer: !docile,
    selfPack: pack,
  });
  if (!moves.length) return null;

  const ontoPlayer = moves.find((m) => m.file === player.file && m.rank === player.rank);
  if (ontoPlayer && !docile && (sees || pack.hunting > 0)) return ontoPlayer;

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

  const away = moves.filter((m) => !(m.file === player.file && m.rank === player.rank));
  if (docile) return pick(world.rng, away) || null;
  return pick(world.rng, away) || pick(world.rng, moves);
}

export function stepEnemies(world) {
  const events = [];
  for (const pack of world.packs) {
    if (pack.dead) continue;
    if (pack.rank <= world.decayRank) { pack.dead = true; continue; }
    const dest = chaseOrWander(world, pack);
    if (!dest) continue;
    const hitPlayer = dest.file === world.player.file && dest.rank === world.player.rank;
    if (hitPlayer && pack.stance === 'docile') continue;
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
export function movePlayer(world, file, rank, opts = {}) {
  const legal = playerMoves(world);
  if (!legal.some((m) => m.file === file && m.rank === rank)) {
    return { ok: false, reason: 'illegal' };
  }
  const pack = world.packs.find((p) => !p.dead && p.file === file && p.rank === rank);
  world.player.file = file;
  world.player.rank = rank;
  world.turns += 1;
  if (world.scene !== 'town') {
    world.furthestRank = Math.max(world.furthestRank || 0, world.player.rank);
  }
  revealAround(world, file, rank, world.scene === 'town' ? 16 : OW.VISION);

  if (pack) {
    if (pack.stance === 'docile' && !opts.fight) {
      return { ok: true, event: { type: 'meet', pack } };
    }
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

const TOWN_NAMES = {
  wood: ['Ashford', 'Millcross', 'The Lower March', 'Palisade'],
  frost: ['Rimewell', 'Hoar Hamlet', 'Whitegate'],
  peak: ['Cinderrow', 'The Brand', 'Emberstow'],
  gate: ['Bannerhold', 'The March'],
};

function placeTown(world, rng, pred, biomeHint) {
  const spots = emptyFloor(world, pred);
  if (!spots.length) return null;
  const s = pick(rng, spots);
  const biome = biomeHint || s.cell.biome || 'wood';
  s.cell.poi = 'village';
  s.cell.terrain = TERRAIN.FORT;
  s.cell.townName = pick(rng, TOWN_NAMES[biome] || TOWN_NAMES.wood);
  s.cell.townSeed = (rng() * 0xFFFFFFFF) >>> 0;
  return s;
}

function makeQuest(rng, npcId, act) {
  const kind = pick(rng, ['scout', 'bounty', 'tribute']);
  if (kind === 'scout') {
    return {
      id: `${npcId}-scout`, npcId, kind, status: 'offer',
      title: 'Walk the north',
      detail: 'Come back when you have seen further up the road.',
      needRank: 12 + act * 4,
      reward: { gold: 4 + act, map: true },
    };
  }
  if (kind === 'bounty') {
    return {
      id: `${npcId}-bounty`, npcId, kind, status: 'offer',
      title: 'Scatter a band',
      detail: 'Put down one hostile company and return.',
      needKills: 1,
      reward: { gold: 5 + act, piece: pick(rng, ['n', 'f', 'w']) },
    };
  }
  return {
    id: `${npcId}-tribute`, npcId, kind, status: 'offer',
    title: 'A mouth to feed',
    detail: 'Leave a pawn with me. I will make it worth your while.',
    reward: { gold: 4, map: true },
  };
}

/** Fisher-Yates against the town's own rng, so a shuffle replays the same for a given seed. */
function shuffled(rng, list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * A small plaza you walk. The people are pieces: a merchant, a courier
 * who sells map scraps, an inn, and one or two with work for you. Every
 * visit reshuffles which stalls stand and where each of them sets up, so
 * two villages of the same biome don't read as the same square.
 */
export function generateTown(rng, biome, act, name, leader = 'k') {
  const files = 9;
  const ranks = 7;
  const cells = [];
  for (let r = 0; r < ranks; r++) {
    const row = [];
    for (let f = 0; f < files; f++) {
      const edge = r === ranks - 1 || f === 0 || f === files - 1;
      const southGate = r === 0 && f >= 3 && f <= 5;
      row.push({
        terrain: southGate ? TERRAIN.FLOOR : (edge ? TERRAIN.WALL : TERRAIN.FLOOR),
        biome,
        poi: southGate ? 'exit' : null,
        loot: null,
      });
    }
    cells.push(row);
  }
  // A handful of stalls as short walls, leaving a plaza — which ones stand
  // (and where the walkable floor around them falls) varies by seed.
  const stallPool = [[2, 4], [6, 4], [1, 2], [7, 2], [2, 2], [6, 2], [1, 4], [7, 4]];
  const stalls = shuffled(rng, stallPool).slice(0, 3 + Math.floor(rng() * 3));
  for (const [f, r] of stalls) {
    if (cells[r]?.[f]) cells[r][f].terrain = TERRAIN.WALL;
  }

  // Interior floor not spoken for by a stall, the gate, or the spawn square —
  // the pool every NPC draws a seat from.
  const stallSet = new Set(stalls.map(([f, r]) => `${f},${r}`));
  const seats = [];
  for (let r = 1; r <= ranks - 2; r++) {
    for (let f = 1; f <= files - 2; f++) {
      if (stallSet.has(`${f},${r}`)) continue;
      if (f === 4 && r === 1) continue; // the player's own doorstep
      seats.push([f, r]);
    }
  }
  const drawn = shuffled(rng, seats);
  const seatFor = (i) => drawn[i % drawn.length] || [4, 3 + (i % 2)];

  const npcs = [
    {
      id: 'inn', role: 'inn', type: 'guard', file: seatFor(0)[0], rank: seatFor(0)[1],
      title: 'Inn',
      name: biome === 'frost' ? 'A Hoarfrost Host' : biome === 'peak' ? 'A Cinder Host' : 'The March Host',
      blurb: 'A bed and a bowl. The road will still be there in the morning.',
    },
    {
      id: 'merchant', role: 'merchant', type: 'w', file: seatFor(1)[0], rank: seatFor(1)[1],
      title: 'Merchant',
      name: 'The Stall',
      blurb: 'Steel, bone, and the odd fairy. Gold talks.',
    },
    {
      id: 'cartographer', role: 'cartographer', type: 'courier', file: seatFor(2)[0], rank: seatFor(2)[1],
      title: 'Maps',
      name: 'The Courier',
      blurb: 'Fragments of the road north. Four gold a scrap.',
    },
    {
      id: 'quest-a', role: 'quest', type: 'banner', file: seatFor(3)[0], rank: seatFor(3)[1],
      title: 'Banner',
      name: 'The Banner',
      blurb: 'They have work, if you have a king to spend.',
    },
  ];
  if (rng() < 0.7) {
    npcs.push({
      id: 'quest-b', role: 'quest', type: 'f', file: seatFor(4)[0], rank: seatFor(4)[1],
      title: 'Priest',
      name: 'The Ferz',
      blurb: 'A quieter kind of errand.',
    });
  }
  for (const npc of npcs) {
    if (npc.role === 'quest') npc.quest = makeQuest(rng, npc.id, act);
  }

  const explored = new Set();
  const visible = new Set();
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) {
      const k = key(f, r);
      explored.add(k);
      visible.add(k);
    }
  }
  return {
    scene: 'town',
    name: name || pick(rng, TOWN_NAMES[biome] || TOWN_NAMES.wood),
    biome,
    files,
    ranks,
    act,
    rng,
    cells,
    packs: [],
    npcs,
    player: { file: 4, rank: 1, leader },
    explored,
    visible,
    decayRank: -1,
    turns: 0,
    grace: 9999,
    rested: false,
  };
}

/** Paint a handful of unexplored floors onto the overworld as "seen". */
export function revealMapFragment(world, rng, count = 18) {
  const candidates = [];
  for (let r = 0; r < world.ranks; r++) {
    for (let f = 0; f < world.files; f++) {
      if (world.explored.has(key(f, r))) continue;
      if (!WALKABLE.has(world.cells[r][f].terrain) && world.cells[r][f].poi == null) continue;
      candidates.push({ f, r });
    }
  }
  let n = 0;
  while (candidates.length && n < count) {
    const i = Math.floor(rng() * candidates.length);
    const [c] = candidates.splice(i, 1);
    world.explored.add(key(c.f, c.r));
    n++;
  }
  return n;
}

export function questProgress(run, quest) {
  if (!quest || quest.status === 'done') return { ready: false };
  if (quest.kind === 'scout') {
    const have = run.voyage?.furthestRank || 0;
    return { ready: have >= quest.needRank, have, need: quest.needRank };
  }
  if (quest.kind === 'bounty') {
    const have = run.packsKilled || 0;
    const need = quest.needKills || 1;
    return { ready: have >= need, have, need };
  }
  if (quest.kind === 'tribute') {
    return { ready: (run.bag || []).some((p) => p.type === 'p') };
  }
  return { ready: false };
}

function squareNameOn(file, rank1) {
  return `${String.fromCharCode(97 + file)}${rank1}`;
}

/**
 * Guarantee two adjacent files a pawn can walk from the home rank to the
 * north. `block` and `fire` both stop a pawn; frost only costs a turn.
 */
function openPawnCrossing(terrain, files, ranks) {
  let best = [Math.max(0, Math.floor(files / 2) - 1), Math.min(files - 1, Math.floor(files / 2))];
  let bestScore = -1;
  for (let f = 0; f < files - 1; f++) {
    let score = 0;
    for (let n = 1; n <= ranks; n++) {
      for (const file of [f, f + 1]) {
        const tile = terrain[squareNameOn(file, n)];
        if (tile !== 'block' && tile !== 'fire') score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = [f, f + 1];
    }
  }
  for (const f of best) {
    for (let n = 1; n <= ranks; n++) {
      const name = squareNameOn(f, n);
      if (terrain[name] === 'block' || terrain[name] === 'fire') delete terrain[name];
    }
  }
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

  // Overworld walls and chasms copy onto the fight. A one-file jog or a hole
  // two squares wide is fine for a knight and death for the starting army
  // (king and three pawns), who cannot jump. Open two neighbouring files so
  // a pawn can walk north and a king can step around a freeze.
  openPawnCrossing(terrain, files, ranks);

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
    // Embark is already a hard enough road. The escort-soak that stops a
    // first-ply king capture on the Old Road stays there; here the king dies
    // if you can reach it.
    rules: { royalGuard: false },
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
