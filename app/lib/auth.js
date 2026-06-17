import { API_BASE } from './config.js';

// Auth sendiri: login email+password → JWT dari backend, simpan di localStorage.
// Swap ke SSO/OAuth nanti = ganti login() + cara simpan token, sisanya tetap.
const T = 'fg_token', U = 'fg_user';

export const auth = {
  token() { return localStorage.getItem(T); },
  current() { try { return JSON.parse(localStorage.getItem(U) || 'null'); } catch { return null; } },
  async login(email, password) {
    const res = await fetch(API_BASE + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Login gagal');
    localStorage.setItem(T, data.token);
    localStorage.setItem(U, JSON.stringify(data.user));
    return data.user;
  },
  logout() { localStorage.removeItem(T); localStorage.removeItem(U); },
};
