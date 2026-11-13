# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Konteks 30 detik

**FINA go** = app pengajuan reimburse + purchase request internal PT. Karta Bhumi Nusantara. Ngegantiin alur manual lama (Google Form → xlsx "Form responses 1" + docx FORMULIR `BR0xx`). Brand navy `#1e2a8e` + teal `#14b8a6`. Bahasa komunikasi: **Indonesia casual**, rekomendasi konkret + tradeoff singkat.

Status: **LIVE (production)**, dipakai tim Finance. Perubahan = deploy ke user beneran → hati-hati sama skema DB + auth.

## Layout repo

| Folder | Isi |
|---|---|
| `app/` | FE production — vanilla + Alpine.js + Tailwind CDN, **no build**. Lihat `app/CLAUDE.md`. |
| `backend/` | API — Hono + Drizzle + libSQL (Turso). Lihat `backend/CLAUDE.md` + `backend/src/features/<fitur>/CLAUDE.md`. |
| `demo/` | Mockup awal (single-file). **Bukan** production — jangan diedit buat fix bug. |
| `laporan/` | Laporan perbaikan buat user (dokumen, bukan kode). |
| `DOMAIN.md`, `FEEDBACK.md`, `PLAN-BE.md`, `DEPLOY.md` | Data model, requirement user, rencana BE, panduan deploy. |

## Hosting (all-Cloudflare)

```
FE  app/      → Cloudflare Pages, project "finago"  → https://finago-3r7.pages.dev (pakai URL utama, bukan <hash>.…)
API backend/  → Cloudflare Workers "finago-api"     (entry src/worker.ts, URL di window.FG_API di app/index.html)
DB            → Turso (libSQL)    — kredensial di backend/.env (gitignored)
Storage       → Cloudflare R2 bucket "finago" via binding BUCKET (gak pakai access key di Workers)
Cron          → Workers Cron Trigger */5 → sync outbox (no-op selama SYNC_PROVIDER=none)
```

Render / Docker masih didukung (`src/index.ts`, `npm run start`) tapi **tidak dipakai** sekarang. `DEPLOY.md` bagian Render = alternatif.

## Commands

Semua dari `backend/`:

```bash
npm run dev            # API lokal Node (tsx watch) → http://localhost:8787, DB default file:./local.db, storage .r2-store/
npm run typecheck      # tsc --noEmit — satu-satunya "test" otomatis; WAJIB lolos sebelum deploy
npm run db:generate    # bikin migrasi dari schema.ts (drizzle-kit; bisa interaktif kalau ada rename)
npm run seed           # seed project/user/rekening — lihat ⚠️ seed di bawah
npm run docx:sample    # generate contoh FORMULIR .docx
npx wrangler deploy --dry-run --outdir /tmp/x   # cek bundle Workers tanpa deploy
```

Gak ada test suite / linter. Verifikasi = `typecheck` + dry-run bundle + smoke test `curl` ke server lokal (login dulu `POST /auth/login`, lalu `Authorization: Bearer`).

**Deploy** (outward-facing, konfirmasi user dulu):
1. Skema berubah → `npm run db:generate`, lalu migrate ke Turso: `set -a; source .env; set +a; npm run db:migrate`.
2. API: `npm run cf:deploy`.
3. FE: dari root, `npx wrangler pages deploy app --project-name finago --commit-dirty=true`.

⚠️ `drizzle.config.ts` + `.env` nunjuk **Turso prod**. Buat migrate/seed lokal override eksplisit: `env -u DATABASE_AUTH_TOKEN DATABASE_URL=file:./local.db npm run db:migrate`.

⚠️ FE lokal: `app/index.html` hardcode `window.FG_API` = Worker prod, dan itu menang atas `localStorage.fg_api`. Mau FE lokal nembak API lokal → kosongin `FG_API` sementara (jangan ke-commit).

## Arsitektur yang perlu baca banyak file buat ngerti

- **Runtime ganda, satu app**: `backend/src/app.ts` (Hono, runtime-agnostic) dipakai `index.ts` (Node) dan `worker.ts` (Workers). Di Workers: env baru ada pas request → `worker.ts` `bridgeEnv(env)` nyalin ke `process.env`; db client (`shared/db/client.ts`) lazy via Proxy; `aws-sdk`/`node:fs` di-import dinamis. **Jangan** baca env / bikin client di top-level module.
- **Auth**: login email+password → JWT HS256 (7 hari, payload `{sub,nama,roles}`). `jwtAuth` set `c.get('user')`, `requireAuth` global → 401 tanpa token valid (kecuali `/health`, `/auth/login`), `requireRole(...)` per route. FE (`app/lib/auth.js` + `api.js`) auto-logout kalau token expired atau server balas 401. Prod tanpa `JWT_SECRET` = fail closed.
- **Aturan bisnis (dikonfirmasi user 2026-11-13)**: approver/verifikator **boleh** verify + approve pengajuannya sendiri (Adinda = Finance, pegang semua role). Jangan "fix" ini jadi separation-of-duties tanpa diminta.
- **Alur state pengajuan**: `draft → submitted | needs_justification → verified → approved → paid`, cabang `returned` (balik ke draft saat diedit) / `rejected`, `reopen` balikin ke `prevState`. Transisi draft/submit/justify di `features/pengajuan/service.ts`; sisanya di `features/approval/service.ts`. Tiap transisi `writeAudit`.
- **NBR** `BR<seq3><tahun>` = posisi dalam tahun; delete pengajuan **merenumber** NBR lain se-tahun (batch tunggal — Workers punya limit subrequest, jangan pakai transaksi interaktif per-baris).
- **Lampiran**: `POST /uploads` → key `nota/nota_<id>.<ext>` di R2. `pengajuan.nota_url` (nota saat pengajuan, ikut di-embed ke docx) dan `pengajuan.bukti_url` (bukti penggunaan dana, ditambah setelah jalan/cair) sama-sama JSON array of key. FE nampilin lewat `api.blobUrl('/uploads/file?key=')` karena `<img>` gak bisa kirim header auth.
- **Output**: docx FORMULIR (`features/pengajuan/docx.ts`, library `docx`) + export rekap `.xlsx` (`features/pengajuan/export.ts` + `shared/xlsx.ts`, writer minimal di atas `jszip`).

## Konvensi struktur kode (feature-based) + aturan WARNING

Arsitektur: **vertical slice / feature-based**, bukan layer-based (jangan misah global `controllers/` `models/`).

- `backend/src/features/<fitur>/` — semua file fitur ngumpul (routes, service, docx, export…). Tiap folder fitur punya **`CLAUDE.md` sendiri** — update kalau nambah endpoint/tabel.
- FE: `app/features/<fitur>.js` = 1 factory Alpine per view.
- **Jangan paksa ceremony**: fitur kecil cukup 1 file. Split pas udah gede.
- `backend/src/shared/` — db (Drizzle), auth, r2, sync provider, xlsx, audit.
- Domain baru yang beneran beda → **repo lain** (polyrepo).

**Hierarki guardrail:** CLAUDE.md utama ini = **guardrail GLOBAL**, gak bisa di-override oleh CLAUDE.md fitur. CLAUDE.md fitur cuma boleh **nambah aturan lebih ketat**. Konflik → global menang.

**ATURAN WARNING (wajib):** semua warning lintas-fitur WAJIB ditulis di sini (boleh double dengan CLAUDE.md fitur): kupling antar-fitur, job/cron, flow nyambung. Tunjuk **benda verifiable** (nama tabel / event / cron / route), bukan deskripsi implementasi.

### ⚠️ Warning lintas-fitur aktif

- `pengajuan` ⇄ `sync-onedrive`: ubah skema tabel `pengajuan`/`pengajuan_item` → cek mapping kolom di `sync-onedrive/consumer.ts` + provider (Sheets/Workbook).
- `sync-onedrive`: **cron** (`wrangler.toml [triggers]`) baca tabel `outbox_events` → provider. Jangan ubah `type` (`sync_pengajuan`, `upload_docx`) / `payload` tanpa update consumer. Idempotent pakai `nbr` — padahal delete me-renumber `nbr` (lihat Masalah terbuka).
- `monitored-items` = flag boolean `pengajuan_item.monitored`, toggle via `POST /pengajuan-items/:itemId/monitor {on}`. `GET /monitored-items` = item ber-flag lintas pengajuan. `PATCH /pengajuan/:id` me-replace item (id baru) dan **membawa flag by nama item** — jangan hapus logika itu.
- Migrasi: kolom `monitored_item_id` + tabel `monitored_items` = **dead** (sisa model lama). TODO regen `drizzle/` pas skema stabil.
- `pengajuan.total` dihitung & di-store di service (sum `pengajuan_item.subtotal`) — jangan percaya angka dari FE.
- `pengajuan.bukti_url` (migrasi `0004_bukti_url`) dipakai `POST /pengajuan/:id/bukti`, detail FE, dan kolom "Jml Bukti" di export xlsx. Belum ikut ke docx / sync.
- Kolom export xlsx (`features/pengajuan/export.ts`) dipakai Finance sebagai pengganti sheet lama — ubah urutan/nama kolom = kabarin user.
- ⚠️ `backend/src/shared/db/seed.ts` `onConflictDoUpdate` **reset password** user yang ada ke `fina123`. Jangan jalanin seed ke Turso prod. Nambah user prod = `POST /users` di API live (login admin).

## Masalah terbuka (dari code review 2026-11-13, belum di-fix — butuh keputusan user)

- **Renumber NBR saat delete** bikin `docx_files.r2_key` (`pengajuan/<NBR>.docx`) + file/baris sync nunjuk NBR lama → objek R2 bisa ketimpa pengajuan baru dengan nomor yang sama. Opsi: stop renumber (soft-delete / void) atau key docx pakai `id`.
- **Visibilitas**: `GET /pengajuan`, `/pengajuan/:id`, `/uploads/file` bisa dibaca semua user login (termasuk no. rekening & nota orang lain). `bankAccountId` gak dicek milik pengaju.
- **Race `nextNbr`**: create bersamaan bisa dapet NBR sama → 500 unique. Ganti tahun di edit gak ganti NBR.

## Data contoh (di `../`, di luar repo)

`../BR001_*.docx` (template output FORMULIR) + `../Salinan dari Pengajuan*.xlsx` (sheet "Form responses 1", "Detail Item", "REKAP COP") — sudah di-mock, **boleh dibaca** (unzip XML). **Jangan di-commit** (`.gitignore` sudah nge-block `*.docx`/`*.xlsx`).

## Jangan dilakukan

- ❌ Campur konteks dengan `../new-hydro-canal/` (sister app, reference design). Pertanyaan HydroCanal → minta pindah sesi.
- ❌ Scaffold React / build step di FE. Stack = vanilla + Alpine.
- ❌ Fallback "demo user" atau trust header `X-User-*` di auth.
- ❌ Deploy / migrate prod / seed prod tanpa konfirmasi user.
