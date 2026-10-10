import { readFile, writeFile, chmod, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import path from 'node:path';

const mode = process.argv[2] || 'development';
if (!['development', 'production'].includes(mode)) throw new Error('Choose development or production.');
const filename = `.env.cms-${mode}.local`;
let source;
try { source = await readFile(filename, 'utf8'); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  if (mode === 'development') throw new Error('Pull an isolated Neon branch into .env.cms-development.local before preparing development.');
  source = await readFile('.env.local', 'utf8');
}
const current = parseEnv(source);
if (mode === 'development') {
  if (!current.NEON_BRANCH || current.NEON_BRANCH === 'production') throw new Error('Development requires an isolated Neon branch.');
  const production = parseEnv(await readFile('.env.local', 'utf8').catch((error) => { if (error.code === 'ENOENT') return ''; throw error; }));
  if (production.DATABASE_URL && new URL(production.DATABASE_URL).hostname === new URL(current.DATABASE_URL).hostname) throw new Error('Development cannot use the production database endpoint.');
}
const defaults = {
  CMS_ORIGIN: mode === 'development' ? 'http://127.0.0.1:9090' : 'https://rayhagimoto.space',
  CMS_OWNER_EMAIL: 'rayhagimoto@gmail.com', CMS_AUTH_SECRET: randomBytes(48).toString('base64url'),
  CMS_SETUP_TOKEN: randomBytes(32).toString('base64url'),
  CMS_SETUP_EXPIRES_AT: new Date(Date.now() + 24 * 3600_000).toISOString(),
  CMS_STORAGE: mode === 'development' ? 'local' : 'netlify', CMS_ENABLED: '1',
};
for (const [key, value] of Object.entries(defaults)) if (!current[key]) { source += `\n${key}=${value}`; current[key] = value; }
await writeFile(filename, source.trimEnd() + '\n', { mode: 0o600 });
await chmod(filename, 0o600);
await mkdir('.cms-local', { recursive: true, mode: 0o700 });
const link = `${current.CMS_ORIGIN}/admin/#setup=${encodeURIComponent(current.CMS_SETUP_TOKEN)}`;
await writeFile(path.join('.cms-local', `${mode}-setup.html`), `<!doctype html><meta charset="utf-8"><title>CMS setup</title><h1>Website administrator setup</h1><p>This private link expires at ${current.CMS_SETUP_EXPIRES_AT}.</p><a href="${link}">Open the admin studio and create your password</a>`, { mode: 0o600 });
console.log(`Preserved existing settings in ${filename}. Private setup link saved in .cms-local/${mode}-setup.html.`);
