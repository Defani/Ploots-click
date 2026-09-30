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
     mvt     vector tile URL template (one colour)

   Common layer settings (QGIS layer properties): legend (show in legend
   items), legendName, filter (expression, see GIS.expr), minScale/maxScale
   (scale-dependent visibility, 1:N; 0 = no limit), showCount.

   Maps (like ArcGIS Pro): the project holds several maps, each with its
   own layers, basemap and last view. GIS.layers is always the active map's
   list (the same array), so everything that works on "the layers" works
   on the active map. The page's main map frame can show another map
   (state.layoutMapId), and more map frames can be placed on the page
   (js/gis/26-maps.js).

   Events (PlootsGIS.on): "layers" (added/removed/reordered/renamed),
   "style" (symbology or visibility), "data" (features edited),
   "selection", "active", "maps" (maps added, renamed, removed, switched).
   ========================================================================== */
(function () {
  "use strict";

  var TYPE = "geojson-map";

  var MAP_DEFAULTS = {
    mapBasemap: "google-roadmap",
    mapView: null,          // { center, zoom, bearing, pitch }
    mapLock: false,
    mapFrame: true, mapFrameWidth: 1, mapFrameColor: "#1a1a1a",
    mapGrid: false, mapGridInterval: 0, mapGridStyle: "lines", mapGridColor: "#6b6b66",
    mapGridWidth: 0.6, mapGridLabels: "lb", mapGridFormat: "dms", mapGridFontSize: 9,
    mapGridType: "geographic", mapGridUtmZone: 0, mapGridLabelPos: "inside", mapGridUnits: "m",
    mapPanelSide: "left"
  };

  var STYLE_DEFAULTS = {
    symbology: "single", field: "", joinField: "",
    singleColor: "#2f6360", catColors: {}, classes: 5, method: "jenks", ramp: "YlGn", reverse: false,
    fillOpacity: 0.8, strokeColor: "#ffffff", strokeWidth: 0.8, pointRadius: 6, lineWidth: 2,
    strokeDash: "solid", lineDash: "solid",
    missingColor: "#d9d6cc", labelField: "", labelSize: 12, labelColor: "#1a1a1a",
    // Labels: {field} template, halo, font, placement along lines, overlap.
    labelTemplate: "", labelHaloColor: "#ffffff", labelHaloWidth: 1.4, labelFont: "regular", labelPlacement: "auto", labelOverlap: false,
    // Renderer: simple features, proportional circles, or heatmap.
    renderer: "simple", sizeField: "", sizeMin: 4, sizeMax: 28, sizeScale: "sqrt",
    heatField: "", heatRadius: 25, heatIntensity: 1, heatRamp: "YlOrRd", heatOpacity: 0.85
  };

  function ensureState() {
    Object.keys(MAP_DEFAULTS).forEach(function (k) { if (state[k] === undefined) state[k] = MAP_DEFAULTS[k]; });
  }
  ensureState();

  var listeners = {};
  var nextId = 1, nextMap = 2;

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

    /* ------------------------------------------------------------ maps */
    maps: [],
    activeMapId: null,
    mapById: function (id) { return GIS.maps.filter(function (m) { return m.id === id; })[0] || null; },
    activeMap: function () { return GIS.mapById(GIS.activeMapId) || GIS.maps[0]; },
    // Basemap of a map: the active one's lives in state.mapBasemap.
    mapBasemap: function (m) { return m === GIS.activeMap() ? state.mapBasemap : m.basemap; },
    setActiveMap: function (id) {
      var next = GIS.mapById(id), cur = GIS.activeMap();
      if (!next || next === cur) return;
      cur.basemap = state.mapBasemap;
      cur.activeId = GIS.activeId;
      if (GIS.analysis && GIS.analysis.map && GIS.analysis.map()) { var am = GIS.analysis.map(), c = am.getCenter(); cur.view = { center: [c.lng, c.lat], zoom: am.getZoom(), bearing: am.getBearing(), pitch: am.getPitch() }; }
      GIS.activeMapId = next.id;
      GIS.layers = next.layers;
      GIS.activeId = next.activeId || (next.layers[0] && next.layers[0].id) || null;
      state.mapBasemap = next.basemap || state.mapBasemap;
      GIS.emit("maps", next);
      GIS.emit("layers");
      if (GIS.refreshBasemap) GIS.refreshBasemap();
      if (next.view && GIS.analysis && GIS.analysis.map && GIS.analysis.map()) GIS.analysis.map().jumpTo(next.view);
    },
    addMap: function (name, from) {
      var m = { id: "M" + (nextMap++), name: name || "Map " + nextMap, layers: [], basemap: from ? GIS.mapBasemap(from) : state.mapBasemap, activeId: null, view: null };
      if (from) {
        m.layers = from.layers.map(function (l) {
          var c = Object.assign({}, l, { id: "L" + (nextId++) });
          if (l.data) c.data = JSON.parse(JSON.stringify(l.data));
          if (l.style) c.style = JSON.parse(JSON.stringify(l.style));
          if (l.selection) c.selection = new Set();
          return c;
        });
        m.view = from.view;
      }
      GIS.maps.push(m);
      GIS.emit("maps", m);
      return m;
    },
    renameMap: function (id, name) { var m = GIS.mapById(id); if (m && name) { m.name = name; GIS.emit("maps", m); } },
    removeMap: function (id) {
      if (GIS.maps.length < 2) throw new Error("A project keeps at least one map.");
      var m = GIS.mapById(id);
      if (!m) return;
      if (m === GIS.activeMap()) GIS.setActiveMap(GIS.maps.filter(function (x) { return x !== m; })[0].id);
      GIS.maps.splice(GIS.maps.indexOf(m), 1);
      if (state.layoutMapId === id) state.layoutMapId = null;
      GIS.emit("maps");
      GIS.emit("layers");
    },
    // A layer by id in any map.
    findLayer: function (id) { for (var i = 0; i < GIS.maps.length; i++) { var l = GIS.maps[i].layers.filter(function (x) { return x.id === id; })[0]; if (l) return l; } return null; },
    STYLE_DEFAULTS: STYLE_DEFAULTS,
    // Fills in style keys added after a layer was created.
    ensureStyle: function (l) {
      if (!l || l.kind !== "vector") return;
      Object.keys(STYLE_DEFAULTS).forEach(function (k) { if (l.style[k] === undefined) l.style[k] = JSON.parse(JSON.stringify(STYLE_DEFAULTS[k])); });
    },
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

    // Vector tile layer (e.g. a GFW dataset): drawn from tiles, one colour.
    addMVT: function (url, sourceLayer, name, attribution) {
      var pal = PALETTES[state.paletteIdx].colors;
      var layer = { id: "L" + (nextId++), kind: "mvt", name: name || "Vector tiles", visible: true, opacity: 1, url: url, sourceLayer: sourceLayer,
        attribution: attribution || "", color: pal[GIS.layers.length % pal.length] };
      GIS.layers.unshift(layer);
      GIS.activeId = layer.id;
      GIS.emit("layers");
      return layer;
    },

    // Copy of a layer (data and style are deep-copied), placed above it.
    duplicate: function (id) {
      var src = GIS.get(id);
      if (!src) return null;
      var copy = Object.assign({}, src, { id: "L" + (nextId++), name: src.name + " copy" });
      if (src.kind === "vector") {
        copy.data = JSON.parse(JSON.stringify(src.data));
        copy.style = JSON.parse(JSON.stringify(src.style));
        copy.selection = new Set();
      }
      if (src.kind === "raster") copy.raster = Object.assign({}, src.raster);
      GIS.layers.splice(GIS.layers.indexOf(src), 0, copy);
      GIS.activeId = copy.id;
      GIS.emit("layers");
      return copy;
    },

    // Feature indices kept by the layer filter (definition query), or null
    // when there is no filter. A broken filter keeps everything.
    filterMask: function (layer) {
      if (!layer || layer.kind !== "vector" || !layer.filter) return null;
      var fn;
      try { fn = GIS.expr.compile(layer.filter); } catch (e) { return null; }
      return layer.data.features.map(function (f) { try { return !!fn(f.properties); } catch (e) { return false; } });
    },
    selectWhere: function (layer, expression, mode) {
      var fn = GIS.expr.compile(expression), next = mode === "add" || mode === "remove" || mode === "within" ? new Set(layer.selection) : new Set();
      layer.data.features.forEach(function (f, i) {
        var hit = false;
        try { hit = !!fn(f.properties); } catch (e) { }
        if (mode === "remove") { if (hit) next.delete(i); }
        else if (mode === "within") { if (!hit) next.delete(i); }
        else if (hit) next.add(i);
      });
      layer.selection = next;
      GIS.emit("selection");
      return next.size;
    },

    remove: function (id) {
      // In place: the array belongs to the active map.
      var at = GIS.layers.findIndex(function (l) { return l.id === id; });
      if (at >= 0) GIS.layers.splice(at, 1);
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

    // Shapefile (.zip), KML or GPX through PlootsFormats (js/formats.js).
    // KML keeps the layer's colors for single and categorized symbology.
    exportFormat: function (layer, fmt, selectedOnly) {
      var F = window.PlootsFormats;
      if (!F) throw new Error("The format writers are not loaded.");
      var feats = layer.data.features.filter(function (f, i) { return !selectedOnly || layer.selection.has(i); });
      var fc = { type: "FeatureCollection", features: feats }, name = safeName(layer.name) + (selectedOnly ? "_selected" : "");
      if (fmt === "shp") {
        var blob = F.toShapefileZip(fc, name), url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = name + "_shp.zip"; a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        return;
      }
      if (fmt === "kml") {
        var s = layer.style, colorOf = null;
        if (s.symbology === "single" || !s.field) colorOf = function () { return s.singleColor; };
        else if (s.symbology === "categorized" && GIS.sym) {
          var map = {};
          GIS.sym.categories(layer).forEach(function (c) { map[String(c.value)] = c.color; });
          colorOf = function (f) { return map[String(GIS.valueOf(layer, f, GIS.table()))] || s.missingColor; };
        }
        GIS.download(F.toKML(fc, layer.name, colorOf), name + ".kml", "application/vnd.google-earth.kml+xml");
        return;
      }
      if (fmt === "gpx") { GIS.download(F.toGPX(fc, layer.name), name + ".gpx", "application/gpx+xml"); return; }
      throw new Error("Unknown export format " + fmt + ".");
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
  GIS.maps.push({ id: "M1", name: "Map 1", layers: GIS.layers, basemap: state.mapBasemap, activeId: null, view: null });
  GIS.activeMapId = "M1";

  /* ------------------------------------------------------ expressions */
  // A small QGIS-style expression language for filters and "select by
  // expression", compiled without eval:
  //   "population" > 50 AND "subregion" = 'Maritime'
  //   name LIKE 'Ma%'   iso3 IN ('IDN', 'MYS')   "area" IS NOT NULL
  //   ("pop" / "area") * 1000 >= 2   NOT "flag"
  // Field names are bare words or "double quoted"; text is 'single quoted'.
  // Geometry variables (QGIS names, on the WGS 84 ellipsoid's sphere):
  //   $area (m²), $length and $perimeter (m), $x, $y (point or centroid),
  //   $id (feature number from 1), e.g. $area / 10000 > 5  (over 5 ha).
  var KEYWORDS = /^(AND|OR|NOT|IN|LIKE|ILIKE|IS|NULL|TRUE|FALSE)$/i;
  function tokenize(src) {
    var out = [], i = 0, m;
    while (i < src.length) {
      var rest = src.slice(i);
      if ((m = /^\s+/.exec(rest))) { i += m[0].length; continue; }
      if ((m = /^(\d+\.?\d*(e[+-]?\d+)?|\.\d+)/i.exec(rest))) { out.push({ t: "num", v: parseFloat(m[0]) }); i += m[0].length; continue; }
      if (rest[0] === "'") {
        var s = "", j = i + 1;
        for (; j < src.length; j++) { if (src[j] === "'") { if (src[j + 1] === "'") { s += "'"; j++; continue; } break; } s += src[j]; }
        if (j >= src.length) throw new Error("Unclosed text");
        out.push({ t: "str", v: s }); i = j + 1; continue;
      }
      if (rest[0] === '"') {
        var e = src.indexOf('"', i + 1);
        if (e < 0) throw new Error("Unclosed field name");
        out.push({ t: "field", v: src.slice(i + 1, e) }); i = e + 1; continue;
      }
      if ((m = /^\$[A-Za-z]+/.exec(rest))) { out.push({ t: "var", v: m[0].toLowerCase() }); i += m[0].length; continue; }
      if ((m = /^(<=|>=|<>|!=|==|\|\||[=<>+\-*\/%(),])/.exec(rest))) { out.push({ t: "op", v: m[0] }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_\u00C0-\uFFFF][\w\u00C0-\uFFFF]*/.exec(rest))) {
        out.push(KEYWORDS.test(m[0]) ? { t: "kw", v: m[0].toUpperCase() } : { t: "field", v: m[0] }); i += m[0].length; continue;
      }
      throw new Error("Unexpected '" + rest[0] + "'");
    }
    return out;
  }
  function num(v) { return v === null || v === undefined || v === "" ? NaN : Number(v); }
  function cmpVals(a, b) {
    var na = num(a), nb = num(b);
    if (isFinite(na) && isFinite(nb)) return na < nb ? -1 : na > nb ? 1 : 0;
    a = String(a); b = String(b);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function likeRe(p, ci) { return new RegExp("^" + String(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", ci ? "i" : ""); }
  function compile(src) {
    var toks = tokenize(String(src || "")), p = 0;
    if (!toks.length) throw new Error("Empty expression");
    function peek(v) { var t = toks[p]; return t && (t.t === "op" || t.t === "kw") && t.v === v; }
    function eat(v) { if (!peek(v)) throw new Error("Expected " + v); p++; }
    function orE() { var a = andE(); while (peek("OR")) { p++; var b = andE(); a = (function (x, y) { return function (r) { return !!x(r) || !!y(r); }; })(a, b); } return a; }
    function andE() { var a = notE(); while (peek("AND")) { p++; var b = notE(); a = (function (x, y) { return function (r) { return !!x(r) && !!y(r); }; })(a, b); } return a; }
    function notE() { if (peek("NOT")) { p++; var a = notE(); return function (r) { return !a(r); }; } return cmpE(); }
    function cmpE() {
      var a = addE(), t = toks[p];
      if (!t) return a;
      if (t.t === "kw" && t.v === "IS") {
        p++; var neg = peek("NOT"); if (neg) p++; eat("NULL");
        return function (r) { var v = a(r), isNull = v === null || v === undefined || v === ""; return neg ? !isNull : isNull; };
      }
      var not = false;
      if (peek("NOT") && toks[p + 1] && toks[p + 1].t === "kw" && /^(IN|LIKE|ILIKE)$/.test(toks[p + 1].v)) { not = true; p++; t = toks[p]; }
      if (t.t === "kw" && t.v === "IN") {
        p++; eat("("); var list = [addE()];
        while (peek(",")) { p++; list.push(addE()); }
        eat(")");
        return function (r) { var v = a(r), hit = list.some(function (f) { return cmpVals(v, f(r)) === 0; }); return not ? !hit : hit; };
      }
      if (t.t === "kw" && (t.v === "LIKE" || t.v === "ILIKE")) {
        p++; var pat = addE(), ci = t.v === "ILIKE";
        return function (r) { var v = a(r), hit = v != null && likeRe(pat(r), ci).test(String(v)); return not ? !hit : hit; };
      }
      if (t.t === "op" && /^(=|==|!=|<>|<|<=|>|>=)$/.test(t.v)) {
        p++; var b = addE(), op = t.v;
        return function (r) {
          var x = a(r), y = b(r);
          if (x === null || x === undefined || y === null || y === undefined) return false;
          var c = cmpVals(x, y);
          return op === "=" || op === "==" ? c === 0 : op === "!=" || op === "<>" ? c !== 0 : op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : c >= 0;
        };
      }
      return a;
    }
    function addE() {
      var a = mulE();
      while (peek("+") || peek("-") || peek("||")) {
        var op = toks[p++].v, b = mulE();
        a = (function (x, y, o) {
          return function (r) { var u = x(r), w = y(r); return o === "||" ? String(u == null ? "" : u) + String(w == null ? "" : w) : o === "+" ? num(u) + num(w) : num(u) - num(w); };
        })(a, b, op);
      }
      return a;
    }
    function mulE() {
      var a = unary();
      while (peek("*") || peek("/") || peek("%")) {
        var op = toks[p++].v, b = unary();
        a = (function (x, y, o) { return function (r) { var u = num(x(r)), w = num(y(r)); return o === "*" ? u * w : o === "/" ? u / w : u % w; }; })(a, b, op);
      }
      return a;
    }
    function unary() { if (peek("-")) { p++; var a = unary(); return function (r) { return -num(a(r)); }; } return prim(); }
    function prim() {
      var t = toks[p++];
      if (!t) throw new Error("Unexpected end");
      if (t.t === "num" || t.t === "str") return function () { return t.v; };
      if (t.t === "field") return function (r) { return r[t.v]; };
      if (t.t === "var") {
        if (!/^\$(area|length|perimeter|x|y|id)$/.test(t.v)) throw new Error("Unknown variable " + t.v);
        return function (r) { return geomVar(t.v, r); };
      }
      if (t.t === "kw" && t.v === "NULL") return function () { return null; };
      if (t.t === "kw" && (t.v === "TRUE" || t.v === "FALSE")) return function () { return t.v === "TRUE"; };
      if (t.t === "op" && t.v === "(") { var e = orE(); eat(")"); return e; }
      throw new Error("Unexpected " + t.v);
    }
    var fn = orE();
    if (p < toks.length) throw new Error("Unexpected " + toks[p].v);
    return fn;
  }
  // properties object -> [feature, index], rebuilt when a lookup misses.
  var featOf = new WeakMap();
  function lookup(props) {
    var hit = featOf.get(props);
    if (hit) return hit;
    GIS.layers.forEach(function (l) { if (l.kind === "vector") l.data.features.forEach(function (f, i) { if (f.properties) featOf.set(f.properties, [f, i]); }); });
    return featOf.get(props);
  }
  var RAD = Math.PI / 180, R = 6371008.8; // mean (≈ authalic) radius, close to ellipsoidal areas
  function ringArea(c) {
    // Spherical excess (as in Turf / d3): signed area of a lon/lat ring.
    var s = 0, n = c.length;
    if (n < 3) return 0;
    for (var i = 0; i < n; i++) {
      var a = c[i], b = c[(i + 1) % n], d = c[(i + 2) % n];
      s += (d[0] - a[0]) * RAD * Math.sin(b[1] * RAD);
    }
    return Math.abs(s * R * R / 2);
  }
  function polyArea(p) { return p.reduce(function (s, r, k) { return s + (k ? -ringArea(r) : ringArea(r)); }, 0); }
  function lineLen(c) {
    var s = 0;
    for (var i = 1; i < c.length; i++) {
      var a = c[i - 1], b = c[i], dl = (b[1] - a[1]) * RAD, dn = (b[0] - a[0]) * RAD;
      var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dn / 2) * Math.sin(dn / 2);
      s += 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    return s;
  }
  function geomVar(v, props) {
    var fi = props && lookup(props), f = fi && fi[0], g = f && f.geometry;
    if (v === "$id") return fi ? fi[1] + 1 : null;
    if (!g) return null;
    var polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    var lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    if (v === "$area") return polys.reduce(function (s, p) { return s + polyArea(p); }, 0);
    if (v === "$perimeter") return polys.reduce(function (s, p) { return s + p.reduce(function (t, r) { return t + lineLen(r); }, 0); }, 0);
    if (v === "$length") return lines.length ? lines.reduce(function (s, l) { return s + lineLen(l); }, 0) : polys.reduce(function (s, p) { return s + lineLen(p[0]); }, 0);
    if (v === "$x" || v === "$y") {
      var c = g.type === "Point" ? g.coordinates : null;
      if (!c) { var b = GIS.featureBounds([f]); c = b ? [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2] : null; }
      return c ? c[v === "$x" ? 0 : 1] : null;
    }
    return null;
  }
  GIS.expr = { compile: compile, geomVar: geomVar };

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
