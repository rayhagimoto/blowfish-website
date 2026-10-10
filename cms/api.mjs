import { timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { handleAuth, requireOwner } from './auth.mjs';
import { assertOrigin, HttpError, json, readJSON } from './http.mjs';
import { transaction } from './db.mjs';
import { renderMarkdown, referencedMedia } from './markdown.mjs';
import { UUID, mediaJSON, uploadImage, readImage } from './media.mjs';
import { queueBuild } from './publishing.mjs';

const revision = z.number().int().positive();
const metadataValue = z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null()]);
const postInput = z.object({
  slug: z.string().min(1).max(160).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().trim().min(1).max(240), description: z.string().max(2000).default(''),
  markdown: z.string().max(200 * 1024), tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  date: z.string().refine((value) => Number.isFinite(Date.parse(value))), revision: revision.optional(),
}).strict();
const galleryItem = z.object({ mediaId: z.string().regex(UUID), title: z.string().max(240).default(''),
  description: z.string().max(4000).default(''), location: z.string().max(240).default(''),
  date: z.string().max(80).default(''), albums: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  metadata: z.record(z.string().max(80), z.union([metadataValue, z.array(metadataValue).max(100)]))
    .refine((value) => Object.keys(value).length <= 100 && JSON.stringify(value).length <= 16_384).default({}),
}).strict();

export const postJSON = (row) => ({ id: row.id, slug: row.slug, title: row.title, description: row.description,
  markdown: row.markdown, tags: row.tags, date: new Date(row.date).toISOString(), revision: row.revision,
  imported: !!row.source_path, publishedAt: row.published_at,
  hasChanges: (row.published_revision ?? row.published?.revision) !== row.revision });
const galleryJSON = (row) => ({ items: row.items, revision: row.revision, publishedAt: row.published_at,
  hasChanges: JSON.stringify(row.items) !== JSON.stringify(row.published) });
const conflict = () => new HttpError(409, 'REVISION_CONFLICT', 'This draft changed in another browser. Reload it before saving or publishing.');

async function limit(db, key, maximum, seconds = 60) {
  const result = await db.query(`INSERT INTO cms.rate_limits (key,hits,expires_at) VALUES ($1,1,now()+$2*interval '1 second')
    ON CONFLICT (key) DO UPDATE SET hits=CASE WHEN cms.rate_limits.expires_at<=now() THEN 1 ELSE cms.rate_limits.hits+1 END,
    expires_at=CASE WHEN cms.rate_limits.expires_at<=now() THEN EXCLUDED.expires_at ELSE cms.rate_limits.expires_at END RETURNING hits`, [key, seconds]);
  if (result.rows[0].hits > maximum) throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Please wait a minute before trying again.');
}
async function existingMedia(db, ids) {
  if (!ids.length) return;
  const result = await db.query('SELECT id FROM cms.media WHERE id=ANY($1::uuid[])', [ids]);
  if (result.rows.length !== new Set(ids).size) throw new HttpError(400, 'IMAGE_MISSING', 'One or more images no longer exist.');
}
function checkToken(value, config) {
  const expiry = config.setupExpiresAt;
  const validTime = expiry instanceof Date && Number.isFinite(expiry.getTime()) && expiry > new Date();
  const hash = (text) => createHash('sha256').update(text).digest();
  return typeof value === 'string' && config.setupToken.length >= 32 && validTime && timingSafeEqual(hash(value), hash(config.setupToken));
}

/** Every route shares the same authorization boundary, including image reads. */
export function createHandler({ config, auth, db, storage, rootDir }) {
  return async (request) => {
    try {
      assertOrigin(request, config.origin);
      const { pathname } = new URL(request.url);
      if (pathname.startsWith('/api/auth/')) return await handleAuth(request, auth, config);
      const method = request.method;
      if (pathname === '/api/cms/status' && method === 'GET') {
        const found = await db.query('SELECT id FROM cms_auth."user" WHERE email=$1 LIMIT 1', [config.ownerEmail]);
        return json({ configured: true, setupRequired: !found.rows.length });
      }
      if (pathname === '/api/cms/setup' && method === 'POST') {
        const ip = request.headers.get('x-nf-client-connection-ip') || 'unknown';
        await limit(db, `setup:${ip}`, 5);
        const body = await readJSON(request, 4096);
        if (!checkToken(body.token, config)) throw new HttpError(403, 'INVALID_SETUP_TOKEN', 'The setup link is invalid or expired.');
        const existing = await db.query('SELECT id FROM cms_auth."user" LIMIT 1');
        if (existing.rows.length) throw new HttpError(409, 'ALREADY_CONFIGURED', 'The administrator account already exists.');
        const input = z.object({ name: z.string().trim().min(1).max(100), password: z.string().min(12).max(128) }).parse(body);
        const response = await auth.api.signUpEmail({ body: { ...input, email: config.ownerEmail }, headers: request.headers, asResponse: true });
        response.headers.set('Cache-Control', 'no-store');
        return response;
      }
      if (pathname === '/api/cms/session' && method === 'GET') {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session || session.user.email.toLowerCase() !== config.ownerEmail) return json({ authenticated: false });
        return json({ authenticated: true, requiresEnrollment: !session.user.twoFactorEnabled,
          requiresMfa: !!session.user.twoFactorEnabled && !session.session.mfaVerified,
          user: { id: session.user.id, name: session.user.name, email: session.user.email, twoFactorEnabled: !!session.user.twoFactorEnabled } });
      }
      const session = await requireOwner(request, auth, config);
      await limit(db, `owner:${session.user.id}`, 180);
      const image = /^\/media\/([a-f0-9-]+)\.webp$/.exec(pathname);
      if (image && method === 'GET' && UUID.test(image[1])) return await readImage(image[1], { config, db, storage, rootDir });
      const route = pathname.replace(/^\/api\/cms/, '');
      if (!pathname.startsWith('/api/cms/')) throw new HttpError(404, 'NOT_FOUND', 'Page not found.');
      if (route === '/preview' && method === 'POST') {
        const input = z.object({ markdown: z.string().max(config.maxPostBytes) }).parse(await readJSON(request));
        return json({ html: await renderMarkdown(input.markdown) });
      }
      if (route === '/posts' && method === 'GET') return json({ posts: (await db.query(`SELECT id,slug,title,description,tags,date,revision,published_at,source_path,
        (published->>'revision')::integer AS published_revision FROM cms.posts WHERE deleted_at IS NULL ORDER BY date DESC`)).rows.map(postJSON) });
      if (route === '/posts' && method === 'POST') {
        const input = postInput.parse(await readJSON(request));
        if (Buffer.byteLength(input.markdown) > config.maxPostBytes) throw new HttpError(413, 'POST_TOO_LARGE', 'This post is too large.');
        const row = await transaction(db, async (client) => {
          await client.query('SELECT pg_advisory_xact_lock(7733401)');
          await existingMedia(client, referencedMedia(input.markdown));
          const result = await client.query('INSERT INTO cms.posts (id,slug,title,description,markdown,tags,date) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *',
            [randomUUID(), input.slug, input.title, input.description, input.markdown, JSON.stringify(input.tags), input.date]);
          return result.rows[0];
        });
        return json({ post: postJSON(row) }, 201);
      }
      const postRoute = /^\/posts\/([a-f0-9-]+)(?:\/(publish|unpublish))?$/.exec(route);
      if (postRoute && UUID.test(postRoute[1])) {
        const [, id, action] = postRoute;
        if (!action && method === 'GET') {
          const result = await db.query('SELECT * FROM cms.posts WHERE id=$1 AND deleted_at IS NULL', [id]);
          if (!result.rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Post not found.');
          return json({ post: postJSON(result.rows[0]) });
        }
        if (!action && method === 'PATCH') {
          const input = postInput.extend({ revision }).parse(await readJSON(request));
          if (Buffer.byteLength(input.markdown) > config.maxPostBytes) throw new HttpError(413, 'POST_TOO_LARGE', 'This post is too large.');
          const row = await transaction(db, async (client) => {
            await client.query('SELECT pg_advisory_xact_lock(7733401)');
            await existingMedia(client, referencedMedia(input.markdown));
            const result = await client.query('UPDATE cms.posts SET slug=$2,title=$3,description=$4,markdown=$5,tags=$6::jsonb,date=$7,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$8 AND deleted_at IS NULL RETURNING *',
              [id, input.slug, input.title, input.description, input.markdown, JSON.stringify(input.tags), input.date, input.revision]);
            if (!result.rows[0]) throw conflict();
            return result.rows[0];
          });
          return json({ post: postJSON(row) });
        }
        if ((action && method === 'POST') || (!action && method === 'DELETE')) {
          const input = z.object({ revision }).parse(await readJSON(request));
          const row = await transaction(db, async (client) => {
            await client.query('SELECT pg_advisory_xact_lock(7733401)');
            const result = await client.query('SELECT * FROM cms.posts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [id]);
            const draft = result.rows[0];
            if (!draft) throw new HttpError(404, 'NOT_FOUND', 'Post not found.');
            if (draft.revision !== input.revision) throw conflict();
            if (method === 'DELETE') {
              // Keep an imported tombstone so the exporter cannot resurrect its repository bundle.
              if (draft.source_path) {
                await client.query("UPDATE cms.posts SET published=NULL,published_at=NULL,markdown='',deleted_at=now(),slug='deleted-'||id::text,revision=revision+1 WHERE id=$1", [id]);
              } else await client.query('DELETE FROM cms.posts WHERE id=$1', [id]);
              return null;
            }
            let snapshot = null;
            if (action === 'publish') {
              const mediaIds = referencedMedia(draft.markdown);
              await existingMedia(client, mediaIds);
              const trustedUnchanged = draft.source_path && (draft.markdown === draft.trusted_markdown ||
                (draft.published?.legacy === true && draft.published.sourcePath === draft.source_path && draft.markdown === draft.published.markdown));
              snapshot = { ...postJSON(draft), mediaIds, html: await renderMarkdown(draft.markdown), legacy: !!trustedUnchanged,
                ...(draft.source_path ? { frontmatter: draft.frontmatter, sourcePath: draft.source_path } : {}) };
            }
            const changed = await client.query('UPDATE cms.posts SET published=$2::jsonb,published_at=CASE WHEN $2::jsonb IS NULL THEN NULL ELSE now() END WHERE id=$1 RETURNING *', [id, snapshot ? JSON.stringify(snapshot) : null]);
            return changed.rows[0];
          });
          const build = await queueBuild(db, config);
          return json({ post: row ? postJSON(row) : null, build });
        }
      }
      if (route === '/media' && method === 'GET') return json({ media: (await db.query('SELECT * FROM cms.media ORDER BY created_at DESC')).rows.map(mediaJSON) });
      if (route === '/media' && method === 'POST') { await limit(db, `upload:${session.user.id}`, 20); return json({ media: await uploadImage(request, { db, storage, config }) }, 201); }
      const mediaRoute = /^\/media\/([a-f0-9-]+)$/.exec(route);
      if (mediaRoute && UUID.test(mediaRoute[1]) && method === 'DELETE') {
        await transaction(db, async (client) => {
          await client.query('SELECT pg_advisory_xact_lock(7733401)');
          const result = await client.query('SELECT * FROM cms.media WHERE id=$1 FOR UPDATE', [mediaRoute[1]]);
          const row = result.rows[0];
          if (!row) throw new HttpError(404, 'NOT_FOUND', 'Image not found.');
          if (row.legacy_path) throw new HttpError(409, 'LEGACY_IMAGE', 'Imported images remain in the website repository. Remove them from the gallery instead.');
          const used = await client.query(`SELECT 1 FROM cms.posts WHERE markdown LIKE $1 OR published::text LIKE $1
            UNION ALL SELECT 1 FROM cms.gallery WHERE items::text LIKE $1 OR published::text LIKE $1 LIMIT 1`, [`%${row.id}%`]);
          if (used.rows.length) throw new HttpError(409, 'IMAGE_IN_USE', 'Remove this image from draft and published content first.');
          await storage.delete(row.object_key);
          await client.query('DELETE FROM cms.media WHERE id=$1', [row.id]);
        });
        return json({ deleted: true });
      }
      if (route === '/gallery' && method === 'GET') {
        const result = await db.query("SELECT * FROM cms.gallery WHERE id='main'");
        return json({ gallery: galleryJSON(result.rows[0]) });
      }
      if (route === '/gallery' && method === 'PUT') {
        const input = z.object({ items: z.array(galleryItem).max(1000), revision }).parse(await readJSON(request));
        if (new Set(input.items.map((item) => item.mediaId)).size !== input.items.length) throw new HttpError(400, 'DUPLICATE_IMAGE', 'An image can appear only once in the gallery.');
        const row = await transaction(db, async (client) => {
          await client.query('SELECT pg_advisory_xact_lock(7733401)');
          await existingMedia(client, input.items.map((item) => item.mediaId));
          const result = await client.query("UPDATE cms.gallery SET items=$1::jsonb,revision=revision+1,updated_at=now() WHERE id='main' AND revision=$2 RETURNING *", [JSON.stringify(input.items), input.revision]);
          if (!result.rows[0]) throw conflict();
          return result.rows[0];
        });
        return json({ gallery: galleryJSON(row) });
      }
      if (route === '/gallery/publish' && method === 'POST') {
        const input = z.object({ revision }).parse(await readJSON(request));
        const result = await db.query("UPDATE cms.gallery SET published=items,published_at=now() WHERE id='main' AND revision=$1 RETURNING *", [input.revision]);
        if (!result.rows[0]) throw conflict();
        return json({ gallery: galleryJSON(result.rows[0]), build: await queueBuild(db, config) });
      }
      if (route === '/security' && method === 'GET') {
        const [sessions, trusted] = await Promise.all([
          db.query('SELECT id,"userAgent","ipAddress","createdAt","expiresAt" FROM cms_auth.session WHERE "userId"=$1 AND "expiresAt">now() ORDER BY "createdAt" DESC', [session.user.id]),
          db.query('SELECT id,"expiresAt" FROM cms_auth.verification WHERE value=$1 AND identifier LIKE \'trust-device-%\' AND "expiresAt">now()', [session.user.id]),
        ]);
        return json({ sessions: sessions.rows.map((row) => ({ ...row, isCurrent: row.id === session.session.id })), trustedDevices: trusted.rows });
      }
      if (route === '/security/revoke-trusted' && method === 'POST') { await db.query('DELETE FROM cms_auth.verification WHERE value=$1 AND identifier LIKE \'trust-device-%\'', [session.user.id]); return json({ revoked: true }); }
      if (route === '/security/revoke-others' && method === 'POST') { await db.query('DELETE FROM cms_auth.session WHERE "userId"=$1 AND id<>$2', [session.user.id, session.session.id]); return json({ revoked: true }); }
      if (route === '/security/revoke-session' && method === 'POST') {
        const input = z.object({ id: z.string().min(1).max(200) }).parse(await readJSON(request));
        await db.query('DELETE FROM cms_auth.session WHERE "userId"=$1 AND id=$2', [session.user.id, input.id]); return json({ revoked: true });
      }
      throw new HttpError(404, 'NOT_FOUND', 'Page not found.');
    } catch (error) {
      if (error instanceof HttpError) return json({ error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof z.ZodError) return json({ error: { code: 'INVALID_INPUT', message: 'Check the submitted fields and try again.' } }, 400);
      if (error.code === '23505') return json({ error: { code: 'ALREADY_EXISTS', message: 'This name is already in use. Choose another.' } }, 409);
      console.error('CMS request failed:', error.name || 'Error', error.code || 'UNKNOWN');
      return json({ error: { code: 'SERVER_ERROR', message: 'The request could not be completed. Please try again.' } }, 500);
    }
  };
}
