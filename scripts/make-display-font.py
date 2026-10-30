#!/usr/bin/env python3
"""
Cuts the headline face from Newsreader's variable source (SIL Open Font License, no reserved font name).

    pip install fonttools brotli
    python scripts/make-display-font.py "path/to/Newsreader[opsz,wght].ttf"

Source: https://github.com/google/fonts/tree/main/ofl/newsreader

The source carries two axes over 650 glyphs, about 130 KB as woff2. This cut pins the weight and keeps the optical size
axis, so one file draws a fine, tight 96px headline and a sturdier, more open 21px card title. The browser picks the optical
size by itself (font-optical-sizing: auto). Only English text is set in this face; anything else falls back glyph by glyph.
"""
import io
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

WEIGHT = 340
OPSZ = (16, 72)
UNICODES = [*range(0x20, 0x7f), 0xa0, 0xa3, 0xa9, 0xae, 0xb7, 0xe9, 0x2013, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x20ac, 0x2122]
FEATURES = ['kern', 'liga', 'tnum', 'case']
OUT = os.path.join(os.path.dirname(__file__), '..', 'web', 'assets', 'fonts', 'newsreader-opsz-16-72.woff2')

font = instancer.instantiateVariableFont(TTFont(sys.argv[1]), {'wght': WEIGHT, 'opsz': OPSZ})
buffer = io.BytesIO()
font.save(buffer)  # subsetting straight after instancing loses glyph variations: go through a saved copy
buffer.seek(0)
font = TTFont(buffer)

options = subset.Options()
options.flavor = 'woff2'
options.layout_features = FEATURES
options.hinting = False
options.notdef_outline = True
subsetter = subset.Subsetter(options)
subsetter.populate(unicodes=UNICODES)
subsetter.subset(font)
font.flavor = 'woff2'
font.save(OUT)
print(os.path.basename(OUT), os.path.getsize(OUT), 'bytes')
