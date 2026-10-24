/* ONE BLISS - STATUS KAMAR TERPADU, 16 KODE (dipakai resepsionis, owner, dan housekeeping agar tampilannya selalu sama).
   Semua kode dihitung dari data kamar yang sama (guest, hk, oo, dnd, mur, so, skp, ea, cout ...), jadi tidak ada dasbor yang bisa berbeda.
   Data kamar boleh berbentuk dasbor resepsionis (hkCode, hkNote, hkBy, hkChk) atau API housekeeping (code, note, by, chk).

   KEBERSIHAN (otomatis dari Housekeeping)
     VCI  Vacant Clean Inspected  kosong, bersih, sudah dicek -> siap dijual
     VC   Vacant Clean            kosong, bersih, menunggu cek supervisor
     VD   Vacant Dirty            kosong, kotor
     CIP  Cleaning In Progress    sedang dibersihkan
     OC   Occupied Clean          terisi, bersih
     OD   Occupied Dirty          terisi, kotor
   TAMU / FRONT OFFICE
     DND  Do Not Disturb          tamu minta tidak diganggu (dari aplikasi tamu)
     MUR  Make Up Room            tamu minta kamar dibersihkan (dari aplikasi tamu)
     DO   Due Out                 jadwal check-out hari ini
     OVS  Overstay                lewat jam / tanggal check-out, tamu belum check-out
     EA   Expected Arrival        ada tamu reservasi yang datang hari ini
     SO   Sleep Out               tamu terdaftar tapi tidak menginap semalam (ditandai FO / HK)
     SKP  Skipper                 tamu pergi tanpa check-out (ditandai FO / HK)
   TIDAK DIJUAL (menahan penjualan, hanya resepsionis/owner yang membuka)
     OOS  Out of Service          sementara tidak dijual (perawatan ringan, deep cleaning)
     OOO  Out of Order            rusak / bermasalah berat
     BLK  Blocked                 ditahan (VIP, grup, pemilik, dsb.) */
(function () {
  if (window.RS) return;
  var CODES = {
    VCI: { t: "Kosong bersih · sudah dicek", s: "Siap dijual", c: "#34d399", f: "#06281d" },
    VC: { t: "Kosong bersih · menunggu cek", s: "Belum dicek supervisor", c: "#a7f3d0", f: "#06281d" },
    VD: { t: "Kosong kotor", s: "Menunggu Housekeeping", c: "#fb7185", f: "#3a0a14" },
    CIP: { t: "Sedang dibersihkan", s: "Cleaning in progress", c: "#38bdf8", f: "#04263a" },
    OC: { t: "Terisi bersih", s: "Tamu menginap", c: "#60a5fa", f: "#0b2243" },
    OD: { t: "Terisi kotor", s: "Perlu dibersihkan", c: "#f59e0b", f: "#3a2a00" },
    DND: { t: "Jangan diganggu", s: "Do Not Disturb", c: "#c084fc", f: "#2a0a4a" },
    MUR: { t: "Minta dibersihkan", s: "Make Up Room", c: "#2dd4bf", f: "#04302b" },
    DO: { t: "Check-out hari ini", s: "Due Out", c: "#fb923c", f: "#3a1a00" },
    OVS: { t: "Lewat jam check-out", s: "Overstay", c: "#e11d48", f: "#ffffff" },
    EA: { t: "Tamu datang hari ini", s: "Expected Arrival", c: "#818cf8", f: "#14123a" },
    SO: { t: "Sleep Out", s: "Tamu tidak menginap semalam", c: "#94a3b8", f: "#0f172a" },
    SKP: { t: "Skipper", s: "Tamu pergi tanpa check-out", c: "#92400e", f: "#ffffff" },
    OOS: { t: "Out of Service", s: "Sementara tidak dijual", c: "#eab308", f: "#2e2400" },
    OOO: { t: "Out of Order", s: "Rusak / bermasalah — tidak dijual", c: "#ef4444", f: "#ffffff" },
    BLK: { t: "Blocked", s: "Ditahan — tidak dijual", c: "#6b7280", f: "#ffffff" }
  };
  var LIST = ["VCI", "VC", "VD", "CIP", "OC", "OD", "DND", "MUR", "DO", "OVS", "EA", "SO", "SKP", "OOS", "OOO", "BLK"];
  var BLOCK = { OOO: 1, OOS: 1, BLK: 1 };
  var HKT = { dirty: "Kotor", doing: "Sedang dibersihkan", insp: "Bersih, menunggu cek supervisor", clean: "Bersih" };
  var E = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] }) };
  var host = function () { return RS.host || {} };
  function blockDirty() {
    try { var h = host(); if (typeof h.bd === "function") return !!h.bd(); if (window.CFG) return CFG.blockDirty !== 0 } catch (e) {}
    return true;
  }
  var today = function () { try { return new Date().toLocaleDateString("sv") } catch (e) { return "" } };
  var d10 = function (s) { return String(s || "").slice(0, 10) };
  var fdt = function (t) { try { return new Date(t).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) } catch (e) { return "" } };

  function info(r) {
    r = r || {};
    var g = !!r.guest, hk = String(r.hk || ""), hc = String(r.hkCode || r.code || ""), by = String(r.hkBy || r.by || ""), T = today();
    var bt = r.oo ? (String(r.ooT || "OOO") === "OO" ? "OOO" : (BLOCK[r.ooT] ? r.ooT : "OOO")) : "";
    var note = String(r.hkNote || r.note || ""), ooNote = String(r.ooNote || note || "");
    var base = g ? ((hc === "OD" || hc === "OC") ? hc : (hk === "dirty" ? "OD" : "OC")) : hk === "doing" ? "CIP" : hk === "dirty" ? "VD" : hk === "insp" ? "VC" : "VCI";
    var cout = d10(r.cout), act = [];
    if (g) {
      if (r.skp) act.push("SKP");
      if (r.ovD || r.ovd || (cout && cout < T)) act.push("OVS");
      if (r.dnd) act.push("DND");
      if (r.mur) act.push("MUR");
      if (r.so) act.push("SO");
      if (cout && cout === T) act.push("DO");
    } else if (r.ea) act.push("EA");
    var code = (!g && bt) ? bt : act.length && g ? act[0] : base;
    var tags = [];
    if (g) { act.forEach(function (x) { if (x !== code) tags.push(x) }); if (base !== code) tags.push(base); if (bt) tags.push(bt) }
    else { act.forEach(function (x) { if (x !== code) tags.push(x) }); if (base !== code) tags.push(base); if (bt && bt !== code) tags.push(bt) }
    var sub = "";
    if (!g && !bt) sub = hk === "doing" ? "Sedang dibersihkan" + (by ? " oleh " + by : "") : hk === "insp" ? "Bersih, menunggu cek supervisor" : hk === "dirty" ? "Menunggu Housekeeping" : "";
    var sell = true, why = "";
    if (g) { sell = false; why = "Sedang terisi tamu" + (bt ? "; " + bt + ": " + (ooNote || "-") + " — tidak dijual setelah check-out" : "") }
    else if (bt) { sell = false; why = bt + (ooNote ? " — " + ooNote : " — " + CODES[bt].s) }
    else if (blockDirty() && (hk === "dirty" || hk === "doing" || hk === "insp")) { sell = false; why = hk === "insp" ? "Menunggu cek supervisor" : hk === "doing" ? "Sedang dibersihkan" : "Belum dibersihkan" }
    return { code: code, base: base, tags: tags, label: CODES[code].t, sub: sub || CODES[code].s, sell: sell, why: why, guest: g, oo: !!bt, bt: bt, hk: hk, by: by,
      note: note, ooNote: ooNote, ooBy: String(r.ooBy || ""), ooAt: +r.ooAt || 0, chk: String(r.hkChk || r.chk || ""), hc: hc };
  }
  var match = function (r, code) { var i = info(r); return i.code === code || i.tags.indexOf(code) >= 0 };
  function chip(r) { var i = info(r); return '<span class="rsc rs-' + i.code + '" title="' + E(i.label) + '">' + i.code + "</span>" }
  /* kode utama + kode tambahan (kecil) */
  function chips(r) {
    var i = info(r); return '<span class="rsc rs-' + i.code + '" title="' + E(i.label) + '">' + i.code + "</span>" +
      i.tags.map(function (t) { return '<span class="rsc rst rs-' + t + '" title="' + E(CODES[t].t) + '">' + t + "</span>" }).join("");
  }
  function line(r) {
    var i = info(r), h = "";
    if (i.oo) h += '<span class="rss no">⛔ ' + (i.guest ? i.bt + " — tidak dijual setelah check-out" : i.bt + " — tidak bisa dijual") + "</span>" + (i.ooNote ? '<small class="rsn">📝 ' + E(i.ooNote) + "</small>" : "");
    else if (i.guest) h += '<span class="rss gr">Terisi tamu</span>' + (i.note ? '<small class="rsn">📝 ' + E(i.note) + "</small>" : "");
    else h += '<span class="rss ' + (i.sell ? "ok" : "wt") + '">' + (i.sell ? "✔ Bisa dijual" : "⏳ Belum bisa dijual") + "</span>" + (i.sub && !i.sell ? '<small class="rsn">' + E(i.sub) + "</small>" : "") + (i.note ? '<small class="rsn">📝 ' + E(i.note) + "</small>" : "");
    return '<div class="rsl">' + h + "</div>";
  }
  function detail(r) {
    var i = info(r), k = function (a, b) { return b ? '<div class="rsk"><span>' + a + "</span><b>" + b + "</b></div>" : "" }, h = "";
    h += k("Status jual", i.sell ? '<span class="rss ok">✔ Bisa dijual</span>' : '<span class="rss ' + (i.oo ? "no" : i.guest ? "gr" : "wt") + '">' + (i.oo ? "⛔ " : "") + E(i.why) + "</span>");
    if (i.tags.length) h += k("Tanda lain", i.tags.map(function (t) { return '<span class="rsc rst rs-' + t + '" title="' + E(CODES[t].t) + '">' + t + "</span> " + E(CODES[t].t) }).join("<br>"));
    if (i.guest) h += k("Tamu", E(r.name || "")) + k("Menginap", r.cin || r.cout ? E((r.cin || "") + " → " + (r.cout || "")) : "");
    h += k("Kebersihan", E(HKT[i.hk] || (i.guest ? "—" : "Bersih")) + (i.by && (i.hk === "doing" || i.hk === "insp") ? " · " + E(i.by) : ""));
    h += k("Dicek oleh", E(i.chk));
    h += k("Catatan HK", E(i.note));
    if (i.oo) h += k("Diblokir oleh", E(i.ooBy) + (i.ooAt ? " · " + E(fdt(i.ooAt)) : "")) + k("Alasan " + i.bt, E(i.ooNote));
    return h;
  }
  /* rekap jumlah kamar per kode (klik = filter) */
  function recap(list, active) {
    var n = {}; LIST.forEach(function (c) { n[c] = 0 });
    (list || []).forEach(function (r) { var i = info(r); n[i.code]++; i.tags.forEach(function (t) { n[t]++ }) });
    return '<div class="rsr">' + LIST.filter(function (c) { return n[c] > 0 || active === c }).map(function (c) {
      return '<button type="button" class="rsf' + (active === c ? " on" : "") + '" onclick="RS.filter(\'' + c + '\')" title="' + E(CODES[c].t) + '"><span class="rsc rs-' + c + '">' + c + "</span> " + n[c] + "</button>";
    }).join("") + '<button type="button" class="rsf" onclick="RS.filter(\'\')">Semua</button><button type="button" class="rsf" onclick="RS.legend()">ℹ 16 status</button></div>';
  }
  function filter(c) { var h = host(); if (h.filter) h.filter(c) }

  var CSS = ".rsc{display:inline-block;font:800 11px/1 system-ui,sans-serif;letter-spacing:.04em;padding:4px 7px;border-radius:6px;vertical-align:middle;margin-right:3px}.rsc.rst{font-size:9px;padding:3px 5px;opacity:.9}" +
    Object.keys(CODES).map(function (k) { return ".rs-" + k + "{background:" + CODES[k].c + ";color:" + CODES[k].f + "}" }).join("") +
    ".rsl{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;margin:4px 0}.rsn{display:block;width:100%;font-size:12px;color:#cfc9bd}" +
    ".rss{font:600 11px system-ui,sans-serif;padding:2px 8px;border-radius:99px;background:#ffffff14;color:#e8e2d6;white-space:nowrap}.rss.ok{background:#34d39926;color:#34d399}.rss.no{background:#ef444440;color:#fecaca}.rss.wt{background:#fbbf2426;color:#fbbf24}.rss.gr{background:#60a5fa22;color:#93c5fd}" +
    ".rsr{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.rsf{font:600 12px system-ui,sans-serif;border:1px solid #2c2722;background:#1c1814;color:#f5f0e6;border-radius:99px;padding:4px 10px 4px 5px;cursor:pointer}.rsf.on{border-color:#b69a6b;background:#2a2218}.rsf .rsc{margin-right:2px}" +
    "dialog.rsd{border:1px solid #2c2722;border-radius:16px;background:#14110e;color:#f5f0e6;padding:0;width:min(460px,94vw);max-height:90vh;font:14px/1.4 system-ui,sans-serif}dialog.rsd::backdrop{background:rgba(0,0,0,.7)}" +
    ".rsb{padding:16px;overflow:auto;max-height:90vh;box-sizing:border-box}.rsh{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.rsh b{font-size:18px}.rsh small{display:block;color:#a9a193}.rsh button{background:none;border:0;color:#a9a193;font-size:26px;line-height:1;cursor:pointer}" +
    ".rsbig{display:flex;align-items:center;gap:12px;margin:12px 0}.rsbig .rsc{font-size:22px;padding:10px 14px}.rsbig div{font-size:13px;color:#cfc9bd}.rsbig b{display:block;font-size:16px;color:#f5f0e6}" +
    ".rsk{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid #2c2722}.rsk span{color:#a9a193}.rsk b{font-weight:600;text-align:right}" +
    ".rsa{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.rsa button,.rsa textarea{font:inherit;border-radius:10px;border:1px solid #2c2722;background:#1c1814;color:#f5f0e6;padding:10px;cursor:pointer}.rsa .p{background:#b69a6b;color:#0a0a0a;border-color:#b69a6b;font-weight:700}.rsa .d{background:#9f1239;border-color:#9f1239;font-weight:700}.rsa .w{grid-column:1/-1}.rsa textarea{cursor:text;min-height:60px;resize:vertical}" +
    ".rsg{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;grid-column:1/-1}.rsg button{padding:8px 4px;font-size:12px}.rsy{display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-top:1px solid #2c2722}.rsy .rsc{min-width:34px;text-align:center}.rsy small{display:block;color:#a9a193}";
  var st = document.createElement("style"); st.textContent = CSS; (document.head || document.documentElement).appendChild(st);

  var dlg = null, curN = null;
  function dialog() {
    if (!dlg) { dlg = document.createElement("dialog"); dlg.className = "rsd"; dlg.id = "rsPop"; document.body.appendChild(dlg); dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close() }) }
    return dlg;
  }
  function pop(n) {
    var h = host(), r = h.get ? h.get(String(n)) : null; if (!r) return;
    curN = String(n);
    var d = dialog(), i = info(r), acts = h.actions ? (h.actions(curN, r) || []) : [], A = "";
    acts.forEach(function (a, x) { A += '<button class="' + (a.c || "") + (a.w === false ? "" : " w") + '" data-a="' + x + '">' + E(a.t) + "</button>" });
    if (h.setFlag) {
      if (i.guest) A += '<button class="w" data-fl="so:' + (r.so ? 0 : 1) + '">' + (r.so ? "↺ Hapus tanda Sleep Out (SO)" : "🌙 Tandai Sleep Out (SO) — tamu tidak menginap") + '</button><button class="w" data-fl="skp:' + (r.skp ? 0 : 1) + '">' + (r.skp ? "↺ Hapus tanda Skipper (SKP)" : "🏃 Tandai Skipper (SKP) — tamu pergi tanpa check-out") + "</button>";
    }
    if (h.setOO) {
      if (i.oo) A += '<button class="p w" data-oo="0">✔ Selesai — buka blokir ' + i.bt + " (bisa dijual lagi)</button>";
      else A += '<textarea class="w" id="rsOoN" maxlength="200" placeholder="Alasan / masalah kamar (mis. AC bocor, kunci rusak, ditahan untuk VIP)"></textarea>' +
        '<div class="rsg"><button class="d" data-oo="1:OOO">⛔ OOO<br><small>Rusak</small></button><button data-oo="1:OOS">🛠 OOS<br><small>Layanan</small></button><button data-oo="1:BLK">🔒 BLK<br><small>Tahan</small></button></div>';
    }
    d.innerHTML = '<div class="rsb"><div class="rsh"><div><b>Kamar ' + E(curN) + "</b><small>" + E(r.type || "") + '</small></div><button aria-label="Tutup" id="rsX">×</button></div>' +
      '<div class="rsbig"><span class="rsc rs-' + i.code + '">' + i.code + "</span><div><b>" + E(i.label) + "</b>" + E(i.sub) + "</div></div>" + detail(r) +
      (A ? '<div class="rsa">' + A + "</div>" : "") + "</div>";
    d.querySelector("#rsX").onclick = function () { d.close() };
    var fin = function () { d.close(); if (h.refresh) h.refresh() };
    d.querySelectorAll("[data-a]").forEach(function (b) { b.onclick = function () { var a = acts[+b.getAttribute("data-a")]; d.close(); try { a.f(curN, r) } catch (e) {} } });
    d.querySelectorAll("[data-fl]").forEach(function (b) { b.onclick = function () { var p = b.getAttribute("data-fl").split(":"); b.disabled = true; try { Promise.resolve(h.setFlag(curN, p[0], p[1] === "1")).then(fin, fin) } catch (e) { fin() } } });
    d.querySelectorAll("[data-oo]").forEach(function (b) {
      b.onclick = function () {
        var p = b.getAttribute("data-oo").split(":"), v = p[0] === "1", nt = v ? ((d.querySelector("#rsOoN") || {}).value || "").trim() : "";
        if (v && !nt && !confirm("Tandai " + p[1] + " tanpa alasan?")) return;
        b.disabled = true; try { Promise.resolve(h.setOO(curN, v, nt, p[1])).then(fin, fin) } catch (e) { fin() }
      };
    });
    if (!d.open) d.showModal();
  }
  function legend() {
    var d = dialog(); curN = null;
    d.innerHTML = '<div class="rsb"><div class="rsh"><div><b>16 status kamar</b><small>Kode yang sama di Resepsionis, Owner & Housekeeping</small></div><button aria-label="Tutup" id="rsX">×</button></div>' +
      LIST.map(function (c) { return '<div class="rsy"><span class="rsc rs-' + c + '">' + c + "</span><div><b>" + E(CODES[c].t) + "</b><small>" + E(CODES[c].s) + (BLOCK[c] ? " · TIDAK DIJUAL" : "") + "</small></div></div>" }).join("") + "</div>";
    d.querySelector("#rsX").onclick = function () { d.close() };
    if (!d.open) d.showModal();
  }
  window.RS = { CODES: CODES, LIST: LIST, BLOCK: BLOCK, info: info, match: match, chip: chip, chips: chips, line: line, detail: detail, recap: recap, filter: filter, legend: legend, pop: pop, host: null };
})();
