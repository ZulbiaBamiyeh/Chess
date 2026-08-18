// Run layer: bag, slots, supply, loadout, settlement, shop, map.
// Run with: node test/run.mjs

import { WHITE } from '../js/chess.js';
import {
  createRun, validateLoadout, buildFight, settleFight, addToBag, hasSlot,
  occupiedSlots, supplyBudget, openShop, buyOffer, autoPlace, currentNode,
  completeNode, pickNode, rest, currentEncounter,
  bagSummary, equipKing, ownedKingIds,
} from '../js/run.js';
import { ENCOUNTERS, homeSquares, generateMap, SHOP_WEIGHTS, firstRooms } from '../js/content.js';
import { chooseMove } from '../js/ai.js';
import { Chess } from '../js/chess.js';
import { RARITY } from '../js/pieces.js';

let failures = 0;
function assert(name, cond, detail = '') {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const gate = ENCOUNTERS.gate;
const alley = ENCOUNTERS.alley;

{
  const run = createRun(1);
  assert('starting bag is six pieces', run.bag.length === 6);
  assert('commons are uncapped', run.slots.common === Infinity);
  assert('one legendary slot', run.slots.legendary === 1);
  assert('starts with 18 HP', run.hp === 18);
  assert('map has three acts', run.map.acts.length === 3);
  assert('start offers a fork', run.choices.length >= 2, String(run.choices.length));
  assert('start rooms are fights', run.choices.every((n) => n.kind === 'fight'));
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
  assert('fight is 4×4 king-capture', game.files === 4 && game.ranks === 4 && game.rules.kingCapture);
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
  assert('winning pays gold', reward.won && reward.gold >= 2, JSON.stringify(reward));
  assert('captured pieces return to the bag', run.bag.length >= before);
}

{
  const run = createRun(1);
  const pawns = run.bag.filter((p) => p.type === 'p').slice(0, 1);
  const game = buildFight(run, gate, autoPlace(gate, pawns));
  const wk = game.kings.w;
  game.board[wk] = null;
  game.kings.w = -1;
  const reward = settleFight(run, game, gate);
  assert('losing ends the run', !reward.won && run.over, JSON.stringify(reward));
  assert('pieces still return after a loss', run.bag.length === 6);
}

{
  const run = createRun(1);
  const game = Chess.fromDiagram(`
    k . .
    # # #
    . K .
  `, { files: 3, ranks: 3, rules: { kingCapture: true, checks: false, castling: false } });
  const reward = settleFight(run, game, gate);
  assert('unwinnable fight is a defeat', !reward.won && run.over && reward.reason === 'unwinnable',
    JSON.stringify(reward));
}

{
  const run = createRun(7);
  run.gold = 40;
  const shop = openShop(run);
  assert('shop has a common', shop.offers.some((o) => o.rarity === 'common'));
  assert('shop offers supply', shop.offers.some((o) => o.kind === 'supply'));
  assert('shop offers a king', shop.offers.some((o) => o.kind === 'king'));
  assert('shop lists at most two kings', shop.offers.filter((o) => o.kind === 'king').length <= 2);
}

{
  const run = createRun(1);
  const summary = bagSummary(run);
  const pawns = summary.pieces.find((p) => p.type === 'p');
  assert('bag summary stacks starting pawns', pawns && pawns.count === 3, JSON.stringify(summary.pieces));
  assert('plain king is in the bag', summary.kings.includes('plain') && summary.equipped === 'plain');
  run.gold = 40;
  const shop = openShop(run);
  const kingOffer = shop.offers.find((o) => o.kind === 'king');
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
  assert('act 1 shop weights have no legendary', SHOP_WEIGHTS[1].legendary === 0);
}

console.log(failures ? `\n${failures} run failure(s)` : '\nAll run tests passed.');
process.exit(failures ? 1 : 0);
