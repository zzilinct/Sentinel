"""
Real QR code pictures for scripts/verify-web.js, made with a different encoder than Sentinel's own tests use
(the qrcode package and Pillow), the way codes reach people: printed, photographed, screenshotted.

    pip install qrcode pillow
    python scripts/verify-web-qr.py <out dir>

Writes the PNGs and manifest.json ([{ "file", "text", "what" }]). Meant for CI, not a person's computer.
"""
import json
import os
import random
import sys

import qrcode
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else 'qr-samples'
os.makedirs(OUT, exist_ok=True)
random.seed(7)

DISCORD = 'https://discord.com/ra/abc123'
WIFI = 'WIFI:T:WPA;S:Cafe Guest;P:coffee-and-cake;;'
SHOP = 'https://www.example.com/menu?table=12'


def code(text, box=10, border=4, level=qrcode.constants.ERROR_CORRECT_M, fill='black', back='white'):
    q = qrcode.QRCode(error_correction=level, box_size=box, border=border)
    q.add_data(text)
    q.make(fit=True)
    return q.make_image(fill_color=fill, back_color=back).convert('RGB')


def photo(img, size=900):
    """The code printed on a page and photographed: tilted, in perspective, a little blurred and noisy."""
    w, h = img.size
    canvas = Image.new('RGB', (size, size), (182, 170, 150))
    page = Image.new('RGB', (w + 80, h + 80), (238, 234, 226))
    page.paste(img, (40, 40))
    page = page.resize((520, 520), Image.BILINEAR)
    canvas.paste(page, ((size - 520) // 2, (size - 520) // 2))
    # Perspective: the top edge further away than the bottom one.
    c = size
    src = [(150, 120), (c - 110, 160), (c - 140, c - 120), (120, c - 150)]
    dst = [(0, 0), (c, 0), (c, c), (0, c)]
    coeffs = perspective_coeffs(dst, src)
    shot = canvas.transform((c, c), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(120, 110, 100))
    shot = shot.filter(ImageFilter.GaussianBlur(1.6))
    px = shot.load()
    for y in range(c):
        for x in range(c):
            n = random.randint(-14, 14)
            r, g, b = px[x, y]
            px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return shot


def solve(a, b):
    """Gaussian elimination, so no numpy is needed."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[piv] = m[piv], m[col]
        for r in range(n):
            if r != col:
                f = m[r][col] / m[col][col]
                for k in range(col, n + 1):
                    m[r][k] -= f * m[col][k]
    return [m[i][n] / m[i][i] for i in range(n)]


def perspective_coeffs(out_pts, in_pts):
    """The 8 coefficients of Pillow's PERSPECTIVE transform: each output corner reads from the matching input point."""
    a, b = [], []
    for (x, y), (u, v) in zip(out_pts, in_pts):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        b.append(v)
    return solve(a, b)


def screenshot(img):
    """A QR code inside a screenshot of a chat or an email: lots of other things around it."""
    shot = Image.new('RGB', (1280, 800), (54, 57, 63))
    d = ImageDraw.Draw(shot)
    for i in range(12):
        d.rectangle([40, 40 + i * 60, 700, 70 + i * 60], fill=(80 + i * 5, 84, 92))
    small = img.resize((300, 300), Image.NEAREST)
    shot.paste(small, (860, 380))
    return shot


samples = []


def save(name, img, text, what):
    img.save(os.path.join(OUT, f'{name}.png'))
    samples.append({'file': f'{name}.png', 'text': text, 'what': what})


save('plain', code(SHOP), SHOP, 'a plain code, 10 px squares')
save('small', code(SHOP, box=3, border=2), SHOP, '3 px squares, nothing to spare')
save('large', code(SHOP, box=40), SHOP, '40 px squares, a big screenshot')
save('rotated', code(SHOP).rotate(33, expand=True, fillcolor='white', resample=Image.BICUBIC), SHOP, 'turned 33 degrees')
save('upside-down', code(SHOP).rotate(180), SHOP, 'upside down')
save('low-contrast', code(SHOP, fill=(105, 105, 115), back=(175, 175, 180)), SHOP, 'grey on grey')
save('inverted', code(SHOP, fill='white', back=(20, 22, 26)), SHOP, 'light on dark (a dark-mode screenshot)')
save('photo', photo(code(SHOP)), SHOP, 'printed and photographed: perspective, blur, noise')
save('discord', code(DISCORD, level=qrcode.constants.ERROR_CORRECT_L), DISCORD, 'a Discord sign-in style link')
save('discord-photo', photo(code(DISCORD)), DISCORD, 'a Discord sign-in style link, photographed off a screen')
save('discord-in-chat', screenshot(code(DISCORD)), DISCORD, 'a Discord sign-in style link inside a chat screenshot')
save('wifi', code(WIFI), WIFI, 'a WiFi network code')
long_url = 'https://www.example.com/track/' + 'a1b2c3d4e5' * 14
save('long', code(long_url, box=6, level=qrcode.constants.ERROR_CORRECT_H), long_url, 'a long link, a large version with high error correction')

with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf8') as f:
    json.dump(samples, f, indent=2)
print(f'{len(samples)} QR pictures in {OUT}')
