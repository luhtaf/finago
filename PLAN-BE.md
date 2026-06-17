# PLAN-BE — FINA go backend

> Keputusan arsitektur + skema + endpoint. Sumber kebenaran teknis backend. Update saat ada perubahan desain.
> Baca dulu: `CLAUDE.md` (guardrail global + konvensi struktur), `DOMAIN.md` (kalau udah ada), data model di `CLAUDE.md` section "Data model nyata".

## Status

Phase 0 — planning. Belum ada kode. Demo FE (`demo/index.html`) udah jalan sebagai acuan alur.

## Prinsip pemilihan stack

Requirement utama bukan "platform tertentu", tapi **portabilitas**: murah/gratis sekarang (belum ada VPS), bisa pindah ke Docker/K8s/on-prem nanti **tanpa rewrite**. Jadi: jangan ngunci ke runtime/DB yang gak bisa di-self-host.

## Stack final

| Layer | Pilihan | Alasan |
|---|---|---|
| FE | vanilla + Alpine + Tailwind (no build) | CF Pages / Netlify, drag-deploy. Pattern dari demo. |
| API | **Hono** | Handler sama jalan di CF Workers/Pages, Node, Bun, Vercel, Netlify, Docker. Ganti adapter doang → zero rewrite pas pindah ke Docker/K8s. |
| ORM | **Drizzle** | Edge-friendly (bundle kecil), support libSQL **dan** Postgres. Catatan: schema per-dialect (`sqliteTable` vs `pgTable`) — migrasi engine = rewrite definisi tabel, bukan query. |
| DB | **Turso / libSQL** | SQLite-at-edge, HTTP-native (langsung jalan di Workers, gak butuh pooler). Free tier sekarang → self-host `sqld` di Docker/K8s nanti. ACID + transaction (aman buat duit/approval). |
| File hot | **Cloudflare R2** | S3-compatible, free tier. Asset yang sering diakses (docx baru, preview nota). Self-host nanti = MinIO. |
| File cold | **OneDrive (M365)** via Microsoft Graph | Arsip permanen (requirement: file harus ada di OneDrive). Diisi **async**, gak real-time. |
| Docx gen | **`docx` (dolanmiu)** | Bangun FORMULIR dari kode (deterministik, no template-binary). Pure JS, jalan di Workers juga. (sebelumnya docxtemplater — ditukar karena gak ada template Word) |
| Sync/job | CF Cron Triggers + Queues (atau cron/BullMQ kalau udah Node) | Consumer outbox → Graph. |

**Kapan pindah ke Postgres:** kalau butuh laporan/analytic berat, banyak modul nyambung (jadi ERP), atau concurrent-write tinggi. Sampai situ migrasi SQL-nya kecil. Sebelum itu, Turso menang di ops (solo engineer).

## Struktur folder (feature-based — lihat guardrail di CLAUDE.md)

```
backend/
  features/
    pengajuan/        CLAUDE.md · routes · model · service · docx.ts
    approval/         CLAUDE.md · routes · service
    rekening/         CLAUDE.md · routes · service   (bank account + verifikasi)
    monitored-items/  CLAUDE.md · routes · service   (anomaly detection)
    projects/         CLAUDE.md · routes            (master kode unik / REKAP COP)
    sync-onedrive/    CLAUDE.md · consumer.ts        (cron, baca outbox → Graph; gak ada route publik)
  shared/
    db/               drizzle client + schema
    graph/            Microsoft Graph client (auth app-only, workbook, upload)
    r2/               R2 client
    auth/             session / role guard
```

## Alur data inti (outbox → R2 hot → OneDrive cold)

```
submit pengajuan
  → tulis ke DB (pengajuan + pengajuan_item) dalam 1 transaction
  → generate docx (docxtemplater) → simpan ke R2 (instan, user dapat link cepat)
  → tulis outbox_event { type:'sync_pengajuan' } + { type:'upload_docx' }
[cron 5 menit] sync-onedrive consumer:
  → baca outbox_event status='pending'
  → Graph: append/upsert row ke spreadsheet OneDrive (Workbook API)
  → Graph: upload docx dari R2 ke folder OneDrive → simpan webUrl ke record
  → tandai event 'done' (idempotent pakai NBR sebagai key)
R2 lifecycle rule: file hapus otomatis setelah 30 hari (rumah permanen = OneDrive)
```

Kenapa outbox: OneDrive boleh telat/down tanpa ngerusak transaksi utama. Graph terisolasi di job async, gak pernah di jalur request.

## Skema DB (Drizzle / libSQL) — turunan dari data model nyata

```
projects        kode(PK) · deskripsi · active                         (REKAP COP)
users           id · nama · email · role · department
bank_accounts   id · user_id(FK) · bank_name · number · holder_name
                · status(verified|pending|rejected) · is_default
                · attachment_url · verified_by · verified_at          (hybrid verify)
pengajuan       id · nbr(unique, BR0xx) · tanggal · kode_proyek(FK)
                · kategori(reimbursement|pengajuan_baru)
                · prioritas(urgent|not_urgent) · nama · total
                · pengaju_id(FK) · bank_account_id(FK) · nota_url
                · state(draft|submitted|verified|approved|rejected|paid)
                · created_at
pengajuan_item  id · pengajuan_id(FK) · item · qty · satuan · harga · subtotal  (Detail Item)
monitored_items id · name · category · last_event_at · expected_interval_days
                · owner_department · watched_by(json)                 (anomaly — FEEDBACK.md)
outbox_events   id · type · payload(json) · status(pending|done|failed)
                · attempts · created_at · processed_at
docx_files      id · pengajuan_id(FK) · r2_key · onedrive_url · status
audit_log       id · entity · entity_id · action · actor_id · meta(json) · at
```

`total` di-store hasil sum `pengajuan_item.subtotal` (hitung di service, simpan, jangan percaya FE).

## Endpoint per fitur

```
features/pengajuan
  POST   /pengajuan                 buat draft (+ items)
  GET    /pengajuan                 list (filter: kategori, state, proyek)
  GET    /pengajuan/:id
  PATCH  /pengajuan/:id             edit draft
  POST   /pengajuan/:id/submit      draft → submitted (trigger anomaly check)
  GET    /pengajuan/:id/docx        link docx (R2 / OneDrive)

features/approval
  GET    /approvals/pending         antrian verifikator/approver
  POST   /pengajuan/:id/verify
  POST   /pengajuan/:id/approve
  POST   /pengajuan/:id/reject      (+ alasan)

features/rekening
  GET    /me/bank-accounts
  POST   /me/bank-accounts          (status awal pending)
  POST   /bank-accounts/:id/verify  (Finance/HR)

features/monitored-items
  GET    /monitored-items
  POST   /monitored-items
  GET    /pengajuan/:id/anomaly     hasil cek flag merah

features/projects
  GET    /projects                  master kode unik

features/sync-onedrive
  (cron consumer, no public route)
  GET    /admin/sync/status         observabilitas outbox
```

## Setup sekali (Microsoft Graph)

- Azure AD **app registration** di tenant M365 perusahaan → dapat client ID + secret + tenant ID.
- **App-only auth** (client credentials), permission `Files.ReadWrite.All` (atau `Sites.ReadWrite.All`), admin consent sekali.
- Wajib **OneDrive for Business / SharePoint (M365)**, bukan OneDrive personal (personal gak support app-only).
- Simpan secret di CF secret / env.

## Masih open (lihat FEEDBACK.md "Pertanyaan terbuka")

- Approval rule: by amount? by kategori? by role? (nentuin state machine `approval`)
- Role hierarchy: berapa level?
- Multi-currency? (sekarang asumsi IDR)
- SLA pencairan + retensi audit.
