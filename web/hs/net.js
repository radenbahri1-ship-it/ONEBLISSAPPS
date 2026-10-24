/* ONE BLISS - jembatan jaringan untuk halaman /hotel: BroadcastChannel + localStorage hs_* disinkronkan lewat server hotel. */
(function () {
  var GUEST = /[?&]g=1/.test((document.currentScript || {}).src || ""), CID = Math.random().toString(36).slice(2) + Date.now().toString(36); window.HS_CID = CID;
  var LS = localStorage, SET = Storage.prototype.setItem, REM = Storage.prototype.removeItem, ver = 0, KEY = "";
  var shared = function (k) { return /^hs_\w{1,40}$/.test(k) && k !== "hs_stay" && k !== "hs_pend" };
  var PIN = false; try { PIN = LS.getItem("hs_pin_mode") === "1" } catch (e) {}
  function toLogin() { try { REM.call(LS, "hs_key_dev") } catch (e) {} location.href = "/login?next=" + encodeURIComponent(location.pathname) }
  if (!GUEST) { try { KEY = LS.getItem("hs_key_dev") || "" } catch (e) {} if (!KEY && PIN) { toLogin() } }
  if (!GUEST) { try { var xc = new XMLHttpRequest(); xc.open("GET", "/hs/cfg", false); xc.send(); var cj = JSON.parse(xc.responseText); window.HS_PUBLIC = (cj.public || ""); window.HS_ICE = (cj.ice || []) } catch (e) {} }
  var H = function () { return KEY ? { "X-HS": KEY } : {} };
  function xhr(u) { var x = new XMLHttpRequest(); x.open("GET", u, false); if (KEY) x.setRequestHeader("X-HS", KEY); try { x.send() } catch (e) { return null } if (x.status === 403) { toLogin(); return null } return x.status === 200 ? x.responseText : null }
  function apply(t) { var r; try { r = JSON.parse(t) } catch (e) { return } ver = r.v || ver; for (var k in r.kv) { if (r.kv[k] === null) REM.call(LS, k); else SET.call(LS, k, r.kv[k]) } }
  var q = {}, qt = 0, chain = Promise.resolve();
  function push(k, d) { q[k] = d; clearTimeout(qt); qt = setTimeout(function () { var o = q; q = {}; Object.keys(o).forEach(function (k) { chain = chain.then(function () { return fetch("/hs/kv", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H()), body: JSON.stringify({ k: k, d: o[k] }) }) }).catch(function () {}) }) }, 150) }
  if (!GUEST) {
    apply(xhr("/hs/kv?v=0"));
    if (!ver) { for (var i = 0; i < LS.length; i++) { var k = LS.key(i); if (shared(k)) push(k, LS.getItem(k)) } }   /* server masih kosong: unggah data lama browser ini */
    Storage.prototype.setItem = function (k, v) { SET.call(this, k, v); if (this === LS && shared(k)) push(k, String(v)) };
    Storage.prototype.removeItem = function (k) { REM.call(this, k); if (this === LS && shared(k)) push(k, null) };
    setInterval(function () { fetch("/hs/kv?v=" + ver, { headers: H(), cache: "no-store" }).then(function (r) { return r.text() }).then(function (t) { var r; try { r = JSON.parse(t) } catch (e) { return } if (r.kv && Object.keys(r.kv).length) apply(t); else ver = Math.max(ver, r.v || 0) }).catch(function () {}) }, 1500);
  }
  var chs = [], last = -1, run = 0, sq = Promise.resolve();
  function BC(n) { this.name = n; this._l = []; this.onmessage = null; chs.push(this); start() }
  BC.prototype = {
    postMessage: function (d) { var n = this.name; if (d && /^(own_|emp_|pong$)/.test(d.type || "")) { fetch("/hs/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n: n, c: CID, d: d }) }).catch(function () {}); return } sq = sq.then(function () { return fetch("/hs/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n: n, c: CID, d: d }) }) }).catch(function () {}) },
    addEventListener: function (t, f) { if (t === "message") this._l.push(f) },
    removeEventListener: function (t, f) { this._l = this._l.filter(function (x) { return x !== f }) },
    close: function () { var s = this; chs = chs.filter(function (x) { return x !== s }) }
  };
  function loop() { fetch("/hs/poll?since=" + last + "&c=" + CID, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("poll " + r.status); return r.json() }).then(function (r) { (r.msgs || []).forEach(function (m) { last = Math.max(last, m.id); chs.forEach(function (c) { if (c.name === m.n) { var e = { data: m.d }; if (c.onmessage) c.onmessage(e); c._l.slice().forEach(function (f) { f(e) }) } }) }); last = Math.max(last, r.last || 0); loop() }).catch(function () { setTimeout(loop, 2000) }) }
  function start() { if (run) return; run = 1; var t = null; try { var x = new XMLHttpRequest(); x.open("GET", "/hs/poll?c=" + CID, false); x.send(); t = JSON.parse(x.responseText) } catch (e) {} last = t ? t.last : 0; loop() }
  window.BroadcastChannel = BC;
})();

/* ===== Aplikasi HP (PWA): service worker, notifikasi, tombol pasang ===== */
(function () {
  var SW = null;
  try { if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/sw.js").then(function (r) { SW = r }).catch(function () {}) } catch (e) {}
  window.HS_NOTIFY = function (title, body, tag) {
    try {
      var o = { body: body, tag: tag, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", vibrate: [120, 60, 120] };
      if ("serviceWorker" in navigator && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then(function (r) { r.showNotification(title, o) }).catch(function () { try { new Notification(title, o) } catch (e) {} });
      else new Notification(title, o);
    } catch (e) {}
  };
  var standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
  var dp = null, btn = null, dlg = null;
  var ua = navigator.userAgent || "", iOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  function closeDlg() { if (dlg) { dlg.remove(); dlg = null } }
  function help() {
    closeDlg();
    var t, pub = window.HS_PUBLIC || "";
    if (!window.isSecureContext) t = "Aplikasi hanya bisa dipasang lewat alamat <b>https</b> (alamat online)." + (pub ? "<br><br>Buka: <b>" + pub.replace(/</g, "") + "</b><br>lalu tekan tombol Instal lagi." : "<br><br>Buka halaman ini lewat alamat online hotel (https://...), lalu tekan tombol Instal lagi.");
    else if (iOS) t = "Di iPhone/iPad (buka dengan <b>Safari</b>):<br>1. Ketuk tombol <b>Bagikan</b> (kotak dengan panah ke atas)<br>2. Pilih <b>Tambah ke Layar Utama</b><br>3. Ketuk <b>Tambah</b>";
    else t = "Di Chrome / Edge:<br>1. Buka menu <b>&#8942;</b> (titik tiga) di pojok browser<br>2. Pilih <b>Instal aplikasi</b> atau <b>Tambahkan ke layar utama</b><br><br>Kalau pilihan itu tidak ada, mungkin aplikasi sudah terpasang di perangkat ini (buka dari menu Start / ikon aplikasi), atau muat ulang halaman sekali lalu tekan Instal lagi.";
    dlg = document.createElement("div");
    dlg.style.cssText = "position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.6);display:grid;place-items:center;padding:18px";
    dlg.innerHTML = '<div style="max-width:360px;width:100%;background:#14110e;border:1px solid #b69a6b;border-radius:16px;padding:20px;color:#fff;font:15px/1.5 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.6)"><div style="display:flex;gap:10px;align-items:center;margin-bottom:12px"><img src="/icons/icon-192.png" width="40" height="40" style="border-radius:10px"><b style="font-size:17px">Pasang aplikasi One Bliss</b></div><div>' + t + '</div><button style="margin-top:16px;width:100%;border:0;border-radius:10px;padding:12px;background:#b69a6b;color:#0a0a0a;font-weight:700">Mengerti</button></div>';
    dlg.onclick = function (e) { if (e.target === dlg || e.target.tagName === "BUTTON") closeDlg() };
    document.body.appendChild(dlg);
  }
  function click() {
    if (dp) { var e = dp; dp = null; try { e.prompt(); e.userChoice && e.userChoice.then(function (r) { if (r.outcome === "accepted") { standalone = true; drop() } }) } catch (x) { help() } return }
    if (btn) { btn.style.opacity = ".6"; btn.style.pointerEvents = "none" }   /* kejadian pemasangan kadang datang terlambat: tunggu sebentar sebelum menampilkan petunjuk manual */
    var n = 0, rel = function () { if (btn) { btn.style.opacity = ""; btn.style.pointerEvents = "" } };
    var t = setInterval(function () {
      n++;
      if (dp) { clearInterval(t); rel(); click() }
      else if (n >= 27) {                              // ~4 dtk tanpa sinyal 'siap dipasang' dari browser
        clearInterval(t); rel();
        /* Chrome/Edge kadang baru memberi sinyal pemasangan setelah halaman dimuat ulang (mis. sinyal sudah terpakai/dibatalkan). Muat ulang otomatis sekali (maks. 1x / 10 mnt), lalu tombol langsung memasang. */
        var last = 0; try { last = +(localStorage.getItem("hs_inst_try") || 0) } catch (x) {}
        if (!iOS && window.isSecureContext && Date.now() - last > 600000) { try { localStorage.setItem("hs_inst_try", String(Date.now())) } catch (x) {} if (btn) btn.textContent = "Menyiapkan…"; setTimeout(function () { location.reload() }, 250) }
        else help();
      }
    }, 150);
  }
  function make() {
    if (standalone || btn || !document.body) return;
    btn = document.createElement("button");
    btn.type = "button"; btn.id = "hsInstallBtn"; btn.setAttribute("aria-label", "Instal aplikasi");
    btn.style.cssText = "position:fixed;right:14px;bottom:max(14px,env(safe-area-inset-bottom));z-index:2147482000;display:flex;gap:7px;align-items:center;border:1px solid #b69a6b;border-radius:999px;padding:10px 15px;background:#14110e;color:#e6cf9f;font:600 13px system-ui,sans-serif;letter-spacing:.02em;box-shadow:0 6px 22px rgba(0,0,0,.55);cursor:pointer";
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>Instal Aplikasi';
    btn.onclick = click;
    try { if (Date.now() - (+(localStorage.getItem("hs_inst_try") || 0)) < 30000) btn.style.boxShadow = "0 0 0 4px #e2ae2f88,0 6px 22px rgba(0,0,0,.55)" } catch (e) {}
    document.body.appendChild(btn);
  }
  function drop() { if (btn) { btn.remove(); btn = null } closeDlg() }
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); dp = e });
  window.addEventListener("appinstalled", function () { standalone = true; dp = null; drop() });
  window.HS_INSTALL = click;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", make); else make();
})();

/* ===== Tombol "Perbarui": muncul bila server punya versi aplikasi yang lebih baru dari yang sedang terbuka ===== */
(function () {
  var shown = 0, mine = window.OB_BUILD || "";
  function upd() {
    var p = [];
    try { if (navigator.serviceWorker) p.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister() })) })) } catch (e) {}
    try { if (window.caches) p.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k) })) })) } catch (e) {}
    Promise.all(p).then(function () { location.reload() }, function () { location.reload() });
  }
  function bar() {
    if (!document.body) return setTimeout(bar, 500);
    var d = document.createElement("div");
    d.style.cssText = "position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);max-width:420px;margin:auto;z-index:2147483000;background:#14110e;border:1px solid #e2ae2f;border-radius:14px;padding:12px 14px;display:flex;gap:10px;align-items:center;color:#fff;font:14px system-ui,sans-serif;box-shadow:0 8px 30px #000b";
    d.innerHTML = "<div style='flex:1'><b>Versi baru tersedia</b><div style='color:#a9a193;font-size:12px'>Perbarui agar fitur terbaru berfungsi.</div></div><button id='obUpd' style='border:0;border-radius:10px;padding:10px 14px;background:#e2ae2f;color:#0a0a0a;font:700 14px system-ui;cursor:pointer'>Perbarui</button><button id='obUpdX' aria-label='Nanti' style='border:0;background:none;color:#a9a193;font-size:20px;cursor:pointer'>×</button>";
    document.body.appendChild(d);
    d.querySelector("#obUpd").onclick = function () { this.textContent = "Memperbarui…"; upd() };
    d.querySelector("#obUpdX").onclick = function () { d.remove() };
  }
  function chk() {
    if (shown || !mine) return;
    fetch("/hs/ver", { cache: "no-store" }).then(function (r) { return r.json() }).then(function (j) { if (j && j.v && j.v !== mine && !shown) { shown = 1; bar() } }).catch(function () {});
  }
  setTimeout(chk, 4000); setInterval(chk, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) chk() });
})();


/* ===== Detak hub resepsionis: server tahu ada halaman resepsionis terbuka; kalau tidak ada, server menjalankan hub tersembunyi ===== */
(function () {
  if (/[?&]g=1/.test((document.currentScript || {}).src || "") || !/resepsionis/.test(location.pathname)) return;
  var HUB = /[?&]hub=1/.test(location.search), u = "/hs/hubbeat" + (HUB ? "?h=1" : ""), KEY = "";
  try { KEY = localStorage.getItem("hs_key_dev") || "" } catch (e) {}
  function beat() { try { fetch(u, { method: "POST", headers: KEY ? { "X-HS": KEY } : {}, cache: "no-store", keepalive: true }).catch(function () {}) } catch (e) {} }
  beat();
  try { var w = new Worker(URL.createObjectURL(new Blob(["setInterval(function(){postMessage(1)},4000)"]))); w.onmessage = beat } catch (e) { setInterval(beat, 4000) }   /* Worker: tidak diperlambat saat tab di latar belakang */
  if (!HUB) addEventListener("pagehide", function () { try { navigator.sendBeacon("/hs/hubbeat?bye=1") } catch (e) {} });
})();


/* ===== Notifikasi push: tetap muncul & berbunyi saat layar terkunci / aplikasi ditutup (butuh https; di iPhone: aplikasi harus dipasang ke Layar Utama) ===== */
(function () {
  if (/[?&]hub=1/.test(location.search) || !window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !window.Notification) return;
  function key(s) { var p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a }
  var busy = 0;
  function acc() { try { var a = JSON.parse(localStorage.getItem("ob_acc") || "null"); return a && a.id && a.tok ? a : {} } catch (e) { return {} } }
  window.HS_PUSH = function () { setTimeout(sub, 300) };
  function sub() {
    if (busy || Notification.permission !== "granted") return; busy = 1;
    navigator.serviceWorker.ready.then(function (reg) {
      return fetch("/hs/pushkey").then(function (r) { return r.json() }).then(function (k) {
        return reg.pushManager.getSubscription().then(function (s) {
          if (s && s.options && s.options.applicationServerKey && btoa(String.fromCharCode.apply(null, new Uint8Array(s.options.applicationServerKey))) !== btoa(String.fromCharCode.apply(null, key(k.key)))) return s.unsubscribe().then(function () { return null });
          return s;
        }).then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(k.key) }) });
      }).then(function (s) { return fetch("/hs/pushsub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sub: s.toJSON(), cid: window.HS_CID || "", icid: window.HS_ICID || "", aid: acc().id, atok: acc().tok }) }) });
    }).catch(function () {}).then(function () { busy = 0 });
  }
  function ask() { try { if (Notification.permission === "default") Notification.requestPermission().then(sub); else sub() } catch (e) {} }
  ["pointerdown", "keydown"].forEach(function (e) { addEventListener(e, ask, { once: true }) });
  sub(); setInterval(sub, 45000);   /* daftar ulang berkala: alamat/ID perangkat bisa berubah setelah login */
})();
