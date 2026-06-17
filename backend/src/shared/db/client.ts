import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

// Lokal: file:./local.db. Prod (Turso): DATABASE_URL + DATABASE_AUTH_TOKEN.
// Di Workers env diinject beda (bukan process.env) — sesuaikan saat deploy CF.
const url = process.env.DATABASE_URL ?? 'file:./local.db';
const authToken = process.env.DATABASE_AUTH_TOKEN;

export const sqlite = createClient({ url, ...(authToken ? { authToken } : {}) });
export const db = drizzle(sqlite, { schema });
export { schema };
