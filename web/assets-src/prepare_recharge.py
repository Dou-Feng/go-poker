"""Generate transparent recharge WebPs. Requires Pillow; run from any directory."""
from pathlib import Path

from PIL import Image

SOURCE = Path(__file__).resolve().parent / "recharge"
TARGET = SOURCE.parent.parent / "public/assets/recharge/diamond"
TARGET.mkdir(parents=True, exist_ok=True)

for source in sorted(SOURCE.glob("diamond_*.png")):
    with Image.open(source) as image:
        image = image.convert("RGBA")
        image.thumbnail((576, 576), Image.Resampling.LANCZOS)
        target = TARGET / f"{source.stem}.webp"
        image.save(target, "WEBP", quality=85, method=6)
        print(f"{source.name}: {source.stat().st_size:,} -> {target.stat().st_size:,} bytes ({image.width}x{image.height})")
