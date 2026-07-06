// Object store — 3 mode:
//  1) R2 binding (Cloudflare Workers): worker.ts panggil useR2Binding(env.BUCKET). Paling simpel, no key.
//  2) S3-compatible (Node: MinIO/R2/Supabase via @aws-sdk): pakai env R2_ENDPOINT + key.
//  3) FS lokal (.r2-store/): fallback dev kalau env S3 kosong.
// aws-sdk & node:fs di-import DINAMIS (di dalam fungsi) biar gak ke-load pas jalan di Workers.

let _bucket: any = null; // R2 binding (Workers)
export function useR2Binding(b: unknown): void { _bucket = b; }

const ENDPOINT = process.env.R2_ENDPOINT;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET ?? 'finago';
const REGION = process.env.R2_REGION ?? 'us-east-1';
const USE_S3 = Boolean(ENDPOINT && ACCESS_KEY && SECRET_KEY);

let _s3: any = null;
let _bucketReady = false;
async function s3() {
  if (!_s3) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    _s3 = new S3Client({
      region: REGION, endpoint: ENDPOINT, forcePathStyle: true,
      credentials: { accessKeyId: ACCESS_KEY as string, secretAccessKey: SECRET_KEY as string },
    });
  }
  return _s3;
}
async function ensureBucket() {
  if (_bucketReady) return;
  const { HeadBucketCommand, CreateBucketCommand } = await import('@aws-sdk/client-s3');
  try { await (await s3()).send(new HeadBucketCommand({ Bucket: BUCKET })); }
  catch { try { await (await s3()).send(new CreateBucketCommand({ Bucket: BUCKET })); } catch { /* race / ada */ } }
  _bucketReady = true;
}

const fsPath = async (key: string) => {
  const { join } = await import('node:path');
  return join(process.env.R2_DIR ?? '.r2-store', key);
};

async function put(key: string, content: Uint8Array): Promise<void> {
  if (_bucket) { await _bucket.put(key, content); return; }
  if (USE_S3) {
    await ensureBucket();
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await s3()).send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: content }));
    return;
  }
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const p = await fsPath(key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content);
}

async function get(key: string): Promise<Uint8Array | null> {
  if (_bucket) {
    const o = await _bucket.get(key);
    return o ? new Uint8Array(await o.arrayBuffer()) : null;
  }
  if (USE_S3) {
    try {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const res = await (await s3()).send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      return bytes ?? null;
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }
  try {
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(await fsPath(key));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function del(key: string): Promise<void> {
  if (_bucket) { await _bucket.delete(key); return; }
  if (USE_S3) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await (await s3()).send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    return;
  }
  try { const { unlink } = await import('node:fs/promises'); await unlink(await fsPath(key)); }
  catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
}

function getUrl(key: string): string {
  if (_bucket) return `/uploads/file?key=${encodeURIComponent(key)}`; // R2 binding: lewat route stream
  if (USE_S3) return `${ENDPOINT}/${BUCKET}/${key}`;
  return `${process.env.R2_PUBLIC_BASE ?? 'http://localhost:8787/files'}/${key}`;
}

export const r2 = { put, get, getUrl, delete: del };
