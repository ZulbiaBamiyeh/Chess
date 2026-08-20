// Chess-Vania overworld: a tall branching board, fog of war, roaming packs,
// shops, villages, and a creeping decay that eats the south. Gold and pieces
// come from winning fights, not from picking things up off the map.
// Pure logic. voyage.js paints it; campaign.js still runs the fights.

import { pieceById } from './pieces.js';

export const OW = {
  FILES: 27,
  VISION: 3,
  GRACE: 24,
  DECAY_EVERY: 3,
  DECAY_HP: 3,
  // How far sideways the danger curve keeps rising before it caps — a
  // Wilderness-style "wander off the road and it gets worse" reach.
  WANDER_REACH: 11,
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

const DEFAULT_BIOME_ORDER = ['wood', 'frost', 'peak', 'gate'];

/**
 * The south is always the standard, easy opening — a glade, not a biome
 * gimmick — and the gate is always what the boss holds at the top. What
 * fills the two bands between them is shuffled per run, so the first real
 * biome you meet isn't always frost.
 */
export function pickBiomeOrder(rng) {
  const middle = rng() < 0.5 ? ['frost', 'peak'] : ['peak', 'frost'];
  return ['wood', ...middle, 'gate'];
}

export function biomeAt(rank, ranks, order = DEFAULT_BIOME_ORDER) {
  const t = rank / Math.max(1, ranks - 1);
  if (t < 0.24) return order[0];
  if (t < 0.52) return order[1];
  if (t < 0.78) return order[2];
  return order[3];
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
      const biome = biomeAt(rank + dr, world.ranks, world.biomeOrder);
      cell.terrain = biome === 'frost' ? TERRAIN.FROST
        : biome === 'peak' && world.rng() < 0.12 ? TERRAIN.EMBER
        : TERRAIN.FLOOR;
      cell.biome = biome;
    }
  }
}

function paintBiomeFloors(world) {
  for (let r = 0; r < world.ranks; r++) {
    const biome = biomeAt(r, world.ranks, world.biomeOrder);
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

function pickArchetype(biome, tier, danger, rng) {
  if (tier === 'boss') {
    if (biome === 'frost') return 'frost';
    if (biome === 'peak') return 'pyre';
    return 'gate';
  }
  if (danger < 0.55 && rng() < 0.14) return 'caravan';
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

/**
 * How far off the spine a square sits, 0 (on it) to 1 (as far as the
 * Wilderness reach goes). The spine is recorded per rank during generation.
 */
function wanderOf(world, file, rank) {
  const sx = world.spine?.[rank];
  if (sx == null) return 0;
  const reach = Math.max(4, OW.WANDER_REACH);
  return Math.min(1, Math.abs(file - sx) / reach);
}

/**
 * The real danger of a square: mostly how far north you've climbed, plus —
 * Wilderness-style — how far you've strayed from the road, once you're not
 * brand new to the act. Straying near the spawn glade stays exactly as safe
 * as standing on the spine; straying deep in gets properly dangerous.
 */
export function combinedDanger(world, file, rank) {
  const rankT = rank / Math.max(1, world.ranks - 1);
  const wander = wanderOf(world, file, rank);
  const wanderWeight = Math.max(0, Math.min(1, (rankT - 0.4) / 0.3));
  return Math.min(1, rankT + wander * 0.6 * wanderWeight);
}

/** True when every already-placed pack sits at least `min` squares away. */
function spacedOut(world, file, rank, min) {
  for (const p of world.packs) {
    if (chebyshev(p, { file, rank }) < min) return false;
  }
  return true;
}

function packPower(world, file, rank, act, rng) {
  const t = combinedDanger(world, file, rank);
  // Until well up the board (or well off the road), they field what you
  // field: two or three pawns.
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

// Named individuals for the fights that should feel like a fight against
// someone, not a fight against a faction — every archetype that can come
// up as a boss or an elite gets its own small cast, so meeting one reads as
// a character and not just a bigger number.
const BOSS_PERSONAS = {
  frost: [
    { name: 'The White Widow',
      blurb: 'She has not been warm since the winter that made her. Everything she touches keeps that promise.' },
    { name: 'Hoarking Vael',
      blurb: 'Crowned in real ice, not glass. He remembers every army that tried to outlast the cold, and did not.' },
  ],
  pyre: [
    { name: 'The Cinder Marshal',
      blurb: 'What the fires left of him still gives orders. What is left of you is not his concern.' },
    { name: 'Ashwrought Dyre',
      blurb: 'He burned his own supply lines once, to make a point. Nobody has needed the reminder since.' },
  ],
  gate: [
    { name: 'Warden Kessel',
      blurb: 'The last thing between you and the next act. He has held this ramp longer than you have been alive.' },
    { name: 'The Last Herald',
      blurb: 'Every king who tried this road left a banner here. He collects them. He is running out of room.' },
  ],
};

const ELITE_PERSONAS = {
  frost: [
    { name: 'Captain Rilka Snowbone', blurb: 'She trained on the passes nobody else survives crossing.' },
    { name: 'The Frost Sergeant', blurb: 'Gives one order, twice: hold, and then hold longer.' },
  ],
  pyre: [
    { name: 'The Ember Captain', blurb: 'Walks through her own fires to prove they will not slow her down.' },
    { name: 'Sarrow Brandwake', blurb: 'Lost an eye to a duel he still insists he won.' },
  ],
  court: [
    { name: "The Prince's Second", blurb: 'Here on behalf of someone who could not be bothered to come himself.' },
    { name: 'Dame Ostellan', blurb: 'Knighted for a battle nobody else remembers her winning.' },
  ],
  tower: [
    { name: 'The Siege Warden', blurb: 'Moves like the fortress she used to command: slow, and not actually stoppable.' },
    { name: 'Old Marrow', blurb: 'Has outlived four commanding officers, and every reason to retire.' },
  ],
  horde: [
    { name: 'Khan Ozgul', blurb: 'Rides at the front, because nobody else in his host is fast enough to stop him first.' },
    { name: 'The Tribute Rider', blurb: 'Collects what the road owes. The road, in her accounting, owes quite a lot.' },
  ],
  thieves: [
    { name: 'Six-Finger Sal', blurb: 'Miscounted once, badly. The name stuck.' },
    { name: 'The Quiet Cutter', blurb: 'You will not hear her coming. That is rather the point.' },
  ],
  skull: [
    { name: 'The Bonecollector', blurb: 'Keeps trophies. Is not subtle about wanting yours.' },
    { name: 'Grael Hollow-Eyed', blurb: 'Sits on the best loot in the wild because nobody has taken it from him yet.' },
  ],
};

/** A named boss or elite, when the archetype has a cast for it — else the plain faction name. */
function packPersona(arch, tier, rng) {
  const pool = tier === 'boss' ? BOSS_PERSONAS[arch] : tier === 'elite' ? ELITE_PERSONAS[arch] : null;
  return pool ? pick(rng, pool) : null;
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
  const danger = combinedDanger(world, file, rank);
  const arch = opts.arch || pickArchetype(biome, tier, danger, world.rng);
  const spec = ARCHETYPES[arch] || ARCHETYPES.levy;
  const stance = spec.stance || 'hostile';
  const persona = packPersona(arch, tier, world.rng);
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
    name: persona?.name || packName(spec, tier, world.rng),
    blurb: persona?.blurb || spec.blurb || '',
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
 * A tall strip with a northward spine, branching side alleys, and the
 * occasional dead end. Rank 0 is south (the start); high ranks are north
 * (the ramp).
 */
export function generateWorld(rng, act = 1) {
  const files = OW.FILES;
  const ranks = 32 + act * 6;
  const biomeOrder = pickBiomeOrder(rng);
  const cells = [];
  for (let r = 0; r < ranks; r++) {
    const row = [];
    for (let f = 0; f < files; f++) {
      row.push({
        terrain: TERRAIN.WALL,
        biome: biomeAt(r, ranks, biomeOrder),
        poi: null,
      });
    }
    cells.push(row);
  }
  const world = {
    files,
    ranks,
    act,
    rng,
    biomeOrder,
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
  for (let y = 0; y < ranks; y++) {
    if (rng() < 0.42) x += rng() < 0.5 ? -1 : 1;
    x = Math.max(2, Math.min(files - 3, x));
    spine[y] = x;
    // A wider south so the opening is a glade, not a one-file trench.
    const wide = y > ranks - 9 ? 0 : (y < 12 ? 1 : (rng() < 0.5 ? 1 : 0));
    carve(world, x, y, wide);
  }
  // Danger and pack placement key off distance from the spine, so it has to
  // exist on the world before anything downstream of it runs.
  world.spine = spine;

  // Short dead-end alleys, one tile wide, just off the spine — nothing but
  // a wandering "?" waits at the end of one.
  const alleys = [];
  for (let y = 5; y < ranks - 8; y++) {
    if (rng() >= 0.22) continue;
    const dir = rng() < 0.5 ? -1 : 1;
    const len = 2 + Math.floor(rng() * 3);
    let bx = spine[y] ?? x;
    const by = y;
    for (let i = 0; i < len; i++) {
      bx += dir;
      if (bx < 1 || bx > files - 2) break;
      carve(world, bx, by, 0);
    }
    alleys.push({ file: bx, rank: by });
  }

  // A wide wilderness either side of the spine, not just the road itself —
  // open near the spine and thinning out with distance, so wandering off
  // to either side is a real, walkable choice rather than a wall. The
  // pinch near the ramp (below) still closes this back to a single file,
  // so straying wide never finds a way around the gate.
  for (let y = 0; y < ranks; y++) {
    const sx = spine[y];
    for (let d = 1; d <= OW.WANDER_REACH; d++) {
      const fall = 1 - d / (OW.WANDER_REACH + 1);
      for (const dir of [-1, 1]) {
        const fx = sx + dir * d;
        if (fx < 1 || fx > files - 2) continue;
        if (rng() < fall * 0.7) carve(world, fx, y, 0);
      }
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
  const signSpots = emptyFloor(world, (_c, _f, r) => r >= 4 && r <= 12);
  if (signSpots.length) {
    pick(rng, signSpots).cell.poi = 'sign';
  }

  // Wandering "?" events live down the alleys, not out in the open — a
  // hidden side room you have to actually go looking for.
  const alleySpots = shuffled(rng, alleys)
    .map(({ file, rank }) => ({ file, rank, cell: cellAt(world, file, rank) }))
    .filter(({ cell }) => cell && WALKABLE.has(cell.terrain) && !cell.poi);
  const targetEvents = 4 + Math.floor(rng() * 3);
  let placedEvents = Math.min(alleySpots.length, targetEvents);
  for (let i = 0; i < placedEvents; i++) {
    alleySpots[i].cell.poi = 'event';
  }
  // Too few alleys formed to seat every event — top up from any open floor
  // still off the main road rather than leave the act short.
  if (placedEvents < 4) {
    const backup = emptyFloor(world, (_c, f, r) => r >= 5 && r <= ranks - 8
      && Math.abs(f - (spine[r] ?? x)) >= 2);
    for (const s of shuffled(rng, backup)) {
      if (placedEvents >= 4) break;
      s.cell.poi = 'event';
      placedEvents++;
    }
  }

  // Packs read as a crowd once two of them stand near enough to see each
  // other; every placement pass from here on keeps this much room between
  // any two, so the road reads as a wilderness rather than a mob.
  const MIN_PACK_SPACING = 4;

  // Patrols, spread across the width rather than lined up on the spine —
  // clumped packs read as a crowd; spaced ones read as a wilderness you
  // actually have to watch for. Each checkpoint tries a handful of squares
  // near that rank, at varying distance from the road, and skips any that
  // would land too close to a pack already placed.
  const used = new Set(world.packs.map((p) => key(p.file, p.rank)));
  // Never in the last 8 ranks — that stretch is pinched to a single file for
  // the boss gate below, where "spread out" has no room to mean anything and
  // a patrol would just crowd the boss guarding it.
  const patrolRanks = [10, 13, 16, 19, 22, 25, 28, ranks - 13, ranks - 10].filter((y) => y < ranks - 8);
  for (const ry of patrolRanks) {
    const y = Math.max(9, Math.min(ranks - 9, ry + (rng() < 0.5 ? 0 : 1)));
    if (chebyshev({ file: spine[y] ?? x, rank: y }, world.player) < 8) continue;
    let placed = false;
    for (let attempt = 0; attempt < 7 && !placed; attempt++) {
      const spread = attempt === 0 ? 0 : Math.floor(rng() * (OW.WANDER_REACH * 2 + 1)) - OW.WANDER_REACH;
      const f = Math.max(1, Math.min(files - 2, (spine[y] ?? x) + spread));
      if (used.has(key(f, y))) continue;
      if (!isWalkable(world, f, y)) continue;
      if (!spacedOut(world, f, y, MIN_PACK_SPACING)) continue;
      const t = combinedDanger(world, f, y);
      const power = packPower(world, f, y, act, rng);
      const tier = t > 0.82 ? 'elite' : t > 0.62 ? 'elite' : 'trash';
      if (placePack(world, f, y, power, tier)) {
        used.add(key(f, y));
        placed = true;
      }
    }
  }

  // Gate boss on the ramp. You do not stroll off Act 1. Their lair is
  // revealed from the start — not fogged like the rest of the act — so
  // there is always a landmark to navigate toward, the way the Wilderness
  // ditch tells you which way is north.
  placePack(world, rampFile, ranks - 2, 18 + act * 6, 'boss', { arch: 'gate' });
  world.bossSpot = { file: rampFile, rank: ranks - 2 };
  revealAround(world, rampFile, ranks - 2, 3);

  // Fill any thin maps so the road is never empty — still spread out, still
  // spaced from whatever is already standing.
  let extra = 0;
  for (let y = 12; y < ranks - 8 && world.packs.length < 14 && extra < 8; y += 3) {
    const spread = Math.floor(rng() * (OW.WANDER_REACH * 2 + 1)) - OW.WANDER_REACH;
    const f = Math.max(1, Math.min(files - 2, (spine[y] ?? x) + spread));
    if (used.has(key(f, y))) continue;
    if (chebyshev({ file: f, rank: y }, world.player) < 5) continue;
    if (!isWalkable(world, f, y) || !spacedOut(world, f, y, MIN_PACK_SPACING)) continue;
    const placed = placePack(world, f, y, packPower(world, f, y, act, rng), y / ranks > 0.62 ? 'elite' : 'trash');
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
  if (cell.poi === 'sign') return { type: 'sign', spent: Boolean(cell.spent) };
  if (cell.poi === 'event') { cell.poi = null; return { type: 'event' }; }
  if (cell.poi === 'exit') return { type: 'exit' };
  if (cell.poi === 'ramp') return { type: 'ramp' };
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

  // Every pack moves one square at a time, same as the leader — a knight-
  // or rook-shaped roam pattern let some archetypes close distance in a
  // single tick a player never could, which read as unfair rather than
  // characterful.
  const moves = movesFor(world, pack.file, pack.rank, 'k', {
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
/**
 * A map fragment shows one connected patch of ground around a random spot,
 * not a scatter of unrelated tiles across the whole act — flood outward
 * from a single anchor (through walls too, as stepping stones, so the
 * patch grows as a compact block instead of snaking down whatever floor
 * happens to be there) and reveal candidate tiles as the flood reaches them.
 */
export function revealMapFragment(world, rng, count = 18) {
  const isCandidate = (f, r) => {
    if (world.explored.has(key(f, r))) return false;
    const cell = world.cells[r]?.[f];
    if (!cell) return false;
    return WALKABLE.has(cell.terrain) || cell.poi != null;
  };
  const candidates = [];
  for (let r = 0; r < world.ranks; r++) {
    for (let f = 0; f < world.files; f++) {
      if (isCandidate(f, r)) candidates.push({ f, r });
    }
  }
  if (!candidates.length) return 0;
  const anchor = candidates[Math.floor(rng() * candidates.length)];

  const seen = new Set([key(anchor.f, anchor.r)]);
  const queue = [anchor];
  let qi = 0;
  let n = 0;
  while (qi < queue.length && n < count) {
    const { f, r } = queue[qi++];
    if (isCandidate(f, r)) {
      world.explored.add(key(f, r));
      n++;
    }
    const neighbors = [[f + 1, r], [f - 1, r], [f, r + 1], [f, r - 1]];
    if (rng() < 0.5) neighbors.reverse();
    for (const [nf, nr] of neighbors) {
      if (nf < 0 || nr < 0 || nf >= world.files || nr >= world.ranks) continue;
      const k = key(nf, nr);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ f: nf, r: nr });
    }
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
 * BFS from the player's whole home rank across every non-blocked square; if
 * `target` isn't reached, cut a straight orthogonal path in from whichever
 * reached square sits nearest it, clearing blocks along the way. Guarantees
 * some piece can always walk to `target` before a single move is made.
 */
function ensureSquareReachable(terrain, files, ranks, target) {
  const passable = (name) => terrain[name] !== 'block';
  const seen = new Set();
  const queue = [];
  for (let f = 0; f < files; f++) {
    const name = squareNameOn(f, 1);
    if (passable(name)) { seen.add(name); queue.push({ f, r: 1 }); }
  }
  let qi = 0;
  while (qi < queue.length) {
    const { f, r } = queue[qi++];
    for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nf = f + df;
      const nr = r + dr;
      if (nf < 0 || nf >= files || nr < 1 || nr > ranks) continue;
      const name = squareNameOn(nf, nr);
      if (seen.has(name) || !passable(name)) continue;
      seen.add(name);
      queue.push({ f: nf, r: nr });
    }
  }
  if (seen.has(target)) return;

  const kf = target.charCodeAt(0) - 97;
  const kr = parseInt(target.slice(1), 10);
  let best = null;
  let bestDist = Infinity;
  for (const name of seen) {
    const f = name.charCodeAt(0) - 97;
    const r = parseInt(name.slice(1), 10);
    const d = Math.abs(f - kf) + Math.abs(r - kr);
    if (d < bestDist) { bestDist = d; best = { f, r }; }
  }
  if (!best) return;
  let { f, r } = best;
  while (f !== kf) {
    f += f < kf ? 1 : -1;
    delete terrain[squareNameOn(f, r)];
  }
  while (r !== kr) {
    r += r < kr ? 1 : -1;
    delete terrain[squareNameOn(f, r)];
  }
}

// Missing squares are a biome trait, not the default shape of a fight — a
// clean board (with a fort tile here or there) is the norm, the way a 6×6
// board with nothing missing reads best. Mountains and the ruined approach
// to a gate are jagged enough that holes belong there; woods and ice are not.
const HOLE_BIOMES = new Set(['peak', 'gate']);

/**
 * Build a fight encounter from the overworld tile the clash happened on.
 * Holes, frost and fire are reserved for boss fights — they can strand a
 * king or block a promotion in ways the player didn't cause, which is only
 * fair when the fight is already a set-piece the player knows is a boss.
 */
export function clashEncounter(world, pack, run, aggressor) {
  const files = Math.min(8, 6 + Math.min(2, world.act - 1));
  const ranks = Math.min(8, 6 + Math.min(2, world.act - 1));
  const originFile = world.player.file - Math.floor(files / 2);
  const originRank = world.player.rank - Math.floor(ranks / 2);
  const hazardsOn = pack.tier === 'boss';
  const holes = hazardsOn && HOLE_BIOMES.has(pack.biome);
  const terrain = {};
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) {
      const owF = originFile + f;
      const owR = originRank + r;
      const cell = cellAt(world, owF, owR);
      const combatName = `${String.fromCharCode(97 + f)}${r + 1}`;
      if (!cell || owR <= world.decayRank
        || (holes && (cell.terrain === TERRAIN.WALL || cell.terrain === TERRAIN.CHASM))) {
        terrain[combatName] = 'block';
      } else if (hazardsOn && cell.terrain === TERRAIN.FROST) {
        terrain[combatName] = 'frost';
      } else if (hazardsOn && cell.terrain === TERRAIN.EMBER) {
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
  // The pawn lane above guarantees a route up the board somewhere — not
  // necessarily to wherever the king in particular landed. A king boxed in
  // by holes with no piece able to reach it is a fight that was lost before
  // the first move; carve it a way in rather than let that happen.
  if (enemy[0]?.type === 'k') ensureSquareReachable(terrain, files, ranks, enemy[0].at);

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
