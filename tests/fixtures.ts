/**
 * Contoh email SINTETIS yang meniru pola umum notifikasi bank/e-wallet Indonesia.
 * Ganti/tambah dengan email asli (disamarkan) untuk memperkuat parser.
 */
export const EMAILS = {
  briQris: {
    from: "BRImo <notifikasi@bri.co.id>",
    subject: "Transaksi Berhasil - Pembayaran QRIS",
    body: `Halo FAJAR,
Transaksi Anda berhasil.
Jenis Transaksi : Pembayaran QRIS
Tanggal : 31 Oktober 2026, 12:41:07 WIB
Nomor Referensi : 123456789012
Sumber Dana : 0123 **** **** 4567
Nama Merchant : KOPI SENJA JAKARTA
Nominal : Rp 25.000,00
Biaya Admin : Rp 0,00
Total : Rp 25.000,00`,
  },
  briTopupGopay: {
    from: "BRImo <notifikasi@bri.co.id>",
    subject: "Transaksi Berhasil - Top Up GoPay",
    body: `<table><tr><td>Jenis Transaksi</td><td>Top Up GoPay</td></tr>
<tr><td>Tanggal</td><td>30/10/2026 08:15:20</td></tr>
<tr><td>No. Referensi</td><td>9988776655</td></tr>
<tr><td>Sumber Dana</td><td>0123********4567</td></tr>
<tr><td>Nomor Tujuan</td><td>0812****7890</td></tr>
<tr><td>Nominal</td><td>Rp100.000</td></tr>
<tr><td>Biaya Admin</td><td>Rp1.000</td></tr>
<tr><td>Total</td><td>Rp101.000</td></tr></table>`,
  },
  gopayTopupIn: {
    from: "GoPay <no-reply@gopay.co.id>",
    subject: "Top Up GoPay berhasil",
    body: `Saldo GoPay kamu sudah bertambah.
Top Up dari
BRI
Jumlah Top Up
Rp100.000
Waktu
30 Okt 2026 08:15
ID Transaksi
GPTU-ABC12345`,
  },
  gopayQris: {
    from: "GoPay <no-reply@gopay.co.id>",
    subject: "Pembayaran QRIS berhasil",
    body: `Kamu bayar
Rp35.000
ke
Merchant
Sayur & Telur Bu Ani
Metode pembayaran
GoPay Saldo
Waktu
4 Okt 2026, 07:12
ID Transaksi
QR-00991122`,
  },
  bniTransferOut: {
    from: "wondr by BNI <wondr@bni.co.id>",
    subject: "Transfer Berhasil",
    body: `Transfer Berhasil
Tanggal Transaksi: 29 Okt 2026 19:02 WIB
Rekening Sumber: 12345678 90
Nama Penerima: BUDI SANTOSO
Bank Tujuan: BCA
Nominal Transfer: Rp 250.000
Biaya: Rp 2.500
No. Ref: BNI202610290001`,
  },
  bniTransferIn: {
    from: "BNI <noreply@bni.co.id>",
    subject: "Dana Masuk ke Rekening Anda",
    body: `Anda telah menerima dana
Nama Pengirim : PT MAJU JAYA
Jumlah : Rp 9.500.000,00
Tanggal : 25/10/2026 09:00
Berita : GAJI OKTOBER`,
  },
  bsiPayment: {
    from: "BSI Mobile <info@bankbsi.co.id>",
    subject: "Bukti Pembayaran",
    body: `BSI Mobile
Pembayaran PLN Prabayar Berhasil
Tanggal : 28-10-2026 20:11:45
Nama Toko : PLN PREPAID
Nominal : Rp 200.000
Biaya Administrasi : Rp 2.500
Total Bayar : Rp 202.500
No. Referensi : BSI2810ABC`,
  },
  danaPayment: {
    from: "DANA <no-reply@dana.id>",
    subject: "Pembayaran Berhasil",
    body: `Pembayaran kamu berhasil!
Total Bayar Rp22.000
Merchant Nasi Goreng Pak Kumis
Tanggal 31 Okt 2026 19:30
ID Transaksi 2026103112345678`,
  },
  ovoPayment: {
    from: "OVO <no-reply@ovo.id>",
    subject: "OVO - Bukti Pembayaran",
    body: `Terima kasih telah menggunakan OVO
Merchant Name: INDOMARET TEBET
Total Payment: Rp 44.500
Date: 31 Oct 2026 10:05
Reference No: OVO-77821`,
  },
  shopeepayRefund: {
    from: "ShopeePay <info@shopee.co.id>",
    subject: "Refund ShopeePay berhasil",
    body: `Dana dikembalikan ke ShopeePay kamu
Jumlah: Rp 59.000
Waktu: 30 Okt 2026 13:00
No. Transaksi: SPAY998877`,
  },
  otp: {
    from: "BRImo <notifikasi@bri.co.id>",
    subject: "Kode OTP BRImo Anda",
    body: "Kode OTP Anda 123456. Jangan berikan kepada siapapun.",
  },
  promo: {
    from: "DANA <promo@dana.id>",
    subject: "Promo Spesial! Diskon 50% hari ini",
    body: "Nikmati diskon hingga Rp50.000",
  },
  failed: {
    from: "GoPay <no-reply@gopay.co.id>",
    subject: "Pembayaran gagal",
    body: "Pembayaran Rp20.000 ke Toko X gagal.",
  },
};

/**
 * Struktur email wondr by BNI (Nov 2026). Semua nilai (nama, merchant, lokasi,
 * nomor rekening/referensi, nominal) adalah REKAAN; hanya susunan labelnya yang asli.
 */
export const WONDR = {
  qris: {
    from: "wondr by BNI <wondr@bni.co.id>",
    subject: "Transaksi berhasil!",
    body: `Transaksi berhasil!
Hai, NAMA PEMILIK
Terima kasih udah bertransaksi dengan wondr by BNI! Kamu baru aja bayar pakai QRIS dengan detail sebagai berikut:
Penerima
9XY9 MPM TOKO CONTOH SEJAHTERA
KOTA CONTOH, 12345, ID
Sumber dana
NAMA PEMILIK
TAPLUS • ******999
Tanggal & waktu transaksi
Tanggal
11 Okt 2026
Waktu
21:33:37 WIB
Detail pembayaran
Nominal
Rp11.300
Total
Rp11.300
Detail merchant
Merchant ID
111111111111111
Merchant PAN
2222222222222222222
Terminal ID
A01
Nama acquirer
BANK CONTOH
Detail transaksi
Customer PAN
3333333333333333333
Nama issuer
BNI
Jenis transaksi
QRIS
Reference ID
20261011000000000001
Kode RRN
abc000000001
Butuh bantuan?`,
  },
  topup: {
    from: "wondr by BNI <wondr@bni.co.id>",
    subject: "Top-up berhasil!",
    body: `Top-up berhasil!
Hai, NAMA PEMILIK
Terima kasih udah memilih wondr by BNI untuk transaksi kamu! Kamu baru aja top-up e-Wallet dengan detail sebagai berikut:
Penerima
NAMA PEMILIK
GoPay • 62*******0000
Sumber dana
NAMA PEMILIK
TAPLUS • ******999
Tanggal & waktu top-up
Tanggal
06 Oktober 2026
Waktu
08:04:16 WIB
Detail top-up
Nominal
Rp50.000
Biaya transaksi
Rp1.000
Total
Rp51.000
Lainnya
Ref ID
20261006000000000002
Biaya transaksi sudah termasuk PPN (bila ada).`,
  },
};

/** Struktur email transfer wondr BNI (nilai rekaan). */
export const WONDR_TRANSFER = (name: string, bankLine: string, amount = "Rp100.000") => ({
  from: "wondr by BNI <wondr@bni.co.id>",
  subject: "Transfer berhasil!",
  body: `Transfer berhasil!
Hai, NAMA PEMILIK
Penerima
${name} -
${bankLine}
Sumber dana
NAMA PEMILIK
TAPLUS • ******999
Tanggal & waktu transaksi
Tanggal
02 Nov 2026
Waktu
20:49:10 WIB
Detail transaksi
Nominal transaksi
${amount}
Biaya admin
Rp2.500
Total
Rp102.500
Metode transaksi
Metode
BI-FAST
Lainnya
Reference ID
20261102000000000777`,
});

/** Contoh notifikasi Jago (dari screenshot pengguna, tanpa data pribadi). */
export const JAGO_NOTIF = {
  paid: { app: "Jago", title: "Jago", text: "You've paid Rp20.000 with GoPay Tabungan Transaction. Need help? Contact Tanya Jago at 1500 746." },
  received: { app: "Jago", title: "Jago", text: "You've received Rp100.000 from NAMA PEMILIK" },
};
