// Offline cache: page, Leaflet and all three courses up front; hole photos cached as they are viewed
// (or via the "offline opslaan" button). Map tiles from IGN/OSM are never cached here.
var C = 'golf-gps-v7', IMG = 'golf-gps-img';
var FILES = ['./', 'index.html', 'app.css', 'app.js', 'gps.js', 'la-finca-book.json', 'las-ramblas-book.json', 'las-colinas-book.json', 'la-finca.json', 'las-ramblas.json', 'las-colinas.json', 'manifest.webmanifest', 'leaflet/leaflet.js', 'leaflet/leaflet.css'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(C).then(function (c) { return c.addAll(FILES); })); self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== C && k !== IMG; }).map(function (k) { return caches.delete(k); })); })); self.clients.claim(); });
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  var isImg = u.pathname.indexOf('/gps/img/') >= 0;
  if (isImg) { // cache first for hole photos
    e.respondWith(caches.match(e.request).then(function (hit) { return hit || fetch(e.request).then(function (r) { var cp = r.clone(); caches.open(IMG).then(function (c) { c.put(e.request, cp); }); return r; }); }));
    return;
  }
  e.respondWith(fetch(e.request).then(function (r) { var cp = r.clone(); caches.open(C).then(function (c) { c.put(e.request, cp); }); return r; })
    .catch(function () { return caches.match(e.request, { ignoreSearch: true }); }));
});
