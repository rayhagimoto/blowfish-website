import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { createPool } from '../db.mjs';

test.skip(process.env.CMS_LIVE_TEST !== '1', 'Live integration requires an explicitly isolated development branch.');

test('real admin bootstrap, MFA, Unicode editing, upload, preview, publication, gallery, and trusted browser lifecycle', async ({ page, context, browser }) => {
  const env = parseEnv(await readFile('.env.cms-development.local', 'utf8'));
  if (env.NEON_BRANCH !== 'cms-development' || env.CMS_ORIGIN !== 'http://127.0.0.1:9090' || env.CMS_STORAGE !== 'local' || env.CMS_BUILD_HOOK) throw new Error('Live tests require an isolated development branch, local storage and no publication hook.');
  const production = parseEnv(await readFile('.env.local', 'utf8'));
  if (new URL(production.DATABASE_URL).hostname === new URL(env.DATABASE_URL).hostname) throw new Error('Live tests cannot use the production database endpoint.');
  const db = createPool(env.DATABASE_URL); const tag = `ui-test-${randomBytes(5).toString('hex')}`;
  const password = randomBytes(32).toString('base64url'); let createdOwner = false; let mediaId; let secret; let recoveryCodes = [];
  const baseline = (await db.query("SELECT * FROM cms.gallery WHERE id='main'")).rows[0];
  const ownerBefore = await db.query('SELECT id FROM cms_auth."user" WHERE email=$1', [env.CMS_OWNER_EMAIL]);
  if (ownerBefore.rows.length) { await db.end(); throw new Error('The isolated test branch must have no administrator before the live bootstrap test.'); }
  createdOwner = true;
  const failures = []; page.on('pageerror', error => failures.push(error.message));
  const call = async (method, path, data) => {
    const response = await context.request.fetch(`/api/cms${path}`, { method, headers: { Origin: env.CMS_ORIGIN }, ...(data ? { data } : {}) });
    if (!response.ok()) throw new Error(`Live API ${method} ${path} returned ${response.status()}.`);
    return response.json();
  };
  try {
    await page.goto('/admin/'); await expect(page.getByRole('heading', { name: 'Make this studio yours.' })).toBeVisible();
    await page.getByLabel('Setup token').fill(env.CMS_SETUP_TOKEN); await page.getByLabel('New password').fill(password);
    await page.getByRole('button', { name: 'Create administrator' }).click();
    await expect(page.getByRole('heading', { name: 'Protect your studio.' })).toBeVisible(); createdOwner = true;
    await page.getByLabel('Confirm your password').fill(password); await page.getByRole('button', { name: 'Set up authenticator' }).click();
    await expect(page.getByRole('heading', { name: 'Scan. Save. Verify.' })).toBeVisible();
    secret = new TextDecoder().decode(base32.decode(await page.locator('#totp-secret').textContent()));
    recoveryCodes = (await page.locator('#recovery-codes').textContent()).trim().split('\n');
    await page.getByLabel('I saved these codes').check(); await page.getByLabel('Authenticator code').fill(await createOTP(secret).totp());
    await page.getByRole('button', { name: 'Verify and open studio' }).click(); await expect(page.getByRole('heading', { name: 'Your journal.' })).toBeVisible();
    const enrolled = await call('GET', '/session'); expect(enrolled.user.twoFactorEnabled).toBe(true); expect(enrolled.requiresMfa).toBe(false);

    await page.getByRole('button', { name: 'New post', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill(tag); await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByRole('heading', { name: 'Make room for an idea.' })).toBeVisible();
    await page.getByLabel('Editor mode').selectOption('sv'); const source = page.locator('.vditor-sv');
    await source.fill('# Unicode 日本語 αβγ\n\n[My public site](https://rayhagimoto.space)\n\n$$E = mc^2$$');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(page.locator('#save-status')).toContainText('Saved at');
    let createdPost = (await call('GET', '/posts')).posts.find(post => post.slug === tag);
    createdPost = (await call('GET', `/posts/${createdPost.id}`)).post;
    expect(createdPost.markdown).toContain('日本語');

    await page.getByRole('button', { name: 'Image library', exact: true }).click();
    const image = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#799c87' } }).jpeg({ quality: 85 }).toBuffer();
    await page.locator('#image-files').setInputFiles({ name: `${tag}.jpg`, mimeType: 'image/jpeg', buffer: image });
    await expect(page.locator('#upload-status')).toContainText('Upload complete.');
    const uploaded = (await call('GET', '/media')).media.find(media => media.filename === `${tag}.jpg`); expect(uploaded).toBeTruthy(); mediaId = uploaded.id;
    await page.getByRole('button', { name: 'Journal', exact: true }).click(); await page.getByRole('button', { name: new RegExp(tag) }).click();
    await page.getByLabel('Editor mode').selectOption('sv');
    await page.getByRole('button', { name: 'Insert library image' }).click();
    await page.getByRole('dialog').locator('.image-card').filter({ hasText: `${tag}.jpg` }).getByRole('button', { name: 'Select image' }).click();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(page.locator('#save-status')).toContainText('Saved at');
    await page.getByRole('button', { name: 'Published preview', exact: true }).click();
    await expect(page.frameLocator('#safe-preview-frame').getByRole('heading', { name: 'Unicode 日本語 αβγ' })).toBeVisible();
    const previewImage = page.frameLocator('#safe-preview-frame').locator('img');
    await expect.poll(() => previewImage.evaluate(element => element.naturalWidth)).toBe(900);
    await expect(page.frameLocator('#safe-preview-frame').locator('.katex')).toBeVisible();
    await page.getByRole('button', { name: 'Publish', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.locator('#post-badge')).toHaveText('Published'); createdPost = (await call('GET', `/posts/${createdPost.id}`)).post;
    expect(createdPost.publishedAt).toBeTruthy(); expect(createdPost.hasChanges).toBe(false);

    const anonymous = await browser.newContext({ baseURL: env.CMS_ORIGIN });
    try { expect((await anonymous.request.get('/api/cms/posts')).status()).toBe(401); expect((await anonymous.request.get(uploaded.url)).status()).toBe(401); }
    finally { await anonymous.close(); }

    await page.getByRole('button', { name: 'Photo gallery', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Curate the gallery.' })).toBeVisible();
    await page.getByRole('button', { name: 'Add images', exact: true }).click(); await page.getByRole('button', { name: 'Choose library image' }).click();
    await page.getByRole('dialog').locator('.image-card').filter({ hasText: `${tag}.jpg` }).getByRole('button', { name: 'Select image' }).click();
    const added = page.locator('#gallery-grid .image-card').filter({ hasText: tag }); await added.getByRole('button', { name: 'Edit details' }).click();
    await page.getByRole('dialog').getByLabel('Caption', { exact: true }).fill('Live integration photograph.');
    await page.getByRole('dialog').getByLabel('Albums', { exact: true }).fill('Integration');
    await page.getByRole('button', { name: 'Apply details' }).click(); await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.locator('#gallery-status')).not.toContainText('Unsaved');
    let gallery = (await call('GET', '/gallery')).gallery; expect(gallery.items.find(item => item.mediaId === mediaId)).toMatchObject({ description: 'Live integration photograph.', albums: ['Integration'] });
    await page.getByRole('button', { name: 'Publish gallery', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Publish gallery', exact: true }).click();
    await expect(page.locator('#gallery-status')).toHaveText('Published');

    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in securely' }).click();
    await expect(page.getByRole('heading', { name: 'Verify it’s you.' })).toBeVisible();
    await page.getByLabel('Authenticator code').fill(await createOTP(secret).totp()); await page.getByLabel('Trust this browser').check();
    await page.getByRole('button', { name: 'Verify and sign in' }).click(); await expect(page.getByRole('heading', { name: 'Your journal.' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in securely' }).click(); await expect(page.getByRole('heading', { name: 'Your journal.' })).toBeVisible();
    await page.getByRole('button', { name: 'Security', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Keep your studio private.' })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke all trusted browsers' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Revoke trust' }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in securely' }).click(); await expect(page.getByRole('heading', { name: 'Verify it’s you.' })).toBeVisible();
    await page.getByRole('button', { name: 'Use a recovery code' }).click(); await page.getByLabel('Recovery code', { exact: true }).fill(recoveryCodes[0]);
    await page.getByRole('button', { name: 'Verify and sign in' }).click(); await expect(page.getByRole('heading', { name: 'Your journal.' })).toBeVisible();
    expect(failures).toEqual([]);
  } finally {
    // Only the explicitly isolated branch and this run's objects are touched.
    await db.query("UPDATE cms.gallery SET items=$1::jsonb,published=$2::jsonb,revision=$3,published_at=$4,updated_at=$5 WHERE id='main'",
      [JSON.stringify(baseline.items), baseline.published ? JSON.stringify(baseline.published) : null, baseline.revision, baseline.published_at, baseline.updated_at]);
    await db.query('DELETE FROM cms.posts WHERE slug=$1 AND source_path IS NULL', [tag]);
    if (mediaId) {
      await db.query('DELETE FROM cms.media WHERE id=$1 AND legacy_path IS NULL', [mediaId]);
      await unlink(`.cms-local/media/cms/${mediaId}.webp`).catch(() => {});
    }
    if (createdOwner) {
      const ids = (await db.query('SELECT id FROM cms_auth."user" WHERE email=$1', [env.CMS_OWNER_EMAIL])).rows.map(row => row.id);
      for (const id of ids) await db.query('DELETE FROM cms_auth.verification WHERE value=$1 OR identifier=$1', [id]);
      await db.query('DELETE FROM cms_auth."user" WHERE email=$1', [env.CMS_OWNER_EMAIL]);
    }
    recoveryCodes.fill(''); secret = ''; await db.end();
  }
});
