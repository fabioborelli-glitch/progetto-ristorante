const CACHE = "ristoos-shell-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.json"]).catch(() => null)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => { caches.open(CACHE).then((c) => c.put("/", res.clone())); return res; }).catch(() => caches.match("/")));
    return;
  }
  if (url.origin === self.location.origin || url.hostname.includes("fontshare") || url.hostname.includes("googleapis") || url.hostname.includes("gstatic")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; }).catch(() => hit)));
  }
});
