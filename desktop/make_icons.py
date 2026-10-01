"""Builds the app icons from the round logo (needs Pillow).

The source is assets/logo-1024.png, a 1024 px render of assets/logo.svg (the
green circle with the map sheet, data layer and the coffee-bean pin). To
render it again after the SVG changes, any SVG renderer works, e.g. with the
Qt that comes with QGIS, or Inkscape:

    inkscape assets/logo.svg -w 1024 -h 1024 -o assets/logo-1024.png

Writes src-tauri/icons/ (icon.ico, icon.png, 32x32.png, 128x128.png,
128x128@2x.png) for the desktop app and assets/icon-192.png,
assets/icon-512.png for the web app manifest:

    python desktop/make_icons.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "src-tauri" / "icons"


def base(size: int = 1024) -> Image.Image:
    logo = Image.open(ROOT / "assets" / "logo-1024.png").convert("RGBA")
    # A little room around the circle, as other app icons have.
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    w = int(size * 0.94)
    img.alpha_composite(logo.resize((w, w), Image.LANCZOS), ((size - w) // 2, (size - w) // 2))
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    img = base()
    img.save(OUT / "icon.png")
    for name, s in (("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256)):
        img.resize((s, s), Image.LANCZOS).save(OUT / name)
    img.save(OUT / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    for s in (192, 512):
        img.resize((s, s), Image.LANCZOS).save(ROOT / "assets" / f"icon-{s}.png")
    print("icons written to", OUT, "and assets/icon-192.png, assets/icon-512.png")


if __name__ == "__main__":
    main()
