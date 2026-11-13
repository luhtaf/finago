import type { Context, Next } from 'hono';
import { verify } from 'hono/jwt';
import type { Role } from '../../shared/db/schema';

// ⚠️ Baca env pas dipakai (bukan module-load) — biar di Workers ke-baca secret yang benar.
// Prod (NODE_ENV=production, di-set di wrangler.toml [vars]) WAJIB punya JWT_SECRET —
// jangan fallback ke secret dev yang ada di repo (token bisa dipalsukan).
export function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET belum di-set');
  return 'dev-secret-fina-go-change-me';
}

// Baca Bearer token kalau ada → set c.get('user'). Gak nge-block (route publik tetap jalan);
// enforcement role ada di requireRole(). getUser() baca c.get('user') ini.
export async function jwtAuth(c: Context, next: Next) {
  const h = c.req.header('Authorization');
  if (h?.startsWith('Bearer ')) {
    try {
      const p = await verify(h.slice(7), jwtSecret(), 'HS256');
      c.set('user', { id: p.sub as string, nama: p.nama as string, roles: p.roles as Role[] });
    } catch { /* token invalid → biarin, requireRole yang nolak */ }
  }
  await next();
}
