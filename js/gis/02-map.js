/* ==========================================================================
   GIS — the map frame (MapLibre GL).

   The map workspace uses the page's chart block as its map frame. Inside it:
   a MapLibre GL map (basemap + every layer in PlootsGIS) and an <svg>
   overlay for what belongs to the frame itself — the coordinate grid
   (graticule) with frame labels, the frame border and basemap attribution.
   Legend, scale bar, north arrow and inset map are separate page items
   (see 03-items.js) that follow the map through PlootsGIS.onView().

   The map is kept between renders (render() restyles it) and removed when
   another chart type takes the chart block (gd._plootsCleanup, called by
   PD.mount and 99-integration.js).

   Resolution: the map canvas is rendered at devicePixelRatio × the canvas
   zoom, so what the browser shows is exactly what WebGL drew. Letting the
   browser shrink a full-size bitmap made thin outlines land on pixels
   unevenly (some 1 px, some 2 px, some faded).

   Interaction: the Fabric page canvas sits above the map, so the map only
   takes the mouse in "move content" mode (double-click the map, or the Map
   panel). A tool pill offers Pan / Select / Identify; Esc or Done leaves the
   mode and stores the view in state.mapView. state.mapLock blocks it.

   Export: gd._plootsExport(scale) re-renders at the export pixel ratio,
   captures the canvas (preserveDrawingBuffer) and returns an <svg> with the
   image plus the overlay.
   ========================================================================== */
(function () {
  "use strict";

  var PD = window.PlootsD3, GIS = window.PlootsGIS;
  if (!PD || !GIS) return;
  var TYPE = GIS.TYPE;

  var GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
  var FONT = ["Noto Sans Regular"];
  var OSM = "© OpenStreetMap contributors";
  var BASEMAPS = [
    { id: "positron", label: "OpenFreeMap Positron", style: "https://tiles.openfreemap.org/styles/positron", attr: "© OpenFreeMap © OpenMapTiles " + OSM },
    { id: "bright", label: "OpenFreeMap Bright", style: "https://tiles.openfreemap.org/styles/bright", attr: "© OpenFreeMap © OpenMapTiles " + OSM },
    { id: "liberty", label: "OpenFreeMap Liberty", style: "https://tiles.openfreemap.org/styles/liberty", attr: "© OpenFreeMap © OpenMapTiles " + OSM },
    { id: "dark", label: "OpenFreeMap Dark", style: "https://tiles.openfreemap.org/styles/dark", attr: "© OpenFreeMap © OpenMapTiles " + OSM },
    { id: "fiord", label: "OpenFreeMap Fiord", style: "https://tiles.openfreemap.org/styles/fiord", attr: "© OpenFreeMap © OpenMapTiles " + OSM },
    { id: "demotiles", label: "MapLibre Demo Tiles", style: "https://demotiles.maplibre.org/style.json", attr: "MapLibre" },
    { id: "osm", label: "OpenStreetMap", tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attr: OSM, maxzoom: 19 },
    { id: "carto-light", label: "CARTO Light", tiles: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", attr: "© CARTO " + OSM },
    { id: "carto-dark", label: "CARTO Dark", tiles: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", attr: "© CARTO " + OSM },
    { id: "esri-imagery", label: "Esri World Imagery", tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attr: "Esri, Maxar, Earthstar Geographics" },
    { id: "esri-topo", label: "Esri World Topo", tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", attr: "Esri" },
    { id: "opentopomap", label: "OpenTopoMap", tiles: "https://tile.opentopomap.org/{z}/{x}/{y}.png", attr: "© OpenTopoMap (CC-BY-SA) " + OSM, maxzoom: 17 },
    { id: "none", label: "None" }
  ];
  GIS.BASEMAPS = BASEMAPS;

  PD.dataFree = PD.dataFree || {};
  PD.dataFree[TYPE] = true;

  function basemapDef(id) { return BASEMAPS.filter(function (b) { return b.id === id; })[0] || BASEMAPS[0]; }

  function styleFor(id) {
    var b = basemapDef(id);
    if (b.style) return b.style;
    var bg = typeof chartBgColor === "function" ? chartBgColor() : "#ffffff";
    var style = { version: 8, glyphs: GLYPHS, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": bg === "rgba(0,0,0,0)" ? "#ffffff" : bg } }] };
    if (b.tiles) {
      style.sources.basemap = { type: "raster", tiles: [b.tiles], tileSize: 256, maxzoom: b.maxzoom || 19 };
      style.layers.push({ id: "basemap", type: "raster", source: "basemap" });
    }
    return style;
  }

  GIS.styleFor = styleFor;

  /* ------------------------------------------------------------- state */

  var M = null;
  var viewListeners = [];
  GIS.onView = function (fn) { viewListeners.push(fn); };
  function emitView(final) { viewListeners.forEach(function (fn) { try { fn(final); } catch (e) { console.error(e); } }); }

  GIS.map = function () { return M && M.map; };
  GIS.mapReady = function () { return !!(M && M.loaded); };

  function create(gd) {
    var s = state;
    gd.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.className = "gj-map-wrap";
    wrap.style.cssText = "position:relative;overflow:hidden;";
    var mapDiv = document.createElement("div");
    mapDiv.style.cssText = "position:absolute;inset:0;";
    var overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    overlay.setAttribute("class", "ploots-map-overlay");
    overlay.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
    var tools = document.createElement("div");
    tools.className = "gis-map-tools";
    tools.style.display = "none";
    tools.innerHTML =
      '<button data-tool="pan" title="Pan"><span class="material-symbols-outlined">pan_tool</span></button>' +
      '<button data-tool="select" title="Select features"><span class="material-symbols-outlined">arrow_selector_tool</span></button>' +
      '<button data-tool="identify" title="Identify"><span class="material-symbols-outlined">info</span></button>' +
      '<span class="gis-tools-sep"></span>' +
      '<button data-act="zoom-layer" title="Zoom to active layer"><span class="material-symbols-outlined">zoom_in_map</span></button>' +
      '<button data-act="zoom-sel" title="Zoom to selection"><span class="material-symbols-outlined">center_focus_strong</span></button>' +
      '<button data-act="clear-sel" title="Clear selection"><span class="material-symbols-outlined">deselect</span></button>' +
      '<span class="gis-tools-sep"></span>' +
      '<button data-act="done" class="gis-done">Done</button>';
    var box = document.createElement("div");
    box.className = "gis-select-box";
    box.style.display = "none";
    wrap.appendChild(mapDiv); wrap.appendChild(overlay); wrap.appendChild(box); wrap.appendChild(tools);
    gd.appendChild(wrap);

    var opts = {
      container: mapDiv, style: styleFor(s.mapBasemap), attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
      preserveDrawingBuffer: true, fadeDuration: 0, pixelRatio: window.devicePixelRatio || 1
    };
    if (s.mapView) { opts.center = s.mapView.center; opts.zoom = s.mapView.zoom; opts.bearing = s.mapView.bearing; opts.pitch = s.mapView.pitch; }
    var map = new maplibregl.Map(opts);
    M = { gd: gd, wrap: wrap, mapDiv: mapDiv, map: map, overlay: overlay, tools: tools, box: box, basemap: s.mapBasemap,
      keys: {}, interactive: false, tool: "pan", loaded: false, layerCount: 0 };
    map.boxZoom.disable();
    map.doubleClickZoom.disable();

    map.on("style.load", function () { M.keys = {}; applyLayers(); });
    map.on("load", function () {
      M.loaded = true;
      if (!state.mapView) fitAll();
      M.layerCount = GIS.layers.length;
      syncRatio(); drawOverlay(); emitView(true);
    });
    var raf = 0;
    map.on("move", function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; drawOverlay(); emitView(false); });
    });
    map.on("moveend", function () { emitView(true); });
    map.on("click", onMapClick);
    map.on("mousemove", onMapHover);

    tools.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.tool) setTool(b.dataset.tool);
      else if (b.dataset.act === "done") setInteractive(false);
      else if (b.dataset.act === "zoom-layer") zoomToLayer(GIS.active());
      else if (b.dataset.act === "zoom-sel") zoomToSelection();
      else if (b.dataset.act === "clear-sel") clearSelection();
    });
    // While moving content the wheel belongs to the map, not the page zoom.
    wrap.addEventListener("wheel", function (e) { if (M && M.interactive) e.stopPropagation(); }, { passive: true });
    wireBoxSelect();

    gd._plootsCleanup = cleanup;
    gd._plootsExport = exportSvg;
    return M;
  }

  function cleanup() {
    if (!M) return;
    setInteractive(false);
    try { M.map.remove(); } catch (e) { }
    if (M.gd) { M.gd._plootsCleanup = null; M.gd._plootsExport = null; }
    M = null;
  }

  // Render at devicePixelRatio × canvas zoom (see header).
  function syncRatio() {
    if (!M || M.exporting) return;
    var w = M.wrap.offsetWidth;
    if (!w) return;
    var k = M.wrap.getBoundingClientRect().width / w;
    var r = Math.max(0.5, Math.min(4, (window.devicePixelRatio || 1) * k));
    if (Math.abs(r - M.map.getPixelRatio()) > 0.02) M.map.setPixelRatio(r);
  }
  var stage = window.syncStageSize;
  if (typeof stage === "function") {
    window.syncStageSize = function () { var out = stage.apply(this, arguments); syncRatio(); return out; };
  }
  window.addEventListener("resize", function () { syncRatio(); });

  /* ------------------------------------------------------------ layers */


  function fitBounds(b, maxZoom) {
    if (!M || !b) return;
    var c = M.map.getContainer(), pad = Math.max(16, Math.min(c.clientWidth, c.clientHeight) * 0.08);
    if (b[0][0] === b[1][0] && b[0][1] === b[1][1]) M.map.jumpTo({ center: b[0], zoom: Math.min(maxZoom || 14, 14) });
    else M.map.fitBounds(b, { padding: pad, animate: false, maxZoom: maxZoom || 18, bearing: M.map.getBearing() });
    saveView();
  }
  function fitAll() { fitBounds(GIS.bounds()); }
  function zoomToLayer(layer) {
    if (!layer) return;
    if (layer.kind === "xyz") return;
    fitBounds(GIS.bounds([Object.assign({}, layer, { visible: true })]));
  }
  function zoomToSelection() {
    var l = GIS.active();
    if (!l || l.kind !== "vector" || !l.selection.size) return;
    fitBounds(GIS.featureBounds(l.data.features.filter(function (f, i) { return l.selection.has(i); })), 16);
  }
  function clearSelection() {
    GIS.layers.forEach(function (l) { if (l.selection) l.selection.clear(); });
    GIS.emit("selection");
  }

  function put(id, def, before) {
    var map = M.map;
    if (map.getLayer(id)) map.removeLayer(id);
    def.id = id;
    map.addLayer(def, before);
  }

  function setSource(id, def, key) {
    var map = M.map;
    if (M.keys[id] === key && map.getSource(id)) return;
    if (map.getLayer(id + "-probe")) map.removeLayer(id + "-probe");
    if (map.getSource(id)) {
      var src = map.getSource(id);
      if (def.type === "geojson" && src.setData) { src.setData(def.data); M.keys[id] = key; return; }
      if (def.type === "image" && src.updateImage) { src.updateImage({ url: def.url, coordinates: def.coordinates }); M.keys[id] = key; return; }
      // Tile URL changed: drop everything drawing from it first.
      map.getStyle().layers.filter(function (L) { return L.source === id; }).forEach(function (L) { map.removeLayer(L.id); });
      map.removeSource(id);
    }
    map.addSource(id, def);
    M.keys[id] = key;
  }

  var OURS = /^gis-/;

  function applyLayers() {
    if (!M) return;
    var map = M.map;
    if (!map.isStyleLoaded()) { map.once("idle", applyLayers); return; }

    // Drop layers/sources of removed layers.
    var ids = GIS.layers.map(function (l) { return "gis-" + l.id; });
    map.getStyle().layers.filter(function (L) { return OURS.test(L.id); }).forEach(function (L) { map.removeLayer(L.id); });
    Object.keys(map.getStyle().sources).filter(function (k) { return OURS.test(k) && !ids.some(function (id) { return k === id || k.indexOf(id + "-") === 0; }); })
      .forEach(function (k) { map.removeSource(k); delete M.keys[k]; });

    // Bottom of the list first, so the top layer is drawn last.
    GIS.layers.slice().reverse().forEach(function (l) {
      var id = "gis-" + l.id, vis = l.visible ? "visible" : "none";
      if (l.kind === "xyz") {
        setSource(id, { type: "raster", tiles: [l.url], tileSize: 256 }, l.url);
        put(id + "-r", { type: "raster", source: id, layout: { visibility: vis }, paint: { "raster-opacity": l.opacity } });
        return;
      }
      if (l.kind === "raster") {
        setSource(id, { type: "image", url: l.raster.url, coordinates: l.raster.coordinates }, l.raster.url.length + "|" + l.raster.rev);
        put(id + "-r", { type: "raster", source: id, layout: { visibility: vis }, paint: { "raster-opacity": l.opacity, "raster-fade-duration": 0, "raster-resampling": l.raster.resampling || "linear" } });
        return;
      }
      GIS.ensureStyle(l);
      var s = l.style, ren = s.renderer || "simple";
      var tbl = s.field === GIS.TABLE_FIELD ? JSON.stringify(GIS.table()) : "";
      var dkey = [l.rev || 0, s.symbology, s.field, s.joinField, tbl, s.labelTemplate, s.labelField, s.labelPlacement].join("|");
      if (M.keys[id] !== dkey) setSource(id, { type: "geojson", data: GIS.sym.styledData(l) }, dkey);
      var lkey = [l.rev || 0, s.labelField, s.labelTemplate, s.labelPlacement].join("|");
      if (M.keys[id + "-lbl"] !== lkey) setSource(id + "-lbl", { type: "geojson", data: GIS.sym.labelData(l) }, lkey);
      if (ren !== "simple") {
        var pkey = [l.rev || 0, ren, s.symbology, s.field, s.joinField, tbl, s.sizeField, s.sizeMin, s.sizeMax, s.sizeScale, s.heatField, s.pointRadius].join("|");
        if (M.keys[id + "-pts"] !== pkey) setSource(id + "-pts", { type: "geojson", data: GIS.sym.pointData(l) }, pkey);
      }

      var color = GIS.sym.colorExpression(l), op = l.opacity;
      var polys = ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false];
      var lines = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false];
      var points = ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false];
      var sel = ["in", ["get", "__i"], ["literal", Array.from(l.selection)]];
      // Heatmap replaces the features; proportional circles replace points
      // and sit on top of polygons/lines (which stay as the base).
      var feat = ren === "heatmap" ? "none" : vis, pointVis = ren === "simple" ? vis : "none";
      // Under proportional circles the polygons become a neutral base.
      var baseFill = ren === "proportional" ? "#e8e6de" : color;
      put(id + "-fill", { type: "fill", source: id, filter: polys, layout: { visibility: feat }, paint: { "fill-color": baseFill, "fill-opacity": (ren === "proportional" ? 0.9 : s.fillOpacity) * op } });
      put(id + "-outline", { type: "line", source: id, filter: polys, layout: { visibility: feat, "line-join": "round" }, paint: { "line-color": s.strokeColor, "line-width": s.strokeWidth, "line-opacity": s.strokeWidth > 0 ? op : 0 } });
      put(id + "-line", { type: "line", source: id, filter: lines, layout: { visibility: feat, "line-cap": "round", "line-join": "round" }, paint: { "line-color": color, "line-width": s.lineWidth, "line-opacity": op } });
      put(id + "-point", { type: "circle", source: id, filter: points, layout: { visibility: pointVis }, paint: {
        "circle-color": color, "circle-radius": s.pointRadius, "circle-opacity": Math.max(0.05, s.fillOpacity) * op,
        "circle-stroke-color": s.strokeColor, "circle-stroke-width": s.strokeWidth, "circle-stroke-opacity": op } });
      if (ren === "proportional") {
        put(id + "-prop", { type: "circle", source: id + "-pts", layout: { visibility: vis, "circle-sort-key": ["-", ["get", "__r"]] }, paint: {
          "circle-color": color, "circle-radius": ["get", "__r"], "circle-opacity": Math.max(0.05, s.fillOpacity) * op,
          "circle-stroke-color": /^#?f{3,6}$/i.test(s.strokeColor) ? "#3a3a36" : s.strokeColor, "circle-stroke-width": Math.max(0.6, s.strokeWidth), "circle-stroke-opacity": op } });
        put(id + "-sel-prop", { type: "circle", source: id + "-pts", filter: sel, layout: { visibility: vis }, paint: {
          "circle-color": "rgba(0,0,0,0)", "circle-radius": ["get", "__r"], "circle-stroke-color": "#ffcc00", "circle-stroke-width": 2.5 } });
      }
      if (ren === "heatmap") {
        var hc = GIS.sym.rampColors(s.heatRamp, false), stops = ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)"];
        hc.forEach(function (c, i) { var col = d3.rgb(c); stops.push(0.08 + 0.92 * i / (hc.length - 1 || 1), "rgba(" + col.r + "," + col.g + "," + col.b + "," + (i === 0 ? 0.35 : 1) + ")"); });
        put(id + "-heat", { type: "heatmap", source: id + "-pts", layout: { visibility: vis }, paint: {
          "heatmap-weight": ["get", "__w"], "heatmap-radius": s.heatRadius, "heatmap-intensity": s.heatIntensity,
          "heatmap-color": stops, "heatmap-opacity": s.heatOpacity * op } });
      }
      // Selection highlight (QGIS yellow).
      put(id + "-sel-fill", { type: "fill", source: id, filter: ["all", polys, sel], layout: { visibility: feat }, paint: { "fill-color": "#ffea00", "fill-opacity": 0.55 } });
      put(id + "-sel-line", { type: "line", source: id, filter: ["all", ["!", points], sel], layout: { visibility: feat, "line-join": "round" }, paint: { "line-color": "#ffcc00", "line-width": Math.max(2, s.lineWidth + 1) } });
      put(id + "-sel-point", { type: "circle", source: id, filter: ["all", points, sel], layout: { visibility: pointVis }, paint: { "circle-color": "#ffea00", "circle-radius": s.pointRadius + 1, "circle-stroke-color": "#1a1a1a", "circle-stroke-width": 1 } });
      // Labels: points/polygons from label anchors; lines along the line.
      var font = [s.labelFont === "bold" ? "Noto Sans Bold" : s.labelFont === "italic" ? "Noto Sans Italic" : "Noto Sans Regular"];
      var lblVis = GIS.sym.hasLabels(l) ? vis : "none", ov = !!s.labelOverlap;
      var lpaint = { "text-color": s.labelColor, "text-halo-color": s.labelHaloColor, "text-halo-width": s.labelHaloWidth, "text-halo-blur": 0.2 };
      put(id + "-label", { type: "symbol", source: id + "-lbl", layout: {
        visibility: lblVis, "text-field": ["get", "t"], "text-font": font, "text-size": s.labelSize, "text-max-width": 8, "text-padding": 2,
        "text-allow-overlap": ov, "text-ignore-placement": ov }, paint: lpaint });
      put(id + "-label-line", { type: "symbol", source: id, filter: lines, layout: {
        visibility: s.labelPlacement !== "point" ? lblVis : "none", "symbol-placement": "line", "text-field": ["coalesce", ["get", "__label"], ""],
        "text-font": font, "text-size": s.labelSize, "text-offset": [0, -0.6], "symbol-spacing": 250, "text-max-angle": 40,
        "text-allow-overlap": ov, "text-ignore-placement": ov, "text-keep-upright": true }, paint: lpaint });
    });
    drawOverlay();
  }

  function queryLayers(layer) {
    var id = "gis-" + layer.id;
    return ["-fill", "-line", "-point", "-prop"].map(function (x) { return id + x; }).filter(function (x) { var L = M.map.getLayer(x); return L && M.map.getLayoutProperty(x, "visibility") !== "none"; });
  }

  /* ----------------------------------------------------- projections */

  // WGS 84 / UTM, forward and inverse (Snyder's series; sub-metre within a
  // zone). Shared with 04-raster.js through GIS.proj.
  var UTM_A = 6378137, UTM_F = 1 / 298.257223563, UTM_K0 = 0.9996;
  var UTM_E2 = UTM_F * (2 - UTM_F), UTM_EP2 = UTM_E2 / (1 - UTM_E2);
  function ll2utm(lon, lat, zone) {
    var phi = lat * Math.PI / 180, lam0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180, lam = lon * Math.PI / 180;
    var n = UTM_A / Math.sqrt(1 - UTM_E2 * Math.sin(phi) * Math.sin(phi)), t = Math.tan(phi) * Math.tan(phi);
    var c = UTM_EP2 * Math.cos(phi) * Math.cos(phi), a = Math.cos(phi) * (lam - lam0), e2 = UTM_E2;
    var m = UTM_A * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi)
      + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi) - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi));
    var x = UTM_K0 * n * (a + (1 - t + c) * Math.pow(a, 3) / 6 + (5 - 18 * t + t * t + 72 * c - 58 * UTM_EP2) * Math.pow(a, 5) / 120) + 500000;
    var y = UTM_K0 * (m + n * Math.tan(phi) * (a * a / 2 + (5 - t + 9 * c + 4 * c * c) * Math.pow(a, 4) / 24 + (61 - 58 * t + t * t + 600 * c - 330 * UTM_EP2) * Math.pow(a, 6) / 720));
    return [x, y]; // raw northing: negative south of the equator
  }
  function utm2ll(x, y, zone, south) {
    var e2 = UTM_E2, ep2 = UTM_EP2;
    x -= 500000; if (south) y -= 10000000;
    var m = y / UTM_K0, mu = m / (UTM_A * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
    var e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    var p1 = mu + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu)
      + (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu) + (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);
    var n1 = UTM_A / Math.sqrt(1 - e2 * Math.sin(p1) * Math.sin(p1)), t1 = Math.tan(p1) * Math.tan(p1), c1 = ep2 * Math.cos(p1) * Math.cos(p1);
    var r1 = UTM_A * (1 - e2) / Math.pow(1 - e2 * Math.sin(p1) * Math.sin(p1), 1.5), d = x / (n1 * UTM_K0);
    var lat = p1 - (n1 * Math.tan(p1) / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * Math.pow(d, 4) / 24
      + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * Math.pow(d, 6) / 720);
    var lon = (d - (1 + 2 * t1 + c1) * Math.pow(d, 3) / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * Math.pow(d, 5) / 120) / Math.cos(p1);
    return [(zone - 1) * 6 - 180 + 3 + lon * 180 / Math.PI, lat * 180 / Math.PI];
  }
  function utmZoneOf(lon) { return Math.max(1, Math.min(60, Math.floor((lon + 180) / 6) + 1)); }
  GIS.proj = { ll2utm: ll2utm, utm2ll: utm2ll, utmZoneOf: utmZoneOf };

  /* ----------------------------------------------------------- overlay */

  // With grid labels outside the frame, the map shrinks inside the chart
  // block and the labels sit in the margin, like a QGIS map item.
  function frameInset() {
    var s = state, z = { l: 0, t: 0, r: 0, b: 0 };
    if (!s.mapGrid || s.mapGridLabelPos !== "outside" || s.mapGridLabels === "none") return z;
    var m = Math.round((s.mapGridFontSize || 9) + 10);
    z.l = z.b = m;
    if (s.mapGridLabels === "all") z.t = z.r = m;
    return z;
  }
  GIS.frameInset = frameInset;

  var GRID_STEPS = [30, 20, 15, 10, 5, 2, 1, 0.5, 0.25, 1 / 6, 0.1, 1 / 12, 0.05, 1 / 60, 0.01, 0.005, 1 / 360, 0.001];
  var UTM_STEPS = [500000, 200000, 100000, 50000, 25000, 20000, 10000, 5000, 2500, 2000, 1000, 500, 250, 200, 100, 50, 25, 10];

  function coordLabel(v, axis) {
    var hemi = axis === "x" ? (v < 0 ? "W" : v > 0 ? "E" : "") : (v < 0 ? "S" : v > 0 ? "N" : "");
    var a = Math.abs(v);
    if (state.mapGridFormat === "decimal") return (Math.round(a * 10000) / 10000) + "°" + hemi;
    var d = Math.floor(a + 1e-9), mf = (a - d) * 60, m = Math.floor(mf + 1e-9), sec = Math.round((mf - m) * 60);
    if (sec === 60) { sec = 0; m++; }
    if (m === 60) { m = 0; d++; }
    return d + "°" + (m || sec ? String(m).padStart(2, "0") + "′" : "") + (sec ? String(sec).padStart(2, "0") + "″" : "") + hemi;
  }
  function utmLabel(v, axis) {
    var km = state.mapGridUnits === "km";
    var n = km ? v / 1000 : v, txt = (Math.round(n * 1000) / 1000).toLocaleString("en-US").replace(/,/g, " ");
    return txt + (km ? " km" : " m") + (axis === "x" ? "E" : "N");
  }

  // Grid lines as sampled polylines in pixel space, each with its label.
  function gridLines(inner) {
    var s = state, map = M.map;
    var px = function (ll) { var p = map.project(ll); return [p.x + inner.x, p.y + inner.y]; };
    var lines = [];
    if (s.mapGridType === "utm") {
      var c = map.getCenter(), zone = s.mapGridUtmZone > 0 ? s.mapGridUtmZone : utmZoneOf(c.lng), south = c.lat < 0;
      var cw = inner.w, ch = inner.h, es = [], ns = [], cm = (zone - 1) * 6 - 180 + 3, far = 0;
      [[0, 0], [cw, 0], [cw, ch], [0, ch], [cw / 2, 0], [cw, ch / 2], [cw / 2, ch], [0, ch / 2]].forEach(function (q) {
        var ll = map.unproject(q), u = ll2utm(ll.lng, ll.lat, zone);
        far = Math.max(far, Math.abs(ll.lng - cm));
        if (south) u[1] += 10000000; // southern-hemisphere false northing
        es.push(u[0]); ns.push(u[1]);
      });
      // Transverse Mercator falls apart far from the zone's meridian: past
      // about 12 degrees the grid falls back to geographic (noted in the panel).
      GIS.gridNote = far > 12 ? "The view is too wide for a UTM grid; showing a geographic grid." : "";
      if (GIS.gridNote) return geographicLines(inner, px);
      var e0 = d3.min(es), e1 = d3.max(es), n0 = d3.min(ns), n1 = d3.max(ns);
      var step = s.mapGridInterval > 0 ? s.mapGridInterval : UTM_STEPS.filter(function (g) { return (e1 - e0) / g >= 3; })[0] || 10;
      var pe = (e1 - e0) * 0.2, pn = (n1 - n0) * 0.2;
      var toLL = function (e, n) { return utm2ll(e, n, zone, south); };
      for (var e = Math.ceil(e0 / step) * step; e <= e1 + 1e-6 && lines.length < 400; e += step) {
        lines.push({ axis: "x", label: utmLabel(e, "x"), pts: d3.range(0, 41).map(function (i) { return px(toLL(e, n0 - pn + (n1 - n0 + 2 * pn) * i / 40)); }), v: e });
      }
      for (var n = Math.ceil(n0 / step) * step; n <= n1 + 1e-6 && lines.length < 800; n += step) {
        lines.push({ axis: "y", label: utmLabel(n, "y"), pts: d3.range(0, 41).map(function (i) { return px(toLL(e0 - pe + (e1 - e0 + 2 * pe) * i / 40, n)); }), v: n });
      }
      lines.zone = zone + (south ? "S" : "N");
      return lines;
    }
    GIS.gridNote = "";
    return geographicLines(inner, px);
  }

  function geographicLines(inner, px) {
    var s = state, map = M.map, lines = [];
    var b = map.getBounds(), west = b.getWest(), east = b.getEast(), so = Math.max(-85, b.getSouth()), no = Math.min(85, b.getNorth());
    var st = s.mapGridInterval > 0 ? s.mapGridInterval : GRID_STEPS.filter(function (g) { return (east - west) / g >= 3; })[0] || 0.001;
    var ew = (east - west) * 0.15, nsp = (no - so) * 0.15;
    var w2 = west - ew, e2 = east + ew, s2 = Math.max(-89, so - nsp), n2 = Math.min(89, no + nsp);
    for (var x = Math.ceil(west / st) * st; x <= east + 1e-9 && lines.length < 400; x += st) {
      var lo = +x.toFixed(9);
      lines.push({ axis: "x", label: coordLabel(lo, "x"), pts: d3.range(0, 61).map(function (i) { return px([lo, s2 + (n2 - s2) * i / 60]); }) });
    }
    for (var y = Math.ceil(so / st) * st; y <= no + 1e-9 && lines.length < 800; y += st) {
      var la = +y.toFixed(9);
      lines.push({ axis: "y", label: coordLabel(la, "y"), pts: d3.range(0, 61).map(function (i) { return px([w2 + (e2 - w2) * i / 60, la]); }) });
    }
    return lines;
  }

  function drawGrid(svg, W, H, inner) {
    var s = state, ink = s.mapGridColor, fs = s.mapGridFontSize || 9, font = s.fontBody;
    var lines = gridLines(inner);
    var x0 = inner.x, y0 = inner.y, x1 = inner.x + inner.w, y1 = inner.y + inner.h, outside = s.mapGridLabelPos === "outside";
    var clipId = "gisGridClip";
    svg.append("defs").append("clipPath").attr("id", clipId).append("rect").attr("x", x0).attr("y", y0).attr("width", inner.w).attr("height", inner.h);
    var g = svg.append("g").attr("class", "gis-grid");
    var lg = g.append("g").attr("clip-path", "url(#" + clipId + ")");
    var line = d3.line();
    if (s.mapGridStyle === "crosses") {
      // Crosses at the intersections of the x and y lines.
      var xs = lines.filter(function (l) { return l.axis === "x"; }), ys = lines.filter(function (l) { return l.axis === "y"; }), c = Math.max(4, fs * 0.6);
      xs.forEach(function (lx) { ys.forEach(function (ly) {
        var p = intersect(lx.pts, ly.pts);
        if (p) lg.append("path").attr("d", "M" + (p[0] - c) + "," + p[1] + "H" + (p[0] + c) + "M" + p[0] + "," + (p[1] - c) + "V" + (p[1] + c)).attr("stroke", ink).attr("stroke-width", s.mapGridWidth).attr("fill", "none");
      }); });
    } else {
      lines.forEach(function (l) { lg.append("path").attr("d", line(l.pts)).attr("stroke", ink).attr("stroke-width", s.mapGridWidth).attr("fill", "none"); });
    }
    if (s.mapGridLabels === "none") return lines;
    var sides = s.mapGridLabels === "all" ? ["left", "right", "top", "bottom"] : ["left", "bottom"];
    var edges = [["left", x0, 0], ["right", x1, 0], ["top", y0, 1], ["bottom", y1, 1]];
    function crossings(pts) {
      var out = [];
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], c2 = pts[i];
        edges.forEach(function (e) {
          var k = e[2], v = e[1];
          if ((a[k] - v) * (c2[k] - v) > 0 || a[k] === c2[k]) return;
          var t = (v - a[k]) / (c2[k] - a[k]), q = [a[0] + (c2[0] - a[0]) * t, a[1] + (c2[1] - a[1]) * t], o = 1 - k;
          if (q[o] < (o ? y0 : x0) - 0.5 || q[o] > (o ? y1 : x1) + 0.5) return;
          out.push({ side: e[0], p: q });
        });
      }
      return out;
    }
    function label(txt, side, p) {
      var t = g.append("text").attr("font-size", fs).attr("font-family", font).attr("fill", "#1a1a1a").text(txt);
      if (!outside) t.attr("stroke", "rgba(255,255,255,0.9)").attr("stroke-width", 2.5).attr("paint-order", "stroke");
      var gap = outside ? 6 : 3, tick = 4;
      if (outside) {
        var tk = side === "left" ? [x0, p[1], x0 - tick, p[1]] : side === "right" ? [x1, p[1], x1 + tick, p[1]] : side === "top" ? [p[0], y0, p[0], y0 - tick] : [p[0], y1, p[0], y1 + tick];
        g.append("line").attr("x1", tk[0]).attr("y1", tk[1]).attr("x2", tk[2]).attr("y2", tk[3]).attr("stroke", "#1a1a1a").attr("stroke-width", 0.8);
      }
      // Left/right labels run along the edge (rotated), like QGIS.
      if (side === "left" || side === "right") {
        var x = side === "left" ? (outside ? x0 - gap - fs / 2 : x0 + gap + fs / 2) : (outside ? x1 + gap + fs / 2 : x1 - gap - fs / 2);
        t.attr("x", 0).attr("y", 0).attr("dy", "0.35em").attr("text-anchor", "middle").attr("transform", "translate(" + x + "," + p[1] + ") rotate(-90)");
      } else if (side === "top") t.attr("x", p[0]).attr("y", outside ? y0 - gap : y0 + gap + fs).attr("text-anchor", "middle");
      else t.attr("x", p[0]).attr("y", outside ? y1 + gap + fs * 0.85 : y1 - gap - 2).attr("text-anchor", "middle");
    }
    lines.forEach(function (l) {
      crossings(l.pts).forEach(function (c3) {
        // x lines label the top/bottom edges, y lines the left/right edges.
        var ok = l.axis === "x" ? (c3.side === "top" || c3.side === "bottom") : (c3.side === "left" || c3.side === "right");
        if (ok && sides.indexOf(c3.side) >= 0) label(l.label, c3.side, c3.p);
      });
    });
    return lines;
  }

  function intersect(a, b) {
    for (var i = 1; i < a.length; i++) for (var j = 1; j < b.length; j++) {
      var p = a[i - 1], r = [a[i][0] - p[0], a[i][1] - p[1]], q = b[j - 1], sv = [b[j][0] - q[0], b[j][1] - q[1]];
      var den = r[0] * sv[1] - r[1] * sv[0];
      if (!den) continue;
      var t = ((q[0] - p[0]) * sv[1] - (q[1] - p[1]) * sv[0]) / den, u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [p[0] + t * r[0], p[1] + t * r[1]];
    }
    return null;
  }

  function attribution() {
    var parts = [];
    var b = basemapDef(state.mapBasemap);
    if (b.attr) parts.push(b.attr);
    GIS.layers.forEach(function (l) { if (l.kind === "xyz" && l.visible && l.attribution) parts.push(l.attribution); });
    return parts.join(" · ");
  }

  function innerRect(W, H) {
    var z = frameInset();
    return { x: z.l, y: z.t, w: Math.max(10, W - z.l - z.r), h: Math.max(10, H - z.t - z.b) };
  }

  function drawOverlay() {
    if (!M) return;
    var s = state, W = s.chartBox.w, H = s.chartBox.h, inner = innerRect(W, H);
    var svg = d3.select(M.overlay).attr("width", W).attr("height", H).attr("viewBox", "0 0 " + W + " " + H);
    svg.selectAll("*").remove();
    if (!GIS.layers.length) {
      svg.append("text").attr("x", inner.x + inner.w / 2).attr("y", inner.y + inner.h / 2).attr("text-anchor", "middle").attr("font-size", 13).attr("fill", "#8a8a8a")
        .attr("font-family", s.fontBody).text("Add a layer from the Map panel");
    }
    if (s.mapGrid && M.loaded) drawGrid(svg, W, H, inner);
    var attr = attribution();
    if (attr) {
      svg.append("text").attr("x", inner.x + inner.w - 4).attr("y", inner.y + inner.h - 4).attr("text-anchor", "end").attr("font-size", 7).attr("font-family", s.fontBody)
        .attr("fill", "#4a4a46").attr("stroke", "rgba(255,255,255,0.85)").attr("stroke-width", 2.2).attr("paint-order", "stroke").text(attr);
    }
    if (s.mapFrame && s.mapFrameWidth > 0) {
      var fw = s.mapFrameWidth;
      svg.append("rect").attr("x", inner.x + fw / 2).attr("y", inner.y + fw / 2).attr("width", Math.max(0, inner.w - fw)).attr("height", Math.max(0, inner.h - fw))
        .attr("fill", "none").attr("stroke", s.mapFrameColor).attr("stroke-width", fw);
    }
  }

  /* ------------------------------------------------------ interaction */

  function setTool(t) {
    if (!M) return;
    M.tool = t;
    Array.prototype.forEach.call(M.tools.querySelectorAll("[data-tool]"), function (b) { b.classList.toggle("active", b.dataset.tool === t); });
    if (t === "select") M.map.dragPan.disable(); else M.map.dragPan.enable();
    M.map.getCanvas().style.cursor = t === "pan" ? "" : t === "select" ? "crosshair" : "help";
  }

  function onMapHover(e) {
    if (!M || !M.interactive || M.tool === "pan") return;
    var l = GIS.active();
    if (!l || l.kind !== "vector") return;
    var hit = M.map.queryRenderedFeatures(e.point, { layers: queryLayers(l) });
    M.map.getCanvas().style.cursor = hit.length ? "pointer" : (M.tool === "select" ? "crosshair" : "help");
  }

  function onMapClick(e) {
    if (!M || !M.interactive || M.boxDragged) return;
    var l = GIS.active();
    if (!l || l.kind !== "vector") return;
    var hit = M.map.queryRenderedFeatures(e.point, { layers: queryLayers(l) });
    if (M.tool === "select") {
      var add = e.originalEvent.shiftKey || e.originalEvent.ctrlKey || e.originalEvent.metaKey;
      if (!add) l.selection.clear();
      hit.forEach(function (h) {
        var i = h.properties.__i;
        if (add && l.selection.has(i)) l.selection.delete(i); else l.selection.add(i);
      });
      GIS.emit("selection");
      return;
    }
    if (M.tool !== "identify" || !hit.length) return;
    var f = l.data.features[hit[0].properties.__i];
    if (!f) return;
    var rows = Object.keys(f.properties).slice(0, 40).map(function (k) {
      var v = f.properties[k];
      return "<tr><th>" + esc(k) + "</th><td>" + esc(typeof v === "object" ? JSON.stringify(v) : v) + "</td></tr>";
    }).join("");
    new maplibregl.Popup({ maxWidth: "300px" }).setLngLat(e.lngLat).setHTML('<div class="gj-popup-title">' + esc(l.name) + '</div><table class="gj-popup">' + rows + "</table>").addTo(M.map);
  }
  function esc(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // Rectangle select with the Select tool (drag on the map).
  function wireBoxSelect() {
    var start = null, canvas = M.map.getCanvasContainer();
    function pt(e) { var r = canvas.getBoundingClientRect(), k = r.width / canvas.offsetWidth; return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]; }
    canvas.addEventListener("mousedown", function (e) {
      if (!M || !M.interactive || M.tool !== "select" || e.button !== 0) return;
      start = pt(e); M.boxDragged = false;
    });
    window.addEventListener("mousemove", function (e) {
      if (!start || !M) return;
      var p = pt(e);
      if (!M.boxDragged && Math.abs(p[0] - start[0]) + Math.abs(p[1] - start[1]) < 5) return;
      M.boxDragged = true;
      var b = M.box.style;
      b.display = "block"; b.left = Math.min(p[0], start[0]) + "px"; b.top = Math.min(p[1], start[1]) + "px";
      b.width = Math.abs(p[0] - start[0]) + "px"; b.height = Math.abs(p[1] - start[1]) + "px";
    });
    window.addEventListener("mouseup", function (e) {
      if (!start || !M) return;
      var p = pt(e), s0 = start;
      start = null;
      M.box.style.display = "none";
      if (!M.boxDragged) return;
      var l = GIS.active();
      if (l && l.kind === "vector") {
        if (!(e.shiftKey || e.ctrlKey || e.metaKey)) l.selection.clear();
        M.map.queryRenderedFeatures([[Math.min(p[0], s0[0]), Math.min(p[1], s0[1])], [Math.max(p[0], s0[0]), Math.max(p[1], s0[1])]], { layers: queryLayers(l) })
          .forEach(function (h) { l.selection.add(h.properties.__i); });
        GIS.emit("selection");
      }
      setTimeout(function () { if (M) M.boxDragged = false; }, 0);
    });
  }

  function onKey(e) { if (e.key === "Escape" && M && M.interactive) setInteractive(false); }

  function saveView() {
    if (!M) return;
    var map = M.map, c = map.getCenter();
    state.mapView = { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  }

  function setInteractive(on) {
    if (!M) return;
    if (on && state.mapLock) return;
    if (M.interactive === !!on) return;
    M.interactive = !!on;
    var fc = window.fabricCanvas, wrapper = fc && (fc.wrapperEl || (fc.upperCanvasEl && fc.upperCanvasEl.parentNode));
    if (on && fc) { fc.discardActiveObject(); fc.requestRenderAll(); }
    if (wrapper) wrapper.style.pointerEvents = on ? "none" : "";
    var block = document.getElementById("chartBlock");
    if (block) block.classList.toggle("gj-interactive", !!on);
    M.tools.style.display = on ? "" : "none";
    if (on) { setTool(M.tool || "pan"); document.addEventListener("keydown", onKey); }
    else {
      document.removeEventListener("keydown", onKey);
      M.map.dragPan.enable();
      M.map.getCanvas().style.cursor = "";
      saveView();
      document.querySelectorAll(".maplibregl-popup").forEach(function (p) { p.remove(); });
      if (typeof historyNotifyChange === "function") historyNotifyChange();
    }
    GIS.emit("interactive", !!on);
  }

  /* ------------------------------------------------- scale & rotation */

  // Map scale 1:N on the printed page: page px are CSS px at 96 dpi.
  var PAGE_M_PER_PX = 0.0254 / 96;
  function metresPerPixel() {
    if (!M) return 0;
    var map = M.map, c = map.getContainer(), y = c.clientHeight / 2, x = c.clientWidth / 2;
    var a = map.unproject([x - 50, y]), b = map.unproject([x + 50, y]);
    return d3.geoDistance([a.lng, a.lat], [b.lng, b.lat]) * 6371008.8 / 100;
  }
  GIS.metresPerPixel = metresPerPixel;
  GIS.getScale = function () { var m = metresPerPixel(); return m ? m / PAGE_M_PER_PX : 0; };
  GIS.setScale = function (n) {
    if (!M || !(n > 0)) return;
    var cur = GIS.getScale();
    if (!cur) return;
    M.map.setZoom(M.map.getZoom() + Math.log2(cur / n));
    saveView(); emitView(true);
  };
  GIS.setRotation = function (deg) { if (!M) return; M.map.setBearing(-(+deg || 0)); saveView(); emitView(true); };
  GIS.getRotation = function () { return M ? -M.map.getBearing() : 0; };

  GIS.mapActions = {
    setInteractive: setInteractive, isInteractive: function () { return !!(M && M.interactive); },
    setTool: setTool, fitAll: fitAll, zoomToLayer: zoomToLayer, zoomToSelection: zoomToSelection, clearSelection: clearSelection,
    redraw: function () { if (M) { applyLayers(); } }
  };

  function hookFabric() {
    var fc = window.fabricCanvas;
    if (!fc || fc._gisHooked) return;
    fc._gisHooked = true;
    fc.on("mouse:dblclick", function (opt) {
      if (state.chartType === TYPE && opt.target && opt.target.isChartProxy) setInteractive(true);
    });
  }
  document.addEventListener("ploots:canvasready", hookFabric);
  hookFabric();

  // Any change in the store restyles the live map.
  GIS.on("*", function (arg, evt) {
    if (evt === "interactive" || evt === "active") return;
    if (state.chartType !== TYPE || !M) return;
    var grew = evt === "layers" && M.loaded && GIS.layers.length > (M.layerCount || 0);
    M.layerCount = GIS.layers.length;
    applyLayers();
    // A newly added layer is framed, unless the map is locked.
    if (grew && !state.mapLock) zoomToLayer(GIS.active());
  });

  /* ------------------------------------------------------------ export */

  function exportSvg(scale) {
    if (!M) return Promise.reject(new Error("Map not ready."));
    var map = M.map, W = state.chartBox.w, H = state.chartBox.h, ir = innerRect(W, H);
    var prev = map.getPixelRatio();
    var ratio = Math.max(1, Math.min(scale || 2, 8192 / Math.max(W, H)));
    M.exporting = true;
    return new Promise(function (resolve) {
      var finished = false;
      function capture() {
        if (finished) return;
        finished = true;
        var url;
        try { url = map.getCanvas().toDataURL("image/png"); } catch (e) { url = ""; }
        M.exporting = false;
        map.setPixelRatio(prev);
        drawOverlay();
        var inner = new XMLSerializer().serializeToString(M.overlay).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
        resolve('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '">' +
          (url ? '<image x="' + ir.x + '" y="' + ir.y + '" width="' + ir.w + '" height="' + ir.h + '" preserveAspectRatio="none" href="' + url + '" xlink:href="' + url + '"/>' : "") +
          inner + "</svg>");
      }
      map.setPixelRatio(ratio);
      map.once("idle", capture);
      map.triggerRepaint();
      setTimeout(capture, 10000);
    });
  }

  /* ------------------------------------------------------------ render */

  PD.renderers[TYPE] = function (gd) {
    var s = state;
    GIS.ensureState();
    if (typeof maplibregl === "undefined") {
      if (gd._plootsCleanup) gd._plootsCleanup();
      PD.placeholder(gd, "Loading MapLibre GL…");
      PlootsLazy.ensureMapLibre().then(function () { if (state.chartType === TYPE) PD.renderActive(); })
        .catch(function () { PD.placeholder(gd, "Could not load MapLibre GL. Check your internet connection."); });
      return;
    }
    if (!M || M.gd !== gd || !gd.contains(M.wrap)) {
      if (gd._plootsCleanup) gd._plootsCleanup();
      create(gd);
    }
    gd._plootsD3 = null;
    M.wrap.style.width = s.chartBox.w + "px";
    M.wrap.style.height = s.chartBox.h + "px";
    var z = frameInset();
    M.mapDiv.style.inset = z.t + "px " + z.r + "px " + z.b + "px " + z.l + "px";
    M.map.resize();
    syncRatio();
    if (M.basemap !== s.mapBasemap) { M.basemap = s.mapBasemap; M.map.setStyle(styleFor(s.mapBasemap), { diff: false }); return; }
    applyLayers();
    emitView(true);
  };

  var mount = PD.mount;
  PD.mount = function (gd) {
    if (gd && gd._plootsCleanup) gd._plootsCleanup();
    return mount.apply(this, arguments);
  };
})();
