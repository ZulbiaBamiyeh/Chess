// A single run: bag, slots, supply, HP, map, shop and fight settlement.
// Nothing here touches the DOM. campaign.js drives the screens.

import { WHITE, BLACK, Chess, ST_SHIELD, ST_FROZEN, FLAG, TILE, parseSquare } from './chess.js';
import { PIECES, SLOT_CAPS, pieceCost, rarityOf, RARITY } from './pieces.js';
import { relicTotals, discountedCost, hasTag, relicById, relicPool } from './relics.js';
import {
  LOSS_HP, FORFEIT_HP, REST_HEAL,
  START_HP, START_GOLD, STARTING_BAG, KING_PASSIVES, REST_GOLD,
  FORAGE_GOLD, TRAIN_COST,
  TURN_CLOCK, THEME_DROPS, DROP_CHANCE,
  generateMap, findNode, encounterFor, firstRooms, freeHomeSquares, homeSquares,
  weightedPiece, supplyUpgradeCost, slotUpgradeCost,
} from './content.js';

let nextUid = 1;
const uid = () => `p${nextUid++}`;

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
  return {
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
  };
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
  return run.bag.splice(i, 1)[0];
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
  const nomad = run.king === 'nomad' ? 1 : 0;
  return Math.max(1, base + (run.deployBonus || 0) + relicTotals(run.relics).deploy + nomad);
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
    // BLACK only — the enemy king needs an escort or a rook on an open line
    // wins the fight on the first ply (the bug this rule exists to fix).
    // The player's own king does not: a free guard made it as safe to push
    // forward as to keep it home, and left the Aegis king's shield with
    // nothing to do (the guard always spent itself first). Now Aegis is the
    // only thing standing between a pushed king and a lost run.
    //
    // Sentinel opts back in: it is a purchase, not the default, so a player
    // who wants the escort back — instead of Aegis's unconditional block —
    // can choose it, and the two remain genuinely different kings.
    royalGuard: run.king === 'sentinel' ? true : BLACK,
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

  if (won) {
    // Paying full army value in gold, plus an uncapped turns-remaining speed
    // bonus, meant a player who actually plays well earned far more than any
    // shop asked for — simulating a fast clean act 1 (win every room in ~40%
    // of the clock) banked 165 gold against a 63 gold shop, twice over,
    // before the SECOND shop of the run even opened. Both terms are cut:
    // half of army instead of all of it, and the speed bonus capped low
    // enough to reward a fast win without being the whole economy.
    gold = 2 + Math.round(army * 0.5) + (tier === 'elite' ? 3 : 0) + (tier === 'boss' ? 6 : 0)
      + Math.min(4, Math.max(0, clockLeft));
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
    // Losing costs HP, not the run. LOSS_HP and FORFEIT_HP had been sitting in
    // the content file unused, so a single lost fight ended a forty-minute run
    // outright — and every HP system in the game (rests, the Field Surgeon,
    // Second Wind, the whole heal economy) had nothing to protect you from.
    hpLost = Math.max(1, (forfeit
      ? (FORFEIT_HP[tier] ?? 2)
      : (LOSS_HP[tier] ?? 3)) - (run.king === 'steadfast' ? 2 : 0));
    run.hp -= hpLost;

    if (run.hp <= 0) {
      if (relics.secondWind && !run.secondWindUsed) {
        // Second Wind turns the first fatal defeat of a run into a scratch.
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

  run.lastReward = {
    won,
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
    healed: won ? relics.healPerFight : 0,
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
export const restHeal = (run) => REST_HEAL + (run?.king === 'convalescent' ? 3 : 0);
export const forageGold = (run) => FORAGE_GOLD + (run?.king === 'ranger' ? 4 : 0);
export const trainCost = (run) => Math.max(1, TRAIN_COST - (run?.king === 'provisioner' ? 2 : 0));

export function rest(run) {
  const before = run.hp;
  run.hp = Math.min(run.hpMax, run.hp + restHeal(run));
  run.gold += REST_GOLD;
  return { healed: run.hp - before, gold: REST_GOLD };
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
  if (item.trained) return { ok: false, reason: 'Already trained.' };
  const cost = trainCost(run);
  if (run.gold < cost) return { ok: false, reason: `Needs ${cost} gold.` };
  run.gold -= cost;
  item.trained = true;
  return { ok: true };
}

/** You may take a room again for as long as you are still standing. */
export function retryAllowed(run) {
  return Boolean(run) && !run.over && run.hp > 0;
}

export function openShop(run) {
  const act = currentAct(run);
  const offers = [];
  const seen = new Set();
  const allowed = new Set(['common']);
  if (run.slots.rare > 0) allowed.add('rare');
  if (run.slots.epic > 0) allowed.add('epic');
  if (run.slots.legendary > 0) allowed.add('legendary');

  // Always one common so a broke player still has a button.
  const common = weightedPiece(run.rng, new Set(['common']), act);
  if (common) {
    seen.add(common.id);
    offers.push(pieceOffer(common, 0, act));
  }

  // One more, not two. A shop that shows every piece you might want doesn't
  // ask you to want anything in particular — three piece offers plus a king
  // and a relic meant a decent run could just buy the whole board and never
  // commit to a build. One real alternative to the common is enough to be a
  // choice.
  for (let i = 1; i < 2; i++) {
    let pick = null;
    for (let tries = 0; tries < 16; tries++) {
      const p = weightedPiece(run.rng, allowed, act);
      if (p && !seen.has(p.id) && hasSlot(run, p.id)) { pick = p; break; }
    }
    if (!pick) continue;
    seen.add(pick.id);
    offers.push(pieceOffer(pick, i, act));
  }

  offers.push({
    kind: 'supply',
    id: 'supply',
    name: 'Deeper Reserve',
    blurb: `+1 supply on every fight. (now +${run.supplyBonus})`,
    cost: supplyUpgradeCost(run.supplyBought),
  });

  offers.push({
    kind: 'heal',
    id: 'heal',
    name: 'A Purse',
    blurb: 'A little extra gold.',
    cost: 4,
  });

  const ownedKings = new Set(ownedKingIds(run));
  const kingPool = Object.values(KING_PASSIVES).filter((pas) => !ownedKings.has(pas.id));
  // One king offer regardless of act. Two in act 3 was one more thing on an
  // already crowded board that a flush run just bought without thinking.
  const kingSlots = 1;
  for (let i = 0; i < kingSlots && kingPool.length; i++) {
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

  if (run.slots.epic < 3) {
    offers.push({
      kind: 'slot',
      id: 'slot-epic',
      rarity: RARITY.EPIC,
      name: 'Epic Slot',
      blurb: 'One more epic piece in the bag.',
      cost: slotUpgradeCost(RARITY.EPIC),
    });
  } else if (run.slots.legendary < 2) {
    offers.push({
      kind: 'slot',
      id: 'slot-legendary',
      rarity: RARITY.LEGENDARY,
      name: 'Legendary Slot',
      blurb: 'Room for another legendary.',
      cost: slotUpgradeCost(RARITY.LEGENDARY),
    });
  }

  // Relics for sale — one per shop, always. A second in act 3 was the
  // clearest case of the shop selling you a whole extra build on top of
  // whatever you had already committed to.
  const relicSlots = 1;
  const pool = relicPool(run.relics);
  for (let i = 0; i < relicSlots && pool.length; i++) {
    const pick = pool.splice(Math.floor(run.rng() * pool.length), 1)[0];
    const relic = relicById(pick);
    offers.push({
      kind: 'relic',
      id: `relic-${relic.id}`,
      relic: relic.id,
      name: relic.name,
      blurb: `${relic.blurb} (${relic.archetype})`,
      rarity: relic.rarity,
      cost: RELIC_PRICE[relic.rarity] ?? 30,
    });
  }

  // Merchant's Seal and friends discount the whole board.
  const discount = 1 - Math.min(0.6, relicTotals(run.relics).shopDiscount);
  for (const offer of offers) offer.cost = Math.max(1, Math.round(offer.cost * discount));
  // Broker: a flat gold off every sticker, after the percentage discounts —
  // a percentage off a percentage off would make it worth more stacked with
  // Merchant's Seal than alone, which isn't the point of a flat discount.
  if (run.king === 'broker') {
    for (const offer of offers) offer.cost = Math.max(1, offer.cost - 1);
  }

  run.shop = { offers, rerollBase: 2, rerollCost: rerollCostFor(run, 2) };
  return run.shop;
}

const RELIC_PRICE = { common: 26, rare: 40, epic: 58, legendary: 75 };

function pieceOffer(pick, i, act) {
  return {
    kind: 'piece',
    id: `piece-${pick.id}-${i}`,
    type: pick.id,
    name: pick.name,
    blurb: pick.blurb,
    cost: 2 + pick.cost + (act - 1),
    rarity: pick.rarity,
  };
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
  } else if (offer.kind === 'heal') {
    run.gold += 6;
  } else if (offer.kind === 'slot') {
    run.slots[offer.rarity] = (run.slots[offer.rarity] || 0) + 1;
  } else if (offer.kind === 'relic') {
    if (!run.relics.includes(offer.relic)) run.relics.push(offer.relic);
  } else {
    return { ok: false, reason: 'Unknown offer.' };
  }

  run.gold -= offer.cost;
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
  return Math.max(1, base - (run.king === 'financier' ? 1 : 0));
}

export function rerollShop(run) {
  const shop = run.shop;
  if (!shop) return { ok: false, reason: 'No shop is open.' };
  if (run.gold < shop.rerollCost) return { ok: false, reason: 'Not enough gold.' };
  run.gold -= shop.rerollCost;
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
 * games. On The Gate — a 4x4 with five supply and three slots — it fielded a
 * knight and a ferz, two bodies, and lost every time; three pawns win it. When
 * the deploy cap is the binding constraint, an empty slot is worth more than a
 * costlier piece in the ones you filled.
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

export function autoPlace(encounter, selectedItems) {
  const free = freeHomeSquares(encounter);
  const withKing = [{ uid: 'king', type: 'k' }, ...selectedItems];
  const placements = [];
  for (let i = 0; i < withKing.length && i < free.length; i++) {
    placements.push({ uid: withKing[i].uid, type: withKing[i].type, sq: free[i] });
  }
  return placements;
}

export { KING_PASSIVES, homeSquares, freeHomeSquares, REST_GOLD, REST_HEAL, FORAGE_GOLD, TRAIN_COST };

// ---- events ---------------------------------------------------------------

/**
 * Can this choice be taken right now? Priced choices need the gold; a choice
 * that drops a piece needs something droppable left in the bag.
 */
export function choiceAvailable(run, choice) {
  if (choice.cost && run.gold < choice.cost) {
    return { ok: false, reason: `Costs ${choice.cost}g` };
  }
  const dropsAPiece = (choice.effects || []).some((e) => e.lose || e.upgrade);
  if (dropsAPiece && run.bag.length <= 1) {
    return { ok: false, reason: 'Nothing to give' };
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
    run.gold -= choice.cost;
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
      run.gold = Math.max(0, run.gold + effect.gold);
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
          : `${PIECES[id].name} would not fit — sold for 12 gold`);
        if (!added) run.gold += 12;
        gained.push({ type: id, sold: added ? 0 : 12 });
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
            : `${PIECES[id].name} comes out — no slot, sold for 12 gold`);
          if (!added) run.gold += 12;
          gained.push({ type: id, sold: added ? 0 : 12 });
        } else {
          // A legendary has nothing above it, and a full slot at the tier
          // above has nowhere to put the result. Either way you are owed.
          run.gold += 25;
          lines.push('Nothing comes out but slag. +25 gold');
        }
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
        run.gold += 20;
        lines.push('You already carry every crown they had. +20 gold');
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
