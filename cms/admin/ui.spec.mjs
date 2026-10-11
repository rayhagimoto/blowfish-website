import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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
      const media = { id: `uploaded-${data.uploads.length}`, filename: 'clipboard.webp', url: `/media/uploaded-${data.uploads.length}.webp`, width: 100, height: 100, size: 1024, metadata: preserved ? JSON.parse(preserved[1]) : data.uploadMetadata || {} };
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
  await page.getByRole('button', { name: 'Move Blue hour up' }).click();
  await expect(page.locator('#gallery-grid .image-card').first()).toContainText('Blue hour');
  await page.getByRole('button', { name: 'Edit details' }).first().click(); await page.getByLabel('Title', { exact: true }).fill('Dusk');
  await page.getByLabel('Caption', { exact: true }).fill('The light at dusk.'); await page.getByLabel('Albums', { exact: true }).fill('Evening, Travel');
  await page.getByRole('button', { name: 'Apply details' }).click(); await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  expect(data.writes.at(-1).items[0]).toMatchObject({ mediaId: 'image-two', title: 'Dusk', description: 'The light at dusk.', albums: ['Evening', 'Travel'] });
  await page.screenshot({ path: testInfo.outputPath('studio-desktop.png'), fullPage: true });
  await page.getByLabel('Album', { exact: true }).selectOption('Evening'); await expect(page.locator('#gallery-grid .image-card')).toHaveCount(1);
});

test('large gallery uploads preserve camera metadata before browser compression', async ({ page }) => {
  const data = fixture(); await mock(page, data); await page.goto('/admin/');
  await page.getByRole('button', { name: 'Photo gallery', exact: true }).click();
  await page.getByRole('button', { name: 'Add images', exact: true }).click();
  await page.locator('#gallery-files').setInputFiles('assets/img/gallery/0000.jpg');
  await expect(page.locator('#gallery-upload-status')).toContainText('Uploads added');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Edit details', exact: true }).last().click();
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-02-23');
  const metadata = JSON.parse(await page.locator('#gallery-details textarea[name="metadata"]').inputValue());
  expect(metadata).toMatchObject({ camera: 'ILCE-7M3', lens: '24-70mm F2.8 DG DN | Art 019', iso: 100, shutter_speed: '1/6 s', aperture: 'f/2.8', focal_length: '70 mm' });
  await page.getByRole('button', { name: 'Apply details', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  expect(data.writes.at(-1).items.at(-1)).toMatchObject({ date: '2026-02-23', metadata });
});

test('library images keep extracted location and settings after reload, with editable gallery overrides', async ({ page }) => {
  const data = fixture(); data.media.push({ id: 'exif-photo', filename: 'Photo.jpg', url: '/media/exif-photo.webp',
    metadata: { location: 'Kyoto, Japan', date: '2026-02-23', camera: 'Sony', iso: 400 } });
  await mock(page, data); await page.goto('/admin/'); await page.reload();
  await page.getByRole('button', { name: 'Photo gallery', exact: true }).click();
  await page.getByRole('button', { name: 'Add images', exact: true }).click();
  await page.getByRole('button', { name: 'Choose library image', exact: true }).click();
  await page.getByRole('button', { name: 'Select image', exact: true }).last().click();
  await page.getByRole('button', { name: 'Edit details', exact: true }).last().click();
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
