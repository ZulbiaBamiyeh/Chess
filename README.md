# GAMBIT

A browser chess game with hand-drawn pieces, a live shader background and
sound that is synthesized as you play. This is the **baseline**: complete,
correct chess against a real opponent. Shops, relics and enemy encounters go
on top of it.

Play it at
**[zulbiabamiyeh.github.io/Chess](https://zulbiabamiyeh.github.io/Chess/)**,
or run it locally (see below). Every push deploys through GitHub Actions.

## What's in it

- **Every rule.** Castling (including the "may not castle through check"
  cases), en passant, under-promotion, check, checkmate, stalemate, and draws
  by threefold repetition, the fifty-move rule and insufficient material.
  Verified against the standard perft counts — see [Testing](#testing).
- **Five opponents**, Pawn through Queen, from a two-ply glance to a
  seven-ply search. They run in a Web Worker, so the background keeps flowing
  while they think.
- **Drag or click** to move. Legal squares show a dot, captures a ring,
  and an illegal drop flashes the square red and thuds.
- **Take-backs** (<kbd>U</kbd>) rewind your move and the reply together, so you
  can explore a line. <kbd>F</kbd> flips the board, <kbd>N</kbd> starts over.
- **Move list** in algebraic notation, capture trays and a live material count.

## About the assets

- **Pieces and board** — the supplied hand-drawn art pack, baked into game
  sprites by `tools/build-assets.py`. That script does two things worth
  knowing about:
  - It **recolours the board**. In the source art the dark squares and the
    black pieces are nearly the same brown, so a black knight on a dark square
    almost vanished. The dark squares are deepened to an espresso and the
    linework cooled, which keeps the hand-drawn wobble but gives both sets
    something to stand against.
  - It **normalises the pieces**. Each drawing floats at a different place
    inside its 500x500 frame; the script crops each to its ink, scales it to a
    per-type height (pawns short, the king towering) and bottom-aligns it on a
    common baseline, so a rank of pieces stands in a straight line.
- **Background** — a WebGL fragment shader (`js/bg.js`) rendering
  domain-warped fbm noise, the same liquid-marble swirl as
  [Hokm Night](https://github.com/ZulbiaBamiyeh/Game-2). Falls back to a CSS
  gradient where WebGL is unavailable.
- **Sound** — all synthesized at runtime with the Web Audio API
  (`js/audio.js`), no audio files. Each board sound is built from the three
  things a real piece makes when it meets a board: a wooden body resonance, a
  click of lacquer on lacquer and a low thump through the table. The music is a
  generative ambient bed — a slow chord cycle on a filtered pad with sparse
  plucks — so it drifts rather than loops, and it ducks under the bigger
  stingers.
- **Fonts** — [Silkscreen](https://fonts.google.com/specimen/Silkscreen) and
  [Baloo 2](https://fonts.google.com/specimen/Baloo+2), bundled in `fonts/` and
  served locally, both under the SIL Open Font License; see `fonts/OFL.txt`.

Nothing is fetched from a third party at runtime — the page loads only its own
files.

## Running it

The game uses ES modules and a module worker, so open it through a local static
server rather than a bare `file://` path:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000/
```

Append `?fen=...` to start from a specific position — useful for testing an
ending, and the hook the encounter generator will use later:

```
http://localhost:8000/?fen=4k3/P7/8/8/8/8/8/4K3 w - - 0 1
```

## Testing

`test/perft.mjs` counts the leaf nodes of the move tree to a fixed depth and
compares them against the published values for six standard positions. If move
generation, castling, en passant, promotion or check evasion is wrong anywhere,
the numbers diverge immediately.

```bash
node test/perft.mjs
```

All 26 cases pass, including Kiwipete to depth 4 (4,085,603 nodes).

## Rebuilding the sprites

Only needed if the source art changes. Requires Pillow.

```bash
python3 tools/build-assets.py path/to/chesspack
```

## Project layout

```
index.html          Page shell / screens / modals
css/style.css       Theme, layout, board, animations
assets/             Baked board and piece sprites
fonts/              Bundled OFL fonts + license
js/chess.js         Rules engine — 0x88 board, move generation, SAN, draws
js/ai.js            Negamax + alpha-beta + quiescence, and the difficulty presets
js/ai-worker.js     Runs the search off the main thread
js/audio.js         SFX synthesis + the generative ambient bed
js/bg.js            WebGL shader background
js/ui.js            Board rendering, pointer handling, animation
js/main.js          Screens, HUD, game flow — wires it all together
test/perft.mjs      Move-generation correctness suite
tools/build-assets.py  Bakes the raw art pack into game sprites
```

## Where the roguelike goes

The engine is deliberately free of any UI or scoring assumptions, which is what
the next layer needs:

- `Chess` takes a FEN, so an encounter can start from any position — down
  material, missing a rook, a puzzle to survive.
- `moves()` is the single source of legality, so a relic that changes how a
  piece moves has one place to hook into.
- `LEVELS` in `js/ai.js` is already a table of opponents; enemies are entries
  in it with a name, a portrait and a search depth.
