// Chess rules engine. Pure logic, no DOM — the UI and the AI both talk to it
// through the same small surface.
//
// The board is a 0x88 array: 128 squares laid out as 8 playable files followed
// by 8 off-board ones, so `sq & 0x88` is a one-instruction bounds test and
// sliding pieces can walk off the edge without a wrap-around check. a8 is 0,
// h1 is 119, and "up the board" for White is -16.
//
// Variant games shrink the playable rectangle (files × ranks), paint terrain
// onto squares, and swap checkmate for king-capture. Movement for every piece
// — classic and fairy — is read from the piece registry. The classic 8×8 path
// is a specialised generator so perft stays honest and fast.

import {
  PIECES, pieceById, isClassicType, PROMOTE_TO, isQueenLike,
} from './pieces.js';

export const WHITE = 'w';
export const BLACK = 'b';

export const PAWN = 'p';
export const KNIGHT = 'n';
export const BISHOP = 'b';
export const ROOK = 'r';
export const QUEEN = 'q';
export const KING = 'k';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const FLAG = {
  NORMAL: 1,
  CAPTURE: 2,
  BIG_PAWN: 4,
  EP_CAPTURE: 8,
  PROMOTION: 16,
  KSIDE_CASTLE: 32,
  QSIDE_CASTLE: 64,
  SHIELD_BREAK: 128,
  WISP_BOOM: 256,
};

export const TILE = {
  NONE: 0,
  BLOCK: 1,
  FROST: 2,
  FORT: 3,
  FIRE: 4,
};

export const TILE_NAME = { 0: 'none', 1: 'block', 2: 'frost', 3: 'fort', 4: 'fire' };
export const TILE_ID = { none: 0, block: 1, frost: 2, fort: 3, fire: 4, '#': 1, '*': 2, '+': 3, '^': 4 };

export const ST_FROZEN = 1;
export const ST_SHIELD = 2;

const KNIGHT_OFFSETS = [-18, -33, -31, -14, 18, 33, 31, 14];
const KING_OFFSETS = [-17, -16, -15, -1, 1, 15, 16, 17];
const BISHOP_DIRS = [-17, -15, 15, 17];
const ROOK_DIRS = [-16, -1, 1, 16];

const SLIDERS = { b: BISHOP_DIRS, r: ROOK_DIRS, q: KING_OFFSETS };

const CASTLE = { K: 1, Q: 2, k: 4, q: 8 };
const CASTLE_MASK = {
  112: CASTLE.Q, 116: CASTLE.K | CASTLE.Q, 119: CASTLE.K,
  0: CASTLE.q, 4: CASTLE.k | CASTLE.q, 7: CASTLE.k,
};

const RANK_1 = 7;
const RANK_8 = 0;

export const file = (sq) => sq & 15;
export const rank = (sq) => sq >> 4;
export const onBoard = (sq) => (sq & 0x88) === 0;

/** 'e4' -> 0x88 index. Rank numbers are relative to `ranks` (default 8). */
export function parseSquare(name, ranks = 8) {
  const f = name.charCodeAt(0) - 97;
  const n = Number(name.slice(1));
  return (ranks - n) * 16 + f;
}

/** 0x88 index -> 'e4'. Rank numbers follow the live board height. */
export function squareName(sq, ranks = 8) {
  return String.fromCharCode(97 + file(sq)) + (ranks - rank(sq));
}

/** 0x88 index -> {row, col} with row 0 at the top (Black's back rank). */
export function toRowCol(sq) {
  return { row: rank(sq), col: file(sq) };
}

export function fromRowCol(row, col) {
  return row * 16 + col;
}

export const swap = (color) => (color === WHITE ? BLACK : WHITE);

export function defaultRules() {
  return {
    checks: true,
    kingCapture: false,
    castling: true,
    royalLeaps: null,
    duckChess: false,
  };
}

function emptyFen(files, ranks) {
  const row = String(files);
  return `${new Array(ranks).fill(row).join('/')} w - - 0 1`;
}

export class Chess {
  /**
   * @param {string|object} [fenOrSpec]
   * @param {object} [options]
   */
  constructor(fenOrSpec = START_FEN, options = {}) {
    if (fenOrSpec && typeof fenOrSpec === 'object') {
      this.load(fenOrSpec.fen ?? emptyFen(fenOrSpec.files ?? 8, fenOrSpec.ranks ?? 8), fenOrSpec);
    } else {
      this.load(fenOrSpec, options);
    }
  }

  load(fen, options = {}) {
    this.files = options.files ?? 8;
    this.ranks = options.ranks ?? 8;
    this.rules = { ...defaultRules(), ...(options.rules || {}) };
    this.kingPassives = options.kingPassives ? options.kingPassives.slice() : [];
    this.board = new Array(128).fill(null);
    this.status = new Uint8Array(128);
    this.terrain = new Uint8Array(128);
    this.fireUntil = new Uint16Array(128);
    this.kings = { w: -1, b: -1 };
    this.history = [];
    this.duck = -1;
    this.awaitingDuck = false;

    if (options.terrain) this.applyTerrain(options.terrain);

    const parts = fen.trim().split(/\s+/);
    const placement = parts[0];
    const turn = parts[1];
    const castling = parts[2];
    const ep = parts[3];
    const half = parts[4];
    const full = parts[5];

    this.parsePlacement(placement);

    this.turn = turn === 'b' ? BLACK : WHITE;
    this.castling = 0;
    if (this.rules.castling && this.files === 8 && this.ranks === 8 && castling) {
      for (const ch of castling) if (CASTLE[ch]) this.castling |= CASTLE[ch];
    }
    this.epSquare = ep && ep !== '-' ? parseSquare(ep, this.ranks) : -1;
    this.halfMoves = Number(half ?? 0);
    this.moveNumber = Number(full ?? 1);

    if (options.duck != null && options.duck !== '') {
      this.duck = typeof options.duck === 'string'
        ? parseSquare(options.duck, this.ranks)
        : options.duck;
    } else if (this.rules.duckChess) {
      this.duck = this.defaultDuckSquare();
    }
    this.awaitingDuck = Boolean(options.awaitingDuck);

    if (options.status) this.applyStatus(options.status);
    if (options.fire) {
      for (const entry of options.fire) {
        const sq = typeof entry.sq === 'string' ? parseSquare(entry.sq, this.ranks) : entry.sq;
        this.fireUntil[sq] = entry.until | 0;
      }
    }

    this.positionCounts = new Map();
    this.countPosition();
    this.refreshMode();
    return this;
  }

  parsePlacement(placement) {
    let sq = 0;
    let i = 0;
    while (i < placement.length) {
      const ch = placement[i];
      if (ch === '/') {
        // Skip the unused files of this rank plus the 0x88 gutter, then
        // align to the start of the next rank.
        sq = (rank(sq) + 1) * 16;
        i++;
        continue;
      }
      if (ch === '{') {
        const end = placement.indexOf('}', i);
        const body = placement.slice(i + 1, end);
        const piece = parseToken(body);
        if (piece && this.inBounds(sq)) {
          this.board[sq] = piece;
          if (piece.type === KING) this.kings[piece.color] = sq;
        }
        sq++;
        i = end + 1;
        continue;
      }
      if (ch >= '1' && ch <= '8') {
        sq += Number(ch);
        i++;
        continue;
      }
      const color = ch === ch.toUpperCase() ? WHITE : BLACK;
      const type = ch.toLowerCase();
      if (PIECES[type] && this.inBounds(sq)) {
        this.board[sq] = { type, color };
        if (type === KING) this.kings[color] = sq;
      }
      sq++;
      i++;
    }
  }

  applyTerrain(spec) {
    if (Array.isArray(spec)) {
      for (const entry of spec) {
        const sq = typeof entry.sq === 'string' ? parseSquare(entry.sq, this.ranks) : entry.sq;
        const tile = typeof entry.tile === 'string' ? TILE_ID[entry.tile] : entry.tile;
        if (sq >= 0) this.terrain[sq] = tile || 0;
      }
      return;
    }
    for (const [name, tile] of Object.entries(spec)) {
      const sq = parseSquare(name, this.ranks);
      this.terrain[sq] = typeof tile === 'string' ? (TILE_ID[tile] || 0) : tile;
    }
  }

  applyStatus(list) {
    for (const entry of list) {
      const sq = typeof entry.sq === 'string' ? parseSquare(entry.sq, this.ranks) : entry.sq;
      this.status[sq] = entry.status | 0;
    }
  }

  refreshMode() {
    let fairy = false;
    for (let sq = 0; sq <= 119; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = this.board[sq];
      if (p && !isClassicType(p.type)) { fairy = true; break; }
    }
    let tiled = false;
    for (let i = 0; i < 128; i++) if (this.terrain[i]) { tiled = true; break; }
    this.hasFairy = fairy;
    this.hasTerrain = tiled;
    this.hasStatus = this.status.some((s) => s !== 0);
    this.classic = this.files === 8 && this.ranks === 8
      && !fairy && !tiled && !this.hasStatus
      && this.rules.checks && !this.rules.kingCapture
      && this.rules.castling
      && !this.rules.royalLeaps
      && this.kingPassives.length === 0;
  }

  inBounds(sq) {
    return (sq & 0x88) === 0 && file(sq) < this.files && rank(sq) < this.ranks;
  }

  isBlocked(sq) {
    return this.terrain[sq] === TILE.BLOCK;
  }

  isDuck(sq) {
    return this.duck >= 0 && this.duck === sq;
  }

  defaultDuckSquare() {
    const cx = (this.files / 2) | 0;
    const cy = (this.ranks / 2) | 0;
    const start = cy * 16 + cx;
    if (!this.board[start] && !this.isBlocked(start)) return start;
    for (let sq = 0; sq <= 119; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      if (this.inBounds(sq) && !this.board[sq] && !this.isBlocked(sq)) return sq;
    }
    return -1;
  }

  /**
   * Icebound Cloak and Rimewalker Boots keep your own army thawed — neither
   * an enemy Rime nor the ground itself can freeze what you own.
   */
  freezeImmune(piece) {
    return Boolean(piece) && piece.color === WHITE && this.kingPassives.includes('icebound');
  }

  isFire(sq) {
    return this.fireUntil[sq] > this.history.length;
  }

  paintFire(sq, until, extra) {
    if (!this.inBounds(sq) || this.isBlocked(sq)) return;
    this.fireUntil[sq] = until;
    if (extra.firePainted) extra.firePainted.push(sq);
  }

  slideDir(from, to) {
    const df = file(to) - file(from);
    const dr = rank(to) - rank(from);
    if (!df && !dr) return 0;
    const stepF = df === 0 ? 0 : df / Math.abs(df);
    const stepR = dr === 0 ? 0 : dr / Math.abs(dr);
    if (df && dr && Math.abs(df) !== Math.abs(dr)) return 0;
    return stepR * 16 + stepF;
  }

  clone() {
    const copy = new Chess(this.toSpec());
    copy.positionCounts = new Map(this.positionCounts);
    return copy;
  }

  toSpec() {
    const terrain = [];
    const status = [];
    for (let sq = 0; sq <= 119; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      if (this.terrain[sq]) terrain.push({ sq, tile: this.terrain[sq] });
      if (this.status[sq]) status.push({ sq, status: this.status[sq] });
    }
    const fire = [];
    for (let sq = 0; sq <= 119; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      if (this.fireUntil[sq]) fire.push({ sq, until: this.fireUntil[sq] });
    }
    return {
      fen: this.fen(),
      files: this.files,
      ranks: this.ranks,
      rules: { ...this.rules },
      kingPassives: this.kingPassives.slice(),
      terrain,
      status,
      fire,
      duck: this.duck,
      awaitingDuck: this.awaitingDuck,
    };
  }

  fen() {
    let placement = '';
    for (let r = 0; r < this.ranks; r++) {
      let empty = 0;
      for (let f = 0; f < this.files; f++) {
        const piece = this.board[r * 16 + f];
        if (!piece) {
          empty++;
        } else {
          if (empty) { placement += empty; empty = 0; }
          placement += encodePiece(piece);
        }
      }
      if (empty) placement += empty;
      if (r < this.ranks - 1) placement += '/';
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
      this.epSquare >= 0 ? squareName(this.epSquare, this.ranks) : '-',
      this.halfMoves,
      this.moveNumber,
    ].join(' ');
  }

  positionKey() {
    return this.fen().split(' ').slice(0, 4).join(' ');
  }

  countPosition() {
    const key = this.positionKey();
    this.positionCounts.set(key, (this.positionCounts.get(key) || 0) + 1);
  }

  sqOf(square) {
    return typeof square === 'string' ? parseSquare(square, this.ranks) : square;
  }

  get(square) {
    return this.board[this.sqOf(square)] || null;
  }

  tileAt(square) {
    return this.terrain[this.sqOf(square)] || TILE.NONE;
  }

  statusAt(square) {
    return this.status[this.sqOf(square)] || 0;
  }

  // ---- attack detection --------------------------------------------------

  attacked(color, sq) {
    if (this.classic) return this.attackedClassic(color, sq);
    return this.attackedGeneral(color, sq);
  }

  /**
   * Is `sq` attacked by any piece of `color`? Rays are cast outward *from* the
   * target square, which is far cheaper than asking every enemy piece where it
   * could go — this runs inside the move-legality filter and the search.
   */
  attackedClassic(color, sq) {
    const board = this.board;

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

  attackedGeneral(color, sq) {
    const board = this.board;
    const extraRoyal = this.rules.royalLeaps;

    for (let from = 0; from <= 119; from++) {
      if (from & 0x88) { from += 7; continue; }
      if (!this.inBounds(from)) continue;
      const piece = board[from];
      if (!piece || piece.color !== color) continue;
      if (this.status[from] & ST_FROZEN) continue;
      if (this.attacksFrom(from, piece, sq, extraRoyal)) return true;
    }
    return false;
  }

  attacksFrom(from, piece, target, extraRoyal) {
    const def = PIECES[piece.type];
    if (!def || def.cannotCapture) return false;

    if (def.pawn) {
      const forward = piece.color === WHITE ? -16 : 16;
      return target === from + forward - 1 || target === from + forward + 1;
    }

    if (def.leapOff) {
      for (const off of def.leapOff) {
        if (from + off === target && this.inBounds(target)) return true;
      }
    }
    if (piece.type === KING && extraRoyal) {
      for (const off of extraRoyal) {
        if (from + off === target && this.inBounds(target)) return true;
      }
    }
    if (this.kingPassives.includes('court') && isQueenLike(piece.type)) {
      for (const off of KNIGHT_OFFSETS) {
        if (from + off === target && this.inBounds(target)) return true;
      }
    }
    if (def.slideOff) {
      for (const dir of def.slideOff) {
        let to = from + dir;
        while (this.inBounds(to) && !this.isBlocked(to) && !this.isDuck(to)) {
          if (to === target) return true;
          if (this.board[to]) break;
          to += dir;
        }
      }
    }
    if (def.hopperOff) {
      for (const dir of def.hopperOff) {
        let to = from + dir;
        let hurdle = false;
        while (this.inBounds(to) && !this.isBlocked(to)) {
          if (!hurdle) {
            if (this.board[to] || this.isDuck(to)) hurdle = true;
            to += dir;
            continue;
          }
          if (to === target) return true;
          break;
        }
      }
    }
    return false;
  }

  kingAttacked(color) {
    const king = this.kings[color];
    return king >= 0 && this.attacked(swap(color), king);
  }

  inCheck() {
    if (!this.rules.checks) return false;
    return this.kingAttacked(this.turn);
  }

  // ---- move generation ---------------------------------------------------

  /**
   * Legal moves for the side to move.
   * @param {object} opts
   * @param {string|number} [opts.square] restrict to moves from one square
   * @param {boolean} [opts.capturesOnly] only captures (quiescence)
   * @param {boolean} [opts.legal=true] set false for pseudo-legal moves
   */
  moves({ square, capturesOnly = false, legal = true } = {}) {
    if (this.classic) return this.movesClassic({ square, capturesOnly, legal });
    return this.movesGeneral({ square, capturesOnly, legal });
  }

  movesClassic({ square, capturesOnly = false, legal = true } = {}) {
    const us = this.turn;
    const them = swap(us);
    const board = this.board;
    const out = [];

    const only = square == null ? null : this.sqOf(square);

    const add = (from, to, flags, captured, promotion) => {
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
            if (rank(from) === startRank && onBoard(two) && !board[two]) {
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

  movesGeneral({ square, capturesOnly = false, legal = true } = {}) {
    const us = this.turn;
    const them = swap(us);
    const board = this.board;
    const out = [];
    const pioneer = this.kingPassives.includes('pioneer');
    const promoRank = us === WHITE
      ? (pioneer ? 1 : 0)
      : (pioneer ? this.ranks - 2 : this.ranks - 1);
    const startRank = us === WHITE ? this.ranks - 2 : 1;
    const extraRoyal = this.rules.royalLeaps;
    const court = this.kingPassives.includes('court');

    const only = square == null ? null : this.sqOf(square);

    const add = (from, to, flags, captured, extra) => {
      const piece = board[from];
      if (piece.type === PAWN && rank(to) === promoRank) {
        for (const promo of PROMOTE_TO) {
          out.push({
            from, to, color: us, piece: PAWN,
            captured: captured || null,
            promotion: promo,
            flags: flags | FLAG.PROMOTION,
            rebound: extra?.rebound ?? -1,
          });
        }
        return;
      }
      out.push({
        from, to, color: us, piece: piece.type,
        captured: captured || null,
        promotion: extra?.promotion || null,
        flags,
        rebound: extra?.rebound ?? -1,
      });
    };

    const tryLand = (from, to, flags) => {
      if (!this.inBounds(to) || this.isBlocked(to) || this.isDuck(to)) return false;
      const target = board[to];
      const mover = board[from];
      if (!target) {
        if (!capturesOnly) add(from, to, flags);
        return true;
      }
      if (PIECES[mover.type]?.cannotCapture) return false;
      if (PIECES[target.type]?.uncapturable) return false;
      if (target.color === us) return false;
      if (this.status[to] & ST_SHIELD) {
        const rebound = this.findRebound(to, from);
        add(from, to, flags | FLAG.CAPTURE | FLAG.SHIELD_BREAK, target.type, { rebound });
        return false;
      }
      add(from, to, flags | FLAG.CAPTURE, target.type);
      return false;
    };

    const first = only != null ? only : 0;
    const last = only != null ? only : 119;

    for (let from = first; from <= last; from++) {
      if (from & 0x88) { from += 7; continue; }
      if (!this.inBounds(from)) continue;
      const piece = board[from];
      if (!piece || piece.color !== us) continue;
      if (this.status[from] & ST_FROZEN) continue;

      const def = PIECES[piece.type];
      if (!def) continue;

      if (def.pawn) {
        const forward = us === WHITE ? -16 : 16;
        if (!capturesOnly) {
          const one = from + forward;
          if (this.inBounds(one) && !board[one] && !this.isBlocked(one) && !this.isDuck(one)) {
            add(from, one, FLAG.NORMAL);
            const two = from + forward * 2;
            // Geometric mid-square, not "one slide step" — a double push
            // crosses `one` even when the vector is longer than a unit step.
            if (this.ranks >= 4 && rank(from) === startRank
                && this.inBounds(two) && !board[two] && !this.isBlocked(two) && !this.isDuck(two)) {
              add(from, two, FLAG.BIG_PAWN);
            }
          }
        }
        for (const diag of [forward - 1, forward + 1]) {
          const to = from + diag;
          if (!this.inBounds(to) || this.isBlocked(to)) continue;
          const target = board[to];
          if (target && target.color === them) {
            tryLand(from, to, FLAG.CAPTURE);
          } else if (!target && to === this.epSquare) {
            add(from, to, FLAG.EP_CAPTURE, PAWN);
          }
        }
        continue;
      }

      const land = (to, flags) => tryLand(from, to, flags);

      if (def.leapOff) {
        for (const off of def.leapOff) land(from + off, FLAG.NORMAL);
      }
      if (piece.type === KING && extraRoyal) {
        for (const off of extraRoyal) land(from + off, FLAG.NORMAL);
      }
      if (court && isQueenLike(piece.type)) {
        for (const off of KNIGHT_OFFSETS) land(from + off, FLAG.NORMAL);
      }
      if (def.slideOff) {
        for (const dir of def.slideOff) {
          let to = from + dir;
          while (this.inBounds(to) && !this.isBlocked(to) && !this.isDuck(to)) {
            const target = board[to];
            if (!target) {
              if (!capturesOnly) add(from, to, FLAG.NORMAL);
            } else {
              if (target.color === them) land(to, FLAG.CAPTURE);
              break;
            }
            to += dir;
          }
        }
      }
      if (def.hopperOff) {
        for (const dir of def.hopperOff) {
          let to = from + dir;
          let hurdle = false;
          while (this.inBounds(to) && !this.isBlocked(to)) {
            if (!hurdle) {
              if (this.board[to] || this.isDuck(to)) hurdle = true;
              to += dir;
              continue;
            }
            if (this.isDuck(to)) break;
            const target = board[to];
            if (!target) {
              if (!capturesOnly) add(from, to, FLAG.NORMAL);
            } else if (target.color === them) {
              land(to, FLAG.CAPTURE);
            }
            break;
          }
        }
      }
    }

    const kingSq = this.kings[us];
    const wantsKing = only == null || only === kingSq;
    if (!capturesOnly && this.rules.castling && this.files === 8 && this.ranks === 8
        && wantsKing && kingSq >= 0 && !(this.status[kingSq] & ST_FROZEN)
        && (!this.rules.checks || !this.attacked(them, kingSq))) {
      const kFlag = us === WHITE ? CASTLE.K : CASTLE.k;
      const qFlag = us === WHITE ? CASTLE.Q : CASTLE.q;
      if (this.castling & kFlag) {
        const f1 = kingSq + 1, f2 = kingSq + 2;
        if (!board[f1] && !board[f2] && !this.isBlocked(f1) && !this.isBlocked(f2)
            && !this.attacked(them, f1) && !this.attacked(them, f2)) {
          out.push({
            from: kingSq, to: f2, color: us, piece: KING,
            captured: null, promotion: null, flags: FLAG.KSIDE_CASTLE, rebound: -1,
          });
        }
      }
      if (this.castling & qFlag) {
        const d1 = kingSq - 1, c1 = kingSq - 2, b1 = kingSq - 3;
        if (!board[d1] && !board[c1] && !board[b1]
            && !this.isBlocked(d1) && !this.isBlocked(c1) && !this.isBlocked(b1)
            && !this.attacked(them, d1) && !this.attacked(them, c1)) {
          out.push({
            from: kingSq, to: c1, color: us, piece: KING,
            captured: null, promotion: null, flags: FLAG.QSIDE_CASTLE, rebound: -1,
          });
        }
      }
    }

    if (!legal || !this.rules.checks) return out;

    const legalMoves = [];
    for (const move of out) {
      this.makeMove(move);
      if (!this.kingAttacked(us)) legalMoves.push(move);
      this.undo();
    }
    return legalMoves;
  }

  /** Nearest empty in-bounds square, used when a shield pops the victim off. */
  findRebound(from, avoid) {
    const dirs = KING_OFFSETS;
    for (const off of dirs) {
      const sq = from + off;
      if (sq === avoid) continue;
      if (this.inBounds(sq) && !this.board[sq] && !this.isBlocked(sq)) return sq;
    }
    for (let sq = 0; sq <= 119; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      if (sq === from || sq === avoid) continue;
      if (this.inBounds(sq) && !this.board[sq] && !this.isBlocked(sq)) return sq;
    }
    return -1;
  }

  // ---- making and unmaking ----------------------------------------------

  /** Applies a move with no legality check. Every field is restored by undo(). */
  makeMove(move) {
    const us = move.color;
    const them = swap(us);
    const board = this.board;

    const extra = this.classic ? null : {
      statusFrom: this.status[move.from],
      statusTo: this.status[move.to],
      rebound: move.rebound ?? -1,
      reboundPiece: null,
      reboundStatus: 0,
      thawed: null,
      burned: null,
      fireSnap: null,
      firePainted: null,
      iced: null,
      wispCapturer: null,
      blast: null,
    };

    this.history.push({
      move,
      turn: this.turn,
      castling: this.castling,
      epSquare: this.epSquare,
      halfMoves: this.halfMoves,
      moveNumber: this.moveNumber,
      kings: { w: this.kings.w, b: this.kings.b },
      extra,
    });

    if (extra) {
      // Pieces of the mover that sat out this turn now thaw.
      let thawed = null;
      for (let sq = 0; sq <= 119; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        if (!(this.status[sq] & ST_FROZEN)) continue;
        const p = board[sq];
        if (!p || p.color !== us) continue;
        if (!thawed) thawed = [];
        thawed.push(sq, this.status[sq]);
        this.status[sq] &= ~ST_FROZEN;
      }
      extra.thawed = thawed;
    }

    const moving = board[move.from];
    board[move.to] = moving;
    board[move.from] = null;
    if (extra) {
      this.status[move.to] = this.status[move.from] & ~ST_FROZEN;
      this.status[move.from] = 0;
    }

    if (move.flags & FLAG.EP_CAPTURE) {
      const cap = move.to + (us === WHITE ? 16 : -16);
      board[cap] = null;
      if (extra) this.status[cap] = 0;
    }

    if (move.flags & FLAG.SHIELD_BREAK) {
      const rebound = move.rebound ?? -1;
      if (rebound >= 0) {
        extra.reboundPiece = { type: move.captured, color: them };
        extra.reboundStatus = extra.statusTo & ~ST_SHIELD;
        board[rebound] = extra.reboundPiece;
        this.status[rebound] = extra.reboundStatus;
        // The attacker occupies `to`; the victim is no longer captured.
        move._shieldSaved = true;
      }
    }

    if (move.promotion) {
      board[move.to] = { type: move.promotion, color: us };
    }

    if (board[move.to] && board[move.to].type === KING) {
      this.kings[us] = move.to;
      if (move.flags & FLAG.KSIDE_CASTLE) {
        board[move.to - 1] = board[move.to + 1];
        board[move.to + 1] = null;
        if (extra) {
          this.status[move.to - 1] = this.status[move.to + 1];
          this.status[move.to + 1] = 0;
        }
      } else if (move.flags & FLAG.QSIDE_CASTLE) {
        board[move.to + 1] = board[move.to - 2];
        board[move.to - 2] = null;
        if (extra) {
          this.status[move.to + 1] = this.status[move.to - 2];
          this.status[move.to - 2] = 0;
        }
      }
      this.castling &= us === WHITE ? ~(CASTLE.K | CASTLE.Q) : ~(CASTLE.k | CASTLE.q);
    }

    if (move.captured === KING && !(move.flags & FLAG.SHIELD_BREAK && move._shieldSaved)) {
      this.kings[them] = -1;
    } else if (move.captured === KING && extra?.rebound >= 0) {
      this.kings[them] = extra.rebound;
    }

    if (CASTLE_MASK[move.from]) this.castling &= ~CASTLE_MASK[move.from];
    if (CASTLE_MASK[move.to]) this.castling &= ~CASTLE_MASK[move.to];

    this.epSquare = (move.flags & FLAG.BIG_PAWN)
      ? move.from + (us === WHITE ? -16 : 16)
      : -1;

    if (extra) {
      const dest = move.to;
      if (this.terrain[dest] === TILE.FROST && !this.freezeImmune(board[dest])) {
        this.status[dest] |= ST_FROZEN;
      }
      if (this.terrain[dest] === TILE.FORT) this.status[dest] |= ST_SHIELD;

      extra.fireSnap = this.fireUntil.slice();
      const def = PIECES[move.piece];
      const paints = Boolean(def?.paintsFire || (this.kingPassives.includes('pyre') && def?.slideOff));
      if (paints) {
        extra.firePainted = [];
        const expire = this.history.length + 1
          + (this.kingPassives.includes('everburn') ? 2 : 0);
        this.paintFire(move.from, expire, extra);
        if (def?.slideOff) {
          const dir = this.slideDir(move.from, dest);
          if (dir) {
            let sq = move.from + dir;
            while (sq !== dest && this.inBounds(sq)) {
              this.paintFire(sq, expire, extra);
              sq += dir;
            }
          }
        }
      }

      if (this.isFire(dest) && board[dest]) {
        extra.burned = { type: board[dest].type, color: us };
        if (board[dest].type === KING) this.kings[us] = -1;
        board[dest] = null;
        this.status[dest] = 0;
      }

      if (def?.ice) {
        // Rime freezes only its ORTHOGONAL neighbours, and the cold takes her
        // too. Both halves of that matter.
        //
        // Freezing all eight neighbours made her literally untouchable: every
        // piece close enough to punish her was disabled before it got a turn,
        // and a pawn — which can only capture on the diagonal — could never
        // answer her at all. Leaving the diagonals live means there is always
        // a reply. Freezing herself costs her the initiative and opens the
        // window in which that reply can land.
        extra.iced = [];
        // Deep Freeze gives the diagonals back — the relic that turns Rime from
        // a good piece into a build.
        const reach = this.kingPassives.includes('deepfreeze') && us === WHITE
          ? KING_OFFSETS
          : ROOK_DIRS;
        for (const off of reach) {
          const sq = dest + off;
          if (!this.inBounds(sq)) continue;
          const p = board[sq];
          if (p && p.color === them && !this.freezeImmune(p)) {
            extra.iced.push(sq, this.status[sq]);
            this.status[sq] |= ST_FROZEN;
          }
        }
        // Recoil. Undo restores this square from `extra.statusTo`, so it needs
        // no bookkeeping of its own.
        if (extra.iced.length) this.status[dest] |= ST_FROZEN;
      }

      // A sapper detonates when taken: the captor dies on top of it and
      // everything standing around the blast goes with them.
      if (move.captured && PIECES[move.captured]?.sapper
        && !(move.flags & FLAG.SHIELD_BREAK && move._shieldSaved)) {
        const blast = [];
        if (board[dest]) {
          blast.push(dest, board[dest]);
          if (board[dest].type === KING) this.kings[us] = -1;
          board[dest] = null;
          this.status[dest] = 0;
        }
        for (const off of KING_OFFSETS) {
          const sq = dest + off;
          if (!this.inBounds(sq)) continue;
          const victim = board[sq];
          if (!victim || PIECES[victim.type]?.uncapturable) continue;
          blast.push(sq, victim);
          if (victim.type === KING) this.kings[victim.color] = -1;
          board[sq] = null;
          this.status[sq] = 0;
        }
        if (blast.length) {
          extra.blast = blast;
          move.flags |= FLAG.WISP_BOOM;
        }
      }

      // Vengeful Ash — the captor of one of your pieces is frozen in place.
      if (move.captured && us === BLACK && board[dest]
        && this.kingPassives.includes('vengefulash')) {
        extra.iced = extra.iced || [];
        extra.iced.push(dest, this.status[dest]);
        this.status[dest] |= ST_FROZEN;
      }

      const tookWisp = move.captured && PIECES[move.captured]?.wisp
        && !(move.flags & FLAG.SHIELD_BREAK && move._shieldSaved);
      if (tookWisp && board[dest]) {
        extra.wispCapturer = { type: board[dest].type, color: us };
        if (board[dest].type === KING) this.kings[us] = -1;
        board[dest] = null;
        this.status[dest] = 0;
        move.flags |= FLAG.WISP_BOOM;
      }
    }

    this.halfMoves = (move.piece === PAWN || (move.flags & (FLAG.CAPTURE | FLAG.EP_CAPTURE)))
      ? 0
      : this.halfMoves + 1;
    if (us === BLACK) this.moveNumber++;
    this.turn = them;
  }

  undo() {
    const state = this.history.pop();
    if (!state) return null;
    const { move, extra } = state;
    const board = this.board;
    const us = move.color;

    this.turn = state.turn;
    this.castling = state.castling;
    this.epSquare = state.epSquare;
    this.awaitingDuck = false;
    this.halfMoves = state.halfMoves;
    this.moveNumber = state.moveNumber;
    this.kings = state.kings;

    if (extra && extra.rebound >= 0 && extra.reboundPiece) {
      board[extra.rebound] = null;
      this.status[extra.rebound] = 0;
    }

    if (extra?.fireSnap) this.fireUntil = extra.fireSnap;
    if (extra?.iced) {
      for (let i = 0; i < extra.iced.length; i += 2) {
        this.status[extra.iced[i]] = extra.iced[i + 1];
      }
    }

    if (extra?.blast) {
      for (let i = 0; i < extra.blast.length; i += 2) {
        const sq = extra.blast[i];
        const piece = extra.blast[i + 1];
        board[sq] = piece;
        if (piece.type === KING) this.kings[piece.color] = sq;
      }
    }
    if (extra?.wispCapturer) {
      board[move.from] = extra.wispCapturer;
      board[move.to] = { type: move.captured, color: swap(us) };
    } else if (extra?.burned && !board[move.to]) {
      board[move.from] = extra.burned;
      board[move.to] = move.captured ? { type: move.captured, color: swap(us) } : null;
    } else {
      board[move.from] = move.promotion
        ? { type: PAWN, color: us }
        : board[move.to];
      board[move.to] = null;
    }

    if (!(extra?.wispCapturer || extra?.burned)) {
      if (move.flags & FLAG.EP_CAPTURE) {
        board[move.to + (us === WHITE ? 16 : -16)] = { type: PAWN, color: swap(us) };
      } else if (move.captured && !(move.flags & FLAG.SHIELD_BREAK && move._shieldSaved)) {
        board[move.to] = { type: move.captured, color: swap(us) };
      } else if (move.flags & FLAG.SHIELD_BREAK && move._shieldSaved) {
        board[move.to] = { type: move.captured, color: swap(us) };
      }
    }

    if (move.flags & FLAG.KSIDE_CASTLE) {
      board[move.to + 1] = board[move.to - 1];
      board[move.to - 1] = null;
    } else if (move.flags & FLAG.QSIDE_CASTLE) {
      board[move.to - 2] = board[move.to + 1];
      board[move.to + 1] = null;
    }

    if (extra) {
      this.status[move.from] = extra.statusFrom;
      this.status[move.to] = extra.statusTo;
      if (move.flags & FLAG.EP_CAPTURE) {
        this.status[move.to + (us === WHITE ? 16 : -16)] = 0;
      }
      if (extra.thawed) {
        for (let i = 0; i < extra.thawed.length; i += 2) {
          this.status[extra.thawed[i]] = extra.thawed[i + 1];
        }
      }
    }

    if (move._shieldSaved) move._shieldSaved = false;
    return move;
  }

  /**
   * Plays a legal move. Accepts a move object from moves(), or
   * {from, to, promotion} with squares as names or indices.
   * Returns the played move (with `san` attached) or null if it is not legal.
   */
  move(input) {
    const from = typeof input.from === 'string' ? parseSquare(input.from, this.ranks) : input.from;
    const to = typeof input.to === 'string' ? parseSquare(input.to, this.ranks) : input.to;
    const promotion = input.promotion || null;

    const options = this.moves({ square: from });
    const candidate = options.find(
      (m) => m.to === to && (!m.promotion || !promotion || m.promotion === promotion),
    );
    if (!candidate) return null;

    const chosen = candidate.promotion && promotion
      ? options.find((m) => m.to === to && m.promotion === promotion) || candidate
      : candidate;

    const san = this.toSan(chosen);
    this.makeMove(chosen);
    this.countPosition();
    if (this.rules.duckChess) this.awaitingDuck = true;
    const played = { ...chosen, san };
    this.history[this.history.length - 1].san = san;
    return played;
  }

  duckSquares() {
    const out = [];
    if (!this.rules.duckChess) return out;
    for (let sq = 0; sq <= 119; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      if (!this.inBounds(sq)) continue;
      if (sq === this.duck) continue;
      if (this.board[sq] || this.isBlocked(sq)) continue;
      out.push(sq);
    }
    return out;
  }

  placeDuck(sq) {
    if (!this.rules.duckChess || !this.awaitingDuck) return false;
    sq = typeof sq === 'string' ? parseSquare(sq, this.ranks) : sq;
    if (!this.inBounds(sq) || this.board[sq] || this.isBlocked(sq) || sq === this.duck) {
      return false;
    }
    this.duck = sq;
    this.awaitingDuck = false;
    return true;
  }

  undoMove() {
    const key = this.positionKey();
    const count = this.positionCounts.get(key);
    if (count > 1) this.positionCounts.set(key, count - 1);
    else this.positionCounts.delete(key);
    return this.undo();
  }

  // ---- notation ----------------------------------------------------------

  toSan(move) {
    if (move.flags & FLAG.KSIDE_CASTLE) return this.withCheckSuffix(move, 'O-O');
    if (move.flags & FLAG.QSIDE_CASTLE) return this.withCheckSuffix(move, 'O-O-O');

    let san = '';
    if (move.piece === PAWN) {
      if (move.flags & (FLAG.CAPTURE | FLAG.EP_CAPTURE | FLAG.SHIELD_BREAK)) {
        san += String.fromCharCode(97 + file(move.from)) + 'x';
      }
    } else {
      san += move.piece.toUpperCase();
      const rivals = this.moves().filter(
        (m) => m.piece === move.piece && m.to === move.to && m.from !== move.from,
      );
      if (rivals.length) {
        const sameFile = rivals.some((m) => file(m.from) === file(move.from));
        const sameRank = rivals.some((m) => rank(m.from) === rank(move.from));
        if (!sameFile) san += String.fromCharCode(97 + file(move.from));
        else if (!sameRank) san += this.ranks - rank(move.from);
        else san += squareName(move.from, this.ranks);
      }
      if (move.flags & (FLAG.CAPTURE | FLAG.SHIELD_BREAK)) san += 'x';
    }

    san += squareName(move.to, this.ranks);
    if (move.promotion) san += '=' + move.promotion.toUpperCase();
    return this.withCheckSuffix(move, san);
  }

  withCheckSuffix(move, san) {
    this.makeMove(move);
    let suffix = '';
    if (this.rules.kingCapture && this.kings[this.turn] < 0) suffix = '#';
    else if (this.rules.checks && this.inCheck()) {
      suffix = this.moves().length === 0 ? '#' : '+';
    }
    this.undo();
    return san + suffix;
  }

  // ---- terminal states ---------------------------------------------------

  isCheckmate() {
    if (this.rules.kingCapture) return this.kings[this.turn] < 0;
    return this.rules.checks && this.inCheck() && this.moves().length === 0;
  }

  isStalemate() {
    if (this.rules.kingCapture) return false;
    return this.rules.checks && !this.inCheck() && this.moves().length === 0;
  }

  isInsufficientMaterial() {
    if (this.rules.kingCapture) return false;
    const counts = { w: [], b: [] };
    for (let sq = 0; sq <= 119; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      if (!this.inBounds(sq)) continue;
      const piece = this.board[sq];
      if (piece && piece.type !== KING) counts[piece.color].push({ ...piece, sq });
    }
    const all = [...counts.w, ...counts.b];
    if (all.length === 0) return true;
    if (all.length === 1 && (all[0].type === BISHOP || all[0].type === KNIGHT)) return true;
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
    if (this.rules.kingCapture) {
      return this.isThreefoldRepetition() || this.isFiftyMoveDraw();
    }
    return this.isStalemate() || this.isInsufficientMaterial() ||
      this.isThreefoldRepetition() || this.isFiftyMoveDraw();
  }

  /**
   * Eventual reachability: can `color` walk a capturing piece onto the
   * enemy king? Walls and uncapturable units are solid; everything else
   * (including own pieces) is treated as something that can step aside.
   */
  canTakeKing(color) {
    const goal = this.kings[swap(color)];
    if (goal < 0) return true;

    const passable = (sq) => {
      if (!this.inBounds(sq) || this.isBlocked(sq)) return false;
      const p = this.board[sq];
      return !(p && p.color !== color && PIECES[p.type]?.uncapturable);
    };

    const flood = (start, steps) => {
      if (start < 0 || !steps.length) return false;
      const seen = new Uint8Array(128);
      const q = [start];
      seen[start] = 1;
      for (let i = 0; i < q.length; i++) {
        const sq = q[i];
        if (sq === goal) return true;
        for (const off of steps) {
          const to = sq + off;
          if ((to & 0x88) || seen[to] || !passable(to)) continue;
          seen[to] = 1;
          q.push(to);
        }
      }
      return false;
    };

    for (const piece of this.pieces()) {
      if (piece.color !== color) continue;
      const def = PIECES[piece.type];
      if (!def || def.cannotCapture) continue;
      const steps = [];
      if (def.leapOff) steps.push(...def.leapOff);
      if (def.slideOff) steps.push(...def.slideOff);
      if (def.hopperOff) steps.push(...def.hopperOff);
      if (def.pawn) steps.push(-17, -16, -15, 15, 16, 17);
      if (flood(piece.square, steps)) return true;
    }
    return false;
  }

  isGameOver() {
    if (this.rules.kingCapture) {
      if (this.kings.w < 0 || this.kings.b < 0) return true;
      if (this.moves().length === 0) return true;
      if (!this.canTakeKing(WHITE)) return true;
      return this.isDraw();
    }
    return this.isCheckmate() || this.isDraw();
  }

  outcome() {
    if (this.rules.kingCapture) {
      if (this.kings.w < 0) return { over: true, winner: BLACK, reason: 'king capture' };
      if (this.kings.b < 0) return { over: true, winner: WHITE, reason: 'king capture' };
      if (this.moves().length === 0) {
        return { over: true, winner: swap(this.turn), reason: 'no moves' };
      }
      if (!this.canTakeKing(WHITE)) {
        return { over: true, winner: BLACK, reason: 'unwinnable' };
      }
      if (this.isThreefoldRepetition() || this.isFiftyMoveDraw()) {
        return { over: true, winner: BLACK, reason: 'unwinnable' };
      }
      return { over: false, winner: null, reason: null };
    }
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

  pieces() {
    const list = [];
    for (let sq = 0; sq <= 119; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      if (!this.inBounds(sq)) continue;
      const piece = this.board[sq];
      if (piece) {
        list.push({
          ...piece,
          square: sq,
          status: this.status[sq] || 0,
        });
      }
    }
    return list;
  }

  /** Remaining army cost for a colour, king counted as 3. Used as fight HP. */
  armyValue(color) {
    let total = 0;
    for (const piece of this.pieces()) {
      if (piece.color !== color) continue;
      const def = pieceById(piece.type);
      total += piece.type === KING ? 3 : (def?.cost ?? 0);
    }
    return total;
  }

  /**
   * Build a game from an ASCII diagram. Colour is ALWAYS explicit:
   *   P / p     classic letters, case is colour
   *   {w:c}     white camel (id after the colon)
   *   {b:hopper}  looked up by id or lowercase name
   *   .         empty
   *   #         blocked tile
   *   *         frost tile
   *   +         fort tile
   */
  static fromDiagram(text, options = {}) {
    const rows = text.trim().split('\n').map((line) => tokenizeRow(line)).filter((r) => r.length);
    const ranks = options.ranks ?? rows.length;
    const files = options.files ?? Math.max(...rows.map((r) => r.length));
    const terrain = [];
    const board = new Array(128).fill(null);
    const kings = { w: -1, b: -1 };

    for (let r = 0; r < ranks; r++) {
      const row = rows[r] || [];
      for (let f = 0; f < files; f++) {
        const token = row[f] || '.';
        const sq = r * 16 + f;
        if (token === '.' || token === '-') continue;
        if (token === '#' || token === '*' || token === '+') {
          terrain.push({ sq, tile: TILE_ID[token] });
          continue;
        }
        const piece = parseToken(token);
        if (!piece) continue;
        board[sq] = piece;
        if (piece.type === KING) kings[piece.color] = sq;
      }
    }

    const game = new Chess({
      fen: emptyFen(files, ranks),
      files,
      ranks,
      rules: options.rules,
      kingPassives: options.kingPassives,
      terrain,
    });
    game.board = board;
    game.kings = kings;
    game.turn = options.turn === BLACK ? BLACK : WHITE;
    game.refreshMode();
    game.positionCounts = new Map();
    game.countPosition();
    return game;
  }
}

function encodePiece(piece) {
  const letter = piece.type;
  return piece.color === WHITE ? letter.toUpperCase() : letter;
}

function parseToken(token) {
  if (!token || token === '.' || token === '-' || token === '#' || token === '*' || token === '+') {
    return null;
  }
  let body = token;
  if (body[0] === '{') body = body.slice(1, -1);
  if (body.includes(':')) {
    const [col, idOrName] = body.split(':');
    const color = col[0].toLowerCase() === 'b' ? BLACK : WHITE;
    const type = resolveType(idOrName);
    if (!type) return null;
    return { type, color };
  }
  if (body.length === 1) {
    const color = body === body.toUpperCase() ? WHITE : BLACK;
    const type = body.toLowerCase();
    if (!PIECES[type]) return null;
    return { type, color };
  }
  return null;
}

function resolveType(idOrName) {
  const raw = idOrName.trim().toLowerCase();
  if (PIECES[raw]) return raw;
  for (const def of Object.values(PIECES)) {
    if (def.name.toLowerCase() === raw) return def.id;
  }
  return null;
}

function tokenizeRow(line) {
  const tokens = [];
  const s = line.trim();
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    if (s[i] === '{') {
      const end = s.indexOf('}', i);
      tokens.push(s.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    tokens.push(s[i]);
    i++;
  }
  return tokens;
}
