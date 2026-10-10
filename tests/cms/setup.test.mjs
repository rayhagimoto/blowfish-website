import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

const script = path.resolve('scripts/cms-prepare.mjs');
test('environment preparation preserves configuration and cannot silently use production for development', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cms-setup-'));
  const source = 'DATABASE_URL=postgresql://owner:fixture@production.example.test/db\nNEON_BRANCH=production\n';
  const run = (mode) => spawnSync(process.execPath, [script, mode], { cwd: root, encoding: 'utf8' });
  try {
    await writeFile(path.join(root, '.env.local'), source);
    assert.notEqual(run('development').status, 0);
    assert.equal(await readFile(path.join(root, '.env.local'), 'utf8'), source);
    await writeFile(path.join(root, '.env.cms-development.local'), source.replace('NEON_BRANCH=production', 'NEON_BRANCH=cms-development'));
    assert.notEqual(run('development').status, 0);
    await writeFile(path.join(root, '.env.cms-development.local'), source.replace('production.example', 'development.example').replace('NEON_BRANCH=production', 'NEON_BRANCH=cms-development') + 'UNRELATED_SETTING=preserved\n');
    assert.equal(run('development').status, 0);
    const first = await readFile(path.join(root, '.env.cms-development.local'), 'utf8');
    const values = parseEnv(first);
    assert.equal(values.UNRELATED_SETTING, 'preserved');
    assert.equal(values.CMS_ORIGIN, 'http://127.0.0.1:9090');
    assert.equal(values.CMS_STORAGE, 'local');
    assert.ok(values.CMS_AUTH_SECRET.length >= 32);
    assert.ok(values.CMS_SETUP_TOKEN.length >= 32);
    const second = run('development');
    assert.equal(second.status, 0);
    assert.equal(await readFile(path.join(root, '.env.cms-development.local'), 'utf8'), first);
    assert.ok(!second.stdout.includes(values.CMS_AUTH_SECRET) && !second.stdout.includes(values.CMS_SETUP_TOKEN));
    assert.equal((await stat(path.join(root, '.env.cms-development.local'))).mode & 0o777, 0o600);
    assert.equal(run('production').status, 0);
    assert.equal(parseEnv(await readFile(path.join(root, '.env.cms-production.local'), 'utf8')).CMS_ORIGIN, 'https://rayhagimoto.space');
    assert.equal(await readFile(path.join(root, '.env.local'), 'utf8'), source);
  } finally { await rm(root, { recursive: true, force: true }); }
});
