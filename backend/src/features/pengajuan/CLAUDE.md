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
- `GET    /pengajuan`            — list **keyset** (bukan OFFSET): `?cursor=&limit=25` (maks 100) + filter `kategori/state/kodeProyek/from/to/q`. Return `{rows, nextCursor, summary?}`; `summary` (count + sum total) cuma di halaman pertama. Urut `(tanggal, created_at, id) DESC` = index `pengajuan_tanggal_idx`. `q` = LIKE di NBR / nama / nama pengaju (wildcard di-escape). Filter dibagi ke `listConds()` — dipakai juga export rekap biar hasil export = yang tampil.
- `GET    /pengajuan/:id`        — header + items.
- `PATCH  /pengajuan/:id`        — edit (hanya state `draft`), replace items + recompute total.
- `POST   /pengajuan/:id/submit` — submit (hanya dari `draft`), return `{state, anomaly}`.
- `DELETE /pengajuan/:id`        — hapus + **renumber NBR** se-tahun. **Cuma state `draft`/`rejected`** (`DELETABLE_STATES`, 409 selain itu — NBR dokumen yang sudah terbit gak boleh geser). Pengaju cuma miliknya; verifikator/approver/admin semua.
- `GET    /pengajuan/:id/docx`   — metadata docx terbaru + URL R2.
- `GET    /pengajuan/export.xlsx` — rekap Excel (`export.ts`, writer di `shared/xlsx.ts`): sheet "Pengajuan" (kolom mirip sheet lama "Form responses 1") + "Detail Item". Filter = `listConds` (sama dengan list, termasuk `q`). Pengaju biasa cuma dapet miliknya. **Route ini harus di atas `/pengajuan/:id`.**
- `GET    /pengajuan/:id/xlsx`   — FORMULIR 1 pengajuan dalam Excel (`exportFormulirXlsx`), padanan docx. Izin = docx (pemilik / verif-approver-admin).
- `POST   /pengajuan/:id/bukti`  — `{keys[]}` dari `POST /uploads`, append ke `pengajuan.bukti_url` (JSON array, maks 20). Boleh di state apa pun selain draft (termasuk `paid`). Pemilik / admin / verifikator. Gak ikut ke docx.
- `POST   /uploads`              — cuma jpg/png/webp/pdf, maks 10 MB → key `nota/nota_<id>.<ext>`. `GET /uploads/file?key=` cuma terima pola itu (anti traversal).

`pengajuId` diambil dari `getUser(c)` (JWT). PATCH/submit/justify cek pemilik (403 kalau bukan). Submit di-guard `WHERE state='draft'` (double-click → 409). Edit draft membawa flag `monitored` per nama item (items di-replace dengan id baru).

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

- **NBR** (`BR<seq3><tahun>`, mis. `BR0012026`). `nextNbr(year)` = MAX seq tahun itu + 1;
  create retry s/d 5x kalau kena unique `nbr` (create paralel). **`DELETE` + ganti tahun di
  draft memicu `renumberStmts`** (2-fase `TMP-<id>` → final, 1 `db.batch`) → NBR pengajuan
  lain BISA berubah. Makanya docx di R2 di-key `pengajuan/<id>.docx`, bukan NBR.
- **Visibilitas**: pengaju biasa cuma liat miliknya (list, detail, docx, export, lampiran);
  verifikator/approver/admin semua. `bankAccountId` dicek milik pengaju (400 `invalid_rekening`).
