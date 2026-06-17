import { eq } from 'drizzle-orm';
import { db } from '../../shared/db/client';
import { monitoredItems, pengajuan, pengajuanItem, type MonitoredItem } from '../../shared/db/schema';
import { newId } from '../../shared/util';
import { writeAudit } from '../../shared/audit';

/** Input CRUD monitored item. `name` + `category` wajib, sisanya opsional. */
export interface MonitoredItemInput {
  name: string;
  category?: MonitoredItem['category'];
  lastEventAt?: Date | null;
  expectedIntervalDays?: number | null;
  ownerDepartment?: string | null;
  watchedBy?: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stopword token yang ga signifikan buat matching (terlalu generik). */
const STOPWORDS = new Set([
  'dan', 'atau', 'untuk', 'yang', 'dengan', 'pada', 'di', 'ke', 'dari',
  'the', 'a', 'an', 'of', 'for', 'and', 'or', 'unit', 'pcs', 'set', 'buah',
]);

/** Token signifikan dari sebuah string (lowercase, buang stopword + token pendek). */
function significantTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Apakah `name` (monitored item) cocok di dalam `haystack` (gabungan teks pengajuan).
 * Strategi dependency-free: (1) substring penuh, lalu (2) token-overlap.
 * TODO: ganti dengan fuzzy beneran (mis. trigram / Levenshtein / fuse.js) supaya
 * tahan typo ("toner hp" vs "tonner hp") — sekarang murni substring + overlap.
 */
function nameMatchesHaystack(name: string, haystack: string): boolean {
  const lname = name.toLowerCase().trim();
  if (!lname) return false;

  // 1. Substring penuh — kasus paling jelas.
  if (haystack.includes(lname)) return true;

  // 2. Token overlap — semua token signifikan dari name muncul di haystack.
  const tokens = significantTokens(lname);
  if (tokens.length === 0) return false;
  return tokens.every((t) => haystack.includes(t));
}

/**
 * Anomaly check layer 1+2 untuk sebuah pengajuan.
 * Layer 1: cocokin item pengajuan ke daftar monitored item.
 * Layer 2: kalau cocok DAN item itu baru ada event < setengah interval normal → flag
 *          (indikasi double-claim / pengajuan terlalu sering).
 *
 * ⚠️ Dipakai fitur `pengajuan` saat submit — signature jangan diubah.
 */
export async function checkAnomaly(
  pengajuanId: string,
): Promise<{ flagged: boolean; reasons: string[] }> {
  const reasons: string[] = [];

  const header = await db.query.pengajuan.findFirst({ where: eq(pengajuan.id, pengajuanId) });
  if (!header) return { flagged: false, reasons };

  const items = await db
    .select()
    .from(pengajuanItem)
    .where(eq(pengajuanItem.pengajuanId, pengajuanId));

  // Haystack = nama pengajuan + semua teks item, lowercase.
  const haystack = [header.nama, ...items.map((it) => it.item)]
    .join(' ')
    .toLowerCase();

  const monitored = await db.select().from(monitoredItems);
  const now = Date.now();

  for (const m of monitored) {
    if (!nameMatchesHaystack(m.name, haystack)) continue;
    if (!m.lastEventAt || !m.expectedIntervalDays) continue;

    const last = m.lastEventAt instanceof Date ? m.lastEventAt.getTime() : new Date(m.lastEventAt).getTime();
    const ageDays = (now - last) / DAY_MS;
    const threshold = m.expectedIntervalDays * 0.5;

    if (ageDays < threshold) {
      reasons.push(
        `${m.name} baru ada event ${Math.round(ageDays)} hari lalu (interval normal ${m.expectedIntervalDays} hari)`,
      );
    }
  }

  return { flagged: reasons.length > 0, reasons };
}

/** Semua monitored item (natural insert order). */
export async function listItems(): Promise<MonitoredItem[]> {
  return db.select().from(monitoredItems);
}

/** Buat monitored item baru. */
export async function createItem(input: MonitoredItemInput, actorId?: string): Promise<MonitoredItem> {
  const id = newId('mon');

  await db.insert(monitoredItems).values({
    id,
    name: input.name,
    category: input.category ?? 'other',
    lastEventAt: input.lastEventAt ?? null,
    expectedIntervalDays: input.expectedIntervalDays ?? null,
    ownerDepartment: input.ownerDepartment ?? null,
    watchedBy: input.watchedBy ?? [],
  });

  await writeAudit({
    entity: 'monitored_item',
    entityId: id,
    action: 'create',
    actorId,
    meta: { name: input.name, category: input.category ?? 'other' },
  });

  const created = await db.query.monitoredItems.findFirst({ where: eq(monitoredItems.id, id) });
  return created!;
}

/** Update monitored item (partial). Field yang ga dikirim dipertahankan. */
export async function updateItem(
  id: string,
  input: Partial<MonitoredItemInput>,
  actorId?: string,
): Promise<MonitoredItem> {
  const existing = await db.query.monitoredItems.findFirst({ where: eq(monitoredItems.id, id) });
  if (!existing) throw new Error('monitored item tidak ditemukan');

  await db
    .update(monitoredItems)
    .set({
      name: input.name ?? existing.name,
      category: input.category ?? existing.category,
      lastEventAt: input.lastEventAt !== undefined ? input.lastEventAt : existing.lastEventAt,
      expectedIntervalDays:
        input.expectedIntervalDays !== undefined ? input.expectedIntervalDays : existing.expectedIntervalDays,
      ownerDepartment: input.ownerDepartment !== undefined ? input.ownerDepartment : existing.ownerDepartment,
      watchedBy: input.watchedBy ?? existing.watchedBy,
    })
    .where(eq(monitoredItems.id, id));

  await writeAudit({
    entity: 'monitored_item',
    entityId: id,
    action: 'update',
    actorId,
    meta: { fields: Object.keys(input) },
  });

  const updated = await db.query.monitoredItems.findFirst({ where: eq(monitoredItems.id, id) });
  return updated!;
}
