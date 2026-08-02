"""
Generate the home-screen / PWA icons (basketball mark) for the Next.js app.

    pip install pillow
    python scripts/make_icons.py     # run from the repo root

Writes:
    app/apple-icon.png    180x180  -> Next emits <link rel="apple-touch-icon">
    public/icon-192.png   192x192  -> manifest (Android home screen)
    public/icon-512.png   512x512  -> manifest (splash / high-DPI)

Why redraw at each size instead of upscaling the legacy 180px PNG: the seams are thin
strokes, so a 512 blown up from 180 goes soft.

This is a direct port of app/icon.svg's own coordinates (viewBox 0 0 100 100, circle at
50,50 r=45, stroke-width 4) scaled to each target size, so every PNG is pixel-proportional
to the SVG rather than an independent redraw — same circle-to-canvas ratio, same stroke
ratio, same four seams. Opaque background (no alpha), since iOS applies a squircle
mask/crop to home-screen icons and a transparent corner would show through as a hole.
"""
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# app/icon.svg's own geometry, viewBox 0 0 100 100 — keep these two files in sync by eye.
CX = CY = 50
R = 45
STROKE = 4
ORANGE = (224, 106, 59)   # #E06A3B, matches icon.svg's fill
INK = (27, 29, 34)        # #1B1D22, matches icon.svg's stroke
WHITE = (255, 255, 255)

TARGETS = [
    (os.path.join(ROOT, "app", "apple-icon.png"), 180),
    (os.path.join(ROOT, "public", "icon-192.png"), 192),
    (os.path.join(ROOT, "public", "icon-512.png"), 512),
]


def quad_bezier(p0, pc, p1, n=32):
    """Sample a quadratic bezier as a polyline — PIL has no curve primitive."""
    pts = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * pc[0] + t ** 2 * p1[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * pc[1] + t ** 2 * p1[1]
        pts.append((x, y))
    return pts


def draw(size: int) -> Image.Image:
    # Supersample: draw at 4x then downscale, so thin curved strokes anti-alias cleanly
    # instead of looking chunky/jagged at native size.
    ss = 4
    scale = size * ss / 100
    img = Image.new("RGB", (size * ss, size * ss), WHITE)
    d = ImageDraw.Draw(img)

    def p(x, y):
        return (x * scale, y * scale)

    r = R * scale
    line_w = max(1, round(STROKE * scale))

    cx, cy = p(CX, CY)
    # SVG centers `stroke` on the path, so icon.svg's ring actually spans r - 2 to r + 2.
    # PIL's ellipse outline instead grows INWARD from the given bounding box (the box IS
    # the stroke's outer edge), so passing bbox radius r alone draws a ring that stops at
    # r rather than reaching past it — and the curved seams, whose endpoints sit just
    # outside r in icon.svg (still inside ITS centered ring), then poke past our ring
    # into the white background. Padding the bbox out by half the stroke width recentres
    # it the same way SVG does.
    outer = r + line_w / 2
    d.ellipse((cx - outer, cy - outer, cx + outer, cy + outer), fill=ORANGE, outline=INK, width=line_w)

    # Straight pole-to-pole and equator seams: app/icon.svg's
    # `M50 5 Q50 50 50 95` / `M5 50 Q50 50 95 50` (both quadratic Beziers that collapse
    # to straight lines because the control point sits on the line between endpoints).
    d.line((*p(50, 5), *p(50, 95)), fill=INK, width=line_w)
    d.line((*p(5, 50), *p(95, 50)), fill=INK, width=line_w)

    # The two shallow seams above and below the equator: `M15 20 Q50 35 85 20` /
    # `M15 80 Q50 65 85 80`.
    top = quad_bezier(p(15, 20), p(50, 35), p(85, 20))
    bottom = quad_bezier(p(15, 80), p(50, 65), p(85, 80))
    d.line(top, fill=INK, width=line_w, joint="curve")
    d.line(bottom, fill=INK, width=line_w, joint="curve")

    return img.resize((size, size), Image.LANCZOS)


def main():
    for path, size in TARGETS:
        draw(size).save(path, format="PNG")
        print(f"wrote {os.path.relpath(path, ROOT)} ({size}x{size})")


if __name__ == "__main__":
    main()
