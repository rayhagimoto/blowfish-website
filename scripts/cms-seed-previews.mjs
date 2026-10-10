import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { getConfig } from '../cms/config.mjs';
import { createPool, transaction } from '../cms/db.mjs';
import { createStorage } from '../cms/storage.mjs';
import { UUID } from '../cms/media.mjs';

export async function seedPreviews({ db, storage, config, rootDir = process.cwd() }) {
  const rows = (await db.query('SELECT id,legacy_path FROM cms.media WHERE legacy_path IS NOT NULL AND preview_object_key IS NULL')).rows;
  let count = 0;
  for (const row of rows) {
    if (!UUID.test(row.id) || !/^(assets\/img\/gallery\/|content\/posts\/)/.test(row.legacy_path) || row.legacy_path.includes('\\') ||
      row.legacy_path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid legacy image path');
    const key = `cms/${row.id}-thumb.webp`;
    const source = await readFile(path.join(rootDir, row.legacy_path));
    const output = await sharp(source, { limitInputPixels: 80_000_000, animated: false }).rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    let written = false;
    try {
      await transaction(db, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(7733401)');
        const current = await client.query('SELECT preview_object_key FROM cms.media WHERE id=$1 FOR UPDATE', [row.id]);
        if (!current.rows[0] || current.rows[0].preview_object_key) return;
        const used = await client.query('SELECT coalesce(sum(CASE WHEN object_key IS NOT NULL THEN size ELSE 0 END + preview_size), 0)::bigint AS bytes FROM cms.media');
        if (Number(used.rows[0].bytes) + output.length > config.mediaBudgetBytes) throw new Error('CMS image storage limit reached');
        written = true;
        await storage.set(key, output);
        await client.query('UPDATE cms.media SET preview_object_key=$2,preview_size=$3 WHERE id=$1', [row.id, key, output.length]);
      });
      if (written) count++;
    } catch (error) {
      if (written) await transaction(db, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(7733401)');
        const current = await client.query('SELECT preview_object_key FROM cms.media WHERE id=$1 FOR UPDATE', [row.id]);
        // A successful concurrent seeder, or an ambiguously acknowledged COMMIT, owns this key.
        if (!current.rows[0]?.preview_object_key) await storage.delete(key);
      }).catch(() => {});
      throw error;
    }
  }
  return count;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = getConfig();
  const db = createPool(config.databaseUrl);
  try { console.log(`Created ${await seedPreviews({ config, db, storage: await createStorage(config) })} private library previews.`); }
  catch (error) { console.error('Private preview setup failed:', error.code || error.name); process.exitCode = 1; }
  finally { await db.end(); }
}
