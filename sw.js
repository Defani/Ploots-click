/* ==========================================================================
   GIS Consultant Studio — service worker.

   Strategy
   --------
   - App shell (same-origin: index.html, js/*, vendor/*, assets/*):
     NETWORK-FIRST, falling back to the cache when offline. The previous
     cache-first version served a stale index.html/JS forever unless
     CACHE_NAME was bumped by hand (and it never was: 18 scripts added after
     v1 were missing from the precache list). Network-first means a normal
     reload always picks up a new release; the cache only matters offline.
   - Version-pinned CDN libraries (cdnjs, jsdelivr): CACHE-FIRST, safe
     because a new version is a new URL.
   - Only real 2xx responses are cached. CDN scripts are re-fetched in CORS
     mode so the status is readable — the old worker also cached opaque
     (status 0) responses, which can hide a 5xx/error page permanently.

   Bump CACHE_NAME when the precache list changes; old caches are deleted
   on activate.
   ========================================================================== */

const CACHE_NAME = "ploots-click-v56";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./vendor/d3-7.9.0.min.js",
  "./js/d3-engine/00-core.js",
  "./js/d3-engine/01-frame.js",
  "./js/d3-engine/02-cartesian.js",
  "./js/d3-engine/03-stats.js",
  "./js/d3-engine/04-flow.js",
  "./js/d3-engine/05-special.js",
  "./js/d3-engine/geo-country-regex.js",
  "./js/d3-engine/06-geo.js",
  "./js/gis/00-store.js",
  "./js/gis/01-symbology.js",
  "./js/gis/02-map.js",
  "./js/gis/03-items.js",
  "./js/gis/04-raster.js",
  "./js/gis/05-attribute-table.js",
  "./js/gis/06-panel.js",
  "./js/gis/07-home.js",
  "./js/gis/08-catalog.js",
  "./js/gis/09-layer-menu.js",
  "./js/gis/10-bridge.js",
  "./js/gis/11-kobo.js",
  "./js/gis/12-workspace.js",
  "./js/gis/13-processing.js",
  "./js/gis/14-ramp-picker.js",
  "./js/gis/15-google-tiles.js",
  "./js/gis/16-logos.js",
  "./js/gis/17-basemap-gallery.js",
  "./js/gis/18-locator.js",
  "./js/gis/19-gfw.js",
  "./js/gis/20-cartography.js",
  "./js/gis/21-digitize.js",
  "./js/gis/22-animation.js",
  "./js/gis/23-gee.js",
  "./js/gis/24-sld.js",
  "./js/gis/26-maps.js",
  "./js/gis/27-supabase.js",
  "./js/gis/28-desktop-engines.js",
  "./js/gis/29-item-props.js",
  "./js/gis/30-arcmap-ui.js",
  "./js/gis/31-layout-dock.js",
  "./js/gis/32-geopdf.js",
  "./js/gis/33-project.js",
  "./js/tooltip.js",
  "./js/glass-select.js",
  "./js/d3-engine/99-integration.js",
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
  "./js/chart-builder/12-radial-rings.js",
  "./js/chart-builder/13-lollipop.js",
  "./js/chart-builder/14-bubble.js",
  "./js/chart-builder/15-sunburst.js",
  "./js/chart-builder/16-ridge-plot.js",
  "./js/chart-builder/17-sankey.js",
  "./js/chart-builder/18-scatter-matrix.js",
  "./js/chart-builder/19-bubble-map.js",
  "./js/chart-builder/20-dumbbell.js",
  "./js/palettes.js",
  "./js/data_formulas.js",
  "./js/data_view.js",
  "./js/dv_shelves.js",
  "./js/data_stats.js",
  "./js/color_picker.js",
  "./js/canvas_background.js",
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
  "./js/layout-editor/18-chart-quickbar.js",
  "./js/layout-editor/19-axis-tick-float.js",
  "./js/layout-editor/20-canvas-zoom.js",
  "./js/layout-editor/21-layers-panel.js",
  "./js/layout-editor/22-axis-format-panel.js",
  "./js/layout-editor/23-canvas-pan-scrollbars.js",
  "./js/layout-editor/24-text-float-bar.js",
  "./js/layout-editor/25-design-panel.js",
  "./js/layout-editor/26-selection-hud.js",
  "./js/layout-editor/27-object-float-bar.js",
  "./js/layout-editor/28-axis-controls-sync.js",
  "./js/layout-editor/29-sidebar-design.js",
  "./js/layout-editor/30-topbar.js",
  "./js/layout-editor/31-shape-stroke.js",
  "./js/ui_sections.js",
  "./js/help_search.js",
  "./js/latex_symbols.js",
  "./js/canvas_ruler.js",
  "./js/undo_redo.js",
  "./js/desktop-shell.js",
  "./css/glass.css",
  "./css/agro.css",
  "./css/home.css",
  "./js/home-thumbs.js",
  "./js/splash.js",
  "./js/agro/agro-loader.js",
  "./css/splash.css",
  "./assets/logo.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/landing/defani.jpg",
  "./assets/home/agro-eye-1.jpg",
  "./assets/home/agro-eye-3.jpg",
  "./assets/home/agro-eye-6.jpg",
  "./js/agro/agro-3d-real.js",
  "./js/agro/agroforestry.js",
  "./js/local-fonts.js",
  "./js/plugins.js",
  "./js/formats.js",
  "./js/file-browser.js",
  "./js/intro.js",
  "./js/lock.js",
  "./assets/logo_light.png",
  "./assets/logo_mark_light.png",
  "./assets/logo_mark_dark.png",
  "./assets/logo_dark.png",
  "./assets/logo_light.avif",
  "./assets/logo_dark.avif",
  "./assets/logo_dark-removebg-preview.png",
  "./assets/palettes.png"
];

const CDN_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // addAll is atomic — one missing file would abort the whole install —
      // so each URL is cached independently and failures are just skipped.
      .then((cache) => Promise.all(PRECACHE_URLS.map((u) => cache.add(u).catch(() => null))))
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

function putInCache(req, res) {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
  }
  return res;
}

// Same-origin: try the network, update the cache, fall back to cache offline.
function networkFirst(req) {
  return fetch(req)
    .then((res) => putInCache(req, res))
    .catch(() =>
      caches.match(req, { ignoreSearch: true }).then((cached) => {
        if (cached) return cached;
        if (req.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      })
    );
}

// Pinned CDN files: cache-first. Fetch in CORS mode (cdnjs/jsdelivr send
// Access-Control-Allow-Origin: *) so the status is visible and errors are
// never cached; fall back to the original no-cors request if CORS fails.
function cacheFirstCdn(req) {
  return caches.match(req.url).then((cached) => {
    if (cached) return cached;
    const corsReq = new Request(req.url, { mode: "cors", credentials: "omit" });
    return fetch(corsReq)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req.url, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => fetch(req));
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Video (range requests) goes straight to the network.
  if (req.headers.has("range") || /\.(webm|mp4)$/i.test(url.pathname)) return;

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (CDN_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirstCdn(req));
  }
  // Anything else (Google Fonts, Iconify API, …) is left to the browser.
});
