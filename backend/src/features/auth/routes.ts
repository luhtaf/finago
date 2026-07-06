import { Hono } from 'hono';
import { z } from 'zod';
import { sign } from 'hono/jwt';
import { eq } from 'drizzle-orm';
import { db } from '../../shared/db/client';
import { users } from '../../shared/db/schema';
import { getUser } from '../../shared/auth';
import { verifyPassword } from './password';
import { jwtSecret } from './middleware';

export const authRoutes = new Hono();

const loginBody = z.object({ email: z.string().min(1), password: z.string().min(1) });

// POST /auth/login → { token, user }
authRoutes.post('/auth/login', async (c) => {
  const parsed = loginBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);

  const u = await db.query.users.findFirst({ where: eq(users.email, parsed.data.email.toLowerCase().trim()) });
  if (!u || !(await verifyPassword(parsed.data.password, u.passwordHash))) {
    return c.json({ error: 'Email atau password salah' }, 401);
  }
  const token = await sign(
    { sub: u.id, nama: u.nama, roles: u.roles, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 },
    jwtSecret(),
  );
  return c.json({ token, user: { id: u.id, nama: u.nama, roles: u.roles, email: u.email, department: u.department } });
});

// GET /auth/me → user dari token
authRoutes.get('/auth/me', async (c) => c.json(getUser(c)));
