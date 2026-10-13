# Photography experiment

Branch: `codex/gallery-overhaul`. The previous gallery implementation was not read or modified. The gallery page selects a new Hugo layout through `type: gallery-overhaul` in its frontmatter, using the site's shared base layout, header, footer, typography, colors, and appearance controls. All 56 original gallery photographs and their sidecars are used in filename order.

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
- [PhotoSwipe 5.4.4](https://photoswipe.com/) owns lightbox navigation, focus trapping, swipe/pinch gestures, and zoom. Its core is a separate bundle loaded on opening. The full album is its data source, independent of rendered gallery batches. Neighboring slides preload in both directions.
- [Dynamic Caption 1.2.7](https://github.com/dimsemenov/photoswipe-dynamic-caption-plugin) positions optional captions below or beside photographs, accounting for available space.
- Hugo generates 480-, 800-, and 1200-pixel WebP previews at quality 85, without upscaling small sources. Gallery cards use a responsive `srcset` with their measured width, so browsers select a suitable preview for the screen's pixel density. Native Save Image and Copy Image on a gallery card target its preview; the card's link and full-size lightbox still target the original JPG. JPEG sources are published unchanged; other image formats are converted to JPG at their original dimensions.
- The gallery starts with empty reserved photo slots, without blurred placeholders. After masonry positions each batch, an IntersectionObserver loads only visible cards and cards within 400 pixels below or 200 pixels above the viewport. Visible cards receive higher fetch priority. Each photo waits for decoding before a 1500ms ease-out fade, 18-pixel upward reveal, and soft 8-pixel blur that clears to sharp; previews loaded ahead remain hidden until they enter the viewport. Reserved dimensions keep the layout steady, and each card reveals only once.
- The gallery uses three columns on desktop and two columns at viewport widths of 960 pixels or less, including phones and the no-JavaScript view.
- Data-saving/2G connections load only visible 480-pixel previews, without lookahead. The no-JavaScript view uses native lazy loading and responsive previews. Reduced motion removes gallery transitions, movement, and blur. The lightbox still loads its immediately adjacent slides on constrained connections, as required by PhotoSwipe.
- No gallery request depends on an external CDN. Library versions and the dependency lockfile are tracked. Compiled bundles and transformed images are generated during the build.
- Gallery entry scripts and stylesheets use content fingerprints so browsers fetch new assets after updates. The shared page body grows with its content and keeps a viewport minimum height, preserving the theme background throughout long galleries and the footer position on short pages.
- The site's dark-mode preference and appearance switcher, reduced motion, accessible album buttons, a manual load-more control, restored focus after closing, and a complete no-JavaScript gallery are included. Gallery styles are scoped to the gallery and lightbox and use the site's color variables.

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

- `layouts/gallery-overhaul/single.html`: gallery content within the shared site layout, collection data, and complete no-JavaScript fallback.
- `layouts/partials/extend-head-uncached.html`: gallery stylesheet loaded only for this page.
- `layouts/partials/gallery-overhaul/`: full-resolution JPGs, responsive previews, optional metadata, and fallback cards.
- `assets/gallery-overhaul/`: library integration and page styles.
- `assets/gallery-overhaul-build/`: generated bundles, watched and published by Hugo's asset pipeline.
- `tests/gallery/`: browser behavior and network loading checks.
- `netlify.toml`: dependency installation and gallery bundle build before Hugo.

To return to the original version, switch to `main`. Restart the server after switching branches to inspect that version.
