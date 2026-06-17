# CLAUDE.md — fitur `projects`

> Tunduk ke `../../../CLAUDE.md` (backend) + `../../../../CLAUDE.md` (global).

## Cerita fitur

Master **kode unik / REKAP COP** (mis. `PRO001`, `BIM001`, `ADM`, `HR`). Setiap pengajuan wajib nunjuk satu proyek lewat `pengajuan.kodeProyek` (FK → `projects.kode`). Fitur ini cuma CRUD master-nya: list, bikin, dan aktif/non-aktifin.

## Aturan

- `kode` adalah **PK** (bukan auto-id). Bikin proyek dengan kode bentrok → gagal di level DB → route balikin `409`.
- Non-aktif itu **soft** (`active=false`), bukan delete. Proyek lama tetap FK valid buat pengajuan yang sudah ada; cuma ga muncul di daftar default lagi.
- List default **hanya `active=true`**; `?includeInactive=1` buat ikut yang non-aktif.
- Create + toggle aktif = role **`admin`**.

## Endpoints (full-path, mounted di `/`)

| Method | Path | Role | Body |
|---|---|---|---|
| GET | `/projects` | login | — (query `?includeInactive=1`) |
| POST | `/projects` | admin | `{ kode, deskripsi }` |
| PATCH | `/projects/:kode` | admin | `{ active }` |

## Tabel yang disentuh

- `projects` — read/write (list, insert, update `active`).
- `audit_log` — via `writeAudit` (action: `create`, `activate`, `deactivate`).

## Konsumen

- `pengajuan` → `pengajuan.kodeProyek` referensi ke `projects.kode`. Jangan rename/delete proyek yang masih dipakai pengajuan (pakai non-aktif aja).
