// Crystal Shield Hub service worker: phone & desktop notifications (push), app badge, and an offline fallback page.
const SHELL = 'cs-shell-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/css/app.css', '/img/logo-dark.png', '/icons/icon-192.png'])).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const isUpdate = keys.some((k) => k.startsWith('cs-shell-') && k !== SHELL); // not the very first install
    await Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)));
    await self.clients.claim();
    // a new version of the hub was deployed: reload open hub windows once so nobody keeps an old copy
    if (isUpdate) {
      for (const c of await self.clients.matchAll({ type: 'window' })) { try { await c.navigate(c.url); } catch { /* not ours */ } }
    }
  })());
});

// Network first; if offline, show the cached app shell (never cache API data)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
  }
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'Crystal Shield', body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    // unread count on the installed app's icon (taskbar / dock / home screen)
    if (typeof data.unread === 'number' && self.navigator.setAppBadge) self.navigator.setAppBadge(data.unread).catch(() => {});
    // Skip the pop-up if the hub is open and focused on this device (the in-app alert + sound already shows)
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.focused && w.visibilityState === 'visible')) return;
    const sticky = ['urgent', 'lead', 'job'].includes(data.type); // stays on screen until clicked (Windows / Mac)
    await self.registration.showNotification(data.title || 'Crystal Shield', {
      body: data.body || '',
      icon: '/icons/notify-192.png',
      badge: '/icons/badge-96.png',
      tag: data.id ? `n${data.id}` : undefined,
      requireInteraction: sticky,
      renotify: !!data.id,
      data: { link: data.link || '' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = `/#/${(e.notification.data && e.notification.data.link || '').replace(/^#?\/?/, '')}`;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { await w.focus(); w.postMessage({ type: 'open', link: e.notification.data && e.notification.data.link }); return; }
    }
    await self.clients.openWindow(target);
  })());
});
