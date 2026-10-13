const CACHE_PREFIX = `yanxi-shell-${encodeURIComponent(self.registration.scope)}-`;
const CACHE = `${CACHE_PREFIX}v8`;
const SHELL = ["./", "./index.html", "./styles.css", "./app.mjs", "./core.mjs", "./processing-workspace.mjs", "./xrd-workspace.mjs", "./offline.mjs", "./research-package.mjs", "./experiment-journal.mjs", "./experiment-journal-ui.mjs", "./qrcode-vendor.mjs", "./runtime.mjs", "./catalog.json", "./favicon.svg", "./manifest.webmanifest", "./xrd-refinement.html", "./xrd-refinement.css", "./xrd-refinement.mjs", "./xrd-refinement/rigaku-ultima-iv-185.json", "./xrd-refinement/skill-integration.md"];
const OPTIONAL_CLOUD = ["./cloud-config.json", "./cloud-client.bundle.mjs"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(async cache => {
    await cache.addAll(SHELL);
    await Promise.all(OPTIONAL_CLOUD.map(async asset => {
      try { const response=await fetch(asset);if(response.ok)await cache.put(asset,response); } catch {}
    }));
  }).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin || new URL(event.request.url).pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request)));
});
