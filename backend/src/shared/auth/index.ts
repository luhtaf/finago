import type { Context, Next } from 'hono';
import type { Role } from '../db/schema';

// ⚠️ STUB auth — ganti dengan session/JWT beneran nanti.
// Sementara selalu balikin demo user (punya semua role) biar fitur bisa di-test.
export interface SessionUser {
  id: string;
  nama: string;
  roles: Role[];
}

const DEMO_USER: SessionUser = {
  id: 'u_demo',
  nama: 'Adinda RN',
  roles: ['pengaju', 'verifikator', 'approver', 'admin'],
};

/**
 * Ambil user aktif. Fase "local auth": baca header X-User-* yang dikirim FE.
 * Swap ke real auth nanti = validasi JWT di sini, sisanya gak berubah.
 */
export function getUser(c: Context): SessionUser {
  const cached = c.get('user') as SessionUser | undefined;
  if (cached) return cached;
  const id = c.req.header('x-user-id');
  if (id) {
    const roles = (c.req.header('x-user-roles') ?? 'pengaju')
      .split(',').map((s) => s.trim()).filter(Boolean) as Role[];
    return { id, nama: c.req.header('x-user-name') ?? id, roles: roles.length ? roles : ['pengaju'] };
  }
  return DEMO_USER;
}

/** Middleware: butuh salah satu role. Stub-nya set demo user + cek role. */
export function requireRole(...roles: Role[]) {
  return async (c: Context, next: Next) => {
    const user = getUser(c);
    c.set('user', user);
    if (roles.length && !roles.some((r) => user.roles.includes(r))) {
      return c.json({ error: 'forbidden', need: roles }, 403);
    }
    await next();
  };
}
