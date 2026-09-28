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
    M = { gd: gd, wrap: wrap, map: map, overlay: overlay, tools: tools, box: box, basemap: s.mapBasemap,
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
      var s = l.style;
      var dkey = [l.rev || 0, s.symbology, s.field, s.joinField, s.field === GIS.TABLE_FIELD ? JSON.stringify(GIS.table()) : ""].join("|");
      if (M.keys[id] !== dkey) setSource(id, { type: "geojson", data: GIS.sym.styledData(l) }, dkey);
      var lkey = (l.rev || 0) + "|" + s.labelField;
      if (M.keys[id + "-lbl"] !== lkey) setSource(id + "-lbl", { type: "geojson", data: GIS.sym.labelData(l) }, lkey);

      var color = GIS.sym.colorExpression(l), op = l.opacity;
      var polys = ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false];
      var lines = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false];
      var points = ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false];
      var sel = ["in", ["get", "__i"], ["literal", Array.from(l.selection)]];
      put(id + "-fill", { type: "fill", source: id, filter: polys, layout: { visibility: vis }, paint: { "fill-color": color, "fill-opacity": s.fillOpacity * op } });
      put(id + "-outline", { type: "line", source: id, filter: polys, layout: { visibility: vis, "line-join": "round" }, paint: { "line-color": s.strokeColor, "line-width": s.strokeWidth, "line-opacity": s.strokeWidth > 0 ? op : 0 } });
      put(id + "-line", { type: "line", source: id, filter: lines, layout: { visibility: vis, "line-cap": "round", "line-join": "round" }, paint: { "line-color": color, "line-width": s.lineWidth, "line-opacity": op } });
      put(id + "-point", { type: "circle", source: id, filter: points, layout: { visibility: vis }, paint: {
        "circle-color": color, "circle-radius": s.pointRadius, "circle-opacity": Math.max(0.05, s.fillOpacity) * op,
        "circle-stroke-color": s.strokeColor, "circle-stroke-width": s.strokeWidth, "circle-stroke-opacity": op } });
      // Selection highlight (QGIS yellow).
      put(id + "-sel-fill", { type: "fill", source: id, filter: ["all", polys, sel], layout: { visibility: vis }, paint: { "fill-color": "#ffea00", "fill-opacity": 0.55 } });
      put(id + "-sel-line", { type: "line", source: id, filter: ["all", ["!", points], sel], layout: { visibility: vis, "line-join": "round" }, paint: { "line-color": "#ffcc00", "line-width": Math.max(2, s.lineWidth + 1) } });
      put(id + "-sel-point", { type: "circle", source: id, filter: ["all", points, sel], layout: { visibility: vis }, paint: { "circle-color": "#ffea00", "circle-radius": s.pointRadius + 1, "circle-stroke-color": "#1a1a1a", "circle-stroke-width": 1 } });
      put(id + "-label", { type: "symbol", source: id + "-lbl", layout: {
        visibility: s.labelField ? vis : "none", "text-field": ["get", "t"], "text-font": FONT, "text-size": s.labelSize, "text-max-width": 8, "text-padding": 2 },
        paint: { "text-color": s.labelColor, "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.4 } });
    });
    drawOverlay();
  }

  function queryLayers(layer) {
    var id = "gis-" + layer.id;
    return ["-fill", "-line", "-point"].map(function (x) { return id + x; }).filter(function (x) { return M.map.getLayer(x); });
  }

  /* ----------------------------------------------------------- overlay */

  var GRID_STEPS = [30, 20, 15, 10, 5, 2, 1, 0.5, 0.25, 1 / 6, 0.1, 1 / 12, 0.05, 1 / 60, 0.01, 0.005, 1 / 360, 0.001];

  function coordLabel(v, axis) {
    var hemi = axis === "x" ? (v < 0 ? "W" : v > 0 ? "E" : "") : (v < 0 ? "S" : v > 0 ? "N" : "");
    var a = Math.abs(v);
    if (state.mapGridFormat === "decimal") return (Math.round(a * 10000) / 10000) + "°" + hemi;
    var d = Math.floor(a + 1e-9), mf = (a - d) * 60, m = Math.floor(mf + 1e-9), sec = Math.round((mf - m) * 60);
    if (sec === 60) { sec = 0; m++; }
    if (m === 60) { m = 0; d++; }
    return d + "°" + (m || sec ? String(m).padStart(2, "0") + "′" : "") + (sec ? String(sec).padStart(2, "0") + "″" : "") + hemi;
  }

  function drawGrid(svg, W, H) {
    var s = state, map = M.map;
    var b = map.getBounds(), west = b.getWest(), east = b.getEast(), south = Math.max(-85, b.getSouth()), north = Math.min(85, b.getNorth());
    var step = s.mapGridInterval > 0 ? s.mapGridInterval : GRID_STEPS.filter(function (g) { return (east - west) / g >= 3; })[0] || 0.001;
    var g = svg.append("g").attr("class", "gis-grid");
    var ink = s.mapGridColor, fs = s.mapGridFontSize || 9, font = s.fontBody;
    function proj(lon, lat) { var p = map.project([lon, lat]); return [p.x, p.y]; }
    var lons = [], lats = [];
    for (var x = Math.ceil(west / step) * step; x <= east + 1e-9; x += step) lons.push(+x.toFixed(9));
    for (var y = Math.ceil(south / step) * step; y <= north + 1e-9; y += step) lats.push(+y.toFixed(9));
    if (lons.length > 200 || lats.length > 200) return;
    var line = d3.line();
    // Sample lines past the view so every one crosses the frame edges.
    var ew = (east - west) * 0.15, ns = (north - south) * 0.15;
    var w2 = west - ew, e2 = east + ew, s2 = Math.max(-89, south - ns), n2 = Math.min(89, north + ns);
    function meridian(lo) { return d3.range(0, 61).map(function (i) { return proj(lo, s2 + (n2 - s2) * i / 60); }); }
    function parallel(la) { return d3.range(0, 61).map(function (i) { return proj(w2 + (e2 - w2) * i / 60, la); }); }
    if (s.mapGridStyle === "crosses") {
      var c = Math.max(4, fs * 0.6);
      lons.forEach(function (lo) { lats.forEach(function (la) {
        var p = proj(lo, la);
        g.append("path").attr("d", "M" + (p[0] - c) + "," + p[1] + "H" + (p[0] + c) + "M" + p[0] + "," + (p[1] - c) + "V" + (p[1] + c)).attr("stroke", ink).attr("stroke-width", s.mapGridWidth).attr("fill", "none");
      }); });
    } else {
      lons.forEach(function (lo) { g.append("path").attr("d", line(meridian(lo))).attr("stroke", ink).attr("stroke-width", s.mapGridWidth).attr("fill", "none"); });
      lats.forEach(function (la) { g.append("path").attr("d", line(parallel(la))).attr("stroke", ink).attr("stroke-width", s.mapGridWidth).attr("fill", "none"); });
    }
    if (s.mapGridLabels === "none") return;
    var sides = s.mapGridLabels === "all" ? ["left", "right", "top", "bottom"] : ["left", "bottom"];
    // Where a grid line crosses a frame edge, label it just inside.
    function crossings(pts) {
      var out = [];
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], c2 = pts[i];
        [["left", 0, "x"], ["right", W, "x"], ["top", 0, "y"], ["bottom", H, "y"]].forEach(function (e) {
          var k = e[2] === "x" ? 0 : 1, v = e[1];
          if ((a[k] - v) * (c2[k] - v) > 0 || a[k] === c2[k]) return;
          var t = (v - a[k]) / (c2[k] - a[k]), q = [a[0] + (c2[0] - a[0]) * t, a[1] + (c2[1] - a[1]) * t];
          var o = 1 - k;
          if (q[o] < 0 || q[o] > (o ? H : W)) return;
          out.push({ side: e[0], p: q });
        });
      }
      return out;
    }
    function label(txt, side, p) {
      var pad = 3, t = g.append("text").attr("font-size", fs).attr("font-family", font).attr("fill", "#1a1a1a")
        .attr("stroke", "rgba(255,255,255,0.9)").attr("stroke-width", 2.5).attr("paint-order", "stroke").text(txt);
      // Left/right labels run along the edge (rotated), like QGIS.
      if (side === "left" || side === "right") {
        var x = side === "left" ? pad + fs / 2 : W - pad - fs / 2;
        t.attr("x", 0).attr("y", 0).attr("dy", "0.35em").attr("text-anchor", "middle").attr("transform", "translate(" + x + "," + p[1] + ") rotate(-90)");
      }
      else if (side === "top") t.attr("x", p[0]).attr("y", pad + fs).attr("text-anchor", "middle");
      else t.attr("x", p[0]).attr("y", H - pad - 2).attr("text-anchor", "middle");
    }
    lons.forEach(function (lo) {
      crossings(meridian(lo))
        .forEach(function (c3) { if (sides.indexOf(c3.side) >= 0) label(coordLabel(lo, "x"), c3.side, c3.p); });
    });
    lats.forEach(function (la) {
      crossings(parallel(la))
        .forEach(function (c3) { if (sides.indexOf(c3.side) >= 0) label(coordLabel(la, "y"), c3.side, c3.p); });
    });
  }

  function attribution() {
    var parts = [];
    var b = basemapDef(state.mapBasemap);
    if (b.attr) parts.push(b.attr);
    GIS.layers.forEach(function (l) { if (l.kind === "xyz" && l.visible && l.attribution) parts.push(l.attribution); });
    return parts.join(" · ");
  }

  function drawOverlay() {
    if (!M) return;
    var s = state, W = s.chartBox.w, H = s.chartBox.h;
    var svg = d3.select(M.overlay).attr("width", W).attr("height", H).attr("viewBox", "0 0 " + W + " " + H);
    svg.selectAll("*").remove();
    if (!GIS.layers.length) {
      svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle").attr("font-size", 13).attr("fill", "#8a8a8a")
        .attr("font-family", s.fontBody).text("Add a layer from the Map panel");
    }
    if (s.mapGrid && M.loaded) drawGrid(svg, W, H);
    var attr = attribution();
    if (attr) {
      svg.append("text").attr("x", W - 4).attr("y", H - 4).attr("text-anchor", "end").attr("font-size", 7).attr("font-family", s.fontBody)
        .attr("fill", "#4a4a46").attr("stroke", "rgba(255,255,255,0.85)").attr("stroke-width", 2.2).attr("paint-order", "stroke").text(attr);
    }
    if (s.mapFrame && s.mapFrameWidth > 0) {
      var fw = s.mapFrameWidth;
      svg.append("rect").attr("x", fw / 2).attr("y", fw / 2).attr("width", Math.max(0, W - fw)).attr("height", Math.max(0, H - fw))
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
    var map = M.map, W = state.chartBox.w, H = state.chartBox.h;
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
          (url ? '<image x="0" y="0" width="' + W + '" height="' + H + '" preserveAspectRatio="none" href="' + url + '" xlink:href="' + url + '"/>' : "") +
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
