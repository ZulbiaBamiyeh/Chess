import {
  generateWorld, mulberry32, playerMoves, movePlayer, materialOf, armyMaterial,
  clashEncounter, OW, TERRAIN, revealAround, packRoster, packCard, stepEnemies,
} from '../js/overworld.js';
import { buildFight, createVoyageRun } from '../js/run.js';
import { BLACK } from '../js/chess.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

function world(seed = 1, act = 1) {
  return generateWorld(mulberry32(seed), act);
}

{
  const w = world(7);
  assert(w.files === OW.FILES, 'width');
  assert(w.ranks > 30, 'tall strip');
  assert(w.player.rank < 4, 'starts south');
  const floors = [];
  let ramp = 0;
  for (let r = 0; r < w.ranks; r++) {
    for (let f = 0; f < w.files; f++) {
      const c = w.cells[r][f];
      if (c.terrain !== TERRAIN.WALL && c.terrain !== TERRAIN.CHASM) floors.push([f, r]);
      if (c.poi === 'ramp') ramp++;
    }
  }
  assert(floors.length > 40, `enough floor, got ${floors.length}`);
  assert(ramp === 1, 'one ramp');
  assert(w.packs.length >= 8, `packs ${w.packs.length}`);
  const vis = [...w.visible];
  assert(vis.length >= 9, `starting vision ${vis.length}`);
  console.log('PASS  generate a branching strip with fog, packs and a ramp');
}

{
  const w = world(3);
  const moves = playerMoves(w);
  assert(moves.length >= 1, 'king can step');
  for (const m of moves) {
    assert(Math.max(Math.abs(m.file - w.player.file), Math.abs(m.rank - w.player.rank)) === 1, 'king step');
  }
  const dest = moves.find((m) => m.rank === w.player.rank + 1) || moves[0];
  const before = w.turns;
  const result = movePlayer(w, dest.file, dest.rank);
  assert(result.ok, 'move ok');
  assert(w.turns === before + 1, 'turn advanced');
  assert(w.player.file === dest.file && w.player.rank === dest.rank, 'moved');
  console.log('PASS  the leader moves by chess steps and the turn clock ticks');
}

{
  const w = world(11);
  w.player.leader = 'n';
  // Stand next to a wall with a floor two-and-one away.
  let jumped = false;
  for (const m of playerMoves(w)) {
    const df = Math.abs(m.file - w.player.file);
    const dr = Math.abs(m.rank - w.player.rank);
    if ((df === 1 && dr === 2) || (df === 2 && dr === 1)) jumped = true;
  }
  assert(jumped || playerMoves(w).length === 0, 'knight uses 2-1 leaps when any exist');
  console.log('PASS  a knight leader leaps 2–1');
}

{
  const w = world(5);
  w.grace = 2;
  w.turns = 1;
  const dest = playerMoves(w)[0];
  movePlayer(w, dest.file, dest.rank); // turns=2, grace=2, decay not yet
  assert(w.decayRank === -1, 'grace holds the decay');
  for (let i = 0; i < 12 && w.decayRank < 0; i++) {
    const step = playerMoves(w).find((m) => !w.packs.some((p) => !p.dead && p.file === m.file && p.rank === m.rank))
      || playerMoves(w)[0];
    if (!step) break;
    movePlayer(w, step.file, step.rank);
  }
  assert(w.decayRank >= 0, `decay started ${w.decayRank}`);
  console.log('PASS  the decay waits out its grace, then eats the south');
}

{
  assert(materialOf('p') === 1, 'pawn 1');
  assert(materialOf('n') === 3, 'knight 3');
  assert(materialOf('q') === 9, 'queen 9');
  assert(materialOf('k') === 0, 'king 0');
  const mat = armyMaterial([{ type: 'k' }, { type: 'p' }, { type: 'n' }]);
  assert(mat === 4, `levy material ${mat}`);
  console.log('PASS  combat level is chess material');
}

{
  const names = new Set();
  let docile = 0;
  let hostile = 0;
  for (const seed of [1, 2, 7, 9, 11, 13, 21, 42]) {
    const w = world(seed);
    for (const p of w.packs) {
      names.add(p.name);
      if (p.stance === 'docile') docile++;
      else hostile++;
      assert(p.blurb && p.blurb.length > 8, `blurb ${p.name}`);
    }
  }
  assert(names.size >= 6, `band names ${[...names].join(', ')}`);
  assert(docile > 0, 'some watches are docile');
  assert(hostile > docile, `hostile ${hostile} docile ${docile}`);
  const roster = packRoster([{ type: 'k' }, { type: 'p' }, { type: 'p' }, { type: 'n' }]);
  assert(roster.includes('King') && roster.includes('Pawn') && roster.includes('×2'), roster);
  const card = packCard({
    name: 'A Hired Watch', blurb: 'Paid to sit.', stance: 'docile',
    army: [{ type: 'k' }, { type: 'p' }], tier: 'trash',
  }, 3);
  assert(card.stance === 'docile' && card.stanceLine.includes('will not strike first'), card.stanceLine);
  console.log('PASS  packs have names, blurbs, and a docile watch');
}

{
  const w = world(9);
  const south = w.packs.filter((p) => p.rank / w.ranks < 0.32 && p.tier !== 'boss');
  assert(south.length >= 1, 'south packs exist');
  for (const p of south) {
    const bodies = (p.army || []).filter((x) => x.type !== 'k');
    assert(bodies.length >= 2 && bodies.length <= 3, `${p.name} bodies ${bodies.length}`);
    assert(bodies.every((x) => x.type === 'p'), `${p.name} ${packRoster(p.army)}`);
  }
  const run = createVoyageRun(9);
  run.voyage = w;
  const enc = clashEncounter(w, south[0], run, 'player');
  assert(enc.rules?.royalGuard === false, 'embark fights drop the enemy guard');
  const game = buildFight(run, enc, [{ uid: 'king', type: 'k', sq: 5 * 16 + 2 }]);
  assert(!game.kingGuarded(game.kings.b), 'their king is not escorted');
  console.log('PASS  the south is king-and-pawns, and their king has no guard');
}

{
  const w = world(7);
  const guard = w.packs.find((p) => p.stance === 'docile');
  assert(guard, 'a docile pack exists');
  for (const p of w.packs) if (p !== guard) p.dead = true;
  w.player.file = Math.max(0, guard.file - 1);
  w.player.rank = guard.rank;
  const events = [];
  for (let i = 0; i < 8; i++) events.push(...stepEnemies(w));
  assert(!events.some((e) => e.type === 'combat'), 'docile packs do not start fights');
  console.log('PASS  a hired watch will not hunt you');
}

{
  const w = world(9);
  const pack = w.packs[0];
  const run = { bag: [{ type: 'p' }, { type: 'p' }, { type: 'p' }] };
  const enc = clashEncounter(w, pack, run, 'enemy');
  assert(enc.firstMover === 'b', 'ambush: they move first');
  assert(enc.enemy.some((e) => e.type === 'k'), 'they bring a king');
  assert(enc.files >= 6 && enc.ranks >= 6, 'a real board');
  const enc2 = clashEncounter(w, pack, run, 'player');
  assert(enc2.firstMover === 'w', 'you struck first');
  console.log('PASS  clash boards carry terrain and first-move');
}

function pawnLaneOpen(enc) {
  const files = enc.files;
  const ranks = enc.ranks;
  for (let f = 0; f < files; f++) {
    let clear = true;
    for (let n = 1; n <= ranks; n++) {
      const tile = enc.terrain?.[`${String.fromCharCode(97 + f)}${n}`];
      if (tile === 'block' || tile === 'fire') { clear = false; break; }
    }
    if (clear) return true;
  }
  return false;
}

{
  const run = { bag: [{ type: 'p' }, { type: 'p' }, { type: 'p' }] };
  let closed = 0;
  for (const seed of [1, 2, 3, 5, 7, 9, 11, 13, 21, 42, 77, 99]) {
    const w = world(seed);
    for (const pack of w.packs.slice(0, 6)) {
      w.player.file = pack.file;
      w.player.rank = Math.max(0, pack.rank - 1);
      const enc = clashEncounter(w, pack, run, 'player');
      if (!pawnLaneOpen(enc)) closed++;
    }
  }
  assert(closed === 0, `pawn-blocked fights ${closed}`);
  console.log('PASS  clash boards keep a pawn-walkable north–south lane');
}

{
  // A 1-file jog copied from the overworld used to leave a gap three pawns
  // cannot cross. Force a wall-lined corridor, then check the fight opens it.
  const w = world(1);
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < w.files; f++) {
      w.cells[r][f].terrain = (f === 5) ? TERRAIN.FLOOR : TERRAIN.CHASM;
    }
  }
  w.player.file = 5;
  w.player.rank = 2;
  const pack = {
    id: 'test-jog', file: 5, rank: 3, army: [{ type: 'k' }, { type: 'p' }],
    name: 'Levy', theme: 'wood', tier: 'trash',
  };
  const enc = clashEncounter(w, pack, { bag: [{ type: 'p' }, { type: 'p' }, { type: 'p' }] }, 'player');
  assert(pawnLaneOpen(enc), `jog still blocked ${JSON.stringify(enc.terrain)}`);
  console.log('PASS  a narrow overworld corridor still yields a pawn crossing');
}

{
  const w = world(2);
  const startVis = w.visible.size;
  w.player.file = 5;
  w.player.rank = 12;
  revealAround(w, 5, 12, OW.VISION);
  assert(w.visible.size >= 9, 'vision refreshes');
  assert(w.explored.size >= startVis, 'explored never shrinks');
  console.log('PASS  fog reveals and remembers');
}

{
  const w = world(9);
  const pack = w.packs[0];
  const run = createVoyageRun(9);
  run.voyage = w;
  const enc = clashEncounter(w, pack, run, 'enemy');
  const game = buildFight(run, enc, [{ uid: 'king', type: 'k', sq: 5 * 16 + 2 }]);
  assert(game.turn === BLACK, `ambush turn ${game.turn}`);
  console.log('PASS  an ambush fight opens on Black’s move');
}

{
  const w = world(13);
  let steps = 0;
  for (let i = 0; i < 18; i++) {
    const moves = playerMoves(w);
    if (!moves.length) break;
    const north = moves.filter((m) => m.rank >= w.player.rank);
    const dest = north[0] || moves[0];
    const res = movePlayer(w, dest.file, dest.rank);
    assert(res.ok, `step ${i}`);
    steps++;
    if (res.event?.type === 'combat') break;
  }
  assert(steps >= 3, `walked ${steps}`);
  console.log('PASS  a walk north does not crash');
}

{
  const rare = new Set(['c', 'h', 'g', 'r', 'i', 'l', 'd', 'x', 'v', 'squirrel',
    's', 't', 'm', 'y', 'crossbow', 'reaper', 'lodestone', 'q', 'a', 'basilisk', 'colossus']);
  let blocked = 0;
  let prizes = 0;
  let bosses = 0;
  let kinds = new Set();
  for (const seed of [1, 2, 7, 9, 11, 13, 21, 42]) {
    const w = world(seed);
    const ramp = [];
    const loot = [];
    for (let r = 0; r < w.ranks; r++) {
      for (let f = 0; f < w.files; f++) {
        const c = w.cells[r][f];
        if (c.poi === 'ramp') ramp.push({ f, r });
        if (c.loot && (c.loot.skull || rare.has(c.loot.piece) || c.loot.relic)) prizes++;
      }
    }
    assert(ramp.length === 1, `ramp seed ${seed}`);
    const gate = w.packs.find((p) => !p.dead && p.file === ramp[0].f && p.rank === ramp[0].r);
    if (gate) bosses++;
    for (const p of w.packs) kinds.add(p.arch || p.name);
    // Path to ramp that never shares a square with a pack.
    const packAt = new Set(w.packs.filter((p) => !p.dead).map((p) => `${p.file},${p.rank}`));
    const q = [{ f: w.player.file, r: w.player.rank }];
    const seen = new Set([`${w.player.file},${w.player.rank}`]);
    let reach = false;
    while (q.length) {
      const cur = q.pop();
      const cell = w.cells[cur.r]?.[cur.f];
      if (cell?.poi === 'ramp' && !packAt.has(`${cur.f},${cur.r}`)) { reach = true; break; }
      for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nf = cur.f + df, nr = cur.r + dr;
        const k = `${nf},${nr}`;
        if (seen.has(k)) continue;
        const c2 = w.cells[nr]?.[nf];
        if (!c2) continue;
        if (c2.terrain === 'wall' || c2.terrain === 'chasm') continue;
        if (packAt.has(k)) continue;
        seen.add(k);
        q.push({ f: nf, r: nr });
      }
    }
    if (!reach) blocked++;
  }
  assert(bosses >= 6, `gate bosses ${bosses}/8`);
  assert(prizes >= 6, `wildy prizes ${prizes}`);
  assert(blocked >= 6, `must fight to leave ${blocked}/8`);
  assert(kinds.size >= 4, `archetypes ${[...kinds].join(',')}`);
  console.log('PASS  act 1 is gated, scavenged, and not a free walk north');
}

console.log('\nOverworld clean.');
