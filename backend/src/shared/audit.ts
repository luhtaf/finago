import { db } from './db/client';
import { auditLog } from './db/schema';
import { newId } from './util';

/** Tulis 1 entri audit. Dipakai semua fitur saat ada transisi state / perubahan sensitif. */
export async function writeAudit(entry: {
  entity: string;
  entityId: string;
  action: string;
  actorId?: string;
  meta?: unknown;
}): Promise<void> {
  await db.insert(auditLog).values({
    id: newId('aud'),
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    actorId: entry.actorId ?? null,
    meta: (entry.meta ?? null) as never,
  });
}
