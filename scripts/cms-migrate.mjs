import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PostgresDialect } from 'kysely';
import { getMigrations } from 'better-auth/db/migration';
import { createPool, transaction } from '../cms/db.mjs';
import { createAuth } from '../cms/auth.mjs';
import { getConfig } from '../cms/config.mjs';

export async function migrate(config) {
  const db = createPool(config.databaseUrl);
  const authPool = createPool(config.databaseUrl);
  try {
    await transaction(db, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(7733400)');
      await client.query('CREATE SCHEMA IF NOT EXISTS cms; CREATE TABLE IF NOT EXISTS cms.migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      const directory = fileURLToPath(new URL('../cms/migrations/', import.meta.url));
      for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
        if ((await client.query('SELECT name FROM cms.migrations WHERE name=$1', [name])).rows.length) continue;
        await client.query(await readFile(path.join(directory, name), 'utf8'));
        await client.query('INSERT INTO cms.migrations (name) VALUES ($1)', [name]);
      }
      await client.query("INSERT INTO cms.gallery (id) VALUES ('main') ON CONFLICT DO NOTHING");
    });
    const auth = createAuth(config, { database: { dialect: new PostgresDialect({ pool: authPool }), type: 'postgres', schemaName: 'cms_auth', transaction: true } });
    const migrations = await getMigrations(auth.options);
    await migrations.runMigrations();
    // Public sessions and MFA records are never exposed through the content schema.
    console.log('CMS content and authentication schemas are ready.');
  } finally { await Promise.all([db.end(), authPool.end()]); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate(getConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL }))
    .catch((error) => { console.error('CMS migration failed:', error.code || error.name); process.exitCode = 1; });
}
