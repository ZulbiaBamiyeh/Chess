// Difficulty harness. The build harness asks "can several armies win?"; this
// asks the question the early game was failing: is a player with NO build —
// the starting bag, no relics — able to brute-force the rooms anyway?
//
// It plays each act's rooms with the real AI on both sides and reports the
// win rate of an unbuilt army, plus how long fights actually run against the
// turn clock. An early act that a bagless player clears every time is not a
// game yet.
//
//   node tools/difficulty.mjs            # act 1
//   node tools/difficulty.mjs --act 2 --games 3

import { createRun, buildFight, suggestLoadout, autoPlace, turnClock } from '../js/run.js';
import { ENCOUNTERS } from '../js/content.js';
import { chooseMove } from '../js/ai.js';
import { WHITE } from '../js/chess.js';

const args = process.argv.slice(2);
const ai = args.indexOf('--act');
const ACT = ai >= 0 ? Number(args[ai + 1]) : 1;
const gi = args.indexOf('--games');
const GAMES = gi >= 0 ? Number(args[gi + 1]) : 2;
const PROFILE = { depth: 3, budget: 150, slip: 0.06 };

const rooms = Object.values(ENCOUNTERS).filter((e) => e.act === ACT && !e.boss);

function play(enc, seed) {
  const run = createRun(seed);                 // starting bag, no relics
  // suggestLoadout picks WHICH pieces; autoPlace decides where they stand.
  const game = buildFight(run, enc, autoPlace(enc, suggestLoadout(run, enc)));
  const clock = turnClock(enc, run);
  let playerTurns = 0;
  for (let ply = 0; ply < clock * 2 + 4; ply++) {
    const out = game.outcome();
    if (out.over) return { won: out.winner === WHITE, turns: playerTurns };
    const mover = game.turn === WHITE ? PROFILE : (enc.ai || PROFILE);
    const move = chooseMove(game, mover);
    if (!move) return { won: false, turns: playerTurns, reason: 'stuck' };
    if (game.turn === WHITE) playerTurns++;
    game.move({ from: move.from, to: move.to, promotion: move.promotion });
    if (game.awaitingDuck) game.placeDuck(game.duckSquares()[0]);
    if (playerTurns >= clock) return { won: false, turns: playerTurns, reason: 'clock' };
  }
  return { won: false, turns: playerTurns, reason: 'cap' };
}

let wins = 0, total = 0, clockOuts = 0;
const turnsWhenWon = [];
const easy = [];
for (const enc of rooms) {
  let w = 0;
  for (let g = 0; g < GAMES; g++) {
    const r = play(enc, 1000 + g * 37);
    total++;
    if (r.won) { wins++; w++; turnsWhenWon.push(r.turns); }
    if (r.reason === 'clock') clockOuts++;
  }
  if (w === GAMES) easy.push(enc.id);
}
const pct = (n) => `${Math.round((n / total) * 100)}%`;
console.log(`Act ${ACT}: ${rooms.length} rooms x ${GAMES} plays, unbuilt starting bag.\n`);
console.log(`  win rate with no build   ${pct(wins)}  (${wins}/${total})`);
console.log(`  lost to the clock        ${pct(clockOuts)}`);
const avg = turnsWhenWon.length
  ? (turnsWhenWon.reduce((a, b) => a + b, 0) / turnsWhenWon.length).toFixed(1) : '-';
console.log(`  turns taken to win       ${avg}  (fastest ${Math.min(...turnsWhenWon, Infinity)})`);
console.log(`  rooms won every attempt  ${easy.length}/${rooms.length}${easy.length ? ' — ' + easy.join(', ') : ''}`);
