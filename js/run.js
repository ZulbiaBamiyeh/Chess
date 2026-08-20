// A single run: bag, slots, supply, HP, map, shop and fight settlement.
// Nothing here touches the DOM. campaign.js drives the screens.

import { WHITE, BLACK, Chess, ST_SHIELD, ST_FROZEN, FLAG, TILE, parseSquare } from './chess.js';
import { PIECES, SLOT_CAPS, pieceCost, rarityOf, RARITY } from './pieces.js';
import { relicTotals, discountedCost, hasTag, relicPool } from './relics.js';
import {
  LOSS_HP, FORFEIT_HP, UNDO_HP, FIGHT_GOLD, REST_HEAL,
  START_HP, START_GOLD, STARTING_BAG, KING_PASSIVES, REST_GOLD,
  FORAGE_GOLD, TRAIN_COST,
  TURN_CLOCK, THEME_DROPS, DROP_CHANCE,
  generateMap, findNode, encounterFor, firstRooms, freeHomeSquares, homeSquares,
  weightedPiece,
} from './content.js';

let nextUid = 1;
const uid = () => `p${nextUid++}`;

function debitGold(run, amount) {
  const n = Math.max(0, Number(amount) || 0);
  if (!n) return 0;
  const paid = Math.min(run.gold, n);
  run.gold -= paid;
  run.goldSpent = (run.goldSpent || 0) + paid;
  return paid;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function createVoyageRun(seed = (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0) {
  const run = createRun(seed);
  run.bag = ['p', 'p', 'p'].map((type) => ({ uid: uid(), type }));
  run.gold = 2;
  run.world = 'voyage';
  run.quests = [];
  run.packsKilled = 0;
  return run;
}

export function createRun(seed = (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0) {
  nextUid = 1;
  const rng = mulberry32(seed);
  const map = generateMap(rng);
  const opening = firstRooms(map.acts[0]);
  const run = {
    seed,
    rng,
    hp: START_HP,
    hpMax: START_HP,
    gold: START_GOLD,
    bag: STARTING_BAG.map((type) => ({ uid: uid(), type })),
    slots: { common: Infinity, rare: SLOT_CAPS.rare, epic: SLOT_CAPS.epic, legendary: SLOT_CAPS.legendary },
    supplyBonus: 0,
    deployBonus: 0,
    supplyBought: 0,
    king: null,
    kings: ['plain'],
    map,
    act: 0,
    nodeId: null,
    choices: opening.slice(),
    cleared: new Set(),
    trail: [],
    deployed: [],
    lastReward: null,
    shop: null,
    relics: [],
    pendingRelics: [],
    secondWindUsed: false,
    over: false,
    won: false,
    goldSpent: 0,
    captured: [],
    formation: null,
  };
  ensureFormation(run);
  return run;
}

export function currentNode(run) {
  if (run.over) return null;
  return findNode(run.map, run.nodeId);
}

export function currentEncounter(run) {
  return encounterFor(currentNode(run));
}

export function currentAct(run) {
  return (currentNode(run)?.act) || run.act + 1;
}

export function occupiedSlots(run) {
  const used = { common: 0, rare: 0, epic: 0, legendary: 0 };
  for (const item of run.bag) {
    const r = rarityOf(item.type);
    if (used[r] != null) used[r]++;
  }
  return used;
}

export function hasSlot(run, type) {
  const r = rarityOf(type);
  if (r === RARITY.UNIQUE || r === RARITY.COMMON) return true;
  const used = occupiedSlots(run);
  return used[r] < (run.slots[r] || 0);
}

export function ownedKingIds(run) {
  const ids = run.kings ? run.kings.slice() : [];
  if (!ids.includes('plain')) ids.unshift('plain');
  if (run.king && !ids.includes(run.king)) ids.push(run.king);
  return ids;
}

export function equippedKingId(run) {
  return run.king || 'plain';
}

export function equipKing(run, id) {
  const want = id || 'plain';
  if (!ownedKingIds(run).includes(want)) return false;
  run.king = want === 'plain' ? null : want;
  if (!run.kings) run.kings = ownedKingIds(run);
  return true;
}

const RARITY_ORDER = { common: 0, rare: 1, epic: 2, legendary: 3, unique: 4 };

/** Stacked bag for the inventory panel: counts, kings, slots. */
export function bagSummary(run) {
  const tallies = new Map();
  for (const item of run.bag) {
    const row = tallies.get(item.type) || { type: item.type, count: 0, trained: 0 };
    row.count += 1;
    if (item.trained) row.trained += 1;
    tallies.set(item.type, row);
  }
  const pieces = [...tallies.values()].sort((a, b) => {
    const da = PIECES[a.type];
    const db = PIECES[b.type];
    const ra = RARITY_ORDER[da?.rarity] ?? 9;
    const rb = RARITY_ORDER[db?.rarity] ?? 9;
    if (ra !== rb) return ra - rb;
    return (da?.cost ?? 0) - (db?.cost ?? 0) || (da?.name || '').localeCompare(db?.name || '');
  });
  return {
    pieces,
    kings: ownedKingIds(run),
    equipped: equippedKingId(run),
    slots: occupiedSlots(run),
    supply: run.supplyBonus,
  };
}

export function addToBag(run, type) {
  if (!PIECES[type] || !hasSlot(run, type)) return null;
  const item = { uid: uid(), type };
  run.bag.push(item);
  return item;
}

export function removeFromBag(run, itemUid) {
  const i = run.bag.findIndex((p) => p.uid === itemUid);
  if (i < 0) return null;
  const gone = run.bag.splice(i, 1)[0];
  pruneFormation(run);
  return gone;
}

export function supplyBudget(run, encounter) {
  const relics = relicTotals(run.relics);
  return Math.max(1, (encounter.supply || 0) + run.supplyBonus + relics.supply);
}

/** A piece's supply cost for THIS run, after relic discounts. */
export function costFor(run, type) {
  return discountedCost(run.relics, type);
}

/**
 * How many pieces you may field, king aside.
 *
 * Supply alone was not enough of a constraint. Points cap what your army is
 * WORTH, but a king-capture fight is won by bodies: enough of them to screen
 * your own king and to swarm theirs. With only a supply cap the cheapest body
 * always won — measured over AI duels, an eight-pawn army beat every single
 * piece in the registry, and the win rate curve ran strictly backwards, with
 * cheap pieces beating expensive ones.
 *
 * A deploy cap is the orthogonal lever: supply limits quality, deploy limits
 * quantity, and the two together make "a few good pieces" and "a cheap horde"
 * both viable instead of the horde dominating. It flattened the measured
 * spread from 6%-100% down to 34%-66%.
 */
export function deployBudget(run, encounter) {
  const supply = encounter.supply || 0;
  // Roughly three fifths of supply, so a pure horde cannot spend it all on
  // bodies and always has points spare to put into something better.
  const base = encounter.deploy ?? Math.max(2, Math.ceil(supply * 0.6));
  return Math.max(1, base + (run.deployBonus || 0) + relicTotals(run.relics).deploy);
}

export function loadoutCost(items, run = null) {
  return items.reduce(
    (sum, item) => sum + (run ? discountedCost(run.relics, item.type) : pieceCost(item.type)), 0);
}

export function validateLoadout(run, encounter, selectedUids) {
  const budget = supplyBudget(run, encounter);
  const items = selectedUids.map((id) => run.bag.find((p) => p.uid === id)).filter(Boolean);
  if (items.length !== selectedUids.length) {
    return { ok: false, reason: 'A selected piece is not in your bag.', cost: 0, budget };
  }
  const homes = freeHomeSquares(encounter);
  if (items.length + 1 > homes.length) {
    return { ok: false, reason: 'Not enough home squares for that many pieces.', cost: loadoutCost(items, run), budget };
  }
  const cost = loadoutCost(items, run);
  const deploy = deployBudget(run, encounter);
  if (items.length > deploy) {
    return {
      ok: false,
      reason: `Too many pieces — ${items.length} / ${deploy}.`,
      cost, budget, deploy, count: items.length,
    };
  }
  if (cost > budget) {
    return { ok: false, reason: `Supply ${cost} / ${budget}.`, cost, budget, deploy, count: items.length };
  }
  return { ok: true, cost, budget, deploy, count: items.length };
}

export function rulesFor(run) {
  const rules = {
    checks: false,
    kingCapture: true,
    castling: false,
    royalLeaps: null,
    // Duck Chess is normally its own encounter-level rule (see the pond and
    // flock rooms); the Duck king just turns it on everywhere, for both
    // sides, the way any other duckChess room already works.
    duckChess: run.king === 'duck',
  };
  return rules;
}

export function buildFight(run, encounter, placements) {
  const terrain = [];
  if (encounter.terrain) {
    for (const [name, tile] of Object.entries(encounter.terrain)) {
      terrain.push({ sq: parseSquare(name, encounter.ranks), tile });
    }
  }

  const game = new Chess({
    fen: emptyPlacement(encounter.files, encounter.ranks),
    files: encounter.files,
    ranks: encounter.ranks,
    rules: { ...rulesFor(run), ...(encounter.rules || {}) },
    // The engine's modifier list. It began as king passives and now carries
    // relic tokens too — the generator and make-move look these up by name.
    kingPassives: [...(run.king ? [run.king] : []), ...relicTotals(run.relics).tokens],
    terrain,
    duck: encounter.duckAt,
    bossScript: encounter.bossScript || null,
  });

  for (const enemy of encounter.enemy || []) {
    const sq = parseSquare(enemy.at, encounter.ranks);
    game.board[sq] = { type: enemy.type, color: BLACK };
    if (enemy.type === 'k') game.kings.b = sq;
  }

  const deployed = [];
  for (const place of placements) {
    const item = place.uid === 'king'
      ? { uid: 'king', type: 'k' }
      : run.bag.find((p) => p.uid === place.uid);
    if (!item) continue;
    const sq = typeof place.sq === 'string' ? parseSquare(place.sq, encounter.ranks) : place.sq;
    game.board[sq] = { type: item.type, color: WHITE };
    if (item.type === 'k') game.kings.w = sq;
    // Trained pieces carry their own permanent shield into every fight, earned
    // once at camp rather than granted per-run like a relic.
    if (item.trained) game.status[sq] |= ST_SHIELD;
    deployed.push(item.uid);
  }

  // Press Gang throws in a free pawn on any spare home square, outside the cap.
  if (relicTotals(run.relics).freePawn) {
    const spare = freeHomeSquares(encounter)
      .map((sq) => (typeof sq === 'string' ? parseSquare(sq, encounter.ranks) : sq))
      .find((sq) => !game.board[sq]);
    if (spare != null) {
      game.board[spare] = { type: 'p', color: WHITE };
      deployed.push('pressgang');
    }
  }

  game.turn = encounter.firstMover === BLACK ? BLACK : WHITE;
  game.refreshMode();
  game.positionCounts = new Map();
  game.countPosition();
  applyStartStatuses(game, run);
  game.refreshMode();

  run.deployed = deployed;
  return game;
}

function emptyPlacement(files, ranks) {
  return `${new Array(ranks).fill(String(files)).join('/')} w - - 0 1`;
}

export const RELIC_SHIELD_CAP = 2;

export function applyStartStatuses(game, run) {
  // Wardens walk in already shielded, whichever side fields them, and anyone
  // already standing on a fort holds it from the first move — a fort only
  // shielded on arrival otherwise, so a garrison started the fight unguarded.
  const relics = relicTotals(run.relics);
  for (const piece of game.pieces()) {
    if (PIECES[piece.type]?.shielded) game.status[piece.square] |= ST_SHIELD;
    if (game.tileAt(piece.square) === TILE.FORT) game.status[piece.square] |= ST_SHIELD;
  }

  // Relic shields cover your own army only, and only RELIC_SHIELD_CAP pieces of
  // it. Measured over AI duels a shield is the single strongest effect in the
  // game, and the two dominant archetypes were both built on one shielding a
  // whole class of piece. Capping the count fixes every such relic at once,
  // present and future, instead of taxing each one separately.
  if (relics.shieldTags.length) {
    const eligible = game.pieces()
      .filter((p) => p.color === WHITE
        && relics.shieldTags.some((tag) => hasTag(p.type, tag)))
      .sort((a, b) => (PIECES[b.type]?.cost || 0) - (PIECES[a.type]?.cost || 0))
      .slice(0, RELIC_SHIELD_CAP);
    for (const piece of eligible) game.status[piece.square] |= ST_SHIELD;
  }

  const king = game.kings.w;
  if (king < 0) return;
  if (run.king === 'aegis') game.status[king] |= ST_SHIELD;
  if (run.king === 'hoarfrost') {
    for (const off of [-17, -16, -15, -1, 1, 15, 16, 17]) {
      const sq = king + off;
      if (!game.inBounds(sq)) continue;
      const p = game.board[sq];
      if (p && p.color === BLACK) game.markFrozen(sq);
    }
  }
  if (run.king === 'rampart') {
    for (const off of [-17, -16, -15, -1, 1, 15, 16, 17]) {
      const sq = king + off;
      if (!game.inBounds(sq)) continue;
      const p = game.board[sq];
      if (p && p.color === WHITE) game.status[sq] |= ST_SHIELD;
    }
  }
  if (run.king === 'formation') {
    for (const piece of game.pieces()) {
      if (piece.color === WHITE && piece.type === 'p') game.status[piece.square] |= ST_SHIELD;
    }
  }
  if (run.king === 'anchor') {
    let best = null;
    for (const piece of game.pieces()) {
      if (piece.color !== WHITE || piece.type === 'k') continue;
      const cost = PIECES[piece.type]?.cost || 0;
      if (!best || cost > best.cost) best = { square: piece.square, cost };
    }
    if (best) game.status[best.square] |= ST_SHIELD;
  }
  if (run.king === 'provisioner') {
    const spare = homeSquares(game.files, game.ranks)
      .find((sq) => !game.board[sq] && game.tileAt(sq) !== TILE.BLOCK);
    if (spare != null) game.board[spare] = { type: 'p', color: WHITE };
  }
}

export function remainingArmy(game, color) {
  return game.armyValue(color);
}

export function turnClock(encounter, run = null) {
  const base = encounter.clock
    || TURN_CLOCK[encounter.tier || (encounter.boss ? 'boss' : 'trash')] || 10;
  return base + (run ? relicTotals(run.relics).clock : 0);
}

export function settleFight(run, game, encounter, { forfeit = false, timeout = false, clockLeft = 0 } = {}) {
  const outcome = game.outcome();
  const won = !forfeit && !timeout && outcome.over && outcome.winner === WHITE;
  // Neither side could ever finish the other off, and the player was clearly
  // ahead — the opponent breaks and runs. It still counts as won for the
  // purposes of moving the run along, but nothing was actually earned.
  const fled = won && outcome.reason === 'opponent fled';
  const army = remainingArmy(game, WHITE);
  const maxArmy = startingArmy(run);
  const tier = encounter.tier || (encounter.boss ? 'boss' : 'trash');
  let gold = 0;
  let drop = null;
  let dropSold = 0;
  let hpLost = 0;

  const relics = relicTotals(run.relics);
  // Martyr relics pay out for pieces of yours that died, win or lose.
  const lost = Math.max(0, (run.deployed || []).length - countDeployedSurvivors(game, run));
  let martyrGold = 0;

  if (won && fled) {
    // No gold, no drop, no relic, no heal — a fight that ended because it
    // could never be finished isn't a fight that pays out.
  } else if (won) {
    gold = encounter.gold ?? FIGHT_GOLD[tier] ?? FIGHT_GOLD.trash;
    gold += relics.goldPerFight;
    martyrGold = lost * relics.goldPerLoss;
    gold += martyrGold;
    run.gold += gold;
    if (relics.healPerFight) {
      run.hp = Math.min(run.hpMax, run.hp + relics.healPerFight);
    }
    // Elites and bosses hand over a relic. This is the main way a build forms.
    if ((tier === 'elite' || tier === 'boss') && !run.pendingRelics?.length) {
      const pool = relicPool(run.relics);
      const picks = [];
      const count = Math.min(pool.length, tier === 'boss' ? 3 : 2);
      for (let i = 0; i < count; i++) {
        picks.push(pool.splice(Math.floor(run.rng() * pool.length), 1)[0]);
      }
      run.pendingRelics = picks;
    }
    drop = rollDrop(run, encounter);
    if (drop) {
      const added = addToBag(run, drop);
      if (!added) {
        dropSold = 2 + pieceCost(drop);
        run.gold += dropSold;
      }
    }
  } else {
    const kingTaken = !forfeit && !timeout
      && outcome.reason === 'king capture'
      && outcome.winner === BLACK;
    if (kingTaken) {
      // HP buys take-backs during the fight. Once the king is gone, the run is.
      hpLost = 0;
      run.over = true;
      run.won = false;
    } else {
      hpLost = Math.max(1, (forfeit
        ? (FORFEIT_HP[tier] ?? 2)
        : (LOSS_HP[tier] ?? 3)));
      run.hp -= hpLost;

      if (run.hp <= 0) {
        if (relics.secondWind && !run.secondWindUsed) {
          // Second Wind turns the first fatal forfeit/timeout into a scratch.
          // It does not revive a captured king.
          run.secondWindUsed = true;
          run.hp = 1;
          run.survived = true;
        } else {
          run.hp = 0;
          run.over = true;
          run.won = false;
        }
      }
    }
  }

  run.captured = run.captured || [];
  for (const entry of game.history || []) {
    const move = entry.move;
    if (!move || move.color !== WHITE || !move.captured) continue;
    if (move.flags & FLAG.SHIELD_BREAK && move._shieldSaved) continue;
    run.captured.push(move.captured);
  }

  run.lastReward = {
    won,
    fled,
    forfeit,
    timeout,
    reason: timeout ? 'too slow' : forfeit ? 'forfeit' : outcome.reason,
    gold,
    drop,
    dropSold,
    army,
    maxArmy,
    clockLeft,
    martyrGold,
    hpLost,
    relicChoices: run.pendingRelics || [],
    healed: won && !fled ? relics.healPerFight : 0,
    secondWind: Boolean(run.survived),
  };
  run.survived = false;
  run.deployed = [];
  return run.lastReward;
}

/** How many of the pieces you deployed are still on the board. */
function countDeployedSurvivors(game, run) {
  const alive = game.pieces().filter((p) => p.color === WHITE && p.type !== 'k').length;
  return alive;
}

const DROP_RANK = {
  [RARITY.COMMON]: 0, [RARITY.RARE]: 1, [RARITY.EPIC]: 2, [RARITY.LEGENDARY]: 3,
};

function rollDrop(run, encounter) {
  const chance = DROP_CHANCE[encounter.tier || 'trash'] ?? 0.15;
  if (run.rng() > chance) return null;
  const fromBoard = (encounter.enemy || [])
    .map((e) => e.type)
    .filter((t) => t !== 'k' && PIECES[t] && PIECES[t].rarity !== RARITY.UNIQUE);
  const theme = THEME_DROPS[encounter.theme] || [];
  let pool = fromBoard.length ? fromBoard : theme;
  if (!pool.length) return null;

  // Prefer something the bag can actually hold. A drop you have no slot for
  // is auto-sold for a handful of gold, which is the flattest possible end
  // to a fight you just won — so only fall back to it when there is nothing
  // in the room you could have kept.
  const roomFor = pool.filter((t) => hasSlot(run, t));
  if (roomFor.length) pool = roomFor;

  // The prize scales with the room. A boss hands over the best thing it
  // fielded rather than whichever pawn the roll happened to land on: it is
  // the trophy for the hardest fight in the act, and rolling a pawn out of
  // it made clearing one feel like nothing happened. Elites lean the same
  // way without committing to it.
  const tier = encounter.tier || 'trash';
  const best = () => {
    const top = Math.max(...pool.map((t) => DROP_RANK[PIECES[t].rarity] ?? 0));
    const finest = pool.filter((t) => (DROP_RANK[PIECES[t].rarity] ?? 0) === top);
    return finest[Math.floor(run.rng() * finest.length)];
  };
  if (tier === 'boss') return best();
  if (tier === 'elite' && run.rng() < 0.5) return best();
  return pool[Math.floor(run.rng() * pool.length)];
}

function startingArmy(run) {
  let total = 3;
  for (const id of run.deployed) {
    if (id === 'king') continue;
    const item = run.bag.find((p) => p.uid === id);
    if (item) total += pieceCost(item.type);
  }
  return total;
}

/** After a node is finished, expose its children — or open the next act. */
export function completeNode(run) {
  const node = currentNode(run);
  if (!node) return [];
  run.cleared.add(node.id);
  if (node.boss) {
    if (run.act < 2) {
      run.act += 1;
      const next = run.map.acts[run.act];
      run.nodeId = null;
      run.choices = firstRooms(next);
      run.trail = [];
      return run.choices.slice();
    }
    run.over = true;
    run.won = true;
    run.choices = [];
    return [];
  }
  run.choices = (node.next || []).map((id) => findNode(run.map, id)).filter(Boolean);
  return run.choices;
}

export function pickNode(run, nodeId) {
  const node = findNode(run.map, nodeId);
  if (!node) return null;
  run.nodeId = nodeId;
  run.choices = [];
  if (!run.trail.includes(nodeId)) run.trail.push(nodeId);
  return node;
}

/**
 * Camp: patch up and pocket a little coin.
 *
 * REST_HEAL had been declared and never used, so camping paid gold and healed
 * nothing. With losses now costing HP that left the economy one-directional —
 * HP only ever fell, and a long run could not survive its own difficulty curve.
 */
/**
 * What a camp is actually worth to THIS run. Exported because the camp screen
 * has to quote these numbers before you commit, and computing them a second
 * time over there is how it ended up promising 7 HP and handing over 10.
 */
export const restHeal = (run) => REST_HEAL;
export const forageGold = (run) => FORAGE_GOLD;
export const trainCost = (run) => TRAIN_COST;

export function rest(run) {
  const before = run.hp;
  run.hp = Math.min(run.hpMax, run.hp + restHeal(run));
  return { healed: run.hp - before, gold: 0 };
}

/** Skip the healing and walk off with more coin instead. */
export function forage(run) {
  const gold = forageGold(run);
  run.gold += gold;
  return { gold };
}

/**
 * Spend gold at camp so one piece in the bag holds a permanent shield —
 * every fight from here on, not just this run's next one. The other two camp
 * choices (rest, forage) are one-shot; this is the only one that compounds,
 * so it costs more than either and only works once per piece.
 */
export function trainPiece(run, itemUid) {
  const item = run.bag.find((p) => p.uid === itemUid);
  if (!item || item.type === 'k') return { ok: false, reason: 'Can’t train that.' };
  if (rarityOf(item.type) !== RARITY.COMMON) {
    return { ok: false, reason: 'Only commons can be trained.' };
  }
  if (item.trained) return { ok: false, reason: 'Already trained.' };
  const cost = trainCost(run);
  if (run.gold < cost) return { ok: false, reason: `Needs ${cost} gold.` };
  debitGold(run, cost);
  item.trained = true;
  return { ok: true };
}

/** You may take a room again for as long as you are still standing. */
export function retryAllowed(run) {
  return Boolean(run) && !run.over && run.hp > 0;
}

/**
 * Pay the HP cost of taking a move back. Refuses if it would drop you to
 * zero — undo is a spend, not a way to die without losing the king.
 */
export function payUndo(run) {
  if (!run || run.over) return { ok: false, reason: 'The run is over.' };
  if (run.hp <= UNDO_HP) {
    return { ok: false, reason: `Need more than ${UNDO_HP} HP to take a move back.` };
  }
  run.hp -= UNDO_HP;
  return { ok: true, hpLost: UNDO_HP, hp: run.hp };
}

export function openShop(run) {
  const act = currentAct(run);
  const offers = [];
  const seen = new Set();

  // The same hooded stall every time: five pieces, or four and a king.
  const ownedKings = new Set(ownedKingIds(run));
  const kingPool = Object.values(KING_PASSIVES).filter((pas) => !ownedKings.has(pas.id));
  const includeKing = kingPool.length > 0 && run.rng() < 0.5;
  const pieceCount = includeKing ? 4 : 5;

  const rarities = shopRarityPlan(run.rng, act, pieceCount);
  for (let i = 0; i < rarities.length; i++) {
    const want = rarities[i];
    let pick = null;
    for (let tries = 0; tries < 20; tries++) {
      const p = weightedPiece(run.rng, new Set([want]), act);
      if (p && !seen.has(p.id) && hasSlot(run, p.id)) { pick = p; break; }
    }
    if (!pick) {
      const fallback = weightedPiece(run.rng, new Set(['common', want]), act);
      if (fallback && !seen.has(fallback.id) && hasSlot(run, fallback.id)) pick = fallback;
    }
    if (!pick) continue;
    seen.add(pick.id);
    offers.push(pieceOffer(run, pick, i, act));
  }

  if (includeKing && kingPool.length) {
    const pick = kingPool.splice(Math.floor(run.rng() * kingPool.length), 1)[0];
    offers.push({
      kind: 'king',
      id: `king-${pick.id}`,
      king: pick.id,
      name: pick.name + ' King',
      blurb: pick.blurb + ' Joins the kings in your bag.',
      cost: pick.cost,
      sprite: pick.sprite,
    });
  }

  const discount = 1 - Math.min(0.6, relicTotals(run.relics).shopDiscount);
  for (const offer of offers) offer.cost = Math.max(1, Math.round(offer.cost * discount));

  run.shop = { offers, rerollBase: 2, rerollCost: rerollCostFor(run, 2) };
  return run.shop;
}

/**
 * What rarities the masked stall puts on the table this visit.
 * Act 1 is commons, maybe one rare. Later acts open up.
 */
function shopRarityPlan(rng, act, count) {
  const plan = [];
  if (act <= 1) {
    const rare = rng() < 0.42 ? 1 : 0;
    for (let i = 0; i < count - rare; i++) plan.push(RARITY.COMMON);
    if (rare) plan.push(RARITY.RARE);
    return plan;
  }
  if (act === 2) {
    const epic = rng() < 0.5 ? 1 : 0;
    const rares = epic ? 1 : 2;
    const commons = Math.max(0, count - rares - epic);
    for (let i = 0; i < commons; i++) plan.push(RARITY.COMMON);
    for (let i = 0; i < rares; i++) plan.push(RARITY.RARE);
    if (epic) plan.push(RARITY.EPIC);
    return plan;
  }
  const legend = rng() < 0.3 ? 1 : 0;
  const epics = legend ? 1 : 2;
  const rares = Math.min(2, Math.max(0, count - epics - legend));
  const commons = Math.max(0, count - rares - epics - legend);
  for (let i = 0; i < commons; i++) plan.push(RARITY.COMMON);
  for (let i = 0; i < rares; i++) plan.push(RARITY.RARE);
  for (let i = 0; i < epics; i++) plan.push(RARITY.EPIC);
  if (legend) plan.push(RARITY.LEGENDARY);
  return plan;
}

// Every merchant on the road is the same hooded figure, and every so often
// — mostly for the better pieces — he'll deal in blood as well as gold, not
// instead of it. Common pieces are never priced this way; it's a rare-and-up
// thing, and it's uncommon even among those.
const BLOOD_CHANCE = 0.12;
const BLOOD_HP_COST = { rare: 3, epic: 5, legendary: 8 };

function pieceOffer(run, pick, i, act) {
  const offer = {
    kind: 'piece',
    id: `piece-${pick.id}-${i}`,
    type: pick.id,
    name: pick.name,
    blurb: pick.blurb,
    cost: 3 + pick.cost + (act - 1) * 2,
    rarity: pick.rarity,
  };
  const bloodCost = BLOOD_HP_COST[pick.rarity];
  if (bloodCost && run.rng() < BLOOD_CHANCE) {
    offer.hpCost = bloodCost;
    offer.cost = Math.max(1, Math.round(offer.cost * 0.6));
  }
  return offer;
}

/** Claims one of the relics an elite or boss offered, and clears the rest. */
export function claimRelic(run, relicId) {
  if (!run.pendingRelics?.includes(relicId)) return false;
  if (!run.relics.includes(relicId)) run.relics.push(relicId);
  run.pendingRelics = [];
  return true;
}

export function skipRelics(run) {
  run.pendingRelics = [];
}

export function buyOffer(run, offerId) {
  const shop = run.shop;
  if (!shop) return { ok: false, reason: 'No shop is open.' };
  const offer = shop.offers.find((o) => o.id === offerId);
  if (!offer) return { ok: false, reason: 'That offer is gone.' };
  if (run.gold < offer.cost) return { ok: false, reason: 'Not enough gold.' };
  if (offer.hpCost && run.hp <= offer.hpCost) return { ok: false, reason: 'Not enough life left.' };

  if (offer.kind === 'piece') {
    if (!hasSlot(run, offer.type)) return { ok: false, reason: 'No slot of that rarity.' };
    addToBag(run, offer.type);
  } else if (offer.kind === 'supply') {
    run.supplyBonus += 1;
    run.supplyBought += 1;
  } else if (offer.kind === 'king') {
    const owned = ownedKingIds(run);
    if (!owned.includes(offer.king)) owned.push(offer.king);
    run.kings = owned;
    run.king = offer.king;
  } else if (offer.kind === 'slot') {
    run.slots[offer.rarity] = (run.slots[offer.rarity] || 0) + 1;
  } else if (offer.kind === 'relic') {
    if (!run.relics.includes(offer.relic)) run.relics.push(offer.relic);
  } else {
    return { ok: false, reason: 'Unknown offer.' };
  }

  debitGold(run, offer.cost);
  if (offer.hpCost) run.hp -= offer.hpCost;
  shop.offers = shop.offers.filter((o) => o.id !== offerId);
  return { ok: true, offer };
}

/**
 * Financier knocks a gold off the sticker price, floor one. Kept separate
 * from the escalating base cost (rerollBase) so the discount is applied
 * fresh each time rather than compounding into the ladder itself — without
 * that split, discounting the already-discounted price before climbing it
 * would flatten the ladder at 1 forever instead of still rising underneath
 * the discount.
 */
function rerollCostFor(run, base) {
  return Math.max(1, base);
}

export function rerollShop(run) {
  const shop = run.shop;
  if (!shop) return { ok: false, reason: 'No shop is open.' };
  if (run.gold < shop.rerollCost) return { ok: false, reason: 'Not enough gold.' };
  debitGold(run, shop.rerollCost);
  const nextBase = Math.min(6, (shop.rerollBase || shop.rerollCost) + 1);
  openShop(run);
  run.shop.rerollBase = nextBase;
  run.shop.rerollCost = rerollCostFor(run, nextBase);
  return { ok: true };
}

export function closeShop(run) {
  run.shop = null;
}

/**
 * A loadout worth fighting with: fill the bodies first, then spend what is left
 * upgrading them.
 *
 * Spending supply on the most expensive pieces first looks sensible and loses
 * games. Opening fights are built for a king and three pawns: bodies first,
 * upgrades later. When the deploy cap is the binding constraint, an empty
 * slot is worth more than a costlier piece in the ones you filled.
 */
export function suggestLoadout(run, encounter) {
  const budget = supplyBudget(run, encounter);
  const slots = deployBudget(run, encounter);
  const priceOf = (item) => costFor(run, item.type);

  // Fill every slot we can afford, cheapest first, so bodies come first.
  const pool = [...run.bag].sort((a, b) => priceOf(a) - priceOf(b));
  const chosen = [];
  let spent = 0;
  for (const item of pool) {
    if (chosen.length >= slots) break;
    if (spent + priceOf(item) > budget) continue;
    chosen.push(item);
    spent += priceOf(item);
  }

  // Then trade up: swap the cheapest thing we brought for the best thing we
  // left behind, as long as the supply stretches. Never costs a body.
  for (let pass = 0; pass < chosen.length; pass++) {
    const bench = run.bag
      .filter((item) => !chosen.includes(item))
      .sort((a, b) => priceOf(b) - priceOf(a));
    let improved = false;
    for (const candidate of bench) {
      const weakest = chosen.reduce((lo, it) => (priceOf(it) < priceOf(lo) ? it : lo), chosen[0]);
      if (!weakest) break;
      const delta = priceOf(candidate) - priceOf(weakest);
      if (delta > 0 && spent + delta <= budget) {
        chosen[chosen.indexOf(weakest)] = candidate;
        spent += delta;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }
  return chosen;
}

/** 8×8 line-of-march board used to set the army before a fight. */
export const CREW_BOARD = {
  files: 8, ranks: 8, supply: 99, deploy: 15, enemy: [],
  name: 'Line of March', blurb: 'Who walks, and where.',
};

export function ensureFormation(run) {
  if (run.formation && run.formation.length) {
    pruneFormation(run);
    return run.formation;
  }
  const formation = [{ uid: 'king', type: 'k', sq: 7 * 16 + 4 }];
  const pawnFiles = [3, 4, 5];
  const pawns = run.bag.filter((p) => p.type === 'p');
  for (let i = 0; i < pawnFiles.length && i < pawns.length; i++) {
    formation.push({ uid: pawns[i].uid, type: 'p', sq: 6 * 16 + pawnFiles[i] });
  }
  run.formation = formation;
  return formation;
}

export function pruneFormation(run) {
  const have = new Set((run.bag || []).map((p) => p.uid));
  have.add('king');
  run.formation = (run.formation || []).filter((p) => have.has(p.uid));
  if (!run.formation.some((p) => p.uid === 'king')) {
    const taken = new Set(run.formation.map((p) => p.sq));
    const kingSq = [7 * 16 + 4, 7 * 16 + 3, 7 * 16 + 5, 7 * 16]
      .find((sq) => !taken.has(sq)) ?? (7 * 16 + 4);
    run.formation.unshift({ uid: 'king', type: 'k', sq: kingSq });
  }
}

/**
 * Stamp one file-shift of the saved line onto this encounter's home ranks.
 * `shift` is added to every file; pieces that still miss the board are dropped.
 */
function stampLine(run, encounter, shift) {
  const files = encounter.files;
  const ranks = encounter.ranks;
  const homeRows = ranks <= 4 ? 1 : 2;
  const homes = new Set(freeHomeSquares(encounter));
  const used = new Set();
  const mapped = [];
  for (const p of run.formation) {
    const f = (p.sq & 15) + shift;
    const r = p.sq >> 4;
    const back = 7 - r;
    if (back < 0 || back >= homeRows) continue;
    if (f < 0 || f >= files) continue;
    const dest = (ranks - 1 - back) * 16 + f;
    if (!homes.has(dest) || used.has(dest)) continue;
    const type = p.uid === 'king' ? 'k' : run.bag.find((b) => b.uid === p.uid)?.type;
    if (!type) continue;
    used.add(dest);
    mapped.push({ uid: p.uid, type, sq: dest });
  }
  return mapped;
}

/**
 * Stamp the saved line of march onto this encounter's home ranks. If the
 * line hangs off a narrower field, slide it left or right (the smallest
 * shift that keeps the king and as much of the army as possible) instead
 * of dropping whoever sat on the a- or h-file.
 */
export function placementsFromFormation(run, encounter) {
  ensureFormation(run);
  const wanted = run.formation.length;
  const order = [0];
  for (let s = 1; s <= 7; s++) order.push(-s, s);
  let best = [];
  for (const shift of order) {
    const mapped = stampLine(run, encounter, shift);
    if (!mapped.some((p) => p.uid === 'king')) continue;
    if (mapped.length <= best.length) continue;
    best = mapped;
    if (mapped.length === wanted) break;
  }
  if (!best.some((p) => p.uid === 'king')) {
    const homes = freeHomeSquares(encounter);
    if (homes[0] != null) best = [{ uid: 'king', type: 'k', sq: homes[0] }];
  }
  const king = best.find((p) => p.uid === 'king');
  let items = best.filter((p) => p.uid !== 'king');
  while (items.length && !validateLoadout(run, encounter, items.map((i) => i.uid)).ok) {
    items.sort((a, b) => (a.sq >> 4) - (b.sq >> 4) || (a.sq & 15) - (b.sq & 15));
    items.shift();
  }
  const placements = king ? [king, ...items] : items;
  return legalizeSetup(run, encounter, placements);
}

function legalizeSetup(run, encounter, placements) {
  if (run.king === 'sentinel') return placements;
  const checks = (pls) => {
    const g = buildFight(run, encounter, pls);
    return g.kings.b >= 0 && g.kingAttacked(BLACK);
  };
  if (!checks(placements)) return placements;

  const bagItems = placements
    .filter((p) => p.uid !== 'king')
    .map((p) => run.bag.find((b) => b.uid === p.uid))
    .filter(Boolean);
  const auto = autoPlace(encounter, bagItems);
  if (!checks(auto)) return auto;

  const g = buildFight(run, encounter, placements);
  const bk = g.kings.b;
  const offenders = new Set();
  for (const p of placements) {
    if (p.uid === 'king') continue;
    const piece = g.board[p.sq];
    if (piece && typeof g.attacksFrom === 'function' && g.attacksFrom(p.sq, piece, bk)) {
      offenders.add(p.uid);
    }
  }
  const stripped = placements.filter((p) => p.uid === 'king' || !offenders.has(p.uid));
  if (!checks(stripped)) return stripped;

  const keep = bagItems.slice();
  while (keep.length) {
    keep.pop();
    const trial = autoPlace(encounter, keep);
    if (!checks(trial)) return trial;
  }
  return autoPlace(encounter, []);
}

export function autoPlace(encounter, selectedItems) {
  const free = freeHomeSquares(encounter);
  const withKing = [{ uid: 'king', type: 'k' }, ...selectedItems];
  const placements = [];
  for (let i = 0; i < withKing.length && i < free.length; i++) {
    placements.push({ uid: withKing[i].uid, type: withKing[i].type, sq: free[i] });
  }
  return placements;
}

export function runStats(run) {
  const captured = tallyTypes(run.captured || []);
  const bag = bagSummary(run);
  const node = currentNode(run);
  const act = node?.act || run.act + 1;
  return {
    won: Boolean(run.won),
    act,
    rooms: run.cleared instanceof Set ? run.cleared.size : 0,
    lastName: node?.name || null,
    lastKind: node?.kind || null,
    goldSpent: run.goldSpent || 0,
    goldLeft: run.gold || 0,
    captured,
    army: bag.pieces,
    kings: bag.kings,
    equipped: bag.equipped,
  };
}

function tallyTypes(types) {
  const map = new Map();
  for (const type of types) {
    if (!type) continue;
    map.set(type, (map.get(type) || 0) + 1);
  }
  return [...map.entries()]
    .map(([type, count]) => ({ type, count, name: PIECES[type]?.name || type }))
    .sort((a, b) => b.count - a.count || (PIECES[a.type]?.cost || 0) - (PIECES[b.type]?.cost || 0));
}

export { KING_PASSIVES, homeSquares, freeHomeSquares, REST_GOLD, REST_HEAL, FORAGE_GOLD, TRAIN_COST, UNDO_HP, FIGHT_GOLD };

// ---- events ---------------------------------------------------------------

/** Gold you must be holding to take this choice, including a losing wager. */
function goldStake(choice) {
  let n = Number(choice.cost) || 0;
  const scan = (list) => {
    for (const e of list || []) {
      if (typeof e.gold === 'number' && e.gold < 0) n += -e.gold;
    }
  };
  scan(choice.effects);
  if (choice.gamble) {
    scan(choice.gamble.win);
    scan(choice.gamble.lose);
  }
  return n;
}

/**
 * Can this choice be taken right now? Priced choices need the gold; a choice
 * that drops a piece needs something droppable left in the bag.
 */
export function choiceAvailable(run, choice) {
  const stake = goldStake(choice);
  if (stake && run.gold < stake) {
    return { ok: false, reason: `Needs ${stake}g` };
  }
  const dropsAPiece = (choice.effects || []).some((e) => e.lose || e.upgrade);
  if (dropsAPiece && run.bag.length <= 1) {
    return { ok: false, reason: 'Nothing to give' };
  }
  // Duplicate doesn't give anything up, so it only needs one piece to exist
  // to copy — not one left over afterward.
  const needsAPiece = (choice.effects || []).some((e) => e.duplicate);
  if (needsAPiece && run.bag.length < 1) {
    return { ok: false, reason: 'Nothing to copy' };
  }
  return { ok: true };
}

/**
 * Applies one event choice and returns lines describing what happened, so the
 * UI can report the outcome without knowing the effect vocabulary.
 *
 * `lose: 'choose'` cannot be resolved here — the caller has to ask which piece
 * first and pass it back as `pickedUid`.
 */
export function applyChoice(run, choice, pickedUid = null) {
  const gate = choiceAvailable(run, choice);
  if (!gate.ok) return { ok: false, reason: gate.reason, lines: [] };

  const lines = [];
  // What the choice handed over, so the UI can give a rare or better piece
  // the same reveal a fight drop gets instead of one more line of text.
  const gained = [];
  if (choice.cost) {
    debitGold(run, choice.cost);
    lines.push(`−${choice.cost} gold`);
  }

  let effects = choice.effects || [];
  if (choice.gamble) {
    const won = Math.random() < choice.gamble.odds;
    lines.push(won ? 'The cup comes up empty. You win.' : 'Wrong cup.');
    effects = [...effects, ...(won ? choice.gamble.win : choice.gamble.lose)];
  }

  for (const effect of effects) {
    if (effect.gold != null) {
      if (effect.gold < 0) debitGold(run, -effect.gold);
      else run.gold += effect.gold;
      lines.push(`${effect.gold >= 0 ? '+' : '−'}${Math.abs(effect.gold)} gold`);
    }
    if (effect.hp != null) {
      run.hp = Math.max(0, run.hp + effect.hp);
      lines.push(`${effect.hp >= 0 ? '+' : '−'}${Math.abs(effect.hp)} HP`);
      if (run.hp <= 0) run.over = true;
    }
    if (effect.maxHp != null) {
      // createRun names this hpMax, not maxHp — the mismatch meant this branch
      // wrote to a field nothing else read, and Math.min(hp, undefined+n) left
      // run.hp as NaN for the rest of the run.
      run.hpMax = Math.max(1, run.hpMax + effect.maxHp);
      run.hp = Math.min(run.hp, run.hpMax);
      lines.push(`${effect.maxHp >= 0 ? '+' : '−'}${Math.abs(effect.maxHp)} max HP`);
    }
    if (effect.heal != null) {
      // Same run.maxHp/hpMax mismatch as the branch above — this also
      // produced NaN for every event that heals (several do).
      const before = run.hp;
      run.hp = Math.min(run.hpMax, run.hp + effect.heal);
      lines.push(`+${run.hp - before} HP`);
    }
    if (effect.supply != null) {
      run.supplyBonus += effect.supply;
      lines.push(`+${effect.supply} supply, permanently`);
    }
    if (effect.deploy != null) {
      run.deployBonus = (run.deployBonus || 0) + effect.deploy;
      lines.push(`+${effect.deploy} piece per fight, permanently`);
    }
    if (effect.gain) {
      const id = rollGain(run, effect.gain);
      if (id) {
        const added = addToBag(run, id);
        lines.push(added ? `${PIECES[id].name} joins the bag`
          : `${PIECES[id].name} would not fit — sold for 2 gold`);
        if (!added) run.gold += 2;
        gained.push({ type: id, sold: added ? 0 : 2 });
      }
    }
    if (effect.lose) {
      const uid = effect.lose === 'choose' ? pickedUid : null;
      // 'priciest' picks itself — a stake worth naming without asking the
      // player to pick their own loss, the way 'choose' does.
      const at = uid
        ? run.bag.findIndex((p) => p.uid === uid)
        : effect.lose === 'priciest'
          ? priciestIndex(run.bag)
          : run.bag.findIndex((p) => p.type === effect.lose);
      if (at >= 0) {
        const [gone] = run.bag.splice(at, 1);
        lines.push(`${PIECES[gone.type].name} left behind`);
      }
    }
    // Feed a piece in, get one of the next rarity up. The reason this exists
    // rather than another flat "gain a rare": it makes the commons you have
    // been carrying since the first floor worth something late, and it is
    // the only way to aim a reward at a tier instead of hoping for one.
    if (effect.upgrade) {
      const at = pickedUid ? run.bag.findIndex((p) => p.uid === pickedUid) : -1;
      if (at >= 0) {
        const [gone] = run.bag.splice(at, 1);
        lines.push(`${PIECES[gone.type].name} goes in`);
        const next = NEXT_RARITY[rarityOf(gone.type)];
        const id = next ? rollGain(run, `random-${next}`) : null;
        if (id) {
          const added = addToBag(run, id);
          lines.push(added ? `${PIECES[id].name} comes out`
            : `${PIECES[id].name} comes out — no slot, sold for 2 gold`);
          if (!added) run.gold += 2;
          gained.push({ type: id, sold: added ? 0 : 2 });
        } else {
          // A legendary has nothing above it, and a full slot at the tier
          // above has nowhere to put the result. Either way you are owed.
          run.gold += 3;
          lines.push('Nothing comes out but slag. +3 gold');
        }
      }
    }
    // Copies a piece you already own — unlike upgrade, the original stays.
    // The reflection is exact: same type, same rarity, just one more of it.
    if (effect.duplicate) {
      const at = pickedUid ? run.bag.findIndex((p) => p.uid === pickedUid) : -1;
      if (at >= 0) {
        const type = run.bag[at].type;
        const added = addToBag(run, type);
        lines.push(added ? `A second ${PIECES[type].name} joins the bag`
          : `The copy has no slot — sold for 2 gold`);
        if (!added) run.gold += 2;
        gained.push({ type, sold: added ? 0 : 2 });
      }
    }
    if (effect.king) {
      const owned = new Set(ownedKingIds(run));
      const pool = Object.keys(KING_PASSIVES).filter((id) => !owned.has(id));
      const id = effect.king === 'random'
        ? pool[Math.floor(Math.random() * pool.length)]
        : effect.king;
      if (id && !owned.has(id)) {
        run.kings = ownedKingIds(run);
        run.kings.push(id);
        lines.push(`${KING_PASSIVES[id].name} King joins the bag`);
      } else {
        run.gold += 3;
        lines.push('You already carry every crown they had. +3 gold');
      }
    }
  }
  return { ok: true, lines, gained };
}

const NEXT_RARITY = {
  [RARITY.COMMON]: RARITY.RARE,
  [RARITY.RARE]: RARITY.EPIC,
  [RARITY.EPIC]: RARITY.LEGENDARY,
};

/** The index of the single most expensive non-king piece in a bag, if any. */
function priciestIndex(bag) {
  let best = -1;
  let bestCost = -1;
  bag.forEach((item, i) => {
    if (item.type === 'k') return;
    const cost = PIECES[item.type]?.cost || 0;
    if (cost > bestCost) { bestCost = cost; best = i; }
  });
  return best;
}

const GAIN_RARITY = {
  'random-common': RARITY.COMMON,
  'random-rare': RARITY.RARE,
  'random-epic': RARITY.EPIC,
  'random-legendary': RARITY.LEGENDARY,
};

/** Turns a `gain` token into a concrete piece id the bag has room for. */
function rollGain(run, token) {
  if (PIECES[token]) return token;
  const wantRarity = GAIN_RARITY[token] || RARITY.COMMON;
  const pool = Object.values(PIECES)
    .filter((p) => p.rarity === wantRarity && p.rarity !== RARITY.UNIQUE && !p.royal);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)].id;
}
