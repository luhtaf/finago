import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { getUser } from '../../shared/auth';
import { r2 } from '../../shared/r2/client';
import { newId } from '../../shared/util';
import { generateDocx } from './docx';
import { exportPengajuanXlsx, exportFormulirXlsx } from './export';
import {
  createPengajuan,
  getPengajuan,
  listPengajuan,
  updateDraft,
  submitPengajuan,
  justifyPengajuan,
  getDocx,
  deletePengajuan,
  getPengajuanOwner,
  addBukti,
  bankAccountOwnedBy,
  attachmentOwnedBy,
} from './service';

export const pengajuanRoutes = new Hono();

/** Edit/submit/justify cuma boleh pemilik pengajuan. null = not found, false = bukan pemilik. */
async function ownedBy(id: string, userId: string): Promise<boolean | null> {
  const owner = await getPengajuanOwner(id);
  return owner === null ? null : owner === userId;
}
const NOT_OWNER = { error: 'forbidden', message: 'Cuma pengaju yang bisa mengubah pengajuan ini' };

// Visibilitas: verifikator/approver/admin lihat semua; pengaju biasa cuma miliknya
// (pengajuan, docx, lampiran — isinya no. rekening & nota orang lain).
const canViewAll = (u: { roles: string[] }) => ['verifikator', 'approver', 'admin'].some((r) => u.roles.includes(r));
/** 'ok' | 'not_found' | 'forbidden' */
async function viewAccess(c: Context, id: string) {
  const u = getUser(c);
  const owner = await getPengajuanOwner(id);
  if (owner === null) return 'not_found' as const;
  return canViewAll(u) || owner === u.id ? ('ok' as const) : ('forbidden' as const);
}
const denyView = (c: Context, r: 'not_found' | 'forbidden') =>
  r === 'not_found' ? c.json({ error: 'not_found' }, 404) : c.json({ error: 'forbidden', message: 'Bukan pengajuan kamu' }, 403);
const BAD_REKENING = { error: 'invalid_rekening', message: 'Rekening tersimpan itu bukan milikmu' };

const itemSchema = z.object({
  item: z.string().min(1),
  qty: z.number().nonnegative(),
  satuan: z.string().nullish(),
  harga: z.number().int().nonnegative(),
  remark: z.string().nullish(),
});

const rekeningSchema = z.object({
  bankName: z.string().min(1),
  number: z.string().min(1),
  holderName: z.string().min(1),
});

const createSchema = z.object({
  tanggal: z.string().min(1), // ISO date YYYY-MM-DD
  kodeProyek: z.string().min(1),
  kategori: z.enum(['reimbursement', 'pengajuan_baru']),
  prioritas: z.enum(['urgent', 'not_urgent']).optional(),
  nama: z.string().min(1),
  bankAccountId: z.string().nullish(),
  rekeningList: z.array(rekeningSchema).nullish(),
  notaUrl: z.string().nullish(),
  items: z.array(itemSchema).min(1),
});

const updateSchema = z.object({
  tanggal: z.string().min(1).optional(),
  kodeProyek: z.string().min(1).optional(),
  kategori: z.enum(['reimbursement', 'pengajuan_baru']).optional(),
  prioritas: z.enum(['urgent', 'not_urgent']).optional(),
  nama: z.string().min(1).optional(),
  bankAccountId: z.string().nullish(),
  rekeningList: z.array(rekeningSchema).nullish(),
  notaUrl: z.string().nullish(),
  items: z.array(itemSchema).min(1),
});

// POST /uploads — upload nota/bukti (multipart, field "file") → simpan storage, balikin key.
// Cuma gambar/PDF, maks 10 MB (Workers request body limit juga ~100 MB, jangan sampai sana).
const UPLOAD_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'pdf']);
const MAX_UPLOAD = 10 * 1024 * 1024;
pengajuanRoutes.post('/uploads', async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'];
  if (!file || typeof file === 'string') return c.json({ error: 'file wajib' }, 400);
  const f = file as { arrayBuffer(): Promise<ArrayBuffer>; name?: string; size?: number };
  const ext = ((f.name || '').split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!UPLOAD_EXT.has(ext)) return c.json({ error: 'invalid_file', message: 'Format harus JPG/PNG/WEBP/PDF' }, 400);
  if ((f.size ?? 0) > MAX_UPLOAD) return c.json({ error: 'too_large', message: 'Ukuran file maks 10 MB' }, 413);
  const buf = new Uint8Array(await f.arrayBuffer());
  if (buf.byteLength > MAX_UPLOAD) return c.json({ error: 'too_large', message: 'Ukuran file maks 10 MB' }, 413);
  const key = `nota/${newId('nota')}.${ext}`;
  await r2.put(key, buf);
  return c.json({ key, url: r2.getUrl(key) });
});

// GET /uploads/file?key=... — stream file (buat nampilin nota/bukti di FE)
pengajuanRoutes.get('/uploads/file', async (c) => {
  const key = c.req.query('key');
  if (!key) return c.json({ error: 'key wajib' }, 400);
  // cuma folder lampiran; tolak traversal (mode FS lokal) + akses ke docx/ dll
  if (!/^nota\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(key)) return c.json({ error: 'invalid_key' }, 400);
  const u = getUser(c);
  if (!canViewAll(u) && !(await attachmentOwnedBy(key, u.id))) return c.json({ error: 'forbidden' }, 403);
  const bytes = await r2.get(key);
  if (!bytes) return c.json({ error: 'not_found' }, 404);
  const ext = (key.split('.').pop() || '').toLowerCase();
  const ct = ext === 'png' ? 'image/png'
    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : ext === 'pdf' ? 'application/pdf'
    : 'application/octet-stream';
  return new Response(bytes as unknown as ArrayBuffer, {
    headers: { 'Content-Type': ct, 'Cache-Control': 'private, max-age=300' },
  });
});

// POST /pengajuan — buat draft baru
pengajuanRoutes.post('/pengajuan', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400);
  }
  const user = getUser(c);
  if (parsed.data.bankAccountId && !(await bankAccountOwnedBy(parsed.data.bankAccountId, user.id))) return c.json(BAD_REKENING, 400);
  const result = await createPengajuan(parsed.data, user.id);
  return c.json(result, 201);
});

// GET /pengajuan — list dengan filter opsional (kategori, state, kodeProyek)
pengajuanRoutes.get('/pengajuan', async (c) => {
  const { kategori, state, kodeProyek } = c.req.query();
  const u = getUser(c);
  const rows = await listPengajuan({ kategori: kategori as never, state, kodeProyek, pengajuId: canViewAll(u) ? undefined : u.id });
  return c.json(rows);
});

// GET /pengajuan/export.xlsx — rekap Excel (sheet Pengajuan + Detail Item), filter sama
// dengan list (+ from/to tanggal). Pengaju biasa cuma dapet pengajuan miliknya.
// ⚠️ HARUS didaftarkan SEBELUM '/pengajuan/:id' biar gak ketangkep sebagai id.
pengajuanRoutes.get('/pengajuan/export.xlsx', async (c) => {
  const u = getUser(c);
  const q = c.req.query();
  const isoDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const privileged = canViewAll(u);
  const bytes = await exportPengajuanXlsx({
    kategori: q.kategori || undefined, state: q.state || undefined, kodeProyek: q.kodeProyek || undefined,
    from: isoDate(q.from), to: isoDate(q.to), pengajuId: privileged ? undefined : u.id,
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(bytes as unknown as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="rekap-pengajuan-${stamp}.xlsx"`,
    },
  });
});

// GET /pengajuan/:id — header + items
pengajuanRoutes.get('/pengajuan/:id', async (c) => {
  const acc = await viewAccess(c, c.req.param('id'));
  if (acc !== 'ok') return denyView(c, acc);
  const found = await getPengajuan(c.req.param('id'));
  if (!found) return c.json({ error: 'not_found' }, 404);
  return c.json(found);
});

// DELETE /pengajuan/:id — hapus + renumber NBR. Pengaju cuma boleh miliknya;
// verifikator/approver/admin boleh semua.
pengajuanRoutes.delete('/pengajuan/:id', async (c) => {
  const u = getUser(c);
  const owner = await getPengajuanOwner(c.req.param('id'));
  if (owner === null) return c.json({ error: 'not_found' }, 404);
  const privileged = (['verifikator', 'approver', 'admin'] as const).some((r) => u.roles.includes(r));
  if (!privileged && owner !== u.id) {
    return c.json({ error: 'forbidden', message: 'Cuma bisa hapus pengajuan sendiri' }, 403);
  }
  const res = await deletePengajuan(c.req.param('id'), u.id);
  if (!res) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, deleted: res.nbr });
});

// POST /pengajuan/:id/bukti — tambah bukti penggunaan dana (boleh walau sudah cair).
// body { keys: string[] } hasil POST /uploads. Pemilik atau admin/verifikator.
const buktiSchema = z.object({ keys: z.array(z.string().regex(/^nota\/[A-Za-z0-9_-]+\.[a-z0-9]+$/)).min(1).max(20) });
pengajuanRoutes.post('/pengajuan/:id/bukti', async (c) => {
  const parsed = buktiSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400);
  const u = getUser(c);
  const id = c.req.param('id')!;
  const owner = await getPengajuanOwner(id);
  if (owner === null) return c.json({ error: 'not_found' }, 404);
  const privileged = u.roles.includes('admin') || u.roles.includes('verifikator');
  if (owner !== u.id && !privileged) {
    return c.json({ error: 'forbidden', message: 'Cuma pengaju yang bisa nambah bukti' }, 403);
  }
  try {
    const res = await addBukti(id, parsed.data.keys, u.id);
    if (!res) return c.json({ error: 'not_found' }, 404);
    return c.json(res);
  } catch (e) {
    return c.json({ error: 'conflict', message: (e as Error).message }, 409);
  }
});

// PATCH /pengajuan/:id — edit draft (replace items, recompute total)
pengajuanRoutes.patch('/pengajuan/:id', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400);
  }
  const own = await ownedBy(c.req.param('id'), getUser(c).id);
  if (own === null) return c.json({ error: 'not_found' }, 404);
  if (!own) return c.json(NOT_OWNER, 403);
  if (parsed.data.bankAccountId && !(await bankAccountOwnedBy(parsed.data.bankAccountId, getUser(c).id))) return c.json(BAD_REKENING, 400);
  try {
    const updated = await updateDraft(c.req.param('id'), parsed.data);
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json(updated);
  } catch (e) {
    return c.json({ error: 'conflict', message: (e as Error).message }, 409);
  }
});

// POST /pengajuan/:id/submit — submit draft (cek anomali, generate docx, outbox)
pengajuanRoutes.post('/pengajuan/:id/submit', async (c) => {
  const own = await ownedBy(c.req.param('id'), getUser(c).id);
  if (own === null) return c.json({ error: 'not_found' }, 404);
  if (!own) return c.json(NOT_OWNER, 403);
  try {
    const result = await submitPengajuan(c.req.param('id'));
    if (!result) return c.json({ error: 'not_found' }, 404);
    return c.json(result);
  } catch (e) {
    return c.json({ error: 'conflict', message: (e as Error).message }, 409);
  }
});

// POST /pengajuan/:id/justify — pengaju kasih alasan kalau kena flag anomali
pengajuanRoutes.post('/pengajuan/:id/justify', async (c) => {
  const body = await c.req.json().catch(() => null);
  const alasan = typeof body?.alasan === 'string' ? body.alasan.trim() : '';
  if (!alasan) return c.json({ error: 'invalid_body', message: 'alasan wajib' }, 400);
  const own = await ownedBy(c.req.param('id')!, getUser(c).id);
  if (own === null) return c.json({ error: 'not_found' }, 404);
  if (!own) return c.json(NOT_OWNER, 403);
  try {
    const result = await justifyPengajuan(c.req.param('id')!, getUser(c).id, alasan);
    if (!result) return c.json({ error: 'not_found' }, 404);
    return c.json(result);
  } catch (e) {
    return c.json({ error: 'conflict', message: (e as Error).message }, 409);
  }
});

// GET /pengajuan/:id/docx — metadata docx terbaru + signed/public URL R2
pengajuanRoutes.get('/pengajuan/:id/docx', async (c) => {
  const acc = await viewAccess(c, c.req.param('id'));
  if (acc !== 'ok') return denyView(c, acc);
  const doc = await getDocx(c.req.param('id'));
  if (!doc) return c.json({ error: 'not_found' }, 404);
  return c.json({
    ...doc,
    url: doc.r2Key ? r2.getUrl(doc.r2Key) : null,
  });
});

// GET /pengajuan/:id/xlsx — FORMULIR 1 pengajuan dalam format Excel (padanan docx).
// Izin sama dengan docx: pemilik atau verifikator/approver/admin.
pengajuanRoutes.get('/pengajuan/:id/xlsx', async (c) => {
  const id = c.req.param('id')!;
  const acc = await viewAccess(c, id);
  if (acc !== 'ok') return denyView(c, acc);
  const res = await exportFormulirXlsx(id);
  if (!res) return c.json({ error: 'not_found' }, 404);
  return new Response(res.bytes as unknown as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${res.nbr}.xlsx"`,
    },
  });
});

// GET /pengajuan/:id/docx/download — generate + stream .docx beneran (Word file)
pengajuanRoutes.get('/pengajuan/:id/docx/download', async (c) => {
  try {
    const id = c.req.param('id')!;
    const acc = await viewAccess(c, id);
    if (acc !== 'ok') return denyView(c, acc);
    const found = await getPengajuan(id);
    if (!found) return c.json({ error: 'not_found' }, 404);
    const { bytes } = await generateDocx(id);
    return new Response(bytes as unknown as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${found.nbr}.docx"`,
      },
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 404);
  }
});
