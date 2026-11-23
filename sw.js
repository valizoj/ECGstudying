"use strict";

const cacheName = "ecgstudying-v1";
const assets = [
  "./", "./index.html", "./style.css", "./cards.js", "./app.js",
  "./manifest.webmanifest", "./icons/192.png", "./icons/512.png", "./icons/apple.png"
];
const assetUrls = new Set(assets.map((asset) => new URL(asset, self.registration.scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("ecgstudying-") && key !== cacheName)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  const scope = self.registration.scope;
  const appPage = event.request.mode === "navigate"
    && (requestUrl.origin + requestUrl.pathname === scope
      || requestUrl.origin + requestUrl.pathname === scope + "index.html");
  if (!appPage && !assetUrls.has(requestUrl.href)) return;

  // Use a consistent installed version of the deck, script and stylesheet.
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(appPage ? "./index.html" : event.request);
    return cached || fetch(event.request);
  })());
});
