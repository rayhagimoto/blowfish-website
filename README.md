# Personal Website

Hugo-based personal site using the [Blowfish](https://github.com/nunocoracao/blowfish.git) theme. Deployed on Netlify.

---

## Project structure

```
├── assets/
│   ├── css/
│   │   ├── compiled/main.css       # Tailwind output (generated, do not edit)
│   │   ├── custom.css              # Custom component styles and overrides
│   │   └── schemes/earthy.css      # Color scheme as CSS custom properties
│   ├── icons/                      # Custom SVG icons
│   ├── img/
│   │   ├── gallery/                # Gallery images (0000.jpg, 0001.jpg, ...)
│   │   └── profile.jpeg
│   ├── js/                         # Custom JS (appearance, gallery, search, etc.)
│   └── lib/                        # Vendored JS libs (KaTeX, Chart.js, Fuse.js)
├── config/_default/hugo.toml       # Main Hugo config (site params, menus, outputs)
├── content/
│   ├── authors/                    # Author profile pages
│   ├── gallery/                    # Gallery section content
│   ├── notes/                      # Short-form notes
│   └── posts/                      # Blog posts (each in its own directory)
├── layouts/                        # Hugo template overrides (take priority over theme)
│   ├── _default/
│   ├── gallery/
│   ├── partials/
│   │   ├── header/basic.html       # Custom header (preserves logo SVG currentColor logic)
│   │   └── logo.html               # Custom logo partial
│   └── shortcodes/
├── scripts/
│   ├── add_new_image.py            # Prepend a new image to the gallery
│   └── fix_gallery_filenames.py    # One-time: flatten subdirs into sequential filenames
├── static/                         # Files copied as-is to output root
├── themes/blowfish/                # Theme (git submodule)
├── netlify.toml                    # Netlify build config
└── tailwind.config.js              # Tailwind CSS config
```

---

## Commands

### Local development

```bash
hugo server
```

Starts a live-reloading dev server at `http://localhost:1313`. Drafts are excluded by default; include them with `--buildDrafts`.

```bash
hugo server --buildDrafts
```

### Build

```bash
npm run build
```

Builds the gallery, admin editor assets, and public Hugo site. Outputs the static site to `public/`. `--gc` cleans unused cache files; `--minify` minifies HTML/CSS/JS.

### Deploy

```bash
netlify deploy --prod
```

Deploys the `public/` directory to production. Netlify also builds automatically on push if CI is configured, using the command in `netlify.toml`.

### Check for build errors

```bash
hugo --gc --minify 2>&1 | grep ERROR
```

Or just run `hugo --gc --minify` and watch for `ERROR` lines in the output.

---

## Styling

Tailwind CSS must be compiled whenever the theme's base CSS or `tailwind.config.js` changes. The output is committed to `assets/css/compiled/main.css`.

```bash
npx tailwindcss --config=tailwind.config.js --input=themes/blowfish/assets/css/main.css --output=assets/css/compiled/main.css
```

In VS Code, this is also available as the default build task (`Ctrl+Shift+B` / `Cmd+Shift+B`).

Custom styles live in:
- `assets/css/custom.css` — component overrides, layout tweaks, dark mode adjustments
- `assets/css/schemes/earthy.css` — color palette defined as CSS custom properties

---

## Submodules

This repo has two submodules:

| Path | Repo |
|---|---|
| `themes/blowfish` | https://github.com/nucocoracao/blowfish.git |
| `content/posts/gamblers-ruin/gamblers-ruin-marimo` | https://github.com/rayhagimoto/gamblers-ruin-blog-marimo |

### Initialize after cloning

```bash
git submodule update --init --recursive
```

### Update submodules to latest

```bash
# Update all submodules
git submodule update --remote --merge

# Update only the theme
git submodule update --remote --merge themes/blowfish
```

After updating the theme, rebuild Tailwind and test with `hugo server` — theme updates can introduce breaking changes to template partials. If any `partial "..." not found` errors appear, check `layouts/partials/` for stale overrides that reference renamed or removed theme partials.

### Check submodule status

```bash
git submodule status
```

---

## Gallery

Gallery images live in `assets/img/gallery/` with sequential zero-padded filenames (`0000.jpg`, `0001.jpg`, ...). The lowest number appears first in the gallery.

### Add a new image (prepends as most recent)

```bash
uv run scripts/add_new_image.py /path/to/image.jpg

# Specify a different gallery directory
uv run scripts/add_new_image.py /path/to/image.jpg --gallery-dir assets/img/gallery
```

This increments all existing filenames by 1 and copies the new image in as `0000.jpg`.

### Fix/flatten filenames (one-time migration)

```bash
uv run scripts/fix_gallery_filenames.py
```

Flattens subdirectory-organized images into the flat `NNNN.jpg` naming scheme. Converts PNGs to JPG. Run from the project root.

---

## Admin CMS

The CMS implementation is complete. Its production configuration and first administrator setup are separate from the public Hugo site. See [setup, security, free-tier limits, and verification](docs/CMS.md).

The admin studio supports mandatory authenticator 2FA, recovery codes, revocable trusted browsers, Markdown/source/split/hybrid/rich-text editing, equations, image paste/drop, and gallery albums, captions, metadata, and ordering. Videos remain a future planned feature.

Netlify hosts the admin interface, API, and private images; the linked Neon Free project stores content and authentication records. Public pages remain static and use explicitly published snapshots.

```bash
npm run cms:prepare
npm run cms:migrate
npm run cms:import
npm run cms:previews
npm run dev:cms
```

These commands use `.env.cms-development.local`. Create the isolated development branch and pull its PostgreSQL connection first; never substitute the production connection for testing. Private credentials, previews, and generated editor files are ignored by Git.
