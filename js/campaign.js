// Run screens: map, loadout, shop, and the fight overlay on the shared board.

import { WHITE, BLACK, FLAG, parseSquare, squareName } from './chess.js';
import { pieceById, pieceCost, rarityOf } from './pieces.js';
import { BoardView, pieceImage, pieceHue, shake, confetti, toast } from './ui.js';
import {
  createRun, currentNode, validateLoadout, buildFight, settleFight,
  openShop, buyOffer, rerollShop, closeShop, advance, retryAllowed,
  autoPlace, supplyBudget, occupiedSlots, homeSquares,
} from './run.js';
import { ENCOUNTERS } from './content.js';

export function initCampaign(ctx) {
  const {
    state, $, showScreen, audio, requestMove, setStatus, refreshStatus,
    updateHud, renderCoordinates,
  } = ctx;

  let deployView = null;
  let selectedUid = null;
  let placements = []; // { uid, type, sq }

  function hearts(n) {
    return '♥'.repeat(Math.max(0, n)) + '♡'.repeat(Math.max(0, 3 - n));
  }

  function paintRunHud() {
    const run = state.run;
    if (!run) return;
    const bits = [
      ['hud-hearts', 'map-hearts', 'load-hearts', 'shop-hearts'],
      ['hud-gold', 'map-gold', 'load-gold', 'shop-gold'],
    ];
    for (const id of bits[0]) {
      const el = $(id);
      if (el) el.textContent = hearts(run.hearts);
    }
    for (const id of bits[1]) {
      const el = $(id);
      if (el) el.textContent = `${run.gold}g`;
    }
    if ($('map-supply')) $('map-supply').textContent = `Supply +${run.supplyBonus}`;
    if ($('hud-army') && state.game && state.mode === 'run') {
      const now = state.game.armyValue(WHITE);
      const max = state.armyMax || now;
      $('hud-army').textContent = `Army ${now}/${max}`;
    }
  }

  function startRun() {
    state.mode = 'run';
    state.run = createRun();
    state.playerColor = WHITE;
    showMap();
  }

  function showMap() {
    const run = state.run;
    const node = currentNode(run);
    paintRunHud();
    const path = $('map-path');
    path.innerHTML = '';
    ENCOUNTERS.forEach((enc, i) => {
      const btn = document.createElement('button');
      btn.className = 'map-node'
        + (i === run.node ? ' current' : '')
        + (i < run.node ? ' done' : '')
        + (enc.kind === 'shop' ? ' shop' : '')
        + (enc.boss ? ' boss' : '');
      btn.innerHTML = `<span class="map-node-kind">${enc.kind === 'shop' ? 'Shop' : enc.boss ? 'Boss' : 'Fight'}</span>`
        + `<span class="map-node-name">${enc.name}</span>`
        + (enc.kind === 'fight'
          ? `<span class="map-node-meta">${enc.files}×${enc.ranks} · ${enc.supply + run.supplyBonus} supply</span>`
          : `<span class="map-node-meta">${enc.blurb}</span>`);
      path.appendChild(btn);
    });
    $('map-blurb').textContent = node
      ? `${node.name} — ${node.blurb}`
      : 'The road is finished.';
    $('btn-map-go').textContent = !node ? 'Finish' : node.kind === 'shop' ? 'Browse' : 'Prepare';
    showScreen('screen-map');
  }

  function goFromMap() {
    const node = currentNode(state.run);
    if (!node || state.run.over) {
      endRun();
      return;
    }
    if (node.kind === 'shop') openShopScreen();
    else openLoadout(node);
  }

  function openLoadout(encounter) {
    state.encounter = encounter;
    selectedUid = null;
    const homes = homeSquares(encounter.files, encounter.ranks);
    const kingSq = homes[Math.floor(homes.length / 2)] ?? homes[0];
    placements = [{ uid: 'king', type: 'k', sq: kingSq }];

    $('loadout-title').textContent = encounter.name;
    $('loadout-blurb').textContent =
      `${encounter.blurb}  ·  ${encounter.files}×${encounter.ranks}  ·  take their king`;

    if (!deployView) {
      deployView = new BoardView($('deploy-board'), {
        onAttemptMove: onDeployDrop,
        canPickUp: canDeployPick,
        legalTargets: deployTargets,
        onPickUp: () => audio.lift(),
      });
    }
    rebuildDeploy();
    renderBag();
    paintSupply();
    paintRunHud();
    showScreen('screen-loadout');
  }

  function rebuildDeploy() {
    const enc = state.encounter;
    const { Chess } = ctx;
    const game = buildFight(state.run, enc, placements);
    deployView.setFlipped(false);
    deployView.syncFromGame(game);
    deployView.setInteractive(true);
    paintHomes(enc);
    paintDeployCoords(enc);
  }

  function paintHomes(enc) {
    const homes = new Set(homeSquares(enc.files, enc.ranks));
    const taken = new Set(placements.map((p) => p.sq));
    for (const [sq, el] of deployView.squares) {
      el.classList.toggle('home', homes.has(sq));
      el.classList.toggle('home-free', homes.has(sq) && !taken.has(sq));
    }
  }

  function paintDeployCoords(enc) {
    const files = Array.from({ length: enc.files }, (_, i) => String.fromCharCode(97 + i));
    const ranks = Array.from({ length: enc.ranks }, (_, i) => String(enc.ranks - i));
    $('coords-files-deploy').innerHTML = files.map((f) => `<span>${f}</span>`).join('');
    $('coords-ranks-deploy').innerHTML = ranks.map((r) => `<span>${r}</span>`).join('');
  }

  function renderBag() {
    const list = $('bag-list');
    list.innerHTML = '';
    const used = new Set(placements.map((p) => p.uid));
    for (const item of state.run.bag) {
      const def = pieceById(item.type);
      const btn = document.createElement('button');
      btn.className = 'bag-item'
        + (used.has(item.uid) ? ' used' : '')
        + (selectedUid === item.uid ? ' on' : '');
      btn.disabled = used.has(item.uid);
      const hue = pieceHue(item.type);
      btn.innerHTML =
        `<i style="background-image:url('${pieceImage(item.type, WHITE)}');${hue ? `filter:hue-rotate(${hue}deg)` : ''}"></i>`
        + `<span class="bag-name">${def.name}</span>`
        + `<span class="bag-meta">${def.cost} · ${def.rarity}</span>`;
      btn.addEventListener('click', () => {
        if (used.has(item.uid)) return;
        selectedUid = selectedUid === item.uid ? null : item.uid;
        audio.click();
        renderBag();
      });
      btn.addEventListener('pointerenter', () => audio.hover());
      list.appendChild(btn);
    }
    const slots = occupiedSlots(state.run);
    $('loadout-slots').textContent = Object.entries(state.run.slots)
      .map(([r, n]) => `${r} ${slots[r] || 0}/${n}`)
      .join('  ·  ');
  }

  function paintSupply() {
    const enc = state.encounter;
    const items = placements.filter((p) => p.uid !== 'king');
    const check = validateLoadout(state.run, enc, items.map((p) => p.uid));
    const budget = check.budget;
    const cost = check.cost;
    $('supply-text').textContent = `${cost} / ${budget}`;
    $('supply-fill').style.width = `${budget ? Math.min(100, (cost / budget) * 100) : 0}%`;
    $('supply-fill').classList.toggle('over', cost > budget);
    $('btn-loadout-fight').disabled = !check.ok;
  }

  function canDeployPick(sq) {
    return placements.some((p) => p.sq === sq && p.uid !== 'king');
  }

  function deployTargets(sq) {
    const enc = state.encounter;
    const homes = homeSquares(enc.files, enc.ranks);
    const taken = new Set(placements.map((p) => p.sq));
    return homes.filter((h) => !taken.has(h) || h === sq).map((to) => ({ to, captured: null }));
  }

  function onDeployDrop(from, to) {
    const piece = placements.find((p) => p.sq === from);
    if (!piece || piece.uid === 'king') return;
    const enc = state.encounter;
    const homes = homeSquares(enc.files, enc.ranks);
    if (!homes.includes(to)) {
      audio.illegal();
      deployView.reject(to);
      return;
    }
    if (placements.some((p) => p.sq === to)) {
      audio.illegal();
      deployView.reject(to);
      return;
    }
    piece.sq = to;
    audio.place();
    rebuildDeploy();
    paintSupply();
  }

  function placeSelected(sq) {
    if (!selectedUid) return false;
    const enc = state.encounter;
    const homes = homeSquares(enc.files, enc.ranks);
    if (!homes.includes(sq) || placements.some((p) => p.sq === sq)) return false;
    const item = state.run.bag.find((p) => p.uid === selectedUid);
    if (!item) return false;
    const next = [...placements, { uid: item.uid, type: item.type, sq }];
    const check = validateLoadout(state.run, enc, next.filter((p) => p.uid !== 'king').map((p) => p.uid));
    if (!check.ok) {
      audio.illegal();
      toast(check.reason || 'Over supply', 'danger');
      return false;
    }
    placements = next;
    selectedUid = null;
    audio.place();
    rebuildDeploy();
    renderBag();
    paintSupply();
    return true;
  }

  function onDeployClick(event) {
    if (event.target.closest('.piece')) return;
    const sq = deployView.squareFromEvent(event);
    if (sq == null) return;
    if (selectedUid) {
      if (!placeSelected(sq)) {
        audio.illegal();
        deployView.reject(sq);
      }
      return;
    }
    const placed = placements.find((p) => p.sq === sq && p.uid !== 'king');
    if (placed) {
      placements = placements.filter((p) => p.uid !== placed.uid);
      audio.lift();
      rebuildDeploy();
      renderBag();
      paintSupply();
    }
  }

  function beginFight() {
    const enc = state.encounter;
    const items = placements.filter((p) => p.uid !== 'king');
    const check = validateLoadout(state.run, enc, items.map((p) => p.uid));
    if (!check.ok) {
      toast(check.reason || 'Check your supply', 'danger');
      return;
    }
    const game = buildFight(state.run, enc, placements);
    state.game = game;
    state.gameOver = false;
    state.thinking = false;
    state.generation++;
    state.armyMax = game.armyValue(WHITE);
    state.view.setFlipped(false);
    state.view.syncFromGame(game);
    state.view.markLastMove(null, null);
    state.view.markCheck(null);
    state.view.setInteractive(true);
    $('run-hud').classList.remove('hidden');
    $('btn-undo').classList.add('hidden');
    $('btn-new').classList.add('hidden');
    $('btn-forfeit').classList.remove('hidden');
    $('opponent-name').textContent = enc.name;
    $('opponent-side').textContent = `${enc.files}×${enc.ranks} · supply ${supplyBudget(state.run, enc)}`;
    $('player-side').textContent = 'plays White';
    renderCoordinates();
    updateHud();
    paintRunHud();
    refreshStatus();
    showScreen('screen-game');
  }

  function onFightOver() {
    const run = state.run;
    const enc = state.encounter;
    const reward = settleFight(run, state.game, enc);
    state.gameOver = true;
    state.view.setInteractive(false);
    paintRunHud();
    updateHud();

    const youWon = reward.won;
    let title = youWon ? 'THE KING FALLS' : 'YOUR KING FALLS';
    let detail;
    if (youWon) {
      detail = `Army remaining ${reward.army}. +${reward.gold} gold`
        + (reward.tithe ? ` (including ${reward.tithe} tithe)` : '') + '.';
      if (enc.boss && run.won) {
        title = 'THE THRONE IS YOURS';
        detail += ' The run is won.';
      }
    } else if (run.over) {
      title = 'THE RUN IS OVER';
      detail = 'No hearts left. Your bag goes home with you — next time.';
    } else {
      detail = `A heart gone. ${run.hearts} left. Your pieces return to the bag.`;
    }

    setStatus(title, youWon ? 'good' : 'danger');
    $('btn-again').classList.toggle('hidden', !(run.over && run.won));
    $('btn-again').textContent = 'Embark again';
    $('btn-continue').classList.toggle('hidden', !youWon || run.over);
    $('btn-retry').classList.toggle('hidden', youWon || !retryAllowed(run));
    $('btn-result-menu').textContent = run.over ? 'Menu' : 'Abandon';

    setTimeout(() => {
      if (youWon) { audio.victory(); confetti(); }
      else audio.defeat();
      $('result-title').textContent = title;
      $('result-detail').textContent = detail;
      $('modal-result').classList.remove('hidden');
    }, 650);
    return true;
  }

  function continueAfterFight() {
    $('modal-result').classList.add('hidden');
    resetClassicButtons();
    if (state.run.over) { endRun(); return; }
    advance(state.run);
    const next = currentNode(state.run);
    if (!next) { endRun(); return; }
    if (next.kind === 'shop') openShopScreen();
    else showMap();
  }

  function retryFight() {
    $('modal-result').classList.add('hidden');
    openLoadout(state.encounter);
  }

  function forfeitFight() {
    if (state.mode !== 'run' || state.gameOver) return;
    const wk = state.game.kings.w;
    if (wk >= 0) {
      state.game.board[wk] = null;
      state.game.kings.w = -1;
    }
    onFightOver();
  }

  function openShopScreen() {
    const node = currentNode(state.run);
    openShop(state.run);
    $('shop-name').textContent = node.name;
    $('shop-blurb').textContent = node.blurb;
    paintShop();
    showScreen('screen-shop');
  }

  function paintShop() {
    const shop = state.run.shop;
    paintRunHud();
    $('btn-shop-reroll').textContent = `Reroll (${shop.rerollCost}g)`;
    const root = $('shop-offers');
    root.innerHTML = '';
    for (const offer of shop.offers) {
      const card = document.createElement('button');
      card.className = 'shop-card rarity-' + (offer.rarity || offer.kind);
      card.disabled = state.run.gold < offer.cost;
      const art = offer.type
        ? `<i class="shop-art" style="background-image:url('${pieceImage(offer.type, WHITE)}');${pieceHue(offer.type) ? `filter:hue-rotate(${pieceHue(offer.type)}deg)` : ''}"></i>`
        : `<i class="shop-art shop-art-icon">${offer.kind === 'supply' ? '+' : offer.kind === 'slot' ? '▣' : '♔'}</i>`;
      card.innerHTML = art
        + `<span class="shop-card-name">${offer.name}</span>`
        + `<span class="shop-card-blurb">${offer.blurb}</span>`
        + `<span class="shop-card-cost">${offer.cost}g</span>`;
      card.addEventListener('click', () => {
        const result = buyOffer(state.run, offer.id);
        if (!result.ok) { audio.illegal(); toast(result.reason, 'danger'); return; }
        audio.capture();
        toast(offer.name, 'good');
        paintShop();
      });
      card.addEventListener('pointerenter', () => audio.hover());
      root.appendChild(card);
    }
  }

  function leaveShop() {
    closeShop(state.run);
    advance(state.run);
    showMap();
  }

  function endRun() {
    resetClassicButtons();
    const run = state.run;
    $('modal-result').classList.add('hidden');
    if (run?.won) {
      $('result-title').textContent = 'THE THRONE IS YOURS';
      $('result-detail').textContent = `Gold in pocket ${run.gold}. The bag goes with you into the next telling.`;
      $('btn-again').classList.remove('hidden');
      $('btn-again').textContent = 'Embark again';
      $('btn-continue').classList.add('hidden');
      $('btn-retry').classList.add('hidden');
      $('btn-result-menu').textContent = 'Menu';
      $('modal-result').classList.remove('hidden');
      audio.victory();
      confetti();
    } else {
      showScreen('screen-start');
    }
    state.mode = 'classic';
  }

  function resetClassicButtons() {
    $('run-hud').classList.add('hidden');
    $('btn-undo').classList.remove('hidden');
    $('btn-new').classList.remove('hidden');
    $('btn-forfeit').classList.add('hidden');
    $('btn-again').classList.remove('hidden');
    $('btn-again').textContent = 'Play Again';
    $('btn-continue').classList.add('hidden');
    $('btn-retry').classList.add('hidden');
    $('btn-result-menu').textContent = 'Menu';
  }

  function abandon() {
    $('modal-result').classList.add('hidden');
    resetClassicButtons();
    state.mode = 'classic';
    state.generation++;
    showScreen('screen-start');
  }

  // ---- bind --------------------------------------------------------------

  $('btn-embark').addEventListener('click', async () => {
    await audio.resume();
    if (state.settings.music) audio.startMusic();
    startRun();
  });
  $('btn-map-go').addEventListener('click', goFromMap);
  $('btn-map-quit').addEventListener('click', abandon);
  $('btn-loadout-back').addEventListener('click', showMap);
  $('btn-loadout-auto').addEventListener('click', () => {
    const enc = state.encounter;
    const remaining = state.run.bag.filter((p) => !placements.some((x) => x.uid === p.uid));
    const pick = [];
    let cost = 0;
    const budget = supplyBudget(state.run, enc);
    for (const item of remaining) {
      const c = pieceCost(item.type);
      if (cost + c > budget) continue;
      pick.push(item);
      cost += c;
    }
    placements = autoPlace(enc, pick);
    selectedUid = null;
    audio.place();
    rebuildDeploy();
    renderBag();
    paintSupply();
  });
  $('btn-loadout-clear').addEventListener('click', () => {
    const king = placements.find((p) => p.uid === 'king');
    placements = king ? [king] : [];
    selectedUid = null;
    rebuildDeploy();
    renderBag();
    paintSupply();
  });
  $('btn-loadout-fight').addEventListener('click', beginFight);
  $('deploy-board').addEventListener('click', onDeployClick);
  $('btn-shop-leave').addEventListener('click', leaveShop);
  $('btn-shop-reroll').addEventListener('click', () => {
    const result = rerollShop(state.run);
    if (!result.ok) { audio.illegal(); toast(result.reason, 'danger'); return; }
    audio.click();
    paintShop();
  });
  $('btn-continue').addEventListener('click', continueAfterFight);
  $('btn-retry').addEventListener('click', retryFight);
  $('btn-forfeit').addEventListener('click', forfeitFight);

  return {
    startRun,
    onFightOver,
    paintRunHud,
    resetClassicButtons,
    abandon,
    isRun() { return state.mode === 'run'; },
  };
}
