#!/usr/bin/env python3
"""Key lime-green map icons and fit them onto 128×128 transparent canvases."""

from pathlib import Path
from PIL import Image

SRC = Path('/home/ash/.grok/sessions/%2Fhome%2Fash%2FDocuments%2FChess/01a0137c-2ab5-77c3-8878-8f15b131d2f5/images')
OUT = Path('/home/ash/Documents/Chess/assets')
SIZE = 128
PAD = 0.10

ICONS = {
    '12.jpg': 'map-fight',
    '13.jpg': 'map-elite',
    '16.jpg': 'map-shop',
    '14.jpg': 'map-rest',
    '15.jpg': 'map-boss',
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


def fit(im):
    bbox = im.getbbox()
    if not bbox:
        return Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    cropped = im.crop(bbox)
    inner = int(SIZE * (1 - 2 * PAD))
    w, h = cropped.size
    scale = min(inner / w, inner / h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    cropped = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(cropped, ((SIZE - nw) // 2, (SIZE - nh) // 2), cropped)
    return canvas


def main():
    OUT.mkdir(exist_ok=True)
    for src_name, stem in ICONS.items():
        src = SRC / src_name
        raw = Image.open(src)
        w, h = raw.size
        raw = raw.crop((0, 0, int(w * 0.93), int(h * 0.93)))
        out = fit(key_green(raw))
        dest = OUT / f'{stem}.png'
        out.save(dest)
        print('wrote', dest, out.size)


if __name__ == '__main__':
    main()
