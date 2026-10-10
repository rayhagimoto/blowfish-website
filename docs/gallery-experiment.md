# Photography experiment

Branch: `codex/gallery-overhaul`. The previous gallery source was not read or modified. The gallery page selects a new standalone Hugo layout through `type: gallery-overhaul` in its frontmatter. All 56 original gallery photographs and their sidecars are used in filename order.

## Run

Use Node 20+ and Hugo **extended** 0.150.1 (compatible with the pinned Blowfish theme).

```sh
git submodule update --init themes/blowfish
npm ci
npm run dev
```

Open <http://localhost:9099/gallery/>. For JavaScript or stylesheet development, run `npm run watch:gallery` in another terminal. Hugo watches image, metadata, and template changes. The first image build takes several minutes; subsequent builds reuse Hugo's image cache.

```sh
npm run build
npm run test:gallery
```

Browser checks use installed Google Chrome. They reuse an existing server on port 9099 or start one automatically.

## Implementation

- [InfiniteGrid 4.13.0](https://naver.github.io/egjs-infinitegrid/Guides/) owns masonry positioning, resize handling, and scroll-triggered appends. Twelve photographs are rendered per batch. Previously loaded cards remain mounted to preserve keyboard navigation; virtualization offers little benefit for this 56-image collection.
- [PhotoSwipe 5.4.4](https://photoswipe.com/) owns lightbox navigation, focus trapping, swipe/pinch gestures, zoom, and responsive image selection. Its core is a separate bundle loaded on opening. The full album is its data source, independent of rendered gallery batches. Neighboring slides preload in both directions.
- [Dynamic Caption 1.2.7](https://github.com/dimsemenov/photoswipe-dynamic-caption-plugin) positions optional captions below or beside photographs, accounting for available space.
- Hugo produces embedded 48-pixel previews and WebP candidates at 320, 640, 960, 1440, and 2048 pixels, plus a largest version fitted within 3000 × 3000. Candidates are capped at the source image's size. Gallery images use smaller candidates; PhotoSwipe updates `sizes` when zooming so the browser can request a larger version.
- Native lazy loading, reserved image dimensions, asynchronous decoding, high priority for the first three photographs, thumbnail neighbor prefetching, and reduced prefetching on data-saving/2G connections keep unnecessary work down. The lightbox still loads its immediately adjacent slides on constrained connections, as required by PhotoSwipe.
- No gallery request depends on an external CDN. Library versions and the dependency lockfile are tracked. Compiled bundles and transformed images are generated during the build.
- System dark mode, reduced motion, accessible album buttons, a manual load-more control, restored focus after closing, and a complete no-JavaScript gallery are included.

## Titles and metadata

Add images under `assets/img/gallery/` with an optional sidecar sharing the same basename:

```yaml
title: Chicago Loop
description: An optional caption.
location: Chicago, IL
albums: [Chicago]
camera: Optional override of the EXIF camera
lens: Optional override of the EXIF lens
```

Every field and the sidecar itself is optional. A title can be shown without metadata, metadata without a title, or neither. Available EXIF date, camera, lens, exposure, aperture, ISO, and focal length are included. GPS coordinates are not exposed. Hugo escapes caption text before it reaches the lightbox; accessible captions also remain in the gallery markup.

## Layout and build files

- `layouts/gallery-overhaul/single.html`: standalone page and initial batch.
- `layouts/partials/gallery-overhaul/`: image variants, optional metadata, and cards.
- `assets/gallery-overhaul/`: library integration and page styles.
- `tests/gallery/`: browser behavior and network loading checks.
- `netlify.toml`: dependency installation and gallery bundle build before Hugo.

To return to the original version, switch to `main`. Restart the server after switching branches to inspect that version.
