self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'What are you doing?';
  const body  = data.body  || 'Tap to jot a one-liner.';
  const url   = data.url   || (self.registration.scope + '?ping=1');

  event.waitUntil(self.registration.showNotification(title, {
    body, tag:'hourly-ping', renotify:true, data:{ url }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || (self.registration.scope + '?ping=1');
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type:'window', includeUncontrolled:true });
    const same = all.find(c => c.url.startsWith(self.registration.scope));
    if (same) { same.focus(); same.postMessage({type:'focus'}); }
    else { await clients.openWindow(url); }
  })());
});
