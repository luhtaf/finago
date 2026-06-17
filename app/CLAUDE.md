# CLAUDE.md — FE app FINA go

> FE asli (production), beda dari `../demo/` (mockup awal). Tunduk ke `../CLAUDE.md` global.

## Stack & pola

Vanilla + Alpine.js + Tailwind (CDN, **no build**). Mobile-friendly wajib. Design system = Satoshi (app) + Newsreader (dokumen FORMULIR), token Tailwind custom di `index.html` (ink/brand/accent/paper/line + radius card/fld/chip). Flat + gradient tipis (total-bar, btn-primary, bg) — bukan gradient di mana-mana.

## Struktur

- `index.html` — shell + semua view sebagai `<template x-if="$store.router.view===...">`. Nav + toast di sini.
- `main.js` — router (hash → `$store.router.{view,id}` + guard auth), `$store.session`, registrasi semua `Alpine.data(...)`. **Tambah view baru** = tambah parseRoute + import factory + `Alpine.data` + template di index.html.
- `lib/config.js` — `API_BASE` (localStorage `fg_api` override).
- `lib/api.js` — fetch wrapper, attach `Authorization: Bearer` dari `auth.token()`, `download()` buat .docx.
- `lib/auth.js` — **auth sendiri**: `login(email,password)` → JWT, simpan localStorage. Swap SSO nanti = ganti file ini.
- `lib/ui.js` — `rp/fmt`, badge status, `toast`.
- `features/<fitur>.js` — tiap view = 1 factory Alpine (`pengajuanList/Form/Detail`, `approvalsQueue`, `rekeningView`, `monitoredView`, `projectsView`). Pakai `api` + `toast`, panggil `this.$nextTick(()=>window.lucide?.createIcons())` setelah render.

## Catatan

- Ganti ES module saat dev → **restart browser** kalau perubahan gak kebaca (modul di-cache agresif).
- Preview FORMULIR = popup modal (tombol "Lihat preview dokumen"), bukan side-by-side, biar rapi + muat di mobile.
- Role gating di FE cuma UX; enforcement asli di backend (`requireRole`).
