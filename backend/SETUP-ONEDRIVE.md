# Setup OneDrive (Microsoft Graph) — panduan gaptek

> Tujuan: bikin FINA go bisa **otomatis taro file .docx ke folder OneDrive** + **nambah baris rekap ke file Excel di OneDrive**. Gratis (numpang langganan M365 yang udah ada). Ikutin urut, jangan loncat.
>
> Bagian A & B paling enak dikerjain sama **admin IT / yang punya akses admin M365**. Kalau kamu bukan admin, kasih dokumen ini ke mereka.

Total ada **4 hasil yang harus dikumpulin** (nanti dimasukin ke app):
`TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `DRIVE_ID`, `WORKBOOK_ITEM_ID`. Catat di notepad sambil jalan.

---

## BAGIAN A — Daftarin "app" di Azure (sekali aja, ~10 menit)

1. Buka **https://entra.microsoft.com** → login pakai akun **admin** Microsoft 365 perusahaan.
2. Menu kiri: **Identity → Applications → App registrations**. Klik **+ New registration**.
3. Isi:
   - **Name**: `FINA go` (bebas).
   - **Supported account types**: pilih **"Accounts in this organizational directory only"**.
   - **Redirect URI**: kosongin aja.
   - Klik **Register**.
4. Sekarang muncul halaman app-nya. Di bagian **Overview**, catat 2 angka panjang:
   - **Application (client) ID** → ini `CLIENT_ID`.
   - **Directory (tenant) ID** → ini `TENANT_ID`.
5. Bikin password app (secret):
   - Menu kiri app: **Certificates & secrets** → tab **Client secrets** → **+ New client secret**.
   - Description: `fina-go`, Expires: pilih **24 months**. Klik **Add**.
   - ⚠️ **LANGSUNG COPY kolom "Value"** (bukan "Secret ID"). Ini `CLIENT_SECRET`. **Cuma muncul sekali** — kalau ke-refresh ilang, harus bikin baru.
6. Kasih izin akses file:
   - Menu kiri app: **API permissions** → **+ Add a permission** → **Microsoft Graph**.
   - Pilih **Application permissions** (BUKAN "Delegated").
   - Cari & centang **`Files.ReadWrite.All`**. (Kalau file rekap-nya ditaro di SharePoint, centang juga **`Sites.ReadWrite.All`**.)
   - Klik **Add permissions**.
7. **PALING PENTING**: klik tombol **"Grant admin consent for [nama perusahaan]"** → **Yes**.
   - Pastiin kolom **Status** jadi centang hijau ✅ **"Granted"**. Kalau masih kuning/abu, izinnya belum aktif.

✔️ Bagian A selesai. Udah dapet: `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`.

---

## BAGIAN B — Siapin folder + file Excel di OneDrive

1. Buka **OneDrive** perusahaan (OneDrive for Business / akun kerja, **bukan** OneDrive pribadi).
2. Bikin folder buat nyimpen dokumen, mis. `FINA-go` → di dalamnya `pengajuan`.
   (Kalau ganti nama folder, nanti sesuaikan `GRAPH_FOLDER_PATH` di app.)
3. Bikin 1 file Excel buat rekap, mis. **`FINA-go-rekap.xlsx`**, taro di folder `FINA-go`.
4. Buka file Excel itu, di baris paling atas bikin **8 kolom** urut begini (header-nya):

   | NBR | Tanggal | Kode Proyek | Kategori | Nama | Total | Status | Pengaju |
   |---|---|---|---|---|---|---|---|

5. Blok 8 header itu + 1 baris kosong di bawahnya → menu **Insert → Table** → centang **"My table has headers"** → OK.
6. Klik tabelnya, menu **Table Design** → kotak **Table Name** (kiri atas) → kasih nama, mis. `Table1`. **Save**.
   (Kalau nama tabelnya beda, nanti isi `GRAPH_WORKBOOK_TABLE` di app sesuai nama itu.)

✔️ Bagian B selesai.

---

## BAGIAN C — Ambil DRIVE_ID & WORKBOOK_ITEM_ID (pakai Graph Explorer)

Ini bagian agak teknis. Pelan-pelan.

1. Buka **https://developer.microsoft.com/graph/graph-explorer**.
2. Klik **Sign in** (kanan atas) → login akun kerja yang sama. Kalau diminta consent, **Accept**.
3. Di kotak URL (pastiin method **GET**), ketik ini lalu **Run query**:
   ```
   https://graph.microsoft.com/v1.0/me/drive
   ```
   → di hasil (Response preview) cari baris `"id": "....."` paling atas. **Copy nilainya** → ini `DRIVE_ID`.
4. Cari item-id file Excel-nya. Jalanin (ganti path kalau nama folder/file beda):
   ```
   https://graph.microsoft.com/v1.0/me/drive/root:/FINA-go/FINA-go-rekap.xlsx
   ```
   → di hasil cari `"id": "....."` → **copy** → ini `WORKBOOK_ITEM_ID`.

> Mentok di bagian ini? Screenshot/paste hasil Graph Explorer ke aku, nanti kubantu tunjukin yang mana ID-nya.

✔️ Bagian C selesai. Sekarang udah lengkap 5 nilai.

---

## BAGIAN D — Masukin ke app & nyalain

1. Buka file `backend/.env` (kalau belum ada, copy dari `backend/.env.example`).
2. Isi nilai yang udah dikumpulin:
   ```
   GRAPH_TENANT_ID=<TENANT_ID>
   GRAPH_CLIENT_ID=<CLIENT_ID>
   GRAPH_CLIENT_SECRET=<CLIENT_SECRET>
   GRAPH_DRIVE_ID=<DRIVE_ID>
   GRAPH_WORKBOOK_ITEM_ID=<WORKBOOK_ITEM_ID>
   GRAPH_WORKBOOK_TABLE=Table1
   GRAPH_FOLDER_PATH=FINA-go/pengajuan
   SYNC_CRON=on
   ```
3. Restart backend (`npm run dev` atau `npm run start`). Di log harusnya muncul `Sync OneDrive cron: ON`.
4. **Tes**: login sebagai admin di app → buat & submit 1 pengajuan → tunggu ≤5 menit (atau pencet tombol manual: `POST /admin/sync/run`). Cek:
   - File `.docx` muncul di folder OneDrive `FINA-go/pengajuan`.
   - Baris baru muncul di Excel `FINA-go-rekap.xlsx`.

---

## Kalau gagal — cek ini

- **403 / Access denied** → izin `Files.ReadWrite.All` belum di-**Grant admin consent** (Bagian A no.7), atau pakai OneDrive **pribadi** (harus akun kerja M365).
- **Tabel gak ke-update** → nama tabel di Excel beda dari `GRAPH_WORKBOOK_TABLE`, atau urutan kolom gak sama.
- **401 / invalid_client** → `CLIENT_SECRET` salah copy (ke-copy "Secret ID", bukan "Value"), atau udah expired.
- **Gak ada yang kejadian** → `SYNC_CRON` belum `on`, atau outbox belum diproses (coba `POST /admin/sync/run`).

## Catatan
- Semua langkah Azure di atas **gratis** — gak perlu langganan Azure berbayar, cukup numpang M365 yang udah ada.
- `CLIENT_SECRET` itu rahasia: cuma di `.env` (udah di-gitignore), jangan di-share/commit.
- Sebelum env Graph diisi, app tetap jalan normal — file cuma kesimpen di storage lokal/MinIO, gak ke OneDrive.
