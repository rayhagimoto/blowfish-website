import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { getMigrations } from 'better-auth/db/migration';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { createAuth, handleAuth, requireOwner, authRouteAllowed } from '../../cms/auth.mjs';
import { renderMarkdown } from '../../cms/markdown.mjs';
import { createHandler } from '../../cms/api.mjs';
import { uploadImage } from '../../cms/media.mjs';
import sharp from 'sharp';
import { crc32, deflateSync } from 'node:zlib';

const config = {
  origin: 'https://cms.example.test',
  ownerEmail: 'rayhagimoto@gmail.com',
  authSecret: 'local-security-test-secret-with-at-least-32-characters',
  setupToken: 'local-security-test-setup-token-with-at-least-32-characters',
  secureCookies: true,
};
const password = 'A long test-only password 123!';
const imageId = 'e3f0f994-b4db-4771-9294-fb78ab51b05d';

const protectedRoutes = [
  ['GET', '/api/cms/posts'], ['POST', '/api/cms/posts'],
  ['GET', `/api/cms/posts/${imageId}`], ['PATCH', `/api/cms/posts/${imageId}`],
  ['DELETE', `/api/cms/posts/${imageId}`], ['POST', `/api/cms/posts/${imageId}/publish`],
  ['POST', `/api/cms/posts/${imageId}/unpublish`],
  ['GET', '/api/cms/media'], ['POST', '/api/cms/media'], ['DELETE', `/api/cms/media/${imageId}`],
  ['GET', `/media/${imageId}.webp`], ['GET', '/api/cms/gallery'], ['PUT', '/api/cms/gallery'],
  ['POST', '/api/cms/gallery/publish'], ['POST', '/api/cms/preview'], ['GET', '/api/cms/security'],
  ['POST', '/api/cms/security/revoke-trusted'], ['POST', '/api/cms/security/revoke-others'],
  ['POST', '/api/cms/security/revoke-session'],
];

function apiFixture({ session = null, setupToken = config.setupToken, expiry = new Date(Date.now() + 60_000), existing = false, hits = 1 } = {}) {
  const calls = { database: [], storage: [], signup: [], sessions: 0 };
  const db = { async query(sql, values) {
    calls.database.push({ sql, values });
    if (sql.startsWith('INSERT INTO cms.rate_limits')) return { rows: [{ hits }] };
    if (sql.startsWith('SELECT id FROM cms_auth.')) return { rows: existing ? [{ id: 'owner' }] : [] };
    throw new Error('Unexpected database access during boundary test');
  } };
  const storage = Object.fromEntries(['get', 'set', 'delete'].map(method => [method, async (...args) => { calls.storage.push({ method, args }); } ]));
  const auth = { api: {
    async getSession() { calls.sessions++; return session; },
    async signUpEmail(options) { calls.signup.push(options); return new Response(JSON.stringify({ registered: true }), { status: 200 }); },
  } };
  const handler = createHandler({ config: { ...config, setupToken, setupExpiresAt: expiry, maxPostBytes: 200 * 1024 }, auth, db, storage });
  const request = (method, route, body = {}, origin = config.origin) => handler(new Request(`${config.origin}${route}`, {
    method, headers: { 'content-type': 'application/json', ...(origin === null ? {} : { origin }) },
    ...(['GET', 'HEAD'].includes(method) ? {} : { body: JSON.stringify(body) }),
  }));
  return { request, calls };
}

test('every CMS data and image route rejects anonymous, wrong-owner and unverified sessions before data access', async () => {
  const identity = { id: 'owner', email: config.ownerEmail, twoFactorEnabled: true };
  for (const [session, status] of [
    [null, 401],
    [{ user: { ...identity, email: 'intruder@example.test' }, session: { mfaVerified: true } }, 401],
    [{ user: { ...identity, twoFactorEnabled: false }, session: { mfaVerified: false } }, 403],
    [{ user: identity, session: { mfaVerified: false } }, 403],
  ]) {
    const fixture = apiFixture({ session });
    for (const [method, route] of protectedRoutes) {
      const response = await fixture.request(method, route);
      assert.equal(response.status, status, `${method} ${route}`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal(fixture.calls.database.length, 0);
    assert.equal(fixture.calls.storage.length, 0);
    assert.equal(fixture.calls.signup.length, 0);
  }
});

test('CMS writes reject missing and hostile origins before authentication or data access', async () => {
  const fixture = apiFixture({ session: { user: { id: 'owner', email: config.ownerEmail, twoFactorEnabled: true }, session: { mfaVerified: true } } });
  for (const [method, route] of protectedRoutes.filter(([method]) => method !== 'GET')) {
    for (const origin of [null, 'https://attacker.example']) {
      assert.equal((await fixture.request(method, route, {}, origin)).status, 403, `${method} ${route}`);
    }
  }
  assert.equal(fixture.calls.sessions, 0);
  assert.equal(fixture.calls.database.length, 0);
  assert.equal(fixture.calls.storage.length, 0);
});

test('bootstrap needs a configured unexpired token and creates only the configured owner', async () => {
  for (const options of [
    {}, { setupToken: '' }, { expiry: new Date(Date.now() - 1000) }, { expiry: new Date('invalid') },
  ]) {
    const fixture = apiFixture(options);
    assert.equal((await fixture.request('POST', '/api/cms/setup', {
      token: options.setupToken === undefined && options.expiry === undefined ? 'incorrect' : config.setupToken,
      name: 'Owner', password,
    })).status, 403);
    assert.equal(fixture.calls.signup.length, 0);
  }
  const existing = apiFixture({ existing: true });
  assert.equal((await existing.request('POST', '/api/cms/setup', { token: config.setupToken, name: 'Owner', password })).status, 409);
  assert.equal(existing.calls.signup.length, 0);
  const weak = apiFixture();
  assert.equal((await weak.request('POST', '/api/cms/setup', { token: config.setupToken, name: 'Owner', password: 'short' })).status, 400);
  assert.equal(weak.calls.signup.length, 0);
  const limited = apiFixture({ hits: 6 });
  assert.equal((await limited.request('POST', '/api/cms/setup', { token: config.setupToken, name: 'Owner', password })).status, 429);
  assert.equal(limited.calls.signup.length, 0);
  const valid = apiFixture();
  assert.equal((await valid.request('POST', '/api/cms/setup', {
    token: config.setupToken, name: 'Owner', password, email: 'intruder@example.test', twoFactorEnabled: true,
  })).status, 200);
  assert.deepEqual(valid.calls.signup[0].body, { name: 'Owner', password, email: config.ownerEmail });
});

test('post mutations reject client-controlled trusted-import fields and missing revision checks', async () => {
  const fixture = apiFixture({ session: { user: { id: 'owner', email: config.ownerEmail, twoFactorEnabled: true }, session: { mfaVerified: true } } });
  const post = { slug: 'safe-post', title: 'Safe post', markdown: 'Text', tags: [], date: new Date().toISOString() };
  for (const fields of [{ legacy: true }, { sourcePath: '../../.env.local' }, { frontmatter: { unsafe: true } }]) {
    assert.equal((await fixture.request('POST', '/api/cms/posts', { ...post, ...fields })).status, 400);
    assert.equal((await fixture.request('PATCH', `/api/cms/posts/${imageId}`, { ...post, revision: 1, ...fields })).status, 400);
  }
  for (const route of [`/api/cms/posts/${imageId}/publish`, `/api/cms/posts/${imageId}/unpublish`, '/api/cms/gallery/publish']) {
    assert.equal((await fixture.request('POST', route, {})).status, 400);
  }
  assert.equal((await fixture.request('DELETE', `/api/cms/posts/${imageId}`, {})).status, 400);
  assert.equal(fixture.calls.database.every(call => call.sql.startsWith('INSERT INTO cms.rate_limits')), true);
  assert.equal(fixture.calls.storage.length, 0);
});

test('media deletion protects referenced and imported files and preserves the database record when blob deletion fails', async () => {
  for (const scenario of [
    { used: true, status: 409 }, { legacy: true, status: 409 }, { missing: true, status: 404 },
    { failDelete: true, status: 500 }, { status: 200 },
  ]) {
    const events = [];
    const client = { release() {}, async query(sql) {
      events.push(sql);
      if (sql.startsWith('SELECT * FROM cms.media')) return { rows: scenario.missing ? [] : [{ id: imageId, object_key: `cms/${imageId}.webp`, legacy_path: scenario.legacy ? 'assets/img/gallery/1.jpg' : null }] };
      if (sql.startsWith('SELECT 1 FROM cms.posts')) return { rows: scenario.used ? [{ used: true }] : [] };
      return { rows: [] };
    } };
    const auth = { api: { async getSession() { return { user: { id: 'owner', email: config.ownerEmail, twoFactorEnabled: true }, session: { mfaVerified: true } }; } } };
    const db = { async query() { return { rows: [{ hits: 1 }] }; }, async connect() { return client; } };
    const storage = { async delete(key) { events.push(`blob:${key}`); if (scenario.failDelete) throw new Error('Simulated blob deletion failure'); } };
    const handler = createHandler({ config, auth, db, storage });
    const response = await handler(new Request(`${config.origin}/api/cms/media/${imageId}`, { method: 'DELETE', headers: { origin: config.origin } }));
    assert.equal(response.status, scenario.status);
    const blobPosition = events.indexOf(`blob:cms/${imageId}.webp`);
    const deletePosition = events.findIndex(sql => sql.startsWith('DELETE FROM cms.media'));
    if (scenario.status === 200) {
      assert.equal(blobPosition >= 0 && blobPosition < deletePosition, true);
      assert.equal(events.includes('COMMIT'), true);
    } else {
      assert.equal(deletePosition, -1);
      assert.equal(events.includes('ROLLBACK'), true);
      if (!scenario.failDelete) assert.equal(blobPosition, -1);
    }
  }
});

class Browser {
  cookies = new Map();

  header() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  take(response) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0];
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (/max-age=0(?:;|$)/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  copy() {
    const browser = new Browser();
    browser.cookies = new Map(this.cookies);
    return browser;
  }

  trustOnly() {
    const browser = new Browser();
    browser.cookies = new Map([...this.cookies].filter(([name]) => name.includes('trust_device')));
    return browser;
  }
}

function protectedRequest(browser = new Browser()) {
  return new Request(`${config.origin}/api/cms/posts`, { headers: { cookie: browser.header() } });
}

async function expectDenied(auth, browser) {
  await assert.rejects(requireOwner(protectedRequest(browser), auth, config), (error) => [401, 403].includes(error.status));
}

test('published Markdown retains formatting and math while dropping executable content', async () => {
  const html = await renderMarkdown([
    '# Unicode α 日本語',
    '',
    '**Bold** and [safe link](https://example.test).',
    '',
    '$x^2 + y^2 = z^2$',
    '',
    '<script>globalThis.compromised = true</script>',
    '<img src="x" onerror="globalThis.compromised = true">',
    '[unsafe](javascript:alert%281%29)',
    '![unsafe](data:image/svg+xml;base64,PHN2Zz4=)',
    '$\\href{javascript:alert(1)}{unsafe}$',
  ].join('\n'));
  assert.match(html, /Unicode α 日本語/);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /href="https:\/\/example.test"/);
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /<script|onerror=|href="javascript:|src="data:/i);
});

function uploadFixture({ budget = 512 * 1024 * 1024, failInsert = false, failCommit = false, failSet = false } = {}) {
  const calls = { sql: [], set: [], delete: [] };
  const client = { release() {}, async query(sql, parameters) {
    calls.sql.push(sql);
    if (sql.includes('sum(size)')) return { rows: [{ bytes: 0 }] };
    if (sql.startsWith('INSERT INTO cms.media')) {
      if (failInsert) throw new Error('Simulated insert failure');
      const [id, object_key, filename, content_type, size, width, height] = parameters;
      return { rows: [{ id, object_key, filename, content_type, size, width, height }] };
    }
    if (sql === 'COMMIT' && failCommit) throw new Error('Simulated commit failure');
    return { rows: [] };
  } };
  return {
    calls,
    db: { async connect() { return client; } },
    storage: {
      async set(key, bytes) { calls.set.push({ key, bytes }); if (failSet) throw new Error('Simulated interrupted blob write'); },
      async delete(key) { calls.delete.push(key); },
    },
    config: { maxUploadBytes: 4 * 1024 * 1024, mediaBudgetBytes: budget },
  };
}

function uploadRequest(bytes, { type = 'image/jpeg', name = 'photo.jpg' } = {}) {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type }));
  return new Request(`${config.origin}/api/cms/media`, { method: 'POST', body: form });
}

function oversizedPixelPNG() {
  const chunk = (type, bytes) => {
    const name = Buffer.from(type);
    const header = Buffer.alloc(4); header.writeUInt32BE(bytes.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
    return Buffer.concat([header, name, bytes, checksum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(10_000, 0); ihdr.writeUInt32BE(10_000, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
}

test('image upload validates decoded content, converts safely, strips metadata and enforces its storage budget', async () => {
  const jpeg = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#cc7700' } })
    .withMetadata({ orientation: 6 }).withExif({ IFD0: { Artist: 'Private author metadata' } }).jpeg().toBuffer();
  const fixture = uploadFixture();
  const media = await uploadImage(uploadRequest(jpeg, { name: '../../private-photo.jpg', type: 'text/plain' }), fixture);
  assert.equal(media.filename, 'private-photo.jpg');
  assert.equal(media.width, 10);
  assert.equal(media.height, 20);
  assert.match(fixture.calls.set[0].key, /^cms\/[a-f0-9-]{36}\.webp$/);
  const converted = await sharp(fixture.calls.set[0].bytes).metadata();
  assert.equal(converted.format, 'webp');
  assert.equal(converted.exif, undefined);
  assert.equal(converted.icc, undefined);
  assert.equal(converted.xmp, undefined);
  assert.equal(fixture.calls.sql.some(sql => sql.includes('pg_advisory_xact_lock')), true);

  for (const bytes of [Buffer.from('not an image'), oversizedPixelPNG(),
    Buffer.from('<svg width="1" height="1" xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')]) {
    const rejected = uploadFixture();
    await assert.rejects(uploadImage(uploadRequest(bytes, { type: 'image/png', name: 'pretend.png' }), rejected), error => error.status === 415);
    assert.equal(rejected.calls.sql.length, 0);
    assert.equal(rejected.calls.set.length, 0);
  }
  const oversized = uploadFixture();
  await assert.rejects(uploadImage(uploadRequest(Buffer.alloc(4 * 1024 * 1024 + 1)), oversized), error => error.status === 413);
  assert.equal(oversized.calls.set.length, 0);
  const overBudget = uploadFixture({ budget: 0 });
  await assert.rejects(uploadImage(uploadRequest(jpeg), overBudget), error => error.status === 413);
  assert.equal(overBudget.calls.set.length, 0);
  assert.equal(overBudget.calls.sql.includes('ROLLBACK'), true);
  for (const failure of [{ failInsert: true }, { failCommit: true }, { failSet: true }]) {
    const failed = uploadFixture(failure);
    await assert.rejects(uploadImage(uploadRequest(jpeg), failed));
    assert.deepEqual(failed.calls.delete, [failed.calls.set[0].key]);
    assert.equal(failed.calls.sql.includes('ROLLBACK'), true);
  }
});

test('real authentication enforces MFA, revocation, recovery and trusted-browser expiration', async () => {
  const database = new DatabaseSync(':memory:');
  const auth = createAuth(config, { database });
  await (await getMigrations(auth.options)).runMigrations();
  let address = 1;
  async function call(route, browser = new Browser(), body, { method = body ? 'POST' : 'GET', ip } = {}) {
    const request = new Request(`${config.origin}/api/auth${route}`, {
      method,
      headers: {
        origin: config.origin,
        cookie: browser.header(),
        'content-type': 'application/json',
        'x-nf-client-connection-ip': ip ?? `192.0.2.${address++}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return browser.take(await handleAuth(request, auth, config));
  }
  const signIn = (browser, ip) => call('/sign-in/email', browser, { email: config.ownerEmail, password }, { ip });

  try {
    await expectDenied(auth, new Browser());
    assert.equal(authRouteAllowed('/sign-up/email', 'POST'), false);
    assert.equal(authRouteAllowed('/two-factor/disable', 'POST'), false);
    assert.equal(authRouteAllowed('/two-factor/verify-totp', 'GET'), false);
    await assert.rejects(call('/sign-up/email', new Browser(), { email: config.ownerEmail, password, name: 'Owner' }), (error) => error.status === 404);
    for (const headers of [{}, { origin: 'https://attacker.example' }, { origin: config.origin, 'sec-fetch-site': 'cross-site' }]) {
      await assert.rejects(handleAuth(new Request(`${config.origin}/api/auth/sign-in/email`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ email: config.ownerEmail, password }),
      }), auth, config), (error) => error.status === 403);
    }

    await assert.rejects(auth.api.signUpEmail({
      body: { email: 'intruder@example.test', password, name: 'Intruder' },
      headers: new Headers({ origin: config.origin }),
    }));

    const enrollment = new Browser();
    const registration = await auth.api.signUpEmail({
      body: { email: config.ownerEmail, password, name: 'Owner', mfaVerified: true, twoFactorEnabled: true },
      headers: new Headers({ origin: config.origin }),
      asResponse: true,
    });
    assert.equal(registration.status, 200);
    enrollment.take(registration);
    for (const header of registration.headers.getSetCookie()) {
      if (header.includes('session_token=')) {
        assert.match(header, /httponly/i);
        assert.match(header, /secure/i);
        assert.match(header, /samesite=strict/i);
      }
    }
    await expectDenied(auth, enrollment);
    const preEnrollment = new Browser();
    assert.equal((await signIn(preEnrollment)).status, 200);
    await expectDenied(auth, preEnrollment);
    await assert.rejects(call('/two-factor/generate-backup-codes', preEnrollment, { password }), (error) => error.status === 403);
    assert.equal((await call('/two-factor/enable', enrollment, { password, method: 'otp' })).ok, false);
    const oldEnrollmentCookie = enrollment.copy();
    const enabled = await call('/two-factor/enable', enrollment, { password, method: 'totp' });
    assert.equal(enabled.status, 200);
    const { totpURI, backupCodes } = await enabled.json();
    assert.equal(backupCodes.length > 0, true);
    const otp = createOTP(Buffer.from(base32.decode(new URL(totpURI).searchParams.get('secret'))).toString('utf8'));
    await expectDenied(auth, enrollment);

    const verified = await call('/two-factor/verify-totp', enrollment, { code: await otp.totp() });
    assert.equal(verified.status, 200);
    const verifiedOwner = await requireOwner(protectedRequest(enrollment), auth, config);
    assert.equal(verifiedOwner.user.email, config.ownerEmail);
    assert.equal(verifiedOwner.user.twoFactorEnabled, true);
    assert.equal(verifiedOwner.session.mfaVerified, true);
    assert.equal(Date.parse(verifiedOwner.session.expiresAt) - Date.now() <= 8 * 60 * 60 * 1000 + 1000, true);
    await expectDenied(auth, oldEnrollmentCookie);
    await expectDenied(auth, preEnrollment);

    const challenge = new Browser();
    const firstFactor = await signIn(challenge);
    assert.equal(firstFactor.status, 200);
    assert.equal((await firstFactor.json()).twoFactorRedirect, true);
    await expectDenied(auth, challenge);
    const invalid = await call('/two-factor/verify-totp', challenge, { code: 'invalid' });
    assert.equal(invalid.ok, false);
    await expectDenied(auth, challenge);
    const secondFactor = await call('/two-factor/verify-totp', challenge, { code: await otp.totp(), trustDevice: true });
    assert.equal(secondFactor.status, 200);
    assert.equal((await requireOwner(protectedRequest(challenge), auth, config)).session.mfaVerified, true);

    const remembered = challenge.trustOnly();
    assert.equal(remembered.cookies.size, 1);
    const rememberedSignIn = await signIn(remembered);
    assert.equal(rememberedSignIn.status, 200);
    assert.notEqual((await rememberedSignIn.json()).twoFactorRedirect, true);
    assert.equal((await requireOwner(protectedRequest(remembered), auth, config)).session.mfaVerified, true);

    const revoked = remembered.trustOnly();
    const context = await auth.$context;
    const trustRows = database.prepare('SELECT identifier FROM verification WHERE identifier LIKE ? AND value = ?').all('trust-device-%', verifiedOwner.user.id);
    assert.equal(trustRows.length > 0, true);
    for (const row of trustRows) await context.internalAdapter.deleteVerificationByIdentifier(row.identifier);
    const revokedSignIn = await signIn(revoked);
    assert.equal((await revokedSignIn.json()).twoFactorRedirect, true);
    await expectDenied(auth, revoked);

    assert.equal((await call('/two-factor/verify-totp', revoked, { code: await otp.totp(), trustDevice: true })).status, 200);
    const expired = revoked.trustOnly();
    database.prepare('UPDATE verification SET expiresAt = ? WHERE identifier LIKE ? AND value = ?').run(Date.now() - 1000, 'trust-device-%', verifiedOwner.user.id);
    const expiredSignIn = await signIn(expired);
    assert.equal((await expiredSignIn.json()).twoFactorRedirect, true);
    await expectDenied(auth, expired);

    const recovery = new Browser();
    assert.equal((await signIn(recovery)).status, 200);
    assert.equal((await call('/two-factor/verify-backup-code', recovery, { code: backupCodes[0] })).status, 200);
    assert.equal((await requireOwner(protectedRequest(recovery), auth, config)).session.mfaVerified, true);
    const replay = new Browser();
    assert.equal((await signIn(replay)).status, 200);
    assert.equal((await call('/two-factor/verify-backup-code', replay, { code: backupCodes[0] })).ok, false);
    await expectDenied(auth, replay);

    assert.equal((await call('/sign-out', recovery, {})).status, 200);
    await expectDenied(auth, recovery);

    const throttled = await Promise.all(Array.from({ length: 12 }, () => call('/sign-in/email', new Browser(), {
      email: 'unknown@example.test', password,
    }, { ip: '198.51.100.10' })));
    assert.equal(throttled.some((response) => response.status === 429), true);
  } finally {
    database.close();
  }
});
