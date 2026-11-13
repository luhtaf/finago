import type { Context, Next } from 'hono';
import type { Role } from '../db/schema';

// User aktif = HANYA dari JWT valid (di-set `jwtAuth` → c.get('user')).
// ⚠️ Dulu ada fallback DEMO_USER (Adinda, semua role) + header X-User-* — itu bikin
// request dengan token expired/invalid diam-diam jadi "Adinda" (pengajuan Bagus tercatat
// atas nama Adinda) dan siapa pun bisa spoof role lewat header. Sekarang dihapus:
// tanpa token valid → 401 dari `requireAuth`.
export interface SessionUser {
  id: string;
  nama: string;
  roles: Role[];
}

export class UnauthenticatedError extends Error {
  constructor() { super('unauthenticated'); this.name = 'UnauthenticatedError'; }
}

/** Ambil user aktif. Throw kalau belum login (route harus di belakang `requireAuth`). */
export function getUser(c: Context): SessionUser {
  const u = c.get('user') as SessionUser | undefined;
  if (!u) throw new UnauthenticatedError();
  return u;
}

/** Path yang boleh diakses tanpa login. */
const PUBLIC = new Set(['/health', '/auth/login']);

/** Middleware global: wajib token valid kecuali path publik / preflight. */
export async function requireAuth(c: Context, next: Next) {
  if (c.req.method === 'OPTIONS' || PUBLIC.has(c.req.path)) return next();
  if (!c.get('user')) {
    return c.json({ error: 'unauthenticated', message: 'Sesi habis, silakan login lagi' }, 401);
  }
  await next();
}

/** Middleware: butuh salah satu role. */
export function requireRole(...roles: Role[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as SessionUser | undefined;
    if (!user) return c.json({ error: 'unauthenticated', message: 'Sesi habis, silakan login lagi' }, 401);
    if (roles.length && !roles.some((r) => user.roles.includes(r))) {
      return c.json({ error: 'forbidden', need: roles }, 403);
    }
    await next();
  };
}
