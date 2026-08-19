// Variant mechanics: king-capture, variable boards, terrain, fairy movement,
// statuses. Colour in diagrams is always explicit — a single letter uses case,
// anything longer must be `{w:camel}` / `{b:hopper}`.
//
// Run with: node test/variant.mjs

import {
  Chess, WHITE, BLACK, FLAG, ST_FROZEN, ST_SHIELD, TILE, defaultRules, parseSquare,
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
  assert('uncapturable drakes that wall the king are unwinnable',
    out.over && out.reason === 'unwinnable', JSON.stringify(out));
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
  assert('drake cannot be taken', !hasMove(g, 'a3', 'b2') && !hasMove(g, 'b3', 'b2'),
    `king=${names(g, 'a3')} knight=${names(g, 'b3')}`);
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

// ---- the royal guard ----------------------------------------------------
// Free deployment against a known, static enemy meant any slider dropped on
// an open line to their king won on the first ply — 76 of 78 encounters could
// be ended that way. A king with a friend beside it cannot be taken, so a
// fight is now "dismantle the escort" rather than "find the line".

const GUARD = { ...KC, royalGuard: true };

{
  const g = Chess.fromDiagram(`
    . {b:pawn} {b:king} .
    . . . .
    . . . .
    . . {w:rook} .
  `, { files: 4, ranks: 4, rules: GUARD });
  const kingSq = g.kings.b;
  const blows = g.moves({ legal: false }).filter((m) => m.to === kingSq);
  assert('a blow at a guarded king is legal but absorbed',
    blows.length === 1 && Boolean(blows[0].flags & FLAG.GUARD_FALLS), String(blows.length));

  const before = JSON.stringify(g.pieces());
  g.makeMove(blows[0]);
  const after = g.pieces();
  assert('the escort dies in his place',
    !after.some((p) => p.type === 'p') && g.kings.b >= 0, JSON.stringify(after));
  assert('the attacker does not take the square',
    after.some((p) => p.type === 'r' && p.square === blows[0].from));
  g.undo();
  assert('undo stands the escort back up', JSON.stringify(g.pieces()) === before);

  // Escorts are finite, so the fight always ends — this is the whole reason
  // the rule spends a guard instead of forbidding the capture outright.
  g.makeMove(blows[0]);
  g.turn = WHITE;
  assert('with the escort spent the king can be taken',
    g.moves({ legal: false }).some((m) => m.to === g.kings.b && !(m.flags & FLAG.GUARD_FALLS)));

  const bare = Chess.fromDiagram(`
    . . {b:king} .
    . . . .
    . . . .
    . . {w:rook} .
  `, { files: 4, ranks: 4, rules: GUARD });
  assert('an unguarded king is taken outright',
    bare.moves({ legal: false }).some(
      (m) => m.to === bare.kings.b && !(m.flags & FLAG.GUARD_FALLS)));
}

{
  // A Drake next to a king would otherwise make it permanently unkillable,
  // because a Drake cannot be taken at all.
  const g = Chess.fromDiagram(`
    . {b:drake} {b:king} .
    . . . .
    . . . .
    . . {w:rook} .
  `, { files: 4, ranks: 4, rules: GUARD });
  assert('an uncapturable piece cannot be spent as a guard',
    g.moves({ legal: false }).some(
      (m) => m.to === g.kings.b && !(m.flags & FLAG.GUARD_FALLS)));
}

{
  // Frozen guards are not guarding — this is frost's answer to a dug-in king.
  const g = Chess.fromDiagram(`
    . {b:pawn} {b:king} .
    . . . .
    . . . .
    . . {w:rook} .
  `, { files: 4, ranks: 4, rules: GUARD });
  const guardSq = g.kings.b - 1;
  const absorbed = (game) => game.moves({ legal: false })
    .some((m) => m.to === game.kings.b && (m.flags & FLAG.GUARD_FALLS));
  assert('an awake guard soaks the blow', absorbed(g));
  g.status[guardSq] |= ST_FROZEN;
  assert('a frozen guard soaks nothing — the king is takeable', !absorbed(g)
    && g.moves({ legal: false }).some((m) => m.to === g.kings.b));
}

{
  // A shot is a capture too, so the guard has to stop it.
  const g = Chess.fromDiagram(`
    . {b:pawn} {b:king} . .
    . . . . .
    . {w:crossbow} . . .
    . . . . .
    . . . . .
  `, { files: 5, ranks: 5, rules: GUARD });
  const shot = g.moves({ legal: false }).find((m) => m.to === g.kings.b);
  assert('a shot at a guarded king spends the guard too',
    Boolean(shot) && Boolean(shot.flags & FLAG.GUARD_FALLS) && Boolean(shot.flags & FLAG.SHOOT));
}

{
  // Classic chess must not pick the rule up.
  assert('the royal guard is off by default', defaultRules().royalGuard === false);
}

{
  // Every king in the book has to start with an escort beside it, or the rule
  // does nothing for that room and the one-ply snipe comes straight back.
  const unguarded = [];
  for (const enc of Object.values(ENCOUNTERS)) {
    const at = new Map();
    for (const p of enc.enemy) at.set(parseSquare(p.at, enc.ranks), p.type);
    const kingSq = [...at.entries()].find(([, t]) => t === 'k')?.[0];
    const guarded = [-17, -16, -15, -1, 1, 15, 16, 17]
      .some((off) => at.has(kingSq + off) && at.get(kingSq + off) !== 'k');
    if (!guarded) unguarded.push(enc.id);
  }
  assert('every encounter king starts with a guard', unguarded.length === 0, unguarded.join(', '));
}

{
  // The run only ever guards one side. Guarding both made the player's own
  // king as safe to push forward as to keep home, and left the Aegis king's
  // shield with nothing to do — the free guard always spent itself first.
  // One attacker per test, aimed at a king with a guard beside it, so there
  // is no ambiguity about which king a given move threatens.
  const blackGuarded = `
    . {b:pawn} {b:king} .
    . . . .
    . . . .
    . . {w:rook} .
  `;
  const onlyBlack = { ...KC, royalGuard: BLACK };
  const g = Chess.fromDiagram(blackGuarded, { files: 4, ranks: 4, rules: onlyBlack });
  const blow = g.moves({ legal: false }).find((m) => m.to === g.kings.b);
  assert('royalGuard: BLACK guards the black king',
    Boolean(blow) && Boolean(blow.flags & FLAG.GUARD_FALLS), JSON.stringify(blow));

  const whiteGuarded = `
    . . {b:rook} .
    . . . .
    . . . .
    . {w:pawn} {w:king} .
  `;
  const g2 = Chess.fromDiagram(whiteGuarded, { files: 4, ranks: 4, rules: onlyBlack, turn: BLACK });
  const blow2 = g2.moves({ legal: false }).find((m) => m.to === g2.kings.w);
  assert('royalGuard: BLACK does not guard the white king',
    Boolean(blow2) && !(blow2.flags & FLAG.GUARD_FALLS), JSON.stringify(blow2));

  const onlyWhite = { ...KC, royalGuard: WHITE };
  const g3 = Chess.fromDiagram(whiteGuarded, { files: 4, ranks: 4, rules: onlyWhite, turn: BLACK });
  const blow3 = g3.moves({ legal: false }).find((m) => m.to === g3.kings.w);
  assert('royalGuard: WHITE guards the white king',
    Boolean(blow3) && Boolean(blow3.flags & FLAG.GUARD_FALLS), JSON.stringify(blow3));
}

{
  // The run itself must actually be wired to the asymmetric version, not just
  // the engine supporting it in the abstract.
  const run = createRun(1);
  const rules = rulesFor(run);
  assert('the run guards only the enemy king', rules.royalGuard === BLACK, String(rules.royalGuard));
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
  // Sentinel opts the player's own king back into the escort the run
  // otherwise reserves for the enemy.
  const rules = rulesFor({ king: 'sentinel' });
  assert('Sentinel guards the player\'s own king too', rules.royalGuard === true);
  const plain = rulesFor({ king: null });
  assert('a plain king still leaves the run default (enemy only)', plain.royalGuard === BLACK);
}

{
  // Duck: the run wires it straight into the existing Duck Chess rule.
  const rules = rulesFor({ king: 'duck' });
  assert('the Duck king turns on duckChess', rules.duckChess === true);
  const plain = rulesFor({ king: null });
  assert('duckChess is off without it', plain.duckChess === false);
}

{
  // Palisade grants the same token Icebound Cloak does — a king built on an
  // existing, already-balanced relic effect rather than a new one.
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
  applyStartStatuses(warden, { king: 'rampart', relics: [] });
  // Read the squares back from the board rather than guessing algebraic
  // names against the diagram's row/rank orientation.
  const queenSq = warden.pieces().find((p) => p.type === 'q').square;
  const pawnSq = warden.pieces().find((p) => p.type === 'p').square;
  assert('Warden shields the piece beside the king', Boolean(warden.status[queenSq] & ST_SHIELD));
  assert('Warden does not shield a piece further away', !(warden.status[pawnSq] & ST_SHIELD));

  const anchor = Chess.fromDiagram(diagram, { files: 5, ranks: 5, rules: { ...KC } });
  applyStartStatuses(anchor, { king: 'anchor', relics: [] });
  assert('Anchor shields the single costliest piece', Boolean(anchor.status[queenSq] & ST_SHIELD));
  assert('Anchor leaves the cheaper piece alone', !(anchor.status[pawnSq] & ST_SHIELD));

  const formation = Chess.fromDiagram(diagram, { files: 5, ranks: 5, rules: { ...KC } });
  applyStartStatuses(formation, { king: 'formation', relics: [] });
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

console.log(failures ? `\n${failures} variant failure(s)` : '\nAll variant tests passed.');
process.exit(failures ? 1 : 0);
