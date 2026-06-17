import { Hono } from 'hono';
import { z } from 'zod';
import { getUser, requireRole } from '../../shared/auth';
import { checkAnomaly, createItem, listItems, updateItem } from './service';

export const monitoredItemsRoutes = new Hono();

const categoryEnum = z.enum(['vehicle', 'equipment', 'software_license', 'consumable', 'other']);

// lastEventAt diterima sebagai ISO string / epoch → di-coerce ke Date.
const dateField = z.coerce.date().nullable().optional();

const createBody = z.object({
  name: z.string().min(1),
  category: categoryEnum.optional(),
  lastEventAt: dateField,
  expectedIntervalDays: z.number().int().positive().nullable().optional(),
  ownerDepartment: z.string().nullable().optional(),
  watchedBy: z.array(z.string()).optional(),
});

// PATCH: semua field opsional (partial update).
const updateBody = createBody.partial();

// ── daftar monitored item (login) ─────────────────────────────────────
monitoredItemsRoutes.get('/monitored-items', async (c) => {
  return c.json(await listItems());
});

// ── buat monitored item (admin/verifikator) ───────────────────────────
monitoredItemsRoutes.post('/monitored-items', requireRole('admin', 'verifikator'), async (c) => {
  const user = getUser(c);
  const parsed = createBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

  const created = await createItem(parsed.data, user.id);
  return c.json(created, 201);
});

// ── update monitored item (admin/verifikator) ─────────────────────────
monitoredItemsRoutes.patch('/monitored-items/:id', requireRole('admin', 'verifikator'), async (c) => {
  const user = getUser(c);
  const id = c.req.param('id')!;
  const parsed = updateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

  try {
    const updated = await updateItem(id, parsed.data, user.id);
    return c.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'gagal update';
    return c.json({ error: msg }, msg.includes('tidak ditemukan') ? 404 : 400);
  }
});

// ── anomaly check untuk 1 pengajuan (login) ───────────────────────────
monitoredItemsRoutes.get('/pengajuan/:id/anomaly', async (c) => {
  const id = c.req.param('id')!;
  return c.json(await checkAnomaly(id));
});
