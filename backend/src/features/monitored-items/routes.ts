import { Hono } from 'hono';
import { z } from 'zod';
import { getUser, requireRole } from '../../shared/auth';
import { setMonitored, listMonitored } from './service';

export const monitoredItemsRoutes = new Hono();

// Daftar item yang dipantau (lintas pengajuan) — verif/admin.
monitoredItemsRoutes.get('/monitored-items', requireRole('verifikator', 'admin'), async (c) => {
  return c.json(await listMonitored());
});

// Toggle flag dipantau di 1 baris pengajuan — verif/admin.
monitoredItemsRoutes.post('/pengajuan-items/:itemId/monitor', requireRole('verifikator', 'admin'), async (c) => {
  const parsed = z.object({ on: z.boolean() }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  try {
    return c.json(await setMonitored(c.req.param('itemId')!, parsed.data.on, getUser(c).id));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 404);
  }
});
