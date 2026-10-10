import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { HttpError } from './http.mjs';
import { transaction } from './db.mjs';

export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const mediaJSON = (row) => ({ id: row.id, filename: row.filename,
  url: `/media/${row.id}.webp`, width: row.width, height: row.height, size: row.size,
  legacyPath: row.legacy_path || undefined });

export async function uploadImage(request, { db, storage, config }) {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) throw new HttpError(415, 'IMAGE_REQUIRED', 'Choose an image file.');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > config.maxUploadBytes + 16_384) throw new HttpError(413, 'IMAGE_TOO_LARGE', 'Images must be smaller than 4 MB.');
  const form = await new Request(request.url, { method: 'POST', headers: request.headers, body: bytes }).formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function' || file.size < 1 || file.size > config.maxUploadBytes) throw new HttpError(413, 'IMAGE_TOO_LARGE', 'Choose an image smaller than 4 MB.');
  let output, info;
  try {
    const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000, animated: false });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1) throw new Error('Unsupported image');
    ({ data: output, info } = await image.rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true }));
  } catch { throw new HttpError(415, 'UNSUPPORTED_IMAGE', 'Upload a valid, still JPEG, PNG, or WebP image.'); }
  const id = randomUUID();
  const key = `cms/${id}.webp`;
  let written = false;
  // Hold the storage-budget lock through upload and insert. Concurrent requests cannot exceed it.
  try { return await transaction(db, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(7733401)");
    const used = await client.query('SELECT coalesce(sum(CASE WHEN object_key IS NOT NULL THEN size ELSE 0 END + preview_size), 0)::bigint AS bytes FROM cms.media');
    if (Number(used.rows[0].bytes) + output.length > config.mediaBudgetBytes) throw new HttpError(413, 'STORAGE_LIMIT', 'The image storage limit has been reached. Remove unused images before uploading more.');
    written = true;
    await storage.set(key, output);
      const filename = path.basename(file.name || 'image').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || 'image';
      const result = await client.query('INSERT INTO cms.media (id,object_key,filename,content_type,size,width,height) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [id, key, filename, 'image/webp', output.length, info.width, info.height]);
      return mediaJSON(result.rows[0]);
  }); } catch (error) {
    if (written) await transaction(db, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(7733401)');
      const committed = await client.query('SELECT object_key FROM cms.media WHERE id=$1 FOR UPDATE', [id]);
      if (!committed.rows[0]) await storage.delete(key);
    }).catch(() => {});
    throw error;
  }
}

export async function readImage(id, { db, storage, config, rootDir = process.cwd() }) {
  if (!UUID.test(id)) throw new HttpError(404, 'NOT_FOUND', 'Image not found.');
  const result = await db.query('SELECT * FROM cms.media WHERE id=$1', [id]);
  const row = result.rows[0];
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Image not found.');
  if (row.preview_object_key) {
    if (row.preview_object_key !== `cms/${id}-thumb.webp`) throw new HttpError(404, 'NOT_FOUND', 'Image not found.');
    const bytes = await storage.get(row.preview_object_key);
    if (!bytes) throw new HttpError(404, 'NOT_FOUND', 'Image not found.');
    return new Response(bytes, { headers: imageHeaders });
  }
  if (row.legacy_path) {
    if (!/^(assets\/img\/gallery\/|content\/posts\/)/.test(row.legacy_path) || row.legacy_path.includes('\\') ||
      row.legacy_path.split('/').some((part) => !part || part === '.' || part === '..')) throw new HttpError(404, 'NOT_FOUND', 'Image not found.');
    if (config.storageMode !== 'local') {
      let target;
      if (row.legacy_path.startsWith('assets/img/gallery/')) {
        const gallery = await db.query("SELECT published FROM cms.gallery WHERE id='main'");
        if (!gallery.rows[0]?.published?.some((item) => item.mediaId === id)) throw new HttpError(404, 'NOT_FOUND', 'Image is not currently published.');
        const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' }[row.content_type];
        if (!extension) throw new HttpError(404, 'NOT_FOUND', 'Image not found.');
        target = `/uploads/${id}${extension}`;
      } else {
        const parts = row.legacy_path.split('/');
        const post = await db.query('SELECT published FROM cms.posts WHERE source_path=$1', [`posts/${parts[2]}/index.md`]);
        if (!post.rows[0]?.published) throw new HttpError(404, 'NOT_FOUND', 'Image is not currently published.');
        target = `/posts/${post.rows[0].published.slug}/${parts.slice(3).map(encodeURIComponent).join('/')}`;
      }
      return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
    }
    const filename = path.resolve(rootDir, row.legacy_path);
    if (!filename.startsWith(path.resolve(rootDir) + path.sep)) throw new HttpError(404, 'NOT_FOUND', 'Image not found.');
    const bytes = await readFile(filename);
    return new Response(await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp().toBuffer(), { headers: imageHeaders });
  }
  if (row.object_key !== `cms/${id}.webp`) throw new HttpError(404, 'NOT_FOUND', 'Image not found.');
  const bytes = await storage.get(row.object_key);
  if (!bytes) throw new HttpError(404, 'NOT_FOUND', 'Image not found.');
  return new Response(bytes, { headers: imageHeaders });
}
const imageHeaders = { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" };
