import type { Context, Next } from 'hono';
import { verify } from 'hono/jwt';
import type { Role } from '../../shared/db/schema';

export const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-fina-go-change-me';

// Baca Bearer token kalau ada → set c.get('user'). Gak nge-block (route publik tetap jalan);
// enforcement role ada di requireRole(). getUser() baca c.get('user') ini.
export async function jwtAuth(c: Context, next: Next) {
  const h = c.req.header('Authorization');
  if (h?.startsWith('Bearer ')) {
    try {
      const p = await verify(h.slice(7), JWT_SECRET, 'HS256');
      c.set('user', { id: p.sub as string, nama: p.nama as string, roles: p.roles as Role[] });
    } catch { /* token invalid → biarin, requireRole yang nolak */ }
  }
  await next();
}
