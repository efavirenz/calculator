"""
One-off icon generator for the calculator PWA. Not part of the
shipped app -- run locally (`python3 generate_icons.py`) whenever the
icon design needs to be regenerated; the output PNGs are what actually
get committed/deployed.
"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "icons")
os.makedirs(OUT_DIR, exist_ok=True)

BLACK = (0, 0, 0, 255)
ORANGE = (255, 159, 10, 255)
GRAY = (99, 99, 102, 255)
WHITE = (255, 255, 255, 255)


def rounded_square(size, radius_ratio, bg):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = int(size * radius_ratio)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=bg)
    return img, draw


def draw_calculator_glyph(draw, size, safe_margin_ratio=0.18):
    """Draws a simplified 2x2 calculator button grid as the glyph."""
    margin = int(size * safe_margin_ratio)
    grid_size = size - 2 * margin
    gap = int(grid_size * 0.12)
    cell = (grid_size - gap) // 2
    radius = int(cell * 0.28)

    positions = [
        (margin, margin),
        (margin + cell + gap, margin),
        (margin, margin + cell + gap),
        (margin + cell + gap, margin + cell + gap),
    ]
    colors = [GRAY, GRAY, GRAY, ORANGE]

    for (x, y), color in zip(positions, colors):
        draw.rounded_rectangle([x, y, x + cell, y + cell], radius=radius, fill=color)

    # Draw a white "+" on the orange (bottom-right) cell to read as a
    # calculator operator button at a glance.
    bx, by = positions[3]
    cx, cy = bx + cell / 2, by + cell / 2
    arm = cell * 0.28
    thickness = max(2, int(cell * 0.09))
    draw.line([(cx - arm, cy), (cx + arm, cy)], fill=WHITE, width=thickness)
    draw.line([(cx, cy - arm), (cx, cy + arm)], fill=WHITE, width=thickness)


def make_icon(size, radius_ratio, filename, padded=False):
    img, draw = rounded_square(size, radius_ratio, BLACK)
    margin_ratio = 0.28 if padded else 0.18
    draw_calculator_glyph(draw, size, safe_margin_ratio=margin_ratio)
    img.save(os.path.join(OUT_DIR, filename))
    print(f"wrote {filename}")


# Standard + maskable app icons
make_icon(192, 0.22, "icon-192.png")
make_icon(512, 0.22, "icon-512.png")
# Maskable icons need extra safe padding since OSes crop to a circle/shape
make_icon(192, 0.5, "icon-maskable-192.png", padded=True)
make_icon(512, 0.5, "icon-maskable-512.png", padded=True)

# Apple touch icons (iOS ignores maskable icons and manifest sizing)
make_icon(152, 0.22, "apple-touch-icon-152.png")
make_icon(167, 0.22, "apple-touch-icon-167.png")
make_icon(180, 0.22, "apple-touch-icon-180.png")

print("done")
