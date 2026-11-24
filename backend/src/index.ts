import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import app from './app';
import { startCron } from './features/sync-onedrive/consumer';

// Entry Node (dev / Docker / VPS). Workers pakai worker.ts.
//
// STATIC_DIR (opsional, path RELATIF ke cwd, mis. "public") → server ini sekalian melayani FE
// (folder app/) di domain yang sama dengan API. File statis dilayani DULUAN, di luar `app`,
// karena `app` punya requireAuth global (file FE gak boleh kena 401). Kalau file gak ada →
// diteruskan ke API. Aman karena FE pakai hash-routing (cuma file statis, gak ada path SPA)
// dan nama file FE (index.html, main.js, lib/, features/, icon.svg, manifest) gak bentrok
// dengan route API.
const port = Number(process.env.PORT ?? 8787);
const staticDir = process.env.STATIC_DIR;

let handler: (req: Request) => Response | Promise<Response> = (req) => app.fetch(req);
if (staticDir) {
  const root = new Hono();
  root.use('*', serveStatic({
    root: staticDir,
    onFound: (path, c) => {
      // index.html & modul JS jangan di-cache lama → deploy baru langsung kebaca
      c.header('Cache-Control', /\.(html|js|webmanifest)$/.test(path) ? 'no-cache' : 'public, max-age=86400');
    },
  }));
  root.all('*', (c) => app.fetch(c.req.raw));
  handler = (req) => root.fetch(req);
}

serve({ fetch: handler, port });
console.log(`FINA go → http://localhost:${port}${staticDir ? ` (FE dari ${staticDir}/)` : ' (API only)'}`);

if (process.env.SYNC_CRON === 'on') {
  startCron();
  console.log('Sync OneDrive cron: ON (tiap 5 menit)');
}
