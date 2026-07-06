# CLAUDE.md — fitur `sync-onedrive`

> Tunduk ke `../../CLAUDE.md` (backend) dan `../../../CLAUDE.md` (global).

## Apa yang dilakukan

Konsumen **async** dari outbox: DB → cloud. Bukan di jalur request — dipicu cron.
Membaca `outbox_events` status=`pending`, proses tiap event sesuai `type`, lalu
tandai `done` (sukses) atau retry/`failed` (gagal).

**Tujuan sync = pluggable** via `getSyncProvider()` (`shared/sync/provider.ts`),
dipilih env **`SYNC_PROVIDER`**:
- `none` (default) → no-op.
- `google` → `shared/google/client.ts` (Drive + Sheets, service account, env `GOOGLE_*`).
- `microsoft` → `shared/graph/client.ts` (OneDrive/SharePoint via Graph app-only, env `GRAPH_*`, **butuh akun kerja berbayar** — bukan akun personal).

Consumer **gak** manggil `graph`/`google` langsung — selalu lewat `getSyncProvider()`.
Fitur `pengajuan` yang **menulis** event saat submit; di sini cuma konsumsi.
Jangan ubah nilai `type` tanpa sinkron dengan penulis.

## Event types + mapping kolom

> ⚠️ Mapping di bawah meng-copy kolom dari `pengajuan`. **Kalau schema/kolom
> `pengajuan` berubah, update mapping di `consumer.ts` + tabel ini.**

| `type` | payload | aksi |
|---|---|---|
| `sync_pengajuan` | `{ pengajuanId }` | `getSyncProvider().appendSpreadsheetRow(row)` — append 1 baris ke spreadsheet (Sheet/Excel) |
| `upload_docx` | `{ pengajuanId }` | cari `docx_files`, `getSyncProvider().uploadFile('FINA-go/pengajuan', '<nbr>.docx', bytes)`, lalu update `docx_files.onedriveUrl` + status `synced` |

Kolom row `sync_pengajuan` (urut): `nbr`, `tanggal`, `kodeProyek`, `kategori`,
`nama`, `total`, `state`, `pengajuId`.

## Idempotency

- `sync_pengajuan`: key natural = **`nbr`**. Re-run harus upsert/skip baris dengan
  nbr sama (Graph layer; stub belum cek).
- `upload_docx`: nama file selalu `${nbr}.docx` → re-upload **menimpa** (overwrite),
  bukan bikin duplikat.

## Retry

`MAX_ATTEMPTS = 5`. Tiap event dibungkus try/catch (1 gagal gak hentikan batch).
Gagal → `attempts++`; tetap `pending` (di-retry run berikutnya) sampai
`attempts >= 5` → set `failed`.

## Cron

- **Node**: panggil `startCron()` (setInterval, default 5 menit) **sekali** dari
  entrypoint. JANGAN auto-start di top-level module.
- **Cloudflare Workers**: JANGAN pakai `startCron`. Pakai **Cron Triggers**
  (`wrangler.toml [triggers] crons`) → handler `scheduled` panggil `runSync()`.

## Endpoint (admin only)

| Method | Path | Role | Aksi |
|---|---|---|---|
| GET  | `/admin/sync/status` | admin | jumlah outbox per status + `lastProcessedAt` |
| POST | `/admin/sync/run`    | admin | trigger `runSync()` sekali manual (testing) |

## Catatan

- Provider **nyata** semua: `google` (Drive/Sheets, service account JWT RS256 via Web
  Crypto) + `microsoft` (Graph app-only). Default `none` = no-op (aman tanpa env).
- `upload_docx` ambil bytes asli dari R2 (`doc.r2Key`) → kirim ke provider.
- **Microsoft butuh akun KERJA** (OneDrive for Business) — akun personal (M365 Family)
  GAK BISA app-only. Google cukup service account gratis + share folder/sheet ke email SA.
- Idempotency upload: Google cari file by-nama di folder → overwrite (bukan duplikat).
- Tidak menyentuh file di luar folder ini.
