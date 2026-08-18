#!/usr/bin/env python3
from pathlib import Path
from PIL import Image

SRC = Path('/home/ash/.grok/sessions/%2Fhome%2Fash%2FDocuments%2FChess/01a0137c-2ab5-77c3-8878-8f15b131d2f5/images')
OUT = Path('/home/ash/Documents/Chess/assets')
SIZE = 320
BASELINE = 0.04
INK = (96, 78, 53)

ITEMS = {
    '25.jpg': ('ferz', 0.74, True),
    '27.jpg': ('king-aegis', 0.78, False),
    '23.jpg': ('king-pioneer', 0.78, False),
    '24.jpg': ('king-court', 0.78, False),
    '28.jpg': ('king-pyre', 0.78, False),
    '26.jpg': ('king-hoarfrost', 0.78, False),
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
                px[x, y] = (r, g, b, int(a * (1.0 - lime * 0.85)))
    return im


def restain(im, ink=INK):
    im = im.copy()
    px = im.load()
    w, h = im.size
    ir, ig, ib = ink
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 20:
                continue
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            chroma = max(r, g, b) - min(r, g, b)
            if luma < 115 and chroma < 55:
                t = max(0.0, min(1.0, luma / 115.0))
                px[x, y] = (
                    int(ir * (0.92 + 0.16 * t)),
                    int(ig * (0.92 + 0.16 * t)),
                    int(ib * (0.92 + 0.16 * t)),
                    a,
                )
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
    canvas.paste(cropped, ((SIZE - nw) // 2, SIZE - nh - int(SIZE * BASELINE)), cropped)
    return canvas


def main():
    for src, (stem, frac, both) in ITEMS.items():
        raw = Image.open(SRC / src)
        w, h = raw.size
        raw = raw.crop((0, 0, int(w * 0.93), int(h * 0.93)))
        keyed = restain(key_green(raw))
        fit(keyed, frac).save(OUT / f'{stem}-white.png')
        print('wrote', f'{stem}-white.png')
        if both:
            fit(to_black(keyed), frac).save(OUT / f'{stem}-black.png')
            print('wrote', f'{stem}-black.png')


if __name__ == '__main__':
    main()
