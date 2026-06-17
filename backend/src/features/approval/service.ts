import { eq, inArray, desc } from 'drizzle-orm';
import { db } from '../../shared/db/client';
import { pengajuan, type Pengajuan, type PengajuanState } from '../../shared/db/schema';
import { writeAudit } from '../../shared/audit';

// ⚙️ Ambang nominal untuk auto-approve saat verifikasi.
// Kalau total <= ambang → verifikator cukup, langsung 'approved'.
// Kalau di atas → masih butuh approver ('verified').
// TODO: pindahkan ke config/DB (mis. tabel app_config) biar bisa diatur tanpa deploy.
export const APPROVAL_THRESHOLD = 1_000_000;

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

/** Pindahkan ke state baru (hanya kolom state) + tulis audit. */
async function transition(
  id: string,
  next: PengajuanState,
  action: string,
  actorId: string,
  meta: Record<string, unknown>,
): Promise<PengajuanState> {
  await db.update(pengajuan).set({ state: next }).where(eq(pengajuan.id, id));
  await writeAudit({ entity: 'pengajuan', entityId: id, action, actorId, meta });
  return next;
}

/**
 * Verifikasi pengajuan oleh verifikator.
 * Dari 'submitted' | 'needs_justification' →
 *   - total <= APPROVAL_THRESHOLD : langsung 'approved' (verifikator cukup)
 *   - total >  APPROVAL_THRESHOLD : 'verified' (masih butuh approver)
 */
export async function verify(id: string, actorId: string): Promise<PengajuanState> {
  const allowed: PengajuanState[] = ['submitted', 'needs_justification'];
  const row = await getOrThrow(id);
  if (!allowed.includes(row.state)) {
    throw new InvalidTransitionError(row.state, 'verify', allowed);
  }
  const autoApprove = row.total <= APPROVAL_THRESHOLD;
  const next: PengajuanState = autoApprove ? 'approved' : 'verified';
  return transition(id, next, 'verify', actorId, {
    from: row.state,
    total: row.total,
    threshold: APPROVAL_THRESHOLD,
    autoApprove,
  });
}

/** Approve pengajuan oleh approver. Dari 'verified' → 'approved'. */
export async function approve(id: string, actorId: string): Promise<PengajuanState> {
  const allowed: PengajuanState[] = ['verified'];
  const row = await getOrThrow(id);
  if (!allowed.includes(row.state)) {
    throw new InvalidTransitionError(row.state, 'approve', allowed);
  }
  return transition(id, 'approved', 'approve', actorId, { from: row.state });
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
  return transition(id, 'rejected', 'reject', actorId, { from: row.state, alasan });
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
  return transition(id, 'returned', 'return', actorId, { from: row.state, alasan });
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
