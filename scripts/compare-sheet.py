#!/usr/bin/env python3
"""Side-by-side sheet: closest photo reference (aesthetic target) | live render.

usage: python3 scripts/compare-sheet.py <render_dir> <refs_dir> <out.jpg>

The references are independent AI concept images; they are not camera-matched to
the scene. Pairing is by subject only, never by viewpoint.
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

PAIRS = [
    ('aerial', '02_coast_aerial.jpg', '01 Seaward aerial — render looks NW from the SE'),
    ('seaward', '01_hero_seaward.jpg', '02 Seaward facade — render looks N from the sea'),
    ('entry', 'ref_entry.jpg', '03 North entry — render looks S from the driveway'),
    ('west', '03_pool_waterfall.jpg', '04 West waterfall — render looks ENE'),
    ('east', '04_lower_firepit.jpg', '05 East firepit — render looks WNW'),
    ('lounge', '05_living.jpg', '06 Lounge — eye level, looks WSW'),
    ('workspace', 'ref_workspace.jpg', '07 Workspace — eye level, looks SE'),
    ('dining', '07_dining_kitchen.jpg', '08 Kitchen + dining — eye level, looks W'),
    ('roof', '10_green_roof_crop.jpg', '09 Roof opening — looks SE from the NW'),
    ('hero-interior', '08_threshold.jpg', '10 Living to sea — eye level, looks SSE'),
    ('hero-exterior', 'ref_terrace.jpg', '11 Terrace to sea — eye level, looks ESE'),
]


def font(size):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf']:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def fit(im, w, h):
    r = max(w / im.width, h / im.height)
    im = im.resize((int(im.width * r + 0.5), int(im.height * r + 0.5)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def main():
    rdir, refdir, out = sys.argv[1], sys.argv[2], sys.argv[3]
    tw, th = 800, 450
    pad, lab = 14, 34
    rows = [(k, r, t) for k, r, t in PAIRS if os.path.exists(os.path.join(rdir, k + '.png'))]
    W = 2 * tw + 3 * pad
    H = len(rows) * (th + lab + pad) + pad + 46
    sheet = Image.new('RGB', (W, H), (18, 22, 26))
    d = ImageDraw.Draw(sheet)
    f, fs = font(18), font(14)
    d.text((pad, 14), 'Photo target (look only, not camera-matched)', fill=(170, 175, 180), font=fs)
    d.text((2 * pad + tw, 14), 'Live render from the single Three.js scene', fill=(170, 175, 180), font=fs)
    y = 46
    for k, r, t in rows:
        ref = Image.open(os.path.join(refdir, r)).convert('RGB')
        ren = Image.open(os.path.join(rdir, k + '.png')).convert('RGB')
        sheet.paste(fit(ref, tw, th), (pad, y))
        sheet.paste(fit(ren, tw, th), (2 * pad + tw, y))
        d.text((pad + 2, y + th + 8), t, fill=(230, 230, 230), font=f)
        y += th + lab + pad
    sheet.save(out, quality=88)
    print(out, sheet.size)


if __name__ == '__main__':
    main()
