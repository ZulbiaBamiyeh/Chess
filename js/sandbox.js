// A menu sandbox: drop any piece, swap king passives, paint terrain,
// and click the board to see legal moves. No AI, no clock, no run.

import { Chess, WHITE, BLACK, TILE, ST_FROZEN, ST_SHIELD } from './chess.js';
import { PIECES } from './pieces.js';
import { KING_PASSIVES, PLAIN_KING, kingDef } from './content.js';
import { BoardView, pieceImage, pieceHue, kingSkin, kingHue, setGameText } from './ui.js';

const KING_STEPS = [-17, -16, -15, -1, 1, 15, 16, 17];

const TERRAIN = [
  { id: 'move', name: 'Move', tile: null, blurb: 'Click a piece on the board to see and play its moves.' },
  { id: 'erase', name: 'Erase', tile: TILE.NONE, blurb: 'Clear a square.' },
  { id: 'block', name: 'Wall', tile: TILE.BLOCK, blurb: 'A wall. Nothing lands here or slides through.' },
  { id: 'frost', name: 'Frost', tile: TILE.FROST, blurb: 'Landing here freezes the piece for a turn.' },
  { id: 'fort', name: 'Fort', tile: TILE.FORT, blurb: 'Landing here grants a shield. The first hit knocks the piece aside.' },
  { id: 'fire', name: 'Fire', tile: TILE.FIRE, blurb: 'Lingering fire. A piece that steps here burns.' },
  { id: 'glass', name: 'Glass', tile: TILE.GLASS,
    blurb: 'Holds once. The first piece to land here turns it into a wall for the rest of the fight.' },
];

// Derived, not hand-listed: the hardcoded version silently went stale every
// time a piece was added, so the sandbox — the one screen whose whole job is
// letting you try every piece — was missing several of them.
// Classic six first, in the order a player thinks of them, then everything
// else cheapest-first.
const CLASSIC_ORDER = ['k', 'q', 'r', 'b', 'n', 'p'];
const PIECE_ORDER = [
  ...CLASSIC_ORDER,
  ...Object.values(PIECES)
    .filter((def) => !CLASSIC_ORDER.includes(def.id))
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name))
    .map((def) => def.id),
];

export function initSandbox({ $, showScreen, audio }) {
  const box = {
    game: null,
    view: null,
    color: WHITE,
    king: 'plain',
    tool: { kind: 'piece', type: 'n' },
  };

  function emptyGame() {
    return new Chess({
      fen: '8/8/8/8/8/8/8/8 w - - 0 1',
      files: 8,
      ranks: 8,
      rules: { checks: false, kingCapture: true, castling: false },
      kingPassives: box.king === 'plain' ? [] : [box.king],
    });
  }

  function paintCoords() {
    const files = Array.from({ length: 8 }, (_, i) => String.fromCharCode(97 + i));
    const ranks = Array.from({ length: 8 }, (_, i) => String(8 - i));
    if ($('coords-files-sandbox')) {
      $('coords-files-sandbox').innerHTML = files.map((f) => `<span>${f}</span>`).join('');
    }
    if ($('coords-ranks-sandbox')) {
      $('coords-ranks-sandbox').innerHTML = ranks.map((r) => `<span>${r}</span>`).join('');
    }
  }

  function refresh() {
    box.view.setWhiteKingSkin(kingSkin(box.king), kingHue(box.king));
    box.view.syncFromGame(box.game);
    box.view.setInteractive(true);
    paintCoords();
    paintTray();
    paintDiagram();
    paintDetail();
  }

  function applyKingPassives() {
    const game = box.game;
    game.kingPassives = box.king === 'plain' ? [] : [box.king];
    const wk = game.kings.w;
    if (wk >= 0 && box.king === 'aegis') game.status[wk] |= ST_SHIELD;
    if (wk >= 0 && box.king === 'hoarfrost') {
      for (const off of KING_STEPS) {
        const sq = wk + off;
        if (!game.inBounds(sq)) continue;
        const p = game.board[sq];
        if (p && p.color === BLACK) game.status[sq] |= ST_FROZEN;
      }
    }
    game.refreshMode();
  }

  function placePiece(sq, type, color) {
    const game = box.game;
    if (!game.inBounds(sq) || game.isBlocked(sq)) return false;
    if (type === 'k') {
      const old = game.kings[color];
      if (old >= 0 && old !== sq) {
        game.board[old] = null;
        game.status[old] = 0;
      }
      game.kings[color] = sq;
    } else if (game.board[sq]?.type === 'k') {
      game.kings[game.board[sq].color] = -1;
    }
    game.board[sq] = { type, color };
    game.status[sq] = 0;
    if (game.terrain[sq] === TILE.FROST) game.status[sq] |= ST_FROZEN;
    if (game.terrain[sq] === TILE.FORT) game.status[sq] |= ST_SHIELD;
    applyKingPassives();
    game.turn = color;
    return true;
  }

  function paintTile(sq, tile) {
    const game = box.game;
    if (!game.inBounds(sq)) return;
    if (tile === TILE.NONE) {
      game.terrain[sq] = 0;
      game.fireUntil[sq] = 0;
      if (!game.board[sq]) game.status[sq] = 0;
    } else {
      game.terrain[sq] = tile;
      if (tile === TILE.FIRE) game.fireUntil[sq] = 9999;
      else game.fireUntil[sq] = 0;
      if (tile === TILE.BLOCK && game.board[sq]) {
        if (game.board[sq].type === 'k') game.kings[game.board[sq].color] = -1;
        game.board[sq] = null;
        game.status[sq] = 0;
      } else if (game.board[sq]) {
        if (tile === TILE.FROST) game.status[sq] |= ST_FROZEN;
        if (tile === TILE.FORT) game.status[sq] |= ST_SHIELD;
      }
    }
    game.refreshMode();
  }

  function eraseSquare(sq) {
    const game = box.game;
    if (!game.inBounds(sq)) return;
    const piece = game.board[sq];
    if (piece?.type === 'k') game.kings[piece.color] = -1;
    game.board[sq] = null;
    game.terrain[sq] = 0;
    game.fireUntil[sq] = 0;
    game.status[sq] = 0;
    game.refreshMode();
  }

  function applyTool(sq) {
    const tool = box.tool;
    if (!tool) return;
    if (tool.kind === 'erase') eraseSquare(sq);
    else if (tool.kind === 'terrain') paintTile(sq, tool.tile);
    else if (tool.kind === 'piece') {
      if (!placePiece(sq, tool.type, box.color)) { audio.illegal(); return; }
      box.tool = { kind: 'move' };
    } else {
      return;
    }
    audio.place();
    refresh();
    if (tool.kind === 'piece' && box.game.board[sq]) box.view.select(sq);
  }

  function paintTray() {
    const kings = $('sandbox-kings');
    if (kings) {
      kings.innerHTML = '';
      for (const def of [PLAIN_KING, ...Object.values(KING_PASSIVES)]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sandbox-pick' + (box.king === def.id ? ' on' : '');
        btn.title = def.blurb;
        const kingFilter = kingHue(def.id) ? ` filter:hue-rotate(${kingHue(def.id)}deg);` : '';
        btn.innerHTML =
          `<i style="background-image:url('${pieceImage('k', WHITE, kingSkin(def.id))}');${kingFilter}"></i>`
          + `<span>${def.name}</span>`;
        btn.addEventListener('click', () => {
          box.king = def.id;
          applyKingPassives();
          audio.click();
          refresh();
        });
        kings.appendChild(btn);
      }
    }

    const colors = $('sandbox-colors');
    if (colors) {
      colors.innerHTML = '';
      for (const [id, label] of [[WHITE, 'White'], [BLACK, 'Black']]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sandbox-pick' + (box.color === id ? ' on' : '');
        const sideFilter = id === WHITE && kingHue(box.king) ? ` filter:hue-rotate(${kingHue(box.king)}deg);` : '';
        btn.innerHTML =
          `<i style="background-image:url('${pieceImage('k', id, id === WHITE ? kingSkin(box.king) : null)}');${sideFilter}"></i>`
          + `<span>${label}</span>`;
        btn.addEventListener('click', () => {
          box.color = id;
          audio.click();
          paintTray();
          paintDetail();
        });
        colors.appendChild(btn);
      }
    }

    const pieces = $('sandbox-pieces');
    if (pieces) {
      pieces.innerHTML = '';
      for (const id of PIECE_ORDER) {
        const def = PIECES[id];
        if (!def) continue;
        const on = box.tool?.kind === 'piece' && box.tool.type === id;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sandbox-pick' + (on ? ' on' : '');
        btn.title = def.blurb;
        const isWhiteKingTile = id === 'k' && box.color === WHITE;
        const skin = isWhiteKingTile ? kingSkin(box.king) : null;
        const hue = isWhiteKingTile ? kingHue(box.king) : pieceHue(id);
        btn.innerHTML =
          `<i style="background-image:url('${pieceImage(id, box.color, skin)}');${hue ? `filter:hue-rotate(${hue}deg)` : ''}"></i>`
          + `<span>${def.name}</span>`;
        btn.addEventListener('click', () => {
          box.tool = { kind: 'piece', type: id };
          audio.click();
          paintTray();
          paintDiagram();
          paintDetail();
        });
        pieces.appendChild(btn);
      }
    }

    const terrain = $('sandbox-terrain');
    if (terrain) {
      terrain.innerHTML = '';
      for (const t of TERRAIN) {
        const on = (t.id === 'move' && box.tool?.kind === 'move')
          || (t.id === 'erase' && box.tool?.kind === 'erase')
          || (t.id === 'terrain' && box.tool?.kind === 'terrain' && box.tool.tile === t.tile)
          || (box.tool?.kind === 'terrain' && box.tool.id === t.id);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sandbox-pick terrain-' + t.id + (on ? ' on' : '');
        btn.title = t.blurb;
        btn.innerHTML = `<span class="sandbox-swatch"></span><span>${t.name}</span>`;
        btn.addEventListener('click', () => {
          if (t.id === 'move') box.tool = { kind: 'move' };
          else if (t.id === 'erase') box.tool = { kind: 'erase' };
          else box.tool = { kind: 'terrain', tile: t.tile, id: t.id };
          audio.click();
          paintTray();
          paintDiagram();
          paintDetail();
        });
        terrain.appendChild(btn);
      }
    }
  }

  function paintDiagram() {
    const host = $('sb-md-board');
    const wrap = $('sandbox-diagram');
    if (!host || !wrap) return;
    const type = box.tool?.kind === 'piece' ? box.tool.type : null;
    if (!type) {
      wrap.classList.add('empty');
      const t = box.tool?.kind === 'terrain'
        ? TERRAIN.find((x) => x.id === box.tool.id)
        : TERRAIN.find((x) => x.id === box.tool?.kind);
      if ($('sb-md-name')) $('sb-md-name').textContent = t?.name || 'How it moves';
      if ($('sb-md-blurb')) $('sb-md-blurb').textContent = t?.blurb || 'Pick a piece from the tray.';
      if ($('sb-md-cost')) $('sb-md-cost').textContent = '';
      if ($('sb-md-art')) {
        $('sb-md-art').style.backgroundImage = '';
        $('sb-md-art').style.filter = '';
      }
      host.innerHTML = '';
      return;
    }
    wrap.classList.remove('empty');
    const def = PIECES[type];
    const king = type === 'k' ? kingDef(box.king) : null;
    const files = 7;
    const ranks = 7;
    const g = new Chess({
      files, ranks,
      rules: { checks: false, kingCapture: true, castling: false },
      kingPassives: box.king === 'plain' ? [] : [box.king],
    });
    const mid = 3 * 16 + 3;
    g.board[mid] = { type, color: WHITE };
    if (type === 'k') g.kings.w = mid;
    if (def.pawn) {
      for (const off of [-17, -15]) {
        const sq = mid + off;
        if (g.inBounds(sq)) g.board[sq] = { type: 'p', color: BLACK };
      }
    }
    if (def.hopper) {
      g.board[mid - 16] = { type: 'p', color: BLACK };
    }
    g.turn = WHITE;
    g.refreshMode();
    const dest = new Map();
    for (const m of g.moves({ square: mid, legal: false })) {
      dest.set(m.to, Boolean(m.captured));
    }
    // Firing squares need drawing from the definition — see campaign.js.
    if (def?.shootOff) {
      for (const off of def.shootOff) {
        const sq = mid + off;
        if (g.inBounds(sq) && sq !== mid) dest.set(sq, true);
      }
    }
    const skin = type === 'k' ? kingSkin(box.king) : null;
    const hue = type === 'k' ? kingHue(box.king) : pieceHue(type);
    if ($('sb-md-name')) {
      $('sb-md-name').textContent = king && king.id !== 'plain' ? `${king.name} King` : def.name;
    }
    if ($('sb-md-blurb')) {
      $('sb-md-blurb').textContent = (king && king.id !== 'plain' ? king.blurb : def.blurb) || '';
    }
    if ($('sb-md-cost')) {
      setGameText($('sb-md-cost'), king && king.id !== 'plain' ? '' : `${def.cost} supply · ${def.rarity}`);
    }
    if ($('sb-md-art')) {
      $('sb-md-art').style.backgroundImage = `url('${pieceImage(type, WHITE, skin)}')`;
      $('sb-md-art').style.filter = hue ? `hue-rotate(${hue}deg)` : '';
    }
    host.innerHTML = '';
    for (let r = 0; r < ranks; r++) {
      for (let f = 0; f < files; f++) {
        const sq = r * 16 + f;
        const cell = document.createElement('i');
        cell.className = 'md-sq' + ((r + f) % 2 ? ' dark' : ' light');
        if (sq === mid) {
          const fig = document.createElement('b');
          fig.style.backgroundImage = `url('${pieceImage(type, WHITE, skin)}')`;
          if (hue) fig.style.filter = `hue-rotate(${hue}deg)`;
          cell.appendChild(fig);
        } else if (dest.has(sq)) {
          cell.classList.add(dest.get(sq) ? 'cap' : 'go');
        }
        host.appendChild(cell);
      }
    }
  }

  function paintDetail() {
    const el = $('sandbox-detail');
    if (!el) return;
    const tool = box.tool;
    if (tool?.kind === 'piece') {
      const def = PIECES[tool.type];
      const king = kingDef(box.king);
      const notes = [];
      if (def?.blurb) notes.push(def.blurb);
      if (tool.type === 'k' && king.id !== 'plain') notes.push(`${king.name}: ${king.blurb}`);
      if (tool.type === 'p' && box.king === 'pioneer') notes.push('Pioneer: promotes one rank sooner.');
      if (box.king === 'court' && (tool.type === 'q' || tool.type === 't' || tool.type === 'a')) {
        notes.push('Court: also leaps like a knight.');
      }
      if (box.king === 'pyre' && def?.slides) notes.push('Pyre: this slider leaves fire on the path.');
      el.textContent = notes.join(' ');
      return;
    }
    if (tool?.kind === 'terrain') {
      const t = TERRAIN.find((x) => x.tile === tool.tile);
      el.textContent = t?.blurb || '';
      return;
    }
    if (tool?.kind === 'erase') {
      el.textContent = 'Click a square to wipe the piece and the tile.';
      return;
    }
    if (tool?.kind === 'move') {
      el.textContent = 'Click a piece on the board to see its moves. Drag or click a highlighted square to play.';
      return;
    }
    el.textContent = '';
  }

  function open() {
    showScreen('screen-sandbox');
    try { audio.resume?.(); } catch { /* AudioContext can refuse before a gesture. */ }

    if (!box.view) {
      const root = $('sandbox-board');
      if (!root) return;
      box.view = new BoardView(root, {
        canPickUp: (sq) => {
          if (box.tool?.kind === 'terrain' || box.tool?.kind === 'erase') return false;
          return Boolean(box.game.board[sq]);
        },
        legalTargets: (sq) => {
          const p = box.game.board[sq];
          if (!p) return [];
          box.game.turn = p.color;
          return box.game.moves({ square: sq });
        },
        onPickUp: (sq) => {
          const p = box.game.board[sq];
          if (p) box.game.turn = p.color;
          audio.lift();
        },
        onAttemptMove: (from, to) => {
          const p = box.game.board[from];
          if (p) box.game.turn = p.color;
          const played = box.game.move({ from, to });
          if (!played) {
            audio.illegal();
            box.view.reject?.(to);
            return;
          }
          if (played.captured) audio.capture();
          else audio.place();
          box.view.syncFromGame(box.game);
          box.view.syncStatuses?.(box.game);
          box.view.markLastMove?.(from, to);
        },
      });
      $('sandbox-board').addEventListener('pointerdown', (event) => {
        if (event.button === 2) {
          const sq = box.view.squareFromEvent(event);
          if (sq == null) return;
          eraseSquare(sq);
          audio.place();
          refresh();
          return;
        }
        if (box.tool?.kind === 'move') return;
        const sq = box.view.squareFromEvent(event);
        if (sq == null) return;
        if (box.tool?.kind === 'piece' && box.game.board[sq]) {
          box.tool = { kind: 'move' };
          paintTray();
          paintDetail();
          return;
        }
        if (box.tool?.kind !== 'piece' && box.tool?.kind !== 'terrain' && box.tool?.kind !== 'erase') return;
        event.stopPropagation();
        applyTool(sq);
      }, true);
    }
    box.game = emptyGame();
    box.tool = { kind: 'piece', type: 'n' };
    box.color = WHITE;
    applyKingPassives();
    refresh();
    try { audio.setMusicStyle('ambient'); } catch { /* music is optional */ }
  }

  window.openSandbox = open;

  const go = (event) => {
    event?.preventDefault?.();
    open();
  };
  if ($('btn-sandbox')) {
    $('btn-sandbox').addEventListener('click', go);
  }
  if ($('btn-sandbox-back')) {
    $('btn-sandbox-back').addEventListener('click', () => {
      audio.setMusicStyle('ambient');
      showScreen('screen-start');
    });
  }
  if ($('btn-sandbox-clear')) {
    $('btn-sandbox-clear').addEventListener('click', () => {
      box.game = emptyGame();
      applyKingPassives();
      audio.click();
      refresh();
    });
  }
  try {
    if (location.hash === '#sandbox') open();
  } catch { /* don't block the rest of boot if a hash-open fails */ }

  return { open };
}
