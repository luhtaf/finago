import { Hono } from 'hono';
import { requireRole } from '../../shared/auth';
import { getStats } from './service';

export const dashboardRoutes = new Hono();

// Agregasi read-only buat dashboard. Filter via query params (kosong = diabaikan).
dashboardRoutes.get('/dashboard/stats', requireRole('verifikator', 'approver', 'admin'), async (c) => {
  const q = c.req.query();
  const norm = (v: string | undefined): string | undefined => (v && v.length ? v : undefined);
  const stats = await getStats({
    from: norm(q.from),
    to: norm(q.to),
    kategori: norm(q.kategori),
    state: norm(q.state),
    kodeProyek: norm(q.kodeProyek),
  });
  return c.json(stats);
});
