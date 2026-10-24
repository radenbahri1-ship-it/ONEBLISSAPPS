# ONE BLISS online untuk tamu di luar (Tailscale Funnel)

## Sekali saja
1. Pasang Python 3 dan Tailscale di komputer resepsionis, login Tailscale.
2. Di https://login.tailscale.com/admin : aktifkan MagicDNS + HTTPS Certificates, lalu izinkan Funnel untuk komputer ini.
3. Jalankan `mulai.bat`. Catat KODE STAF yang tampil.
4. Buka CMD baru:  `tailscale funnel --bg 8089`   (hasilnya alamat `https://NAMA-PC.xxxx.ts.net`)
5. Tutup server, edit `data\config.json`, isi `"public_url": "https://NAMA-PC.xxxx.ts.net"`, jalankan `mulai.bat` lagi.
   (atau: `python server.py --public https://NAMA-PC.xxxx.ts.net`)

## Setiap hari
- Komputer menyala, `mulai.bat` jalan, Tailscale aktif.
- Buka http://localhost:8088/hotel/resepsionis dan BIARKAN TERBUKA (halaman inilah yang memproses semua pendaftaran, login, dan permintaan tamu). Isi KODE STAF sekali.
- Owner: http://localhost:8088/hotel/owner , Karyawan: http://localhost:8088/hotel/karyawan (dari komputer/HP di WiFi hotel: ganti localhost dengan IP komputer).
- Link & QR tamu yang dibuat resepsionis otomatis memakai alamat publik (https://NAMA-PC.xxxx.ts.net/tamu-lama3.html?room=..).
- Tes: matikan WiFi HP, pakai data seluler, buka alamat publik.

## Yang terbuka ke internet (port 8089) dan yang TIDAK
- Terbuka: halaman tamu, dan pesan tamu (daftar, login, perintah kamar, chat, unggah file maks 3 MB).
- TIDAK terbuka: resepsionis, owner, karyawan, data tersimpan (`/hs/kv`). Jangan arahkan Funnel ke port 8088.
- Server menyaring pesan: tamu hanya menerima pesan miliknya (kamar yang berhasil login, pendaftarannya sendiri) dan hanya boleh mengirim jenis pesan tamu. Ada batas laju per IP.
- Data tersimpan di `data\hs_kv.json` (+ `data\guest_secrets.json` untuk kata sandi akun tamu), file chat di `data\files\`. Cadangkan SELURUH folder `data` (kedua file harus dari waktu yang sama).

# SEMUA ONLINE + APLIKASI HP

## Dua pintu, dua alamat
| Siapa | Alamat | Cara membuka |
|---|---|---|
| Tamu (publik, siapa saja) | `https://NAMA-PC.xxxx.ts.net` | Funnel yang sudah berjalan (port 8089) |
| Staf: resepsionis, owner, karyawan (privat) | `https://NAMA-PC.xxxx.ts.net:8443/hotel/owner` (dst.) | Tailscale Serve, hanya perangkat di akun/tailnet Anda |

Panel staf sengaja TIDAK dibuka ke internet umum. Untuk membuka dari HP owner/karyawan di luar hotel:
1. Di komputer server, CMD: `tailscale serve --bg --https=8443 8088`
2. Cek: `tailscale serve status` (harus ada 8443 -> 8088) dan `tailscale funnel status` (Funnel hanya 443 -> 8089, jangan ada 8443).
3. Di HP owner/karyawan: pasang aplikasi Tailscale dan login ke akun yang sama (untuk orang lain: undang lewat menu Share/Invite di admin Tailscale), lalu buka alamat staf di atas. Isi KODE STAF sekali.
4. Karena alamatnya https, kamera (scan QR karyawan) dan mikrofon (panggilan suara) bisa dipakai.
Resepsionis tetap harus terbuka di komputer server (atau di perangkat lain lewat alamat staf) agar tamu dilayani.

## Jadi aplikasi di HP (PWA)
- **Tamu:** buka `https://NAMA-PC.xxxx.ts.net` di Chrome (Android): muncul bilah "Pasang" (atau menu ⋮ > Pasang aplikasi). Di iPhone (Safari): Bagikan > Tambah ke Layar Utama.
- **Staf:** buka alamat staf (port 8443) di HP, lalu pasang dengan cara yang sama. Resepsionis, Owner, dan Karyawan masing-masing menjadi aplikasi sendiri dengan ikon OB.
- Aplikasi tetap terbuka walau sinyal putus sebentar (tampil halaman terakhir); data hidup selalu dari server.
- Notifikasi juga muncul saat aplikasi ditutup (Web Push, lihat bagian "NOTIFIKASI PUSH" di bawah).
- Halaman tamu lewat WiFi hotel (`http://IP-KOMPUTER:8087`, untuk deteksi relay) tidak bisa dipasang sebagai aplikasi karena bukan https. Pakai alamat Funnel untuk aplikasi, dan QR di pintu untuk membuka pintu lewat WiFi hotel.

## Panggilan suara
- Butuh https dan mikrofon, jadi hanya jalan lewat alamat Funnel / alamat staf (bukan alamat WiFi http).
- Bawaan memakai server STUN Google. Kalau panggilan dari data seluler tidak tersambung, tambahkan server TURN di `data\config.json`:
  `"ice_servers": [{"urls": "turn:HOST:3478", "username": "USER", "credential": "PASS"}]` lalu jalankan ulang server (ada layanan TURN dengan paket gratis).

# ESP32-C3 kamar (firmware ESP32C3_ONE_BLISS_REAL_v5_88.ino)
Server menjadi jembatan ke ESP32-C3 tiap kamar. Tidak ada yang perlu diubah di firmware v5.88.

## Alur yang dipakai (mode WiFi, bawaan)
1. Resepsionis menyetujui check-in -> server membuat pass di ESP kamar (kode = PIN 6 digit tamu, berlaku sampai check-out + `grace_min`).
2. Tamu terhubung ke WiFi hotel, membuka halaman tamu lewat alamat WiFi hotel (`http://IP-KOMPUTER:8087`, tampil di jendela server; QR di pintu otomatis mengarah ke sini), login dengan PIN, lalu menekan buka pintu -> relay ON. Server mencatat IP HP tamu.
3. Selama tamu di dalam, server mengecek HP tamu (ping) tiap beberapa detik dan mengabari ESP. HP tidak terjawab lebih dari `wifi_grace` detik (keluar WiFi / pergi) -> relay OFF dan sesi berakhir.
4. Tamu kembali: login / tekan buka pintu lagi (atau scan QR pintu).
5. Check-out di resepsionis -> pass dicabut.
Monitor semua kamar (ESP online, pass, sesi, relay, HP di WiFi, sisa pass): `http://localhost:8088/esp`.

## Setelan (data\config.json, bagian "esp")
- `ip_template` ("192.168.1.{no}") atau `rooms` ({"101": "192.168.8.51"}) = alamat ESP tiap kamar.
- `user` / `password` = login admin dashboard ESP32 (bawaan firmware admin / 12345678).
- `mode`: 1 = WiFi (bawaan, sesuai alur di atas), 2 = BLE, 3 = WiFi atau BLE (lebih stabil kalau HP tamu sering tidur). Setelah mengubah `mode`, jalankan ulang server.
- `wifi_grace` (detik, 20-900, bawaan 120) = toleransi HP tidak terjawab sebelum dianggap keluar. HP yang layarnya mati kadang tidak menjawab ping, jadi naikkan ke 180-300 kalau relay sering mati sendiri. Nilai ini baru dikirim ke ESP kalau `dev_password` (password developer ESP) diisi.
- `hold` (menit) = relay tetap ON saat belum ada tanda tamu di WiFi. `ping_every` = jeda cek HP (detik).
- `lan_guest_port` (bawaan 8087, isi 0 untuk mematikan) = port halaman tamu untuk WiFi hotel.
- `enabled: false` = matikan jembatan (simulasi saja).

## Syarat jaringan
- Komputer server, ESP32 kamar, dan WiFi tamu harus satu jaringan/subnet. WiFi tamu tidak boleh memakai "AP/client isolation", karena komputer harus bisa mengecek (ping) HP tamu.
- Izinkan python di Windows Firewall (jaringan Private dan Public) saat ditanya, supaya port 8087 bisa dibuka dari HP tamu.
- Halaman tamu lewat WiFi hotel memakai http (bukan https), jadi fitur yang butuh https (kamera, mikrofon, notifikasi) tidak aktif di sana. Login, buka pintu, dan chat tetap jalan.
- Tamu yang membuka dari internet (alamat Funnel) tidak punya IP WiFi, jadi relay hanya menyala selama `hold` dan tidak bisa bertahan. Deteksi keberadaan hanya untuk tamu yang membuka lewat WiFi hotel.

# Firmware KEYLESS (ESP32C3_ONE_BLISS_KEYLEssv3_heap2_nimble1, v5.83+ NimBLE)
Firmware ini tidak punya endpoint /pass_*. Server mendeteksinya otomatis (kamar tampil "firmware KEYLESS terdeteksi" di jendela server) dan memakai API bawaan firmware:
- Check-in disetujui  -> /action?cmd=ready  (kamar "Menunggu Tamu")
- Tamu tekan Pintu    -> /lrelay_set?r=N&state=3  (pulsa relay berfungsi "Kunci"; N dicari otomatis dari /lrelay_get). Kalau tidak ada relay "Kunci": /action?cmd=open lalu close setelah `relock_s` detik.
- Check-out           -> /action?cmd=checkout
- Status/monitor      -> /status
Setelan di data\config.json bagian "esp":
- `dev_password` = password Developer dashboard ESP32 (bawaan firmware: dev12345). WAJIB cocok, kalau tidak pintu ditolak (401).
- `rooms` atau `ip_template` = alamat ESP32 tiap kamar. `driver`: "auto" (bawaan) / "keyless" / "pass".
- `lock_relay` (0 = otomatis), `relock_s` (detik, hanya untuk cadangan relay utama).
Yang tetap dilakukan di dashboard ESP32: pairing BLE HP tamu (Pair), sehingga relay/lampu/AC mengikuti kehadiran tamu lewat BLE. Tamu tanpa pairing tetap bisa buka pintu lewat tombol Pintu di web.

## Firmware v5.84 (ESP32C3_ONE_BLISS_KEYLESS_v5_84_PASS.ino) - disarankan
Firmware ini sudah memahami PIN dari web (/pass_*), jadi server memakai mode "pass" otomatis (PIN tamu, masa berlaku, buka pintu, sesi berakhir saat HP keluar WiFi). Logika BLE bawaan tidak diubah. Setelan `admin_password` ESP harus sama dengan `esp.password` di config.json (bawaan 12345678), dan `dev_password` dengan password Developer ESP.

# INTERKOM: panggilan suara antar tamu, resepsionis, owner, dan karyawan/HK
Semua aplikasi punya tombol 📞 (kanan bawah) yang membuka pop-up interkom: daftar kontak, tombol Panggil, dan layar panggilan (mikrofon ON/OFF, akhiri). Panggilan masuk muncul sebagai pop-up layar penuh dengan nada dering (Angkat / Tolak). Suara berjalan langsung antar perangkat (WebRTC); server hanya meneruskan sinyal.

## Pengaturan (hanya di aplikasi Owner, tab "📞 Panggilan")
- Aktifkan/matikan fitur untuk seluruh hotel.
- Siapa yang mendapat fitur: Resepsionis, Owner, Karyawan (Semua / Hanya yang dipilih / Tidak ada), Kamar (Semua / Hanya yang dipilih / Tidak ada; ada tombol "Hanya kamar terisi"). Yang tidak disematkan tidak melihat tombol panggilan dan tidak muncul di daftar kontak.
- Matriks "siapa boleh memanggil siapa" (Tamu, Karyawan/HK, Owner, Resepsionis). Bawaan: tamu boleh menelepon resepsionis dan karyawan; antar kamar dan tamu ke owner dimatikan; staf boleh saling dan boleh menelepon tamu.
- **Akun aplikasi tamu** (tamu yang login akun tanpa kamar): centang "Akun aplikasi tamu" di tab Panggilan. Bila aktif, akun tamu bisa menelepon Resepsionis (halaman resepsionis harus terbuka) dan ditelepon oleh Resepsionis/Owner dari menu Akun Aplikasi. Resepsionis juga harus diberi fitur. Bila dimatikan, akun tamu tidak bisa menelepon maupun ditelepon.
- Perubahan tersimpan otomatis dan langsung berlaku. Tamu tidak bisa menembus aturan ini: semua panggilan tamu diperiksa oleh halaman resepsionis (hub).

## Syarat
- Halaman resepsionis harus tetap terbuka (sudah wajib sejak awal); ia perantara panggilan tamu dan penyimpan pengaturan.
- Butuh HTTPS + izin mikrofon (alamat Funnel untuk tamu, alamat staf port 8443 untuk staf). Lewat http://IP-WiFi tombolnya tampil tapi memberi peringatan.
- Kalau panggilan dari data seluler tidak tersambung, isi server TURN di `data\config.json` (`ice_servers`), lihat bagian "Panggilan suara" di atas.
- Berkas baru: `web/hs/ic.js` (dipakai semua halaman). `server.py` hanya ditambah dua izin kecil (`ic2` dan `/hs/ic.js` untuk tamu).

# [DIGANTI di fix14: login PIN sudah tidak dipakai, lihat bagian "LOGIN AKUN STAF" paling bawah] STAF LEWAT FUNNEL
Funnel (port 8089) sekarang melayani DUA hal di alamat yang sama:
- Tamu: https://NAMA-PC.xxxx.ts.net/  (tanpa login, tidak dibatasi jumlah orangnya)
- Staf: https://NAMA-PC.xxxx.ts.net/login  -> pilih Resepsionis / Owner / Karyawan-HK, isi PIN.
  Tanpa Tailscale dan tanpa akun Gmail di HP staf. Login berlaku 30 hari per HP (tersimpan di data\sessions.json).

## PIN
Dibuat otomatis saat server pertama jalan dan tampil di jendela server. Ubah di data\config.json bagian "staff_pins":
  "staff_pins": {"owner": "...", "resepsionis": "...", "hk": "..."}   (minimal 6 karakter, lalu jalankan ulang server)
Hak halaman: owner = owner+resepsionis+karyawan; resepsionis = resepsionis+karyawan; HK = karyawan saja.
Monitor ESP (/esp) dan KODE STAF TIDAK bisa dibuka lewat Funnel, hanya dari komputer/WiFi hotel (port 8088).

## Pengaman
- Salah PIN 6x dalam 10 menit -> IP itu dikunci 10 menit. Total salah 100x/jam dari semua IP -> login baru dikunci sementara
  (yang sudah login tetap jalan; staf di komputer hotel/port 8088 tidak terpengaruh).
- Keluar: buka /logout.
- Catatan: semua staf yang sudah login memakai data bersama yang sama (seperti sebelumnya). Pembatasan per peran hanya pada halaman.
  PIN di dalam aplikasi owner tetap berlaku sebagai lapis kedua.

## Batas tamu (dinaikkan)
Pantau 40 koneksi/IP, 600 permintaan/menit/IP, kirim 300/menit/IP. Antrean pesan server 1000. Batas bandwidth Funnel dari Tailscale tetap berlaku.

# [DIGANTI di fix14: lihat "LOGIN AKUN STAF" paling bawah] LOGIN DENGAN PIN
- Alamat: `https://NAMA-PC.xxxx.ts.net/login`. Cukup isi PIN; sistem mengenali siapa yang masuk.
- Owner dan Resepsionis (PIN bersama): `data\config.json` > `staff_pins`.
- Karyawan: PIN pribadi 6-8 angka, diatur owner di dasbor Owner > Karyawan > Kelola karyawan (kolom PIN, tombol "Atur PIN"/"PIN acak"). Tidak boleh ada dua karyawan dengan PIN sama.
- Karyawan berperan Housekeeping/Teknisi/Laundry/Keamanan/Lainnya masuk ke halaman karyawan (otomatis login sebagai dirinya). Berperan Resepsionis masuk ke dasbor resepsionis.
- Nonaktifkan/hapus karyawan atau ganti PIN-nya: sesi di HP orang itu langsung tidak berlaku.
- Karyawan (HK) tidak bisa melihat PIN/QR orang lain dan tidak bisa mengirim perintah owner.
- Komputer server (localhost:8088) tetap masuk tanpa PIN.

# RESERVASI BERDASARKAN TANGGAL + ULASAN TAMU (pembaruan)
## Reservasi
- Pendaftaran tamu untuk tanggal mendatang (mis. hari ini tgl 26, booking tgl 28) tidak lagi membuat kamar langsung "Terisi". Setelah resepsionis menyetujui, kamar tetap kosong sampai tanggal check-in; reservasi tampil di kartu "Reservasi mendatang" (resepsionis) dan tab "📅 Reservasi" (owner).
- Kamar dianggap bentrok hanya jika tanggalnya beririsan (check-out = hari check-in berikutnya diperbolehkan). Pendaftaran yang bentrok ditolak otomatis.
- Halaman tamu: pilih Check-in/Check-out lalu daftar kamar langsung menyesuaikan. Kamar yang dipesan pada tanggal itu tampil "Sudah dipesan"; tanggal lain tetap "Tersedia". Di detail kamar tampil tanggal yang sudah dipesan.
- Hari check-in (pukul jam check-in hotel) sistem otomatis check-in: PIN & QR dikirim ke HP tamu. Bisa dimatikan di owner > Reservasi, lalu resepsionis menekan "Check-in sekarang". Tamu dapat membatalkan lewat menu "Kamar Saya"; reservasi yang tidak pernah check-in hilang otomatis setelah tanggal check-out lewat.
- Pendapatan/voucher dicatat saat check-in (bukan saat disetujui). Data tersimpan di `hs_resv` (ikut disinkron seperti data lain).
## Ulasan tamu
- Tamu yang sedang menginap: Smart Room > Info > "Beri penilaian & ulasan" (bintang + komentar, bisa diperbarui).
- Semua tamu: menu "Ulasan" di aplikasi tamu menampilkan rata-rata, sebaran bintang, filter bintang, dan daftar ulasan (nama disingkat, mis. "Budi S.").
- Owner > "⭐ Rating & Ulasan": filter bintang, kamar, tipe, tanggal, status tayang, cari teks; Sembunyikan/Tayangkan/Hapus tiap ulasan; batas bintang minimal yang tayang; matikan/aktifkan fitur untuk tamu; ekspor CSV. Rata-rata di aplikasi tamu dihitung dari ulasan yang tayang saja.

# Chat & panggilan calon tamu (beranda tamu)
- Tombol "Tanya Resepsionis" (melayang), strip "Ada pertanyaan sebelum memesan?" dan panggilan suara muncul di beranda tamu, tanpa login.
- Resepsionis: menu **💬 Chat Calon Tamu** (balas langsung; ada lencana pesan belum dibaca + bunyi notifikasi). Panggilan masuk muncul di **📞 Panggilan Masuk** (Angkat/Tolak), sama seperti panggilan kamar.
- Halaman resepsionis harus tetap terbuka (seperti biasa). Kalau tertutup, tamu melihat status "Offline" dan tombol WhatsApp.
- Kata kunci FAQ otomatis (Owner > fitur "faq") ikut membalas chat calon tamu dengan awalan 🤖.
- Owner dapat menonaktifkan di tab Rating & Ulasan > "Chat & panggilan calon tamu di beranda".
- Panggilan suara butuh HTTPS (alamat Funnel). Riwayat chat disimpan 14 hari di data\hs_kv.json.

# AKUN & OBROLAN PENGGEMAR (fix10)
- **Tombol "Tulis Ulasan & Curhat"** ada di beranda tamu, bagian *Kata Tamu Kami*, di bawah kotak ulasan (juga saat belum ada ulasan). Di bawahnya tampil **Obrolan Penggemar ONE BLISS**: komentar, bintang opsional, dan balasan antar pengunjung.
- **Daftar akun di setiap aplikasi** (Tamu, Resepsionis, Owner, Karyawan): menu/tombol **👤 Akun** (di aplikasi staf: tombol kiri bawah). Isi nama, username, No. HP/WhatsApp, kata sandi. Akun tercatat atas aplikasi tempat ia mendaftar, jadi pemilik aplikasi mudah dikenali.
- Menulis ulasan dan membalas **wajib punya akun**; membaca obrolan terbuka untuk siapa saja.
- Akun yang dibuat dari aplikasi staf diberi lencana **Staf** di komentar. Lencana tidak bisa dipalsukan dari halaman tamu (server yang menandai asal pesan).
- Kata sandi tidak dikirim polos (SHA-256 di HP). No. HP **hanya** terlihat owner/resepsionis, tidak tampil publik dan tidak terbaca karyawan (HK).
- **Moderasi** (owner & resepsionis): 👤 Akun > Moderasi: lihat akun terdaftar (nama, @username, HP, aplikasi), blokir/buka blokir, sembunyikan atau hapus komentar & balasan. Penulis bisa menghapus tulisannya sendiri.
- Seperti fitur lain, **halaman resepsionis harus tetap terbuka**: halaman itulah pusat data akun (`hs_accts`) dan obrolan (`hs_comm`, tersimpan di `data\hs_kv.json`, ikut dicadangkan bersama folder `data`). Jika tertutup, tamu melihat obrolan terakhir yang tersimpan di HP-nya, tetapi tidak bisa daftar/masuk/menulis.
- Batas: kirim 1 tulisan per 12 detik per akun, 8 salah masuk per 10 menit per username, komentar 400 karakter, balasan 300 karakter, 300 komentar terakhir disimpan.

# MENU AKUN APLIKASI & PERSETUJUAN (fix13)
- **Resepsionis:** menu **👤 Akun Aplikasi** (kartu di dasbor, ada lencana jumlah akun menunggu). **Owner:** tab **👤 Akun Aplikasi**. Isinya semua yang mendaftar / punya aplikasi: nama, @username, No. HP, aplikasi asal (Tamu/Resepsionis/Owner/Karyawan), tanggal, dan status.
- **Persetujuan:** kotak centang *Setujui pendaftaran akun otomatis* (bawaan: nyala). Matikan untuk **manual**: akun baru berstatus *Menunggu*, lalu owner atau resepsionis menekan **✅ Setujui** / **⛔ Tolak** (atau **Setujui semua**). Akun dari aplikasi staf selalu langsung disetujui. Ada juga **Cabut** dan **Blokir**.
- Akun yang masih *Menunggu* bisa masuk tetapi belum bisa menulis/membalas dan fitur chat, panggilan, Smart Room belum terbuka. HP pendaftar memeriksa status otomatis tiap 15 detik dan langsung terbuka setelah disetujui. Resepsionis mendengar bunyi notifikasi saat ada pendaftar menunggu.
- Perintah setuju/tolak dari tab Owner diproses halaman resepsionis, jadi **halaman resepsionis harus terbuka dan sudah dimuat ulang setelah update**. Kalau tamu melihat "Pusat data belum menjawab", itu penyebab utamanya.

# LOGIN AKUN STAF - SATU APLIKASI UNTUK OWNER, RESEPSIONIS, KARYAWAN/HK (fix14)
PIN staf (owner, resepsionis, PIN karyawan) tidak dipakai lagi untuk masuk. Tiap orang punya **akun: username + kata sandi**. Sistem mengenali siapa yang masuk dan memberi halaman sesuai perannya. Tamu tetap aplikasi sendiri (tanpa akun, alamat `https://NAMA-PC.xxxx.ts.net/`).

## Satu alamat, satu aplikasi
- Alamat staf: `https://NAMA-PC.xxxx.ts.net/login` (di HP: Chrome > menu > Pasang aplikasi; hasilnya SATU ikon "OB Staf" untuk semua peran). Tidak perlu Tailscale/akun Gmail di HP staf.
- Setelah masuk, langsung terbuka halaman sesuai peran. Tombol **☰ Nama** (kanan atas) menampilkan nama & peran, pindah halaman yang boleh dibuka, **Ganti kata sandi**, dan **Keluar**.
- Hak per peran: **Owner** = Owner + Resepsionis + Karyawan; **Resepsionis** = Resepsionis + Karyawan; **Karyawan/HK** = halaman Karyawan saja (otomatis masuk sebagai dirinya, tanpa ketik ID/kode lagi).
- Login berlaku 30 hari per HP. Keluar membersihkan sesi di HP itu.

## Akun pertama (owner)
- Saat server pertama kali jalan, jendela server menampilkan **AKUN OWNER BARU: username `owner` + kata sandi acak**. Catat, masuk, lalu ganti lewat ☰ > Ganti kata sandi.
- Lupa kata sandi owner: tutup server, jalankan `python server.py --reset-owner` (membuat kata sandi owner baru dan menampilkannya).
- Akun disimpan di `data\users.json` (kata sandi disimpan terenkripsi PBKDF2, tidak bisa dibaca). Ikut dicadangkan bersama folder `data`.
- Karena PIN lama dihapus, semua login lama otomatis keluar; staf perlu akun baru (lihat di bawah).

## Membuat akun
Ada dua cara, hasilnya sama:
1. **Owner membuat langsung:** aplikasi Owner > tab **🔑 Akun Staf** > isi Nama, Username (huruf kecil/angka, 3-24), Peran, Kata sandi (min. 6) > Simpan. Untuk peran Karyawan/HK, pilih **karyawan terkait** dari daftar karyawan (dibuat di tab Karyawan); satu karyawan satu akun.
2. **[DIHAPUS di fix16: staf TIDAK bisa mendaftar sendiri lagi]** ~~Staf mendaftar sendiri:~~ di halaman login, tab **Daftar akun** (peran Karyawan/HK atau Resepsionis). Akun berstatus *Menunggu*; owner menekan **✅ Setujui** di tab Akun Staf (untuk HK, pilih dulu karyawan terkait lalu Simpan). Akun **Owner tidak bisa** dibuat lewat pendaftaran, hanya oleh owner.
- Di tab Akun Staf owner juga bisa: Ubah, Nonaktifkan/Aktifkan, Hapus, dan atur ulang kata sandi orang lain (mengganti kata sandi otomatis mengeluarkan akun itu dari semua perangkat).
- Perlindungan: tidak bisa menghapus/menurunkan owner aktif terakhir atau akun yang sedang dipakai sendiri.
- Karyawan yang dinonaktifkan/dihapus di data karyawan: akunnya otomatis tidak bisa masuk. Akun dinonaktifkan/dihapus/diganti sandinya: sesi di HP-nya langsung tidak berlaku.

## Tanpa PIN di dalam aplikasi
- **Aplikasi Owner:** akun owner langsung masuk ke dasbor (PIN dalam aplikasi diisi otomatis oleh sistem). Butuh halaman resepsionis sudah pernah memuat data di komputer hotel; kalau belum, tampil pesan menunggu.
- **Resepsionis > Pengaturan Owner:** akun owner langsung terbuka tanpa PIN. Akun resepsionis tetap diminta PIN owner/manajer untuk membuka pengaturan owner (supaya resepsionis tidak bisa mengubah pengaturan owner).
- **Komputer hotel (localhost:8088) tidak memakai akun:** tetap masuk tanpa login seperti sebelumnya dan tetap memakai PIN owner untuk dasbor Owner dan Pengaturan Owner (komputer ini dipakai bersama oleh resepsionis).

## Pengaman
- Salah kata sandi 8x dalam 10 menit (per IP atau per username) -> dikunci 10 menit. Total salah 100x/jam -> login baru dikunci sementara (yang sudah login tetap jalan).
- Karyawan/HK hanya bisa membaca data yang diperlukan (tanpa PIN/token orang lain), tidak bisa menulis data, tidak bisa mengelola akun.
- Pendaftaran mandiri dibatasi 3x/menit per IP dan maksimal 30 akun menunggu.
- Kata sandi dikirim lewat HTTPS (alamat Funnel). Lewat http WiFi hotel kata sandi tidak terenkripsi; pakai alamat https untuk login staf.
- Bila server diganti komputer: salin folder `data` (termasuk `users.json`) agar akun ikut.


# SATU APLIKASI: staf dibuat owner, pendaftaran aplikasi hanya untuk tamu (fix16)
## Satu aplikasi, satu alamat
- Semua orang membuka alamat yang sama: `https://NAMA-PC.xxxx.ts.net/` (satu ikon aplikasi di HP).
- Tombol **Masuk** (👤 Akun) mengenali siapa yang masuk: akun **staf/karyawan** (dibuat owner) langsung dibawa ke halaman sesuai perannya; akun **tamu** tetap di aplikasi tamu.
- Alamat lama `/login` hanya mengarahkan ke aplikasi ini (dialog Masuk terbuka otomatis). Halaman login staf terpisah sudah dihapus.

## Siapa boleh mendaftar
- **Staf, karyawan, resepsionis, owner: hanya dibuat OWNER** di aplikasi Owner > tab **🔑 Akun Staf**. Pendaftaran sendiri oleh staf dihapus (alamat `/register` ditutup).
- **Tab Daftar di aplikasi hanya untuk tamu/orang lain.** Akun tamu tidak punya akses halaman staf. Username tamu tidak boleh sama dengan username staf.
- Tombol akun melayang di halaman staf dihapus; staf memakai menu ☰ (Ganti kata sandi, Keluar).

## Perbaikan bug
1. **Login/daftar di aplikasi tamu selalu gagal ("Pusat data belum terbuka / tidak tersambung")**: balasan pusat data dikirim tanpa jenis pesan `acct_r`, sehingga selalu dibuang server dan tidak pernah sampai ke HP tamu, walau halaman resepsionis terbuka. Dan selain itu akun tamu hanya diproses oleh satu tab resepsionis.
   **Kini akun & obrolan diproses langsung oleh server**: halaman resepsionis TIDAK perlu terbuka untuk daftar/masuk/ulasan.
2. Kata sandi akun tamu dan token sesinya dulu ikut tersinkron ke semua browser staf. Kini disimpan hanya di server (`data\guest_secrets.json`, PBKDF2 + garam). Akun lama otomatis dipindahkan saat server pertama dijalankan (tidak perlu daftar ulang).
3. Browser tidak lagi boleh menulis data akun/obrolan langsung (`hs_accts`, `hs_comm`, `hs_acfg`); semua lewat server, dan moderasi diperiksa oleh server berdasarkan sesi login (bukan tanda yang dikirim halaman).
4. Pesan galat login sama untuk username tak dikenal dan kata sandi salah (tidak membocorkan username staf).

## Yang perlu dilakukan sekali setelah update
- Ganti seluruh isi folder dengan paket ini (folder `data` JANGAN dihapus), jalankan ulang `mulai.bat`.
- Di HP: buka aplikasi, tekan tombol **Perbarui** bila muncul (atau tutup lalu buka lagi). Aplikasi "OB Staf" lama boleh dihapus; pakai satu ikon One Bliss.
- Staf yang tadinya mendaftar sendiri dan masih "Menunggu" tetap bisa disetujui/dihapus owner di tab Akun Staf.
- Catatan: bunyi notifikasi "akun tamu baru menunggu persetujuan" di halaman resepsionis tidak ada lagi; lencana jumlah menunggu di kartu Akun Aplikasi tetap tampil.

# Dasbor kamar Housekeeping + perbaikan menu Akun Aplikasi (fix17)
- **Bug resepsionis:** menu "Akun Aplikasi" memperlihatkan dasbor Kamar karena menu itu belum terdaftar di pengalih halaman. Kini menampilkan daftar akun yang sudah mendaftar (dengan lencana jumlah yang menunggu).
- **Halaman Karyawan (HK), tab Kamar = Dasbor Kamar:** daftar semua kamar dengan status (Kosong / Kotor / Dibersihkan / Bersih / Terisi tamu). Tekan kamar kosong, masukkan **PIN HK** (PIN pribadi dari Owner > Kelola karyawan), pintu terbuka dan lampu menyala. Selesai: tekan kamar lagi > **Selesai** (centang daftar periksa), akses sementara dicabut.
- Aturan keamanan (diperiksa server): kamar terisi tamu ditolak; kamar yang sedang dibersihkan HK lain ditolak; salah PIN 5 kali = dikunci 10 menit; HK tanpa PIN diminta menghubungi owner; kejadian masuk Log Sistem resepsionis.
- **Scan QR sekarang hanya untuk absen:** tombol Absen masuk / pulang membuka kamera dan hanya menerima QR ID karyawan milik sendiri. Scan QR kamar dihapus.
- Firmware **pass (v5.8x)**: server membuat akses sementara "HK nama" (default 90 menit, `esp.hk_minutes`) lalu memanggil `/pass_door` (relay/lampu ON); saat Selesai akses dicabut (relay OFF).
- Firmware **KEYLESS**: pintu dibuka lewat relay kunci. Perintah LAMPU untuk firmware ini belum diketahui; isi `esp.hk_lamp_cmd` (dan `esp.hk_lamp_off_cmd`) di `data\config.json` dengan nama perintah /action yang menyalakan lampu.
- Catatan: login/absen halaman HK dan pencatatan status kamar masih melalui halaman resepsionis, jadi halaman itu tetap dibuka. Pembukaan pintu + lampu dan pemeriksaan PIN dilakukan server sendiri.

# Rating & Ulasan, tamu hanya membalas, pembersihan menu kembar (fix18)
- **Menu baru "⭐ Rating & Ulasan"** di Resepsionis (sidebar) dan di tab Owner "Rating & Ulasan" (bagian bawah). Isinya: rata-rata + sebaran bintang, rating menginap per kamar, dan semua ulasan/obrolan dari aplikasi tamu beserta balasannya.
- Owner/resepsionis bisa **Balas sebagai ONE BLISS** (lencana "Hotel"), **Sembunyikan/Tampilkan**, dan **Hapus** (ulasan maupun balasan).
- **Aplikasi tamu: hanya bisa membalas.** Tombol Hapus untuk tamu dihapus, dan server menolak perintah hapus dari tamu.
- Menu **Akun Aplikasi** kini hanya berisi akun (daftar komentar dipindah ke Rating & Ulasan).
## Menu kembar yang dihapus
- Resepsionis: tombol **⚙ Pengaturan Owner** (harga, voucher, hotel & aturan, PIN) dihapus; semuanya sudah ada di halaman Owner (Harga & Voucher, Pengaturan, Keamanan). Harga musiman/libur sekarang bisa ditambah/dihapus dari Owner > Harga & Voucher.
- Resepsionis: tombol **QR tugas kamar** di Housekeeping dihapus (HK memakai dasbor kamar + PIN).
- Owner > Pusat Fitur: kartu **Ringkasan hari ini** (kembar tab Ringkasan) dan **Kinerja Housekeeping** (kembar tab Karyawan) dihapus. **Unduh data** dipindah ke tab Data (satu tempat untuk ekspor).


# HUB RESEPSIONIS TERSEMBUNYI - halaman resepsionis TIDAK perlu dibuka lagi (fix19)
Dulu semua pendaftaran, login tamu, perintah owner/karyawan, panggilan, dst. diproses oleh halaman resepsionis (hub). Kini server otomatis menjalankan halaman resepsionis yang sama di Edge/Chrome **tanpa jendela** saat tidak ada halaman resepsionis yang terbuka. Semua fitur lain tetap normal walau resepsionis ditutup.
- **Otomatis:** `mulai.bat` -> server cek tiap detik. Tidak ada halaman resepsionis terbuka (di komputer atau di HP staf) -> hub tersembunyi jalan. Resepsionis membuka halamannya -> hub tersembunyi berhenti sendiri (hanya satu hub aktif, tidak ada proses ganda). Ditutup lagi -> hub tersembunyi jalan kembali dalam sekitar 6-20 detik.
- **Syarat:** Microsoft Edge atau Google Chrome terpasang di komputer server (Edge sudah ada di Windows 10/11). Server mencarinya sendiri. Kalau tidak ketemu, jendela server menampilkan peringatan; isi alamatnya di `data\config.json`:
  `"hub": {"enabled": true, "browser": "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "grace": 15, "args": []}`
- `enabled: false` = saklar cadangan untuk mematikan hub tersembunyi (hanya bila bermasalah, mis. komputer tanpa Edge/Chrome; resepsionis lalu harus dibuka seperti dulu). Bawaan sudah `true`, tidak perlu diubah. `grace` = detik tanpa halaman resepsionis sebelum hub tersembunyi mengambil alih (minimal 8).
- Hub tersembunyi memakai profil sementara `data\hub_profile` (dihapus tiap dijalankan; semua data tetap dari server). Kalau server mati mendadak, sisa hub tersembunyi dimatikan otomatis saat server dijalankan lagi (`data\hub.pid`).
- Jendela server menampilkan baris `[HUB] ...` saat hub tersembunyi mulai/berhenti. Tidak ada yang tampil di layar komputer.
- Batas: selama beberapa detik saat pergantian (halaman resepsionis ditutup, hub tersembunyi belum menyala), pesan yang masuk bisa terlewat; tamu cukup mencoba lagi. Bunyi/notifikasi di layar resepsionis tetap hanya muncul bila halamannya dibuka.
- Catatan lama di atas yang berbunyi "halaman resepsionis harus tetap terbuka" tidak berlaku lagi bila hub tersembunyi aktif.


# NOTIFIKASI PUSH: muncul & berbunyi walau layar terkunci / aplikasi ditutup (fix20)
Sebelumnya notifikasi hanya muncul bila halamannya masih hidup di latar belakang. Kini server mengirim **Web Push** lewat layanan push HP (Google/Apple/Mozilla), sehingga HP berbunyi dan menampilkan pop-up di layar kunci walau aplikasi ditutup. Tanpa pustaka tambahan (hanya Python bawaan); kunci VAPID dibuat otomatis di `data\vapid.json`, langganan perangkat di `data\push.json` (ikut dicadangkan).
## Satu kali per HP
1. Buka aplikasi lewat alamat **https** (alamat Funnel), lalu ketuk layar sekali; izinkan notifikasi saat diminta.
2. **iPhone:** wajib iOS 16.4+ dan aplikasi dipasang ke Layar Utama (Bagikan > Tambah ke Layar Utama), lalu buka dari ikon itu dan izinkan notifikasi.
3. **Android:** Pengaturan > Aplikasi > Chrome/ONE BLISS > Baterai: pilih "Tidak dibatasi", dan pastikan notifikasi tidak disenyapkan. Mode Jangan Ganggu/Fokus tetap menahan notifikasi.
## Siapa mendapat apa
- **Resepsionis & Owner:** setiap pemberitahuan yang tampil di dasbor resepsionis (pendaftaran/reservasi baru, permintaan tamu, SOS, dst.).
- **Semua orang (tamu, resepsionis, owner, karyawan/HK):** panggilan suara masuk (pop-up tetap tampil sampai disentuh, getar panjang).
- **Tamu:** wake-up call, reservasi disetujui, check-out, dan balasan resepsionis di chat calon tamu.
- Kalau aplikasi sedang terbuka dan terlihat, push tidak ditampilkan (bunyi/pop-up di halaman yang bekerja).
## Batas yang jujur
- Bunyi di layar kunci adalah **nada notifikasi bawaan HP**, bukan nada dering/suara ucapan buatan aplikasi (browser tidak mengizinkannya).
- Server butuh internet untuk menghubungi layanan push. Halaman WiFi hotel (http) tidak bisa push.
- Belum dicakup: notifikasi tugas HK dan pesan chat dalam kamar ke tamu (belum ada pemetaan jenis pesannya).

# DASBOR HOUSEKEEPING (HK) - alur kamar
- Tampilan HK sama dengan owner: kartu kamar berwarna + filter (Semua / Terisi / Kosong-Siap / Kotor / Dibersihkan / Menunggu cek / Maintenance) + pencarian.
- Tekan kamar -> pop-up: pilih **kode status** (VD kosong kotor, VC kosong bersih, OD terisi kotor, OC terisi bersih, OO rusak) dan isi **catatan kamar**, lalu "Simpan".
- **Input PIN HK = HK mulai mengerjakan** (pintu terbuka, lampu menyala, nama + jam mulai tercatat). Kamar terisi tamu tidak bisa dimasuki.
- Selesai: centang 4 cek, pilih kode (bawaan VC), isi catatan, tekan **Konfirmasi selesai** -> akses sementara dicabut.
- Setelah selesai: kamar berstatus **Menunggu cek** (ungu) dan belum bisa dijual. Resepsionis atau owner menekan "Lolos cek -> Siap" (atau "Kembalikan ke HK").
- Owner > Pengaturan > "Cek supervisor sebelum kamar siap": 1 = wajib cek (bawaan), 0 = langsung siap begitu HK konfirmasi selesai.
- Kode OO dari HK hanya laporan (tampil sebagai lencana + masuk log). Untuk benar-benar memblokir penjualan, owner tetap memakai status Maintenance di Edit kamar.
- Perubahan status kamar masih diproses halaman resepsionis (atau hub tersembunyi server), jadi halaman itu tetap harus berjalan.

# PANGGILAN ANTAR AKUN STAF
- Setiap akun yang sedang masuk (owner, resepsionis, HK) sekarang punya "nomor" sendiri sesuai username dan tampil di daftar kontak interkom (ikon 📞) pada grup **Akun staf**, lengkap dengan nama, peran, dan titik hijau bila sedang online.
- Ketuk Panggil pada nama itu: akun tujuan berdering di perangkat mana pun yang sedang membuka aplikasi dengan akun tersebut. Satu akun yang dibuka di dua perangkat akan berdering di keduanya; siapa yang mengangkat lebih dulu yang tersambung.
- Kontak lama tetap ada: tamu (kamar) masih memanggil Resepsionis/HK seperti biasa, dan tombol "Resepsionis" / "Owner" tetap menjangkau layar yang sedang terbuka. Karyawan yang sudah punya akun hanya tampil sekali (sebagai akun).
- Owner > Panggilan > "Antar akun staf" menyalakan/mematikan fitur ini. Tombol utama "Aktifkan fitur panggilan suara" tetap berlaku untuk semuanya.
- Akun hanya bisa saling memanggil sesama akun staf. Tamu tidak bisa memanggil akun staf secara langsung.
- Tetap butuh alamat HTTPS (alamat staf port 8443) dan izin mikrofon.

# PANGGILAN TAMU KE TAMU (antar kamar)
- Tamu yang kamarnya sedang terisi bisa menelepon kamar terisi lain dari tombol 📞 di halaman tamu (grup "Kamar tamu"). Suara langsung antar HP, resepsionis hanya jadi perantara sinyal.
- Privasi: nama tamu TIDAK ditampilkan, hanya "Kamar 102". Resepsionis tetap melihat nama di log.
- Kamar yang sedang **Jangan Ganggu** (manual atau terjadwal) tidak berdering; penelepon diberi tahu.
- Batas dering: maksimal 4 kali per menit dari satu kamar, supaya tidak dipakai mengganggu.
- Aktif secara bawaan untuk pengaturan baru. Jika owner pernah menyimpan pengaturan Panggilan sebelumnya, centang sekali: Owner > Panggilan > **Tamu ↔ Tamu** (sama dengan sel Tamu → Tamu di tabel "Siapa boleh memanggil siapa"). Pembatasan kamar tertentu: pilih "Hanya yang dipilih" pada Kamar tamu.
- Syarat: kedua tamu membuka halaman lewat alamat HTTPS (Funnel) dan mengizinkan mikrofon; halaman resepsionis (atau hub tersembunyi server) harus berjalan.

# CHAT & PANGGILAN KE AKUN APLIKASI (Owner / Resepsionis)
- Menu **Akun Aplikasi** (resepsionis dan owner): setiap akun yang disetujui punya tombol **💬 Chat** dan **📞 Panggil**.
- Chat tersimpan di server (`hs_dm`), tampil di kedua sisi. Pesan baru dari akun memunculkan penanda "(n baru)" dan pemberitahuan di halaman owner/resepsionis. Di aplikasi tamu: menu Akun > **Pesan dari Hotel**.
- Panggilan suara: resepsionis/owner menelepon akun; akun menjawab di aplikasinya. Butuh https (alamat Funnel) dan mikrofon.
- Penanda "● aplikasi terbuka" berarti aplikasi akun itu sedang terbuka (bisa langsung dering). Kalau tertutup, panggilan tidak sampai, jadi kirim chat dulu.
- Pengaturan: `hs_cfg.ic.app = 0` mematikan panggilan ke akun aplikasi (bawaan aktif).

## fix26: akun tamu "username/sandi salah" setelah update
**Penyebab:** akun tamu disimpan di DUA file: `data\\hs_kv.json` (username, nama, HP) dan `data\\guest_secrets.json` (kata sandi + token masuk). Bila keduanya tidak cocok (folder `data` diganti/dipulihkan sebagian, `guest_secrets.json` hilang, rusak, atau gagal tersimpan), akun masih ada tapi kata sandinya tidak ada: masuk selalu "salah", daftar ulang "username sudah dipakai", dan owner tidak punya tombol untuk memperbaikinya.

**Perbaikan:**
- Tamu yang akunnya "yatim": di aplikasi tekan **Daftar**, isi username dan No. HP yang SAMA, akun dan riwayat chat dipulihkan dengan sandi baru. Pesan masuk kini menjelaskan hal ini.
- Owner/resepsionis: di Akun Aplikasi ada tombol **🔑 Setel ulang sandi** (24 jam, login berikutnya menentukan sandi baru) dan **🗑 Hapus akun** (username & HP bebas lagi).
- `guest_secrets.json` kini punya cadangan `guest_secrets.json.bak`, file rusak tidak lagi diam-diam dianggap kosong, penyimpanan diulang bila Windows mengunci file sesaat.
- Server menyalin file data penting ke `data\\cadangan\\<tanggal-jam>` (10 terakhir) setiap dijalankan, dan menampilkan peringatan di jendela server bila ada akun tamu tanpa kata sandi.

**Cara update yang aman:** tutup server, TIMPA hanya isi `web\\`, `server.py`, `esp_bridge.py`, `mulai.bat`. Jangan hapus/ganti folder `data`, dan jangan ekstrak paket ke folder baru (data baru akan kosong).

## fix27: chat & panggilan ke akun tamu walau aplikasi ditutup + sandi oleh owner
- **Notifikasi seperti WhatsApp:** begitu tamu masuk akun dan mengizinkan notifikasi, HP-nya terdaftar ke akun itu. Chat dari owner/resepsionis dan panggilan suara dari owner/resepsionis dikirim sebagai notifikasi (bunyi + getar panjang untuk panggilan) walau aplikasi ditutup/layar terkunci. Chat dari tamu ke owner/resepsionis juga membunyikan HP staf.
- **Panggilan:** notifikasi panggilan ditekan -> aplikasi terbuka -> dering tampil -> Jawab. Penelepon menunggu 45 detik. Dering diulang otomatis ke aplikasi yang baru dibuka.
- **Status di Akun Aplikasi (owner):** "Panggil" tanpa tulisan = aplikasi tamu sedang terbuka; "(notifikasi)" = aplikasi ditutup tapi masih bisa dihubungi lewat notifikasi; "(offline)" = belum pernah mengaktifkan notifikasi.
- **Batas teknis (aplikasi web/PWA, bukan aplikasi native):** panggilan tidak bisa berdering layar penuh seperti WhatsApp, hanya notifikasi. iPhone: aplikasi harus dipasang ke Layar Utama (iOS 16.4+). Android: izinkan notifikasi dan jangan batasi baterai untuk Chrome/aplikasi ini. Status "(notifikasi)" tidak bisa memastikan HP benar-benar menyala/online.
- **Sandi tamu:** server hanya menyimpan sandi yang diacak, jadi sandi asli tamu TIDAK bisa ditampilkan. Gantinya: tombol **🔑 Setel sandi** di Akun Aplikasi, owner menentukan sandi baru (tampil jelas saat itu juga), tamu keluar dari semua perangkat dan masuk dengan sandi itu.

## fix28: galat "gagal simpan push [WinError 32]" di jendela server
- Penyebab: Windows mengunci file sesaat (antivirus/Defender/OneDrive, terutama di folder Downloads) atau dua proses menyimpan file yang sama bersamaan. Kini semua file data (akun tamu, akun staf, sesi, data sinkron, push, ESP) disimpan lewat satu jalur yang diulang otomatis.
- **Letakkan folder server di tempat tetap di luar Downloads/Desktop/OneDrive, mis. `C:\onebliss_online`.**
- **Saat memasang versi baru JANGAN mengekstrak ke folder baru lalu menjalankannya.** Folder `data` baru kosong: semua akun tamu hilang dan sandi owner kembali ke "SANDI OWNER AWAL". Salin dulu folder `data` LAMA ke folder baru (tutup server dulu), atau timpa file ke folder lama.

## fix29: folder DATA dipisah dari folder program (aman saat mengganti seluruh file)
- Semua data (akun tamu, akun staf, pengaturan, chat, cadangan) kini disimpan di **`C:\\onebliss_data`** (di luar folder program, lokasinya tetap). Folder program boleh dihapus/diganti/diekstrak ulang kapan saja tanpa menyentuh data. Lokasi tampil di jendela server ("FOLDER DATA").
- Mau lokasi lain? Setel variabel lingkungan `ONEBLISS_DATA` ke folder pilihan Anda.
- Pemasangan lama (folder `data` masih di dalam folder program): pada start pertama, isinya disalin otomatis ke `C:\\onebliss_data` bila folder itu masih kosong.
- Perbaikan tambahan: perubahan akun tamu langsung ditulis ke disk (dulu bisa tertinggal ±2 detik; jika jendela server ditutup saat itu, akun tercatat tapi kata sandinya hilang). Penyimpanan data juga dilakukan saat server dimatikan normal (Ctrl+C).

### Cara kerja & update (urut)
1. Struktur: `C:\\ONEBLISS\\server\\` = isi paket (server.py, esp_bridge.py, mulai.bat, web\). Data otomatis di `C:\\onebliss_data`.
2. Update: tutup jendela server -> kosongkan `C:\\ONEBLISS\\server\\` (pindahkan file lama keluar) -> salin isi paket baru -> jalankan `mulai.bat`. Folder `C:\\onebliss_data` JANGAN disentuh.
3. Cadangan manual: salin `C:\\onebliss_data` ke flashdisk/Drive secara berkala (server juga menyimpan 10 salinan otomatis di `C:\\onebliss_data\\cadangan`).


# STATUS KAMAR TERPADU (16 kode)
Resepsionis, Owner, dan Housekeeping memakai satu modul (`web/hs/rs.js`), jadi kode dan keterangan kamar selalu sama.

| Kelompok | Kode |
|---|---|
| Kebersihan (otomatis dari HK) | **VCI** kosong bersih sudah dicek (siap jual), **VC** kosong bersih menunggu cek, **VD** kosong kotor, **CIP** sedang dibersihkan, **OC** terisi bersih, **OD** terisi kotor |
| Tamu / Front Office | **DND** jangan diganggu, **MUR** minta dibersihkan (keduanya dari aplikasi tamu), **DO** check-out hari ini, **OVS** lewat jam/tanggal check-out, **EA** tamu reservasi datang hari ini, **SO** Sleep Out, **SKP** Skipper |
| Tidak dijual | **OOS** Out of Service (sementara), **OOO** Out of Order (rusak), **BLK** Blocked (ditahan: VIP/grup/pemilik) |

- Satu kamar menampilkan kode utama (paling mendesak) dan kode tambahan kecil. Contoh: kamar terisi kotor dengan check-out hari ini tampil **DO** + OD.
- **OOS / OOO / BLK tidak bisa dijual**: hilang dari katalog tamu, pendaftaran & reservasi ditolak, check-in manual/otomatis diblokir. Kamar terisi yang ditandai tetap tampil sebagai kamar terisi, lalu tidak dijual setelah check-out.
- HK memilih kode VC, VD, OC, OD, SO, SKP, OOS, atau OOO + catatan di dasbor HK. Blokir hanya bisa dibuka oleh Resepsionis/Owner dari popup kamar ("Selesai - buka blokir").
- SO dan SKP dapat ditandai/dihapus oleh Resepsionis atau Owner dari popup kamar; keduanya otomatis hilang saat check-in/check-out.
- Klik kode kamar untuk popup per kamar. Baris kode di atas daftar kamar adalah rekap dan filter; tombol "ℹ 16 status" menampilkan arti tiap kode.

# PENJAGA KETIKAN
`web/hs/draft.js` (dimuat di semua halaman): teks yang sedang ditulis disimpan otomatis dan dikembalikan beserta fokus & posisi kursor bila halaman menggambar ulang (refresh real-time) atau dimuat ulang. Kolom sandi/PIN tidak disimpan, dan draf dibuang bila aplikasi sendiri yang mengosongkan kolom (mis. setelah kirim/simpan).

## Tombol Instal Aplikasi
Bila browser memberi sinyal "siap dipasang", tombol Instal langsung membuka kotak pemasangan. Bila sinyal belum datang (Chrome/Edge kadang baru memberi sinyal setelah halaman dimuat ulang), tombol menunggu ±4 detik lalu memuat ulang halaman otomatis satu kali (maks. 1x per 10 menit); setelah itu tombol menyala dan tekan sekali lagi untuk memasang. Petunjuk manual hanya muncul bila tetap tidak ada sinyal (mis. alamat bukan https, iPhone/Safari, atau aplikasi sudah terpasang di perangkat itu).

## Tombol panggilan & chat di aplikasi tamu
Tombol 📞 interkom kini ditumpuk di atas tombol Chat sehingga tidak saling menimpa.

## Penjaga ketikan (diperkuat)
Draf tersimpan di localStorage (bertahan walau tab/aplikasi dimatikan sistem) selama 30 menit dan dipulihkan setelah halaman menggambar ulang atau dimuat ulang. Setelah menekan tombol kirim/simpan atau Enter, draf dibuang agar pesan yang sudah terkirim tidak muncul lagi.
