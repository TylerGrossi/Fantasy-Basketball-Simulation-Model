"""
Cut the app's brand assets out of the master logo artwork.

    pip install pillow numpy
    python scripts/make_icons.py     # run from the repo root

Source: assets/logo-source.png — the FBBSim artwork, one image holding BOTH lockups side
by side (horizontal lockup on the left, rounded app tile on the right). It is the master;
everything below is derived from it, so a new logo means replacing that one file and
re-running this. Nothing here is hand-drawn any more — the previous version of this script
redrew a basketball from app/icon.svg's coordinates, and that mark no longer exists.

Writes:
    public/logo-mark.png     the ball, TRANSPARENT   -> header
    public/logo-word.png     "FBBSim", TRANSPARENT   -> header
    public/logo-tile.png     384x384  -> the app tile, for the mobile home hero
    public/og.png            1200x630 -> link preview when the site is shared
    app/icon.png             256x256  -> browser tab / favicon (94% ball, vs 78% below)
    app/apple-icon.png       180x180  -> <link rel="apple-touch-icon">
    public/icon-192.png      192x192  -> manifest (Android home screen)
    public/icon-512.png      512x512  -> manifest (splash / high-DPI)

TWO deliberate departures from the source artwork:

1. The header's THREE parts ship separately — ball, wordmark, and (in Nav.tsx) the tagline
   as live text — rather than as one flattened lockup. The artwork sets the tagline at 22px
   against a 366px lockup, i.e. 6% of its height; scaled to fit a header that is 62px tall
   the tagline lands around 2px and reads as a grey smudge. Setting it as text decouples
   its size from the mark's, so it can be legible without the ball having to grow to
   billboard size. See components/Nav.tsx for the layout that reassembles them.

2. The icons are built from the BALL ALONE, re-centred on an opaque square, rather than by
   cropping the right-hand tile. Two reasons: the tile carries a drop shadow that would
   bake a grey edge into the icon, and iOS/Android apply their OWN rounded mask — feeding
   them an already-rounded tile double-rounds it and leaves pale corners inside the mask.
   The ball is scaled to the same 78% of the canvas the artwork's tile uses, so the result
   is the right-hand logo, just with the platform supplying the rounding.

Opaque white background on the icons, for the same reason as before: iOS masks home-screen
icons and a transparent corner shows through as a hole.
"""

import os

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "assets", "logo-source.png")

# The artwork's flat background. Measured, not assumed — it is 254, not pure white, which
# matters because the alpha extraction below solves against it.
BG = np.array([254.0, 254.0, 254.0])

# Regions of assets/logo-source.png, as (left, top, right, bottom) in its own pixels.
# Measured from the file; re-measure if the artwork is ever replaced.
BALL = (37, 238, 402, 604)        # left lockup's ball mark, 365x366
WORDMARK = (449, 344, 1026, 470)  # "FBBSim" only — the tagline sits below, at y 503..524
LOCKUP = (37, 238, 1026, 604)     # the WHOLE left logo, tagline included, 989x366

# The ball occupies this fraction of the app tile's width in the source artwork.
BALL_ON_TILE = 0.78

WHITE = (255, 255, 255)

ICON_TARGETS = [
    # (path, size, how much of the canvas the ball fills)
    #
    # All of these are the artwork's own mark on white. They differ only in how much of the
    # canvas the ball takes.
    #
    # The FAVICON is the odd one out at 94%. It is looked at 16-32px across in a browser
    # tab, and at that size the generous padding that makes a home-screen icon look composed
    # is just thrown-away pixels. The home-screen icons keep the artwork's own 78%, because
    # those ARE seen large, where the padding reads as composition and the white tile is the
    # artwork's right-hand logo.
    (os.path.join(ROOT, "app", "icon.png"), 256, 0.94),
    (os.path.join(ROOT, "app", "apple-icon.png"), 180, BALL_ON_TILE),
    (os.path.join(ROOT, "public", "icon-192.png"), 192, BALL_ON_TILE),
    (os.path.join(ROOT, "public", "icon-512.png"), 512, BALL_ON_TILE),
]


def to_alpha(rgb: Image.Image) -> Image.Image:
    """
    Lift the flat background out of a crop, turning it into real transparency.

    Solves the compositing equation the artwork was flattened with. Every pixel is
    `P = a*F + (1-a)*BG` for some foreground colour F and coverage a; taking the channel
    that moved FURTHEST from the background recovers a, and F follows by unpremultiplying.
    A plain "make near-white transparent" threshold instead leaves a hard, aliased edge on
    every curve in the mark — this keeps the artwork's own anti-aliasing intact.

    The mid-greys in the bar chart come back as partially transparent dark pixels rather
    than opaque grey. Over a light background — which is the only kind this app has — they
    composite back to exactly the original colour.
    """
    arr = np.asarray(rgb).astype(np.float64)
    alpha = ((BG - arr) / BG).max(axis=2).clip(0.0, 1.0)
    safe = np.where(alpha[..., None] > 0, alpha[..., None], 1.0)
    fg = ((arr - (1.0 - alpha[..., None]) * BG) / safe).clip(0, 255)
    out = np.dstack([fg, alpha * 255.0]).round().astype(np.uint8)
    return Image.fromarray(out, mode="RGBA")


def build_icon(src: Image.Image, size: int, frac: float) -> Image.Image:
    """The ball on an opaque white square, filling `frac` of the canvas."""
    ball = to_alpha(src.crop(BALL))
    # Supersample the resize so the thin seams stay smooth at 180px and below.
    target = max(1, round(size * frac))
    scale = target / max(ball.width, ball.height)
    ball = ball.resize(
        (max(1, round(ball.width * scale)), max(1, round(ball.height * scale))),
        Image.LANCZOS,
    )

    canvas = Image.new("RGBA", (size, size), WHITE + (255,))
    canvas.alpha_composite(ball, ((size - ball.width) // 2, (size - ball.height) // 2))
    return canvas.convert("RGB")


# An inverted favicon - the mark knocked out on a solid orange chip - was tried here and
# reverted on the owner's call. It read better at 16px against every tab-bar colour, but
# the white tile is the brand, and matching the rest of the icon set won. If small-size
# visibility comes up again, that is the lever: a filled field, not more scaling.


def build_og(src: Image.Image) -> Image.Image:
    """
    The link-preview card: the full lockup, centred on white, at 1200x630.

    1200x630 is the size every platform crops toward (Facebook/LinkedIn/Slack want ~1.91:1,
    Twitter's summary_large_image the same), so one image covers all of them.

    This is the ONE place the artwork's own tagline is used as artwork rather than being
    reset as text: a share card is 1200px wide, so the tagline lands around 26px tall and
    the resolution is there for it. The header has to re-set it only because 62px of
    header cannot give it more than about 2px.

    Deliberately just the logo, generously sized and centred. Every platform draws the
    title and description as text of its own directly beneath this image, so repeating
    them inside it produces a card that says everything twice.
    """
    card = Image.new("RGB", (1200, 630), WHITE)
    lockup = to_alpha(src.crop(LOCKUP))
    width = round(1200 * 0.66)
    scale = width / lockup.width
    lockup = lockup.resize((width, round(lockup.height * scale)), Image.LANCZOS)
    card.paste(
        lockup,
        ((1200 - lockup.width) // 2, (630 - lockup.height) // 2),
        lockup,
    )
    return card


def build_tile(src: Image.Image, size: int) -> Image.Image:
    """
    The right-hand app tile for use INSIDE a page: white rounded square, ball centred,
    transparent outside the corners.

    Drawn rather than cropped, because the tile in the artwork is a near-white shape on a
    near-white background — `to_alpha` would dissolve the tile along with the background,
    since it cannot tell them apart. The corner radius matches the artwork's (~22%).

    Distinct from the ICON outputs above, which are square and hard-cornered on purpose:
    those get their rounding from iOS/Android. This one has to supply its own, because
    nothing masks an <img> sitting on a page.
    """
    ss = 4  # supersample, so the corner curve doesn't stair-step
    big = size * ss
    tile = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle(
        (0, 0, big - 1, big - 1), radius=round(big * 0.22), fill=WHITE + (255,)
    )

    ball = to_alpha(src.crop(BALL))
    target = max(1, round(big * BALL_ON_TILE))
    scale = target / max(ball.width, ball.height)
    ball = ball.resize(
        (max(1, round(ball.width * scale)), max(1, round(ball.height * scale))),
        Image.LANCZOS,
    )
    tile.alpha_composite(ball, ((big - ball.width) // 2, (big - ball.height) // 2))
    return tile.resize((size, size), Image.LANCZOS)


def main():
    if not os.path.exists(SOURCE):
        raise SystemExit(f"missing {os.path.relpath(SOURCE, ROOT)} — the master artwork")
    src = Image.open(SOURCE).convert("RGB")

    # The header's two pieces, exported separately so the tagline can be laid out as real
    # text BETWEEN them — see components/Nav.tsx for why it isn't baked into the artwork.
    for region, name in ((BALL, "logo-mark.png"), (WORDMARK, "logo-word.png")):
        piece = to_alpha(src.crop(region))
        path = os.path.join(ROOT, "public", name)
        piece.save(path, format="PNG", optimize=True)
        print(
            f"wrote {os.path.relpath(path, ROOT)} "
            f"({piece.width}x{piece.height}, transparent)"
        )

    tile_path = os.path.join(ROOT, "public", "logo-tile.png")
    build_tile(src, 384).save(tile_path, format="PNG", optimize=True)
    print(f"wrote {os.path.relpath(tile_path, ROOT)} (384x384, rounded, transparent)")

    og_path = os.path.join(ROOT, "public", "og.png")
    build_og(src).save(og_path, format="PNG", optimize=True)
    print(f"wrote {os.path.relpath(og_path, ROOT)} (1200x630, link preview)")

    for path, size, frac in ICON_TARGETS:
        build_icon(src, size, frac).save(path, format="PNG", optimize=True)
        print(f"wrote {os.path.relpath(path, ROOT)} ({size}x{size}, ball {frac:.0%})")


if __name__ == "__main__":
    main()
