// The Chess-Vania overworld screen. Fog, a camera that follows the leader,
// roaming packs with combat-level badges, and the decay eating the south.

import { WHITE } from './chess.js';
import { pieceById } from './pieces.js';
import { pieceImage, kingSkin, kingHue, pieceHue, toast, tip } from './ui.js';
import { createVoyageRun, addToBag, removeFromBag, bagSummary } from './run.js';
import { EVENTS, kingDef } from './content.js';
import {
  generateWorld, generateTown, playerMoves, movePlayer, clashEncounter, bagMaterial,
  armyMaterial, threatTint, keyPieceType,
  bumpFromPack, cellAt, TERRAIN, OW, key, packCard, chebyshev,
  revealMapFragment, questProgress, mulberry32,
} from './overworld.js';

/** Draws an unseen event for this run where possible, same idea as the old map's picker. */
function pickEvent(run) {
  run.seenEvents = run.seenEvents || new Set();
  const all = Object.values(EVENTS);
  const fresh = all.filter((e) => !run.seenEvents.has(e.id));
  const pool = fresh.length ? fresh : all;
  const ev = pool[Math.floor(run.rng() * pool.length)];
  run.seenEvents.add(ev.id);
  return ev.id;
}

// Hand-built vector marks for the map's non-piece points of interest — no
// bitmap art ships for these, so a real icon means drawing one, not just
// styling a bigger Unicode glyph. Same badge shape throughout (a hexagon
// puck) so the set reads as one family; only the emblem and its colour
// change per kind.
function owBadge(stroke, fill, glyph) {
  return `<svg viewBox="0 0 32 32" class="ow-icon-svg">`
    + `<polygon points="16,2 28,9 28,23 16,30 4,23 4,9" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`
    + glyph
    + `</svg>`;
}
const OW_ICON = {
  event: owBadge('#8a7bff', 'rgba(24,16,42,0.94)',
    '<path d="M16 10a5 5 0 1 1-4.2 7.7" fill="none" stroke="#8a7bff" stroke-width="2" stroke-linecap="round"/>'
    + '<path d="M16 10a5 5 0 0 1 5 5" fill="none" stroke="#c08cff" stroke-width="2" stroke-linecap="round"/>'
    + '<text x="16" y="23" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="15" fill="#e8dcff">?</text>'),
  quest: owBadge('#43d9ff', 'rgba(18,26,42,0.92)',
    '<rect x="10" y="9" width="12" height="16" rx="2" fill="rgba(20,30,50,0.9)" stroke="#43d9ff" stroke-width="1.6"/>'
    + '<circle cx="10" cy="9" r="1.8" fill="none" stroke="#43d9ff" stroke-width="1.3"/>'
    + '<circle cx="22" cy="9" r="1.8" fill="none" stroke="#43d9ff" stroke-width="1.3"/>'
    + '<circle cx="10" cy="25" r="1.8" fill="none" stroke="#43d9ff" stroke-width="1.3"/>'
    + '<circle cx="22" cy="25" r="1.8" fill="none" stroke="#43d9ff" stroke-width="1.3"/>'
    + '<text x="16" y="21" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="12" fill="#43d9ff">?</text>'),
  shop: owBadge('#e0b84f', 'rgba(42,28,14,0.92)',
    '<path d="M13 10c0-2 1.3-3.4 3-3.4s3 1.4 3 3.4" fill="none" stroke="#c9a24a" stroke-width="1.6"/>'
    + '<path d="M11 11h10l2.4 12.6a2 2 0 0 1-2 2.4H10.6a2 2 0 0 1-2-2.4z" fill="rgba(120,80,30,0.9)" stroke="#e0b84f" stroke-width="1.8"/>'
    + '<text x="16" y="22" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="13" fill="#ffd76a">$</text>'),
};

// Town NPCs stand in for roles with no bespoke art of their own yet, borrowing
// a combat piece's silhouette. A hue shift — the same reskin trick every
// placeholder king and piece in this game used before its own art arrived —
// keeps a merchant reading as a trader instead of a stray Wazir.
const NPC_TINT = {
  merchant: { hue: 0, sat: 1.75 },
  cartographer: { hue: 265, sat: 1.4 },
  quest: { hue: 320, sat: 1.4 },
};

export function initVoyage(ctx) {
  const {
    state, $, showScreen, audio, campaign,
  } = ctx;

  let legal = [];
  const FOG_S = 8;
  let fogRaf = 0;
  let fogGrid = null;
  let fogFiles = 0;
  let fogRanks = 0;

  function overworld() {
    return state.run?.voyage;
  }

  function world() {
    return state.run?.town || state.run?.voyage;
  }

  function start() {
    state.mode = 'run';
    state.world = 'voyage';
    state.run = createVoyageRun();
    state.playerColor = WHITE;
    state._hudPrev = null;
    state.run.voyage = generateWorld(state.run.rng, 1);
    showWithBossReveal();
    // After the boss-reveal pan has settled on the leader, not competing
    // with its own toast.
    setTimeout(() => tip('move', 'Click a lit square to walk there, one step at a time.'), 2000);
  }

  function show() {
    if (!world()) return;
    campaign.paintRunHud();
    paintBoard();
    paintBlurb();
    showScreen('screen-overworld');
    audio.setMusicStyle(world()?.scene === 'town' ? 'town' : 'ambient');
    ensureFog();
    requestAnimationFrame(centerOnPlayer);
  }

  /**
   * Opening an act: reveal where the boss holds the ramp before the camera
   * settles on the leader, the way looking north across the Wilderness tells
   * you where the ditch is before you ever take a step. Only for a fresh
   * overworld — returning to a map already underway just centers as usual.
   */
  function showWithBossReveal(introLine) {
    if (!world()) return;
    campaign.paintRunHud();
    paintBoard();
    paintBlurb();
    showScreen('screen-overworld');
    audio.setMusicStyle('ambient');
    ensureFog();
    const w = overworld();
    const spot = w?.bossSpot;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (!spot || reduce) {
      requestAnimationFrame(centerOnPlayer);
      return;
    }
    requestAnimationFrame(() => {
      centerOnCell(spot.file, spot.rank, 'auto');
      const boss = w.packs.find((p) => p.tier === 'boss' && !p.dead);
      const line = boss ? `${boss.name} holds the ramp north. Find your way up.` : 'Find your way north.';
      toast(introLine ? `${introLine} ${line}` : line, 'danger');
      setTimeout(centerOnPlayer, 1700);
    });
  }

  function resumeFromWorld() {
    if (state.run?.over) {
      campaign.abandon();
      return;
    }
    show();
  }

  function onFightSettled(reward) {
    const w = overworld();
    const packId = state.encounter?.packId;
    const pack = w?.packs.find((p) => p.id === packId);
    if (reward?.won && pack) pack.dead = true;
    else if (pack && !pack.dead) bumpFromPack(w, pack);
    if (state.run.over) {
      campaign.abandon();
      return;
    }
    if (reward?.won) {
      state.run.packsKilled = (state.run.packsKilled || 0) + 1;
      const cell = cellAt(w, w.player.file, w.player.rank);
      if (cell?.poi === 'ramp') {
        toast(`${state.encounter?.name || 'They'} fall. The ramp is open.`, 'good');
        climbRamp();
        return;
      }
    }
    show();
    if (reward?.won) toast(`${state.encounter?.name || 'They'} fall`, 'good');
  }

  function paintBlurb() {
    const w = world();
    if (!$('ow-blurb') || !w) return;
    if (w.scene === 'town') {
      $('ow-blurb').textContent = `${w.name}. Talk to the pieces. South is the road.`;
      return;
    }
    const south = w.player.rank - (w.decayRank + 1);
    const turnsLeft = Math.max(0, w.grace - w.turns);
    let line;
    if (w.decayRank < 0) {
      line = turnsLeft
        ? `The south is still. ${turnsLeft} move${turnsLeft === 1 ? '' : 's'} before the decay wakes.`
        : 'The decay is stirring.';
    } else if (south <= 3) {
      line = 'The decay is at your heels. Go north.';
    } else {
      line = `Decay has eaten ${w.decayRank + 1} ranks of the south. ${south} ranks of ground left under you.`;
    }
    const mat = bagMaterial(state.run);
    $('ow-blurb').textContent = line;
    if ($('ow-army')) $('ow-army').textContent = `Army ${mat}`;
    if ($('ow-act')) {
      const romans = ['I', 'II', 'III'];
      $('ow-act').textContent = `ACT ${romans[w.act - 1] || w.act}`;
    }
  }

  /** The left dock: every quest actually taken, with live progress. */
  function paintQuestLog() {
    const host = $('ow-quest-list');
    if (!host) return;
    const quests = (state.run.quests || []).filter((q) => q.status !== 'done');
    if (!quests.length) {
      host.innerHTML = '<p class="ow-dock-empty">Talk to someone in a town.</p>';
      return;
    }
    host.innerHTML = quests.map((q) => {
      const prog = questProgress(state.run, q);
      let line = q.detail;
      if (q.kind === 'scout' && prog.need != null) line = `${Math.min(prog.have, prog.need)} / ${prog.need} ranks north`;
      else if (q.kind === 'bounty' && prog.need != null) line = `${Math.min(prog.have, prog.need)} / ${prog.need} scattered`;
      return `<div class="ow-quest-card${prog.ready ? ' ready' : ''}">`
        + `<span class="ow-quest-name">${q.title}</span>`
        + `<span class="ow-quest-detail">${prog.ready ? 'Ready — find them again.' : line}</span>`
        + `</div>`;
    }).join('');
  }

  /** The right dock: a glance at the bag. Click anything to open it in full. */
  function paintInventoryDock() {
    const kingsHost = $('ow-inv-kings');
    const piecesHost = $('ow-inv-pieces');
    const slotsHost = $('ow-inv-slots');
    if (!kingsHost || !piecesHost) return;
    const run = state.run;
    const summary = bagSummary(run);
    if (slotsHost) {
      slotsHost.textContent = Object.entries(run.slots)
        .filter(([r]) => r !== 'common')
        .map(([r, n]) => `${r} ${summary.slots[r] || 0}/${n === Infinity ? '∞' : n}`)
        .join('  ·  ');
    }
    kingsHost.innerHTML = summary.kings.map((id) => {
      const def = kingDef(id);
      const on = summary.equipped === id;
      const hue = kingHue(id) ? ` filter:hue-rotate(${kingHue(id)}deg);` : '';
      return `<button type="button" class="bag-tile king-tile${on ? ' on' : ' idle'}" title="${def.name} King">`
        + `<i style="background-image:url('${pieceImage('k', WHITE, kingSkin(id))}');${hue}"></i>`
        + `<span class="bag-tile-name">${def.name}${on ? ' (active)' : ''}</span>`
        + `</button>`;
    }).join('');
    piecesHost.innerHTML = summary.pieces.map((row) => {
      const def = pieceById(row.type);
      const hue = pieceHue(row.type) ? ` filter:hue-rotate(${pieceHue(row.type)}deg);` : '';
      return `<button type="button" class="bag-tile" title="${def?.name || row.type}">`
        + `<i style="background-image:url('${pieceImage(row.type, WHITE)}');${hue}"></i>`
        + (row.count > 1 ? `<span class="bag-tile-count">×${row.count}</span>` : '')
        + `<span class="bag-tile-name">${def?.name || row.type}</span>`
        + `</button>`;
    }).join('');
    const openFull = () => campaign.openBag();
    kingsHost.onclick = openFull;
    piecesHost.onclick = openFull;
  }

  function terrainClass(cell, file, rank) {
    const w = world();
    const bits = ['ow-sq'];
    bits.push((file + rank) % 2 ? 'dark' : 'light');
    bits.push(cell.biome || 'wood');
    if (rank <= w.decayRank) bits.push('decay');
    const k = key(file, rank);
    if (w.visible.has(k)) bits.push('fog-visible');
    else if (w.explored.has(k)) bits.push('fog-seen');
    else bits.push('fog-hidden');
    if (cell.terrain === TERRAIN.CHASM || (cell.terrain === TERRAIN.WALL && w.scene !== 'town')) {
      bits.push('chasm');
    }
    if (w.scene === 'town' && cell.terrain === TERRAIN.WALL) bits.push('town-wall');
    if (cell.terrain === TERRAIN.FROST) bits.push('frost-tile');
    if (cell.terrain === TERRAIN.EMBER) bits.push('ember-tile');
    if (cell.terrain === TERRAIN.FORT) bits.push('fort-tile');
    if (cell.terrain === TERRAIN.RAMP) bits.push('ramp-tile');
    return bits.join(' ');
  }

  function paintBoard() {
    const w = world();
    const board = $('ow-board');
    const stack = $('ow-stack');
    if (!board || !w) return;
    const host = stack || board;
    host.style.setProperty('--ow-files', w.files);
    host.style.setProperty('--ow-ranks', w.ranks);
    host.classList.toggle('town', w.scene === 'town');
    legal = playerMoves(w);
    const legalSet = new Set(legal.map((m) => key(m.file, m.rank)));
    const playerMat = bagMaterial(state.run);
    board.innerHTML = '';

    // North is the top of the grid: paint high ranks first.
    for (let displayRow = 0; displayRow < w.ranks; displayRow++) {
      const rank = w.ranks - 1 - displayRow;
      for (let file = 0; file < w.files; file++) {
        const cell = w.cells[rank][file];
        const sq = document.createElement('button');
        sq.type = 'button';
        sq.className = terrainClass(cell, file, rank);
        sq.dataset.file = String(file);
        sq.dataset.rank = String(rank);
        const vis = w.visible.has(key(file, rank));
        const seen = w.explored.has(key(file, rank));

        if (seen && !sq.classList.contains('fog-hidden')) {
          if (cell.poi === 'village') {
            // Standing in for a town's own icon for now — the shop badge is
            // the closest of the three to "a place with people in it."
            sq.insertAdjacentHTML('beforeend', `<i class="ow-loot">${OW_ICON.shop}</i>`);
          } else if (cell.poi === 'shop') {
            sq.insertAdjacentHTML('beforeend', `<i class="ow-loot">${OW_ICON.shop}</i>`);
          } else if (cell.poi === 'ramp') {
            sq.insertAdjacentHTML('beforeend', `<i class="ow-poi" style="background-image:url('assets/ow-ramp.png')"></i>`);
          } else if (cell.poi === 'sign') {
            sq.insertAdjacentHTML('beforeend', `<i class="ow-loot">${OW_ICON.quest}</i>`);
          } else if (cell.poi === 'event') {
            sq.insertAdjacentHTML('beforeend', `<i class="ow-loot ow-event">${OW_ICON.event}</i>`);
          } else if (cell.poi === 'exit') {
            sq.classList.add('ow-exit');
          }
        }

        // A boss stays a landmark once its lair has been seen, even from
        // outside current vision — you should always know where the goal
        // is, not just when standing next to it.
        const pack = w.packs.find((p) => !p.dead && p.file === file && p.rank === rank);
        const showPack = vis || (pack?.tier === 'boss' && seen);
        if (showPack) {
          if (pack) {
            const mat = armyMaterial(pack.army);
            const tint = threatTint(mat, playerMat);
            if (pack.stance === 'docile') sq.classList.add('ow-docile');
            const fig = document.createElement('i');
            fig.className = `ow-piece${vis ? '' : ' ow-landmark'}`;
            fig.style.backgroundImage = `url('${pieceImage(keyPieceType(pack.army), 'b')}')`;
            sq.appendChild(fig);
            const badge = document.createElement('span');
            badge.className = `ow-lvl ${pack.stance === 'docile' ? 'docile' : tint}${pack.skull ? ' skull' : ''}`;
            badge.textContent = String(mat);
            badge.title = `${pack.name} · ${pack.stance === 'docile' ? 'docile' : 'hostile'} · ${mat}`;
            sq.appendChild(badge);
          }
        }
        if (vis) {
          const npc = (w.npcs || []).find((n) => n.file === file && n.rank === rank);
          if (npc) {
            const fig = document.createElement('i');
            fig.className = 'ow-piece ow-npc';
            fig.style.backgroundImage = `url('${pieceImage(npc.type, WHITE)}')`;
            const tint = NPC_TINT[npc.role];
            if (tint) fig.style.filter = `hue-rotate(${tint.hue}deg) saturate(${tint.sat})`;
            sq.appendChild(fig);
            const tag = document.createElement('span');
            tag.className = 'ow-npc-tag';
            tag.textContent = npc.title;
            sq.appendChild(tag);
          }
          if (w.player.file === file && w.player.rank === rank) {
            const fig = document.createElement('i');
            fig.className = 'ow-piece ow-you';
            const skin = w.player.leader === 'k' ? kingSkin(state.run.king) : null;
            fig.style.backgroundImage = `url('${pieceImage(w.player.leader, WHITE, skin)}')`;
            sq.appendChild(fig);
            sq.classList.add('you');
          }
        }

        if (legalSet.has(key(file, rank))) sq.classList.add('ow-go');
        sq.addEventListener('click', () => onSquare(file, rank));
        board.appendChild(sq);
      }
    }
    updateFogGrid();
    sizeFogCanvas();
    paintQuestLog();
    paintInventoryDock();
  }

  function centerOnEl(el, behavior = 'smooth') {
    const port = $('ow-port');
    if (!el || !port) return;
    const y = el.offsetTop - port.clientHeight * 0.55 + el.offsetHeight / 2;
    const x = el.offsetLeft - port.clientWidth * 0.5 + el.offsetWidth / 2;
    port.scrollTo({ top: Math.max(0, y), left: Math.max(0, x), behavior });
  }

  function centerOnPlayer() {
    centerOnEl(document.querySelector('.ow-sq.you'));
  }

  function centerOnCell(file, rank, behavior = 'smooth') {
    centerOnEl(document.querySelector(`.ow-sq[data-file="${file}"][data-rank="${rank}"]`), behavior);
  }

  function onSquare(file, rank) {
    const w = world();
    if (!w || state.run.over) return;
    const vis = w.visible.has(key(file, rank));
    const npc = vis && (w.npcs || []).find((n) => n.file === file && n.rank === rank);
    if (npc) {
      // A town is small and safe — clicking a stall or a quest-giver opens
      // them straight away instead of making you walk over first.
      const canTalk = w.scene === 'town' || chebyshev(w.player, npc) === 1;
      openNpcSheet(npc, canTalk);
      return;
    }
    const pack = vis && (w.packs || []).find((p) => !p.dead && p.file === file && p.rank === rank);
    if (pack) {
      const canStep = legal.some((m) => m.file === file && m.rank === rank);
      openPackSheet(pack, { canStep });
      return;
    }
    const dest = legal.find((m) => m.file === file && m.rank === rank);
    if (!dest) {
      audio.illegal();
      return;
    }
    const result = movePlayer(w, file, rank);
    if (!result.ok) {
      audio.illegal();
      return;
    }
    audio.place();
    handleEvent(result.event);
  }

  function closePackSheet() {
    const host = $('ow-modal');
    if (!host) return;
    host.classList.add('hidden');
    host.innerHTML = '';
    host.onclick = null;
  }

  function beginClash(pack, aggressor) {
    const w = overworld();
    const enc = clashEncounter(w, pack, state.run, aggressor);
    audio.setMusicStyle('fight');
    playVersus(enc, () => campaign.openLoadout(enc));
  }

  function openPackSheet(pack, { canStep = false, onThem = false } = {}) {
    const host = $('ow-modal');
    if (!host) return;
    const info = packCard(pack, bagMaterial(state.run));
    const reach = onThem || canStep;
    host.classList.remove('hidden');
    host.innerHTML = `
      <div class="ow-card pack-card">
        <span class="pack-stance ${info.stance}">${info.stanceLine}</span>
        <h2>${info.name}</h2>
        <p class="pack-blurb">${info.blurb}</p>
        <p class="pack-roster">${info.roster}</p>
        <p class="pack-level ${info.tint}">Material ${info.material} · ${
          info.tint === 'safe' ? 'weaker than you' : info.tint === 'deadly' ? 'stronger than you' : 'even with you'
        }</p>
        ${reach
          ? `<button class="btn btn-gold" data-act="fight" type="button">Fight</button>`
          : `<p class="pack-reach">You cannot reach them from here.</p>`}
        <button class="btn btn-ghost" data-act="leave" type="button">${
          onThem ? 'Leave them' : 'Back'
        }</button>
      </div>`;
    host.onclick = (e) => {
      const act = e.target?.dataset?.act;
      if (!act) return;
      const w = world();
      if (act === 'leave') {
        closePackSheet();
        if (onThem) {
          bumpFromPack(w, pack);
          paintBoard();
          paintBlurb();
          centerOnPlayer();
        }
        return;
      }
      if (act !== 'fight') return;
      closePackSheet();
      if (onThem) {
        audio.click();
        beginClash(pack, 'player');
        return;
      }
      if (!canStep) {
        toast('You cannot reach them from here', 'danger');
        audio.illegal();
        return;
      }
      const result = movePlayer(w, pack.file, pack.rank, { fight: true });
      if (!result.ok) {
        audio.illegal();
        return;
      }
      audio.place();
      handleEvent(result.event);
    };
  }

  function handleEvent(event) {
    const w = world();
    if (!event) {
      paintBoard();
      paintBlurb();
      centerOnPlayer();
      return;
    }
    if (event.type === 'combat') {
      if (event.aggressor === 'enemy') {
        // Let the board actually show the pack stepping onto the leader
        // before the ambush overlay takes over, instead of cutting straight
        // to "AMBUSH" with no visible reason why.
        paintBoard();
        paintBlurb();
        centerOnPlayer();
        setTimeout(() => beginClash(event.pack, event.aggressor), 550);
        return;
      }
      beginClash(event.pack, event.aggressor);
      return;
    }
    if (event.type === 'meet') {
      paintBoard();
      paintBlurb();
      centerOnPlayer();
      openPackSheet(event.pack, { onThem: true, canStep: true });
      return;
    }
    if (event.type === 'shop') {
      campaign.openWorldShop({
        name: 'A Wayside Stall',
        blurb: 'Someone set a stall on the road north.',
      });
      return;
    }
    if (event.type === 'village') {
      enterTown(event);
      return;
    }
    if (event.type === 'exit') {
      leaveTown();
      return;
    }
    if (event.type === 'event') {
      campaign.openEvent(pickEvent(state.run));
      return;
    }
    if (event.type === 'sign') {
      const ow = overworld();
      const cell = cellAt(ow, ow.player.file, ow.player.rank);
      if (!cell?.spent) {
        cell.spent = true;
        const n = revealMapFragment(ow, ow.rng, 14);
        toast(`A sign. ${n} scraps of the road north come into view.`, 'good');
      } else {
        toast('You already read it.', '');
      }
      paintBoard();
      paintBlurb();
      centerOnPlayer();
      return;
    }
    if (event.type === 'ramp') {
      climbRamp();
      return;
    }
    if (event.type === 'decay') {
      state.run.hp -= OW.DECAY_HP;
      if (state.run.hp <= 0) {
        state.run.hp = 0;
        state.run.over = true;
        toast('The decay takes you', 'danger');
        campaign.abandon();
        return;
      }
      const pack = { file: w.player.file, rank: w.player.rank };
      bumpFromPack(w, pack);
      toast(`The decay burns. −${OW.DECAY_HP} HP. North, now.`, 'danger');
      campaign.paintRunHud();
      paintBoard();
      paintBlurb();
      centerOnPlayer();
      return;
    }
    paintBoard();
    paintBlurb();
    centerOnPlayer();
  }

  function enterTown(event) {
    const ow = overworld();
    const seed = event.seed || 1;
    state.run.town = generateTown(mulberry32(seed), event.biome || 'wood', ow.act, event.name, ow.player.leader);
    toast(`${state.run.town.name}.`, 'good');
    audio.place();
    show();
    setTimeout(() => tip('town', 'Click anyone here to talk, trade, or take work.'), 900);
  }

  function leaveTown() {
    state.run.town = null;
    toast('Back to the road.', '');
    audio.place();
    show();
  }

  function grantQuestReward(reward) {
    if (!reward) return;
    if (reward.gold) {
      state.run.gold += reward.gold;
      toast(`+${reward.gold}g`, 'good');
    }
    if (reward.piece) {
      const added = addToBag(state.run, reward.piece);
      const def = pieceById(reward.piece);
      toast(added ? `${def?.name || reward.piece} joins the bag` : 'No slot for the gift', added ? 'good' : 'danger');
    }
    if (reward.map) {
      const n = revealMapFragment(overworld(), overworld().rng, 16);
      toast(`${n} scraps of map.`, 'good');
    }
    campaign.paintRunHud();
  }

  function openNpcSheet(npc, canTalk) {
    const host = $('ow-modal');
    if (!host) return;
    const run = state.run;
    const live = (run.quests || []).find((q) => q.npcId === npc.id);
    const quest = live || npc.quest;
    const prog = quest ? questProgress(run, quest) : null;
    let body = `<p class="pack-blurb">${npc.blurb}</p>`;
    const actions = [];
    if (!canTalk) {
      body += `<p class="pack-reach">Walk next to them.</p>`;
    } else if (npc.role === 'inn') {
      const town = world();
      actions.push(`<button class="btn btn-gold" data-act="rest" type="button" ${town.rested ? 'disabled' : ''}>${town.rested ? 'Already rested' : 'Sit a while'}</button>`);
    } else if (npc.role === 'merchant') {
      actions.push(`<button class="btn btn-gold" data-act="shop" type="button">See the stall</button>`);
    } else if (npc.role === 'cartographer') {
      const cost = 3;
      actions.push(`<button class="btn btn-gold" data-act="map" type="button" ${run.gold < cost ? 'disabled' : ''}>Buy a fragment · ${cost}g</button>`);
    } else if (npc.role === 'quest' && quest) {
      if (quest.status === 'done') {
        body += `<p>They have nothing more for you.</p>`;
      } else if (quest.status === 'offer') {
        body += `<p class="pack-roster">${quest.title}</p><p>${quest.detail}</p>`;
        actions.push(`<button class="btn btn-gold" data-act="accept" type="button">Take the work</button>`);
      } else if (prog?.ready) {
        body += `<p class="pack-roster">${quest.title}</p><p>They nod. The work is done.</p>`;
        actions.push(`<button class="btn btn-gold" data-act="turnin" type="button">Collect</button>`);
      } else {
        body += `<p class="pack-roster">${quest.title}</p><p>${quest.detail}</p>`;
      }
    }
    actions.push(`<button class="btn btn-ghost" data-act="leave" type="button">Back</button>`);
    host.classList.remove('hidden');
    host.innerHTML = `
      <div class="ow-card pack-card">
        <span class="pack-stance docile">${npc.title}</span>
        <h2>${npc.name}</h2>
        ${body}
        ${actions.join('')}
      </div>`;
    host.onclick = (e) => {
      const act = e.target?.dataset?.act;
      if (!act) return;
      if (act === 'leave') { closePackSheet(); return; }
      if (!canTalk) { audio.illegal(); return; }
      if (act === 'rest') {
        const town = world();
        if (town.rested) { audio.illegal(); return; }
        closePackSheet();
        campaign.openWorldRest(npc.name, () => { town.rested = true; });
        return;
      }
      if (act === 'shop') {
        closePackSheet();
        campaign.openWorldShop({
          name: `${world().name} stall`,
          blurb: 'Gold for steel.',
        });
        return;
      }
      if (act === 'map') {
        const cost = 3;
        if (state.run.gold < cost) { audio.illegal(); return; }
        state.run.gold -= cost;
        const n = revealMapFragment(overworld(), overworld().rng, 18);
        toast(`${n} scraps of the north. −${cost}g`, 'good');
        audio.place();
        campaign.paintRunHud();
        closePackSheet();
        return;
      }
      if (act === 'accept' && npc.quest) {
        const q = { ...npc.quest, status: 'open' };
        if (q.kind === 'bounty') q.needKills = (state.run.packsKilled || 0) + 1;
        state.run.quests = state.run.quests || [];
        state.run.quests.push(q);
        npc.quest = q;
        toast('The work is yours.', 'good');
        audio.click();
        closePackSheet();
        paintQuestLog();
        return;
      }
      if (act === 'turnin') {
        const q = (state.run.quests || []).find((x) => x.npcId === npc.id);
        if (!q || !questProgress(state.run, q).ready) { audio.illegal(); return; }
        if (q.kind === 'tribute') {
          const pawn = (state.run.bag || []).find((p) => p.type === 'p');
          if (!pawn) { audio.illegal(); return; }
          removeFromBag(state.run, pawn.uid);
        }
        q.status = 'done';
        if (npc.quest) npc.quest.status = 'done';
        grantQuestReward(q.reward);
        audio.victory();
        closePackSheet();
        paintQuestLog();
      }
    };
  }

  function climbRamp() {
    const w = world();
    if (w.act >= 3) {
      state.run.over = true;
      state.run.won = true;
      campaign.finishRun();
      return;
    }
    state.run.voyage = generateWorld(state.run.rng, w.act + 1);
    audio.victory();
    showWithBossReveal(`Act ${w.act + 1} opens.`);
  }

  function hash2(ix, iy) {
    let n = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function fade(t) { return t * t * (3 - 2 * t); }
  function vnoise(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = fade(x - x0);
    const ty = fade(y - y0);
    const a = hash2(x0, y0);
    const b = hash2(x0 + 1, y0);
    const c = hash2(x0, y0 + 1);
    const d = hash2(x0 + 1, y0 + 1);
    return a + (b - a) * tx + (c - a) * ty + (d - b - c + a) * tx * ty;
  }
  function fbm(x, y) {
    return vnoise(x, y) * 0.55 + vnoise(x * 2.07, y * 2.07) * 0.3 + vnoise(x * 4.13, y * 4.13) * 0.15;
  }
  function fogAt(f, r) {
    if (f < 0 || r < 0 || f >= fogFiles || r >= fogRanks) return 0;
    const v = fogGrid[r * fogFiles + f];
    if (v === 0) return 0;
    if (v === 1) return 0.16;
    // Unexplored mist only on the rim of the known island, so the shader
    // shows through instead of a black (or grey) rectangle filling the map.
    for (let dr = -2; dr <= 2; dr++) {
      for (let df = -2; df <= 2; df++) {
        const rr = r + dr;
        const ff = f + df;
        if (rr < 0 || ff < 0 || rr >= fogRanks || ff >= fogFiles) continue;
        if (fogGrid[rr * fogFiles + ff] < 2) return 0.48;
      }
    }
    return 0;
  }
  function sampleCoverage(file, rank) {
    const f0 = Math.floor(file);
    const r0 = Math.floor(rank);
    const tf = file - f0;
    const tr = rank - r0;
    const a = fogAt(f0, r0);
    const b = fogAt(f0 + 1, r0);
    const c = fogAt(f0, r0 + 1);
    const d = fogAt(f0 + 1, r0 + 1);
    return a + (b - a) * tf + (c - a) * tr + (d - b - c + a) * tf * tr;
  }
  function updateFogGrid() {
    const w = world();
    if (!w) return;
    fogFiles = w.files;
    fogRanks = w.ranks;
    const n = fogFiles * fogRanks;
    if (!fogGrid || fogGrid.length !== n) fogGrid = new Uint8Array(n);
    for (let r = 0; r < w.ranks; r++) {
      for (let f = 0; f < w.files; f++) {
        const k = key(f, r);
        fogGrid[r * fogFiles + f] = w.visible.has(k) ? 0 : w.explored.has(k) ? 1 : 2;
      }
    }
  }
  function sizeFogCanvas() {
    const canvas = $('ow-fog');
    const w = world();
    if (!canvas || !w) return;
    const width = w.files * FOG_S;
    const height = w.ranks * FOG_S;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }
  function drawFog(now) {
    fogRaf = requestAnimationFrame(drawFog);
    const canvas = $('ow-fog');
    const screen = $('screen-overworld');
    if (!canvas || !fogGrid || screen?.classList.contains('hidden')) return;
    const ctx2 = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    if (!W || !H) return;
    const img = ctx2.createImageData(W, H);
    const data = img.data;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const t = reduce ? 0 : now * 0.0002;
    const ranks = fogRanks;
    const go = new Set(legal.map((m) => key(m.file, m.rank)));
    for (let y = 0; y < H; y++) {
      const displayRow = (y + 0.5) / FOG_S;
      const rankF = (ranks - 1) - displayRow;
      for (let x = 0; x < W; x++) {
        const fileF = (x + 0.5) / FOG_S;
        let cov = sampleCoverage(fileF, rankF);
        if (cov < 0.03) continue;
        const n = fbm(fileF * 0.82 + t, rankF * 0.82 - t * 0.55);
        const n2 = fbm(fileF * 0.26 + t * 0.32, rankF * 0.2 + t * 0.18);
        cov += (n - 0.5) * 0.46 + (n2 - 0.5) * 0.2;
        const cellKey = key(Math.floor(fileF + 1e-6), Math.floor(rankF + 1e-6));
        if (go.has(cellKey)) cov *= 0.28;
        if (cov < 0.04) continue;
        if (cov > 1) cov = 1;
        const i = (y * W + x) * 4;
        const swirl = n * 16;
        // Pale drifting mist, not a black wall — the shader behind is the sky.
        data[i] = 186 + swirl * 0.8;
        data[i + 1] = 198 + swirl * 0.6;
        data[i + 2] = 214 + swirl * 0.4;
        data[i + 3] = (cov * 118) | 0;
      }
    }
    ctx2.putImageData(img, 0, 0);
  }
  function ensureFog() {
    if (fogRaf) return;
    fogRaf = requestAnimationFrame(drawFog);
  }

  function playVersus(enc, done) {
    const overlay = $('ow-versus');
    if (!overlay) { done(); return; }
    const w = world();
    const youType = w?.player.leader || 'k';
    const youSkin = youType === 'k' ? kingSkin(state.run.king) : null;
    const youDef = pieceById(youType);
    const them = (enc.enemy || []).filter((e) => e.type !== 'k')
      .sort((a, b) => (pieceById(b.type)?.value || 0) - (pieceById(a.type)?.value || 0))[0]
      || enc.enemy?.[0];
    const themType = them?.type || 'p';
    const themDef = pieceById(themType);
    const ambush = enc.aggressor === 'enemy';

    $('vs-you-art').style.backgroundImage = `url('${pieceImage(youType, WHITE, youSkin)}')`;
    $('vs-you-name').textContent = youType === 'k' ? 'Your king' : `Your ${youDef?.name || youType}`;
    $('vs-you-sub').textContent = ambush ? 'Caught' : 'Strikes';
    $('vs-them-art').style.backgroundImage = `url('${pieceImage(themType, 'b')}')`;
    $('vs-them-name').textContent = enc.name || themDef?.name || 'Enemy';
    $('vs-them-sub').textContent = `Lv ${enc.material ?? armyMaterial(enc.enemy || [])}`;
    $('vs-label').textContent = ambush ? 'AMBUSH' : 'VS';

    overlay.classList.toggle('ambush', ambush);
    overlay.classList.remove('out', 'play', 'hidden');
    overlay.setAttribute('aria-hidden', 'false');
    void overlay.offsetWidth;
    overlay.classList.add('play');
    audio.place();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const hold = reduce ? 400 : 1680;
    setTimeout(() => {
      overlay.classList.add('out');
      setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.classList.remove('out', 'ambush');
        overlay.setAttribute('aria-hidden', 'true');
        done();
      }, reduce ? 0 : 420);
    }, hold);
  }

  /**
   * Click-and-drag panning for the mouse. Touch already scrolls the port
   * natively, so this only arms for mouse pointers — grabbing the map with a
   * finger would otherwise fight the browser's own touch-scroll. A real drag
   * captures the pointer so the square underneath never sees the click that
   * ends it; a plain tap that never crosses the threshold is untouched and
   * still moves the leader as it always has.
   */
  function initDragPan() {
    const port = $('ow-port');
    if (!port) return;
    const THRESHOLD = 4;
    let dragging = false;
    let captured = false;
    let startX = 0;
    let startY = 0;
    let startScrollX = 0;
    let startScrollY = 0;

    port.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      dragging = true;
      captured = false;
      startX = e.clientX;
      startY = e.clientY;
      startScrollX = port.scrollLeft;
      startScrollY = port.scrollTop;
    });
    port.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!captured) {
        if (Math.hypot(dx, dy) < THRESHOLD) return;
        captured = true;
        port.setPointerCapture(e.pointerId);
        port.classList.add('dragging');
      }
      port.scrollLeft = startScrollX - dx;
      port.scrollTop = startScrollY - dy;
    });
    const endDrag = (e) => {
      if (captured) port.releasePointerCapture(e.pointerId);
      dragging = false;
      captured = false;
      port.classList.remove('dragging');
    };
    port.addEventListener('pointerup', endDrag);
    port.addEventListener('pointercancel', endDrag);
  }

  $('btn-ow-quit')?.addEventListener('click', () => campaign.abandon());
  $('btn-ow-bag')?.addEventListener('click', () => campaign.openBag());
  $('ow-king')?.addEventListener('click', () => campaign.openBag());
  initDragPan();

  return { start, show, resumeFromWorld, onFightSettled };
}
