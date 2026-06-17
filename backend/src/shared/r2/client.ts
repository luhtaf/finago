// Object store. Default: S3-compatible (MinIO sekarang, Cloudflare R2 nanti — sama-sama S3 API).
// Kalau env S3 belum di-set → fallback ke FS lokal (.r2-store/) biar dev tetap jalan tanpa MinIO.
//
// MinIO lokal:
//   docker run -p 9000:9000 -p 9001:9001 minio/minio server /data --console-address ":9001"
//   env: R2_ENDPOINT=http://localhost:9000 R2_ACCESS_KEY_ID=minioadmin R2_SECRET_ACCESS_KEY=minioadmin R2_BUCKET=finago
// Pindah ke Cloudflare R2 = ganti R2_ENDPOINT + key + (region auto), kode sama.

import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
  CreateBucketCommand, HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ENDPOINT = process.env.R2_ENDPOINT;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET ?? 'finago';
const REGION = process.env.R2_REGION ?? 'us-east-1';
const USE_S3 = Boolean(ENDPOINT && ACCESS_KEY && SECRET_KEY);

let _s3: S3Client | null = null;
let _bucketReady = false;
function s3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: REGION,
      endpoint: ENDPOINT,
      forcePathStyle: true, // wajib buat MinIO
      credentials: { accessKeyId: ACCESS_KEY as string, secretAccessKey: SECRET_KEY as string },
    });
  }
  return _s3;
}
async function ensureBucket(): Promise<void> {
  if (_bucketReady) return;
  try {
    await s3().send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    try { await s3().send(new CreateBucketCommand({ Bucket: BUCKET })); } catch { /* race / sudah ada */ }
  }
  _bucketReady = true;
}

// ── FS fallback ───────────────────────────────────────────────────────
const fsDir = () => process.env.R2_DIR ?? '.r2-store';
const fsPath = (key: string) => join(fsDir(), key);

async function put(key: string, content: Uint8Array): Promise<void> {
  if (USE_S3) {
    await ensureBucket();
    await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: content }));
    return;
  }
  const p = fsPath(key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content);
}

async function get(key: string): Promise<Uint8Array | null> {
  if (USE_S3) {
    try {
      const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      return bytes ?? null;
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }
  try {
    const buf = await readFile(fsPath(key));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function del(key: string): Promise<void> {
  if (USE_S3) {
    await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    return;
  }
  try { await unlink(fsPath(key)); }
  catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
}

function getUrl(key: string): string {
  if (USE_S3) return `${ENDPOINT}/${BUCKET}/${key}`;
  const base = process.env.R2_PUBLIC_BASE ?? 'http://localhost:8787/files';
  return `${base}/${key}`;
}

export const r2 = { put, get, getUrl, delete: del };
