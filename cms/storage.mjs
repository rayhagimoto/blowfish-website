import { getStore } from '@netlify/blobs';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

export async function createStorage(config = {}) {
  if (config.storageMode === 'local') {
    const directory = path.resolve(config.mediaDir || '.cms-local/media');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filename = (key) => {
      if (!/^cms\/[a-f0-9-]+(?:-thumb)?\.webp$/.test(key)) throw new Error('Invalid media key.');
      return path.join(directory, key.slice(4));
    };
    return {
      async get(key) { try { return await readFile(filename(key)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
      async set(key, value) { await writeFile(filename(key), value, { mode: 0o600 }); },
      async delete(key) { await unlink(filename(key)).catch((error) => { if (error.code !== 'ENOENT') throw error; }); },
    };
  }
  const options = { name: 'cms-media', consistency: 'strong' };
  if (config.siteId && config.netlifyToken) Object.assign(options, { siteID: config.siteId, token: config.netlifyToken });
  const store = getStore(options);
  return {
    async get(key) { const value = await store.get(key, { type: 'arrayBuffer' }); return value ? Buffer.from(value) : null; },
    async set(key, value) { await store.set(key, new Uint8Array(value)); },
    async delete(key) { await store.delete(key); },
  };
}
