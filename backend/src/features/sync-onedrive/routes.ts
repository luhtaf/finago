import { Hono } from 'hono';
import { count, desc, isNotNull } from 'drizzle-orm';
import { db } from '../../shared/db/client';
import { outboxEvents } from '../../shared/db/schema';
import { requireRole } from '../../shared/auth';
import { runSync } from './consumer';

export const syncRoutes = new Hono();

// GET /admin/sync/status — ringkasan outbox (jumlah per status + processedAt terakhir).
syncRoutes.get('/admin/sync/status', requireRole('admin'), async (c) => {
  const rows = await db
    .select({ status: outboxEvents.status, n: count() })
    .from(outboxEvents)
    .groupBy(outboxEvents.status);

  const counts = { pending: 0, done: 0, failed: 0 };
  for (const r of rows) {
    if (r.status in counts) counts[r.status as keyof typeof counts] = r.n;
  }

  const last = await db
    .select({ processedAt: outboxEvents.processedAt })
    .from(outboxEvents)
    .where(isNotNull(outboxEvents.processedAt))
    .orderBy(desc(outboxEvents.processedAt))
    .limit(1);

  return c.json({
    counts,
    total: counts.pending + counts.done + counts.failed,
    lastProcessedAt: last[0]?.processedAt ?? null,
  });
});

// POST /admin/sync/run — trigger runSync sekali manual (buat testing / dorong batch).
syncRoutes.post('/admin/sync/run', requireRole('admin'), async (c) => {
  const result = await runSync();
  return c.json({ ok: true, ...result });
});
