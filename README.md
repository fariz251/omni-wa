# Omnichannel Performance Deck (GitHub/Vercel + Google Apps Script bridge)

Arsitektur:

```
Browser (Vercel, statis)  --fetch POST-->  Google Apps Script Web App  -->  Google Spreadsheet
   public/index.html                          gas/Code.gs
   public/config.js  (isi GAS_URL)
```

- Upload xlsx/csv Shopee diproses di browser, lalu dikirim per batch ke GAS dan di-upsert ke spreadsheet.
- Dashboard memuat semua sheet lewat `getData`, lalu dihitung/dikompilasi di browser (logika sama seperti sebelumnya).
- GAS hanya jembatan: tidak ada lagi `HtmlService`, tidak ada UI di GAS.

## 1. Pasang backend di Google Apps Script

1. Buka spreadsheet utama -> **Extensions -> Apps Script**.
2. Ganti isi `Code.gs` dengan isi `gas/Code.gs`. Hapus file `Index.html` lama (tidak dipakai lagi).
3. **Project Settings -> Script Properties**, tambahkan:
   - `APP_PASSWORD` = password untuk membuka aplikasi
   - `SPREADSHEET_ADMIN_ID` = ID spreadsheet admin (opsional)
4. **Deploy -> New deployment -> Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Salin URL Web App (berakhiran `/exec`). Saat pertama kali, setujui otorisasi akses spreadsheet.

> Setiap kali `Code.gs` diubah, buat **New version** pada deployment yang sama (Deploy -> Manage deployments -> Edit -> New version) agar URL tidak berubah.

## 2. Hubungkan frontend

Edit `public/config.js`:

```js
window.APP_CONFIG = { GAS_URL: 'https://script.google.com/macros/s/XXXX/exec' };
```

## 3. Deploy ke GitHub dan Vercel

```bash
git init && git add . && git commit -m "init"
git remote add origin <url-repo-github>
git push -u origin main
```

Di vercel.com: **Add New -> Project -> Import** repo -> Deploy (tanpa build command, output directory `public`, sudah diatur di `vercel.json`).

## Catatan keamanan

- URL Web App bersifat publik, jadi data dilindungi oleh `APP_PASSWORD` yang diperiksa di GAS. Password dikirim di body request (HTTPS) dan disimpan di `sessionStorage` browser selama tab terbuka.
- Repo GitHub boleh publik karena tidak berisi data maupun password. Hanya `GAS_URL` yang ada di `config.js`.
- Ini proteksi dasar (satu password bersama), bukan login per pengguna.

## Batas yang perlu diketahui

- GAS punya kuota eksekusi harian dan satu request maksimal 6 menit. Upload sudah dipecah per batch 500 baris dan dikunci (`LockService`) agar dua upload tidak saling menimpa.
- Kecepatan: GAS cold start dan baca sheet bisa memakan 2-5 detik. Jika data sangat besar, pertimbangkan versi `omnichannel-deck` (Vercel + Sheets API langsung) yang lebih cepat.
- GAS Web App tidak mendukung preflight CORS, jadi frontend memakai `Content-Type: text/plain` (request sederhana). Jangan diubah menjadi `application/json`.

## Uji

```bash
npm test   # menguji gas/Code.gs dengan layanan Google tiruan
```

## CSS (Tailwind)

Tampilan memakai Tailwind yang **dikompilasi saat build** (`public/tailwind.css`), bukan script `cdn.tailwindcss.com`. Browser tidak lagi menghitung CSS saat halaman berubah, sehingga ganti tab dan menu lebih ringan.

- Di Vercel, CSS dibuat otomatis lewat `buildCommand` di `vercel.json`. Tidak ada yang perlu dijalankan manual.
- Jika Anda menambah class Tailwind baru di `public/index.html` dan ingin mencobanya lokal: `npm install && npm run build:css`.

## Auto-refresh (hampir real-time)

Dashboard memanggil `ping` ke Apps Script tiap 60 detik (hanya saat tab browser terlihat). Jika ada data baru (dari upload manual, WhatsApp, atau n8n) data dimuat ulang diam-diam tanpa loader. Tombol **Refresh** di header memuat ulang manual. Label "Sinkron HH:MM" menunjukkan sinkron terakhir. Upload raw data manual **tetap ada** sebagai cadangan jika n8n/server bermasalah.

## Report WhatsApp via n8n + WAHA

Ketik di WhatsApp:

| Perintah | Hasil |
|---|---|
| `/report` | Report gabungan bulan berjalan |
| `/report september` atau `/report 2026-09` | Report bulan tertentu |
| `/report semua` | Semua periode |
| `/report shopee mitra` | Filter toko: `shopee diansari`, `shopee mitra`, `tiktok ...`, `tokped ...`, `wa` |
| `/report shopee mitra september` | Kombinasi toko + bulan |

Setup:

1. Apps Script: tempel `gas/Code.gs` terbaru -> **Project Settings -> Script Properties** tambah `N8N_KEY` (string acak panjang) -> **Deploy -> Manage deployments -> Edit -> New version**.
2. n8n: **Import from file** `n8n/waha-report.workflow.json`.
3. Buka node **Parse perintah**, isi `CONFIG`: `GAS_URL` (URL /exec), `N8N_KEY` (sama dengan di Apps Script), `WAHA_URL`, `WAHA_API_KEY`, `WAHA_SESSION`, `ALLOWED` (nomor yang boleh, format `628...`).
4. Aktifkan workflow, lalu di WAHA set webhook ke `https://<n8n-anda>/webhook/waha-report` dengan event `message`.
5. Uji dari editor Apps Script: jalankan `cobaReport` dan `cekSpreadsheetAdmin`.

Workflow ini sudah diuji di n8n 1.123 asli (impor, aktivasi, webhook, panggilan Apps Script dengan redirect 302, balasan WAHA). Pemanggilan ke Shopee Open Platform dan WAHA sungguhan belum bisa diuji dari sini.
