import { eq, inArray, desc } from 'drizzle-orm';
import { db } from '../../shared/db/client';
import { pengajuan, type Pengajuan, type PengajuanState } from '../../shared/db/schema';
import { writeAudit } from '../../shared/audit';

/** Error transisi state tidak valid → di-map ke HTTP 409 oleh router. */
export class InvalidTransitionError extends Error {
  readonly code = 'invalid_transition';
  constructor(
    public readonly from: PengajuanState | undefined,
    public readonly action: string,
    public readonly allowed: PengajuanState[],
  ) {
    super(
      `Tidak bisa '${action}' dari state '${from ?? 'unknown'}'. ` +
        `State valid: ${allowed.join(', ')}.`,
    );
    this.name = 'InvalidTransitionError';
  }
}

/** Pengajuan tidak ditemukan → di-map ke HTTP 404 oleh router. */
export class NotFoundError extends Error {
  readonly code = 'not_found';
  constructor(public readonly id: string) {
    super(`Pengajuan '${id}' tidak ditemukan.`);
    this.name = 'NotFoundError';
  }
}

async function getOrThrow(id: string): Promise<Pengajuan> {
  const [row] = await db.select().from(pengajuan).where(eq(pengajuan.id, id)).limit(1);
  if (!row) throw new NotFoundError(id);
  return row;
}

/** Pindahkan ke state baru (+ kolom tambahan opsional) + tulis audit. */
async function transition(
  id: string,
  next: PengajuanState,
  action: string,
  actorId: string,
  meta: Record<string, unknown>,
  extra: Partial<typeof pengajuan.$inferInsert> = {},
): Promise<PengajuanState> {
  await db.update(pengajuan).set({ state: next, ...extra }).where(eq(pengajuan.id, id));
  await writeAudit({ entity: 'pengajuan', entityId: id, action, actorId, meta });
  return next;
}

/**
 * Verifikasi pengajuan oleh verifikator. Dari 'submitted' | 'needs_justification' → 'verified'.
 * Rekam `reviewedBy` = nama verifikator (muncul di docx kolom "Reviewed by"). TIDAK auto-approve.
 */
export async function verify(id: string, actorId: string, actorName: string): Promise<PengajuanState> {
  const allowed: PengajuanState[] = ['submitted', 'needs_justification'];
  const row = await getOrThrow(id);
  if (!allowed.includes(row.state)) {
    throw new InvalidTransitionError(row.state, 'verify', allowed);
  }
  return transition(id, 'verified', 'verify', actorId, { from: row.state }, { reviewedBy: actorName });
}

/** Approve pengajuan oleh approver. Dari 'verified' → 'approved'. Rekam `approvedBy` = nama approver. */
export async function approve(id: string, actorId: string, actorName: string): Promise<PengajuanState> {
  const allowed: PengajuanState[] = ['verified'];
  const row = await getOrThrow(id);
  if (!allowed.includes(row.state)) {
    throw new InvalidTransitionError(row.state, 'approve', allowed);
  }
  return transition(id, 'approved', 'approve', actorId, { from: row.state }, { approvedBy: actorName });
}

/** Tolak pengajuan. Dari state non-terminal → 'rejected'. */
export async function reject(
  id: string,
  actorId: string,
  alasan: string,
): Promise<PengajuanState> {
  const terminal: PengajuanState[] = ['rejected', 'paid'];
  const row = await getOrThrow(id);
  if (terminal.includes(row.state)) {
    // State terminal: tidak ada transisi keluar.
    const allowed: PengajuanState[] = [
      'draft',
      'submitted',
      'needs_justification',
      'verified',
      'approved',
      'returned',
    ];
    throw new InvalidTransitionError(row.state, 'reject', allowed);
  }
  return transition(id, 'rejected', 'reject', actorId, { from: row.state, alasan }, { prevState: row.state });
}

/**
 * Buka kembali keputusan (revisi): dari 'rejected' | 'returned' → balik ke state
 * sebelum keputusan (prevState, mis. 'verified' → approve lagi tersedia). Buat
 * kasus "keburu tolak, ternyata mau di-acc". Kalau prevState kosong → 'submitted'.
 */
export async function reopen(id: string, actorId: string): Promise<PengajuanState> {
  const allowed: PengajuanState[] = ['rejected', 'returned'];
  const row = await getOrThrow(id);
  if (!allowed.includes(row.state)) {
    throw new InvalidTransitionError(row.state, 'reopen', allowed);
  }
  const back = (row.prevState as PengajuanState) ?? 'submitted';
  return transition(id, back, 'reopen', actorId, { from: row.state, to: back }, { prevState: null });
}

/** Kembalikan untuk revisi. Dari 'submitted' | 'verified' → 'returned'. */
export async function returnForRevision(
  id: string,
  actorId: string,
  alasan: string,
): Promise<PengajuanState> {
  const allowed: PengajuanState[] = ['submitted', 'verified'];
  const row = await getOrThrow(id);
  if (!allowed.includes(row.state)) {
    throw new InvalidTransitionError(row.state, 'return', allowed);
  }
  return transition(id, 'returned', 'return', actorId, { from: row.state, alasan }, { prevState: row.state });
}

/** Tandai sudah dibayar. Dari 'approved' → 'paid'. */
export async function markPaid(id: string, actorId: string): Promise<PengajuanState> {
  const allowed: PengajuanState[] = ['approved'];
  const row = await getOrThrow(id);
  if (!allowed.includes(row.state)) {
    throw new InvalidTransitionError(row.state, 'pay', allowed);
  }
  return transition(id, 'paid', 'pay', actorId, { from: row.state });
}

/** Daftar pengajuan yang menunggu aksi approval, terbaru dulu. */
export async function listPending(): Promise<Pengajuan[]> {
  return db
    .select()
    .from(pengajuan)
    .where(inArray(pengajuan.state, ['submitted', 'verified', 'needs_justification']))
    .orderBy(desc(pengajuan.createdAt));
}
