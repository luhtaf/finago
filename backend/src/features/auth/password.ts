// Hash password pakai Web Crypto PBKDF2 (SHA-256). Jalan di Node 20+ DAN Cloudflare Workers
// (global `crypto.subtle`), gak pakai node:crypto. Format: "pbkdf2$<iter>$<salt-hex>$<key-hex>".
const ITERATIONS = 100_000;
const KEYLEN = 32; // bytes

function toHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}
function fromHex(h: string): Uint8Array {
  const a = new Uint8Array(h.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return a;
}

async function derive(pw: string, salt: Uint8Array, iter: number): Promise<string> {
  const mat = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, mat, KEYLEN * 8);
  return toHex(new Uint8Array(bits));
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(pw, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${key}`;
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const got = await derive(pw, fromHex(parts[2]!), Number(parts[1]));
  const expected = parts[3]!;
  // constant-time-ish compare
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
