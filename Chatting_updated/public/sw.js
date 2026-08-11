self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification && event.notification.data || {};
  const room = (data && data.room) ? String(data.room) : '';
  const url = room ? `?room=${encodeURIComponent(room)}` : '.';
  event.waitUntil((async () => {
    try {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (allClients && allClients.length) {
        const client = allClients[0];
        await client.focus();
        try { client.postMessage({ type: 'open-room', room }); } catch {}
        return;
      }
      await clients.openWindow(url);
    } catch (e) {
      try { await clients.openWindow(url); } catch {}
    }
  })());
});
