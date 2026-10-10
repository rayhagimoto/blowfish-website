import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { legacyId, parseFrontmatter, readRepositoryContent, importRepositoryContent } from "../../scripts/cms-import.mjs";

test("frontmatter parser preserves Unicode YAML/TOML and rejects executable frontmatter engines", () => {
  const yaml = parseFrontmatter('---\ntitle: 日本語\ncustom:\n  setting: true\n---\n{{< katex >}}\n$\\alpha$');
  assert.deepEqual(yaml.frontmatter, { title: "日本語", custom: { setting: true } });
  assert.equal(yaml.markdown, "{{< katex >}}\n$\\alpha$");
  const toml = parseFrontmatter("+++\ntitle = 'TOML'\ndate = 2026-10-01T12:00:00Z\n+++\nbody");
  assert.equal(toml.frontmatter.date, "2026-10-01T12:00:00.000Z");
  assert.throws(() => parseFrontmatter("---js\n(() => globalThis.secret)()\n---\nbody"), /YAML or TOML/);
});

test("legacy import is idempotent, preserves drafts and metadata, and never uploads files", async (t) => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "cms-import-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await mkdir(path.join(rootDir, "content/posts/published"), { recursive: true });
  await mkdir(path.join(rootDir, "content/posts/draft"), { recursive: true });
  await mkdir(path.join(rootDir, "assets/img/gallery"), { recursive: true });
  const source = '---\ntitle: Public 日本語\ndate: 2026-10-01\ncustom: keep\n---\n{{< figure src="featured.png" >}}';
  await writeFile(path.join(rootDir, "content/posts/published/index.md"), source);
  await writeFile(path.join(rootDir, "content/posts/draft/index.md"), "+++\ntitle = 'Private'\ndate = '2026-10-01'\ndraft = true\n+++\nprivate body");
  const image = await sharp({ create: { width: 2, height: 3, channels: 3, background: "red" } }).png().toBuffer();
  await writeFile(path.join(rootDir, "content/posts/published/featured.png"), image);
  await writeFile(path.join(rootDir, "assets/img/gallery/0000.png"), image);
  await writeFile(path.join(rootDir, "assets/img/gallery/0000.yaml"), "title: Photo\nalbums: [Chicago]\nlens: Existing lens\ncustom: preserve\n");
  const content = await readRepositoryContent({ rootDir });
  assert.equal(content.posts.find((post) => post.slug === "draft").published, null);
  assert.equal(content.posts.find((post) => post.slug === "published").published.frontmatter.custom, "keep");
  assert.equal(content.gallery[0].metadata.custom, "preserve");
  assert.deepEqual([content.media[0].width, content.media[0].height], [2, 3]);
  assert.equal(content.media[0].id, legacyId(content.media[0].legacyPath));
  const inserted = new Set();
  const records = [];
  const db = { async query(sql, params) {
    if (sql.startsWith("INSERT INTO")) {
      records.push({ sql, params });
      const key = sql.includes("cms.gallery") ? "gallery" : `${sql.includes("cms.posts") ? "post" : "media"}:${params[0]}`;
      const rowCount = inserted.has(key) ? 0 : 1;
      inserted.add(key);
      return { rows: [], rowCount };
    }
    return { rows: [], rowCount: 0 };
  } };
  assert.deepEqual(await importRepositoryContent({ rootDir, db }), { posts: 2, media: 2, gallerySeeded: true });
  assert.deepEqual(await importRepositoryContent({ rootDir, db }), { posts: 0, media: 0, gallerySeeded: false });
  const postRecords = records.filter((entry) => entry.sql.includes("INSERT INTO cms.posts"));
  const draftRecord = postRecords.find((entry) => entry.params[1] === "draft");
  assert.equal(draftRecord.params[9], null);
  assert.ok(records.every((entry) => entry.sql.includes("ON CONFLICT")));
  assert.equal(await readFile(path.join(rootDir, "content/posts/published/index.md"), "utf8"), source);
});
