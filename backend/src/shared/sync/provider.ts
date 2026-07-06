import { graph } from '../graph/client';
import { google } from '../google/client';

// Tujuan sync (mirror DB → cloud). Dipilih via env SYNC_PROVIDER (dibaca lazy,
// biar di Workers ke-baca yang bener). Tiap provider punya env-nya sendiri:
//   - microsoft → GRAPH_* (OneDrive for Business / SharePoint via Graph, butuh akun kerja)
//   - google    → GOOGLE_* (Drive + Sheets via service account, gratis)
//   - none      → no-op (default)
export interface SyncProvider {
  appendSpreadsheetRow(row: Record<string, unknown>): Promise<void>;
  uploadFile(folderPath: string, filename: string, content: Uint8Array): Promise<{ webUrl: string }>;
}

const noop: SyncProvider = {
  async appendSpreadsheetRow(row) {
    console.log('[sync] SYNC_PROVIDER=none → skip appendRow', (row as { nbr?: string })?.nbr);
  },
  async uploadFile(_folderPath, filename) {
    console.log('[sync] SYNC_PROVIDER=none → skip uploadFile', filename);
    return { webUrl: '' };
  },
};

export function getSyncProvider(): SyncProvider {
  const p = (process.env.SYNC_PROVIDER ?? 'none').toLowerCase();
  if (p === 'microsoft' || p === 'onedrive' || p === 'graph') return graph;
  if (p === 'google' || p === 'gdrive' || p === 'sheets') return google;
  return noop;
}
