import { transaction } from './db.mjs';

export async function queueBuild(db, config) {
  if (!config.buildHook) return { queued: false, message: 'Publication saved. Run a website build to update the public site.' };
  const buildId = await transaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7733402)');
    const last = await client.query("SELECT id FROM cms.builds WHERE requested_at > now() - interval '60 seconds' AND status IN ('pending','queued') LIMIT 1");
    if (last.rows.length) return null;
    const result = await client.query("INSERT INTO cms.builds (status) VALUES ('pending') RETURNING id");
    return result.rows[0].id;
  });
  if (!buildId) return { queued: false, message: 'Publication saved. A website build was just requested; publish again in one minute to ensure these edits are included.' };
  try {
    const hook = new URL(config.buildHook);
    if (hook.protocol !== 'https:' || hook.hostname !== 'api.netlify.com' || !hook.pathname.startsWith('/build_hooks/')) throw new Error('Invalid build hook');
    const response = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) throw new Error('Build request failed');
    await db.query("UPDATE cms.builds SET status='queued' WHERE id=$1", [buildId]);
    return { queued: true, message: 'Website build requested. Changes appear after a successful deployment.' };
  } catch {
    await db.query("UPDATE cms.builds SET status='failed' WHERE id=$1", [buildId]);
    return { queued: false, message: 'Publication saved, but the website build could not start. Publish again to retry.' };
  }
}
