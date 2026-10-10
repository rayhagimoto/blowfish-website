import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '../cms/config.mjs';
import { createPool } from '../cms/db.mjs';
import { createAuth } from '../cms/auth.mjs';
import { createHandler } from '../cms/api.mjs';
import { createStorage } from '../cms/storage.mjs';

const config = getConfig();
if (new URL(config.origin).hostname !== '127.0.0.1' || config.storageMode !== 'local') throw new Error('Development requires local storage and a 127.0.0.1 origin.');
const handler = createHandler({ config, auth: createAuth(config), db: createPool(config.databaseUrl), storage: await createStorage(config) });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, config.origin);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
      const headers = new Headers(incoming.headers);
      headers.set('x-nf-client-connection-ip', incoming.socket.remoteAddress || 'unknown');
      const chunks = []; let size = 0;
      for await (const chunk of incoming) { size += chunk.length; if (size > config.maxUploadBytes + 16_384) { outgoing.writeHead(413).end(); return; } chunks.push(chunk); }
      const request = new Request(url, { method: incoming.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const response = await handler(request);
      outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), ...(response.headers.getSetCookie().length ? { 'set-cookie': response.headers.getSetCookie() } : {}) });
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } else {
      const relative = decodeURIComponent(url.pathname).replace(/\/$/, '/index.html');
      const filename = path.resolve('static', `.${relative}`);
      if (!filename.startsWith(path.resolve('static') + path.sep)) { outgoing.writeHead(404).end(); return; }
      outgoing.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      outgoing.end(await readFile(filename));
    }
  } catch { outgoing.writeHead(404).end('Not found'); }
});
server.listen(Number(new URL(config.origin).port), '127.0.0.1', () => console.log(`Admin studio: ${config.origin}/admin/`));
