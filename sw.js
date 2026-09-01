/* ==========================================================================
   Ploots Click — service worker.

   Precaches the app shell (HTML/CSS-in-HTML/local JS/local images) on
   install, so a repeat visit needs zero network round trips for anything
   that ships with the app. The heavy CDN libraries (Fabric, AG Grid,
   MathJax, etc.) are lazy-loaded (see js/lazy-loader.js) and deliberately
   NOT precached here — most users never touch every panel in one session,
   and force-downloading all of them on first visit would defeat the whole
   point of lazy loading. Instead, the fetch handler below cache-firsts them
   the moment each one actually loads, so it's instant on every visit after
   the first time that specific feature is used.

   Every CDN URL below is pinned to an exact version (cdnjs convention), so
   cache-first is safe: a version bump means a new URL, never a stale hit.

   Bump CACHE_NAME on any release that changes file contents — a new name
   makes `install` populate a fresh cache and `activate` deletes the old
   one, so users never get stuck on outdated JS.
   ========================================================================== */

const CACHE_NAME = "ploots-click-v1";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./vendor/plotly-cartesian.min.js",
  "./js/lazy-loader.js",
  "./js/chart-builder/01-config.js",
  "./js/chart-builder/02-state.js",
  "./js/chart-builder/03-ui-lists.js",
  "./js/chart-builder/04-data.js",
  "./js/chart-builder/05-style-helpers.js",
  "./js/chart-builder/06-canvas-units.js",
  "./js/chart-builder/07-render.js",
  "./js/chart-builder/08-helpers-export.js",
  "./js/chart-builder/09-event-wiring.js",
  "./js/chart-builder/10-view-switcher-init.js",
  "./js/chart-builder/11-choropleth.js",
  "./js/palettes.js",
  "./js/data_formulas.js",
  "./js/data_view.js",
  "./js/data_stats.js",
  "./js/color_picker.js",
  "./js/layout-editor/01-canvas-core.js",
  "./js/layout-editor/02-toolbar-text.js",
  "./js/layout-editor/03-shapes.js",
  "./js/layout-editor/04-images.js",
  "./js/layout-editor/05-object-actions.js",
  "./js/layout-editor/06-context-menu.js",
  "./js/layout-editor/07-selection.js",
  "./js/layout-editor/08-format-bars.js",
  "./js/layout-editor/09-panels-helpers.js",
  "./js/layout-editor/10-export-overlay.js",
  "./js/layout-editor/11-sidebar-nav.js",
  "./js/layout-editor/12-theme-init.js",
  "./js/layout-editor/13-axis-title-detach.js",
  "./js/layout-editor/14-legend-hover.js",
  "./js/layout-editor/15-legend-detach.js",
  "./js/layout-editor/16-draw-tool.js",
  "./js/layout-editor/17-textbox-resize.js",
  "./js/ui_sections.js",
  "./js/latex_symbols.js",
  "./js/canvas_ruler.js",
  "./js/undo_redo.js",
  "./assets/logo_light.png",
  "./assets/logo_dark.png",
  "./assets/logo_light.avif",
  "./assets/logo_dark.avif",
  "./assets/palettes.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      // Activate this version immediately rather than waiting for every
      // open tab to close — a static chart tool has no server-side state
      // that a mid-session swap could corrupt.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Hosts whose responses are safe to cache-first indefinitely: same-origin
// (the app itself) and cdnjs (every URL we load from it is version-pinned).
function isCacheableRequest(url) {
  return url.origin === self.location.origin || url.hostname === "cdnjs.cloudflare.com";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (!isCacheableRequest(url)) return; // let the browser handle fonts, etc. normally

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Cache successful responses AND cross-origin "opaque" ones (the
          // <script src> fetches to cdnjs are no-cors, so their status is
          // always 0 from here — that's expected, not an error).
          if (res && (res.status === 200 || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // offline and never cached: let it fail naturally
    })
  );
});
