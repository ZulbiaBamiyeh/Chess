// Run layer: bag, slots, supply, loadout, settlement, shop.
// Run with: node test/run.mjs

import { WHITE, FLAG } from '../js/chess.js';
import {
  createRun, validateLoadout, buildFight, settleFight, addToBag, hasSlot,
  occupiedSlots, supplyBudget, openShop, buyOffer, autoPlace, currentNode,
  advance,
} from '../js/run.js';
import { ENCOUNTERS, homeSquares } from '../js/content.js';
import { chooseMove } from '../js/ai.js';
import { Chess } from '../js/chess.js';

let failures = 0;
function assert(name, cond, detail = '') {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const gate = ENCOUNTERS[0];
const alley = ENCOUNTERS[1];

{
  const run = createRun(1);
  assert('starting bag is six pieces plus an implicit king', run.bag.length === 6);
  const used = occupiedSlots(run);
  assert('starting bag fits common slots', used.common <= run.slots.common);
  assert('starts with 3 hearts', run.hearts === 3);
  assert('gate supply is 6 + bonus 0', supplyBudget(run, gate) === 6);
}

{
  const run = createRun(1);
  const cheap = run.bag.filter((p) => p.type === 'p').slice(0, 2).map((p) => p.uid);
  const ok = validateLoadout(run, gate, cheap);
  assert('two pawns fit a supply-6 fight', ok.ok && ok.cost === 2, JSON.stringify(ok));

  const everything = run.bag.map((p) => p.uid);
  const fat = validateLoadout(run, alley, everything);
  assert('full bag exceeds alley supply 5', !fat.ok, JSON.stringify(fat));
}

{
  const run = createRun(1);
  const pawns = run.bag.filter((p) => p.type === 'p').slice(0, 2);
  const places = autoPlace(gate, pawns);
  assert('auto-place includes the king', places.some((p) => p.uid === 'king'));
  assert('auto-place stays on home squares', places.every((p) => homeSquares(4, 4).includes(p.sq)));
  const game = buildFight(run, gate, places);
  assert('fight is 4×4 king-capture', game.files === 4 && game.ranks === 4 && game.rules.kingCapture);
  assert('both kings present', game.kings.w >= 0 && game.kings.b >= 0);
  assert('white to move', game.turn === WHITE);
  assert('enemy ferz is on the board', game.pieces().some((p) => p.type === 'f' && p.color === 'b'));
}

{
  const run = createRun(1);
  const before = run.bag.length;
  const pawns = run.bag.filter((p) => p.type === 'p').slice(0, 1);
  const game = buildFight(run, gate, autoPlace(gate, pawns));
  // Capture the black king with a fabricated outcome by removing it.
  const bk = game.kings.b;
  game.board[bk] = null;
  game.kings.b = -1;
  const reward = settleFight(run, game, gate);
  assert('winning pays gold from remaining army', reward.won && reward.gold >= 2, JSON.stringify(reward));
  assert('captured pieces return to the bag', run.bag.length === before, `bag=${run.bag.length}`);
  assert('deployed list is cleared', run.deployed.length === 0);
}

{
  const run = createRun(1);
  const pawns = run.bag.filter((p) => p.type === 'p').slice(0, 1);
  const game = buildFight(run, gate, autoPlace(gate, pawns));
  const wk = game.kings.w;
  game.board[wk] = null;
  game.kings.w = -1;
  const reward = settleFight(run, game, gate);
  assert('losing costs a heart', !reward.won && run.hearts === 2, JSON.stringify(reward));
  assert('pieces still return after a loss', run.bag.length === 6);
}

{
  const run = createRun(7);
  run.gold = 40;
  const shop = openShop(run);
  assert('shop has piece offers', shop.offers.some((o) => o.kind === 'piece'));
  assert('shop always offers a supply upgrade', shop.offers.some((o) => o.kind === 'supply'));
  const piece = shop.offers.find((o) => o.kind === 'piece');
  if (piece) {
    const bag = run.bag.length;
    const bought = buyOffer(run, piece.id);
    assert('buying a piece spends gold and fills the bag', bought.ok && run.bag.length === bag + 1);
  }
  const supply = run.shop.offers.find((o) => o.kind === 'supply');
  const before = run.supplyBonus;
  const up = buyOffer(run, supply.id);
  assert('buying supply raises the persistent bonus', up.ok && run.supplyBonus === before + 1);
}

{
  const run = createRun(1);
  run.slots.common = 6;
  // Fill common slots.
  while (occupiedSlots(run).common < run.slots.common) addToBag(run, 'p');
  assert('full common slots reject another pawn', !hasSlot(run, 'p'));
  assert('full common slots still accept an uncommon rook', hasSlot(run, 'r'));
}

{
  const run = createRun(1);
  assert('first node is the gate', currentNode(run).id === 'gate');
  advance(run);
  assert('second node is the alley', currentNode(run).id === 'alley');
}

{
  // AI should take a hanging king on a tiny board.
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
  // Play the Gate to completion with the engine AI on both sides so a
  // real encounter cannot livelock the search.
  const run = createRun(99);
  const pawns = run.bag.filter((p) => p.type === 'p').slice(0, 2);
  const knight = run.bag.find((p) => p.type === 'n');
  const game = buildFight(run, gate, autoPlace(gate, [knight, ...pawns].filter(Boolean)));
  let plies = 0;
  const cap = 80;
  while (!game.isGameOver() && plies < cap) {
    const move = chooseMove(game, { depth: 2, slip: 0, budget: 250 });
    if (!move) break;
    const played = game.move({ from: move.from, to: move.to, promotion: move.promotion });
    if (!played) break;
    plies++;
  }
  const out = game.outcome();
  assert('gate AI-vs-AI finishes', out.over && plies < cap, JSON.stringify({ plies, out }));
}

console.log(failures ? `\n${failures} run failure(s)` : '\nAll run tests passed.');
process.exit(failures ? 1 : 0);
