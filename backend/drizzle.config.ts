import { defineConfig } from 'drizzle-kit';

// libSQL/Turso. Lokal: file:./local.db. Prod: set DATABASE_URL + DATABASE_AUTH_TOKEN (Turso).
// Pindah ke Postgres nanti = ganti dialect 'postgresql' + rewrite definisi tabel di schema.ts.
export default defineConfig({
  dialect: 'turso',
  schema: './src/shared/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:./local.db',
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
});
