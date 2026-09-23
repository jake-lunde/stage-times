#!/usr/bin/env python3
"""Propose an edition's festival colors off its own art.

    npm run palette -- austin-city-limits-2026
    npm run palette -- austin-city-limits-2026 path/to/admat.png   # add images

Reads the festival art (assets/festivals/<key>.*) and the source images the
edition's YAML names, counts exact pixel colors (poster art is flat, so the
real inks are the most common exact values; averaging would blend them), drops
greys and near-duplicates, and prints each candidate with the text it takes.
Then a `colors:` line of the first usable ones, one per stage of a weekend, for
the owner to reorder and paste under `festival:`. The schema is the gate
(src/colors.ts); this only proposes. Needs Pillow (`pip3 install pillow`).
"""

import colorsys
import glob
import math
import os
import re
import sys
from collections import Counter

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CREAM, INK = (0xFC, 0xF9, 0xF4), (0x12, 0x18, 0x1F)
MIN_CONTRAST, MIN_DISTANCE = 4.5, 12  # src/colors.ts


def luminance(c):
    ch = [v / 255 for v in c]
    ch = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in ch]
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def lab(c):
    r, g, b = [v / 255 for v in c]
    r, g, b = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in (r, g, b)]
    f = lambda t: t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116
    x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
    y = f(0.2126 * r + 0.7152 * g + 0.0722 * b)
    z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
    return (116 * y - 16, 500 * (x - y), 200 * (y - z))


def distance(a, b):
    return math.dist(lab(a), lab(b))


def hexof(c):
    return '#%02X%02X%02X' % c


def images_for(key, extra):
    art = sorted(glob.glob(os.path.join(ROOT, 'assets', 'festivals', key + '.*')))
    sources = []
    yaml = os.path.join(ROOT, 'data', key + '.yaml')
    if os.path.exists(yaml):
        names = re.findall(r'^#\s+([0-9a-f]{64}\.\w+)\s*$', open(yaml).read(), re.M)
        sources = [os.path.join(ROOT, 'source', 'images', n) for n in names]
    return art + [s for s in sources if os.path.exists(s)] + extra, yaml


def stages_per_weekend(yaml):
    if not os.path.exists(yaml):
        return 8
    text = open(yaml).read()
    weekends = re.findall(r'^\s+weekend:\s*"([^"]*)"', text, re.M)
    ids = re.findall(r'^\s+- id:', text, re.M)
    return max(Counter(weekends).values()) if weekends else len(ids)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    key, extra = sys.argv[1], sys.argv[2:]
    paths, yaml = images_for(key, extra)
    if not paths:
        sys.exit(f'No art for {key}: commit assets/festivals/{key}.<ext> first, or name images after the key.')

    counts = Counter()
    for p in paths:
        im = Image.open(p).convert('RGB')
        im.thumbnail((600, 600), Image.NEAREST)  # nearest: never invent a blended color
        counts.update(im.getdata())
    total = sum(counts.values())

    picked = []  # (color, share)
    for c, n in counts.most_common(4000):
        _, l, s = colorsys.rgb_to_hls(*[v / 255 for v in c])
        if s < 0.35 or not 0.15 <= l <= 0.9:
            continue  # greys, the poster's ink, the paper
        near = next((i for i, (p, _) in enumerate(picked) if distance(c, p) < MIN_DISTANCE), None)
        if near is None:
            picked.append((c, n))
        else:
            picked[near] = (picked[near][0], picked[near][1] + n)
    picked = [(c, n) for c, n in picked if n / total >= 0.002]
    picked.sort(key=lambda cn: -cn[1])

    print(f'{key}: {len(paths)} image(s)')
    print('  color     share  text')
    usable = []
    for c, n in picked[:16]:
        cream, ink = contrast(c, CREAM), contrast(c, INK)
        if cream >= MIN_CONTRAST:
            text = f'cream {cream:.1f}:1'
        elif ink >= MIN_CONTRAST:
            text = f'ink {ink:.1f}:1'
        else:
            text = f'NEITHER (cream {cream:.1f}, ink {ink:.1f}) — the schema refuses it'
        print(f'  {hexof(c)}  {n / total:5.1%}  {text}')
        if max(cream, ink) >= MIN_CONTRAST:
            usable.append(hexof(c))

    need = stages_per_weekend(yaml)
    line = ', '.join(f'"{h}"' for h in usable[:need])
    print(f'\n{need} stages a weekend. Reorder to taste, then under `festival:`:')
    print(f'  colors: [{line}]')
    if len(usable) < need:
        print(f'  (only {len(usable)} usable — add an image with `npm run palette -- {key} <path>`, or the edition keeps the house colors)')


if __name__ == '__main__':
    main()
