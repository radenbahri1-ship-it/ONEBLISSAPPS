# ONE BLISS

Sistem hotel + aplikasi tamu: reservasi, kunci kamar digital (ESP32), chat, panggilan suara (WebRTC), ulasan, akun aplikasi, dan panel untuk resepsionis, owner, serta karyawan/housekeeping.
Berjalan sebagai **server Python tanpa library tambahan** + aplikasi web (PWA) yang bisa dipasang di HP seperti aplikasi biasa.

## Isi repo
| Folder / berkas | Fungsi |
|---|---|
| `server.py` | Server hotel (port staf 8088, port tamu 8089, port WiFi hotel 8087), akun, sinkron data, push, hub resepsionis tersembunyi |
| `esp_bridge.py` | Jembatan ke ESP32-C3 di tiap kamar (pass, relay, status) |
| `web/` | Aplikasi: `tamu`, `resepsionis`, `owner`, `karyawan`, monitor `esp`, service worker `sw.js`, manifest PWA, ikon |
| `mulai.bat` / `mulai.sh` | Jalankan server (Windows / Linux, macOS, Raspberry Pi), otomatis hidup lagi bila berhenti |
| `tools/cek.py` | Pemeriksaan otomatis (sintaks + uji server); dipakai GitHub Actions |
| `docs/PANDUAN_LENGKAP.md` | Panduan pasang: Tailscale Funnel, akun, ESP32, panggilan suara |
| `docs/APLIKASI_HP.md` | Cara menjadikannya aplikasi HP (PWA dan APK Android) |

## Mulai cepat
Syarat: Python 3.9+ (Windows: centang *Add python.exe to PATH*). Edge atau Chrome dipakai server sebagai "resepsionis tersembunyi".

```
git clone <alamat-repo-anda>
cd ONEBLISSAPPS
mulai.bat          # Windows
./mulai.sh         # Linux / macOS
```
Jendela server menampilkan alamat dan **sandi owner awal**. Buka `http://localhost:8088`, masuk sebagai `owner`, lalu ganti sandi.
Data (akun, kata sandi, chat, config) disimpan di luar folder program: `C:\onebliss_data` (Windows) atau `~/onebliss_data`. Ubah dengan variabel lingkungan `ONEBLISS_DATA`. **Folder data tidak masuk repo.**

Agar tamu bisa membuka dari internet: ikuti `docs/PANDUAN_LENGKAP.md` (Tailscale Funnel ke port 8089). Jangan pernah mengarahkan Funnel ke port 8088 (panel staf).

## Jadi aplikasi sungguhan
Lihat `docs/APLIKASI_HP.md`. Ringkas: aplikasi sudah memenuhi syarat PWA (manifest, ikon, service worker, notifikasi push), jadi bisa dipasang dari Chrome/Safari, dan bisa dikemas menjadi APK Android.

## Catatan keamanan
- Tidak ada alamat, kata sandi, atau kunci pribadi di dalam kode. Alamat publik diisi sendiri: `python server.py --public https://NAMA-PC.xxxx.ts.net` (tersimpan di `data/config.json`, tidak masuk repo).
- Bawaan firmware ESP32 (`admin / 12345678`, `dev12345`) hanya tertulis di panduan: ganti di perangkat nyata.
- Belum ada berkas `LICENSE`: tanpa lisensi, semua hak tetap pada Anda. Tambahkan bila ingin kode boleh dipakai orang lain.

## Pemeriksaan
```
python tools/cek.py
```
GitHub Actions menjalankan ini di Ubuntu dan Windows pada setiap push (`.github/workflows/ci.yml`).
