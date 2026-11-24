// Base URL backend. Prioritas: window.FG_API (di-set di index.html pas deploy) →
// localStorage 'fg_api' → default localhost (dev).
// FG_API = "same-origin" → API dilayani server yang sama dengan FE (deploy VPS/Docker:
// container Node melayani app/ + API di domain yang sama) → base URL kosong.
const fg = typeof window !== 'undefined' && typeof window.FG_API === 'string' ? window.FG_API.trim() : '';
export const API_BASE =
  fg === 'same-origin' ? '' :
  fg ||
  localStorage.getItem('fg_api') ||
  'http://localhost:8787';
