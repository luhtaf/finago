import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../shared/db/client';
import { pengajuan, pengajuanItem } from '../../shared/db/schema';
import { writeAudit } from '../../shared/audit';

/**
 * Model SEDERHANA: "dipantau" = flag boolean per baris pengajuan. Bukan entitas master,
 * bukan interval, bukan fuzzy. Verifikator toggle on/off → item masuk/keluar daftar dipantau.
 */

/** Toggle flag dipantau di 1 baris pengajuan (verifikator/admin). */
export async function setMonitored(
  pengajuanItemId: string,
  on: boolean,
  actorId?: string,
): Promise<{ ok: true; monitored: boolean }> {
  const [it] = await db.select().from(pengajuanItem).where(eq(pengajuanItem.id, pengajuanItemId)).limit(1);
  if (!it) throw new Error('item pengajuan tidak ditemukan');
  await db.update(pengajuanItem).set({ monitored: on }).where(eq(pengajuanItem.id, pengajuanItemId));
  await writeAudit({
    entity: 'pengajuan_item', entityId: pengajuanItemId,
    action: on ? 'monitor_on' : 'monitor_off', actorId,
  });
  return { ok: true, monitored: on };
}

/** Daftar semua item yang dipantau, lintas pengajuan — biar verif bisa liat. */
export async function listMonitored() {
  return db
    .select({
      itemId: pengajuanItem.id,
      item: pengajuanItem.item,
      qty: pengajuanItem.qty,
      satuan: pengajuanItem.satuan,
      pengajuanId: pengajuan.id,
      nbr: pengajuan.nbr,
      namaPengajuan: pengajuan.nama,
      tanggal: pengajuan.tanggal,
      state: pengajuan.state,
    })
    .from(pengajuanItem)
    .innerJoin(pengajuan, eq(pengajuanItem.pengajuanId, pengajuan.id))
    .where(eq(pengajuanItem.monitored, true))
    .orderBy(desc(pengajuan.createdAt));
}

/**
 * Dipakai fitur `pengajuan` saat submit (kontrak lama dipertahankan).
 * Sekarang gak auto-flag — cuma balikin item yang ditandai dipantau di pengajuan ini.
 */
export async function checkAnomaly(
  pengajuanId: string,
): Promise<{ flagged: boolean; reasons: string[]; matched: { itemId: string; item: string }[] }> {
  const items = await db
    .select()
    .from(pengajuanItem)
    .where(and(eq(pengajuanItem.pengajuanId, pengajuanId), eq(pengajuanItem.monitored, true)));
  return { flagged: false, reasons: [], matched: items.map((it) => ({ itemId: it.id, item: it.item })) };
}
