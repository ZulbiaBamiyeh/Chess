#!/usr/bin/env python3
"""Fit a new wazir, then restain fairy-piece outlines to the classic ink."""

from pathlib import Path
from PIL import Image

SRC = Path('/home/ash/.grok/sessions/%2Fhome%2Fash%2FDocuments%2FChess/01a0137c-2ab5-77c3-8878-8f15b131d2f5/images')
OUT = Path('/home/ash/Documents/Chess/assets')
SIZE = 320
BASELINE = 0.04

FAIRY = [
    'camel', 'ferz', 'wazir', 'hopper', 'ice', 'drake',
    'firebishop', 'wisp', 'blaze',
]


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


def sample_outline(path, n=40):
    im = Image.open(path).convert('RGBA')
    px = im.load()
    w, h = im.size
    samples = []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 200:
                continue
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            chroma = max(r, g, b) - min(r, g, b)
            if luma < 80 and chroma < 50:
                edge = False
                for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    nx, ny = x + dx, y + dy
                    if nx < 0 or ny < 0 or nx >= w or ny >= h or px[nx, ny][3] < 40:
                        edge = True
                        break
                if edge:
                    samples.append((r, g, b))
    samples.sort(key=lambda c: c[0] + c[1] + c[2])
    if not samples:
        return (96, 78, 53)
    mid = samples[len(samples) // 2]
    print(path.name, 'outline sample', mid, 'n', len(samples))
    return mid


def restain_outlines(im, ink):
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
            # Neutral dark strokes — skip saturated fire/ice/duck fills.
            if luma < 92 and chroma < 55:
                t = max(0.0, min(1.0, luma / 92.0))
                px[x, y] = (
                    int(ir * (0.82 + 0.28 * t)),
                    int(ig * (0.82 + 0.28 * t)),
                    int(ib * (0.82 + 0.28 * t)),
                    a,
                )
    return im


def write_pair(im, stem, frac):
    white = fit(im, frac)
    white.save(OUT / f'{stem}-white.png')
    fit(to_black(im), frac).save(OUT / f'{stem}-black.png')
    print('wrote', stem)


def main():
    ink = sample_outline(OUT / 'king-white.png')
    sample_outline(OUT / 'rook-white.png')
    sample_outline(OUT / 'knight-white.png')

    raw = Image.open(SRC / '17.jpg')
    w, h = raw.size
    raw = raw.crop((0, 0, int(w * 0.93), int(h * 0.93)))
    wazir = restain_outlines(key_green(raw), ink)
    write_pair(wazir, 'wazir', 0.72)

    fracs = {
        'camel': 0.76, 'ferz': 0.62, 'hopper': 0.72, 'ice': 0.80,
        'drake': 0.88, 'firebishop': 0.84, 'wisp': 0.80, 'blaze': 0.78,
    }
    for stem, frac in fracs.items():
        src = OUT / f'{stem}-white.png'
        if not src.exists():
            print('missing', src)
            continue
        restain_outlines(Image.open(src).convert('RGBA'), ink).save(src)
        black = OUT / f'{stem}-black.png'
        if black.exists():
            restain_outlines(Image.open(black).convert('RGBA'), ink).save(black)
        print('restained', stem)

    duck = OUT / 'duck-yellow.png'
    if duck.exists():
        restain_outlines(Image.open(duck).convert('RGBA'), ink).save(duck)
        print('restained duck')


if __name__ == '__main__':
    main()
