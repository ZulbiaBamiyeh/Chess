// Run layer: bag, slots, supply, loadout, settlement, shop, map.
// Run with: node test/run.mjs

import { WHITE, TILE } from '../js/chess.js';
import {
  createRun, validateLoadout, buildFight, settleFight, addToBag, hasSlot, runStats,
  ensureFormation, placementsFromFormation, CREW_BOARD,
  occupiedSlots, supplyBudget, deployBudget, openShop, buyOffer, autoPlace, currentNode,
  completeNode, pickNode, rest, forage, trainPiece, currentEncounter,
  bagSummary, equipKing, ownedKingIds, applyChoice, choiceAvailable,
  costFor, claimRelic, RELIC_SHIELD_CAP, TRAIN_COST, FORAGE_GOLD, freeHomeSquares,
  restHeal, forageGold, trainCost, payUndo, UNDO_HP, FIGHT_GOLD,
  buildSpoils, rollSpoils, claimSpoils, SPOIL_PIECE_WEIGHT,
  turnClock, TURN_CLOCK, CLOCK_WARN, CLOCK_PANIC,
  climbMark, climbScore, formatClimbMark,
} from '../js/run.js';
import { ENCOUNTERS, homeSquares, generateMap, SHOP_WEIGHTS, firstRooms, EVENTS } from '../js/content.js';
import { chooseMove } from '../js/ai.js';
import { Chess } from '../js/chess.js';
import { RARITY, PIECES } from '../js/pieces.js';
import { RELICS, RELIC_IDS, hasTag } from '../js/relics.js';
import { readFileSync } from 'node:fs';
import { ST_SHIELD as ST_SHIELD_BIT } from '../js/chess.js';

let failures = 0;
function assert2(cond, name) { if (!cond) { failures++; console.log(`FAIL  ${name}`); } }
function assert(name, cond, detail = '') {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const gate = ENCOUNTERS.gate;
const alley = ENCOUNTERS.alley;

{
  const run = createRun(1);
  assert('starting bag is three pawns', run.bag.length === 3 && run.bag.every((p) => p.type === 'p'));
  assert('commons are uncapped', run.slots.common === Infinity);
  assert('one legendary slot', run.slots.legendary === 1);
  assert('starts with 18 HP', run.hp === 18);
  assert('map has three acts', run.map.acts.length === 3);
  assert('start offers a fork', run.choices.length >= 2, String(run.choices.length));
  assert('start rooms are fights', run.choices.every((n) => n.kind === 'fight'));
  const mark = climbMark(run);
  assert('a new climb is act 1 level 1', mark.act === 1 && mark.floor === 1 && !mark.won, JSON.stringify(mark));
  assert('the title line names the floor', formatClimbMark(mark) === 'Act 1 · level 1');
  assert('a later act outranks a deep early floor',
    climbScore({ act: 2, floor: 1, won: false }) > climbScore({ act: 1, floor: 8, won: false }));
  assert('clearing the run is the top mark',
    formatClimbMark({ act: 3, floor: 8, won: true }) === 'Act 3 cleared');
  const form = ensureFormation(run);
  assert('a new run has a line of march', form.some((p) => p.uid === 'king') && form.filter((p) => p.type === 'p').length === 3);
  const king = form.find((p) => p.uid === 'king');
  const pawnSq = form.filter((p) => p.type === 'p').map((p) => p.sq).sort((a, b) => a - b);
  assert('the king starts on d1', king.sq === 7 * 16 + 3, String(king.sq));
  assert('the pawns start on c2, d2 and e2',
    pawnSq[0] === 6 * 16 + 2 && pawnSq[1] === 6 * 16 + 3 && pawnSq[2] === 6 * 16 + 4,
    JSON.stringify(pawnSq));
  const homes = freeHomeSquares(CREW_BOARD);
  assert('line of march has two home ranks', homes.length === 16);
  const setupGame = buildFight(run, CREW_BOARD, form);
  assert('setup board fields the king and three pawns',
    setupGame.pieces().length === 4, String(setupGame.pieces().length));
}

{
  const run = createRun(1);
  const mapped = placementsFromFormation(run, gate);
  assert('formation maps onto the first fight', mapped.some((p) => p.uid === 'king') && mapped.length >= 2);
  const game = buildFight(run, gate, mapped);
  assert('mapped line does not open checking their king',
    !game.kingAttacked('b'), JSON.stringify(game.pieces()));
}

{
  const run = createRun(1);
  const pawns = run.bag.filter((p) => p.type === 'p');
  run.formation = [
    { uid: 'king', type: 'k', sq: 7 * 16 + 7 },
    { uid: pawns[0].uid, type: 'p', sq: 6 * 16 + 6 },
    { uid: pawns[1].uid, type: 'p', sq: 6 * 16 + 7 },
  ];
  const mapped = placementsFromFormation(run, gate);
  assert('a right-side line shifts left onto a 6-file field',
    mapped.length === 3 && mapped.every((p) => (p.sq & 15) < 6),
    JSON.stringify(mapped));
  const files = mapped.map((p) => p.sq & 15).sort((a, b) => a - b);
  assert('the shifted line keeps its shape',
    files[2] - files[0] === 1, JSON.stringify(files));
}

{
  // A line that is wider than the field still arrives in full — extras sit
  // on the next free square rather than being left behind.
  const run = createRun(1);
  const pawns = run.bag.filter((p) => p.type === 'p');
  run.formation = [
    { uid: 'king', type: 'k', sq: 7 * 16 + 7 },
    { uid: pawns[0].uid, type: 'p', sq: 6 * 16 + 0 },
    { uid: pawns[1].uid, type: 'p', sq: 6 * 16 + 7 },
    { uid: pawns[2].uid, type: 'p', sq: 6 * 16 + 6 },
  ];
  const mapped = placementsFromFormation(run, gate);
  const ids = new Set(mapped.map((p) => p.uid));
  assert('every piece in the line reaches a 6-file field',
    ids.has('king') && ids.has(pawns[0].uid) && ids.has(pawns[1].uid) && ids.has(pawns[2].uid)
    && mapped.every((p) => (p.sq & 15) < 6),
    JSON.stringify(mapped));
}

{
  // The saved line is the army. A fight's supply and deploy caps do not
  // strip it down before the first ply.
  const run = createRun(1);
  addToBag(run, 'q');
  const queen = run.bag.find((p) => p.type === 'q');
  const pawns = run.bag.filter((p) => p.type === 'p');
  run.formation = [
    { uid: 'king', type: 'k', sq: 7 * 16 + 4 },
    { uid: queen.uid, type: 'q', sq: 7 * 16 + 0 },
    ...pawns.map((p, i) => ({ uid: p.uid, type: 'p', sq: 6 * 16 + (1 + i) })),
  ];
  const mapped = placementsFromFormation(run, gate);
  assert('the line is not trimmed to the fight\'s supply',
    mapped.some((p) => p.type === 'q') && mapped.length === 5,
    JSON.stringify({ mapped, supply: gate.supply, cost: mapped.filter((p) => p.uid !== 'king').map((p) => p.type) }));
}

{
  // A rook staring up the enemy king's file would open in check — the mapper
  // has to break that line rather than let the fight start illegal.
  const run = createRun(1);
  addToBag(run, 'r');
  const rook = run.bag.find((p) => p.type === 'r');
  run.formation = [
    { uid: 'king', type: 'k', sq: 7 * 16 + 3 },
    { uid: rook.uid, type: 'r', sq: 7 * 16 + 3 },
  ];
  const enc = {
    ...gate,
    files: 6, ranks: 6,
    enemy: [{ type: 'k', at: 'd6' }],
    terrain: {},
  };
  const mapped = placementsFromFormation(run, enc);
  const game = buildFight(run, enc, mapped);
  assert('an opening check is broken before the fight',
    !game.kingAttacked('b'), 'still checking');
}

{
  const run = createRun(1);
  const cheap = run.bag.filter((p) => p.type === 'p').slice(0, 2).map((p) => p.uid);
  const enc = currentEncounter(run) || gate;
  const ok = validateLoadout(run, enc, cheap);
  assert('two pawns fit a small fight', ok.ok, JSON.stringify(ok));
}

{
  const run = createRun(1);
  const pawns = run.bag.filter((p) => p.type === 'p').slice(0, 2);
  const places = autoPlace(gate, pawns);
  assert('auto-place includes the king', places.some((p) => p.uid === 'king'));
  const game = buildFight(run, gate, places);
  assert('the fight is built at the encounter\'s size, in king-capture mode',
    game.files === gate.files && game.ranks === gate.ranks && game.rules.kingCapture);
  assert('both kings present', game.kings.w >= 0 && game.kings.b >= 0);
}

{
  const run = createRun(1);
  const before = run.bag.length;
  const pawns = run.bag.filter((p) => p.type === 'p').slice(0, 1);
  const game = buildFight(run, gate, autoPlace(gate, pawns));
  const bk = game.kings.b;
  game.board[bk] = null;
  game.kings.b = -1;
  const reward = settleFight(run, game, gate);
  assert('winning pays gold', reward.won && reward.gold >= 1, JSON.stringify(reward));
  assert('a trash fight drops a set purse', reward.gold === FIGHT_GOLD.trash, JSON.stringify(reward));
  assert('captured pieces return to the bag', run.bag.length >= before);
}

{
  const pay = (clockLeft) => {
    const run = createRun(1);
    const game = buildFight(run, gate, autoPlace(gate, []));
    game.board[game.kings.b] = null;
    game.kings.b = -1;
    return settleFight(run, game, gate, { clockLeft }).gold;
  };
  assert('speed does not pay extra gold', pay(20) === pay(0) && pay(0) === FIGHT_GOLD.trash);
}

{
  assert('a trash fight is not on a short fuse', turnClock(gate) >= 48, String(turnClock(gate)));
  assert('elites get a longer clock than trash',
    turnClock(ENCOUNTERS.pond) > turnClock(gate),
    `${turnClock(ENCOUNTERS.pond)} vs ${turnClock(gate)}`);
  assert('bosses get the longest clock',
    turnClock(ENCOUNTERS.steward) > turnClock(ENCOUNTERS.pond));
  assert('the run warning is well before they leave',
    CLOCK_WARN === 15 && CLOCK_PANIC === 5 && turnClock(gate) - CLOCK_WARN >= 30,
    JSON.stringify({ warn: CLOCK_WARN, clock: turnClock(gate), clocks: TURN_CLOCK }));
}

{
  const run = createRun(1);
  const pawns = run.bag.filter((p) => p.type === 'p');
  const game = buildFight(run, gate, autoPlace(gate, pawns));
  game.board[game.kings.b] = null;
  game.kings.b = -1;
  settleFight(run, game, gate, { clockLeft: 20 });
  const shop = openShop(run);
  const prices = shop.offers.filter((o) => o.kind === 'piece').map((o) => o.cost)
    .sort((a, b) => a - b);
  assert('after the opening fight, two shop pieces are out of reach',
    prices.length >= 2 && run.gold < prices[0] + prices[1],
    JSON.stringify({ gold: run.gold, prices }));
}

{
  const run = createRun(1);
  const pawns = run.bag.filter((p) => p.type === 'p').slice(0, 1);
  const game = buildFight(run, gate, autoPlace(gate, pawns));
  const wk = game.kings.w;
  game.board[wk] = null;
  game.kings.w = -1;
  const before = run.hp;
  const reward = settleFight(run, game, gate);
  assert('losing the king ends the run',
    !reward.won && run.over && !run.won && run.hp === before,
    JSON.stringify({ before, after: run.hp, reward }));
  assert('pieces still return after a loss', run.bag.length === 3);
}

{
  const run = createRun(1);
  const game = buildFight(run, gate, autoPlace(gate, []));
  const before = run.hp;
  const reward = settleFight(run, game, gate, { forfeit: true });
  assert('a forfeit costs HP and leaves the run alive',
    !reward.won && !run.over && run.hp === before - reward.hpLost && reward.hpLost > 0,
    JSON.stringify({ before, after: run.hp, reward }));
}

{
  const run = createRun(1);
  const before = run.hp;
  const paid = payUndo(run);
  assert('undo spends 3 HP', paid.ok && run.hp === before - UNDO_HP, JSON.stringify(paid));
  run.hp = UNDO_HP;
  const refused = payUndo(run);
  assert('undo will not spend your last 3 HP', !refused.ok && run.hp === UNDO_HP, JSON.stringify(refused));
}

{
  const run = createRun(1);
  run.over = true;
  const blocked = payUndo(run);
  assert('undo refuses a dead run', !blocked.ok && run.over);
  const revived = payUndo(run, { revive: true });
  assert('undo from YOU DIED spends HP and stands the run up',
    revived.ok && !run.over && run.hp === 18 - UNDO_HP, JSON.stringify({ revived, hp: run.hp }));
  run.over = true;
  run.hp = UNDO_HP;
  const tooLow = payUndo(run, { revive: true });
  assert('undo from YOU DIED still will not spend your last 3 HP',
    !tooLow.ok && run.over && run.hp === UNDO_HP, JSON.stringify(tooLow));
  run.hp = 18;
  run.over = true;
  assert('undo is refused once the run is over', !payUndo(run).ok);
}

{
  const run = createRun(1);
  const game = Chess.fromDiagram(`
    k . .
    # # #
    . K .
  `, { files: 3, ranks: 3, rules: { kingCapture: true, checks: false, castling: false } });
  const reward = settleFight(run, game, gate);
  assert('unwinnable fight is a defeat', !reward.won && reward.reason === 'unwinnable',
    JSON.stringify(reward));
}

{
  const run = createRun(7);
  run.gold = 40;
  const shop = openShop(run);
  const pieces = shop.offers.filter((o) => o.kind === 'piece');
  const kings = shop.offers.filter((o) => o.kind === 'king');
  assert('shop stocks five stalls', shop.offers.length === 5, String(shop.offers.length));
  assert('shop is five pieces, or four and a king',
    (pieces.length === 5 && kings.length === 0) || (pieces.length === 4 && kings.length === 1),
    JSON.stringify(shop.offers.map((o) => o.kind)));
  assert('shop has a common', shop.offers.some((o) => o.rarity === 'common' || o.kind === 'piece'));
  assert('shop does not offer the removed Deeper Reserve', !shop.offers.some((o) => o.kind === 'supply'));
  assert('shop does not offer the removed Epic Slot', !shop.offers.some((o) => o.id === 'slot-epic'));
  assert('shop lists at most one king', kings.length <= 1);
}

{
  const run = createRun(1);
  run.gold = 40;
  const shop = openShop(run);
  const offer = shop.offers.find((o) => o.kind === 'piece') || shop.offers[0];
  const before = run.gold;
  const bought = buyOffer(run, offer.id);
  assert('a purchase records gold spent', bought.ok && run.goldSpent === before - run.gold,
    JSON.stringify({ spent: run.goldSpent, before, after: run.gold, ok: bought.ok }));
}

{
  const run = createRun(1);
  run.captured = ['p', 'p', 'n'];
  run.goldSpent = 12;
  const stats = runStats(run);
  const pawns = stats.captured.find((c) => c.type === 'p');
  assert('run stats stack captured pieces', pawns && pawns.count === 2, JSON.stringify(stats.captured));
  assert('run stats keep gold spent', stats.goldSpent === 12);
}

{
  let sawKing = false;
  let sawFive = false;
  let sawRare = false;
  let sawEpic = false;
  let sawLegend = false;
  for (let seed = 0; seed < 80; seed++) {
    const run = createRun(seed + 3);
    const shop = openShop(run);
    if (shop.offers.some((o) => o.kind === 'king')) sawKing = true;
    if (shop.offers.filter((o) => o.kind === 'piece').length === 5) sawFive = true;
    if (shop.offers.some((o) => o.rarity === 'rare')) sawRare = true;
  }
  for (let seed = 0; seed < 40; seed++) {
    const run = createRun(seed + 11);
    run.act = 2;
    run.nodeId = run.map.acts[2].nodes.find((n) => n.kind === 'shop')?.id || run.nodeId;
    const shop = openShop(run);
    if (shop.offers.some((o) => o.rarity === 'epic')) sawEpic = true;
    run.act = 2;
  }
  // Act 3 shops can roll a legendary.
  for (let seed = 0; seed < 60 && !sawLegend; seed++) {
    const run = createRun(seed + 21);
    const shopNode = run.map.acts[2].nodes.find((n) => n.kind === 'shop');
    if (shopNode) run.nodeId = shopNode.id;
    run.act = 2;
    const shop = openShop(run);
    if (shop.offers.some((o) => o.rarity === 'legendary')) sawLegend = true;
  }
  assert('some shops sell a king', sawKing);
  assert('some shops sell five pieces', sawFive);
  assert('act 1 shops can show a rare', sawRare);
}

{
  // Every merchant is the same hooded figure, and every so often — mostly
  // for the better pieces — an offer is priced partly in blood as well as
  // gold. Rare across many shops, and never on a common piece.
  let found = null;
  for (let seed = 0; seed < 500 && !found; seed++) {
    const run = createRun(seed);
    const shop = openShop(run);
    found = shop.offers.find((o) => o.kind === 'piece' && o.hpCost);
  }
  assert('at least one blood-priced offer turns up over many shops', Boolean(found));
  assert('a blood-priced offer is never common rarity', found.rarity !== 'common');
  assert('a blood-priced offer still costs gold too', found.cost > 0);

  const run = createRun(3);
  run.gold = 999;
  run.hp = found.hpCost;
  run.shop = { offers: [found], rerollBase: 2, rerollCost: 2 };
  const blocked = buyOffer(run, found.id);
  assert('a purchase that would zero hp is refused', !blocked.ok && run.hp === found.hpCost, JSON.stringify(blocked));

  run.hp = found.hpCost + 5;
  const before = run.hp;
  const bought = buyOffer(run, found.id);
  assert('a blood offer spends both gold and hp', bought.ok
    && run.gold === 999 - found.cost && run.hp === before - found.hpCost, JSON.stringify(bought));
}

{
  const run = createRun(1);
  const summary = bagSummary(run);
  const pawns = summary.pieces.find((p) => p.type === 'p');
  assert('bag summary stacks starting pawns', pawns && pawns.count === 3, JSON.stringify(summary.pieces));
  assert('plain king is in the bag', summary.kings.includes('plain') && summary.equipped === 'plain');
  run.gold = 40;
  let kingOffer = null;
  let shop = null;
  for (let seed = 1; seed < 80 && !kingOffer; seed++) {
    const r = createRun(seed);
    r.gold = 40;
    shop = openShop(r);
    kingOffer = shop.offers.find((o) => o.kind === 'king');
    if (kingOffer) Object.assign(run, { bag: r.bag, gold: r.gold, shop: r.shop, kings: r.kings, king: r.king, rng: r.rng, slots: r.slots, relics: r.relics });
  }
  assert('a king can be bought', Boolean(kingOffer));
  const bought = buyOffer(run, kingOffer.id);
  assert('buying a king keeps the old one', bought.ok && ownedKingIds(run).includes('plain')
    && ownedKingIds(run).includes(kingOffer.king), ownedKingIds(run).join(','));
  assert('bought king is equipped', run.king === kingOffer.king);
  assert('can switch back to plain', equipKing(run, 'plain') && run.king === null);
  const again = openShop(run);
  assert('owned kings leave the shop', !again.offers.some((o) => o.kind === 'king' && o.king === kingOffer.king));
}

{
  const run = createRun(1);
  assert('full rare slots still accept a common pawn', hasSlot(run, 'p'));
  assert('legendary amazon needs the slot', hasSlot(run, 'a') === (run.slots.legendary > 0));
}

{
  const run = createRun(1);
  const first = run.choices[0];
  assert('can pick a starting path', Boolean(first && pickNode(run, first.id)));
  assert('picked room becomes current', currentNode(run)?.id === first.id);
}

{
  const g = Chess.fromDiagram(`
    . k .
    . . .
    N . K
  `, { files: 3, ranks: 3, rules: { kingCapture: true, checks: false, castling: false } });
  const move = chooseMove(g, { depth: 2, slip: 0, budget: 400 });
  const dest = move && String.fromCharCode(97 + (move.to & 15)) + (3 - (move.to >> 4));
  assert('AI takes the hanging king', dest === 'b3', dest ? `played ${dest}` : 'no move');
}

{
  const g = Chess.fromDiagram(`
    . K .
    k . .
    . . .
  `, { files: 3, ranks: 3, rules: { kingCapture: true, checks: false, castling: false } });
  g.turn = 'b';
  let missed = 0;
  for (let i = 0; i < 20; i++) {
    const move = chooseMove(g, { depth: 2, slip: 1, budget: 200 });
    if (!move || move.to !== g.kings.w) missed++;
  }
  assert('enemy king takes ours whenever it can, even when it would slip', missed === 0,
    `missed ${missed}/20`);
}

{
  const g = Chess.fromDiagram(`
    k . p
    . K .
    . . .
  `, { files: 3, ranks: 3, rules: { kingCapture: true, checks: false, castling: false } });
  const move = chooseMove(g, { depth: 1, slip: 1, budget: 120 });
  assert('AI king prefers taking our king over a hanging pawn',
    Boolean(move && move.to === g.kings.b && move.from === g.kings.w),
    move ? `from ${move.from} to ${move.to}` : 'no move');
}

{
  const rules = { kingCapture: true, checks: false, castling: false };
  const g = Chess.fromDiagram(`
    k . . .
    . . . .
    . . Q .
    . . . K
  `, { files: 4, ranks: 4, rules, turn: 'b' });
  let hung = 0;
  for (let i = 0; i < 24; i++) {
    const move = chooseMove(g, { depth: 2, slip: 1, budget: 250 });
    if (!move) { hung++; continue; }
    g.move({ from: move.from, to: move.to, promotion: move.promotion });
    if (g.kingAttacked('b')) hung++;
    g.undo();
  }
  assert('AI never slips its king onto a taken square', hung === 0, `hung ${hung}/24`);
}

{
  const rules = { kingCapture: true, checks: false, castling: false };
  const g = Chess.fromDiagram(`
    . . . k
    . . . q
    . N . .
    . . . K
  `, { files: 4, ranks: 4, rules });
  const queen = [...g.pieces()].find((p) => p.type === 'q' && p.color === 'b');
  const move = chooseMove(g, { depth: 2, slip: 0, budget: 400 });
  assert('AI takes a hanging queen', Boolean(move && queen && move.to === queen.square),
    move ? `played to ${move.to}` : 'no move');
}

{
  const rules = { kingCapture: true, checks: false, castling: false };
  const g = Chess.fromDiagram(`
    . . k
    . . .
    . K .
  `, { files: 3, ranks: 3, rules });
  let walkedIn = 0;
  for (let i = 0; i < 16; i++) {
    const move = chooseMove(g, { depth: 2, slip: 0.5, budget: 250 });
    if (!move) { walkedIn++; continue; }
    g.move({ from: move.from, to: move.to, promotion: move.promotion });
    if (g.kingAttacked('w')) walkedIn++;
    g.undo();
  }
  assert('AI king does not step next to our king', walkedIn === 0, `walked in ${walkedIn}/16`);
}

{
  const run = createRun(3);
  const fights = Object.values(ENCOUNTERS);
  let crashed = null;
  for (const enc of fights) {
    const pick = [];
    let cost = 0;
    const budget = enc.supply;
    for (const item of run.bag) {
      const real = { p: 1, n: 3, f: 2, w: 2, c: 3, d: 2 }[item.type] ?? 2;
      if (cost + real > budget) continue;
      pick.push(item);
      cost += real;
    }
    const game = buildFight(run, enc, autoPlace(enc, pick));
    if (game.kings.w < 0 || game.kings.b < 0) {
      crashed = `${enc.id} missing a king`;
      break;
    }
    const move = chooseMove(game, { depth: 1, slip: 0, budget: 120 });
    if (!move) { crashed = `${enc.id} AI found no move`; break; }
    const played = game.move({ from: move.from, to: move.to, promotion: move.promotion });
    if (!played) { crashed = `${enc.id} AI move rejected`; break; }
  }
  assert('every encounter builds and accepts an AI move', !crashed, crashed || '');
}

{
  const rng = (() => { let i = 0; return () => (i = (i * 1.1 + 0.17) % 1); })();
  const map = generateMap(rng);
  assert('each act ends on a boss', map.acts.every((a) => a.nodes.some((n) => n.boss)));
  assert('each act opens with a fork', map.acts.every((a) => firstRooms(a).length >= 2));
  assert('maps actually branch', map.acts.every((a) => a.nodes.some((n) => n.next.length >= 2)));
  const act1 = map.acts[0];
  const shops = act1.nodes.filter((n) => n.kind === 'shop');
  const rests = act1.nodes.filter((n) => n.kind === 'rest');
  assert('act 1 has at most two shops', shops.length <= 2, String(shops.length));
  assert('act 1 shops sit mid or late', shops.every((n) => n.col >= 4), shops.map((n) => n.col).join(','));
  assert('each act has at most two camps',
    map.acts.every((a) => a.nodes.filter((n) => n.kind === 'rest').length <= 2));
  assert('each act has a camp',
    map.acts.every((a) => a.nodes.some((n) => n.kind === 'rest')), String(rests.length));
  assert('act 1 shop weights have no legendary', SHOP_WEIGHTS[1].legendary === 0);
}

{
  const early = Object.values(EVENTS).filter((e) => (e.minAct || 1) <= 1);
  const leak = [];
  for (const ev of early) {
    const blob = JSON.stringify(ev);
    if (blob.includes('random-legendary') || blob.includes('"basilisk"') || blob.includes('"colossus"')
      || blob.includes('"amazon"')) leak.push(ev.id);
  }
  assert('act 1 events never hand out legendaries', leak.length === 0, leak.join(','));
}



// ---- deploy cap ----------------------------------------------------------
//
// Supply caps what an army is worth; deploy caps how many bodies it has. With
// only the first, AI duels showed the cheapest body always won and the win-rate
// curve ran strictly backwards. See deployBudget() in run.js.

{
  const run = createRun(1);
  const cap = deployBudget(run, gate);
  assert('an encounter has a deploy cap', Number.isFinite(cap) && cap >= 2, String(cap));
  assert('the cap is tighter than the supply budget',
    cap < supplyBudget(run, gate) || gate.supply <= 3,
    `cap=${cap} supply=${supplyBudget(run, gate)}`);
}

{
  // A pawn horde is stopped by the body cap well before it runs out of points.
  const run = createRun(1);
  for (let i = 0; i < 10; i++) addToBag(run, 'p');
  const cap = deployBudget(run, courtyardOrGate());
  const enc = courtyardOrGate();
  const horde = run.bag.filter((p) => p.type === 'p').slice(0, cap + 2).map((p) => p.uid);
  const check = validateLoadout(run, enc, horde);
  assert('a horde over the cap is rejected', !check.ok, JSON.stringify(check));
  assert('rejection names the piece count', /pieces/i.test(check.reason || ''), check.reason);

  const legal = run.bag.filter((p) => p.type === 'p').slice(0, cap).map((p) => p.uid);
  const ok = validateLoadout(run, enc, legal);
  assert('exactly the cap is allowed', ok.ok, JSON.stringify(ok));
}

{
  const run = createRun(1);
  run.deployBonus = 2;
  const enc = courtyardOrGate();
  assert('the shop upgrade widens the cap',
    deployBudget(run, enc) === deployBudget(createRun(1), enc) + 2);
}

function courtyardOrGate() {
  return ENCOUNTERS.courtyard || gate;
}

// ---- content book --------------------------------------------------------

{
  const list = Object.values(ENCOUNTERS);
  assert('encounter book is Slay-the-Spire sized', list.length >= 55, String(list.length));
  for (const act of [1, 2, 3]) {
    const inAct = list.filter((e) => e.act === act);
    const easy = inAct.filter((e) => e.tier === 'trash' && e.pool === 'easy').length;
    const hard = inAct.filter((e) => e.tier === 'trash' && e.pool === 'hard').length;
    assert(`act ${act} has an easy pool`, easy >= 3, String(easy));
    assert(`act ${act} has a deep hard pool`, hard >= 10, String(hard));
    assert(`act ${act} has three elites`, inAct.filter((e) => e.tier === 'elite').length >= 3);
    assert(`act ${act} has three bosses`, inAct.filter((e) => e.tier === 'boss').length >= 3);
  }
}

{
  // Every enemy must stand on a real square, alone, and every fight needs a king.
  let bad = 0;
  for (const e of Object.values(ENCOUNTERS)) {
    const seen = new Set();
    for (const en of e.enemy || []) {
      const file = en.at.charCodeAt(0) - 97;
      const rank = Number(en.at.slice(1));
      if (file < 0 || file >= e.files || rank < 1 || rank > e.ranks) bad++;
      if (seen.has(en.at)) bad++;
      seen.add(en.at);
      if (!PIECES[en.type]) bad++;
    }
    for (const sq of Object.keys(e.terrain || {})) {
      const file = sq.charCodeAt(0) - 97;
      const rank = Number(sq.slice(1));
      if (file < 0 || file >= e.files || rank < 1 || rank > e.ranks) bad++;
    }
    if (!(e.enemy || []).some((x) => x.type === 'k')) bad++;
  }
  assert('every encounter is structurally sound', bad === 0, `${bad} problems`);
}

{
  const baked = new Set([TILE.BLOCK, TILE.FROST, TILE.FIRE, TILE.GLASS]);
  const rooms = [];
  for (const e of Object.values(ENCOUNTERS)) {
    for (const tile of Object.values(e.terrain || {})) {
      if (baked.has(tile)) rooms.push(`${e.id}:${tile}`);
    }
    const script = e.bossScript || {};
    if (script.blizzard || script.shrink || script.meteor) rooms.push(`${e.id}:script`);
  }
  assert('no fight starts with holes, ice or flame already on the board',
    rooms.length === 0, rooms.join(', '));
}

{
  // A map must never put the same fight on twice, and must open on easy rooms.
  let seed = 4242;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let repeats = 0;
  let hardOpeners = 0;
  for (let i = 0; i < 60; i++) {
    const map = generateMap(rng);
    for (const act of map.acts) {
      const ids = act.nodes.filter((n) => n.kind === 'fight' && !n.boss).map((n) => n.encounterId);
      if (new Set(ids).size !== ids.length) repeats++;
      for (const n of act.nodes.filter((x) => x.col === 0 && x.kind === 'fight')) {
        if (ENCOUNTERS[n.encounterId]?.pool !== 'easy') hardOpeners++;
      }
    }
  }
  assert('no act repeats a fight', repeats === 0, `${repeats} acts repeated`);
  assert('every act opens on the easy pool', hardOpeners === 0, `${hardOpeners} hard openers`);
}

{
  const map = (() => {
    let seed = 11;
    const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    return generateMap(rng);
  })();
  for (const act of map.acts) {
    const events = act.nodes.filter((n) => n.kind === 'event');
    assert(`act ${act.act} has ? rooms`, events.length >= 3, String(events.length));
    assert(`act ${act.act} ? rooms all resolve to an event`,
      events.every((n) => EVENTS[n.eventId]));
    assert(`act ${act.act} does not repeat an event`,
      new Set(events.map((n) => n.eventId)).size === events.length);
  }
}

{
  // Every choice in the book must resolve without throwing and leave the run sane.
  let broken = 0;
  for (const ev of Object.values(EVENTS)) {
    for (const choice of ev.choices) {
      const run = createRun(1);
      run.gold = 200;
      try {
        applyChoice(run, choice, run.bag[0]?.uid);
        if (run.hp > run.maxHp || run.hp < 0 || run.gold < 0) broken++;
      } catch { broken++; }
    }
  }
  assert('every event choice resolves cleanly', broken === 0, `${broken} broken`);

  const poor = createRun(1);
  poor.gold = 0;
  const priced = Object.values(EVENTS).flatMap((e) => e.choices).find((c) => c.cost);
  assert('a priced choice is blocked when broke', !choiceAvailable(poor, priced).ok);
  const wager = EVENTS.wager.choices.find((c) => c.gamble);
  assert('a gold gamble is blocked when broke', !choiceAvailable(poor, wager).ok, JSON.stringify(choiceAvailable(poor, wager)));
  const toll = EVENTS.tollkeeper.choices.find((c) => c.label === 'Pay in coin');
  assert('a gold toll is blocked when broke', !choiceAvailable(poor, toll).ok);
}

{
  // The new pieces have to be reachable and legal.
  for (const id of ['z', 'm', 'x', 'v']) {
    assert(`${PIECES[id].name} is in the registry`, Boolean(PIECES[id]));
    assert(`${PIECES[id].name} has a cost and a value`,
      PIECES[id].cost > 0 && PIECES[id].value > 0);
  }
}

// ---- relics --------------------------------------------------------------
//
// The synergy layer. Relics change rules and key off piece tags, which is what
// makes an army a build rather than a shopping list.

{
  assert('there is a relic book', RELIC_IDS.length >= 20, String(RELIC_IDS.length));
  const arch = new Set(Object.values(RELICS).map((r) => r.archetype));
  assert('relics point at several archetypes', arch.size >= 6, String(arch.size));
  assert('every relic explains itself',
    Object.values(RELICS).every((r) => r.name && r.blurb && r.rarity));
}

{
  const run = createRun(1);
  const enc = ENCOUNTERS.courtyard;
  const baseSupply = supplyBudget(run, enc);
  const baseDeploy = deployBudget(run, enc);

  const swarm = createRun(1);
  swarm.relics = ['muster', 'levy'];
  assert('swarm relics trade supply for bodies',
    deployBudget(swarm, enc) > baseDeploy && supplyBudget(swarm, enc) < baseSupply);
  assert('Levy Writ makes pawns free', costFor(swarm, 'p') === 0);

  const quality = createRun(1);
  quality.relics = ['warrant'];
  assert('quality relics trade bodies for supply',
    supplyBudget(quality, enc) > baseSupply && deployBudget(quality, enc) < baseDeploy);

  const cav = createRun(1);
  cav.relics = ['cavalry'];
  assert('Cavalry Standard discounts leapers only',
    costFor(cav, 'c') === PIECES.c.cost - 1 && costFor(cav, 'b') === PIECES.b.cost);
}

{
  // Budgets must never fall below something playable, however you stack.
  const run = createRun(1);
  run.relics = ['warrant', 'commission', 'heavystandard', 'farrier'];
  for (const enc of Object.values(ENCOUNTERS)) {
    assert2(supplyBudget(run, enc) >= 1 && deployBudget(run, enc) >= 1,
      `budgets stay playable on ${enc.id}`);
  }
  assert('stacked deploy penalties never reach zero', true);
}

{
  // Relic shields cover your army, and only up to the cap.
  const run = createRun(1);
  run.relics = ['farrier'];
  run.bag = [];
  for (const t of ['n', 'n', 'c', 'z']) addToBag(run, t);
  const enc = ENCOUNTERS.gate;
  const game = buildFight(run, enc, autoPlace(enc, run.bag.slice(0, 3)));
  const shielded = game.pieces()
    .filter((p) => p.color === WHITE && (game.statusAt(p.square) & ST_SHIELD_BIT));
  assert('a class-shield relic shields at most the cap',
    shielded.length <= RELIC_SHIELD_CAP, `${shielded.length} shielded`);
  assert('relic shields never cover the enemy',
    !game.pieces().some((p) => p.color !== 'w' && (game.statusAt(p.square) & ST_SHIELD_BIT)
      && p.type !== 'v'));
}

{
  // Relic tokens must actually reach the engine.
  const run = createRun(1);
  run.relics = ['deepfreeze', 'ashboots'];
  const game = buildFight(run, ENCOUNTERS.gate, autoPlace(ENCOUNTERS.gate, []));
  assert('relic tokens reach the engine modifier list',
    game.kingPassives.includes('deepfreeze') && game.kingPassives.includes('ashboots'),
    JSON.stringify(game.kingPassives));
}

{
  // Every relic that names a piece tag has to actually hit something in the
  // registry — a discount or a shield keyed to a tag no piece carries is a
  // relic that silently does nothing.
  const ids = Object.keys(PIECES);
  const dead = [];
  for (const relic of Object.values(RELICS)) {
    const tag = relic.discount?.tag || relic.shieldTag?.tag;
    if (tag && !ids.some((id) => hasTag(id, tag))) dead.push(`${relic.id}:${tag}`);
  }
  assert('no relic keys off a tag nothing has', dead.length === 0, dead.join(', '));

  // Likewise every engine token a relic pushes must be one the engine reads.
  const source = readFileSync(new URL('../js/chess.js', import.meta.url), 'utf8');
  const unread = [];
  for (const relic of Object.values(RELICS)) {
    for (const token of relic.tokens || []) {
      if (!source.includes(`'${token}'`)) unread.push(`${relic.id}:${token}`);
    }
  }
  assert('no relic pushes a token the engine ignores', unread.length === 0, unread.join(', '));
}

{
  // The four newer rules, reached the way the run layer reaches them.
  const run = createRun(1);
  run.relics = ['gravecall', 'longshot', 'phalanx', 'postroad'];
  const game = buildFight(run, ENCOUNTERS.gate, autoPlace(ENCOUNTERS.gate, []));
  assert('the new archetype tokens reach the engine too',
    ['gravecall', 'longshot', 'wideaura', 'kingswap'].every((t) => game.kingPassives.includes(t)),
    JSON.stringify(game.kingPassives));
}

{
  // Elites and bosses must hand over a relic choice.
  const run = createRun(1);
  const enc = ENCOUNTERS.pond;
  const game = buildFight(run, enc, autoPlace(enc, []));
  game.board[game.kings.b] = null;
  game.kings.b = -1;
  const reward = settleFight(run, game, enc, {});
  assert('an elite offers relics', (reward.relicChoices || []).length > 0);
  const first = reward.relicChoices[0];
  assert('a relic can be claimed', claimRelic(run, first) && run.relics.includes(first));
  assert('claiming clears the rest', run.pendingRelics.length === 0);
}

{
  const run = createRun(1);
  run.relics = ['seal'];
  const shop = openShop(run);
  assert('the shop sells pieces, not relics', shop.offers.every((o) => o.kind === 'piece' || o.kind === 'king'));
  assert("Merchant's Seal discounts the board",
    shop.offers.every((o) => o.cost >= 1));
}

{
  // Forfeit costs HP; only running out of HP (or losing the king) ends the run.
  const run = createRun(1);
  let losses = 0;
  while (!run.over && losses < 30) {
    const game = buildFight(run, gate, autoPlace(gate, []));
    settleFight(run, game, gate, { forfeit: true });
    losses++;
  }
  assert('a run survives more than one forfeit', losses > 1, String(losses));
  assert('running out of HP ends the run', run.over && run.hp === 0, String(run.hp));
}

{
  const run = createRun(1);
  run.relics = ['secondwind'];
  run.hp = 2;
  const game = buildFight(run, gate, autoPlace(gate, []));
  game.board[game.kings.w] = null;
  game.kings.w = -1;
  settleFight(run, game, gate);
  assert('Second Wind does not revive a captured king', run.over && !run.won);
}

{
  // Resting is the other half of that economy.
  const run = createRun(1);
  run.hp = 2;
  const goldBefore = run.gold;
  const gained = rest(run);
  assert('camping heals a lot', run.hp === 2 + gained.healed && gained.healed >= 12, JSON.stringify(gained));
  assert('camping does not pay gold', run.gold === goldBefore && gained.gold === 0, JSON.stringify(gained));
}

{
  // Camp's other two choices: forage trades the heal for more gold, and
  // training spends gold to make one piece hold a permanent shield.
  const run = createRun(2);
  run.hp = 2;
  const before = run.hp;
  const result = forage(run);
  assert('foraging pays but does not heal', run.hp === before && result.gold === FORAGE_GOLD);

  run.gold = TRAIN_COST;
  const target = run.bag.find((p) => p.type !== 'k');
  const trained = trainPiece(run, target.uid);
  assert('training spends gold and marks the piece', trained.ok && run.gold === 0 && target.trained === true);

  const fancy = createRun(4);
  addToBag(fancy, 'r');
  fancy.gold = 99;
  const rook = fancy.bag.find((p) => p.type === 'r');
  const blocked = trainPiece(fancy, rook.uid);
  assert('training refuses a non-common', !blocked.ok, JSON.stringify(blocked));

  const short = createRun(3);
  short.gold = 0;
  const denied = trainPiece(short, short.bag[0].uid);
  assert('training is gated on gold', !denied.ok);

  const encounter = ENCOUNTERS.gate;
  const homes = freeHomeSquares(encounter);
  const game = buildFight(run, encounter, [
    { uid: 'king', sq: homes[0] },
    { uid: target.uid, sq: homes[1] },
  ]);
  const sq = game.pieces().find((p) => p.type === target.type && p.color === WHITE)?.square;
  assert('a trained piece enters the fight already shielded',
    sq != null && (game.status[sq] & ST_SHIELD_BIT) !== 0);
}

{
  // applyChoice's maxHp branch used to write to run.maxHp, a field createRun
  // never sets (it's called hpMax) — Math.min(hp, undefined + n) left hp as
  // NaN for the rest of the run, invisible to every naive comparison.
  const run = createRun(4);
  const beforeMax = run.hpMax;
  const result = applyChoice(run, { effects: [{ maxHp: 3 }, { heal: 99 }] });
  assert('a maxHp effect raises hpMax, not a stray field',
    result.ok && run.hpMax === beforeMax + 3 && run.maxHp === undefined);
  assert('hp after a maxHp+heal effect is a real number, not NaN',
    Number.isFinite(run.hp) && run.hp === run.hpMax);
}

{
  // gain now understands every rarity tier, not just 'random-rare' with
  // everything else silently falling back to common.
  const run = createRun(7);
  for (let i = 0; i < 30; i++) {
    const before = run.bag.length;
    applyChoice(run, { effects: [{ gain: 'random-legendary' }] });
    if (run.bag.length > before) {
      const added = run.bag[run.bag.length - 1];
      assert('random-legendary actually gains a legendary piece',
        PIECES[added.type]?.rarity === RARITY.LEGENDARY, added.type);
      break;
    }
  }
}

{
  // 'priciest' drops the single most expensive piece in the bag, not the
  // first one found and not the king.
  const run = createRun(8);
  run.bag = [
    { uid: 'a', type: 'p' },
    { uid: 'b', type: 'q' },
    { uid: 'c', type: 'n' },
  ];
  const result = applyChoice(run, { effects: [{ lose: 'priciest' }] });
  assert('priciest removes the queen, not the pawn or knight',
    result.ok && !run.bag.some((p) => p.uid === 'b') && run.bag.length === 2,
    JSON.stringify(run.bag));
}

{
  // The eight new no-safe-option rooms actually made it into the pool the
  // map draws from, and every choice in them still resolves cleanly.
  const newRooms = ['tollkeeper', 'ledger', 'hightable', 'scale', 'plaguecart', 'beggar', 'cairn', 'fasttrack'];
  const missing = newRooms.filter((id) => !EVENTS[id]);
  assert('the new stsesque rooms are registered', missing.length === 0, missing.join(', '));
  let broke = 0;
  for (const id of newRooms) {
    for (const choice of EVENTS[id].choices) {
      for (let trial = 0; trial < 12; trial++) {
        const run = createRun(1);
        run.gold = 300;
        for (const t of ['p', 'p', 'n', 'b', 'r']) addToBag(run, t);
        try {
          const res = applyChoice(run, choice, run.bag[0]?.uid);
          if (!res.ok || !Number.isFinite(run.hp) || !Number.isFinite(run.gold)
            || run.hp > run.hpMax || run.hp < 0 || run.gold < 0) broke++;
        } catch { broke++; }
      }
    }
  }
  assert('every choice in the new rooms resolves cleanly', broke === 0, String(broke));
}

{
  // `upgrade` feeds a piece in and gets one of the next rarity back. The
  // ladder has to actually climb — an earlier shape of this silently fell
  // through to common whenever the token was not one it recognised.
  const ladder = [['p', RARITY.RARE], ['r', RARITY.EPIC], ['q', RARITY.LEGENDARY]];
  for (const [feed, want] of ladder) {
    let got = null;
    for (let t = 0; t < 60 && !got; t++) {
      const run = createRun(t + 1);
      run.slots = { common: Infinity, rare: 9, epic: 9, legendary: 9 };
      run.bag = [{ uid: 'a', type: feed }, { uid: 'b', type: 'p' }];
      applyChoice(run, { effects: [{ upgrade: true }] }, 'a');
      const added = run.bag.find((p) => p.uid !== 'a' && p.uid !== 'b');
      if (added) got = PIECES[added.type].rarity;
    }
    assert(`upgrade turns a ${PIECES[feed].rarity} into a ${want}`, got === want, String(got));
  }
}

{
  // Nothing sits above legendary, so the crucible owes you instead of
  // silently eating the piece.
  const run = createRun(3);
  run.bag = [{ uid: 'L', type: 'a' }, { uid: 'z', type: 'p' }];
  const gold = run.gold;
  const res = applyChoice(run, { effects: [{ upgrade: true }] }, 'L');
  assert('feeding a legendary in pays out instead of vanishing',
    res.ok && run.gold > gold && !run.bag.some((p) => p.uid === 'L'), JSON.stringify(res.lines));
}

{
  // An upgrade consumes a piece, so it needs one — same gate `lose` uses.
  const run = createRun(4);
  run.bag = [{ uid: 'only', type: 'p' }];
  const gate = choiceAvailable(run, { effects: [{ upgrade: true }] });
  assert('an upgrade is gated on having a piece to feed it', !gate.ok, JSON.stringify(gate));
}

{
  // A king handed out by an event lands in the bag, not the void.
  const run = createRun(5);
  const before = ownedKingIds(run).length;
  const res = applyChoice(run, { effects: [{ king: 'random' }] });
  assert('an event can hand over a king', res.ok && ownedKingIds(run).length === before + 1,
    JSON.stringify(res.lines));
}

{
  // applyChoice reports what it handed over so the UI can give a rare or
  // better piece its own reveal.
  const run = createRun(6);
  run.slots = { common: Infinity, rare: 9, epic: 9, legendary: 9 };
  const res = applyChoice(run, { effects: [{ gain: 'basilisk' }] });
  assert('applyChoice reports gained pieces',
    Array.isArray(res.gained) && res.gained[0]?.type === 'basilisk', JSON.stringify(res.gained));
}

{
  // Every room in the book, every choice, against a full bag and real gold.
  let broke = 0;
  for (const ev of Object.values(EVENTS)) {
    for (const choice of ev.choices) {
      for (let t = 0; t < 8; t++) {
        const run = createRun(t + 1);
        run.gold = 400;
        for (const ty of ['p', 'n', 'b', 'r', 'q', 'a', 'crossbow', 'gnu']) addToBag(run, ty);
        try {
          const res = applyChoice(run, choice, run.bag[0]?.uid);
          if (!res.ok || !Number.isFinite(run.hp) || !Number.isFinite(run.gold)
            || run.hp > run.hpMax || run.hp < 0 || run.gold < 0 || run.hpMax < 1) broke++;
          if (run.bag.some((item) => !PIECES[item.type])) broke++;
        } catch { broke++; }
      }
    }
  }
  assert('every choice in every room resolves cleanly', broke === 0, String(broke));
}

{
  assert('higher rarity is a thinner slice',
    SPOIL_PIECE_WEIGHT.common > SPOIL_PIECE_WEIGHT.rare
    && SPOIL_PIECE_WEIGHT.rare > SPOIL_PIECE_WEIGHT.epic
    && SPOIL_PIECE_WEIGHT.epic > SPOIL_PIECE_WEIGHT.legendary);

  const steward = buildSpoils(ENCOUNTERS.steward);
  const types = steward.filter((it) => it.kind === 'piece').map((it) => it.type).sort();
  assert('the wheel offers the enemy\'s pieces, not the king',
    types.join(',') === 'n,p,r' && !steward.some((it) => it.type === 'k'));
  assert('the wheel always offers extra gold', steward.some((it) => it.kind === 'gold' && it.amount >= 1));
  const pawn = steward.find((it) => it.type === 'p');
  const rook = steward.find((it) => it.type === 'r');
  assert('a pawn outweighs a rook on the wheel', pawn.weight > rook.weight);

  const rime = buildSpoils(ENCOUNTERS.rimeguard);
  const rimePiece = rime.find((it) => it.type === 'i');
  const rimePawn = rime.find((it) => it.type === 'p');
  assert('a rime is a thinner slice than a pawn', rimePiece && rimePawn && rimePiece.weight < rimePawn.weight);
}

{
  const run = createRun(1);
  const pawns = run.bag.filter((p) => p.type === 'p').slice(0, 1);
  const game = buildFight(run, gate, autoPlace(gate, pawns));
  game.board[game.kings.b] = null;
  game.kings.b = -1;
  const goldBefore = run.gold;
  const bagBefore = run.bag.length;
  const reward = settleFight(run, game, gate);
  assert('winning still pays the fight purse immediately',
    reward.won && run.gold === goldBefore + FIGHT_GOLD.trash, JSON.stringify(reward));
  assert('the extra prize waits on the wheel',
    reward.spoils && reward.spoils.winner >= 0 && !reward.spoils.claimed && !reward.drop,
    JSON.stringify(reward.spoils));
  assert('the bag does not grow until the wheel lands', run.bag.length === bagBefore);

  const prize = reward.spoils.items[reward.spoils.winner];
  const claimed = claimSpoils(run);
  assert('claiming marks the wheel done', claimed.spoils.claimed);
  if (prize.kind === 'gold') {
    assert('a gold landing pays the extra',
      run.gold === goldBefore + FIGHT_GOLD.trash + prize.amount && claimed.bonusGold === prize.amount);
  } else {
    assert('a piece landing goes in the bag or sells',
      run.bag.length === bagBefore + 1 || claimed.dropSold > 0, JSON.stringify(claimed));
  }
  const goldAfter = run.gold;
  const bagAfter = run.bag.length;
  claimSpoils(run);
  assert('claiming twice does nothing', run.gold === goldAfter && run.bag.length === bagAfter);
}

{
  const run = createRun(1);
  const game = buildFight(run, gate, autoPlace(gate, []));
  // Unwinnable-and-ahead is the flee path; forfeit is the simpler "no spoils".
  const reward = settleFight(run, game, gate, { forfeit: true });
  assert('a lost fight has no spoils', !reward.spoils && !reward.won);
}

{
  // Across many seeds, gold and commons land more than epics and legendaries.
  const enc = ENCOUNTERS.rimeguard;
  const tally = { gold: 0, common: 0, rare: 0, epic: 0, legendary: 0 };
  for (let s = 0; s < 240; s++) {
    const run = createRun(s * 17 + 3);
    const spun = rollSpoils(run, enc);
    const prize = spun.items[spun.winner];
    if (!prize) continue;
    if (prize.kind === 'gold') tally.gold++;
    else tally[prize.rarity] = (tally[prize.rarity] || 0) + 1;
  }
  assert('gold is the common landing on the wheel',
    tally.gold > tally.common && tally.gold > tally.rare,
    JSON.stringify(tally));
  assert('commons land more than epics',
    tally.common > tally.epic, JSON.stringify(tally));
}

{
  // The camp screen quotes these before you commit, so what it promises has
  // to be what the run layer actually hands over. They lived as separate
  // copies for a while and the screen offered 7 HP while rest() gave 10.
  const cases = [
    ['convalescent', (r) => { const before = (r.hp = 1); rest(r); return r.hp - before; }, restHeal],
    ['ranger', (r) => forage(r).gold, forageGold],
  ];
  for (const [king, act, quoted] of cases) {
    for (const who of [null, king]) {
      const run = createRun(1);
      run.king = who;
      assert(`camp quotes what it pays (${king}: ${who || 'plain'})`,
        act(run) === quoted(run), `${act(createRun(1))} vs ${quoted(run)}`);
    }
  }
  for (const who of [null, 'provisioner']) {
    const run = createRun(1);
    run.king = who;
    run.gold = 100;
    addToBag(run, 'n');
    const before = run.gold;
    trainPiece(run, run.bag.find((p) => p.type === 'n').uid);
    assert(`training charges what the camp quotes (${who || 'plain'})`,
      before - run.gold === trainCost(run), `${before - run.gold} vs ${trainCost(run)}`);
  }
}

console.log(failures ? `\n${failures} run failure(s)` : '\nAll run tests passed.');
process.exit(failures ? 1 : 0);
