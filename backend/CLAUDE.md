# CLAUDE.md — backend FINA go

> Guardrail backend. **Tunduk ke `../CLAUDE.md` (global) — gak bisa di-override.** Boleh nambah aturan lebih ketat.

## Stack

Hono + Drizzle + libSQL (Turso). Portable: dev Node (`tsx`), deploy CF Workers/Pages → Docker/K8s tanpa rewrite. Detail: `../PLAN-BE.md`.

## Konvensi struktur (feature-based)

- `src/features/<fitur>/` — `routes.ts` (Hono router, full-path, export `const <fitur>Routes`), `service.ts` (logika + DB), `CLAUDE.md` (cerita fitur).
- `src/shared/` — `db/` (drizzle client + schema), `graph/`, `r2/`, `auth/`, `audit.ts`, `util.ts`.
- Fitur kecil cukup `routes.ts` + `service.ts`; split lebih lanjut PAS udah gede.
- Tiap router di-mount di `src/index.ts` lewat `app.route('/', xRoutes)`.

## Kontrak antar-file (jangan diubah sembarangan)

- DB: `import { db } from '../../shared/db/client'`, tabel dari `'../../shared/db/schema'`.
- ID: `import { newId } from '../../shared/util'`.
- Audit: `import { writeAudit } from '../../shared/audit'` — panggil tiap transisi state.
- Auth: `import { getUser, requireRole } from '../../shared/auth'` (masih STUB, selalu demo user).
- Total pengajuan **dihitung server** (sum `pengajuan_item.subtotal`) — jangan percaya FE.

## ⚠️ Warning lintas-fitur (mirror dari ../CLAUDE.md)

- `pengajuan` `submit` → panggil `checkAnomaly()` dari `monitored-items/service`.
- `pengajuan` → tulis `outbox_events` (`sync_pengajuan`, `upload_docx`) → dikonsumsi `sync-onedrive`. Jangan ubah `type` tanpa update consumer.
- Ubah `schema.ts` (pengajuan/item) → cek mapping di `sync-onedrive` (Workbook columns).

## Status implementasi

- `auth/` **nyata** — login email+password → JWT (`hono/jwt`), middleware `jwtAuth`, scrypt hash. Lihat `features/auth/CLAUDE.md`.
- `pengajuan/docx.ts` **nyata** — library `docx`, .docx FORMULIR valid. Approver masih konstanta (`DIRECTOR_NAME`), TODO derive dari approval.
- `r2/` **S3-compatible** — pakai AWS S3 SDK; default **MinIO** (env `R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET`), fallback FS (`.r2-store/`) kalau env kosong. Pindah ke Cloudflare R2 = ganti endpoint+key, kode sama. Interface `put/get/getUrl/delete`.
- `graph/` **nyata-with-env** — Microsoft Graph app-only; aktif kalau `GRAPH_*` env di-set, no-op+log kalau gak (dev). Butuh Azure app reg buat live.
- TODO: `JWT_SECRET` env di prod; node:crypto → Web Crypto kalau deploy ke Workers.
