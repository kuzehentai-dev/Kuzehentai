// Safe PWA Service Worker for KH with 3-Layer Cover Cache
const CACHE_NAME = 'kh-pwa-v5';
const COVERS_CACHE_NAME = 'kh-anime-covers-v1';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon.png',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/icono.png'
];

// Installation: precache shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// Activation: cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== COVERS_CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch handling: Capa 2 persistent Cache Storage for covers + passthrough for APIs/DB
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Exclude non-GET, chrome extensions, and real-time database endpoints
  if (
    req.method !== 'GET' ||
    url.hostname.includes('firestore') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('supabase') ||
    url.hostname.includes('googleapis.com') ||
    url.protocol.startsWith('chrome-extension')
  ) {
    return;
  }

  // Capa 2: Cover Image Caching Strategy (Pure Cache First: Once loaded, never re-downloads)
  const isImageCover = 
    req.destination === 'image' ||
    url.pathname.includes('/covers/') ||
    url.pathname.includes('/api/covers/') ||
    /\.(webp|jpg|jpeg|png|gif|svg)(\?.*)?$/i.test(url.pathname);

  if (isImageCover && !url.pathname.startsWith('/api/user-list') && !url.pathname.startsWith('/api/admin')) {
    event.respondWith(
      caches.open(COVERS_CACHE_NAME).then((cache) => {
        return cache.match(req).then((cachedResponse) => {
          // Si la imagen ya fue cargada, entregarla inmediatamente sin volver a pedir descarga por la red
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(req)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(req, networkResponse.clone());
              }
              return networkResponse;
            })
            .catch(() => cachedResponse);
        });
      })
    );
    return;
  }

  // Passthrough for dynamic non-cover API endpoints
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Network-first strategy for dynamic HTML/JS/CSS assets to ensure fresh content
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          url.origin === self.location.origin
        ) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(req).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (req.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});

