// Base URL backend. Prioritas: window.FG_API (di-set di index.html pas deploy) →
// localStorage 'fg_api' → default localhost (dev).
export const API_BASE =
  (typeof window !== 'undefined' && window.FG_API && window.FG_API.trim()) ||
  localStorage.getItem('fg_api') ||
  'http://localhost:8787';
