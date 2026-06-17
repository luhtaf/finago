import { Hono } from 'hono';
import { z } from 'zod';
import { requireRole } from '../../shared/auth';
import { createProject, listProjects, setActive } from './service';

export const projectsRoutes = new Hono();

const createBody = z.object({
  kode: z.string().min(1),
  deskripsi: z.string().min(1),
});

const activeBody = z.object({
  active: z.boolean(),
});

// ── daftar proyek ─────────────────────────────────────────────────────
// ?includeInactive=1 → ikut yang non-aktif juga.
projectsRoutes.get('/projects', async (c) => {
  const includeInactive = ['1', 'true'].includes(c.req.query('includeInactive') ?? '');
  return c.json(await listProjects({ includeInactive }));
});

// ── bikin master proyek (admin) ───────────────────────────────────────
projectsRoutes.post('/projects', requireRole('admin'), async (c) => {
  const parsed = createBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

  try {
    const created = await createProject(parsed.data);
    return c.json(created, 201);
  } catch (err) {
    // kode bentrok (PK) atau error DB lain.
    const msg = err instanceof Error ? err.message : 'gagal bikin proyek';
    return c.json({ error: msg }, 409);
  }
});

// ── aktif / non-aktifkan proyek (admin) ───────────────────────────────
projectsRoutes.patch('/projects/:kode', requireRole('admin'), async (c) => {
  const kode = c.req.param('kode')!;
  const parsed = activeBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

  try {
    const updated = await setActive(kode, parsed.data.active);
    return c.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'gagal update proyek';
    return c.json({ error: msg }, msg.includes('tidak ditemukan') ? 404 : 400);
  }
});
