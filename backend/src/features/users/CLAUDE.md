# CLAUDE.md — fitur `users`

> Tunduk ke `../../CLAUDE.md` (backend) + `../../../CLAUDE.md` (global).

## Cerita fitur

Kelola user (CRUD ringan) untuk admin/approver: lihat daftar user, bikin user baru, edit profil/role/password. Bukan self-service register — ini panel admin. Auth sendiri tetap di fitur `auth`.

## File

- `service.ts` — `listUsers` / `createUser` / `updateUser`. Password di-hash pakai `hashPassword` dari `../auth/password` (scrypt). Semua return **tanpa `passwordHash`** (bentuk `SafeUser`). Email selalu di-lowercase + trim saat create.
- `routes.ts` — Hono router, export `const usersRoutes`. Semua route `requireRole('admin','approver')`.

## Endpoints (full-path, mounted di `/`)

| Method | Path | Role | Body |
|---|---|---|---|
| GET | `/users` | admin/approver | — |
| POST | `/users` | admin/approver | `{ nama, email, password, roles[], department? }` |
| PATCH | `/users/:id` | admin/approver | `{ nama?, department?, roles?, password? }` |

- POST: email duplikat → **409** `{ error: 'email sudah dipakai' }`. Sukses → **201**.
- PATCH: user gak ketemu → **404**. Hanya field yang dikirim yang di-update; `password` non-empty → re-hash.

## Tabel yang disentuh

- `users` — read/write. `roles` json `Role[]` (`pengaju|verifikator|approver|admin`).
- `audit_log` — via `writeAudit` (entity `'user'`, action `create` / `update`).

## Catatan

- ⚠️ Route **belum di-mount**. Parent (`src/index.ts`) yang mount: `app.route('/', usersRoutes)`.
- Auth masih STUB (`getUser` balikin demo user dengan semua role) — endpoint bisa di-test langsung.
- `passwordHash` tidak pernah keluar dari service (select kolom eksplisit).
