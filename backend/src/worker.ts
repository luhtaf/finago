import app from './app';
import { useR2Binding } from './shared/r2/client';
import { runSync } from './features/sync-onedrive/consumer';

// Entry Cloudflare Workers. R2 dipakai lewat binding `env.BUCKET` (di-set per request).
// DB/secret (DATABASE_URL, JWT_SECRET, dll) dibaca dari process.env — Cloudflare populate
// dari vars + secrets pas `nodejs_compat` aktif (lihat wrangler.toml).
interface Env {
  BUCKET?: unknown;
  [k: string]: unknown;
}
interface Ctx { waitUntil(p: Promise<unknown>): void }

// Salin secret/vars dari binding `env` ke process.env, supaya kode yang baca process.env
// (db client, JWT, Graph) dapet nilai yang bener — gak gantung ke auto-populate nodejs_compat.
function bridgeEnv(env: Env): void {
  if (typeof process === 'undefined' || !process.env) return;
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') process.env[k] = v;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    bridgeEnv(env);
    if (env.BUCKET) useR2Binding(env.BUCKET);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return app.fetch(request, env as Record<string, unknown>, ctx as any);
  },
  // Cron Trigger (wrangler.toml [triggers]) → sync outbox → OneDrive.
  async scheduled(_event: unknown, env: Env, ctx: Ctx): Promise<void> {
    bridgeEnv(env);
    if (env.BUCKET) useR2Binding(env.BUCKET);
    ctx.waitUntil(runSync());
  },
};
