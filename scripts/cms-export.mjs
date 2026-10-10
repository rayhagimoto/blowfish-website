import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { parse as parseToml, stringify as stringifyToml } from "@iarna/toml";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_EXTENSIONS = { "image/webp": ".webp", "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/avif": ".avif" };
const MEDIA_URL = /\/media\/([0-9a-f-]{36})\.webp\b/gi;

function inside(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath.includes("\\") || path.isAbsolute(relativePath) || relativePath.split("/").some((part) => part === "." || part === ".." || part === "")) throw new Error("Invalid CMS source path");
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("Invalid CMS source path");
  return resolved;
}

async function exists(filename) {
  try { await stat(filename); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

function mediaIds(snapshot) {
  const ids = new Set(snapshot.mediaIds ?? []);
  for (const match of (snapshot.html ?? "").matchAll(MEDIA_URL)) ids.add(match[1]);
  for (const id of ids) if (!UUID.test(id)) throw new Error("Invalid published media ID");
  return new Set([...ids].map((id) => id.toLowerCase()));
}

async function buildConfig(rootDir, stageDir) {
  const configDir = path.join(stageDir, "config");
  await cp(path.join(rootDir, "config"), configDir, { recursive: true });
  const defaults = path.join(configDir, "_default");
  const mainFile = path.join(defaults, "hugo.toml");
  const moduleFile = path.join(defaults, "module.toml");
  const main = parseToml(await readFile(mainFile, "utf8"));
  const module = await exists(moduleFile) ? parseToml(await readFile(moduleFile, "utf8")) : {};
  const original = [...(main.module?.mounts ?? []), ...(module.mounts ?? [])];
  const relativeStage = path.relative(rootDir, stageDir).split(path.sep).join("/");
  const mounts = [
    { source: `${relativeStage}/content`, target: "content" },
    { source: `${relativeStage}/assets`, target: "assets" },
    { source: `${relativeStage}/data`, target: "data" },
    { source: `${relativeStage}/static`, target: "static" },
    ...original.filter((mount) => mount.target !== "content"),
  ];
  for (const target of ["assets", "data", "static", "layouts", "i18n", "archetypes"]) {
    if (!original.some((mount) => mount.target === target)) mounts.push({ source: target, target });
  }
  // The copied module category replaces only mounts. All source configuration stays intact.
  await writeFile(moduleFile, stringifyToml({ ...module, mounts }));
  return configDir;
}

/** Export only immutable published snapshots. Never write into tracked content or assets. */
export async function exportPublishedContent({ rootDir = process.cwd(), stageDir = path.join(rootDir, ".cms-hugo"), db, storage }) {
  rootDir = path.resolve(rootDir);
  stageDir = path.resolve(stageDir);
  if (stageDir !== path.join(rootDir, ".cms-hugo")) throw new Error("CMS staging must use the project's .cms-hugo directory");
  const client = db.connect ? await db.connect() : db;
  let posts, gallery, media;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    ({ rows: posts } = await client.query("SELECT id, source_path, published FROM cms.posts ORDER BY id"));
    const result = await client.query("SELECT published FROM cms.gallery WHERE id = 'main'");
    gallery = result.rows[0]?.published ?? null;
    const requested = new Set();
    for (const post of posts) if (post.published) for (const id of mediaIds(post.published)) requested.add(id);
    if (gallery !== null) {
      if (!Array.isArray(gallery)) throw new Error("Invalid published gallery");
      for (const item of gallery) {
        if (!UUID.test(item.mediaId)) throw new Error("Invalid gallery media ID");
        requested.add(item.mediaId.toLowerCase());
      }
    }
    ({ rows: media } = await client.query("SELECT id, object_key, content_type, legacy_path FROM cms.media WHERE id = ANY($1::uuid[])", [[...requested]]));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release?.();
  }

  const byId = new Map(media.map((item) => [item.id, item]));
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });
  await cp(path.join(rootDir, "content"), path.join(stageDir, "content"), { recursive: true });
  await Promise.all(["assets/img/gallery", "data", "static/uploads"].map((name) => mkdir(path.join(stageDir, name), { recursive: true })));
  const exportedMedia = new Map();
  async function exportMedia(id) {
    id = id.toLowerCase();
    if (exportedMedia.has(id)) return exportedMedia.get(id);
    const image = byId.get(id);
    if (!image || !IMAGE_EXTENSIONS[image.content_type]) throw new Error("Published image is missing or unsupported");
    const extension = IMAGE_EXTENSIONS[image.content_type];
    let bytes;
    if (image.legacy_path) {
      if (!/^(assets\/img\/gallery\/|content\/posts\/)/.test(image.legacy_path)) throw new Error("Invalid legacy image path");
      bytes = await readFile(inside(rootDir, image.legacy_path));
    } else {
      if (image.object_key !== `cms/${id}.webp`) throw new Error("Invalid uploaded image key");
      bytes = await storage.get(image.object_key);
      if (bytes === null || bytes === undefined) throw new Error("Published image blob is missing");
      bytes = Buffer.from(bytes);
    }
    const filename = `${id}${extension}`;
    await writeFile(path.join(stageDir, "static/uploads", filename), bytes);
    const result = { image, bytes, filename, publicUrl: `/uploads/${filename}` };
    exportedMedia.set(id, result);
    return result;
  }

  for (const post of posts) {
    if (post.source_path) {
      if (!/^posts\/.+\/index\.(md|markdown)$/i.test(post.source_path)) throw new Error("Invalid imported post path");
      // Removing the complete leaf bundle also removes unpublished bundle media.
      await rm(path.dirname(inside(path.join(stageDir, "content"), post.source_path)), { recursive: true, force: true });
    }
  }
  const slugs = new Set();
  let postCount = 0;
  for (const post of posts) {
    const published = post.published;
    if (!published) continue;
    if (!SLUG.test(published.slug) || published.slug.length > 160 || slugs.has(published.slug)) throw new Error("Invalid or duplicate published slug");
    slugs.add(published.slug);
    const bundle = path.join(stageDir, "content/posts", published.slug);
    if (await exists(bundle)) throw new Error("Published CMS slug collides with repository content");
    if (post.source_path) {
      await cp(path.dirname(inside(path.join(rootDir, "content"), post.source_path)), bundle, { recursive: true });
      await rm(path.join(bundle, path.basename(post.source_path)), { force: true });
    } else await mkdir(bundle, { recursive: true });
    let body;
    if (published.legacy === true) {
      if (!post.source_path || published.sourcePath !== post.source_path) throw new Error("Legacy publication has no matching source");
      body = published.markdown;
    } else {
      if (typeof published.html !== "string") throw new Error("Published CMS HTML snapshot is missing");
      for (const id of mediaIds(published)) await exportMedia(id);
      body = published.html.replace(MEDIA_URL, (_, id) => exportedMedia.get(id.toLowerCase()).publicUrl)
        .replace(/\{\{/g, "&#123;&#123;");
    }
    if (typeof body !== "string") throw new Error("Published post body is missing");
    const frontmatter = {
      ...(post.source_path ? published.frontmatter : {}),
      title: published.title,
      description: published.description ?? "",
      tags: published.tags ?? [],
      date: published.date,
      draft: false,
      ...(published.legacy ? {} : { cms: true }),
    };
    await writeFile(path.join(bundle, "index.md"), `---\n${stringify(frontmatter)}---\n${body}\n`);
    postCount++;
  }

  if (gallery !== null) {
    const images = [];
    for (const item of gallery) {
      const exported = await exportMedia(item.mediaId);
      // Keep legacy resource names so existing public URLs and Hugo image caches survive import.
      const legacyAsset = exported.image.legacy_path?.startsWith("assets/img/gallery/") ? exported.image.legacy_path.slice("assets/".length) : null;
      const assetName = legacyAsset ?? `img/gallery/cms-${exported.filename}`;
      if (!legacyAsset) await writeFile(path.join(stageDir, "assets", assetName), exported.bytes);
      const metadata = { ...(item.metadata ?? {}), title: item.title ?? "", description: item.description ?? "", location: item.location ?? "", date: item.date ?? "", albums: item.albums ?? [] };
      await writeFile(path.join(stageDir, "assets", assetName.replace(/\.[^.]+$/, ".yaml")), stringify(metadata));
      images.push(assetName);
    }
    await writeFile(path.join(stageDir, "data/cms-gallery.json"), JSON.stringify({ enabled: true, images }));
  }
  const configDir = await buildConfig(rootDir, stageDir);
  return { stageDir, configDir, posts: postCount, images: exportedMedia.size, galleryImages: gallery?.length ?? null };
}

export async function exportFromEnvironment({ rootDir = process.cwd(), env = process.env } = {}) {
  if (env.CMS_ENABLED !== "1") return null;
  if (!env.DATABASE_URL) throw new Error("CMS_ENABLED requires DATABASE_URL");
  const { createPool } = await import("../cms/db.mjs");
  const { createStorage } = await import("../cms/storage.mjs");
  const storageMode = env.CMS_STORAGE === "local" ? "local" : "netlify";
  if (storageMode === "local" && !["localhost", "127.0.0.1"].includes(new URL(env.CMS_ORIGIN).hostname)) throw new Error("Local CMS image storage requires a local origin");
  const db = createPool(env.DATABASE_URL);
  let store;
  const storage = { async get(key) {
    store ??= createStorage({ storageMode, mediaDir: path.resolve(rootDir, env.CMS_MEDIA_DIR ?? ".cms-local/media"), siteId: env.NETLIFY_SITE_ID ?? env.SITE_ID, netlifyToken: env.NETLIFY_AUTH_TOKEN });
    return (await store).get(key);
  } };
  try { return await exportPublishedContent({ rootDir, db, storage }); }
  finally { await db.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  exportFromEnvironment().then((result) => console.log(result ? `Exported ${result.posts} published CMS posts and ${result.images} referenced images.` : "CMS database is not configured; repository content will be used."))
    .catch(() => { console.error("CMS export failed; the build has stopped to preserve the published site."); process.exitCode = 1; });
}
