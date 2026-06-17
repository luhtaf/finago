import { eq } from 'drizzle-orm';
import { db } from '../../shared/db/client';
import { outboxEvents, pengajuan, docxFiles } from '../../shared/db/schema';
import { graph } from '../../shared/graph/client';
import { r2 } from '../../shared/r2/client';

const MAX_ATTEMPTS = 5;

export interface SyncResult {
  processed: number;
  failed: number;
}

/** Bentuk payload tiap event outbox (ditulis fitur `pengajuan` saat submit). */
interface EventPayload {
  pengajuanId?: string;
}

/**
 * Handler `sync_pengajuan` → append 1 baris ke spreadsheet OneDrive.
 * Idempotency: pakai `nbr` sebagai key — kalau row dengan nbr ini sudah ada di
 * sheet, Graph layer yang harus skip/upsert (stub belum cek). Mapping kolom di
 * sini ⚠️ kalau schema `pengajuan` berubah, update CLAUDE.md feature ini.
 */
async function handleSyncPengajuan(pengajuanId: string): Promise<void> {
  const header = await db.query.pengajuan.findFirst({ where: eq(pengajuan.id, pengajuanId) });
  if (!header) {
    throw new Error(`sync_pengajuan: pengajuan ${pengajuanId} tidak ditemukan`);
  }

  // Kolom spreadsheet OneDrive. Key `nbr` dipakai sebagai natural key (idempotent).
  await graph.appendSpreadsheetRow({
    nbr: header.nbr,
    tanggal: header.tanggal,
    kodeProyek: header.kodeProyek,
    kategori: header.kategori,
    nama: header.nama,
    total: header.total,
    state: header.state,
    pengajuId: header.pengajuId,
  });
}

/**
 * Handler `upload_docx` → ambil baris docx, upload bytes ke OneDrive, lalu
 * update `docx_files.onedriveUrl` + status 'synced'. Idempotent: nama file
 * `${nbr}.docx` tetap → re-upload menimpa file lama (overwrite), bukan duplikat.
 */
async function handleUploadDocx(pengajuanId: string): Promise<void> {
  const header = await db.query.pengajuan.findFirst({ where: eq(pengajuan.id, pengajuanId) });
  if (!header) {
    throw new Error(`upload_docx: pengajuan ${pengajuanId} tidak ditemukan`);
  }

  const doc = await db.query.docxFiles.findFirst({
    where: eq(docxFiles.pengajuanId, pengajuanId),
  });
  if (!doc) {
    throw new Error(`upload_docx: docx_files untuk pengajuan ${pengajuanId} tidak ditemukan`);
  }

  // Ambil bytes asli docx dari R2 pakai r2Key. Kalau null (belum/tidak ada di R2),
  // skip mulus: tandai event done biar gak terus-terusan di-retry sampai MAX_ATTEMPTS.
  const bytes = doc.r2Key ? await r2.get(doc.r2Key) : null;
  if (!bytes) {
    console.warn(
      `[sync-onedrive] upload_docx: bytes untuk r2Key ${doc.r2Key} (pengajuan ${pengajuanId}) tidak ada di R2, skip.`,
    );
    return;
  }

  const { webUrl } = await graph.uploadFile('FINA-go/pengajuan', `${header.nbr}.docx`, bytes);

  await db
    .update(docxFiles)
    .set({ onedriveUrl: webUrl, status: 'synced' })
    .where(eq(docxFiles.id, doc.id));
}

/** Dispatch event ke handler sesuai `type`. */
async function processEvent(type: string, payload: EventPayload): Promise<void> {
  const pengajuanId = payload?.pengajuanId;
  if (!pengajuanId) {
    throw new Error(`event ${type}: payload.pengajuanId kosong`);
  }

  switch (type) {
    case 'sync_pengajuan':
      return handleSyncPengajuan(pengajuanId);
    case 'upload_docx':
      return handleUploadDocx(pengajuanId);
    default:
      throw new Error(`event type tidak dikenal: ${type}`);
  }
}

/**
 * Konsumen outbox: baca event status='pending' (max `limit`), proses tiap satu.
 * Tiap event dibungkus try/catch → 1 kegagalan gak menghentikan batch.
 * Sukses → status 'done' + processedAt. Gagal → attempts++ dan set 'failed'
 * kalau attempts >= MAX_ATTEMPTS (kalau belum, tetap 'pending' biar di-retry
 * di run berikutnya).
 */
export async function runSync(limit = 50): Promise<SyncResult> {
  const events = await db
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.status, 'pending'))
    .limit(limit);

  let processed = 0;
  let failed = 0;

  for (const event of events) {
    try {
      await processEvent(event.type, (event.payload as EventPayload) ?? {});
      await db
        .update(outboxEvents)
        .set({ status: 'done', processedAt: new Date() })
        .where(eq(outboxEvents.id, event.id));
      processed += 1;
    } catch (err) {
      const attempts = event.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db
        .update(outboxEvents)
        .set({ attempts, status: giveUp ? 'failed' : 'pending' })
        .where(eq(outboxEvents.id, event.id));
      if (giveUp) failed += 1;
      console.error(
        `[sync-onedrive] event ${event.id} (${event.type}) gagal (attempt ${attempts}/${MAX_ATTEMPTS}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { processed, failed };
}

/**
 * Jalankan runSync periodik via setInterval (default 5 menit).
 * ⚠️ JANGAN dipanggil di top-level module — biar import bersih untuk test &
 * environment serverless. Di Node panggil sekali dari entrypoint.
 * Di Cloudflare Workers JANGAN pakai ini — pakai Cron Triggers (wrangler.toml
 * `[triggers] crons = [...]`) yang memanggil runSync() di handler `scheduled`.
 */
export function startCron(intervalMs = 5 * 60 * 1000): ReturnType<typeof setInterval> {
  return setInterval(() => {
    runSync().catch((err) => {
      console.error('[sync-onedrive] runSync (cron) gagal:', err);
    });
  }, intervalMs);
}
