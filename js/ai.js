// The computer opponent: negamax with alpha-beta pruning, a quiescence search
// so it stops hanging pieces at the horizon, and move ordering to make the
// pruning actually bite.
//
// Difficulty is expressed as search depth plus a "slip" chance — an easy
// opponent genuinely considers the position, it just sometimes picks a move
// that isn't the best one, which feels far more human than a weak evaluator.

import { Chess, WHITE, BLACK, PAWN, BISHOP, KING, FLAG, ST_SHIELD, file, rank } from './chess.js';
import { PIECES, pieceValue } from './pieces.js';

const VALUE = Object.fromEntries(Object.values(PIECES).map((p) => [p.id, p.value]));

// Piece-square tables, written from White's point of view with the 8th rank on
// the top row, so they read like a board. Black looks them up mirrored.
const PST = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  q: [
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  // The king wants a corner in the middlegame and the centre in the endgame,
  // so two tables get blended by how much material is left.
  k: [
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20,
  ],
  kEnd: [
   -50,-40,-30,-20,-20,-30,-40,-50,
   -30,-20,-10,  0,  0,-10,-20,-30,
   -30,-10, 20, 30, 30, 20,-10,-30,
   -30,-10, 30, 40, 40, 30,-10,-30,
   -30,-10, 30, 40, 40, 30,-10,-30,
   -30,-10, 20, 30, 30, 20,-10,-30,
   -30,-30,  0,  0,  0,  0,-30,-30,
   -50,-30,-30,-30,-30,-30,-30,-50,
  ],
};

const MATE = 100000;
const MAX_QUIESCENCE = 6;

/** True when this capture actually removes the royal — a shield bounce does not. */
function killsRoyal(move) {
  return Boolean(move && move.captured === KING && !(move.flags & FLAG.SHIELD_BREAK));
}

/** Difficulty presets, exposed so the UI can label them. */
export const LEVELS = [
  { id: 1, name: 'Pawn',   blurb: 'Sees a little, and sometimes picks the second-best.', depth: 3, slip: 0.16, budget: 350 },
  { id: 2, name: 'Knight', blurb: 'Takes what you hang, misses the rest.',      depth: 3, slip: 0.08, budget: 550 },
  { id: 3, name: 'Bishop', blurb: 'Punishes loose pieces and short tactics.',   depth: 4, slip: 0.03, budget: 900 },
  { id: 4, name: 'Rook',   blurb: 'Calculates properly. You will need a plan.', depth: 5, slip: 0.0,  budget: 1600 },
  { id: 5, name: 'Queen',  blurb: 'Searches as deep as the clock allows.',      depth: 7, slip: 0.0,  budget: 2800 },
];

export function levelById(id) {
  return LEVELS.find((l) => l.id === Number(id)) || LEVELS[2];
}

/** Static evaluation in centipawns, always from White's point of view. */
export function evaluate(game) {
  if (game.kings.w < 0) return -MATE;
  if (game.kings.b < 0) return MATE;

  const board = game.board;
  const classicBoard = game.files === 8 && game.ranks === 8;
  let score = 0;
  let phase = 0;                        // non-pawn material, for king tapering
  const bishops = { w: 0, b: 0 };
  const pawnFiles = { w: new Array(game.files).fill(0), b: new Array(game.files).fill(0) };
  const kingSq = {};
  const kingIdx = {};

  for (let sq = 0; sq <= 119; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    if (!game.inBounds(sq)) continue;
    const piece = board[sq];
    if (!piece) continue;

    const row = sq >> 4;
    const col = sq & 15;
    const sign = piece.color === WHITE ? 1 : -1;
    const val = VALUE[piece.type] ?? pieceValue(piece.type);

    if (piece.type === KING) {
      kingSq[piece.color] = sq;
      kingIdx[piece.color] = classicBoard
        ? (piece.color === WHITE ? row * 8 + col : (7 - row) * 8 + col)
        : -1;
      continue;
    }

    score += sign * val;

    if (classicBoard && PST[piece.type]) {
      const idx = piece.color === WHITE ? row * 8 + col : (7 - row) * 8 + col;
      score += sign * PST[piece.type][idx];
    } else {
      score += sign * centerBonus(col, row, game.files, game.ranks);
    }

    if (piece.type !== PAWN) phase += val;
    if (piece.type === BISHOP) bishops[piece.color]++;
    if (piece.type === PAWN && col < pawnFiles[piece.color].length) {
      pawnFiles[piece.color][col]++;
    }
  }

  // 0 = bare kings, 1 = both sides still have their whole army.
  const opening = Math.min(1, phase / 6800);
  for (const color of ['w', 'b']) {
    const sign = color === WHITE ? 1 : -1;
    if (classicBoard && kingIdx[color] >= 0) {
      const idx = kingIdx[color];
      const mid = PST.k[idx];
      const end = PST.kEnd[idx];
      score += sign * (mid * opening + end * (1 - opening));
    } else if (kingSq[color] >= 0) {
      const sq = kingSq[color];
      const col = file(sq);
      const row = rank(sq);
      if (game.rules.kingCapture) {
        // Stay back. Walking the king into the scrum is how fights end.
        const home = color === WHITE ? game.ranks - 1 : 0;
        score += sign * (8 - Math.abs(row - home) * 4);
        const midFile = (game.files - 1) / 2;
        score += sign * (2 - Math.abs(col - midFile));
      } else {
        score += sign * centerBonus(col, row, game.files, game.ranks);
      }
    }
  }

  if (game.rules.kingCapture) {
    score += kingSafety(game, WHITE) - kingSafety(game, BLACK);
  }

  if (bishops.w >= 2) score += 30;
  if (bishops.b >= 2) score -= 30;

  // Pawn structure: doubled pawns are a liability, isolated ones more so.
  for (const color of ['w', 'b']) {
    const sign = color === WHITE ? 1 : -1;
    const files = pawnFiles[color];
    for (let f = 0; f < files.length; f++) {
      if (!files[f]) continue;
      if (files[f] > 1) score -= sign * 14 * (files[f] - 1);
      const neighbours = (f > 0 ? files[f - 1] : 0) + (f < 7 ? files[f + 1] : 0);
      if (!neighbours) score -= sign * 16;
    }
  }

  return score;
}

// Most Valuable Victim / Least Valuable Attacker: try the fat captures first,
// since a good early move makes alpha-beta cut off most of the rest.
function pieceVal(type) {
  return VALUE[type] ?? pieceValue(type) ?? 0;
}

function centerBonus(col, row, files, ranks) {
  const cf = (files - 1) / 2;
  const cr = (ranks - 1) / 2;
  return 10 - (Math.abs(col - cf) + Math.abs(row - cr)) * 3;
}

/** True when the side to move's king can be taken this turn. */
function isThreatened(game) {
  if (game.rules.kingCapture) return game.kingAttacked(game.turn);
  return game.inCheck();
}

/**
 * King-capture safety from that colour's point of view. A hanging king is
 * almost the whole game; sitting next to the enemy army is how it gets there.
 */
function kingSafety(game, color) {
  const king = game.kings[color];
  if (king < 0) return 0;
  const them = color === WHITE ? BLACK : WHITE;
  if (game.kingAttacked(color) && !(game.status[king] & ST_SHIELD)) return -4800;

  let score = 0;
  const kf = file(king);
  const kr = rank(king);
  const board = game.board;
  for (let sq = 0; sq <= 119; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    if (!game.inBounds(sq)) continue;
    const piece = board[sq];
    if (!piece || piece.color !== them || piece.type === KING) continue;
    const d = Math.max(Math.abs((sq & 15) - kf), Math.abs((sq >> 4) - kr));
    if (d === 1) score -= 55;
    else if (d === 2) score -= 16;
  }
  return score;
}

/** After this move, can the opponent take our king (or did we burn it)? */
function leavesKingHanging(game, move) {
  if (!game.rules.kingCapture) return false;
  game.makeMove(move);
  const us = move.color;
  const king = game.kings[us];
  const hang = king < 0 || (game.kingAttacked(us) && !(game.status[king] & ST_SHIELD));
  game.undo();
  return hang;
}

function moveScore(move, killers, ply) {
  if (killsRoyal(move)) return 5000000;
  if (move.captured) {
    return 10000 + pieceVal(move.captured) * 10 - pieceVal(move.piece);
  }
  if (move.promotion) return 9000 + VALUE[move.promotion];
  const killer = killers[ply];
  if (killer && killer.from === move.from && killer.to === move.to) return 8000;
  if (move.flags & (FLAG.KSIDE_CASTLE | FLAG.QSIDE_CASTLE)) return 500;
  return 0;
}

function order(moves, killers, ply, preferred) {
  const scored = moves.map((move) => {
    let score = moveScore(move, killers, ply);
    if (preferred && move.from === preferred.from && move.to === preferred.to &&
        move.promotion === preferred.promotion) {
      score += 1000000;                  // principal variation move from the last iteration
    }
    return { move, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.move);
}

class Search {
  constructor(game, deadline) {
    this.game = game;
    this.deadline = deadline;
    this.killers = [];
    this.nodes = 0;
    this.aborted = false;
  }

  outOfTime() {
    // Checking the clock is not free, so only sample it every so often.
    if ((this.nodes & 1023) !== 0) return this.aborted;
    if (performance.now() >= this.deadline) this.aborted = true;
    return this.aborted;
  }

  quiescence(alpha, beta, qdepth) {
    this.nodes++;
    const game = this.game;
    if (game.kings[game.turn] < 0) return -MATE;
    const them = game.turn === WHITE ? BLACK : WHITE;
    if (game.kings[them] < 0) return MATE;

    const sign = game.turn === WHITE ? 1 : -1;
    const stand = sign * evaluate(game);
    const threatened = isThreatened(game);

    if (qdepth <= 0) return threatened ? -MATE : stand;

    // A hanging king is not something you can stand pat on — take it, flee,
    // or lose. In king-capture that also means searching quiet escapes.
    if (!threatened) {
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
    }

    const moves = order(
      game.moves({ capturesOnly: !threatened }),
      this.killers, 0, null,
    );
    if (threatened && !moves.length) return -MATE;

    let best = threatened ? -MATE : stand;
    for (const move of moves) {
      if (killsRoyal(move)) return MATE;
      if (!threatened && move.captured && stand + pieceVal(move.captured) + 200 < alpha) continue;
      game.makeMove(move);
      const score = -this.quiescence(-beta, -alpha, qdepth - 1);
      game.undo();
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  negamax(depth, alpha, beta, ply, preferred) {
    this.nodes++;
    if (this.outOfTime()) return evaluate(this.game) * (this.game.turn === WHITE ? 1 : -1);

    const game = this.game;
    if (game.halfMoves >= 100) return 0;

    if (game.kings[game.turn] < 0) return -MATE + ply;
    if (game.kings[game.turn === WHITE ? BLACK : WHITE] < 0) return MATE - ply;

    const threatened = isThreatened(game);
    if (threatened && ply < 18) depth++;

    if (depth <= 0) return this.quiescence(alpha, beta, MAX_QUIESCENCE);

    const moves = game.moves();
    const royalKill = moves.find(killsRoyal);
    if (royalKill) {
      if (ply === 0) this.rootBest = royalKill;
      return MATE - ply;
    }
    if (moves.length === 0) {
      // Mate scores are pushed toward zero by distance, so the search prefers
      // mate in two over mate in four. King-capture treats a smothered side
      // as a loss rather than a stalemate.
      if (game.rules.kingCapture || threatened) return -MATE + ply;
      return 0;
    }

    let best = -Infinity;
    let bestMove = null;
    for (const move of order(moves, this.killers, ply, ply === 0 ? preferred : null)) {
      game.makeMove(move);
      const score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, null);
      game.undo();
      if (this.aborted) return best === -Infinity
        ? evaluate(game) * (game.turn === WHITE ? 1 : -1)
        : best;

      if (score > best) { best = score; bestMove = move; }
      if (best > alpha) alpha = best;
      if (alpha >= beta) {
        if (!move.captured) this.killers[ply] = { from: move.from, to: move.to };
        break;
      }
    }

    if (ply === 0) this.rootBest = bestMove;
    return best;
  }
}

/**
 * Pick a move for the side to move.
 * @param {Chess|string} position a game or a FEN
 * @param {object} level a LEVELS entry
 * @returns {{from:number,to:number,promotion:?string,score:number,depth:number,nodes:number}|null}
 */
export function chooseMove(position, level) {
  const game = position instanceof Chess ? position : new Chess(position);
  const legal = game.moves();
  if (legal.length === 0) return null;

  // Taking the king ends the fight. Never search past it and never slip off it
  // — an easy opponent still knows how to finish.
  const royalKill = legal.find(killsRoyal);
  if (royalKill) {
    return {
      from: royalKill.from,
      to: royalKill.to,
      promotion: royalKill.promotion || null,
      score: MATE,
      depth: 0,
      nodes: 0,
    };
  }

  const safe = game.rules.kingCapture
    ? legal.filter((m) => !leavesKingHanging(game, m))
    : legal;
  const candidates = safe.length ? safe : legal;

  const deadline = performance.now() + level.budget;
  const search = new Search(game, deadline);
  let best = candidates[0];
  let bestScore = 0;
  let reached = 0;

  // Iterative deepening: each pass seeds the next one's move ordering, so
  // going deeper is much cheaper than searching that depth from scratch.
  for (let depth = 1; depth <= level.depth; depth++) {
    search.rootBest = null;
    const score = search.negamax(depth, -Infinity, Infinity, 0, best);
    if (search.aborted && !search.rootBest) break;
    if (search.rootBest) {
      best = search.rootBest;
      bestScore = score;
      reached = depth;
    }
    if (search.aborted) break;
    if (Math.abs(score) > MATE - 100) break;   // forced mate found, stop looking
  }

  // Never walk the king onto a taken square if any safe move exists — even
  // when a shallow abort left a suicide as the "best" line.
  if (safe.length && leavesKingHanging(game, best)) {
    best = safe[0];
    let pick = -Infinity;
    for (const move of safe) {
      game.makeMove(move);
      const score = (move.color === WHITE ? 1 : -1) * evaluate(game);
      game.undo();
      if (score > pick) { pick = score; best = move; }
    }
    bestScore = pick;
  }

  // Weaker levels sometimes play a near-best move instead of the principal
  // one. They still will not hang the king or ignore a recapture that search
  // already priced as winning.
  if (level.slip > 0 && Math.random() < level.slip && Math.abs(bestScore) < MATE - 100) {
    const us = game.turn === WHITE ? 1 : -1;
    const ranked = candidates.map((move) => {
      game.makeMove(move);
      const score = us * evaluate(game);
      game.undo();
      return { move, score };
    });
    ranked.sort((a, b) => b.score - a.score);
    const floor = ranked[0].score - 180;
    const pool = ranked.filter((r) => r.score >= floor);
    const pick = pool[Math.floor(Math.random() * pool.length)].move;
    best = pick;
  }

  return {
    from: best.from,
    to: best.to,
    promotion: best.promotion || null,
    score: bestScore,
    depth: reached,
    nodes: search.nodes,
  };
}

/** After a piece move in Duck Chess, park the duck. Heuristic, not a search. */
export function chooseDuck(game) {
  const options = game.duckSquares();
  if (!options.length) return null;
  const us = game.turn === WHITE ? BLACK : WHITE; // side that just moved
  const them = game.turn;
  let best = options[0];
  let bestScore = -Infinity;
  for (const sq of options) {
    let score = 0;
    const king = game.kings[them];
    if (king >= 0) {
      const df = Math.abs((sq & 15) - (king & 15));
      const dr = Math.abs((sq >> 4) - (king >> 4));
      if (df <= 1 && dr <= 1 && (df || dr)) score += 40;
    }
    const ours = game.kings[us];
    if (ours >= 0) {
      const df = Math.abs((sq & 15) - (ours & 15));
      const dr = Math.abs((sq >> 4) - (ours >> 4));
      score -= (df + dr);
    }
    score += ((sq & 15) === ((game.files / 2) | 0) ? 2 : 0);
    if (score > bestScore) { bestScore = score; best = sq; }
  }
  return best;
}
