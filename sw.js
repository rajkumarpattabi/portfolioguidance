// Offline cache for PortfolioGuidance (mealfast/healthdashboard-style).
// Bump VERSION to force all clients to refresh cached assets.
const VERSION = 'pg-v24';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './config.js', './sectors.js',
  './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = req.url;
  if (req.method !== 'GET') return;
  // Never touch the Zerodha/Worker calls or any cross-origin request.
  if (url.includes('workers.dev') || url.includes('kite.trade') || url.includes('zerodha.com')
      || url.includes('/holdings') || url.includes('/login') || url.includes('/session')
      || !url.startsWith(self.location.origin)) {
    return; // fall through to the network
  }
  // NETWORK-FIRST for our own files: always load the latest when online,
  // fall back to cache only when offline. This makes updates appear immediately.
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
