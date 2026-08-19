// Balance harness. Plays AI-vs-AI duels at equal supply and reports how often
// each piece actually wins, so pricing is set by evidence rather than by feel.
//
// The method: give White the piece under test plus enough pawns to spend the
// same supply the reference army spends on pawns alone, then play the same
// matchup with the colours swapped so the first-move advantage cancels. A piece
// priced correctly should land near 50%. Anything far above that is underpriced
// for what it does.
//
//   node tools/balance.mjs                 # every collectible piece
//   node tools/balance.mjs i l g           # just these ids
//   node tools/balance.mjs --games 40      # more samples, tighter error bars

import { Chess, WHITE, BLACK } from '../js/chess.js';
import { PIECES } from '../js/pieces.js';
import { chooseMove } from '../js/ai.js';

const args = process.argv.slice(2);
const gamesFlag = args.indexOf('--games');
const GAMES = gamesFlag >= 0 ? Number(args[gamesFlag + 1]) : 24;
// A deploy cap limits BODIES the way supply limits POINTS. Without one, supply
// is the only constraint and the cheapest body always wins.
const deployFlag = args.indexOf('--deploy');
const DEPLOY = deployFlag >= 0 ? Number(args[deployFlag + 1]) : Infinity;
const only = args.filter((a) => !a.startsWith('--') && PIECES[a]);
const numeric = new Set(args.filter((a) => /^\d+$/.test(a)));

const bi = args.indexOf('--budget');
const FILES = 7;
const RANKS = 7;
// Default 8 kept the expensive pieces out of the sample entirely — the Queen
// costs 9, so it was never measured at all.
const BUDGET = bi >= 0 ? Number(args[bi + 1]) : 8;
const MOVE_CAP = 70;           // plies before the duel is called a draw
const PROFILE = { depth: 3, budget: 120, slip: 0.12 };

const emptyRow = (n) => String(n);
const emptyFen = () =>
  Array.from({ length: RANKS }, () => emptyRow(FILES)).join('/') + ' w - - 0 1';

/** Home squares, back rank first then the rank in front, centre outward. */
function homeSquares(color) {
  const rows = color === WHITE ? [RANKS - 1, RANKS - 2] : [0, 1];
  const mid = (FILES - 1) / 2;
  const cols = [...Array(FILES).keys()]
    .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  const out = [];
  for (const row of rows) for (const col of cols) out.push(row * 16 + col);
  return out;
}

/** The piece under test, topped up with pawns to exactly fill the budget. */
function armyFor(id) {
  const cost = PIECES[id].cost;
  if (cost > BUDGET) return null;
  const fill = Math.max(0, Math.min(BUDGET - cost, DEPLOY - 1));
  return [id, ...Array(fill).fill('p')];
}

/**
 * The yardstick: a sensible mixed army that fills its slots and spends its
 * budget. A flat wall of pawns is only a fair comparison at low budgets — at
 * 16 supply it left ten points unspent, which flattered anything expensive.
 */
function referenceArmy() {
  const ladder = ['n', 'b', 'n', 'b', 'r', 'n', 'b', 'r'];
  const army = [];
  let spent = 0;
  const slots = Math.min(DEPLOY, BUDGET);
  for (const type of ladder) {
    if (army.length >= slots) break;
    const c = PIECES[type].cost;
    if (spent + c > BUDGET) continue;
    army.push(type);
    spent += c;
  }
  while (army.length < slots && spent + 1 <= BUDGET) { army.push('p'); spent += 1; }
  return army;
}

const REFERENCE = referenceArmy();

function build(whiteArmy, blackArmy, rng) {
  const game = new Chess({
    fen: emptyFen(),
    files: FILES,
    ranks: RANKS,
    rules: { kingCapture: true },
  });

  for (const [color, army] of [[WHITE, whiteArmy], [BLACK, blackArmy]]) {
    const slots = homeSquares(color);
    // Jitter the layout so repeated duels are not one identical game.
    const shuffled = slots.slice(1);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const order = [slots[0], ...shuffled];
    game.board[order[0]] = { type: 'k', color };
    game.kings[color] = order[0];
    army.forEach((type, i) => {
      const sq = order[i + 1];
      if (sq !== undefined) game.board[sq] = { type, color };
    });
  }
  game.turn = WHITE;
  game.refreshMode();
  return game;
}

/** Plays one duel out. Returns 'w', 'b' or 'draw'. */
function playOut(game) {
  for (let ply = 0; ply < MOVE_CAP; ply++) {
    const done = game.outcome();
    if (done.over) return done.winner || 'draw';
    const move = chooseMove(game, PROFILE);
    if (!move) return game.turn === WHITE ? 'b' : 'w';
    const played = game.move({ from: move.from, to: move.to, promotion: move.promotion });
    if (!played) return 'draw';
    if (game.awaitingDuck) game.placeDuck(game.duckOptions()[0]);
  }
  return 'draw';
}

/** Deterministic-ish RNG so a report can be reproduced. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ids = (only.length ? only : Object.keys(PIECES))
  .filter((id) => id !== 'k' && PIECES[id].cost <= BUDGET);

console.log(`Duels: ${GAMES} per piece, ${BUDGET} supply a side, `
  + `deploy cap ${DEPLOY === Infinity ? 'none' : DEPLOY}, ${FILES}x${RANKS}, `
  + `depth ${PROFILE.depth}. Reference: ${REFERENCE.join('')}.\n`);
console.log('piece         cost  value   win%   draw%   loss%   verdict');
console.log('-'.repeat(66));

const rows = [];
for (const id of ids) {
  const army = armyFor(id);
  if (!army) continue;
  let wins = 0, draws = 0, losses = 0;
  const rng = makeRng(0xC0FFEE + id.charCodeAt(0) * 7919);

  for (let g = 0; g < GAMES; g++) {
    // Half the duels with the tested piece as White, half as Black.
    const asWhite = g % 2 === 0;
    const game = asWhite ? build(army, REFERENCE, rng) : build(REFERENCE, army, rng);
    const result = playOut(game);
    const testedWon = asWhite ? result === 'w' : result === 'b';
    const testedLost = asWhite ? result === 'b' : result === 'w';
    if (result === 'draw') draws++;
    else if (testedWon) wins++;
    else if (testedLost) losses++;
  }

  const pct = (n) => ((n / GAMES) * 100).toFixed(0).padStart(4);
  const winRate = wins / GAMES;
  const scoreRate = (wins + draws * 0.5) / GAMES;
  let verdict = 'ok';
  if (scoreRate >= 0.80) verdict = 'OVERPOWERED';
  else if (scoreRate >= 0.68) verdict = 'strong';
  else if (scoreRate <= 0.20) verdict = 'WEAK';
  else if (scoreRate <= 0.32) verdict = 'soft';

  rows.push({ id, name: PIECES[id].name, cost: PIECES[id].cost, scoreRate });
  console.log(
    `${(PIECES[id].name + ' (' + id + ')').padEnd(14)}`
    + `${String(PIECES[id].cost).padStart(3)}`
    + `${String(PIECES[id].value).padStart(7)}`
    + `${pct(wins)}%  ${pct(draws)}%  ${pct(losses)}%   ${verdict}`,
  );
}

console.log('\nBy score rate (win + half draws), worst to best:');
for (const r of rows.sort((a, b) => a.scoreRate - b.scoreRate)) {
  const bar = '#'.repeat(Math.round(r.scoreRate * 40));
  console.log(`  ${r.name.padEnd(11)} c${String(r.cost).padStart(2)}  ${(r.scoreRate * 100).toFixed(0).padStart(3)}%  ${bar}`);
}
