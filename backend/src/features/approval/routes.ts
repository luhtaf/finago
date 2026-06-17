import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { getUser, requireRole } from '../../shared/auth';
import {
  verify,
  approve,
  reject,
  returnForRevision,
  markPaid,
  listPending,
  InvalidTransitionError,
  NotFoundError,
} from './service';

export const approvalRoutes = new Hono();

const alasanBody = z.object({
  alasan: z.string().trim().min(1, 'Alasan wajib diisi.'),
});

/** Map error service → HTTP response. */
function mapError(c: Context, err: unknown) {
  if (err instanceof NotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof InvalidTransitionError) {
    return c.json(
      { error: err.code, message: err.message, from: err.from, allowed: err.allowed },
      409,
    );
  }
  throw err;
}

// GET /approvals/pending — antrian aksi approval.
approvalRoutes.get('/approvals/pending', async (c) => {
  const items = await listPending();
  return c.json({ items });
});

// POST /pengajuan/:id/verify — verifikator.
approvalRoutes.post('/pengajuan/:id/verify', requireRole('verifikator'), async (c) => {
  try {
    const state = await verify(c.req.param('id')!, getUser(c).id);
    return c.json({ ok: true, state });
  } catch (err) {
    return mapError(c, err);
  }
});

// POST /pengajuan/:id/approve — approver.
approvalRoutes.post('/pengajuan/:id/approve', requireRole('approver'), async (c) => {
  try {
    const state = await approve(c.req.param('id')!, getUser(c).id);
    return c.json({ ok: true, state });
  } catch (err) {
    return mapError(c, err);
  }
});

// POST /pengajuan/:id/reject — verifikator / approver. body { alasan }.
approvalRoutes.post('/pengajuan/:id/reject', requireRole('verifikator', 'approver'), async (c) => {
  const parsed = alasanBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400);
  }
  try {
    const state = await reject(c.req.param('id')!, getUser(c).id, parsed.data.alasan);
    return c.json({ ok: true, state });
  } catch (err) {
    return mapError(c, err);
  }
});

// POST /pengajuan/:id/return — verifikator / approver. body { alasan }.
approvalRoutes.post('/pengajuan/:id/return', requireRole('verifikator', 'approver'), async (c) => {
  const parsed = alasanBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400);
  }
  try {
    const state = await returnForRevision(c.req.param('id')!, getUser(c).id, parsed.data.alasan);
    return c.json({ ok: true, state });
  } catch (err) {
    return mapError(c, err);
  }
});

// POST /pengajuan/:id/pay — verifikator / admin.
approvalRoutes.post('/pengajuan/:id/pay', requireRole('verifikator', 'admin'), async (c) => {
  try {
    const state = await markPaid(c.req.param('id')!, getUser(c).id);
    return c.json({ ok: true, state });
  } catch (err) {
    return mapError(c, err);
  }
});
