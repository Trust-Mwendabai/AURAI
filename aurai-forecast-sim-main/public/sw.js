/**
 * Service Worker for Aurai Forecast PWA
 *
 * Provides:
 * - Cache-first strategy for static assets
 * - Network-first strategy for API calls
 * - Offline fallback page
 * - Background sync for critical operations
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `aurai-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `aurai-dynamic-${CACHE_VERSION}`;
const API_CACHE = `aurai-api-${CACHE_VERSION}`;

// Assets to cache on install
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

/**
 * Install event: cache essential assets
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('Some assets could not be cached during install:', err);
        // Don't fail the entire install, just warn
        return Promise.resolve();
      });
    }).then(() => self.skipWaiting())
  );
});

/**
 * Activate event: clean up old caches
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            return (
              (name.startsWith('aurai-') && !name.endsWith(CACHE_VERSION))
            );
          })
          .map((name) => {
            console.log('Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

/**
 * Fetch event: implement caching strategies
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests and non-GET methods
  if (url.origin !== self.location.origin || request.method !== 'GET') {
    return;
  }

  // API requests: network-first with fallback
  if (url.pathname.startsWith('/api/') || url.pathname.includes('localhost')) {
    event.respondWith(networkFirstStrategy(request, API_CACHE));
    return;
  }

  // Static assets: cache-first strategy
  event.respondWith(cacheFirstStrategy(request, STATIC_CACHE));
});

/**
 * Network-first strategy: try network, fall back to cache
 * Good for API calls where fresh data is preferred
 */
async function networkFirstStrategy(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Cache successful responses
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Network failed, try cache
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    // No cache available
    return new Response(
      JSON.stringify({
        error: 'Offline',
        message: 'You appear to be offline. Please check your connection.',
      }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Cache-first strategy: use cache, fall back to network
 * Good for static assets that don't change often
 */
async function cacheFirstStrategy(request, cacheName) {
  try {
    // Try cache first
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }

    // Not in cache, fetch from network
    const response = await fetch(request);
    if (response.ok) {
      // Cache it for next time
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('Fetch error:', error);
    // Return offline page if main document fails
    if (request.destination === 'document') {
      return new Response(
        `<!DOCTYPE html>
<html>
<head>
  <title>Offline</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 20px;
    }
    h1 { margin: 0 0 10px 0; font-size: 32px; }
    p { margin: 0; color: #ccc; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📡 Offline</h1>
    <p>You appear to be offline. Please check your internet connection.</p>
  </div>
</body>
</html>`,
        {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }
      );
    }
    throw error;
  }
}

/**
 * Handle messages from clients (e.g., for manual cache clearing)
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => caches.delete(name))
      );
    });
  }
});

/**
 * Handle push notifications
 */
self.addEventListener('push', (event) => {
  if (!event.data) {
    console.log('Push received but no data');
    return;
  }

  let notificationData = {
    title: 'Aurai Forecast',
    body: 'You have a new notification',
    // Relative to the service worker's own scope, so this still resolves
    // correctly when the app is served from a subdirectory.
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: 'aurai-notification',
  };

  try {
    const data = event.data.json();
    notificationData = { ...notificationData, ...data };
  } catch (e) {
    // If payload is not JSON, treat as plain text
    notificationData.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, {
      body: notificationData.body,
      icon: notificationData.icon,
      badge: notificationData.badge,
      tag: notificationData.tag,
      requireInteraction: false,
    })
  );
});

/**
 * Handle notification clicks
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || self.registration.scope;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window open with the target URL
      for (let client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
