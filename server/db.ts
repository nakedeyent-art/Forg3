import pg from 'pg';

let pool: pg.Pool | null | undefined;

// Shared Postgres pool, enabled by DATABASE_URL. Both the document store and
// the object store use it; when absent they fall back to local files.
export function getDatabasePool(): pg.Pool | null {
  if (pool !== undefined) {
    return pool;
  }

  const connectionString = (process.env.DATABASE_URL || '').trim();

  if (!connectionString) {
    pool = null;
    return pool;
  }

  pool = new pg.Pool({
    connectionString,
    max: clampInt(process.env.DATABASE_POOL_SIZE, 5, 1, 20),
    ssl: resolveSsl(connectionString)
  });
  pool.on('error', (error) => {
    console.error('Postgres pool error:', error.message);
  });

  return pool;
}

export async function closeDatabasePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

function resolveSsl(connectionString: string) {
  const mode = (process.env.DATABASE_SSL || '').trim().toLowerCase();

  if (mode === 'disable' || mode === 'false') {
    return undefined;
  }

  if (mode === 'no-verify' || mode === 'require') {
    return { rejectUnauthorized: false };
  }

  // Default: local/plain connections stay plain, everything else uses TLS
  // without CA pinning (matches most managed Postgres providers).
  if (/localhost|127\.0\.0\.1|@db[:/]/.test(connectionString)) {
    return undefined;
  }

  return { rejectUnauthorized: false };
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(value), min), max);
}
