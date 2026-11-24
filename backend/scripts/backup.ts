/**
 * Backup harian di VPS: snapshot SQLite yang konsisten (VACUUM INTO — aman walau app jalan)
 * + arsip folder lampiran. Simpan N hari terakhir.
 *
 * Di dalam container (dipanggil cron host, lihat DEPLOY-HOSTINGER.md):
 *   npx tsx scripts/backup.ts /data/backups
 * Env: KEEP_DAYS (default 14). Sumber: DATABASE_URL (file:…) + R2_DIR.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';

const outDir = process.argv[2] ?? '/data/backups';
const keepDays = Number(process.env.KEEP_DAYS ?? 14);
const dbUrl = process.env.DATABASE_URL ?? '';
const filesDir = process.env.R2_DIR ?? '/data/files';
if (!dbUrl.startsWith('file:')) { console.error('backup.ts cuma buat DB file: (VPS). DATABASE_URL=' + dbUrl); process.exit(2); }

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
mkdirSync(outDir, { recursive: true });

async function main() {
  const dbOut = join(outDir, `finago-${stamp}.db`);
  await createClient({ url: dbUrl }).execute(`VACUUM INTO '${dbOut.replace(/'/g, "''")}'`);
  const filesOut = join(outDir, `files-${stamp}.tar.gz`);
  execFileSync('tar', ['-czf', filesOut, '-C', filesDir, '.']);

  const cutoff = Date.now() - keepDays * 86_400_000;
  for (const f of readdirSync(outDir)) {
    const p = join(outDir, f);
    if (/^(finago-.*\.db|files-.*\.tar\.gz)$/.test(f) && statSync(p).mtimeMs < cutoff) rmSync(p);
  }
  const mb = (p: string) => (statSync(p).size / 1e6).toFixed(1) + ' MB';
  console.log(`✓ backup ${stamp}: db ${mb(dbOut)}, files ${mb(filesOut)} (simpan ${keepDays} hari)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
