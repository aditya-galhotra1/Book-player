const V = "ra-v1", SHELL = ["./", "index.html", "app.js", "styles.css", "manifest.webmanifest", "icon.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
const store = (req, r) => { if (r.status === 200) { const c = r.clone(); caches.open(V).then(x => x.put(req, c)); } return r; };
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url), same = u.origin === location.origin;
  if (e.request.method !== "GET" || !(same || u.hostname === "cdn.jsdelivr.net")) return;
  e.respondWith(same
    ? fetch(e.request).then(r => store(e.request, r)).catch(() => caches.match(e.request))
    : caches.match(e.request).then(hit => hit || fetch(e.request).then(r => store(e.request, r))));
});
