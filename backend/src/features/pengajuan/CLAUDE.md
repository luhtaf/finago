# CLAUDE.md — fitur `pengajuan`

> Tunduk ke `../../CLAUDE.md` (backend) dan `../../../CLAUDE.md` (global).

## Apa yang dilakukan

Inti FINA go: bikin + kelola pengajuan (reimbursement / pengajuan baru). Karyawan
buat draft berisi item-item rincian, lalu submit untuk masuk alur approval.
Setiap item punya `subtotal = round(qty * harga)`; `total` header **dihitung server**
(sum subtotal) — jangan percaya angka dari FE.

Lifecycle yang ditangani di sini:
`draft` → (submit) → `submitted` ATAU `needs_justification` (kalau kena anomali).
State lanjutan (verified/approved/returned/rejected/paid) di fitur `approval`.

## Tabel yang disentuh

- `pengajuan` — header (insert saat create, update saat edit draft / submit).
- `pengajuan_item` — detail item (replace-all saat create/edit draft).
- `docx_files` — baris dokumen FORMULIR hasil generate (upsert, status `generated`).
- `outbox_events` — emit 2 event saat submit (`sync_pengajuan`, `upload_docx`).

## Endpoint (full-path, di-mount di `/`)

- `POST   /pengajuan`            — buat draft baru (zod-validated), return `{id, nbr}`.
- `GET    /pengajuan`            — list, filter query: `kategori` / `state` / `kodeProyek`.
- `GET    /pengajuan/:id`        — header + items.
- `PATCH  /pengajuan/:id`        — edit (hanya state `draft`), replace items + recompute total.
- `POST   /pengajuan/:id/submit` — submit (hanya dari `draft`), return `{state, anomaly}`.
- `DELETE /pengajuan/:id`        — hapus + **renumber NBR** se-tahun. Pengaju cuma miliknya; verifikator/approver/admin semua.
- `GET    /pengajuan/:id/docx`   — metadata docx terbaru + URL R2.

`pengajuId` selalu diambil dari `getUser(c)` (auth STUB → demo user).

## Coupling lintas-fitur

- **monitored-items**: `submit` memanggil `checkAnomaly(pengajuanId)`. Kalau `flagged`,
  state jadi `needs_justification` dan alasan disimpan di audit `meta`. (file
  `monitored-items/service` dibangun agen lain — kita cuma import.)
- **sync-onedrive**: konsumen `outbox_events`. Jangan ubah `type` event
  (`sync_pengajuan`, `upload_docx`) tanpa update consumer-nya.
- **docx.ts**: NYATA (library `docx`) — generate FORMULIR valid (No | Rincian Anggaran |
  Kuantitas | Sat. | Jumlah | TOTAL | Dikirim ke Rekening | Prepared/Approved), simpan ke R2.
  Approver masih konstanta `DIRECTOR_NAME` (TODO derive dari record approval).

## Catatan / TODO

- **NBR = posisi-dalam-tahun** (`BR<seq3><tahun>`, mis. `BR0012026`). `nextNbr(year)`
  = jumlah pengajuan tahun itu + 1. **`DELETE` memicu `renumberYear`** (2-fase, pakai
  `TMP-<id>` dulu) biar nomor rapat lagi → NBR pengajuan lain BISA berubah saat ada delete.
- **NBR race**: create concurrent rawan duplikat (unique `nbr`). TODO: retry-on-unique.
