# Migrasi FINA go → VPS Hostinger (runbook)

> Status: **disiapkan & sudah gladi lokal** (data prod asli, container, browser) — belum dijalankan di VPS.
> Prod lama (Cloudflare Pages + Workers + Turso + R2) **tetap jalan** sampai langkah cutover.

## Arsitektur target

```
                 ┌──────────────── VPS Hostinger (Ubuntu 24.04, Docker) ────────────────┐
user ── HTTPS ──▶│ caddy (80/443, TLS otomatis) ──▶ finago (Node: API + FE same-origin)  │
                 │                                   └─ volume finago-data:/data         │
                 │                                        ├─ finago.db   (SQLite/libSQL) │
                 │                                        ├─ files/nota/… (lampiran)     │
                 │                                        └─ backups/    (harian, 14 hr) │
                 └───────────────────────────────────────────────────────────────────────┘
```

- Satu image (`Dockerfile` di root): API Hono + folder `app/` dilayani dari domain yang sama
  (`window.FG_API = "same-origin"` di-set saat build). Gak ada lagi domain API terpisah → gak kena
  blokir `workers.dev` lagi.
- DB = file SQLite di volume (`DATABASE_URL=file:/data/finago.db`), file lampiran = mode FS r2 client
  (`R2_DIR=/data/files`). **Satu instance saja** (SQLite file gak boleh dipakai 2 container).
- Migrasi skema otomatis tiap container start (`drizzle-kit migrate`, idempoten).
- File: `Dockerfile`, `.dockerignore`, `deploy/hostinger/{docker-compose.yml,Caddyfile,.env.example}`,
  `backend/scripts/{migrate-turso-to-file,pull-r2-files,backup}.ts`.

## 0. Beli VPS (dilakukan pemilik)

- Plan **KVM 1** (1 vCPU / 4 GB / 50 GB) sudah lebih dari cukup (DB < 1 MB, file nota ± ratusan MB/tahun).
  KVM 2 kalau mau longgar.
- OS: **Ubuntu 24.04** (template polos, bukan panel). Lokasi: yang terdekat ke Indonesia.
- Aktifkan backup mingguan Hostinger (lapisan backup kedua).
- Masukkan SSH public key saat setup; matikan login password.

## 1. Siapkan server (sekali)

```bash
ssh root@<IP>
apt update && apt -y upgrade && apt -y install ca-certificates curl git ufw unattended-upgrades
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
```

Ambil kode (repo private): deploy key read-only di GitHub, atau `rsync` dari laptop:

```bash
# di laptop, dari root repo (tanpa .env / data lokal)
rsync -az --delete --exclude node_modules --exclude .git --exclude 'backend/.env' \
  --exclude 'backend/local.db*' --exclude .wrangler ./ deploy@<IP>:/opt/finago/
```

## 2. Konfigurasi

```bash
cd /opt/finago/deploy/hostinger
cp .env.example .env
# JWT_SECRET=$(openssl rand -hex 32)
# FINAGO_DOMAIN=srvXXXX.hstgr.cloud   ← hostname bawaan VPS, sudah resolve ke IP → HTTPS langsung jalan
```

⚠️ **Jangan go-live via `http://IP`** — password login lewat HTTP polos. Minimal pakai hostname bawaan
VPS (`srvXXXX.hstgr.cloud`) sampai domain final ada; ganti `FINAGO_DOMAIN` + `docker compose up -d` kapan saja.

## 3. Gladi di VPS (Cloudflare masih live, gak ganggu user)

Di laptop (punya akses Turso + `wrangler login`):

```bash
cd backend
set -a; source .env; set +a
SRC_URL="$DATABASE_URL" SRC_TOKEN="$DATABASE_AUTH_TOKEN" env -u DATABASE_URL -u DATABASE_AUTH_TOKEN \
  npx tsx scripts/migrate-turso-to-file.ts ./migrasi/finago.db      # baca-saja dari Turso, verifikasi count
npx tsx scripts/pull-r2-files.ts ./migrasi/finago.db ./migrasi/files # resumable
```

Kirim ke volume VPS lalu start:

```bash
rsync -az ./migrasi/ deploy@<IP>:/opt/finago/migrasi/
ssh deploy@<IP>
cd /opt/finago/deploy/hostinger && docker compose up -d --build
docker compose stop finago
V=$(docker volume inspect hostinger_finago-data -f '{{.Mountpoint}}')
sudo cp /opt/finago/migrasi/finago.db $V/ && sudo cp -r /opt/finago/migrasi/files $V/ && sudo chown -R 1000:1000 $V
docker compose start finago && docker compose ps
curl -s https://$FINAGO_DOMAIN/health
```

Cek: login akun asli, list (jumlah = Turso), buka 1 nota lama, download docx/xlsx, upload bukti.

## 4. Cutover (± 30 menit, umumkan ke user)

1. **Freeze prod lama**: deploy halaman maintenance/redirect ke Cloudflare Pages
   (`app/` diganti 1 `index.html` berisi info + link ke URL baru) → gak ada input baru di Cloudflare.
2. Ulangi langkah 3 dengan data terbaru: hapus `./migrasi/finago.db` lama → `migrate-turso-to-file`
   (verifikasi count) → `pull-r2-files` (cuma tarik delta) → salin ke volume (stop container dulu) → start.
3. Smoke test (langkah 3 bagian Cek).
4. Umumkan URL baru. Semua user **login ulang** (JWT_SECRET baru — normal).
5. Biarkan Turso + R2 + Worker **apa adanya 2–4 minggu** sebagai cadangan, baru dimatikan.

**Rollback**: deploy ulang `app/` asli ke Pages (`npx wrangler pages deploy app --project-name finago`)
— Worker + Turso gak pernah disentuh. Data yang masuk di VPS setelah cutover harus disalin balik manual
(jarang perlu kalau rollback diputuskan cepat).

## 5. Backup

Harian jam 01:00 (crontab user `deploy`):

```cron
0 1 * * * cd /opt/finago/deploy/hostinger && docker compose exec -T finago npx tsx scripts/backup.ts /data/backups >> /opt/finago/backup.log 2>&1
```

- Isi: snapshot DB konsisten (`VACUUM INTO`) + `files-*.tar.gz`, disimpan 14 hari (`KEEP_DAYS`).
- ⚠️ Backup ini **di disk yang sama** dengan data. Wajib salinan di luar VPS (mis. `rclone` ke
  Google Drive/R2 mingguan) + backup mingguan Hostinger. Uji restore sekali setelah go-live.

Restore: stop `finago` → ganti `/data/finago.db` dengan snapshot + extract `files-*.tar.gz` ke `/data/files` → start.

## 6. Update rutin (setelah ada perubahan kode)

```bash
# laptop: rsync seperti langkah 1 (atau git pull di server)
ssh deploy@<IP> 'cd /opt/finago/deploy/hostinger && docker compose up -d --build'
```

Migrasi skema jalan otomatis saat container start. Cek `docker compose logs -f finago`.

## Catatan

- Node entry `backend/src/index.ts`: `STATIC_DIR` → FE dilayani DULUAN (di luar `requireAuth`), sisanya
  diteruskan ke API. Worker entry (`worker.ts`) gak berubah → prod Cloudflare tetap jalan.
- Sync OneDrive/Google (`SYNC_PROVIDER`) default `none`; kalau dinyalakan di VPS pakai `SYNC_CRON=on`.
- Wrangler v3: `r2 object get` default remote (v4 butuh `--remote`).
