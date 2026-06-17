# CLAUDE.md — fitur `auth`

> Tunduk ke `../../CLAUDE.md` (backend) + `../../../CLAUDE.md` (global).

## Cerita fitur

Auth sendiri (own auth), bukan SSO. Login email + password → **JWT** (HS256, `hono/jwt`). FE simpan token, kirim tiap request via `Authorization: Bearer`.

## File

- `password.ts` — hash/verify pakai `node:crypto` scrypt. Format `salt:key`. ⚠️ TODO: di CF Workers `node:crypto` gak ada → ganti Web Crypto (PBKDF2).
- `middleware.ts` — `jwtAuth`: baca Bearer → set `c.get('user')`. Gak nge-block (route publik tetap jalan). `JWT_SECRET` dari env (default dev). Di-`app.use('*')` di `index.ts` sebelum routes.
- `routes.ts` — `POST /auth/login` → `{token, user}`; `GET /auth/me`.

## Kontrak / coupling

- `shared/auth/getUser(c)` baca `c.get('user')` yang di-set `jwtAuth`. Semua fitur pakai `getUser` + `requireRole` — JANGAN ubah bentuk user `{ id, nama, roles }`.
- `users.passwordHash` (kolom DB) diisi `seed.ts` (semua demo user password `fina123`).

## STUB / TODO

- JWT_SECRET masih default dev — set env `JWT_SECRET` di prod.
- Belum ada register/ganti-password endpoint (cukup login buat sekarang).
