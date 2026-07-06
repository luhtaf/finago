# CLAUDE.md — fitur `approval`

> Tunduk ke `../../../CLAUDE.md` (backend) & `../../../../CLAUDE.md` (global). Boleh lebih ketat.

## Tanggung jawab

Fitur ini **memiliki state machine `pengajuan`** sisi approval. Hanya memutasi `pengajuan.state` (tidak pernah ubah `total`, item, dll) + menulis `audit_log` lewat `writeAudit` tiap transisi.

## State machine

```
submitted | needs_justification ─ verify ─→ verified   (set reviewedBy = nama verifikator)
verified  ─ approve ─→ approved   (set approvedBy = nama approver)
approved  ─ pay     ─→ paid        (terminal; ADMIN only)
submitted | verified ─ return ─→ returned
<non-terminal>       ─ reject ─→ rejected (terminal)
```

- **Verify TIDAK auto-approve** (gak ada threshold) — selalu ke `verified`, tombol approve tetap muncul. Approve = langkah terpisah.
- `reviewedBy`/`approvedBy` = **nama aktor** (snapshot, `getUser(c).nama`) → dipakai docx kolom Reviewed/Approved by (dinamis, bukan konstanta).
- Transisi salah → `InvalidTransitionError` → **409**. Gak ada → `NotFoundError` → **404**.
- Terminal: `paid`, `rejected`.

## Endpoints

| Method | Path | Role |
|---|---|---|
| GET  | `/approvals/pending` | — (antrian: submitted, verified, needs_justification) |
| POST | `/pengajuan/:id/verify` | verifikator |
| POST | `/pengajuan/:id/approve` | approver |
| POST | `/pengajuan/:id/reject` | verifikator, approver — body `{ alasan }` |
| POST | `/pengajuan/:id/return` | verifikator, approver — body `{ alasan }` |
| POST | `/pengajuan/:id/pay` | **admin** (pencairan = tanda clear) |

Actor diambil dari `getUser(c).id`. Body `{ alasan }` divalidasi zod (wajib non-kosong) → 400 kalau invalid.

## Catatan

- Tidak menyentuh file di luar folder ini.
- `submit` (draft → submitted) & perhitungan `total` adalah milik fitur `pengajuan`, bukan di sini.
