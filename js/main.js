// Wires the engine, the opponent, the audio and the board view together, and
// owns everything that is "the app" rather than "the game": screens, settings,
// the HUD, take-backs and the end-of-game flow.

import { Chess, WHITE, BLACK, FLAG } from './chess.js';
import { LEVELS, levelById, chooseDuck } from './ai.js';
import { pieceCost } from './pieces.js';
import { ShaderBackground } from './bg.js';
import { audio } from './audio.js';
import { BoardView, pieceImage, shake, confetti, toast } from './ui.js';
import { initCampaign } from './campaign.js';
import { initSandbox } from './sandbox.js';

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const trayValue = (type) => PIECE_VALUE[type] ?? pieceCost(type);
const $ = (id) => document.getElementById(id);

const state = {
  game: new Chess(),
  view: null,
  playerColor: WHITE,
  level: levelById(3),
  thinking: false,
  awaitingPromotion: null,
  gameOver: false,
  mode: 'classic',
  run: null,
  encounter: null,
  armyMax: 0,
  campaign: null,
  // Bumped whenever the position is reset from outside the normal move flow.
  // A search that finishes after that is stale and gets dropped.
  generation: 0,
  settings: { music: true, sfx: true, flip: false },
};

// ---- the opponent, off the main thread where possible ---------------------

let worker = null;
let workerSeq = 0;
const pending = new Map();

function setupWorker() {
  try {
    worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const { id, result } = event.data;
      const resolve = pending.get(id);
      pending.delete(id);
      resolve?.(result);
    };
    worker.onerror = () => { worker = null; };
  } catch {
    worker = null;    // falls back to searching on the main thread
  }
}

function requestMove(game, level) {
  const spec = game.toSpec ? game.toSpec() : null;
  const fen = spec ? spec.fen : game;
  const payload = spec
    ? { spec, fen, level }
    : { fen, levelId: typeof level === 'object' ? level.id : level, level };
  if (worker) {
    return new Promise((resolve) => {
      const id = ++workerSeq;
      pending.set(id, resolve);
      worker.postMessage({ id, ...payload });
    });
  }
  return import('./ai.js').then(({ chooseMove }) =>
    chooseMove(spec ? new Chess(spec) : new Chess(fen),
      typeof level === 'object' ? level : levelById(level)));
}

// ---- screens ---------------------------------------------------------------

function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.add('hidden');
  $(id).classList.remove('hidden');
}

// ---- HUD -------------------------------------------------------------------

/**
 * Which pieces each side has captured, and who is up on material.
 *
 * Captures come from the move history rather than from what is missing off a
 * full set, so a game started from a custom position doesn't open with two
 * trays full of pieces nobody took. The balance is read off the board, which
 * is the true count either way.
 */
function materialSummary() {
  const taken = { w: [], b: [] };
  for (const entry of state.game.history) {
    if (entry.move.captured) taken[entry.move.color].push(entry.move.captured);
  }

  let balance = 0;
  for (const piece of state.game.pieces()) {
    balance += (piece.color === WHITE ? 1 : -1) * trayValue(piece.type);
  }

  // taken.w = pieces White has captured; balance > 0 means White is ahead.
  return { taken, balance };
}

function renderTray(el, types, color, advantage) {
  el.innerHTML = '';
  types.sort((a, b) => trayValue(b) - trayValue(a));
  for (const type of types) {
    const bit = document.createElement('i');
    bit.className = 'taken-piece';
    bit.style.backgroundImage = `url('${pieceImage(type, color)}')`;
    el.appendChild(bit);
  }
  if (advantage > 0) {
    const badge = document.createElement('span');
    badge.className = 'advantage';
    badge.textContent = `+${advantage}`;
    el.appendChild(badge);
  }
}

function renderMoveList() {
  const list = $('move-list');
  const sans = state.game.history.map((h) => h.san).filter(Boolean);
  list.innerHTML = '';
  for (let i = 0; i < sans.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';
    row.innerHTML =
      `<span class="move-no">${i / 2 + 1}.</span>` +
      `<span class="move-san">${sans[i]}</span>` +
      `<span class="move-san">${sans[i + 1] ?? ''}</span>`;
    list.appendChild(row);
  }
  list.scrollTop = list.scrollHeight;
}

function updateHud() {
  const { taken, balance } = materialSummary();
  const player = state.playerColor;
  const opponent = player === WHITE ? BLACK : WHITE;
  const opponentColorName = opponent === WHITE ? 'w' : 'b';

  // Each panel shows the pieces that side has captured.
  renderTray($('tray-player'), taken[player], opponent, player === WHITE ? balance : -balance);
  renderTray($('tray-opponent'), taken[opponent], player, opponent === WHITE ? balance : -balance);

  if (state.mode !== 'run') {
    $('opponent-name').textContent = state.level.name;
    $('opponent-side').textContent = opponent === WHITE ? 'plays White' : 'plays Black';
    $('player-side').textContent = player === WHITE ? 'plays White' : 'plays Black';
  }

  $('panel-player').classList.toggle('active', state.game.turn === player && !state.gameOver);
  $('panel-opponent').classList.toggle('active', state.game.turn === opponent && !state.gameOver);

  renderMoveList();
  $('btn-undo').disabled = state.thinking || state.game.history.length === 0;
}

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

function refreshStatus() {
  if (state.gameOver) return;
  const foe = state.mode === 'run' && state.encounter
    ? state.encounter.name
    : state.level.name;
  if (state.thinking) {
    setStatus(`${foe} is thinking`, 'thinking');
    return;
  }
  if (state.game.awaitingDuck) {
    setStatus(state.game.turn !== state.playerColor ? 'Park the duck' : 'They park the duck');
    return;
  }
  if (state.game.turn === state.playerColor) {
    setStatus(state.game.inCheck() ? 'You are in check' : 'Your move',
      state.game.inCheck() ? 'danger' : '');
  } else {
    setStatus(`${foe} to move`);
  }
}

// ---- playing a move --------------------------------------------------------

/** Sound, camera and toast for a move that has just been applied. */
function reactTo(move) {
  const game = state.game;
  const inCheck = game.inCheck();
  const mate = inCheck && game.moves().length === 0;

  if (move.promotion) {
    audio.promote();
    toast('PROMOTION', 'good');
  } else if (move.flags & (FLAG.KSIDE_CASTLE | FLAG.QSIDE_CASTLE)) {
    audio.castle();
  } else if (move.captured) {
    audio.capture();
    shake(1);
    state.background?.pulse();
  } else {
    audio.place();
  }

  if (state.mode === 'run') state.campaign.paintRunHud();

  if (mate || (state.mode === 'run' && state.game.outcome().over && state.game.outcome().winner)) {
    setTimeout(() => { shake(2); state.background?.pulse(); }, 160);
  } else if (inCheck) {
    setTimeout(() => {
      audio.check();
      shake(1.4);
      toast('CHECK', 'danger');
    }, 180);
  }

  state.view.markCheck(inCheck ? game.kings[game.turn] : null);
}

function playMove(from, to, promotion) {
  const move = state.game.move({ from, to, promotion });
  if (!move) return false;
  state.view.applyMove(move);
  state.view.reconcile(state.game);
  state.view.syncStatuses(state.game);
  reactTo(move);
  updateHud();

  if (checkGameOver()) return true;
  if (state.mode === 'run' && state.campaign && state.game.turn !== state.playerColor) {
    if (state.campaign.tickClock()) {
      state.campaign.onFightOver({ timeout: true });
      return true;
    }
  }
  if (state.game.awaitingDuck) {
    beginDuckPlace(state.playerColor);
    return true;
  }
  refreshStatus();
  if (state.game.turn !== state.playerColor) scheduleOpponent();
  return true;
}

function beginDuckPlace(who) {
  state.view.clearSelection();
  for (const sq of state.game.duckSquares()) {
    state.view.squares.get(sq)?.classList.add('target');
  }
  state.view.squares.get(state.game.duck)?.classList.add('duck-here');
  setStatus(who === state.playerColor ? 'Park the duck' : 'They park the duck', '');
}

function onPlaceDuck(sq) {
  if (!state.game.awaitingDuck) return;
  if (!state.game.placeDuck(sq)) {
    audio.illegal();
    state.view.reject(sq);
    return;
  }
  audio.place();
  state.view.syncDuck(state.game);
  state.view.clearSelection();
  if (checkGameOver()) return;
  refreshStatus();
  if (state.game.turn !== state.playerColor) scheduleOpponent();
  else state.view.setInteractive(true);
}

function checkGameOver() {
  const outcome = state.game.outcome();
  if (!outcome.over) return false;

  if (state.mode === 'run') return state.campaign.onFightOver(outcome);

  state.gameOver = true;
  state.view.setInteractive(false);
  updateHud();

  const youWon = outcome.winner === state.playerColor;
  const moveCount = Math.ceil(state.game.history.length / 2);
  const plural = moveCount === 1 ? 'move' : 'moves';
  let title;
  let detail;
  if (outcome.reason === 'checkmate') {
    title = youWon ? 'CHECKMATE — YOU WIN' : 'CHECKMATE';
    detail = youWon
      ? `You mated ${state.level.name} in ${moveCount} ${plural}.`
      : `${state.level.name} mated you in ${moveCount} ${plural}.`;
  } else {
    title = 'DRAW';
    detail = `The game is drawn by ${outcome.reason}.`;
  }

  setStatus(title, youWon ? 'good' : outcome.winner ? 'danger' : '');
  setTimeout(() => {
    if (outcome.winner === null) audio.drawn();
    else if (youWon) { audio.victory(); confetti(); }
    else audio.defeat();
    $('result-title').textContent = title;
    $('result-detail').textContent = detail;
    $('modal-result').classList.remove('hidden');
  }, 700);
  return true;
}

function scheduleOpponent() {
  state.thinking = true;
  state.view.setInteractive(false);
  refreshStatus();
  updateHud();

  const startedAt = performance.now();
  const level = state.mode === 'run' && state.encounter?.ai
    ? state.encounter.ai
    : state.level;
  const generation = state.generation;
  requestMove(state.game, level).then((result) => {
    // A snap-instant reply feels robotic; hold the shortest searches back a
    // little so the opponent always looks like it considered the position.
    const elapsed = performance.now() - startedAt;
    const wait = Math.max(0, 420 - elapsed);
    setTimeout(() => {
      if (generation !== state.generation) return;   // the game moved on
      state.thinking = false;
      if (state.gameOver || !result) return;
      const move = state.game.move({
        from: result.from,
        to: result.to,
        promotion: result.promotion,
      });
      if (!move) { refreshStatus(); return; }
      state.view.applyMove(move);
      state.view.reconcile(state.game);
      state.view.syncStatuses(state.game);
      reactTo(move);
      updateHud();
      if (checkGameOver()) return;
      if (state.game.awaitingDuck) {
        const duckSq = result.duck ?? chooseDuck(state.game);
        if (duckSq != null) state.game.placeDuck(duckSq);
        state.view.syncDuck(state.game);
      }
      if (checkGameOver()) return;
      state.view.setInteractive(true);
      refreshStatus();
    }, wait);
  });
}

// ---- promotion -------------------------------------------------------------

function askPromotion(from, to) {
  state.awaitingPromotion = { from, to };
  const picker = $('promotion-picker');
  picker.innerHTML = '';
  for (const type of ['q', 'r', 'b', 'n']) {
    const btn = document.createElement('button');
    btn.className = 'promo-btn';
    btn.dataset.type = type;
    btn.innerHTML =
      `<i style="background-image:url('${pieceImage(type, state.playerColor)}')"></i>` +
      `<span>${{ q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[type]}</span>`;
    btn.addEventListener('click', () => {
      $('modal-promotion').classList.add('hidden');
      const choice = state.awaitingPromotion;
      state.awaitingPromotion = null;
      audio.click();
      if (choice) playMove(choice.from, choice.to, type);
    });
    btn.addEventListener('pointerenter', () => audio.hover());
    picker.appendChild(btn);
  }
  $('modal-promotion').classList.remove('hidden');
}

// ---- board handlers --------------------------------------------------------

function canPickUp(sq) {
  if (state.gameOver || state.thinking || state.game.awaitingDuck) return false;
  const piece = state.game.get(sq);
  return Boolean(piece) && piece.color === state.playerColor &&
    state.game.turn === state.playerColor;
}

function legalTargets(sq) {
  return state.game.moves({ square: sq });
}

function onAttemptMove(from, to) {
  if (state.gameOver || state.thinking) return;
  const options = state.game.moves({ square: from }).filter((m) => m.to === to);
  if (options.length === 0) {
    audio.illegal();
    state.view.reject(to);
    return;
  }
  if (options[0].promotion) {
    askPromotion(from, to);
    return;
  }
  playMove(from, to);
}

// ---- game lifecycle --------------------------------------------------------

/**
 * A position can be handed in through `?fen=...`, which makes it possible to
 * start from a specific board — handy for testing an ending, and the hook the
 * encounter generator will eventually use.
 */
function startingPosition() {
  const fen = new URLSearchParams(location.search).get('fen');
  if (!fen) return new Chess();
  try {
    return new Chess(fen.trim());
  } catch {
    return new Chess();
  }
}

function newGame() {
  if (state.mode === 'run') return;
  state.generation++;
  state.game = startingPosition();
  state.gameOver = false;
  state.thinking = false;
  state.awaitingPromotion = null;
  $('modal-result').classList.add('hidden');
  $('modal-promotion').classList.add('hidden');

  state.view.setFlipped(state.playerColor === BLACK ? !state.settings.flip : state.settings.flip);
  state.view.syncFromGame(state.game);
  state.view.markLastMove(null, null);
  state.view.markCheck(null);
  state.view.setInteractive(true);
  renderCoordinates();
  updateHud();
  refreshStatus();

  if (state.game.turn !== state.playerColor) scheduleOpponent();
}

/** Takes back to the player's own turn — their move and the reply together. */
function takeBack() {
  if (state.mode === 'run') return;
  if (state.thinking || state.game.history.length === 0) return;
  state.generation++;
  state.game.undoMove();
  if (state.game.turn !== state.playerColor && state.game.history.length > 0) {
    state.game.undoMove();
  }
  state.gameOver = false;
  $('modal-result').classList.add('hidden');
  state.view.syncFromGame(state.game);
  const last = state.game.history[state.game.history.length - 1];
  state.view.markLastMove(last?.move.from ?? null, last?.move.to ?? null);
  state.view.markCheck(state.game.inCheck() ? state.game.kings[state.game.turn] : null);
  state.view.setInteractive(true);
  audio.lift();
  updateHud();
  refreshStatus();
}

function renderCoordinates() {
  const nFiles = state.view?.files ?? 8;
  const nRanks = state.view?.ranks ?? 8;
  const files = Array.from({ length: nFiles }, (_, i) => String.fromCharCode(97 + i));
  const ranks = Array.from({ length: nRanks }, (_, i) => String(nRanks - i));
  const flipped = state.view.flipped;
  $('coords-files').innerHTML = (flipped ? [...files].reverse() : files)
    .map((f) => `<span>${f}</span>`).join('');
  $('coords-ranks').innerHTML = (flipped ? [...ranks].reverse() : ranks)
    .map((r) => `<span>${r}</span>`).join('');
}

// ---- wiring ----------------------------------------------------------------

function bindSounds() {
  for (const el of document.querySelectorAll('button, .toggle')) {
    el.addEventListener('pointerenter', () => audio.hover());
  }
  for (const el of document.querySelectorAll('button')) {
    el.addEventListener('click', () => audio.click());
  }
}

function buildLevelPicker() {
  const picker = $('level-picker');
  picker.innerHTML = '';
  for (const level of LEVELS) {
    const btn = document.createElement('button');
    btn.className = 'level-btn' + (level.id === state.level.id ? ' on' : '');
    btn.dataset.level = level.id;
    btn.innerHTML =
      `<i style="background-image:url('${pieceImage(
        { 1: 'p', 2: 'n', 3: 'b', 4: 'r', 5: 'q' }[level.id], BLACK)}')"></i>` +
      `<span class="level-name">${level.name}</span>` +
      `<span class="level-blurb">${level.blurb}</span>`;
    btn.addEventListener('click', () => {
      state.level = level;
      for (const other of picker.children) other.classList.toggle('on', other === btn);
    });
    picker.appendChild(btn);
  }
}

function init() {
  state.background = new ShaderBackground($('bg-canvas'));
  state.background.start();

  state.view = new BoardView($('board'), {
    onAttemptMove, canPickUp, legalTargets,
    onPickUp: () => audio.lift(),
    isPlacingDuck: () => Boolean(state.game?.awaitingDuck && state.game.turn !== state.playerColor),
    onPlaceDuck,
  });

  setupWorker();
  buildLevelPicker();
  renderCoordinates();
  bindSounds();

  // Side picker
  for (const btn of document.querySelectorAll('#side-picker .side-btn')) {
    btn.addEventListener('click', () => {
      for (const other of document.querySelectorAll('#side-picker .side-btn')) {
        other.classList.toggle('on', other === btn);
      }
      state.chosenSide = btn.dataset.side;
    });
  }
  state.chosenSide = 'w';

  state.campaign = initCampaign({
    state, $, showScreen, audio, requestMove, setStatus, refreshStatus,
    updateHud, renderCoordinates, Chess,
  });

  const sandbox = initSandbox({ $, showScreen, audio });
  $('btn-sandbox')?.addEventListener('click', () => sandbox?.open());

  $('btn-classic').addEventListener('click', () => showScreen('screen-classic'));
  $('btn-classic-back').addEventListener('click', () => showScreen('screen-start'));

  $('btn-play').addEventListener('click', async () => {
    await audio.resume();
    if (state.settings.music) audio.startMusic();
    state.mode = 'classic';
    state.campaign.resetClassicButtons();
    state.playerColor = state.chosenSide === 'random'
      ? (Math.random() < 0.5 ? WHITE : BLACK)
      : (state.chosenSide === 'b' ? BLACK : WHITE);
    state.settings.flip = false;
    audio.setMusicStyle('fight');
    showScreen('screen-game');
    newGame();
  });

  $('btn-howto').addEventListener('click', () => showScreen('screen-howto'));
  $('btn-howto-close').addEventListener('click', () => showScreen('screen-start'));

  $('btn-new').addEventListener('click', () => newGame());
  $('btn-undo').addEventListener('click', () => takeBack());
  $('btn-flip').addEventListener('click', () => {
    state.settings.flip = !state.settings.flip;
    state.view.setFlipped(!state.view.flipped);
    renderCoordinates();
  });
  $('btn-quit').addEventListener('click', () => {
    state.generation++;
    state.gameOver = true;
    state.thinking = false;
    audio.setMusicStyle('ambient');
    if (state.mode === 'run') state.campaign.abandon();
    else showScreen('screen-start');
  });
  $('btn-again').addEventListener('click', () => {
    if (state.mode === 'run') {
      $('modal-result').classList.add('hidden');
      state.campaign.startRun();
      return;
    }
    newGame();
  });
  $('btn-result-menu').addEventListener('click', () => {
    $('modal-result').classList.add('hidden');
    audio.setMusicStyle('ambient');
    if (state.mode === 'run') state.campaign.abandon();
    else showScreen('screen-start');
  });

  const music = $('chk-music');
  const sfx = $('chk-sfx');
  music.addEventListener('change', () => {
    state.settings.music = music.checked;
    audio.toggleMusic(music.checked);
  });
  sfx.addEventListener('change', () => {
    state.settings.sfx = sfx.checked;
    audio.toggleSfx(sfx.checked);
  });
  $('btn-music').addEventListener('click', () => {
    music.checked = !music.checked;
    music.dispatchEvent(new Event('change'));
    $('btn-music').classList.toggle('off', !music.checked);
  });
  $('btn-sfx').addEventListener('click', () => {
    sfx.checked = !sfx.checked;
    sfx.dispatchEvent(new Event('change'));
    $('btn-sfx').classList.toggle('off', !sfx.checked);
  });

  document.addEventListener('keydown', (event) => {
    if ($('screen-game').classList.contains('hidden')) return;
    if (event.key === 'u') takeBack();
    if (event.key === 'f') $('btn-flip').click();
    if (event.key === 'n') newGame();
    if (event.key === 'Escape') state.view.cancelDrag();
  });
}

init();
