"use strict";

const cacheName = "ecg-cloze-v2";
const assets = ["./", "./index.html", "./study.css", "./study.js", "./deck.js", "./image-meta.js",
  "./manifest.webmanifest", "../icons/192.png", "../icons/512.png", "../icons/apple.png",
  ...["003", "009", "024", "049"].map((id) => "./sample-images/" + id + ".jpg")];
const urls = new Set(assets.map((path) => new URL(path, self.registration.scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("ecg-cloze-") && key !== cacheName)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const scope = self.registration.scope;
  const url = new URL(event.request.url);
  const cleanUrl = url.origin + url.pathname;
  const navigation = event.request.mode === "navigate" && (cleanUrl === scope || cleanUrl === scope + "index.html");
  if (!navigation && !urls.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const local = await cache.match(navigation ? "./index.html" : event.request);
    return local || fetch(event.request);
  })());
});
