"""Builds public/emoji/cry-outline.png, the one-colour mask the Crygago reaction icon is painted through, from the line art the
team supplied (scripts/assets/cry-lineart-source.png). The strokes become opaque white on a transparent background, kept as
thin as the artwork draws them (just made crisper so they still show at 20px), with a margin so no stroke touches the edge.
The app paints it in the button's current colour.
Pillow + numpy only.
Usage (from the repo root):  python scripts/make-cry-mask.py"""
import os
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'scripts', 'assets', 'cry-lineart-source.png')
OUT = os.path.join(ROOT, 'public', 'emoji', 'cry-outline.png')
PAD = 10      # transparent margin so strokes never touch the edge
GROW = 0      # stroke thickening in source pixels (0 keeps the artwork's own line weight; 3 was the bolder first version)
BLUR = 0.5    # a light softening so the thin lines stay smooth when scaled down
BOOST = 2.2   # opacity gain: makes the thin, anti-aliased lines read clearly at 20px without widening them

src = Image.open(SRC).convert('RGBA')
a = np.asarray(src).astype(float)
alpha = a[..., 3] / 255
lum = a[..., :3].mean(axis=2) / 255
# Strokes are dark (black or brown) on transparency: keep them, let any light pixel drop out.
strokes = np.clip(alpha * np.clip((0.75 - lum) / 0.55, 0, 1), 0, 1)

mask = Image.fromarray((strokes * 255).astype(np.uint8), 'L')
if GROW:
    mask = mask.filter(ImageFilter.MaxFilter(GROW))
mask = mask.filter(ImageFilter.GaussianBlur(BLUR)).point(lambda v: min(255, int(v * BOOST)))

w, h = mask.size
canvas = Image.new('L', (w + 2 * PAD, h + 2 * PAD), 0)
canvas.paste(mask, (PAD, PAD))
out = Image.new('RGBA', canvas.size, (255, 255, 255, 0))
out.putalpha(canvas)
out.save(OUT, optimize=True)
print('saved', OUT, out.size)
