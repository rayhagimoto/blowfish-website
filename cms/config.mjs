import { z } from 'zod';

const originSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.pathname === '/' && !url.search && !url.hash &&
    (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
}, 'Use an HTTPS origin (HTTP is allowed only on localhost).');

export function getConfig(env = process.env) {
  const origin = originSchema.parse(env.CMS_ORIGIN).replace(/\/$/, '');
  const storageMode = env.CMS_STORAGE === 'local' ? 'local' : 'netlify';
  if (storageMode === 'local' && !['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) {
    throw new Error('Local image storage is restricted to local development.');
  }
  return {
    origin,
    ownerEmail: z.email().parse(env.CMS_OWNER_EMAIL || 'rayhagimoto@gmail.com').toLowerCase(),
    databaseUrl: z.string().min(1).parse(env.DATABASE_URL),
    authSecret: z.string().min(32).parse(env.CMS_AUTH_SECRET),
    setupToken: env.CMS_SETUP_TOKEN || '',
    setupExpiresAt: env.CMS_SETUP_EXPIRES_AT ? new Date(env.CMS_SETUP_EXPIRES_AT) : null,
    secureCookies: origin.startsWith('https:'),
    storageMode,
    mediaDir: env.CMS_MEDIA_DIR || '.cms-local/media',
    siteId: env.NETLIFY_SITE_ID || env.SITE_ID,
    netlifyToken: env.NETLIFY_AUTH_TOKEN,
    buildHook: env.CMS_BUILD_HOOK || '',
    mediaBudgetBytes: 512 * 1024 * 1024,
    maxUploadBytes: 4 * 1024 * 1024,
    maxPostBytes: 200 * 1024,
  };
}
