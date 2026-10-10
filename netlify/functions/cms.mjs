import { getConfig } from '../../cms/config.mjs';
import { createPool } from '../../cms/db.mjs';
import { createAuth } from '../../cms/auth.mjs';
import { createStorage } from '../../cms/storage.mjs';
import { createHandler } from '../../cms/api.mjs';
import { json } from '../../cms/http.mjs';

let handler;
export default async function (request, context) {
  try {
    if (!handler) {
      const config = getConfig();
      handler = createHandler({ config, auth: createAuth(config), db: createPool(config.databaseUrl), storage: await createStorage(config) });
    }
    const headers = new Headers(request.headers);
    // Use the platform's connection address, never a client-supplied header.
    headers.set('x-nf-client-connection-ip', context.ip || 'unknown');
    return await handler(new Request(request, { headers }));
  } catch {
    return json({ error: { code: 'CMS_UNAVAILABLE', message: 'The admin studio is not configured yet.' } }, 503);
  }
}
export const config = { path: ['/api/auth/*', '/api/cms/*', '/media/*'] };
