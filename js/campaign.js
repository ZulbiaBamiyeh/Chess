// Run screens: map, loadout, shop, and the fight overlay on the shared board.

import { WHITE, BLACK, FLAG, parseSquare, squareName, TILE } from './chess.js';
import { pieceById, pieceCost, rarityOf } from './pieces.js';
import { BoardView, pieceImage, pieceHue, kingSkin, shake, confetti, toast } from './ui.js';
import {
  createRun, currentNode, validateLoadout, buildFight, settleFight,
  openShop, buyOffer, rerollShop, closeShop, retryAllowed,
  autoPlace, supplyBudget, deployBudget, occupiedSlots, freeHomeSquares,
  completeNode, pickNode, rest, forage, trainPiece,
  REST_GOLD, REST_HEAL, FORAGE_GOLD, TRAIN_COST, turnClock,
  bagSummary, equipKing, applyChoice, choiceAvailable, claimRelic, skipRelics,
  suggestLoadout,
} from './run.js';
import { encounterFor, kingDef, EVENTS } from './content.js';
import { relicById } from './relics.js';

export function initCampaign(ctx) {
  const {
    state, $, showScreen, audio, requestMove, setStatus, refreshStatus,
    updateHud, renderCoordinates,
  } = ctx;

  let deployView = null;
  let selectedUid = null;
  let placements = []; // { uid, type, sq }

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

    for (const id of ['hud-gold', 'map-gold', 'load-gold', 'shop-gold', 'rest-gold', 'event-gold']) {
      const el = $(id);
      if (!el) continue;
      const num = el.querySelector('.chip-num');
      if (num) num.textContent = `${run.gold}g`; else el.textContent = `${run.gold}g`;
      if (goldChanged) flashChip(el, run.gold > prev.gold);
    }

    for (const id of ['hud-hp', 'map-hp', 'load-hp', 'shop-hp', 'rest-hp', 'event-hp']) {
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

  function startRun() {
    state.mode = 'run';
    state.run = createRun();
    state.playerColor = WHITE;
    state._hudPrev = null;
    showMap();
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

    const climb = $('map-climb');
    climb.innerHTML = '';

    const floors = {};
    let maxCol = 0;
    for (const node of act.nodes) {
      (floors[node.col] ||= []).push(node);
      if (node.col > maxCol) maxCol = node.col;
    }
    const W = 420;
    const step = 152;
    const H = 168 + (maxCol + 1) * step;
    climb.style.width = `${W}px`;
    climb.style.height = `${H}px`;
    if ($('map-art')) $('map-art').style.height = `${Math.max(H, 800)}px`;

    const pos = {};
    for (const node of act.nodes) {
      const onFloor = floors[node.col];
      const jx = (hash01(node.id) - 0.5) * 14;
      const jy = (hash01(node.id + 'y') - 0.5) * 8;
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

    const openRooms = (run.choices && run.choices.length)
      ? run.choices
      : (here && openIds.has(here.id) ? [here] : []);
    if (openRooms.length > 1) {
      $('map-blurb').textContent = openRooms.map((n) => n.name).join('  ·  ');
    } else if (openRooms.length === 1) {
      $('map-blurb').textContent = `${openRooms[0].name} — ${openRooms[0].blurb}`;
    } else if (here) {
      $('map-blurb').textContent = `${here.name} — ${here.blurb}`;
    } else {
      $('map-blurb').textContent = 'Choose a path.';
    }
    showScreen('screen-map');
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

  function enterNode() {
    const node = currentNode(state.run);
    if (!node || state.run.over) { endRun(); return; }
    if (node.kind === 'shop') openShopScreen();
    else if (node.kind === 'rest') openRest();
    else if (node.kind === 'event') openEvent(node);
    else {
      const enc = encounterFor(node);
      if (enc) openLoadout(enc);
    }
  }

  function goFromMap() {
    enterNode();
  }

  const REST_CHOICES = [
    { id: 'rest', label: 'Rest',
      detail: `Heal ${REST_HEAL} HP, pocket ${REST_GOLD} gold.` },
    { id: 'forage', label: 'Forage',
      detail: `Skip the healing — take ${FORAGE_GOLD} gold instead.` },
    { id: 'train', label: 'Train',
      detail: `Spend ${TRAIN_COST} gold to permanently shield one piece, every fight from now on.` },
  ];

  function openRest() {
    paintRunHud();
    const node = currentNode(state.run);
    $('rest-name').textContent = node?.name || 'A Quiet Square';
    $('rest-detail').textContent = 'Choose how to spend the moment.';
    $('rest-outcome').classList.add('hidden');
    $('btn-rest-move-on').classList.add('hidden');
    $('rest-choices').classList.remove('hidden');
    paintRestChoices();
    showScreen('screen-rest');
  }

  function trainGate() {
    if (state.run.gold < TRAIN_COST) return { ok: false, reason: `Needs ${TRAIN_COST}g` };
    if (!state.run.bag.some((p) => p.type !== 'k' && !p.trained)) {
      return { ok: false, reason: 'Nothing left to train' };
    }
    return { ok: true };
  }

  function paintRestChoices() {
    const host = $('rest-choices');
    host.innerHTML = '';
    for (const choice of REST_CHOICES) {
      const gate = choice.id === 'train' ? trainGate() : { ok: true };
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'event-choice';
      btn.disabled = !gate.ok;
      btn.innerHTML = `<span class="ec-label">${choice.label}</span>`
        + `<span class="ec-detail">${choice.detail}</span>`
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
        + `<span class="ec-detail">${def.cost} supply · ${def.rarity}</span>`;
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
  }

  function openLoadout(encounter) {
    state.encounter = encounter;
    selectedUid = null;
    const homes = freeHomeSquares(encounter);
    const kingSq = homes[Math.floor((homes.length - 1) / 2)] ?? homes[0];
    placements = kingSq != null ? [{ uid: 'king', type: 'k', sq: kingSq }] : [];

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
  }

  function rebuildDeploy() {
    const enc = state.encounter;
    const { Chess } = ctx;
    const game = buildFight(state.run, enc, placements);
    deployView.setWhiteKingSkin(kingSkin(state.run.king));
    deployView.setFlipped(false);
    deployView.syncFromGame(game);
    deployView.setInteractive(true);
    paintHomes(enc);
    paintDeployCoords(enc);
  }

  function paintKingChip(run) {
    const def = kingDef(run.king);
    const skin = kingSkin(run.king);
    for (const prefix of ['map', 'load', 'shop', 'rest']) {
      const art = $(`${prefix}-king-art`);
      const name = $(`${prefix}-king-name`);
      const chip = $(`${prefix}-king`);
      if (art) art.style.backgroundImage = `url('${pieceImage('k', WHITE, skin)}')`;
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
    const files = 7;
    const ranks = 7;
    const g = new Chess({
      files, ranks,
      rules: { checks: false, kingCapture: true, castling: false },
    });
    const mid = 3 * 16 + 3;
    g.board[mid] = { type, color: WHITE };
    if (type === 'k') g.kings.w = mid;
    if (def.pawn) {
      for (const off of [-17, -15]) {
        const sq = mid + off;
        if (g.inBounds(sq)) g.board[sq] = { type: 'p', color: 'b' };
      }
    }
    // A hopper needs something to hop, or its diagram comes out blank.
    if (def.hopper) g.board[mid - 16] = { type: 'p', color: 'b' };
    g.turn = WHITE;
    g.refreshMode();
    const dest = new Map();
    for (const m of g.moves({ square: mid, legal: false })) {
      dest.set(m.to, Boolean(m.captured));
    }
    // A shot only generates when something is standing there to be shot, so
    // on an empty diagram board a Crossbow would look like a plain Ferz —
    // its whole point invisible. Draw the firing squares from the definition.
    if (def.shootOff) {
      for (const off of def.shootOff) {
        const sq = mid + off;
        if (g.inBounds(sq) && sq !== mid) dest.set(sq, true);
      }
    }

    if ($(ids.name)) $(ids.name).textContent = def.name;
    if ($(ids.blurb)) $(ids.blurb).textContent = def.blurb || '';
    if ($(ids.cost)) $(ids.cost).textContent = `${def.cost} supply · ${def.rarity}`;
    if ($(ids.art)) {
      $(ids.art).style.backgroundImage = `url('${pieceImage(type, WHITE)}')`;
      $(ids.art).style.filter = pieceHue(type) ? `hue-rotate(${pieceHue(type)}deg)` : '';
    }

    host.innerHTML = '';
    for (let r = 0; r < ranks; r++) {
      for (let f = 0; f < files; f++) {
        const sq = r * 16 + f;
        const cell = document.createElement('i');
        cell.className = 'md-sq' + ((r + f) % 2 ? ' dark' : ' light');
        if (sq === mid) {
          const fig = document.createElement('b');
          fig.style.backgroundImage = `url('${pieceImage(type, WHITE)}')`;
          if (pieceHue(type)) fig.style.filter = `hue-rotate(${pieceHue(type)}deg)`;
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
        btn.innerHTML =
          `<i style="background-image:url('${pieceImage('k', WHITE, kingSkin(id))}')"></i>`
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
    $('btn-loadout-fight').disabled = !check.ok;
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
    piece.sq = to;
    audio.place();
    rebuildDeploy();
    paintSupply();
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
    const enc = state.encounter;
    const items = placements.filter((p) => p.uid !== 'king');
    const check = validateLoadout(state.run, enc, items.map((p) => p.uid));
    if (!check.ok) {
      toast(check.reason || 'Check your supply', 'danger');
      return;
    }
    const game = buildFight(state.run, enc, placements);
    state.game = game;
    state.view.setWhiteKingSkin(kingSkin(state.run.king));
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
    audio.setMusicStyle('fight');
    showScreen('screen-game');
    if (game.outcome().over) onFightOver(game.outcome());
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
    if (youWon) {
      title = 'THE KING FALLS';
      detail = `+${reward.gold} gold` + (reward.clockLeft ? ` (${reward.clockLeft} for speed)` : '') + '.';
      if (reward.drop) {
        const def = pieceById(reward.drop);
        detail += reward.dropSold
          ? ` A ${def?.name || reward.drop} dropped — no slot, sold for ${reward.dropSold}g.`
          : ` They dropped a ${def?.name || reward.drop}.`;
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
      detail = `Your king fell, and you had nothing left. −${reward.hpLost} HP.`;
    } else if (reward.secondWind) {
      title = 'SECOND WIND';
      detail = 'That should have finished you. You get up anyway, on one hit point.';
    } else {
      title = 'YOUR KING FALLS';
      detail = `−${reward.hpLost} HP. You still have ${run.hp} left — go again.`;
    }

    setStatus(title, youWon ? 'good' : 'danger');
    $('btn-again').classList.toggle('hidden', !run.over);
    $('btn-again').textContent = run.won ? 'Embark again' : 'Try again';
    $('btn-continue').classList.toggle('hidden', !youWon || run.over);
    $('btn-retry').classList.toggle('hidden', youWon || !retryAllowed(run));
    $('btn-result-menu').textContent = 'Menu';

    audio.setMusicStyle('ambient');
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

    const pending = state.run.pendingRelics || [];
    const advance = () => {
      completeNode(state.run);
      if (state.run.over) { endRun(); return; }
      showMap();
    };
    if (pending.length) { offerRelics(pending, advance); return; }
    advance();
  }

  function retryFight() {
    $('modal-result').classList.add('hidden');
    openLoadout(state.encounter);
  }

  function forfeitFight() {
    if (state.mode !== 'run' || state.gameOver) return;
    const enc = state.encounter;
    onFightOver({ forfeit: true });
  }

// ---- events (the ? rooms) ----------------------------------------------

  function openEvent(node) {
    const ev = EVENTS[node.eventId] || Object.values(EVENTS)[0];
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

  function paintChoices(ev) {
    const host = $('event-choices');
    host.innerHTML = '';
    for (const choice of ev.choices) {
      const gate = choiceAvailable(state.run, choice);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'event-choice';
      btn.disabled = !gate.ok;
      btn.innerHTML = `<span class="ec-label">${choice.label}</span>`
        + `<span class="ec-detail">${choice.detail}</span>`
        + (gate.ok ? '' : `<span class="ec-block">${gate.reason}</span>`);
      btn.addEventListener('click', () => takeChoice(choice));
      btn.addEventListener('pointerenter', () => audio.hover());
      host.appendChild(btn);
    }
  }

  /** A choice that gives up a piece has to ask which one before it resolves. */
  function takeChoice(choice) {
    const needsPick = (choice.effects || []).some((e) => e.lose === 'choose');
    if (needsPick) { askWhichPiece(choice); return; }
    resolveChoice(choice, null);
  }

  function askWhichPiece(choice) {
    const host = $('event-choices');
    host.innerHTML = '<div class="ec-detail" style="padding:0 0 .4rem">Which piece do you leave?</div>';
    for (const item of state.run.bag) {
      const def = pieceById(item.type);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'event-choice';
      btn.innerHTML = `<span class="ec-label">${def.name}</span>`
        + `<span class="ec-detail">${def.cost} supply · ${def.rarity}</span>`;
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
    $('event-outcome').innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
    $('event-outcome').classList.remove('hidden');
    $('btn-event-leave').classList.remove('hidden');
    paintRunHud();
    if (state.run.hp <= 0) { state.run.over = true; }
  }

  function leaveEvent() {
    if (state.run.over) { endRun(); return; }
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
          + relic.blurb + '</span>';
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
        + `<span class="relic-blurb">${relic.blurb}</span>`;
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

  function openShopScreen() {
    const node = currentNode(state.run);
    openShop(state.run);
    $('shop-name').textContent = node.name;
    $('shop-blurb').textContent = node.blurb;
    audio.setMusicStyle('shop');
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
        : offer.kind === 'king'
          ? `<i class="shop-art" style="background-image:url('${pieceImage('k', WHITE, offer.sprite || kingSkin(offer.king))}')"></i>`
          : offer.kind === 'supply'
            ? `<i class="shop-art" style="background-image:url('assets/map-shop.png')"></i>`
            : offer.kind === 'relic'
              ? '<i class="shop-art shop-art-relic">✦</i>'
              : `<i class="shop-art shop-art-${offer.kind === 'slot' ? 'slot' : 'purse'}"></i>`;
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
    completeNode(state.run);
    showMap();
  }

  function endRun() {
    closeBag();
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
    closeBag();
    audio.setMusicStyle('ambient');
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
  if ($('btn-bag-close')) $('btn-bag-close').addEventListener('click', closeBag);
  if ($('panel-bag')) {
    $('panel-bag').addEventListener('click', (e) => {
      if (e.target === $('panel-bag')) closeBag();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeBag();
  });
  $('btn-embark').addEventListener('click', async () => {
    await audio.resume();
    if (state.settings.music) audio.startMusic();
    startRun();
  });
  if ($('btn-map-go')) $('btn-map-go').addEventListener('click', goFromMap);
  $('btn-map-quit').addEventListener('click', abandon);
  $('btn-loadout-back').addEventListener('click', showMap);
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
  $('btn-rest-move-on').addEventListener('click', () => {
    completeNode(state.run);
    showMap();
  });
  $('btn-rest-back').addEventListener('click', showMap);

  return {
    startRun,
    onFightOver,
    paintRunHud,
    resetClassicButtons,
    abandon,
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
