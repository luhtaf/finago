import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

// Hash password pakai scrypt (node:crypto, no dep). Format: "<salt-hex>:<key-hex>".
// TODO: di CF Workers node:crypto gak ada → ganti ke Web Crypto (PBKDF2) saat deploy edge.
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${key}`;
}

export function verifyPassword(pw: string, stored: string | null): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, key] = stored.split(':');
  const keyBuf = Buffer.from(key!, 'hex');
  const dk = scryptSync(pw, salt!, 64);
  return keyBuf.length === dk.length && timingSafeEqual(keyBuf, dk);
}
