/* ==========================================================================
   GIS — location search (the box at the top left of the Analysis map),
   like QGIS's locator bar.

   As you type        features of the loaded vector layers whose attribute
                      values match, and coordinates typed as "lat, lon"
                      (decimal or degrees-minutes-seconds, e.g. 6°12'S
                      106°49'E).
   On Enter           places from OpenStreetMap's Nominatim. Nominatim's
                      usage policy asks for no search-as-you-type and at
                      most one request per second, so it is only asked on
                      Enter (or the search button), never faster than that.

   Picking a result zooms to it and marks it (boundary or point) until the
   next search or Escape; "Add as layer" keeps it as a vector layer.
   Ctrl+K focuses the box.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var NOMINATIM = "https://nominatim.openstreetmap.org/search";
  var SRC = "ploots-locate";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function map() { return GIS.analysis && GIS.analysis.map(); }

  /* ------------------------------------------------------ coordinates */

  function dms(s) {
    // 6°12'30"S, 6 12 30 S, -6.2083
    var m = String(s).trim().match(/^(-?\d+(?:\.\d+)?)\s*[°d:\s]\s*(?:(\d+(?:\.\d+)?)\s*['′m:\s]?\s*(?:(\d+(?:\.\d+)?)\s*["″s]?)?)?\s*([NSEW])?$/i);
    if (!m) return null;
    var v = Math.abs(+m[1]) + (m[2] ? +m[2] / 60 : 0) + (m[3] ? +m[3] / 3600 : 0);
    var neg = /^-/.test(m[1]) || /[SW]/i.test(m[4] || "");
    return { v: neg ? -v : v, axis: m[4] ? (/[NS]/i.test(m[4]) ? "lat" : "lon") : null };
  }
  function parseCoords(q) {
    var s = q.trim(), parts;
    var dec = s.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (dec) {
      var a = +dec[1], b = +dec[2];
      // lat, lon unless the first number cannot be a latitude.
      if (Math.abs(a) > 90 && Math.abs(b) <= 90) return { lon: a, lat: b };
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b };
      return null;
    }
    parts = s.split(/\s*[,;]\s*|\s+(?=-?\d+\s*[°d])/);
    if (parts.length !== 2) {
      var m = s.match(/^(.*?[NS])\s*(.*?[EW])$/i) || s.match(/^(.*?[EW])\s*(.*?[NS])$/i);
      if (m) parts = [m[1], m[2]];
    }
    if (!parts || parts.length !== 2) return null;
    var p = dms(parts[0]), r = dms(parts[1]);
    if (!p || !r) return null;
    var lat = p.axis === "lon" ? r.v : p.v, lon = p.axis === "lon" ? p.v : r.v;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat: lat, lon: lon };
  }

  /* ---------------------------------------------------------- layers */

  function layerMatches(q) {
    var term = q.trim().toLowerCase(), out = [];
    if (term.length < 2) return out;
    GIS.layers.forEach(function (l) {
      if (l.kind !== "vector" || !l.data) return;
      for (var i = 0; i < l.data.features.length && out.length < 12; i++) {
        var f = l.data.features[i], props = f.properties || {};
        for (var k in props) {
          var v = props[k];
          if (v != null && typeof v !== "object" && String(v).toLowerCase().indexOf(term) >= 0) {
            out.push({ kind: "feature", layer: l, index: i, feature: f, label: String(v), sub: l.name + " · " + k });
            break;
          }
        }
      }
    });
    return out;
  }

  /* ------------------------------------------------------- nominatim */

  var lastAsk = 0;
  function nominatim(q) {
    var wait = Math.max(0, lastAsk + 1100 - Date.now());
    return new Promise(function (res) { setTimeout(res, wait); }).then(function () {
      lastAsk = Date.now();
      var url = NOMINATIM + "?format=jsonv2&limit=8&polygon_geojson=1&polygon_threshold=0.0005&q=" + encodeURIComponent(q) +
        "&accept-language=" + encodeURIComponent(navigator.language || "en");
      return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) {
        if (!r.ok) throw new Error("Place search: HTTP " + r.status);
        return r.json();
      });
    }).then(function (list) {
      return list.map(function (p) {
        var bb = p.boundingbox ? p.boundingbox.map(Number) : null; // [s, n, w, e]
        return { kind: "place", label: p.name || p.display_name.split(",")[0], sub: p.display_name, type: (p.type || "").replace(/_/g, " "),
          lon: +p.lon, lat: +p.lat, bbox: bb ? [bb[2], bb[0], bb[3], bb[1]] : null, geojson: p.geojson };
      });
    });
  }

  /* ------------------------------------------------------------- map */

  function mark(geom) {
    var m = map();
    if (!m) return;
    var data = { type: "FeatureCollection", features: geom ? [{ type: "Feature", properties: {}, geometry: geom }] : [] };
    if (m.getSource(SRC)) { m.getSource(SRC).setData(data); return; }
    if (!geom || !m.isStyleLoaded()) return;
    m.addSource(SRC, { type: "geojson", data: data });
    m.addLayer({ id: SRC + "-fill", type: "fill", source: SRC, filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false], paint: { "fill-color": "#ff5a1f", "fill-opacity": 0.12 } });
    m.addLayer({ id: SRC + "-line", type: "line", source: SRC, filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": "#ff5a1f", "line-width": 2.2 } });
    m.addLayer({ id: SRC + "-pt", type: "circle", source: SRC, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 7, "circle-color": "#ff5a1f", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } });
  }
  function bboxOf(geom) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    (function walk(c) { if (typeof c[0] === "number") { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(walk); })(geom.type === "GeometryCollection" ? geom.geometries.map(function (g) { return g.coordinates; }) : geom.coordinates);
    return b;
  }
  function go(r) {
    var m = map();
    if (!m) return;
    var geom = r.kind === "feature" ? r.feature.geometry : r.geojson && r.geojson.type !== "Point" ? r.geojson : { type: "Point", coordinates: [r.lon, r.lat] };
    mark(geom);
    var bb = r.kind === "place" && r.bbox ? r.bbox : geom && geom.type !== "Point" ? bboxOf(geom) : null;
    if (bb && (bb[2] - bb[0] > 1e-6 || bb[3] - bb[1] > 1e-6)) m.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 60, maxZoom: 16, duration: 900 });
    else { var c = geom.coordinates; m.flyTo({ center: c, zoom: Math.max(m.getZoom(), r.kind === "coord" ? 14 : 15), duration: 900 }); }
    if (r.kind === "feature") { GIS.setActive(r.layer.id); r.layer.selection = new Set([r.index]); GIS.emit("selection"); }
  }
  function addLayer(r) {
    var geom = r.kind === "feature" ? r.feature.geometry : r.geojson || { type: "Point", coordinates: [r.lon, r.lat] };
    var props = r.kind === "place" ? { name: r.label, type: r.type, address: r.sub, source: "OpenStreetMap Nominatim" } : { name: r.label };
    var l = GIS.addVector({ type: "FeatureCollection", features: [{ type: "Feature", properties: props, geometry: geom }] }, r.label);
    if (l && r.kind === "place") l.attribution = "© OpenStreetMap contributors (Nominatim)";
    mark(null);
  }

  /* -------------------------------------------------------------- UI */

  var box = null, input, list, results = [], sel = -1;
  function build(host) {
    if (box && host.contains(box)) return;
    if (box) box.remove();
    box = document.createElement("div");
    box.className = "gloc";
    box.innerHTML = '<div class="gloc-bar">' + sym("search") +
      '<input type="search" placeholder="Search places, coordinates or layer features" spellcheck="false" autocomplete="off">' +
      '<kbd>Ctrl K</kbd><button type="button" class="gloc-go" title="Search places (OpenStreetMap)">' + sym("travel_explore") + "</button></div>" +
      '<div class="gloc-list" hidden></div>';
    host.appendChild(box);
    input = box.querySelector("input");
    list = box.querySelector(".gloc-list");
    input.addEventListener("input", function () { local(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); if (sel >= 0 && results[sel] && results[sel].kind !== "hint") pickAt(sel); else places(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1); }
      else if (e.key === "Escape") { if (!list.hidden) hide(); else { input.value = ""; mark(null); input.blur(); } }
    });
    input.addEventListener("focus", function () { if (results.length) list.hidden = false; });
    box.querySelector(".gloc-go").addEventListener("click", places);
    list.addEventListener("mousedown", function (e) { e.preventDefault(); });
    list.addEventListener("click", function (e) {
      var a = e.target.closest("[data-add]");
      if (a) { addLayer(results[+a.dataset.add]); hide(); return; }
      var r = e.target.closest("[data-i]");
      if (r) pickAt(+r.dataset.i);
    });
    document.addEventListener("mousedown", function (e) { if (box && !box.contains(e.target)) hide(); });
  }
  function hide() { if (list) list.hidden = true; }
  function show(rs, note) {
    results = rs;
    sel = rs.length && rs[0].kind !== "hint" ? 0 : -1;
    var h = "";
    rs.forEach(function (r, i) {
      var icon = r.kind === "coord" ? "my_location" : r.kind === "feature" ? "polyline" : r.kind === "hint" ? "keyboard_return" : "place";
      h += '<div class="gloc-row' + (i === sel ? " sel" : "") + (r.kind === "hint" ? " hint" : "") + '" data-i="' + i + '">' + sym(icon) +
        '<div class="gloc-txt"><b>' + esc(r.label) + "</b>" + (r.sub ? "<span>" + esc(r.sub) + "</span>" : "") + "</div>" +
        (r.type ? '<em>' + esc(r.type) + "</em>" : "") +
        (r.kind === "place" || r.kind === "coord" ? '<button type="button" data-add="' + i + '" title="Add as layer">' + sym("add_location_alt") + "</button>" : "") + "</div>";
    });
    if (note) h += '<div class="gloc-note">' + note + "</div>";
    list.innerHTML = h;
    list.hidden = !h;
  }
  function move(d) {
    var rows = list.querySelectorAll(".gloc-row:not(.hint)");
    if (!rows.length) return;
    sel = Math.max(0, Math.min(results.length - 1, sel + d));
    Array.prototype.forEach.call(list.querySelectorAll(".gloc-row"), function (r) { r.classList.toggle("sel", +r.dataset.i === sel); });
  }
  function pickAt(i) {
    var r = results[i];
    if (!r || r.kind === "hint") { places(); return; }
    go(r);
    hide();
  }
  function local() {
    var q = input.value;
    if (!q.trim()) { show([]); return; }
    var rs = [], c = parseCoords(q);
    if (c) rs.push({ kind: "coord", label: c.lat.toFixed(6) + ", " + c.lon.toFixed(6), sub: "Coordinates (WGS 84)", lat: c.lat, lon: c.lon, geojson: { type: "Point", coordinates: [c.lon, c.lat] } });
    rs = rs.concat(layerMatches(q));
    rs.push({ kind: "hint", label: "Press Enter to search places", sub: "OpenStreetMap Nominatim" });
    show(rs);
  }
  function places() {
    var q = input.value.trim();
    if (!q) return;
    var c = parseCoords(q);
    if (c) { local(); pickAt(0); return; }
    show(results.filter(function (r) { return r.kind !== "hint"; }), "Searching places…");
    nominatim(q).then(function (ps) {
      var rs = results.filter(function (r) { return r.kind === "feature" || r.kind === "coord"; }).concat(ps);
      show(rs, ps.length ? "Places © OpenStreetMap contributors" : "No places found.");
      if (ps.length && !results.some(function (r) { return r.kind === "feature"; })) { sel = rs.indexOf(ps[0]); move(0); }
    }).catch(function (e) { show(results.filter(function (r) { return r.kind !== "hint"; }), esc(e.message)); });
  }

  // Mount on the Analysis map once it exists.
  function mount() {
    var host = document.getElementById("gisAnalysisHost");
    if (host) build(host);
  }
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K") && document.body.classList.contains("gis-analysis")) {
      e.preventDefault(); mount(); input.focus(); input.select();
    }
  });
  new MutationObserver(function () { if (document.body.classList.contains("gis-analysis")) mount(); })
    .observe(document.body, { attributes: true, attributeFilter: ["class"] });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(mount, 0); }); else setTimeout(mount, 0);

  GIS.locator = { parseCoords: parseCoords, focus: function () { mount(); if (input) input.focus(); } };
})();
