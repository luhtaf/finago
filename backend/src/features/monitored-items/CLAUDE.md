# CLAUDE.md — fitur `monitored-items`

> Tunduk ke `../../../CLAUDE.md` (backend) + `../../../../CLAUDE.md` (global).

## Cerita fitur

Deteksi pengajuan ganda buat aset/biaya berpola (servis kendaraan, toner, lisensi, dll). **Manual, bukan auto fuzzy** — fuzzy match dulu dibuang karena rapuh (harus exact). Sekarang: verifikator **nandai** baris pengajuan ke monitored item dari daftar.

## Alur (manual tag)

1. Admin/verifikator daftarin monitored item (`name`, `category`, `expectedIntervalDays`). `lastEventAt` boleh kosong.
2. Pas review, verifikator nandai `pengajuan_item` → monitored item (`POST /pengajuan-items/:itemId/monitor`). Kalau monitored item itu **baru kepakai < ½ interval** → balikin `warning` (rawan ganda).
3. Pas pengajuan di-**verify** (fitur `approval`), `touchOnVerify` update `lastEventAt` = now buat semua monitored item yang ditandai di pengajuan itu. Ini yang bikin pengajuan berikutnya kena warning.

## Kontrak ekspor (jangan diubah sembarangan)

```ts
checkAnomaly(pengajuanId): Promise<{ flagged; reasons; matched }>   // baca item yang DITANDAI
tagPengajuanItem(pengajuanItemId, monitoredItemId|null, actorId?): Promise<{ ok; warning }>
touchOnVerify(pengajuanId, when?): Promise<string[]>                // dipanggil approval.verify
```

⚠️ `pengajuan/service` import `checkAnomaly` (submit) — return shape jangan diubah. `approval/service` import `touchOnVerify` (verify).

## Endpoints (mounted di `/`)

| Method | Path | Role |
|---|---|---|
| GET | `/monitored-items` | login |
| POST | `/monitored-items` | admin/verifikator |
| PATCH | `/monitored-items/:id` | admin/verifikator |
| GET | `/pengajuan/:id/anomaly` | login → `{flagged, reasons, matched}` |
| POST | `/pengajuan-items/:itemId/monitor` | verifikator/admin → `{monitoredItemId\|null}` |

## Tabel

- `monitored_items` — CRUD.
- `pengajuan_item.monitored_item_id` — FK tag (di-set di sini).
- `audit_log` — create/update/tag_monitor/untag_monitor.

## Catatan

- Submit pengajuan **gak auto-flag lagi** (belum ditandai) — flag/warning muncul pas verifikator nandai / di kartu "Item dimonitor" di FE detail.
