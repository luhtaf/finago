// Microsoft Graph client (OneDrive / M365) — app-only auth (client credentials).
// Setup creds: lihat PLAN-BE.md "Setup sekali (Microsoft Graph)" (Azure AD app
// registration, Files.ReadWrite.All / Sites.ReadWrite.All, admin consent, env/secret).
//
// Aktif otomatis kalau env vars di-set; kalau gak (mis. dev tanpa creds) → no-op + log,
// jadi app tetap jalan tanpa kredensial.
//
// Dipanggil HANYA dari job async sync-onedrive (consumer outbox), gak di jalur request.
//
// ⚠️ Nama tabel workbook di-hardcode 'Table1' — sesuaikan ke nama tabel asli di
//    workbook M365 (lihat Workbook API / Excel "Table Name") kalau beda.

const TENANT_ID = process.env.GRAPH_TENANT_ID;
const CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const DRIVE_ID = process.env.GRAPH_DRIVE_ID;
const WORKBOOK_ITEM_ID = process.env.GRAPH_WORKBOOK_ITEM_ID;
const FOLDER_PATH = process.env.GRAPH_FOLDER_PATH;

const WORKBOOK_TABLE_NAME = 'Table1';
const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface DriveItemResponse {
  webUrl?: string;
}

function isConfigured(): boolean {
  return Boolean(TENANT_ID && CLIENT_ID && CLIENT_SECRET && DRIVE_ID);
}

// Token cache di module scope; reuse sampai ~60s sebelum exp.
let cachedToken: string | null = null;
let cachedTokenExpiresAt = 0;

async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID as string,
    client_secret: CLIENT_SECRET as string,
    scope: 'https://graph.microsoft.com/.default',
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[graph] token request failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as TokenResponse;
  cachedToken = json.access_token;
  // refresh 60s sebelum benar-benar expired.
  cachedTokenExpiresAt = now + (json.expires_in - 60) * 1000;
  return json.access_token;
}

export const graph = {
  async appendSpreadsheetRow(row: Record<string, unknown>): Promise<void> {
    if (!isConfigured()) {
      console.log('[graph] not configured, skip appendRow', row);
      return;
    }

    const token = await getToken();
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${WORKBOOK_ITEM_ID}/workbook/tables/${WORKBOOK_TABLE_NAME}/rows/add`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [Object.values(row)] }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[graph] appendSpreadsheetRow failed: ${res.status} ${text}`);
    }
  },

  async uploadFile(
    folderPath: string,
    filename: string,
    content: Uint8Array,
  ): Promise<{ webUrl: string }> {
    if (!isConfigured()) {
      console.log('[graph] not configured, skip uploadFile', folderPath, filename);
      return { webUrl: `https://onedrive.example/${encodeURIComponent(filename)}` };
    }

    const token = await getToken();
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root:/${folderPath}/${filename}:/content`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': DOCX_CONTENT_TYPE,
        },
        body: content,
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[graph] uploadFile failed: ${res.status} ${text}`);
    }

    const json = (await res.json()) as DriveItemResponse;
    return { webUrl: json.webUrl ?? '' };
  },
};
