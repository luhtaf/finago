# FINA go

> Platform pengajuan internal **PT. Karta Bhumi Nusantara** — reimbursement + pengajuan baru (purchase request) dengan alur approval.

<p align="center"><img src="./brand/finago-logo.png" alt="FINA go" width="320"/></p>

## Status

**Production** — dipakai tim Finance sejak Juni 2026. Menggantikan alur manual (Google Form → spreadsheet → ketik FORMULIR .docx).

## Fitur

- **Pengajuan** dengan rincian per item (qty × harga, total dihitung server), lampiran nota, rekening tujuan (bisa >1).
- **Alur approval**: draft → submitted → verified → approved → paid, plus kembalikan (revisi), tolak, buka kembali. Audit trail tiap aksi.
- **Role**: pengaju, verifikator, approver, admin (1 user bisa multi-role). Pengaju cuma lihat pengajuan miliknya.
- **Dokumen**: FORMULIR otomatis (.docx & .xlsx per pengajuan), nomor dokumen `BR<seq><tahun>` otomatis.
- **Rekap Excel** semua pengajuan sesuai filter.
- **Bukti penggunaan dana** bisa ditambahkan walau pengajuan sudah cair.
- **List** dengan pencarian, filter (status, kategori, proyek, tanggal), pagination keyset.
- Kelola user, rekening (verifikasi), master proyek, item dipantau, dashboard.

## Stack

| Bagian | Teknologi |
|---|---|
| FE (`app/`) | Vanilla JS + Alpine.js + Tailwind (CDN) — tanpa build step, mobile-friendly |
| API (`backend/`) | Hono + Drizzle ORM, TypeScript (jalan di Node & Cloudflare Workers) |
| Database | libSQL/SQLite (Turso, atau file SQLite di VPS) |
| File | Cloudflare R2, S3-compatible, atau disk lokal |
| Auth | Email + password → JWT (PBKDF2) |

## Struktur

```
app/                  FE: index.html (semua view), main.js (router), lib/, features/<fitur>.js
backend/src/
  app.ts              definisi API (mount semua fitur)
  index.ts            entry Node (dev / Docker; opsional melayani app/ juga)
  worker.ts           entry Cloudflare Workers
  features/<fitur>/   routes + service per fitur (pengajuan, approval, users, rekening, …)
  shared/             db (schema Drizzle), auth, storage, xlsx, audit
backend/drizzle/      migrasi database
backend/scripts/      migrasi data, backup, export .sql
deploy/hostinger/     docker-compose + Caddy untuk VPS
```

## Jalanin lokal

```bash
cd backend
npm install
env -u DATABASE_AUTH_TOKEN DATABASE_URL=file:./local.db npm run db:migrate
env -u DATABASE_AUTH_TOKEN DATABASE_URL=file:./local.db npm run seed
npm run dev            # API → http://localhost:8787
npm run typecheck
```

FE: buka `app/` lewat static server mana saja (mis. `python3 -m http.server` di folder `app/`) dan arahkan `window.FG_API` di `app/index.html` ke API lokal.

Atau semuanya dalam satu container:

```bash
docker build -t finago .
docker run -p 8787:8787 -e JWT_SECRET=dev-secret -v finago-data:/data finago
# → http://localhost:8787
```

## Deploy

- **Cloudflare** (Pages + Workers + Turso + R2): [`DEPLOY.md`](./DEPLOY.md)
- **VPS / Docker** (Hostinger, dll): [`DEPLOY-HOSTINGER.md`](./DEPLOY-HOSTINGER.md)

## Dokumen lain

- [`FEEDBACK.md`](./FEEDBACK.md) — sumber requirement & catatan keputusan
- [`DOMAIN.md`](./DOMAIN.md) — model domain & aturan bisnis
- [`PLAN-BE.md`](./PLAN-BE.md) — desain backend per endpoint
