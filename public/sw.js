/**
 * The service worker, so NXOne opens and works without a signal.
 *
 * It is a cautious one. The books already live in this browser rather than on a server, so being
 * offline costs nothing but the files the page is made of — which is exactly what this keeps.
 *
 * Two rules worth knowing. Nothing but this site is ever touched: a request to the API, or to
 * anywhere else, goes straight to the network and is never stored, because a cached answer about
 * somebody's account or plan would be worse than no answer. And a new version never takes over a
 * page that is already open; it waits for the next fresh start, because swapping the code under a
 * half-finished invoice is how you lose one.
 */

const VERSION = "dev";
const SHELL = `nxone-shell-${VERSION}`;
const PAGES = `nxone-pages-${VERSION}`;

/** Enough to open the app and make an invoice with no signal at all. */
const CORE = ["/", "/today/", "/documents/", "/invoice-generator/", "/expenses/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PAGES).then((cache) =>
      // One missing page must not stop the rest being kept, so they are added one by one.
      Promise.all(CORE.map((url) => cache.add(url).catch(() => undefined)))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== SHELL && n !== PAGES).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

/** The page can ask for the new version when it knows nothing is half-written. */
self.addEventListener("message", (event) => {
  if (event.data === "take-over") self.skipWaiting();
});

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>No signal</title>
<style>body{font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;height:100vh;background:#F7F8F7;color:#101828}
main{max-width:30rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#475467;line-height:1.5}</style></head>
<body><main><h1>This page has not been opened on this device yet</h1>
<p>Your work is safe and still on this device. Open NXOne again when you have a signal and this page will be kept for next time.</p></main></body></html>`;

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Built files carry a hash in their name, so a stored copy can never be the wrong one.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const held = await cache.match(request);
        if (held) return held;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  // Pages: the network first, so a change is picked up, with what we hold as the fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(PAGES).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(PAGES);
          return (await cache.match(request))
            ?? (await cache.match("/today/"))
            ?? (await cache.match("/"))
            ?? new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        })
    );
    return;
  }

  // Everything else of ours: show what we hold, and quietly fetch a fresh copy for next time.
  event.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const held = await cache.match(request);
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => held);
      return held ?? fresh;
    })
  );
});
