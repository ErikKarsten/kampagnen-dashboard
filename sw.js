// Kampagnenanalyse – Hintergrunddienst
// Holt die Startseite immer frisch. Benachrichtigungen aufs Gerät gibt es nicht
// (der Alarm erscheint nur auf der Webseite).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Die Startseite immer frisch beim Server nachfragen, damit Neuerungen sofort
// sichtbar sind (sonst hebt der Browser sie bis zu 10 Minuten auf)
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate' || e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).catch(() => fetch(e.request)));
});
