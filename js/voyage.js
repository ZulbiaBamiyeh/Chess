// The Chess-Vania overworld screen. Fog, a camera that follows the leader,
// roaming packs with combat-level badges, and the decay eating the south.

import { WHITE } from './chess.js';
import { pieceById } from './pieces.js';
import { pieceImage, kingSkin, toast } from './ui.js';
import { createVoyageRun, addToBag, REST_HEAL } from './run.js';
import { RELICS } from './relics.js';
import {
  generateWorld, playerMoves, movePlayer, clashEncounter, bagMaterial,
  armyMaterial, threatTint, leadersInBag, setLeader, villageRecruit,
  bumpFromPack, cellAt, TERRAIN, OW, key, packCard,
} from './overworld.js';

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

  function world() {
    return state.run?.voyage;
  }

  function start() {
    state.mode = 'run';
    state.world = 'voyage';
    state.run = createVoyageRun();
    state.playerColor = WHITE;
    state._hudPrev = null;
    state.run.voyage = generateWorld(state.run.rng, 1);
    show();
  }

  function show() {
    if (!world()) return;
    campaign.paintRunHud();
    paintBoard();
    paintLeaders();
    paintBlurb();
    showScreen('screen-overworld');
    audio.setMusicStyle('ambient');
    ensureFog();
    requestAnimationFrame(centerOnPlayer);
  }

  function resumeFromWorld() {
    if (state.run?.over) {
      campaign.abandon();
      return;
    }
    show();
  }

  function onFightSettled(reward) {
    const w = world();
    const packId = state.encounter?.packId;
    const pack = w?.packs.find((p) => p.id === packId);
    if (reward?.won && pack) pack.dead = true;
    else if (pack && !pack.dead) bumpFromPack(w, pack);
    if (state.run.over) {
      campaign.abandon();
      return;
    }
    if (reward?.won) {
      const cell = cellAt(w, w.player.file, w.player.rank);
      if (cell?.poi === 'ramp') {
        toast(`${state.encounter?.name || 'They'} fall. The ramp is open.`, 'good');
        climbRamp();
        return;
      }
      if (cell?.poi === 'loot' && cell.loot) {
        takeLoot(cell.loot);
        cell.loot = null;
        cell.poi = null;
      }
    }
    show();
    if (reward?.won) toast(`${state.encounter?.name || 'They'} fall`, 'good');
  }

  function paintBlurb() {
    const w = world();
    if (!$('ow-blurb') || !w) return;
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

  function paintLeaders() {
    const host = $('ow-leaders');
    if (!host) return;
    const w = world();
    host.innerHTML = '';
    for (const type of leadersInBag(state.run)) {
      const def = pieceById(type);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ow-leader' + (w.player.leader === type ? ' on' : '');
      const skin = type === 'k' ? kingSkin(state.run.king) : null;
      btn.style.backgroundImage = `url('${pieceImage(type, WHITE, skin)}')`;
      btn.title = type === 'k' ? 'Lead with the king' : `Lead with the ${def?.name || type}`;
      btn.addEventListener('click', () => {
        if (setLeader(w, type, state.run)) {
          audio.click();
          paintBoard();
          paintLeaders();
        }
      });
      host.appendChild(btn);
    }
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
    if (cell.terrain === TERRAIN.CHASM || cell.terrain === TERRAIN.WALL) bits.push('chasm');
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
            sq.insertAdjacentHTML('beforeend', `<i class="ow-poi" style="background-image:url('assets/ow-village.png')"></i>`);
          } else if (cell.poi === 'shop') {
            sq.insertAdjacentHTML('beforeend', `<i class="ow-poi" style="background-image:url('assets/ow-shop.png')"></i>`);
          } else if (cell.poi === 'ramp') {
            sq.insertAdjacentHTML('beforeend', `<i class="ow-poi" style="background-image:url('assets/ow-ramp.png')"></i>`);
          } else if (cell.poi === 'loot') {
            const skull = cell.loot?.skull;
            sq.insertAdjacentHTML('beforeend', `<i class="ow-loot${skull ? ' skull' : ''}">${skull ? '☠' : '✦'}</i>`);
          }
        }

        if (vis) {
          const pack = w.packs.find((p) => !p.dead && p.file === file && p.rank === rank);
          if (pack) {
            const mat = armyMaterial(pack.army);
            const tint = threatTint(mat, playerMat);
            if (pack.stance === 'docile') sq.classList.add('ow-docile');
            const fig = document.createElement('i');
            fig.className = 'ow-piece';
            fig.style.backgroundImage = `url('${pieceImage(pack.army[1]?.type || 'p', 'b')}')`;
            sq.appendChild(fig);
            const badge = document.createElement('span');
            badge.className = `ow-lvl ${pack.stance === 'docile' ? 'docile' : tint}${pack.skull ? ' skull' : ''}`;
            badge.textContent = String(mat);
            badge.title = `${pack.name} · ${pack.stance === 'docile' ? 'docile' : 'hostile'} · ${mat}`;
            sq.appendChild(badge);
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
  }

  function centerOnPlayer() {
    const you = document.querySelector('.ow-sq.you');
    const port = $('ow-port');
    if (!you || !port) return;
    const y = you.offsetTop - port.clientHeight * 0.55 + you.offsetHeight / 2;
    port.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  function onSquare(file, rank) {
    const w = world();
    if (!w || state.run.over) return;
    const vis = w.visible.has(key(file, rank));
    const pack = vis && w.packs.find((p) => !p.dead && p.file === file && p.rank === rank);
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
    const w = world();
    const enc = clashEncounter(w, pack, state.run, aggressor);
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
      openVillage(event.biome);
      return;
    }
    if (event.type === 'loot') {
      takeLoot(event.loot);
      paintBoard();
      paintBlurb();
      campaign.paintRunHud();
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

  function takeLoot(loot) {
    if (!loot) return;
    state.run.gold += loot.gold || 0;
    let line = loot.skull ? `A skull cache. +${loot.gold}g` : `A cache. +${loot.gold}g`;
    if (loot.piece) {
      const added = addToBag(state.run, loot.piece);
      const def = pieceById(loot.piece);
      line += added
        ? `. A ${def?.name || loot.piece} joins the bag.`
        : `. A ${def?.name || loot.piece} — no slot, left behind.`;
    }
    if (loot.relic && !state.run.relics.includes(loot.relic)) {
      state.run.relics.push(loot.relic);
      line += ` Relic: ${RELICS[loot.relic]?.name || loot.relic}.`;
    }
    toast(line, loot.skull ? 'danger' : 'good');
    audio.victory();
  }

  function openVillage(biome) {
    const offer = villageRecruit(biome);
    const host = $('ow-modal');
    if (!host) return;
    const def = pieceById(offer.type);
    host.classList.remove('hidden');
    host.innerHTML = `
      <div class="ow-card">
        <h2>${biome === 'frost' ? 'A frost hamlet' : biome === 'peak' ? 'A cinder camp' : 'A quiet village'}</h2>
        <p>They will house you for a night, or send someone with you.</p>
        <button class="btn btn-gold" data-act="heal">Rest · +${REST_HEAL} HP</button>
        <button class="btn btn-gold" data-act="hire" ${state.run.gold < offer.gold ? 'disabled' : ''}>
          Hire ${def?.name || offer.name} · ${offer.gold}g
        </button>
        <button class="btn btn-ghost" data-act="leave">Move on</button>
      </div>`;
    host.onclick = (e) => {
      const act = e.target?.dataset?.act;
      if (!act) return;
      if (act === 'heal') {
        state.run.hp = Math.min(state.run.hpMax, state.run.hp + REST_HEAL);
        toast('You sleep. The bag is still there in the morning.', 'good');
        audio.victory();
      } else if (act === 'hire') {
        if (state.run.gold < offer.gold) { audio.illegal(); return; }
        const added = addToBag(state.run, offer.type);
        if (!added) { toast('No slot for them', 'danger'); audio.illegal(); return; }
        state.run.gold -= offer.gold;
        toast(`${def.name} joins you`, 'good');
        audio.victory();
      }
      host.classList.add('hidden');
      host.onclick = null;
      campaign.paintRunHud();
      paintLeaders();
      paintBoard();
      paintBlurb();
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
    toast(`Act ${w.act + 1} opens.`, 'good');
    audio.victory();
    show();
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
    if (f < 0 || r < 0 || f >= fogFiles || r >= fogRanks) return 1;
    const v = fogGrid[r * fogFiles + f];
    return v === 0 ? 0 : v === 1 ? 0.22 : 1;
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
        data[i] = 7 + swirl * 0.25;
        data[i + 1] = 9 + swirl * 0.3;
        data[i + 2] = 14 + swirl * 0.45;
        data[i + 3] = (cov * 255) | 0;
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

  $('btn-ow-quit')?.addEventListener('click', () => campaign.abandon());
  const openBag = () => document.getElementById('btn-map-bag')?.click();
  $('btn-ow-bag')?.addEventListener('click', openBag);
  $('ow-king')?.addEventListener('click', openBag);

  return { start, show, resumeFromWorld, onFightSettled };
}
