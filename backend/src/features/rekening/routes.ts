import { Hono } from 'hono';
import { z } from 'zod';
import { getUser, requireRole } from '../../shared/auth';
import { addAccount, listMine, listPending, updateAccount, verifyAccount } from './service';

export const rekeningRoutes = new Hono();

const accountBody = z.object({
  bankName: z.string().min(1),
  number: z.string().min(1),
  holderName: z.string().min(1),
  isDefault: z.boolean().optional(),
  attachmentUrl: z.string().url().nullable().optional(),
});

const verifyBody = z.object({
  decision: z.enum(['verified', 'rejected']),
});

// ── rekening milik sendiri ────────────────────────────────────────────
rekeningRoutes.get('/me/bank-accounts', async (c) => {
  const user = getUser(c);
  return c.json(await listMine(user.id));
});

rekeningRoutes.post('/me/bank-accounts', async (c) => {
  const user = getUser(c);
  const parsed = accountBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

  const created = await addAccount(user.id, parsed.data);
  return c.json(created, 201);
});

rekeningRoutes.patch('/me/bank-accounts/:id', async (c) => {
  const user = getUser(c);
  const id = c.req.param('id')!;
  const parsed = accountBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

  try {
    const updated = await updateAccount(id, user.id, parsed.data);
    return c.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'gagal update';
    const status = msg.includes('bukan pemilik') ? 403 : msg.includes('tidak ditemukan') ? 404 : 400;
    return c.json({ error: msg }, status);
  }
});

// ── verifikasi (verifikator/admin) ────────────────────────────────────
rekeningRoutes.get('/bank-accounts/pending', requireRole('verifikator', 'admin'), async (c) => {
  return c.json(await listPending());
});

rekeningRoutes.post(
  '/bank-accounts/:id/verify',
  requireRole('verifikator', 'admin'),
  async (c) => {
    const user = getUser(c);
    const id = c.req.param('id')!;
    const parsed = verifyBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

    try {
      const updated = await verifyAccount(id, user.id, parsed.data.decision);
      return c.json(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'gagal verifikasi';
      return c.json({ error: msg }, msg.includes('tidak ditemukan') ? 404 : 400);
    }
  },
);
