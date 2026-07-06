import { Hono } from 'hono';
import { z } from 'zod';
import { getUser } from '../../shared/auth';
import { r2 } from '../../shared/r2/client';
import { newId } from '../../shared/util';
import { generateDocx } from './docx';
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
} from './service';

export const pengajuanRoutes = new Hono();

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

// POST /uploads — upload nota/bukti (multipart, field "file") → simpan storage, balikin key
pengajuanRoutes.post('/uploads', async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'];
  if (!file || typeof file === 'string') return c.json({ error: 'file wajib' }, 400);
  const f = file as { arrayBuffer(): Promise<ArrayBuffer>; name?: string };
  const buf = new Uint8Array(await f.arrayBuffer());
  const ext = ((f.name || '').split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const key = `nota/${newId('nota')}.${ext}`;
  await r2.put(key, buf);
  return c.json({ key, url: r2.getUrl(key) });
});

// GET /uploads/file?key=... — stream file (buat nampilin nota/bukti di FE)
pengajuanRoutes.get('/uploads/file', async (c) => {
  const key = c.req.query('key');
  if (!key) return c.json({ error: 'key wajib' }, 400);
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
  const result = await createPengajuan(parsed.data, user.id);
  return c.json(result, 201);
});

// GET /pengajuan — list dengan filter opsional (kategori, state, kodeProyek)
pengajuanRoutes.get('/pengajuan', async (c) => {
  const { kategori, state, kodeProyek } = c.req.query();
  const rows = await listPengajuan({ kategori: kategori as never, state, kodeProyek });
  return c.json(rows);
});

// GET /pengajuan/:id — header + items
pengajuanRoutes.get('/pengajuan/:id', async (c) => {
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

// PATCH /pengajuan/:id — edit draft (replace items, recompute total)
pengajuanRoutes.patch('/pengajuan/:id', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400);
  }
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
  const doc = await getDocx(c.req.param('id'));
  if (!doc) return c.json({ error: 'not_found' }, 404);
  return c.json({
    ...doc,
    url: doc.r2Key ? r2.getUrl(doc.r2Key) : null,
  });
});

// GET /pengajuan/:id/docx/download — generate + stream .docx beneran (Word file)
pengajuanRoutes.get('/pengajuan/:id/docx/download', async (c) => {
  try {
    const id = c.req.param('id')!;
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
