/* ONE BLISS - INTERKOM: panggilan suara antar tamu, resepsionis, owner, dan karyawan/HK (WebRTC, suara langsung antar perangkat).
   Dipakai oleh semua halaman. Pengaturan siapa-boleh-memanggil-siapa ada di tab "Panggilan" milik owner (hs_cfg.ic).
   Id peserta: 'R' resepsionis | 'O' owner | 'K:<id karyawan>' | 'T:<no kamar>' tamu.
   Pesan lewat saluran yang sama dengan halaman lain: {type:'ic2', k, cid, fid, fn, tid, to?, sdp?, ice?, why?}
   k = ring | accept | reject | end | offer | answer | here | who | dir | dirq                                     */
(function () {
  if (window.IC) return;
  var SRC = (document.currentScript || {}).src || "", GUEST = /[?&]g=1/.test(SRC), CH = "hotel-sim";
  var $ = function (id) { return document.getElementById(id) };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] }) };
  var jp = function (k) { try { return JSON.parse(localStorage.getItem(k)) } catch (e) { return null } };

  /* ---------- kebijakan (dipakai juga oleh tab owner & hub resepsionis) ---------- */
  var DEF = { on: 1, res: 1, own: 1, acc: 1, app: 1, rm: { m: "all", l: [] }, em: { m: "all", l: [] },
    mx: { T: { R: 1, K: 1, O: 0, T: 1 }, K: { R: 1, K: 1, O: 1, T: 1 }, O: { R: 1, K: 1, O: 0, T: 1 }, R: { R: 0, K: 1, O: 1, T: 1 } } };
  function norm(x) {
    x = x && typeof x === "object" ? x : {};
    var o = JSON.parse(JSON.stringify(DEF));
    if (x.on != null) o.on = x.on ? 1 : 0;
    if (x.res != null) o.res = x.res ? 1 : 0;
    if (x.own != null) o.own = x.own ? 1 : 0;
    if (x.acc != null) o.acc = x.acc ? 1 : 0;
    if (x.app != null) o.app = x.app ? 1 : 0;
    ["rm", "em"].forEach(function (k) {
      if (x[k] && ["all", "sel", "none"].indexOf(x[k].m) >= 0) { o[k].m = x[k].m; o[k].l = Array.isArray(x[k].l) ? x[k].l.map(function (v) { return String(v).slice(0, 40) }).slice(0, 500) : [] }
    });
    "TKOR".split("").forEach(function (g) { "TKOR".split("").forEach(function (h) { if (x.mx && x.mx[g] && x.mx[g][h] != null) o.mx[g][h] = x.mx[g][h] ? 1 : 0 }) });
    o.mx.O.O = 0; o.mx.R.R = 0;
    return o;
  }
  var grp = function (id) { id = String(id || ""); return id === "R" || id === "O" ? id : id.indexOf("A:") === 0 ? "A" : id.indexOf("U:") === 0 ? "U" : id.indexOf("K:") === 0 ? "K" : id.indexOf("T:") === 0 ? "T" : "" };
  function has(ic, id) {
    var g = grp(id); if (!g) return false;
    if (g === "R") return !!ic.res; if (g === "O") return !!ic.own; if (g === "A" || g === "U") return true;
    var k = g === "K" ? ic.em : ic.rm, v = String(id).slice(2);
    return k.m === "all" || (k.m === "sel" && k.l.indexOf(v) >= 0);
  }
  function can(ic, a, b) { var ga = grp(a), gb = grp(b); if (ga === "U" || gb === "U") return !!(ic.on && ic.app !== 0 && ((gb === "U" && (a === "R" || a === "O")) || (ga === "U" && b === "R" && ic.res)));   /* akun aplikasi: dipanggil oleh Resepsionis/Owner, dan boleh memanggil Resepsionis */ if (ga === "A" || gb === "A") return !!(ic.on && ic.acc && ga === "A" && gb === "A" && a !== b); return !!(ic.on && a !== b && ga && gb && has(ic, a) && has(ic, b) && ic.mx[ga] && ic.mx[ga][gb]) }
  var cfgIc = function () { return norm((jp("hs_cfg") || {}).ic) };
  var roomsAll = function () { return jp("hs_rooms") || {} };
  var staffAll = function () { var s = jp("hs_staff"); return Array.isArray(s) ? s : [] };
  var byNum = function (a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true }) };

  var sig = "", self = null, bc = null, call = null, GD = null, sendG = null, seen = {}, open = false, root = null, micOn = true, lvlL = 0, lvlR = 0, ALT = null, seenP = {}, seenO = {}, doneR = {}, ACC = [], RL = { owner: "Owner", resepsionis: "Resepsionis", hk: "Karyawan / HK" };
  var isOn = function (id) { if (self && self.id === id) return true; if (grp(id) === "T") return null; return Date.now() - (seen[id] || 0) < 35000 || Date.now() - (seenP[id] || 0) < 60000 };
  var isOpen = function (id) { return Date.now() - (seenO[id] || 0) < 35000 };
  function allIds() {
    var a = ["R", "O"]; staffAll().forEach(function (s) { if (s.on !== false) a.push("K:" + s.id) }); ACC.forEach(function (u) { a.push("A:" + u.u) }); appAcc().forEach(function (u) { a.push("U:" + u.id) });
    var rr = roomsAll(); Object.keys(rr).sort(byNum).forEach(function (n) { if (rr[n].guest) a.push("T:" + n) }); return a;
  }
  /* akun aplikasi tamu/pengunjung (hs_accts, disinkronkan server ke halaman staf): yang aktif & tidak diblokir bisa ditelepon */
  var appAcc = function () { if (GUEST) return []; var x = jp("hs_accts"); return Array.isArray(x) ? x.filter(function (u) { return u && u.id && u.st === "ok" && !u.bl }) : [] };
  function nameOf(id) {
    if (id === "R") return { name: "Resepsionis", sub: "Front office" }; if (id === "O") return { name: "Owner", sub: "Pemilik" };
    if (grp(id) === "U") { var ua = appAcc().filter(function (x) { return "U:" + x.id === id })[0]; return { name: ua ? ua.name : id.slice(2), sub: ua ? "@" + ua.user : "" } }
    if (grp(id) === "A") { var u = ACC.filter(function (x) { return "A:" + x.u === id })[0]; return { name: u ? u.name : id.slice(2), sub: u ? (RL[u.role] || u.role) : "" } }
    if (grp(id) === "K") { var s = staffAll().filter(function (x) { return "K:" + x.id === id })[0]; return { name: s ? s.name : id, sub: s ? s.role : "" } }
    var n = String(id).slice(2), r = roomsAll()[n]; return { name: "Kamar " + n, sub: r && r.name ? r.name : "" };
  }
  /* daftar kontak lengkap untuk halaman ini: kontak bawaan (resepsionis/owner/karyawan/kamar) + akun staf lain.
     Karyawan yang punya akun hanya tampil sekali (sebagai akun). */
  function dirMine() {
    var a = dirFor(self.id), ic = cfgIc();
    if (ALT && ic.acc) { var hide = {}; ACC.forEach(function (u) { if (u.emp) hide["K:" + u.emp] = 1 }); a = a.filter(function (c) { return !hide[c.id] }).concat(dirFor(ALT.id)) }
    return a;
  }
  function dirFor(me) { var ic = cfgIc(); return allIds().filter(function (id) { return can(ic, me, id) }).map(function (id) { var n = nameOf(id); return { id: id, name: n.name, sub: n.sub, on: isOn(id) } }) }
  function inbound(me) { var ic = cfgIc(); return allIds().filter(function (id) { return can(ic, id, me) }) }

  /* ---------- pesan ---------- */
  function out(tid, k, x) {
    var m = Object.assign({ type: "ic2", k: k, tid: tid }, x || {}), fm = m.__me; delete m.__me;
    if (GUEST) { if (sendG) sendG(m); return }
    var fid = fm || (call && call.peer && call.peer.id === tid && call.me) || self.id;   // satu halaman bisa dikenal sebagai 'R'/'O'/'K:..' dan sebagai akun 'A:..'
    m.fid = fid; m.fn = ALT && fid === ALT.id ? ALT.name : self.name;
    if (grp(tid) === "T") m.to = String(tid).slice(2);
    if (IC.hook) try { IC.hook(m) } catch (e) {}
    if (bc) bc.postMessage(m);
  }
  function beacon() { if (GUEST || !self || !bc) return; bc.postMessage({ type: "ic2", k: "here", fid: self.id, fn: self.name, role: self.role || "" }); if (ALT) bc.postMessage({ type: "ic2", k: "here", fid: ALT.id, fn: ALT.name, role: ALT.role || "" }) }
  var cleanIce = function (a) { return (Array.isArray(a) ? a : []).slice(0, 6).filter(function (s) { return s && (typeof s.urls === "string" || Array.isArray(s.urls)) }).map(function (s) { var o = { urls: s.urls }; if (s.username) o.username = String(s.username); if (s.credential) o.credential = String(s.credential); return o }) };
  var iceList = function () { var a = cleanIce(GUEST ? (GD && GD.ice) : window.HS_ICE); return a.length ? a : [{ urls: "stun:stun.l.google.com:19302" }] };

  function onMsg(m) {
    if (!m || m.type !== "ic2" || !self) return;
    if (m.k === "here") { if (m.fid) { seen[m.fid] = Date.now(); seenO[m.fid] = Date.now() } return }
    if (m.k === "herep") { (m.list || []).forEach(function (x) { if (x && x.id) seenP["U:" + x.id] = Date.now() }); return }
    if (m.k === "who") { beacon(); return }
    var myid = m.tid === self.id ? self.id : (ALT && m.tid === ALT.id ? ALT.id : ""); if (!myid) return;
    if (m.k === "dir") { if (GUEST) { GD = m; render() } return }
    if (m.k === "ring") return onRing(m);
    if (!call || call.cid !== m.cid || call.peer.id !== m.fid || (call.me && call.me !== myid)) return;
    if (m.k === "accept" && call.dir === "out" && call.s === "ring") { clearTimeout(call.to); call.s = "conn"; ui(); startOffer() }
    else if (m.k === "offer") onOffer(m);
    else if (m.k === "answer") onAnswer(m);
    else if (m.k === "reject") finish("Ditolak" + (m.why ? " (" + m.why + ")" : ""), true);
    else if (m.k === "end") finish(call.s === "live" ? "Panggilan selesai" : (m.why === "tidak dijawab" ? "Panggilan terlewat" : "Panggilan dibatalkan" + (m.why ? " (" + m.why + ")" : "")), true);
  }
  function onRing(m) {
    var ic = cfgIc(), ok = GUEST ? (GD && GD.inn && GD.inn.indexOf(m.fid) >= 0 && (GD.on || self.id.indexOf("U:") === 0)) : can(ic, m.fid, m.tid);
    if (!ok) return out(m.fid, "reject", { cid: m.cid, why: "tidak diizinkan", __me: m.tid });
    if (doneR[m.cid] || (call && call.cid === m.cid)) return;   /* dering ulang yang sama (aplikasi dibuka dari notifikasi): abaikan */
    if (call) return out(m.fid, "reject", { cid: m.cid, why: "sibuk", __me: m.tid });
    doneR[m.cid] = 1;
    call = { cid: m.cid, peer: { id: m.fid, name: m.fn || nameOf(m.fid).name }, dir: "in", s: "ring", t0: 0, me: m.tid };
    micOn = true; ringStart();
    try { if (document.hidden && window.HS_NOTIFY) window.HS_NOTIFY("📞 Panggilan suara masuk", call.peer.name, "ic2") } catch (e) {}
    var c = call; c.to = setTimeout(function () { if (call === c && c.s === "ring") { out(c.peer.id, "end", { cid: c.cid, why: "tidak dijawab" }); finish("Panggilan terlewat dari " + c.peer.name) } }, 45000);
    ui();
  }

  /* ---------- WebRTC ---------- */
  var secure = function () { return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) };
  async function mic() {
    if (!secure()) { toast("Panggilan suara butuh alamat HTTPS. Buka lewat alamat aman (bukan http://IP)."); return null }
    try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }) }
    catch (e) { toast("Izinkan akses mikrofon di browser untuk memakai panggilan suara"); return null }
  }
  var gather = function (p) { return new Promise(function (res) { if (p.iceGatheringState === "complete") return res(); var f = function () { if (p.iceGatheringState === "complete") { p.removeEventListener("icegatheringstatechange", f); res() } }; p.addEventListener("icegatheringstatechange", f); setTimeout(res, 4000) }) };
  function levelOf(stream, cb) { try { var c = new (window.AudioContext || window.webkitAudioContext)(), an = c.createAnalyser(); an.fftSize = 256; c.createMediaStreamSource(stream).connect(an); var d = new Uint8Array(an.frequencyBinCount), t = setInterval(function () { an.getByteFrequencyData(d); var s = 0; for (var i = 0; i < d.length; i++) s += d[i]; cb(s / d.length / 255) }, 100); return function () { clearInterval(t); try { c.close() } catch (e) {} } } catch (e) { return function () {} } }
  function mkPc(ice) {
    var c = call, p = c.pc = new RTCPeerConnection({ iceServers: ice });
    c.audio = document.body.appendChild(Object.assign(document.createElement("audio"), { autoplay: true, playsInline: true }));
    p.ontrack = function (e) { var s = e.streams[0] || new MediaStream([e.track]); c.audio.srcObject = s; c.audio.play().catch(function () { document.addEventListener("click", function () { c.audio && c.audio.play() }, { once: true }) }); c.stR && c.stR(); c.stR = levelOf(s, function (v) { lvlR = v }) };
    p.onconnectionstatechange = function () {
      if (call !== c) return; var st = p.connectionState;
      if (st === "connected") { clearTimeout(c.dc); if (c.s !== "live") { c.s = "live"; c.t0 = Date.now(); ringStop(); ui() } }
      else if (st === "failed") { out(c.peer.id, "end", { cid: c.cid, why: "koneksi gagal" }); finish("Koneksi suara gagal (jaringan mungkin butuh server TURN)") }
      else if (st === "disconnected") { clearTimeout(c.dc); c.dc = setTimeout(function () { if (call === c && p.connectionState !== "connected") { out(c.peer.id, "end", { cid: c.cid, why: "koneksi terputus" }); finish("Koneksi terputus") } }, 8000) }
    };
    c.stream.getTracks().forEach(function (t) { t.enabled = micOn; p.addTrack(t, c.stream) });
    c.stL = levelOf(c.stream, function (v) { lvlL = v });
    return p;
  }
  async function startOffer() {
    var c = call, p; try { p = mkPc(iceList()); await p.setLocalDescription(await p.createOffer()); await gather(p) } catch (e) { out(c.peer.id, "end", { cid: c.cid, why: "gagal menyiapkan suara" }); return finish("Gagal menyiapkan suara: " + (e.message || e)) }
    if (call !== c) return; out(c.peer.id, "offer", { cid: c.cid, sdp: p.localDescription.sdp, ice: iceList() });
  }
  async function onOffer(m) {
    var c = call; if (!c || c.dir !== "in" || !c.stream || c.pc || !m.sdp) return;
    var ice = cleanIce(m.ice), p; try { p = mkPc(ice.length ? ice : iceList()); await p.setRemoteDescription({ type: "offer", sdp: String(m.sdp).slice(0, 30000) }); await p.setLocalDescription(await p.createAnswer()); await gather(p) } catch (e) { out(c.peer.id, "end", { cid: c.cid, why: "gagal menyiapkan suara" }); return finish("Gagal menyiapkan suara: " + (e.message || e)) }
    if (call !== c) return; out(c.peer.id, "answer", { cid: c.cid, sdp: p.localDescription.sdp });
  }
  function onAnswer(m) { if (call && call.pc && call.dir === "out" && call.pc.signalingState === "have-local-offer" && m.sdp) call.pc.setRemoteDescription({ type: "answer", sdp: String(m.sdp).slice(0, 30000) }).catch(function (e) { out(call.peer.id, "end", { cid: call.cid, why: "gagal" }); finish("Jawaban suara gagal: " + e.message) }) }

  async function callTo(id) {
    if (!self || !featOn()) return toast("Fitur panggilan belum diaktifkan untuk Anda");
    if (call) return toast("Anda sedang dalam panggilan");
    var me = grp(id) === "A" ? (ALT && ALT.id) : self.id;
    if (!GUEST && (!me || !can(cfgIc(), me, id))) return toast("Panggilan ke " + nameOf(id).name + " tidak diizinkan");
    var s = await mic(); if (!s) return; if (call) { s.getTracks().forEach(function (t) { t.stop() }); return }
    var cid = "C" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4), nm = nameOf(id).name; micOn = true;
    var c = call = { cid: cid, peer: { id: id, name: nm }, dir: "out", s: "ring", stream: s, t0: 0, me: me };
    out(id, "ring", { cid: cid });
    c.to = setTimeout(function () { if (call === c && c.s === "ring") { out(id, "end", { cid: cid, why: "tidak dijawab" }); finish("Tidak dijawab oleh " + nm) } }, 45000);
    open = true; ui();
  }
  async function acceptIn() {
    var c = call; if (!c || c.dir !== "in" || c.s !== "ring") return; ringStop(); clearTimeout(c.to);
    var s = await mic(); if (call !== c) { if (s) s.getTracks().forEach(function (t) { t.stop() }); return }
    if (!s) { out(c.peer.id, "reject", { cid: c.cid, why: "mikrofon tidak tersedia" }); return finish("Panggilan ditolak: mikrofon tidak tersedia") }
    c.stream = s; c.s = "conn"; open = true; out(c.peer.id, "accept", { cid: c.cid }); ui();
  }
  function rejectIn() { var c = call; if (!c || c.dir !== "in") return; out(c.peer.id, "reject", { cid: c.cid, why: "ditolak" }); finish("Panggilan ditolak") }
  function hangup() { var c = call; if (!c) return; out(c.peer.id, "end", { cid: c.cid, why: c.s === "live" ? "" : "dibatalkan" }); finish(c.s === "live" ? "Panggilan selesai" : "Panggilan dibatalkan") }
  function finish(msg, silent) {
    var c = call; if (!c) return; call = null; ringStop(); clearTimeout(c.to); clearTimeout(c.dc);
    try { c.pc && c.pc.close() } catch (e) {} if (c.stream) c.stream.getTracks().forEach(function (t) { t.stop() });
    if (c.audio) { c.audio.srcObject = null; c.audio.remove() } c.stL && c.stL(); c.stR && c.stR(); lvlL = lvlR = 0; micOn = true;
    if (msg) toast(msg); ui();
  }

  /* ---------- nada dering ---------- */
  var ac = null, rt = 0;
  function ringStart() {
    ringStop();
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); var b = function () { if (!ac) return; var o = ac.createOscillator(), g = ac.createGain(); o.type = "sine"; o.frequency.value = 880; g.gain.value = 0.18; o.connect(g); g.connect(ac.destination); o.start(); o.frequency.setValueAtTime(660, ac.currentTime + 0.2); o.stop(ac.currentTime + 0.42) }; b(); rt = setInterval(function () { b(); try { navigator.vibrate && navigator.vibrate([250, 120, 250]) } catch (e) {} }, 1600) } catch (e) {}
  }
  function ringStop() { clearInterval(rt); rt = 0; try { ac && ac.close() } catch (e) {} ac = null; try { navigator.vibrate && navigator.vibrate(0) } catch (e) {} }

  /* ---------- tampilan ---------- */
  var CSS = ".icfab{position:fixed;right:14px;bottom:calc(88px + env(safe-area-inset-bottom,0px));z-index:2147482000;width:54px;height:54px;border-radius:50%;border:1px solid #b69a6b;background:#14110e;color:#fff;font-size:24px;box-shadow:0 6px 22px rgba(0,0,0,.55);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-direction:column;line-height:1}.icfab.live{background:#065f46;border-color:#34d399}.icfab.gst{bottom:calc(134px + env(safe-area-inset-bottom,0px))}.icfab small{font-size:10px;margin-top:1px}" +
    "dialog.icd{border:0;padding:0;margin:0;max-width:none;max-height:none;width:100%;height:100%;background:transparent;color:#fff;font:15px/1.4 system-ui,'Segoe UI',sans-serif}dialog.icd::backdrop{background:rgba(0,0,0,.72)}dialog.icd[open]{display:flex;align-items:flex-end;justify-content:center}@media(min-width:640px){dialog.icd[open]{align-items:center}}" +
    ".icbox{width:100%;max-width:440px;max-height:88vh;display:flex;flex-direction:column;background:#14110e;border:1px solid #2c2722;border-radius:18px 18px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.6)}@media(min-width:640px){.icbox{border-radius:18px}}" +
    ".ich{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #2c2722}.ich b{font-size:16px;color:#e2ae2f}.ich button{background:none;border:0;color:#a9a193;font-size:26px;cursor:pointer;line-height:1}" +
    "#icB{padding:12px 14px 18px;overflow:auto}.icq{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid #2c2722;background:#0a0a0a;color:#fff;font:inherit;margin-bottom:8px}" +
    ".icg{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a9a193;margin:12px 2px 4px}.icr{display:flex;align-items:center;gap:10px;padding:9px 6px;border-bottom:1px solid #2c2722}.icr .n{flex:1;min-width:0}.icr .n b{display:block;font-weight:600}.icr .n span{font-size:12px;color:#a9a193}" +
    ".icd1{width:9px;height:9px;border-radius:50%;background:#4b4640;flex:none}.icd1.on{background:#34d399}.icd1.nn{background:#8b7d62}.icbtn{border:0;border-radius:10px;padding:9px 14px;background:#b69a6b;color:#0a0a0a;font-weight:700;cursor:pointer;font-size:14px}.icbtn:disabled{opacity:.4}.icbtn.r{background:#9f1239;color:#fff}.icbtn.g{background:#1c1814;color:#fff;border:1px solid #2c2722}" +
    ".icemp{padding:22px 8px;text-align:center;color:#a9a193;font-size:14px}.iccall{text-align:center;padding:14px 4px}.iccall .av{width:84px;height:84px;margin:0 auto 10px;border-radius:50%;background:#1c1814;border:2px solid #b69a6b;display:flex;align-items:center;justify-content:center;font-size:38px}.iccall .av.ring{animation:icp 1.2s infinite}@keyframes icp{0%{box-shadow:0 0 0 0 rgba(226,174,47,.6)}100%{box-shadow:0 0 0 26px rgba(226,174,47,0)}}.iccall h3{margin:0;font-size:20px}.iccall .st{color:#a9a193;margin:4px 0 10px}.icw{display:flex;gap:3px;justify-content:center;align-items:center;height:44px;margin-bottom:12px}.icw i{display:block;width:4px;height:5px;border-radius:2px;background:#34d399}.icrow{display:flex;gap:10px;justify-content:center}" +
    ".icinb{width:100%;max-width:380px;margin:auto;text-align:center;background:#14110e;border:1px solid #b69a6b;border-radius:22px;padding:28px 20px;box-shadow:0 20px 60px rgba(0,0,0,.7)}dialog#icIn[open]{align-items:center}.icinb .av{width:92px;height:92px;margin:0 auto 12px;border-radius:50%;background:#1c1814;border:2px solid #e2ae2f;display:flex;align-items:center;justify-content:center;font-size:42px;animation:icp 1.2s infinite}.icnm{font-size:22px;font-weight:700}.icsub{color:#a9a193;margin:4px 0 20px}.icinb .icbtn{min-width:120px;padding:13px 18px;font-size:16px}.icinb .icbtn.y{background:#16a34a;color:#fff}" +
    ".ictoast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(150px + env(safe-area-inset-bottom,0px));z-index:2147483300;background:#14110e;color:#fff;border:1px solid #b69a6b;padding:10px 16px;border-radius:12px;font:14px system-ui;max-width:86vw;text-align:center;box-shadow:0 8px 28px rgba(0,0,0,.6)}";
  var tt = 0;
  function toast(t) { var e = $("icToast"); if (!e) { e = document.createElement("div"); e.id = "icToast"; e.className = "ictoast"; document.body.appendChild(e) } e.textContent = t; e.style.display = ""; clearTimeout(tt); tt = setTimeout(function () { e.style.display = "none" }, 3800) }
  var featOn = function () { if (!self) return false; if (GUEST) return !!(GD && GD.on); var ic = cfgIc(); return !!(ic.on && (has(ic, self.id) || (ALT && ic.acc))) };
  var fmt = function (ms) { var s = Math.floor(ms / 1000); return String(s / 60 | 0).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0") };
  var GN = { U: "Akun aplikasi", A: "Akun staf", R: "Resepsionis", O: "Owner", K: "Karyawan / Housekeeping", T: "Kamar tamu" };

  var noFab = false;   /* true = sembunyikan tombol 📞 (kecuali sedang ada panggilan); dipakai aplikasi tamu saat tamu tidak sedang di kamar */
  function build() {
    if (root || !document.body) return;
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement("div"); root.id = "icRoot";
    root.innerHTML = '<button class="icfab" id="icFab" style="display:none" aria-label="Interkom">📞<small id="icBd"></small></button>' +
      '<dialog class="icd" id="icP"><div class="icbox"><div class="ich"><b>📞 Interkom</b><button id="icX" aria-label="Tutup">×</button></div><div id="icB"></div></div></dialog>' +
      '<dialog class="icd" id="icIn"><div class="icinb"><div class="av">📞</div><div class="icnm" id="icInN"></div><div class="icsub">Panggilan suara masuk…</div><div class="icrow"><button class="icbtn r" id="icRej">Tolak</button><button class="icbtn y" id="icAcc">Angkat</button></div></div></dialog>';
    document.body.appendChild(root);
    if (GUEST) $("icFab").classList.add("gst");   /* di aplikasi tamu: tombol chat ada di bawahnya, jangan bertumpuk */
    $("icFab").onclick = function () { api.open() }; $("icX").onclick = function () { api.close() };
    $("icP").addEventListener("close", function () { open = false; sig = "" }); $("icIn").addEventListener("cancel", function (e) { e.preventDefault() });
    $("icAcc").onclick = acceptIn; $("icRej").onclick = rejectIn;
    $("icB").addEventListener("click", function (e) { var b = e.target.closest("[data-call]"); if (b) { callTo(b.getAttribute("data-call")); return } if (e.target.closest("#icMt")) { micOn = !micOn; if (call && call.stream) call.stream.getAudioTracks().forEach(function (t) { t.enabled = micOn }); $("icMt").textContent = micOn ? "🎤 Mikrofon ON" : "🔇 Mikrofon OFF"; return } if (e.target.closest("#icEnd")) hangup() });
    $("icB").addEventListener("input", function (e) { if (e.target.id === "icQ") list() });
  }
  function ui() {
    build(); if (!root) return;
    var fab = $("icFab"), show = !!self && (featOn() || !!call) && !(noFab && !call);
    fab.style.display = show ? "" : "none"; fab.classList.toggle("live", !!call && call.s === "live");
    var inc = $("icIn"), ringing = !!call && call.dir === "in" && call.s === "ring";
    if (ringing) { $("icInN").textContent = call.peer.name; if (!inc.open) { try { inc.showModal() } catch (e) {} } } else if (inc.open) inc.close();
    var p = $("icP");
    if (open && !ringing) { var fresh = !p.open; if (fresh) { try { p.showModal() } catch (e) {} } var sg = [!!self, featOn(), call ? call.cid + call.s : "", secure(), GUEST && !!GD].join("|"); if (fresh || sg !== sig) { sig = sg; body() } } else if (p.open && !open) p.close()
    tick();
  }
  function body() {
    var b = $("icB"); if (!b) return;
    if (call && !(call.dir === "in" && call.s === "ring")) {
      var tx = call.s === "live" ? "Tersambung" : call.s === "conn" ? "Menyambungkan suara…" : "Memanggil…";
      b.innerHTML = '<div class="iccall"><div class="av' + (call.s === "ring" ? " ring" : "") + '">' + (call.dir === "in" ? "🎙️" : "📞") + '</div><h3>' + esc(call.peer.name) + '</h3><div class="st" id="icSt">' + tx + '</div><div class="icw" id="icW">' + "<i></i>".repeat(22) + '</div><div class="icrow"><button class="icbtn g" id="icMt">' + (micOn ? "🎤 Mikrofon ON" : "🔇 Mikrofon OFF") + '</button><button class="icbtn r" id="icEnd">' + (call.s === "ring" ? "Batalkan" : "Akhiri") + "</button></div></div>"; return;
    }
    if (!self) { b.innerHTML = '<div class="icemp">Masuk dulu untuk memakai panggilan suara.</div>'; return }
    if (!featOn()) { b.innerHTML = '<div class="icemp">Fitur panggilan suara belum diaktifkan untuk ' + (GUEST && self.id.indexOf("U:") !== 0 ? "kamar ini" : "akun ini") + ' oleh owner.</div>'; return }
    var warn = secure() ? "" : '<div class="icemp" style="color:#fbbf24;padding:6px 0">⚠ Mikrofon butuh alamat HTTPS. Buka lewat alamat aman agar panggilan bisa dipakai.</div>';
    b.innerHTML = warn + '<input class="icq" id="icQ" placeholder="Cari nama / kamar…" autocomplete="off"><div id="icL"></div>';
    if (!GUEST) beaconWho(); else if (!GD) askDir(); list();
  }
  function list() {
    var L = $("icL"); if (!L) return; var q = ($("icQ") ? $("icQ").value : "").toLowerCase().trim();
    var cs = (GUEST ? ((GD && GD.out) || []) : dirMine()).filter(function (c) { return !q || (c.name + " " + c.sub).toLowerCase().indexOf(q) >= 0 });
    if (!cs.length) { L.innerHTML = '<div class="icemp">' + (q ? "Tidak ada yang cocok." : "Belum ada yang bisa dihubungi saat ini.") + "</div>"; return }
    var h = "", order = ["A", "R", "O", "K", "T", "U"];
    order.forEach(function (g) {
      var a = cs.filter(function (c) { return grp(c.id) === g }).sort(function (x, y) { return (y.on === true) - (x.on === true) || byNum(x.name, y.name) }); if (!a.length) return;
      h += '<div class="icg">' + GN[g] + "</div>" + a.map(function (c) { return '<div class="icr"><span class="icd1 ' + (c.on === true ? "on" : c.on === null ? "nn" : "") + '" title="' + (c.on === true ? "Online" : c.on === null ? "Kamar terisi" : "Offline") + '"></span><div class="n"><b>' + esc(c.name) + "</b><span>" + esc(c.sub || "") + (c.on === false ? " · offline" : "") + '</span></div><button class="icbtn" data-call="' + esc(c.id) + '"' + (call ? " disabled" : "") + ">📞 Panggil</button></div>" }).join("");
    });
    L.innerHTML = h;
  }
  function tick() {
    if (!root) return; var c = call, bd = $("icBd"), w = $("icW"), st = $("icSt");
    if (bd) bd.textContent = c && c.s === "live" ? fmt(Date.now() - c.t0) : "";
    if (st && c) st.textContent = c.s === "live" ? "Tersambung · " + fmt(Date.now() - c.t0) : c.s === "conn" ? "Menyambungkan suara…" : c.dir === "out" ? "Memanggil…" : "";
    if (w && c && c.s === "live") { var v = Math.min(1, Math.max(lvlL, lvlR) * 5); w.querySelectorAll("i").forEach(function (i) { i.style.height = (5 + v * Math.random() * 38) + "px" }) }
  }
  function render() { var f = $("icFab"); if (f) { var sh = !!self && (featOn() || !!call) && !(noFab && !call); f.style.display = sh ? "" : "none" } if (open && !call && $("icL")) list(); else if (open && !call) body() }
  /* ---------- akun staf: setiap akun yang masuk juga punya id sendiri 'A:<username>' ---------- */
  function loadAcc() {
    if (GUEST || !ALT) return;
    try {
      fetch("/hs/acct", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ op: "dir" }) })
        .then(function (r) { return r.json() })
        .then(function (j) {
          if (!j || !j.ok || !Array.isArray(j.users)) return;
          ACC = j.users.filter(function (u) { return u && typeof u.u === "string" && /^[a-z0-9._-]{3,24}$/.test(u.u) })
            .map(function (u) { return { u: u.u, name: String(u.name || u.u).slice(0, 40), role: String(u.role || ""), emp: String(u.emp || "") } });
          sig = ""; render();
        }).catch(function () {});
    } catch (e) {}
  }
  function setAlt(m) {
    if (GUEST || !m || !m.ok || m.local || !m.user || !/^[a-z0-9._-]{3,24}$/.test(String(m.user))) return;
    var id = "A:" + m.user; if (ALT && ALT.id === id && ALT.name === (m.name || m.user)) return;
    ALT = { id: id, name: String(m.name || m.user).slice(0, 40), role: String(m.role || "") };
    if (self) { beacon(); beaconWho() } loadAcc(); ui();
  }
  document.addEventListener("obme", function (e) { setAlt(e.detail) });
  setInterval(loadAcc, 60000);
  function beaconWho() { if (!GUEST && bc && self) bc.postMessage({ type: "ic2", k: "who", fid: self.id }) }
  function askDir() { if (GUEST && sendG && self && self.id.indexOf("U:") !== 0) sendG({ k: "dirq" }) }

  /* ---------- API ---------- */
  var api = IC = window.IC = {
    DEF: DEF, norm: norm, grp: grp, has: has, can: can, cfgIc: cfgIc, dirFor: dirFor, inbound: inbound, nameOf: nameOf, allIds: allIds,
    isOn: isOn, isOpen: isOpen, seen: seen, guest: GUEST, hook: null, deliver: onMsg,
    call: function () { return call }, setSend: function (f) { sendG = f },
    setFabHidden: function (v) { v = !!v; if (v === noFab) return; noFab = v; ui() },
    setGD: function (d) { if (!GUEST || !self || JSON.stringify(GD) === JSON.stringify(d)) return; GD = d; ui() },
    setSelf: function (s) {
      var same = (!s && !self) || (s && self && s.id === self.id && s.name === self.name); if (same) return;
      var was = self; self = s ? { id: s.id, name: s.name, role: s.role || "" } : null; window.HS_ICID = self ? self.id : "";
      if (!self && call) finish("Sesi berakhir"); if (!self) { GD = null }
      if (self && (!was || was.id !== self.id)) { GD = null; if (GUEST) askDir(); else { beacon(); beaconWho() } }
      ui();
    },
    open: function () { build(); if (!self) return; open = true; sig = ""; loadAcc(); ui() },
    close: function () { open = false; var p = $("icP"); if (p && p.open) p.close() },
    callTo: callTo, hangup: hangup
  };
  var IC;
  function boot() { if (window.OBME) setAlt(window.OBME); build(); try { bc = new BroadcastChannel(CH); bc.addEventListener("message", function (e) { onMsg(e.data) }) } catch (e) {} setInterval(function () { if (!self) return; if (!GUEST) beacon(); }, 15000); setInterval(function () { if (!root) return; ui(); if (open && !call && $("icL")) list() }, 2500); setInterval(tick, 250) }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
