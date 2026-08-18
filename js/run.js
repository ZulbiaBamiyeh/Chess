// A single run: bag, slots, supply, HP, map, shop and fight settlement.
// Nothing here touches the DOM. campaign.js drives the screens.

import { WHITE, BLACK, Chess, ST_SHIELD, ST_FROZEN, FLAG, parseSquare } from './chess.js';
import { PIECES, SLOT_CAPS, pieceCost, rarityOf, RARITY } from './pieces.js';
import {
  START_HP, START_GOLD, STARTING_BAG, KING_PASSIVES, REST_GOLD,
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
    const row = tallies.get(item.type) || { type: item.type, count: 0 };
    row.count += 1;
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
  return (encounter.supply || 0) + run.supplyBonus;
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
  return base + (run.deployBonus || 0);
}

export function loadoutCost(items) {
  return items.reduce((sum, item) => sum + pieceCost(item.type), 0);
}

export function validateLoadout(run, encounter, selectedUids) {
  const budget = supplyBudget(run, encounter);
  const items = selectedUids.map((id) => run.bag.find((p) => p.uid === id)).filter(Boolean);
  if (items.length !== selectedUids.length) {
    return { ok: false, reason: 'A selected piece is not in your bag.', cost: 0, budget };
  }
  const homes = freeHomeSquares(encounter);
  if (items.length + 1 > homes.length) {
    return { ok: false, reason: 'Not enough home squares for that many pieces.', cost: loadoutCost(items), budget };
  }
  const cost = loadoutCost(items);
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
    kingPassives: run.king ? [run.king] : [],
    terrain,
    duck: encounter.duckAt,
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
    deployed.push(item.uid);
  }

  game.turn = WHITE;
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

export function applyStartStatuses(game, run) {
  const king = game.kings.w;
  if (king < 0) return;
  if (run.king === 'aegis') game.status[king] |= ST_SHIELD;
  if (run.king === 'hoarfrost') {
    for (const off of [-17, -16, -15, -1, 1, 15, 16, 17]) {
      const sq = king + off;
      if (!game.inBounds(sq)) continue;
      const p = game.board[sq];
      if (p && p.color === BLACK) game.status[sq] |= ST_FROZEN;
    }
  }
}

export function remainingArmy(game, color) {
  return game.armyValue(color);
}

export function turnClock(encounter) {
  return encounter.clock || TURN_CLOCK[encounter.tier || (encounter.boss ? 'boss' : 'trash')] || 10;
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

  if (won) {
    gold = 2 + army + (tier === 'elite' ? 3 : 0) + (tier === 'boss' ? 6 : 0) + Math.max(0, clockLeft);
    run.gold += gold;
    drop = rollDrop(run, encounter);
    if (drop) {
      const added = addToBag(run, drop);
      if (!added) {
        dropSold = 2 + pieceCost(drop);
        run.gold += dropSold;
      }
    }
  } else {
    run.over = true;
    run.won = false;
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
  };
  run.deployed = [];
  return run.lastReward;
}

function rollDrop(run, encounter) {
  const chance = DROP_CHANCE[encounter.tier || 'trash'] ?? 0.15;
  if (run.rng() > chance) return null;
  const fromBoard = (encounter.enemy || [])
    .map((e) => e.type)
    .filter((t) => t !== 'k' && PIECES[t] && PIECES[t].rarity !== RARITY.UNIQUE);
  const theme = THEME_DROPS[encounter.theme] || [];
  const pool = fromBoard.length ? fromBoard : theme;
  if (!pool.length) return null;
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

export function rest(run) {
  run.gold += REST_GOLD;
  return REST_GOLD;
}

export function retryAllowed() {
  return false;
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

  for (let i = 1; i < 3; i++) {
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
  const kingSlots = act >= 3 ? 2 : 1;
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

  run.shop = { offers, rerollCost: 2 };
  return run.shop;
}

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
  } else {
    return { ok: false, reason: 'Unknown offer.' };
  }

  run.gold -= offer.cost;
  shop.offers = shop.offers.filter((o) => o.id !== offerId);
  return { ok: true, offer };
}

export function rerollShop(run) {
  const shop = run.shop;
  if (!shop) return { ok: false, reason: 'No shop is open.' };
  if (run.gold < shop.rerollCost) return { ok: false, reason: 'Not enough gold.' };
  run.gold -= shop.rerollCost;
  const next = Math.min(6, shop.rerollCost + 1);
  openShop(run);
  run.shop.rerollCost = next;
  return { ok: true };
}

export function closeShop(run) {
  run.shop = null;
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

export { KING_PASSIVES, homeSquares, freeHomeSquares, REST_GOLD };
