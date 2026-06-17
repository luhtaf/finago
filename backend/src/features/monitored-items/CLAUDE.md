# CLAUDE.md — fitur `monitored-items`

> Tunduk ke `../../../CLAUDE.md` (backend) + `../../../../CLAUDE.md` (global).

## Cerita fitur

Deteksi anomali pengajuan. **Monitored item** = barang/aset yang punya pola pakai wajar (mis. ganti oli kendaraan tiap 90 hari, beli toner printer, lisensi software tahunan). Kalau ada pengajuan yang nyebut barang ini terlalu cepat dari interval normalnya → kemungkinan double-claim / pengajuan ganda → di-flag biar verifikator waspada.

## Konsep 3 layer

1. **Layer 1 — match**: cocokin item pengajuan ke daftar monitored item (substring + token-overlap, dependency-free; lihat TODO buat fuzzy beneran).
2. **Layer 2 — interval check**: kalau cocok DAN `lastEventAt` + `expectedIntervalDays` terisi DAN umur event terakhir < `expectedIntervalDays * 0.5` hari → push reason.
3. **Layer 3 — justifikasi**: BUKAN di sini. Hidup di flow `pengajuan` submit — kalau `checkAnomaly` balikin `flagged: true`, pengajuan masuk state `needs_justification` dan pengaju diminta kasih alasan. Fitur ini cuma sediakan sinyalnya.

## Kontrak ekspor (JANGAN diubah sembarangan)

```ts
export async function checkAnomaly(pengajuanId: string): Promise<{ flagged: boolean; reasons: string[] }>
```

⚠️ Fitur `pengajuan` meng-import `checkAnomaly` saat submit. Signature ini bagian dari kontrak lintas-fitur — ubah = update consumer `pengajuan/service`.

## Endpoints (full-path, mounted di `/`)

| Method | Path | Role | Body |
|---|---|---|---|
| GET | `/monitored-items` | login | — |
| POST | `/monitored-items` | admin/verifikator | `{ name, category?, lastEventAt?, expectedIntervalDays?, ownerDepartment?, watchedBy? }` |
| PATCH | `/monitored-items/:id` | admin/verifikator | partial dari POST |
| GET | `/pengajuan/:id/anomaly` | login | — → `{ flagged, reasons }` |

## Tabel yang disentuh

- `monitored_items` — read/write (CRUD).
- `pengajuan` + `pengajuan_item` — read-only (bahan haystack di `checkAnomaly`).
- `audit_log` — via `writeAudit` (entity `monitored_item`, action create / update).

## Catatan

- Matching murni substring + token-overlap (no fuzzy lib). **TODO**: ganti dengan trigram / Levenshtein / fuse.js biar tahan typo.
- Auth masih STUB (`getUser` balikin demo user dengan semua role).
- Mount di `src/index.ts`: `app.route('/', monitoredItemsRoutes)`.
