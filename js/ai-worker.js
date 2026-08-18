// Runs the search off the main thread so the shader background keeps flowing
// while the opponent thinks. main.js falls back to calling chooseMove()
// directly if a module worker cannot be constructed.

import { Chess } from './chess.js';
import { chooseMove, levelById } from './ai.js';

self.onmessage = (event) => {
  const { id, spec, fen, level, levelId } = event.data;
  const game = spec ? new Chess(spec) : new Chess(fen);
  const preset = (level && typeof level === 'object') ? level : levelById(levelId ?? level);
  const result = chooseMove(game, preset);
  self.postMessage({ id, result });
};
