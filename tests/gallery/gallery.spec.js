import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function ready(page) {
  await page.goto('/gallery/');
  await expect(page.locator('.album-filters')).toBeVisible();
  await expect(page.locator('.gallery-card.is-loaded').first()).toBeVisible();
}

async function collection(page) {
  return page.locator('#gallery-data').evaluate(el => JSON.parse(el.textContent));
}

test('shares the site theme and preserves its appearance switcher', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('appearance', 'light'));
  const styles = () => page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const title = getComputedStyle(document.querySelector('h1'));
    return { background: body.backgroundColor, color: body.color, font: body.fontFamily, titleFont: title.fontFamily, titleSize: title.fontSize, titleWeight: title.fontWeight };
  });
  await page.goto('/posts/');
  const siteStyles = await styles();
  const siteCss = await page.locator('link[href*="main.bundle"]').getAttribute('href');
  await ready(page);
  expect(await styles()).toEqual(siteStyles);
  await expect(page.locator('link[href*="main.bundle"]')).toHaveAttribute('href', siteCss);
  await expect(page.getByRole('button', { name: 'Search', exact: true }).first()).toBeVisible();
  await expect(page.locator('#site-footer')).toHaveCount(1);
  await page.getByRole('button', { name: 'Dark mode switcher', exact: true }).first().click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect((await styles()).background).not.toBe(siteStyles.background);
  const accent = await page.evaluate(() => `rgb(${getComputedStyle(document.documentElement).getPropertyValue('--color-primary-400').trim()})`);
  await expect(page.locator('.album-filters [aria-pressed="true"]')).toHaveCSS('background-color', accent);
});

test('starts with a small batch and loads the lightbox library only when opened', async ({ page }) => {
  const requests = [];
  const errors = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  const photos = await collection(page);
  expect(photos).toHaveLength(56);
  await expect(page.locator('.gallery-card')).toHaveCount(12);
  expect(requests.some(url => /photoswipe\.esm-/.test(url))).toBe(false);
  const large = new Set(photos.flatMap(photo => photo.variants.filter(v => v.width > 960).map(v => v.src)));
  expect(requests.some(url => large.has(new URL(url).pathname))).toBe(false);
  await page.locator('.gallery-link').first().click();
  await expect(page.locator('.pswp')).toBeVisible();
  expect(requests.some(url => /photoswipe\.esm-/.test(url))).toBe(true);
  expect(errors).toEqual([]);
});

test('navigates the entire collection, preloads both directions, zooms, and restores focus', async ({ page }) => {
  const loaded = new Set();
  page.on('request', request => loaded.add(new URL(request.url()).pathname));
  await ready(page);
  const photos = await collection(page);
  // Open within the first batch so both neighbors exist without wrapping.
  const opener = page.locator('.gallery-link').nth(5);
  await opener.click();
  await expect(page.locator('.pswp')).toBeFocused();
  await expect(page.locator('.pswp__counter')).toHaveText('6 / 56');
  await expect(page.locator('.pswp__item[aria-hidden="false"] .photo-title')).toHaveText(photos[5].title);
  await expect.poll(() => [4, 6].every(index => photos[index].variants.some(v => loaded.has(v.src)))).toBe(true);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.pswp__counter')).toHaveText('5 / 56');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.pswp__counter')).toHaveText('6 / 56');
  await page.getByRole('button', { name: 'Zoom photograph', exact: true }).click();
  await expect.poll(() => photos[5].variants.some(v => v.width >= 1440 && loaded.has(v.src))).toBe(true);
  for (let index = 0; index < 9; index++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.pswp__counter')).toHaveText('15 / 56');
  await expect(page.locator('.gallery-card')).toHaveCount(12);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pswp')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('scroll appends every image once and album filtering resets the grid and lightbox', async ({ page }) => {
  await ready(page);
  for (let batch = 0; batch < 5; batch++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(250);
  }
  await expect(page.locator('.gallery-card')).toHaveCount(56);
  const ids = await page.locator('.gallery-card').evaluateAll(cards => cards.map(card => card.dataset.photoId));
  expect(new Set(ids).size).toBe(56);
  await expect(page.locator('#load-more')).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'Japan', exact: true }).click();
  const japan = (await collection(page)).filter(photo => photo.albums.includes('Japan'));
  await expect(page.locator('#photo-count')).toHaveText(String(japan.length));
  const filteredIds = await page.locator('.gallery-card').evaluateAll(cards => cards.map(card => card.dataset.photoId));
  expect(filteredIds.every(id => japan.some(photo => photo.id === id))).toBe(true);
  await page.locator('.gallery-link').first().click();
  await expect(page.locator('.pswp')).toBeFocused();
  await expect(page.locator('.pswp__counter')).toHaveText(`1 / ${japan.length}`);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pswp')).toHaveCount(0);
  await page.getByRole('button', { name: 'All photographs', exact: true }).click();
  await expect(page.locator('#photo-count')).toHaveText('56');
});

test('mobile layout stays within the viewport and supports touch navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const first = await page.locator('.gallery-card').first().boundingBox();
  const gridBounds = await page.locator('#photo-grid').boundingBox();
  expect(first.width).toBeCloseTo(gridBounds.width, 0);
  await page.locator('.gallery-link').first().click();
  await expect(page.locator('.pswp')).toBeVisible();
  await expect(page.locator('.pswp')).toBeFocused();
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 320, y: 320 }] });
  for (const x of [260, 200, 140, 70]) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 320 }] });
    await page.waitForTimeout(30);
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.pswp__counter')).toHaveText('2 / 56');
  await page.keyboard.press('Escape');
});

test('missing titles, missing metadata, and entirely empty captions display cleanly', async ({ page }) => {
  await page.route('**/gallery/', async route => {
    const response = await route.fetch();
    const html = await response.text();
    const body = html.replace(/(<script id="gallery-data" type="application\/json">)([\s\S]*?)(<\/script>)/, (_, open, json, close) => {
      const photos = JSON.parse(json);
      photos[0].title = '';
      photos[0].caption = '<dl class="photo-metadata"><div><dt>Location</dt><dd>Chicago</dd></div></dl>';
      photos[1].caption = '<h2 class="photo-title">Title only</h2>';
      photos[2].title = '';
      photos[2].caption = '';
      return open + JSON.stringify(photos) + close;
    });
    await route.fulfill({ response, body });
  });
  await ready(page);
  await page.locator('.gallery-link').first().click();
  await expect(page.locator('.pswp')).toBeFocused();
  await expect(page.locator('.pswp__item[aria-hidden="false"] .photo-metadata')).toContainText('Chicago');
  await expect(page.locator('.pswp__item[aria-hidden="false"] .photo-title')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.pswp__item[aria-hidden="false"] .photo-title')).toHaveText('Title only');
  await expect(page.locator('.pswp__item[aria-hidden="false"] .photo-metadata')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.pswp__counter')).toHaveText('3 / 56');
  await expect(page.locator('.pswp__item[aria-hidden="false"] .pswp__dynamic-caption')).toHaveCount(0);
});

test('all images and their captions remain available without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:9099/gallery/');
  await expect(page.locator('.gallery-card')).toHaveCount(56);
  await expect(page.locator('.gallery-link').first()).toHaveAttribute('href', /\.webp$/);
  await expect(page.locator('figcaption').first()).toContainText('Chicago');
  await expect(page.locator('.album-filters')).toBeHidden();
  await context.close();
});

test('Hugo builds images with absent sidecars, titles only, or metadata only', async ({ page }) => {
  await ready(page);
  const [photo] = await collection(page);
  const preview = await (await page.request.get(photo.thumb)).body();
  const fixture = mkdtempSync(join(tmpdir(), 'gallery-metadata-'));
  try {
    mkdirSync(join(fixture, 'assets/img/gallery'), { recursive: true });
    mkdirSync(join(fixture, 'content/gallery'), { recursive: true });
    cpSync('layouts/gallery-overhaul', join(fixture, 'layouts/gallery-overhaul'), { recursive: true });
    cpSync('layouts/partials/gallery-overhaul', join(fixture, 'layouts/partials/gallery-overhaul'), { recursive: true });
    writeFileSync(join(fixture, 'layouts/partials/scroll-to-top.html'), '<div id="scroll-to-top"></div>');
    mkdirSync(join(fixture, 'layouts/_default'), { recursive: true });
    writeFileSync(join(fixture, 'layouts/_default/baseof.html'), '<!doctype html><html><body>{{ block "main" . }}{{ end }}</body></html>');
    writeFileSync(join(fixture, 'hugo.toml'), 'baseURL = "https://example.test/"\ntitle = "Test gallery"\n');
    writeFileSync(join(fixture, 'content/gallery/index.md'), '---\ntitle: Photography\ntype: gallery-overhaul\n---\n');
    for (const id of ['00', '01', '02']) writeFileSync(join(fixture, `assets/img/gallery/${id}.webp`), preview);
    writeFileSync(join(fixture, 'assets/img/gallery/01.yaml'), 'title: Title only\n');
    writeFileSync(join(fixture, 'assets/img/gallery/02.yaml'), 'location: Metadata only\n');
    execFileSync(process.env.HUGO_BINARY || 'hugo', ['--source', fixture, '--cacheDir', join(fixture, 'cache')], { stdio: 'pipe' });
    const html = readFileSync(join(fixture, 'public/gallery/index.html'), 'utf8');
    const data = JSON.parse(html.match(/<script id="gallery-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    expect(data).toHaveLength(3);
    expect(data[0].title).toBe('');
    expect(data[0].caption).toBe('');
    expect(data[1].caption).toContain('Title only');
    expect(data[1].caption).not.toContain('<dl');
    expect(data[2].title).toBe('');
    expect(data[2].caption).toContain('Metadata only');
    expect(data[2].caption).not.toContain('<h2');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
