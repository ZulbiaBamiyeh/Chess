// Variant mechanics: king-capture, variable boards, terrain, fairy movement,
// statuses. Colour in diagrams is always explicit — a single letter uses case,
// anything longer must be `{w:camel}` / `{b:hopper}`.
//
// Run with: node test/variant.mjs

import {
  Chess, WHITE, BLACK, FLAG, ST_FROZEN, ST_SHIELD, TILE,
} from '../js/chess.js';
import { ENCOUNTERS, KING_PASSIVES } from '../js/content.js';
import { PIECES } from '../js/pieces.js';
import { rulesFor, createRun, buildFight, autoPlace, applyStartStatuses } from '../js/run.js';

let failures = 0;

function assert(name, cond, detail = '') {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function names(game, square) {
  return game.moves({ square }).map((m) => {
    const sq = String.fromCharCode(97 + (m.to & 15)) + (game.ranks - (m.to >> 4));
    return sq + (m.captured ? 'x' : '') + (m.promotion ? `=${m.promotion}` : '');
  }).sort();
}

function hasMove(game, from, to) {
  const dest = typeof to === 'string'
    ? to
    : String.fromCharCode(97 + (to & 15)) + (game.ranks - (to >> 4));
  return game.moves({ square: from }).some((m) => {
    const sq = String.fromCharCode(97 + (m.to & 15)) + (game.ranks - (m.to >> 4));
    return sq === dest;
  });
}

const KC = { kingCapture: true, checks: false, castling: false };

// ---- boards --------------------------------------------------------------

{
  const g = Chess.fromDiagram(`
    k . . .
    . . . .
    . . . .
    K . . N
  `, { files: 4, ranks: 4, rules: KC });
  assert('4×4 in-bounds', g.inBounds(0) && g.inBounds(3) && !g.inBounds(4) && !g.inBounds(64));
  assert('white king on 4×4 has 3 moves', g.moves({ square: 'a1' }).length === 3,
    `got ${g.moves({ square: 'a1' }).length}`);
  assert('knight on d1 cannot leap off the 4×4', !hasMove(g, 'd1', 'c3') || hasMove(g, 'd1', 'b2'),
    names(g, 'd1').join(','));
  // Knight on d1 (file 3, rank 3): leaps: e3 (off), c3 (on), f2 (off), b2 (on),
  // e-1 off, c-1 off, f0 off, b0 off. So c3 and b2.
  assert('knight on d1 reaches b2 and c3 only', names(g, 'd1').join(',') === 'b2,c3',
    names(g, 'd1').join(','));
}

{
  const g = Chess.fromDiagram(`
    k . .
    . . .
    N . K
  `, { files: 3, ranks: 3, rules: KC });
  assert('3×3 files', g.files === 3 && g.ranks === 3);
  // a1 → b3 (2 up 1 right) and c2 (1 up 2 right) both sit on a 3×3.
  assert('3×3 knight reaches b3 and c2', names(g, 'a1').join(',') === 'b3,c2',
    names(g, 'a1').join(','));
}

// ---- king capture --------------------------------------------------------

{
  const g = Chess.fromDiagram(`
    . k .
    . . .
    N . K
  `, { files: 3, ranks: 3, rules: KC });
  assert('king-capture: knight can take the king', hasMove(g, 'a1', 'b3'));
  const taken = g.move({ from: 'a1', to: 'b3' });
  assert('king-capture move plays', Boolean(taken));
  const out = g.outcome();
  assert('king-capture ends the fight', out.over && out.winner === WHITE && out.reason === 'king capture',
    JSON.stringify(out));
}

{
  const g = Chess.fromDiagram(`
    . k .
    . Q .
    . . K
  `, { files: 3, ranks: 3, rules: { kingCapture: true, checks: false, castling: false } });
  // Black to move, standing next to a queen — legal because checks are off.
  g.turn = BLACK;
  g.positionCounts = new Map();
  g.countPosition();
  assert('king-capture: walking onto a guarded square is legal', hasMove(g, 'b3', 'b2'),
    names(g, 'b3').join(','));
  assert('king-capture: adjacent kings can take each other', hasMove(g, 'b3', 'c1') === false);
}

{
  const g = Chess.fromDiagram(`
    k . .
    # # #
    . K .
  `, { files: 3, ranks: 3, rules: KC });
  const out = g.outcome();
  assert('walled-off kings are unwinnable', out.over && out.winner === BLACK && out.reason === 'unwinnable',
    JSON.stringify(out));
}

{
  const g = Chess.fromDiagram(`
    . k . .
    # # # #
    . . N .
    K . . .
  `, { files: 4, ranks: 4, rules: KC });
  const out = g.outcome();
  assert('a knight can jump a wall to take the king', !out.over,
    JSON.stringify(out));
}

{
  const g = Chess.fromDiagram(`
    k . .
    {b:d} {b:d} {b:d}
    . K .
  `, { files: 3, ranks: 3, rules: KC });
  const out = g.outcome();
  assert('a king can take a drake wall', hasMove(g, 'b1', 'b2'), names(g, 'b1').join(','));
  assert('drakes a king can walk into are winnable', !out.over, JSON.stringify(out));
}

{
  const g = Chess.fromDiagram(`
    k . .
    . . .
    . K Q
  `, { files: 3, ranks: 3, rules: KC, turn: 'b' });
  // After white's move it would be black's turn; we set turn explicitly.
  assert('denial is checked from the side to move', g.turn === BLACK);
  assert('black king can step to a2 (no check filter)', hasMove(g, 'a3', 'a2'),
    names(g, 'a3').join(','));
}

// ---- pawn double-step path ----------------------------------------------

{
  const g = Chess.fromDiagram(`
    . . . . k
    . . . . .
    . . n . .
    P . . . .
    . . . . K
  `, { files: 5, ranks: 5, rules: KC });
  // White pawn on a2, start rank. Intermediate a3 is empty, a4 empty.
  assert('pawn double-step on 5×5 from a2', hasMove(g, 'a2', 'a4'), names(g, 'a2').join(','));
  assert('pawn single-step on 5×5', hasMove(g, 'a2', 'a3'));
}

{
  const g = Chess.fromDiagram(`
    . . . . k
    . . . . .
    n . . . .
    P . . . .
    . . . . K
  `, { files: 5, ranks: 5, rules: KC });
  assert('pawn double-step blocked by the square it crosses', !hasMove(g, 'a2', 'a4'),
    names(g, 'a2').join(','));
  assert('pawn can still step one onto the blocker? no', !hasMove(g, 'a2', 'a3'));
}

{
  const g = Chess.fromDiagram(`
    k . .
    . . .
    P . K
  `, { files: 3, ranks: 3, rules: KC });
  assert('no double-step on a 3-rank board', !hasMove(g, 'a1', 'a3') && hasMove(g, 'a1', 'a2'),
    names(g, 'a1').join(','));
}

// ---- blocked terrain -----------------------------------------------------

{
  const g = Chess.fromDiagram(`
    k . . .
    . # . .
    . R . .
    . . . K
  `, { files: 4, ranks: 4, rules: KC });
  assert('block tile recorded', g.tileAt('b3') === TILE.BLOCK);
  assert('rook cannot land on a block', !hasMove(g, 'b2', 'b3'), names(g, 'b2').join(','));
  assert('rook cannot slide through a block', !hasMove(g, 'b2', 'b4'), names(g, 'b2').join(','));
  assert('rook can still slide the other way', hasMove(g, 'b2', 'b1') && hasMove(g, 'b2', 'a2'));
}

// ---- frost / frozen ------------------------------------------------------

{
  const g = Chess.fromDiagram(`
    k . . .
    . * . .
    . . . .
    N . . K
  `, { files: 4, ranks: 4, rules: KC });
  assert('frost tile recorded', g.tileAt('b3') === TILE.FROST);
  const hopped = g.move({ from: 'a1', to: 'b3' });
  assert('knight can leap onto frost', Boolean(hopped));
  assert('landing on frost freezes the piece', (g.statusAt('b3') & ST_FROZEN) !== 0);
  g.move({ from: 'a4', to: 'b4' });
  assert('frozen knight has no moves on the following turn', g.moves({ square: 'b3' }).length === 0,
    names(g, 'b3').join(','));
  const kingMoves = g.moves({ square: 'd1' });
  assert('king can still move while the knight is frozen', kingMoves.length > 0);
  if (kingMoves.length) g.move({ from: 'd1', to: kingMoves[0].to });
  if (g.turn === BLACK && g.get('b4')?.type === 'k') g.move({ from: 'b4', to: 'a4' });
  assert('knight thaws after its side spends a turn',
    g.get('b3')?.type === 'n' && (g.statusAt('b3') & ST_FROZEN) === 0
    && g.moves({ square: 'b3' }).length > 0,
    `piece=${g.get('b3')?.type} status=${g.statusAt('b3')} moves=${names(g, 'b3')}`);
}

{
  // Sandbox lets the same colour move twice. Ice still has to last until
  // the other side plays, or "frozen for a turn" is a no-op at the menu.
  const g = new Chess({
    fen: '8/8/8/8/8/8/8/8 w - - 0 1',
    files: 8, ranks: 8,
    rules: { checks: false, kingCapture: true, castling: false },
  });
  const frost = g.sqOf('e4');
  const d2 = g.sqOf('d2');
  const g1 = g.sqOf('g1');
  g.terrain[frost] = TILE.FROST;
  g.board[d2] = { type: 'n', color: WHITE };
  g.board[g1] = { type: 'n', color: WHITE };
  g.turn = WHITE;
  assert('sandbox knight can leap onto frost', Boolean(g.move({ from: 'd2', to: 'e4' })));
  assert('sandbox landing freezes', (g.statusAt('e4') & ST_FROZEN) !== 0);
  g.turn = WHITE;
  assert('frozen knight has no moves before the other side plays', g.moves({ square: 'e4' }).length === 0);
  g.turn = WHITE;
  assert('a second white move does not thaw ice', Boolean(g.move({ from: 'g1', to: 'f3' })));
  assert('knight still frozen after a same-colour follow-up', (g.statusAt('e4') & ST_FROZEN) !== 0);
  g.board[g.sqOf('a8')] = { type: 'k', color: BLACK };
  g.kings.b = g.sqOf('a8');
  g.turn = BLACK;
  assert('black can move while the knight is iced', Boolean(g.move({ from: 'a8', to: 'a7' })));
  g.turn = WHITE;
  assert('knight still sits out white\'s next activation', g.moves({ square: 'e4' }).length === 0);
  g.turn = WHITE;
  assert('white\'s other knight can still move', Boolean(g.move({ from: 'f3', to: 'g1' })));
  g.turn = WHITE;
  assert('knight thaws once white has spent a turn after black',
    (g.statusAt('e4') & ST_FROZEN) === 0 && g.moves({ square: 'e4' }).length > 0,
    `status=${g.statusAt('e4')} moves=${g.moves({ square: 'e4' }).length}`);
}

// ---- fort / shield -------------------------------------------------------

{
  const g = Chess.fromDiagram(`
    k . . .
    . + . .
    . . . n
    N . . K
  `, { files: 4, ranks: 4, rules: KC });
  const parked = g.move({ from: 'a1', to: 'b3' });
  assert('knight can leap onto the fort', Boolean(parked));
  assert('fort grants a shield', (g.statusAt('b3') & ST_SHIELD) !== 0);
  // Black knight on d2 leaps onto b3 (2 left, 1 up).
  const capture = g.moves({ square: 'd2' }).find((m) => {
    const sq = String.fromCharCode(97 + (m.to & 15)) + (g.ranks - (m.to >> 4));
    return sq === 'b3';
  });
  assert('capturing a shielded piece is a shield-break', Boolean(capture && (capture.flags & FLAG.SHIELD_BREAK)),
    capture ? `flags=${capture.flags}` : 'no capture');
  if (capture) {
    g.makeMove(capture);
    const still = g.pieces().filter((p) => p.type === 'n' && p.color === WHITE);
    assert('shield pops the victim onto a rebound square', still.length === 1,
      `white knights left=${still.length}`);
    assert('shield is gone after the break', still.length === 0 || (still[0].status & ST_SHIELD) === 0);
    g.undo();
    assert('shield-break undo restores the fort piece',
      g.get('b3')?.type === 'n' && g.get('b3')?.color === WHITE
      && g.get('d2')?.type === 'n' && g.get('d2')?.color === BLACK,
      `b3=${g.get('b3')?.color}${g.get('b3')?.type} d2=${g.get('d2')?.color}${g.get('d2')?.type}`);
  }
}

// ---- fairy movement ------------------------------------------------------

{
  const g = Chess.fromDiagram(`
    k . . . .
    . . . . .
    . . . . .
    . . . . .
    {w:camel} . . . K
  `, { files: 5, ranks: 5, rules: KC });
  const dests = names(g, 'a1');
  assert('camel from a1 reaches b4 and d2', dests.includes('b4') && dests.includes('d2'), dests.join(','));
  assert('camel does not also walk like a knight', !dests.includes('b3') && !dests.includes('c2'), dests.join(','));
}

{
  const g = Chess.fromDiagram(`
    k . .
    . . .
    {w:ferz} . K
  `, { files: 3, ranks: 3, rules: KC });
  assert('ferz steps one diagonal', names(g, 'a1').join(',') === 'b2', names(g, 'a1').join(','));
}

{
  const g = Chess.fromDiagram(`
    k . .
    . . .
    {w:wazir} . K
  `, { files: 3, ranks: 3, rules: KC });
  const dests = names(g, 'a1');
  assert('wazir steps one orthogonal', dests.includes('a2') && dests.includes('b1') && !dests.includes('b2'),
    dests.join(','));
}

{
  const g = Chess.fromDiagram(`
    k . . . .
    . . p . .
    . . . . .
    . . . . .
    . . {w:hopper} . K
  `, { files: 5, ranks: 5, rules: KC });
  // Hopper on c1, hurdle pawn on c4 → lands c5.
  assert('hopper lands just beyond the first piece', hasMove(g, 'c1', 'c5'), names(g, 'c1').join(','));
  assert('hopper cannot land on the hurdle', !hasMove(g, 'c1', 'c4'));
  assert('hopper cannot fly with no hurdle', !hasMove(g, 'c1', 'c2') && !hasMove(g, 'c1', 'c3'),
    names(g, 'c1').join(','));
}

{
  const g = Chess.fromDiagram(`
    k . . .
    . . . .
    . . . .
    {w:champion} . . K
  `, { files: 4, ranks: 4, rules: KC });
  const dests = names(g, 'a1');
  assert('champion has wazir step', dests.includes('a2') && dests.includes('b1'));
  assert('champion has dabbaba (0,2)', dests.includes('a3'));
  assert('champion has alfil (2,2)', dests.includes('c3'));
  assert('champion is not a king (no diagonal-1)', !dests.includes('b2'), dests.join(','));
}

{
  const g = Chess.fromDiagram(`
    k . . . .
    . . . . .
    . . . . .
    . . . . .
    {w:princess} . . . K
  `, { files: 5, ranks: 5, rules: KC });
  const dests = names(g, 'a1');
  assert('princess has a bishop ray', dests.includes('b2') && dests.includes('c3') && dests.includes('d4'));
  assert('princess has a knight leap', dests.includes('b3') && dests.includes('c2'), dests.join(','));
}

// ---- explicit colour, not inferred from the word ------------------------

{
  const g = Chess.fromDiagram(`
    k . .
    . . .
    {w:camel} . K
  `, { files: 3, ranks: 3, rules: KC });
  const piece = g.get('a1');
  assert('{w:camel} is White', piece && piece.color === WHITE && piece.type === 'c',
    JSON.stringify(piece));
}

{
  const g = Chess.fromDiagram(`
    {b:camel} . k
    . . .
    K . .
  `, { files: 3, ranks: 3, rules: KC });
  const piece = g.get('a3');
  assert('{b:camel} is Black', piece && piece.color === BLACK && piece.type === 'c',
    JSON.stringify(piece));
}

// ---- capturesOnly is actually captures ----------------------------------

{
  const g = Chess.fromDiagram(`
    k . r .
    . . . .
    . N . .
    . . . K
  `, { files: 4, ranks: 4, rules: KC });
  const all = g.moves({ square: 'b2' });
  const caps = g.moves({ square: 'b2', capturesOnly: true });
  assert('quiet knight moves exist', all.some((m) => !m.captured), names(g, 'b2').join(','));
  assert('capturesOnly drops empty-square destinations',
    caps.length > 0 && caps.every((m) => m.captured),
    `all=${all.length} caps=${caps.length} dests=${names(g, 'b2')}`);
}

// ---- make/undo restores a variant position ------------------------------

{
  const g = Chess.fromDiagram(`
    k . . .
    . . . .
    . . . .
    C . . K
  `, { files: 4, ranks: 4, rules: KC });
  const before = g.fen();
  const move = g.moves({ square: 'a1' })[0];
  assert('camel on a1 has a move to undo', Boolean(move), names(g, 'a1').join(','));
  if (move) {
    g.makeMove(move);
    g.undo();
  }
  assert('variant make/undo restores FEN', g.fen() === before, `${g.fen()} vs ${before}`);
  assert('variant make/undo restores camel', g.get('a1')?.type === 'c');
}

// ---- army value (HP from remaining army) --------------------------------

{
  const g = Chess.fromDiagram(`
    k p .
    . . .
    P N K
  `, { files: 3, ranks: 3, rules: KC });
  // White: pawn 1 + knight 3 + king 3 = 7
  assert('army value counts remaining cost + king 3', g.armyValue(WHITE) === 7, String(g.armyValue(WHITE)));
  assert('black army value', g.armyValue(BLACK) === 4, String(g.armyValue(BLACK)));
}

// ---- royal extra leaps (dash passive) -----------------------------------

{
  const g = Chess.fromDiagram(`
    k . . .
    . . . .
    . . . .
    . . . K
  `, { files: 4, ranks: 4, rules: { ...KC, royalLeaps: [/* 2-step orthogonal */ -32, 32, -2, 2] } });
  const dests = names(g, 'd1');
  assert('dash king can leap two orthogonal', dests.includes('d3') && dests.includes('b1'), dests.join(','));
}

// ---- FEN round-trip on a small board with a fairy piece -----------------

{
  const g = Chess.fromDiagram(`
    k . c
    . . .
    P . K
  `, { files: 3, ranks: 3, rules: KC });
  const spec = g.toSpec();
  const g2 = new Chess(spec);
  assert('spec round-trip FEN', g2.fen() === g.fen(), `${g2.fen()} vs ${g.fen()}`);
  assert('spec round-trip camel', g2.get('c3')?.type === 'c' && g2.get('c3')?.color === BLACK);
  assert('spec keeps rules', g2.rules.kingCapture === true && g2.rules.checks === false);
}

// ---- registry is complete -----------------------------------------------

{
  const ids = Object.keys(PIECES);
  assert('registry has classic six', ['p', 'n', 'b', 'r', 'q', 'k'].every((id) => ids.includes(id)));
  assert('registry has fairy set', ['f', 'w', 'c', 'h', 's', 't', 'a', 'g', 'd', 'i', 'l', 'y'].every((id) => ids.includes(id)));
  assert('every piece has a cost and rarity', Object.values(PIECES).every((p) => p.cost >= 0 && p.rarity));
}

{
  const g = Chess.fromDiagram(`
    k n .
    . {w:drake} .
    . . K
  `, { files: 3, ranks: 3, rules: KC });
  assert('drake cannot capture', !hasMove(g, 'b2', 'b3'), names(g, 'b2').join(','));
  g.turn = 'b';
  assert('a knight cannot take a drake', !hasMove(g, 'b3', 'b2'), names(g, 'b3').join(','));
  assert('a king can take a drake', hasMove(g, 'a3', 'b2'), names(g, 'a3').join(','));
}

{
  const g = Chess.fromDiagram(`
    k . n
    . . .
    . {w:d} K
  `, { files: 3, ranks: 3, rules: KC, turn: 'b' });
  assert('a leaping knight still cannot take a drake', !hasMove(g, 'c3', 'b1'), names(g, 'c3').join(','));
}

{
  const g = Chess.fromDiagram(`
    k {b:wisp} .
    . . .
    N . K
  `, { files: 3, ranks: 3, rules: KC });
  const boom = g.move({ from: 'a1', to: 'b3' });
  assert('taking a wisp is legal', Boolean(boom));
  assert('wisp takes the taker with it', !g.get('b3') && !g.pieces().some((p) => p.type === 'n' && p.color === WHITE));
}

{
  // Rime freezes orthogonally, not diagonally, and freezes herself with them.
  // The diagonal exemption is what keeps her answerable: a pawn only captures
  // on the diagonal, so freezing all eight neighbours made her untouchable.
  const g = Chess.fromDiagram(`
    n n k
    . . .
    . {w:rime} K
  `, { files: 3, ranks: 3, rules: KC });
  g.move({ from: 'b1', to: 'b2' });
  assert('rime freezes the enemy orthogonally beside her',
    (g.statusAt('b3') & 1) !== 0, `status=${g.statusAt('b3')}`);
  assert('rime leaves a diagonal enemy free',
    (g.statusAt('a3') & 1) === 0, `status=${g.statusAt('a3')}`);
  assert('rime freezes herself on the recoil',
    (g.statusAt('b2') & 1) !== 0, `status=${g.statusAt('b2')}`);

  const frozen = g.moves().some((m) => m.from === g.sqOf('b3'));
  const free = g.moves().some((m) => m.from === g.sqOf('a3'));
  assert('the frozen knight cannot move', !frozen);
  assert('the untouched knight still can', free);
}

{
  // Recoil has to survive undo, since the search relies on it.
  const g = Chess.fromDiagram(`
    n n k
    . . .
    . {w:rime} K
  `, { files: 3, ranks: 3, rules: KC });
  const before = g.fen();
  const mv = g.moves().find((m) => m.from === g.sqOf('b1') && m.to === g.sqOf('b2'));
  g.makeMove(mv);
  g.undo();
  assert('undo restores the board after a freeze', g.fen() === before, g.fen());
  assert('undo clears the recoil', (g.statusAt('b1') & 1) === 0);
  assert('undo thaws what she froze', (g.statusAt('b3') & 1) === 0);
}

{
  const g = Chess.fromDiagram(`
    k . .
    . . .
    {w:flame} . K
  `, { files: 3, ranks: 3, rules: KC });
  g.move({ from: 'a1', to: 'b2' });
  assert('flame paints fire on the square it left', g.isFire(g.sqOf('a1')), `fire a1=${g.fireUntil[g.sqOf('a1')]} hist=${g.history.length}`);
}

{
  const g = Chess.fromDiagram(`
    k . . . .
    . . . . n
    . . . . .
    . . . . .
    . . . . K
  `, { files: 5, ranks: 5, rules: { ...KC, duckChess: true }, duck: 'c3' });
  assert('duck chess starts with a duck on c3', g.duck === g.sqOf('c3'));
  assert('a rook-like slide cannot pass the duck', !g.moves({ square: 'e4' }).some((m) => {
    const name = String.fromCharCode(97 + (m.to & 15)) + (5 - (m.to >> 4));
    return name === 'c3' || name === 'b4' || name === 'a5';
  }));
  const played = g.move({ from: 'e1', to: 'd2' });
  assert('after a move the duck must be parked', Boolean(played) && g.awaitingDuck);
  assert('cannot park the duck on itself', g.placeDuck('c3') === false);
  assert('can park the duck on an empty square', g.placeDuck('b2') === true && g.duck === g.sqOf('b2') && !g.awaitingDuck);
}

// ---- ranged capture, reanimation, banner aura, courier swap --------------
// Four rules that break the "one piece travels from A to B, maybe taking what
// it finds" assumption the rest of the engine is built on, so each one needs
// its make/undo round trip pinned as much as its move generation.

const snap = (g) => JSON.stringify(g.pieces());

{
  const g = Chess.fromDiagram(`
    . . {b:pawn} . .
    . . . . .
    . . . {w:crossbow} .
    . . . . .
    . . . . .
  `, { files: 5, ranks: 5, rules: KC });
  const shots = g.moves({ legal: false }).filter((m) => m.flags & FLAG.SHOOT);
  assert('a crossbow shoots at a knight’s leap', shots.length === 1, String(shots.length));
  const before = snap(g);
  g.makeMove(shots[0]);
  const after = g.pieces();
  assert('the shot kills without moving the shooter',
    !after.some((p) => p.color === BLACK)
    && after.some((p) => p.type === 'crossbow' && p.square === shots[0].from));
  g.undo();
  assert('undo restores a shot', snap(g) === before, snap(g));
}

{
  // A martyr is the shooter's whole reason to exist: taking a wisp by hand
  // kills the taker, but a shot is fired from out of reach.
  const g = Chess.fromDiagram(`
    . . {b:wisp} . .
    . . . . .
    . . . {w:crossbow} .
    . . . . .
    . . . . .
  `, { files: 5, ranks: 5, rules: KC });
  const shot = g.moves({ legal: false }).find((m) => m.flags & FLAG.SHOOT);
  g.makeMove(shot);
  assert('shooting a wisp costs the shooter nothing',
    g.pieces().some((p) => p.type === 'crossbow'), snap(g));
}

{
  const g = Chess.fromDiagram(`
    . . . .
    . {b:knight} . .
    {w:reaper} . . .
    . . . .
  `, { files: 4, ranks: 4, rules: KC });
  const cap = g.moves({ legal: false }).find((m) => m.captured);
  const before = snap(g);
  g.makeMove(cap);
  const risen = g.pieces().find((p) => p.type === 'n');
  assert('what a reanimator kills rises on its side',
    Boolean(risen) && risen.color === WHITE && risen.square === cap.from, snap(g));
  g.undo();
  assert('undo restores a raise', snap(g) === before, snap(g));
}

{
  const g = Chess.fromDiagram(`
    . . . . .
    . . . . .
    {w:banner} {w:rook} . . .
    . . . . .
    . . . . .
  `, { files: 5, ranks: 5, rules: KC });
  const sq = g.pieces().find((p) => p.type === 'r').square;
  const diagonal = (game, from) => game.moves({ square: from, legal: false }).filter((m) => (
    Math.abs((m.to >> 4) - (from >> 4)) === 1 && Math.abs((m.to & 15) - (from & 15)) === 1
  )).length;
  assert('a banner lends its neighbour a diagonal step', diagonal(g, sq) > 0);

  const lone = Chess.fromDiagram(`
    . . . . .
    . . . . .
    . {w:rook} . . .
    . . . . .
    . . . . .
  `, { files: 5, ranks: 5, rules: KC });
  const loneSq = lone.pieces().find((p) => p.type === 'r').square;
  assert('a rook with no banner has no diagonal step', diagonal(lone, loneSq) === 0);
}

{
  const g = Chess.fromDiagram(`
    . . . .
    . . {w:rook} .
    . . . .
    {w:courier} . . .
  `, { files: 4, ranks: 4, rules: KC });
  const swaps = g.moves({ legal: false }).filter((m) => m.flags & FLAG.SWAP);
  assert('a courier offers a swap with a friend', swaps.length === 1, String(swaps.length));
  assert('a swap takes nothing', swaps.every((m) => !m.captured));
  const before = snap(g);
  g.makeMove(swaps[0]);
  const after = g.pieces();
  assert('the two trade squares',
    after.some((p) => p.type === 'courier' && p.square === swaps[0].to)
    && after.some((p) => p.type === 'r' && p.square === swaps[0].from), snap(g));
  g.undo();
  assert('undo restores a swap', snap(g) === before, snap(g));
}

{
  // The courier must not be a free ride out of terrain it would otherwise
  // have to walk through.
  const g = Chess.fromDiagram(`
    . . . .
    . . {w:rook} .
    . . . .
    {w:courier} . . .
  `, { files: 4, ranks: 4, rules: KC });
  // fromDiagram reads terrain out of the diagram itself, and a square cannot
  // hold both a tile glyph and a piece — so ice the rook's square directly.
  g.terrain[1 * 16 + 2] = TILE.FROST;
  assert('a courier will not swap onto ice',
    g.moves({ legal: false }).every((m) => !(m.flags & FLAG.SWAP)));
}

// ---- fire that an encounter declares, not fire a Flame paints ------------
// isFire only ever consulted the painted kind, so every TILE.FIRE square in
// the encounter book was drawn as fire and behaved as bare floor.

{
  const burn = (passives) => {
    const g = Chess.fromDiagram(`
      . . . .
      . . . .
      . {w:rook} . .
      . . . .
    `, { files: 4, ranks: 4, rules: KC, kingPassives: passives });
    g.terrain[1 * 16 + 1] = TILE.FIRE;
    const from = g.pieces().find((p) => p.type === 'r').square;
    const step = g.moves({ square: from, legal: false }).find((m) => m.to === 1 * 16 + 1);
    g.makeMove(step);
    return !g.pieces().some((p) => p.type === 'r');
  };
  assert('a declared fire tile actually burns what steps on it', burn([]));
  assert('Ash Boots walks your own pieces through fire', !burn(['ashboots']));
}

{
  // Multi-letter piece ids have to survive a FEN round trip. The single-letter
  // upper/lower-case convention silently mangles them — `crossbow` came back
  // as c, r, o, s, s, b, o, w — so they serialise in the brace form instead.
  const g = Chess.fromDiagram(`
    . {b:crossbow} .
    . {w:reaper} .
    . {w:king} .
  `, { files: 3, ranks: 3, rules: KC });
  const fen = g.fen();
  const back = new Chess({ fen, files: 3, ranks: 3, rules: KC });
  assert('a multi-letter piece survives a FEN round trip',
    JSON.stringify(back.pieces()) === JSON.stringify(g.pieces()), fen);
}

// ---- new king variants -----------------------------------------------------

{
  // Every king id must resolve back to itself — the shop and the bag both
  // key kings off run.king, and the engine's own kingPassives checks look
  // for that exact string, so a king whose object key drifted from its id
  // field would silently stop doing anything the moment it was equipped.
  const mismatched = Object.entries(KING_PASSIVES).filter(([key, def]) => key !== def.id);
  assert('every king id matches its own registry key',
    mismatched.length === 0, mismatched.map(([k]) => k).join(', '));
}

{
  // Vanguard: a straight two-square jump, clearing whatever sits between —
  // and only for the player's own king, the same asymmetry every other new
  // king passive respects.
  const g = Chess.fromDiagram(`
    . . . . .
    . . . . .
    . {w:pawn} {w:king} . .
    . . . . .
    . . . . .
  `, { files: 5, ranks: 5, rules: { ...KC }, kingPassives: ['vanguard'] });
  const moves = g.moves({ square: g.kings.w, legal: false });
  assert('Vanguard king can leap two squares', moves.some((m) => m.to === g.kings.w - 2));
  assert('Vanguard king still moves one square too', moves.some((m) => m.to === g.kings.w - 16));

  const black = Chess.fromDiagram(`
    . . . . .
    . . . . .
    . {b:pawn} {b:king} . .
    . . . . .
    . . . . .
  `, { files: 5, ranks: 5, rules: { ...KC }, kingPassives: ['vanguard'], turn: BLACK });
  const blackMoves = black.moves({ square: black.kings.b, legal: false });
  assert('Vanguard does not reach the enemy king',
    !blackMoves.some((m) => m.to === black.kings.b - 2));
}

{
  // Duck: the run wires it straight into the existing Duck Chess rule.
  const rules = rulesFor({ king: 'duck' });
  assert('the Duck king turns on duckChess', rules.duckChess === true);
  const plain = rulesFor({ king: null });
  assert('duckChess is off without it', plain.duckChess === false);
}

{
  // Palisade grants the 'icebound' engine token, same as any other source of it.
  const g = Chess.fromDiagram(`
    {b:rime} . .
    . {w:pawn} .
    . . .
  `, { files: 3, ranks: 3, rules: { ...KC }, kingPassives: ['icebound'] });
  assert('Palisade (icebound) protects a piece from freezeImmune',
    g.freezeImmune(g.board[g.sqOf('b2')]));
}

{
  // Marksman grants Longshot's extended 3-1 range to shooters.
  const g = Chess.fromDiagram(`
    . . . . . . .
    . . . . . . .
    . . . . . . .
    . . . {w:crossbow} . . .
    . . . . . . .
    . . . . . . .
    . . . . . . .
  `, { files: 7, ranks: 7, rules: { ...KC }, kingPassives: ['longshot'] });
  const def = PIECES.crossbow;
  const offsets = g.shootOffsets(def, WHITE);
  assert('Marksman extends the crossbow to the camel leap',
    offsets.length > def.shootOff.length);
}

{
  // Warden, Anchor and Formation all act at fight start via
  // applyStartStatuses rather than any engine hook, so they're testable
  // directly against a hand-built position.
  const diagram = `
    . . . . .
    . {w:king} {w:queen} . .
    . . . . .
    . . . . .
    . . . . {w:pawn}
  `;
  const warden = Chess.fromDiagram(diagram, { files: 5, ranks: 5, rules: { ...KC } });
  applyStartStatuses(warden, { king: 'rampart' });
  // Read the squares back from the board rather than guessing algebraic
  // names against the diagram's row/rank orientation.
  const queenSq = warden.pieces().find((p) => p.type === 'q').square;
  const pawnSq = warden.pieces().find((p) => p.type === 'p').square;
  assert('Warden shields the piece beside the king', Boolean(warden.status[queenSq] & ST_SHIELD));
  assert('Warden does not shield a piece further away', !(warden.status[pawnSq] & ST_SHIELD));

  const anchor = Chess.fromDiagram(diagram, { files: 5, ranks: 5, rules: { ...KC } });
  applyStartStatuses(anchor, { king: 'anchor' });
  assert('Anchor shields the single costliest piece', Boolean(anchor.status[queenSq] & ST_SHIELD));
  assert('Anchor leaves the cheaper piece alone', !(anchor.status[pawnSq] & ST_SHIELD));

  const formation = Chess.fromDiagram(diagram, { files: 5, ranks: 5, rules: { ...KC } });
  applyStartStatuses(formation, { king: 'formation' });
  assert('Formation shields the pawn', Boolean(formation.status[pawnSq] & ST_SHIELD));
  assert('Formation leaves the queen unshielded', !(formation.status[queenSq] & ST_SHIELD));
}

{
  // End-to-end: the run layer actually reaches an equipped king through the
  // whole buildFight pipeline, not just in the unit tests above.
  const run = createRun(42);
  run.king = 'duck';
  const enc = ENCOUNTERS.gate;
  const game = buildFight(run, enc, autoPlace(enc, []));
  assert('buildFight wires the Duck king into the live rules', game.rules.duckChess === true);
  assert('a fresh Duck Chess fight starts with a duck placed', game.duck >= 0);
}

{
  const g = Chess.fromDiagram(`
    . . . . .
    . . . . .
    . . {w:king} . .
    . . . . .
    . . . . .
  `, { files: 5, ranks: 5, rules: { ...KC }, kingPassives: ['ranger'] });
  const moves = g.moves({ square: g.kings.w, legal: false });
  assert('Ranger king can leap like a knight',
    moves.some((m) => m.to === g.kings.w - 33) || moves.some((m) => m.to === g.kings.w - 31));
}

{
  const g = Chess.fromDiagram(`
    . . .
    . # .
    . {w:king} .
  `, { files: 3, ranks: 3, rules: { ...KC }, kingPassives: ['nomad'] });
  const wall = g.sqOf('b2');
  const moves = g.moves({ square: g.kings.w, legal: false });
  assert('Nomad king can step onto a blocked tile', moves.some((m) => m.to === wall));
  const step = moves.find((m) => m.to === wall);
  g.makeMove(step);
  assert('Nomad king clears the wall it stepped on', g.tileAt(wall) !== TILE.BLOCK);
}

{
  const g = Chess.fromDiagram(`
    {b:rime} . .
    . {w:king} .
    . . .
  `, { files: 3, ranks: 3, rules: { ...KC }, kingPassives: ['steadfast'] });
  assert('Steadfast king is freeze-immune', g.freezeImmune(g.board[g.kings.w]));
}

{
  const run = createRun(3);
  run.king = 'provisioner';
  const enc = ENCOUNTERS.hedge;
  const game = buildFight(run, enc, autoPlace(enc, []));
  const pawns = game.pieces().filter((p) => p.color === WHITE && p.type === 'p').length;
  assert('Provisioner starts a fight with a levy pawn', pawns >= 1, String(pawns));
}

// ---- boss scripts -----------------------------------------------------------

{
  // Meteor: telegraphs a cross around the white king, detonates it two plies
  // later, and undo has to unwind all of it — the kill, the fire it leaves,
  // and the telegraph state itself.
  const g = new Chess({
    files: 8, ranks: 8, rules: { ...KC }, bossScript: { meteor: { period: 4, delay: 2 } },
  });
  const wk = g.sqOf('e1');
  const bk = g.sqOf('a8');
  g.board[wk] = { type: 'k', color: WHITE }; g.kings.w = wk;
  g.board[bk] = { type: 'k', color: BLACK }; g.kings.b = bk;
  g.turn = WHITE;
  g.refreshMode();

  const step = (from, to) => {
    const m = g.moves({ square: from, legal: false }).find((mv) => mv.to === to);
    g.makeMove(m);
    return m;
  };
  step(wk, g.sqOf('e2'));                 // ply 1
  step(bk, g.sqOf('a7'));                 // ply 2
  step(g.sqOf('e2'), wk);                 // ply 3, king walks home
  assert('meteor has not warned before its period', !g.isWarned(wk));
  step(g.sqOf('a7'), bk);                 // ply 4 — telegraph fires (a cross around e1)
  assert('meteor warns the white king square on schedule', g.isWarned(wk));

  // d2 is diagonal from e1 — outside the orthogonal cross the telegraph
  // marked — so this is a genuine dodge, not just a step within the blast.
  const d2 = g.sqOf('d2');
  step(wk, d2);                           // ply 5 — the player's one warning
  step(bk, g.sqOf('a7'));                 // ply 6 — detonation
  assert('meteor spares a king that actually left the marked squares', g.kings.w === d2);
  assert('meteor leaves fire on the square it hit, not the empty king start', g.isFire(wk));

  let undone = 0;
  while (g.history.length) { g.undo(); undone++; }
  assert('meteor undo rewinds every ply', undone === 6);
  assert('meteor undo clears the telegraph', g.warnUntil.every((v) => v === 0));
  assert('meteor undo clears the fire it left', g.fireUntil.every((v) => v === 0));
  assert('meteor undo restores the king that moved out of the blast',
    g.board[wk] && g.board[wk].type === 'k');
}

{
  // Blizzard: freezes a fresh row every period, and freezes whoever is
  // caught standing on it — the tile itself stays frost afterward via the
  // ordinary frost rule, so this only has to prove the moment it forms.
  const g = new Chess({
    files: 6, ranks: 6, rules: { ...KC }, bossScript: { blizzard: { period: 2 } },
  });
  const wk = g.sqOf('a6');
  const bk = g.sqOf('f1');
  g.board[wk] = { type: 'k', color: WHITE }; g.kings.w = wk;
  g.board[bk] = { type: 'k', color: BLACK }; g.kings.b = bk;
  const caught = g.sqOf('c6');
  g.board[caught] = { type: 'p', color: WHITE };
  g.turn = WHITE;
  g.refreshMode();

  const step = (from, to) => {
    const m = g.moves({ square: from, legal: false }).find((mv) => mv.to === to);
    g.makeMove(m);
  };
  step(wk, g.sqOf('a5'));                 // ply 1
  step(bk, g.sqOf('f2'));                 // ply 2 — blizzard pulses the board's row 0

  assert('blizzard turns the row to frost', g.terrain[caught] === TILE.FROST);
  assert('blizzard freezes whatever was caught on it', Boolean(g.status[caught] & ST_FROZEN));

  let undone = 0;
  while (g.history.length) { g.undo(); undone++; }
  assert('blizzard undo clears the frost', g.terrain.every((v) => v === TILE.NONE));
  assert('blizzard undo thaws what it froze', !(g.status[caught] & ST_FROZEN));
}

{
  // Shrink: closes the outer ring to holes, killing anything left standing
  // on it, and stops well short of closing the arena.
  const g = new Chess({
    files: 8, ranks: 8, rules: { ...KC }, bossScript: { shrink: { period: 2, floor: 3 } },
  });
  const wk = g.sqOf('e4');
  const bk = g.sqOf('e5');
  g.board[wk] = { type: 'k', color: WHITE }; g.kings.w = wk;
  g.board[bk] = { type: 'k', color: BLACK }; g.kings.b = bk;
  const onRing = g.sqOf('a1');
  g.board[onRing] = { type: 'p', color: BLACK };
  g.turn = WHITE;
  g.refreshMode();

  const step = (from, to) => {
    const m = g.moves({ square: from, legal: false }).find((mv) => mv.to === to);
    g.makeMove(m);
  };
  step(wk, g.sqOf('e3'));
  step(bk, g.sqOf('e6'));                 // N=2 — the outer ring closes

  assert('shrink walls off a corner of the outer ring', g.terrain[g.sqOf('a8')] === TILE.BLOCK);
  assert('shrink kills what was standing on the closing ring', g.board[onRing] === null);
  assert('shrink leaves the interior open', g.terrain[wk] === TILE.NONE);

  let undone = 0;
  while (g.history.length) { g.undo(); undone++; }
  assert('shrink undo reopens the ring', g.terrain.every((v) => v === TILE.NONE));
  assert('shrink undo restores what was standing there', Boolean(g.board[onRing]));
}

// ---- glass terrain ----------------------------------------------------------

{
  const g = Chess.fromDiagram(`
    k . . .
    . . . .
    . ~ . .
    K . . .
  `, { files: 4, ranks: 4, rules: KC });
  assert('glass tile recorded', g.tileAt('b2') === TILE.GLASS);
  assert('glass does not block a slide before it breaks', hasMove(g, 'a1', 'b2'), names(g, 'a1').join(','));

  const landed = g.move({ from: 'a1', to: 'b2' });
  assert('landing on glass is a legal move', Boolean(landed));
  assert('glass breaks into a wall once something lands on it', g.tileAt('b2') === TILE.BLOCK);
  assert('the piece that broke it still stands there', g.get('b2')?.type === 'k');

  g.undo();
  assert('undo restores the glass', g.tileAt('b2') === TILE.GLASS);
  assert('undo puts the king back where it started', g.get('a1')?.type === 'k' && !g.get('b2'));
}

{
  // A slide that only PASSES OVER glass (not landing on it) leaves it whole —
  // only landing breaks it.
  const g = Chess.fromDiagram(`
    k . . . .
    . . . . .
    . ~ . . .
    . . . . .
    K R . . .
  `, { files: 5, ranks: 5, rules: KC });
  assert('a rook can slide past an unbroken glass tile', hasMove(g, 'b1', 'b5'), names(g, 'b1').join(','));
  const rook = g.move({ from: 'b1', to: 'b5' });
  assert('the slide lands past the glass, not on it', Boolean(rook) && g.get('b5')?.type === 'r');
  assert('glass survives being passed over, not landed on', g.tileAt('b3') === TILE.GLASS);
}

// ---- the lodestone's pull ---------------------------------------------------

// Rows are top-down, so -16 is "up the board". A lodestone stepping up from
// row 4 to row 3 puts row 2 in the gap and row 1 two away — which is where
// each of these diagrams parks whatever is meant to be dragged.
const PULL_BOARD = (occupant, gap = '.') => `
  {b:king} . . . .
  . . ${occupant} . .
  . . ${gap} . .
  . . . . .
  {w:king} . {w:lodestone} . .
`;
const pullGame = (occupant, gap, opts = {}) => Chess.fromDiagram(
  PULL_BOARD(occupant, gap),
  { files: 5, ranks: 5, rules: { ...KC }, ...opts },
);
// The lodestone's own step: row 4 col 2 up to row 3 col 2.
const LODE_FROM = 4 * 16 + 2;
const LODE_TO = 3 * 16 + 2;
const PULL_MID = 2 * 16 + 2;
const PULL_FAR = 1 * 16 + 2;

{
  const g = pullGame('{b:pawn}');
  assert('the pull leaves the enemy alone until the lodestone moves',
    g.board[PULL_FAR]?.type === 'p' && !g.board[PULL_MID]);

  g.move({ from: LODE_FROM, to: LODE_TO });
  assert('a lodestone drags an enemy two squares off one square closer',
    g.board[PULL_MID]?.type === 'p' && g.board[PULL_MID]?.color === BLACK,
    JSON.stringify(g.board[PULL_MID]));
  assert('the square it was dragged off is empty', !g.board[PULL_FAR]);
  assert('the lodestone itself still made its own move', g.board[LODE_TO]?.type === 'lodestone');

  g.undo();
  assert('undo puts the dragged piece back', g.board[PULL_FAR]?.type === 'p' && !g.board[PULL_MID]);
  assert('undo puts the lodestone back', g.board[LODE_FROM]?.type === 'lodestone' && !g.board[LODE_TO]);
}

{
  // A body in the gap means there is nowhere to drag them to.
  const g = pullGame('{b:pawn}', '{b:knight}');
  g.move({ from: LODE_FROM, to: LODE_TO });
  assert('a blocked gap stops the pull',
    g.board[PULL_FAR]?.type === 'p' && g.board[PULL_MID]?.type === 'n');
}

{
  // It is a pull on the ENEMY, not a tractor beam on everything.
  const g = pullGame('{w:pawn}');
  g.move({ from: LODE_FROM, to: LODE_TO });
  assert('the pull does not drag your own pieces',
    g.board[PULL_FAR]?.color === WHITE && !g.board[PULL_MID]);
}

{
  // Frozen holds against the pull — the cold already owns them.
  const g = pullGame('{b:pawn}');
  g.status[PULL_FAR] |= ST_FROZEN;
  g.move({ from: LODE_FROM, to: LODE_TO });
  assert('a frozen piece cannot be dragged', g.board[PULL_FAR]?.type === 'p' && !g.board[PULL_MID]);
}

{
  // Dragging their king out of position is the whole point, so kings.b has
  // to follow it — a stale king square would break every capture check.
  const g = Chess.fromDiagram(`
    . . . . .
    . . {b:king} . .
    . . . . .
    . . . . .
    {w:king} . {w:lodestone} . .
  `, { files: 5, ranks: 5, rules: { ...KC } });
  g.move({ from: LODE_FROM, to: LODE_TO });
  assert('the pull drags a king too', g.board[PULL_MID]?.type === 'k');
  assert('the dragged king is tracked at its new square', g.kings.b === PULL_MID, String(g.kings.b));
  g.undo();
  assert('undo restores the dragged king square', g.kings.b === PULL_FAR, String(g.kings.b));
}

{
  // Dragged onto ice they freeze; the terrain applies to a piece hauled onto
  // it, not only to one that walked there.
  const g = pullGame('{b:pawn}', '*');
  g.move({ from: LODE_FROM, to: LODE_TO });
  assert('a piece dragged onto frost freezes',
    g.board[PULL_MID]?.type === 'p' && Boolean(g.status[PULL_MID] & ST_FROZEN));
  g.undo();
  assert('undo thaws and returns a piece dragged onto frost',
    g.board[PULL_FAR]?.type === 'p' && !(g.status[PULL_FAR] & ST_FROZEN) && !g.status[PULL_MID]);
}

{
  // And dragged into fire they burn — setting the fire and then hauling
  // someone onto it is the reason to field the thing.
  const g = pullGame('{b:pawn}', '^');
  g.move({ from: LODE_FROM, to: LODE_TO });
  assert('a piece dragged into fire dies', !g.board[PULL_MID] && !g.board[PULL_FAR]);
  g.undo();
  assert('undo stands a burned dragged piece back up',
    g.board[PULL_FAR]?.type === 'p' && !g.board[PULL_MID]);
}

{
  // The nasty one: a pull can drag someone into the square the lodestone
  // just vacated, so undo has to clear that square before walking the
  // lodestone back onto it.
  const g = Chess.fromDiagram(`
    . . . . .
    . . . . .
    . . . . .
    . . {w:lodestone} . .
    {w:king} . {b:pawn} {b:king} .
  `, { files: 5, ranks: 5, rules: { ...KC } });
  const from = 3 * 16 + 2;
  const to = 2 * 16 + 2;
  const behind = 4 * 16 + 2;
  g.move({ from, to });
  assert('a pull can drag an enemy into the square the lodestone left',
    g.board[from]?.type === 'p' && !g.board[behind]);
  assert('the lodestone is on its destination', g.board[to]?.type === 'lodestone');
  g.undo();
  assert('undo returns the lodestone to a square the pull had filled',
    g.board[from]?.type === 'lodestone', JSON.stringify(g.board[from]));
  assert('undo returns the dragged piece behind it', g.board[behind]?.type === 'p');
  assert('undo leaves the destination empty', !g.board[to]);
}

{
  // A Bombard shoots along the dabbaba lines, which is a different set of
  // squares from the Crossbow's knight leaps — that separation is the point
  // of having both.
  const g = Chess.fromDiagram(`
    . . . . .
    . . {b:knight} . .
    . . . . .
    . . {w:bombard} . .
    {w:king} . . . {b:king}
  `, { files: 5, ranks: 5, rules: { ...KC } });
  const shooter = 3 * 16 + 2;
  const target = 1 * 16 + 2;
  const shot = g.moves({ square: shooter, legal: false }).find((m) => m.to === target);
  assert('a bombard shoots two squares in a straight line',
    Boolean(shot) && Boolean(shot.flags & FLAG.SHOOT), JSON.stringify(shot));
  g.makeMove(shot);
  assert('the bombard kills without moving',
    !g.board[target] && g.board[shooter]?.type === 'bombard');
}

{
  // A Basilisk freezes like a Rime but arrives along a diagonal, so it can
  // set that up from across the board rather than a step at a time.
  const g = Chess.fromDiagram(`
    . . . . .
    . {b:rook} . . .
    . . . . .
    . . . {w:basilisk} .
    {w:king} . . . {b:king}
  `, { files: 5, ranks: 5, rules: { ...KC } });
  const from = 3 * 16 + 3;
  const to = 1 * 16 + 1;
  const slide = g.moves({ square: from, legal: false }).find((m) => m.to === to);
  assert('a basilisk slides on the diagonals', Boolean(slide), names(g, from).join(','));
}

// ---- undo symmetry regressions ----------------------------------------------
// All three of these were found by fuzzing make/undo over random positions:
// play every legal move from a position, undo it, and demand the engine be
// byte-identical. Each one silently corrupted the AI's search rather than
// throwing, so nothing surfaced them until the state was compared directly.

const engineSnapshot = (g) => JSON.stringify({
  board: g.board.map((p) => (p ? p.type + p.color : null)),
  status: Array.from(g.status),
  kings: g.kings,
});

{
  // A king capturing a sapper. undo() restores `this.kings` from the history
  // entry and then the blast-restore loop used to re-derive it from the
  // square the corpse was on, putting the king back on the sapper's square.
  const g = Chess.fromDiagram(`
    . . . .
    . {b:sapper} . .
    . {w:king} . .
    . . . {b:king}
  `, { files: 4, ranks: 4, rules: { ...KC } });
  const before = engineSnapshot(g);
  const blow = g.moves({ square: g.kings.w, legal: false }).find((m) => m.captured === 'x');
  g.makeMove(blow);
  assert('a king that takes a sapper dies in the blast', g.kings.w === -1);
  g.undo();
  assert('undo restores the king to its own square, not the sapper\'s',
    engineSnapshot(g) === before, `kings ${JSON.stringify(g.kings)}`);
}

{
  // A frozen piece caught in a sapper blast. The blast recorded the square
  // and the piece but not its status, so it came back thawed.
  const g = Chess.fromDiagram(`
    . . . . .
    . . . . .
    . {w:pawn} {b:sapper} . .
    . . {w:rook} . .
    {w:king} . . . {b:king}
  `, { files: 5, ranks: 5, rules: { ...KC } });
  const frozenSq = 2 * 16 + 1;
  g.status[frozenSq] |= ST_FROZEN;
  const before = engineSnapshot(g);
  const blow = g.moves({ square: 3 * 16 + 2, legal: false }).find((m) => m.captured === 'x');
  g.makeMove(blow);
  g.undo();
  assert('undo restores the frozen status of a blast victim',
    engineSnapshot(g) === before, `status ${g.status[frozenSq]}`);
}

{
  // A Basilisk taking a sapper: the freeze happens first, the blast second,
  // so undo has to unwind the blast first or the blast's (already-frozen)
  // record wins over the real pre-move status.
  const g = Chess.fromDiagram(`
    . . . . .
    . . . . .
    . {b:rook} {b:sapper} . .
    . . . {w:basilisk} .
    {w:king} . . . {b:king}
  `, { files: 5, ranks: 5, rules: { ...KC } });
  const before = engineSnapshot(g);
  const blow = g.moves({ square: 3 * 16 + 3, legal: false }).find((m) => m.captured === 'x');
  assert('the basilisk can reach the sapper', Boolean(blow));
  g.makeMove(blow);
  g.undo();
  assert('undo unwinds a blast before the freeze that preceded it',
    engineSnapshot(g) === before);
}

{
  // A pawn promoting onto a fire tile. `extra.burned` records the piece as
  // it stood on the destination — already promoted — so undo walked a queen
  // back onto the pawn's square and left it there.
  const g = Chess.fromDiagram(`
    . ^ . .
    . {w:pawn} . .
    . . . {b:king}
    {w:king} . . .
  `, { files: 4, ranks: 4, rules: { ...KC } });
  const before = engineSnapshot(g);
  const push = g.moves({ square: 1 * 16 + 1, legal: false }).find((m) => m.promotion === 'q');
  assert('the pawn can promote onto the burning square', Boolean(push));
  g.makeMove(push);
  assert('promoting into fire kills it', !g.board[1] && !g.board[1 * 16 + 1]);
  g.undo();
  assert('undo returns a burned promotion as a pawn, not a queen',
    engineSnapshot(g) === before, JSON.stringify(g.board[1 * 16 + 1]));
}

{
  // A side frozen out of every legal move used to lose the fight outright,
  // even with both kings still standing — freezing every enemy piece was a
  // free win with no capture involved. It should forfeit the ply instead.
  const g = Chess.fromDiagram(`
    . . . {b:king}
    . . . .
    . . . {b:pawn}
    {w:king} . . .
  `, { files: 4, ranks: 4, rules: { ...KC } });
  g.turn = BLACK;
  g.status[g.kings.w] |= ST_FROZEN;
  const beforeTurn = g.turn;
  const mv = g.moves({ square: 2 * 16 + 3 })[0];
  assert('black has a move to test with', Boolean(mv));
  g.makeMove(mv);
  assert('the turn bounces back to black instead of the fight ending',
    g.turn === BLACK, `turn ${g.turn}`);
  assert('both kings are still standing', g.kings.w >= 0 && g.kings.b >= 0);
  assert('outcome is not over just because one side is frozen solid',
    !g.outcome().over, JSON.stringify(g.outcome()));
  g.undo();
  assert('undo restores whoever\'s turn it truly was before the frozen bounce',
    g.turn === beforeTurn, `turn ${g.turn}`);
}

{
  // Clicking an enemy should list where it can go even though it is not
  // that side's turn — the dots are a read, not a move.
  const g = new Chess();
  const b8 = 1;
  assert('white to move does not play a black knight',
    g.turn === WHITE && g.moves({ square: b8 }).length === 0);
  const looks = g.moves({ square: b8, color: BLACK });
  const dests = looks.map((m) => String.fromCharCode(97 + (m.to & 15)) + (8 - (m.to >> 4))).sort();
  assert('a black knight still shows a6 and c6 on white\'s turn',
    dests.join(',') === 'a6,c6', dests.join(','));
  assert('previewing does not hand the turn over', g.turn === WHITE);
}

console.log(failures ? `\n${failures} variant failure(s)` : '\nAll variant tests passed.');
process.exit(failures ? 1 : 0);
