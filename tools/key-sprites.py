#!/usr/bin/env python3
"""Key lime-green generations and drop them into assets/ as 320×320 sprites."""

from pathlib import Path
from PIL import Image

SRC = Path('/home/ash/.grok/sessions/%2Fhome%2Fash%2FDocuments%2FChess/01a0137c-2ab5-77c3-8878-8f15b131d2f5/images')
OUT = Path('/home/ash/Documents/Chess/assets')
SIZE = 320
BASELINE = 0.04

WHITE_MAP = {
    '2.jpg': ('duck-yellow', 0.62, False),
    '1.jpg': ('wazir', 0.68, True),
    '3.jpg': ('blaze', 0.78, True),
    '4.jpg': ('ferz', 0.62, True),
    '11.jpg': ('camel', 0.76, True),
    '6.jpg': ('ice', 0.80, True),
    '7.jpg': ('hopper', 0.72, True),
    '8.jpg': ('drake', 0.88, True),
    '9.jpg': ('firebishop', 0.84, True),
    '10.jpg': ('wisp', 0.80, True),
}


def key_green(im):
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if g > 140 and g > r * 1.15 and g > b * 1.05:
                px[x, y] = (r, g, b, 0)
            else:
                lime = max(0.0, min(1.0, (g - max(r, b)) / 80.0))
                na = int(a * (1.0 - lime * 0.85))
                px[x, y] = (r, g, b, na)
    return im


def to_black(im):
    im = im.copy()
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 12:
                continue
            if b > r + 10 and g > 100:
                px[x, y] = (70, 88, 110, a)
                continue
            if r > 160 and g > 140 and b > 100:
                luma = (r + g + b) / 3
                t = max(0.0, min(1.0, (luma - 140) / 100.0))
                px[x, y] = (
                    int(118 * (0.55 + 0.55 * t)),
                    int(70 * (0.55 + 0.55 * t)),
                    int(32 * (0.55 + 0.55 * t)),
                    a,
                )
    return im


def fit(im, height_frac):
    bbox = im.getbbox()
    if not bbox:
        return Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    cropped = im.crop(bbox)
    target_h = int(SIZE * height_frac)
    w, h = cropped.size
    scale = target_h / h
    nw, nh = int(w * scale), target_h
    if nw > int(SIZE * 0.94):
        scale = (SIZE * 0.94) / w
        nw, nh = int(SIZE * 0.94), int(h * scale)
    cropped = cropped.resize((max(1, nw), max(1, nh)), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    x = (SIZE - cropped.size[0]) // 2
    y = SIZE - cropped.size[1] - int(SIZE * BASELINE)
    canvas.paste(cropped, (x, y), cropped)
    return canvas


def main():
    OUT.mkdir(exist_ok=True)
    for src_name, (stem, frac, both) in WHITE_MAP.items():
        src = SRC / src_name
        if not src.exists():
            print('missing', src)
            continue
        raw = Image.open(src)
        w, h = raw.size
        raw = raw.crop((0, 0, int(w * 0.93), int(h * 0.93)))
        keyed = key_green(raw)
        if stem == 'duck-yellow':
            fit(keyed, frac).save(OUT / 'duck-yellow.png')
            print('wrote duck-yellow.png')
            continue
        fit(keyed, frac).save(OUT / f'{stem}-white.png')
        print('wrote', f'{stem}-white.png')
        if both:
            fit(to_black(keyed), frac).save(OUT / f'{stem}-black.png')
            print('wrote', f'{stem}-black.png')


if __name__ == '__main__':
    main()
