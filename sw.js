// Service worker: lets the game be installed on a phone and opens the page shell when offline.
// Pages and scripts always try the network first, so a new deploy shows up straight away.
// Firebase and font requests are never touched (live data is never served from this cache).
const CACHE = "clutch-shell-v2";
const SHELL = ["index.html", "styles.css", "manifest.json", "icons/icon-192.png", "logo.jpg"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).catch(function () {}));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // Firebase, fonts, anything else: leave alone
  if (url.pathname.indexOf("admin") !== -1) return;           // the organiser page always runs live
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error());
      });
    })
  );
});
