# GAMBIT

A chess roguelike in the browser. Capture the king, keep your army, spend
your supply. Hand-drawn pieces, a live shader background, and sound
synthesized as you play. Classic chess is still in the menu.

Play it at
**[zulbiabamiyeh.github.io/Chess](https://zulbiabamiyeh.github.io/Chess/)**,
or run it locally (see below). Every push deploys through GitHub Actions.

## What's in it

- **A run.** Six fights and two shops. Boards from a 5×3 alley to a 6×6
  throne. Each opponent sets a **supply** budget — you pick a loadout from
  your bag, and captured pieces come home afterwards.
- **King capture.** Checks do not bind you. Taking their king wins the
  fight; losing yours costs a heart. Army HP is the remaining cost of your
  standing pieces, and gold on a win scales with how much of that army is
  still up.
- **Fairy pieces** in a data-driven registry: ferz, wazir, camel, champion,
  princess, empress, amazon, hopper. Terrain tiles (block, frost, fort)
  and statuses (frozen, shielded) are real board state.
- **The shop.** Buy pieces into rarity-limited bag slots, a persistent
  **+1 supply** (the deploy-limit upgrade), or a king passive (Aegis, Dash,
  Tithe, Command).
- **Classic chess** is still here — every rule, five opponents, verified
  against the standard perft counts.

## Testing

```bash
node test/perft.mjs     # 26 classic counts
node test/variant.mjs   # king-capture, boards, terrain, fairy pieces
node test/run.mjs       # bag, loadout, shop, settlement, AI
```

Classic perft still covers the six standard positions through the published
depths (Kiwipete to depth 4 is 4,085,603 nodes). Variant tests cover
king-capture, shrinking boards, frost/fort/block, and the fairy set.

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
js/pieces.js        Piece registry — cost, rarity, movement
js/chess.js         Rules engine — 0x88, variable boards, terrain, king-capture
js/ai.js            Negamax + alpha-beta + quiescence
js/ai-worker.js     Runs the search off the main thread
js/content.js       Encounters, shop stock, king passives
js/run.js           Bag, slots, supply, loadout, settlement
js/campaign.js      Map / loadout / shop screens
js/audio.js         SFX synthesis + the generative ambient bed
js/bg.js            WebGL shader background
js/ui.js            Board rendering, pointer handling, animation
js/main.js          Screens, HUD, classic + run flow
test/perft.mjs      Classic move-generation counts
test/variant.mjs    Variant mechanics
test/run.mjs        Run-layer unit tests
tools/build-assets.py  Bakes the raw art pack into game sprites
```
