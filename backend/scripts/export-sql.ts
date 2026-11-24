/**
 * Export seluruh DB (Turso / file SQLite) → SATU file .sql (schema + data) untuk PostgreSQL atau MySQL.
 *
 *   DIALECT=pg    SRC_URL=libsql://… SRC_TOKEN=… npx tsx scripts/export-sql.ts finago-postgres.sql
 *   DIALECT=mysql SRC_URL=libsql://… SRC_TOKEN=… npx tsx scripts/export-sql.ts finago-mysql.sql
 *   (SRC_URL=file:./finago.db juga bisa)
 *
 * - Sumber cuma DIBACA. Tabel internal drizzle (__drizzle_migrations) gak ikut.
 * - Tipe dikonversi pakai pengetahuan schema.ts (SQLite gak nyimpan boolean/timestamp/json):
 *     boolean 0/1  → boolean (pg) / BOOLEAN=tinyint(1) (mysql)
 *     unix detik   → timestamptz (pg) / DATETIME UTC (mysql)
 *     teks JSON    → jsonb (pg) / JSON (mysql)
 *     enum teks    → text/VARCHAR(32) + CHECK
 *   MySQL: kolom PK/FK/index → VARCHAR(191) (TEXT gak bisa di-index), utf8mb4, InnoDB.
 * - PG: semua dalam 1 transaksi. MySQL: DDL auto-commit → FK check dimatikan selama import.
 * - Butuh PostgreSQL ≥ 12 / MySQL ≥ 8.0.16 (CHECK + default ekspresi).
 * - ⚠️ Berisi data sensitif (hash password, no. rekening). Simpan sebagai rahasia.
 */
import { writeFileSync } from 'node:fs';
import { createClient, type Row } from '@libsql/client';

const outArg = process.argv[2];
const SRC_URL = process.env.SRC_URL;
const D = (process.env.DIALECT ?? 'pg') as 'pg' | 'mysql';
if (!outArg || !SRC_URL || !['pg', 'mysql'].includes(D)) {
  console.error('Pakai: DIALECT=pg|mysql SRC_URL=… [SRC_TOKEN=…] npx tsx scripts/export-sql.ts <out.sql>');
  process.exit(2);
}
const out: string = outArg;
const src = createClient({ url: SRC_URL, ...(process.env.SRC_TOKEN ? { authToken: process.env.SRC_TOKEN } : {}) });

const BOOL = new Set(['projects.active', 'bank_accounts.is_default', 'pengajuan_item.monitored']);
const TS = new Set(['bank_accounts.verified_at', 'pengajuan.created_at', 'monitored_items.last_event_at',
  'outbox_events.created_at', 'outbox_events.processed_at', 'audit_log.at']);
const JSONC = new Set(['users.roles', 'pengajuan.rekening_list', 'monitored_items.watched_by', 'outbox_events.payload', 'audit_log.meta']);
const ENUM: Record<string, string[]> = {
  'bank_accounts.status': ['pending', 'verified', 'rejected'],
  'pengajuan.kategori': ['reimbursement', 'pengajuan_baru'],
  'pengajuan.prioritas': ['urgent', 'not_urgent'],
  'pengajuan.state': ['draft', 'submitted', 'needs_justification', 'verified', 'approved', 'returned', 'rejected', 'paid'],
  'monitored_items.category': ['vehicle', 'equipment', 'software_license', 'consumable', 'other'],
  'outbox_events.status': ['pending', 'done', 'failed'],
  'docx_files.status': ['generated', 'synced', 'failed'],
};
const ORDER = ['projects', 'users', 'bank_accounts', 'monitored_items', 'pengajuan', 'pengajuan_item', 'docx_files', 'outbox_events', 'audit_log'];
const SKIP = (t: string) => t.startsWith('sqlite_') || t.startsWith('libsql_') || t.startsWith('_cf_') || t === '__drizzle_migrations';

const q = (id: string) => (D === 'pg' ? `"${id.replace(/"/g, '""')}"` : `\`${id.replace(/`/g, '``')}\``);
// MySQL (default sql_mode) memperlakukan backslash sebagai escape → gandakan
const lit = (s: string) => `'${(D === 'mysql' ? s.replace(/\\/g, '\\\\') : s).replace(/'/g, "''")}'`;

function colType(key: string, sqliteType: string, keyed: boolean) {
  const t = sqliteType.toUpperCase();
  if (BOOL.has(key)) return D === 'pg' ? 'boolean' : 'BOOLEAN';
  if (TS.has(key)) return D === 'pg' ? 'timestamptz' : 'DATETIME';
  if (JSONC.has(key)) return D === 'pg' ? 'jsonb' : 'JSON';
  if (t.includes('INT')) return D === 'pg' ? 'bigint' : 'BIGINT';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return D === 'pg' ? 'double precision' : 'DOUBLE';
  if (D === 'pg') return 'text';
  if (ENUM[key]) return 'VARCHAR(32)';
  return keyed ? 'VARCHAR(191)' : 'TEXT';
}

function colDefault(key: string, d: string | null): string | null {
  if (d == null) return null;
  if (/unixepoch/i.test(d)) return D === 'pg' ? 'now()' : 'CURRENT_TIMESTAMP';
  if (BOOL.has(key)) return /^(1|true)$/i.test(d) ? 'true' : 'false';
  if (JSONC.has(key)) {
    const raw = d.replace(/^'(.*)'$/s, '$1').replace(/''/g, "'");
    return D === 'pg' ? `${lit(raw)}::jsonb` : `(CAST(${lit(raw)} AS JSON))`;
  }
  return d; // angka / 'teks' — literal SQLite sama di pg & mysql
}

function value(key: string, v: Row[string] | undefined): string {
  if (v === null || v === undefined) return 'NULL';
  if (BOOL.has(key)) return Number(v) ? 'true' : 'false';
  if (TS.has(key)) return D === 'pg' ? `to_timestamp(${Number(v)})` : `FROM_UNIXTIME(${Number(v)})`;
  if (JSONC.has(key)) {
    let s = String(v);
    try { JSON.parse(s); } catch { s = JSON.stringify(s); } // teks bukan JSON → simpan sebagai string JSON
    return D === 'pg' ? `${lit(s)}::jsonb` : lit(s);
  }
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (v instanceof ArrayBuffer) return D === 'pg' ? `'\\x${Buffer.from(v).toString('hex')}'::bytea` : `X'${Buffer.from(v).toString('hex')}'`;
  return lit(String(v));
}

async function main() {
  const names = (await src.execute("select name from sqlite_master where type='table'")).rows.map((r) => String(r.name)).filter((t) => !SKIP(t));
  const tables = [...ORDER.filter((t) => names.includes(t)), ...names.filter((t) => !ORDER.includes(t))];

  // kolom yang jadi kunci (PK / FK dua sisi / index) → MySQL butuh VARCHAR, bukan TEXT
  const info: Record<string, { cols: Row[]; fks: Row[]; idx: { name: string; unique: boolean; cols: string[] }[] }> = {};
  const keyed = new Set<string>();
  for (const t of tables) {
    const cols = (await src.execute(`pragma table_info("${t}")`)).rows;
    const fks = (await src.execute(`pragma foreign_key_list("${t}")`)).rows;
    const idx: { name: string; unique: boolean; cols: string[] }[] = [];
    for (const ix of (await src.execute(`pragma index_list("${t}")`)).rows) {
      if (String(ix.origin) === 'pk') continue;
      const ic = (await src.execute(`pragma index_info("${String(ix.name)}")`)).rows.sort((a, b) => Number(a.seqno) - Number(b.seqno)).map((r) => String(r.name));
      idx.push({ name: String(ix.name), unique: Number(ix.unique) === 1, cols: ic });
      ic.forEach((c) => keyed.add(`${t}.${c}`));
    }
    cols.filter((c) => Number(c.pk) > 0).forEach((c) => keyed.add(`${t}.${c.name}`));
    fks.forEach((f) => { keyed.add(`${t}.${f.from}`); keyed.add(`${f.table}.${f.to}`); });
    info[t] = { cols, fks, idx };
  }

  const counts: Record<string, number> = {};
  const P: string[] = [
    `-- FINA go — export ${D === 'pg' ? 'PostgreSQL (≥12)' : 'MySQL (≥8.0.16)'}: schema + data, ${new Date().toISOString()}`,
    D === 'pg'
      ? '-- Import: psql "<connection-url>" -v ON_ERROR_STOP=1 -f <file>.sql   (ke database KOSONG)'
      : '-- Import: mysql --default-character-set=utf8mb4 <db_kosong> < <file>.sql',
    '-- Waktu disimpan UTC. ⚠️ Berisi data sensitif (hash password, nomor rekening) — simpan sebagai rahasia.',
    '',
    ...(D === 'pg'
      ? ['BEGIN;', "SET client_encoding = 'UTF8';", "SET TIME ZONE 'UTC';"]
      : ['SET NAMES utf8mb4;', "SET time_zone = '+00:00';", 'SET FOREIGN_KEY_CHECKS = 0;']),
    '',
  ];
  const indexes: string[] = [];

  for (const t of tables) {
    const { cols, fks, idx } = info[t]!;
    const pk = cols.filter((c) => Number(c.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((c) => q(String(c.name)));
    const defs = cols.map((c) => {
      const key = `${t}.${c.name}`;
      const dflt = colDefault(key, c.dflt_value == null ? null : String(c.dflt_value));
      const chk = ENUM[key] ? ` CHECK (${q(String(c.name))} IN (${ENUM[key]!.map(lit).join(', ')}))` : '';
      return `  ${q(String(c.name))} ${colType(key, String(c.type), keyed.has(key))}${Number(c.notnull) ? ' NOT NULL' : ''}${dflt ? ` DEFAULT ${dflt}` : ''}${chk}`;
    });
    if (pk.length) defs.push(`  PRIMARY KEY (${pk.join(', ')})`);
    for (const f of fks) {
      const od = String(f.on_delete ?? 'NO ACTION').toUpperCase();
      defs.push(`  FOREIGN KEY (${q(String(f.from))}) REFERENCES ${q(String(f.table))} (${q(String(f.to))})${od !== 'NO ACTION' ? ` ON DELETE ${od}` : ''}`);
    }
    P.push(`CREATE TABLE ${q(t)} (\n${defs.join(',\n')}\n)${D === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : ''};`, '');
    for (const ix of idx) indexes.push(`CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX ${q(ix.name)} ON ${q(t)} (${ix.cols.map(q).join(', ')});`);

    const cn = cols.map((c) => String(c.name));
    const rows = (await src.execute(`select ${cn.map((c) => `"${c}"`).join(', ')} from "${t}"`)).rows;
    counts[t] = rows.length;
    for (let i = 0; i < rows.length; i += 200) {
      const vals = rows.slice(i, i + 200).map((r) => `  (${cn.map((n) => value(`${t}.${n}`, r[n])).join(', ')})`);
      P.push(`INSERT INTO ${q(t)} (${cn.map(q).join(', ')}) VALUES\n${vals.join(',\n')};`);
    }
    P.push('');
  }

  P.push('-- index', ...indexes, '', D === 'pg' ? 'COMMIT;' : 'SET FOREIGN_KEY_CHECKS = 1;', '');
  writeFileSync(out, P.join('\n'));
  console.log(`✓ ${out} (${D})`);
  console.log(`COUNTS ${JSON.stringify(counts)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
