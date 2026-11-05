#!/usr/bin/env python3
"""Build a labelled contact sheet of rendered stills (optionally next to reference images).

usage: python3 scripts/contact-sheet.py <render_dir> <out.jpg> [--refs ref1.jpg,ref2.jpg] [--cols 3]
"""
import sys
import os
from PIL import Image, ImageDraw, ImageFont

ORDER = ['aerial', 'seaward', 'entry', 'west', 'east', 'lounge', 'workspace', 'dining', 'roof',
         'hero-interior', 'hero-exterior']
LABELS = {
    'aerial': '01 Seaward aerial (W, looking E)',
    'seaward': '02 Seaward facade (S, looking N)',
    'entry': '03 North entry (N, looking S)',
    'west': '04 West waterfall (W, looking ENE)',
    'east': '05 East firepit (E, looking WNW)',
    'lounge': '06 Lounge, eye level (looking WSW)',
    'workspace': '07 Workspace, eye level (looking SE)',
    'dining': '08 Kitchen + dining, eye level (looking SE)',
    'roof': '09 Roof opening (NW, looking SE)',
    'hero-interior': '10 Living to sea, eye level (looking ESE)',
    'hero-exterior': '11 Terrace to sea (W, looking ESE)',
}


def font(size):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf']:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def main():
    src, out = sys.argv[1], sys.argv[2]
    args = sys.argv[3:]
    cols = 3
    if '--cols' in args:
        cols = int(args[args.index('--cols') + 1])
    tiles = []
    for k in ORDER:
        p = os.path.join(src, k + '.png')
        if os.path.exists(p):
            tiles.append((LABELS[k], Image.open(p).convert('RGB')))
    if not tiles:
        print('no renders found')
        return
    tw = 640
    th = int(tw * tiles[0][1].height / tiles[0][1].width)
    pad, lab = 12, 30
    rows = (len(tiles) + cols - 1) // cols
    W = cols * tw + (cols + 1) * pad
    H = rows * (th + lab) + (rows + 1) * pad
    sheet = Image.new('RGB', (W, H), (18, 22, 26))
    d = ImageDraw.Draw(sheet)
    f = font(16)
    for i, (label, im) in enumerate(tiles):
        r, c = divmod(i, cols)
        x = pad + c * (tw + pad)
        y = pad + r * (th + lab + pad)
        sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y))
        d.text((x + 4, y + th + 6), label, fill=(225, 225, 225), font=f)
    sheet.save(out, quality=90)
    print(out, sheet.size)


if __name__ == '__main__':
    main()
