/* ONE BLISS - PENJAGA KETIKAN: teks yang sedang ditulis tidak hilang saat halaman menggambar ulang (refresh otomatis/real-time).
   Cara kerja:
   1. Setiap ketikan di kolom teks / area teks / pilihan disimpan sebagai draf (per halaman, di sessionStorage).
   2. Bila kolom itu dihapus dari layar karena halaman digambar ulang, lalu muncul kolom baru yang sama (id/name/posisi sama),
      isinya dikembalikan otomatis beserta fokus dan posisi kursor.
   3. Draf dibuang bila aplikasi sendiri yang mengosongkan / mengisi kolom itu (mis. setelah kirim atau simpan), jadi teks lama tidak muncul lagi.
   Kolom sandi/PIN, file, dan kotak centang tidak disimpan. Tambahkan atribut data-nodraft pada kolom yang tidak perlu dijaga. */
(function () {
  if (window.HS_DRAFT) return;
  var PAGE = "hsd:" + location.pathname, MAX = 200, TTL = 30 * 60e3, WIN = 60e3, BW = 5 * 60e3, mem = {}, BOOT = Date.now(), lastFocus = null, act = null;
  var store = function () { try { localStorage.setItem("hsd:t", "1"); return localStorage } catch (e) { return sessionStorage } };   // localStorage: bertahan walau tab/aplikasi dimuat ulang atau dimatikan sistem
  var load = function () { try { var j = JSON.parse(store().getItem(PAGE) || "{}"); return j && typeof j === "object" ? j : {} } catch (e) { return mem } };
  var D = load();
  var save = function () { try { store().setItem(PAGE, JSON.stringify(D)) } catch (e) { mem = D } };
  var ok = function (f) {
    if (!f || !f.tagName || f.hasAttribute("data-nodraft") || f.readOnly || f.disabled) return false;
    if (f.tagName === "TEXTAREA" || f.tagName === "SELECT") return true;
    if (f.tagName !== "INPUT") return false;
    return /^(text|search|tel|url|email|number|date|time|datetime-local|month|week|)$/i.test(f.type || "") && !/^(pin|pw|pass|password|sandi)/i.test(f.id || f.name || "");
  };
  function key(f) {
    if (f.id) return "#" + f.id;
    if (f.name) return "n:" + f.name;
    var box = f.closest("[id]"), root = box || document.body, same = root.querySelectorAll(f.tagName.toLowerCase()), i = Array.prototype.indexOf.call(same, f);
    return (box ? "#" + box.id : "body") + ">" + f.tagName + (f.type ? ":" + f.type : "") + "[" + i + "]" + (f.placeholder ? ":" + f.placeholder.slice(0, 30) : "");
  }
  function put(k, v) {
    if (v === "" || v == null) delete D[k]; else { D[k] = { v: String(v).slice(0, 5000), t: Date.now(), o: 0 } }
    var ks = Object.keys(D); if (ks.length > MAX) ks.sort(function (a, b) { return D[a].t - D[b].t }).slice(0, ks.length - MAX).forEach(function (x) { delete D[x] });
    save();
  }
  /* ketikan pengguna */
  function onUser(e) {
    var f = e.target; if (!ok(f)) return; f._dk = 1; f._dv = f.value; if (e.isTrusted) lastFocus = { k: key(f), t: Date.now() }; put(key(f), f.value);
  }
  document.addEventListener("input", onUser, true); document.addEventListener("change", onUser, true);
  document.addEventListener("focusin", function (e) { if (ok(e.target)) lastFocus = { k: key(e.target), t: Date.now() } }, true);

  /* tombol kirim/simpan atau Enter: setelah itu kolom boleh kosong, jangan dipulihkan */
  var SEND = /kirim|send|simpan|save|submit|balas|reply|post|lapor|tambah|tambahkan|ok$|selesai|setuju|terapkan|masuk|daftar|oke|ya$/i;
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest("button,[role=button],input[type=button],input[type=submit]"); if (!b) return;
    var lb = (b.textContent || b.value || b.getAttribute("aria-label") || "").trim();
    act = { t: Date.now(), sc: SEND.test(lb) || b.type === "submit" ? (b.parentElement || b).closest("dialog,form,.card,section,aside,[id]") : null };
  }, true);
  document.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && ok(e.target) && e.target.tagName !== "TEXTAREA") act = { t: Date.now(), f: e.target }; else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && ok(e.target)) act = { t: Date.now(), f: e.target } }, true);
  var sent = function (f) { return act && Date.now() - act.t < 2500 && (act.f === f || (act.sc && act.sc.contains(f))) };

  /* kolom hilang dari layar -> draf-nya ditandai yatim (boleh dipulihkan ke kolom baru yang sama) */
  function orphan(node) {
    if (!node || node.nodeType !== 1) return;
    var fs = node.matches && node.matches("input,textarea,select") ? [node] : Array.prototype.slice.call(node.querySelectorAll("input,textarea,select"));
    var ch = 0;
    fs.forEach(function (f) {
      if (!f._dk || !ok(f)) return; var k = f._dkey || key(f), d = D[k]; if (!d) return;
      if (f.value !== f._dv || sent(f)) { delete D[k]; ch = 1 }   // diubah/dikosongkan oleh program, atau baru dikirim/disimpan: bukan draf lagi
      else if (d.v === f.value) d.o = Date.now();
    });
    if (ch) save();
  }
  function scan() {
    var fs = document.querySelectorAll("input,textarea,select"), now = Date.now(), ch = 0;
    for (var i = 0; i < fs.length; i++) {
      var f = fs[i]; if (!ok(f)) continue;
      if (!f._dk) {                                  // kolom baru
        f._dk = 1; var k = key(f), d = D[k]; f._dkey = k;
        if (d && now - d.t < TTL && d.v !== f.value && (d.o ? now - d.o < WIN : now - BOOT < BW)) {
          var opt = f.tagName === "SELECT" ? Array.prototype.some.call(f.options, function (o) { return o.value === d.v }) : true;
          if (opt) {
            var foc = lastFocus && lastFocus.k === k && now - lastFocus.t < 120e3 && (!document.activeElement || document.activeElement === document.body || document.activeElement === f);
            f.value = d.v; f._dv = f.value; d.o = 0;
            if (foc && f.tagName !== "SELECT") { try { f.focus({ preventScroll: true }); var n = f.value.length; f.setSelectionRange(n, n) } catch (e) {} }
            try { f.dispatchEvent(new Event("input", { bubbles: true })) } catch (e) {}
            f._dv = f.value; continue;
          }
        }
        f._dv = f.value;
      } else if (f.value !== f._dv) {                // diubah oleh program (bukan ketikan): buang draf agar tidak muncul lagi
        f._dv = f.value; k = f._dkey || key(f); if (D[k]) { delete D[k]; ch = 1 }
      }
    }
    if (ch) save();
  }
  var tm = 0, soon = function () { clearTimeout(tm); tm = setTimeout(scan, 60) };
  function boot() {
    scan();
    try {
      new MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) for (var j = 0; j < ms[i].removedNodes.length; j++) orphan(ms[i].removedNodes[j]);
        scan();                                          // langsung (sebelum ketikan berikutnya), bukan ditunda
      }).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    setInterval(scan, 1500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.HS_DRAFT = { scan: scan, clear: function () { D = {}; save() } };
})();
