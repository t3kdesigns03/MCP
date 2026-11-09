"""Build the classic Win95/98-style device icons used by the canvas.

Inputs  : assets/icons/source/*.jpg  (pixel-art renders with a baked-in
          checkerboard / white "transparent" background)
Outputs : assets/icons/{pc,switch,server,router,firewall,cloud}.png

* pc / switch / server are cut out of the source JPGs: flood-fill the
  background from the image border, stop at the dark pixel-art outline,
  crop, and downscale.
* router / firewall / cloud have no source art in the repo, so they are
  drawn here pixel-by-pixel in the same beige Win98 palette.

Run:  python scripts/make_icons.py      (needs Pillow)
"""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "icons" / "source"
OUT = ROOT / "assets" / "icons"
SIZE = 128  # final icon box (square, transparent padding)


def _is_bg(px: tuple[int, int, int], dark_bg: bool) -> bool:
    r, g, b = px[:3]
    sat = max(r, g, b) - min(r, g, b)
    lum = (r + g + b) / 3
    if dark_bg:
        return lum < 40 and sat < 25
    return lum > 180 and sat < 22


def cut_out(src: Path, dark_bg: bool = False) -> Image.Image:
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not _is_bg(px[x, y], dark_bg):
            continue
        px[x, y] = (0, 0, 0, 0)
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))
    # one erosion pass: drop light, unsaturated fringe pixels touching alpha
    for _ in range(2):
        kill = []
        for y in range(1, h - 1):
            for x in range(1, w - 1):
                if px[x, y][3] == 0:
                    continue
                if any(px[x + dx, y + dy][3] == 0 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    r, g, b, _ = px[x, y]
                    sat = max(r, g, b) - min(r, g, b)
                    lum = (r + g + b) / 3
                    if (not dark_bg and lum > 165 and sat < 30) or (dark_bg and lum < 60 and sat < 30 and False):
                        kill.append((x, y))
        for x, y in kill:
            px[x, y] = (0, 0, 0, 0)
    bbox = im.getbbox()
    im = im.crop(bbox)
    return fit(im)


def fit(im: Image.Image, size: int = SIZE, pad: int = 6) -> Image.Image:
    w, h = im.size
    scale = (size - 2 * pad) / max(w, h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    resample = Image.NEAREST if scale >= 1 else Image.LANCZOS
    im = im.resize((nw, nh), resample)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(im, ((size - nw) // 2, (size - nh) // 2), im)
    return canvas


# ---------------------------------------------------------------- pixel art
# Win98 beige palette, matched to the source renders
K = (24, 24, 28, 255)        # outline
B1 = (236, 228, 204, 255)    # beige face
B2 = (214, 204, 176, 255)    # beige shade
B3 = (180, 170, 142, 255)    # beige dark side
HI = (250, 247, 236, 255)    # highlight
G = (64, 210, 64, 255)       # green LED
A = (240, 176, 32, 255)      # amber LED
R1 = (186, 58, 44, 255)      # brick
R2 = (140, 40, 32, 255)      # brick shade
M = (226, 218, 196, 255)     # mortar
C1 = (236, 244, 255, 255)    # cloud
C2 = (190, 212, 238, 255)    # cloud shade
DG = (92, 92, 96, 255)       # port dark


def grid(w: int, h: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def box3d(d: ImageDraw.ImageDraw, x0: int, y0: int, x1: int, y1: int, depth: int = 3) -> None:
    """Beige box with a top bevel and right-side depth, Win98 style."""
    # top face
    d.polygon([(x0 + depth, y0), (x1 + depth, y0), (x1, y0 + depth), (x0, y0 + depth)], fill=B2, outline=K)
    # side
    d.polygon([(x1, y0 + depth), (x1 + depth, y0), (x1 + depth, y1 - depth), (x1, y1)], fill=B3, outline=K)
    # front
    d.rectangle([x0, y0 + depth, x1, y1], fill=B1, outline=K)
    d.line([(x0 + 1, y0 + depth + 1), (x1 - 1, y0 + depth + 1)], fill=HI)
    d.line([(x0 + 1, y0 + depth + 1), (x0 + 1, y1 - 1)], fill=HI)


def draw_router() -> Image.Image:
    im, d = grid(48, 40)
    # antennas
    for ax in (12, 34):
        d.rectangle([ax, 4, ax + 1, 18], fill=DG, outline=K)
        d.rectangle([ax - 1, 2, ax + 2, 4], fill=K)
    box3d(d, 4, 16, 42, 34, depth=4)
    # LED row
    for i, x in enumerate(range(9, 26, 4)):
        d.rectangle([x, 25, x + 1, 26], fill=G if i != 3 else A)
    # ports
    for x in (29, 34):
        d.rectangle([x, 24, x + 3, 28], fill=DG, outline=K)
    # base strip
    d.line([(5, 32), (41, 32)], fill=B3)
    return fit(im.resize((48 * 3, 40 * 3), Image.NEAREST))


def draw_firewall() -> Image.Image:
    im, d = grid(44, 40)
    box3d(d, 3, 4, 38, 36, depth=4)
    # brick wall panel inside the beige frame
    x0, y0, x1, y1 = 7, 11, 34, 32
    d.rectangle([x0, y0, x1, y1], fill=M, outline=K)
    row_h = 4
    for r, y in enumerate(range(y0 + 1, y1, row_h)):
        off = 0 if r % 2 == 0 else 4
        x = x0 + 1 - off
        while x < x1:
            bx0, bx1 = max(x, x0 + 1), min(x + 6, x1 - 1)
            by1 = min(y + row_h - 2, y1 - 1)
            if bx1 > bx0:
                d.rectangle([bx0, y, bx1, by1], fill=R1)
                d.line([(bx0, by1), (bx1, by1)], fill=R2)
            x += 8
    d.rectangle([33, 7, 34, 8], fill=G)
    return fit(im.resize((44 * 3, 40 * 3), Image.NEAREST))


def draw_cloud() -> Image.Image:
    im, d = grid(48, 32)
    blobs = [(6, 14, 20, 28), (12, 6, 28, 22), (22, 3, 38, 19), (30, 10, 44, 26), (14, 16, 36, 29)]
    for b in blobs:
        d.ellipse(b, fill=K)
    inner = [(7, 15, 19, 27), (13, 7, 27, 21), (23, 4, 37, 18), (31, 11, 43, 25), (15, 17, 35, 28)]
    for b in inner:
        d.ellipse(b, fill=C1)
    d.rectangle([9, 22, 41, 27], fill=C1)
    d.line([(9, 28), (41, 28)], fill=K)
    d.line([(10, 26), (40, 26)], fill=C2)
    d.line([(10, 27), (40, 27)], fill=C2)
    d.point([(26, 7), (27, 7), (25, 8)], fill=(255, 255, 255, 255))
    return fit(im.resize((48 * 3, 32 * 3), Image.NEAREST))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = {
        "pc": cut_out(SRC / "pc-crt.jpg"),
        "switch": cut_out(SRC / "hub-10baset.jpg"),
        "server": cut_out(SRC / "server-tower.jpg"),
        "router": draw_router(),
        "firewall": draw_firewall(),
        "cloud": draw_cloud(),
    }
    for name, im in jobs.items():
        path = OUT / f"{name}.png"
        im.save(path, optimize=True)
        print(f"wrote {path.relative_to(ROOT)}  {im.size}")


if __name__ == "__main__":
    main()
