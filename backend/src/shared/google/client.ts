// Google Drive + Sheets client — service account (server-to-server, no user login).
// Auth: JWT (RS256) ditandatangani pakai Web Crypto → jalan di Node DAN Workers.
// Aktif kalau env GOOGLE_* di-set (lihat isConfigured). Dipakai sbg provider 'google'.
//
// Setup: bikin service account di Google Cloud → download JSON key → share folder
// Drive + Google Sheet ke email SA (Editor). Env:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY (PEM, \n boleh di-escape),
//   GOOGLE_DRIVE_FOLDER_ID (folder docx), GOOGLE_SHEET_ID (spreadsheet rekap),
//   GOOGLE_SHEET_TAB (default 'Sheet1').

const SCOPE = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets';
const DOCX_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function cfg() {
  return {
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY,
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
    sheetId: process.env.GOOGLE_SHEET_ID,
    sheetTab: process.env.GOOGLE_SHEET_TAB ?? 'Sheet1',
  };
}
function isConfigured(): boolean {
  const c = cfg();
  return Boolean(c.email && c.key && (c.folderId || c.sheetId));
}

// ── helpers base64url + RS256 sign ──
function b64urlBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64url = (s: string) => b64urlBytes(new TextEncoder().encode(s));
function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function signRs256(data: string, pem: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToDer(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
  return b64urlBytes(new Uint8Array(sig));
}

// token cache (module scope)
let cachedToken: string | null = null;
let cachedExp = 0;
async function getToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedExp) return cachedToken;
  const c = cfg();
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: c.email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const toSign = `${header}.${claim}`;
  const jwt = `${toSign}.${await signRs256(toSign, c.key as string)}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`[google] token failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = j.access_token;
  cachedExp = now + (j.expires_in ?? 3600) - 60;
  return cachedToken;
}

// cari file ber-nama sama di folder (buat overwrite, biar idempotent)
async function findFileId(token: string, folderId: string, name: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { files?: { id: string }[] };
  return j.files?.[0]?.id ?? null;
}

export const google = {
  // append 1 baris ke Google Sheet
  async appendSpreadsheetRow(row: Record<string, unknown>): Promise<void> {
    const c = cfg();
    if (!isConfigured() || !c.sheetId) {
      console.log('[google] not configured / no GOOGLE_SHEET_ID, skip appendRow', row?.nbr);
      return;
    }
    const token = await getToken();
    const range = encodeURIComponent(`${c.sheetTab}!A1`);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [Object.values(row)] }),
      },
    );
    if (!res.ok) throw new Error(`[google] appendSpreadsheetRow failed: ${res.status} ${await res.text()}`);
  },

  // upload docx ke folder Drive; overwrite kalau nama sama (idempotent)
  async uploadFile(_folderPath: string, filename: string, content: Uint8Array): Promise<{ webUrl: string }> {
    const c = cfg();
    if (!isConfigured() || !c.folderId) {
      console.log('[google] not configured / no GOOGLE_DRIVE_FOLDER_ID, skip uploadFile', filename);
      return { webUrl: '' };
    }
    const token = await getToken();
    const existingId = await findFileId(token, c.folderId, filename);

    if (existingId) {
      // update media file lama
      const res = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media&fields=id,webViewLink`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': DOCX_CT }, body: content as unknown as ArrayBuffer },
      );
      if (!res.ok) throw new Error(`[google] uploadFile (update) failed: ${res.status} ${await res.text()}`);
      const j = (await res.json()) as { webViewLink?: string };
      return { webUrl: j.webViewLink ?? '' };
    }

    // bikin file baru (multipart: metadata + media)
    const boundary = 'finago-gdrive-boundary';
    const enc = new TextEncoder();
    const pre = enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ name: filename, parents: [c.folderId] })}\r\n` +
      `--${boundary}\r\nContent-Type: ${DOCX_CT}\r\n\r\n`,
    );
    const post = enc.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(pre.length + content.length + post.length);
    body.set(pre, 0); body.set(content, pre.length); body.set(post, pre.length + content.length);
    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: body as unknown as ArrayBuffer },
    );
    if (!res.ok) throw new Error(`[google] uploadFile (create) failed: ${res.status} ${await res.text()}`);
    const j = (await res.json()) as { webViewLink?: string };
    return { webUrl: j.webViewLink ?? '' };
  },
};
