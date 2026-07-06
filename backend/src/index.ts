import { serve } from '@hono/node-server';
import app from './app';
import { startCron } from './features/sync-onedrive/consumer';

// Entry Node (dev/Docker/Render). Workers pakai worker.ts.
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`FINA go API → http://localhost:${port}`);

if (process.env.SYNC_CRON === 'on') {
  startCron();
  console.log('Sync OneDrive cron: ON (tiap 5 menit)');
}
