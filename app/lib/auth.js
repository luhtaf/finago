import { API_BASE } from './config.js';

// Auth sendiri: login email+password → JWT dari backend, simpan di localStorage.
// Swap ke SSO/OAuth nanti = ganti login() + cara simpan token, sisanya tetap.
const T = 'fg_token', U = 'fg_user';

// exp (detik) dari payload JWT — cuma buat UX (auto logout); validasi asli di backend.
function tokenExp(t) {
  try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp || 0; } catch { return 0; }
}

export const auth = {
  token() { return localStorage.getItem(T); },
  expired() { const t = localStorage.getItem(T); return !t || tokenExp(t) * 1000 <= Date.now(); },
  // user tersimpan cuma dianggap login kalau token-nya masih berlaku
  current() {
    if (this.expired()) { this.logout(); return null; }
    try { return JSON.parse(localStorage.getItem(U) || 'null'); } catch { return null; }
  },
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
  // dipanggil pas API balas 401 / token expired → bersihin sesi + lempar ke login
  forceLogout() {
    this.logout();
    try { const s = window.Alpine?.store('session'); if (s) s.user = null; } catch {}
    if (location.hash !== '#/login') location.hash = '#/login';
  },
};
