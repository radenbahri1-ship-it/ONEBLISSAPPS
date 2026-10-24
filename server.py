#!/usr/bin/env python3
"""ONE BLISS - server hotel (tamu online lewat Tailscale Funnel).
Dua pendengar:
  STAF  0.0.0.0:8088      -> semua halaman (resepsionis/owner/karyawan/tamu) + sinkron data. Hanya LAN / localhost.
  TAMU  127.0.0.1:8089    -> HANYA halaman tamu + pesan tamu yang diizinkan. Arahkan Tailscale Funnel ke port ini.
Hanya library bawaan Python (tanpa pip)."""
import atexit, base64, hashlib, json, os, queue, re, secrets, shutil, subprocess, sys, threading, time, urllib.error, urllib.parse, urllib.request
import esp_bridge
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_aw_lock = threading.Lock()
def _aw(path, text, enc="utf-8"):
    """Tulis file lewat berkas sementara UNIK + kunci + ulang bila Windows mengunci sesaat (antivirus/OneDrive/Defender, atau dua utas menyimpan bersamaan -> WinError 32)."""
    with _aw_lock:
        tmp = "%s.%d.tmp" % (path, threading.get_ident())
        open(tmp, "w", encoding=enc).write(text)
        last = None
        for i in range(12):
            try: os.replace(tmp, path); return
            except OSError as e: last = e; time.sleep(0.15)
        try: open(path, "w", encoding=enc).write(text); os.remove(tmp)   # terakhir: tulis langsung
        except Exception: raise last

BASE = os.path.dirname(os.path.abspath(__file__)); WEB = os.path.join(BASE, "web")
try: os.chdir(BASE)   # sama persis dengan mulai.bat (cd ke folder program): hasil tidak tergantung dari folder mana server.py dijalankan
except OSError: pass
def _data_dir():
    """Folder DATA (akun tamu, akun staf, pengaturan, cadangan) ada di LUAR folder program, di lokasi tetap: Windows C:\\onebliss_data
    (ubah lewat variabel lingkungan ONEBLISS_DATA). Jadi mengganti/menghapus/mengekstrak ulang folder program TIDAK menyentuh data."""
    d = os.environ.get("ONEBLISS_DATA", "").strip()
    if d: return os.path.abspath(d)
    if os.name == "nt": return os.path.join(os.environ.get("SystemDrive", "C:") + os.sep, "onebliss_data")
    return os.path.join(os.path.expanduser("~"), "onebliss_data")
DATA = _data_dir(); FILES = os.path.join(DATA, "files")
os.makedirs(FILES, exist_ok=True)
try:   # pemasangan lama: folder data masih di dalam folder program -> salin sekali ke lokasi baru bila lokasi baru masih kosong
    _old = os.path.join(BASE, "data")
    if os.path.isdir(_old) and os.path.abspath(_old) != os.path.abspath(DATA) and not any(os.path.isfile(os.path.join(DATA, n)) for n in ("hs_kv.json", "users.json", "guest_secrets.json", "config.json")):
        shutil.copytree(_old, DATA, dirs_exist_ok=True, ignore=shutil.ignore_patterns("hub_profile", "cadangan")); print(" [DATA] data lama disalin dari %s ke %s" % (_old, DATA))
except Exception as e: print(" [DATA] gagal menyalin data lama:", e)
def _cadangan_data(keep=10):
    """Salinan file data penting tiap server dijalankan (data\\cadangan\\<tanggal-jam>), simpan 10 terakhir. Penyelamat bila update/penggantian folder membuat data tidak cocok."""
    try:
        names = [n for n in ("config.json", "hs_kv.json", "users.json", "guest_secrets.json", "guest_secrets.json.bak") if os.path.isfile(os.path.join(DATA, n))]
        if not names: return
        root = os.path.join(DATA, "cadangan"); dst = os.path.join(root, time.strftime("%Y%m%d-%H%M%S")); os.makedirs(dst, exist_ok=True)
        for n in names: shutil.copy2(os.path.join(DATA, n), os.path.join(dst, n))
        for d in sorted(os.listdir(root))[:-keep]: shutil.rmtree(os.path.join(root, d), ignore_errors=True)
    except Exception as e: print("gagal cadangan data:", e)
_cadangan_data()
CFG_FILE, KV_FILE = os.path.join(DATA, "config.json"), os.path.join(DATA, "hs_kv.json")
cfg = {"staff_port": 8088, "guest_port": 8089, "public_url": "", "hs_key": "", "lan_guest_port": 8087, "ice_servers": [], "esp": {}}
try: cfg.update(json.load(open(CFG_FILE, encoding="utf-8")))
except Exception: pass
if "--public" in sys.argv: cfg["public_url"] = sys.argv[sys.argv.index("--public") + 1].rstrip("/")
if not cfg["hs_key"]: cfg["hs_key"] = secrets.token_hex(3)
cfg.pop("staff_pins", None)   # PIN staf tidak dipakai lagi: login memakai akun (username + kata sandi), lihat data\\users.json
cfg["esp"] = dict(esp_bridge.DEFAULTS, **(cfg.get("esp") or {}))   # tampilkan semua opsi ESP di config.json
cfg["hub"] = dict({"enabled": True, "browser": "", "grace": 15, "args": []}, **(cfg.get("hub") or {}))   # hub resepsionis tersembunyi (lihat bagian HUB)
json.dump(cfg, open(CFG_FILE, "w", encoding="utf-8"), indent=2)

def lan_ip():
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try: s.connect(("10.255.255.255", 1)); return s.getsockname()[0]
    except Exception: return "127.0.0.1"
    finally: s.close()
if int(cfg.get("lan_guest_port") or 0) and not cfg.get("lan_url_fixed"): cfg["lan_url"] = "http://%s:%d" % (lan_ip(), int(cfg["lan_guest_port"]))

MIME = {".webmanifest": "application/manifest+json", ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon"}
CHANNEL = "hotel-sim"
GUEST_SEND = {"hello", "login", "register", "reg_cancel", "reg_status", "resend_req", "stay_check", "cmd", "visit", "acct"}
GUEST_PUBLIC = {"info", "info2", "info3", "cfg", "pong", "popup", "avail", "comm"}       # siaran tanpa alamat (data publik hotel)
GUEST_ADDR = {"ack", "call_live", "call_end", "cmres", "cmv", "denied", "ext", "ext2", "ext3", "ext4", "revoked", "state", "wakeup", "checkout", "rtc", "door_res", "ic2"}
GUEST_VISIT = {"visit_r", "acct_r"}      # balasan resepsionis ke calon tamu (chat/panggilan sebelum reservasi), dialamatkan lewat vid
VID_RE = re.compile(r"[A-Za-z0-9]{8,24}")
GUEST_RID = {"reg_approved", "reg_rejected", "resend_fail", "stay_ok", "stay_gone"}
SEND_LIMIT = {"register": 600000, "cmd": 200000, "visit": 40000}; SEND_DEFAULT = 20000
FILE_MAX, FILES_TOTAL_MAX = 3_000_000, 500_000_000
FID_G = re.compile(r"F[a-z0-9]{5,14}"); FID_S = re.compile(r"[\w-]{1,40}")

lock = threading.RLock(); cv = threading.Condition()
kv, ver, dirty = {}, [0], [False]
msgs, mid = [], [0]
clients = {}   # cid -> status akses tamu (hanya untuk menyaring pesan)
try:
    j = json.load(open(KV_FILE, encoding="utf-8")); kv = j.get("kv", {}); ver[0] = j.get("ver", 0)
except Exception: pass

def publish(d):
    with cv:
        mid[0] += 1; msgs.append({"id": mid[0], "n": CHANNEL, "c": "server", "d": d}); del msgs[:-1000]; cv.notify_all()
br = esp_bridge.Bridge(cfg, kv, lock, publish, DATA)

def kv_flush():
    """Tulis hs_kv.json SEKARANG bila ada perubahan (dipanggil juga saat akun tamu berubah & saat server dimatikan)."""
    if not dirty[0]: return
    with lock:
        dirty[0] = False; snap = json.dumps({"ver": ver[0], "kv": kv})
    try: _aw(KV_FILE, snap)
    except Exception as e: dirty[0] = True; print("gagal simpan:", e)
def saver():
    while True:
        time.sleep(0.7)
        kv_flush()
atexit.register(kv_flush)
try:
    import signal
    def _bye(*a): kv_flush(); os._exit(0)
    for _n in ("SIGTERM", "SIGINT", "SIGBREAK"):
        if hasattr(signal, _n): signal.signal(getattr(signal, _n), _bye)
except Exception: pass

buckets = {}
def allow(ip, kind, per_min):
    now = time.time(); k = (ip, kind)
    with lock:
        w = [t for t in buckets.get(k, []) if now - t < 60]
        if len(w) >= per_min: buckets[k] = w; return False
        w.append(now); buckets[k] = w
        if len(buckets) > 5000: buckets.clear()
    return True
polls = {}
def poll_slot(ip, delta, lim=40):
    with lock:
        n = polls.get(ip, 0) + delta
        if delta > 0 and n > lim: return False
        polls[ip] = max(0, n); return True

SESS_FILE = os.path.join(DATA, "sessions.json"); SESS_DAYS = 30
USERS_FILE = os.path.join(DATA, "users.json")
ROLES = ("owner", "resepsionis", "hk")
LAND = {"owner": "/owner-lama3.html", "resepsionis": "/resepsionis-lama3.html", "hk": "/karyawan-lama3.html"}
ROLE_PAGES = {"owner": {"/owner-lama3.html", "/resepsionis-lama3.html", "/karyawan-lama3.html"}, "resepsionis": {"/resepsionis-lama3.html", "/karyawan-lama3.html"}, "hk": {"/karyawan-lama3.html"}}
STAFF_PAGES = set().union(*ROLE_PAGES.values())
STAFF_STATIC = STAFF_PAGES | {"/hs/net.js", "/hs/ic.js", "/hs/rs.js", "/hs/draft.js", "/hs/akun.js", "/hs/staf.js", "/sw.js", "/manifest-staf.webmanifest", "/manifest-owner.webmanifest", "/manifest-resepsionis.webmanifest", "/manifest-karyawan.webmanifest", "/manifest-tamu.webmanifest"}
UNAME = re.compile(r"[a-z0-9._-]{3,24}")
sessions = {}; fails = {}; ufails = {}; gfails = []; rfails = {}
try: sessions = json.load(open(SESS_FILE, encoding="utf-8"))
except Exception: pass
users = {}
try: users = json.load(open(USERS_FILE, encoding="utf-8"))
except Exception: pass
if not isinstance(users, dict): users = {}
def _hash(t): return hashlib.sha256(t.encode()).hexdigest()

# ---------- akun staf (data\users.json; kata sandi disimpan PBKDF2 + garam, tidak pernah dikirim ke halaman) ----------
def users_save():
    try: _aw(USERS_FILE, json.dumps(users, indent=1))
    except Exception as e: print("gagal simpan akun:", e)
def pw_hash(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt, hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 150000).hex()
def pw_set(u, pw): u["salt"], u["h"] = pw_hash(pw); u["pv"] = int(u.get("pv") or 0) + 1   # pv naik = semua sesi lama akun ini batal
def pw_ok(u, pw):
    try: return secrets.compare_digest(pw_hash(pw, u["salt"])[1], u["h"])
    except Exception: return False
def new_pass():   # 12 karakter acak, dikelompokkan 4-4-4 agar mudah diketik (contoh: k7m2-p9xq-4tnb)
    r = "".join(secrets.choice("abcdefghjkmnpqrstuvwxyz23456789") for _ in range(12)); return r[:4] + "-" + r[4:8] + "-" + r[8:]
def owners_active(skip=None): return [x for k, x in users.items() if k != skip and x.get("role") == "owner" and x.get("st") == "ok"]
def pub(u): return {k: u.get(k, "") for k in ("u", "name", "role", "emp", "phone", "st", "c", "last")}
BOOT = ""
OWNER_PW_FILE = os.path.join(DATA, "SANDI_OWNER_AWAL.txt")
def _owner_pw_saved():
    try: return open(OWNER_PW_FILE, encoding="utf-8").read().strip()
    except Exception: return ""
def _owner_pw_forget():
    try: os.remove(OWNER_PW_FILE)
    except OSError: pass
# Sandi owner awal: dibuat acak SEKALI, disimpan di data\SANDI_OWNER_AWAL.txt, dan TIDAK berubah tiap server dijalankan ulang.
# Tampil di jendela server setiap start selama owner belum menggantinya. Begitu owner menggantinya, berkas ini dihapus otomatis.
# Mau menentukan sendiri? Isi "owner_password" (minimal 8 karakter) di data\config.json lalu jalankan: python server.py --reset-owner
_saved_pw = _owner_pw_saved()
if "--reset-owner" in sys.argv or not owners_active():   # pertama kali jalan / lupa kata sandi owner
    _cp = str(cfg.get("owner_password") or "")
    _pw = _cp if len(_cp) >= 8 else (_saved_pw if len(_saved_pw) >= 8 else new_pass())
    _o = users.get("owner") or {"u": "owner", "name": "Owner", "emp": "", "phone": "", "c": int(time.time())}
    _o.update(role="owner", st="ok"); pw_set(_o, _pw); users["owner"] = _o; users_save(); BOOT = _pw
    if len(_cp) >= 8: _owner_pw_forget()   # sandi pilihan sendiri: jangan simpan salinan polos
    else:
        try: open(OWNER_PW_FILE, "w", encoding="utf-8").write(_pw); os.chmod(OWNER_PW_FILE, 0o600)
        except Exception as e: print("gagal simpan sandi awal:", e)
elif _saved_pw:
    _ow = users.get("owner")
    if _ow and pw_ok(_ow, _saved_pw): BOOT = _saved_pw   # owner belum menggantinya: tampilkan lagi
    else: _owner_pw_forget()                              # sudah diganti: hapus salinan polos

# ---------- akun TAMU & obrolan penggemar: diproses SERVER (dulu halaman resepsionis; kini tidak perlu halaman resepsionis terbuka) ----------
# Akun staf/karyawan hanya dibuat owner (users.json). Pendaftaran di aplikasi hanya untuk tamu/orang lain.
GA_FILE = os.path.join(DATA, "guest_secrets.json")
def _ga_load():
    """Baca guest_secrets.json. Bila rusak/terkunci: JANGAN diam-diam mulai kosong (dulu itu membuat semua kata sandi tamu hilang dan akun jadi 'username atau kata sandi salah'). Coba .bak, dan simpan file rusak sebagai .rusak-<jam>."""
    for f in (GA_FILE, GA_FILE + ".bak"):
        if not os.path.isfile(f): continue
        try:
            j = json.load(open(f, encoding="utf-8-sig"))
            if isinstance(j, dict):
                if f != GA_FILE: print(" [AKUN TAMU] guest_secrets.json rusak, dipulihkan dari cadangan .bak (%d akun)" % len(j))
                return j
        except Exception as e: print(" [AKUN TAMU] gagal membaca %s: %s" % (os.path.basename(f), e))
        if f == GA_FILE:
            try: os.replace(GA_FILE, GA_FILE + ".rusak-" + time.strftime("%H%M%S"))
            except Exception: pass
    return {}
ga_sec = _ga_load()
def ga_save():
    """Simpan; salinan sebelumnya dijaga di .bak."""
    try:
        if os.path.isfile(GA_FILE):
            try: shutil.copy2(GA_FILE, GA_FILE + ".bak")
            except Exception: pass
        _aw(GA_FILE, json.dumps(ga_sec))
    except Exception as e: print(" [AKUN TAMU] GAGAL simpan akun tamu (kata sandi bisa hilang saat server mati):", e)
def kvj(k, dflt):
    try: v = json.loads((kv.get(k) or {}).get("d") or "null")
    except Exception: v = None
    return v if isinstance(v, type(dflt)) else dflt
def kvput(k, v):
    with lock: ver[0] += 1; kv[k] = {"v": ver[0], "d": json.dumps(v, ensure_ascii=False)}; dirty[0] = True
def _rnd(n): return "".join(secrets.choice("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") for _ in range(n))
def _T(x): return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f]", " ", str("" if x is None else x))).strip()
def _short(n):
    w = [x for x in _T(n).split(" ") if x]
    return "Tamu" if not w else w[0][:14] + ((" " + w[1][0].upper() + ".") if len(w) > 1 else "")
def ga_pub(a): return {"id": a["id"], "user": a["user"], "name": a["name"], "app": a.get("app", "tamu"), "staf": 1 if a.get("staf") else 0, "st": a.get("st") or "ok"}
def ga_comm_pub():
    out = []
    for c in [c for c in kvj("hs_comm", []) if isinstance(c, dict) and not c.get("hide")][-60:][::-1]:
        out.append({"id": c.get("id"), "a": c.get("a"), "n": c.get("n"), "s": 1 if c.get("s") else 0, "t": c.get("t"), "v": c.get("v") or 0, "c": c.get("c"),
                    "rp": [{"id": r.get("id"), "a": r.get("a"), "n": r.get("n"), "s": 1 if r.get("s") else 0, "t": r.get("t"), "c": r.get("c")} for r in (c.get("rp") or []) if isinstance(r, dict) and not r.get("hide")][-8:]})
    return out
def ga_migrate():
    """Akun lama (kata sandi/token tersimpan di data sinkron semua staf) -> rahasia dipindah ke guest_secrets.json (PBKDF2)."""
    L = kvj("hs_accts", []); chg = False
    for a in L:
        if isinstance(a, dict) and ("pwh" in a or "ths" in a):
            s_ = ga_sec.setdefault(str(a.get("id")), {})
            if a.get("pwh") and not s_.get("h"): s_["salt"], s_["h"] = pw_hash(str(a["pwh"]))
            if a.get("ths") and not s_.get("ths"): s_["ths"] = list(a["ths"])[-5:]
            a.pop("pwh", None); a.pop("ths", None); chg = True
    if chg: kvput("hs_accts", L); ga_save()
if ga_sec and not os.path.isfile(GA_FILE): ga_save()   # dipulihkan dari .bak: tulis ulang file utama sekarang
ga_migrate()
def ga_orphans(): return [a for a in kvj("hs_accts", []) if isinstance(a, dict) and not (ga_sec.get(str(a.get("id"))) or {}).get("h")]
_o = ga_orphans()
if _o: print(" [AKUN TAMU] %d akun tamu TANPA kata sandi (data tidak cocok setelah update/pemulihan): %s. Tamu bisa memulihkan sendiri lewat Daftar dengan username + No. HP yang sama; owner juga bisa Setel ulang / Hapus akun di Akun Aplikasi." % (len(_o), ", ".join("@" + str(a.get("user")) for a in _o[:12])))
_gfl, _glast = {}, {}
CALLS_U = {}      # panggilan suara staf -> akun aplikasi: cid -> {u: id akun, f: 'R'|'O', t: waktu}
_gseen = {}       # kapan terakhir kehadiran akun aplikasi disiarkan ke staf
def _dm_list(aid): return [x for x in (kvj("hs_dm", {}).get(aid) or []) if isinstance(x, dict)]
def _dm_add(aid, f, n, txt, now):
    D = kvj("hs_dm", {}); th = [x for x in (D.get(aid) or []) if isinstance(x, dict)]
    th.append({"i": "M" + _rnd(6), "t": int(now * 1000), "f": f, "n": n, "c": txt}); D[aid] = th[-200:]; kvput("hs_dm", D)
def _dm_n(aid):
    th = _dm_list(aid); st = [x for x in th if x.get("f") == "s"]
    return {"k": "dmn", "n": len(st), "t": st[-1].get("t", 0) if st else 0, "ice": cfg.get("ice_servers") or []}
def ic_u_staff(d):
    """Validasi sinyal panggilan dari staf ke akun aplikasi (tid 'U:<id akun>'). Hanya R/O, hanya akun aktif, hanya panggilan yang tercatat."""
    k = str(d.get("k", "")); cid = re.sub(r"[^\w-]", "", str(d.get("cid", "")))[:40]; tid = str(d.get("tid", ""))[2:]; fid = str(d.get("fid", "")); now = time.time()
    if not cid: return False
    with lock:
        for x in [x for x, v in CALLS_U.items() if now - v["t"] > 3 * 3600]: CALLS_U.pop(x, None)
        if k == "ring":
            if fid not in ("R", "O") or len(CALLS_U) > 300: return False
            a = next((x for x in kvj("hs_accts", []) if isinstance(x, dict) and x.get("id") == tid), None)
            if not a or a.get("bl") or a.get("st") != "ok": return False
            CALLS_U[cid] = {"u": tid, "f": fid, "t": now, "fn": str(d.get("fn") or "")[:40], "ans": False, "rn": 0}
            push_acct(tid, "📞 Panggilan suara masuk", CALLS_U[cid]["fn"] or ("Owner" if fid == "O" else "Resepsionis"), "ic2", True); return True
        c = CALLS_U.get(cid)
        if not c or c["u"] != tid or c["f"] != fid: return False
        if k in ("end", "reject"): CALLS_U.pop(cid, None)
        elif k not in ("offer", "answer", "accept"): return False
        return True
def _pub_ring(cid, aid):
    c = CALLS_U.get(cid)
    if c and c["u"] == aid and not c.get("ans") and time.time() - c["t"] < 42:
        publish({"type": "ic2", "k": "ring", "cid": cid, "tid": "U:" + aid, "fid": c["f"], "fn": c.get("fn") or ("Owner" if c["f"] == "O" else "Resepsionis")})
def ring_replay(aid):
    """Aplikasi baru dibuka (mis. dari notifikasi panggilan) saat panggilan masih berdering: kirim ulang dering ke aplikasi itu."""
    now = time.time()
    for cid, c in list(CALLS_U.items()):
        if c["u"] == aid and not c.get("ans") and now - c["t"] < 42 and c.get("rn", 0) < 3:
            c["rn"] = c.get("rn", 0) + 1
            for dl in (1.5, 4, 8): threading.Timer(dl, _pub_ring, (cid, aid)).start()
def _acct_locked(m, role, ip):
    k = str(m.get("k", "")); now = time.time(); err = lambda why, **x: ([dict({"k": "err", "why": why}, **x)], False)
    L = [x for x in kvj("hs_accts", []) if isinstance(x, dict)]
    def put(a):
        i = next((i for i, x in enumerate(L) if x.get("id") == a["id"]), -1)
        if i >= 0: L[i] = a
        else: L.append(a)
        kvput("hs_accts", L)
    def newtok(a):
        tok = _rnd(24); s_ = ga_sec.setdefault(a["id"], {}); s_["ths"] = ((s_.get("ths") or []) + [_hash(tok)])[-5:]; ga_save(); return tok
    def auth(aid, tok):
        a = next((x for x in L if x.get("id") == str(aid or "")), None)
        if not a or a.get("bl"): return None
        return a if _hash(str(tok or "")) in (ga_sec.get(a["id"], {}).get("ths") or []) else None
    if k == "hi":
        out = [{"k": "comm", "list": ga_comm_pub()}]
        if m.get("id"):
            a0 = auth(m.get("id"), m.get("tok")); out.append({"k": "me", "ok": 1 if a0 else 0, "acct": ga_pub(a0) if a0 else None})
            if a0: out.append(_dm_n(a0["id"])); ring_replay(a0["id"])
        return out, False
    if k == "ping":   # denyut ringan tiap ~20 dtk dari aplikasi yang sudah masuk: status, pesan baru, dan kehadiran (agar staf tahu akun ini bisa ditelepon)
        a0 = auth(m.get("id"), m.get("tok"))
        if not a0: return [{"k": "me", "ok": 0, "acct": None}], False
        ring_replay(a0["id"])
        if a0.get("st") == "ok" and now - _gseen.get(a0["id"], 0) > 10:
            _gseen[a0["id"]] = now
            if len(_gseen) > 6000: _gseen.clear()
            publish({"type": "ic2", "k": "here", "fid": "U:" + a0["id"], "fn": _short(a0["name"])})
        return [{"k": "me", "ok": 1, "acct": ga_pub(a0)}, _dm_n(a0["id"])], False
    if k == "dmget":
        a0 = auth(m.get("id"), m.get("tok"))
        if not a0: return err("Silakan masuk akun dulu.", relog=1)
        return [{"k": "dm", "list": [{"t": x.get("t"), "f": x.get("f"), "n": x.get("n"), "c": x.get("c")} for x in _dm_list(a0["id"])[-60:]]}], False
    if k == "dmsend":
        a0 = auth(m.get("id"), m.get("tok"))
        if not a0: return err("Silakan masuk akun dulu.", relog=1)
        if a0.get("st") != "ok": return err("Akun Anda belum disetujui pengelola hotel.")
        txt = _T(m.get("c"))[:400]
        if not txt: return err("Tulis pesan dulu.")
        if now - _glast.get("dm" + a0["id"], 0) < 2: return err("Terlalu cepat, tunggu sebentar.")
        _glast["dm" + a0["id"]] = now; _dm_add(a0["id"], "a", _short(a0["name"]), txt, now)
        push_staff("💬 " + _short(a0["name"]), txt, "dmin")
        return [{"k": "posted"}], False
    if k == "ic":     # sinyal panggilan suara dari akun aplikasi (menjawab panggilan staf) -> diteruskan ke staf yang memanggil
        a0 = auth(m.get("id"), m.get("tok")); p_ = m.get("p") if isinstance(m.get("p"), dict) else {}
        kk = str(p_.get("k", "")); cid = re.sub(r"[^\w-]", "", str(p_.get("cid", "")))[:40]; c_ = CALLS_U.get(cid)
        if a0 and kk == "ring" and cid and not c_ and str(p_.get("tid", "")) == "R":   # akun aplikasi menelepon Resepsionis (aturan owner diperiksa halaman resepsionis)
            nm_ = _short(a0["name"]); stop = lambda why: publish({"type": "ic2", "k": "end", "cid": cid, "tid": "U:" + a0["id"], "fid": "R", "why": why})
            for x in [x for x, v in CALLS_U.items() if now - v["t"] > 3 * 3600]: CALLS_U.pop(x, None)
            if a0.get("st") != "ok": stop("akun belum disetujui"); return [], False
            if len(CALLS_U) > 300 or any(v.get("out") and v["u"] == a0["id"] and now - v["t"] < 45 for v in CALLS_U.values()): stop("masih ada panggilan berjalan"); return [], False
            if not allow(ip, "icr" + a0["id"], 6): stop("terlalu sering memanggil"); return [], False
            CALLS_U[cid] = {"u": a0["id"], "f": "R", "t": now, "fn": nm_, "ans": False, "rn": 99, "out": 1}
            publish({"type": "ic2", "k": "ring", "cid": cid, "tid": "R", "fid": "U:" + a0["id"], "fn": nm_})
            push_staff("📞 Panggilan suara masuk", nm_, "ic2", True, ("resepsionis",)); return [], False
        if not a0 or kk not in ("accept", "reject", "end", "offer", "answer") or not c_ or c_["u"] != a0["id"]: return [], False
        o = {"type": "ic2", "k": kk, "cid": cid, "tid": c_["f"], "fid": "U:" + a0["id"], "fn": _short(a0["name"])}
        if isinstance(p_.get("sdp"), str): o["sdp"] = p_["sdp"][:30000]
        if p_.get("why"): o["why"] = _T(p_.get("why"))[:80]
        if kk in ("accept", "reject", "end"): c_["ans"] = True
        if kk in ("end", "reject"): CALLS_U.pop(cid, None)
        publish(o); return [], False
    if k == "reg":
        nm = _T(m.get("name"))[:40]; us = _T(m.get("user")).lower(); ph = re.sub(r"\D", "", str(m.get("ph") or "")); pw = str(m.get("pwh") or "")
        if nm.__len__() < 2: return err("Nama minimal 2 huruf.")
        if not re.fullmatch(r"[a-z0-9_.]{3,20}", us): return err("Username 3-20 karakter: huruf, angka, titik, atau garis bawah.")
        if not 8 <= len(ph) <= 15: return err("No. HP / WhatsApp tidak valid.")
        if not re.fullmatch(r"[a-f0-9]{64}", pw): return err("Kata sandi tidak valid.")
        if not allow(ip, "greg", 6): return err("Terlalu sering mendaftar. Coba lagi sebentar lagi.")
        if len(L) >= 5000: return err("Pendaftaran penuh. Hubungi resepsionis.")
        if us in users: return err("Username sudah dipakai, pilih yang lain.")
        ex = next((x for x in L if x.get("user") == us), None)
        if ex and not (ga_sec.get(ex["id"]) or {}).get("h") and ex.get("ph") == ph and not ex.get("bl"):   # akun yatim (kata sandi hilang): pemilik dengan username + No. HP yang sama memulihkan akunnya, riwayat tetap
            ga_sec[ex["id"]] = {}; ga_sec[ex["id"]]["salt"], ga_sec[ex["id"]]["h"] = pw_hash(pw); tok = newtok(ex); ex["name"] = nm or ex.get("name"); put(ex)
            return [{"k": "ok", "tok": tok, "acct": ga_pub(ex)}], False
        if ex: return err("Username sudah dipakai, pilih yang lain.")
        if any(x.get("ph") == ph for x in L): return err("No. HP ini sudah terdaftar. Silakan Masuk.")
        c_ = kvj("hs_acfg", {}); auto = not c_ or c_.get("auto") != 0
        a = {"id": "A" + _rnd(8), "user": us, "name": nm, "ph": ph, "app": "tamu", "staf": 0, "st": "ok" if auto else "wait", "t": int(now * 1000), "bl": 0}
        ga_sec[a["id"]] = {}; ga_sec[a["id"]]["salt"], ga_sec[a["id"]]["h"] = pw_hash(pw); tok = newtok(a); put(a)
        return [{"k": "ok", "tok": tok, "acct": ga_pub(a)}], False
    if k == "login":
        u = _T(m.get("user")).lower()
        if not allow(ip, "glogin", 30): return err("Terlalu banyak percobaan. Coba lagi sebentar lagi.")
        f = [t for t in _gfl.get(u, []) if now - t < 600]
        if len(f) >= 8: return err("Terlalu banyak percobaan. Coba lagi 10 menit lagi.")
        if len(_gfl) > 5000: _gfl.clear()
        a = next((x for x in L if x.get("user") == u), None); s_ = ga_sec.get(a["id"]) if a else None
        ok = bool(s_ and s_.get("h") and secrets.compare_digest(pw_hash(str(m.get("pwh") or ""), s_["salt"])[1], s_["h"]))
        pwx = str(m.get("pwh") or "")
        if a and not ok and not (s_ or {}).get("h") and not a.get("bl") and a.get("st") != "no":
            if (s_ or {}).get("claim", 0) > now and re.fullmatch(r"[a-f0-9]{64}", pwx):   # owner menekan 'Setel ulang sandi': login berikutnya menentukan kata sandi baru
                ga_sec[a["id"]] = {}; ga_sec[a["id"]]["salt"], ga_sec[a["id"]]["h"] = pw_hash(pwx); tok = newtok(a); put(a); _gfl[u] = []
                return [{"k": "ok", "tok": tok, "acct": ga_pub(a)}], False
            return err("Kata sandi akun ini perlu dibuat ulang. Tekan Daftar, isi username & No. HP yang sama, akun dan riwayat Anda dipulihkan. Atau minta resepsionis menyetel ulang.")
        if not a or not ok: _gfl[u] = f + [now]; return err("Username atau kata sandi salah.")
        if a.get("bl"): return err("Akun ini diblokir. Hubungi resepsionis.")
        if a.get("st") == "no": return err("Pendaftaran akun ini ditolak. Hubungi resepsionis.")
        tok = newtok(a); put(a); _gfl[u] = []
        return [{"k": "ok", "tok": tok, "acct": ga_pub(a)}], False
    if k in ("post", "reply"):
        au = auth(m.get("id"), m.get("tok"))
        if not au: return err("Silakan masuk akun dulu.", relog=1)
        if au.get("st") == "wait": return err("Akun Anda menunggu persetujuan pengelola hotel. Coba lagi setelah disetujui.")
        if au.get("st") == "no": return err("Pendaftaran akun Anda ditolak.")
        txt = _T(m.get("c"))[: 400 if k == "post" else 300]
        if len(txt) < (3 if k == "post" else 1): return err("Tulisan terlalu pendek.")
        if now - _glast.get(au["id"], 0) < 12: return err("Terlalu cepat, tunggu beberapa detik.")
        _glast[au["id"]] = now
        CL = [c for c in kvj("hs_comm", []) if isinstance(c, dict)]; t_ = int(now * 1000)
        if k == "post":
            try: v_ = max(0, min(5, int(round(float(m.get("v") or 0)))))
            except Exception: v_ = 0
            CL.append({"id": "C" + _rnd(8), "a": au["id"], "n": _short(au["name"]), "s": 1 if au.get("staf") else 0, "t": t_, "v": v_, "c": txt, "rp": [], "hide": 0})
            kvput("hs_comm", CL[-300:])
        else:
            it = next((x for x in CL if x.get("id") == str(m.get("cid") or "")), None)
            if not it: return err("Komentar tidak ditemukan.")
            it["rp"] = ((it.get("rp") or []) + [{"id": "P" + _rnd(6), "a": au["id"], "n": _short(au["name"]), "s": 1 if au.get("staf") else 0, "t": t_, "c": txt, "hide": 0}])[-40:]
            kvput("hs_comm", CL)
        return [{"k": "posted"}], True
    if k == "del": return err("Tamu hanya bisa membalas. Penghapusan ulasan hanya oleh pengelola hotel.")
    if k == "mod":
        if role not in ("owner", "resepsionis"): return err("Hanya owner/resepsionis.")
        op = str(m.get("op") or ""); mid = str(m.get("id") or "")
        if op == "auto": kvput("hs_acfg", {"auto": 1 if m.get("v") else 0})
        elif op in ("ok", "no", "okall"):
            for y in L:
                if (op == "okall" and y.get("st") == "wait") or y.get("id") == mid:
                    y["st"] = "no" if op == "no" else "ok"
                    if op == "no": ga_sec.setdefault(y["id"], {})["ths"] = []
            kvput("hs_accts", L); ga_save()
        elif op == "bl":
            x = next((y for y in L if y.get("id") == mid), None)
            if x:
                x["bl"] = 0 if x.get("bl") else 1
                if x["bl"]: ga_sec.setdefault(x["id"], {})["ths"] = []
                kvput("hs_accts", L); ga_save()
        elif op == "reset":   # setel ulang sandi tamu: 24 jam ke depan login dengan username itu menentukan sandi baru
            x = next((y for y in L if y.get("id") == mid), None)
            if not x: return err("Akun tidak ditemukan.")
            pw_ = str(m.get("pwh") or "")
            if re.fullmatch(r"[a-f0-9]{64}", pw_):   # owner menentukan sandi baru (hash dihitung di HP owner); tamu keluar dari semua perangkat
                ga_sec[x["id"]] = {}; ga_sec[x["id"]]["salt"], ga_sec[x["id"]]["h"] = pw_hash(pw_); ga_save()
            else: ga_sec[x["id"]] = {"claim": now + 86400}; ga_save()
        elif op == "delacct":   # hapus akun tamu (username & No. HP bebas dipakai lagi); ulasan lama tetap
            x = next((y for y in L if y.get("id") == mid), None)
            if not x: return err("Akun tidak ditemukan.")
            L[:] = [y for y in L if y.get("id") != mid]; kvput("hs_accts", L); ga_sec.pop(mid, None); ga_save()
            D_ = kvj("hs_dm", {}); D_.pop(mid, None); kvput("hs_dm", D_)
        elif op == "dm":
            txt = _T(m.get("c"))[:400]; a_ = next((y for y in L if y.get("id") == mid), None)
            if not txt: return err("Tulis pesan dulu.")
            if not a_ or a_.get("bl") or a_.get("st") != "ok": return err("Akun ini belum aktif / diblokir.")
            _dm_add(mid, "s", "Owner" if role == "owner" else "Resepsionis", txt, now)
            push_acct(mid, "💬 " + ("Owner" if role == "owner" else "Resepsionis") + " ONE BLISS", txt, "dm")
        elif op == "reply":
            txt = _T(m.get("c"))[:300]
            if not txt: return err("Tulis balasan dulu.")
            CL = [c for c in kvj("hs_comm", []) if isinstance(c, dict)]; it = next((x for x in CL if x.get("id") == mid), None)
            if not it: return err("Ulasan tidak ditemukan.")
            it["rp"] = ((it.get("rp") or []) + [{"id": "P" + _rnd(6), "a": "HOTEL", "n": "ONE BLISS", "s": 1, "t": int(now * 1000), "c": txt, "hide": 0}])[-40:]
            kvput("hs_comm", CL)
        elif op in ("hide", "rm"):
            ML = [c for c in kvj("hs_comm", []) if isinstance(c, dict)]
            if op == "hide":
                for c in ML:
                    if c.get("id") == mid: c["hide"] = 0 if c.get("hide") else 1
                    for r in (c.get("rp") or []):
                        if r.get("id") == mid: r["hide"] = 0 if r.get("hide") else 1
            else:
                ML = [c for c in ML if c.get("id") != mid]
                for c in ML: c["rp"] = [r for r in (c.get("rp") or []) if r.get("id") != mid]
            kvput("hs_comm", ML)
        else: return err("Perintah tidak dikenal.")
        return [{"k": "ok"}], True
    return err("Perintah tidak dikenal.")
def acct_op(m, role, ip):
    with lock: reps, bc = _acct_locked(m, role, ip)
    kv_flush()   # akun tamu = 2 file (hs_kv.json + guest_secrets.json): jangan biarkan satu tertinggal bila server ditutup mendadak
    if bc: publish({"type": "comm", "list": ga_comm_pub()})
    return reps


HK_CODES = ("VD", "VC", "OD", "OC", "OO", "OOS", "SO", "SKP")   # kode status kamar yang boleh dilaporkan HK
def _hk_insp():
    """True = setelah HK selesai, kamar menunggu cek supervisor (bawaan). Owner bisa mematikan: pengaturan hkInsp = 0 -> langsung siap."""
    c = kvj("hs_cfg", {})
    try: return str(c.get("hkInsp", 1)) not in ("0", "0.0")
    except Exception: return True
_hkf = {}
def hk_api(b, sess, local):
    """Dasbor kamar Housekeeping: daftar kamar + masuk kamar KOSONG dengan PIN HK (tanpa QR). PIN diperiksa di server."""
    op = str(b.get("op", "")); emp = str((sess or {}).get("emp", "")); now = time.time()
    me = next((e for e in staff_list() if str(e.get("id")) == emp and e.get("on") is not False), None) if emp else None
    if not me or me.get("role") != "Housekeeping": return {"ok": False, "msg": "Fitur ini hanya untuk akun karyawan Housekeeping."}
    rd = br.rooms_data()
    if op == "rooms":
        out = []
        for n, r in rd.items():
            if not isinstance(r, dict): continue
            out.append({"n": n, "type": str(r.get("type", ""))[:30], "guest": bool(r.get("guest")), "hk": str(r.get("hk") or ""), "by": str(r.get("hkBy") or "")[:30],
                        "mine": bool(r.get("hk") == "doing" and str(r.get("hkId") or "") == emp), "oo": bool(r.get("oo")), "ooNote": _T(r.get("ooNote") or "")[:200], "ooT": str(r.get("ooT") or "")[:3], "dnd": bool(r.get("dnd")), "mur": bool(r.get("mur")), "so": bool(r.get("so")), "skp": bool(r.get("skp")), "ea": bool(r.get("ea")), "ovD": bool(r.get("ovD")), "ooBy": str(r.get("ooBy") or "")[:30], "ooAt": int(r.get("ooAt") or 0),
                        "code": (str(r.get("hkCode") or "")[:3] if str(r.get("hkCode") or "") in HK_CODES else ""), "note": _T(r.get("hkNote") or "")[:200],
                        "cout": str(r.get("cout") or "")[:10] if r.get("guest") else "", "at": int(r.get("hkAt") or 0) if r.get("hk") == "doing" else 0, "chk": str(r.get("hkChk") or "")[:30]})
        out.sort(key=lambda x: (len(x["n"]), x["n"]))
        return {"ok": True, "rooms": out, "name": me.get("name", ""), "insp": _hk_insp()}
    room = str(b.get("room", "")); r = rd.get(room)
    if not isinstance(r, dict): return {"ok": False, "msg": "Kamar tidak ditemukan."}
    if op == "enter":
        if r.get("guest"): return {"ok": False, "msg": "Kamar %s masih terisi tamu." % room}
        if r.get("hk") == "doing" and str(r.get("hkId") or "") not in ("", emp): return {"ok": False, "msg": "Kamar %s sedang dibersihkan %s." % (room, r.get("hkBy", ""))}
        pin = str(b.get("pin", ""))[:12]; real = str(me.get("pin") or "")
        if not real: return {"ok": False, "msg": "PIN HK Anda belum diatur. Minta owner mengisinya (Owner > Karyawan > Kelola karyawan)."}
        with lock:
            f = [t for t in _hkf.get(emp, []) if now - t < 600]; _hkf[emp] = f
            if len(f) >= 5: return {"ok": False, "msg": "Terlalu banyak PIN salah. Coba lagi 10 menit lagi."}
            if not (pin and secrets.compare_digest(pin, real)): _hkf[emp] = f + [now]; return {"ok": False, "msg": "PIN salah (%d/5)." % (len(f) + 1)}
            _hkf[emp] = []
        ok, msg = br.hk_enter(room, me.get("name", "HK"))
        if not ok: return {"ok": False, "msg": msg}
        publish({"type": "hk_evt", "act": "start", "room": room, "emp": emp, "name": me.get("name", ""), "ts": int(now * 1000)})
        return {"ok": True, "msg": msg}
    if op == "leave":
        if r.get("guest"): return {"ok": False, "msg": "Kamar terisi tamu."}
        if not (r.get("hk") == "doing" and str(r.get("hkId") or "") == emp): return {"ok": False, "msg": "Anda tidak sedang membersihkan kamar ini."}
        br.hk_leave(room, me.get("name", "HK")); return {"ok": True, "msg": "Akses sementara dicabut."}
    if op in ("mark", "done"):
        code = str(b.get("code", "")).strip().upper()[:3]; code = code if code in HK_CODES else ""
        note = _T(b.get("note", ""))[:200]
        if op == "mark":
            if not code and not note: return {"ok": False, "msg": "Pilih kode status atau isi catatan dulu."}
            publish({"type": "hk_evt", "act": "mark", "room": room, "emp": emp, "name": me.get("name", ""), "code": code, "note": note, "ts": int(now * 1000)})
            return {"ok": True, "msg": "Kamar %s: kode & catatan tersimpan%s." % (room, " (%s dilaporkan ke resepsionis & owner)" % ("OOO" if code == "OO" else code) if code in ("OO", "OOS", "SKP") else "")}
        if r.get("guest"): return {"ok": False, "msg": "Kamar terisi tamu."}
        if not (r.get("hk") == "doing" and str(r.get("hkId") or "") == emp): return {"ok": False, "msg": "Anda tidak sedang membersihkan kamar ini (masukkan PIN HK dulu)."}
        br.hk_leave(room, me.get("name", "HK"))
        publish({"type": "hk_evt", "act": "done", "room": room, "emp": emp, "name": me.get("name", ""), "code": code, "note": note, "ts": int(now * 1000)})
        insp = _hk_insp()
        return {"ok": True, "insp": insp, "msg": ("Kamar %s selesai. Menunggu cek supervisor." if insp else "Kamar %s selesai. Siap dijual.") % room}
    return {"ok": False, "msg": "Perintah tidak dikenal."}

_sl = [None, []]
def staff_list():
    """Daftar karyawan dari data dasbor (hs_staff), di-cache per versi data."""
    with lock:
        if _sl[0] != ver[0]:
            try: L = json.loads((kv.get("hs_staff") or {}).get("d") or "[]")
            except Exception: L = []
            _sl[0] = ver[0]; _sl[1] = [x for x in L if isinstance(x, dict)] if isinstance(L, list) else []
        return _sl[1]
def emp_active(emp): return bool(emp) and any(str(e.get("id")) == str(emp) and e.get("on") is not False for e in staff_list())
def emp_token(emp): return next((str(e.get("token", "")) for e in staff_list() if str(e.get("id")) == str(emp)), "") if emp else ""
def sess_save():
    try: _aw(SESS_FILE, json.dumps(sessions))
    except Exception as e: print("gagal simpan sesi:", e)
def sess_get(tok):
    """Sesi sah selama akunnya masih ada, disetujui, kata sandinya tidak diganti; peran selalu mengikuti akun saat ini."""
    if not tok: return None
    with lock:
        k = _hash(tok); x = sessions.get(k)
        if not x: return None
        if x["exp"] < time.time(): sessions.pop(k, None); return None
        u = users.get(x.get("user", ""))
        if not u or u.get("st") != "ok" or u.get("pv") != x.get("pv"): sessions.pop(k, None); return None
        if u.get("role") == "hk" and not emp_active(u.get("emp")): return None
        return {"role": u["role"], "user": u["u"], "name": u.get("name", ""), "emp": u.get("emp", "")}
def sess_new(u):
    tok = secrets.token_urlsafe(24)
    with lock:
        now = time.time()
        for k in [k for k, v in sessions.items() if v["exp"] < now]: sessions.pop(k, None)
        if len(sessions) > 600: sessions.pop(min(sessions, key=lambda k: sessions[k]["exp"]), None)
        sessions[_hash(tok)] = {"user": u["u"], "pv": u.get("pv"), "exp": now + SESS_DAYS * 86400}
    sess_save(); return tok
def sess_drop(tok):
    with lock: sessions.pop(_hash(tok), None)
    sess_save()
def try_login(ip, user, pw):
    """-> (akun|None, pesan). Batas: 8 salah/10 menit per IP dan per username, 100 salah/jam global."""
    now = time.time(); user = str(user).strip().lower()[:24]
    with lock:
        fl = [t for t in fails.get(ip, []) if now - t < 600]; fails[ip] = fl
        ul = [t for t in ufails.get(user, []) if now - t < 600]; ufails[user] = ul
        gl = [t for t in gfails if now - t < 3600]; gfails[:] = gl
        if len(fl) >= 8 or len(ul) >= 8: return None, "Terlalu banyak percobaan. Coba lagi 10 menit lagi."
        if len(gl) >= 100: return None, "Login dikunci sementara (banyak percobaan salah). Coba lagi nanti atau pakai komputer hotel."
        if len(fails) > 5000: fails.clear()
        if len(ufails) > 5000: ufails.clear()
        u = users.get(user)
    if not u: pw_hash(pw); return None, "__guest__"   # bukan akun staf: biarkan jalur akun tamu yang menilai (hash tetap dihitung supaya waktunya sama)
    ok = pw_ok(u, pw)
    if not ok:
        with lock: fails.setdefault(ip, []).append(now); ufails.setdefault(user, []).append(now); gfails.append(now)
        return None, "Username atau kata sandi salah."
    if u.get("st") == "wait": return None, "Akun Anda masih menunggu persetujuan owner."
    if u.get("st") != "ok": return None, "Akun dinonaktifkan. Hubungi owner."
    if u.get("role") == "hk" and not emp_active(u.get("emp")): return None, "Akun belum terhubung ke data karyawan yang aktif. Hubungi owner."
    return u, "ok"

_wv = [0, ""]
def web_ver():
    """Versi aplikasi = sidik dari berkas web (html/js/manifest). Berubah saat berkas diganti; dipakai tombol Perbarui di aplikasi."""
    if time.time() - _wv[0] < 5 and _wv[1]: return _wv[1]
    h = hashlib.sha1()
    for root, _, fs in os.walk(WEB):
        for f in sorted(fs):
            if f.endswith((".html", ".js", ".webmanifest")):
                try: st = os.stat(os.path.join(root, f)); h.update(("%s|%d|%d;" % (f, st.st_size, int(st.st_mtime))).encode())
                except OSError: pass
    _wv[0], _wv[1] = time.time(), h.hexdigest()[:10]; return _wv[1]

def san(k, d, role):
    """Karyawan (HK) tidak boleh membaca PIN/QR token orang lain atau PIN owner lewat sinkron data."""
    if role != "hk" or not isinstance(d, str): return d
    if k == "hs_accts": return "[]"
    if k == "hs_dm": return "{}"
    try: v = json.loads(d)
    except Exception: return d
    if k == "hs_staff" and isinstance(v, list): v = [({a: b for a, b in x.items() if a not in ("pin", "token")} if isinstance(x, dict) else x) for x in v]
    elif k == "hs_cfg" and isinstance(v, dict):
        for a in ("pin", "mgr"): v.pop(a, None)
    else: return d
    return json.dumps(v)

LOGOUT_HTML = """<!DOCTYPE html><meta charset="utf-8"><title>Keluar</title><body style="background:#0a0a0a;color:#a9a193;font:16px system-ui;text-align:center;padding-top:30vh">Keluar...<script>try{localStorage.removeItem("hs_key_dev");localStorage.removeItem("hs_pin_mode");localStorage.removeItem("emp_me");sessionStorage.removeItem("own")}catch(e){}location.replace("/")</script>"""

def client(cid):
    with lock:
        c = clients.get(cid)
        if not c:
            if len(clients) > 3000:
                for k in [k for k, v in clients.items() if time.time() - v["t"] > 3600]: clients.pop(k, None)
            c = clients[cid] = {"logins": {}, "rids": {}, "auth": {}, "vids": {}, "uids": {}, "t": 0}
        c["t"] = time.time(); return c

def guest_sees(c, d, i=0):
    if not isinstance(d, dict): return False
    t = d.get("type")
    if t in GUEST_PUBLIC: return d.get("to") is None
    if t in ("login_ok", "login_fail"):
        ok = c["logins"].get((str(d.get("to")), str(d.get("token"))), 1 << 60) < i
        if ok and t == "login_ok": c["auth"].setdefault(str(d.get("to")), i)
        return ok
    if t in GUEST_RID:
        ok = c["rids"].get(str(d.get("rid")), 1 << 60) < i
        if ok and d.get("room") and t in ("stay_ok", "reg_approved"): c["auth"].setdefault(str(d["room"]), i)
        return ok
    if t == "ic2" and str(d.get("tid", "")).startswith("U:"):   # panggilan staf ke akun aplikasi: hanya untuk perangkat yang sudah masuk dengan akun itu
        return c["uids"].get(str(d["tid"])[2:], 1 << 60) <= i
    if t in GUEST_ADDR:
        r = d.get("to", d.get("room")); return r is not None and c["auth"].get(str(r), 1 << 60) <= i
    if t in GUEST_VISIT: return str(d.get("vid")) in c["vids"]
    if t == "rchat": return bool(c["auth"])
    return False

def learn(c, d):
    t = d.get("type")
    with lock:
        if t in ("visit", "acct") and VID_RE.fullmatch(str(d.get("vid", ""))) and len(c["vids"]) < 4: c["vids"].setdefault(str(d["vid"]), mid[0])
        if t == "login" and d.get("room") is not None and len(c["logins"]) < 20: c["logins"].setdefault((str(d.get("room")), str(d.get("token"))), mid[0])
        for k in ("rid", "reqid"):
            if t in ("register", "reg_status", "reg_cancel", "stay_check", "resend_req") and d.get(k) is not None and len(c["rids"]) < 30: c["rids"].setdefault(str(d[k])[:60], mid[0])

def real_ip(h):
    ip = h.client_address[0]
    if ip in ("127.0.0.1", "::1"):
        x = h.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        if x: return x[:45]
    return ip

class H(BaseHTTPRequestHandler):
    guest = False; pin_login = False; role = None; trust_local = False; local = False; sess = None
    server_version = "OneBliss"
    def log_message(self, *a): pass
    def _send(self, code, body=b"", ctype="application/json", extra=None):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD": self.wfile.write(body)
    def _json(self, o, code=200): self._send(code, json.dumps(o).encode())
    def _body(self, lim):
        n = int(self.headers.get("Content-Length") or 0)
        if n > lim or n < 0: return None
        return self.rfile.read(n)
    def _key_ok(self):
        if self.pin_login: return bool(self.role)   # alamat publik: hanya sesi PIN (KODE STAF tidak berlaku)
        return secrets.compare_digest(self.headers.get("X-HS", ""), cfg["hs_key"])
    def _ck(self): return urllib.parse.parse_qs(self.headers.get("Cookie", "").replace("; ", "&").replace(";", "&")).get("ob_s", [""])[0]
    def _auth(self):
        """Alamat publik: cek sesi akun (cookie atau header X-HS). Sesi sah = diperlakukan sebagai staf sesuai peran akunnya."""
        if not self.pin_login: return
        if self.trust_local and self.client_address[0] in ("127.0.0.1", "::1") and not self.headers.get("X-Forwarded-For"):
            self.role, self.guest, self.local = "owner", False, True; return   # komputer server sendiri: tanpa login
        self.sess = sess_get(self._ck()) or sess_get(self.headers.get("X-HS", ""))
        self.role = self.sess["role"] if self.sess else None
        self.guest = not self.role
    def _staff_gate(self, p):
        """Alamat publik + staf: hanya halaman/endpoint staf yang diizinkan (bukan /esp, /hs/esp, index)."""
        if self.local: return True
        if p in STAFF_PAGES: return p in ROLE_PAGES.get(self.role, ())
        return p in STAFF_STATIC or p in ("/tamu-lama3.html", "/hs/cfg", "/hs/kv", "/hs/poll", "/hs/send", "/hs/file", "/hs/me", "/hs/acct", "/hs/hk", "/hs/ver", "/hs/hubbeat", "/hs/pushkey", "/hs/pushsub", "/hs/pushq", "/hs/pushevt") or p.startswith("/icons/")
    def _to_login(self, p):
        r = {"/owner-lama3.html": "owner", "/karyawan-lama3.html": "hk"}.get(p, "resepsionis")
        return self._send(302, b"", "text/plain", {"Location": "/?masuk=1&next=%s" % urllib.parse.quote(p)})
    def _static(self, name):
        f = os.path.normpath(os.path.join(WEB, name))
        if not f.startswith(WEB + os.sep) or not os.path.isfile(f): return self._send(404, b"404", "text/plain")
        data = open(f, "rb").read()
        if name == "hs/net.js": data = ('window.OB_BUILD="%s";\n' % web_ver()).encode() + data   # versi yang dimuat halaman ini
        self._send(200, data, MIME.get(os.path.splitext(f)[1], "application/octet-stream"), {"Service-Worker-Allowed": "/"} if name == "sw.js" else None)
    def _route(self):
        u = urllib.parse.urlparse(self.path); p = u.path
        if p.startswith("/hotel/"): p = p[6:]
        if p in ("/hotel", "/tamu", "/tamu.html"): p = "/tamu-lama3.html"
        if p in ("/resepsionis", "/owner", "/karyawan"): p += "-lama3.html"
        if p == "/": p = "/tamu-lama3.html" if self.guest else "/index.html"
        return u, p
    def _guest_page_ok(self, p): return p in ("/tamu-lama3.html", "/hs/net.js", "/hs/draft.js", "/hs/ic.js", "/hs/akun.js", "/sw.js", "/manifest-tamu.webmanifest", "/manifest-staf.webmanifest") or p in ("/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png")
    def _acct(self, b):
        op = str(b.get("op", "")); me = (self.sess or {}).get("user", "")
        J = lambda ok, msg="", **k: self._json(dict({"ok": ok, "msg": msg}, **k))
        if op == "pass":   # ganti kata sandi sendiri (semua peran)
            if not me: return J(False, "Komputer hotel tidak memakai akun.")
            old, new = str(b.get("old", ""))[:64], str(b.get("new", ""))[:64]
            if len(new) < 6: return J(False, "Kata sandi baru minimal 6 karakter.")
            with lock:
                u = users.get(me)
                if not u or not pw_ok(u, old): return J(False, "Kata sandi lama salah.")
                pw_set(u, new); users_save()
            return J(True, "Kata sandi diganti. Silakan masuk lagi.")
        if op == "dir":   # daftar akun aktif (nama + peran saja) agar setiap akun bisa saling menelepon di interkom; semua peran staf boleh melihat
            if not self.role: return J(False, "Belum masuk.")
            with lock:
                L = [{"u": x["u"], "name": str(x.get("name") or x["u"])[:40], "role": str(x.get("role", "")), "emp": str(x.get("emp", ""))[:40]}
                     for x in users.values() if x.get("st") == "ok" and (x.get("role") != "hk" or emp_active(x.get("emp")))]
            return J(True, me=me, users=sorted(L, key=lambda z: (z["name"].lower(), z["u"]))[:300])
        if self.role != "owner": return J(False, "Hanya owner yang boleh mengelola akun.")
        if op == "list":
            with lock: return J(True, me=me, users=sorted((pub(u) for u in users.values()), key=lambda x: (x["st"] != "wait", x["role"] != "owner", x["u"])))
        key = str(b.get("u", "")).strip().lower()
        if not UNAME.fullmatch(key): return J(False, "Username 3-24 karakter: huruf kecil, angka, titik, strip.")
        if op == "del":
            with lock:
                u = users.get(key)
                if not u: return J(False, "Akun tidak ditemukan.")
                if key == me: return J(False, "Akun yang sedang dipakai tidak bisa dihapus.")
                if u.get("role") == "owner" and not owners_active(key): return J(False, "Tidak bisa: ini satu-satunya owner aktif.")
                users.pop(key); users_save()
            return J(True, "Akun dihapus.")
        if op == "save":
            name = re.sub(r"\s+", " ", str(b.get("name", ""))).strip()[:40]; role = str(b.get("role", "")); st = str(b.get("st", "ok"))
            emp = str(b.get("emp", "")).strip()[:40]; phone = re.sub(r"[^0-9+ -]", "", str(b.get("phone", "")))[:20]; pw = str(b.get("pass", ""))[:64]
            if role not in ROLES: return J(False, "Peran tidak valid.")
            if st not in ("ok", "off"): return J(False, "Status tidak valid.")
            if pw and len(pw) < 6: return J(False, "Kata sandi minimal 6 karakter.")
            if emp and not any(str(e.get("id")) == emp for e in staff_list()): return J(False, "Karyawan tidak ditemukan di data karyawan.")
            if role == "hk" and not emp: return J(False, "Akun karyawan/HK harus dihubungkan ke data karyawan.")
            with lock:
                u = users.get(key); new = u is None
                if new and len(pw) < 6: return J(False, "Akun baru wajib diberi kata sandi (minimal 6 karakter).")
                if emp and any(k != key and x.get("emp") == emp for k, x in users.items()): return J(False, "Karyawan itu sudah punya akun lain.")
                if key == me and (st != "ok" or role != "owner"): return J(False, "Akun yang sedang dipakai tidak boleh dinonaktifkan atau diturunkan.")
                if u and u.get("role") == "owner" and (role != "owner" or st != "ok") and not owners_active(key): return J(False, "Tidak bisa: ini satu-satunya owner aktif.")
                if new: u = {"u": key, "c": int(time.time())}
                u.update(name=name or key, role=role, emp=emp, phone=phone, st=st)
                if pw: pw_set(u, pw)
                users[key] = u; users_save()
            return J(True, "Akun dibuat." if new else "Akun disimpan.")
        return J(False, "Perintah tidak dikenal.")
    def do_HEAD(self): self.do_GET()
    def do_GET(self):
        u, p = self._route(); q = urllib.parse.parse_qs(u.query); ip = real_ip(self); self._auth()
        if p == "/.well-known/assetlinks.json":   # bukti kepemilikan situs untuk aplikasi Android (TWA/APK); isi berkas data\\assetlinks.json dari PWABuilder/Bubblewrap
            f = os.path.join(DATA, "assetlinks.json")
            if not os.path.isfile(f): return self._send(404, b"404", "text/plain")
            return self._send(200, open(f, "rb").read(), "application/json")
        if self.pin_login:
            if p == "/login":
                nx = (q.get("next") or [""])[0]; nx = nx if nx[:1] == "/" and nx[1:2] != "/" else ""
                return self._send(302, b"", "text/plain", {"Location": "/?masuk=1" + ("&next=" + urllib.parse.quote(nx) if nx else "")})
            if p == "/logout":
                if self._ck(): sess_drop(self._ck())
                return self._send(200, LOGOUT_HTML.encode(), "text/html; charset=utf-8", {"Set-Cookie": "ob_s=; Path=/; Max-Age=0"})
            if p == "/hs/me":
                if self.local: return self._json({"ok": True, "local": True, "role": "owner", "name": "Komputer hotel", "user": "", "emp": "", "etoken": "", "pages": sorted(ROLE_PAGES["owner"]), "land": LAND["owner"]})
                if not self.role or not self.sess: return self._json({"ok": False})
                s_ = self.sess
                return self._json({"ok": True, "local": False, "role": s_["role"], "name": s_["name"], "user": s_["user"], "emp": s_["emp"], "etoken": emp_token(s_["emp"]), "pages": sorted(ROLE_PAGES[s_["role"]]), "land": LAND[s_["role"]]})
            if p == "/index.html" and self.role and not self.local: return self._send(302, b"", "text/plain", {"Location": LAND[self.role]})   # buka alamat utama = langsung ke aplikasi sesuai peran
            if p in STAFF_PAGES and not (self.role and self._staff_gate(p)): return self._to_login(p)
            if self.role and not self._staff_gate(p): return self._send(404, b"404", "text/plain")
        if p == "/hs/ver": return self._json({"v": web_ver()})
        if p == "/hs/pushkey": return self._json({"key": VAPID_PUB})
        if p == "/hs/poll":
            if self.guest and not allow(ip, "poll", 600): return self._json({"busy": True}, 429)
            return self._poll(q, ip)
        if p == "/hs/file":
            fid = (q.get("id") or [""])[0]
            if not (FID_G if self.guest else FID_S).fullmatch(fid): return self._send(404, b"", "text/plain")
            if self.guest and not allow(ip, "fget", 120): return self._send(429, b"", "text/plain")
            f = os.path.join(FILES, fid)
            if not os.path.isfile(f): return self._send(404, b"", "text/plain")
            t = open(f + ".t").read() if os.path.isfile(f + ".t") else "application/octet-stream"
            if t.lower().startswith("text/html") or "svg" in t.lower(): t = "application/octet-stream"
            return self._send(200, open(f, "rb").read(), t, {"Content-Disposition": "inline", "Content-Security-Policy": "sandbox"})
        if self.guest and p == "/tamu-lama3.html" and q.get("ip") and not q.get("room"):   # QR pintu ESP32: /g -> portal/tamu?ip=IP-ESP
            rm = next((n for n in br.rooms_data() if br.ip(n) == q["ip"][0]), None)
            if rm: return self._send(302, b"", "text/plain", {"Location": "/tamu-lama3.html?room=" + rm})
        if self.guest:
            if not self._guest_page_ok(p): return self._send(404, b"404", "text/plain")
            return self._static(p.lstrip("/"))
        if p == "/hs/cfg": return self._json({"public": cfg["public_url"], "ice": cfg.get("ice_servers") or []})
        if p == "/hs/esp":
            if not self._key_ok(): return self._json({"ok": False}, 403)
            return self._json(br.snapshot())
        if p == "/esp": p = "/esp.html"
        if p == "/hs/kv":
            if not self._key_ok(): return self._json({"ok": False}, 403)
            v = int((q.get("v") or ["0"])[0] or 0)
            with lock: return self._json({"v": ver[0], "kv": {k: san(k, x["d"], self.role) for k, x in kv.items() if x["v"] > v}})
        return self._static(p.lstrip("/"))
    def _poll(self, q, ip):
        cid = (q.get("c") or [""])[0][:40]; since = (q.get("since") or [""])[0]
        c = client(cid) if self.guest else None
        if since == "": return self._json({"last": mid[0], "msgs": []})
        try: since = int(since)
        except ValueError: since = -1
        lim = 40 if self.guest else 80   # staf lewat proxy Tailscale: jangan dibatasi ketat
        if not poll_slot(ip, 1, lim): return self._json({"busy": True}, 429)   # tanpa "last": klien tidak melewatkan pesan
        try:
            end = time.time() + 20
            with cv:
                while True:
                    ms = [m for m in msgs if m["id"] > since and m["c"] != cid and (not self.guest or guest_sees(c, m["d"], m["id"]))]
                    if ms or time.time() >= end: break
                    cv.wait(max(0.1, min(2.0, end - time.time())))
            return self._json({"last": mid[0], "msgs": ms})
        finally: poll_slot(ip, -1)
    def do_POST(self):
        u, p = self._route(); q = urllib.parse.parse_qs(u.query); ip = real_ip(self); self._auth()
        if self.pin_login and p == "/login":
            raw = self._body(2000)
            try: b = json.loads(raw); user = str(b.get("user", "")); pw = str(b.get("pass", ""))[:64]
            except Exception: return self._json({"ok": False, "msg": "Data salah"}, 400)
            u, msg = try_login(ip, user, pw)
            if not u and msg in ("__guest__", "Username atau kata sandi salah."): return self._json({"ok": False, "guest": True})   # jalur akun tamu menilai berikutnya (pesan galat sama untuk semua)
            if not u: return self._json({"ok": False, "msg": msg}, 429 if "Terlalu" in msg or "dikunci" in msg else 403)
            tok = sess_new(u)
            with lock: u["last"] = int(time.time()); users_save()
            ck = "ob_s=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d" % (tok, SESS_DAYS * 86400) + ("; Secure" if self.headers.get("X-Forwarded-Proto", "") == "https" else "")
            return self._send(200, json.dumps({"ok": True, "token": tok, "role": u["role"], "name": u.get("name", ""), "user": u["u"], "emp": u.get("emp", ""), "etoken": emp_token(u.get("emp", "")), "pages": sorted(ROLE_PAGES[u["role"]]), "land": LAND[u["role"]]}).encode(), "application/json", {"Set-Cookie": ck})
        if p == "/hs/acct" and self.pin_login:
            if not self.role: return self._json({"ok": False, "msg": "Belum masuk"}, 403)
            raw = self._body(4000)
            try: b = json.loads(raw); assert isinstance(b, dict)
            except Exception: return self._json({"ok": False, "msg": "Data salah"}, 400)
            return self._acct(b)
        if self.pin_login and self.role and not self._staff_gate(p): return self._send(404, b"404", "text/plain")
        if p == "/hs/hk" and self.pin_login:
            if not getattr(self, "sess", None): return self._json({"ok": False, "msg": "Belum masuk"}, 403)
            if not allow(ip, "hk", 120): return self._json({"ok": False, "msg": "Terlalu sering"}, 429)
            raw = self._body(2000)
            try: b = json.loads(raw); assert isinstance(b, dict)
            except Exception: return self._json({"ok": False, "msg": "Data salah"}, 400)
            return self._json(hk_api(b, self.sess, self.local))
        if p == "/hs/file":
            fid = (q.get("id") or [""])[0]
            if not (FID_G if self.guest else FID_S).fullmatch(fid): return self._json({"ok": False}, 400)
            if self.guest and not allow(ip, "fput", 12): return self._json({"ok": False, "msg": "terlalu sering"}, 429)
            raw = self._body(FILE_MAX if self.guest else 9_000_000)
            if raw is None: return self._json({"ok": False}, 413)
            f = os.path.join(FILES, fid)
            if self.guest and os.path.exists(f): return self._json({"ok": False}, 409)   # tamu tidak boleh menimpa file
            if self.guest and sum(os.path.getsize(os.path.join(FILES, x)) for x in os.listdir(FILES)) > FILES_TOTAL_MAX: return self._json({"ok": False, "msg": "penyimpanan penuh"}, 507)
            open(f, "wb").write(raw); open(f + ".t", "w").write(re.sub(r"[^\w/.+-]", "", self.headers.get("Content-Type", ""))[:60])
            return self._json({"ok": True})
        if p == "/hs/hubbeat":   # detak halaman resepsionis yang terbuka (h=1: detak hub tersembunyi; bye=1: halaman ditutup)
            if self.guest or self.role not in ("owner", "resepsionis"): return self._json({"ok": False}, 403)
            now = time.time()
            if (q.get("h") or [""])[0] == "1": hub["hseen"] = now
            elif (q.get("bye") or [""])[0] == "1": hub["seen"] = min(hub["seen"], now - HUBG() + 6)   # beri 6 detik: mungkin hanya dimuat ulang
            else: hub["seen"] = now
            return self._json({"ok": True})
        if p in ("/hs/pushsub", "/hs/pushq", "/hs/pushevt"):
            if not allow(ip, "push", 120): return self._json({"ok": False}, 429)
            try: b = json.loads(self._body(6000) or b"{}"); assert isinstance(b, dict)
            except Exception: return self._json({"ok": False}, 400)
            if p == "/hs/pushsub":
                sub = b.get("sub") or {}; ep = str(sub.get("endpoint", ""))
                if not ep.startswith("https://") or len(ep) > 700: return self._json({"ok": False}, 400)
                if self.guest and len(psubs) > 5000: return self._json({"ok": False}, 429)
                sid = _sid(ep); rec = {"ep": ep, "t": int(time.time())}
                if self.role in ROLES: rec.update(role=self.role, emp=(self.sess or {}).get("emp", "") if self.sess else "", icid=str(b.get("icid") or "")[:40])
                else:
                    rec["cid"] = str(b.get("cid") or "")[:40]
                    aid_, atok_ = str(b.get("aid") or "")[:20], str(b.get("atok") or "")[:60]
                    if aid_ and atok_:   # akun aplikasi yang sudah masuk: notifikasi chat & panggilan sampai walau aplikasi ditutup
                        a_ = next((x for x in kvj("hs_accts", []) if isinstance(x, dict) and x.get("id") == aid_), None)
                        if a_ and not a_.get("bl") and a_.get("st") == "ok" and _hash(atok_) in (ga_sec.get(aid_, {}).get("ths") or []): rec["aid"] = aid_
                with lock: psubs[sid] = rec
                push_save(); return self._json({"ok": True})
            if p == "/hs/pushq":
                sid = _sid(str(b.get("ep", "")))
                with lock: items = [x for x in ppend.pop(sid, []) if time.time() - x["ts"] < 600]
                return self._json({"items": items})
            if self.guest or self.role not in ("owner", "resepsionis"): return self._json({"ok": False}, 403)   # pushevt: hanya hub resepsionis
            push_staff(str(b.get("t", "ONE BLISS"))[:80], str(b.get("m", ""))[:200], str(b.get("k", "ob"))[:20], b.get("k") in ("sos", "call")); return self._json({"ok": True})
        if p == "/hs/send":
            if self.guest and not allow(ip, "send", 300): return self._json({"ok": False, "msg": "terlalu sering"}, 429)
            raw = self._body(8_000_000 if not self.guest else 600000)
            if raw is None: return self._json({"ok": False}, 413)
            try: b = json.loads(raw)
            except Exception: return self._json({"ok": False}, 400)
            if not isinstance(b, dict): return self._json({"ok": False}, 400)
            d, cid = b.get("d"), str(b.get("c", ""))[:40]
            if self.role == "hk" and not self.local and (not isinstance(d, dict) or str(d.get("type", "")).startswith("own_")): return self._json({"ok": False}, 403)
            if isinstance(d, dict):
                d.pop("_s", None); d.pop("_r", None)   # tanda staf hanya boleh dipasang server
                if d.get("type") == "hk_evt": return self._json({"ok": False}, 403)   # peristiwa Housekeeping hanya boleh dari server
                if d.get("type") == "acct" and not self.guest: d["_s"] = 1; d["_r"] = self.role or ""
                if d.get("type") == "ic2" and str(d.get("tid", "")).startswith("U:") and (self.guest or self.role not in ("owner", "resepsionis") or not ic_u_staff(d)): return self._json({"ok": False}, 403)
            if self.guest:
                if b.get("n") != CHANNEL or not isinstance(d, dict) or d.get("type") not in GUEST_SEND: return self._json({"ok": False}, 403)
                if len(raw) > SEND_LIMIT.get(d["type"], SEND_DEFAULT): return self._json({"ok": False}, 413)
                if d["type"] == "visit" and (not VID_RE.fullmatch(str(d.get("vid", ""))) or not allow(ip, "visit", 40)): return self._json({"ok": False, "msg": "terlalu sering"}, 429)
                if d["type"] == "acct" and (not VID_RE.fullmatch(str(d.get("vid", ""))) or not allow(ip, "acct", 300)): return self._json({"ok": False, "msg": "terlalu sering"}, 429)
                learn(client(cid), d)
                if d["type"] == "cmd" and d.get("cmd") == "door": br.door(str(d.get("room", "")), str(d.get("token", "")), None if self.client_address[0] in ("127.0.0.1", "::1") else self.client_address[0])
            if isinstance(d, dict) and d.get("type") == "acct":   # akun & obrolan: server yang menjawab (tidak butuh halaman resepsionis)
                vid, q_ = str(d.get("vid", "")), str(d.get("q", ""))[:20]
                if not VID_RE.fullmatch(vid): return self._json({"ok": False}, 400)
                try: reps = acct_op(d, "" if self.guest else (self.role or ""), ip)
                except Exception as e: print("galat akun:", e); reps = [{"k": "err", "why": "Terjadi kesalahan di server. Coba lagi."}]
                if self.guest:
                    with lock:
                        cu = client(cid)["uids"]
                        for r in reps:
                            if r.get("k") in ("me", "ok") and r.get("acct") and r.get("ok", 1) and len(cu) < 6: cu.setdefault(str(r["acct"]["id"]), mid[0])
                for r in reps: publish(dict(r, type="acct_r", vid=vid, q=q_))
                return self._json({"ok": True})
            with cv:
                mid[0] += 1; msgs.append({"id": mid[0], "n": str(b.get("n", ""))[:40], "c": cid, "d": d}); del msgs[:-1000]; cv.notify_all(); _i = mid[0]
            try: push_scan(d, _i, bool(self.guest))
            except Exception as e: print(" [PUSH] galat:", e)
            return self._json({"ok": True})
        if p == "/hs/kv" and not self.guest:
            if not self._key_ok() or self.role == "hk": return self._json({"ok": False}, 403)
            raw = self._body(8_000_000)
            try: b = json.loads(raw); k, d = str(b.get("k", "")), b.get("d")
            except Exception: return self._json({"ok": False}, 400)
            if not re.fullmatch(r"hs_\w{1,40}", k) or k in ("hs_stay", "hs_pend", "hs_accts", "hs_comm", "hs_acfg", "hs_dm") or not (d is None or isinstance(d, str)): return self._json({"ok": False}, 400)
            with lock: ver[0] += 1; kv[k] = {"v": ver[0], "d": d}; dirty[0] = True
            if k == "hs_rooms": threading.Timer(1.0, br.on_rooms_changed).start()
            return self._json({"ok": True})
        self._send(404, b"404", "text/plain")

class HG(H): guest = True
class HP(HG): pin_login = True   # port tamu publik (Funnel): tamu bebas, staf wajib PIN
class HS(HP): trust_local = True   # port staf 8088: komputer server tanpa kode; perangkat lain (LAN/Tailscale) wajib login PIN
class Srv(ThreadingHTTPServer):
    daemon_threads = True; request_queue_size = 64
    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)): return   # klien menutup tab / sinyal putus: normal
        super().handle_error(request, client_address)

# ---------- NOTIFIKASI PUSH (muncul & berbunyi walau layar terkunci / aplikasi ditutup) ----------
# Web Push tanpa isi pesan (hanya pustaka bawaan Python): server memanggil layanan push HP (Google/Apple/Mozilla) bertanda tangan VAPID,
# lalu service worker di HP mengambil isi pemberitahuannya dari /hs/pushq dan menampilkannya.
_P, _N = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff, 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551
_B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b
_G = (0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296, 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5)
def _ec_add(a, b):
    if a is None: return b
    if b is None: return a
    if a[0] == b[0]:
        if (a[1] + b[1]) % _P == 0: return None
        l = (3 * a[0] * a[0] - 3) * pow(2 * a[1], -1, _P) % _P
    else: l = (b[1] - a[1]) * pow(b[0] - a[0], -1, _P) % _P
    x = (l * l - a[0] - b[0]) % _P
    return (x, (l * (a[0] - x) - a[1]) % _P)
def _ec_mul(k, pt):
    r = None
    while k:
        if k & 1: r = _ec_add(r, pt)
        pt = _ec_add(pt, pt); k >>= 1
    return r
def _b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def _ecdsa(d, msg):
    z = int.from_bytes(hashlib.sha256(msg).digest(), "big")
    while True:
        k = secrets.randbelow(_N - 1) + 1; r = _ec_mul(k, _G)[0] % _N
        if not r: continue
        sg = pow(k, -1, _N) * (z + r * d) % _N
        if sg: return r.to_bytes(32, "big") + sg.to_bytes(32, "big")
VAPID_FILE, PUSH_FILE = os.path.join(DATA, "vapid.json"), os.path.join(DATA, "push.json")
try: _v = json.load(open(VAPID_FILE))
except Exception:
    _d = secrets.randbelow(_N - 1) + 1; _q = _ec_mul(_d, _G)
    _v = {"d": _d, "pub": _b64(b"\x04" + _q[0].to_bytes(32, "big") + _q[1].to_bytes(32, "big"))}
    json.dump(_v, open(VAPID_FILE, "w"))
VAPID_D, VAPID_PUB = int(_v["d"]), _v["pub"]
try: psubs = json.load(open(PUSH_FILE)).get("subs", {})
except Exception: psubs = {}
ppend = {}; pjobs = queue.Queue(); _jwt = {}
def push_save():
    try: _aw(PUSH_FILE, json.dumps({"subs": dict(psubs)}))
    except Exception as e: print("gagal simpan push:", e)
def _sid(ep): return hashlib.sha256(ep.encode()).hexdigest()[:24]
def vapid_hdr(ep):
    u = urllib.parse.urlparse(ep); aud = "%s://%s" % (u.scheme, u.netloc); c = _jwt.get(aud)
    if not c or c[1] < time.time():
        sub = cfg["public_url"] if str(cfg.get("public_url", "")).startswith("https://") else "mailto:admin@onebliss.example"
        h = _b64(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode()) + "." + _b64(json.dumps({"aud": aud, "exp": int(time.time()) + 43200, "sub": sub}, separators=(",", ":")).encode())
        c = _jwt[aud] = (h + "." + _b64(_ecdsa(VAPID_D, h.encode())), time.time() + 21600)
    return "vapid t=%s, k=%s" % (c[0], VAPID_PUB)
def push_to(sids, title, body, kind="ob", call=False, url="/"):
    """Antrekan pemberitahuan ke daftar langganan (id)."""
    for sid in sids:
        if sid not in psubs: continue
        with lock:
            q = ppend.setdefault(sid, []); q.append({"t": title, "b": str(body)[:200], "k": kind, "call": bool(call), "u": url, "ts": time.time()}); del q[:-20]
        pjobs.put((sid, call))
def push_worker():
    while True:
        sid, call = pjobs.get()
        s = psubs.get(sid)
        if not s: continue
        try:
            rq = urllib.request.Request(s["ep"], data=b"", method="POST", headers={"Authorization": vapid_hdr(s["ep"]), "TTL": "90" if call else "3600", "Urgency": "high", "Content-Length": "0"})
            urllib.request.urlopen(rq, timeout=12).read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 410): psubs.pop(sid, None); push_save()
            else: print(" [PUSH] ditolak %s: %s" % (e.code, e.reason))
        except Exception as e: print(" [PUSH] gagal kirim:", e)
def push_staff(title, body, kind="ob", call=False, roles=("owner", "resepsionis"), icid=None):
    ids = [k for k, v in psubs.items() if v.get("role") in roles and (icid is None or v.get("icid") == icid)]
    push_to(ids, title, body, kind, call, "/"); return len(ids)
def push_acct(aid, title, body, kind="ob", call=False):
    """Push ke semua perangkat akun aplikasi (tamu/pengunjung) yang sudah masuk, walau aplikasinya ditutup."""
    ids = [k for k, v in list(psubs.items()) if v.get("aid") == aid]
    push_to(ids, title, body, kind, call, "/"); return len(ids)
def push_presence():
    """Akun yang punya langganan push dianggap 'bisa dihubungi' (seperti WhatsApp): satu pesan ringkas tiap 25 dtk ke staf."""
    while True:
        time.sleep(25)
        try:
            ids = {v["aid"] for v in list(psubs.values()) if v.get("aid")}
            if not ids: continue
            nm = {x.get("id"): x for x in kvj("hs_accts", []) if isinstance(x, dict)}
            lst = [{"id": i, "fn": _short(nm[i].get("name"))} for i in ids if i in nm and nm[i].get("st") == "ok" and not nm[i].get("bl")]
            if lst: publish({"type": "ic2", "k": "herep", "list": lst[:300]})
        except Exception as e: print(" [PUSH] presence:", e)
threading.Thread(target=push_presence, daemon=True).start()
def push_scan(d, i, from_guest):
    """Periksa pesan yang baru lewat; kirim push ke penerimanya (tamu disaring dengan aturan yang sama seperti polling)."""
    if not isinstance(d, dict): return
    t, k = d.get("type"), d.get("k")
    if t == "ic2" and k == "offer":
        who = str(d.get("fn") or "").strip() or "Seseorang"; title = "📞 Panggilan suara masuk"
        if d.get("to") is None and d.get("tid") is not None:
            if push_staff(title, who, "ic2", True, ("owner", "resepsionis", "hk"), icid=str(d.get("tid"))): return
    elif t == "visit_r" and k == "msg": title, who = "💬 Resepsionis ONE BLISS", str(d.get("m") or "Pesan baru")
    elif t == "wakeup": title, who = "⏰ Wake-up call", "Waktunya bangun"
    elif t == "reg_approved": title, who = "✅ Reservasi disetujui", "PIN & QR kamar sudah dikirim"
    elif t == "checkout": title, who = "ONE BLISS", "Check-out kamar Anda diproses"
    else: return
    call = t == "ic2"
    ids = []
    for sid, v in list(psubs.items()):
        if not v.get("cid"): continue
        with lock: c = clients.get(v["cid"])
        if c and guest_sees(c, d, i): ids.append(sid)
    if ids: push_to(ids, title, who, "ic2" if call else (t if t != "visit_r" else "visit"), call)
    elif call and from_guest and not d.get("to"): push_staff(title, who, "ic2", True)
for _ in range(2): threading.Thread(target=push_worker, daemon=True).start()

# ---------- HUB TERSEMBUNYI ----------
# Hub (penerima pendaftaran, login, perintah owner, dst.) adalah halaman resepsionis. Kalau tidak ada halaman resepsionis yang terbuka,
# server menjalankan halaman yang sama di Edge/Chrome tanpa jendela (headless). Begitu halaman resepsionis dibuka, hub tersembunyi berhenti.
HUBC = cfg["hub"]
hub = {"seen": 0.0, "hseen": 0.0, "proc": None, "next": 0.0, "warned": False}
HUB_PID = os.path.join(DATA, "hub.pid")
def HUBG():
    try: return max(8.0, float(HUBC.get("grace") or 15))
    except Exception: return 15.0
def _kill_tree(pid, p=None):
    try:
        if os.name == "nt": subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=15)
        elif p: p.terminate()
        else: os.kill(int(pid), 15)
    except Exception: pass
def hub_browser():
    c = str(HUBC.get("browser") or "").strip()
    if c and os.path.isfile(c): return c
    for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LocalAppData")):
        for rel in ("Microsoft\\Edge\\Application\\msedge.exe", "Google\\Chrome\\Application\\chrome.exe"):
            if base and os.path.isfile(os.path.join(base, rel)): return os.path.join(base, rel)
    for n in ("msedge", "microsoft-edge", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        f = shutil.which(n)
        if f: return f
    return ""
def hub_stop():
    p = hub["proc"]; hub["proc"] = None
    if not p: return
    _kill_tree(p.pid, p)
    try: p.wait(timeout=5)
    except Exception:
        try: p.kill()
        except Exception: pass
    try: os.remove(HUB_PID)
    except OSError: pass
def hub_start():
    exe = hub_browser()
    if not exe:
        if not hub["warned"]: hub["warned"] = True; print(" [HUB] Edge/Chrome tidak ditemukan, hub tersembunyi tidak jalan. Isi hub.browser (alamat msedge.exe / chrome.exe) di data\\config.json")
        return
    prof = os.path.join(DATA, "hub_profile"); shutil.rmtree(prof, ignore_errors=True)   # profil baru tiap jalan: data murni dari server
    url = "http://127.0.0.1:%d/resepsionis-lama3.html?hub=1" % int(cfg["staff_port"])
    cmd = [exe, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--user-data-dir=" + prof,
           "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
           "--autoplay-policy=no-user-gesture-required", "--window-size=1280,800"] + [str(a) for a in (HUBC.get("args") or [])] + [url]
    try: hl = open(os.path.join(DATA, "hub.log"), "w"); hl.write("python %s | %s\n%s\n\n" % (sys.version.split()[0], sys.executable, " ".join(cmd))); hl.flush()   # keluaran Edge/Chrome disimpan agar kegagalan hub terlihat
    except OSError: hl = subprocess.DEVNULL
    kw = {"stdin": subprocess.DEVNULL, "stdout": hl, "stderr": hl, "cwd": BASE}
    if os.name == "nt": kw["creationflags"] = 0x08000000   # tanpa jendela konsol
    hub["proc"] = subprocess.Popen(cmd, **kw); hub["hseen"] = time.time()
    try: open(HUB_PID, "w").write(str(hub["proc"].pid))
    except OSError: pass
    print(" [HUB] Resepsionis tersembunyi berjalan memakai %s (halaman resepsionis tidak perlu dibuka)." % os.path.basename(exe))
def hub_loop():
    try: _kill_tree(int(open(HUB_PID).read().strip()))   # sisa hub dari server yang mati mendadak
    except Exception: pass
    while True:
        time.sleep(1)
        try:
            p = hub["proc"]
            if not HUBC.get("enabled"):
                if p: hub_stop()
                continue
            now = time.time()
            if now - hub["seen"] < HUBG():
                if p: hub_stop(); print(" [HUB] Halaman resepsionis terbuka: hub tersembunyi berhenti.")
                continue
            if p and (p.poll() is not None or now - hub["hseen"] > 45): rc = p.poll(); hub_stop(); hub["next"] = now + 5; print(" [HUB] Hub tersembunyi mati/macet (kode keluar %s), dijalankan ulang. Rincian: %s" % (rc, os.path.join(DATA, "hub.log")))
            elif not p and now >= hub["next"]: hub_start(); hub["next"] = time.time() + 5
        except Exception as e: print(" [HUB] galat:", e); hub["next"] = time.time() + 30
atexit.register(hub_stop)

def main():
    threading.Thread(target=saver, daemon=True).start(); threading.Thread(target=br.loop, daemon=True).start()
    threading.Thread(target=hub_loop, daemon=True).start()
    gs = Srv(("127.0.0.1", int(cfg["guest_port"])), HP); threading.Thread(target=gs.serve_forever, daemon=True).start()
    threading.Thread(target=br.wifi_loop, daemon=True).start()
    if int(cfg.get("lan_guest_port") or 0):
        try: ls = Srv(("0.0.0.0", int(cfg["lan_guest_port"])), HG); threading.Thread(target=ls.serve_forever, daemon=True).start()
        except OSError as e: print(" Gagal membuka port tamu WiFi hotel %s: %s" % (cfg["lan_guest_port"], e)); cfg["lan_guest_port"] = 0; cfg["lan_url"] = ""
    ss = Srv(("0.0.0.0", int(cfg["staff_port"])), HS)
    print("=" * 62); print(" ONE BLISS server hotel jalan"); print("=" * 62)
    print(" PANEL STAF (komputer ini): http://localhost:%d  -> halaman resepsionis TIDAK wajib terbuka (hub tersembunyi otomatis)" % cfg["staff_port"])
    print(" PORT TAMU (untuk Funnel): http://127.0.0.1:%d   -> tailscale funnel --bg %d" % (cfg["guest_port"], cfg["guest_port"]))
    if cfg.get("lan_guest_port"): print(" Alamat tamu WiFi hotel  : %s   (QR pintu mengarah ke sini; deteksi HP via WiFi)" % cfg["lan_url"])
    print(" Alamat tamu publik      : %s" % (cfg["public_url"] or "(belum diisi: jalankan lagi dengan --public https://NAMA-PC.xxxx.ts.net)"))
    print(" ESP32 kamar            : %s | monitor: http://localhost:%d/esp" % ("AKTIF (IP: %s)" % cfg["esp"]["ip_template"] if cfg["esp"]["enabled"] else "mati", cfg["staff_port"]))
    print(" STAF ONLINE (Funnel)   : %s/login   (SATU aplikasi untuk tamu, Owner, Resepsionis, Karyawan: Masuk dengan akun)" % cfg["public_url"])
    print(" FOLDER DATA           : %s   (akun & pengaturan; JANGAN dihapus, aman saat folder program diganti)" % DATA)
    if BOOT: print(" SANDI OWNER AWAL       : username  owner   kata sandi  %s   (tetap sama tiap start; juga di data\\SANDI_OWNER_AWAL.txt. Ganti di Owner > Akun Staf, setelah itu berkas & tampilan ini hilang)" % BOOT)
    else: print(" Akun staf              : dikelola owner di aplikasi Owner > Akun Staf (lupa kata sandi owner: python server.py --reset-owner)")
    print("=" * 62)
    try: ss.serve_forever()
    except KeyboardInterrupt: pass
    finally: hub_stop()

if __name__ == "__main__": main()
