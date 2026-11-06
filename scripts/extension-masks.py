"""The companion's masks, from the site's renders (web/assets/img/masks), at the size the companion shows them.

The largest is the block page's: at most 480 CSS px tall. The popup (76 px wide) and settings (84 px) use the same
files. Run again after the masks are re-rendered:   python scripts/extension-masks.py
Names are the site's own, so a new render drops in by name.
"""
import pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'web' / 'assets' / 'img' / 'masks'
OUT = ROOT / 'extension' / 'src' / 'masks'
HEIGHT = 480

OUT.mkdir(parents=True, exist_ok=True)
names = ['onyx'] + [f'{t}-{c}' for t in ('scam', 'virus', 'malware') for c in ('red', 'orange', 'yellow')]
total = 0
for name in names:
    im = Image.open(SRC / f'{name}.webp').convert('RGBA')
    w = round(im.width * HEIGHT / im.height)
    im.resize((w, HEIGHT), Image.LANCZOS).save(OUT / f'{name}.webp', 'WEBP', quality=72, method=6)
    total += (OUT / f'{name}.webp').stat().st_size
print(f'{len(names)} masks, {total} bytes')
