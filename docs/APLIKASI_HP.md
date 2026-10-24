# Menjadikan ONE BLISS aplikasi HP

Aplikasi ini adalah **PWA** (Progressive Web App), cara yang sama dipakai banyak aplikasi modern. Sudah ada: manifest (`web/manifest-*.webmanifest`), ikon 192/512/maskable, service worker (`web/sw.js`), dan push notifikasi (VAPID) saat aplikasi ditutup.
Syarat: server terjangkau lewat **alamat https** (Tailscale Funnel).

## Tahap 1 - Pasang dari browser (siap pakai)
- **Android (Chrome):** buka alamat publik > menu ⋮ > *Pasang aplikasi* (atau tombol "Instal Aplikasi" di halaman).
- **iPhone (Safari):** Bagikan > *Tambah ke Layar Utama*. Notifikasi push di iPhone hanya jalan setelah dipasang ke Layar Utama (iOS 16.4 ke atas).
- Staf: buka alamat staf (`/login`) dan pasang dengan cara sama; Resepsionis, Owner, Karyawan masing-masing punya ikon sendiri.

## Tahap 2 - APK Android sungguhan (Trusted Web Activity)
APK ini membungkus PWA memakai Chrome di dalamnya, sehingga **push notifikasi, panggilan suara, dan kamera tetap berfungsi**. Cara tanpa menulis kode:

1. Pastikan alamat publik tamu sudah bisa dibuka dari HP lewat data seluler.
2. Buka <https://www.pwabuilder.com>, masukkan alamat publik, lalu pilih paket **Android**. Isi nama paket (contoh `com.onebliss.tamu`) dan buat/unduh kunci tanda tangan. **Simpan berkas kunci dan sandinya dengan aman, jangan masukkan ke repo** (`.gitignore` sudah menolak `*.keystore`, `*.jks`).
3. PWABuilder memberi berkas `assetlinks.json`. Simpan sebagai `C:\onebliss_data\assetlinks.json` (atau `~/onebliss_data/assetlinks.json`) lalu jalankan ulang server. Server menyajikannya di `/.well-known/assetlinks.json` (sudah disiapkan di `server.py`). Tanpa ini, aplikasi akan menampilkan bilah alamat browser.
4. Hasilnya `.apk` untuk dibagikan langsung (tamu perlu mengizinkan "sumber tidak dikenal") atau `.aab` untuk **Google Play Console** (biaya pendaftaran satu kali; Play mewajibkan halaman *Kebijakan Privasi*, karena aplikasi memakai mikrofon, kamera, dan No. HP).

Catatan: langkah PWABuilder dan Play Console berubah dari waktu ke waktu; ikuti petunjuk terbaru di sana. Langkah ini belum saya uji dari sisi Anda.

## Tahap 3 - iPhone App Store
Perlu Mac, Xcode, dan akun Apple Developer berbayar tahunan; Apple juga sering menolak aplikasi yang hanya membungkus situs. Untuk iPhone, Tahap 1 (Tambah ke Layar Utama) adalah jalur yang realistis.

## Supaya "seperti WhatsApp"
- Notifikasi saat aplikasi tertutup: sudah ada (Web Push). Di Android bekerja untuk PWA terpasang maupun APK TWA.
- Server harus menyala terus. Selama server ada di komputer hotel, aplikasi mati bila komputer/internet hotel mati. Bagian yang bisa dipindah ke VPS 24 jam adalah server tamu; bagian ESP32 (pintu) tetap butuh komputer di jaringan hotel.
