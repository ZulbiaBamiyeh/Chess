// Runs the search off the main thread so the shader background keeps flowing
// while the opponent thinks. main.js falls back to calling chooseMove()
// directly if a module worker cannot be constructed.

import { Chess } from './chess.js';
import { chooseMove, levelById } from './ai.js';

self.onmessage = (event) => {
  const { id, fen, level } = event.data;
  const result = chooseMove(new Chess(fen), levelById(level));
  self.postMessage({ id, result });
};
