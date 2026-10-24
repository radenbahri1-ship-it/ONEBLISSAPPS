/* ONE BLISS - MENU STAF (satu aplikasi untuk Owner, Resepsionis, Karyawan/HK)
   Dipakai di tiga halaman staf. Mengenali akun dari sesi login (/hs/me): menampilkan nama + peran, pindah halaman sesuai hak,
   ganti kata sandi sendiri, dan keluar. Di komputer hotel (localhost) tidak tampil karena tanpa akun. */
(function () {
  "use strict";
  if (window.OBSTAF) return; window.OBSTAF = 1;
  var RN = { owner: "Owner", resepsionis: "Resepsionis", hk: "Karyawan / HK" };
  var PG = { "/owner-lama3.html": ["👑", "Aplikasi Owner"], "/resepsionis-lama3.html": ["🛎", "Resepsionis"], "/karyawan-lama3.html": ["🧹", "Karyawan / HK"] };
  function el(t, css, html) { var e = document.createElement(t); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] }) }
  function build(m) {
    var btn = el("button", "position:fixed;top:calc(env(safe-area-inset-top,0px) + 6px);right:8px;z-index:99990;height:34px;min-width:34px;padding:0 10px;border-radius:17px;border:1px solid #b69a6b;background:rgba(20,17,14,.92);color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer;display:flex;align-items:center;gap:6px", "☰ <span style='max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" + esc((m.name || m.user || "").split(" ")[0]) + "</span>");
    btn.id = "obStafBtn"; btn.setAttribute("aria-label", "Menu akun");
    var box = el("div", "position:fixed;top:calc(env(safe-area-inset-top,0px) + 46px);right:8px;z-index:99991;width:min(270px,92vw);background:#14110e;border:1px solid #b69a6b;border-radius:12px;padding:12px;color:#fff;font:14px system-ui,sans-serif;display:none;box-shadow:0 8px 30px #000a");
    var cur = location.pathname, h = "<div style='font-weight:700'>" + esc(m.name || m.user) + "</div><div style='color:#a9a193;font-size:12px;margin-bottom:10px'>@" + esc(m.user) + " · " + esc(RN[m.role] || m.role) + "</div>";
    (m.pages || []).forEach(function (p) {
      var i = PG[p]; if (!i) return;
      h += "<a href='" + p + "' style='display:block;padding:10px;margin-bottom:6px;border-radius:8px;text-decoration:none;color:#fff;border:1px solid " + (p === cur ? "#b69a6b" : "#2c2722") + ";background:" + (p === cur ? "#b69a6b22" : "none") + "'>" + i[0] + " " + i[1] + (p === cur ? " <small style='color:#b69a6b'>(sedang dibuka)</small>" : "") + "</a>";
    });
    h += "<button id='obStafPw' style='width:100%;text-align:left;padding:10px;margin:4px 0 6px;border-radius:8px;border:1px solid #2c2722;background:none;color:#fff;font:inherit;cursor:pointer'>🔑 Ganti kata sandi</button>" +
         "<button id='obStafOut' style='width:100%;text-align:left;padding:10px;border-radius:8px;border:1px solid #5a2a2a;background:none;color:#fb7185;font:inherit;cursor:pointer'>🚪 Keluar</button>";
    box.innerHTML = h;
    btn.onclick = function (e) { e.stopPropagation(); box.style.display = box.style.display === "none" ? "block" : "none" };
    document.addEventListener("click", function (e) { if (!box.contains(e.target) && e.target !== btn) box.style.display = "none" });
    document.body.appendChild(btn); document.body.appendChild(box);
    document.getElementById("obStafOut").onclick = function () { location.href = "/logout" };
    document.getElementById("obStafPw").onclick = function () {
      var o = prompt("Kata sandi lama:"); if (o === null) return;
      var n = prompt("Kata sandi baru (minimal 6 karakter):"); if (n === null) return;
      if (n.length < 6) return alert("Kata sandi baru minimal 6 karakter.");
      var n2 = prompt("Ulangi kata sandi baru:"); if (n2 === null) return;
      if (n2 !== n) return alert("Kata sandi baru tidak sama.");
      fetch("/hs/acct", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "pass", old: o, new: n }) })
        .then(function (r) { return r.json() }).then(function (j) { alert(j.msg || (j.ok ? "Berhasil" : "Gagal")); if (j.ok) location.href = "/logout" })
        .catch(function () { alert("Tidak tersambung") });
    };
  }
  function go() {
    fetch("/hs/me", { cache: "no-store", credentials: "same-origin" }).then(function (r) { return r.json() }).then(function (m) {
      window.OBME = m; try { document.dispatchEvent(new CustomEvent("obme", { detail: m })) } catch (e) {}
      if (m && m.ok && !m.local) build(m);
    }).catch(function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
})();
