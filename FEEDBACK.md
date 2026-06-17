# Feedback log

> Sumber requirement FINA go. Update terus saat ada masukan baru dari user, klien, atau internal.

## Sumber awal (yang sudah ada)

### File contoh dari Fathul (di luar repo, sensitive)

User punya 2 file contoh format pengajuan yang dipakai sekarang (manual):

1. **Reimbursement form** (docx) — `BR001_07-28-25_Reimbursement ADM_Urgent - Adinda RN.docx`
   - Format dokumen reimburse yang dipakai sekarang
   - Berisi struktur kolom dan workflow approval manual
   - **NOT IN REPO** — sensitive, ada nama karyawan asli
   - Kalau butuh referensi, user akan share isinya saat planning DOMAIN.md

2. **Purchase request log** (xlsx) — `Salinan dari Pengajuan Baru Per Agustus 2025.xlsx`
   - Spreadsheet log pengajuan purchase request agustus 2025
   - Berisi kolom + sample data realistic
   - **NOT IN REPO** — sensitive
   - Kalau butuh referensi, user akan share isinya saat planning DOMAIN.md

> Catatan: kedua file ini sempat ke-commit accidentally di `../new-hydro-canal` (commit `a060a6e`), sudah dihapus dari tracking di commit `500c06d`. Pelajaran: pakai `git add <file>` eksplisit, bukan `git add -A` di folder yang banyak file pribadi nyasar.

## Sumber yang perlu di-collect

### Wawancara internal (TBD)

User yang perlu diajak ngobrol untuk dapat requirement detail:

- [ ] **Admin / Finance officer** — yang sekarang handle approval manual
- [ ] **HR / GA** — yang sering ngajuin purchase (alat kantor, supplies)
- [ ] **Operator lapangan** — yang sering ngajuin reimburse (BBM, perdiem)
- [ ] **Manager / Director** — yang approve nominal besar

Topik wawancara:
- Workflow approval sekarang seperti apa? Manual / email / WA?
- Berapa lama biasanya dari ajukan sampai cair?
- Pain point terbesar (lost form? approval ngestuck? salah hitung?)
- Volume per bulan (5? 50? 500 pengajuan)
- Nominal range (rata-rata 100rb, 1jt, 10jt?)
- Categories yang sering muncul

### Dokumen referensi

- [ ] SOP reimburse yang berlaku sekarang (kalau ada PDF)
- [ ] Master kategori biaya / chart of accounts
- [ ] Format laporan finance ke management
- [ ] Apakah ada integrasi ke sistem accounting existing?

## Persyaratan yang sudah jelas

Belum ada yang sudah final. Semua masih asumsi awal:

1. ✅ Aplikasi standalone (separate dari HydroCanal) — disepakati di percakapan polyrepo strategy
2. ✅ Stack vanilla + Alpine.js + Tailwind (no build) — disepakati Fathul
3. ✅ Brand navy + teal sesuai logo FINA go
4. ✅ 2 jenis pengajuan: reimbursement + purchase request
5. ✅ Approval workflow (multi-level)
6. ✅ Attachment untuk receipt/quotation

## Fitur penting yang sudah disepakati (2026-06-13, Fathul)

### Monitored items + anomaly detection

User di FINA go bisa **tag item yang di-monitor** (mobil, alat, software license, dll). Saat ada pengajuan yang menyentuh item tersebut, sistem cek anomaly.

Contoh kasus: user submit "servis mobil B 1234 XYZ", padahal mobil itu baru diservis sebulan lalu (lastEventAt). Verifikator dapat **flag merah** + butuh justifikasi tambahan dari pengaju.

Pattern implementasi:

```
collection monitored_items {
  id, name: "Toyota Avanza B 1234 XYZ",
  category: "vehicle" | "equipment" | "software_license" | "consumable" | ...,
  lastEventAt: date,
  expectedIntervalDays: number,  // mis. 90 hari untuk servis mobil rutin
  ownerDepartment, notes,
  watchedBy: [verifikatorId, ...]  // subscriber
}
```

3 layer logic:

1. **Layer 1 — Auto-tag saat submit**: backend regex/fuzzy match description → suggest tag
2. **Layer 2 — Flag di verifikator dashboard**: kalau `today - lastEventAt < expectedIntervalDays * 0.5` → flag merah
3. **Layer 3 — Justifikasi wajib**: kalau pengaju lanjut → tulis alasan; verifikator approve dengan komentar

Plus fitur turunan:
- **History per item**: timeline semua pengajuan terkait item
- **Watch list**: verifikator subscribe → tiap pengajuan ke item kirim notif extra
- **Bulk dashboard anomali**: filter semua pengajuan yang ter-flag minggu ini

### Nomor rekening: hybrid (user input + admin verify)

Disepakati hybrid pattern:

1. User input rekening di profile saat onboarding
2. Status `pending verification` → Finance/HR cek attachment (buku rekening / foto KTP+rekening)
3. Status `verified` → reimburse hanya bisa ke rekening verified
4. Ubah/tambah rekening → kembali ke `pending` → re-verify (anti swap fraud jelang reimburse besar)
5. User bisa punya >1 rekening (utama + cadangan) → bisa pilih saat submit pengajuan
6. Audit log semua perubahan rekening

Schema sketsa:
```
users {
  ...
  bankAccounts: [
    { id, bankName: "BCA", number: "1234567890", holderName: "Adinda RN",
      status: "verified" | "pending" | "rejected",
      verifiedBy: userId, verifiedAt: date,
      isDefault: boolean,
      attachmentUrl: "uploads/buku-rek-..." }
  ]
}
```

## Pertanyaan terbuka (perlu jawaban sebelum DOMAIN.md final)

1. **Multi-tenant?** FINA go khusus PT. Karta Bhumi Nusantara, atau bisa untuk anak perusahaan / vendor lain?
2. **Mata uang?** IDR only, atau multi-currency (USD untuk software license, dll)?
3. **Approval rule**: by amount (>1jt = director), by category, atau by initiator role?
4. **Budget tracking**: real-time budget per department? Atau cukup log historis?
5. **Reimburse delay**: ada SLA? (mis. max 7 hari dari approve sampai cair)
6. **Audit retention**: berapa lama log pengajuan disimpan? (1 tahun, 5 tahun, forever?)
7. **Print format**: invoice/voucher print-friendly untuk hardcopy archive?
8. **Notifikasi**: in-app saja, email, WhatsApp?
9. **Mobile**: PWA + responsive cukup, atau native app?
10. **Role hierarchy detail**: berapa level approval? Configurable per amount/category?

## Inspirasi (bukan requirement, tapi acuan UX)

- **Brex / Ramp / Mekari Jurnal** — UX reimburse modern
- **Concur** — enterprise expense management (overkill, tapi reference flow)
- **Jurnal.id** — local Indonesian, UX familiar untuk audience
- **Spendesk** — approval chain visual

Saat design demo, coba pinjam pola dari salah satu (jangan plek-plekan, sesuaikan dengan vibes navy/teal + Bahasa Indonesia).

## Log update

| Tanggal | Sumber | Note |
|---|---|---|
| 2026-06-13 | Fathul | Initial setup repo, polyrepo strategy disepakati |
| 2026-06-13 | Fathul | Brand identity: logo + navy/teal |
| 2026-06-13 | Fathul | Stack vanilla + Alpine.js disepakati |
| 2026-06-15 | Fathul | Requirement form: line-item + auto-hitung total → output docx FORMULIR (ganti free-text). Demo `demo/index.html` jadi. |
| 2026-06-15 | Fathul | Stack BE dikunci: Hono + Drizzle + Turso/libSQL, R2(hot)→OneDrive(cold) via Graph async outbox, docxtemplater. Lihat `PLAN-BE.md`. |
| 2026-06-15 | Fathul | Konvensi repo: feature-based + CLAUDE.md per fitur; guardrail global di CLAUDE.md utama gak bisa di-override. |
| 2026-06-15 | Fathul | Desain UI: Hybrid (Satoshi app + Newsreader dokumen), flat + gradient tipis di elemen hero, token Tailwind custom. |
| 2026-06-17 | Fathul | FE asli (`app/`) full: auth sendiri (JWT email+pw), main menu, preview FORMULIR popup (bukan side-by-side), rekening/monitored/projects. Mobile-friendly. |
| 2026-06-17 | Fathul | BE: auth feature (JWT+scrypt), R2 FS-backed (dev), Graph real-with-env. Dibangun fan-out 5 subagent paralel. Semua fitur FE+BE kelar. |
