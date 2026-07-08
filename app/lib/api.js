import { auth } from './auth.js';
import { API_BASE } from './config.js';

export { API_BASE };

function authHeaders() {
  const t = auth.token();
  return t ? { Authorization: 'Bearer ' + t } : {};
}

async function req(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; } // respons non-JSON (mis. "Internal Server Error")
  if (!res.ok) throw new Error((data && (data.message || data.error)) || text || `HTTP ${res.status}`);
  return data;
}

export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b),
  patch: (p, b) => req('PATCH', p, b),
  del: (p) => req('DELETE', p),
  // fetch file dengan auth → object URL (buat <img> / link, karena <img> ga bisa kirim header)
  async blobUrl(path) {
    const res = await fetch(API_BASE + path, { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return URL.createObjectURL(await res.blob());
  },
  // upload file (multipart) → { key, url }
  async upload(path, file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(API_BASE + path, { method: 'POST', headers: authHeaders(), body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload gagal');
    return data;
  },
  // download file (docx) → trigger browser save
  async download(path, filename) {
    const res = await fetch(API_BASE + path, { headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  },
};
