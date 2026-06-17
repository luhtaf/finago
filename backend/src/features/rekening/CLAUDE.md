# CLAUDE.md — fitur `rekening`

> Tunduk ke `../../../CLAUDE.md` (backend) + `../../../../CLAUDE.md` (global).

## Cerita fitur

Kelola rekening bank user untuk tujuan transfer reimburse. Model **hybrid verify**: user input sendiri, finance (verifikator/admin) yang verifikasi.

## Hybrid verify flow

1. User tambah rekening → status **`pending`** (selalu, ga bisa di-skip).
2. Verifikator/admin memutuskan → **`verified`** atau **`rejected`**. Saat itu di-set `verifiedBy` (actor) + `verifiedAt` (now).
3. **Reset-to-pending on edit**: kalau user ubah `number` / `bankName` / `holderName` (identitas rekening), status otomatis balik ke `pending` + `verifiedBy`/`verifiedAt` di-clear. Ini anti swap-fraud — biar ga bisa verify rekening A lalu diam-diam ganti ke rekening B. Ubah `isDefault`/`attachmentUrl` saja TIDAK reset status.

## Aturan lain

- `isDefault=true` → otomatis unset `isDefault` di semua rekening lain milik user (1 default per user).
- Edit hanya boleh rekening milik sendiri (`updateAccount` cek `userId`, else error → 403).
- **Hanya rekening `verified` yang boleh dipakai reimburse.** Enforcement ada di fitur `pengajuan` (saat set `bankAccountId`), BUKAN di sini.

## Endpoints (full-path, mounted di `/`)

| Method | Path | Role | Body |
|---|---|---|---|
| GET | `/me/bank-accounts` | login | — |
| POST | `/me/bank-accounts` | login | `{ bankName, number, holderName, isDefault?, attachmentUrl? }` |
| PATCH | `/me/bank-accounts/:id` | pemilik | sama dengan POST |
| POST | `/bank-accounts/:id/verify` | verifikator/admin | `{ decision: 'verified'\|'rejected' }` |

## Tabel yang disentuh

- `bank_accounts` — read/write (CRUD + verify).
- `audit_log` — via `writeAudit` (create, update / update_reset_pending, verify, reject).

## Catatan

- Auth masih STUB (`getUser` balikin demo user dengan semua role) — verify bisa di-test langsung.
