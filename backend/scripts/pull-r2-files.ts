/**
 * Tarik file lampiran (nota + bukti) dari Cloudflare R2 → folder lokal (format sama dengan
 * mode FS r2 client: <dir>/<key>, mis. <dir>/nota/nota_xxx.jpg).
 *
 *   npx tsx scripts/pull-r2-files.ts ./finago.db ./files
 *
 * - Daftar key diambil dari kolom pengajuan.nota_url + pengajuan.bukti_url di DB target
 *   (hasil migrate-turso-to-file). Docx gak ditarik — selalu di-generate ulang saat download.
 * - Pakai `wrangler r2 object get` (wrangler v3: default remote; kalau upgrade ke v4 tambah --remote) (butuh `wrangler login` ke akun pemilik bucket).
 * - Resumable: file yang sudah ada dilewati. Jalankan ulang buat ambil sisa / delta.
 * - LIMIT=N → cuma tarik N file (gladi resik).
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@libsql/client';

const run = promisify(execFile);
const [dbArg, outArg] = process.argv.slice(2);
const BUCKET = process.env.R2_BUCKET ?? 'finago';
if (!dbArg || !outArg) { console.error('Pakai: npx tsx scripts/pull-r2-files.ts <db> <out-dir>'); process.exit(2); }
const dbPath: string = dbArg, outDir: string = outArg;

const parseKeys = (v: unknown): string[] => {
  if (!v) return [];
  try { const a = JSON.parse(String(v)); return Array.isArray(a) ? a.map(String) : [String(v)]; } catch { return [String(v)]; }
};
const SAFE = /^nota\/[A-Za-z0-9_-]+\.[a-z0-9]+$/; // pola key yang dibuat POST /uploads

async function main() {
  const db = createClient({ url: `file:${dbPath}` });
  const rows = (await db.execute('select nota_url, bukti_url from pengajuan')).rows;
  const keys = [...new Set(rows.flatMap((r) => [...parseKeys(r.nota_url), ...parseKeys(r.bukti_url)]))];
  const bad = keys.filter((k) => !SAFE.test(k));
  if (bad.length) console.log(`⚠️  ${bad.length} key format gak dikenal, dilewati: ${bad.slice(0, 5).join(', ')}`);
  const todo = keys.filter((k) => SAFE.test(k) && !(existsSync(join(outDir, k)) && statSync(join(outDir, k)).size > 0));
  const already = keys.length - bad.length - todo.length;
  if (process.env.LIMIT) todo.splice(Number(process.env.LIMIT)); // uji coba: tarik N file saja
  console.log(`key total ${keys.length} · sudah ada ${already} · ditarik ${todo.length}`);

  let done = 0; const failed: string[] = [];
  const worker = async () => {
    for (let k = todo.shift(); k; k = todo.shift()) {
      const dest = join(outDir, k);
      mkdirSync(dirname(dest), { recursive: true });
      try { await run('npx', ['wrangler', 'r2', 'object', 'get', `${BUCKET}/${k}`, '--file', dest], { timeout: 120_000 }); }
      catch (e) { failed.push(k); console.log(`   ❌ ${k}: ${String((e as Error).message).split('\n')[0]}`); }
      if (++done % 25 === 0) console.log(`   … ${done}`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(failed.length ? `selesai dengan ${failed.length} gagal — jalankan ulang buat coba lagi` : '✓ semua file tertarik');
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
