# FINA go — backend

Hono + Drizzle + libSQL (Turso). Feature-based. Detail desain: [`../PLAN-BE.md`](../PLAN-BE.md). Guardrail: [`CLAUDE.md`](./CLAUDE.md).

## Jalanin lokal

```bash
npm install
cp .env.example .env        # default DATABASE_URL kosong → file:./local.db
npm run db:generate         # bikin SQL migration dari schema
npm run db:migrate          # apply ke local.db
npm run seed                # master proyek + demo user + rekening verified
npm run dev                 # http://localhost:8787  (tsx watch)
npm run typecheck           # tsc --noEmit
```

## Smoke test (alur create → submit → approve)

```bash
curl localhost:8787/health
curl localhost:8787/projects
# buat pengajuan
curl -X POST localhost:8787/pengajuan -H 'content-type: application/json' -d '{
  "nama":"BBM dan Nitrogen","kodeProyek":"PRO001","kategori":"reimbursement",
  "prioritas":"urgent","tanggal":"2026-06-15","bankAccountId":"bank_demo",
  "items":[{"item":"BBM Pertalite","qty":20,"satuan":"Liter","harga":10000},
           {"item":"Nitrogen","qty":4,"satuan":"Ban","harga":4000}]}'
# → total dihitung server = 216000
curl -X POST localhost:8787/pengajuan/<id>/submit   # anomaly check + emit outbox
curl -X POST localhost:8787/pengajuan/<id>/verify   # ≤1jt → auto approved
curl -X POST localhost:8787/admin/sync/run          # konsumsi outbox → OneDrive (stub)
```

## Yang masih STUB (belum nyata)

| Stub | File | Implement nanti |
|---|---|---|
| Microsoft Graph (OneDrive) | `src/shared/graph/client.ts` | app-only auth + Workbook API + upload |
| Cloudflare R2 | `src/shared/r2/client.ts` | S3 client / R2 binding |
| Auth | `src/shared/auth/index.ts` | session/JWT (sekarang selalu demo user, semua role) |
| Cron sync | `src/features/sync-onedrive/consumer.ts` | `startCron()` (Node) / CF Cron Triggers |

Docx generator (`src/features/pengajuan/docx.ts`) **sudah nyata** (library `docx`) — `npm run docx:sample` bikin contoh ke `/tmp/formulir.docx`. Approver masih konstanta (TODO derive dari approval).
