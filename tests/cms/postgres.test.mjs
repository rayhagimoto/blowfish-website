import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import sharp from 'sharp';
import { createPool } from '../../cms/db.mjs';
import { createHandler } from '../../cms/api.mjs';

// The explicit test URL prevents the normal test command from touching any database.
const enabled = process.env.CMS_RUN_INTEGRATION_TESTS === '1' && !!process.env.CMS_TEST_DATABASE_URL;

test('real Postgres enforces CMS revisions, publication snapshots, gallery ordering, and media lifecycle', { skip: !enabled }, async (t) => {
  const production = parseEnv(await readFile('.env.local', 'utf8').catch((error) => { if (error.code === 'ENOENT') return ''; throw error; }));
  if (production.DATABASE_URL && new URL(production.DATABASE_URL).hostname === new URL(process.env.CMS_TEST_DATABASE_URL).hostname) throw new Error('Integration tests cannot use the production database endpoint.');
  const db = createPool(process.env.CMS_TEST_DATABASE_URL);
  const marker = randomUUID();
  const prefix = `cms-test-${marker}`;
  const filename = `${prefix}.png`;
  const ownerId = `integration-${marker}`;
  const origin = 'http://localhost:9099';
  const config = { origin, ownerEmail: 'rayhagimoto@gmail.com', storageMode: 'local',
    mediaBudgetBytes: 512 * 1024 * 1024, maxUploadBytes: 4 * 1024 * 1024,
    maxPostBytes: 200 * 1024, buildHook: '' };
  const blobs = new Map();
  const storage = { async get(key) { return blobs.get(key) ?? null; }, async set(key, bytes) { blobs.set(key, bytes); }, async delete(key) { blobs.delete(key); } };
  const originalGallery = (await db.query("SELECT * FROM cms.gallery WHERE id='main'")).rows[0];
  await db.query("INSERT INTO cms.gallery(id) VALUES('main') ON CONFLICT DO NOTHING");
  t.after(async () => {
    try {
      if (originalGallery) {
        await db.query("UPDATE cms.gallery SET items=$1::jsonb,published=$2::jsonb,revision=$3,published_at=$4,updated_at=$5 WHERE id='main'",
          [JSON.stringify(originalGallery.items), originalGallery.published === null ? null : JSON.stringify(originalGallery.published), originalGallery.revision, originalGallery.published_at, originalGallery.updated_at]);
      } else await db.query("DELETE FROM cms.gallery WHERE id='main'");
      await db.query('DELETE FROM cms.posts WHERE slug LIKE $1 OR source_path LIKE $2', [`${prefix}%`, `posts/${prefix}%`]);
      await db.query('DELETE FROM cms.media WHERE filename=$1', [filename]);
      await db.query('DELETE FROM cms.rate_limits WHERE key=ANY($1::text[])', [[`owner:${ownerId}`, `upload:${ownerId}`]]);
    } finally { blobs.clear(); await db.end(); }
  });

  let session = { user: { id: ownerId, email: config.ownerEmail, twoFactorEnabled: true }, session: { id: 'integration-session', mfaVerified: true } };
  const auth = { api: { async getSession() { return session; } } };
  const handler = createHandler({ config, auth, db, storage });
  async function request(route, method = 'GET', body, expected = 200, originHeader = origin) {
    const response = await handler(new Request(`${origin}${route}`, {
      method, headers: { origin: originHeader, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    const json = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(json)}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return json;
  }

  await t.test('all data routes require an owner session with completed MFA and same-origin mutations', async () => {
    const verified = session;
    session = null;
    await request('/api/cms/posts', 'GET', undefined, 401);
    await request('/media/11111111-1111-4111-8111-111111111111.webp', 'GET', undefined, 401);
    session = { ...verified, session: { ...verified.session, mfaVerified: false } };
    await request('/api/cms/posts', 'GET', undefined, 403);
    session = verified;
    await request('/api/cms/posts', 'POST', {}, 403, 'https://other.example');
  });

  const input = { slug: prefix, title: 'Original draft 日本語', description: 'Integration fixture', markdown: 'Initial draft with $x^2$', tags: ['数学'], date: '2026-10-01T12:00:00Z' };
  const created = await request('/api/cms/posts', 'POST', input, 201);
  const postId = created.post.id;
  let revision = created.post.revision;
  let mediaId;

  await t.test('editing a draft requires the current revision; invalid slugs are rejected', async () => {
    assert.equal((await db.query('SELECT published FROM cms.posts WHERE id=$1', [postId])).rows[0].published, null);
    const changed = await request(`/api/cms/posts/${postId}`, 'PATCH', { ...input, title: 'Second draft', revision });
    revision = changed.post.revision;
    assert.equal(revision, 2);
    await request(`/api/cms/posts/${postId}`, 'PATCH', { ...input, revision: 1 }, 409);
    await request('/api/cms/posts', 'POST', { ...input, slug: '../escape' }, 400);
  });

  await t.test('valid image uploads are re-encoded and stay behind authorization', async () => {
    const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: 'red' } }).png().toBuffer();
    const form = new FormData();
    form.set('file', new File([png], filename, { type: 'image/png' }));
    const response = await handler(new Request(`${origin}/api/cms/media`, { method: 'POST', headers: { origin }, body: form }));
    const result = await response.json();
    assert.equal(response.status, 201, JSON.stringify(result));
    mediaId = result.media.id;
    const stored = (await db.query('SELECT * FROM cms.media WHERE id=$1', [mediaId])).rows[0];
    assert.equal(stored.content_type, 'image/webp');
    assert.equal((await sharp(blobs.get(stored.object_key)).metadata()).format, 'webp');
    const image = await handler(new Request(`${origin}/media/${mediaId}.webp`));
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('cache-control'), 'private, no-store');
    assert.equal(image.headers.get('content-type'), 'image/webp');
  });

  await t.test('publication creates an immutable safe HTML snapshot while later edits stay draft', async () => {
    const markdown = `Equation $E=mc^2$\n\n![photo](/media/${mediaId}.webp)\n\n<script>alert(1)</script>`;
    const saved = await request(`/api/cms/posts/${postId}`, 'PATCH', { ...input, title: 'Published edition', markdown, revision });
    revision = saved.post.revision;
    await request(`/api/cms/posts/${postId}/publish`, 'POST', { revision: revision - 1 }, 409);
    const publication = await request(`/api/cms/posts/${postId}/publish`, 'POST', { revision });
    assert.equal(publication.build.queued, false);
    const before = (await db.query('SELECT published FROM cms.posts WHERE id=$1', [postId])).rows[0].published;
    assert.equal(before.title, 'Published edition');
    assert.match(before.html, /katex/);
    assert.doesNotMatch(before.html, /<script|alert\(1\)/);
    assert.deepEqual(before.mediaIds, [mediaId]);
    const draft = await request(`/api/cms/posts/${postId}`, 'PATCH', { ...input, title: 'Secret next draft', markdown, revision });
    revision = draft.post.revision;
    assert.equal(draft.post.hasChanges, true);
    const row = (await db.query('SELECT title,published FROM cms.posts WHERE id=$1', [postId])).rows[0];
    assert.equal(row.title, 'Secret next draft');
    assert.deepEqual(row.published, before);
    await request(`/api/cms/media/${mediaId}`, 'DELETE', undefined, 409);
  });

  await t.test('gallery edits preserve metadata, reject duplicate images, and publish only on request', async () => {
    const gallery = (await request('/api/cms/gallery')).gallery;
    const item = { mediaId, title: 'Gallery photo', albums: ['Chicago'], metadata: { lens: 'Fixture lens', albums: ['Chicago'] } };
    const saved = await request('/api/cms/gallery', 'PUT', { items: [item], revision: gallery.revision });
    await request('/api/cms/gallery', 'PUT', { items: [], revision: gallery.revision }, 409);
    await request('/api/cms/gallery', 'PUT', { items: [item, item], revision: saved.gallery.revision }, 400);
    await request('/api/cms/gallery/publish', 'POST', { revision: saved.gallery.revision });
    const row = (await db.query("SELECT items,published FROM cms.gallery WHERE id='main'")).rows[0];
    assert.equal(row.published[0].mediaId, mediaId);
    assert.deepEqual(row.published[0].metadata.albums, ['Chicago']);
    const cleared = await request('/api/cms/gallery', 'PUT', { items: [], revision: saved.gallery.revision });
    await request(`/api/cms/media/${mediaId}`, 'DELETE', undefined, 409);
    await request('/api/cms/gallery/publish', 'POST', { revision: cleared.gallery.revision });
  });

  await t.test('unpublish/delete clears references so unused uploads can be removed', async () => {
    await request(`/api/cms/posts/${postId}/unpublish`, 'POST', { revision });
    assert.equal((await db.query('SELECT published FROM cms.posts WHERE id=$1', [postId])).rows[0].published, null);
    await request(`/api/cms/posts/${postId}`, 'DELETE', { revision });
    await request(`/api/cms/media/${mediaId}`, 'DELETE');
    assert.equal((await db.query('SELECT id FROM cms.media WHERE id=$1', [mediaId])).rowCount, 0);
    assert.equal(blobs.size, 0);
    await request(`/api/cms/posts/${postId}`, 'GET', undefined, 404);
  });

  await t.test('legacy metadata edits retain trusted shortcodes; changed bodies use safe HTML', async () => {
    const id = randomUUID();
    const slug = `${prefix}-legacy-publication`;
    const sourcePath = `posts/${slug}/index.md`;
    const markdown = '{{< katex >}}\n$y$';
    const frontmatter = { custom: 'preserved', image: { filename: 'featured' } };
    const original = { slug, title: 'Legacy fixture', description: '', tags: [], date: input.date,
      markdown, legacy: true, sourcePath, frontmatter, revision: 1, mediaIds: [] };
    await db.query('INSERT INTO cms.posts(id,slug,title,markdown,trusted_markdown,date,source_path,frontmatter,published) VALUES($1,$2,$3,$4,$4,$5,$6,$7::jsonb,$8::jsonb)',
      [id, slug, original.title, markdown, input.date, sourcePath, JSON.stringify(frontmatter), JSON.stringify(original)]);
    const metadataEdit = { ...input, slug, title: 'Metadata edit', markdown, revision: 1 };
    await request(`/api/cms/posts/${id}`, 'PATCH', { ...metadataEdit, frontmatter: { custom: 'forged' } }, 400);
    await request(`/api/cms/posts/${id}`, 'PATCH', metadataEdit);
    await request(`/api/cms/posts/${id}/publish`, 'POST', { revision: 2 });
    let published = (await db.query('SELECT published FROM cms.posts WHERE id=$1', [id])).rows[0].published;
    assert.equal(published.legacy, true);
    assert.equal(published.markdown, markdown);
    assert.deepEqual(published.frontmatter, frontmatter);
    await request(`/api/cms/posts/${id}/unpublish`, 'POST', { revision: 2 });
    await request(`/api/cms/posts/${id}/publish`, 'POST', { revision: 2 });
    published = (await db.query('SELECT published FROM cms.posts WHERE id=$1', [id])).rows[0].published;
    assert.equal(published.legacy, true);
    await request(`/api/cms/posts/${id}`, 'PATCH', { ...metadataEdit, markdown: 'Edited body with $z$', revision: 2 });
    await request(`/api/cms/posts/${id}/publish`, 'POST', { revision: 3 });
    published = (await db.query('SELECT published FROM cms.posts WHERE id=$1', [id])).rows[0].published;
    assert.equal(published.legacy, false);
    assert.match(published.html, /katex/);
    assert.deepEqual(published.frontmatter, frontmatter);
  });

  await t.test('deleting an imported post keeps a tombstone to prevent repository resurrection', async () => {
    const id = randomUUID();
    await db.query('INSERT INTO cms.posts(id,slug,title,markdown,source_path,published) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
      [id, `${prefix}-legacy`, 'Legacy fixture', 'Original legacy body', `posts/${prefix}-legacy/index.md`, JSON.stringify({ slug: `${prefix}-legacy`, title: 'Legacy fixture' })]);
    await request(`/api/cms/posts/${id}`, 'DELETE', { revision: 1 });
    const row = (await db.query('SELECT source_path,published,markdown,revision FROM cms.posts WHERE id=$1', [id])).rows[0];
    assert.ok(row.source_path);
    assert.equal(row.published, null);
    assert.equal(row.markdown, '');
    assert.equal(row.revision, 2);
  });
});
