import { eq, and, gte, lte, inArray, type SQL } from 'drizzle-orm';
import { db } from '../../shared/db/client';
import { pengajuan, pengajuanItem, users, type PengajuanState } from '../../shared/db/schema';

/** Kategori valid (mirror enum schema). */
type Kategori = 'reimbursement' | 'pengajuan_baru';

export interface StatsFilter {
  from?: string | undefined;       // tanggal >= from (YYYY-MM-DD)
  to?: string | undefined;         // tanggal <= to   (YYYY-MM-DD)
  kategori?: string | undefined;   // eq kategori
  state?: string | undefined;      // eq state
  kodeProyek?: string | undefined; // eq kode_proyek
}

interface Bucket {
  count: number;
  amount: number;
}

export interface DashboardStats {
  totalCount: number;
  totalAmount: number;
  paidAmount: number;
  pendingCount: number;
  byState: { state: PengajuanState; count: number; amount: number }[];
  byKategori: { kategori: Kategori; count: number; amount: number }[];
  byProyek: { kodeProyek: string; count: number; amount: number }[];
  byMonth: { month: string; count: number; amount: number }[];
  byPengaju: { pengaju: string; count: number; amount: number }[];
  byItem: { item: string; count: number; qty: number; amount: number }[];
  items: {
    item: string; qty: number; satuan: string | null; harga: number; subtotal: number;
    nbr: string; namaPengajuan: string; pengaju: string; kodeProyek: string; tanggal: string; state: PengajuanState;
  }[];
}

const PENDING_STATES: PengajuanState[] = ['submitted', 'needs_justification', 'verified'];

/**
 * Agregasi read-only buat dashboard. Filter apa pun yang di-set di-AND-kan.
 * State 'draft' SELALU di-exclude — cuma submitted+ yang dihitung sebagai pengajuan nyata.
 */
export async function getStats(filter: StatsFilter): Promise<DashboardStats> {
  // base: draft di-exclude di JS (lihat `real` di bawah) — biar filter.state apa pun
  // tetap gak bisa narik draft ke stats.
  const conds: SQL[] = [];

  if (filter.from) conds.push(gte(pengajuan.tanggal, filter.from));
  if (filter.to) conds.push(lte(pengajuan.tanggal, filter.to));
  if (filter.kategori) conds.push(eq(pengajuan.kategori, filter.kategori as Kategori));
  if (filter.state) conds.push(eq(pengajuan.state, filter.state as PengajuanState));
  if (filter.kodeProyek) conds.push(eq(pengajuan.kodeProyek, filter.kodeProyek));

  const rows = await db
    .select({
      id: pengajuan.id,
      nbr: pengajuan.nbr,
      nama: pengajuan.nama,
      pengajuId: pengajuan.pengajuId,
      kategori: pengajuan.kategori,
      kodeProyek: pengajuan.kodeProyek,
      total: pengajuan.total,
      state: pengajuan.state,
      tanggal: pengajuan.tanggal,
    })
    .from(pengajuan)
    .where(conds.length ? and(...conds) : undefined);

  // Exclude draft di JS (base condition) — tetap aman walau filter.state minta draft.
  const real = rows.filter((r) => r.state !== 'draft');

  let totalCount = 0;
  let totalAmount = 0;
  let paidAmount = 0;
  let pendingCount = 0;

  const stateMap = new Map<PengajuanState, Bucket>();
  const kategoriMap = new Map<Kategori, Bucket>();
  const proyekMap = new Map<string, Bucket>();
  const monthMap = new Map<string, Bucket>();
  const pengajuMap = new Map<string, Bucket>();

  // nama pengaju (id → nama) buat agregat & detail
  const userMap = new Map((await db.select({ id: users.id, nama: users.nama }).from(users)).map((u) => [u.id, u.nama]));
  const pengajuNama = (id: string): string => userMap.get(id) ?? id;

  const bump = (m: Map<string, Bucket>, key: string, amount: number): void => {
    const b = m.get(key) ?? { count: 0, amount: 0 };
    b.count += 1;
    b.amount += amount;
    m.set(key, b);
  };

  for (const r of real) {
    totalCount += 1;
    totalAmount += r.total;
    if (r.state === 'paid') paidAmount += r.total;
    if (PENDING_STATES.includes(r.state)) pendingCount += 1;

    bump(stateMap as Map<string, Bucket>, r.state, r.total);
    bump(kategoriMap as Map<string, Bucket>, r.kategori, r.total);
    bump(proyekMap, r.kodeProyek, r.total);
    bump(monthMap, r.tanggal.slice(0, 7), r.total);
    bump(pengajuMap, pengajuNama(r.pengajuId), r.total);
  }

  const byState = [...stateMap.entries()].map(([state, b]) => ({
    state: state as PengajuanState,
    count: b.count,
    amount: b.amount,
  }));

  const byKategori = [...kategoriMap.entries()].map(([kategori, b]) => ({
    kategori: kategori as Kategori,
    count: b.count,
    amount: b.amount,
  }));

  const byProyek = [...proyekMap.entries()]
    .map(([kodeProyek, b]) => ({ kodeProyek, count: b.count, amount: b.amount }))
    .sort((a, b) => b.amount - a.amount);

  const byMonth = [...monthMap.entries()]
    .map(([month, b]) => ({ month, count: b.count, amount: b.amount }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

  const byPengaju = [...pengajuMap.entries()]
    .map(([pengaju, b]) => ({ pengaju, count: b.count, amount: b.amount }))
    .sort((a, b) => b.amount - a.amount);

  // ── per item: agregat (group by nama) + detail (semua baris) — buat baris non-draft yg lolos filter ──
  const realIds = real.map((r) => r.id);
  const meta = new Map(real.map((r) => [r.id, r]));
  const itemRows = realIds.length
    ? await db.select().from(pengajuanItem).where(inArray(pengajuanItem.pengajuanId, realIds))
    : [];

  const itemAgg = new Map<string, { item: string; count: number; qty: number; amount: number }>();
  const items: DashboardStats['items'] = [];
  for (const it of itemRows) {
    const m = meta.get(it.pengajuanId);
    if (!m) continue;
    const key = it.item.trim().toLowerCase();
    const agg = itemAgg.get(key) ?? { item: it.item.trim(), count: 0, qty: 0, amount: 0 };
    agg.count += 1;
    agg.qty += it.qty;
    agg.amount += it.subtotal;
    itemAgg.set(key, agg);
    items.push({
      item: it.item, qty: it.qty, satuan: it.satuan, harga: it.harga, subtotal: it.subtotal,
      nbr: m.nbr, namaPengajuan: m.nama, pengaju: pengajuNama(m.pengajuId), kodeProyek: m.kodeProyek, tanggal: m.tanggal, state: m.state,
    });
  }
  const byItem = [...itemAgg.values()].sort((a, b) => b.amount - a.amount);
  items.sort((a, b) => (a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : 0));

  return { totalCount, totalAmount, paidAmount, pendingCount, byState, byKategori, byProyek, byMonth, byPengaju, byItem, items };
}
