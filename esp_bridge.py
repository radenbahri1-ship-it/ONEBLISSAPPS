"""Jembatan server -> ESP32-C3 kamar (firmware v5.88: /pass_set /pass_door /pass_status /pass_clear /pass_portal).
Sumber kebenaran = data kamar dari halaman resepsionis (hs_rooms di server): tamu check-in + PIN 6 digit -> pass di ESP;
check-out -> pass dicabut; tamu menekan 'buka pintu' -> /pass_door (relay ON, scan BLE tamu ON)."""
import base64, datetime, ipaddress, json, os, re, subprocess, threading, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

DEFAULTS = {"enabled": True, "user": "admin", "password": "12345678", "ip_template": "192.168.1.{no}", "rooms": {},
            "mode": 1, "hold": 5, "grace_min": 120, "poll_busy": 8, "poll_idle": 60, "timeout": 4,
            "wifi_grace": 120, "ping_every": 6, "dev_password": "", "driver": "auto", "relock_s": 5, "lock_relay": 0, "hk_minutes": 90, "hk_lamp_cmd": "", "hk_lamp_off_cmd": ""}

class Bridge:
    def __init__(self, cfg, kv, lock, publish, data_dir):
        self.cfg = cfg; self.kv = kv; self.lock = lock; self.publish = publish
        self.c = dict(DEFAULTS); self.c.update(cfg.get("esp") or {})
        self.sf = os.path.join(data_dir, "esp_state.json"); self.state = {}
        try: self.state = json.load(open(self.sf, encoding="utf-8"))
        except Exception: pass
        self.driver = {}; self.klr = {}; self.gips = {}; self.cfgd = set(); self.live = {}; self.sig = {}; self.due = {}; self.door_t = {}; self.logs = []; self.pool = ThreadPoolExecutor(6); self.busy = set()

    # ---- util ----
    def log(self, room, ok, msg):
        e = {"t": int(time.time()), "room": room, "ok": ok, "msg": msg}
        with self.lock: self.logs.append(e); del self.logs[:-120]
        print(" [ESP] kamar %s: %s" % (room, msg))
        try: self.publish({"type": "esp_event", "room": room, "ok": ok, "msg": msg})
        except Exception: pass
    def res(self, room, ok, msg):
        try: self.publish({"type": "door_res", "to": room, "ok": ok, "msg": msg})
        except Exception: pass
    def save(self):
        try:
            with self.lock: s = json.dumps(self.state)
            _t = "%s.%d.tmp" % (self.sf, threading.get_ident()); open(_t, "w", encoding="utf-8").write(s)
            for _i in range(12):
                try: os.replace(_t, self.sf); break
                except OSError: time.sleep(0.15)
        except Exception: pass
    def ip(self, room):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,8}", room or ""): return None
        return (self.c.get("rooms") or {}).get(room) or self.c["ip_template"].replace("{no}", room)
    def call(self, room, path, params=None, post=False, auth=None):
        ip = self.ip(room)
        if not ip: return 0, "kamar tidak valid"
        u, pw = auth or (self.c["user"], self.c["password"])
        tok = base64.b64encode(("%s:%s" % (u, pw)).encode()).decode()
        data = urllib.parse.urlencode(params or {}).encode() if post else None
        url = "http://%s%s" % (ip, path)
        if not post and params: url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, data=data, headers={"Authorization": "Basic " + tok}, method="POST" if post else "GET")
        try:
            with urllib.request.urlopen(req, timeout=float(self.c["timeout"])) as r: return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e: return e.code, e.read().decode("utf-8", "replace")[:200]
        except Exception as e: return 0, str(e)[:100]
    def rooms_data(self):
        try:
            with self.lock: d = self.kv.get("hs_rooms", {}).get("d")
            r = json.loads(d) if d else {}
            return r if isinstance(r, dict) else {}
        except Exception: return {}
    def cout_time(self):
        try:
            with self.lock: d = self.kv.get("hs_cfg", {}).get("d")
            return str((json.loads(d) or {}).get("cout") or "12:00")
        except Exception: return "12:00"
    def mins_until(self, cout):
        try:
            hh, mm = self.cout_time().split(":")
            d = datetime.datetime.strptime(str(cout), "%Y-%m-%d").replace(hour=int(hh), minute=int(mm)) + datetime.timedelta(minutes=int(self.c["grace_min"]))
            m = int((d - datetime.datetime.now()).total_seconds() // 60)
        except Exception: m = 1440
        if m < 120: m = 120   # tamu yang baru daftar jangan langsung kedaluwarsa
        return min(20160, m)
    def portal(self):
        if int(self.c["mode"]) in (1, 3) and self.cfg.get("lan_url"): return self.cfg["lan_url"]   # QR pintu -> halaman tamu di WiFi hotel (IP HP asli terbaca)
        return self.cfg.get("public_url") or ""
    def push_dev(self, room):
        if not self.c.get("dev_password"): return
        c, b = self.call(room, "/pass_cfg", {"pm": int(self.c["mode"]), "wg": max(20, min(900, int(self.c["wifi_grace"])))}, post=True, auth=("developer", self.c["dev_password"]))
        self.log(room, c == 200, "setelan ESP: mode %s, toleransi WiFi %s dtk" % (self.c["mode"], self.c["wifi_grace"]) if c == 200 else "gagal setelan developer ESP (%s) - cek dev_password" % c)
    def mark(self, room, online, st=None):
        with self.lock:
            was = self.live.get(room, {}).get("online")
            self.live[room] = {"online": online, "t": int(time.time()), "st": st if st is not None else self.live.get(room, {}).get("st")}
        if was is not None and was != online: self.log(room, online, "ESP32 kembali ONLINE" if online else "ESP32 TIDAK terjangkau")
        if online and room not in self.cfgd and self.c.get("dev_password") and self.driver.get(room) != "keyless":
            self.cfgd.add(room); self.pool.submit(self.push_dev, room)

    # ---- sinkron pass ----
    # ---- firmware KEYLESS (v5.8x NimBLE, tanpa /pass_*): pakai API bawaannya /status, /action, /lrelay_* ----
    def kl_auth(self): return ("developer", self.c.get("dev_password") or "dev12345")
    def kl_status(self, room):
        c, b = self.call(room, "/status")
        if c != 200: self.mark(room, False); return None
        try: j = json.loads(b)
        except Exception: self.mark(room, False); return None
        code = str(j.get("room_status_code") or "")
        st = {"has": code not in ("", "waiting_guest"), "session": code in ("occupied", "guest_out"), "relay": bool(j.get("relay_state")), "present": code == "occupied",
              "wifiRssi": j.get("wifi_rssi"), "heap": j.get("free_heap"), "fw": "keyless", "mode": j.get("ble_scan_mode"), "room": j.get("room_status"), "expLeft": 0}
        self.mark(room, True, st); return st
    def kl_act(self, room, cmd): return self.call(room, "/action", {"cmd": cmd, "who": "web-hotel"}, auth=self.kl_auth())
    def kl_lock_relay(self, room):
        if int(self.c.get("lock_relay") or 0) > 0: return int(self.c["lock_relay"])
        if room in self.klr: return self.klr[room]
        c, b = self.call(room, "/lrelay_get", auth=self.kl_auth()); idx = 0
        try:
            j = json.loads(b)
            for i, r in enumerate(j.get("r", [])):
                if i < int(j.get("cnt", 0)) and int(r.get("fn", -1)) == 3: idx = i + 1; break
            if c == 200: self.klr[room] = idx
        except Exception: pass
        return idx
    def kl_reconcile(self, room, rm):
        stt = self.state.setdefault(room, {}); rid = str(rm.get("rid") or rm.get("token") or "")
        if rm.get("guest"):
            if stt.get("kl") == rid: return
            c, b = self.kl_act(room, "ready")
            if c == 200:
                with self.lock: stt["kl"] = rid
                self.save(); self.log(room, True, "check-in: kamar disiapkan di ESP32 (Menunggu Tamu) untuk %s" % str(rm.get("name") or "tamu")[:24])
            else: self.log(room, False, "gagal menyiapkan kamar di ESP32: %s %s" % (c, b[:80]))
        elif stt.get("kl"):
            c, b = self.kl_act(room, "checkout")
            if c == 200:
                with self.lock: stt.pop("kl", None)
                self.save(); self.log(room, True, "check-out: ESP32 diberi perintah checkout")
            else: self.log(room, False, "gagal checkout di ESP32: %s %s" % (c, b[:80]))
    def kl_door(self, room):
        r = self.kl_lock_relay(room)
        if r:
            c, b = self.call(room, "/lrelay_set", {"r": r, "state": 3}, auth=self.kl_auth())
            ok, how = c == 200, "relay kunci %d (pulsa)" % r
        else:
            c, b = self.kl_act(room, "open"); ok, how = c == 200, "relay utama (buka manual)"
            if ok: threading.Timer(max(2, int(self.c.get("relock_s") or 5)), lambda: self.kl_act(room, "close")).start()
        if ok: self.log(room, True, "tamu masuk: %s" % how); self.res(room, True, "pintu dibuka")
        else:
            why = "ESP32 menolak/tidak terjangkau (%s). Cek dev_password ESP di config.json" % c if c in (0, 401, 403) else "ESP32: %s %s" % (c, b[:60])
            self.log(room, False, "pintu gagal: " + why); self.res(room, False, why)
    def status(self, room):
        if self.c.get("driver") == "keyless" or self.driver.get(room) == "keyless": self.driver[room] = "keyless"; return self.kl_status(room)
        c, b = self.call(room, "/pass_status")
        if c == 404 and self.c.get("driver") != "pass":
            self.driver[room] = "keyless"; self.log(room, True, "firmware KEYLESS terdeteksi (tanpa /pass_*): memakai API bawaan"); return self.kl_status(room)
        if c == 200:
            try: st = json.loads(b); self.mark(room, True, st); return st
            except Exception: pass
        self.mark(room, False); return None
    def reconcile(self, room, st=None):
        rm = self.rooms_data().get(room) or {}
        st = st or self.status(room)
        if st is None: return
        if self.driver.get(room) == "keyless": return self.kl_reconcile(room, rm)
        code = str(rm.get("token", ""))
        if rm.get("guest") and re.fullmatch(r"\d{4,8}", code):
            rid = str(rm.get("rid") or ""); mins = self.mins_until(rm.get("cout"))
            stt = self.state.setdefault(room, {})
            if st.get("has") and st.get("code") == code and not stt.get("rid"): stt["rid"] = rid   # adopsi pass yang sudah ada
            same = bool(st.get("has")) and stt.get("rid") == rid
            if st.get("has") and st.get("code") == code and same and abs(int(st.get("expLeft", 0)) - mins * 60) < 1800: return
            p = {"code": code, "name": str(rm.get("name") or "tamu")[:24], "mins": mins, "hold": int(self.c["hold"]), "mode": int(self.c["mode"]), "keep": "1" if same else "0"}
            if self.portal(): p["portal"] = self.portal()
            c, b = self.call(room, "/pass_set", p, post=True)
            if c == 200:
                with self.lock: stt.update(rid=rid, code=code)
                if not same: stt.pop("key", None)
                self.save(); self.log(room, True, "pass %s untuk %s (%d mnt)" % ("diperpanjang/PIN diganti" if same else "BARU", p["name"], mins)); self.due[room] = 0
            else: self.log(room, False, "gagal membuat pass: %s %s" % (c, b[:80]))
        elif st.get("has"):
            if (self.state.get(room) or {}).get("hk", 0) > time.time(): return   # pass sementara Housekeeping masih berlaku: jangan dicabut
            c, b = self.call(room, "/pass_clear", None, post=True)
            with self.lock: self.state.pop(room, None)
            self.save(); self.log(room, c == 200, "pass DICABUT (check-out)" if c == 200 else "gagal mencabut pass: %s" % c)

    def door(self, room, token, gip=None):
        """Tamu menekan buka pintu. Dicek lagi di server: kamar berisi tamu & PIN cocok."""
        if not self.c["enabled"]: return
        rm = self.rooms_data().get(room) or {}
        if not (rm.get("guest") and str(rm.get("token", "")) == token and re.fullmatch(r"\d{4,8}", token)):
            return self.res(room, False, "data kamar belum tersinkron, tunggu beberapa detik lalu coba lagi")
        now = time.time()
        if now - self.door_t.get(room, 0) < 4: return
        self.door_t[room] = now
        if gip and int(self.c["mode"]) in (1, 3):
            try:
                if ipaddress.ip_address(gip).is_private: self.gips[room] = {"ip": gip, "t": now, "alive": None, "seen": None}
                else: gip = None
            except ValueError: gip = None
        else: gip = None
        def run():
            self.reconcile(room)   # pastikan pass sudah ada di ESP
            if self.driver.get(room) == "keyless": return self.kl_door(room)
            key = self.state.get(room, {}).get("key", "")
            pr = {"code": token, "key": key}
            if gip: pr["gip"] = gip
            c, b = self.call(room, "/pass_door", pr, post=True)
            try: j = json.loads(b)
            except Exception: j = {}
            if c == 200 and j.get("ok"):
                if j.get("key"):
                    with self.lock: self.state.setdefault(room, {})["key"] = j["key"]
                    self.save()
                self.log(room, True, "tamu masuk (HP %s): relay ON" % gip if gip else "tamu masuk (tanpa IP WiFi): relay ON selama masa tahan")
                self.res(room, True, "pintu dibuka")
            else:
                why = j.get("msg") or b[:80] or ("ESP32 kamar tidak terjangkau (%s)" % c)
                self.log(room, False, "pintu ditolak ESP: %s" % why); self.res(room, False, str(why)[:120])
        self.pool.submit(run)

    # ---- Housekeeping: masuk kamar KOSONG lewat dasbor kamar + PIN HK (tanpa QR): pintu terbuka, lampu/relay kamar menyala ----
    def kl_unlock(self, room):
        r = self.kl_lock_relay(room)
        if r:
            c, b = self.call(room, "/lrelay_set", {"r": r, "state": 3}, auth=self.kl_auth()); return c == 200, c, b
        c, b = self.kl_act(room, "open")
        if c == 200: threading.Timer(max(2, int(self.c.get("relock_s") or 5)), lambda: self.kl_act(room, "close")).start()
        return c == 200, c, b
    def hk_enter(self, room, who):
        """-> (ok, pesan). Dipanggil server SETELAH PIN HK dan status kamar (kosong) diperiksa."""
        if not self.c["enabled"]: return True, "Mode simulasi (jembatan ESP32 mati): tidak ada perangkat yang dikendalikan."
        st = self.status(room)
        if st is None: return False, "ESP32 kamar %s tidak terjangkau. Cek listrik/WiFi kamar." % room
        mins = max(10, int(self.c.get("hk_minutes") or 90)); nm = ("HK " + str(who))[:24]
        if self.driver.get(room) == "keyless":
            ok, c, b = self.kl_unlock(room)
            if not ok:
                why = "ESP32 menolak (%s). Cek dev_password ESP di config.json" % c if c in (0, 401, 403) else "ESP32: %s %s" % (c, b[:60])
                self.log(room, False, "HK %s gagal masuk: %s" % (who, why)); return False, why
            lamp = str(self.c.get("hk_lamp_cmd") or "").strip(); lamp_ok = False
            if lamp: lamp_ok = self.kl_act(room, lamp)[0] == 200
            self.log(room, True, "Housekeeping %s masuk: pintu dibuka%s" % (who, ", lampu ON" if lamp_ok else " (perintah lampu belum diatur: isi esp.hk_lamp_cmd)"))
            return True, "Pintu dibuka" + (", lampu menyala." if lamp_ok else ". (Lampu: perintah ESP untuk firmware KEYLESS belum diatur di config.)")
        import random
        code = "%06d" % random.randint(0, 999999); p = {"code": code, "name": nm, "mins": mins, "hold": int(self.c["hold"]), "mode": int(self.c["mode"]), "keep": "0"}
        if self.portal(): p["portal"] = self.portal()
        c, b = self.call(room, "/pass_set", p, post=True)
        if c != 200: self.log(room, False, "HK %s: gagal membuat pass sementara: %s %s" % (who, c, b[:80])); return False, "ESP32 menolak membuat akses sementara (%s)." % c
        with self.lock: self.state[room] = {"hk": time.time() + mins * 60, "rid": "HK"}
        self.save()
        c, b = self.call(room, "/pass_door", {"code": code, "key": ""}, post=True)
        try: j = json.loads(b)
        except Exception: j = {}
        if c == 200 and j.get("ok"):
            self.log(room, True, "Housekeeping %s masuk: pintu dibuka, relay/lampu ON (%d mnt)" % (who, mins)); return True, "Pintu dibuka, lampu menyala."
        why = j.get("msg") or b[:80] or ("tidak terjangkau (%s)" % c); self.log(room, False, "HK %s ditolak ESP: %s" % (who, why)); return False, str(why)[:120]
    def hk_leave(self, room, who):
        if not self.c["enabled"]: return True
        if self.driver.get(room) == "keyless":
            off = str(self.c.get("hk_lamp_off_cmd") or "").strip()
            if off: self.kl_act(room, off)
            self.log(room, True, "Housekeeping %s selesai" % who); return True
        c, b = self.call(room, "/pass_clear", None, post=True)
        with self.lock: self.state.pop(room, None)
        self.save(); self.log(room, c == 200, "Housekeeping %s selesai: akses sementara dicabut, lampu/relay OFF" % who if c == 200 else "HK selesai tapi gagal mencabut akses: %s" % c)
        return c == 200

    # ---- hook & loop ----
    def on_rooms_changed(self):
        if not self.c["enabled"]: return
        rd = self.rooms_data()
        for n, r in rd.items():
            if not isinstance(r, dict): continue
            s = (bool(r.get("guest")), str(r.get("token", "")), str(r.get("rid", "")), str(r.get("cout", "")), str(r.get("name", "")))
            if self.sig.get(n) != s:
                first = n not in self.sig; self.sig[n] = s
                if first and not s[0]: continue          # kamar kosong saat start: biarkan sampai poll
                if n not in self.busy: self.busy.add(n); self.pool.submit(self._job, n)
    def _job(self, n):
        try: self.reconcile(n)
        finally: self.busy.discard(n)
    def loop(self):
        time.sleep(2); self.on_rooms_changed()
        if self.cfg.get("public_url"):
            for n in list(self.rooms_data()): self.pool.submit(lambda n=n: self.call(n, "/pass_portal", {"portal": self.cfg["public_url"]}, True))
        while True:
            time.sleep(2)
            if not self.c["enabled"]: continue
            self.on_rooms_changed()
            now = time.time()
            for n, r in list(self.rooms_data().items()):
                if not isinstance(r, dict) or now < self.due.get(n, 0) or n in self.busy: continue
                self.due[n] = now + (self.c["poll_busy"] if r.get("guest") else self.c["poll_idle"])
                self.busy.add(n); self.pool.submit(self._job, n)
    @staticmethod
    def ping(ip):
        win = os.name == "nt"
        cmd = ["ping", "-n", "2", "-w", "1200", ip] if win else ["ping", "-c", "2", "-W", "1", ip]
        try: return subprocess.run(cmd, capture_output=True, timeout=8, creationflags=0x08000000 if win else 0).returncode == 0
        except Exception: return False
    def wifi_one(self, room, g):
        alive = self.ping(g["ip"]); g["alive"] = alive
        if alive:
            g["seen"] = time.time(); self.call(room, "/pass_wifi", None, post=True)   # kabari ESP: HP tamu masih di WiFi
    def wifi_loop(self):
        while True:
            time.sleep(max(3, int(self.c["ping_every"])))
            if not self.c["enabled"] or int(self.c["mode"]) not in (1, 3): continue
            rd = self.rooms_data()
            for room, g in list(self.gips.items()):
                r = rd.get(room)
                if not (isinstance(r, dict) and r.get("guest")): self.gips.pop(room, None); continue
                st = (self.live.get(room) or {}).get("st") or {}
                if st.get("session") or time.time() - g["t"] < 180: self.pool.submit(self.wifi_one, room, g)
    def snapshot(self):
        rd = self.rooms_data()
        with self.lock:
            rooms = {}
            for n, r in rd.items():
                lv = self.live.get(n, {}); st = lv.get("st") or {}
                rooms[n] = {"guest": bool(isinstance(r, dict) and r.get("guest")), "name": (r or {}).get("name", "") if isinstance(r, dict) else "", "online": lv.get("online"), "t": lv.get("t"), "ip": self.ip(n),
                            "has": st.get("has"), "session": st.get("session"), "relay": st.get("relay"), "present": st.get("present"), "expLeft": st.get("expLeft"), "mode": st.get("mode"),
                            "rssi": st.get("wifiRssi"), "wifi": (self.gips.get(n) or {}).get("alive"), "gip": (self.gips.get(n) or {}).get("ip"), "pmode": st.get("mode"), "heap": st.get("heap"), "fw": st.get("v"), "esp01": st.get("esp01"), "locked": st.get("locked")}
            return {"enabled": self.c["enabled"], "rooms": rooms, "log": list(self.logs[-40:])}
