import { and, asc, desc, eq, gte, like, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../shared/db/client';
import { pengajuan, pengajuanItem, docxFiles, outboxEvents, users, bankAccounts } from '../../shared/db/schema';
import { newId } from '../../shared/util';
import { writeAudit } from '../../shared/audit';
import { checkAnomaly } from '../monitored-items/service';
import { generateDocx } from './docx';

export interface ItemInput {
  item: string;
  qty: number;
  satuan?: string | null;
  harga: number;
  remark?: string | null;
}

export interface Rekening { bankName: string; number: string; holderName: string }

export interface CreatePengajuanInput {
  tanggal: string; // ISO date YYYY-MM-DD
  kodeProyek: string;
  kategori: 'reimbursement' | 'pengajuan_baru';
  prioritas?: 'urgent' | 'not_urgent';
  nama: string;
  bankAccountId?: string | null;
  rekeningList?: Rekening[] | null;
  notaUrl?: string | null;
  items: ItemInput[];
}

export interface UpdateDraftInput {
  tanggal?: string;
  kodeProyek?: string;
  kategori?: 'reimbursement' | 'pengajuan_baru';
  prioritas?: 'urgent' | 'not_urgent';
  nama?: string;
  bankAccountId?: string | null;
  rekeningList?: Rekening[] | null;
  notaUrl?: string | null;
  items: ItemInput[];
}

export interface ListFilter {
  kategori?: 'reimbursement' | 'pengajuan_baru';
  state?: string;
  kodeProyek?: string;
  pengajuId?: string; // diisi route buat pengaju biasa → cuma miliknya
  from?: string;      // tanggal >= (YYYY-MM-DD)
  to?: string;        // tanggal <= (YYYY-MM-DD)
  q?: string;         // cari di NBR / nama pengajuan / nama pengaju
  cursor?: string;    // keyset: dari nextCursor halaman sebelumnya
  limit?: number;
}

/** Hitung subtotal per item (round) + total header. */
function priceItems(items: ItemInput[]) {
  const priced = items.map((it) => ({
    ...it,
    subtotal: Math.round(it.qty * it.harga),
  }));
  const total = priced.reduce((acc, it) => acc + it.subtotal, 0);
  return { priced, total };
}

const nbrFor = (n: number, year: string) => `BR${String(n).padStart(3, '0')}${year}`;
const inYear = (nbr: string, year: string) => nbr.startsWith('BR') && nbr.endsWith(year);

const yearOf = (tanggal: string | undefined) => (tanggal || '').slice(0, 4) || String(new Date().getFullYear());
const seqOf = (nbr: string, year: string) => Number(nbr.slice(2, nbr.length - year.length)) || 0;

/**
 * Generate NBR: nomor terbesar dalam tahun + 1, format BR<seq3><tahun> → mis. BR0012026.
 * Sequence di-reset per tahun (dari tanggal pengajuan). Delete merapatkan nomor lagi
 * (`renumberStmts`). Pakai MAX (bukan COUNT) biar gak tabrakan kalau ada celah.
 */
async function nextNbr(year: string): Promise<string> {
  const rows = await db.select({ nbr: pengajuan.nbr }).from(pengajuan).where(like(pengajuan.nbr, `BR%${year}`));
  const max = rows.filter((r) => inYear(r.nbr, year)).reduce((m, r) => Math.max(m, seqOf(r.nbr, year)), 0);
  return nbrFor(max + 1, year);
}

const isNbrConflict = (e: unknown) => /UNIQUE constraint failed: pengajuan\.nbr/i.test(String((e as Error)?.message ?? e) + String((e as { cause?: unknown })?.cause ?? ''));

/** Statement (buat db.batch) yang merapatkan NBR se-tahun sesuai urutan createdAt, kecuali `skipId`. */
async function renumberStmts(year: string, skipId?: string) {
  const rest = (await db.select({ id: pengajuan.id, nbr: pengajuan.nbr }).from(pengajuan)
    .where(like(pengajuan.nbr, `BR%${year}`)).orderBy(asc(pengajuan.createdAt)))
    .filter((r) => r.id !== skipId && inYear(r.nbr, year));
  // 2-fase (TMP → final) biar gak tabrakan unique `nbr`
  return [
    ...rest.map((r) => db.update(pengajuan).set({ nbr: `TMP-${r.id}` }).where(eq(pengajuan.id, r.id))),
    ...rest.map((r, i) => db.update(pengajuan).set({ nbr: nbrFor(i + 1, year) }).where(eq(pengajuan.id, r.id))),
  ];
}

export async function createPengajuan(input: CreatePengajuanInput, userId: string) {
  const id = newId('pgj');
  const year = yearOf(input.tanggal);
  const { priced, total } = priceItems(input.items);

  // create bersamaan bisa dapet nbr sama → unique violation → hitung ulang & coba lagi
  let nbr = '';
  for (let attempt = 0; ; attempt++) {
    nbr = await nextNbr(year);
    try { await insertNew(nbr); break; }
    catch (e) { if (!isNbrConflict(e) || attempt >= 4) throw e; }
  }

  await writeAudit({ entity: 'pengajuan', entityId: id, action: 'create', actorId: userId });
  return { id, nbr };

  async function insertNew(nbr: string) {
  await db.transaction(async (tx) => {
    await tx.insert(pengajuan).values({
      id,
      nbr,
      tanggal: input.tanggal,
      kodeProyek: input.kodeProyek,
      kategori: input.kategori,
      prioritas: input.prioritas ?? 'not_urgent',
      nama: input.nama,
      total,
      pengajuId: userId,
      bankAccountId: input.bankAccountId ?? null,
      rekeningList: input.rekeningList ?? null,
      notaUrl: input.notaUrl ?? null,
      state: 'draft',
    });
    if (priced.length) {
      await tx.insert(pengajuanItem).values(
        priced.map((it) => ({
          id: newId('pit'),
          pengajuanId: id,
          item: it.item,
          qty: it.qty,
          satuan: it.satuan ?? null,
          harga: it.harga,
          subtotal: it.subtotal,
          remark: it.remark ?? null,
        })),
      );
    }
  });
  }
}

export async function getPengajuan(id: string) {
  const header = await db.query.pengajuan.findFirst({ where: eq(pengajuan.id, id) });
  if (!header) return null;
  const items = await db
    .select()
    .from(pengajuanItem)
    .where(eq(pengajuanItem.pengajuanId, id));
  return { ...header, items };
}

/** WHERE bersama buat list + ringkasan + export (butuh LEFT JOIN users kalau pakai `q`). */
export function listConds(f: ListFilter): SQL | undefined {
  const c: SQL[] = [];
  if (f.kategori) c.push(eq(pengajuan.kategori, f.kategori));
  if (f.state) c.push(eq(pengajuan.state, f.state as never));
  if (f.kodeProyek) c.push(eq(pengajuan.kodeProyek, f.kodeProyek));
  if (f.pengajuId) c.push(eq(pengajuan.pengajuId, f.pengajuId));
  if (f.from) c.push(gte(pengajuan.tanggal, f.from));
  if (f.to) c.push(lte(pengajuan.tanggal, f.to));
  const q = f.q?.trim();
  if (q) {
    // escape wildcard LIKE biar input "%"/"_" dicari literal
    const pat = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    c.push(or(
      sql`${pengajuan.nbr} LIKE ${pat} ESCAPE '\\'`,
      sql`${pengajuan.nama} LIKE ${pat} ESCAPE '\\'`,
      sql`${users.nama} LIKE ${pat} ESCAPE '\\'`,
    )!);
  }
  return c.length ? and(...c) : undefined;
}

type Cursor = [tanggal: string, createdAt: number, id: string];
const encodeCursor = (c: Cursor) => btoa(JSON.stringify(c)).replace(/=+$/, '');
function decodeCursor(s: string): Cursor | null {
  try {
    const v = JSON.parse(atob(s));
    return Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'number' && typeof v[2] === 'string' ? (v as Cursor) : null;
  } catch { return null; }
}

/**
 * List pengajuan — KEYSET pagination (bukan OFFSET): urut (tanggal, created_at, id) DESC,
 * halaman berikut = baris "setelah" cursor terakhir. Baca ~limit baris per halaman di posisi
 * mana pun (Turso nagih per row-read) dan stabil walau ada data baru masuk.
 * Ringkasan (count + sum total) cuma dihitung di halaman pertama (tanpa cursor).
 */
export async function listPengajuan(f: ListFilter = {}) {
  const limit = Math.min(Math.max(f.limit ?? 25, 1), 100);
  const base = listConds(f);
  const cur = f.cursor ? decodeCursor(f.cursor) : null;
  const where = cur
    ? and(base, sql`(${pengajuan.tanggal}, ${pengajuan.createdAt}, ${pengajuan.id}) < (${cur[0]}, ${cur[1]}, ${cur[2]})`)
    : base;

  const rows = await db
    .select({
      id: pengajuan.id,
      nbr: pengajuan.nbr,
      nama: pengajuan.nama,
      kategori: pengajuan.kategori,
      kodeProyek: pengajuan.kodeProyek,
      total: pengajuan.total,
      state: pengajuan.state,
      tanggal: pengajuan.tanggal,
      createdAt: pengajuan.createdAt,
      pengajuId: pengajuan.pengajuId,
      pengaju: users.nama,
    })
    .from(pengajuan)
    .leftJoin(users, eq(pengajuan.pengajuId, users.id))
    .where(where)
    .orderBy(desc(pengajuan.tanggal), desc(pengajuan.createdAt), desc(pengajuan.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? encodeCursor([last.tanggal, Math.floor(new Date(last.createdAt).getTime() / 1000), last.id])
    : null;

  let summary: { count: number; total: number } | undefined;
  if (!cur) {
    const [s] = await db
      .select({ count: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${pengajuan.total}), 0)` })
      .from(pengajuan)
      .leftJoin(users, eq(pengajuan.pengajuId, users.id))
      .where(base);
    summary = { count: Number(s?.count ?? 0), total: Number(s?.total ?? 0) };
  }

  return { rows: page, nextCursor, summary };
}

/** Pengajuan yang sudah jalan (verified/approved/paid/...) gak boleh dihapus — NBR-nya sudah terbit. */
export const DELETABLE_STATES = ['draft', 'rejected'] as const;

/**
 * Hapus pengajuan + anak-anaknya, lalu rapatkan NBR di tahun yang sama.
 * Return null kalau gak ketemu. Cek izin (owner / verif-approver-admin) di route.
 */
export async function deletePengajuan(id: string, actorId?: string) {
  const header = await db.query.pengajuan.findFirst({ where: eq(pengajuan.id, id) });
  if (!header) return null;
  if (!(DELETABLE_STATES as readonly string[]).includes(header.state)) {
    // hapus = renumber NBR se-tahun → dokumen yang sudah terbit bisa berubah nomor. Tolak.
    throw new Error('Cuma pengajuan Draft atau Ditolak yang bisa dihapus. Tolak dulu kalau memang mau dihapus.');
  }
  const year = header.nbr.slice(-4);

  // ⚠️ SEMUA jadi 1 batch (atomic, 1 subrequest ke Turso). JANGAN pakai transaksi
  // interaktif statement-per-statement → di Cloudflare Workers kena limit subrequest
  // ("Too many subrequests") begitu jumlah baris besar. Renumber 2-fase (TMP → final)
  // biar gak tabrakan unique `nbr`.
  const stmts = [
    db.delete(pengajuanItem).where(eq(pengajuanItem.pengajuanId, id)),
    db.delete(docxFiles).where(eq(docxFiles.pengajuanId, id)),
    db.delete(pengajuan).where(eq(pengajuan.id, id)),
    ...(await renumberStmts(year, id)),
  ];
  await db.batch(stmts as unknown as Parameters<typeof db.batch>[0]);

  await writeAudit({ entity: 'pengajuan', entityId: id, action: 'delete', actorId, meta: { nbr: header.nbr } });
  return { id, nbr: header.nbr, pengajuId: header.pengajuId };
}

export async function getPengajuanOwner(id: string): Promise<string | null> {
  const row = await db.query.pengajuan.findFirst({ where: eq(pengajuan.id, id), columns: { pengajuId: true } });
  return row?.pengajuId ?? null;
}

export async function updateDraft(id: string, input: UpdateDraftInput) {
  const header = await db.query.pengajuan.findFirst({ where: eq(pengajuan.id, id) });
  if (!header) return null;
  if (header.state !== 'draft' && header.state !== 'returned') {
    throw new Error('hanya pengajuan state=draft atau returned yang bisa diubah');
  }

  const { priced, total } = priceItems(input.items);
  // items di-replace (id baru) → bawa flag `monitored` verifikator by nama item, biar gak ilang
  const prevMonitored = new Set(
    (await db.select({ item: pengajuanItem.item, monitored: pengajuanItem.monitored })
      .from(pengajuanItem).where(eq(pengajuanItem.pengajuanId, id)))
      .filter((r) => r.monitored).map((r) => r.item.trim().toLowerCase()),
  );

  await db.transaction(async (tx) => {
    await tx
      .update(pengajuan)
      .set({
        ...(input.tanggal !== undefined ? { tanggal: input.tanggal } : {}),
        ...(input.kodeProyek !== undefined ? { kodeProyek: input.kodeProyek } : {}),
        ...(input.kategori !== undefined ? { kategori: input.kategori } : {}),
        ...(input.prioritas !== undefined ? { prioritas: input.prioritas } : {}),
        ...(input.nama !== undefined ? { nama: input.nama } : {}),
        ...(input.bankAccountId !== undefined ? { bankAccountId: input.bankAccountId } : {}),
        ...(input.rekeningList !== undefined ? { rekeningList: input.rekeningList } : {}),
        ...(input.notaUrl !== undefined ? { notaUrl: input.notaUrl } : {}),
        // returned → balik ke draft biar masuk alur lagi
        ...(header.state === 'returned' ? { state: 'draft' as const } : {}),
        total,
      })
      .where(eq(pengajuan.id, id));

    // replace items: hapus semua lalu insert ulang
    await tx.delete(pengajuanItem).where(eq(pengajuanItem.pengajuanId, id));
    if (priced.length) {
      await tx.insert(pengajuanItem).values(
        priced.map((it) => ({
          id: newId('pit'),
          pengajuanId: id,
          item: it.item,
          qty: it.qty,
          satuan: it.satuan ?? null,
          harga: it.harga,
          subtotal: it.subtotal,
          remark: it.remark ?? null,
          monitored: prevMonitored.has(it.item.trim().toLowerCase()),
        })),
      );
    }
  });

  // tahun tanggal diganti → NBR ikut pindah ke urutan tahun baru, tahun lama dirapatkan.
  const oldYear = header.nbr.slice(-4);
  const newYear = input.tanggal ? yearOf(input.tanggal) : oldYear;
  if (newYear !== oldYear && inYear(header.nbr, oldYear)) {
    for (let attempt = 0; ; attempt++) {
      try {
        const nbr = await nextNbr(newYear);
        await db.batch([
          db.update(pengajuan).set({ nbr }).where(eq(pengajuan.id, id)),
          ...(await renumberStmts(oldYear, id)),
        ] as unknown as Parameters<typeof db.batch>[0]);
        break;
      } catch (e) { if (!isNbrConflict(e) || attempt >= 4) throw e; }
    }
  }

  await writeAudit({ entity: 'pengajuan', entityId: id, action: 'update_draft' });
  return getPengajuan(id);
}

export async function submitPengajuan(id: string) {
  const header = await db.query.pengajuan.findFirst({ where: eq(pengajuan.id, id) });
  if (!header) return null;
  if (header.state !== 'draft') {
    throw new Error('hanya pengajuan state=draft yang bisa di-submit');
  }

  // Cek anomali via fitur monitored-items (cross-feature).
  const anomaly = await checkAnomaly(id);
  const nextState: 'submitted' | 'needs_justification' = anomaly.flagged
    ? 'needs_justification'
    : 'submitted';

  // guard state di WHERE → double-click submit gak dobel outbox event / baris sheet
  const upd = await db.update(pengajuan).set({ state: nextState })
    .where(and(eq(pengajuan.id, id), eq(pengajuan.state, 'draft')));
  if (!upd.rowsAffected) throw new Error('pengajuan sudah di-submit');

  // Generate dokumen FORMULIR (stub) → R2 + baris docx_files.
  await generateDocx(id);

  // Outbox: dikonsumsi async oleh fitur sync-onedrive. Jangan ubah `type` tanpa update consumer.
  await db.insert(outboxEvents).values([
    { id: newId('obx'), type: 'sync_pengajuan', payload: { pengajuanId: id } as never },
    { id: newId('obx'), type: 'upload_docx', payload: { pengajuanId: id } as never },
  ]);

  await writeAudit({
    entity: 'pengajuan',
    entityId: id,
    action: 'submit',
    meta: { state: nextState, anomaly },
  });

  return { state: nextState, anomaly };
}

export async function justifyPengajuan(id: string, _userId: string, alasan: string) {
  const header = await db.query.pengajuan.findFirst({ where: eq(pengajuan.id, id) });
  if (!header) return null;
  if (header.state !== 'needs_justification') {
    throw new Error('hanya pengajuan needs_justification yang bisa dikasih justifikasi');
  }

  await db.update(pengajuan).set({ state: 'submitted' }).where(eq(pengajuan.id, id));

  await writeAudit({
    entity: 'pengajuan',
    entityId: id,
    action: 'justify',
    actorId: _userId,
    meta: { alasan },
  });

  return { state: 'submitted' as const };
}

export async function getDocx(pengajuanId: string) {
  // ambil baris docx terbaru untuk pengajuan ini
  const rows = await db
    .select()
    .from(docxFiles)
    .where(eq(docxFiles.pengajuanId, pengajuanId))
    .orderBy(desc(docxFiles.id));
  return rows[0] ?? null;
}

/** Parse kolom JSON-array key (notaUrl / buktiUrl). Toleran format lama (1 string). */
export function parseKeys(v: string | null | undefined): string[] {
  if (!v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [v]; }
  catch { return [v]; }
}

export const MAX_BUKTI = 20;

/**
 * Tambah bukti penggunaan dana ke pengajuan yang SUDAH jalan (submitted s/d paid).
 * Draft pakai form edit biasa (lampiran nota). Append, gak replace. Izin dicek di route.
 */
export async function addBukti(id: string, keys: string[], actorId: string) {
  const header = await db.query.pengajuan.findFirst({ where: eq(pengajuan.id, id) });
  if (!header) return null;
  if (header.state === 'draft') throw new Error('Pengajuan masih draft — lampirkan nota lewat form edit');
  const existing = parseKeys(header.buktiUrl);
  const merged = [...existing, ...keys.filter((k) => !existing.includes(k))];
  if (merged.length > MAX_BUKTI) throw new Error(`Maksimal ${MAX_BUKTI} bukti per pengajuan`);
  await db.update(pengajuan).set({ buktiUrl: JSON.stringify(merged) }).where(eq(pengajuan.id, id));
  await writeAudit({ entity: 'pengajuan', entityId: id, action: 'add_bukti', actorId, meta: { added: keys.length, state: header.state } });
  return { buktiKeys: merged };
}

/** Rekening tersimpan harus milik si pengaju (rekeningList ad-hoc tetap bebas, by design). */
export async function bankAccountOwnedBy(bankAccountId: string, userId: string): Promise<boolean> {
  const row = await db.query.bankAccounts.findFirst({ where: and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.userId, userId)), columns: { id: true } });
  return !!row;
}

/** Apakah lampiran `key` nempel di pengajuan milik `userId` (nota atau bukti). */
export async function attachmentOwnedBy(key: string, userId: string): Promise<boolean> {
  const rows = await db.select({ notaUrl: pengajuan.notaUrl, buktiUrl: pengajuan.buktiUrl })
    .from(pengajuan).where(eq(pengajuan.pengajuId, userId));
  return rows.some((r) => parseKeys(r.notaUrl).includes(key) || parseKeys(r.buktiUrl).includes(key));
}
