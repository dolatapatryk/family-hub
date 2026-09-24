const CACHE_NAME = 'family-hub-static-v1'
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon.svg',
]

self.addEventListener('install', event => {
  event.waitUntil(Promise.all([
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)),
    self.skipWaiting(),
  ]))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys.filter(key => key.startsWith('family-hub-static-') && key !== CACHE_NAME)
        .map(key => caches.delete(key)),
    )
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      try {
        const response = await fetch(request)
        if (response.ok) await cache.put('/', response.clone())
        return response
      } catch {
        return (await cache.match('/')) || Response.error()
      }
    })())
    return
  }

  const isVersionedAsset = url.pathname.startsWith('/assets/')
    && ['script', 'style', 'image', 'font'].includes(request.destination)

  if (isVersionedAsset) {
    event.respondWith(caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(request)
      if (cached) return cached

      const response = await fetch(request)
      if (response.ok) await cache.put(request, response.clone())
      return response
    }))
  }
})
