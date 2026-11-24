/**
 * Salin SELURUH data Turso → file SQLite baru (buat pindah ke VPS).
 *
 *   SRC_URL=libsql://… SRC_TOKEN=… npx tsx scripts/migrate-turso-to-file.ts ./finago.db
 *
 * - Sumber cuma DIBACA (SELECT). Nama env sengaja SRC_* (bukan DATABASE_URL) biar gak ketuker.
 * - Target harus belum ada / kosong. Skema dibuat lewat migrasi drizzle yang sama (folder
 *   drizzle/) → __drizzle_migrations ikut benar, `drizzle-kit migrate` berikutnya aman.
 * - Semua tabel disalin apa adanya (id, nbr, timestamp tetap), lalu jumlah baris tiap tabel
 *   dicocokkan sumber vs target. Exit 1 kalau ada yang beda.
 */
import { existsSync, statSync } from 'node:fs';
import { createClient, type InValue } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

const target = process.argv[2];
const SRC_URL = process.env.SRC_URL;
const SRC_TOKEN = process.env.SRC_TOKEN;
if (!target || !SRC_URL) {
  console.error('Pakai: SRC_URL=libsql://… SRC_TOKEN=… npx tsx scripts/migrate-turso-to-file.ts <target.db>');
  process.exit(2);
}
if (existsSync(target) && statSync(target).size > 0) {
  console.error(`Target ${target} sudah ada & berisi — hapus dulu kalau memang mau ulang.`);
  process.exit(2);
}

// urutan aman FK; tabel lain (kalau ada) disalin setelahnya
const ORDER = ['projects', 'users', 'bank_accounts', 'monitored_items', 'pengajuan', 'pengajuan_item', 'docx_files', 'outbox_events', 'audit_log'];
const SKIP = (t: string) => t.startsWith('sqlite_') || t.startsWith('libsql_') || t === '__drizzle_migrations' || t.startsWith('_cf_');

const src = createClient({ url: SRC_URL, ...(SRC_TOKEN ? { authToken: SRC_TOKEN } : {}) });
const dst = createClient({ url: `file:${target}` });

async function main() {
  console.log('1) bikin skema di target lewat migrasi drizzle…');
  await migrate(drizzle(dst), { migrationsFolder: './drizzle' });

  const srcTables = (await src.execute("select name from sqlite_master where type='table'")).rows.map((r) => String(r.name)).filter((t) => !SKIP(t));
  const dstTables = new Set((await dst.execute("select name from sqlite_master where type='table'")).rows.map((r) => String(r.name)));
  const missing = srcTables.filter((t) => !dstTables.has(t));
  if (missing.length) throw new Error(`Tabel ada di sumber tapi gak ada di skema migrasi: ${missing.join(', ')}`);
  const tables = [...ORDER.filter((t) => srcTables.includes(t)), ...srcTables.filter((t) => !ORDER.includes(t))];

  console.log('2) salin data…');
  await dst.execute('PRAGMA foreign_keys = OFF');
  for (const t of tables) {
    // kolom = irisan sumber ∩ target (kolom dead di sumber yang gak ada di skema → dilewati, dilaporkan)
    const sCols = (await src.execute(`pragma table_info("${t}")`)).rows.map((r) => String(r.name));
    const dCols = new Set((await dst.execute(`pragma table_info("${t}")`)).rows.map((r) => String(r.name)));
    const cols = sCols.filter((c) => dCols.has(c));
    const dropped = sCols.filter((c) => !dCols.has(c));
    if (dropped.length) console.log(`   ⚠️  ${t}: kolom di sumber tapi gak di skema, dilewati: ${dropped.join(', ')}`);

    const rows = (await src.execute(`select ${cols.map((c) => `"${c}"`).join(',')} from "${t}"`)).rows;
    const sql = `insert into "${t}" (${cols.map((c) => `"${c}"`).join(',')}) values (${cols.map(() => '?').join(',')})`;
    for (let i = 0; i < rows.length; i += 200) {
      await dst.batch(rows.slice(i, i + 200).map((r) => ({ sql, args: cols.map((c) => r[c] as InValue) })), 'write');
    }
    console.log(`   ${t}: ${rows.length}`);
  }
  await dst.execute('PRAGMA foreign_keys = ON');

  console.log('3) verifikasi jumlah baris + integritas…');
  let ok = true;
  for (const t of tables) {
    const a = Number((await src.execute(`select count(*) n from "${t}"`)).rows[0]!.n);
    const b = Number((await dst.execute(`select count(*) n from "${t}"`)).rows[0]!.n);
    if (a !== b) { ok = false; console.log(`   ❌ ${t}: sumber ${a} ≠ target ${b}`); }
  }
  const fk = (await dst.execute('PRAGMA foreign_key_check')).rows.length;
  const integ = String((await dst.execute('PRAGMA integrity_check')).rows[0]!.integrity_check);
  console.log(`   foreign_key_check: ${fk === 0 ? 'bersih' : fk + ' pelanggaran'} · integrity_check: ${integ}`);
  if (!ok || integ !== 'ok') { console.log('GAGAL — jangan dipakai.'); process.exit(1); }
  console.log(`✓ selesai → ${target}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
