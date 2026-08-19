// Build harness. The piece harness answers "is this piece priced right"; this
// one answers the question that actually matters for a roguelike: can several
// DIFFERENT armies all beat the game, at roughly similar rates?
//
// Each archetype gets its relics and a bag that suits them, then plays real
// encounters from the book with the real AI on the other side. A healthy game
// has every archetype clustered — no single build that trivialises the run and
// none that cannot function.
//
//   node tools/builds.mjs
//   node tools/builds.mjs --games 3      # plays per encounter

import { createRun, buildFight, autoPlace, supplyBudget, deployBudget, costFor, suggestLoadout } from '../js/run.js';
import { ENCOUNTERS } from '../js/content.js';
import { chooseMove } from '../js/ai.js';
import { addToBag } from '../js/run.js';
import { WHITE } from '../js/chess.js';

const args = process.argv.slice(2);
const gi = args.indexOf('--games');
const PLAYS = gi >= 0 ? Number(args[gi + 1]) : 2;
const PROFILE = { depth: 3, budget: 150, slip: 0.06 };
const PLY_CAP = 90;

/** The archetypes a player could plausibly assemble by act 2. */
const BUILDS = {
  // Two relics each: an earlier version gave swarm and fire three and the
  // others two, which measured generosity rather than synergy.
  // Every bag is worth ~18 supply at base cost. The first pass at this handed
  // the "quality" build a bag worth 28 while swarm got 10, so it measured how
  // good the pieces were rather than how good the relics were.
  baseline: { relics: [], bag: ['p', 'p', 'n', 'b', 'r', 'f', 'w'] },
  swarm: { relics: ['muster', 'levy'], bag: ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'f', 'w', 'n'] },
  quality: { relics: ['warrant', 'heavystandard'], bag: ['q', 'r', 'n', 'p'] },
  frost: { relics: ['deepfreeze', 'icebound'], bag: ['i', 'i', 'b', 'n', 'p', 'p'] },
  fire: { relics: ['pyroclast', 'ashboots'], bag: ['l', 'l', 'b', 'n', 'p', 'p'] },
  cavalry: { relics: ['cavalry', 'farrier'], bag: ['n', 'n', 'c', 'z', 'h', 'p', 'p'] },
  martyr: { relics: ['vengefulash', 'bonetithe'], bag: ['y', 'x', 'v', 'b', 'p'] },
  reanimation: { relics: ['charnel', 'gravecall'], bag: ['reaper', 'reaper', 'n', 'p', 'p', 'p'] },
  volley: { relics: ['quiver', 'pavise'], bag: ['crossbow', 'crossbow', 'b', 'n', 'p', 'p'] },
  // Banners pay off on pieces that LACK a king step — a rook under a banner
  // is a Dragon King, a wazir is a Guard. Pairing them with pieces that
  // already step every way would measure nothing.
  formation: { relics: ['drillground', 'phalanx'], bag: ['banner', 'banner', 'r', 'r', 'w', 'w', 'p'] },
  relay: { relics: ['relay', 'postroad'], bag: ['courier', 'courier', 'r', 'n', 'p', 'p'] },
};

/** The yardstick. `--act 3` asks the harder question: does late content still
 *  threaten a build that has come together? */
const ai = args.indexOf('--act');
const ACT = ai >= 0 ? Number(args[ai + 1]) : 12;
const BOSSES = args.includes('--bosses');
const TRIALS = BOSSES
  ? ['marshal', 'quartermaster', 'steward', 'rimeguard', 'collector',
     'warden', 'conflagration', 'archivist', 'throne']
  : ACT === 3
    ? ['nightwatch', 'crucible', 'frostgate', 'parliament', 'lantern',
       'bulwark', 'stable', 'furnace', 'procession']
    : ['courtyard', 'bailey', 'kennels', 'cloister', 'dunes',
       'forge', 'gallery', 'reliquary', 'glacier'];

function makeRun(spec) {
  const run = createRun(20240818);
  run.relics = [...spec.relics];
  // By act 3 a player has been collecting all run, so the bag is roughly double
  // and supply actually binds again. Testing an act-3 budget against an act-1
  // bag measures nothing but which bag holds the best piece.
  if (ACT === 3 || BOSSES) spec = { ...spec, bag: [...spec.bag, ...spec.bag] };
  run.bag = [];
  for (const type of spec.bag) addToBag(run, type);
  // Slots can block exotic bags; the harness is testing armies, not slot maths.
  run.slots = { common: Infinity, rare: 99, epic: 99, legendary: 99 };
  run.bag = [];
  for (const type of spec.bag) addToBag(run, type);
  return run;
}

const pickLoadout = (run, enc) => suggestLoadout(run, enc);

function playOut(game, enc) {
  for (let ply = 0; ply < PLY_CAP; ply++) {
    const done = game.outcome();
    if (done.over) return done.winner || 'draw';
    // Faithful to the real game: you think at PROFILE, they think at whatever
    // the encounter specifies. Running both sides at one strength measured a
    // matchup the player never actually faces.
    // One profile for both sides. This sweep compares builds AGAINST EACH
    // OTHER, so a constant opponent is the controlled experiment; the act-3
    // profiles run to 2.4s a move, which is right in the game and hopeless in
    // a sweep. test/playthrough.mjs uses the real encounter AI, where
    // faithfulness is the point.
    const move = chooseMove(game, PROFILE);
    if (!move) return game.turn === WHITE ? 'b' : 'w';
    if (!game.move({ from: move.from, to: move.to, promotion: move.promotion })) return 'draw';
    if (game.awaitingDuck) game.placeDuck(game.duckSquares()[0]);
  }
  return 'draw';
}

console.log(`Builds vs ${TRIALS.length} encounters, ${PLAYS} plays each, depth ${PROFILE.depth}.\n`);
console.log('build      supply/deploy   win%   draw%   loss%   verdict');
console.log('-'.repeat(60));

const rows = [];
for (const [name, spec] of Object.entries(BUILDS)) {
  let w = 0, d = 0, l = 0;
  let sampleSupply = 0, sampleDeploy = 0;
  for (const encId of TRIALS) {
    const enc = ENCOUNTERS[encId];
    if (!enc) continue;
    for (let p = 0; p < PLAYS; p++) {
      const run = makeRun(spec);
      if (!sampleSupply) { sampleSupply = supplyBudget(run, enc); sampleDeploy = deployBudget(run, enc); }
      const load = pickLoadout(run, enc);
      const game = buildFight(run, enc, autoPlace(enc, load));
      const res = playOut(game, enc);
      if (res === 'w') w++; else if (res === 'b') l++; else d++;
    }
  }
  const n = w + d + l;
  const score = (w + d * 0.5) / n;
  let verdict = 'ok';
  if (score >= 0.78) verdict = 'DOMINANT';
  else if (score <= 0.22) verdict = 'UNPLAYABLE';
  else if (score >= 0.66) verdict = 'strong';
  else if (score <= 0.34) verdict = 'weak';
  rows.push({ name, score });
  const pct = (x) => String(Math.round((x / n) * 100)).padStart(4);
  console.log(`${name.padEnd(10)} ${String(sampleSupply).padStart(6)}/${String(sampleDeploy).padEnd(6)}`
    + ` ${pct(w)}%  ${pct(d)}%  ${pct(l)}%   ${verdict}`);
}

console.log('\nBy score rate:');
for (const r of rows.sort((a, b) => a.score - b.score)) {
  console.log(`  ${r.name.padEnd(10)} ${String(Math.round(r.score * 100)).padStart(3)}%  ${'#'.repeat(Math.round(r.score * 40))}`);
}
const spread = Math.max(...rows.map(r => r.score)) - Math.min(...rows.map(r => r.score));
console.log(`\nSpread across builds: ${Math.round(spread * 100)} points (tight is healthy).`);
