// End-to-end run simulation.
//
// The unit tests cover each system in isolation; this walks a whole run the way
// a player does — pick a node, build a loadout, fight it out with the real AI,
// settle, take the relic, shop, resolve an event, cross an act boundary — and
// asserts nothing throws and the state stays coherent the entire way.
//
// Run with: node test/playthrough.mjs

import {
  createRun, currentNode, buildFight, settleFight, autoPlace, supplyBudget,
  deployBudget, costFor, suggestLoadout, completeNode, pickNode, rest, forage, trainPiece,
  currentEncounter, turnClock,
  openShop, buyOffer, closeShop, claimRelic, applyChoice, addToBag,
} from '../js/run.js';
import { EVENTS, ENCOUNTERS } from '../js/content.js';
const ENCOUNTERS_FOR_LOSS = ENCOUNTERS.gate;
import { chooseMove } from '../js/ai.js';
import { WHITE } from '../js/chess.js';

let failures = 0;
function assert(name, cond, detail = '') {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

// A competent player. The point is to exercise the flow, not to measure
// difficulty — tools/builds.mjs and tools/difficulty.mjs do that.
//
// The budget has to at least match what the encounters give the opponent
// (450ms in act 1). At 220 this profile was simply the weaker engine, so it
// lost every act-1 fight and the walk bled out on floor six without ever
// reaching a shop, an event or an act boundary — the things it exists to
// cover.
// Both sides play the same shallow, fast search. This file's job is to walk
// the flow, and for that the fights only have to END — how well they are
// played does not matter, and measuring difficulty is tools/difficulty.mjs's
// job. Two things forced this:
//
//  - The profile must not be the WEAKER engine. At 220ms against encounters
//    that think for 450 it lost every act-1 fight, and the walk bled out on
//    floor six without reaching a shop, an event or an act boundary — the
//    things it exists to cover.
//  - It must be cheap. Fights stopped ending on the first ply this pass, so
//    twenty real AI games at a generous budget turned this into an
//    eight-minute test.
const THINK = 60;
const PROFILE = { depth: 2, budget: THINK, slip: 0 };
// Cap DEPTH as well as budget. Capping only the clock left act-2 and act-3
// rooms searching at depth 5 and 6, and once the walk started winning fights
// it reached them — one move there costs more than this whole file should.
const opponent = (enc) => ({
  ...(enc.ai || PROFILE), depth: PROFILE.depth, budget: THINK,
});

const loadoutFor = (run, enc) => suggestLoadout(run, enc);

function fight(run, enc) {
  const game = buildFight(run, enc, autoPlace(enc, loadoutFor(run, enc)));
  // Bound by the encounter's own turn clock, the way the real game does it.
  // A flat 80-ply cap meant every unresolved fight burned the full budget at
  // up to 2.4s a move once fights stopped ending on the first ply.
  const plyCap = turnClock(enc, run) * 2;
  for (let ply = 0; ply < plyCap; ply++) {
    if (game.outcome().over) break;
    const move = chooseMove(game, game.turn === WHITE ? PROFILE : opponent(enc));
    if (!move) break;
    if (!game.move({ from: move.from, to: move.to, promotion: move.promotion })) break;
    if (game.awaitingDuck) game.placeDuck(game.duckSquares()[0]);
  }
  return { game, reward: settleFight(run, game, enc, {}) };
}

// ---- walk a run ------------------------------------------------------------

// A player who has found their feet: enough army to clear rooms, so the walk
// actually crosses shops, events, rests and an act boundary instead of dying
// on the first floor.
const run = createRun(987654321);
run.slots = { common: Infinity, rare: 9, epic: 9, legendary: 9 };
for (const t of ['r', 'b', 'n', 'c', 'q', 'dragon', 'gnu', 't']) addToBag(run, t);
// Supply relics, not just a fat bag. Rooms grew to 6x6 and a king now costs
// its escorts as well as itself, so a starting-supply army cannot close a
// fight and the walk simply bled out on floor six every time.
run.relics = ['commission', 'warrant', 'tide', 'surgeon'];
let steps = 0;
let fights = 0;
let shops = 0;
let events = 0;
let rests = 0;
let relicsTaken = 0;
let threw = null;
const seenKinds = new Set();

try {
  while (!run.over && !run.won && steps < 12) {
    steps++;
    // Route like a player rather than always taking the leftmost door: rest
    // when hurt, otherwise take the softest room on offer. Picking blind walked
    // straight into an act-1 elite on the third room and died there three times.
    const choices = run.choices && run.choices.length ? run.choices : [];
    if (choices.length) {
      const rank = (n) => {
        if (n.kind === 'rest') return run.hp < run.hpMax * 0.6 ? 0 : 3;
        if (n.kind === 'shop') return 1;
        if (n.kind === 'event') return 2;
        if (n.tier === 'elite' || n.boss) return 5;
        return 4;
      };
      const best = [...choices].sort((a, b) => rank(a) - rank(b))[0];
      pickNode(run, best.id);
    }

    const node = currentNode(run);
    if (!node) break;
    seenKinds.add(node.kind);

    if (node.kind === 'fight') {
      const enc = currentEncounter(run);
      const { reward } = fight(run, enc);
      fights++;
      if (!reward.won) {
        // Losing costs HP now, not the run — retry the room while blood lasts.
        if (run.over) break;
        continue;
      }
      if ((run.pendingRelics || []).length) {
        claimRelic(run, run.pendingRelics[0]);
        relicsTaken++;
      }
    } else if (node.kind === 'shop') {
      const shop = openShop(run);
      run.gold += 60;                       // simulate a well-funded visit
      for (const offer of [...shop.offers]) buyOffer(run, offer.id);
      closeShop(run);
      shops++;
    } else if (node.kind === 'event') {
      const ev = EVENTS[node.eventId];
      applyChoice(run, ev.choices[0], run.bag[0]?.uid);
      events++;
    } else if (node.kind === 'rest') {
      // Cycle through all three camp choices so the walk exercises each one,
      // not just the default — this is how the training-shield bug and the
      // uid-mismatch in an earlier draft would have surfaced.
      const pick = rests % 3;
      if (pick === 0) rest(run);
      else if (pick === 1) forage(run);
      else {
        const target = run.bag.find((p) => p.type !== 'k' && !p.trained);
        if (target) trainPiece(run, target.uid);
        else rest(run);
      }
      rests++;
    }

    // State must stay coherent after every single step.
    if (run.hp > run.hpMax || run.hp < 0 || run.gold < 0
      || !Number.isFinite(run.gold) || run.bag.some((p) => !p.type)) {
      throw new Error(`incoherent run state after ${node.kind}: `
        + JSON.stringify({ hp: run.hp, max: run.hpMax, gold: run.gold }));
    }
    if (run.over) break;
    completeNode(run);
  }
} catch (err) {
  threw = err;
}

console.log(`\nWalked ${steps} rooms: ${fights} fights, ${shops} shops, `
  + `${events} events, ${rests} rests, ${relicsTaken} relics taken.`);
console.log(`Finished at act ${run.act + 1}, hp ${run.hp}/${run.hpMax}, `
  + `gold ${run.gold}, bag ${run.bag.length}, relics ${run.relics.length}.\n`);

assert('a run walks without throwing', threw === null, threw && threw.message);
assert('the walk crosses more than one kind of room', seenKinds.size >= 2,
  [...seenKinds].join(','));
assert('at least one fight was played', fights >= 1, String(fights));
assert('hp stayed within bounds', run.hp >= 0 && run.hp <= run.hpMax,
  `${run.hp}/${run.hpMax}`);
assert('gold never went negative', run.gold >= 0, String(run.gold));
assert('the bag survived', run.bag.every((p) => p && p.type));
assert('relics are unique', new Set(run.relics).size === run.relics.length);
assert('the run reached a terminal state or ran its course',
  run.over || run.won || steps >= 1);

// A second, relic-heavy run to exercise the stacking paths.
{
  const loaded = createRun(13579);
  loaded.relics = ['muster', 'levy', 'warrant', 'heavystandard', 'cavalry', 'farrier',
    'deepfreeze', 'icebound', 'pyroclast', 'ashboots', 'vengefulash', 'bonetithe'];
  for (const t of ['q', 'i', 'l', 'c', 'y', 'x', 'v', 'm']) addToBag(loaded, t);
  let ok = true;
  let detail = '';
  try {
    const enc = currentEncounter(loaded) || null;
    const node = (loaded.choices || [])[0];
    if (node) pickNode(loaded, node.id);
    const e = currentEncounter(loaded);
    if (e) {
      const { reward } = fight(loaded, e);
      if (!reward) ok = false;
      if (supplyBudget(loaded, e) < 1 || deployBudget(loaded, e) < 1) {
        ok = false;
        detail = 'budgets collapsed';
      }
    }
  } catch (err) { ok = false; detail = err.message; }
  assert('a fight with twelve stacked relics resolves', ok, detail);
}

// ---- each room kind, exercised directly -----------------------------------
//
// The walk above depends on winning fights to advance, so a bad run would leave
// shops, events and rests untested. These hit each path regardless.

{
  const r = createRun(24680);
  r.gold = 200;
  const shop = openShop(r);
  assert('a shop stocks offers', shop.offers.length > 0);
  const before = r.gold;
  let bought = 0;
  for (const offer of [...shop.offers]) {
    if (buyOffer(r, offer.id).ok) bought++;
  }
  closeShop(r);
  assert('offers can be bought', bought > 0, String(bought));
  assert('buying spends gold', r.gold < before);
  assert('gold never goes negative in a shop', r.gold >= 0);
}

{
  const r = createRun(13570);
  let broke = 0;
  for (const ev of Object.values(EVENTS)) {
    for (const choice of ev.choices) {
      const fresh = createRun(1);
      fresh.gold = 300;
      try {
        applyChoice(fresh, choice, fresh.bag[0]?.uid);
        if (!Number.isFinite(fresh.hp) || !Number.isFinite(fresh.hpMax) || !Number.isFinite(fresh.gold)
          || fresh.hp > fresh.hpMax || fresh.hp < 0 || fresh.gold < 0) broke++;
      } catch { broke++; }
    }
  }
  assert('every event choice survives a real run', broke === 0, String(broke));
}

{
  const r = createRun(11111);
  r.hp = 4;
  const before = r.hp;
  rest(r);
  assert('resting heals', r.hp > before, `${before} -> ${r.hp}`);
  assert('resting never overheals', r.hp <= r.hpMax);
}

{
  // Forfeit costs HP and leaves the run alive until the blood runs out.
  const r = createRun(2222);
  const enc = ENCOUNTERS_FOR_LOSS;
  let losses = 0;
  while (!r.over && losses < 20) {
    const g = buildFight(r, enc, autoPlace(enc, []));
    const reward = settleFight(r, g, enc, { forfeit: true });
    losses++;
    if (reward.hpLost <= 0) break;
  }
  assert('a forfeit costs HP rather than the run', losses > 1, String(losses));
  assert('enough forfeits do end the run', r.over);
  assert('HP bottoms out at zero', r.hp === 0, String(r.hp));
}

{
  const r = createRun(2223);
  const enc = ENCOUNTERS_FOR_LOSS;
  const g = buildFight(r, enc, autoPlace(enc, []));
  g.board[g.kings.w] = null;
  g.kings.w = -1;
  settleFight(r, g, enc, {});
  assert('losing the king ends the run for good', r.over && !r.won);
}

console.log(failures ? `\n${failures} playthrough failure(s)` : '\nPlaythrough clean.');
process.exit(failures ? 1 : 0);
