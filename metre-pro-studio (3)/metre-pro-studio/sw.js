// Service Worker pour Métré Pro-Studio
const CACHE_NAME = 'metre-pro-studio-v1';

// Fichiers à mettre en cache
const urlsToCache = [
    './',
    './index.html',
    './manifest.json',
    './css/main.css',
    './css/components/dialog.css',
    './css/components/table.css',
    './css/components/tree.css',
    './css/components/viewer.css',
    './css/components/canvas-editor.css',
    './js/app.js',
    './js/config/settings.js',
    './js/core/utils.js',
    './js/core/storage.js'
];

// Installation du service worker
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Cache ouvert');
                return cache.addAll(urlsToCache);
            })
            .catch(err => {
                console.log('[SW] Erreur cache:', err);
            })
    );
    // Activer immédiatement
    self.skipWaiting();
});

// Activation du service worker
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Suppression ancien cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    // Prendre le contrôle immédiatement
    self.clients.claim();
});

// Interception des requêtes
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Retourner depuis le cache si disponible
                if (response) {
                    return response;
                }
                // Sinon, faire la requête réseau
                return fetch(event.request);
            })
    );
});
