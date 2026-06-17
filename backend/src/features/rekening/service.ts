import { and, eq, ne } from 'drizzle-orm';
import { db } from '../../shared/db/client';
import { bankAccounts, users, type BankAccount } from '../../shared/db/schema';
import { newId } from '../../shared/util';
import { writeAudit } from '../../shared/audit';

/** Field yang kalau diubah = ganti identitas rekening → reset ke 'pending' (anti swap-fraud). */
export interface RekeningInput {
  bankName: string;
  number: string;
  holderName: string;
  isDefault?: boolean;
  attachmentUrl?: string | null;
}

export type VerifyDecision = 'verified' | 'rejected';

/** Set isDefault=true di 1 rekening → unset semua rekening lain milik user. */
async function unsetOtherDefaults(userId: string, keepId?: string): Promise<void> {
  await db
    .update(bankAccounts)
    .set({ isDefault: false })
    .where(
      keepId
        ? and(eq(bankAccounts.userId, userId), ne(bankAccounts.id, keepId))
        : eq(bankAccounts.userId, userId),
    );
}

/** Semua rekening milik user (terbaru by default dulu secara natural insert order). */
export async function listMine(userId: string): Promise<BankAccount[]> {
  return db.select().from(bankAccounts).where(eq(bankAccounts.userId, userId));
}

/**
 * Semua rekening berstatus 'pending' (lintas user) untuk antrian verifikasi finance.
 * Di-join nama pemilik (users.nama) biar verifikator gak perlu fetch terpisah.
 */
export async function listPending(): Promise<Array<BankAccount & { userNama: string }>> {
  const rows = await db
    .select({
      account: bankAccounts,
      userNama: users.nama,
    })
    .from(bankAccounts)
    .leftJoin(users, eq(bankAccounts.userId, users.id))
    .where(eq(bankAccounts.status, 'pending'));

  return rows.map((row) => ({ ...row.account, userNama: row.userNama ?? '' }));
}

/**
 * Tambah rekening baru. Selalu mulai status 'pending' (hybrid verify).
 * Kalau isDefault=true, unset default rekening lain milik user dulu.
 */
export async function addAccount(userId: string, input: RekeningInput): Promise<BankAccount> {
  const id = newId('bank');
  const isDefault = input.isDefault ?? false;

  if (isDefault) await unsetOtherDefaults(userId);

  await db.insert(bankAccounts).values({
    id,
    userId,
    bankName: input.bankName,
    number: input.number,
    holderName: input.holderName,
    status: 'pending',
    isDefault,
    attachmentUrl: input.attachmentUrl ?? null,
  });

  await writeAudit({
    entity: 'bank_account',
    entityId: id,
    action: 'create',
    actorId: userId,
    meta: { bankName: input.bankName, isDefault },
  });

  const created = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, id) });
  return created!;
}

/**
 * Update rekening milik sendiri. Mengubah number/bankName/holderName = ganti identitas →
 * status di-reset ke 'pending' + clear verifiedBy/verifiedAt (anti swap-fraud).
 * Hanya pemilik yang boleh ubah; selain itu lempar error.
 */
export async function updateAccount(
  id: string,
  userId: string,
  input: RekeningInput,
): Promise<BankAccount> {
  const existing = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, id) });
  if (!existing) throw new Error('rekening tidak ditemukan');
  if (existing.userId !== userId) throw new Error('bukan pemilik rekening');

  const identityChanged =
    input.bankName !== existing.bankName ||
    input.number !== existing.number ||
    input.holderName !== existing.holderName;

  const isDefault = input.isDefault ?? existing.isDefault;
  if (isDefault && !existing.isDefault) await unsetOtherDefaults(userId, id);

  await db
    .update(bankAccounts)
    .set({
      bankName: input.bankName,
      number: input.number,
      holderName: input.holderName,
      isDefault,
      attachmentUrl: input.attachmentUrl ?? existing.attachmentUrl,
      // Reset verifikasi kalau identitas berubah.
      ...(identityChanged
        ? { status: 'pending' as const, verifiedBy: null, verifiedAt: null }
        : {}),
    })
    .where(eq(bankAccounts.id, id));

  await writeAudit({
    entity: 'bank_account',
    entityId: id,
    action: identityChanged ? 'update_reset_pending' : 'update',
    actorId: userId,
    meta: { identityChanged, isDefault },
  });

  const updated = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, id) });
  return updated!;
}

/**
 * Verifikator/admin memutuskan rekening: 'verified' | 'rejected'.
 * Set status + verifiedBy(actor) + verifiedAt(now). (Pengecekan role dilakukan di route.)
 */
export async function verifyAccount(
  id: string,
  actorId: string,
  decision: VerifyDecision,
): Promise<BankAccount> {
  const existing = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, id) });
  if (!existing) throw new Error('rekening tidak ditemukan');

  await db
    .update(bankAccounts)
    .set({ status: decision, verifiedBy: actorId, verifiedAt: new Date() })
    .where(eq(bankAccounts.id, id));

  await writeAudit({
    entity: 'bank_account',
    entityId: id,
    action: decision === 'verified' ? 'verify' : 'reject',
    actorId,
    meta: { decision },
  });

  const updated = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, id) });
  return updated!;
}
