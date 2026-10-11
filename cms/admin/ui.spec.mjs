import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { suppliedPhotoMetadata } from '../photo-metadata.mjs';

const owner = { id: 'owner', name: 'Ray Hagimoto', email: 'rayhagimoto@gmail.com', twoFactorEnabled: true };
function fixture() {
  return { configured: true, authenticated: true, requiresEnrollment: false,
    post: { id: 'post-one', title: 'A field note', slug: 'field-note', description: 'A short story', tags: ['travel'], date: '2026-10-10', markdown: '# Hello κόσμε\n\n$E=mc^2$', revision: 1, publishedAt: null, hasChanges: true, imported: true },
    media: [{ id: 'image-one', filename: 'Alpine light.webp', url: '/media/image-one.webp', width: 800, height: 600, size: 1024 }, { id: 'image-two', filename: 'Blue hour.webp', url: '/media/image-two.webp', width: 800, height: 600, size: 1024 }],
    gallery: { items: [{ mediaId: 'image-one', title: 'Alpine light', description: '', location: '', date: '', albums: ['Mountains'], metadata: {} }, { mediaId: 'image-two', title: 'Blue hour', description: '', location: '', date: '', albums: [], metadata: {} }], revision: 1, publishedAt: null, hasChanges: true },
    writes: [], uploads: [], conflict: false, authBodies: [], externalRequests: [], preview: '<h1>Hello κόσμε</h1><p>Safe preview.</p>' };
}
async function mock(page, data) {
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:9107')) data.externalRequests.push(request.url()); });
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname; const body = request.headers()['content-type']?.includes('application/json') && request.postData() ? JSON.parse(request.postData()) : null;
    const send = (json, status = 200) => route.fulfill({ status, json });
    if (path === '/api/cms/status') return send({ configured: data.configured, setupRequired: !data.configured });
    if (path === '/api/cms/session') return send({ authenticated: data.authenticated, user: data.authenticated ? { ...owner, twoFactorEnabled: !data.requiresEnrollment } : null, requiresEnrollment: data.requiresEnrollment });
    if (path === '/api/cms/setup') { data.authBodies.push(body); data.configured = true; data.authenticated = true; data.requiresEnrollment = true; return send({ user: owner }); }
    if (path === '/api/auth/sign-in/email') { data.authBodies.push(body); return send({ twoFactorRedirect: true }); }
    if (path === '/api/auth/two-factor/enable') return send({ totpURI: 'otpauth://totp/Studio:test?secret=JBSWY3DPEHPK3PXP&issuer=Studio', backupCodes: ['one-time-recovery', 'second-recovery'] });
    if (path === '/api/auth/two-factor/verify-totp' || path === '/api/auth/two-factor/verify-backup-code') { data.authBodies.push(body); data.authenticated = true; data.requiresEnrollment = false; return send({ user: owner }); }
    if (path.startsWith('/api/auth/')) return send({ user: owner, session: { id: 'current' } });
    if (path === '/api/cms/posts') return send({ posts: [data.post] });
    if (path === '/api/cms/posts/post-one' && request.method() === 'PATCH') {
      if (data.conflict) return send({ error: { code: 'CONFLICT', message: 'A newer version exists.' } }, 409);
      data.writes.push(body); data.post = { ...data.post, ...body, revision: data.post.revision + 1 }; return send({ post: data.post });
    }
    if (path === '/api/cms/posts/post-one') { if (data.slowPost) await new Promise(resolve => setTimeout(resolve, 300)); return send({ post: data.post }); }
    if (path === '/api/cms/preview') return send({ html: data.preview });
    if (path === '/api/cms/media' && request.method() === 'POST') {
      data.uploads.push(request.postData()); const preserved = request.postData().match(/name="metadata"\r\n\r\n([^\r]*)/);
      let metadata;
      try { metadata = preserved ? suppliedPhotoMetadata(preserved[1]) : data.uploadMetadata || {}; }
      catch { return send({ error: { code: 'INVALID_METADATA', message: 'The photo metadata could not be read.' } }, 400); }
      const media = { id: `uploaded-${data.uploads.length}`, filename: 'clipboard.webp', url: `/media/uploaded-${data.uploads.length}.webp`, width: 100, height: 100, size: 1024, metadata };
      data.media.push(media); return send({ media });
    }
    if (path === '/api/cms/media') return send({ media: data.media });
    if (path === '/api/cms/gallery' && request.method() === 'PUT') { data.writes.push(body); data.gallery = { ...data.gallery, ...body, revision: data.gallery.revision + 1 }; return send(data.gallery); }
    if (path === '/api/cms/gallery') return send({ gallery: data.gallery });
    if (path === '/api/cms/security') return send({ sessions: [{ id: 'current', isCurrent: true, userAgent: 'Current browser', expiresAt: '2026-11-10' }], trustedDevices: [] });
    return send({});
  });
  await page.route('**/media/*.webp', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#678c76"/></svg>' }));
}

test('sign-in shares the public default theme and follows system changes without storing a preference', async ({ page }, testInfo) => {
  const data = fixture(); data.authenticated = false; await mock(page, data);
  await page.emulateMedia({ colorScheme: 'light' }); await page.goto('/admin/');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(15, 15, 15)');
  await expect(page.getByRole('button', { name: 'Sign in securely' })).toHaveCSS('background-color', 'rgb(216, 131, 41)');
  await page.screenshot({ path: testInfo.outputPath('studio-signin-dark.png'), fullPage: true, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' }); await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test('public appearance preference persists across the studio, editor, preview, and reload', async ({ page }, testInfo) => {
  const data = fixture(); await mock(page, data);
  await page.addInitScript(() => { if (!localStorage.getItem('appearance')) localStorage.setItem('appearance', 'light'); });
  await page.emulateMedia({ colorScheme: 'dark' }); await page.goto('/admin/');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: /A field note/ }).click();
  await expect(page.locator('#markdown-editor .vditor-ir')).toBeVisible();
  await expect(page.locator('#markdown-editor .vditor-toolbar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: testInfo.outputPath('studio-editor-light.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Published preview', exact: true }).click();
  const preview = page.frameLocator('#safe-preview-frame');
  await expect(preview.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: 'Switch color theme' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('#markdown-editor')).toHaveClass(/vditor--dark/);
  await expect(page.locator('#markdown-editor .vditor-toolbar')).toHaveCSS('background-color', 'rgb(25, 25, 25)');
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toHaveCSS('background-color', 'rgb(25, 25, 25)');
  await expect(preview.locator('body')).toHaveCSS('background-color', 'rgb(15, 15, 15)');
  await page.screenshot({ path: testInfo.outputPath('studio-editor-dark.png'), fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => localStorage.getItem('appearance'))).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch color theme' })).toHaveText('Light theme');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(15, 15, 15)');
});

test('sign-in requires a TOTP challenge and passes the trusted browser preference', async ({ page }) => {
  const data = fixture(); data.authenticated = false; await mock(page, data); await page.goto('/admin/');
  await page.getByLabel('Password', { exact: true }).fill('unique-password-for-test'); await page.getByRole('button', { name: 'Sign in securely' }).click();
  await expect(page.getByRole('heading', { name: 'Verify it’s you.' })).toBeVisible();
  await page.getByLabel('Authenticator code').fill('123456'); await page.getByLabel('Trust this browser').check();
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your journal.' })).toBeVisible();
  expect(data.authBodies.at(-1)).toMatchObject({ code: '123456', trustDevice: true });
});

test('setup removes the token from the address and requires enrollment with saved recovery codes', async ({ page }) => {
  const data = fixture(); data.configured = false; data.authenticated = false; await mock(page, data); await page.goto('/admin/#setup=private-setup-token');
  await expect(page.getByLabel('Setup token')).toHaveValue('private-setup-token'); expect(page.url()).not.toContain('private-setup-token');
  await page.getByLabel('New password').fill('unique-password-for-test'); await page.getByRole('button', { name: 'Create administrator' }).click();
  await expect(page.getByRole('heading', { name: 'Protect your studio.' })).toBeVisible();
  await page.getByLabel('Confirm your password').fill('unique-password-for-test'); await page.getByRole('button', { name: 'Set up authenticator' }).click();
  await expect(page.getByRole('heading', { name: 'Scan. Save. Verify.' })).toBeVisible();
  await expect(page.locator('#totp-qr')).toBeVisible(); await expect(page.locator('#recovery-codes')).toContainText('one-time-recovery');
  await page.getByLabel('I saved these codes').check(); await page.getByLabel('Authenticator code').fill('123456');
  await page.getByRole('button', { name: 'Verify and open studio' }).click();
  await expect(page.getByRole('heading', { name: 'Your journal.' })).toBeVisible();
});

test('Unicode editing and local math assets work with strict CSP and safe published preview', async ({ page }) => {
  const data = fixture(); await mock(page, data); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/admin/'); await page.getByRole('button', { name: /A field note/ }).click();
  await expect(page.locator('#markdown-editor .vditor-ir')).toBeVisible();
  await expect(page.locator('#markdown-editor .katex').first()).toBeVisible();
  await page.getByLabel('Editor mode').selectOption('sv');
  const source = page.locator('.vditor-sv'); await expect(source).toBeVisible(); await expect(source).toHaveValue(/κόσμε/);
  await source.fill('# Unicode 日本語 ∑ αβγ\n\n$$x^2$$');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect.poll(() => data.writes.length).toBeGreaterThan(0); expect(data.writes.at(-1).markdown).toContain('日本語');
  await page.getByRole('button', { name: 'Published preview', exact: true }).click();
  await expect(page.frameLocator('#safe-preview-frame').getByRole('heading', { name: 'Hello κόσμε' })).toBeVisible();
  await expect(page.locator('#safe-preview-frame')).toHaveAttribute('sandbox', 'allow-same-origin');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]); expect(data.externalRequests).toEqual([]); expect(errors).toEqual([]);
});

test('rich text, hybrid, and source preview modes preserve Markdown', async ({ page }) => {
  const data = fixture(); await mock(page, data); await page.goto('/admin/'); await page.getByRole('button', { name: /A field note/ }).click();
  for (const mode of ['wysiwyg', 'split', 'ir', 'sv']) {
    await page.getByLabel('Editor mode').selectOption(mode);
    if (mode === 'split' || mode === 'sv') await expect(page.locator('.vditor-sv')).toHaveValue(/Hello κόσμε/);
    else await expect(page.locator(mode === 'ir' ? '.vditor-ir [contenteditable=true]' : '.vditor-wysiwyg [contenteditable=true]')).toContainText('Hello κόσμε');
  }
  expect(data.externalRequests).toEqual([]);
});

test('clipboard and drag-and-drop images upload and insert stable media links', async ({ page }) => {
  const data = fixture(); await mock(page, data); await page.goto('/admin/'); await page.getByRole('button', { name: /A field note/ }).click();
  await page.getByLabel('Editor mode').selectOption('sv'); const source = page.locator('.vditor-sv'); await source.focus();
  for (const eventType of ['paste', 'drop']) {
    await source.evaluate((element, type) => {
      const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'clipboard.png', { type: 'image/png' }));
      const rectangle = element.getBoundingClientRect();
      const event = type === 'paste' ? new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
        : new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true, clientX: rectangle.x + 15, clientY: rectangle.y + 15 });
      element.dispatchEvent(event);
    }, eventType);
    await expect.poll(() => data.uploads.length).toBe(eventType === 'paste' ? 1 : 2);
    await expect(source).toHaveValue(new RegExp(`uploaded-${eventType === 'paste' ? 1 : 2}\\.webp`));
  }
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  expect(data.writes.at(-1).markdown).toContain('/media/uploaded-2.webp'); expect(data.externalRequests).toEqual([]);
});

test('autosave conflicts preserve browser edits and pause further writes', async ({ page }) => {
  const data = fixture(); data.conflict = true; await mock(page, data); await page.goto('/admin/');
  await page.getByRole('button', { name: /A field note/ }).click(); await page.getByLabel('Title', { exact: true }).fill('Keep this local title');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(page.locator('#conflict-box')).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Keep this local title'); await expect(page.locator('#save-status')).toContainText('Save failed');
  await page.getByRole('button', { name: 'Photo gallery', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Keep this local title'); expect(data.writes).toEqual([]);
});

test('gallery order, caption, albums, and metadata persist as an explicit draft', async ({ page }, testInfo) => {
  const data = fixture(); await mock(page, data); await page.goto('/admin/'); await page.getByRole('button', { name: 'Photo gallery', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select Blue hour', exact: true }).check();
  await page.getByRole('button', { name: 'Move selected photographs up' }).click();
  await expect(page.locator('#gallery-grid .image-card').first()).toContainText('Blue hour');
  await page.getByRole('button', { name: 'Edit selected photographs' }).click(); await page.getByLabel('Title', { exact: true }).fill('Dusk');
  await page.getByLabel('Caption', { exact: true }).fill('The light at dusk.'); await page.getByLabel('Albums', { exact: true }).fill('Evening, Travel');
  await page.getByRole('button', { name: 'Apply details' }).click(); await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  expect(data.writes.at(-1).items[0]).toMatchObject({ mediaId: 'image-two', title: 'Dusk', description: 'The light at dusk.', albums: ['Evening', 'Travel'] });
  await page.screenshot({ path: testInfo.outputPath('studio-desktop.png'), fullPage: true });
  await page.getByLabel('Album', { exact: true }).selectOption('Evening'); await expect(page.locator('#gallery-grid .image-card')).toHaveCount(1);
});

test('large gallery uploads preserve camera metadata before browser compression', async ({ page }) => {
  const data = fixture(); await mock(page, data); await page.goto('/admin/');
  await page.getByRole('button', { name: 'Photo gallery', exact: true }).click();
  const choosing = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Upload photos', exact: true }).click();
  await choosing;
  await page.locator('#gallery-files').setInputFiles('assets/img/gallery/0000.jpg');
  await expect(page.locator('#gallery-upload-status')).toContainText('1 photograph added');
  await page.getByRole('button', { name: 'Edit selected photographs', exact: true }).click();
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-02-23');
  const metadata = JSON.parse(await page.locator('#gallery-details textarea[name="metadata"]').inputValue());
  expect(metadata).toMatchObject({ camera: 'ILCE-7M3', lens: '24-70mm F2.8 DG DN | Art 019', iso: 100, shutter_speed: '1/6 s', aperture: 'f/2.8', focal_length: '70 mm', focal_length_35mm: 70 });
  await page.getByRole('button', { name: 'Apply details', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  expect(data.writes.at(-1).items.at(-1)).toMatchObject({ date: '2026-02-23', metadata });
});

test('library images keep extracted location and settings after reload, with editable gallery overrides', async ({ page }) => {
  const data = fixture(); data.media.push({ id: 'exif-photo', filename: 'Photo.jpg', url: '/media/exif-photo.webp',
    metadata: { location: 'Kyoto, Japan', date: '2026-02-23', camera: 'Sony', iso: 400 } });
  await mock(page, data); await page.goto('/admin/'); await page.reload();
  await page.getByRole('button', { name: 'Photo gallery', exact: true }).click();
  await page.getByRole('button', { name: 'Choose library photos', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select Photo.jpg', exact: true }).check();
  await page.getByRole('button', { name: 'Add selected photographs', exact: true }).click();
  await page.getByRole('button', { name: 'Edit selected photographs', exact: true }).click();
  await expect(page.getByLabel('Location', { exact: true })).toHaveValue('Kyoto, Japan');
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-02-23');
  await page.getByLabel('Location', { exact: true }).fill('Fushimi Inari, Kyoto');
  await page.getByRole('button', { name: 'Apply details', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  expect(data.writes.at(-1).items.at(-1)).toMatchObject({ location: 'Fushimi Inari, Kyoto', metadata: data.media.at(-1).metadata });
  expect(data.media.at(-1).metadata.location).toBe('Kyoto, Japan');
});

test('mobile studio layout fits its viewport', async ({ page }, testInfo) => {
  const data = fixture(); await mock(page, data); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/admin/');
  await page.getByRole('button', { name: 'Photo gallery', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Curate the gallery.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const cards = page.locator('#gallery-grid .gallery-photo');
  const first = await cards.nth(0).boundingBox(); const second = await cards.nth(1).boundingBox();
  expect(first.y).toBe(second.y); expect(second.x).toBeGreaterThan(first.x);
  await page.screenshot({ path: testInfo.outputPath('studio-mobile.png'), fullPage: true });
});

test('safe preview loads cookie-protected draft images and blocks scripts even if a malformed response includes them', async ({ page, context }) => {
  const data = fixture(); data.preview = '<h1>Private photograph</h1><img alt="Draft photograph" src="/fixture-private-image.svg"><script>parent.previewScriptRan=true</script>';
  await context.addCookies([{ name: 'fixture-admin', value: 'authenticated', url: 'http://127.0.0.1:9107', sameSite: 'Strict', httpOnly: true }]);
  await mock(page, data); await page.goto('/admin/'); await page.getByRole('button', { name: /A field note/ }).click();
  await page.getByRole('button', { name: 'Published preview', exact: true }).click();
  const image = page.frameLocator('#safe-preview-frame').getByAltText('Draft photograph');
  await expect(image).toBeVisible(); await expect.poll(() => image.evaluate(element => element.naturalWidth)).toBe(100);
  expect(await page.evaluate(() => window.previewScriptRan)).toBeUndefined();
});

test('loading a post prevents overlapping navigation and shows the imported-format notice', async ({ page }) => {
  const data = fixture(); data.slowPost = true; await mock(page, data); await page.goto('/admin/');
  await page.getByRole('button', { name: /A field note/ }).click();
  await expect(page.getByRole('button', { name: 'Photo gallery', exact: true })).toBeDisabled();
  await expect(page.getByText('This post uses existing website formatting.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Editor mode')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Photo gallery', exact: true })).toBeEnabled();
});

test('an editor asset failure preserves Markdown and leaves a working draft download', async ({ page }) => {
  const data = fixture(); await mock(page, data); await page.clock.install();
  await page.route('**/lute.min.js', route => route.abort());
  await page.goto('/admin/'); await page.getByRole('button', { name: /A field note/ }).click();
  await expect(page.getByRole('heading', { name: 'Make room for an idea.' })).toBeVisible();
  await page.clock.fastForward(21000); await expect(page.locator('#save-status')).toContainText('Your Markdown is preserved');
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download Markdown', exact: true }).click();
  const download = await downloading; const markdown = await readFile(await download.path(), 'utf8');
  expect(markdown).toContain('Hello κόσμε'); expect(markdown).toContain('title: "A field note"');
});

test('gallery batch edits change only opted-in fields and removal keeps library originals', async ({ page }) => {
  const data = fixture(); data.gallery.items[0].metadata = { iso: 100, camera: 'Sony' }; data.gallery.items[1].metadata = { iso: 400 };
  await mock(page, data); await page.goto('/admin/'); await page.getByRole('button', { name: 'Photo gallery', exact: true }).click();
  const edit = page.getByRole('button', { name: 'Edit selected photographs', exact: true }); const remove = page.getByRole('button', { name: 'Remove selected photographs from gallery', exact: true });
  await expect(edit).toBeDisabled(); await expect(remove).toBeDisabled();
  await expect(page.locator('#gallery-grid button')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Select all visible photographs', exact: true }).check();
  await expect(page.locator('#gallery-selection-count')).toHaveText('2 selected');
  await edit.click(); await expect(page.getByLabel('Title', { exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Change location', exact: true }).check(); await page.getByLabel('Location', { exact: true }).fill('Chicago, IL');
  await page.getByRole('button', { name: 'Apply details', exact: true }).click(); await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  expect(data.writes.at(-1).items).toMatchObject([{ title: 'Alpine light', location: 'Chicago, IL', albums: ['Mountains'], metadata: { iso: 100, camera: 'Sony' } }, { title: 'Blue hour', location: 'Chicago, IL', albums: [], metadata: { iso: 400 } }]);
  await remove.click(); await expect(page.locator('#gallery-grid .gallery-photo')).toHaveCount(0); await expect(remove).toBeDisabled();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click(); expect(data.writes.at(-1).items).toEqual([]); expect(data.media).toHaveLength(2);
  await page.getByRole('button', { name: 'Choose library photos', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('checkbox')).toHaveCount(2);
});

test('gallery albums support batches, clearing assignments, and safe filter selection', async ({ page }) => {
  const data = fixture(); await mock(page, data); await page.goto('/admin/'); await page.getByRole('button', { name: 'Photo gallery', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select all visible photographs', exact: true }).check();
  const albums = page.getByRole('button', { name: 'Change albums for selected photographs', exact: true }); await albums.click();
  await page.getByLabel('New albums', { exact: true }).fill('Travel, Travel'); await page.getByRole('button', { name: 'Apply albums', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click(); expect(data.writes.at(-1).items.map(item => item.albums)).toEqual([['Mountains', 'Travel'], ['Travel']]);
  await page.getByLabel('Album', { exact: true }).selectOption('Mountains'); await expect(page.locator('#gallery-selection-count')).toHaveText('Select photos'); await expect(albums).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Select Alpine light', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Move selected photographs down' })).toBeDisabled();
  await albums.click(); await page.getByLabel('Album action', { exact: true }).selectOption('remove'); await page.getByRole('checkbox', { name: 'Mountains', exact: true }).check();
  await page.getByRole('button', { name: 'Apply albums', exact: true }).click();
  await expect(page.locator('#gallery-selection-count')).toHaveText('Select photos'); await expect(page.getByLabel('Album', { exact: true })).toHaveValue('');
  await page.getByRole('checkbox', { name: 'Select all visible photographs', exact: true }).check(); await albums.click();
  await page.getByLabel('Album action', { exact: true }).selectOption('replace'); await page.getByRole('button', { name: 'Apply albums', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click(); expect(data.writes.at(-1).items.map(item => item.albums)).toEqual([[], []]);
});

test('batch reorder preserves selected photo order and library picker adds several together', async ({ page }) => {
  const data = fixture();
  for (const [id, title] of [['image-three', 'Third photo'], ['image-four', 'Fourth photo']]) {
    data.media.push({ id, filename: `${title}.jpg`, url: `/media/${id}.webp`, metadata: { iso: 800 } });
  }
  await mock(page, data); await page.goto('/admin/'); await page.getByRole('button', { name: 'Photo gallery', exact: true }).click();
  await page.getByRole('button', { name: 'Choose library photos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add selected photographs', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Select Third photo.jpg', exact: true }).check(); await page.getByRole('checkbox', { name: 'Select Fourth photo.jpg', exact: true }).check();
  await expect(page.locator('#gallery-grid .gallery-photo')).toHaveCount(2);
  await page.getByRole('button', { name: 'Add selected photographs', exact: true }).click(); await expect(page.locator('#gallery-selection-count')).toHaveText('2 selected');
  await page.getByRole('button', { name: 'Move selected photographs up', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click(); expect(data.writes.at(-1).items.map(item => item.mediaId)).toEqual(['image-one', 'image-three', 'image-four', 'image-two']);
  await page.getByRole('button', { name: 'Move selected photographs down', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Move selected photographs down', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click(); expect(data.writes.at(-1).items.map(item => item.mediaId)).toEqual(['image-one', 'image-two', 'image-three', 'image-four']);
});

test('gallery drops upload a batch without albums and keep successes when a file is unsupported', async ({ page }) => {
  const data = fixture(); data.uploadMetadata = { location: 'Kyoto', date: '2026-02-23', iso: 400 };
  await mock(page, data); await page.goto('/admin/'); await page.getByRole('button', { name: 'Photo gallery', exact: true }).click();
  await page.getByLabel('Album', { exact: true }).selectOption('Mountains');
  await page.locator('#gallery-workspace').evaluate(element => {
    const transfer = new DataTransfer();
    for (const name of ['first.png', 'unsupported.txt', 'second.png']) transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], name, { type: name.endsWith('.png') ? 'image/png' : 'text/plain' }));
    element.dispatchEvent(new DragEvent('dragenter', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    if (!element.classList.contains('drag-over')) throw new Error('No upload affordance during file drag.');
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#gallery-upload-status')).toContainText('2 photographs added'); await expect(page.locator('#gallery-upload-status')).toContainText('1 upload(s) failed');
  await expect(page.locator('#gallery-workspace')).not.toHaveClass(/drag-over/); await expect(page.getByLabel('Album', { exact: true })).toHaveValue('');
  await expect(page.locator('#gallery-selection-count')).toHaveText('2 selected'); await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  expect(data.uploads).toHaveLength(2); expect(data.writes.at(-1).items.slice(-2)).toMatchObject([{ albums: [], location: 'Kyoto', date: '2026-02-23', metadata: { iso: 400 } }, { albums: [], location: 'Kyoto', date: '2026-02-23', metadata: { iso: 400 } }]);
});

test('photo grid reveals details on hover and keeps icon actions and mobile photos compact', async ({ page }, testInfo) => {
  const data = fixture(); const names = ['Chicago Loop', 'Roosevelt Rd', 'Roosevelt Station', 'Roosevelt Station', 'Ceres', 'Grant Park', 'Aoba Castle', 'Lake Michigan', 'Ikebukuro', 'Night train', 'Shinjuku', 'JR Hokkaido'];
  data.media = names.map((name, index) => ({ id: `photo-${index}`, filename: `${name}.jpg`, url: `/media/photo-${index}.webp` }));
  data.gallery.items = data.media.map((media, index) => ({ mediaId: media.id, title: names[index], description: '', location: index < 6 ? 'Chicago, IL' : 'Japan', date: '', albums: index < 6 ? ['Chicago'] : ['Japan'], metadata: {} }));
  await mock(page, data);
  const { default: sharp } = await import('sharp');
  const photos = await Promise.all(names.map((_, index) => sharp(`assets/img/gallery/${String(index).padStart(4, '0')}.jpg`).resize(600).jpeg().toBuffer()));
  await page.route('**/media/photo-*.webp', route => route.fulfill({ contentType: 'image/jpeg', body: photos[Number(new URL(route.request().url()).pathname.match(/photo-(\d+)/)[1])] }));
  await page.goto('/admin/'); await page.getByRole('button', { name: 'Photo gallery', exact: true }).click(); await page.mouse.move(0, 0);
  const cards = page.locator('#gallery-grid .gallery-photo'); const details = cards.first().locator('.gallery-photo-details');
  await expect(details).toHaveCSS('opacity', '0'); await cards.first().hover(); await expect(details).toHaveCSS('opacity', '1');
  await cards.first().click(); await expect(cards.first().getByRole('checkbox')).toBeChecked(); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('checkbox', { name: 'Select Roosevelt Rd', exact: true }).check(); await page.mouse.move(0, 0);
  await expect(details).toHaveCSS('opacity', '0'); await expect(page.locator('#gallery-edit svg')).toBeVisible(); await expect(page.locator('#gallery-edit')).toHaveCSS('border-top-width', '0px');
  await expect.poll(() => cards.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('gallery-desktop.png'), fullPage: true, animations: 'disabled' });
  await cards.first().hover(); await page.screenshot({ path: testInfo.outputPath('gallery-hover.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.mouse.move(0, 0);
  const first = await cards.nth(0).boundingBox(); const second = await cards.nth(1).boundingBox(); expect(first.y).toBe(second.y); expect(second.x).toBeGreaterThan(first.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('gallery-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Change albums for selected photographs', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test.describe('touch gallery', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('selection reveals photo details and single removal leaves other images intact', async ({ page }) => {
    const data = fixture(); await mock(page, data); await page.goto('/admin/'); await page.getByRole('button', { name: 'Photo gallery', exact: true }).tap();
    const card = page.locator('#gallery-grid .gallery-photo').first();
    await expect(card.locator('.gallery-photo-details')).toHaveCSS('opacity', '0'); await card.tap();
    await expect(card.getByRole('checkbox')).toBeChecked(); await expect(card.locator('.gallery-photo-details')).toHaveCSS('opacity', '1');
    await page.getByRole('button', { name: 'Remove selected photographs from gallery', exact: true }).tap();
    await expect(page.locator('#gallery-grid .gallery-photo')).toHaveCount(1); await expect(page.locator('#gallery-grid')).toContainText('Blue hour');
    await page.getByRole('button', { name: 'Save draft', exact: true }).tap(); expect(data.writes.at(-1).items.map(item => item.mediaId)).toEqual(['image-two']);
  });
});
