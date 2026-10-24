/* ONE BLISS - service worker: aplikasi bisa dipasang & halaman tetap terbuka saat sinyal putus. Data /hs/* tidak pernah disimpan. */
const V = 'ob-v10';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(V).then(c => c.addAll(['/icons/icon-192.png', '/icons/icon-512.png']).catch(() => {}))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const OFFLINE = '<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="margin:0;background:#0a0a0a;color:#fff;font:16px system-ui;display:grid;place-items:center;min-height:100vh;text-align:center"><div><h2 style="color:#b69a6b;font-family:Georgia,serif">ONE BLISS</h2><p>Tidak ada koneksi internet.<br>Coba lagi setelah sinyal kembali.</p><button onclick="location.reload()" style="padding:12px 22px;border-radius:10px;border:0;background:#b69a6b;color:#0a0a0a;font-size:15px">Muat ulang</button></div>';
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || r.headers.has('range')) return;
  if (u.pathname.startsWith('/hs/') && u.pathname !== '/hs/net.js' && u.pathname !== '/hs/ic.js' && u.pathname !== '/hs/rs.js' && u.pathname !== '/hs/draft.js' && u.pathname !== '/hs/akun.js' && u.pathname !== '/hs/staf.js') return;      // data hidup: selalu langsung ke server
  e.respondWith((async () => {
    const c = await caches.open(V);
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), r.mode === 'navigate' ? 6000 : 8000);
      const res = await fetch(r, { signal: ctl.signal }); clearTimeout(t);
      if (res.ok && res.status === 200) c.put(r, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const hit = await c.match(r, { ignoreSearch: r.mode === 'navigate' });
      if (hit) return hit;
      if (r.mode === 'navigate') return new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return Response.error();
    }
  })());
});
self.addEventListener('push', e => e.waitUntil((async () => {
  let items = [];
  try {
    const s = await self.registration.pushManager.getSubscription();
    if (s) { const r = await fetch('/hs/pushq', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ep: s.endpoint }) }); items = (await r.json()).items || []; }
  } catch (x) {}
  const cl = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (cl.some(c => c.visibilityState === 'visible')) return;   // halaman sedang terlihat: bunyi/pop-up sudah tampil di halaman
  if (!items.length) items = [{ t: 'ONE BLISS', b: 'Ada pemberitahuan baru', k: 'ob' }];
  for (const it of items) await self.registration.showNotification(it.t, {
    body: it.b, tag: it.k || 'ob', renotify: true, silent: false, requireInteraction: !!it.call, timestamp: it.ts ? Math.round(it.ts * 1000) : Date.now(),
    vibrate: it.call ? [500, 250, 500, 250, 500, 250, 500, 250, 500] : [200, 100, 200], icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: it.u || '/' }
  });
})()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => { for (const c of l) if ('focus' in c) return c.focus(); return self.clients.openWindow((e.notification.data && e.notification.data.url) || '/'); }));
});
