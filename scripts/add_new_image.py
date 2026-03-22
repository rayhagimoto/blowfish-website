# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "click",
# ]
# ///
"""
Python CLI script to add a new image as the first picture in my gallery.

Expected usage pattern:

    python add_new_image.py /path/to/file
    uv run scripts/add_new_image.py /path/to/file

What it does:
Increments filenames of all images in the gallery by +1, then adds the new image as the zero-th image.

Assume images are in with filenames fitting the pattern assets/img/gallery/NNNN.jpg (e.g. 0000.jpg, 0001.jpg).
Also shifts any corresponding YAML metadata sidecar files (NNNN.yaml) and creates a skeleton YAML for the new image.
"""

from pathlib import Path
import re
import shutil

import click

GALLERY_DIR_DEFAULT = Path("assets/img/gallery")
GALLERY_PATTERN = re.compile(r"^(\d{4})\.jpg$", re.IGNORECASE)

SKELETON_YAML = """\
title: # Americana Submarine
description: # Under the loop, across from the CBOT
location: # Chicago, IL
albums: # [Chicago, Street]

# Optional EXIF overrides (auto-read from image if omitted)
# date: # 2026-02-23
# focal_length: # 70mm
# lens: # Sigma 24-70mm F2.8 DG DN | Art 019
# shutter_speed: # 1/1000s
# iso: # 100
"""


def get_gallery_images(gallery_dir: Path) -> list[tuple[int, Path]]:
    """Return list of (number, path) for existing gallery images, sorted by number ascending."""
    if not gallery_dir.is_dir():
        return []
    entries = []
    for p in gallery_dir.iterdir():
        if not p.is_file():
            continue
        m = GALLERY_PATTERN.match(p.name)
        if m:
            entries.append((int(m.group(1)), p))
    return sorted(entries)


@click.command()
@click.argument(
    "image_path",
    type=click.Path(exists=True, path_type=Path),
    required=True,
)
@click.option(
    "--gallery-dir",
    type=click.Path(path_type=Path),
    default=None,
    help=f"Gallery directory (default: {GALLERY_DIR_DEFAULT})",
)
def main(image_path: Path, gallery_dir: Path | None) -> None:
    """Add a new image as the first picture in the gallery.

    Increments all existing gallery filenames by +1, then copies the new image as 0000.jpg.
    """
    gallery_dir = gallery_dir or GALLERY_DIR_DEFAULT
    gallery_dir = gallery_dir.resolve()

    if not gallery_dir.is_dir():
        raise click.ClickException(f"Gallery directory does not exist: {gallery_dir}")

    existing = get_gallery_images(gallery_dir)
    if not existing:
        # No existing images: just copy the new one as 0000.jpg
        dest = gallery_dir / "0000.jpg"
        shutil.copy2(image_path, dest)
        click.echo(f"Added {image_path} as {dest}")
    else:
        # Rename from highest index down so we never overwrite
        for num, path in reversed(existing):
            new_name = f"{num + 1:04d}.jpg"
            new_path = gallery_dir / new_name
            path.rename(new_path)
            click.echo(f"  {path.name} -> {new_name}")

            # Also shift the YAML sidecar if it exists
            yaml_path = gallery_dir / f"{num:04d}.yaml"
            if yaml_path.is_file():
                new_yaml = gallery_dir / f"{num + 1:04d}.yaml"
                yaml_path.rename(new_yaml)
                click.echo(f"  {yaml_path.name} -> {new_yaml.name}")

        dest = gallery_dir / "0000.jpg"
        shutil.copy2(image_path, dest)
        click.echo(f"Added {image_path} as {dest}")

    # Create skeleton YAML for the new image
    yaml_dest = gallery_dir / "0000.yaml"
    yaml_dest.write_text(SKELETON_YAML)
    click.echo(f"Created {yaml_dest}")


if __name__ == "__main__":
    main()
