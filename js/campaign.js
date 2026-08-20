// Run screens reached from the overworld: loadout, shop, rest, events, and
// the fight overlay on the shared board. The overworld itself lives in
// overworld.js (logic) and voyage.js (the walkable screen). The Old Road —
// the original StS-style node map — lives here directly: it's small enough
// (draw the road, enter whichever node is clicked) not to need its own file.

import { WHITE, BLACK, FLAG, parseSquare, squareName, TILE } from './chess.js';
import { pieceById, pieceCost, rarityOf } from './pieces.js';
import { BoardView, pieceImage, pieceHue, kingSkin, kingHue, shake, confetti, toast,
  gameText, setGameText, setTitleText, tip } from './ui.js';
import {
  createRun, currentNode, pickNode, completeNode,
  validateLoadout, buildFight, settleFight,
  openShop, buyOffer, rerollShop, closeShop, retryAllowed,
  autoPlace, supplyBudget, deployBudget, occupiedSlots, freeHomeSquares,
  rest, forage, trainPiece,
  REST_GOLD, REST_HEAL, FORAGE_GOLD, TRAIN_COST, turnClock,
  restHeal, forageGold, trainCost,
  bagSummary, equipKing, applyChoice, choiceAvailable, claimRelic, skipRelics,
  suggestLoadout, runStats, ensureFormation, placementsFromFormation, CREW_BOARD,
  pruneFormation, payUndo, UNDO_HP,
} from './run.js';
import { kingDef, EVENTS, encounterFor } from './content.js';
import { relicById } from './relics.js';

export function initCampaign(ctx) {
  const {
    state, $, showScreen, audio, requestMove, setStatus, refreshStatus,
    updateHud, renderCoordinates, resetInspect, scheduleOpponent,
  } = ctx;

  function goWorld() {
    if (setupMode) { closeCrewSetup(); return; }
    if (state.world === 'voyage') {
      state.voyage?.resumeFromWorld();
      return;
    }
    showMap();
  }

  let deployView = null;
  let crewPreview = null;
  let selectedUid = null;
  let placements = []; // { uid, type, sq }
  let shopSelectedId = null;
  let setupMode = false;

  /**
   * Gold and HP used to be a bare number in the pixel font, same weight as
   * every other chip on the bar — easy to miss, easy to misread, and the
   * event screen's gold chip was not even in the update list, so it sat on
   * "0g" the whole time. Now both get an icon, HP gets a fill bar that drains
   * toward red, and either flashes green/red on the frame it actually changes
   * so a heal or a hit registers without having to read the digits.
   */
  function flashChip(el, positive) {
    el.classList.remove('flash-pos', 'flash-neg');
    void el.offsetWidth; // restart the animation even on back-to-back changes
    el.classList.add(positive ? 'flash-pos' : 'flash-neg');
  }

  function paintRunHud() {
    paintRelics();
    const run = state.run;
    if (!run) return;
    const prev = state._hudPrev || { gold: run.gold, hp: run.hp };
    const goldChanged = run.gold !== prev.gold;
    const hpChanged = run.hp !== prev.hp;

    for (const id of ['hud-gold', 'map-gold', 'load-gold', 'shop-gold', 'rest-gold', 'event-gold', 'ow-gold']) {
      const el = $(id);
      if (!el) continue;
      const num = el.querySelector('.chip-num');
      if (num) num.textContent = `${run.gold}g`; else el.textContent = `${run.gold}g`;
      if (goldChanged) flashChip(el, run.gold > prev.gold);
    }

    for (const id of ['hud-hp', 'map-hp', 'load-hp', 'shop-hp', 'rest-hp', 'event-hp', 'ow-hp']) {
      const el = $(id);
      if (!el) continue;
      const pct = run.hpMax > 0 ? Math.max(0, Math.min(1, run.hp / run.hpMax)) : 0;
      el.style.setProperty('--hp-pct', `${Math.round(pct * 100)}%`);
      const num = el.querySelector('.chip-num');
      if (num) num.textContent = `${run.hp}/${run.hpMax}`; else el.textContent = `${run.hp}/${run.hpMax}`;
      el.classList.toggle('low', pct <= 0.34);
      if (hpChanged) flashChip(el, run.hp > prev.hp);
    }
    state._hudPrev = { gold: run.gold, hp: run.hp };

    if ($('map-supply')) {
      $('map-supply').textContent = `Supply +${run.supplyBonus}`;
    }
    paintKingChip(run);
    if ($('hud-army') && state.game && state.mode === 'run') {
      const now = state.game.armyValue(WHITE);
      const max = state.armyMax || now;
      $('hud-army').textContent = `Army ${now}/${max}`;
    }
    if ($('hud-clock')) {
      if (state.clock != null) {
        $('hud-clock').textContent = `${state.clock}`;
        $('hud-clock').classList.toggle('low', state.clock <= 3);
        $('hud-clock').classList.remove('hidden');
      } else {
        $('hud-clock').classList.add('hidden');
      }
    }
  }

  // ---- the Old Road: the original StS-style branching node map ----------

  function startRun() {
    state.mode = 'run';
    state.world = 'road';
    state.run = createRun();
    state.playerColor = WHITE;
    state._hudPrev = null;
    showMap();
  }

  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return ((h >>> 0) % 1000) / 1000;
  }

  function nodeIcon(node) {
    const src = node.boss ? 'map-boss'
      : node.kind === 'shop' ? 'map-shop'
      : node.kind === 'rest' ? 'map-rest'
      : node.kind === 'event' ? null
      : node.tier === 'elite' ? 'map-elite'
      : 'map-fight';
    // The ? room has no art of its own; the mark is the icon.
    if (src === null) return '<span class="map-ico map-ico-mark">?</span>';
    return `<img class="map-ico" src="assets/${src}.png" alt="" draggable="false" width="32" height="32">`;
  }

  function showMap() {
    closeBag();
    audio.setMusicStyle('ambient');
    const run = state.run;
    if (run.over) { endRun(); return; }
    const act = run.map.acts[run.act];
    const here = currentNode(run);
    const openIds = new Set(
      (run.choices && run.choices.length)
        ? run.choices.map((n) => n.id)
        : here ? [here.id] : [],
    );
    const cleared = run.cleared || new Set();
    const trail = new Set(run.trail || []);
    paintRunHud();

    const romans = ['I', 'II', 'III'];
    if ($('map-act-label')) $('map-act-label').textContent = `ACT ${romans[run.act] || run.act + 1}`;
    if ($('map-art')) {
      $('map-art').classList.remove('act-0', 'act-1', 'act-2');
      $('map-art').classList.add(`act-${run.act}`);
    }

    showScreen('screen-map');
    paintCrew();

    const climb = $('map-climb');
    climb.innerHTML = '';

    const floors = {};
    let maxCol = 0;
    for (const node of act.nodes) {
      (floors[node.col] ||= []).push(node);
      if (node.col > maxCol) maxCol = node.col;
    }
    const scroll = $('map-scroll');
    const W = Math.max(520, (scroll?.clientWidth || 640) - 8);
    const viewH = Math.max(scroll?.clientHeight || 720, 640);
    const step = Math.max(210, Math.floor((viewH * 1.25) / Math.max(1, maxCol + 1)));
    const H = 160 + (maxCol + 1) * step;
    climb.style.width = `${W}px`;
    climb.style.height = `${H}px`;
    if ($('map-art')) $('map-art').style.height = `${Math.max(H, viewH)}px`;

    const pos = {};
    for (const node of act.nodes) {
      const onFloor = floors[node.col];
      const jx = (hash01(node.id) - 0.5) * 36;
      const jy = (hash01(node.id + 'y') - 0.5) * 18;
      const x = ((node.row + 1) / (onFloor.length + 1)) * W + jx;
      const y = H - 86 - node.col * step + jy;
      pos[node.id] = { x, y };
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'map-ink');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <filter id="map-wobble">
        <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.4"/>
      </filter>`;
    svg.appendChild(defs);

    for (const node of act.nodes) {
      const a = pos[node.id];
      for (const nid of node.next || []) {
        const b = pos[nid];
        if (!b) continue;
        const walked = trail.has(node.id) && trail.has(nid);
        const ahead = openIds.has(nid) && (
          node.id === run.nodeId || cleared.has(node.id) || openIds.has(node.id)
        );
        const mx = (a.x + b.x) / 2 + (hash01(node.id + nid) - 0.5) * 22;
        const my = (a.y + b.y) / 2;
        const d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
        const under = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        under.setAttribute('d', d);
        under.setAttribute('class', 'map-edge-under'
          + (walked ? ' walked' : '')
          + (ahead ? ' ahead' : ''));
        svg.appendChild(under);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', 'map-edge'
          + (walked ? ' walked' : '')
          + (ahead ? ' ahead' : ''));
        svg.appendChild(path);
      }
    }
    climb.appendChild(svg);

    for (const node of act.nodes) {
      const p = pos[node.id];
      const current = node.id === run.nodeId && !(run.choices && run.choices.length);
      const open = openIds.has(node.id);
      const done = cleared.has(node.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'map-dot'
        + (current ? ' current' : '')
        + (open && !current ? ' open' : '')
        + (done ? ' done' : '')
        + (node.kind === 'shop' ? ' shop' : '')
        + (node.kind === 'rest' ? ' rest' : '')
        + (node.kind === 'event' ? ' event' : '')
        + (node.boss ? ' boss' : '')
        + (node.tier === 'elite' ? ' elite' : '');
      btn.style.left = `${p.x}px`;
      btn.style.top = `${p.y}px`;
      btn.setAttribute('aria-label', node.name);
      if (p.y < 90) btn.classList.add('tip-below');
      btn.innerHTML = nodeIcon(node) + `<span class="map-tip"><b>${node.name}</b>${node.blurb}</span>`;
      if (open) {
        btn.addEventListener('click', () => {
          if (node.id !== run.nodeId) pickNode(run, node.id);
          enterNode();
        });
        btn.addEventListener('pointerenter', () => audio.hover());
      }
      climb.appendChild(btn);
    }

    requestAnimationFrame(() => {
      const scroll = $('map-scroll');
      if (!scroll) return;
      const focus = climb.querySelector('.map-dot.current, .map-dot.open');
      if (focus) focus.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      else scroll.scrollTop = scroll.scrollHeight;
    });
  }

  function enterNode() {
    const node = currentNode(state.run);
    if (!node || state.run.over) { endRun(); return; }
    if (node.kind === 'shop') {
      openWorldShop({ name: node.name, blurb: node.blurb });
    } else if (node.kind === 'rest') {
      openWorldRest(node.name);
    } else if (node.kind === 'event') {
      openEvent(node.eventId);
    } else {
      const enc = encounterFor(node);
      if (enc) {
        if (state.world === 'voyage') openLoadout(enc);
        else startMappedFight(enc);
      }
    }
  }

  function startMappedFight(encounter) {
    state.encounter = encounter;
    placements = placementsFromFormation(state.run, encounter);
    const wanted = (state.run.formation || []).filter((p) => p.uid !== 'king').length;
    const brought = placements.filter((p) => p.uid !== 'king').length;
    if (brought < wanted) {
      toast('Some of the line would not fit this field.', 'danger');
    }
    beginFight();
  }

  function crewPlacements() {
    return ensureFormation(state.run);
  }

  function paintCrew() {
    if (!state.run) return;
    ensureFormation(state.run);
    paintCrewRoster();
    paintCrewPreview();
  }

  function paintCrewPreview() {
    const root = $('crew-preview');
    if (!root) return;
    if (!crewPreview) {
      crewPreview = new BoardView(root, {
        onAttemptMove: () => {},
        canPickUp: () => false,
        legalTargets: () => [],
      });
    }
    const game = buildFight(state.run, CREW_BOARD, crewPlacements());
    crewPreview.setWhiteKingSkin(kingSkin(state.run.king), kingHue(state.run.king));
    crewPreview.setFlipped(false);
    crewPreview.syncFromGame(game);
    crewPreview.setInteractive(false);
  }

  function openCrewSetup() {
    if (!state.run) return;
    setupMode = true;
    state.encounter = CREW_BOARD;
    selectedUid = null;
    placements = ensureFormation(state.run).map((p) => ({ ...p }));
    if ($('loadout-title')) $('loadout-title').textContent = 'Starting position';
    if ($('loadout-blurb')) {
      $('loadout-blurb').textContent = 'Place your army on the two home ranks and pick a king. Fights use this line.';
    }
    if ($('enemy-roster')) $('enemy-roster').textContent = '';
    if ($('btn-loadout-fight')) {
      $('btn-loadout-fight').textContent = 'Done';
      $('btn-loadout-fight').disabled = false;
    }
    $('screen-loadout')?.classList.add('setup-line');
    showScreen('screen-loadout');
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
    paintMoveDiagram(null);
    paintRunHud();
    audio.click();
  }

  function closeCrewSetup() {
    if (setupMode && state.run) {
      state.run.formation = placements.map((p) => ({ uid: p.uid, type: p.type, sq: p.sq }));
      pruneFormation(state.run);
      toast('Starting position set', 'good');
    }
    setupMode = false;
    $('screen-loadout')?.classList.remove('setup-line');
    if ($('btn-loadout-fight')) {
      $('btn-loadout-fight').textContent = 'Fight';
      $('btn-loadout-fight').disabled = false;
    }
    showMap();
  }

  function paintCrewRoster() {
    const kingsHost = $('crew-kings');
    const piecesHost = $('crew-pieces');
    if (!kingsHost || !piecesHost) return;
    const summary = bagSummary(state.run);
    kingsHost.innerHTML = '';
    for (const id of summary.kings) {
      const def = kingDef(id);
      const on = summary.equipped === id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bag-tile king-tile' + (on ? ' on' : ' idle');
      const kingFilter = kingHue(id) ? ` filter:hue-rotate(${kingHue(id)}deg);` : '';
      btn.innerHTML =
        `<i style="background-image:url('${pieceImage('k', WHITE, kingSkin(id))}');${kingFilter}"></i>`
        + `<span class="bag-tile-name">${def.name}</span>`;
      btn.title = def.blurb;
      btn.addEventListener('click', () => {
        if (!equipKing(state.run, id)) { audio.illegal(); return; }
        audio.click();
        paintRunHud();
        paintCrew();
        toast(`${def.name} king is active`, 'good');
      });
      btn.addEventListener('pointerenter', () => audio.hover());
      kingsHost.appendChild(btn);
    }

    piecesHost.innerHTML = '';
    const used = new Set(crewPlacements().map((p) => p.uid));
    const groups = new Map();
    for (const item of state.run.bag) {
      const key = `${item.type}|${item.trained ? 1 : 0}`;
      const g = groups.get(key) || { type: item.type, trained: Boolean(item.trained), items: [] };
      g.items.push(item);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const def = pieceById(g.type);
      const freeItems = g.items.filter((it) => !used.has(it.uid));
      const allPlaced = freeItems.length === 0;
      const activeItem = allPlaced ? g.items.find((it) => used.has(it.uid)) : freeItems[0];
      const btn = document.createElement('button');
      btn.className = `bag-tile rarity-${def.rarity}`
        + (allPlaced ? ' used' : '');
      const hue = pieceHue(g.type);
      const countBadge = g.items.length > 1
        ? `${freeItems.length}/${g.items.length}`
        : '';
      btn.innerHTML =
        `<i style="background-image:url('${pieceImage(g.type, WHITE)}');${hue ? `filter:hue-rotate(${hue}deg)` : ''}"></i>`
        + (countBadge ? `<span class="bag-tile-count">${countBadge}</span>` : '')
        + (g.trained ? '<span class="bag-trained">⛨</span>' : '')
        + `<span class="bag-tile-name">${def.name}</span>`;
      btn.addEventListener('click', () => {
        audio.click();
        openCrewSetup();
      });
      btn.addEventListener('pointerenter', () => audio.hover());
      piecesHost.appendChild(btn);
    }
  }

  /**
   * Built per visit, not once at module load, so the numbers on the card
   * always match what rest() / forage() / trainPiece() actually pay.
   */
  const restChoices = (run) => [
    { id: 'rest', label: 'Rest',
      detail: `Heal ${restHeal(run)} HP, pocket ${REST_GOLD} gold.` },
    { id: 'forage', label: 'Forage',
      detail: `Skip the healing — take ${forageGold(run)} gold instead.` },
    { id: 'train', label: 'Train',
      detail: `Spend ${trainCost(run)} gold to permanently shield one piece, every fight from now on.` },
  ];


  let restDoneCb = null;

  function openWorldRest(name, onDone) {
    restDoneCb = onDone || null;
    paintRunHud();
    $('rest-name').textContent = name || 'A Quiet Square';
    $('rest-detail').textContent = 'Choose how to spend the moment.';
    $('rest-outcome').classList.add('hidden');
    $('btn-rest-move-on').classList.add('hidden');
    $('rest-choices').classList.remove('hidden');
    paintRestChoices();
    showScreen('screen-rest');
  }

  function trainGate() {
    const cost = trainCost(state.run);
    if (state.run.gold < cost) return { ok: false, reason: `Needs ${cost}g` };
    if (!state.run.bag.some((p) => p.type !== 'k' && !p.trained)) {
      return { ok: false, reason: 'Nothing left to train' };
    }
    return { ok: true };
  }

  function paintRestChoices() {
    const host = $('rest-choices');
    host.innerHTML = '';
    for (const choice of restChoices(state.run)) {
      const gate = choice.id === 'train' ? trainGate() : { ok: true };
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'event-choice';
      btn.disabled = !gate.ok;
      btn.innerHTML = `<span class="ec-label">${choice.label}</span>`
        + `<span class="ec-detail">${gameText(choice.detail)}</span>`
        + (gate.ok ? '' : `<span class="ec-block">${gate.reason}</span>`);
      btn.addEventListener('click', () => takeRestChoice(choice.id));
      btn.addEventListener('pointerenter', () => audio.hover());
      host.appendChild(btn);
    }
  }

  function takeRestChoice(id) {
    if (id === 'train') { askWhichPieceToTrain(); return; }
    audio.click();
    if (id === 'forage') {
      const result = forage(state.run);
      finishRest([`+${result.gold} gold`]);
    } else {
      const result = rest(state.run);
      finishRest([`+${result.healed} HP`, `+${result.gold} gold`]);
    }
  }

  function askWhichPieceToTrain() {
    const host = $('rest-choices');
    host.innerHTML = '<div class="ec-detail" style="padding:0 0 .4rem">Which piece learns to hold?</div>';
    for (const item of state.run.bag.filter((p) => p.type !== 'k' && !p.trained)) {
      const def = pieceById(item.type);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'event-choice';
      btn.innerHTML = `<span class="ec-label">${def.name}</span>`
        + `<span class="ec-detail">${gameText(`${def.cost} supply · ${def.rarity}`)}</span>`;
      btn.addEventListener('click', () => {
        const result = trainPiece(state.run, item.uid);
        if (!result.ok) { audio.illegal(); toast(result.reason, 'danger'); return; }
        // Train is the one camp choice that compounds for the rest of the
        // run — worth a bigger payoff than a click, same as claiming a relic.
        audio.victory();
        confetti(28);
        finishRest([`${def.name} is shielded, every fight from now on`]);
      });
      btn.addEventListener('pointerenter', () => audio.hover());
      host.appendChild(btn);
    }
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'event-choice';
    back.innerHTML = '<span class="ec-label">Actually, no</span>';
    back.addEventListener('click', () => paintRestChoices());
    host.appendChild(back);
  }

  function finishRest(lines) {
    $('rest-choices').classList.add('hidden');
    $('rest-outcome').innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
    $('rest-outcome').classList.remove('hidden');
    $('btn-rest-move-on').classList.remove('hidden');
    paintRunHud();
    if (restDoneCb) { restDoneCb(); restDoneCb = null; }
  }

  function openLoadout(encounter) {
    setupMode = false;
    $('screen-loadout')?.classList.remove('setup-line');
    if ($('btn-loadout-fight')) $('btn-loadout-fight').textContent = 'Fight';
    state.encounter = encounter;
    selectedUid = null;
    const homes = freeHomeSquares(encounter);
    const kingSq = homes[Math.floor((homes.length - 1) / 2)] ?? homes[0];
    placements = kingSq != null ? [{ uid: 'king', type: 'k', sq: kingSq }] : [];

    if (state.world === 'voyage') {
      const auto = autoPlace(encounter, suggestLoadout(state.run, encounter));
      if (auto.length) placements = auto;
    }
    $('loadout-title').textContent = encounter.name;
    $('loadout-blurb').textContent =
      `${encounter.blurb}  ·  ${encounter.files}×${encounter.ranks}  ·  take their king`;
    renderEnemy(encounter);

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
    paintMoveDiagram(null);
    paintRunHud();
    showScreen('screen-loadout');
    tip('loadout', 'Click pieces in your bag to place them, then fight.');
  }

  function rebuildDeploy() {
    const enc = state.encounter;
    const { Chess } = ctx;
    const game = buildFight(state.run, enc, placements);
    deployView.setWhiteKingSkin(kingSkin(state.run.king), kingHue(state.run.king));
    deployView.setFlipped(false);
    deployView.syncFromGame(game);
    deployView.setInteractive(true);
    paintHomes(enc);
    paintDeployCoords(enc);
  }

  function paintKingChip(run) {
    const def = kingDef(run.king);
    const skin = kingSkin(run.king);
    const hue = kingHue(run.king);
    for (const prefix of ['load', 'shop', 'rest', 'ow', 'map']) {
      const art = $(`${prefix}-king-art`);
      const name = $(`${prefix}-king-name`);
      const chip = $(`${prefix}-king`);
      if (art) {
        art.style.backgroundImage = `url('${pieceImage('k', WHITE, skin)}')`;
        art.style.filter = hue ? `hue-rotate(${hue}deg)` : '';
      }
      if (name) name.textContent = `${def.name} King`;
      if (chip) chip.title = def.blurb;
    }
  }

  function paintHomes(enc) {
    const free = new Set(freeHomeSquares(enc));
    const taken = new Set(placements.map((p) => p.sq));
    const enemy = new Set((enc.enemy || []).map((p) => parseSquare(p.at, enc.ranks)));
    const blocked = new Set();
    if (enc.terrain) {
      for (const [name, tile] of Object.entries(enc.terrain)) {
        if (tile === TILE.BLOCK) blocked.add(parseSquare(name, enc.ranks));
      }
    }
    for (const [sq, el] of deployView.squares) {
      const can = free.has(sq) && !taken.has(sq);
      el.classList.toggle('home-free', can);
      el.classList.toggle('home', free.has(sq) && taken.has(sq));
      el.classList.toggle('no-place', !free.has(sq) && !taken.has(sq));
      el.classList.toggle('place-enemy', enemy.has(sq));
      el.classList.toggle('place-block', blocked.has(sq));
    }
  }

  function paintDeployCoords(enc) {
    const files = Array.from({ length: enc.files }, (_, i) => String.fromCharCode(97 + i));
    const ranks = Array.from({ length: enc.ranks }, (_, i) => String(enc.ranks - i));
    $('coords-files-deploy').innerHTML = files.map((f) => `<span>${f}</span>`).join('');
    $('coords-ranks-deploy').innerHTML = ranks.map((r) => `<span>${r}</span>`).join('');
  }

  function remainingSupply() {
    const enc = state.encounter;
    const spent = placements.filter((p) => p.uid !== 'king')
      .reduce((sum, p) => sum + pieceCost(p.type), 0);
    return supplyBudget(state.run, enc) - spent;
  }

  function renderEnemy(encounter) {
    let host = $('enemy-roster');
    if (!host) return;
    const bits = (encounter.enemy || []).map((p) => {
      const def = pieceById(p.type);
      return def ? def.name : p.type;
    });
    host.textContent = bits.length ? `They bring ${bits.join(', ')}.` : '';
  }

  /**
   * Duplicate pieces (three pawns, say) used to each get their own full-width
   * row, so a modest bag meant a lot of scrolling to look at identical text
   * three times over. Group same type+trained copies into one tile — a
   * count badge stands in for the repetition, and the tile still tracks
   * which specific copy it's acting on underneath, so placing and picking
   * back up work exactly as before.
   */
  function renderBag() {
    const list = $('bag-list');
    list.innerHTML = '';
    const used = new Set(placements.map((p) => p.uid));
    const left = remainingSupply();
    const groups = new Map();
    for (const item of state.run.bag) {
      const key = `${item.type}|${item.trained ? 1 : 0}`;
      const g = groups.get(key) || { type: item.type, trained: Boolean(item.trained), items: [] };
      g.items.push(item);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const def = pieceById(g.type);
      const freeItems = g.items.filter((it) => !used.has(it.uid));
      const placedCount = g.items.length - freeItems.length;
      const allPlaced = freeItems.length === 0;
      const tooDear = !allPlaced && def.cost > left;
      // Bodies are capped as well as points, so a horde runs out of room
      // before it runs out of supply.
      const atDeployCap = !allPlaced
        && placements.filter((p) => p.uid !== 'king').length >= deployBudget(state.run, state.encounter);
      const activeItem = allPlaced ? g.items.find((it) => used.has(it.uid)) : freeItems[0];
      const btn = document.createElement('button');
      btn.className = `bag-tile rarity-${def.rarity}`
        + (allPlaced ? ' used' : '')
        + (tooDear || atDeployCap ? ' dear' : '')
        + (g.items.some((it) => it.uid === selectedUid) ? ' on' : '');
      btn.title = `${def.name} — ${def.blurb || ''}`.trim();
      const hue = pieceHue(g.type);
      const countBadge = g.items.length > 1
        ? (placedCount > 0 ? `${freeItems.length}/${g.items.length}` : `×${g.items.length}`)
        : '';
      btn.innerHTML =
        `<i style="background-image:url('${pieceImage(g.type, WHITE)}');${hue ? `filter:hue-rotate(${hue}deg)` : ''}"></i>`
        + (countBadge ? `<span class="bag-tile-count">${countBadge}</span>` : '')
        + (g.trained ? '<span class="bag-trained" title="Trained: shielded every fight">⛨</span>' : '')
        + `<span class="bag-tile-cost">${def.cost}</span>`
        + `<span class="bag-tile-name">${def.name}</span>`
        + `<span class="bag-tile-meta">${def.cost}${allPlaced ? ' · on board' : ''}</span>`;
      btn.addEventListener('click', () => {
        if (allPlaced) {
          placements = placements.filter((p) => p.uid !== activeItem.uid);
          selectedUid = activeItem.uid;
          audio.lift();
          rebuildDeploy();
          renderBag();
          paintSupply();
          paintMoveDiagram(activeItem.type);
          return;
        }
        if (tooDear) {
          audio.illegal();
          toast(`Needs ${def.cost} supply`, 'danger');
          return;
        }
        if (atDeployCap) {
          audio.illegal();
          toast(`No room — ${deployBudget(state.run, state.encounter)} pieces max`, 'danger');
          return;
        }
        selectedUid = selectedUid === activeItem.uid ? null : activeItem.uid;
        audio.click();
        renderBag();
        paintMoveDiagram(selectedUid ? activeItem.type : null);
      });
      btn.addEventListener('pointerenter', () => audio.hover());
      list.appendChild(btn);
    }
    const slots = occupiedSlots(state.run);
    $('loadout-slots').textContent = Object.entries(state.run.slots)
      .filter(([r]) => r !== 'common')
      .map(([r, n]) => `${r} ${slots[r] || 0}/${n === Infinity ? '∞' : n}`)
      .join('  ·  ') + '  ·  commons uncapped';
    renderSelected();
    paintLoadoutKings();
  }

  function paintLoadoutKings() {
    const host = $('loadout-kings');
    if (!host || !state.run) return;
    host.innerHTML = '';
    const summary = bagSummary(state.run);
    for (const id of summary.kings) {
      const def = kingDef(id);
      const on = summary.equipped === id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bag-tile king-tile' + (on ? ' on' : ' idle');
      const kingFilter = kingHue(id) ? ` filter:hue-rotate(${kingHue(id)}deg);` : '';
      btn.innerHTML =
        `<i style="background-image:url('${pieceImage('k', WHITE, kingSkin(id))}');${kingFilter}"></i>`
        + `<span class="bag-tile-name">${def.name}</span>`;
      btn.title = def.blurb;
      btn.addEventListener('click', () => {
        if (!equipKing(state.run, id)) { audio.illegal(); return; }
        audio.click();
        paintRunHud();
        rebuildDeploy();
        paintLoadoutKings();
        toast(`${def.name} king is active`, 'good');
      });
      btn.addEventListener('pointerenter', () => audio.hover());
      host.appendChild(btn);
    }
  }

  function paintMoveDiagram(type, ids = {
    box: 'move-diagram', board: 'md-board', name: 'md-name',
    blurb: 'md-blurb', cost: 'md-cost', art: 'md-art',
    emptyBlurb: 'Click a piece in the bag.',
  }) {
    const box = $(ids.box);
    const host = $(ids.board);
    if (!box || !host) return;
    const Chess = ctx.Chess;
    if (!type || !Chess) {
      box.classList.add('empty');
      if ($(ids.name)) $(ids.name).textContent = 'How it moves';
      if ($(ids.blurb)) $(ids.blurb).textContent = ids.emptyBlurb || '';
      if ($(ids.cost)) $(ids.cost).textContent = '';
      if ($(ids.art)) $(ids.art).style.backgroundImage = '';
      host.innerHTML = '';
      return;
    }
    box.classList.remove('empty');
    const def = pieceById(type);
    const artUrl = pieceImage(type, WHITE, ids.skin || null);
    const artHue = ids.hue || pieceHue(type);
    const files = 7;
    const ranks = 7;
    const g = new Chess({
      files, ranks,
      rules: { checks: false, kingCapture: true, castling: false },
    });
    const mid = 3 * 16 + 3;
    g.board[mid] = { type, color: WHITE };
    if (type === 'k') g.kings.w = mid;
    if (def?.pawn) {
      for (const off of [-17, -15]) {
        const sq = mid + off;
        if (g.inBounds(sq)) g.board[sq] = { type: 'p', color: 'b' };
      }
    }
    // A hopper needs something to hop, or its diagram comes out blank.
    if (def?.hopper) g.board[mid - 16] = { type: 'p', color: 'b' };
    g.turn = WHITE;
    g.refreshMode();
    const dest = new Map();
    for (const m of g.moves({ square: mid, legal: false })) {
      dest.set(m.to, Boolean(m.captured));
    }
    // A shot only generates when something is standing there to be shot, so
    // on an empty diagram board a Crossbow would look like a plain Ferz —
    // its whole point invisible. Draw the firing squares from the definition.
    if (def?.shootOff) {
      for (const off of def.shootOff) {
        const sq = mid + off;
        if (g.inBounds(sq) && sq !== mid) dest.set(sq, true);
      }
    }

    if ($(ids.name)) $(ids.name).textContent = def?.name || '';
    if ($(ids.blurb)) $(ids.blurb).textContent = def?.blurb || '';
    if ($(ids.cost)) setGameText($(ids.cost), `${def?.cost ?? 0} supply · ${def?.rarity || ''}`);
    if ($(ids.art)) {
      $(ids.art).style.backgroundImage = `url('${artUrl}')`;
      $(ids.art).style.filter = artHue ? `hue-rotate(${artHue}deg)` : '';
    }

    host.innerHTML = '';
    for (let r = 0; r < ranks; r++) {
      for (let f = 0; f < files; f++) {
        const sq = r * 16 + f;
        const cell = document.createElement('i');
        cell.className = 'md-sq' + ((r + f) % 2 ? ' dark' : ' light');
        if (sq === mid) {
          const fig = document.createElement('b');
          fig.style.backgroundImage = `url('${artUrl}')`;
          if (artHue) fig.style.filter = `hue-rotate(${artHue}deg)`;
          cell.appendChild(fig);
        } else if (dest.has(sq)) {
          cell.classList.add(dest.get(sq) ? 'cap' : 'go');
        }
        host.appendChild(cell);
      }
    }
  }

  const BAG_DIAGRAM = {
    box: 'bag-diagram', board: 'bag-md-board', name: 'bag-md-name',
    blurb: 'bag-md-blurb', cost: 'bag-md-cost', art: 'bag-md-art',
    emptyBlurb: 'Click a piece or a king.',
  };

  const SHOP_DIAGRAM = {
    box: 'shop-diagram', board: 'shop-md-board', name: 'shop-md-name',
    blurb: 'shop-md-blurb', cost: 'shop-md-cost', art: 'shop-md-art',
    emptyBlurb: 'Click a piece on the table.',
  };

  function markBagPeek(btn) {
    for (const host of [$('bag-kings'), $('bag-counts')]) {
      if (!host) continue;
      for (const tile of host.querySelectorAll('.bag-tile')) tile.classList.remove('peek');
    }
    btn?.classList.add('peek');
  }

  function paintBagPanel() {
    const run = state.run;
    if (!run) return;
    const summary = bagSummary(run);
    const slots = summary.slots;
    if ($('bag-panel-slots')) {
      $('bag-panel-slots').textContent = Object.entries(run.slots)
        .filter(([r]) => r !== 'common')
        .map(([r, n]) => `${r} ${slots[r] || 0}/${n === Infinity ? '∞' : n}`)
        .join('  ·  ') + `  ·  commons uncapped  ·  supply +${summary.supply}`;
    }

    const kings = $('bag-kings');
    if (kings) {
      kings.innerHTML = '';
      for (const id of summary.kings) {
        const def = kingDef(id);
        const btn = document.createElement('button');
        const on = summary.equipped === id;
        btn.type = 'button';
        btn.className = 'bag-tile king-tile' + (on ? ' on' : ' idle');
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        const kingFilter = kingHue(id) ? ` filter:hue-rotate(${kingHue(id)}deg);` : '';
        btn.innerHTML =
          `<i style="background-image:url('${pieceImage('k', WHITE, kingSkin(id))}');${kingFilter}"></i>`
          + (on ? '<span class="bag-tile-count">ON</span>' : '')
          + `<span class="bag-tile-name">${def.name}</span>`
          + `<span class="bag-tile-meta">${on ? 'active this run' : 'set as active'}</span>`;
        btn.addEventListener('click', () => {
          markBagPeek(btn);
          paintMoveDiagram('k', BAG_DIAGRAM);
          if ($('bag-md-name')) $('bag-md-name').textContent = `${def.name} King`;
          if ($('bag-md-blurb')) $('bag-md-blurb').textContent = def.blurb;
          if (on) return;
          if (!equipKing(run, id)) { audio.illegal(); return; }
          audio.click();
          paintRunHud();
          paintBagPanel();
          toast(`${def.name} king is active`, 'good');
        });
        btn.addEventListener('pointerenter', () => audio.hover());
        kings.appendChild(btn);
      }
    }

    const counts = $('bag-counts');
    if (counts) {
      counts.innerHTML = '';
      if (!summary.pieces.length) {
        const empty = document.createElement('p');
        empty.className = 'slot-line';
        empty.textContent = 'No pieces yet.';
        counts.appendChild(empty);
      }
      for (const row of summary.pieces) {
        const def = pieceById(row.type);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bag-tile';
        const hue = pieceHue(row.type);
        btn.innerHTML =
          `<i style="background-image:url('${pieceImage(row.type, WHITE)}');${hue ? `filter:hue-rotate(${hue}deg)` : ''}"></i>`
          + (row.count > 1 ? `<span class="bag-tile-count">×${row.count}</span>` : '')
          + (row.trained ? `<span class="bag-trained" title="${row.trained} trained: shielded every fight">⛨${row.trained > 1 ? `×${row.trained}` : ''}</span>` : '')
          + `<span class="bag-tile-name">${def?.name || row.type}</span>`
          + `<span class="bag-tile-meta">${def?.cost ?? 0} · ${def?.rarity || ''}</span>`;
        btn.addEventListener('click', () => {
          audio.click();
          markBagPeek(btn);
          paintMoveDiagram(row.type, BAG_DIAGRAM);
        });
        btn.addEventListener('pointerenter', () => audio.hover());
        counts.appendChild(btn);
      }
    }
  }

  function openBag() {
    if (!state.run) return;
    paintBagPanel();
    paintMoveDiagram(null, BAG_DIAGRAM);
    const panel = $('panel-bag');
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    audio.click();
  }

  function closeBag() {
    const panel = $('panel-bag');
    if (!panel || panel.classList.contains('hidden')) return;
    panel.classList.add('hidden');
    panel.setAttribute('aria-hidden', 'true');
  }

  function renderSelected() {
    const host = $('loadout-selected');
    if (!host) return;
    host.innerHTML = placements.map((p) => {
      const def = pieceById(p.type);
      return `<span class="sel-chip">${def?.name || p.type}${p.uid === 'king' ? '' : ` ${def.cost}`}</span>`;
    }).join('');
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

    // Bodies are capped separately from points — see deployBudget().
    const deploy = check.deploy ?? deployBudget(state.run, enc);
    const count = check.count ?? items.length;
    if ($('deploy-text')) {
      $('deploy-text').textContent = `${count} / ${deploy}`;
      $('deploy-fill').style.width = `${deploy ? Math.min(100, (count / deploy) * 100) : 0}%`;
      $('deploy-fill').classList.toggle('over', count > deploy);
    }
    $('btn-loadout-fight').disabled = setupMode ? false : !check.ok;
  }

  function canDeployPick(sq) {
    return placements.some((p) => p.sq === sq);
  }

  function deployTargets(sq) {
    const enc = state.encounter;
    const homes = freeHomeSquares(enc);
    const taken = new Set(placements.map((p) => p.sq));
    return homes.filter((h) => !taken.has(h) || h === sq).map((to) => ({ to, captured: null }));
  }

  function selectNextAffordable() {
    const used = new Set(placements.map((p) => p.uid));
    const left = remainingSupply();
    const next = state.run.bag.find((item) => !used.has(item.uid) && pieceCost(item.type) <= left);
    selectedUid = next ? next.uid : null;
  }

  function onDeployDrop(from, to) {
    const piece = placements.find((p) => p.sq === from);
    if (!piece) return;
    const enc = state.encounter;
    const homes = freeHomeSquares(enc);
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
    const moved = placements.map((p) => (p.sq === from ? { ...p, sq: to } : p));
    if (placementChecksEnemy(enc, moved)) {
      audio.illegal();
      deployView.reject(to);
      toast('That would already have their king in check.', 'danger');
      return;
    }
    piece.sq = to;
    audio.place();
    rebuildDeploy();
    paintSupply();
  }

  /**
   * With no royal guard left to soak a first-ply snipe, the fairness fix
   * moves to deployment instead: a placement that already has their king
   * in check before a single move is played is not a legal placement.
   * Sentinel opts out — the one king built around opening on the attack.
   */
  function placementChecksEnemy(enc, next) {
    if (setupMode) return false;
    if (state.run.king === 'sentinel') return false;
    const game = buildFight(state.run, enc, next);
    return game.kingAttacked(BLACK);
  }

  function placeSelected(sq) {
    if (!selectedUid) return false;
    const enc = state.encounter;
    const homes = freeHomeSquares(enc);
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
    if (placementChecksEnemy(enc, next)) {
      audio.illegal();
      toast('That would already have their king in check.', 'danger');
      return false;
    }
    placements = next;
    selectNextAffordable();
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
    }
  }

  function beginFight() {
    if (setupMode) { closeCrewSetup(); return; }
    const enc = state.encounter;
    const items = placements.filter((p) => p.uid !== 'king');
    const check = validateLoadout(state.run, enc, items.map((p) => p.uid));
    if (!check.ok) {
      toast(check.reason || 'Check your supply', 'danger');
      return;
    }
    const game = buildFight(state.run, enc, placements);
    if (state.run.king !== 'sentinel' && game.kingAttacked(BLACK)) {
      toast('That opens with their king in check — move something.', 'danger');
      return;
    }
    state.game = game;
    state.view.setWhiteKingSkin(kingSkin(state.run.king), kingHue(state.run.king));
    state.gameOver = false;
    state.thinking = false;
    state.generation++;
    state.armyMax = game.armyValue(WHITE);
    state.clock = turnClock(enc);
    state.view.setFlipped(false);
    state.view.syncFromGame(game);
    state.view.markLastMove(null, null);
    state.view.markCheck(null);
    state.view.setInteractive(true);
    resetInspect?.();
    $('run-hud').classList.remove('hidden');
    $('btn-undo').classList.remove('hidden');
    $('btn-undo').textContent = `Take Back · ${UNDO_HP} HP`;
    $('btn-undo').title = `Costs ${UNDO_HP} HP. A fallen king cannot be taken back.`;
    $('btn-new').classList.add('hidden');
    $('btn-forfeit').classList.remove('hidden');
    $('opponent-name').textContent = enc.name;
    $('opponent-side').textContent = `${enc.files}×${enc.ranks} · supply ${supplyBudget(state.run, enc)}`;
    $('player-side').textContent = 'plays White';
    renderCoordinates();
    updateHud();
    paintRunHud();
    refreshStatus();
    audio.setMusicStyle('fight');
    showScreen('screen-game');
    tip('goal', 'Take their king to win. Keep yours out of reach.');
    if (game.outcome().over) onFightOver(game.outcome());
    else if (game.turn !== state.playerColor && scheduleOpponent) scheduleOpponent();
  }

  function onFightOver(opts = {}) {
    const run = state.run;
    const enc = state.encounter;
    const reward = settleFight(run, state.game, enc, {
      forfeit: Boolean(opts.forfeit),
      timeout: Boolean(opts.timeout),
      clockLeft: Math.max(0, state.clock ?? 0),
    });
    state.gameOver = true;
    state.view.setInteractive(false);
    paintRunHud();
    updateHud();

    const youWon = reward.won;
    let title = youWon ? 'THE KING FALLS' : 'YOUR KING FALLS';
    let detail;
    if (reward.fled) {
      title = 'THEY RAN';
      detail = 'Neither of you could finish it — they break and run rather than sit there. No loot from this one.';
    } else if (youWon) {
      title = 'THE KING FALLS';
      detail = `They dropped ${reward.gold} gold.`;
      if (reward.drop) {
        const def = pieceById(reward.drop);
        // Rare and better get their own reveal after this modal closes, so
        // the results line only mentions the ones that do not.
        state.lastDrop = { type: reward.drop, sold: reward.dropSold || 0 };
        if (!def || def.rarity === 'common') {
          detail += reward.dropSold
            ? ` A ${def?.name || reward.drop} dropped — no slot, sold for ${reward.dropSold}g.`
            : ` They dropped a ${def?.name || reward.drop}.`;
        }
      }
      if (enc.boss && run.act >= 2 && run.won) {
        title = 'THE THRONE IS YOURS';
        detail += ' The run is won.';
      } else if (enc.boss) {
        detail += ' The next act opens.';
      }
    } else if (reward.reason === 'unwinnable') {
      title = 'NO WAY THROUGH';
      detail = 'Their king cannot be taken.';
    } else if (run.over) {
      title = 'YOU DIED';
      detail = reward.reason === 'king capture'
        ? 'Your king fell. The run is over.'
        : `Nothing left. −${reward.hpLost} HP.`;
    } else if (reward.secondWind) {
      title = 'SECOND WIND';
      detail = 'That should have finished you. You get up anyway, on one hit point.';
    } else {
      title = reward.forfeit ? 'FORFEIT' : reward.timeout ? 'TOO SLOW' : 'THE FIGHT IS LOST';
      detail = `−${reward.hpLost} HP. You still have ${run.hp} left.`;
    }

    setStatus(title, youWon ? 'good' : 'danger');

    if (run.over) {
      if (run.won) { audio.victory(); confetti(); }
      else audio.defeat();
      setTimeout(() => showGameOver(), 700);
      return true;
    }

    $('btn-again').classList.toggle('hidden', !run.over);
    $('btn-again').textContent = run.won ? 'Embark again' : 'Try again';
    $('btn-continue').classList.toggle('hidden', !youWon || run.over);
    $('btn-retry').classList.toggle('hidden', youWon || !retryAllowed(run));
    $('btn-result-menu').textContent = 'Menu';

    audio.setMusicStyle('ambient');
    setTimeout(() => {
      if (reward.fled) audio.click();
      else if (youWon) { audio.victory(); confetti(); }
      else audio.defeat();
      setTitleText($('result-title'), title, youWon ? 'good' : 'bad');
      setGameText($('result-detail'), detail);
      $('modal-result').classList.remove('hidden');
    }, 650);
    return true;
  }

  function continueAfterFight() {
    $('modal-result').classList.add('hidden');
    resetClassicButtons();
    if (state.run.over) { endRun(); return; }

    const pending = state.run.pendingRelics || [];
    const advance = () => {
      if (state.world === 'voyage') {
        state.voyage?.onFightSettled(state.run.lastReward);
        return;
      }
      completeNode(state.run);
      if (state.run.over) { endRun(); return; }
      showMap();
    };
    const relicsThen = () => {
      if (pending.length) { offerRelics(pending, advance); return; }
      advance();
    };
    // The piece first, then the relic, then the map. A rare drop is the
    // thing you actually won; it should not have to share a screen with
    // anything else.
    showDropReveal(relicsThen);
  }

  const DROP_DIAGRAM = {
    box: 'drop-diagram', board: 'drop-md-board', name: 'drop-md-name',
    blurb: 'drop-md-blurb', cost: 'drop-md-cost', art: 'drop-md-art',
  };
  const DROP_TINT = {
    rare: 'var(--blue)', epic: 'var(--violet)', legendary: 'var(--gold)',
  };

  /**
   * Celebrate a rare-or-better drop before anything else happens. Commons
   * stay a clause in the results line — there are a lot of them and stopping
   * the run for a Pawn would train the player to click through this.
   */
  function showDropReveal(done) {
    const drop = state.lastDrop;
    state.lastDrop = null;
    const def = drop && pieceById(drop.type);
    if (!def || !DROP_TINT[def.rarity]) { done(); return; }

    const card = $('modal-drop');
    if (!card) { done(); return; }
    card.querySelector('.drop-modal').style.setProperty('--drop-tint', DROP_TINT[def.rarity]);
    $('drop-rarity').textContent = def.rarity;
    setTitleText($('drop-title'),
      drop.sold ? `A ${def.name}, and no room for it` : `A ${def.name}`,
      drop.sold ? 'bad' : 'prize');
    setGameText($('drop-note'), drop.sold
      ? `Your ${def.rarity} slots are full, so it went for ${drop.sold} gold.`
      : 'It joins the bag.');
    $('btn-drop-take').textContent = drop.sold ? 'Take the gold' : 'Take it';
    paintMoveDiagram(drop.type, DROP_DIAGRAM);

    const close = () => {
      $('modal-drop').classList.add('hidden');
      $('btn-drop-take').onclick = null;
      done();
    };
    $('btn-drop-take').onclick = close;
    card.classList.remove('hidden');
    if (!drop.sold) { audio.victory(); confetti(); }
  }

  function retryFight() {
    $('modal-result').classList.add('hidden');
    if (state.world === 'voyage') openLoadout(state.encounter);
    else startMappedFight(state.encounter);
  }

  function forfeitFight() {
    if (state.mode !== 'run' || state.gameOver) return;
    const enc = state.encounter;
    onFightOver({ forfeit: true });
  }

  function takeBack() {
    if (state.mode !== 'run' || !state.run || !state.game) return false;
    if (state.gameOver || state.thinking) return false;
    if (state.game.history.length === 0) return false;
    if (state.game.outcome?.().over && state.game.kings.w < 0) {
      audio.illegal();
      toast('Your king is gone. The run is over.', 'danger');
      return false;
    }
    const paid = payUndo(state.run);
    if (!paid.ok) {
      audio.illegal();
      toast(paid.reason, 'danger');
      return false;
    }
    state.generation++;
    state.game.undoMove();
    if (state.game.turn !== state.playerColor && state.game.history.length > 0) {
      state.game.undoMove();
    }
    state.view.syncFromGame(state.game);
    const last = state.game.history[state.game.history.length - 1];
    state.view.markLastMove(last?.move.from ?? null, last?.move.to ?? null);
    state.view.markCheck(state.game.inCheck() ? state.game.kings[state.game.turn] : null);
    state.view.setInteractive(true);
    audio.lift();
    paintRunHud();
    updateHud();
    refreshStatus();
    toast(`−${UNDO_HP} HP`, 'danger');
    return true;
  }

// ---- events (the ? rooms) ----------------------------------------------

  function openEvent(eventId) {
    const ev = EVENTS[eventId] || Object.values(EVENTS)[0];
    state.event = ev;
    paintRunHud();
    $('event-name').textContent = ev.name;
    $('event-text').textContent = ev.text;
    $('event-outcome').classList.add('hidden');
    $('btn-event-leave').classList.add('hidden');
    $('event-choices').classList.remove('hidden');
    paintChoices(ev);
    audio.setMusicStyle('shop');
    showScreen('screen-event');
  }

  /**
   * A quick read on what a choice actually is, so the card can carry that at
   * a glance the way a Spire event does — red for a real risk, gold for a
   * straight cost, green for a straight boon — instead of every option
   * looking identical until you read every word of it.
   */
  function choiceTone(choice) {
    const effects = choice.effects || [];
    if (choice.gamble || effects.some((e) => (e.hp != null && e.hp < 0) || e.lose)) {
      return 'tone-risk';
    }
    const boon = effects.some((e) => (e.gold != null && e.gold > 0) || e.gain
      || e.heal != null || (e.hp != null && e.hp > 0) || e.supply != null
      || e.deploy != null || e.maxHp != null || e.upgrade || e.king);
    if (boon && !choice.cost) return 'tone-boon';
    if (choice.cost) return 'tone-cost';
    return 'tone-neutral';
  }

  function paintChoices(ev) {
    const host = $('event-choices');
    host.innerHTML = '';
    for (const choice of ev.choices) {
      const gate = choiceAvailable(state.run, choice);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `event-choice ${choiceTone(choice)}`;
      btn.disabled = !gate.ok;
      btn.innerHTML = `<span class="ec-label">${choice.label}</span>`
        + `<span class="ec-detail">${gameText(choice.detail)}</span>`
        + (gate.ok ? '' : `<span class="ec-block">${gate.reason}</span>`);
      btn.addEventListener('click', () => takeChoice(choice));
      btn.addEventListener('pointerenter', () => audio.hover());
      host.appendChild(btn);
    }
  }

  /** A choice that gives up a piece has to ask which one before it resolves. */
  function takeChoice(choice) {
    const effects = choice.effects || [];
    const needsPick = effects.some((e) => e.lose === 'choose' || e.upgrade || e.duplicate);
    if (needsPick) {
      const mode = effects.some((e) => e.duplicate) ? 'copy'
        : effects.some((e) => e.upgrade) ? 'feed' : 'lose';
      askWhichPiece(choice, mode);
      return;
    }
    resolveChoice(choice, null);
  }

  function askWhichPiece(choice, mode = 'lose') {
    const host = $('event-choices');
    const prompt = mode === 'feed' ? 'Which piece goes in?'
      : mode === 'copy' ? 'Which piece gets copied?'
      : 'Which piece do you leave?';
    host.innerHTML = `<div class="ec-detail" style="padding:0 0 .4rem">${prompt}</div>`;
    for (const item of state.run.bag) {
      const def = pieceById(item.type);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'event-choice';
      btn.innerHTML = `<span class="ec-label">${def.name}</span>`
        + `<span class="ec-detail">${gameText(`${def.cost} supply · ${def.rarity}`)}</span>`;
      btn.addEventListener('click', () => resolveChoice(choice, item.uid));
      btn.addEventListener('pointerenter', () => audio.hover());
      host.appendChild(btn);
    }
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'event-choice';
    back.innerHTML = '<span class="ec-label">Actually, no</span>';
    back.addEventListener('click', () => paintChoices(state.event));
    host.appendChild(back);
  }

  function resolveChoice(choice, pickedUid) {
    const result = applyChoice(state.run, choice, pickedUid);
    if (!result.ok) { audio.illegal(); toast(result.reason || 'Not now', 'danger'); return; }
    audio.click();
    $('event-choices').classList.add('hidden');
    const lines = result.lines.length ? result.lines : ['Nothing happens.'];
    $('event-outcome').innerHTML = lines.map((l) => `<div>${gameText(l)}</div>`).join('');
    $('event-outcome').classList.remove('hidden');
    $('btn-event-leave').classList.remove('hidden');
    paintRunHud();
    if (state.run.hp <= 0) { state.run.over = true; }

    // A room that hands over a Basilisk should land like one. The best thing
    // the choice produced gets the same reveal a fight drop does; anything
    // common just stays in the outcome lines behind it.
    const worth = { rare: 1, epic: 2, legendary: 3 };
    const prize = (result.gained || [])
      .filter((g) => worth[pieceById(g.type)?.rarity])
      .sort((a, b) => worth[pieceById(b.type).rarity] - worth[pieceById(a.type).rarity])[0];
    if (prize) {
      state.lastDrop = prize;
      showDropReveal(() => {});
    }
  }

  function leaveEvent() {
    if (state.run.over) { endRun(); return; }
    if (state.world === 'voyage') { goWorld(); return; }
    completeNode(state.run);
    if (state.run.over) { endRun(); return; }
    showMap();
  }

/** The relic tray — small marks with the rule they change on hover. */
  function paintRelics() {
    for (const id of ['map-relics', 'loadout-relics', 'game-relics']) {
      const host = $(id);
      if (!host) continue;
      const owned = state.run?.relics || [];
      host.innerHTML = '';
      host.classList.toggle('hidden', owned.length === 0);
      for (const rid of owned) {
        const relic = relicById(rid);
        if (!relic) continue;
        const chip = document.createElement('span');
        chip.className = `relic-chip rarity-${relic.rarity}`;
        chip.innerHTML = '✦<span class="relic-tip"><b>' + relic.name + '</b>'
          + gameText(relic.blurb) + '</span>';
        host.appendChild(chip);
      }
    }
  }

  /** After an elite or boss, choose one of the relics they were carrying. */
  function offerRelics(choices, done) {
    const host = $('relic-choices');
    host.innerHTML = '';
    for (const rid of choices) {
      const relic = relicById(rid);
      if (!relic) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `relic-card rarity-${relic.rarity}`;
      btn.innerHTML = '<span class="relic-mark">✦</span>'
        + `<span class="relic-name">${relic.name}</span>`
        + `<span class="relic-arch">${relic.archetype}</span>`
        + `<span class="relic-blurb">${gameText(relic.blurb)}</span>`;
      btn.addEventListener('click', () => {
        claimRelic(state.run, rid);
        audio.victory();
        $('modal-relic').classList.add('hidden');
        paintRelics();
        done();
      });
      btn.addEventListener('pointerenter', () => audio.hover());
      host.appendChild(btn);
    }
    $('btn-relic-skip').onclick = () => {
      skipRelics(state.run);
      $('modal-relic').classList.add('hidden');
      done();
    };
    $('modal-relic').classList.remove('hidden');
  }

  function paintShop() {
    const shop = state.run.shop;
    paintRunHud();
    $('btn-shop-reroll').textContent = `Reroll (${shop.rerollCost}g)`;
    const table = $('shop-table');
    if (!table) return;
    table.innerHTML = '';
    const offers = shop.offers || [];
    if (shopSelectedId && !offers.some((o) => o.id === shopSelectedId)) shopSelectedId = null;

    for (let i = 0; i < 5; i++) {
      const offer = offers[i];
      const pad = document.createElement('button');
      pad.type = 'button';
      pad.className = 'shop-pad'
        + (offer ? ` rarity-${offer.rarity || offer.kind}` : ' empty')
        + (offer && offer.id === shopSelectedId ? ' selected' : '')
        + (offer?.hpCost ? ' blood' : '');
      if (!offer) {
        pad.disabled = true;
        pad.setAttribute('aria-label', 'Sold');
        table.appendChild(pad);
        continue;
      }
      const isKing = offer.kind === 'king';
      const figUrl = isKing
        ? pieceImage('k', WHITE, offer.sprite || kingSkin(offer.king))
        : pieceImage(offer.type, WHITE);
      const hue = isKing ? kingHue(offer.king) : pieceHue(offer.type);
      pad.setAttribute('aria-label', offer.name);
      pad.innerHTML = `<i class="shop-fig" style="background-image:url('${figUrl}');${hue ? `filter:hue-rotate(${hue}deg)` : ''}"></i>`;
      pad.addEventListener('click', () => {
        shopSelectedId = offer.id;
        audio.click();
        paintShop();
      });
      pad.addEventListener('pointerenter', () => audio.hover());
      table.appendChild(pad);
    }
    paintShopInspect();
  }

  function selectedShopOffer() {
    return (state.run?.shop?.offers || []).find((o) => o.id === shopSelectedId) || null;
  }

  function paintShopInspect() {
    const inspect = $('shop-inspect');
    const buy = $('btn-shop-buy');
    const price = $('shop-inspect-price');
    const offer = selectedShopOffer();
    if (!inspect) return;
    if (!offer) {
      inspect.classList.add('empty');
      paintMoveDiagram(null, SHOP_DIAGRAM);
      if (price) price.textContent = '';
      if (buy) buy.disabled = true;
      return;
    }
    inspect.classList.remove('empty');
    if (offer.kind === 'king') {
      paintMoveDiagram('k', {
        ...SHOP_DIAGRAM,
        skin: offer.sprite || kingSkin(offer.king),
        hue: kingHue(offer.king),
      });
      if ($('shop-md-name')) $('shop-md-name').textContent = offer.name;
      if ($('shop-md-blurb')) $('shop-md-blurb').textContent = offer.blurb;
      if ($('shop-md-cost')) setGameText($('shop-md-cost'), `${offer.cost}g · king variant`);
    } else {
      paintMoveDiagram(offer.type, SHOP_DIAGRAM);
      if ($('shop-md-cost')) {
        const def = pieceById(offer.type);
        setGameText($('shop-md-cost'),
          `${offer.cost}g · ${def?.cost ?? 0} supply · ${offer.rarity || def?.rarity || ''}`);
      }
    }
    const canBuy = state.run.gold >= offer.cost && !(offer.hpCost && state.run.hp <= offer.hpCost);
    if (price) {
      price.innerHTML = `<span class="shop-card-cost">${offer.cost}g</span>`
        + (offer.hpCost
          ? `<span class="shop-card-cost-hp"><svg class="chip-ico shop-cost-ico"><use href="#icon-heart"></use></svg>${offer.hpCost}</span>`
          : '');
    }
    if (buy) {
      buy.disabled = !canBuy;
      buy.textContent = canBuy ? `Buy ${offer.name}` : 'Not enough';
    }
  }

  function buySelectedShopOffer() {
    const offer = selectedShopOffer();
    if (!offer) return;
    const result = buyOffer(state.run, offer.id);
    if (!result.ok) { audio.illegal(); toast(result.reason, 'danger'); return; }
    audio.capture();
    toast(offer.name, 'good');
    shopSelectedId = null;
    paintShop();
  }

  function leaveShop() {
    closeShop(state.run);
    if (state.world === 'voyage') { goWorld(); return; }
    completeNode(state.run);
    showMap();
  }

  function endRun() {
    closeBag();
    resetClassicButtons();
    const run = state.run;
    $('modal-result').classList.add('hidden');
    if (run?.won) {
      audio.victory();
      confetti();
      showGameOver();
    } else if (run?.over) {
      showGameOver();
    } else {
      showScreen('screen-start');
      state.mode = 'classic';
    }
  }

  function showGameOver() {
    const run = state.run;
    if (!run) { showScreen('screen-start'); return; }
    const stats = runStats(run);
    const romans = ['I', 'II', 'III'];
    const actLabel = `Act ${romans[stats.act - 1] || stats.act}`;
    const where = run.won
      ? 'the throne'
      : (stats.lastName || 'the road');
    if ($('go-title')) {
      setTitleText($('go-title'), run.won ? 'THE THRONE IS YOURS' : 'YOU DIED',
        run.won ? 'prize' : 'bad');
    }
    if ($('go-far')) {
      $('go-far').textContent = run.won
        ? `${actLabel} cleared · ${stats.rooms} rooms`
        : `${actLabel} · ${stats.rooms} rooms · fell at ${where}`;
    }
    if ($('go-gold')) {
      $('go-gold').textContent = `${stats.goldSpent}g spent · ${stats.goldLeft}g left`;
    }
    paintStatRow($('go-captured'), stats.captured, 'None taken.');
    paintStatRow($('go-army'), stats.army, 'An empty bag.');
    if ($('go-kings')) {
      const names = (stats.kings || []).map((id) => (kingDef(id).name || 'Plain') + ' King');
      $('go-kings').textContent = names.join(' · ') || 'Plain King';
    }
    if (run.won) audio.setMusicStyle('ambient');
    else audio.setMusicStyle('gameover');
    showScreen('screen-gameover');
  }

  function paintStatRow(host, rows, empty) {
    if (!host) return;
    host.innerHTML = '';
    if (!rows || !rows.length) {
      host.innerHTML = `<span class="go-empty">${empty}</span>`;
      return;
    }
    for (const row of rows) {
      const chip = document.createElement('span');
      chip.className = 'go-piece';
      const art = document.createElement('i');
      art.style.backgroundImage = `url('${pieceImage(row.type, WHITE)}')`;
      if (pieceHue(row.type)) art.style.filter = `hue-rotate(${pieceHue(row.type)}deg)`;
      chip.appendChild(art);
      const label = document.createElement('b');
      const name = row.name || pieceById(row.type)?.name || row.type;
      label.textContent = row.count > 1 ? `${row.count} ${name}` : name;
      chip.appendChild(label);
      host.appendChild(chip);
    }
  }

  function resetClassicButtons() {
    $('run-hud').classList.add('hidden');
    $('btn-undo').classList.remove('hidden');
    $('btn-undo').textContent = 'Take Back';
    $('btn-undo').title = 'Take back your last move.';
    $('btn-new').classList.remove('hidden');
    $('btn-forfeit').classList.add('hidden');
    $('btn-again').classList.remove('hidden');
    $('btn-again').textContent = 'Play Again';
    $('btn-continue').classList.add('hidden');
    $('btn-retry').classList.add('hidden');
    $('btn-result-menu').textContent = 'Menu';
  }

  function abandon() {
    closeBag();
    $('modal-result').classList.add('hidden');
    resetClassicButtons();
    state.mode = 'classic';
    state.generation++;
    showScreen('screen-start');
  }

  // ---- bind --------------------------------------------------------------

  for (const id of ['btn-map-bag', 'btn-shop-bag', 'btn-rest-bag', 'map-king']) {
    if ($(id)) $(id).addEventListener('click', openBag);
  }
  if ($('btn-map-quit')) $('btn-map-quit').addEventListener('click', abandon);

  if ($('btn-bag-close')) $('btn-bag-close').addEventListener('click', closeBag);
  if ($('panel-bag')) {
    $('panel-bag').addEventListener('click', (e) => {
      if (e.target === $('panel-bag')) closeBag();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeBag();
  });
  $('btn-loadout-back').addEventListener('click', goWorld);
  if ($('btn-event-leave')) $('btn-event-leave').addEventListener('click', leaveEvent);
  if ($('btn-event-bag')) $('btn-event-bag').addEventListener('click', openBag);
  $('btn-loadout-auto').addEventListener('click', () => {
    const enc = state.encounter;
    placements = autoPlace(enc, suggestLoadout(state.run, enc));
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
  if ($('btn-crew-setup')) $('btn-crew-setup').addEventListener('click', openCrewSetup);
  if ($('crew-preview-wrap')) $('crew-preview-wrap').addEventListener('click', openCrewSetup);
  if ($('btn-go-again')) {
    $('btn-go-again').addEventListener('click', () => {
      audio.setMusicStyle('ambient');
      startRun();
    });
  }
  if ($('btn-go-menu')) {
    $('btn-go-menu').addEventListener('click', () => abandon());
  }
  $('btn-shop-leave').addEventListener('click', leaveShop);
  if ($('btn-shop-buy')) $('btn-shop-buy').addEventListener('click', buySelectedShopOffer);
  $('btn-shop-reroll').addEventListener('click', () => {
    const result = rerollShop(state.run);
    if (!result.ok) { audio.illegal(); toast(result.reason, 'danger'); return; }
    audio.click();
    shopSelectedId = null;
    paintShop();
  });
  $('btn-continue').addEventListener('click', continueAfterFight);
  $('btn-retry').addEventListener('click', retryFight);
  $('btn-forfeit').addEventListener('click', forfeitFight);
  $('btn-rest-move-on').addEventListener('click', () => {
    if (state.world === 'voyage') { goWorld(); return; }
    completeNode(state.run);
    if (state.run.over) { endRun(); return; }
    showMap();
  });
  $('btn-rest-back').addEventListener('click', goWorld);

  function openWorldShop({ name, blurb } = {}) {
    shopSelectedId = null;
    openShop(state.run);
    if ($('shop-name')) $('shop-name').textContent = name || 'The Masked Stall';
    if ($('shop-blurb')) $('shop-blurb').textContent = blurb || 'The same hooded figure. Gold, and sometimes blood.';
    audio.setMusicStyle('shop');
    paintShop();
    showScreen('screen-shop');
  }

  return {
    onFightOver,
    takeBack,
    paintRunHud,
    resetClassicButtons,
    abandon,
    startRun,
    openLoadout,
    openWorldShop,
    openWorldRest,
    openEvent,
    openBag,
    goWorld,
    finishRun: endRun,
    tickClock() {
      // This used to decrement to zero and then return false forever, so the
      // clock on the HUD was pure decoration and nothing stopped you taking
      // fifty quiet moves to grind a fight down. It ends the fight now, which
      // is what makes the Royal Guard a problem to solve rather than a wall to
      // wait behind.
      if (state.clock == null) return false;
      if (state.clock > 0) state.clock -= 1;
      paintRunHud();
      return state.clock <= 0;
    },
    isRun() { return state.mode === 'run'; },
  };
}
