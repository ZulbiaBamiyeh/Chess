# GAMBIT

A chess roguelike in the browser. Capture the king, keep your army, spend
your supply. Hand-drawn pieces, a live shader background, and sound
synthesized as you play. Classic chess is still in the menu.

Play it at
**[zulbiabamiyeh.github.io/Chess](https://zulbiabamiyeh.github.io/Chess/)**,
or run it locally (see below). Every push deploys through GitHub Actions.

## What's in it

- **A run.** Three acts on a branching map, a boss at the end of each.
  Trash fights are small boards; elites are nastier; bosses play on 8×8.
- **78 encounters**, past Slay the Spire's scale — an easy pool and a deep hard
  pool per act, elites and bosses each. Fights draw without
  replacement, so an act never repeats itself, and every act opens on the easy
  pool so a run cannot die to its first room.
- **King capture ends the fight.** Losing yours costs **HP** by tier, not the
  run — you can take the room again for as long as you are still standing, and
  the run ends only when the HP does. The shop heals, pieces always come home.
- **Camp is a real choice, not a button.** Rest heals and pays a little gold;
  Forage skips the heal for more gold; Train spends gold to give one piece in
  the bag a permanent shield, every fight from then on — the only camp choice
  that compounds, so it's gated on gold and one-time per piece.
- **Two budgets.** Supply caps what your army is *worth*; deploy caps how many
  *bodies* it has. Supply alone was not enough — a king-capture fight is won by
  bodies, so with points as the only limit the cheapest body always won.
- **36 relics across thirteen archetypes** — Swarm, Few and Fine, Frost, Fire,
  Cavalry, Martyr, Coin, Endure, Tempo, and four built on the newer rules:
  Reanimation, Volley, Formation, Relay. Relics change a rule and key off piece
  tags, so owning one makes you want particular pieces and owning two makes you
  want a particular army. They drop from elites and bosses as a choice, and
  appear in shops.
- **31 pieces**, classic six plus a fairy set: camel, zebra, wazir, ferz, guard,
  champion, gnu, squirrel, princess, empress, amazon, hopper, nightrider,
  dragon horse, dragon king, drake, rime, flame, wisp, sapper, warden — and four
  that each bring a rule the engine did not have before:
  - **Crossbow** kills at a knight's leap *without moving*. It can never be
    traded off by the thing it kills, which makes it the clean answer to
    wisps and sappers — but it only threatens the squares it can shoot, and
    it walks into place one step at a time.
  - **Reanimator** — whatever it kills gets up again on your side, on the
    square the reanimator just left. Every trade it wins is worth double, so
    the army grows out of the fight rather than out of the loadout.
  - **Banner** lends every friend standing beside it a king's step. A rook
    under a banner is a Dragon King; a wazir is a Guard. It is the one piece
    that wants the army bunched together instead of spread out.
  - **Courier** trades places with a friend instead of being blocked by one —
    hauling a slow piece up the board, or (with Post Road) pulling the king
    out of a mating net. It will not carry anyone into fire or onto ice.
- **18 ? rooms** in the shape of Slay the Spire's — a scene and two or three
  choices, most of them a trade rather than a gift.
- **Six kings**, each a single loud passive: Aegis, Pioneer, Court, Pyre,
  Hoarfrost, and the plain one that just gives supply.
- **Classic chess** is still here — every rule, five opponents, verified
  against the standard perft counts.

## Balance

Pricing is set by measurement, not by feel. Two harnesses:

```bash
node tools/balance.mjs --games 16 --deploy 6 --budget 12   # per piece
node tools/builds.mjs --games 4 --act 3                    # per archetype
node tools/builds.mjs --games 3 --bosses                   # vs every boss
```

`balance.mjs` plays AI-vs-AI duels at equal supply, both colours, and reports
how often each piece actually wins. `builds.mjs` asks the question that matters
for a roguelike — can several *different* armies all beat the game?

Two methodology notes worth keeping, because both produced wrong answers first:

- The reference army has to **spend its budget**. A flat wall of pawns is only
  fair at low budgets; at 16 supply it left ten points unspent and flattered
  anything expensive. The Queen was never measured at all until the budget flag
  existed, because she cost more than the harness had to spend.
- Build tests have to **normalise the bag**. The first version handed the
  quality build a bag worth 28 supply while swarm got 10, so it measured the
  pieces rather than the relics.

Current state: eleven archetypes span 33%–74%, a spread of 46 points, with the
no-relic baseline sitting at the floor (28%) and every build beating it. Bosses
are a real wall — an unspecialised army wins about 20% of them, a committed one
far more.

Both harnesses are noisy at small sample counts — one piece measured 40% and
then 13% at an unchanged price across two runs — so treat a single reading as a
hint and only act on differences that survive a re-run. The archetype numbers
above moved a build from 100% to 33% and back to a middle, which is what that
looks like in practice.

## Testing

```bash
node test/perft.mjs        # 26 classic counts
node test/variant.mjs      # king-capture, boards, terrain, fairy pieces, statuses
node test/run.mjs          # bag, loadout, shop, settlement, AI, map, events, relics
node test/playthrough.mjs  # a whole run, end to end
```

`playthrough.mjs` walks a run the way a player does — routing around elites when
hurt, fighting with the real AI, settling, taking relics, shopping, resolving
events, camping — and asserts the state stays coherent at every step. It is
worth more than its size suggests: it is what surfaced three dead features that
every unit test had been happy with.

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
js/content.js       Encounters, ? room events, shop stock, king passives
js/relics.js        Relics, piece tags, archetypes
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
