# DOMAIN — FINA go

> Model domain + aturan bisnis (role, approval, anomaly, pencairan). Ini **konsep/aturan**; skema fisik tabel ada di `PLAN-BE.md` (biar gak dobel & gak drift). Baca `CLAUDE.md` dulu.

## ⚠️ Asumsi yang perlu konfirmasi Fathul/perusahaan

Yang di bawah ini **asumsi awal** dari data contoh + praktik umum, **bukan final**. Tinggal koreksi:

1. **Role** = 4 fungsi (pengaju, verifikator/finance, approver/director, admin) — 1 orang boleh punya >1 role (org kecil).
2. **Threshold approval** (configurable, default): ≤ Rp1.000.000 → verifikator cukup; > Rp1.000.000 → wajib + approver.
3. IDR only (belum multi-currency).
4. Belum ada SLA pencairan formal.

Sisanya (di bawah) cukup stabil.

## Aktor & role

| Role | Siapa (contoh data) | Boleh apa |
|---|---|---|
| **pengaju** | Bagus DJ, Adin AR, karyawan | Buat draft, submit, kasih justifikasi kalau ke-flag, lihat status sendiri |
| **verifikator** | Adinda RN (Finance/ADM) | Cek kelengkapan (nota, rekening, anomaly), verify / return / reject, eksekusi pencairan (mark paid) |
| **approver** | Wahyu Banitara (Director) | Approve final / reject untuk nominal di atas threshold |
| **admin** | — | Kelola master: `projects`, `monitored_items`, verifikasi `bank_accounts`, user/role |

1 user bisa pegang banyak role (mis. Adinda = verifikator + admin).

## Entitas inti (konsep)

Pengajuan (reimbursement / pengajuan baru) punya banyak **item rincian** (Item, Qty, Satuan, Harga → Subtotal). Total = sum subtotal, dihitung server. Tiap pengajuan nempel ke 1 **proyek** (kode unik) + 1 **rekening pencairan** (yang sudah verified). Skema lengkap: `PLAN-BE.md`.

## State machine pengajuan

```
        ┌─────────── return (revisi) ───────────┐
        ▼                                        │
   [draft] ──submit──> [submitted] ──verify──> [verified] ──approve──> [approved] ──cairkan──> [paid]
                           │  │                    │                        
                  anomaly  │  └──reject──────────────────────reject──────> [rejected]
                  ke-flag  ▼
              [needs_justification] ──(pengaju isi alasan)──> [submitted]
```

**State:**

| State | Arti | Siapa pindahin |
|---|---|---|
| `draft` | Lagi diisi | pengaju |
| `submitted` | Nunggu verifikasi | pengaju (submit) |
| `needs_justification` | Ke-flag anomaly, nunggu alasan pengaju | sistem (auto) |
| `verified` | Lolos verifikasi finance | verifikator |
| `approved` | Disetujui (kalau perlu approver) | approver / verifikator* |
| `returned` | Dibalikin buat revisi (gak hangus) | verifikator/approver → balik `draft` |
| `rejected` | Ditolak (terminal) | verifikator/approver |
| `paid` | Sudah cair (terminal) | verifikator/finance |

\* Kalau total ≤ threshold, dari `verified` langsung bisa `approved` oleh verifikator tanpa approver (lihat aturan amount).

## Aturan approval by amount (configurable)

Disimpan di config/tabel (bisa diubah tanpa deploy). Default:

| Total | Jalur | Langkah |
|---|---|---|
| ≤ Rp1.000.000 | Ringkas | pengaju → verifikator (`verified`=`approved`) → paid |
| > Rp1.000.000 | Penuh | pengaju → verifikator (`verified`) → approver (`approved`) → paid |

Catatan: aturan ditulis as data (threshold + butuh-approver?), bukan hardcode — biar gampang ganti pas perusahaan mutusin angka beneran. Bisa diperluas ke rule by-kategori / by-department nanti.

## Anomaly detection (monitored items) — 3 layer

Dari FEEDBACK.md. Nyambung ke `pengajuan` lewat `POST /pengajuan/:id/submit`.

1. **Auto-tag saat submit** — backend fuzzy-match deskripsi item → cocokin ke `monitored_items` (mis. "servis mobil B 1234 XYZ").
2. **Flag di dashboard verifikator** — kalau `today - last_event_at < expected_interval_days * 0.5` → flag merah. Pengajuan masuk `needs_justification`.
3. **Justifikasi wajib** — pengaju isi alasan → balik `submitted`; verifikator approve dengan komentar (tercatat di audit).

Turunan: history per item (timeline pengajuan terkait), watch list (verifikator subscribe), dashboard bulk anomali mingguan.

## Rekening — hybrid (user input + finance verify)

Dari FEEDBACK.md. Reimburse **hanya** bisa ke rekening `verified`.

```
user input rekening → [pending] → finance cek attachment → [verified] → bisa dipakai
                                                          ↘ [rejected]
ubah/tambah rekening → balik [pending] → re-verify   (anti swap-fraud jelang reimburse besar)
```

User boleh > 1 rekening (utama + cadangan), pilih saat submit. Semua perubahan rekening masuk `audit_log`.

## Audit trail

Setiap transisi state + perubahan rekening + verifikasi + komentar approval ditulis ke `audit_log` (entity, action, actor, meta, timestamp). Retensi: TBD (lihat FEEDBACK.md).

## Open (nyetir desain lanjutan)

- Angka threshold + apakah ada tier ke-3 (mis. > 10jt wajib 2 approver?).
- Role hierarchy: cukup flat (4 role) atau perlu per-department?
- Notifikasi transisi: in-app / email / WA? (FEEDBACK.md).
