// Kampagnenanalyse – Hintergrunddienst für Benachrichtigungen
// Zeigt die Alarm-Mitteilungen der stündlichen Konto-Prüfung an, auch wenn die
// Webseite gerade nicht geöffnet ist. Ein Klick auf die Mitteilung öffnet die Seite.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { text: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titel || 'Kampagnenanalyse', {
    body: d.text || '',
    tag: d.tag || 'kampagnen-alarm',
    renotify: true,
    requireInteraction: Boolean(d.dringend), // Alarm bleibt stehen, bis man ihn wegklickt
    icon: 'icon-192.png',
    data: { url: d.url || self.registration.scope },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const ziel = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenster) => {
    for (const f of fenster) {
      if (f.url.startsWith(self.registration.scope) && 'focus' in f) return f.focus();
    }
    return self.clients.openWindow(ziel);
  }));
});
