"use strict";

importScripts("./schema-images.js?v=4");

const cacheName = "ecg-cloze-v4";
const scope = self.registration.scope;
const appShell = new URL("./app.html", scope).href;
const legacyShells = new Set([scope, new URL("./index.html", scope).href]);
const appAssets = ["study.css", "study.js", "deck.js", "image-meta.js", "layouts.js", "diagrams.js",
  "schema-images.js", "manifest.webmanifest"].map((path) => "./" + path + "?v=4");
const assets = [appShell, ...appAssets, "../icons/192.png", "../icons/512.png", "../icons/apple.png",
  ...["003", "009", "024", "049"].map((id) => "./sample-images/" + id + ".jpg"),
  ...Object.values(self.ECG_SCHEMA_IMAGES).map((figure) => figure.src),
];
const assetUrls = new Set(assets.map((path) => new URL(path, scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await (await caches.open(cacheName)).addAll(assets);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("ecg-cloze-") && key !== cacheName) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const path = url.origin + url.pathname;
  if (event.request.mode === "navigate" && legacyShells.has(path)) {
    event.respondWith(Promise.resolve(Response.redirect(appShell, 302)));
  } else if (event.request.mode === "navigate" && path === appShell) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(event.request);
        if (fresh.ok) return fresh;
      } catch {
        // The installed copy also works without a connection.
      }
      return (await caches.open(cacheName)).match(appShell);
    })());
  } else if (assetUrls.has(url.href)) {
    event.respondWith((async () => {
      const hit = await (await caches.open(cacheName)).match(event.request);
      return hit || fetch(event.request);
    })());
  }
});
