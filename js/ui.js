// The board view: rendering, pointer handling and all the physical feedback.
//
// Pieces are absolutely-positioned elements placed with a transform built from
// two CSS custom properties (--row/--col), so a move is a single transform
// change the compositor can animate, dragging is the same transform plus a
// pixel offset, and flipping the board is just re-assigning every row and
// column and letting the transition carry the pieces around.

import { WHITE, squareName, parseSquare, rank, file, fromRowCol, FLAG, TILE, ST_FROZEN, ST_SHIELD } from './chess.js';
import { pieceById } from './pieces.js';
import { kingDef } from './content.js';

const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// Stamped with the commit SHA by the deploy workflow. Without it a browser
// keeps serving the previously cached artwork and a new build looks like it
// never landed.
const ASSET_VERSION = '';

export const pieceImage = (type, color, skin = null) => {
  if (type === 'u' || type === 'duck') {
    return `assets/duck-yellow.png${ASSET_VERSION}`;
  }
  const def = pieceById(type);
  let sprite = def?.sprite || PIECE_NAMES[type] || 'pawn';
  if (type === 'k' && skin && skin !== 'king') sprite = skin;
  return `assets/${sprite}-${color === WHITE ? 'white' : 'black'}.png${ASSET_VERSION}`;
};

// Only the first five kings ever got dedicated art (assets/king-<id>-*.png).
// Every king since reuses the plain king sprite and leans on `kingHue()`
// for a colour identity instead — the same trick pieceHue() already uses so
// a growing roster doesn't need a matching flood of new PNGs.
export function kingSkin(id) {
  return kingDef(id).sprite || 'king';
}

export const kingHue = (id) => kingDef(id).hue || 0;

export const pieceHue = (type) => pieceById(type)?.hue || 0;

export class BoardView {
  /**
   * @param {HTMLElement} root the .board element
   * @param {object} handlers
   * @param {(from:number,to:number)=>void} handlers.onAttemptMove
   * @param {(sq:number)=>void} [handlers.onPickUp]
   * @param {(sq:number)=>void} [handlers.onInspect] called with whatever square was clicked
   * @param {(sq:number)=>boolean} [handlers.canPickUp]
   * @param {(sq:number)=>Array} handlers.legalTargets moves from a square
   */
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.flipped = false;
    this.interactive = true;
    this.selected = null;
    this.pieceEls = new Map();   // 0x88 square -> element
    this.dragging = null;

    this.squareLayer = root.querySelector('.squares');
    this.pieceLayer = root.querySelector('.pieces');
    this.fxLayer = root.querySelector('.board-fx');

    this.files = 8;
    this.ranks = 8;
    this.squares = new Map();
    this.whiteKingSkin = 'king';
    this.whiteKingHue = 0;
    this.resize(8, 8);

    root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    root.addEventListener('pointermove', (e) => this.onPointerMove(e));
    root.addEventListener('pointerup', (e) => this.onPointerUp(e));
    root.addEventListener('pointercancel', () => this.cancelDrag());
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.clearSelection();
    });
  }

  resize(files, ranks) {
    this.files = files;
    this.ranks = ranks;
    const wrap = this.root.closest('.board-wrap') || this.root.parentElement;
    if (wrap) {
      wrap.style.setProperty('--files', String(files));
      wrap.style.setProperty('--ranks', String(ranks));
    }
    this.root.style.setProperty('--files', String(files));
    this.root.style.setProperty('--ranks', String(ranks));
    this.root.classList.toggle('sized', files !== 8 || ranks !== 8);
    this.root.dataset.files = String(files);
    this.root.dataset.ranks = String(ranks);

    this.squareLayer.innerHTML = '';
    this.squares.clear();
    for (let row = 0; row < ranks; row++) {
      for (let col = 0; col < files; col++) {
        const sq = fromRowCol(row, col);
        const el = document.createElement('div');
        el.className = 'sq' + ((row + col) % 2 ? ' dark' : ' light');
        el.dataset.square = squareName(sq, ranks);
        el.innerHTML = '<i class="dot"></i><i class="ring"></i>';
        this.place(el, row, col);
        this.squareLayer.appendChild(el);
        this.squares.set(sq, el);
      }
    }
  }

  /** Writes an element's board position, honouring the current orientation. */
  place(el, row, col) {
    el.style.setProperty('--row', this.flipped ? this.ranks - 1 - row : row);
    el.style.setProperty('--col', this.flipped ? this.files - 1 - col : col);
  }

  placeSquare(el, sq) {
    this.place(el, rank(sq), file(sq));
  }

  setFlipped(flipped) {
    this.flipped = flipped;
    for (const [sq, el] of this.squares) this.placeSquare(el, sq);
    for (const [sq, el] of this.pieceEls) this.placeSquare(el, sq);
    this.root.classList.toggle('flipped', flipped);
  }

  setInteractive(on) {
    this.interactive = on;
    this.root.classList.toggle('locked', !on);
    if (!on) this.clearSelection();
  }

  setWhiteKingSkin(skin, hue = 0) {
    this.whiteKingSkin = skin || 'king';
    this.whiteKingHue = hue || 0;
  }

  // ---- rendering ---------------------------------------------------------

  /** Rebuilds every piece from the position. Used on new games and take-backs. */
  syncFromGame(game) {
    this.resize(game.files || 8, game.ranks || 8);
    this.pieceLayer.innerHTML = '';
    this.pieceEls.clear();
    this.paintTerrain(game);
    for (const piece of game.pieces()) {
      this.addPiece(piece.square, piece.type, piece.color, piece.status);
    }
    this.syncDuck(game);
    this.clearSelection();
  }

  syncDuck(game) {
    if (this.duckEl) {
      this.duckEl.remove();
      this.duckEl = null;
    }
    if (game.duck == null || game.duck < 0) return;
    const el = document.createElement('div');
    el.className = 'piece duck-token';
    el.style.backgroundImage = `url('${pieceImage('u')}')`;
    this.placeSquare(el, game.duck);
    this.pieceLayer.appendChild(el);
    this.duckEl = el;
  }

  paintTerrain(game) {
    for (const [sq, el] of this.squares) {
      el.classList.remove('tile-block', 'tile-frost', 'tile-fort', 'tile-fire', 'tile-warn', 'tile-glass');
      const tile = game.tileAt(sq);
      if (tile === TILE.BLOCK) el.classList.add('tile-block');
      else if (tile === TILE.FROST) el.classList.add('tile-frost');
      else if (tile === TILE.FORT) el.classList.add('tile-fort');
      else if (tile === TILE.GLASS) el.classList.add('tile-glass');
      if (game.isFire?.(sq) || tile === TILE.FIRE) el.classList.add('tile-fire');
      if (game.isWarned?.(sq)) el.classList.add('tile-warn');
    }
  }

  addPiece(sq, type, color, status = 0) {
    const el = document.createElement('div');
    el.className = `piece ${color === WHITE ? 'white' : 'black'}`;
    el.dataset.type = type;
    const isWhiteKing = type === 'k' && color === WHITE;
    const skin = isWhiteKing ? this.whiteKingSkin : null;
    el.style.backgroundImage = `url('${pieceImage(type, color, skin)}')`;
    const hue = isWhiteKing ? this.whiteKingHue : pieceHue(type);
    if (hue) el.style.filter = `hue-rotate(${hue}deg) drop-shadow(0 3px 3px rgba(0,0,0,0.45))`;
    this.applyStatus(el, status);
    this.placeSquare(el, sq);
    this.pieceLayer.appendChild(el);
    this.pieceEls.set(sq, el);
    return el;
  }

  applyStatus(el, status) {
    el.classList.toggle('frozen', Boolean(status & ST_FROZEN));
    el.classList.toggle('shielded', Boolean(status & ST_SHIELD));
  }

  syncStatuses(game) {
    for (const [sq, el] of this.pieceEls) {
      this.applyStatus(el, game.statusAt(sq));
      // A guarded king cannot be taken, so the player has to be able to see
      // that at a glance — otherwise the rule reads as "my move was rejected
      // for no reason".
      const piece = game.board[sq];
      const guarded = Boolean(piece && piece.type === 'k' && game.kingGuarded?.(sq));
      el.classList.toggle('guarded', guarded);
    }
    this.paintTerrain(game);
  }

  /**
   * Animates a move that has already been applied to the engine.
   * Returns the classification the caller needs for sound and camera effects.
   */
  applyMove(move) {
    const el = this.pieceEls.get(move.from);
    if (!el) return;

    const capturedSquare = (move.flags & FLAG.EP_CAPTURE)
      ? move.to + (move.color === WHITE ? 16 : -16)
      : move.to;

    // A swap moves two friendly pieces and takes nothing; a shot takes
    // something without the shooter ever leaving its square. Both break the
    // one-piece-travels-from-to assumption the rest of this method makes.
    if (move.flags & FLAG.SWAP) {
      const partner = this.pieceEls.get(move.to);
      this.pieceEls.set(move.to, el);
      this.placeSquare(el, move.to);
      this.thud(el);
      if (partner) {
        this.pieceEls.set(move.from, partner);
        this.placeSquare(partner, move.from);
        this.thud(partner, 90);
      } else {
        this.pieceEls.delete(move.from);
      }
      return { swap: true };
    }

    const victim = this.pieceEls.get(capturedSquare);
    if (move.flags & FLAG.SHOOT) {
      if (victim && (move.flags & FLAG.SHIELD_BREAK) && move.rebound >= 0) {
        this.pieceEls.delete(capturedSquare);
        this.pieceEls.set(move.rebound, victim);
        this.placeSquare(victim, move.rebound);
        victim.classList.remove('shielded');
        victim.classList.add('rebounds');
        setTimeout(() => victim.classList.remove('rebounds'), 360);
      } else if (victim) {
        this.pieceEls.delete(capturedSquare);
        this.explode(capturedSquare, victim);
      }
      this.recoil(el, move.from, move.to);
      return { shot: true, captured: move.captured };
    }

    if (victim && (move.flags & FLAG.SHIELD_BREAK) && move.rebound >= 0) {
      this.pieceEls.delete(capturedSquare);
      this.pieceEls.set(move.rebound, victim);
      this.placeSquare(victim, move.rebound);
      victim.classList.remove('shielded');
      victim.classList.add('rebounds');
      setTimeout(() => victim.classList.remove('rebounds'), 360);
    } else if (victim) {
      this.pieceEls.delete(capturedSquare);
      this.explode(capturedSquare, victim);
    }

    this.pieceEls.delete(move.from);
    this.pieceEls.set(move.to, el);
    this.placeSquare(el, move.to);
    this.thud(el);

    if (move.flags & (FLAG.KSIDE_CASTLE | FLAG.QSIDE_CASTLE)) {
      const kingSide = Boolean(move.flags & FLAG.KSIDE_CASTLE);
      const rookFrom = kingSide ? move.to + 1 : move.to - 2;
      const rookTo = kingSide ? move.to - 1 : move.to + 1;
      const rook = this.pieceEls.get(rookFrom);
      if (rook) {
        this.pieceEls.delete(rookFrom);
        this.pieceEls.set(rookTo, rook);
        this.placeSquare(rook, rookTo);
        this.thud(rook, 90);
      }
    }

    if (move.promotion) {
      // Swap the artwork once the pawn has finished travelling, so the change
      // reads as the promotion happening on arrival.
      setTimeout(() => {
        el.dataset.type = move.promotion;
        el.style.backgroundImage = `url('${pieceImage(move.promotion, move.color)}')`;
        el.classList.add('promoting');
        setTimeout(() => el.classList.remove('promoting'), 700);
      }, 240);
    }

    this.markLastMove(move.from, move.to);
    this.clearSelection();
  }

  /**
   * Bring the sprites back in line with the board after effects that create
   * or destroy pieces away from the move's own two squares — a reanimator
   * raising the dead, a sapper's blast clearing a ring. applyMove animates
   * the move itself; this catches whatever else the engine did.
   */
  reconcile(game) {
    for (let sq = 0; sq <= 119; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const piece = game.board[sq];
      const el = this.pieceEls.get(sq);
      if (!piece) {
        if (el) { this.pieceEls.delete(sq); this.explode(sq, el); }
        continue;
      }
      const colorClass = piece.color === WHITE ? 'white' : 'black';
      if (!el) {
        const born = this.addPiece(sq, piece.type, piece.color, game.status?.[sq] ?? 0);
        born.classList.add('rising');
        setTimeout(() => born.classList.remove('rising'), 460);
        continue;
      }
      if (el.dataset.type !== piece.type || !el.classList.contains(colorClass)) {
        this.pieceEls.delete(sq);
        el.remove();
        this.addPiece(sq, piece.type, piece.color, game.status?.[sq] ?? 0);
      }
    }
  }

  /** A shooter kicks back along its firing line instead of travelling. */
  recoil(el, from, to) {
    const dr = (to >> 4) - (from >> 4);
    const df = (to & 15) - (from & 15);
    const len = Math.hypot(dr, df) || 1;
    el.style.setProperty('--kx', `${(-df / len) * 26}%`);
    el.style.setProperty('--ky', `${(-dr / len) * 26}%`);
    el.classList.remove('recoiling');
    void el.offsetWidth;
    el.classList.add('recoiling');
    setTimeout(() => el.classList.remove('recoiling'), 340);
  }

  thud(el, delay = 0) {
    setTimeout(() => {
      el.classList.remove('landing');
      void el.offsetWidth;              // restart the keyframe
      el.classList.add('landing');
      setTimeout(() => el.classList.remove('landing'), 320);
    }, 240 + delay);
  }

  /** A taken piece spins out, leaving a burst of splinters behind. */
  explode(sq, el) {
    el.classList.add('taken');
    setTimeout(() => el.remove(), 380);

    const burst = document.createElement('div');
    burst.className = 'burst';
    this.placeSquare(burst, sq);
    for (let i = 0; i < 12; i++) {
      const shard = document.createElement('i');
      const angle = (Math.PI * 2 * i) / 12 + Math.random() * 0.5;
      const distance = 26 + Math.random() * 34;
      shard.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
      shard.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
      shard.style.setProperty('--delay', `${Math.random() * 60}ms`);
      burst.appendChild(shard);
    }
    this.fxLayer.appendChild(burst);
    setTimeout(() => burst.remove(), 700);
  }

  markLastMove(from, to) {
    for (const el of this.squares.values()) el.classList.remove('last');
    if (from != null) this.squares.get(from)?.classList.add('last');
    if (to != null) this.squares.get(to)?.classList.add('last');
  }

  markCheck(square) {
    for (const el of this.squares.values()) el.classList.remove('check');
    if (square != null) this.squares.get(square)?.classList.add('check');
  }

  /** Briefly outline a square — used when an illegal move is attempted. */
  reject(square) {
    const el = this.squares.get(square);
    if (!el) return;
    el.classList.remove('reject');
    void el.offsetWidth;
    el.classList.add('reject');
    setTimeout(() => el.classList.remove('reject'), 420);
  }

  // ---- selection ---------------------------------------------------------

  select(sq) {
    this.clearSelection();
    this.selected = sq;
    this.squares.get(sq)?.classList.add('sel');
    for (const move of this.handlers.legalTargets(sq)) {
      const el = this.squares.get(move.to);
      if (!el) continue;
      el.classList.add(move.captured ? 'target-capture' : 'target');
    }
  }

  clearSelection() {
    this.selected = null;
    for (const el of this.squares.values()) {
      el.classList.remove('sel', 'target', 'target-capture', 'hovered');
    }
  }

  // ---- pointer input -----------------------------------------------------

  squareFromEvent(event) {
    const rect = this.root.getBoundingClientRect();
    let col = Math.floor(((event.clientX - rect.left) / rect.width) * this.files);
    let row = Math.floor(((event.clientY - rect.top) / rect.height) * this.ranks);
    if (col < 0 || col >= this.files || row < 0 || row >= this.ranks) return null;
    if (this.flipped) { col = this.files - 1 - col; row = this.ranks - 1 - row; }
    return fromRowCol(row, col);
  }

  onPointerDown(event) {
    if (!this.interactive || event.button === 2) return;
    const sq = this.squareFromEvent(event);
    if (sq == null) return;
    this.handlers.onInspect?.(sq);
    if (this.handlers.isPlacingDuck?.()) {
      this.handlers.onPlaceDuck?.(sq);
      return;
    }

    const mine = this.handlers.canPickUp(sq);

    // Second click on a highlighted target completes a click-to-move.
    if (this.selected != null && this.selected !== sq && !mine) {
      const target = this.squares.get(sq);
      if (target?.classList.contains('target') || target?.classList.contains('target-capture')) {
        const from = this.selected;
        this.clearSelection();
        this.handlers.onAttemptMove(from, sq);
        return;
      }
    }

    if (!mine) {
      if (this.selected != null) {
        const from = this.selected;
        this.clearSelection();
        this.handlers.onAttemptMove(from, sq);
      }
      return;
    }

    // Picking up a piece always arms a drag, even when it is already selected —
    // a click that turns into a drag has to keep working. Whether releasing
    // without moving *deselects* is decided in onPointerUp.
    const wasSelected = this.selected === sq;
    if (!wasSelected) {
      this.select(sq);
      this.handlers.onPickUp?.(sq);
    }

    const el = this.pieceEls.get(sq);
    if (!el) return;
    this.dragging = {
      from: sq,
      el,
      wasSelected,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    el.classList.add('lifted');
    this.root.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  onPointerMove(event) {
    if (!this.dragging) return;
    const drag = this.dragging;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    // Only commit to a drag past a small threshold, so a click that wobbles a
    // couple of pixels still behaves like a click.
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    drag.el.classList.add('dragging');
    drag.el.style.setProperty('--dx', `${dx}px`);
    drag.el.style.setProperty('--dy', `${dy}px`);

    const sq = this.squareFromEvent(event);
    for (const el of this.squares.values()) el.classList.remove('hovered');
    if (sq != null && sq !== drag.from) this.squares.get(sq)?.classList.add('hovered');
  }

  onPointerUp(event) {
    if (!this.dragging) return;
    const drag = this.dragging;
    const sq = this.squareFromEvent(event);
    this.endDrag();

    if (!drag.moved) {
      // A click rather than a drag: the first one selects, a second one on the
      // same piece puts it back down.
      if (drag.wasSelected) this.clearSelection();
      return;
    }
    this.clearSelection();
    if (sq != null && sq !== drag.from) {
      this.handlers.onAttemptMove(drag.from, sq);
    }
  }

  endDrag() {
    const drag = this.dragging;
    this.dragging = null;
    if (!drag) return;
    drag.el.classList.remove('lifted', 'dragging');
    drag.el.style.removeProperty('--dx');
    drag.el.style.removeProperty('--dy');
    for (const el of this.squares.values()) el.classList.remove('hovered');
  }

  cancelDrag() {
    this.endDrag();
    this.clearSelection();
  }
}

// ---- screen-level effects -------------------------------------------------

let shakeTimer = null;

/** Knocks the whole app a few pixels. Strength 1 is a capture, 2 a checkmate. */
export function shake(strength = 1) {
  const app = document.getElementById('app');
  if (!app) return;
  app.style.setProperty('--shake', strength);
  app.classList.remove('shaking');
  void app.offsetWidth;
  app.classList.add('shaking');
  clearTimeout(shakeTimer);
  shakeTimer = setTimeout(() => app.classList.remove('shaking'), 420);
}

/** Confetti for the end of the game. */
export function confetti(count = 90) {
  const layer = document.getElementById('particles');
  if (!layer) return;
  const colors = ['#ffcf3f', '#ff5470', '#43d9ff', '#4ef08e', '#c08cff'];
  for (let i = 0; i < count; i++) {
    const bit = document.createElement('i');
    bit.className = 'confetti';
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = colors[Math.floor(Math.random() * colors.length)];
    bit.style.setProperty('--drift', `${(Math.random() - 0.5) * 240}px`);
    bit.style.setProperty('--spin', `${Math.random() * 900 - 450}deg`);
    bit.style.animationDelay = `${Math.random() * 500}ms`;
    bit.style.animationDuration = `${1800 + Math.random() * 1400}ms`;
    layer.appendChild(bit);
    setTimeout(() => bit.remove(), 3600);
  }
}

/** Big centred text that punches in and fades — check, checkmate, promotion. */
export function toast(text, kind = '') {
  const layer = document.getElementById('particles');
  if (!layer) return;
  const el = document.createElement('div');
  el.className = `board-toast ${kind}`;
  el.textContent = text;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

export { squareName, parseSquare };
