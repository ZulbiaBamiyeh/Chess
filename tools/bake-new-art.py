#!/usr/bin/env python3
"""Key lime-green generations, fit them to 320×320, stain extra kings, bake tiles."""

from pathlib import Path
from PIL import Image, ImageFilter, ImageChops, ImageDraw
import colorsys
import math

SRC = Path('/home/ash/.grok/sessions/%2Fhome%2Fash%2FDocuments%2FChess/01a01cb4-a67e-72f1-8508-8fbc0b025cd1/images')
OUT = Path('/home/ash/Documents/Chess/assets')
SIZE = 320
BASELINE = 0.04
INK = (98, 80, 54)

PIECES = {
    '2.jpg':  ('banner',     0.80),
    '3.jpg':  ('wisp',       0.78),
    '4.jpg':  ('crossbow',   0.74),
    '5.jpg':  ('amazon',     0.90),
    '6.jpg':  ('sapper',     0.76),
    '7.jpg':  ('gnu',        0.78),
    '9.jpg':  ('warden',     0.80),
    '10.jpg': ('guard',      0.74),
    '11.jpg': ('nightrider', 0.82),
    '12.jpg': ('champion',   0.78),
    '14.jpg': ('empress',    0.88),
    '15.jpg': ('ice',        0.88),
    '16.jpg': ('princess',   0.86),
    '17.jpg': ('dragon',     0.88),
    '18.jpg': ('zebra',      0.76),
    '19.jpg': ('horse',      0.84),
    '20.jpg': ('reaper',     0.80),
    '21.jpg': ('basilisk',   0.88),
    '22.jpg': ('courier',    0.78),
    '23.jpg': ('bombard',    0.74),
    '24.jpg': ('squirrel',   0.76),
    '25.jpg': ('colossus',   0.94),
    '26.jpg': ('lodestone',  0.80),
}

KINGS = {
    '31.jpg': ('king-aegis',     0.94),
    '33.jpg': ('king-court',     0.94),
    '35.jpg': ('king-pyre',      0.94),
    '29.jpg': ('king-hoarfrost', 0.94),
    '38.jpg': ('king-duck',      0.94),
}

# Exact-pose stains of king-white.png. (h, s, l_scale) in HLS, h in [0,1].
STAIN_KINGS = {
    'king-pioneer':      (0.33, 0.55, 0.72),
    'king-sentinel':     (0.54, 0.50, 0.70),
    'king-vanguard':     (0.00, 0.68, 0.72),
    'king-icebound':     (0.53, 0.22, 1.05),
    'king-longshot':     (0.14, 0.62, 0.82),
    'king-rampart':      (0.68, 0.48, 0.62),
    'king-anchor':       (0.86, 0.55, 0.70),
    'king-formation':    (0.02, 0.58, 0.68),
    'king-provisioner':  (0.28, 0.58, 0.78),
    'king-ranger':       (0.10, 0.50, 0.70),
    'king-broker':       (0.61, 0.58, 0.68),
    'king-convalescent': (0.95, 0.32, 0.92),
    'king-steadfast':    (0.07, 0.62, 0.72),
    'king-nomad':        (0.47, 0.55, 0.68),
    'king-financier':    (0.83, 0.50, 0.72),
}


def crop_watermark(im):
    w, h = im.size
    return im.crop((0, 0, int(w * 0.93), int(h * 0.93)))


def key_green(im):
    """Flood-fill lime from the edges so interior greens (sashes, mint) survive."""
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()

    def is_lime(x, y):
        r, g, b, a = px[x, y]
        if a < 8:
            return True
        # checkerboard / near-white paper around some gens
        if r > 230 and g > 230 and b > 230:
            return True
        if g > 140 and g > r * 1.18 and g > b * 1.10:
            return True
        # pale lime / chartreuse fringes
        if g > 180 and r < 160 and b < 160 and g > r + 30:
            return True
        return False

    seen = bytearray(w * h)
    stack = []
    for x in range(w):
        stack.append((x, 0))
        stack.append((x, h - 1))
    for y in range(h):
        stack.append((0, y))
        stack.append((w - 1, y))

    while stack:
        x, y = stack.pop()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not is_lime(x, y):
            continue
        px[x, y] = (0, 0, 0, 0)
        if x > 0:
            stack.append((x - 1, y))
        if x + 1 < w:
            stack.append((x + 1, y))
        if y > 0:
            stack.append((x, y - 1))
        if y + 1 < h:
            stack.append((x, y + 1))

    # Fringe: knock down leftover lime mixed into antialiased edges.
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            lime = max(0.0, min(1.0, (g - max(r, b)) / 70.0))
            if lime > 0.15 and g > 130:
                na = int(a * (1.0 - lime))
                px[x, y] = (r, g, b, na)
    return im


def restain_outlines(im, ink=INK):
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
            if luma < 92 and chroma < 55:
                t = max(0.0, min(1.0, luma / 92.0))
                px[x, y] = (
                    int(ir * (0.82 + 0.28 * t)),
                    int(ig * (0.82 + 0.28 * t)),
                    int(ib * (0.82 + 0.28 * t)),
                    a,
                )
    return im


def to_black(im):
    """Cream wood -> warm brown; keep saturated accents (ice, magnets, flames)."""
    im = im.copy()
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 12:
                continue
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            chroma = max(r, g, b) - min(r, g, b)
            # leave outlines
            if luma < 95 and chroma < 50:
                continue
            # saturated accent (not cream wood)
            if chroma > 55 and not (r > 160 and g > 140 and b > 90 and abs(r - g) < 80):
                # slightly darken accents so they sit on brown wood
                px[x, y] = (int(r * 0.88), int(g * 0.88), int(b * 0.88), a)
                continue
            # cream / light wood -> espresso-copper like the classic black set
            t = max(0.0, min(1.0, (luma - 90) / 140.0))
            px[x, y] = (
                int(70 + 78 * t),
                int(42 + 48 * t),
                int(22 + 24 * t),
                a,
            )
    return im


def fit(im, height_frac, size=SIZE):
    bbox = im.getbbox()
    if not bbox:
        return Image.new('RGBA', (size, size), (0, 0, 0, 0))
    cropped = im.crop(bbox)
    target_h = int(size * height_frac)
    w, h = cropped.size
    scale = target_h / h
    nw, nh = int(w * scale), target_h
    if nw > int(size * 0.94):
        scale = (size * 0.94) / w
        nw, nh = int(size * 0.94), int(h * scale)
    cropped = cropped.resize((max(1, nw), max(1, nh)), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    x = (size - cropped.size[0]) // 2
    y = size - cropped.size[1] - int(size * BASELINE)
    canvas.alpha_composite(cropped, (x, y))
    return canvas


def write_pair(im, stem, frac):
    white = fit(im, frac)
    white.save(OUT / f'{stem}-white.png', optimize=True)
    fit(to_black(im), frac).save(OUT / f'{stem}-black.png', optimize=True)
    print('wrote', stem)


def process_keyed(src_name, stem, frac):
    raw = Image.open(SRC / src_name)
    keyed = restain_outlines(key_green(crop_watermark(raw)))
    write_pair(keyed, stem, frac)


def stain_king(im, h, s, l_scale):
    """Recolor cream wood of the exact king, keep outlines and relative shading."""
    im = im.convert('RGBA')
    px = im.load()
    w, hgt = im.size
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    opx = out.load()
    for y in range(hgt):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            chroma = max(r, g, b) - min(r, g, b)
            if luma < 100 and chroma < 50:
                opx[x, y] = (r, g, b, a)
                continue
            _, _, ll = colorsys.rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)
            ll = max(0.12, min(0.92, ll * l_scale))
            nr, ng, nb = colorsys.hls_to_rgb(h, ll, s)
            opx[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
    return out


def darken_king(im):
    """A black-side variant of a stained king: same hue, lower luma."""
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    opx = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            chroma = max(r, g, b) - min(r, g, b)
            if luma < 100 and chroma < 50:
                opx[x, y] = (r, g, b, a)
                continue
            hh, ll, ss = colorsys.rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)
            ll = max(0.10, ll * 0.62)
            ss = min(1.0, ss * 1.05)
            nr, ng, nb = colorsys.hls_to_rgb(hh, ll, ss)
            opx[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
    return out


def crop_square_content(im):
    """Drop white/paper margin around a full-bleed tile."""
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    # treat near-white as empty for bbox
    mask = Image.new('L', (w, h), 0)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            if r > 245 and g > 245 and b > 245:
                continue
            mp[x, y] = 255
    bbox = mask.getbbox()
    if not bbox:
        return im
    # trim a couple of pixels of outline paper
    return im.crop(bbox)


def bake_tile(src_name, dest, size=256):
    raw = Image.open(SRC / src_name)
    im = crop_watermark(raw).convert('RGBA')
    im = crop_square_content(im)
    im = im.resize((size, size), Image.Resampling.LANCZOS)
    im.save(OUT / dest, optimize=True)
    print('wrote', dest, im.size)


def bake_shield(src_name, dest, size=320):
    raw = Image.open(SRC / src_name)
    im = key_green(crop_watermark(raw))
    # also punch the inner lime disc if flood-fill missed it (fully enclosed)
    px = im.load()
    w, h = im.size
    cx, cy = w // 2, h // 2
    # sample center
    cr, cg, cb, ca = px[cx, cy]
    if cg > 140 and cg > cr * 1.1:
        # flood from center
        stack = [(cx, cy)]
        seen = set()
        while stack:
            x, y = stack.pop()
            if (x, y) in seen:
                continue
            if x < 0 or y < 0 or x >= w or y >= h:
                continue
            seen.add((x, y))
            r, g, b, a = px[x, y]
            if g > 120 and g > r * 1.1 and g > b * 1.05:
                px[x, y] = (0, 0, 0, 0)
                stack.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    im = im.resize((size, size), Image.Resampling.LANCZOS)
    im.save(OUT / dest, optimize=True)
    print('wrote', dest, im.size)


def main():
    OUT.mkdir(exist_ok=True)

    for src, (stem, frac) in PIECES.items():
        process_keyed(src, stem, frac)

    for src, (stem, frac) in KINGS.items():
        process_keyed(src, stem, frac)

    king = Image.open(OUT / 'king-white.png').convert('RGBA')
    for stem, (h, s, l_scale) in STAIN_KINGS.items():
        stained = stain_king(king, h, s, l_scale)
        stained.save(OUT / f'{stem}-white.png', optimize=True)
        darken_king(stained).save(OUT / f'{stem}-black.png', optimize=True)
        print('stained', stem)

    bake_tile('32.jpg', 'tile-frost.png', 256)
    bake_tile('27.jpg', 'tile-fire-light.png', 256)
    bake_tile('28.jpg', 'tile-fire-dark.png', 256)
    bake_shield('36.jpg', 'shield-ring.png', 320)

    print('done')


if __name__ == '__main__':
    main()
