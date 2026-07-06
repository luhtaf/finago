# CLAUDE.md — backend FINA go

> Guardrail backend. **Tunduk ke `../CLAUDE.md` (global) — gak bisa di-override.** Boleh nambah aturan lebih ketat.

## Stack

Hono + Drizzle + libSQL (Turso). Portable: dev Node (`tsx`), deploy CF Workers/Pages → Docker/K8s tanpa rewrite. Detail: `../PLAN-BE.md`.

## Konvensi struktur (feature-based)

- `src/features/<fitur>/` — `routes.ts` (Hono router, full-path, export `const <fitur>Routes`), `service.ts` (logika + DB), `CLAUDE.md` (cerita fitur).
- `src/shared/` — `db/` (drizzle client + schema), `graph/`, `r2/`, `auth/`, `audit.ts`, `util.ts`.
- Fitur kecil cukup `routes.ts` + `service.ts`; split lebih lanjut PAS udah gede.
- **Entry runtime**: `src/app.ts` = definisi Hono (mount semua router di sini, `app.route('/', xRoutes)`). `src/index.ts` = entry Node (dev/Render, pakai `@hono/node-server`). `src/worker.ts` = entry Cloudflare Workers (`export default {fetch,scheduled}` + set R2 binding). **JANGAN** import `@hono/node-server` di `app.ts` (biar Worker bundle aman).

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

- `auth/` **nyata** — login email+password → JWT (`hono/jwt`), middleware `jwtAuth`. Hash **PBKDF2 via Web Crypto** (`crypto.subtle`) → jalan di Node DAN Workers. Format `pbkdf2$iter$salt$key`. `hashPassword`/`verifyPassword` **async**.
- `pengajuan/docx.ts` **nyata** — library `docx`, .docx FORMULIR valid. Approver masih konstanta (`DIRECTOR_NAME`), TODO derive dari approval.
- `r2/` **3 mode**: (1) **R2 binding** di Workers (`useR2Binding(env.BUCKET)` dari worker.ts — no key), (2) **S3** di Node (env `R2_ENDPOINT/R2_ACCESS_KEY_ID/...` → MinIO/R2/Supabase), (3) **FS** fallback dev. aws-sdk + node:fs di-import **dinamis** biar Worker bundle aman.
- **Sync mirror = pluggable** via `shared/sync/provider.ts` (`getSyncProvider()`), pilih env **`SYNC_PROVIDER=none|google|microsoft`**. `google/` (Drive+Sheets, service account JWT RS256 Web Crypto, env `GOOGLE_*`) + `graph/` (OneDrive/SharePoint app-only, env `GRAPH_*`, **butuh akun kerja berbayar**). `none` default = no-op. Consumer `sync-onedrive` panggil lewat provider, bukan langsung.
- **Deploy**: Node → Render (`npm run start`). Workers → `wrangler.toml` + `npm run cf:deploy` (R2 binding, secrets via `wrangler secret put`, Cron Trigger buat sync). Lihat `../DEPLOY.md`.
- TODO: `JWT_SECRET` wajib di prod. Di Workers, env dibaca dari `process.env` (butuh `nodejs_compat` — vars+secrets ke-expose ke `process.env`).
