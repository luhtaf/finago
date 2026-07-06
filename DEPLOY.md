# Deploy FINA go — panduan dari nol (gratis, tanpa VPS)

> Target: app online, **nol VPS orang**, semua free tier. Ikutin urut.
>
> Arsitektur:
> ```
> FE (app/)  ── Cloudflare Pages  (static, gratis)
>      │ panggil API
> API (backend/) ── Render        (Node, gratis)
>      ├── DB     ── Turso         (libSQL managed, gratis)
>      └── Storage── Cloudflare R2 (S3-compatible, gratis)
> ```
> Yang dibayar: **nol** (selama di free tier). Graph/OneDrive opsional (lihat `backend/SETUP-ONEDRIVE.md`).

Siapin akun dulu (gratis semua): **Turso**, **Cloudflare** (buat R2 + Pages), **Render**, **GitHub** (buat connect repo).

---

## 1. DB — Turso (libSQL managed)

1. Install CLI: `curl -sSfL https://get.tur.so/install.sh | bash` (lalu buka terminal baru).
2. `turso auth signup` → login lewat browser.
3. Bikin database: `turso db create finago`
4. Catat 2 nilai ini:
   - URL: `turso db show finago --url`  → `libsql://finago-xxx.turso.io`
   - Token: `turso db tokens create finago`  → string panjang
   Simpan jadi `DATABASE_URL` + `DATABASE_AUTH_TOKEN`.

## 2. Storage — Cloudflare R2

1. Cloudflare dashboard → **R2** → **Create bucket**, nama `finago`.
2. R2 → **Manage R2 API Tokens** → **Create API token** (Object Read & Write) → catat **Access Key ID** + **Secret Access Key**.
3. Endpoint R2: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (Account ID ada di halaman R2). 
   Jadi: `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=finago`.

## 3. Isi DB (migrate + seed) — sekali, dari laptop

Di folder `backend/`, jalanin dengan env Turso (ganti nilainya):
```bash
cd backend
npm install
DATABASE_URL="libsql://finago-xxx.turso.io" DATABASE_AUTH_TOKEN="<token>" npm run db:migrate
DATABASE_URL="libsql://finago-xxx.turso.io" DATABASE_AUTH_TOKEN="<token>" npm run seed
```
Ini bikin tabel + 3 user demo (password `fina123`) di Turso. Cukup sekali.

## 4. Deploy API — pilih salah satu

### 4A. Cloudflare Workers (rekomendasi — all-CF, gak perlu kartu kedua)

> Karena kartu udah di Cloudflare (buat R2), backend di Workers = gak usah daftar/isi kartu Render. R2 dipakai lewat **binding** (gak butuh R2 access key di sini). Gak ada cold-start-tidur.

1. `cd backend && npm install`
2. `npx wrangler login` (browser).
3. Pastiin bucket R2 ada (skip kalau udah bikin di dashboard): `npx wrangler r2 bucket create finago`.
   (`wrangler.toml` udah nge-bind bucket `finago` ke `BUCKET`.)
4. Set secrets (DB + JWT; R2 gak perlu karena binding):
   ```bash
   npx wrangler secret put DATABASE_URL          # libsql://finago-xxx.turso.io
   npx wrangler secret put DATABASE_AUTH_TOKEN    # token Turso
   npx wrangler secret put JWT_SECRET             # random panjang
   # opsional OneDrive: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_DRIVE_ID, GRAPH_WORKBOOK_ITEM_ID
   ```
5. Deploy: `npm run cf:deploy`
6. Dapet URL `https://finago-api.<subdomain>.workers.dev`. Tes `/health`.

> Cron sync OneDrive jalan otomatis tiap 5 menit (Cron Trigger di `wrangler.toml`). Kalau `GRAPH_*` belum di-set, dia no-op (aman).

### 4B. Render (Node, alternatif — butuh kartu Render)

1. Push repo ini ke GitHub (kalau belum).
2. Render → **New** → **Web Service** → connect repo.
3. Setting:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm run start`
   - **Instance**: Free
4. **Environment** → tambah:
   ```
   DATABASE_URL=libsql://finago-xxx.turso.io
   DATABASE_AUTH_TOKEN=<token>
   JWT_SECRET=<bikin random panjang, mis. hasil `openssl rand -hex 32`>
   R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
   R2_ACCESS_KEY_ID=<r2 key>
   R2_SECRET_ACCESS_KEY=<r2 secret>
   R2_BUCKET=finago
   ```
   (PORT otomatis dari Render — kode udah baca `process.env.PORT`.)
5. Deploy. Catat URL-nya, mis. `https://finago-api.onrender.com`.
6. Tes: buka `https://finago-api.onrender.com/health` → harus `{"ok":true,...}`.

> ⚠️ Render free **tidur** kalau idle (cold start ~30 dtk request pertama). Buat demo aman. Mau selalu nyala → Railway / Fly / Koyeb (langkah mirip).

## 5. Deploy FE — Cloudflare Pages

1. Edit `app/index.html`, isi URL API dari langkah 4:
   ```html
   <script>window.FG_API = "https://finago-api.onrender.com";</script>
   ```
2. Deploy folder `app/`:
   - **Cara cepat (CLI)**: `npx wrangler pages deploy app --project-name finago`
   - **Atau dashboard**: Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Upload assets** → drag folder `app/`. (Build command kosong, ini static.)
3. Dapet URL, mis. `https://finago.pages.dev`. Buka → halaman login muncul.

## 6. Tes end-to-end

1. Buka `https://finago.pages.dev` → login `bagus@kartabhumi.id` / `fina123`.
2. Buat pengajuan + lampirkan foto → submit → download .docx.
3. Login `adinda@kartabhumi.id` → cek Dashboard, kelola pengguna, approve.

---

## Kalau gagal — cek ini

- **FE kebuka tapi login/error "Failed to fetch"** → `window.FG_API` salah/ kosong, atau API (Render) lagi cold-start (tunggu ~30 dtk, refresh).
- **401 / CORS** → API CORS udah `*` (oke). Pastiin `window.FG_API` pakai `https://` + tanpa trailing slash.
- **500 "no such column" / table** → migrate (langkah 3) belum jalan ke Turso, atau env DB di Render beda dari yang di-migrate.
- **Upload/docx gagal** → R2 env salah, atau bucket beda nama.
- **Login "Email atau password salah"** → seed (langkah 3) belum jalan. Password demo: `fina123`.

## Update kemudian

- Ubah kode → push ke GitHub → Render auto-redeploy (API). FE: deploy ulang `app/` (`wrangler pages deploy app`).
- Ubah skema DB → `npm run db:generate` lalu `db:migrate` (dengan env Turso).

## Catatan
- Auth `JWT_SECRET` WAJIB di-set di prod (jangan pakai default dev).
- Pindah dari Render → Docker/K8s nanti: bikin `Dockerfile` (`FROM node`, `npm ci`, `CMD npm run start`), DB/storage tetap (Turso + R2). Kode gak berubah.
- OneDrive (opsional): isi env `GRAPH_*` + `SYNC_CRON=on` — lihat `backend/SETUP-ONEDRIVE.md`.
