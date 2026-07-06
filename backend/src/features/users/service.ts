import { eq } from 'drizzle-orm';
import { db } from '../../shared/db/client';
import { users, type Role } from '../../shared/db/schema';
import { newId } from '../../shared/util';
import { writeAudit } from '../../shared/audit';
import { hashPassword } from '../auth/password';

/** User tanpa passwordHash — bentuk aman untuk dikembalikan ke client. */
export interface SafeUser {
  id: string;
  nama: string;
  email: string;
  roles: Role[];
  department: string | null;
}

export interface CreateUserInput {
  nama: string;
  email: string;
  password: string;
  roles: Role[];
  department?: string | null;
}

export interface UpdateUserInput {
  nama?: string;
  department?: string | null;
  roles?: Role[];
  password?: string;
}

const SAFE_COLUMNS = {
  id: users.id,
  nama: users.nama,
  email: users.email,
  roles: users.roles,
  department: users.department,
} as const;

/** Semua user, tanpa passwordHash. */
export async function listUsers(): Promise<SafeUser[]> {
  return db.select(SAFE_COLUMNS).from(users);
}

/**
 * Bikin user baru. Email di-lowercase + trim, password di-hash (scrypt).
 * Error unique-email dibiarkan throw (di-handle di route → 409).
 */
export async function createUser(input: CreateUserInput, actorId?: string): Promise<SafeUser> {
  const id = newId('u');
  const email = input.email.toLowerCase().trim();

  await db.insert(users).values({
    id,
    nama: input.nama,
    email,
    passwordHash: await hashPassword(input.password),
    roles: input.roles,
    department: input.department ?? null,
  });

  await writeAudit({
    entity: 'user',
    entityId: id,
    action: 'create',
    actorId: actorId ?? id,
    meta: { email, roles: input.roles },
  });

  const created = await db.select(SAFE_COLUMNS).from(users).where(eq(users.id, id));
  return created[0]!;
}

/**
 * Update field yang dikirim saja. Kalau password ada + non-empty → re-hash.
 * Lempar error kalau user gak ketemu.
 */
export async function updateUser(
  id: string,
  input: UpdateUserInput,
  actorId?: string,
): Promise<SafeUser> {
  const existing = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!existing) throw new Error('user tidak ditemukan');

  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.nama !== undefined) patch.nama = input.nama;
  if (input.department !== undefined) patch.department = input.department;
  if (input.roles !== undefined) patch.roles = input.roles;
  if (input.password) patch.passwordHash = await hashPassword(input.password);

  if (Object.keys(patch).length) {
    await db.update(users).set(patch).where(eq(users.id, id));
  }

  await writeAudit({
    entity: 'user',
    entityId: id,
    action: 'update',
    actorId: actorId ?? id,
    meta: { fields: Object.keys(patch), passwordChanged: !!input.password },
  });

  const updated = await db.select(SAFE_COLUMNS).from(users).where(eq(users.id, id));
  return updated[0]!;
}
