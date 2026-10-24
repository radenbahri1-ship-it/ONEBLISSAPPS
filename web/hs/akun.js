/* ONE BLISS - AKUN TAMU & OBROLAN PENGGEMAR + MASUK TERPADU (satu aplikasi)
   Pendaftaran akun di aplikasi HANYA untuk tamu/orang lain. Akun staf & karyawan dibuat owner (Owner > Akun Staf).
   Tombol Masuk mengenali akun staf (lalu membuka halaman sesuai peran) atau akun tamu. Server yang memproses akun & obrolan.
   - Daftar / masuk akun di setiap aplikasi, supaya pemilik aplikasi ONE BLISS mudah dikenali (nama, username, No. HP).
   - Tombol "Tulis Ulasan & Curhat" + obrolan antar penggemar di beranda tamu (#cmBox), lengkap dengan balasan.
   - Server menyimpan akun (hs_accts) dan obrolan (hs_comm), menyiarkan {type:'comm'} ke semua tamu, dan membalas {type:'acct_r'} per perangkat (vid).
   Pesan tamu -> pusat: {type:'acct', vid, q, k:'hi'|'reg'|'login'|'post'|'reply'|'del'|'mod', ...}
   Kata sandi tidak pernah dikirim polos: dikirim sebagai SHA-256(username:sandi:onebliss). No. HP hanya terlihat pengelola. */
(function () {
  "use strict";
  if (window.OBACC) return;
  var SRC = (document.currentScript || {}).src || "", GUEST = /[?&]g=1/.test(SRC), CH = "hotel-sim", PATH = location.pathname;
  var APP = /resepsionis/.test(PATH) ? "resepsionis" : /owner/.test(PATH) ? "owner" : /karyawan/.test(PATH) ? "karyawan" : "tamu";
  var MOD = APP === "owner" || APP === "resepsionis";
  var APPN = { tamu: "Aplikasi Tamu", resepsionis: "Aplikasi Resepsionis", owner: "Aplikasi Owner", karyawan: "Aplikasi Karyawan" };
  var AL = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  /* ---------- util ---------- */
  var $ = function (id) { return document.getElementById(id) };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] }) };
  var T = function (x) { return String(x == null ? "" : x).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim() };
  var jp = function (k) { try { return JSON.parse(localStorage.getItem(k)) } catch (e) { return null } };
  var sv = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} };
  function rnd(n) {
    var o = "", a;
    try { a = new Uint8Array(n); crypto.getRandomValues(a); for (var i = 0; i < n; i++) o += AL[a[i] % 62]; return o } catch (e) {}
    for (var j = 0; j < n; j++) o += AL[Math.floor(Math.random() * 62)];
    return o;
  }
  function ror(x, n) { return (x >>> n) | (x << (32 - n)) }
  var K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256(str) {   /* SHA-256 murni JS: jalan juga di http (WiFi hotel) yang tidak punya crypto.subtle */
    var m = unescape(encodeURIComponent(str)), l = m.length, w = [], i, n = (((l + 8) >> 6) + 1) * 16;
    for (i = 0; i < n; i++) w[i] = 0;
    for (i = 0; i < l; i++) w[i >> 2] |= m.charCodeAt(i) << (24 - (i % 4) * 8);
    w[l >> 2] |= 0x80 << (24 - (l % 4) * 8); w[n - 1] = l * 8;
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    for (var b = 0; b < n; b += 16) {
      var x = [], a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7], j;
      for (j = 0; j < 64; j++) {
        if (j < 16) x[j] = w[b + j];
        else { var s0 = ror(x[j - 15], 7) ^ ror(x[j - 15], 18) ^ (x[j - 15] >>> 3), s1 = ror(x[j - 2], 17) ^ ror(x[j - 2], 19) ^ (x[j - 2] >>> 10); x[j] = (x[j - 16] + s0 + x[j - 7] + s1) | 0 }
        var S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K256[j] + x[j]) | 0, S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22), mj = (a & bb) ^ (a & c) ^ (bb & c), t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (v) { return ("00000000" + (v >>> 0).toString(16)).slice(-8) }).join("");
  }
  function shortName(n) { var w = T(n).split(" ").filter(Boolean); if (!w.length) return "Tamu"; return w[0].slice(0, 14) + (w[1] ? " " + w[1][0].toUpperCase() + "." : "") }
  function ago(t) {
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "baru saja"; if (s < 3600) return Math.floor(s / 60) + " mnt lalu"; if (s < 86400) return Math.floor(s / 3600) + " jam lalu"; if (s < 7 * 86400) return Math.floor(s / 86400) + " hari lalu";
    try { return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) } catch (e) { return "" }
  }
  var stars = function (v) { v = Math.max(0, Math.min(5, v | 0)); return "★★★★★".slice(0, v) + "☆☆☆☆☆".slice(0, 5 - v) };

  /* ---------- keadaan perangkat ---------- */
  var VID = (function () { var v = ""; try { v = localStorage.getItem("ob_acc_vid") || "" } catch (e) {} if (!/^[A-Za-z0-9]{8,24}$/.test(v)) { v = rnd(14); try { localStorage.setItem("ob_acc_vid", v) } catch (e) {} } return v })();
  var ME = jp("ob_acc");                       /* {id,user,name,app,staf,tok} */
  var COMM = jp("ob_comm_cache") || [];        /* obrolan publik terakhir yang diterima */
  var ch = null; try { ch = new BroadcastChannel(CH) } catch (e) {}
  var pend = {}, DMN = { n: 0, ice: [] }, DMI = 0;
  var seenN = function () { return parseInt(localStorage.getItem("ob_dm_n") || "0", 10) || 0 };
  var unreadG = function () { return ME ? Math.max(0, DMN.n - seenN()) : 0 };

  /* ---------- kirim ke pusat ---------- */
  function send(o, cb) {
    o.type = "acct"; o.vid = VID; o.app = APP; o.q = rnd(8);
    if (cb) {
      pend[o.q] = cb;
      setTimeout(function () { if (pend[o.q]) { var f = pend[o.q]; delete pend[o.q]; f({ k: "err", why: "Server belum menjawab. Periksa koneksi internet Anda lalu coba lagi." }) } }, 12000);
    }
    if (ch) ch.postMessage(o);
  }
  function onR(r) {
    if (r.k === "dmn") {
      var old = unreadG(); DMN = { n: r.n | 0, ice: Array.isArray(r.ice) ? r.ice : [] };
      if (unreadG() > old) { refreshBtns(); if (!bg) toast("💬 Pesan baru dari hotel. Buka menu Akun."); try { if (document.hidden && window.HS_NOTIFY) window.HS_NOTIFY("💬 Pesan dari ONE BLISS", "Ada pesan baru dari hotel", "dm") } catch (e) {} } else refreshBtns();
      return;
    }
    if (r.k === "comm") { gotComm(r.list || []); return }
    if (r.k === "me" && r.ok && r.acct && ME && ME.st !== r.acct.st) { ME.st = r.acct.st; sv("ob_acc", ME); try { window.HS_PUSH && window.HS_PUSH() } catch (e) {} refreshBtns(); renderFeed() }
    if (r.k === "me" && !r.ok) { ME = null; try { localStorage.removeItem("ob_acc") } catch (e) {} refreshBtns(); renderFeed() }
    var f = pend[r.q]; if (f) { delete pend[r.q]; f(r) }
  }
  function gotComm(list) { COMM = Array.isArray(list) ? list : []; sv("ob_comm_cache", COMM.slice(0, 60)); renderFeed(); if (MODBOX) drawHosts() }
  if (ch) ch.addEventListener("message", function (e) {
    var m = e.data; if (!m || typeof m !== "object") return;
    if (m.type === "comm") { gotComm(m.list); return }
    if (m.type === "acct_r" && m.vid === VID) { onR(m); return }
  });

  /* data akun & obrolan dibaca dari penyimpanan sinkron (diisi server); semua perubahan lewat server */
  var A = function () { var x = jp("hs_accts"); return Array.isArray(x) ? x : [] };
  var C = function () { var x = jp("hs_comm"); return Array.isArray(x) ? x : [] };
  var autoOn = function () { var c = jp("hs_acfg"); return !c || c.auto !== 0 };

  /* ================= TAMPILAN ================= */
  var css = ".obm-bg{position:fixed;inset:0;z-index:2147483002;background:rgba(0,0,0,.66);display:grid;place-items:center;padding:14px;overflow:auto}" +
    ".obm{width:min(420px,100%);max-height:92vh;overflow:auto;background:#14110e;border:1px solid var(--gd,#e2ae2f);border-radius:16px;padding:18px;color:#f1ece0;font:14px/1.5 system-ui,'Segoe UI',sans-serif;box-shadow:0 14px 50px rgba(0,0,0,.7);text-align:left}" +
    ".obm-h{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}.obm-h b{font:600 17px Georgia,serif;color:var(--gd,#e2ae2f)}" +
    ".obm-x{background:none;border:0;color:#bbb;font-size:20px;cursor:pointer;padding:2px 8px}" +
    ".obm-t{display:flex;gap:6px;margin:0 0 12px}.obm-t button{flex:1;padding:9px;border-radius:9px;border:1px solid #3a3226;background:#1b1712;color:#cfc9bd;font-weight:600;cursor:pointer}.obm-t button.on{background:var(--gd,#e2ae2f);color:#1b1405;border-color:var(--gd,#e2ae2f)}" +
    ".obm label{display:block;font-size:12px;color:#a9a193;margin:10px 0 4px}.obm input,.obm textarea{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid #3a3226;background:#1d1813;color:#fff;font:15px system-ui,sans-serif}" +
    ".obm textarea{resize:vertical;min-height:96px}.obm-b{width:100%;margin-top:14px;padding:12px;border:0;border-radius:10px;background:linear-gradient(#f3cc63,var(--gd,#e2ae2f));color:#1b1405;font-weight:700;font-size:15px;cursor:pointer}.obm-b[disabled]{opacity:.55}" +
    ".obm-g{background:none;border:1px solid #3a3226;color:#e6cf9f;margin-top:8px}.obm-m{min-height:20px;margin-top:8px;font-size:13px;color:#e57373}.obm-n{font-size:12px;color:#a9a193;margin-top:6px}.obm-ok{color:#7ddc9a}" +
    ".obm-st{display:flex;gap:4px;justify-content:center;margin:6px 0}.obm-st button{background:none;border:0;font-size:30px;line-height:1;color:#4a4033;cursor:pointer;padding:2px 4px}.obm-st button.on{color:var(--gd,#e2ae2f)}" +
    ".obm-av{width:54px;height:54px;border-radius:50%;background:linear-gradient(#f3cc63,var(--gd,#e2ae2f));color:#1b1405;display:grid;place-items:center;font:700 24px Georgia,serif;margin:0 auto 8px}" +
    ".obm-pr{text-align:center;margin-bottom:6px}.obm-pr b{font-size:18px}.obm-pr small{display:block;color:#a9a193}" +
    ".obm-bd{display:inline-block;margin-top:6px;padding:3px 10px;border-radius:999px;border:1px solid var(--gd,#e2ae2f);color:var(--gd,#e2ae2f);font-size:11px;letter-spacing:.08em;text-transform:uppercase}" +
    ".obm-rw{border:1px solid #2c261d;border-radius:10px;padding:9px 11px;margin:7px 0;font-size:13px;word-break:break-word}.obm-rw small{color:#a9a193;display:block}.obm-rw .a{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}.obm-rw .a button{padding:5px 10px;border-radius:7px;border:1px solid #3a3226;background:#1b1712;color:#e6cf9f;font-size:12px;cursor:pointer}" +
    ".obf{max-width:760px;margin:26px auto 0;text-align:left}.obf-w{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:6px 0 24px}" +
    ".obf-w button{padding:13px 20px;border-radius:10px;font:600 14px system-ui,'Segoe UI',sans-serif;letter-spacing:.06em;cursor:pointer}.obf-w .p{border:0;background:linear-gradient(#f3cc63,var(--gd,#e2ae2f));color:#1b1405}.obf-w .o{background:transparent;border:1px solid var(--gd,#e2ae2f);color:#e6cf9f}" +
    ".obf-h{font:600 11px 'Segoe UI',sans-serif;letter-spacing:.34em;text-transform:uppercase;color:var(--gd,#e2ae2f);text-align:center;margin:0 0 14px}" +
    ".obf-c{border:1px solid #e2ae2f44;background:#ffffff08;border-radius:12px;padding:14px 16px;margin:0 0 12px}.obf-c .hd{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.obf-c .hd b{color:#fff;font-size:15px}.obf-c .hd small{color:#a9a193;margin-left:auto}" +
    ".obf-c .st{color:var(--gd,#e2ae2f);letter-spacing:2px;font-size:13px}.obf-c p{margin:8px 0 0;color:#e8e2d4;font-size:15px;line-height:1.55;white-space:pre-wrap;word-break:break-word}" +
    ".obf-bd{font-size:10px;letter-spacing:.1em;text-transform:uppercase;border:1px solid var(--gd,#e2ae2f);color:var(--gd,#e2ae2f);border-radius:999px;padding:1px 8px}" +
    ".obf-a{display:flex;gap:14px;margin-top:10px;font-size:13px}.obf-a button{background:none;border:0;color:#cfc9bd;cursor:pointer;padding:2px 0;font:inherit}.obf-a button:hover{color:var(--gd,#e2ae2f)}" +
    ".obf-r{margin:10px 0 0 10px;padding-left:12px;border-left:2px solid #e2ae2f55}.obf-r div{margin:8px 0;font-size:14px;color:#e8e2d4;word-break:break-word}.obf-r small{color:#a9a193;margin-left:6px}" +
    ".obf-rf{display:flex;gap:6px;margin-top:8px}.obf-rf input{flex:1;padding:9px 11px;border-radius:9px;border:1px solid #3a3226;background:#1d1813;color:#fff;font:14px system-ui,sans-serif}.obf-rf button{padding:9px 14px;border:0;border-radius:9px;background:var(--gd,#e2ae2f);color:#1b1405;font-weight:700;cursor:pointer}" +
    ".obf-e{text-align:center;color:#a9a193;padding:18px;border:1px dashed #e2ae2f55;border-radius:12px}.obf-m{text-align:center;margin-top:8px}.obf-m button{background:none;border:1px solid var(--gd,#e2ae2f);color:#e6cf9f;padding:9px 18px;border-radius:9px;cursor:pointer}" +
    "#obAccFab{position:fixed;left:12px;bottom:max(12px,env(safe-area-inset-bottom));z-index:2147481900;border:1px solid var(--gd,#b69a6b);border-radius:999px;padding:9px 14px;background:#14110e;color:#e6cf9f;font:600 13px system-ui,sans-serif;box-shadow:0 6px 22px rgba(0,0,0,.55);cursor:pointer}" +
    "#obToast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:2147483003;background:#14110e;border:1px solid var(--gd,#e2ae2f);color:#fff;padding:10px 18px;border-radius:999px;font:14px system-ui,sans-serif;display:none;max-width:90vw;text-align:center}";
  function addCss() { if ($("obAccCss")) return; var s = document.createElement("style"); s.id = "obAccCss"; s.textContent = css; document.head.appendChild(s) }
  function toast(t) { var e = $("obToast"); if (!e) { e = document.createElement("div"); e.id = "obToast"; document.body.appendChild(e) } e.textContent = t; e.style.display = "block"; clearTimeout(toast.t); toast.t = setTimeout(function () { e.style.display = "none" }, 2800) }

  var bg = null, MODBOX = false;
  function close() { if (bg) { bg.remove(); bg = null } MODBOX = false; if (DMI) { clearInterval(DMI); DMI = 0 } }
  function modal(html) {
    close(); addCss();
    bg = document.createElement("div"); bg.className = "obm-bg"; bg.innerHTML = '<div class="obm" role="dialog" aria-modal="true">' + html + "</div>";
    bg.addEventListener("click", function (e) { if (e.target === bg || e.target.closest(".obm-x")) close() });
    document.body.appendChild(bg); return bg.firstChild;
  }
  var q1 = function (sel) { return bg ? bg.querySelector(sel) : null };

  function saveMe(r) { ME = { id: r.acct.id, user: r.acct.user, name: r.acct.name, app: r.acct.app, staf: r.acct.staf, st: r.acct.st || "ok", tok: r.tok }; sv("ob_acc", ME); refreshBtns(); renderFeed() }
  function logout() { ME = null; try { localStorage.removeItem("ob_acc") } catch (e) {} refreshBtns(); renderFeed() }

  /* --- masuk staf: akun dibuat owner; berhasil -> halaman sesuai peran. Callback: "go" | teks galat | null (bukan staf -> coba akun tamu) --- */
  function staffTry(u, pw, cb) {
    var done = 0; function fin(x) { if (!done) { done = 1; cb(x) } }
    try {
      fetch("/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ user: u, pass: pw }) })
        .then(function (r) { return r.json() }).then(function (j) {
          if (j && j.ok) {
            try { localStorage.setItem("hs_pin_mode", "1"); if (j.token) localStorage.setItem("hs_key_dev", j.token); if (j.emp && j.etoken) localStorage.setItem("emp_me", JSON.stringify({ emp: j.emp, token: j.etoken })); else localStorage.removeItem("emp_me") } catch (e) {}
            var n = new URLSearchParams(location.search).get("next"), ok = n && n.charAt(0) === "/" && n.charAt(1) !== "/" && (j.pages || []).indexOf(n.split("?")[0]) >= 0;
            location.href = ok ? n : j.land; fin("go"); return;
          }
          if (j && j.guest) return fin(null);
          fin((j && j.msg) || "Username atau kata sandi salah.");
        }).catch(function () { fin(null) });
    } catch (e) { fin(null) }
  }

  /* --- panel akun --- */
  function openAcc(tab, after, note) {
    if (ME) return profile();
    var up = tab === "up";
    var el = modal('<div class="obm-h"><b>Akun ONE BLISS</b><button class="obm-x" aria-label="Tutup">✕</button></div>' +
      '<div class="obm-t"><button data-t="in" class="' + (up ? "" : "on") + '">Masuk</button><button data-t="up" class="' + (up ? "on" : "") + '">Daftar</button></div>' +
      (note ? '<div class="obm-n" style="margin:0 0 6px;color:#e6cf9f">' + esc(note) + "</div>" : "") +
      '<div id="obF"></div>');
    var F = el.querySelector("#obF");
    function form(upMode) {
      F.innerHTML = (upMode ? '<label>Nama lengkap</label><input id="obN" maxlength="40" autocomplete="name" placeholder="Contoh: Budi Santoso">' : "") +
        '<label>Username</label><input id="obU" maxlength="20" autocapitalize="none" autocomplete="username" placeholder="huruf/angka, tanpa spasi">' +
        (upMode ? '<label>No. HP / WhatsApp</label><input id="obP" inputmode="tel" maxlength="20" autocomplete="tel" placeholder="08xxxxxxxxxx"><div class="obm-n">Nomor hanya dilihat pengelola hotel untuk mengenali pemilik aplikasi, tidak ditampilkan ke publik.</div>' : "") +
        '<label>Kata sandi</label><input id="obW" type="password" maxlength="64" autocomplete="' + (upMode ? "new-password" : "current-password") + '" placeholder="minimal 6 karakter">' +
        '<button class="obm-b" id="obGo">' + (upMode ? "Daftar Akun" : "Masuk") + '</button><div class="obm-m" id="obMsg"></div>' +
        '<div class="obm-n">' + (upMode ? "Pendaftaran ini untuk <b>tamu / pengunjung</b>. Akun staf & karyawan dibuat oleh owner." : "Belum punya akun? Pilih Daftar di atas. Staf & karyawan: masuk dengan akun dari owner.") + "</div>";
      el.querySelector("#obGo").onclick = function () {
        var u = T($("obU").value).toLowerCase(), pw = $("obW").value, msg = $("obMsg"); msg.className = "obm-m"; msg.textContent = "";
        if (!(upMode ? /^[a-z0-9_.]{3,20}$/ : /^[a-z0-9._-]{3,24}$/).test(u)) { msg.textContent = "Username 3-20 karakter: huruf, angka, titik, atau garis bawah."; return }
        if (pw.length < 6) { msg.textContent = "Kata sandi minimal 6 karakter."; return }
        var o = { k: upMode ? "reg" : "login", user: u, pwh: sha256(u + ":" + pw + ":onebliss") };
        if (upMode) { o.name = T($("obN").value); o.ph = $("obP").value; if (o.name.length < 2) { msg.textContent = "Isi nama lengkap."; return } if (String(o.ph).replace(/\D/g, "").length < 8) { msg.textContent = "Isi No. HP / WhatsApp yang benar."; return } }
        var b = $("obGo"); b.disabled = true; msg.className = "obm-m obm-ok"; msg.textContent = "Memproses…";
        function guestGo() {
          if (!/^[a-z0-9_.]{3,20}$/.test(u)) { b.disabled = false; msg.className = "obm-m"; msg.textContent = "Username atau kata sandi salah."; return }
          send(o, doneG);
        }
        function doneG(r) {
          if (!bg) return;
          if (r.k === "ok") { saveMe(r); toast(upMode ? (r.acct.st === "wait" ? "Pendaftaran terkirim. Menunggu persetujuan hotel." : "Akun berhasil dibuat 🎉") : "Selamat datang, " + shortName(r.acct.name) + "!"); close(); if (r.acct.st === "wait") { setTimeout(waitInfo, 300) } else if (after) after() }
          else { b.disabled = false; msg.className = "obm-m"; msg.textContent = r.why || "Gagal." }
        }
        if (upMode) { send(o, doneG); return }
        staffTry(u, pw, function (res) { if (res === "go") return; if (res) { b.disabled = false; msg.className = "obm-m"; msg.textContent = res; return } guestGo() });
      };
    }
    el.querySelector(".obm-t").onclick = function (e) { var b = e.target.closest("button"); if (!b) return; [].forEach.call(el.querySelectorAll(".obm-t button"), function (x) { x.classList.toggle("on", x === b) }); form(b.dataset.t === "up") };
    form(up);
  }
  function profile() {
    var el = modal('<div class="obm-h"><b>Akun Saya</b><button class="obm-x" aria-label="Tutup">✕</button></div>' +
      '<div class="obm-pr"><div class="obm-av">' + esc((ME.name || "?").charAt(0).toUpperCase()) + "</div><b>" + esc(ME.name) + "</b><small>@" + esc(ME.user) + '</small><span class="obm-bd">' + (ME.staf ? "Staf · " : "") + esc(APPN[ME.app] || "ONE BLISS") + "</span><br><span class=\"obm-bd\" style=\"border-color:" + (ME.st === "wait" ? "#f3cc63;color:#f3cc63" : ME.st === "no" ? "#e57373;color:#e57373" : "#7ddc9a;color:#7ddc9a") + "\">" + (ME.st === "wait" ? "Menunggu persetujuan" : ME.st === "no" ? "Ditolak" : "Disetujui") + "</span></div>" +
      '<div class="obm-n" style="text-align:center">Akun ini mengenali Anda sebagai pemilik aplikasi ONE BLISS ini dan dipakai saat menulis ulasan atau membalas obrolan.</div>' +
      '<button class="obm-b" id="obCm">✍️ Tulis Ulasan & Curhat</button><button class="obm-b obm-g" id="obDm">💬 Pesan dari Hotel' + (unreadG() ? " (" + unreadG() + " baru)" : "") + '</button>' + (MOD ? '<button class="obm-b obm-g" id="obMd">🛡️ Akun Aplikasi & Moderasi</button>' : "") + '<button class="obm-b obm-g" id="obLo">Keluar</button>');
    el.querySelector("#obCm").onclick = function () { compose() };
    el.querySelector("#obDm").onclick = dmGuest;
    el.querySelector("#obLo").onclick = function () { logout(); close(); toast("Anda sudah keluar") };
    if (MOD) el.querySelector("#obMd").onclick = openMod;
  }

  function waitInfo() {
    var no = ME && ME.st === "no";
    var el = modal('<div class="obm-h"><b>' + (no ? "Pendaftaran Ditolak" : "Menunggu Persetujuan") + '</b><button class="obm-x" aria-label="Tutup">✕</button></div><div class="obm-n" style="font-size:14px;color:#e8e2d4">' + (no ? "Pendaftaran akun Anda ditolak oleh pengelola hotel. Silakan hubungi resepsionis." : "Akun Anda sudah terdaftar dan sedang diperiksa pengelola hotel (resepsionis/owner). Fitur lengkap dan menulis ulasan terbuka setelah disetujui. Halaman ini memeriksa otomatis.") + '</div><button class="obm-b obm-g" id="obOk">Mengerti</button>');
    el.querySelector("#obOk").onclick = close;
  }
  /* --- PESAN langsung antara akun aplikasi dan resepsionis/owner --- */
  var bub = function (m, mine) { return '<div style="display:flex;justify-content:' + (mine ? "flex-end" : "flex-start") + ';margin:6px 0"><div style="max-width:82%;padding:8px 11px;border-radius:12px;background:' + (mine ? "#e2ae2f;color:#1b1405" : "#2a241b;color:#f1ece0") + ';word-break:break-word;white-space:pre-wrap">' + (mine ? "" : "<small style='display:block;opacity:.7'>" + esc(m.n || "Hotel") + "</small>") + esc(m.c) + "<small style='display:block;opacity:.6;text-align:right;font-size:10px'>" + esc(ago(m.t)) + "</small></div></div>" };
  function dmGuest() {
    if (!ME) return openAcc("in");
    if (ME.st === "wait" || ME.st === "no") return waitInfo();
    var el = modal('<div class="obm-h"><b>💬 Pesan dari Hotel</b><button class="obm-x" aria-label="Tutup">✕</button></div><div id="dmL" style="max-height:46vh;overflow:auto;min-height:90px"></div><textarea id="dmT" maxlength="400" placeholder="Tulis pesan untuk resepsionis / owner…" style="min-height:62px"></textarea><button class="obm-b" id="dmS">Kirim</button><div class="obm-m" id="dmM"></div>'), list = [];
    function draw() { var L = $("dmL"); if (!L) return; var st = L.scrollTop, bot = L.scrollHeight - L.clientHeight - st < 40; L.innerHTML = list.length ? list.map(function (m) { return bub(m, m.f === "a") }).join("") : '<div class="obm-n" style="text-align:center;padding:20px 0">Belum ada pesan. Tulis pesan di bawah, resepsionis/owner akan membalas di sini.</div>'; if (bot) L.scrollTop = L.scrollHeight; else L.scrollTop = st }
    function pull() { if (!bg || !$("dmL")) return; send({ k: "dmget", id: ME.id, tok: ME.tok }, function (r) { if (!bg || !$("dmL")) return; if (r.k === "dm") { list = r.list || []; var sN = list.filter(function (x) { return x.f === "s" }).length; try { localStorage.setItem("ob_dm_n", String(sN)) } catch (e) {} if (sN > DMN.n) DMN.n = sN; refreshBtns(); draw() } else if (r.relog) { logout(); close(); openAcc("in", null, "Sesi berakhir, silakan masuk lagi.") } }) }
    el.querySelector("#dmS").onclick = function () {
      var t = T($("dmT").value), msg = $("dmM"); if (!t) return; var b = $("dmS"); b.disabled = true; msg.className = "obm-m obm-ok"; msg.textContent = "Mengirim…";
      send({ k: "dmsend", id: ME.id, tok: ME.tok, c: t }, function (r) { if (!bg || !$("dmS")) return; b.disabled = false; if (r.k === "posted") { $("dmT").value = ""; msg.textContent = ""; list.push({ f: "a", c: t, t: Date.now() }); draw(); var L = $("dmL"); if (L) L.scrollTop = L.scrollHeight; setTimeout(pull, 700) } else { msg.className = "obm-m"; msg.textContent = r.why || "Gagal." } });
    };
    draw(); pull(); DMI = setInterval(pull, 4000);
  }
  var dmAll = function () { var x = jp("hs_dm"); return x && typeof x === "object" && !Array.isArray(x) ? x : {} };
  var dmSeen = function () { return jp("ob_dm_seen") || {} };
  var dmUnread = function (id) { var th = dmAll()[id] || [], sn = dmSeen()[id] || 0; return th.filter(function (m) { return m.f === "a" && m.t > sn }).length };
  function dmMark(id) { var th = dmAll()[id] || [], l = th.length ? th[th.length - 1].t : 0, sn = dmSeen(); sn[id] = Math.max(sn[id] || 0, l); sv("ob_dm_seen", sn) }
  function dmStaff(id) {
    var a = A().filter(function (x) { return x.id === id })[0]; if (!a) return toast("Akun tidak ditemukan");
    var el = modal('<div class="obm-h"><b>💬 ' + esc(a.name) + ' <small style="color:#a9a193">@' + esc(a.user) + '</small></b><button class="obm-x" aria-label="Tutup">✕</button></div><div id="dmL" style="max-height:46vh;overflow:auto;min-height:90px"></div><textarea id="dmT" maxlength="400" placeholder="Tulis pesan…" style="min-height:62px"></textarea><div style="display:flex;gap:8px"><button class="obm-b" id="dmS" style="flex:1">Kirim</button><button class="obm-b obm-g" id="dmC" style="flex:1">📞 Panggil</button></div><div class="obm-m" id="dmM"></div>'), last = "";
    function draw(force) { var L = $("dmL"); if (!L) return; var th = dmAll()[id] || [], sig = th.length + ":" + (th.length ? th[th.length - 1].t : 0); if (sig === last && !force) return; last = sig; var bot = L.scrollHeight - L.clientHeight - L.scrollTop < 40 || force; L.innerHTML = th.length ? th.map(function (m) { return bub(m, m.f === "s") }).join("") : '<div class="obm-n" style="text-align:center;padding:20px 0">Belum ada percakapan dengan akun ini.</div>'; if (bot) L.scrollTop = L.scrollHeight; dmMark(id) }
    el.querySelector("#dmS").onclick = function () {
      var t = T($("dmT").value), msg = $("dmM"); if (!t) return; var b = $("dmS"); b.disabled = true; msg.className = "obm-m obm-ok"; msg.textContent = "Mengirim…";
      send({ k: "mod", op: "dm", id: id, c: t }, function (r) { if (!bg || !$("dmS")) return; b.disabled = false; if (r.k === "ok") { $("dmT").value = ""; msg.textContent = "" } else { msg.className = "obm-m"; msg.textContent = r.why || "Gagal." } });
    };
    el.querySelector("#dmC").onclick = function () { callApp(id) };
    draw(true); DMI = setInterval(draw, 1200);
  }
  function callApp(id) { if (window.IC && IC.callTo) IC.callTo("U:" + id); else toast("Panggilan suara belum siap di halaman ini") }
  /* pemberitahuan pesan baru dari akun aplikasi untuk owner & resepsionis */
  if (MOD) (function () {
    var base = null;
    setInterval(function () {
      var D = dmAll(), n = 0, who = "";
      Object.keys(D).forEach(function (id) { var u = dmUnread(id); if (u) { n += u; if (!who) { var a = A().filter(function (x) { return x.id === id })[0]; who = a ? a.name : "akun" } } });
      if (base !== null && n > base) { toast("💬 Pesan baru dari " + who); try { if (document.hidden && window.HS_NOTIFY) window.HS_NOTIFY("💬 Pesan dari " + who, "Buka Akun Aplikasi untuk membalas", "dm") } catch (e) {} }
      base = n; var c = $("accN"); if (c && !(A().filter(function (x) { return x.st === "wait" && !x.bl }).length)) { c.textContent = n || ""; c.style.display = n ? "" : "none" }
    }, 3000);
  })();

  /* --- tulis ulasan / balasan --- */
  function compose() {
    if (ME && (ME.st === "wait" || ME.st === "no")) return waitInfo();
    if (!ME) return openAcc("up", compose, "Daftar atau masuk dulu agar ulasan Anda tercatat atas nama Anda.");
    var rate = 0, el = modal('<div class="obm-h"><b>Tulis Ulasan & Curhat</b><button class="obm-x" aria-label="Tutup">✕</button></div>' +
      '<div class="obm-n" style="margin:0">Tampil sebagai <b>' + esc(shortName(ME.name)) + "</b>. Bagikan pengalaman, tanya sesama penggemar, atau curhat seputar ONE BLISS.</div>" +
      '<div class="obm-st" id="obSt">' + [1, 2, 3, 4, 5].map(function (i) { return '<button data-v="' + i + '" aria-label="' + i + ' bintang">★</button>' }).join("") + '</div><div class="obm-n" style="text-align:center;margin:0 0 6px">Bintang boleh dikosongkan</div>' +
      '<textarea id="obTx" maxlength="400" placeholder="Tulis di sini…"></textarea><div class="obm-n" id="obCt" style="text-align:right">0/400</div><button class="obm-b" id="obSd">Kirim</button><div class="obm-m" id="obMsg"></div>');
    el.querySelector("#obSt").onclick = function (e) { var b = e.target.closest("button"); if (!b) return; var v = +b.dataset.v; rate = rate === v ? 0 : v; [].forEach.call(el.querySelectorAll("#obSt button"), function (x) { x.classList.toggle("on", +x.dataset.v <= rate) }) };
    el.querySelector("#obTx").oninput = function () { $("obCt").textContent = this.value.length + "/400" };
    el.querySelector("#obSd").onclick = function () {
      var t = T($("obTx").value), msg = $("obMsg"); if (t.length < 3) { msg.textContent = "Tulisan terlalu pendek."; return }
      var b = $("obSd"); b.disabled = true; msg.className = "obm-m obm-ok"; msg.textContent = "Mengirim…";
      send({ k: "post", id: ME.id, tok: ME.tok, c: t, v: rate }, function (r) {
        if (!bg) return;
        if (r.k === "posted") { close(); toast("Terkirim! Terima kasih sudah berbagi 🙏") }
        else { b.disabled = false; msg.className = "obm-m"; msg.textContent = r.why || "Gagal."; if (r.relog) { logout(); openAcc("in", compose, "Sesi berakhir, silakan masuk lagi.") } }
      });
    };
  }

  /* --- obrolan di beranda (#cmBox) --- */
  var open = {}, showAll = false;
  function renderFeed() {
    var box = $("cmBox"); if (!box) return; addCss();
    var L = COMM, shown = showAll ? L : L.slice(0, 5);
    box.innerHTML = '<div class="obf-h">Obrolan Penggemar ONE BLISS</div>' + (L.length ? shown.map(function (c) {
      var mine = ME && c.a === ME.id, rp = c.rp || [], op = !!open[c.id];
      return '<div class="obf-c" data-id="' + esc(c.id) + '"><div class="hd"><b>' + esc(c.n) + "</b>" + (c.s ? '<span class="obf-bd">Staf</span>' : "") + (c.v ? '<span class="st">' + stars(c.v) + "</span>" : "") + "<small>" + esc(ago(c.t)) + "</small></div><p>" + esc(c.c) + "</p>" +
        '<div class="obf-a"><button data-a="tg">↩️ Balas' + (rp.length ? " (" + rp.length + ")" : "") + "</button>" + "</div>" +
        (op ? '<div class="obf-r">' + rp.map(function (r) { return "<div><b>" + esc(r.n) + "</b>" + (r.s ? ' <span class="obf-bd">Staf</span>' : "") + "<small>" + esc(ago(r.t)) + "</small><br>" + esc(r.c) + "</div>" }).join("") + '<div class="obf-rf"><input maxlength="300" placeholder="Tulis balasan…"><button data-a="rs">Kirim</button></div></div>' : "") + "</div>";
    }).join("") + (L.length > 5 ? '<div class="obf-m"><button data-a="all">' + (showAll ? "Tampilkan lebih ringkas" : "Lihat semua " + L.length + " obrolan") + "</button></div>" : "") : '<div class="obf-e">Belum ada obrolan. Jadilah yang pertama berbagi cerita atau curhat di sini.</div>');
  }
  function feedClick(e) {
    var b = e.target.closest("button[data-a]"); if (!b) return; var a = b.dataset.a, card = b.closest(".obf-c"), id = card && card.dataset.id;
    if (a === "all") { showAll = !showAll; renderFeed(); return }
    if (a === "tg") { open[id] = !open[id]; renderFeed(); return }
    if (a === "rs") {
      var inp = card.querySelector(".obf-rf input"), t = T(inp.value); if (!t) return;
      if (!ME) return openAcc("up", function () { }, "Daftar atau masuk dulu untuk membalas.");
      if (ME.st === "wait" || ME.st === "no") return waitInfo();
      b.disabled = true;
      send({ k: "reply", id: ME.id, tok: ME.tok, cid: id, c: t }, function (r) { b.disabled = false; if (r.k === "posted") { inp.value = ""; toast("Balasan terkirim") } else { toast(r.why || "Gagal"); if (r.relog) { logout(); openAcc("in", null, "Sesi berakhir, silakan masuk lagi.") } } });
    }
  }

  /* --- akun aplikasi & moderasi (owner & resepsionis): dipakai modal, menu Akun Aplikasi resepsionis, dan tab owner --- */
  function modHTML() {
    var AC = A().slice().reverse(), W = AC.filter(function (x) { return x.st === "wait" && !x.bl }), auto = autoOn();
    var row = function (a) {
      var st = a.bl ? "Diblokir" : a.st === "wait" ? "Menunggu" : a.st === "no" ? "Ditolak" : "Disetujui", col = a.bl || a.st === "no" ? "#e57373" : a.st === "wait" ? "#f3cc63" : "#7ddc9a", i = esc(a.id), bt = "";
      var act = a.st === "ok" && !a.bl, un = act ? dmUnread(a.id) : 0, on = act && window.IC && IC.isOn && IC.isOn("U:" + a.id) === true, op_ = on && window.IC && IC.isOpen && IC.isOpen("U:" + a.id);
      if (act) bt += '<button data-o="dm" data-i="' + i + '">💬 Chat' + (un ? ' <b style="color:#f3cc63">(' + un + " baru)</b>" : "") + '</button><button data-o="call" data-i="' + i + '"' + (on ? ' title="' + (op_ ? "Aplikasi terbuka" : "Aplikasi ditutup: panggilan masuk lewat notifikasi di HP tamu") + '"' : ' title="Tamu belum mengaktifkan notifikasi / belum pernah membuka aplikasi, panggilan mungkin tidak terjawab"') + ">📞 Panggil" + (on ? (op_ ? "" : " (notifikasi)") : " (offline)") + "</button>";
      if (a.st === "wait" || a.st === "no") bt += '<button data-o="ok" data-i="' + i + '">✅ Setujui</button>';
      if (a.st !== "no") bt += '<button data-o="no" data-i="' + i + '">⛔ ' + (a.st === "wait" ? "Tolak" : "Cabut") + "</button>";
      bt += '<button data-o="bl" data-i="' + i + '">' + (a.bl ? "Buka blokir" : "Blokir") + "</button>";
      bt += '<button data-o="reset" data-i="' + i + '" title="Tamu lupa sandi / akun tidak bisa masuk setelah update">🔑 Setel ulang sandi</button><button data-o="delacct" data-i="' + i + '">🗑 Hapus akun</button>';
      return '<div class="obm-rw"><b>' + esc(a.name) + "</b> @" + esc(a.user) + ' <span style="color:' + col + ';font-weight:700">● ' + st + "</span><small>📞 " + esc(a.ph) + " · " + esc(APPN[a.app] || a.app) + (a.staf ? " · Staf" : "") + " · " + esc(ago(a.t)) + (on ? ' · <span style="color:#7ddc9a">● aplikasi terbuka</span>' : "") + '</small><div class="a">' + bt + "</div></div>";
    };
    var h = '<div class="obm-rw"><label style="display:flex;gap:8px;align-items:center;font-size:14px;cursor:pointer"><input type="checkbox" data-auto="1" style="width:auto"' + (auto ? " checked" : "") + '> Setujui pendaftaran akun otomatis</label><small>Matikan untuk menyetujui manual: akun baru menunggu di daftar "Menunggu persetujuan". Akun staf & karyawan tidak dibuat di sini (hanya owner, di menu Akun Staf).</small></div>' +
      '<div class="obm-n" style="margin:8px 0">' + AC.length + ' akun · <b style="color:#f3cc63">' + W.length + " menunggu</b> · " + "</div>";
    if (W.length) h += '<button class="obm-b" data-o="okall" style="margin:0 0 8px">✅ Setujui semua yang menunggu (' + W.length + ')</button><div class="obm-n" style="color:#f3cc63"><b>MENUNGGU PERSETUJUAN</b></div>' + W.map(row).join("");
    h += '<div class="obm-n" style="color:#e6cf9f;margin-top:12px"><b>SEMUA AKUN</b></div>' + (AC.filter(function (x) { return !(x.st === "wait" && !x.bl) }).slice(0, 80).map(row).join("") || (W.length ? "" : '<div class="obm-n">Belum ada akun.</div>')) +
      "";
    return h;
  }

  /* --- menu RATING & ULASAN (owner & resepsionis): rating bintang + ulasan + balasan dari aplikasi tamu --- */
  function revHTML() {
    var CM = C().slice().reverse(), R = CM.filter(function (c) { return c.v > 0 && !c.hide }), n = R.length, dist = [0, 0, 0, 0, 0], sum = 0;
    R.forEach(function (c) { var v = Math.max(1, Math.min(5, c.v | 0)); dist[v - 1]++; sum += v });
    var avg = n ? sum / n : 0, mx = Math.max(1, Math.max.apply(null, dist));
    var h = '<div class="obm-rw"><div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center"><div style="text-align:center"><b style="font:700 34px Georgia,serif;color:#f3cc63">' + (n ? avg.toFixed(1) : "-") + "</b><br>" + (n ? stars(Math.round(avg)) : "") + "<br><small>" + n + " rating · " + CM.length + " tulisan</small></div><div style=\"flex:1;min-width:160px\">" +
      [5, 4, 3, 2, 1].map(function (s) { return '<div style="display:flex;gap:6px;align-items:center;font-size:12px"><span style="width:26px">' + s + '★</span><div style="flex:1;height:8px;background:#ffffff14;border-radius:4px"><i style="display:block;height:8px;border-radius:4px;background:#e2ae2f;width:' + Math.round(dist[s - 1] * 100 / mx) + '%"></i></div><span style="width:22px;text-align:right">' + dist[s - 1] + "</span></div>" }).join("") + "</div></div></div>";
    h += '<div class="obm-n" style="margin:8px 0">Tamu hanya bisa membalas. Menyembunyikan / menghapus hanya bisa dilakukan di sini.</div>';
    h += CM.slice(0, 80).map(function (c) {
      var i = esc(c.id);
      return '<div class="obm-rw"><b>' + esc(c.n) + "</b>" + (c.hide ? " · <i>disembunyikan</i>" : "") + (c.v ? " " + stars(c.v) : ' <small>(obrolan, tanpa rating)</small>') + "<br>" + esc(c.c) + "<small>" + esc(ago(c.t)) + " · " + (c.rp || []).length + ' balasan</small>' +
        '<div class="a"><button data-o="hide" data-i="' + i + '">' + (c.hide ? "Tampilkan" : "Sembunyikan") + '</button><button data-o="rm" data-i="' + i + '">Hapus</button></div>' +
        (c.rp || []).map(function (r) {
          return '<div class="obm-rw" style="margin-left:10px"><b>' + esc(r.n) + "</b>" + (r.s ? ' <span class="obf-bd">Hotel</span>' : "") + (r.hide ? " · <i>disembunyikan</i>" : "") + "<br>" + esc(r.c) + '<div class="a"><button data-o="hide" data-i="' + esc(r.id) + '">' + (r.hide ? "Tampilkan" : "Sembunyikan") + '</button><button data-o="rm" data-i="' + esc(r.id) + '">Hapus</button></div></div>';
        }).join("") +
        '<div class="obm-rf" style="display:flex;gap:6px;margin-top:6px"><input maxlength="300" placeholder="Balas sebagai ONE BLISS…" style="flex:1"><button data-o="rp" data-i="' + i + '">Balas</button></div></div>';
    }).join("") || '<div class="obm-n">Belum ada rating / ulasan dari aplikasi tamu.</div>';
    return h;
  }
  function openMod() {
    modal('<div class="obm-h"><b>Akun Aplikasi & Moderasi</b><button class="obm-x" aria-label="Tutup">✕</button></div><div id="obModBox" class="obmod"></div>');
    MODBOX = true; drawHosts();
  }
  function drawHosts() {
    var h = null;
    ["obModBox", "accBox"].forEach(function (id) {
      var el = $(id); if (!el) return; if (h === null) h = modHTML();
      el.classList.add("obmod"); if (el._h !== h) { el._h = h; el.innerHTML = h }
    });
    var rb = $("revBox"); if (rb) {
      var ae = document.activeElement, typing = ae && rb.contains(ae) && ae.tagName === "INPUT" && ae.value;
      var rh = revHTML(); rb.classList.add("obmod"); if (rb._h !== rh && !typing) { rb._h = rh; rb.innerHTML = rh }
    }
    var n = A().filter(function (x) { return x.st === "wait" && !x.bl }).length, c = $("accN");
    if (c) { c.textContent = n; c.style.display = n ? "" : "none" }
  }
  function sendMod(o) { o.k = "mod"; send(o, function (r) { if (r.k !== "ok") toast(r.why || "Gagal"); setTimeout(drawHosts, 900) }) }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".obmod button[data-o]"); if (!b) return;
    if (b.dataset.o === "rp") {
      var inp = b.parentNode.querySelector("input"), t = T(inp && inp.value); if (!t) return toast("Tulis balasan dulu");
      b.disabled = true; var ob = b; send({ k: "mod", op: "reply", id: b.dataset.i, c: t }, function (r) { ob.disabled = false; if (r.k === "ok") { inp.value = ""; toast("Balasan terkirim") } else toast(r.why || "Gagal"); setTimeout(drawHosts, 900) });
      return;
    }
    if (b.dataset.o === "call") { callApp(b.dataset.i); return }
    if (b.dataset.o === "dm") { dmStaff(b.dataset.i); return }
    if (b.dataset.o === "rm" && !confirm("Hapus permanen?")) return;
    if (b.dataset.o === "no" && !confirm("Tolak / cabut akun ini?")) return;
    if (b.dataset.o === "reset") {
      var ac_ = A().filter(function (x) { return x.id === b.dataset.i })[0]; if (!ac_) return;
      var tmp_ = Math.random().toString(36).slice(2, 8), np_ = prompt("Sandi baru untuk @" + ac_.user + " (minimal 6 karakter). Sandi tamu yang lama tidak bisa dilihat karena server hanya menyimpan sandi yang diacak.", tmp_);
      if (!np_ || np_.length < 6) return;
      sendMod({ op: "reset", id: b.dataset.i, pwh: sha256(ac_.user + ":" + np_ + ":onebliss") });
      alert("Sandi @" + ac_.user + " sekarang: " + np_ + "\nBeri tahu tamu. Tamu keluar dari semua perangkat dan masuk dengan sandi ini."); return;
    }
    if (b.dataset.o === "delacct" && !confirm("Hapus akun ini? Username dan No. HP bisa didaftarkan lagi.")) return;
    sendMod({ op: b.dataset.o, id: b.dataset.i });
  });
  document.addEventListener("change", function (e) { var c = e.target; if (c && c.matches && c.matches(".obmod input[data-auto]")) sendMod({ op: "auto", v: c.checked ? 1 : 0 }) });
  setInterval(function () { if ($("accBox") || $("obModBox") || $("revBox")) drawHosts() }, 2000);

  /* --- tombol & pemasangan --- */
  function refreshBtns() {
    var dm = unreadG() ? " 💬" + unreadG() : "", n = ME ? "👤 " + shortName(ME.name) + dm : "👤 Daftar / Masuk";
    var a = $("rvAcc"); if (a) a.textContent = n;
    var na = $("nA"); if (na) na.textContent = ME ? "👤 " + shortName(ME.name) + dm : "👤 Akun";
    var f = $("obAccFab"); if (f) f.textContent = ME ? "👤 " + shortName(ME.name) + dm : "👤 Akun";
    try { window.dispatchEvent(new Event("obacc")) } catch (e) {}
  }
  function mount() {
    addCss();
    var w = $("rvWrite"); if (w) w.onclick = function () { compose() };
    var a = $("rvAcc"); if (a) a.onclick = function () { openAcc("up") };
    var na = $("nA"); if (na) na.onclick = function () { openAcc("in"); var h = document.querySelector("header.hd"), s = $("scrim"); if (h) h.classList.remove("open"); if (s) s.classList.remove("on") };
    var box = $("cmBox"); if (box) { box.addEventListener("click", feedClick); renderFeed() }
    refreshBtns();
    if (APP === "tamu" && /[?&]masuk=1/.test(location.search) && !ME) setTimeout(function () { openAcc("in", null, "Masuk dengan akun Anda. Staf & karyawan: pakai akun yang dibuat owner.") }, 400);
    var hi = function () { send({ k: "hi", id: ME && ME.id, tok: ME && ME.tok }, function () { }) };
    var ping = function () { if (ME && !document.hidden) send({ k: "ping", id: ME.id, tok: ME.tok }, function () { }) };
    hi(); var tk = 0; setInterval(function () { tk++; var wt = ME && ME.st === "wait"; if (!document.hidden && ((wt) || (tk % 6 === 0 && $("cmBox")))) hi() }, 15000);
    if (APP === "tamu") { setInterval(ping, 20000); setTimeout(ping, 1500) }
    document.addEventListener("visibilitychange", function () { if (!document.hidden) { if ($("cmBox")) hi(); if (APP === "tamu") ping() } });
  }
  window.OBACC = { ic: function (p) { if (ME) send({ k: "ic", id: ME.id, tok: ME.tok, p: p }) }, ice: function () { return DMN.ice || [] }, dm: dmStaff, modHTML: modHTML, mod: openMod, open: openAcc, compose: compose, me: function () { return ME }, sha256: sha256 };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
