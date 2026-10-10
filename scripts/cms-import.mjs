import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { parse as parseToml } from "@iarna/toml";
import sharp from "sharp";

const IMAGE_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif" };
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function legacyId(relativePath) {
  const bytes = createHash("sha256").update(`cms-repository:${relativePath}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parseFrontmatter(text) {
  const match = text.replace(/^\uFEFF/, "").match(/^(---|\+\+\+)\r?\n([\s\S]*?)\r?\n\1(?:\r?\n|$)/);
  if (!match) throw new Error("Repository post requires YAML or TOML frontmatter");
  const source = text.replace(/^\uFEFF/, "");
  const parsed = match[1] === "---" ? parseYaml(match[2], { maxAliasCount: 100 }) : parseToml(match[2]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Repository frontmatter must be an object");
  return { frontmatter: JSON.parse(JSON.stringify(parsed)), markdown: source.slice(match[0].length) };
}

async function walk(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const result = [];
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : 1)) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(filename));
    else if (entry.isFile()) result.push(filename);
  }
  return result;
}

function relative(rootDir, filename) { return path.relative(rootDir, filename).split(path.sep).join("/"); }
function text(value) { return value === null || value === undefined ? "" : String(value); }
function strings(value) { return Array.isArray(value) ? value.map(String) : value ? [String(value)] : []; }

/** Discover existing assets without uploading, moving, or rewriting repository files. */
export async function readRepositoryContent({ rootDir = process.cwd() } = {}) {
  rootDir = path.resolve(rootDir);
  const postFiles = await walk(path.join(rootDir, "content/posts"));
  const galleryFiles = await walk(path.join(rootDir, "assets/img/gallery"));
  const media = [];
  for (const filename of [...postFiles, ...galleryFiles]) {
    const contentType = IMAGE_TYPES[path.extname(filename).toLowerCase()];
    if (!contentType) continue;
    const legacyPath = relative(rootDir, filename);
    const metadata = await sharp(filename).metadata();
    const info = await stat(filename);
    media.push({ id: legacyId(legacyPath), filename: path.basename(filename), contentType, size: info.size, width: metadata.width ?? null, height: metadata.height ?? null, legacyPath });
  }
  const posts = [];
  for (const filename of postFiles.filter((name) => /\/index\.(md|markdown)$/i.test(name))) {
    const { frontmatter, markdown } = parseFrontmatter(await readFile(filename, "utf8"));
    const sourcePath = relative(path.join(rootDir, "content"), filename);
    const slug = text(frontmatter.slug || path.basename(path.dirname(filename)));
    if (!SLUG.test(slug) || slug.length > 160) throw new Error(`Repository post has an unsupported CMS slug: ${slug}`);
    const date = new Date(frontmatter.date ?? (await stat(filename)).mtime).toISOString();
    const data = { slug, title: text(frontmatter.title || slug), description: text(frontmatter.description), markdown, tags: strings(frontmatter.tags), date, mediaIds: [], revision: 1, legacy: true, sourcePath, frontmatter };
    posts.push({ id: legacyId(`content/${sourcePath}`), sourcePath, frontmatter, ...data, published: frontmatter.draft === true ? null : data });
  }
  const gallery = [];
  for (const image of media.filter((item) => item.legacyPath.startsWith("assets/img/gallery/"))) {
    const sidecar = path.join(rootDir, image.legacyPath.replace(/\.[^.]+$/, ".yaml"));
    let metadata = {};
    try { metadata = parseYaml(await readFile(sidecar, "utf8"), { maxAliasCount: 100 }) ?? {}; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Gallery metadata must be an object");
    gallery.push({ mediaId: image.id, title: text(metadata.title), description: text(metadata.description), location: text(metadata.location), date: text(metadata.date), albums: strings(metadata.albums), metadata: JSON.parse(JSON.stringify(metadata)) });
  }
  return { posts, media, gallery };
}

/** Insert legacy records once; later CMS edits and publications always take precedence. */
export async function importRepositoryContent({ rootDir = process.cwd(), db }) {
  const content = await readRepositoryContent({ rootDir });
  const client = db.connect ? await db.connect() : db;
  let posts = 0, media = 0;
  try {
    await client.query("BEGIN");
    for (const item of content.media) {
      const result = await client.query(
        "INSERT INTO cms.media (id, filename, content_type, size, width, height, legacy_path) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING id",
        [item.id, item.filename, item.contentType, item.size, item.width, item.height, item.legacyPath],
      );
      media += result.rowCount ?? 0;
    }
    for (const item of content.posts) {
      const result = await client.query(
        "INSERT INTO cms.posts (id, slug, title, description, markdown, trusted_markdown, tags, date, revision, source_path, frontmatter, published, published_at) VALUES ($1, $2, $3, $4, $5, $5, $6::jsonb, $7, 1, $8, $9::jsonb, $10::jsonb, $11) ON CONFLICT DO NOTHING RETURNING id",
        [item.id, item.slug, item.title, item.description, item.markdown, JSON.stringify(item.tags), item.date, item.sourcePath, JSON.stringify(item.frontmatter), item.published ? JSON.stringify(item.published) : null, item.published ? item.date : null],
      );
      posts += result.rowCount ?? 0;
    }
    const gallery = JSON.stringify(content.gallery);
    const result = await client.query(
      "INSERT INTO cms.gallery (id, items, published, revision, published_at) VALUES ('main', $1::jsonb, $1::jsonb, 1, now()) ON CONFLICT (id) DO UPDATE SET items = EXCLUDED.items, published = EXCLUDED.published, published_at = EXCLUDED.published_at WHERE cms.gallery.revision = 1 AND cms.gallery.items = '[]'::jsonb AND cms.gallery.published IS NULL RETURNING id",
      [gallery],
    );
    await client.query("COMMIT");
    return { posts, media, gallerySeeded: (result.rowCount ?? 0) > 0 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release?.(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required for CMS import."); process.exitCode = 1; }
  else {
    const { createPool } = await import("../cms/db.mjs");
    const db = createPool(process.env.DATABASE_URL);
    try {
      const result = await importRepositoryContent({ db });
      console.log(`Imported ${result.posts} posts and ${result.media} existing images; gallery ${result.gallerySeeded ? "seeded" : "preserved"}.`);
    } catch { console.error("CMS import failed; no repository files were changed."); process.exitCode = 1; }
    finally { await db.end(); }
  }
}
