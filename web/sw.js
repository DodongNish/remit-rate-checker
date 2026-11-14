self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Remittance ranking changed", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Remittance ranking changed";
  const options = {
    body: payload.body || "The exchange-rate ranking has changed.",
    icon: "./android-chrome-192x192.png?v=2",
    badge: "./android-chrome-192x192.png?v=2",
    tag: "remit-rate-ranking-change",
    renotify: true,
    data: { url: payload.url || "https://dodongnish.github.io/remit-rate-checker/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "https://dodongnish.github.io/remit-rate-checker/";
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(targetUrl);
        return;
      }
    }
    await clients.openWindow(targetUrl);
  })());
});
