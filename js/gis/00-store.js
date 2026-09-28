/* ==========================================================================
   GIS — layer store.

   The map workspace (Home -> Map) works like a small QGIS: a list of layers
   drawn by MapLibre GL in the page's map frame, plus layout items (legend,
   scale bar, north arrow, inset map) placed freely on the page.

   window.PlootsGIS holds the layers. Layer data is kept here rather than in
   `state`, so the undo history (which snapshots state) never copies large
   files. Map-level settings (basemap, grid, frame, lock, view) live in
   state.map*.

   Layer kinds:
     vector  GeoJSON FeatureCollection; style = QGIS-like symbology
     raster  georeferenced image (GeoTIFF) as a MapLibre image source
     xyz     raster tile URL template

   Events (PlootsGIS.on): "layers" (added/removed/reordered/renamed),
   "style" (symbology or visibility), "data" (features edited),
   "selection", "active".
   ========================================================================== */
(function () {
  "use strict";

  var TYPE = "geojson-map";

  var MAP_DEFAULTS = {
    mapBasemap: "positron",
    mapView: null,          // { center, zoom, bearing, pitch }
    mapLock: false,
    mapFrame: true, mapFrameWidth: 1, mapFrameColor: "#1a1a1a",
    mapGrid: false, mapGridInterval: 0, mapGridStyle: "lines", mapGridColor: "#6b6b66",
    mapGridWidth: 0.6, mapGridLabels: "lb", mapGridFormat: "dms", mapGridFontSize: 9,
    mapPanelSide: "left"
  };

  var STYLE_DEFAULTS = {
    symbology: "single", field: "", joinField: "",
    singleColor: "#2f6360", catColors: {}, classes: 5, method: "jenks", ramp: "YlGn", reverse: false,
    fillOpacity: 0.8, strokeColor: "#ffffff", strokeWidth: 0.8, pointRadius: 6, lineWidth: 2,
    missingColor: "#d9d6cc", labelField: "", labelSize: 12, labelColor: "#1a1a1a"
  };

  function ensureState() {
    Object.keys(MAP_DEFAULTS).forEach(function (k) { if (state[k] === undefined) state[k] = MAP_DEFAULTS[k]; });
  }
  ensureState();

  var listeners = {};
  var nextId = 1;

  var GIS = window.PlootsGIS = {
    TYPE: TYPE,
    TABLE_FIELD: "__table__",
    layers: [],        // index 0 = top of the list = drawn last (on top)
    activeId: null,
    rev: 0,
    ensureState: ensureState,

    on: function (evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    emit: function (evt, arg) {
      GIS.rev++;
      (listeners[evt] || []).concat(listeners["*"] || []).forEach(function (fn) { try { fn(arg, evt); } catch (e) { console.error(e); } });
    },

    get: function (id) { return GIS.layers.filter(function (l) { return l.id === id; })[0] || null; },
    active: function () { return GIS.get(GIS.activeId) || GIS.layers[0] || null; },
    setActive: function (id) { GIS.activeId = id; GIS.emit("active", id); },
    vectors: function () { return GIS.layers.filter(function (l) { return l.kind === "vector"; }); },

    // Accepts FeatureCollection, Feature, bare geometry or TopoJSON.
    normalise: function (obj) {
      if (!obj || typeof obj !== "object") throw new Error("Not a JSON object.");
      if (obj.type === "Topology") {
        var feats = [];
        Object.keys(obj.objects || {}).forEach(function (k) { feats = feats.concat(PlootsD3.topoFeature(obj, obj.objects[k]).features); });
        return { type: "FeatureCollection", features: feats };
      }
      if (obj.type === "FeatureCollection") return { type: "FeatureCollection", features: (obj.features || []).filter(function (f) { return f && f.geometry; }) };
      if (obj.type === "Feature") return { type: "FeatureCollection", features: obj.geometry ? [obj] : [] };
      if (obj.type && obj.coordinates) return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: obj }] };
      throw new Error("Unknown GeoJSON type: " + obj.type);
    },

    addVector: function (obj, name) {
      var fc = GIS.normalise(obj);
      if (!fc.features.length) throw new Error("No features with geometry.");
      fc.features.forEach(function (f) { f.properties = f.properties || {}; });
      var layer = {
        id: "L" + (nextId++), kind: "vector", name: name || "Layer", visible: true, opacity: 1,
        data: fc, selection: new Set(), style: JSON.parse(JSON.stringify(STYLE_DEFAULTS))
      };
      var pal = PALETTES[state.paletteIdx].colors;
      layer.style.singleColor = pal[GIS.layers.length % pal.length];
      GIS.layers.unshift(layer);
      GIS.activeId = layer.id;
      GIS.emit("layers");
      return layer;
    },

    addRaster: function (raster, name) {
      var layer = { id: "L" + (nextId++), kind: "raster", name: name || "Raster", visible: true, opacity: 1, raster: raster };
      GIS.layers.unshift(layer);
      GIS.activeId = layer.id;
      GIS.emit("layers");
      return layer;
    },

    addXYZ: function (url, name, attribution) {
      var layer = { id: "L" + (nextId++), kind: "xyz", name: name || "Tiles", visible: true, opacity: 1, url: url, attribution: attribution || "" };
      // Tile layers go to the bottom, like a basemap.
      GIS.layers.push(layer);
      GIS.activeId = layer.id;
      GIS.emit("layers");
      return layer;
    },

    remove: function (id) {
      GIS.layers = GIS.layers.filter(function (l) { return l.id !== id; });
      if (GIS.activeId === id) GIS.activeId = GIS.layers[0] ? GIS.layers[0].id : null;
      GIS.emit("layers");
    },

    move: function (id, to) {
      var i = GIS.layers.findIndex(function (l) { return l.id === id; });
      if (i < 0) return;
      var l = GIS.layers.splice(i, 1)[0];
      GIS.layers.splice(Math.max(0, Math.min(GIS.layers.length, to)), 0, l);
      GIS.emit("layers");
    },

    // Property names over the first 500 features; numeric = every non-empty
    // value parses as a number.
    fields: function (layer) {
      var all = [], numeric = [], seen = {}, isNum = {};
      if (!layer || layer.kind !== "vector") return { all: all, numeric: numeric };
      layer.data.features.slice(0, 500).forEach(function (f) {
        Object.keys(f.properties).forEach(function (k) {
          var v = f.properties[k];
          if (!seen[k]) { seen[k] = true; all.push(k); isNum[k] = true; }
          if (v === null || v === "" || v === undefined) return;
          if (typeof v === "object" || typeof v === "boolean" || !isFinite(Number(v))) isNum[k] = false;
        });
      });
      all.forEach(function (k) { if (isNum[k]) numeric.push(k); });
      return { all: all, numeric: numeric };
    },

    geometryKind: function (layer) {
      var k = {};
      (layer && layer.kind === "vector" ? layer.data.features : []).forEach(function (f) {
        var t = f.geometry.type.replace("Multi", "");
        k[t === "LineString" ? "line" : t === "Point" ? "point" : "polygon"] = true;
      });
      return k.polygon ? "polygon" : k.line ? "line" : k.point ? "point" : "polygon";
    },

    // Data-table lookup for the "join to table" value source:
    // category (lower-cased) -> first visible series value.
    table: function () {
      var vis = state.seriesNames.filter(function (n) { return state.seriesMeta[n] && state.seriesMeta[n].visible; })[0];
      var out = {};
      if (!vis) return out;
      state.categories.forEach(function (c, i) {
        var v = state.seriesData[vis][i];
        if (c != null && typeof v === "number" && isFinite(v)) out[String(c).trim().toLowerCase()] = v;
      });
      return out;
    },

    valueOf: function (layer, f, table) {
      var s = layer.style;
      if (s.field === GIS.TABLE_FIELD) {
        var key = f.properties[s.joinField];
        return table && key != null ? table[String(key).trim().toLowerCase()] : undefined;
      }
      return f.properties[s.field];
    },

    bounds: function (layers) {
      var xs = [], ys = [];
      function walk(c) { if (typeof c[0] === "number") { xs.push(c[0]); ys.push(c[1]); } else c.forEach(walk); }
      (layers || GIS.layers).forEach(function (l) {
        if (!l.visible) return;
        if (l.kind === "vector") l.data.features.forEach(function (f) { walk(f.geometry.coordinates); });
        else if (l.kind === "raster") l.raster.coordinates.forEach(function (c) { xs.push(c[0]); ys.push(c[1]); });
      });
      if (!xs.length) return null;
      return [[d3.min(xs), d3.min(ys)], [d3.max(xs), d3.max(ys)]];
    },

    featureBounds: function (features) {
      var xs = [], ys = [];
      function walk(c) { if (typeof c[0] === "number") { xs.push(c[0]); ys.push(c[1]); } else c.forEach(walk); }
      features.forEach(function (f) { walk(f.geometry.coordinates); });
      return xs.length ? [[d3.min(xs), d3.min(ys)], [d3.max(xs), d3.max(ys)]] : null;
    },

    download: function (text, filename, mime) {
      var blob = new Blob([text], { type: mime || "application/octet-stream" });
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    },

    exportGeoJSON: function (layer, selectedOnly) {
      var feats = layer.data.features.filter(function (f, i) { return !selectedOnly || layer.selection.has(i); });
      GIS.download(JSON.stringify({ type: "FeatureCollection", features: feats }), safeName(layer.name) + (selectedOnly ? "_selected" : "") + ".geojson", "application/geo+json");
    },

    exportCSV: function (layer, selectedOnly) {
      var fields = GIS.fields(layer).all;
      var rows = [fields.concat(["geometry_type", "x", "y"])];
      layer.data.features.forEach(function (f, i) {
        if (selectedOnly && !layer.selection.has(i)) return;
        var c = f.geometry.type === "Point" ? f.geometry.coordinates : null;
        if (!c) { var b = GIS.featureBounds([f]); c = b ? [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2] : ["", ""]; }
        rows.push(fields.map(function (k) { var v = f.properties[k]; return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : v; }).concat([f.geometry.type, c[0], c[1]]));
      });
      var csv = rows.map(function (r) { return r.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
      GIS.download(csv, safeName(layer.name) + (selectedOnly ? "_selected" : "") + ".csv", "text/csv");
    }
  };

  function safeName(s) { return String(s || "layer").replace(/[\\/:*?"<>|]+/g, "").replace(/\.(geo)?json$/i, "").trim() || "layer"; }

  // Offline sample: Southeast Asian countries from the bundled Natural Earth
  // topojson, with UN 2023 population estimates (millions) and subregion.
  var SEA = {
    IDN: ["Indonesia", "Maritime", 277.5], MYS: ["Malaysia", "Maritime", 34.3], PHL: ["Philippines", "Maritime", 117.3],
    BRN: ["Brunei", "Maritime", 0.45], TLS: ["Timor-Leste", "Maritime", 1.36], THA: ["Thailand", "Mainland", 71.8],
    VNM: ["Vietnam", "Mainland", 98.9], MMR: ["Myanmar", "Mainland", 54.6], KHM: ["Cambodia", "Mainland", 16.9],
    LAO: ["Laos", "Mainland", 7.6]
  };
  GIS.loadSample = function () {
    return fetch("vendor/topojson/asia_110m.json")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (topo) {
        var fc = PlootsD3.topoFeature(topo, topo.objects.countries);
        return {
          type: "FeatureCollection",
          features: fc.features.filter(function (f) { return SEA[f.id]; }).map(function (f) {
            var m = SEA[f.id];
            return { type: "Feature", geometry: f.geometry, properties: { name: m[0], iso3: f.id, subregion: m[1], population_m: m[2] } };
          })
        };
      });
  };

  if (typeof SAMPLE_DATA_BY_TYPE !== "undefined") {
    // Data-table rows for the "join to table" value source.
    SAMPLE_DATA_BY_TYPE[TYPE] = "Country\tLand area (thousand km²)\nIndonesia\t1904.6\nMalaysia\t330.8\nPhilippines\t300.0\nMyanmar\t676.6\nThailand\t513.1\nVietnam\t331.2\nCambodia\t181.0\nLaos\t236.8\nBrunei\t5.8\nTimor-Leste\t14.9";
  }
})();
