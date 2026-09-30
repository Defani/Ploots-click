"""Builds the desktop app icons from assets/logo_light.png (needs Pillow).

The icon is the two asterisks of the Ploots logo on a dark rounded square.
Writes src-tauri/icons/: icon.ico, icon.png, 32x32.png, 128x128.png and
128x128@2x.png. Run it again only when the logo changes:

    python desktop/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "src-tauri" / "icons"
BG = (39, 40, 44, 255)


def base(size: int = 1024) -> Image.Image:
    logo = Image.open(ROOT / "assets" / "logo_light.png").convert("RGBA")
    stars = logo.crop((620, 92, 1320, 468))  # the purple and cyan asterisks
    # Keep only the colored pixels (the logo background is white).
    px = stars.load()
    for y in range(stars.height):
        for x in range(stars.width):
            r, g, b, a = px[x, y]
            if max(r, g, b) - min(r, g, b) < 60:
                px[x, y] = (0, 0, 0, 0)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 0.22), fill=255)
    img.paste(Image.new("RGBA", (size, size), BG), (0, 0), mask)
    w = int(size * 0.80)
    h = int(stars.height * w / stars.width)
    stars = stars.resize((w, h), Image.LANCZOS)
    img.alpha_composite(stars, ((size - w) // 2, (size - h) // 2))
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    img = base()
    img.save(OUT / "icon.png")
    for name, s in (("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256)):
        img.resize((s, s), Image.LANCZOS).save(OUT / name)
    img.save(OUT / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
