#!/usr/bin/env python3
"""Bake the raw hand-drawn art pack into the sprites the game loads.

Two jobs:

1. The board is recoloured. In the source art the dark squares and the black
   pieces are almost the same brown, so a black knight on a dark square nearly
   disappears. Deepening the dark squares (and cooling the linework) keeps the
   hand-drawn wobble but gives both piece sets something to sit against.
2. The pieces are normalised. Each drawing floats at a different place inside
   its 500x500 frame, so dropped straight into a square they would bob about at
   different heights. Every piece is cropped to its ink, scaled to a per-type
   height and bottom-aligned on a common baseline, so a rank of pieces stands
   in a straight line.

Usage: python3 tools/build-assets.py <src-dir> [--out assets]
"""

import sys
import os
from PIL import Image

# ---- board recolouring ----------------------------------------------------

BOARD_MAP = [
    ((243, 235, 215), (238, 226, 200)),  # light squares -> warm parchment
    ((163, 119, 84), (92, 62, 45)),      # dark squares  -> deep espresso
    ((82, 56, 21), (44, 29, 22)),        # linework      -> near-black umber
]

BOARD_SIZE = 1280

# ---- piece normalisation --------------------------------------------------

PIECE_SIZE = 320
# Height of each piece as a fraction of one square. Tuned by eye so the set
# keeps a believable hierarchy: pawns short, the king towering.
PIECE_HEIGHT = {
    'pawn': 0.64,
    'knight': 0.74,
    'bishop': 0.80,
    'rook': 0.70,
    'queen': 0.86,
    'king': 0.94,
}
MAX_WIDTH = 0.94   # of a square, so the knight's muzzle never crosses a border
BASELINE = 0.04    # gap between the piece's foot and the bottom of the frame

TYPES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']
COLORS = ['white', 'black']


def recolor_board(src, dst):
    im = Image.open(src).convert('RGBA')
    im = im.crop(im.getbbox())  # trim the drawn border so 8x8 maps exactly

    # Only ~550 distinct colours in the source, so remap through a cache.
    cache = {}

    def remap(px):
        hit = cache.get(px)
        if hit is not None:
            return hit
        r, g, b, a = px
        if a == 0:
            cache[px] = px
            return px
        # Inverse-square-distance blend across the three anchors keeps the
        # antialiased edges smooth instead of snapping to a hard palette.
        wsum = 0.0
        acc = [0.0, 0.0, 0.0]
        for (sr, sg, sb), target in BOARD_MAP:
            d = (r - sr) ** 2 + (g - sg) ** 2 + (b - sb) ** 2
            w = 1.0 / (d + 1.0) ** 2
            wsum += w
            for i in range(3):
                acc[i] += w * target[i]
        out = (
            int(round(acc[0] / wsum)),
            int(round(acc[1] / wsum)),
            int(round(acc[2] / wsum)),
            a,
        )
        cache[px] = out
        return out

    im.putdata([remap(p) for p in im.getdata()])
    im = im.resize((BOARD_SIZE, BOARD_SIZE), Image.LANCZOS)
    im.save(dst, optimize=True)
    return im.size


def type_boxes(srcdir):
    """Union bbox per piece type, so white and black of a type align exactly."""
    boxes = {}
    for t in TYPES:
        box = None
        for c in COLORS:
            b = Image.open(os.path.join(srcdir, f'chess-{t}-{c}.png')).convert('RGBA').getbbox()
            box = b if box is None else (
                min(box[0], b[0]), min(box[1], b[1]),
                max(box[2], b[2]), max(box[3], b[3]),
            )
        boxes[t] = box
    return boxes


def normalize_piece(src, dst, box, height_frac):
    im = Image.open(src).convert('RGBA').crop(box)
    h = PIECE_SIZE * height_frac
    scale = min(h / im.height, PIECE_SIZE * MAX_WIDTH / im.width)
    w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
    im = im.resize((w, h), Image.LANCZOS)

    frame = Image.new('RGBA', (PIECE_SIZE, PIECE_SIZE), (0, 0, 0, 0))
    x = round((PIECE_SIZE - w) / 2)
    y = round(PIECE_SIZE * (1 - BASELINE) - h)
    frame.alpha_composite(im, (x, y))
    frame.save(dst, optimize=True)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    srcdir = sys.argv[1]
    out = 'assets'
    if '--out' in sys.argv:
        out = sys.argv[sys.argv.index('--out') + 1]
    os.makedirs(out, exist_ok=True)

    size = recolor_board(os.path.join(srcdir, 'board.png'), os.path.join(out, 'board.png'))
    print(f'board.png {size[0]}x{size[1]}')

    boxes = type_boxes(srcdir)
    for t in TYPES:
        for c in COLORS:
            name = f'{t}-{c}.png'
            normalize_piece(
                os.path.join(srcdir, f'chess-{name}'),
                os.path.join(out, name),
                boxes[t],
                PIECE_HEIGHT[t],
            )
            print(f'{name} from {boxes[t]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
