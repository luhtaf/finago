# CLAUDE.md — fitur `approval`

> Tunduk ke `../../../CLAUDE.md` (backend) & `../../../../CLAUDE.md` (global). Boleh lebih ketat.

## Tanggung jawab

Fitur ini **memiliki state machine `pengajuan`** sisi approval. Hanya memutasi `pengajuan.state` (tidak pernah ubah `total`, item, dll) + menulis `audit_log` lewat `writeAudit` tiap transisi.

## State machine

```
submitted ─┬─ verify ─→ approved   (kalau total <= APPROVAL_THRESHOLD)
           └─ verify ─→ verified   (kalau total >  APPROVAL_THRESHOLD)
needs_justification ─ verify ─→ approved | verified  (sama seperti submitted)
verified  ─ approve ─→ approved
approved  ─ pay     ─→ paid        (terminal)
submitted | verified ─ return ─→ returned
<non-terminal>       ─ reject ─→ rejected (terminal)
```

- Transisi dari state yang salah → lempar `InvalidTransitionError` → router map ke **HTTP 409**.
- Pengajuan tidak ada → `NotFoundError` → **HTTP 404**.
- Terminal state: `paid`, `rejected` (tidak ada transisi keluar).

## Aturan nominal (CONFIGURABLE)

`const APPROVAL_THRESHOLD = 1_000_000` di `service.ts`. Saat **verify**: `total <= THRESHOLD` → langsung `approved` (verifikator cukup), selain itu → `verified` (masih butuh approver). TODO: pindahkan ke config/DB biar bisa diatur tanpa deploy.

## Endpoints

| Method | Path | Role |
|---|---|---|
| GET  | `/approvals/pending` | — (antrian: submitted, verified, needs_justification) |
| POST | `/pengajuan/:id/verify` | verifikator |
| POST | `/pengajuan/:id/approve` | approver |
| POST | `/pengajuan/:id/reject` | verifikator, approver — body `{ alasan }` |
| POST | `/pengajuan/:id/return` | verifikator, approver — body `{ alasan }` |
| POST | `/pengajuan/:id/pay` | verifikator, admin |

Actor diambil dari `getUser(c).id`. Body `{ alasan }` divalidasi zod (wajib non-kosong) → 400 kalau invalid.

## Catatan

- Tidak menyentuh file di luar folder ini.
- `submit` (draft → submitted) & perhitungan `total` adalah milik fitur `pengajuan`, bukan di sini.
