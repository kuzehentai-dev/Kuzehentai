// Ultra-Fast PWA Service Worker for KuzeHentai
// Strategies:
// 1. Cover Images: Cache-First (0ms load from Cache API)
// 2. Catalog APIs (/api/bootstrap, /api/animes, etc.): Stale-While-Revalidate (0ms instant response + background refresh)
// 3. Fonts & Static Assets: Cache-First
// 4. Shell / Navigation: Stale-While-Revalidate with offline fallback

const SHELL_CACHE_NAME = 'kh-shell-v7';
const COVERS_CACHE_NAME = 'kh-anime-covers-v1';
const API_CACHE_NAME = 'kh-api-cache-v1';
const FONTS_CACHE_NAME = 'kh-fonts-v1';

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
    caches.open(SHELL_CACHE_NAME).then((cache) => {
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
          .filter((key) => key !== SHELL_CACHE_NAME && key !== COVERS_CACHE_NAME && key !== API_CACHE_NAME && key !== FONTS_CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch handling
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Exclude non-GET, Chrome extensions, and third-party Firebase/Supabase real-time traffic
  if (
    req.method !== 'GET' ||
    url.hostname.includes('firestore') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('supabase') ||
    url.hostname.includes('googleapis.com/identitytoolkit') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.protocol.startsWith('chrome-extension')
  ) {
    return;
  }

  // 1. Google Fonts & Gstatic: Cache-First
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(FONTS_CACHE_NAME).then((cache) => {
        return cache.match(req).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          return fetch(req).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(req, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => cachedResponse);
        });
      })
    );
    return;
  }

  // 2. Cover Images & Episode Thumbnails: Cache-First (Instant 0ms retrieval)
  const isImageCover = 
    req.destination === 'image' ||
    url.pathname.includes('/covers/') ||
    url.pathname.includes('/api/covers/') ||
    /\.(webp|jpg|jpeg|png|gif|svg)(\?.*)?$/i.test(url.pathname);

  if (isImageCover && !url.pathname.startsWith('/api/user-list') && !url.pathname.startsWith('/api/admin')) {
    event.respondWith(
      caches.open(COVERS_CACHE_NAME).then((cache) => {
        return cache.match(req).then((cachedResponse) => {
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

  // 3. Catalog API Endpoints: Stale-While-Revalidate (Instant 0ms cached data + silent background update)
  const isCatalogApi = 
    url.pathname === '/api/bootstrap' ||
    url.pathname === '/api/animes' ||
    url.pathname === '/api/studios' ||
    url.pathname === '/api/genres';

  if (isCatalogApi) {
    event.respondWith(
      caches.open(API_CACHE_NAME).then((cache) => {
        return cache.match(req).then((cachedResponse) => {
          // Launch background network fetch to revalidate
          const fetchPromise = fetch(req)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(req, networkResponse.clone());
              }
              return networkResponse;
            })
            .catch(() => cachedResponse);

          // Return cached response instantly in 0ms if available, otherwise wait for network
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // Exclude admin, auth, and user mutations from caching
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 4. Shell & Static Scripts/Styles: Stale-While-Revalidate
  event.respondWith(
    caches.open(SHELL_CACHE_NAME).then((cache) => {
      return cache.match(req).then((cachedResponse) => {
        const fetchPromise = fetch(req)
          .then((networkResponse) => {
            if (
              networkResponse &&
              networkResponse.status === 200 &&
              url.origin === self.location.origin
            ) {
              cache.put(req, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => {
            if (cachedResponse) return cachedResponse;
            if (req.mode === 'navigate') {
              return cache.match('/index.html');
            }
          });

        return cachedResponse || fetchPromise;
      });
    })
  );
});
