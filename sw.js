// Recall service worker — app-shell caching so the UI (and whatever's already
// in localStorage) still loads with no signal. Recording/processing still
// need network (Claude, Whisper, Supabase) — this only covers the shell.
const CACHE = 'recall-shell-v1';
const SHELL = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Cross-origin (fonts, Claude/OpenAI/Supabase APIs, magic-link redirects) — never intercept.
  if (url.origin !== self.location.origin) return;

  // Network-first so a fresh deploy is picked up immediately when online
  // (matches the version-badge-confirms-deploy workflow); cache is only
  // the offline fallback.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('/')))
  );
});
