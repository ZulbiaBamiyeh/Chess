// A single run: bag, slots, supply, hearts, shop and fight settlement.
// Nothing here touches the DOM. campaign.js drives the screens.

import { WHITE, BLACK, Chess, ST_SHIELD, FLAG, parseSquare } from './chess.js';
import { PIECES, SLOT_CAPS, pieceCost, rarityOf, RARITY } from './pieces.js';
import {
  ENCOUNTERS, START_HEARTS, START_GOLD, STARTING_BAG, KING_PASSIVES,
  homeSquares, freeHomeSquares, weightedPiece, supplyUpgradeCost, slotUpgradeCost,
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
  const run = {
    seed,
    rng: mulberry32(seed),
    hearts: START_HEARTS,
    gold: START_GOLD,
    bag: STARTING_BAG.map((type) => ({ uid: uid(), type })),
    slots: { common: SLOT_CAPS.common, uncommon: 2, rare: 1, legendary: 0 },
    supplyBonus: 0,
    supplyBought: 0,
    kingPassives: [],
    node: 0,
    deployed: [],
    lastReward: null,
    shop: null,
    over: false,
    won: false,
  };
  return run;
}

export function currentNode(run) {
  return ENCOUNTERS[run.node] || null;
}

export function isRunOver(run) {
  return run.over;
}

export function occupiedSlots(run) {
  const used = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
  for (const item of run.bag) {
    const r = rarityOf(item.type);
    if (used[r] != null) used[r]++;
  }
  return used;
}

export function hasSlot(run, type) {
  const r = rarityOf(type);
  if (r === RARITY.UNIQUE) return true;
  const used = occupiedSlots(run);
  return used[r] < (run.slots[r] || 0);
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

export function loadoutCost(items) {
  return items.reduce((sum, item) => sum + pieceCost(item.type), 0);
}

/**
 * Selected bag items plus the implicit king. King is never in the bag.
 * @returns {{ ok: boolean, reason?: string, cost: number, budget: number }}
 */
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
  if (cost > budget) {
    return { ok: false, reason: `Supply ${cost} / ${budget}.`, cost, budget };
  }
  return { ok: true, cost, budget };
}

export function rulesFor(run, encounter) {
  const rules = {
    checks: false,
    kingCapture: true,
    castling: false,
    royalLeaps: null,
  };
  if (run.kingPassives.includes('dash')) {
    rules.royalLeaps = [-32, 32, -2, 2];
  }
  return rules;
}

/**
 * @param {Array<{uid:string, sq:number}>} placements  king uses uid 'king'
 */
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
    rules: rulesFor(run, encounter),
    kingPassives: run.kingPassives.slice(),
    terrain,
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
  if (run.kingPassives.includes('aegis')) game.status[king] |= ST_SHIELD;
  if (run.kingPassives.includes('command')) {
    for (const off of [-17, -16, -15, -1, 1, 15, 16, 17]) {
      const sq = king + off;
      if (!game.inBounds(sq)) continue;
      const p = game.board[sq];
      if (p && p.color === WHITE) game.status[sq] |= ST_SHIELD;
    }
  }
}

export function remainingArmy(game, color) {
  return game.armyValue(color);
}

/**
 * Settle a finished fight. Pieces always return to the bag.
 * Gold on a win scales with the army you still have on the board.
 */
export function settleFight(run, game, encounter) {
  const outcome = game.outcome();
  const won = outcome.over && outcome.winner === WHITE;
  const army = remainingArmy(game, WHITE);
  const maxArmy = startingArmy(run);
  let gold = 0;
  let tithe = 0;

  if (won) {
    gold = 2 + army;
    if (run.kingPassives.includes('tithe')) {
      for (const entry of game.history) {
        if (entry.move.color === WHITE && (entry.move.flags & (FLAG.CAPTURE | FLAG.EP_CAPTURE))) {
          tithe += 1;
        }
      }
      gold += tithe;
    }
    run.gold += gold;
    if (encounter.boss) {
      run.over = true;
      run.won = true;
    }
  } else if (outcome.over && outcome.winner === BLACK) {
    run.hearts -= 1;
    if (run.hearts <= 0) {
      run.over = true;
      run.won = false;
    }
  }

  run.lastReward = {
    won,
    reason: outcome.reason,
    gold,
    tithe,
    army,
    maxArmy,
    hearts: run.hearts,
  };
  run.deployed = [];
  return run.lastReward;
}

function startingArmy(run) {
  let total = 3;
  for (const uid of run.deployed) {
    if (uid === 'king') continue;
    const item = run.bag.find((p) => p.uid === uid);
    if (item) total += pieceCost(item.type);
  }
  return total;
}

export function advance(run) {
  if (run.over) return currentNode(run);
  run.node += 1;
  if (run.node >= ENCOUNTERS.length) {
    run.over = true;
    run.won = true;
    return null;
  }
  return currentNode(run);
}

export function retryAllowed(run) {
  return !run.over && run.hearts > 0;
}

// ---- shop ----------------------------------------------------------------

export function openShop(run) {
  const offers = [];
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    const allowed = new Set(
      Object.entries(run.slots).filter(([, n]) => n > 0).map(([r]) => r),
    );
    let pick = null;
    for (let tries = 0; tries < 12; tries++) {
      const p = weightedPiece(run.rng, allowed);
      if (p && !seen.has(p.id) && hasSlot(run, p.id)) { pick = p; break; }
    }
    if (!pick) continue;
    seen.add(pick.id);
    offers.push({
      kind: 'piece',
      id: `piece-${pick.id}-${i}`,
      type: pick.id,
      name: pick.name,
      blurb: pick.blurb,
      cost: 2 + pick.cost,
      rarity: pick.rarity,
    });
  }

  offers.push({
    kind: 'supply',
    id: 'supply',
    name: 'Deeper Reserve',
    blurb: `+1 supply on every fight. (now +${run.supplyBonus})`,
    cost: supplyUpgradeCost(run.supplyBought),
  });

  for (const pas of Object.values(KING_PASSIVES)) {
    if (run.kingPassives.includes(pas.id)) continue;
    offers.push({
      kind: 'passive',
      id: `pas-${pas.id}`,
      passive: pas.id,
      name: pas.name,
      blurb: pas.blurb,
      cost: pas.cost,
    });
    break;
  }

  if (run.slots.legendary < 1) {
    offers.push({
      kind: 'slot',
      id: 'slot-legendary',
      rarity: RARITY.LEGENDARY,
      name: 'Legendary Slot',
      blurb: 'Room in the bag for one legendary piece.',
      cost: slotUpgradeCost(RARITY.LEGENDARY),
    });
  } else if (run.slots.rare < 3) {
    offers.push({
      kind: 'slot',
      id: 'slot-rare',
      rarity: RARITY.RARE,
      name: 'Rare Slot',
      blurb: 'One more rare piece in the bag.',
      cost: slotUpgradeCost(RARITY.RARE),
    });
  }

  run.shop = { offers, rerollCost: 2 };
  return run.shop;
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
  } else if (offer.kind === 'passive') {
    if (!run.kingPassives.includes(offer.passive)) run.kingPassives.push(offer.passive);
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
  openShop(run);
  run.shop.rerollCost = Math.min(6, shop.rerollCost + 1);
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

export { ENCOUNTERS, KING_PASSIVES, homeSquares, freeHomeSquares };
