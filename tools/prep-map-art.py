#!/usr/bin/env python3
"""Crop watermarks, key the node ring, write map paintings into assets/."""

from pathlib import Path
from PIL import Image

SRC = Path('/home/ash/.grok/sessions/%2Fhome%2Fash%2FDocuments%2FChess/01a0137c-2ab5-77c3-8878-8f15b131d2f5/images')
OUT = Path('/home/ash/Documents/Chess/assets')


def cover_watermark(im):
    im = im.convert('RGB')
    w, h = im.size
    # Sample parchment from just inside the bottom-left of the frame.
    sample = im.getpixel((int(w * 0.12), int(h * 0.94)))
    px = im.load()
    x0, y0 = int(w * 0.78), int(h * 0.93)
    for y in range(y0, h):
        for x in range(x0, w):
            px[x, y] = sample
    return im


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
                px[x, y] = (r, g, b, int(a * (1.0 - lime * 0.85)))
    return im


def fit_square(im, size=256):
    bbox = im.getbbox()
    cropped = im.crop(bbox)
    pad = int(size * 0.04)
    inner = size - pad * 2
    w, h = cropped.size
    scale = min(inner / w, inner / h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    cropped = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(cropped, ((size - nw) // 2, (size - nh) // 2), cropped)
    return canvas


def main():
    OUT.mkdir(exist_ok=True)
    mapping = {
        '18.jpg': 'map-act1.png',
        '22.jpg': 'map-act2.png',
        '21.jpg': 'map-act3.png',
    }
    for src, dest in mapping.items():
        im = cover_watermark(Image.open(SRC / src))
        # Keep enough resolution for a tall stage without huge files.
        w, h = im.size
        if w > 900:
            im = im.resize((900, int(h * 900 / w)), Image.Resampling.LANCZOS)
        im.save(OUT / dest, quality=90)
        print('wrote', dest, im.size)

    ring = Image.open(SRC / '20.jpg')
    w, h = ring.size
    ring = ring.crop((0, 0, int(w * 0.93), int(h * 0.93)))
    fit_square(key_green(ring), 256).save(OUT / 'map-ring.png')
    print('wrote map-ring.png')


if __name__ == '__main__':
    main()
