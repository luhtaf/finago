import { Hono } from 'hono';
import { z } from 'zod';
import { getUser, requireRole } from '../../shared/auth';
import { createUser, listUsers, updateUser } from './service';

export const usersRoutes = new Hono();

const roleEnum = z.enum(['pengaju', 'verifikator', 'approver', 'admin']);

const createBody = z.object({
  nama: z.string().min(1),
  email: z.string().min(3),
  password: z.string().min(4),
  roles: z.array(roleEnum).min(1),
  department: z.string().nullish(),
});

const updateBody = z.object({
  nama: z.string().min(1).optional(),
  department: z.string().nullish(),
  roles: z.array(roleEnum).min(1).optional(),
  password: z.string().optional(),
});

// Semua endpoint kelola user khusus admin/approver.
usersRoutes.get('/users', requireRole('admin', 'approver'), async (c) => {
  return c.json(await listUsers());
});

usersRoutes.post('/users', requireRole('admin', 'approver'), async (c) => {
  const actor = getUser(c);
  const parsed = createBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

  try {
    const created = await createUser(parsed.data, actor.id);
    return c.json(created, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/unique|sudah|email/i.test(msg)) return c.json({ error: 'email sudah dipakai' }, 409);
    throw err;
  }
});

usersRoutes.patch('/users/:id', requireRole('admin', 'approver'), async (c) => {
  const actor = getUser(c);
  const id = c.req.param('id')!;
  const parsed = updateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

  try {
    const updated = await updateUser(id, parsed.data, actor.id);
    return c.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'gagal update';
    return c.json({ error: msg }, msg.includes('tidak ditemukan') ? 404 : 400);
  }
});
