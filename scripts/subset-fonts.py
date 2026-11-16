#!/usr/bin/env python3
"""
Cuts Geist and Geist Mono down to the letters Sentinel shows, in place, after scripts/fetch-fonts.js.

    pip install fonttools brotli
    node scripts/fetch-fonts.js && python scripts/subset-fonts.py

Google's "latin" files carry combining accents, Romanian and Turkish letters, fractions and proportional figures that no
page uses. Kept: printable ASCII and all of Latin-1 (names and email addresses typed by people, such as Jose with its
accent), every other character the website, the web app, the companion and the Windows app's pages are written with,
and the features the CSS asks for (tabular figures, ligatures). Anything else falls back to the metric-matched
stand-ins in fonts.css, glyph by glyph. tests/type.test.js fails when a page uses a character these files lost.
Newsreader is cut by scripts/make-display-font.py.
"""
import html
import os
import re

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.join(os.path.dirname(__file__), '..')
FONTS = os.path.join(ROOT, 'web', 'assets', 'fonts')
FACES = ['geist-normal-300-700.woff2', 'geist-mono-normal-400-600.woff2']
SOURCES = [os.path.join(ROOT, 'web'), os.path.join(ROOT, 'extension', 'src'), os.path.join(ROOT, 'desktop', 'src', 'pages')]
SKIP = re.compile(r'node_modules|vendor|models|img|downloads|fonts')
FEATURES = ['ccmp', 'locl', 'liga', 'tnum', 'kern', 'mark', 'mkmk']


def used():
    chars = set(range(0x20, 0x7f)) | set(range(0xa0, 0x100))
    for top in SOURCES:
        for folder, dirs, files in os.walk(top):
            dirs[:] = [d for d in dirs if not SKIP.search(d)]
            for name in files:
                if not re.search(r'\.(html|js|css|json|txt)$', name) or name.endswith('.min.js') or name == 'mask3d.js':
                    continue
                with open(os.path.join(folder, name), encoding='utf-8') as f:
                    text = f.read()
                chars |= {ord(c) for c in html.unescape(text)}
    return chars


chars = used()
for face in FACES:
    path = os.path.join(FONTS, face)
    font = TTFont(path)
    keep = sorted(chars & set(font.getBestCmap()))
    before = os.path.getsize(path)
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = FEATURES
    options.hinting = False
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=keep)
    subsetter.subset(font)
    font.flavor = 'woff2'
    font.save(path)
    print(face, len(keep), 'characters', before, '->', os.path.getsize(path), 'bytes')
