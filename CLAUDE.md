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

## Yang belum jelas — tanya user

Saat user request demo / planning, klarifikasi dulu:

1. **Role hierarchy**: berapa level? (mis. Karyawan → Manager → Finance → Director, atau cukup 3 level?)
2. **Approval rule by amount**: apakah > X jt = wajib director? Configurable per nominal?
3. **Budget categories**: ada kah master kategori (BBM, makan dinas, alat, software, dll)?
4. **Attachment requirement**: receipt wajib untuk reimburse? Quotation untuk purchase?
5. **Notifikasi**: push notif/email saat status berubah?
6. **Integrasi accounting**: perlu export untuk SAP/sistem accounting? Atau standalone?

## Jangan dilakukan

- ❌ Jangan baca file `BR001_*.docx` atau `Salinan dari Pengajuan*.xlsx` tanpa user explicit minta. Itu data asli karyawan, sensitive.
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
