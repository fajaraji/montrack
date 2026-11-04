# Montrack

Pencatat keuangan pribadi yang **terisi sendiri** dari email bukti bayar bank & e-wallet, dengan satu angka yang jelas: **"bulan ini sudah keluar berapa?"**

- **Pengeluaran terpisah dari saldo.** Top-up GoPay dari BRI, transfer ke rekening sendiri, dan koreksi saldo **tidak** dihitung sebagai pengeluaran.
- **Otomatis dari Gmail.** Google Apps Script di akun Google-mu mengirim email bukti bayar BRI, BNI, BSI, GoPay, OVO, DANA, ShopeePay (juga BCA/Mandiri) tiap 5 menit.
- **Kategori otomatis yang belajar.** ±200 kata kunci merchant Indonesia sudah tersedia. Sekali kamu memilih kategori untuk "Warkop Mbak Sri", transaksi berikutnya dari merchant itu otomatis ikut.
- **Impor mutasi PDF/CSV** untuk transaksi tanpa email (biaya admin bulanan, bunga, auto-debit). Transaksi yang sudah tercatat dari email dicocokkan, jadi tidak dobel.
- **Tinjau cepat**: saran 3 kategori per transaksi, centang banyak sekaligus, dan tombol **Batalkan** untuk setiap perubahan.
- **Ganti nama merchant** ("9XY9 MPM ALFAMART…" → "Alfamart"), **bagi transaksi** ke beberapa kategori, dan **abaikan dari laporan** (reimburse/titipan).
- **Laporan** tren 6 bulan, kategori vs rata-rata, merchant terbesar, rekap mingguan, dan **deteksi tagihan/langganan** bulanan.
- **Biaya rutin** (mis. admin rekening): nominal, tanggal, dan akun bisa diubah kapan saja; dicatat otomatis tiap bulan.
- **Ekspor CSV** dan **mode privasi** (sembunyikan nominal).
- **Login sekali**: sesi 180 hari yang diperpanjang otomatis.
- **Notifikasi HP → Montrack** lewat MacroDroid untuk transaksi tanpa email (mis. Jago), dan **Flip** dipasangkan otomatis dengan transfer bank ke Flip.
- Web app + **PWA** (bisa dipasang di Android lewat Chrome). Berjalan di **Cloudflare Workers + Neon Postgres**, gratis.

## Coba dulu di laptop (tanpa akun apa pun)

```bash
npm install
```

```bash
npm run local:demo
```

Buka http://localhost:8787, password `montrack`. Data demo disimpan di folder `.local-db` (hapus folder itu untuk mulai dari nol; `npm run local` = tanpa data demo).

## Deploy ke Cloudflare + Neon

### 1. Database Neon
1. Daftar di https://neon.tech, lalu buat project. Region **AWS Asia Pacific (Singapore)** paling dekat.
2. Salin *connection string* (`postgresql://...neon.tech/neondb?sslmode=require`).
3. Buat tabel dan kategori default:

```bash
DATABASE_URL='postgresql://...' npm run db:migrate
```

### 2. Secret & deploy Worker
Buat tiga string acak, satu untuk tiap secret:

```bash
openssl rand -hex 24
```

```bash
npx wrangler login
```

```bash
npx wrangler secret put DATABASE_URL
```

```bash
npx wrangler secret put APP_PASSWORD
```

```bash
npx wrangler secret put SESSION_SECRET
```

```bash
npx wrangler secret put INGEST_SECRET
```

```bash
npm run deploy
```

Aplikasi aktif di `https://montrack.<subdomain-kamu>.workers.dev`. Login dengan `APP_PASSWORD`.

> Kalau `wrangler secret put` menolak karena Worker belum ada, jalankan `npm run deploy` sekali dulu, isi secret-nya, lalu deploy lagi.

### 3. Sambungkan Gmail (Google Apps Script)
1. Di aplikasi BRImo / wondr BNI / BSI Mobile / GoPay / DANA / OVO / ShopeePay, **nyalakan notifikasi email transaksi**.
2. Buka https://script.google.com, buat **New project**, lalu tempel isi [`apps-script/Code.gs`](apps-script/Code.gs).
3. Buka **Project Settings → Script Properties** dan tambahkan:
   - `MONTRACK_URL` = `https://montrack.<subdomain-kamu>.workers.dev`
   - `MONTRACK_SECRET` = nilai `INGEST_SECRET`
4. Pilih fungsi **`setup`**, klik **Run**, lalu izinkan akses. Fungsi ini memasang pemicu tiap 5 menit dan mengirim email 30 hari terakhir.

Server memproses maksimal 4 email per kiriman, karena paket gratis Cloudflare Workers membatasi 50 query database per request. Sisanya ditandai `deferred` dan dikirim ulang otomatis. Kalau kamu memperbarui `Code.gs`, tempel versi baru lalu jalankan `setup` lagi.

Akses Gmail tetap di akun Google-mu. Montrack tidak pernah memegang token Gmail; script hanya *mengirim* email dari pengirim yang terdaftar di `SENDERS`.

### 4. Notifikasi HP → Montrack (untuk transaksi tanpa email, mis. Jago/GoPay Tabungan)
Aplikasi web tidak bisa membaca notifikasi HP, jadi notifikasi diteruskan oleh **MacroDroid** (Play Store, versi gratis cukup):
1. **Trigger**: *Notification* → *Notification Received* → pilih aplikasi (Jago, wondr by BNI, DANA, dll.) → *Any content*.
2. **Action**: *Connectivity* → *HTTP Request*:
   - Method `POST`, URL `https://montrack.<subdomain>.workers.dev/api/ingest/notification`
   - Header `Authorization: Bearer <INGEST_SECRET>`
   - Content type `application/json`, body:
     `{"app":"[not_app_name]","title":"[not_title]","text":"[notification]"}`
     (pilih teks bertanda kurung siku lewat tombol **…** / *Magic Text* agar namanya tepat)
3. Izinkan *Notification access* untuk MacroDroid.

Pembacaannya longgar (nominal "Rp…" + kata kunci bayar/terima/top up). Transaksi yang sama dari email dan notifikasi hanya dicatat sekali.

### 5. Pemakaian pertama
1. **Lainnya → Pengaturan → Nama pemilik rekening**: isi namamu seperti yang tertulis di rekening. Transfer ke atau dari nama ini dicatat sebagai *transfer antar rekening sendiri*.
2. **Akun**: akun BRI/BNI/GoPay dst. dibuat otomatis saat email pertama masuk. Klik **Sesuaikan** lalu isi saldo sebenarnya, supaya saldo akurat. Selisihnya dicatat sebagai *penyesuaian*, bukan pengeluaran.
3. **Tinjau**: pilih kategori untuk transaksi yang belum dikenali, cukup sekali per merchant.
4. Sebulan sekali, **Impor mutasi** dari e-statement bank (PDF bisa diberi password, dan file dibaca di browser) untuk menangkap biaya admin dan bunga.

## Cara Montrack menghitung

| Jenis | Contoh | Masuk "Pengeluaran bulan ini"? | Mengubah saldo akun? |
|---|---|---|---|
| Pengeluaran | QRIS, bayar PLN, biaya admin | ✅ | ✅ berkurang |
| Pemasukan | gaji, refund, bunga | ➖ (dihitung sebagai pemasukan) | ✅ bertambah |
| Transfer | top-up GoPay dari BRI, tarik tunai, pindah ke rekening sendiri | ❌ | ✅ pindah antar akun |
| Penyesuaian | koreksi saldo | ❌ | ✅ |

- Email "Top Up GoPay" dari BRI dan email "Top up berhasil" dari GoPay (nominal sama, selisih waktu ≤ 30 menit) **digabung jadi satu transfer**.
- Biaya admin pada email (mis. Rp1.000 top-up, Rp2.500 BI-FAST) dicatat sebagai pengeluaran terpisah berkategori *Biaya Bank & Admin*.
- Transfer ke nama orang lain dicatat sebagai pengeluaran *Transfer ke Orang Lain* dan masuk **Tinjau**. Kalau ternyata rekeningmu sendiri, klik **"Ini rekening saya sendiri"**.
- Bulan dihitung dalam WIB.

## Tentang parser email

Format email tiap bank dan e-wallet berbeda dan bisa berubah. Parser di `src/worker/parsers/email.ts` membaca **label** yang umum dipakai (Nominal, Total Bayar, Nama Merchant, Penerima, Tanggal, No. Referensi, dll.), jadi tidak bergantung pada satu template.

**Penting:** contoh email di `tests/fixtures.ts` masih **sintetis** (meniru pola umum), belum diambil dari email asli. Email yang belum terbaca tidak hilang: email itu muncul di **Tinjau → Email yang belum terbaca**, dan bisa **Baca ulang** setelah parser diperbarui. Untuk memperkuat parser:

1. Salin isi email asli (samarkan nominal, nama, dan nomor rekening) ke `tests/fixtures.ts`.
2. Tambahkan test di `tests/parser.test.ts`, lalu perbaiki parser sampai lolos (`npm test`).

## Pengembangan

| Perintah | Fungsi |
|---|---|
| `npm run local:demo` | Server lokal Node + PGlite dengan data contoh |
| `npm run dev` | Vite + Worker (workerd) dengan hot reload. Butuh `.dev.vars` (lihat `.dev.vars.example`) berisi `DATABASE_URL` Neon |
| `npm test` | Test parser, mutasi, dan alur API terhadap Postgres (PGlite) |
| `npm run typecheck` | Pemeriksaan TypeScript |
| `npm run db:generate` | Buat migrasi baru setelah mengubah `src/worker/db/schema.ts` |
| `npm run db:migrate` | Terapkan migrasi ke Neon |
| `npm run deploy` | Build & deploy ke Cloudflare |

```
src/
  worker/            API (Hono) untuk Cloudflare Workers
    db/              skema Drizzle, koneksi Neon, seed kategori & aturan
    parsers/         parser email bank/e-wallet, tanggal, HTML→teks
    services/        ingest email, kategorisasi, saldo, ringkasan, impor mutasi
  client/            React SPA (Tailwind)
  shared/            tipe, format rupiah, waktu WIB, parser mutasi CSV/PDF
apps-script/Code.gs  kurir Gmail → Montrack
scripts/             migrasi Neon & server lokal
tests/               Vitest + PGlite
```

## Keamanan
- Satu pengguna: login dengan `APP_PASSWORD`, sesi berupa cookie `HttpOnly` + `Secure` (JWT HS256, 30 hari).
- Endpoint `/api/ingest/email` hanya menerima `Authorization: Bearer <INGEST_SECRET>`.
- Isi email disimpan (sebagai teks) di database Neon milikmu, agar bisa dibaca ulang saat parser diperbarui.
- File mutasi diproses di browser; yang dikirim ke server hanya tanggal, keterangan, dan nominal.
