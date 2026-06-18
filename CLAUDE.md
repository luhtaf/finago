# CLAUDE.md — FINA go

> Instruksi untuk Claude saat sesi baru di repo ini. Baca sebelum mulai apa-apa.

## Konteks 30 detik

**FINA go** = app pengajuan reimburse + purchase request internal PT. Karta Bhumi Nusantara. Sister app dari `../new-hydro-canal/` (QC kanal). Brand navy + teal. Stack vanilla + Alpine.js + Tailwind (no build).

Status: Phase 0 planning. **Belum ada kode produksi, belum ada demo.**

## Sebelum kerja apa-apa, baca

Urutan baca (kalau dokumen-nya ada):

1. `README.md` — overview brand + stack + tujuan
2. `FEEDBACK.md` — sumber requirement (file user + interview)
3. `DOMAIN.md` — data model pengajuan + approval + budget
4. `PLAN.md` — roadmap fase
5. `PLAN-FE.md` — frontend per page
6. `PLAN-BE.md` — backend per endpoint

Kalau file di atas BELUM ADA → user baru mulai planning, bantu nulis sesuai urutan.

## Pattern dari sister app

Demo HydroCanal di `../new-hydro-canal/demo/` adalah **reference design**. Reuse pattern-nya:

| Pattern | File reference | Kapan dipakai di FINA go |
|---|---|---|
| Single-file SPA (HTML + CSS + JS terpisah) | `demo/index.html`, `app.js`, `style.css` | Selalu — struktur dasar demo |
| Hash routing | `demo/app.js` (function `route()`) | Multi-page navigation |
| Template `<template id="view-*">` | `demo/index.html` | Per page |
| Dark mode toggle | `demo/style.css` section "DARK MODE" | Selalu |
| ⌘K command palette | `demo/app.js` (CMD_ITEMS array) | Production-feel |
| Role pill switcher | `demo/app.js` (`applyRole`, `setRole`) | Karena ada banyak role di FINA go |
| Toast notifications | `demo/app.js` (function `toast`) | Selalu |
| Confirmation modal | `demo/app.js` (`confirmDialog`) | Destructive actions |
| Walkthrough tour | `demo/app.js` (TOUR_STEPS) | Onboarding |
| Status badge dot dengan pulse | `demo/style.css` (`.badge-dot`) | Status pengajuan |

**Filosofi**: jangan reinvent. Copy struktur, swap konten + warna.

## Brand swap

HydroCanal pakai sky `#0284c7`. FINA go pakai navy `#1e2a8e` + teal `#14b8a6`. Refactor pattern:

```js
// Di tailwind.config (di index.html)
colors: {
  brand: { 500: '#1e2a8e', 600: '#1a247a', 700: '#152066' /* navy */ },
  accent: { 500: '#14b8a6', 600: '#0d9488' /* teal */ },
}
```

Logo: `brand/finago-logo.png` — dipakai di splash + login + top nav (mini).

## Data model nyata (dari file contoh — sudah di-mock, BOLEH dibaca)

File contoh ada di parent dir `../` (bukan di repo): `BR001_*.docx` + `Salinan dari Pengajuan*.xlsx`. Sudah di-mock Fathul (row 1–2 + sheet Detail diubah), aman dibaca. Cara baca: unzip XML (lihat git log / minta Claude extract), jangan butuh tool eksternal.

**Sumber kebenaran data hari ini (manual, mau digantikan FINA go):**

1. **xlsx sheet "Form responses 1"** = master log pengajuan. 1 row = 1 pengajuan. Kolom penting:
   `Tanggal | Kode Unik (proyek) | Status (Urgent/Not Urgent) | Nama Pengaju | Kategori (Reimbursement | Pengajuan Baru) | Nama Pengajuan | Total Pengajuan | Upload Nota | Nomor Rekening | NBR (BR001…) | Approval | Document Studio file link`
   ⚠️ Masalah lama: rincian item di-mash jadi free-text di `Nama Pengajuan` (`"1. Konsumsi Rp 1jt\n2. BBM Rp 1jt…"`) → susah dihitung & diaudit.
2. **xlsx sheet "Detail Item"** = breakdown per item: `NBR | Item | Jumlah | Satuan | Harga`. **Ini struktur target form** (line-item, bukan free-text).
3. **xlsx sheet "REKAP COP"** = master kode proyek: `PRO001` = APP Group QC Canal OKI, `BIM001` = Grand Makarti Jaksel, dll. Kode Unik di pengajuan refer ke sini.
4. **`BR001_*.docx`** = **template OUTPUT**. `FORMULIR Reimbursement`, tabel `No | Rincian Anggaran | Kuantitas | Sat. | Jumlah | Remark`, `TOTAL Rp…`, `Dikirim ke Rekening`, `Prepared & Requested by` / `Approved by`.

**Requirement inti (Fathul, 2026-06-13):** ganti alur lama → **satu form dengan line-item table (mirip sheet "Detail Item")** → **auto-sum Total** → **generate docx FORMULIR** sebagai output. NBR (nomor dokumen BR0xx) auto-increment. Mockup dulu sebelum wiring backend.

## Konvensi struktur kode (feature-based) + aturan WARNING

Arsitektur: **vertical slice / feature-based**, bukan layer-based (jangan misah global `controllers/` `models/`).

- `backend/features/<fitur>/` — semua file fitur ngumpul (routes, model, service, docx, dll). Subfitur = subfolder di dalamnya.
- Tiap folder fitur punya **`CLAUDE.md` sendiri** — nyeritain fitur itu lengkap (tabel, job/cron, endpoint) biar context AI ringan walau codebase gede.
- FE sama polanya: `features/<fitur>/` pas keluar dari fase demo single-file (vanilla no-build tetep bisa via ES module `<script type=module>`).
- **Jangan paksa ceremony**: fitur kecil cukup 1 file. Split controller/model/service PAS udah gede, bukan di depan.
- `backend/shared/` — db client (Drizzle), graph client, r2, auth.
- Domain baru yang beneran beda → **repo lain** (polyrepo), bukan dijejelin ke sini.

**Hierarki guardrail (penting):** CLAUDE.md utama ini = **guardrail GLOBAL**, berlaku ke semua fitur dan **gak bisa di-override / di-ignore** oleh CLAUDE.md fitur. CLAUDE.md per fitur cuma boleh **nambah aturan yang lebih ketat** buat fitur itu — gak boleh ngelonggarin yang global. Kalau konflik → **global menang**.

**ATURAN WARNING (wajib, biar gak ke-miss):** semua warning lintas-fitur WAJIB ditulis di **CLAUDE.md UTAMA ini** (boleh double dengan CLAUDE.md fitur). Yang wajib naik ke sini: kupling antar-fitur, job/cron, dan flow nyambung. Tulis nunjuk **benda verifiable** (nama tabel / event / cron), bukan deskripsi implementasi (biar gak drift).

### ⚠️ Warning lintas-fitur aktif
Direncanakan di `PLAN-BE.md` (jadi wajib dipatuhi pas implementasi):
- `pengajuan` ⇄ `sync-onedrive`: ubah skema tabel `pengajuan`/`pengajuan_item` → cek mapping kolom di consumer sync + Workbook API.
- `sync-onedrive`: ada **cron** baca tabel `outbox_events` → Graph API. Jangan ubah `type`/`payload` event tanpa update consumer. Idempotent pakai `nbr`.
- `monitored-items` itu **flag boolean sederhana** `pengajuan_item.monitored` (bukan master/interval/fuzzy). Verifikator toggle on/off lewat `POST /pengajuan-items/:itemId/monitor {on}`. `GET /monitored-items` = daftar item ber-flag (lintas pengajuan). `checkAnomaly` masih ada (dipakai submit) tapi gak auto-flag.
- ⚠️ Migrasi belum bersih: kolom `pengajuan_item.monitored` ditambah manual (ALTER) ke `local.db`; `monitored_item_id` + tabel `monitored_items` jadi **dead** (sisa model lama). TODO: regen `drizzle/` dari nol pas skema stabil.
- `pengajuan.total` di-hitung & di-store di service (sum `pengajuan_item.subtotal`) — jangan percaya angka dari FE.

## Yang belum jelas — tanya user

Saat user request demo / planning, klarifikasi dulu:

1. **Role hierarchy**: berapa level? (mis. Karyawan → Manager → Finance → Director, atau cukup 3 level?)
2. **Approval rule by amount**: apakah > X jt = wajib director? Configurable per nominal?
3. **Budget categories**: ada kah master kategori (BBM, makan dinas, alat, software, dll)?
4. **Attachment requirement**: receipt wajib untuk reimburse? Quotation untuk purchase?
5. **Notifikasi**: push notif/email saat status berubah?
6. **Integrasi accounting**: perlu export untuk SAP/sistem accounting? Atau standalone?

## Jangan dilakukan

- ⚠️ File `BR001_*.docx` + `Salinan dari Pengajuan*.xlsx` (di `../`) sekarang **sudah di-mock & boleh dibaca** (lihat section "Data model nyata"). Tetap jangan commit file-nya ke repo — sensitive-format, simpan di luar tracking.
- ❌ Jangan campur konteks dengan `../new-hydro-canal/`. Kalau user nanya tentang HydroCanal, ingatkan untuk pindah sesi ke folder itu.
- ❌ Jangan langsung scaffold React. Stack target adalah vanilla + Alpine.

## Filosofi (sama dengan HydroCanal)

- Bahasa Indonesia casual untuk komunikasi
- Rekomendasi konkret + tradeoff singkat, bukan jawaban hedge
- Demo dulu sebelum production
- AI-context-aware: docs di-split per concern
- Polyrepo: standalone repo, pattern dari sister app boleh di-reuse

## Resume sesi

Kalau sesi baru:

1. Cek dokumen di list "Sebelum kerja apa-apa" → ada apa, belum ada apa
2. Tanya user: mau lanjutin dari mana? (planning, demo build, refactor demo, dll)
3. Kalau planning → bantu nulis file selanjutnya sesuai urutan
4. Kalau demo build → mulai dari `demo/index.html` + `app.js` + `style.css`, copy pattern dari `../new-hydro-canal/demo/`
