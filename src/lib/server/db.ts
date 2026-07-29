import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * The Postgres pool, and the rule that the cloud is optional.
 *
 * Fragment runs in three shapes and only one of them has a database. The
 * open-source and desktop builds are local-first with no server at all, and
 * the hosted build is the same client with a backend behind it. So every
 * cloud route has to answer "is there a database?" before doing anything, and
 * answer "no" without throwing. `DATABASE_URL` unset is a supported
 * configuration, not a misconfiguration.
 */

const globalForPool = globalThis as unknown as { fragmentPgPool?: Pool | null };

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Cached on globalThis because Next.js reloads modules in dev; a fresh pool
 * per reload leaks connections until Postgres refuses new ones.
 */
export function getPool(): Pool | null {
  if (!isDatabaseConfigured()) return null;
  if (globalForPool.fragmentPgPool) return globalForPool.fragmentPgPool;

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Verify the server certificate. Encryption without authentication stops
    // a passive listener and does nothing about an active one, which is the
    // threat that actually matters on the hop from a serverless function to a
    // managed database. Hosted Postgres providers (Neon, Supabase, RDS) all
    // present certificates from public CAs, so the system trust store is
    // enough; set DATABASE_SSL_INSECURE=true only for a self-hosted server
    // with a self-signed certificate.
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== "true" }
        : undefined,
  });

  // A pool that emits an unhandled 'error' takes the process down. Idle
  // clients dropped by the server are routine, not fatal.
  pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
  });

  globalForPool.fragmentPgPool = pool;
  return pool;
}

/** Throws when the cloud is not configured. Use inside routes that require it. */
export function requirePool(): Pool {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set");
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = requirePool();
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/** First row or null, for the very common lookup-one case. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run `fn` inside a transaction, rolling back on any throw.
 *
 * Sync needs this: a push writes many documents and advances the client's
 * view of the world, and a half-applied push would leave the client believing
 * it had persisted rows that are not there.
 */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = requirePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is already broken; the original error is the useful one.
    }
    throw err;
  } finally {
    client.release();
  }
}
