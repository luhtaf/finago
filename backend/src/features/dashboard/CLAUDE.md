# CLAUDE.md — fitur `dashboard`

> Tunduk ke `../../../CLAUDE.md` (backend) + `../../../../CLAUDE.md` (global).

## Cerita fitur

Agregasi **read-only** buat dashboard. Baca tabel `pengajuan`, hitung ringkasan + breakdown
(per state / kategori / proyek / bulan). **Gak ubah skema, gak nulis apa pun** — pure read.

## Endpoints (mounted di `/`)

| Method | Path | Role |
|---|---|---|
| GET | `/dashboard/stats` | verifikator / approver / admin |

### Filter (query params, kosong = diabaikan)

`from` (tanggal ≥), `to` (tanggal ≤), `kategori`, `state`, `kodeProyek`. Di-AND-kan.

### Response

```ts
{
  totalCount, totalAmount, paidAmount, pendingCount,   // angka ringkas
  byState:    { state, count, amount }[],              // state yang ada aja
  byKategori: { kategori, count, amount }[],
  byProyek:   { kodeProyek, count, amount }[],          // sort amount desc
  byMonth:    { month: 'YYYY-MM', count, amount }[],     // sort month asc
}
```

## Catatan

- State `draft` **selalu di-exclude** — cuma submitted+ yang dihitung sebagai pengajuan nyata.
- `pendingCount` = state ∈ {submitted, needs_justification, verified}.
- Agregasi dilakukan di JS atas hasil query (bukan SQL GROUP BY) — simpel, dataset kecil.
- ⚠️ Route **belum di-mount**. Parent harus tambah `app.route('/', dashboardRoutes)` di `src/index.ts`.
