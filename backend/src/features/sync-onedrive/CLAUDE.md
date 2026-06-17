# CLAUDE.md — fitur `sync-onedrive`

> Tunduk ke `../../CLAUDE.md` (backend) dan `../../../CLAUDE.md` (global).

## Apa yang dilakukan

Konsumen **async** dari outbox: DB → OneDrive (Microsoft Graph). Bukan di jalur
request — dipicu cron. Membaca `outbox_events` status=`pending`, proses tiap
event sesuai `type`, lalu tandai `done` (sukses) atau retry/`failed` (gagal).

Fitur `pengajuan` yang **menulis** event saat submit; di sini kita cuma konsumsi.
Jangan ubah nilai `type` tanpa sinkron dengan penulis.

## Event types + mapping kolom

> ⚠️ Mapping di bawah meng-copy kolom dari `pengajuan`. **Kalau schema/kolom
> `pengajuan` berubah, update mapping di `consumer.ts` + tabel ini.**

| `type` | payload | aksi |
|---|---|---|
| `sync_pengajuan` | `{ pengajuanId }` | `graph.appendSpreadsheetRow(row)` — append 1 baris ke spreadsheet OneDrive |
| `upload_docx` | `{ pengajuanId }` | cari `docx_files`, `graph.uploadFile('FINA-go/pengajuan', '<nbr>.docx', bytes)`, lalu update `docx_files.onedriveUrl` + status `synced` |

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

## Catatan / TODO

- **Graph masih STUB** (`shared/graph/client.ts`): `appendSpreadsheetRow` cuma
  `console.log`, `uploadFile` balikin URL dummy. Implementasi nyata = app-only auth
  + Workbook API + upload `PUT .../content`.
- **R2 stub**: `upload_docx` belum fetch bytes asli — kirim `Uint8Array(0)`
  placeholder. TODO: ambil bytes dari R2 (`doc.r2Key`) begitu R2 bukan stub.
- Tidak menyentuh file di luar folder ini.
