// Chess rules engine. Pure logic, no DOM — the UI and the AI both talk to it
// through the same small surface.
//
// The board is a 0x88 array: 128 squares laid out as 8 playable files followed
// by 8 off-board ones, so `sq & 0x88` is a one-instruction bounds test and
// sliding pieces can walk off the edge without a wrap-around check. a8 is 0,
// h1 is 119, and "up the board" for White is -16.

export const WHITE = 'w';
export const BLACK = 'b';

export const PAWN = 'p';
export const KNIGHT = 'n';
export const BISHOP = 'b';
export const ROOK = 'r';
export const QUEEN = 'q';
export const KING = 'k';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Move flags, combined as a bitmask on each generated move.
export const FLAG = {
  NORMAL: 1,
  CAPTURE: 2,
  BIG_PAWN: 4,   // two-square pawn advance; sets the en-passant square
  EP_CAPTURE: 8,
  PROMOTION: 16,
  KSIDE_CASTLE: 32,
  QSIDE_CASTLE: 64,
};

const KNIGHT_OFFSETS = [-18, -33, -31, -14, 18, 33, 31, 14];
const KING_OFFSETS = [-17, -16, -15, -1, 1, 15, 16, 17];
const BISHOP_DIRS = [-17, -15, 15, 17];
const ROOK_DIRS = [-16, -1, 1, 16];

const SLIDERS = { b: BISHOP_DIRS, r: ROOK_DIRS, q: KING_OFFSETS };

// Castling rights are tracked as a bitmask; moving off or onto one of these
// squares clears the matching bit, which covers both "the rook moved" and
// "the rook was captured on its home square".
const CASTLE = { K: 1, Q: 2, k: 4, q: 8 };
const CASTLE_MASK = {
  112: CASTLE.Q, 116: CASTLE.K | CASTLE.Q, 119: CASTLE.K, // a1, e1, h1
  0: CASTLE.q, 4: CASTLE.k | CASTLE.q, 7: CASTLE.k,        // a8, e8, h8
};

const RANK_1 = 7;  // rank index (0 = the 8th rank) of White's back rank
const RANK_8 = 0;

export const file = (sq) => sq & 15;
export const rank = (sq) => sq >> 4;
export const onBoard = (sq) => (sq & 0x88) === 0;

/** 'e4' -> 0x88 index. */
export function parseSquare(name) {
  const f = name.charCodeAt(0) - 97;
  const r = 8 - Number(name[1]);
  return r * 16 + f;
}

/** 0x88 index -> 'e4'. */
export function squareName(sq) {
  return String.fromCharCode(97 + file(sq)) + (8 - rank(sq));
}

/** 0x88 index -> {row, col} with row 0 at the top (Black's back rank). */
export function toRowCol(sq) {
  return { row: rank(sq), col: file(sq) };
}

export function fromRowCol(row, col) {
  return row * 16 + col;
}

const swap = (color) => (color === WHITE ? BLACK : WHITE);

export class Chess {
  constructor(fen = START_FEN) {
    this.load(fen);
  }

  load(fen) {
    this.board = new Array(128).fill(null);
    this.kings = { w: -1, b: -1 };
    this.history = [];

    const [placement, turn, castling, ep, half, full] = fen.split(/\s+/);

    let sq = 0;
    for (const ch of placement) {
      if (ch === '/') {
        sq += 8;  // skip the off-board half of the row
      } else if (ch >= '1' && ch <= '8') {
        sq += Number(ch);
      } else {
        const color = ch === ch.toUpperCase() ? WHITE : BLACK;
        const type = ch.toLowerCase();
        this.board[sq] = { type, color };
        if (type === KING) this.kings[color] = sq;
        sq++;
      }
    }

    this.turn = turn === 'b' ? BLACK : WHITE;
    this.castling = 0;
    for (const ch of castling) if (CASTLE[ch]) this.castling |= CASTLE[ch];
    this.epSquare = ep && ep !== '-' ? parseSquare(ep) : -1;
    this.halfMoves = Number(half ?? 0);
    this.moveNumber = Number(full ?? 1);

    this.positionCounts = new Map();
    this.countPosition();
    return this;
  }

  clone() {
    const copy = new Chess(this.fen());
    copy.positionCounts = new Map(this.positionCounts);
    return copy;
  }

  fen() {
    let placement = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const piece = this.board[r * 16 + f];
        if (!piece) {
          empty++;
        } else {
          if (empty) { placement += empty; empty = 0; }
          placement += piece.color === WHITE ? piece.type.toUpperCase() : piece.type;
        }
      }
      if (empty) placement += empty;
      if (r < 7) placement += '/';
    }

    let castling = '';
    if (this.castling & CASTLE.K) castling += 'K';
    if (this.castling & CASTLE.Q) castling += 'Q';
    if (this.castling & CASTLE.k) castling += 'k';
    if (this.castling & CASTLE.q) castling += 'q';

    return [
      placement,
      this.turn,
      castling || '-',
      this.epSquare >= 0 ? squareName(this.epSquare) : '-',
      this.halfMoves,
      this.moveNumber,
    ].join(' ');
  }

  /** Everything that defines a repetition: placement, turn, castling, en passant. */
  positionKey() {
    return this.fen().split(' ').slice(0, 4).join(' ');
  }

  countPosition() {
    const key = this.positionKey();
    this.positionCounts.set(key, (this.positionCounts.get(key) || 0) + 1);
  }

  get(square) {
    const sq = typeof square === 'string' ? parseSquare(square) : square;
    return this.board[sq] || null;
  }

  // ---- attack detection --------------------------------------------------

  /**
   * Is `sq` attacked by any piece of `color`? Rays are cast outward *from* the
   * target square, which is far cheaper than asking every enemy piece where it
   * could go — this runs inside the move-legality filter and the search.
   */
  attacked(color, sq) {
    const board = this.board;

    // Pawns. A white pawn on sq+15 or sq+17 captures onto sq.
    const pawnFrom = color === WHITE ? [sq + 15, sq + 17] : [sq - 15, sq - 17];
    for (const from of pawnFrom) {
      if (!onBoard(from)) continue;
      const p = board[from];
      if (p && p.color === color && p.type === PAWN) return true;
    }

    for (const off of KNIGHT_OFFSETS) {
      const from = sq + off;
      if (!onBoard(from)) continue;
      const p = board[from];
      if (p && p.color === color && p.type === KNIGHT) return true;
    }

    for (const off of KING_OFFSETS) {
      const from = sq + off;
      if (!onBoard(from)) continue;
      const p = board[from];
      if (p && p.color === color && p.type === KING) return true;
    }

    for (const dir of BISHOP_DIRS) {
      let from = sq + dir;
      while (onBoard(from)) {
        const p = board[from];
        if (p) {
          if (p.color === color && (p.type === BISHOP || p.type === QUEEN)) return true;
          break;
        }
        from += dir;
      }
    }

    for (const dir of ROOK_DIRS) {
      let from = sq + dir;
      while (onBoard(from)) {
        const p = board[from];
        if (p) {
          if (p.color === color && (p.type === ROOK || p.type === QUEEN)) return true;
          break;
        }
        from += dir;
      }
    }

    return false;
  }

  kingAttacked(color) {
    const king = this.kings[color];
    return king >= 0 && this.attacked(swap(color), king);
  }

  inCheck() {
    return this.kingAttacked(this.turn);
  }

  // ---- move generation ---------------------------------------------------

  /**
   * Legal moves for the side to move.
   * @param {object} opts
   * @param {string|number} [opts.square] restrict to moves from one square
   * @param {boolean} [opts.capturesOnly] only captures and promotions (quiescence)
   * @param {boolean} [opts.legal=true] set false for pseudo-legal moves
   */
  moves({ square, capturesOnly = false, legal = true } = {}) {
    const us = this.turn;
    const them = swap(us);
    const board = this.board;
    const out = [];

    const only = square == null
      ? null
      : (typeof square === 'string' ? parseSquare(square) : square);

    const add = (from, to, flags, captured, promotion) => {
      // A pawn reaching the last rank always promotes; emit one move per choice.
      if (board[from].type === PAWN && (rank(to) === RANK_8 || rank(to) === RANK_1)) {
        for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
          out.push({
            from, to, color: us, piece: PAWN,
            captured: captured || null,
            promotion: promo,
            flags: flags | FLAG.PROMOTION,
          });
        }
        return;
      }
      out.push({
        from, to, color: us, piece: board[from].type,
        captured: captured || null,
        promotion: promotion || null,
        flags,
      });
    };

    const first = only != null ? only : 0;
    const last = only != null ? only : 119;

    for (let from = first; from <= last; from++) {
      if (from & 0x88) { from += 7; continue; }
      const piece = board[from];
      if (!piece || piece.color !== us) continue;

      if (piece.type === PAWN) {
        const forward = us === WHITE ? -16 : 16;
        const startRank = us === WHITE ? 6 : 1;

        if (!capturesOnly) {
          const one = from + forward;
          if (onBoard(one) && !board[one]) {
            add(from, one, FLAG.NORMAL);
            const two = from + forward * 2;
            if (rank(from) === startRank && !board[two]) {
              add(from, two, FLAG.BIG_PAWN);
            }
          }
        }

        for (const diag of [forward - 1, forward + 1]) {
          const to = from + diag;
          if (!onBoard(to)) continue;
          const target = board[to];
          if (target && target.color === them) {
            add(from, to, FLAG.CAPTURE, target.type);
          } else if (!target && to === this.epSquare) {
            add(from, to, FLAG.EP_CAPTURE, PAWN);
          }
        }
        continue;
      }

      if (piece.type === KNIGHT || piece.type === KING) {
        const offsets = piece.type === KNIGHT ? KNIGHT_OFFSETS : KING_OFFSETS;
        for (const off of offsets) {
          const to = from + off;
          if (!onBoard(to)) continue;
          const target = board[to];
          if (!target) {
            if (!capturesOnly) add(from, to, FLAG.NORMAL);
          } else if (target.color === them) {
            add(from, to, FLAG.CAPTURE, target.type);
          }
        }
        continue;
      }

      for (const dir of SLIDERS[piece.type]) {
        let to = from + dir;
        while (onBoard(to)) {
          const target = board[to];
          if (!target) {
            if (!capturesOnly) add(from, to, FLAG.NORMAL);
          } else {
            if (target.color === them) add(from, to, FLAG.CAPTURE, target.type);
            break;
          }
          to += dir;
        }
      }
    }

    // Castling. Generated only when the whole king path is clear and unattacked;
    // the king's destination is re-checked by the legality filter below anyway.
    const kingSq = this.kings[us];
    const wantsKing = only == null || only === kingSq;
    if (!capturesOnly && wantsKing && kingSq >= 0 && !this.attacked(them, kingSq)) {
      const kFlag = us === WHITE ? CASTLE.K : CASTLE.k;
      const qFlag = us === WHITE ? CASTLE.Q : CASTLE.q;

      if (this.castling & kFlag) {
        const f1 = kingSq + 1, f2 = kingSq + 2;
        if (!board[f1] && !board[f2] && !this.attacked(them, f1) && !this.attacked(them, f2)) {
          out.push({
            from: kingSq, to: f2, color: us, piece: KING,
            captured: null, promotion: null, flags: FLAG.KSIDE_CASTLE,
          });
        }
      }
      if (this.castling & qFlag) {
        const d1 = kingSq - 1, c1 = kingSq - 2, b1 = kingSq - 3;
        if (!board[d1] && !board[c1] && !board[b1] &&
            !this.attacked(them, d1) && !this.attacked(them, c1)) {
          out.push({
            from: kingSq, to: c1, color: us, piece: KING,
            captured: null, promotion: null, flags: FLAG.QSIDE_CASTLE,
          });
        }
      }
    }

    if (!legal) return out;

    const legalMoves = [];
    for (const move of out) {
      this.makeMove(move);
      if (!this.kingAttacked(us)) legalMoves.push(move);
      this.undo();
    }
    return legalMoves;
  }

  // ---- making and unmaking ----------------------------------------------

  /** Applies a move with no legality check. Every field is restored by undo(). */
  makeMove(move) {
    const us = move.color;
    const them = swap(us);
    const board = this.board;

    this.history.push({
      move,
      turn: this.turn,
      castling: this.castling,
      epSquare: this.epSquare,
      halfMoves: this.halfMoves,
      moveNumber: this.moveNumber,
      kings: { w: this.kings.w, b: this.kings.b },
    });

    board[move.to] = board[move.from];
    board[move.from] = null;

    if (move.flags & FLAG.EP_CAPTURE) {
      board[move.to + (us === WHITE ? 16 : -16)] = null;
    }
    if (move.promotion) {
      board[move.to] = { type: move.promotion, color: us };
    }
    if (board[move.to].type === KING) {
      this.kings[us] = move.to;
      if (move.flags & FLAG.KSIDE_CASTLE) {
        board[move.to - 1] = board[move.to + 1];
        board[move.to + 1] = null;
      } else if (move.flags & FLAG.QSIDE_CASTLE) {
        board[move.to + 1] = board[move.to - 2];
        board[move.to - 2] = null;
      }
      this.castling &= us === WHITE ? ~(CASTLE.K | CASTLE.Q) : ~(CASTLE.k | CASTLE.q);
    }

    if (CASTLE_MASK[move.from]) this.castling &= ~CASTLE_MASK[move.from];
    if (CASTLE_MASK[move.to]) this.castling &= ~CASTLE_MASK[move.to];

    this.epSquare = (move.flags & FLAG.BIG_PAWN)
      ? move.from + (us === WHITE ? -16 : 16)
      : -1;

    // The fifty-move counter resets on a pawn move or a capture.
    this.halfMoves = (move.piece === PAWN || (move.flags & (FLAG.CAPTURE | FLAG.EP_CAPTURE)))
      ? 0
      : this.halfMoves + 1;
    if (us === BLACK) this.moveNumber++;
    this.turn = them;
  }

  undo() {
    const state = this.history.pop();
    if (!state) return null;
    const { move } = state;
    const board = this.board;
    const us = move.color;

    this.turn = state.turn;
    this.castling = state.castling;
    this.epSquare = state.epSquare;
    this.halfMoves = state.halfMoves;
    this.moveNumber = state.moveNumber;
    this.kings = state.kings;

    board[move.from] = move.promotion
      ? { type: PAWN, color: us }
      : board[move.to];
    board[move.to] = null;

    if (move.flags & FLAG.EP_CAPTURE) {
      board[move.to + (us === WHITE ? 16 : -16)] = { type: PAWN, color: swap(us) };
    } else if (move.captured) {
      board[move.to] = { type: move.captured, color: swap(us) };
    }

    if (move.flags & FLAG.KSIDE_CASTLE) {
      board[move.to + 1] = board[move.to - 1];
      board[move.to - 1] = null;
    } else if (move.flags & FLAG.QSIDE_CASTLE) {
      board[move.to - 2] = board[move.to + 1];
      board[move.to + 1] = null;
    }

    return move;
  }

  /**
   * Plays a legal move. Accepts a move object from moves(), or
   * {from, to, promotion} with squares as names or indices.
   * Returns the played move (with `san` attached) or null if it is not legal.
   */
  move(input) {
    const from = typeof input.from === 'string' ? parseSquare(input.from) : input.from;
    const to = typeof input.to === 'string' ? parseSquare(input.to) : input.to;
    const promotion = input.promotion || null;

    const candidate = this.moves({ square: from }).find(
      (m) => m.to === to && (!m.promotion || !promotion || m.promotion === promotion),
    );
    if (!candidate) return null;

    // Without an explicit choice a promoting pawn becomes a queen.
    const chosen = candidate.promotion && promotion
      ? this.moves({ square: from }).find((m) => m.to === to && m.promotion === promotion)
      : candidate;

    const san = this.toSan(chosen);
    this.makeMove(chosen);
    this.countPosition();
    const played = { ...chosen, san };
    this.history[this.history.length - 1].san = san;
    return played;
  }

  undoMove() {
    const key = this.positionKey();
    const count = this.positionCounts.get(key);
    if (count > 1) this.positionCounts.set(key, count - 1);
    else this.positionCounts.delete(key);
    return this.undo();
  }

  // ---- notation ----------------------------------------------------------

  /** Standard algebraic notation for a move in the current position. */
  toSan(move) {
    if (move.flags & FLAG.KSIDE_CASTLE) return this.withCheckSuffix(move, 'O-O');
    if (move.flags & FLAG.QSIDE_CASTLE) return this.withCheckSuffix(move, 'O-O-O');

    let san = '';
    if (move.piece === PAWN) {
      if (move.flags & (FLAG.CAPTURE | FLAG.EP_CAPTURE)) {
        san += String.fromCharCode(97 + file(move.from)) + 'x';
      }
    } else {
      san += move.piece.toUpperCase();
      // Disambiguate only against other pieces of the same type that could
      // also reach the destination.
      const rivals = this.moves().filter(
        (m) => m.piece === move.piece && m.to === move.to && m.from !== move.from,
      );
      if (rivals.length) {
        const sameFile = rivals.some((m) => file(m.from) === file(move.from));
        const sameRank = rivals.some((m) => rank(m.from) === rank(move.from));
        if (!sameFile) san += String.fromCharCode(97 + file(move.from));
        else if (!sameRank) san += 8 - rank(move.from);
        else san += squareName(move.from);
      }
      if (move.flags & FLAG.CAPTURE) san += 'x';
    }

    san += squareName(move.to);
    if (move.promotion) san += '=' + move.promotion.toUpperCase();
    return this.withCheckSuffix(move, san);
  }

  withCheckSuffix(move, san) {
    this.makeMove(move);
    let suffix = '';
    if (this.inCheck()) suffix = this.moves().length === 0 ? '#' : '+';
    this.undo();
    return san + suffix;
  }

  // ---- terminal states ---------------------------------------------------

  isCheckmate() {
    return this.inCheck() && this.moves().length === 0;
  }

  isStalemate() {
    return !this.inCheck() && this.moves().length === 0;
  }

  /** Neither side can force mate with the material left on the board. */
  isInsufficientMaterial() {
    const counts = { w: [], b: [] };
    for (let sq = 0; sq <= 119; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const piece = this.board[sq];
      if (piece && piece.type !== KING) counts[piece.color].push({ ...piece, sq });
    }
    const all = [...counts.w, ...counts.b];
    if (all.length === 0) return true;                       // K v K
    if (all.length === 1 && (all[0].type === BISHOP || all[0].type === KNIGHT)) return true;
    // K+B v K+B with both bishops on the same colour complex.
    if (all.length === 2 && all.every((p) => p.type === BISHOP) &&
        counts.w.length === 1 && counts.b.length === 1) {
      const shade = (sq) => (rank(sq) + file(sq)) % 2;
      if (shade(all[0].sq) === shade(all[1].sq)) return true;
    }
    return false;
  }

  isThreefoldRepetition() {
    return (this.positionCounts.get(this.positionKey()) || 0) >= 3;
  }

  isFiftyMoveDraw() {
    return this.halfMoves >= 100;
  }

  isDraw() {
    return this.isStalemate() || this.isInsufficientMaterial() ||
      this.isThreefoldRepetition() || this.isFiftyMoveDraw();
  }

  isGameOver() {
    return this.isCheckmate() || this.isDraw();
  }

  /** A short reason string once the game is over, or null while it continues. */
  outcome() {
    if (this.isCheckmate()) {
      return { over: true, winner: swap(this.turn), reason: 'checkmate' };
    }
    if (this.isStalemate()) return { over: true, winner: null, reason: 'stalemate' };
    if (this.isInsufficientMaterial()) {
      return { over: true, winner: null, reason: 'insufficient material' };
    }
    if (this.isThreefoldRepetition()) {
      return { over: true, winner: null, reason: 'threefold repetition' };
    }
    if (this.isFiftyMoveDraw()) return { over: true, winner: null, reason: 'fifty-move rule' };
    return { over: false, winner: null, reason: null };
  }

  /** All pieces currently on the board, for rendering. */
  pieces() {
    const list = [];
    for (let sq = 0; sq <= 119; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const piece = this.board[sq];
      if (piece) list.push({ ...piece, square: sq });
    }
    return list;
  }
}

export { swap };
