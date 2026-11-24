import { asc, eq } from 'drizzle-orm';
import { db } from '../../shared/db/client';
import { pengajuan, pengajuanItem, users, projects, bankAccounts } from '../../shared/db/schema';
import { buildXlsx } from '../../shared/xlsx';
import { parseKeys, listConds } from './service';

// Export rekap pengajuan → .xlsx. Kolom sheet "Pengajuan" sengaja mirip sheet lama
// "Form responses 1" (biar Finance familiar), sheet "Detail Item" mirip "Detail Item".
export interface ExportFilter {
  kategori?: string; state?: string; kodeProyek?: string;
  from?: string; to?: string;     // tanggal pengajuan YYYY-MM-DD (inklusif)
  q?: string;                     // cari NBR / nama pengajuan / nama pengaju (sama dengan list)
  pengajuId?: string;             // diisi route kalau user cuma pengaju (lihat miliknya)
}

const STATE_LABEL: Record<string, string> = {
  draft: 'Draft', submitted: 'Menunggu verif', needs_justification: 'Perlu alasan', verified: 'Terverifikasi',
  approved: 'Disetujui', returned: 'Dikembalikan', rejected: 'Ditolak', paid: 'Cair',
};
const KAT_LABEL: Record<string, string> = { reimbursement: 'Reimbursement', pengajuan_baru: 'Pengajuan Baru' };

export async function exportPengajuanXlsx(f: ExportFilter): Promise<Uint8Array> {
  // filter SAMA PERSIS dengan list (listConds) → yang di-export = yang tampil di layar
  const where = listConds(f as never);
  const headers = await db
    .select({ p: pengajuan, pengaju: users.nama })
    .from(pengajuan)
    .leftJoin(users, eq(pengajuan.pengajuId, users.id))
    .where(where)
    .orderBy(asc(pengajuan.tanggal), asc(pengajuan.nbr));

  // item lewat JOIN dengan filter yang sama (bukan IN (...ids) → aman dari limit parameter SQLite)
  const items = await db
    .select({ it: pengajuanItem, nbr: pengajuan.nbr })
    .from(pengajuanItem)
    .innerJoin(pengajuan, eq(pengajuanItem.pengajuanId, pengajuan.id))
    .leftJoin(users, eq(pengajuan.pengajuId, users.id)) // dibutuhkan filter `q` (nama pengaju)
    .where(where)
    .orderBy(asc(pengajuan.tanggal), asc(pengajuan.nbr));

  return buildXlsx([
    {
      name: 'Pengajuan',
      columns: [
        { header: 'Tanggal', width: 12 }, { header: 'NBR', width: 13 }, { header: 'Kode Unik', width: 11 },
        { header: 'Prioritas', width: 11 }, { header: 'Nama Pengaju', width: 20 }, { header: 'Kategori', width: 15 },
        { header: 'Nama Pengajuan', width: 36 }, { header: 'Total Pengajuan', width: 16, money: true },
        { header: 'Status', width: 15 }, { header: 'Nomor Rekening', width: 44 },
        { header: 'Reviewed by', width: 18 }, { header: 'Approved by', width: 18 },
        { header: 'Jml Nota', width: 9 }, { header: 'Jml Bukti Penggunaan', width: 12 },
      ],
      rows: headers.map(({ p, pengaju }) => [
        p.tanggal, p.nbr, p.kodeProyek, p.prioritas === 'urgent' ? 'Urgent' : 'Not Urgent', pengaju ?? '-',
        KAT_LABEL[p.kategori] ?? p.kategori, p.nama, p.total, STATE_LABEL[p.state] ?? p.state,
        (p.rekeningList ?? []).map((r) => `${r.number} ${r.bankName} a.n ${r.holderName}`).join('; '),
        p.reviewedBy, p.approvedBy, parseKeys(p.notaUrl).length, parseKeys(p.buktiUrl).length,
      ]),
    },
    {
      name: 'Detail Item',
      columns: [
        { header: 'NBR', width: 13 }, { header: 'Item', width: 36 }, { header: 'Jumlah', width: 9 },
        { header: 'Satuan', width: 10 }, { header: 'Harga', width: 14, money: true },
        { header: 'Subtotal', width: 15, money: true }, { header: 'Remark', width: 28 }, { header: 'Dipantau', width: 10 },
      ],
      rows: items.map(({ it, nbr }) => [nbr, it.item, it.qty, it.satuan, it.harga, it.subtotal, it.remark, it.monitored ? 'Ya' : '']),
    },
  ]);
}

/**
 * Export 1 pengajuan → .xlsx berlayout FORMULIR (padanan Excel dari docx di docx.ts):
 * info dokumen di atas, tabel rincian, TOTAL, rekening tujuan, blok tanda tangan.
 * Return null kalau gak ketemu. Izin dicek di route.
 */
export async function exportFormulirXlsx(id: string): Promise<{ nbr: string; bytes: Uint8Array } | null> {
  const [row] = await db
    .select({ p: pengajuan, pengaju: users.nama, proyek: projects.deskripsi })
    .from(pengajuan)
    .leftJoin(users, eq(pengajuan.pengajuId, users.id))
    .leftJoin(projects, eq(pengajuan.kodeProyek, projects.kode))
    .where(eq(pengajuan.id, id))
    .limit(1);
  if (!row) return null;
  const { p } = row;
  const items = await db.select().from(pengajuanItem).where(eq(pengajuanItem.pengajuanId, id));

  // rekening: snapshot rekeningList, fallback rekening tersimpan (sama seperti docx)
  let rekening = (p.rekeningList ?? []).map((r) => `${r.number} ${r.bankName} a.n ${r.holderName}`);
  if (!rekening.length && p.bankAccountId) {
    const b = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, p.bankAccountId) });
    if (b) rekening = [`${b.number} ${b.bankName} a.n ${b.holderName}`];
  }

  const kat = KAT_LABEL[p.kategori] ?? p.kategori;
  const signed = (ok: boolean) => (ok ? 'Signed via System' : '');
  const st = p.state;
  const reviewed = st === 'verified' || st === 'approved' || st === 'paid';
  const approved = st === 'approved' || st === 'paid';

  const bytes = await buildXlsx([{
    name: p.nbr,
    columns: [
      { header: 'No', width: 6 }, { header: 'Rincian Anggaran', width: 38 }, { header: 'Kuantitas', width: 11 },
      { header: 'Sat.', width: 9 }, { header: 'Harga Satuan', width: 16, money: true },
      { header: 'Jumlah', width: 18, money: true }, { header: 'Remark', width: 26 },
    ],
    preamble: [
      [`FORMULIR ${kat.toUpperCase()}`],
      ['PT. KARTA BHUMI NUSANTARA'],
      [],
      ['No. Dokumen', `${p.nbr}/${p.kodeProyek}/${kat.replace(' ', '-')}`],
      ['Tanggal', p.tanggal],
      ['Kode Proyek', row.proyek ? `${p.kodeProyek} — ${row.proyek}` : p.kodeProyek],
      ['Nama Pengajuan', p.nama],
      ['Nama Pengaju', row.pengaju ?? '-'],
      ['Prioritas', p.prioritas === 'urgent' ? 'Urgent' : 'Not Urgent'],
      ['Status', STATE_LABEL[p.state] ?? p.state],
      [],
    ],
    rows: items.map((it, i) => [i + 1, it.item, it.qty, it.satuan, it.harga, it.subtotal, it.remark]),
    footer: [
      [null, null, null, null, 'TOTAL', p.total],
      [],
      ['Dikirim ke Rekening'],
      ...(rekening.length ? rekening.map((r, i) => [`${i + 1}.`, r]) : [[null, '-']]),
      [],
      ['', 'Prepared & Requested by', 'Reviewed by', null, 'Approved by'],
      ['', row.pengaju ?? '-', p.reviewedBy ?? '', null, p.approvedBy ?? ''],
      ['', signed(st !== 'draft'), signed(reviewed), null, signed(approved)],
    ],
  }]);
  return { nbr: p.nbr, bytes };
}
