// Offline cache for PortfolioGuidance (mealfast/healthdashboard-style).
// Bump VERSION to force all clients to refresh cached assets.
const VERSION = 'pg-v1';
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
  const url = e.request.url;
  // Never cache the Zerodha/Worker calls or any cross-origin API — always go to network.
  if (url.includes('workers.dev') || url.includes('kite.trade') || url.includes('zerodha.com')
      || url.includes('/holdings') || url.includes('/login') || url.includes('/session')) {
    return; // fall through to the network
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      if (e.request.method === 'GET' && res.status === 200 && url.startsWith(self.location.origin)) {
        caches.open(VERSION).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
