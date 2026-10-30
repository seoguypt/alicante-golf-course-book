// Offline cache: page + all three courses, so it keeps working with a weak signal on the course.
var C = 'golf-gps-v1', FILES = ['./', 'index.html', 'gps.js', 'la-finca.json', 'las-ramblas.json', 'las-colinas.json', 'manifest.webmanifest'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(C).then(function (c) { return c.addAll(FILES); })); self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== C; }).map(function (k) { return caches.delete(k); })); })); self.clients.claim(); });
// network first, cache fallback (so updates arrive when online)
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(function (r) { var cp = r.clone(); caches.open(C).then(function (c) { c.put(e.request, cp); }); return r; })
    .catch(function () { return caches.match(e.request, { ignoreSearch: true }); }));
});
