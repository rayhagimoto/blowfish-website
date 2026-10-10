# Website CMS

The admin studio lives at `/admin/`. Videos are a future planned feature. The public site continues to be a static Hugo/Blowfish site.

## Current implementation and activation status

Implemented and tested locally. Production configuration was prepared on 2026-10-10: the production database was migrated and imported, 103 private image-library previews were seeded, and the production-only Netlify environment and `CMS publish` hook were configured. Deployment uses the repository's `main` branch and Netlify's hosted build. Confirm the latest deployment is **Published** before opening the private production setup link. The administrator creates the production password and enrolls 2FA personally; the development login does not carry over.

The sole administrator email is `rayhagimoto@gmail.com`. Netlify and Neon accounts are already linked; no further hosting account or paid service is required. Use any authenticator app supporting TOTP.

An isolated Neon `cms-development` branch was created for testing, expiring at **2026-10-11 23:00 UTC**. Its connection and generated development secrets are in `.env.cms-development.local`, mode 0600. `.env.local` and the production Neon context were preserved. Temporary test users, posts, uploads and gallery edits were removed or restored. Private legacy previews remain in the local development store.

## Features

- Single administrator, password sign-in, mandatory TOTP enrollment, encrypted recovery codes, and 30-day trusted browsers that can be revoked. Sessions expire after eight hours and can be revoked individually or together.
- Vditor source, split preview, hybrid live rendering, and rich-text modes; Unicode font choices; headings, lists, tables, code, links, equations, and undo/redo. Editor scripts, fonts, syntax highlighting, and math assets are bundled locally.
- Image selection, clipboard paste and drop, browser compression for oversized uploads, a reusable image library, captions, and private publication preview.
- Gallery upload, selection, ordering, albums, captions, dates, location, and metadata. Gallery edits remain draft until explicitly published.
- Autosaved post drafts with revision conflict protection and draft export. Publishing saves a separate snapshot; subsequent edits stay private until published again.
- Import of existing posts, bundles, original frontmatter and gallery metadata without rewriting tracked content. Unchanged imported bodies retain their trusted website formatting, including across unpublish/republish. Editing those bodies converts them to sanitized Markdown HTML; review custom shortcodes and embeds in the publication preview.

## Free service constraints

Verified on 2026-10-10 through the authenticated CLIs:

- Neon organization plan is **Free**. Only an expiring test branch was added; no paid backend service was provisioned.
- Netlify account remains **legacy Free**, with no payment method, no active Pro trial, and automatic top-ups disabled. Reported allowances are 300 monthly build minutes, 125,000 function invocations, and 100 GB bandwidth. These are allowances, not confirmed remaining usage.
- A tiny private Netlify Blobs image was written, read back, and deleted successfully on the existing account. Exact remaining Blobs allowance was not exposed by the account inspection.

The application caps stored uploads plus private imported-image previews at **512 MiB**, accepts at most **4 MiB** per upload, and rate limits uploads and requests. Public reading does not invoke the CMS database or API. Publishing uses Hugo builds, so publish in batches and monitor account usage. Build requests within one minute are suppressed; the CMS explicitly reports that another publish is needed to ensure the latest edits are deployed. A successful build-hook request means a build was requested, not that deployment has completed.

There is no plan upgrade or paid fallback. [Legacy Free limits can pause sites or builds](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-legacy-plans/billing-faq-for-legacy-plans/). Keep the existing plan; [switching from legacy pricing is irreversible](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-legacy-plans/legacy-pricing-plans/).

## Local development

Requires Node **22+** and **Hugo extended 0.150.1**. Existing gallery image processing needs the extended build. `HUGO_BINARY` can name a local executable.

```sh
# Pull an explicitly isolated branch; do not overwrite .env.local.
neon env pull --project-id green-term-51774415 --branch cms-development --file .env.cms-development.local --service postgres
npm ci
npm run cms:prepare
npm run cms:migrate
npm run cms:import
npm run cms:previews
npm run dev:cms
```

Open `.cms-local/development-setup.html` locally to follow the expiring setup link. Create a development-only password, enroll an authenticator, and save the recovery codes. Setup links use a fragment removed immediately from the browser address; tokens are never put in public assets or logs. Setup stops working after the first account exists.

For a CMS-enabled public build:

```sh
node --env-file=.env.cms-development.local scripts/cms-hugo-build.mjs
```

`npm run build` also builds gallery/admin assets. Supply the same private environment and `CMS_ENABLED=1` when building CMS publications. With CMS disabled the repository content builds as before; with it enabled a database/blob/export failure stops deployment rather than publishing an incomplete site.

## Production activation

Run activation only when ready to deploy the reviewed changes. Test commands must continue to use the isolated branch.

1. Run `npm run cms:prepare:production`. This writes a separate mode-0600 `.env.cms-production.local`, preserves existing values, generates random secrets, and creates `.cms-local/production-setup.html`. It never prints secrets. The bootstrap link expires in 24 hours; regenerate only the setup token/expiry if activation is delayed.
2. Apply migrations with `node --env-file=.env.cms-production.local scripts/cms-migrate.mjs`, then import with `node --env-file=.env.cms-production.local scripts/cms-import.mjs`. Migration tooling selects the direct connection; runtime/build use the pooled connection.
3. In the `ray-hagimoto` project's **Project configuration > Environment variables**, add these values from `.env.cms-production.local`, selecting **Production** as the deploy context: `DATABASE_URL`, `CMS_ENABLED`, `CMS_STORAGE`, `CMS_ORIGIN`, `CMS_OWNER_EMAIL`, `CMS_AUTH_SECRET`, `CMS_SETUP_TOKEN`, and `CMS_SETUP_EXPIRES_AT`. Use the default **all scopes** on Free; [custom variable scopes require Pro or Enterprise](https://docs.netlify.com/build/environment-variables/overview/). The build and functions need the pooled `DATABASE_URL`; keep `DATABASE_URL_UNPOOLED` and `NEON_BRANCH` local. Never commit the private file or embed these values in browser assets. Runtime Blobs access uses Netlify's function context; no account-wide Netlify token is required in deployed functions.
4. For local private-preview seeding only, supply `NETLIFY_SITE_ID` and an authenticated Netlify token privately to `cms-seed-previews.mjs`. This creates small WebP previews of imported images so they remain usable in the library even when unpublished; original repository assets remain the public build sources. The token need not be saved in project or function configuration.
5. In **Project configuration > Developer settings > Continuous deployment > Build hooks**, create a hook named `CMS publish` for the production branch `main`. Store its URL privately as a **Production** environment variable `CMS_BUILD_HOOK`, using all scopes on Free. Without a hook, publication is saved and the UI tells you to run a website build manually. Keep unrelated Netlify variables/settings unchanged.
6. Commit the reviewed CMS source, templates, package lockfile, and updated `netlify.toml`, then push them to the repository's production branch `main`. The CMS implementation currently includes uncommitted changes, so triggering a build of the existing remote branch alone will not install it. Use Netlify's hosted Linux build; wait for a successful **Published** deployment in the Deploys page. Sharp has platform-specific binaries: a function packaged on macOS must not be treated as a tested Linux production bundle.
7. Open `.cms-local/production-setup.html` locally, follow its private link to `https://rayhagimoto.space/admin/`, create your production password, enroll TOTP, and save recovery codes offline. The development account and its authenticator enrollment do not carry over. Verify that logged-out CMS and private-image requests are denied and that a test publication appears on the public site after its build finishes. Remove `CMS_SETUP_TOKEN` and `CMS_SETUP_EXPIRES_AT` from Netlify afterwards and rebuild so deployed functions receive the change. Recovery-code sign-in still requires the password. Keep `CMS_AUTH_SECRET` stable; rotating it invalidates encrypted authentication data and requires a deliberate recovery/migration procedure.

For step 4 on this Mac, the following reads the existing Netlify CLI login privately and gives its token only to the preview-seeding process. It does not save or print the token:

```sh
node --env-file=.env.cms-production.local --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const login = JSON.parse(readFileSync(join(homedir(), 'Library/Preferences/netlify/config.json'), 'utf8'));
const token = login.users?.[login.userId]?.auth?.token;
if (!token) throw new Error('Sign in with the Netlify CLI first.');
const { siteId } = JSON.parse(readFileSync('.netlify/state.json', 'utf8'));
if (!siteId) throw new Error('Link this directory to the Netlify project first.');
const result = spawnSync(process.execPath, ['--env-file=.env.cms-production.local', 'scripts/cms-seed-previews.mjs'], {
  env: { ...process.env, NETLIFY_SITE_ID: siteId, NETLIFY_AUTH_TOKEN: token }, stdio: 'inherit',
});
process.exit(result.status ?? 1);
NODE
```

Deploy previews should use their own database, secrets and storage configuration, or leave CMS disabled. Netlify Blobs stores are site-scoped; do not connect an editable preview to production CMS data. A localhost storage configuration is rejected for deployed origins.

## Security design

Better Auth handles password hashing, TOTP, encrypted secrets/codes, signed trusted-browser cookies, and native auth rate limits. Managed Neon Auth was not selected because mandatory MFA is required here.

Every content, gallery, security and runtime-image route checks the configured owner, enabled MFA, and **MFA completion for that particular session**. An old password-only session remains blocked even after another session enrolls MFA. Public signup, MFA disabling, OAuth, email OTP and password-reset endpoints are not exposed. Bootstrap requires a constant-time checked, high-entropy, unexpired token and can create only the configured owner.

Cookies are HttpOnly, Secure in production and SameSite Strict. Native session caching is disabled. Unsafe requests require the exact origin and reject cross-site fetch metadata. Persistent limits use the platform connection address, replacing inbound IP headers. PostgreSQL connections verify TLS; Better Auth tables use an explicitly qualified separate schema rather than session search paths.

New Markdown publication drops raw HTML, sanitizes URLs/markup, and renders KaTeX with trust disabled and expansion/size bounds. Hugo shortcode delimiters in generated CMS HTML are escaped. The preview is sandboxed without script execution; the admin has a restrictive CSP and no-store responses. Original imported content remains trusted only when its body is unchanged from the immutable repository import.

Uploads are decoded rather than accepted by MIME label; only still JPEG/PNG/WebP is allowed. Sharp applies orientation, removes EXIF/GPS/ICC/XMP, caps new-image decoding at 40 million pixels, resizes to 4096 pixels and re-encodes WebP. Private imported previews are resized to 1600 pixels. Storage keys are canonical UUIDs, references are validated, and a database lock prevents concurrent upload/deletion/reference changes from bypassing the storage budget. Referenced or repository-owned images cannot be deleted. Failure cleanup checks durable rows before deleting a potentially committed blob.

Public builds read only published snapshots and publish only referenced managed uploads. Images become public when referenced by published content; unpublishing removes generated copies on the next successful deployment. External caches or previously downloaded copies cannot be recalled. An export error preserves the currently deployed site.

These controls and tests reduce risk; they cannot guarantee absolute security. Keep dependencies patched, review changes to auth/storage, retain backups, and test the actual deployed configuration.

## Verification

```sh
npm run test:cms
npm run test:cms:ui
```

The normal CMS tests touch no remote database. The real Postgres test requires both `CMS_RUN_INTEGRATION_TESTS=1` and an explicit `CMS_TEST_DATABASE_URL`. The live browser test requires `CMS_LIVE_TEST=1` and `cms/admin/live.config.mjs`; it is restricted to local storage and the development connection. Its cleanup restores gallery state and removes fixture accounts/content; do not run it against production.

Completed checks include real Better Auth TOTP/trusted/recovery flows, authorization/CSRF denial before data access, backup-code replay, old-session MFA bypass attempts, canonical private-image access, decoded-image validation/metadata removal, budget and commit-failure cleanup, actual Postgres revisions/snapshots/gallery lifecycle, and real browser signup/enrollment/edit/upload/publish/revocation. Actual extended-Hugo builds verified equations, assets, galleries and unpublish cleanup. The complete legacy public build succeeded with 33 pages and 427 processed images. Dependency audit reported zero known vulnerabilities.

## Changes made

- `cms/config.mjs`, `db.mjs`, `http.mjs`, `auth.mjs`, `api.mjs`: validated server settings, qualified DB access, owner/MFA gate, bootstrap, CSRF/rate limits, revision-aware post/gallery/security APIs.
- `cms/media.mjs`, `storage.mjs`, `markdown.mjs`, `publishing.mjs`: safe image processing/private storage, bounded sanitization/math and publishing hooks.
- `cms/migrations/001-content.sql` through `004-trusted-import.sql`: content/auth namespaces, drafts/snapshots, media, gallery, limits/build records, deletion tombstones, private previews and immutable imported bodies.
- `cms/admin/`, `static/admin/index.html`, `scripts/build-admin.mjs`: admin UI, bundled local dependencies, fixture/live browser tests and public math assets.
- `scripts/cms-prepare.mjs`, `cms-migrate.mjs`, `cms-import.mjs`, `cms-seed-previews.mjs`, `cms-dev.mjs`: private environment preparation, versioned setup/import, private previews and local server.
- `scripts/cms-export.mjs`, `cms-hugo-build.mjs`: snapshot export and staged Hugo builds.
- `layouts/partials/cms-gallery-images.html`, both gallery image templates, `extend-head-uncached.html`: ordered publication manifest, metadata and matching public math styles.
- `netlify/functions/cms.mjs`, `netlify.toml`: same-origin routes, trusted platform IP, Node 22, function bundling/admin headers; removed the old always-successful ignore command so publishing builds can run.
- `package.json`, lockfile: editor/auth/storage/DB/math/parser dependencies and build/test/setup commands; removed vulnerable executable frontmatter parsing and updated KaTeX.
- `.gitignore`, `.env.example`, README and this guide: private/generated file exclusions and activation documentation.

The pre-existing Neon skill/MCP setup is preserved separately from the CMS deployment. Security tests have one focused commit (`f0fda90`); the remaining CMS implementation and assertions are included in the production deployment commit. Private environment files, setup links, and generated assets remain excluded from Git.
