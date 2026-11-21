/* Minimal AudioLang service worker: offline app shell, never caches the API. */
const CACHE = 'audiolang-shell-v4'
const SHELL = [
  '/',
  '/manifest.webmanifest?v=4',
  '/favicon.svg?v=4',
  '/icon-192.png?v=4',
  '/icon-512.png?v=4',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // API and audio streaming always hit the network.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    // Network-first navigation, falling back to the cached shell when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          void caches.open(CACHE).then((cache) => cache.put('/', copy))
          return response
        })
        .catch(() => caches.match('/').then((cached) => cached ?? caches.match(request))),
    )
    return
  }

  // Static assets: cache-first, then fill the cache in the background.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})
