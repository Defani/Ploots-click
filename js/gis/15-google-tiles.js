/* ==========================================================================
   GIS — Google Maps basemaps (roadmap, satellite, hybrid, terrain).

   As in GeoLibre's basemap catalog: without an API key the public Google
   tiles are used (mt1.google.com, lyrs=m / s / y / p). With the user's own
   Map Tiles API key (Google Cloud), the licensed 2D Tiles API is used
   instead, with a session token per map type. The key stays in this
   browser / desktop profile (localStorage) and is sent only to Google.

   Sessions last about two weeks; they are cached and renewed a day before
   they expire. While a session is being created the public tiles show.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var KEY = "ploots-google-maps-key", SESS = "ploots-google-maps-sessions";
  var API = "https://tile.googleapis.com/v1/";
  var PUBLIC = { roadmap: "m", satellite: "s", hybrid: "y", terrain: "p" };
  // Session request per basemap type.
  var TYPES = {
    roadmap: { mapType: "roadmap" },
    satellite: { mapType: "satellite" },
    hybrid: { mapType: "satellite", layerTypes: ["layerRoadmap"] },
    terrain: { mapType: "terrain", layerTypes: ["layerRoadmap"] }
  };

  function get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } }
  function apiKey() { return get(KEY, ""); }
  function sessions() { try { return JSON.parse(get(SESS, "{}")) || {}; } catch (e) { return {}; } }

  var pending = {};
  function createSession(type) {
    if (pending[type]) return pending[type];
    var body = Object.assign({ language: navigator.language || "en-US", region: "ID", scale: "scaleFactor1x" }, TYPES[type]);
    pending[type] = fetch(API + "createSession?key=" + encodeURIComponent(apiKey()), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j.error && j.error.message) || ("Google Map Tiles API: HTTP " + r.status));
        var all = sessions();
        all[type] = { session: j.session, expiry: +j.expiry * 1000 || Date.now() + 12 * 864e5, key: apiKey() };
        set(SESS, JSON.stringify(all));
        return all[type];
      });
    }).finally(function () { delete pending[type]; });
    return pending[type];
  }
  function validSession(type) {
    var s = sessions()[type];
    return s && s.key === apiKey() && s.expiry - Date.now() > 864e5 ? s : null;
  }

  function toast(m) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(m); }

  // The style for a Google basemap entry ({ google: "roadmap" | ... }).
  function style(b) {
    var type = b.google, s = apiKey() ? validSession(type) : null;
    if (apiKey() && !s) {
      createSession(type).then(function () { if (GIS.refreshBasemap) GIS.refreshBasemap(); })
        .catch(function (e) { toast(e.message); });
    }
    var url = s ? API + "2dtiles/{z}/{x}/{y}?session=" + encodeURIComponent(s.session) + "&key=" + encodeURIComponent(s.key)
      : "https://mt1.google.com/vt/lyrs=" + PUBLIC[type] + "&x={x}&y={y}&z={z}";
    return {
      version: 8, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      sources: { basemap: { type: "raster", tiles: [url], tileSize: 256, maxzoom: s ? 22 : 20 } },
      layers: [{ id: "background", type: "background", paint: { "background-color": "#ffffff" } }, { id: "basemap", type: "raster", source: "basemap" }]
    };
  }

  // Optional: the user's own Map Tiles API key. Nothing is filled in for them.
  function askKey() {
    var v = window.prompt("Optional: your own Google Map Tiles API key (Google Cloud console, enable \"Map Tiles API\", " +
      "create an API key). With a key the licensed Map Tiles API is used; without one, the public Google tiles.\n\n" +
      "The key is stored only on this computer. Leave empty to remove it.", apiKey());
    if (v == null) return false;
    v = v.trim();
    set(KEY, v || null);
    set(SESS, null);
    if (GIS.refreshBasemap) GIS.refreshBasemap();
    return !!v;
  }

  GIS.google = { style: style, hasKey: function () { return !!apiKey(); }, askKey: askKey };
})();
