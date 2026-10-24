#!/usr/bin/env python3
"""Pemeriksaan otomatis ONE BLISS (dipakai GitHub Actions, bisa dijalankan sendiri: python tools/cek.py).
1) sintaks Python  2) sintaks semua JavaScript (berkas .js + <script> di .html, butuh node bila ada)
3) server dijalankan di port uji dan halaman utama dicek: tamu terbuka, panel staf TIDAK terbuka lewat port tamu."""
import json, os, py_compile, re, shutil, subprocess, sys, tempfile, time, urllib.request, urllib.error
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); WEB = os.path.join(ROOT, "web"); bad = []
def fail(m): bad.append(m); print("GAGAL:", m)

for f in ("server.py", "esp_bridge.py"):
    try: py_compile.compile(os.path.join(ROOT, f), doraise=True); print("ok  sintaks", f)
    except py_compile.PyCompileError as e: fail("%s: %s" % (f, e))

node = shutil.which("node")
if node:
    tmp = tempfile.mkdtemp(); jobs = []
    for d, _, fs in os.walk(WEB):
        for n in fs:
            p = os.path.join(d, n)
            if n.endswith(".js"): jobs.append((p, p))
            elif n.endswith(".html"):
                h = open(p, encoding="utf-8").read()
                for i, sc in enumerate(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", h, re.S)):
                    t = os.path.join(tmp, "%s_%d.js" % (n, i)); open(t, "w", encoding="utf-8").write(sc); jobs.append((p + "#%d" % i, t))
    for label, f in jobs:
        r = subprocess.run([node, "--check", f], capture_output=True, text=True)
        if r.returncode: fail("JavaScript %s: %s" % (os.path.relpath(label, ROOT), r.stderr.strip().splitlines()[0:3]))
    print("ok  sintaks %d skrip JavaScript" % len(jobs))
else: print("lewati: node tidak ada, JavaScript tidak diperiksa")

for n in os.listdir(WEB):
    if n.endswith(".webmanifest"):
        try: json.load(open(os.path.join(WEB, n), encoding="utf-8"))
        except Exception as e: fail("manifest %s: %s" % (n, e))

data = tempfile.mkdtemp(); SP, GP = 18088, 18089
json.dump({"staff_port": SP, "guest_port": GP, "lan_guest_port": 0, "public_url": "https://contoh.invalid", "hub": {"enabled": False}, "esp": {"enabled": False}},
          open(os.path.join(data, "config.json"), "w"))
env = dict(os.environ, ONEBLISS_DATA=data)
srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "server.py")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
class _NoRedir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None   # jangan ikuti pengalihan: 302 ke halaman masuk = panel staf tertutup
_op = urllib.request.build_opener(_NoRedir)
def get(port, path):
    try:
        with _op.open("http://127.0.0.1:%d%s" % (port, path), timeout=5) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, b""
    except Exception: return 0, b""
try:
    for _ in range(40):
        if get(GP, "/")[0] == 200: break
        time.sleep(0.5)
    else: fail("server tidak menyala dalam 20 detik")
    cek = [(GP, "/", 200), (GP, "/tamu", 200), (GP, "/manifest-tamu.webmanifest", 200), (GP, "/sw.js", 200), (GP, "/icons/icon-192.png", 200), (GP, "/hs/ic.js", 200),
           (GP, "/hotel/owner", 302), (GP, "/owner-lama3.html", 302), (GP, "/resepsionis-lama3.html", 302), (GP, "/hs/kv?v=0", 404), (GP, "/esp", 404),
           (GP, "/.well-known/assetlinks.json", 404), (SP, "/hotel/tamu", 200)]
    for port, path, want in cek:
        got = get(port, path)[0]
        print(("ok  " if got == want else "GAGAL"), port, path, got)
        if got != want: bad.append("%d %s: harusnya %d, dapat %d" % (port, path, want, got))
    st, body = get(GP, "/tamu")
    if st == 200 and b"ONE BLISS" not in body.upper() and b"Nama Hotel" not in body: fail("halaman tamu tidak berisi isi yang diharapkan")
finally:
    srv.terminate()
    try: srv.wait(timeout=10)
    except Exception: srv.kill()
    shutil.rmtree(data, ignore_errors=True)
print("\nSELESAI:", "ada %d masalah" % len(bad) if bad else "semua lolos"); sys.exit(1 if bad else 0)
