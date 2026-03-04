# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pillow",
# ]
# ///
"""
One-time script: flatten gallery subdirs (01_japan, 02_london, ...) into assets/img/gallery
with sequential names 0000.jpg, 0001.jpg, ... Converts PNG to JPG via PIL.

Run from project root: uv run scripts/fix_gallery_filenames.py
"""

from pathlib import Path
import shutil
import sys

from PIL import Image

# Project root = cwd when script is run from project root
PROJECT_ROOT = Path.cwd()
GALLERY_DIR = PROJECT_ROOT / "assets" / "img" / "gallery"
REQUIRED_FIRST_IMAGE = GALLERY_DIR / "01_japan" / "000.jpg"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}


def is_image(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS


def subdirs_sorted(gallery: Path) -> list[Path]:
    """Return subdirectories of gallery sorted by name (01_japan, 02_london, ...)."""
    return sorted(p for p in gallery.iterdir() if p.is_dir())


def images_sorted(subdir: Path) -> list[Path]:
    """Return image paths in subdir sorted by filename (ascending, Python default)."""
    return sorted(
        (p for p in subdir.iterdir() if is_image(p)),
        key=lambda p: p.name,
    )


def convert_to_jpg(src: Path, dest: Path) -> None:
    """Convert image to JPG and write to dest. Removes src if it was PNG."""
    img = Image.open(src)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    img.save(dest, "JPEG", quality=95)
    src.unlink()


def main() -> None:
    if not REQUIRED_FIRST_IMAGE.exists():
        print(
            f"Expected first image not found: {REQUIRED_FIRST_IMAGE}",
            file=sys.stderr,
        )
        sys.exit(1)

    if not GALLERY_DIR.is_dir():
        print(f"Gallery directory not found: {GALLERY_DIR}", file=sys.stderr)
        sys.exit(1)

    subdirs = subdirs_sorted(GALLERY_DIR)
    counter = 0

    for subdir in subdirs:
        for path in images_sorted(subdir):
            dest = GALLERY_DIR / f"{counter:04d}.jpg"
            if path.suffix.lower() == ".png":
                convert_to_jpg(path, dest)
                print(f"  {path} -> {dest.name} (converted PNG)")
            else:
                shutil.move(str(path), str(dest))
                print(f"  {path.name} -> {dest.name}")
            counter += 1

    print(f"Done. {counter} images in {GALLERY_DIR}.")


if __name__ == "__main__":
    main()
