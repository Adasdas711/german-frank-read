const CACHE = "franka-offline-79f8a86419c69e54";
const FILES = [
  "./index.html",
  "./fbook-builder.html",
  "./manifest.webmanifest",
  "./pwa/icon-192.png",
  "./pwa/icon-512.png",
  "./pwa/apple-touch-icon.png",
];
const urls = FILES.map((path) => new URL(path, self.registration.scope).href);
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(urls.map((url) => new Request(url, { cache: "reload" }))),
      )
      // Each page is self-contained. Activate the complete new cache even if
      // another app tab is open; the next launch must not keep serving old code.
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("franka-offline-") && name !== CACHE)
          await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  url.hash = "";
  url.search = "";
  if (url.href === self.registration.scope) url.pathname += "index.html";
  if (!urls.includes(url.href)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(url.href)) || fetch(event.request);
    })(),
  );
});
