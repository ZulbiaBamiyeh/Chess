import {
  generateWorld, generateTown, mulberry32, playerMoves, movePlayer, materialOf, armyMaterial,
  clashEncounter, OW, TERRAIN, revealAround, packRoster, packCard, stepEnemies,
  revealMapFragment, combinedDanger, chebyshev, key, parseKey,
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
  assert(docile > 0, 'some caravans are docile');
  assert(hostile > 0, 'some packs are still hostile');
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
  const south = w.packs.filter((p) => p.rank / Math.max(1, w.ranks - 1) < 0.4 && p.tier !== 'boss');
  assert(south.length >= 1, 'south packs exist');
  for (const p of south) {
    const bodies = (p.army || []).filter((x) => x.type !== 'k');
    assert(bodies.length >= 2 && bodies.length <= 3, `${p.name} bodies ${bodies.length}`);
    assert(bodies.every((x) => x.type === 'p'), `${p.name} ${packRoster(p.army)}`);
  }
  const run = createVoyageRun(9);
  run.voyage = w;
  const enc = clashEncounter(w, south[0], run, 'player');
  const game = buildFight(run, enc, [{ uid: 'king', type: 'k', sq: 5 * 16 + 2 }]);
  assert(game.kings.b >= 0, 'the enemy king is on the board');
  console.log('PASS  the south is king-and-pawns');
}

{
  let w = null;
  let guard = null;
  for (let seed = 0; seed < 60 && !guard; seed++) {
    w = world(seed);
    guard = w.packs.find((p) => p.stance === 'docile');
  }
  assert(guard, 'a docile pack exists across 60 seeds');
  for (const p of w.packs) if (p !== guard) p.dead = true;
  w.player.file = Math.max(0, guard.file - 1);
  w.player.rank = guard.rank;
  const events = [];
  for (let i = 0; i < 8; i++) events.push(...stepEnemies(w));
  assert(!events.some((e) => e.type === 'combat'), 'docile packs do not start fights');
  console.log('PASS  a hired watch will not hunt you');
}

{
  // Every pack moves one square at a time, same as the leader — a knight-
  // or rook-shaped roam archetype used to close distance in a single tick
  // no player move ever could.
  const w = world(3);
  let checked = 0;
  for (let step = 0; step < 15; step++) {
    const before = w.packs.filter((p) => !p.dead).map((p) => ({ id: p.id, file: p.file, rank: p.rank }));
    stepEnemies(w);
    for (const prior of before) {
      const now = w.packs.find((p) => p.id === prior.id);
      if (!now || now.dead) continue;
      const d = chebyshev(prior, now);
      assert(d <= 1, `${prior.id} moved ${d} squares in one step (roam ${now.arch})`);
      checked++;
    }
  }
  assert(checked > 0, 'no pack ever moved to check');
  console.log('PASS  packs move one square at a time, whatever their archetype');
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
    name: 'Levy', theme: 'wood', biome: 'peak', tier: 'trash',
  };
  const enc = clashEncounter(w, pack, { bag: [{ type: 'p' }, { type: 'p' }, { type: 'p' }] }, 'player');
  assert(pawnLaneOpen(enc), `jog still blocked ${JSON.stringify(enc.terrain)}`);
  console.log('PASS  a narrow overworld corridor still yields a pawn crossing');
}

{
  // Missing squares are a biome trait, not the default shape of a fight — a
  // clean board should be the norm. The exact same wall-heavy terrain should
  // yield holes in a biome that fits them and none in one that doesn't —
  // and only for a boss fight, where hazards are allowed to appear at all.
  const w = world(1, 2);
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < w.files; f++) {
      w.cells[r][f].terrain = (f === 5) ? TERRAIN.FLOOR : TERRAIN.WALL;
    }
  }
  w.player.file = 5;
  w.player.rank = 2;
  const bag = { bag: [{ type: 'p' }, { type: 'p' }, { type: 'p' }] };
  const woodPack = { id: 'wood-pack', file: 5, rank: 3, army: [{ type: 'k' }], name: 'Levy', biome: 'wood', tier: 'boss' };
  const peakPack = { id: 'peak-pack', file: 5, rank: 3, army: [{ type: 'k' }], name: 'Cinder Host', biome: 'peak', tier: 'boss' };
  const cleanEnc = clashEncounter(w, woodPack, bag, 'player');
  const holeEnc = clashEncounter(w, peakPack, bag, 'player');
  const blocks = (enc) => Object.values(enc.terrain).filter((t) => t === 'block').length;
  assert(blocks(cleanEnc) === 0, `wood board should have no holes, got ${blocks(cleanEnc)}`);
  assert(blocks(holeEnc) > 0, 'peak board should still have holes');
  console.log('PASS  fight-board holes are a biome trait, not the default');
}

{
  // Holes, frost and fire are reserved for boss fights — the exact same
  // hazard-heavy terrain should come back completely clean for a trash or
  // elite pack, in any act, in any biome.
  const w = world(1, 2);
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < w.files; f++) {
      w.cells[r][f].terrain = f === 5 ? TERRAIN.FROST : (f === 4 ? TERRAIN.EMBER : TERRAIN.WALL);
    }
  }
  w.player.file = 5;
  w.player.rank = 2;
  const bag = { bag: [{ type: 'p' }, { type: 'p' }, { type: 'p' }] };
  for (const biome of ['wood', 'frost', 'peak', 'gate']) {
    for (const tier of ['trash', 'elite']) {
      const pack = { id: `${biome}-${tier}-pack`, file: 5, rank: 3, army: [{ type: 'k' }], name: 'Test', biome, tier };
      const enc = clashEncounter(w, pack, bag, 'player');
      const hazards = Object.values(enc.terrain).filter((t) => t === 'block' || t === 'frost' || t === 'fire').length;
      assert(hazards === 0, `non-boss ${biome}/${tier} board had ${hazards} hazard tile(s)`);
    }
  }
  console.log('PASS  non-boss fights never carry holes, frost or fire');
}

{
  // A king should never generate walled off behind holes with no piece able
  // to reach it before a single move is made.
  const w = world(2, 2);
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < w.files; f++) {
      // A checkerboard of walls, dense enough that a king could plausibly
      // land somewhere the pawn lane never touches.
      w.cells[r][f].terrain = (f + r) % 2 === 0 ? TERRAIN.WALL : TERRAIN.FLOOR;
    }
  }
  w.player.file = 5;
  w.player.rank = 2;
  const bag = { bag: [{ type: 'p' }, { type: 'p' }, { type: 'p' }] };
  let checked = 0;
  for (let trial = 0; trial < 20; trial++) {
    const pack = {
      id: `gate-${trial}`, file: 5, rank: 3, biome: 'gate', tier: 'boss',
      army: [{ type: 'k' }, { type: 'p' }, { type: 'p' }], name: 'Test Boss',
    };
    const enc = clashEncounter(w, pack, bag, 'player');
    const kingSq = enc.enemy.find((e) => e.type === 'k')?.at;
    if (!kingSq) continue;
    checked++;
    // BFS from the whole south rank across everything but 'block'.
    const passable = (name) => enc.terrain[name] !== 'block';
    const seen = new Set();
    const queue = [];
    for (let f = 0; f < enc.files; f++) {
      const name = `${String.fromCharCode(97 + f)}1`;
      if (passable(name)) { seen.add(name); queue.push({ f, r: 1 }); }
    }
    let qi = 0;
    while (qi < queue.length) {
      const { f, r } = queue[qi++];
      for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nf = f + df;
        const nr = r + dr;
        if (nf < 0 || nr < 1 || nf >= enc.files || nr > enc.ranks) continue;
        const name = `${String.fromCharCode(97 + nf)}${nr}`;
        if (seen.has(name) || !passable(name)) continue;
        seen.add(name);
        queue.push({ f: nf, r: nr });
      }
    }
    assert(seen.has(kingSq), `enemy king at ${kingSq} is unreachable, trial ${trial}`);
  }
  assert(checked >= 15, `too few trials produced a king to check: ${checked}`);
  console.log('PASS  the enemy king is never walled off behind holes');
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
  let blocked = 0;
  let bosses = 0;
  let kinds = new Set();
  for (const seed of [1, 2, 7, 9, 11, 13, 21, 42]) {
    const w = world(seed);
    const ramp = [];
    for (let r = 0; r < w.ranks; r++) {
      for (let f = 0; f < w.files; f++) {
        const c = w.cells[r][f];
        if (c.poi === 'ramp') ramp.push({ f, r });
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
  assert(blocked >= 6, `must fight to leave ${blocked}/8`);
  assert(kinds.size >= 4, `archetypes ${[...kinds].join(',')}`);
  console.log('PASS  act 1 is gated and not a free walk north');
}

{
  const w = world(3);
  const towns = [];
  for (let r = 0; r < w.ranks; r++) {
    for (let f = 0; f < w.files; f++) {
      if (w.cells[r][f].poi === 'village') towns.push(w.cells[r][f]);
    }
  }
  assert(towns.length >= 1, `towns ${towns.length}`);
  const t = generateTown(mulberry32(towns[0].townSeed || 1), towns[0].biome || 'wood', 1, towns[0].townName);
  assert(t.scene === 'town', 'scene');
  assert(t.npcs.length >= 4, `npcs ${t.npcs.length}`);
  const roles = new Set(t.npcs.map((n) => n.role));
  assert(roles.has('merchant') && roles.has('cartographer') && roles.has('quest') && roles.has('inn'), [...roles].join());
  const n = revealMapFragment(w, w.rng, 12);
  assert(n >= 1, `fragment ${n}`);
  const firstHostile = w.packs.filter((p) => p.stance === 'hostile' && p.tier !== 'boss').sort((a, b) => a.rank - b.rank)[0];
  if (firstHostile) {
    assert(firstHostile.rank >= 8, `first fight at rank ${firstHostile.rank}`);
  }
  console.log('PASS  towns have a merchant, a courier, and work');
}

{
  // A map fragment reveals one connected patch of ground, not a scatter of
  // unrelated tiles spread across the whole act.
  let maxSpan = 0;
  let trials = 0;
  for (let seed = 0; seed < 25; seed++) {
    const w = world(seed);
    const before = new Set(w.explored);
    const n = revealMapFragment(w, w.rng, 16);
    if (n < 6) continue;
    let minF = Infinity, maxF = -Infinity, minR = Infinity, maxR = -Infinity;
    for (const k of w.explored) {
      if (before.has(k)) continue;
      const { file, rank } = parseKey(k);
      minF = Math.min(minF, file); maxF = Math.max(maxF, file);
      minR = Math.min(minR, rank); maxR = Math.max(maxR, rank);
    }
    const span = Math.max(maxF - minF, maxR - minR);
    maxSpan = Math.max(maxSpan, span);
    trials++;
  }
  assert(trials >= 15, `too few trials revealed enough to judge: ${trials}`);
  assert(maxSpan <= 12, `a fragment sprawled ${maxSpan} squares across — not a block`);
  console.log('PASS  a found map fragment is one block of ground, not scattered tiles');
}

{
  // The map is wider than the road: real, walkable width to either side of
  // the spine, not just a corridor with occasional dead-end branches. Any
  // single row can run thin by chance, so this checks the average across
  // the middle of the map rather than one sampled rank.
  let total = 0;
  let rows = 0;
  const w = world(5);
  for (let r = Math.floor(w.ranks * 0.25); r < w.ranks * 0.8; r += 2) {
    let open = 0;
    for (let f = 0; f < w.files; f++) {
      const c = w.cells[r][f];
      if (c.terrain !== TERRAIN.WALL && c.terrain !== TERRAIN.CHASM) open++;
    }
    total += open;
    rows++;
  }
  const avg = total / rows;
  assert(avg >= w.files * 0.3, `mid-map width only averages ${avg.toFixed(1)}/${w.files} walkable`);
  console.log('PASS  the road has real open width beside it, not just a corridor');
}

{
  // Wilderness danger: flat and safe near spawn no matter where you stand,
  // rises the further you stray from the spine once you're not brand new
  // to the act, and never exceeds the cap.
  const w = world(5);
  const southRank = Math.floor(w.ranks * 0.25);
  const sx0 = w.spine[southRank];
  const onSpine = combinedDanger(w, sx0, southRank);
  const offSpine = combinedDanger(w, Math.min(w.files - 1, sx0 + 6), southRank);
  assert(onSpine === offSpine, `south should be flat: ${onSpine} vs ${offSpine}`);

  const midRank = Math.floor(w.ranks * 0.6);
  const sx1 = w.spine[midRank];
  const near = combinedDanger(w, sx1, midRank);
  const far = combinedDanger(w, Math.min(w.files - 1, sx1 + 6), midRank);
  assert(far > near + 0.15, `wandering should raise danger: near ${near} far ${far}`);
  assert(far <= 1 && near <= 1, 'danger never exceeds its cap');
  console.log('PASS  danger is flat near spawn and rises when you wander off the road');
}

{
  // Packs should read as a spread wilderness, not a crowd — nothing placed
  // closer than the minimum spacing to anything else, across many seeds.
  let worst = Infinity;
  for (let seed = 0; seed < 40; seed++) {
    const w = world(seed);
    for (let i = 0; i < w.packs.length; i++) {
      for (let j = i + 1; j < w.packs.length; j++) {
        const d = chebyshev(w.packs[i], w.packs[j]);
        if (d < worst) worst = d;
      }
    }
  }
  assert(worst >= 4, `packs stood as close as ${worst} squares apart`);
  console.log('PASS  packs keep their distance instead of clumping together');
}

{
  // Events are hidden down side alleys, not sitting out on the open road —
  // every one should stand off the spine, and there should be a real spread
  // of them per act.
  let counts = [];
  let minDist = Infinity;
  for (let seed = 0; seed < 40; seed++) {
    const w = world(seed);
    let n = 0;
    for (let r = 0; r < w.ranks; r++) {
      for (let f = 0; f < w.files; f++) {
        if (w.cells[r][f].poi !== 'event') continue;
        n++;
        const d = Math.abs(f - w.spine[r]);
        if (d < minDist) minDist = d;
      }
    }
    counts.push(n);
  }
  assert(Math.min(...counts) >= 3, `some acts had too few events: ${Math.min(...counts)}`);
  assert(minDist >= 1, `an event sat right on the spine: distance ${minDist}`);
  console.log('PASS  events wait down side alleys, not out on the open road');
}

{
  // The boss's lair is revealed from the start, so there is always a
  // landmark to navigate toward.
  const w = world(4);
  assert(w.bossSpot, 'no bossSpot recorded');
  const boss = w.packs.find((p) => p.tier === 'boss');
  assert(boss.file === w.bossSpot.file && boss.rank === w.bossSpot.rank, 'bossSpot does not match the boss pack');
  assert(w.explored.has(key(boss.file, boss.rank)), 'the boss lair is not marked explored');
  console.log('PASS  the boss lair is revealed from the start, not fogged');
}

{
  // Bosses and elites are named individuals, not just a bigger faction tag.
  const genericTail = /(Band|Host|Watch|Camp|Court|Cache|Guard|Wing|Cohort|Raid|Screen|Horde|Riders|Column|March|Battery|Keep|Outriders|Hunt|Haul|Company)$/;
  let bossPersonal = 0;
  let bossTotal = 0;
  let elitePersonal = 0;
  let eliteTotal = 0;
  for (let seed = 0; seed < 30; seed++) {
    const w = world(seed);
    for (const p of w.packs) {
      if (p.tier === 'boss') {
        bossTotal++;
        if (!genericTail.test(p.name)) bossPersonal++;
      } else if (p.tier === 'elite') {
        eliteTotal++;
        if (!genericTail.test(p.name)) elitePersonal++;
      }
    }
  }
  assert(bossPersonal === bossTotal, `some bosses got a generic name: ${bossPersonal}/${bossTotal}`);
  assert(elitePersonal === eliteTotal, `some elites got a generic name: ${elitePersonal}/${eliteTotal}`);
  console.log('PASS  bosses and elites are named individuals');
}

console.log('\nOverworld clean.');
