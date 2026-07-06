import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { authRoutes } from './features/auth/routes';
import { jwtAuth } from './features/auth/middleware';
import { pengajuanRoutes } from './features/pengajuan/routes';
import { approvalRoutes } from './features/approval/routes';
import { rekeningRoutes } from './features/rekening/routes';
import { monitoredItemsRoutes } from './features/monitored-items/routes';
import { projectsRoutes } from './features/projects/routes';
import { syncRoutes } from './features/sync-onedrive/routes';
import { usersRoutes } from './features/users/routes';
import { dashboardRoutes } from './features/dashboard/routes';

// Definisi app Hono — runtime-agnostic. Node entry: index.ts. Workers entry: worker.ts.
const app = new Hono();
app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-User-Id', 'X-User-Name', 'X-User-Roles'],
}));
app.use('*', jwtAuth);

app.get('/health', (c) => c.json({ ok: true, app: 'FINA go', ts: Date.now() }));

// Tiap fitur pakai full-path di router-nya, di-mount di '/'.
app.route('/', authRoutes);
app.route('/', pengajuanRoutes);
app.route('/', approvalRoutes);
app.route('/', rekeningRoutes);
app.route('/', monitoredItemsRoutes);
app.route('/', projectsRoutes);
app.route('/', syncRoutes);
app.route('/', usersRoutes);
app.route('/', dashboardRoutes);

export default app;
