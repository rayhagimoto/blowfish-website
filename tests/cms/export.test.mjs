import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseToml } from "@iarna/toml";
import { exportPublishedContent, exportFromEnvironment } from "../../scripts/cms-export.mjs";
import { parseFrontmatter } from "../../scripts/cms-import.mjs";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const DRAFT = "33333333-3333-4333-8333-333333333333";

async function fixture(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "cms-export-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await mkdir(path.join(rootDir, "config/_default"), { recursive: true });
  await mkdir(path.join(rootDir, "content/posts/legacy"), { recursive: true });
  await mkdir(path.join(rootDir, "assets/img/gallery"), { recursive: true });
  await writeFile(path.join(rootDir, "config/_default/hugo.toml"), 'theme = "blowfish"\n[[module.mounts]]\nsource = "assets"\ntarget = "assets"\n[[module.mounts]]\nsource = "hugo_stats.json"\ntarget = "assets/notwatching/hugo_stats.json"\ndisableWatch = true\n');
  await writeFile(path.join(rootDir, "config/_default/module.toml"), '[hugoVersion]\nmin = "0.87.0"\n');
  await writeFile(path.join(rootDir, "content/posts/legacy/index.md"), "---\ntitle: Original\n---\nOriginal repository content\n");
  await writeFile(path.join(rootDir, "content/posts/legacy/featured.png"), "legacy bundle image");
  return rootDir;
}

function database({ posts = [], gallery = null, media = [] } = {}) {
  const requested = [];
  return {
    requested,
    async query(sql, params) {
      if (sql.includes("FROM cms.posts")) return { rows: posts };
      if (sql.includes("FROM cms.gallery")) return { rows: [{ published: gallery }] };
      if (sql.includes("FROM cms.media")) { requested.push(...params[0]); return { rows: media.filter((image) => params[0].includes(image.id)) }; }
      return { rows: [] };
    },
  };
}

function snapshot(overrides = {}) { return { slug: "new-post", title: "Published title", description: "A description", tags: ["数学"], date: "2026-10-01T12:00:00.000Z", markdown: "Draft markdown", html: "<p>Published content</p>", mediaIds: [], revision: 1, ...overrides }; }

test("only published snapshots and referenced uploads enter the Hugo staging directory", async (t) => {
  const rootDir = await fixture(t);
  const db = database({
    posts: [{ id: "post", source_path: null, title: "Secret draft", markdown: "Do not publish", published: snapshot({ html: `<p>Unicode 日本語 <img src="/media/${FIRST}.webp"></p>` }) }, { id: "draft", source_path: null, published: null }],
    media: [{ id: FIRST, content_type: "image/webp", object_key: `cms/${FIRST}.webp` }, { id: DRAFT, content_type: "image/webp", object_key: `cms/${DRAFT}.webp` }],
  });
  const fetched = [];
  const exported = await exportPublishedContent({ rootDir, db, storage: { async get(key) { fetched.push(key); return Buffer.from("published image"); } } });
  const content = await readFile(path.join(exported.stageDir, "content/posts/new-post/index.md"), "utf8");
  assert.match(content, /Unicode 日本語/);
  assert.match(content, new RegExp(`/uploads/${FIRST}.webp`));
  assert.doesNotMatch(content, /Secret draft|Do not publish|Draft markdown/);
  assert.deepEqual(fetched, [`cms/${FIRST}.webp`]);
  assert.deepEqual(db.requested, [FIRST]);
  await assert.rejects(access(path.join(exported.stageDir, `static/uploads/${DRAFT}.webp`)));
  assert.equal(await readFile(path.join(rootDir, "content/posts/legacy/index.md"), "utf8"), "---\ntitle: Original\n---\nOriginal repository content\n");
});

test("legacy snapshots keep shortcode syntax, unknown frontmatter, and leaf bundle images", async (t) => {
  const rootDir = await fixture(t);
  const legacy = snapshot({ slug: "legacy", legacy: true, sourcePath: "posts/legacy/index.md", frontmatter: { custom: { value: "keep" }, image: { filename: "featured" }, draft: false }, markdown: "{{< katex >}}\n$\\alpha$\n![image](featured.png)" });
  const result = await exportPublishedContent({ rootDir, db: database({ posts: [{ source_path: "posts/legacy/index.md", published: legacy }] }), storage: {} });
  const content = parseFrontmatter(await readFile(path.join(result.stageDir, "content/posts/legacy/index.md"), "utf8"));
  assert.deepEqual(content.frontmatter.custom, { value: "keep" });
  assert.equal(content.markdown.trim(), legacy.markdown);
  assert.equal(await readFile(path.join(result.stageDir, "content/posts/legacy/featured.png"), "utf8"), "legacy bundle image");
});

test("unpublishing an imported post removes its entire staged bundle only", async (t) => {
  const rootDir = await fixture(t);
  const result = await exportPublishedContent({ rootDir, db: database({ posts: [{ source_path: "posts/legacy/index.md", published: null }] }), storage: {} });
  await assert.rejects(access(path.join(result.stageDir, "content/posts/legacy")));
  await access(path.join(rootDir, "content/posts/legacy/featured.png"));
});

test("republishing an imported post retains server-owned frontmatter with sanitized CMS HTML", async (t) => {
  const rootDir = await fixture(t);
  const published = snapshot({ slug: "legacy", legacy: false, frontmatter: { custom: "keep", image: { filename: "featured" } }, html: "<p>New safe content</p>" });
  const result = await exportPublishedContent({ rootDir, db: database({ posts: [{ source_path: "posts/legacy/index.md", published }] }), storage: {} });
  const content = parseFrontmatter(await readFile(path.join(result.stageDir, "content/posts/legacy/index.md"), "utf8"));
  assert.deepEqual(content.frontmatter.image, { filename: "featured" });
  assert.equal(content.frontmatter.custom, "keep");
  assert.equal(content.frontmatter.cms, true);
  assert.equal(content.markdown.trim(), "<p>New safe content</p>");
});

test("published gallery preserves explicit order, metadata, and empty-gallery semantics", async (t) => {
  const rootDir = await fixture(t);
  const gallery = [{ mediaId: SECOND, title: "Second first", albums: ["Chicago"], metadata: { lens: "Legacy lens" } }, { mediaId: FIRST, title: "First second" }];
  const media = [FIRST, SECOND].map((id) => ({ id, content_type: "image/webp", object_key: `cms/${id}.webp` }));
  const result = await exportPublishedContent({ rootDir, db: database({ gallery, media }), storage: { async get() { return Buffer.from("image"); } } });
  const manifest = JSON.parse(await readFile(path.join(result.stageDir, "data/cms-gallery.json"), "utf8"));
  assert.deepEqual(manifest.images, [`img/gallery/cms-${SECOND}.webp`, `img/gallery/cms-${FIRST}.webp`]);
  assert.match(await readFile(path.join(result.stageDir, `assets/img/gallery/cms-${SECOND}.yaml`), "utf8"), /lens: Legacy lens/);
  await exportPublishedContent({ rootDir, db: database({ gallery: [] }), storage: {} });
  assert.deepEqual(JSON.parse(await readFile(path.join(result.stageDir, "data/cms-gallery.json"), "utf8")), { enabled: true, images: [] });
});

test("generated Hugo mounts retain repository config and never mount draft database records", async (t) => {
  const rootDir = await fixture(t);
  const result = await exportPublishedContent({ rootDir, db: database(), storage: {} });
  const config = parseToml(await readFile(path.join(result.configDir, "_default/module.toml"), "utf8"));
  assert.equal(config.hugoVersion.min, "0.87.0");
  assert.equal(config.mounts[0].source, ".cms-hugo/content");
  assert.ok(config.mounts.some((mount) => mount.source === "hugo_stats.json" && mount.disableWatch));
  assert.ok(config.mounts.some((mount) => mount.source === "layouts"));
  assert.equal(await readFile(path.join(rootDir, "config/_default/module.toml"), "utf8"), '[hugoVersion]\nmin = "0.87.0"\n');
  await assert.rejects(access(path.join(result.stageDir, "data/cms-gallery.json")));
});

test("legacy gallery retains public resource names while CMS metadata overrides sidecars", async (t) => {
  const rootDir = await fixture(t);
  await writeFile(path.join(rootDir, "assets/img/gallery/0000.jpg"), "legacy photo");
  await writeFile(path.join(rootDir, "assets/img/gallery/0000.yaml"), "title: Original\n");
  const result = await exportPublishedContent({ rootDir, db: database({ gallery: [{ mediaId: FIRST, title: "CMS title" }], media: [{ id: FIRST, content_type: "image/jpeg", legacy_path: "assets/img/gallery/0000.jpg" }] }), storage: {} });
  const manifest = JSON.parse(await readFile(path.join(result.stageDir, "data/cms-gallery.json"), "utf8"));
  assert.deepEqual(manifest.images, ["img/gallery/0000.jpg"]);
  assert.equal(await readFile(path.join(result.stageDir, "static/uploads", `${FIRST}.jpg`), "utf8"), "legacy photo");
  assert.match(await readFile(path.join(result.stageDir, "assets/img/gallery/0000.yaml"), "utf8"), /CMS title/);
  assert.equal(await readFile(path.join(rootDir, "assets/img/gallery/0000.yaml"), "utf8"), "title: Original\n");
});

test("CMS HTML cannot execute Hugo shortcode syntax", async (t) => {
  const rootDir = await fixture(t);
  const result = await exportPublishedContent({ rootDir, db: database({ posts: [{ source_path: null, published: snapshot({ html: "<p>{{&lt; arbitrary-shortcode &gt;}}</p>" }) }] }), storage: {} });
  const output = await readFile(path.join(result.stageDir, "content/posts/new-post/index.md"), "utf8");
  assert.doesNotMatch(output, /\{\{/);
  assert.match(output, /&#123;&#123;/);
});

test("export fails closed for database failures, unsafe paths, collisions, and missing blobs", async (t) => {
  const rootDir = await fixture(t);
  await writeFile(path.join(rootDir, ".env.local"), "private fixture credential");
  const cases = [
    { db: { async query() { throw new Error("database offline"); } }, match: /database offline/ },
    { db: database({ posts: [{ published: snapshot({ slug: "../escape" }) }] }), match: /slug/ },
    { db: database({ posts: [{ source_path: "posts/../../outside/index.md", published: null }] }), match: /source path/ },
    { db: database({ posts: [{ published: snapshot({ slug: "legacy" }) }] }), match: /collides/ },
    { db: database({ posts: [{ published: snapshot({ mediaIds: [FIRST] }) }], media: [{ id: FIRST, content_type: "image/jpeg", legacy_path: "assets/img/gallery/../../../.env.local" }] }), match: /source path/ },
    { db: database({ posts: [{ published: snapshot({ mediaIds: [FIRST] }) }], media: [{ id: FIRST, content_type: "image/webp", object_key: `cms/${FIRST}.webp` }] }), match: /blob is missing/ },
  ];
  for (const entry of cases) await assert.rejects(exportPublishedContent({ rootDir, db: entry.db, storage: { async get() { return null; } } }), entry.match);
  await access(path.join(rootDir, "content/posts/legacy/index.md"));
});

test("database presence alone never enables public CMS export", async () => {
  assert.equal(await exportFromEnvironment({ env: { DATABASE_URL: "postgres://unused" } }), null);
  await assert.rejects(exportFromEnvironment({ env: { CMS_ENABLED: "1" } }), /requires DATABASE_URL/);
});
