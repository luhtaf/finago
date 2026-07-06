import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

// ⚠️ LAZY init — JANGAN bikin client di module-load. Di Cloudflare Workers, top-level code
// jalan pas deploy-validate SEBELUM env keisi → DATABASE_URL undefined → fallback 'file:' →
// web libsql client nolak ("URL_SCHEME_NOT_SUPPORTED"). Inisialisasi pas dipakai (request time).
type DB = ReturnType<typeof drizzle<typeof schema>>;
let _db: DB | null = null;

function init(): DB {
  if (_db) return _db;
  const url = process.env.DATABASE_URL ?? 'file:./local.db';
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  const client = createClient({ url, ...(authToken ? { authToken } : {}) });
  _db = drizzle(client, { schema });
  return _db;
}

// Proxy: akses `db.select`/`db.query`/dll memicu init() pas pertama kali dipakai.
export const db = new Proxy({} as DB, {
  get(_t, prop) {
    const real = init() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

export { schema };
