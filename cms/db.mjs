import pg from 'pg';

export function createPool(connectionString) {
  const url = new URL(connectionString);
  // Pin verified TLS semantics across node-postgres upgrades.
  if (url.searchParams.get('sslmode') === 'require') url.searchParams.set('sslmode', 'verify-full');
  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: 3,
    idleTimeoutMillis: 15_000,
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: true,
  });
  pool.on('error', (error) => console.error('Idle CMS database connection closed:', error.code || error.name));
  return pool;
}

export async function transaction(db, callback) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const value = await callback(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
