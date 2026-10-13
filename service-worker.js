
self.addEventListener("push", (event) => {
  let data = {};

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = {
        title: "Pesan baru · NEXORA",
        body: event.data.text()
      };
    }
  }

  const title = data.title || "Pesan baru · NEXORA";

  const options = {
    body: data.body || "Kamu menerima pesan baru.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: {
      url: data.url || "/"
    },
    tag: "nexora-new-message",
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || "/",
    self.location.origin
  ).href;

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin)) {
          client.focus();
          return client.navigate(targetUrl);
        }
      }

      return clients.openWindow(targetUrl);
    })
  );
});
