import { and, asc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { db } from '../../shared/db/client';
import { pengajuan, pengajuanItem, users } from '../../shared/db/schema';
import { buildXlsx } from '../../shared/xlsx';
import { parseKeys } from './service';

// Export rekap pengajuan → .xlsx. Kolom sheet "Pengajuan" sengaja mirip sheet lama
// "Form responses 1" (biar Finance familiar), sheet "Detail Item" mirip "Detail Item".
export interface ExportFilter {
  kategori?: string; state?: string; kodeProyek?: string;
  from?: string; to?: string;     // tanggal pengajuan YYYY-MM-DD (inklusif)
  pengajuId?: string;             // diisi route kalau user cuma pengaju (lihat miliknya)
}

const STATE_LABEL: Record<string, string> = {
  draft: 'Draft', submitted: 'Menunggu verif', needs_justification: 'Perlu alasan', verified: 'Terverifikasi',
  approved: 'Disetujui', returned: 'Dikembalikan', rejected: 'Ditolak', paid: 'Cair',
};
const KAT_LABEL: Record<string, string> = { reimbursement: 'Reimbursement', pengajuan_baru: 'Pengajuan Baru' };

function conds(f: ExportFilter): SQL | undefined {
  const c: SQL[] = [];
  if (f.kategori) c.push(eq(pengajuan.kategori, f.kategori as never));
  if (f.state) c.push(eq(pengajuan.state, f.state as never));
  if (f.kodeProyek) c.push(eq(pengajuan.kodeProyek, f.kodeProyek));
  if (f.from) c.push(gte(pengajuan.tanggal, f.from));
  if (f.to) c.push(lte(pengajuan.tanggal, f.to));
  if (f.pengajuId) c.push(eq(pengajuan.pengajuId, f.pengajuId));
  return c.length ? and(...c) : undefined;
}

export async function exportPengajuanXlsx(f: ExportFilter): Promise<Uint8Array> {
  const where = conds(f);
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
