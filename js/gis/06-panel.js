/* ==========================================================================
   GIS — the Map panel (left sidebar, "Map" nav button).

   Sections: Layers, Layer style, Basemap, Map view, Grid, Frame, Layout
   items. Controls are generated and bound through data-bind="scope:key":
     layer:key   active layer's style (vector) or the layer itself
     layerTop:k  property on the layer object (name, opacity, visible)
     raster:key  active raster layer's render settings (re-colours it)
     map:key     state.map* settings (frame, grid, basemap, lock)
     item:key    selected layout item's gisOpts (legend, scale bar, ...)
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var TYPE = GIS.TYPE;
  var PANEL_ID = "panel-map";

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (sel ? " selected" : "") + ">" + esc(label) + "</option>"; }
  function options(list, value) { return list.map(function (o) { return opt(o[0], o[1], String(o[0]) === String(value)); }).join(""); }

  function section(id, icon, title, body, open) {
    return '<div class="side-section' + (open ? " open" : "") + '" data-section="' + id + '">' +
      '<div class="side-section-head"><span class="ss-lbl"><span class="material-symbols-outlined">' + icon + "</span>" + title + '</span><span class="material-symbols-outlined ss-chev">expand_more</span></div>' +
      '<div class="side-section-body" id="' + id + '">' + (body || "") + "</div></div>";
  }

  function field(label, control) { return '<label class="field-label">' + label + "</label>" + control; }
  function pair(a, b) { return '<div class="num-pair" style="margin-top:8px;"><div>' + a + "</div><div>" + b + "</div></div>"; }
  function num(bind, v, min, max, step) { return '<input type="number" data-bind="' + bind + '" value="' + esc(v) + '"' + (min != null ? ' min="' + min + '"' : "") + (max != null ? ' max="' + max + '"' : "") + ' step="' + (step || "any") + '">'; }
  function color(bind, v) { return '<input type="color" class="full-color-picker" data-bind="' + bind + '" value="' + esc(v) + '">'; }
  function check(bind, v, label) { var id = "gb_" + bind.replace(/\W/g, "_"); return '<div class="check-row"><input type="checkbox" id="' + id + '" data-bind="' + bind + '"' + (v ? " checked" : "") + '><label for="' + id + '">' + label + "</label></div>"; }
  function select(bind, list, v) { return '<select data-bind="' + bind + '">' + options(list, v) + "</select>"; }
  function range(bind, v, min, max, step) { return '<input type="range" data-bind="' + bind + '" value="' + esc(v) + '" min="' + min + '" max="' + max + '" step="' + step + '">'; }
  function text(bind, v, ph) { return '<input type="text" data-bind="' + bind + '" value="' + esc(v) + '" placeholder="' + esc(ph || "") + '">'; }

  /* ------------------------------------------------------------ layout */

  function buildPanel() {
    if ($(PANEL_ID)) return;
    var panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "sidebar-panel";
    // Same sticky title bar ui_sections.js gives the built-in panels.
    panel.innerHTML =
      '<div class="sp-head"><span class="sp-title">Map</span><button type="button" class="sp-close" title="Close panel" aria-label="Close panel">' +
        '<span class="material-symbols-outlined">keyboard_double_arrow_left</span></button></div>' +
      section("gisLayers", "layers", "Layers",
        '<div class="gis-layer-actions">' +
          '<button class="file-btn" title="Add vector layer (GeoJSON, TopoJSON)"><span class="material-symbols-outlined">polyline</span>Vector<input type="file" id="gisVectorFile" accept=".json,.geojson,.topojson,application/json,application/geo+json" multiple></button>' +
          '<button class="file-btn" title="Add raster layer (GeoTIFF)"><span class="material-symbols-outlined">grid_on</span>Raster<input type="file" id="gisRasterFile" accept=".tif,.tiff,image/tiff"></button>' +
          '<button id="gisXyzBtn" title="Add XYZ tile layer"><span class="material-symbols-outlined">travel_explore</span>XYZ</button>' +
        "</div>" +
        '<div class="gis-layer-actions">' +
          '<button id="gisUrlBtn"><span class="material-symbols-outlined">link</span>URL</button>' +
          '<button id="gisSampleBtn"><span class="material-symbols-outlined">public</span>Sample</button>' +
          '<button id="gisTableBtn"><span class="material-symbols-outlined">table</span>Attributes</button>' +
        "</div>" +
        '<div id="gisUrlWrap" style="display:none;"><textarea id="gisUrlText" placeholder="https://…/data.geojson or GeoJSON text" style="height:60px;font-size:11px;margin-top:6px;"></textarea><button id="gisUrlLoad" style="width:100%;margin-top:6px;">Load</button></div>' +
        '<div id="gisXyzWrap" style="display:none;">' +
          '<select id="gisXyzPreset" style="margin-top:6px;">' + options([["", "Custom URL"]].concat(GIS.BASEMAPS.filter(function (b) { return b.tiles; }).map(function (b) { return [b.id, b.label]; })), "") + "</select>" +
          '<input type="text" id="gisXyzUrl" placeholder="https://…/{z}/{x}/{y}.png" style="margin-top:6px;">' +
          '<button id="gisXyzAdd" style="width:100%;margin-top:6px;">Add tile layer</button></div>' +
        '<p class="status" id="gisStatus" style="display:none;"></p>' +
        '<div id="gisLayerList" class="gis-layer-list"></div>', true) +
      section("gisStyle", "palette", "Layer style", "", true) +
      section("gisBasemapSec", "map", "Basemap", '<select id="gisBasemap">' + options(GIS.BASEMAPS.map(function (b) { return [b.id, b.label]; }), state.mapBasemap) + "</select>", true) +
      section("gisView", "explore", "Map view", "", true) +
      section("gisGrid", "grid_4x4", "Grid", "", false) +
      section("gisFrame", "crop_square", "Frame", "", false) +
      section("gisItemsSec", "dashboard_customize", "Layout items",
        '<div class="gis-item-add">' +
          '<button data-add="legend"><span class="material-symbols-outlined">format_list_bulleted</span>Legend</button>' +
          '<button data-add="scalebar"><span class="material-symbols-outlined">straighten</span>Scale bar</button>' +
          '<button data-add="north"><span class="material-symbols-outlined">navigation</span>North arrow</button>' +
          '<button data-add="inset"><span class="material-symbols-outlined">picture_in_picture</span>Inset map</button>' +
          '<button data-add="colorbar"><span class="material-symbols-outlined">gradient</span>Color bar</button>' +
        '</div><div id="gisItemProps"></div>', true);
    var sidebar = document.querySelector(".sidebar");
    sidebar.insertBefore(panel, sidebar.firstChild);

    // Nav button, right after the Data toggle's separator.
    var nav = document.querySelector(".sidebar-nav");
    var btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.setAttribute("data-panel", PANEL_ID);
    btn.title = "Map";
    btn.innerHTML = '<span class="material-symbols-outlined">map</span><span class="nav-lbl">Map</span>';
    var canvasBtn = nav.querySelector('[data-panel="panel-canvas"]');
    nav.insertBefore(btn, canvasBtn);
    btn.addEventListener("click", function () {
      if (btn.classList.contains("active")) { window.closeSidebar(); return; }
      enterMapMode();
      activateSidebarPanel(PANEL_ID);
    });

    panel.querySelector(".sp-close").addEventListener("click", function () { if (window.closeSidebar) window.closeSidebar(); });
    wireStatic();
    refreshAll();
  }

  function setStatus(msg, ok) {
    var el = $("gisStatus");
    if (!el) return;
    el.style.display = msg ? "" : "none";
    el.className = "status " + (ok ? "ok" : "error");
    el.textContent = msg || "";
  }

  /* -------------------------------------------------------- layer list */

  var KIND_ICON = { vector: "polyline", raster: "grid_on", xyz: "travel_explore" };

  function renderLayerList() {
    var box = $("gisLayerList");
    if (!box) return;
    if (!GIS.layers.length) { box.innerHTML = '<div class="gis-empty">No layers</div>'; return; }
    var act = GIS.active();
    box.innerHTML = GIS.layers.map(function (l, i) {
      var sel = l.kind === "vector" && l.selection.size ? '<em class="gis-sel-badge">' + l.selection.size + "</em>" : "";
      return '<div class="gis-layer' + (act && act.id === l.id ? " active" : "") + '" data-id="' + l.id + '" draggable="true">' +
        '<input type="checkbox" data-vis="' + l.id + '"' + (l.visible ? " checked" : "") + ' title="Show / hide">' +
        '<span class="material-symbols-outlined gis-kind">' + KIND_ICON[l.kind] + "</span>" +
        '<span class="gis-layer-name" title="Double-click to rename">' + esc(l.name) + "</span>" + sel +
        '<button data-up="' + l.id + '" title="Move up"' + (i === 0 ? " disabled" : "") + '><span class="material-symbols-outlined">arrow_upward</span></button>' +
        '<button data-down="' + l.id + '" title="Move down"' + (i === GIS.layers.length - 1 ? " disabled" : "") + '><span class="material-symbols-outlined">arrow_downward</span></button>' +
        '<button data-zoom="' + l.id + '" title="Zoom to layer"><span class="material-symbols-outlined">zoom_in_map</span></button>' +
        '<button data-del="' + l.id + '" title="Remove layer"><span class="material-symbols-outlined">close</span></button>' +
        "</div>";
    }).join("");
  }

  function wireLayerList() {
    var box = $("gisLayerList"), dragId = null;
    box.addEventListener("click", function (e) {
      var t = e.target, b = t.closest("button");
      if (b) {
        if (b.dataset.up) GIS.move(b.dataset.up, GIS.layers.findIndex(function (l) { return l.id === b.dataset.up; }) - 1);
        else if (b.dataset.down) GIS.move(b.dataset.down, GIS.layers.findIndex(function (l) { return l.id === b.dataset.down; }) + 1);
        else if (b.dataset.zoom) GIS.mapActions && GIS.mapActions.zoomToLayer(GIS.get(b.dataset.zoom));
        else if (b.dataset.del) GIS.remove(b.dataset.del);
        return;
      }
      if (t.dataset.vis) { var l = GIS.get(t.dataset.vis); l.visible = t.checked; GIS.emit("style"); return; }
      var row = t.closest(".gis-layer");
      if (row) GIS.setActive(row.dataset.id);
    });
    box.addEventListener("dblclick", function (e) {
      var nameEl = e.target.closest(".gis-layer-name");
      if (!nameEl) return;
      var l = GIS.get(nameEl.parentNode.dataset.id);
      var n = (window.prompt("Layer name", l.name) || "").trim();
      if (n) { l.name = n; GIS.emit("layers"); }
    });
    box.addEventListener("dragstart", function (e) { var r = e.target.closest(".gis-layer"); if (r) { dragId = r.dataset.id; e.dataTransfer.effectAllowed = "move"; } });
    box.addEventListener("dragover", function (e) { if (dragId) e.preventDefault(); });
    box.addEventListener("drop", function (e) {
      var r = e.target.closest(".gis-layer");
      if (!dragId || !r) return;
      e.preventDefault();
      GIS.move(dragId, GIS.layers.findIndex(function (l) { return l.id === r.dataset.id; }));
      dragId = null;
    });
  }

  /* -------------------------------------------------------- layer style */

  var SYMS = [["single", "Single"], ["categorized", "Categorized"], ["graduated", "Graduated"]];
  var METHODS = [["jenks", "Natural breaks (Jenks)"], ["quantile", "Quantile"], ["equal", "Equal interval"]];

  function renderStyle() {
    var box = $("gisStyle"), l = GIS.active();
    if (!box) return;
    if (!l) { box.innerHTML = '<div class="gis-empty">No layer selected</div>'; return; }
    var h = '<div class="gis-style-name">' + esc(l.name) + "</div>";
    h += field("Layer opacity", range("layerTop:opacity", l.opacity, 0, 1, 0.05));
    if (l.kind === "xyz") { box.innerHTML = h + field("Tile URL", text("layerTop:url", l.url)); return; }
    if (l.kind === "raster") {
      var r = l.raster, bands = r.bands.map(function (b, i) { return [i, "Band " + (i + 1)]; });
      h += field("Render type", select("raster:mode", [["single", "Singleband pseudocolor"]].concat(r.bands.length >= 3 ? [["rgb", "Multiband color (RGB)"]] : []), r.mode));
      if (r.mode === "rgb") {
        h += pair(field("Red", select("rasterRgb:0", bands, r.rgb[0])), field("Green", select("rasterRgb:1", bands, r.rgb[1])));
        h += field("Blue", select("rasterRgb:2", bands, r.rgb[2]));
      } else {
        h += field("Band", select("raster:band", bands, r.band));
        h += field("Color ramp", select("raster:ramp", GIS.sym.RAMPS.map(function (x) { return [x, x]; }), r.ramp));
        h += check("raster:reverse", r.reverse, "Invert ramp");
        h += pair(field("Color mode", select("raster:classMode", [["continuous", "Continuous"], ["discrete", "Discrete"]], r.classMode)),
          r.classMode === "discrete" ? field("Classes", num("raster:classes", r.classes, 2, 20, 1)) : "");
        h += check("raster:auto", r.auto, "Stretch to 2–98% cumulative count");
        if (!r.auto) h += pair(field("Min", num("raster:min", r.min)), field("Max", num("raster:max", r.max)));
      }
      h += field("Resampling", select("raster:resampling", [["linear", "Bilinear"], ["nearest", "Nearest neighbour"]], r.resampling));
      h += '<div class="gis-meta">EPSG:' + r.epsg + " · " + r.sourceSize[0] + " × " + r.sourceSize[1] + " px · " + r.bands.length + " band(s)</div>";
      box.innerHTML = h;
      return;
    }
    GIS.ensureStyle(l);
    var s = l.style, f = GIS.fields(l), ren = s.renderer || "simple";
    var numList = f.numeric.map(function (k) { return [k, k]; });
    h += field("Renderer", select("layer:renderer", [["simple", "Features"], ["proportional", "Proportional symbols"], ["heatmap", "Heatmap"]], ren));
    if (ren === "heatmap") {
      h += field("Weight", '<select data-bind="layer:heatField">' + opt("", "Equal weight", !s.heatField) + options(numList, s.heatField) + "</select>");
      h += pair(field("Radius (px)", num("layer:heatRadius", s.heatRadius, 2, 150, 1)), field("Intensity", num("layer:heatIntensity", s.heatIntensity, 0.1, 10, 0.1)));
      h += field("Color ramp", select("layer:heatRamp", GIS.sym.RAMPS.map(function (x) { return [x, x]; }), s.heatRamp));
      h += field("Opacity", range("layer:heatOpacity", s.heatOpacity, 0, 1, 0.05));
      box.innerHTML = h;
      return;
    }
    if (ren === "proportional") {
      h += field("Size by", '<select data-bind="layer:sizeField">' + opt("", "— Select field —", !s.sizeField) + options(numList, s.sizeField) + "</select>");
      h += pair(field("Min size (px)", num("layer:sizeMin", s.sizeMin, 0, 80, 0.5)), field("Max size (px)", num("layer:sizeMax", s.sizeMax, 2, 150, 0.5)));
      h += field("Scaling", select("layer:sizeScale", [["sqrt", "Area (proportional)"], ["linear", "Linear (min–max)"]], s.sizeScale));
    }
    h += '<div class="toggle-group" style="margin-top:10px;">' + SYMS.map(function (x) { return '<button data-sym="' + x[0] + '"' + (s.symbology === x[0] ? ' class="active"' : "") + ">" + x[1] + "</button>"; }).join("") + "</div>";
    if (s.symbology === "single") h += field("Color", color("layer:singleColor", s.singleColor));
    else {
      var list = (s.symbology === "graduated" ? f.numeric : f.all).map(function (k) { return [k, k]; }).concat([[GIS.TABLE_FIELD, "Data table (join)"]]);
      h += field("Value", '<select data-bind="layer:field">' + opt("", "— Select field —", !s.field) + options(list, s.field) + "</select>");
      if (s.field === GIS.TABLE_FIELD) h += field("Join field", select("layer:joinField", f.all.map(function (k) { return [k, k]; }), s.joinField));
      if (s.symbology === "categorized") {
        var cats = GIS.sym.categories(l);
        h += '<div class="gj-class-list">' + (cats.length ? cats.slice(0, 80).map(function (c, i) {
          return '<div class="gj-class-row"><input type="color" data-cat="' + i + '" value="' + c.color + '"><span title="' + esc(c.value) + '">' + esc(c.value) + "</span><em>" + c.count + "</em></div>";
        }).join("") : '<div class="gis-empty">No values</div>') + "</div>";
        h += '<button id="gisRecolor" style="width:100%;margin-top:6px;">Classify with active palette</button>';
      } else if (s.symbology === "graduated") {
        h += pair(field("Classes", num("layer:classes", s.classes, 2, 9, 1)), field("Mode", select("layer:method", METHODS, s.method)));
        h += field("Color ramp", select("layer:ramp", GIS.sym.RAMPS.map(function (x) { return [x, x]; }), s.ramp));
        h += check("layer:reverse", s.reverse, "Invert ramp");
        var cls = GIS.sym.classes(l);
        h += '<div class="gj-class-list">' + (cls.colors.length ? cls.labels.map(function (lb, i) {
          return '<div class="gj-class-row"><i style="background:' + cls.colors[i] + '"></i><span>' + esc(lb) + "</span><em>" + cls.counts[i] + "</em></div>";
        }).join("") : '<div class="gis-empty">Select a numeric field</div>') + "</div>";
      }
      h += field("No-value color", color("layer:missingColor", s.missingColor));
    }
    var kind = GIS.geometryKind(l);
    if (kind === "polygon") h += field("Fill opacity", range("layer:fillOpacity", s.fillOpacity, 0, 1, 0.05));
    h += pair(field("Stroke color", color("layer:strokeColor", s.strokeColor)), field("Stroke width", num("layer:strokeWidth", s.strokeWidth, 0, 20, 0.1)));
    if (kind === "point") h += field("Point size", num("layer:pointRadius", s.pointRadius, 1, 50, 0.5));
    if (kind === "line") h += field("Line width", num("layer:lineWidth", s.lineWidth, 0.2, 30, 0.2));
    h += field("Labels", '<select data-bind="layer:labelField">' + opt("", "No labels", !s.labelField) + options(f.all.map(function (k) { return [k, k]; }), s.labelField) + "</select>");
    h += field("Label template", text("layer:labelTemplate", s.labelTemplate, "{name} ({value})"));
    if (s.labelField || s.labelTemplate) {
      h += pair(field("Size", num("layer:labelSize", s.labelSize, 6, 48, 1)), field("Font", select("layer:labelFont", [["regular", "Regular"], ["bold", "Bold"], ["italic", "Italic"]], s.labelFont)));
      h += pair(field("Color", color("layer:labelColor", s.labelColor)), field("Halo", color("layer:labelHaloColor", s.labelHaloColor)));
      h += field("Halo width", num("layer:labelHaloWidth", s.labelHaloWidth, 0, 8, 0.1));
      if (kind === "line") h += field("Placement", select("layer:labelPlacement", [["auto", "Along the line"], ["point", "At the middle"]], s.labelPlacement));
      h += check("layer:labelOverlap", s.labelOverlap, "Show all labels (allow overlap)");
    }
    box.innerHTML = h;
  }

  /* ---------------------------------------------------- view/grid/frame */

  function renderView() {
    var v = $("gisView");
    if (v) v.innerHTML =
      pair(field("Scale 1:", '<input type="number" id="gisScale" min="1" step="1">'), field("Rotation (°)", '<input type="number" id="gisRotation" step="1">')) +
      check("map:mapLock", state.mapLock, "Lock map (no pan / zoom)") +
      '<button id="gisMoveBtn" class="btn-primary" style="width:100%;margin-top:10px;"' + (state.mapLock ? " disabled" : "") + '><span class="material-symbols-outlined">open_with</span>Move content</button>' +
      '<div class="gis-layer-actions" style="margin-top:6px;"><button id="gisZoomAll"><span class="material-symbols-outlined">fit_screen</span>Full extent</button><button id="gisZoomLayer"><span class="material-symbols-outlined">zoom_in_map</span>Active layer</button></div>';
    syncViewInputs();
    var g = $("gisGrid");
    if (g) g.innerHTML =
      check("map:mapGrid", state.mapGrid, "Show grid") +
      pair(field("Type", select("map:mapGridType", [["geographic", "Geographic (°)"], ["utm", "UTM (m)"]], state.mapGridType)),
        field(state.mapGridType === "utm" ? "Interval (m)" : "Interval (°)", num("map:mapGridInterval", state.mapGridInterval, 0, state.mapGridType === "utm" ? 1000000 : 90, "any"))) +
      (state.mapGridType === "utm"
        ? pair(field("UTM zone", select("map:mapGridUtmZone", [[0, "Auto (map center)"]].concat(d3.range(1, 61).map(function (z) { return [z, "Zone " + z]; })), state.mapGridUtmZone)),
            field("Units", select("map:mapGridUnits", [["m", "Meters"], ["km", "Kilometers"]], state.mapGridUnits)))
        : field("Format", select("map:mapGridFormat", [["dms", "Degrees, minutes"], ["decimal", "Decimal degrees"]], state.mapGridFormat))) +
      pair(field("Labels", select("map:mapGridLabels", [["lb", "Left & bottom"], ["all", "All sides"], ["none", "None"]], state.mapGridLabels)),
        field("Label position", select("map:mapGridLabelPos", [["inside", "Inside frame"], ["outside", "Outside frame"]], state.mapGridLabelPos))) +
      field("Style", select("map:mapGridStyle", [["lines", "Lines"], ["crosses", "Crosses"]], state.mapGridStyle)) +
      '<p class="status error" id="gisGridNote" style="display:none;"></p>' +
      pair(field("Color", color("map:mapGridColor", state.mapGridColor)), field("Width", num("map:mapGridWidth", state.mapGridWidth, 0.1, 5, 0.1))) +
      field("Label size", num("map:mapGridFontSize", state.mapGridFontSize, 6, 24, 1));
    var fr = $("gisFrame");
    if (fr) fr.innerHTML = check("map:mapFrame", state.mapFrame, "Show frame") +
      pair(field("Width", num("map:mapFrameWidth", state.mapFrameWidth, 0, 10, 0.25)), field("Color", color("map:mapFrameColor", state.mapFrameColor)));
  }

  function syncViewInputs() {
    var gn = $("gisGridNote");
    if (gn) { gn.textContent = state.mapGrid && state.mapGridType === "utm" ? GIS.gridNote || "" : ""; gn.style.display = gn.textContent ? "" : "none"; }
    var sc = $("gisScale"), ro = $("gisRotation"), bm = $("gisBasemap");
    if (bm && bm.value !== state.mapBasemap) bm.value = state.mapBasemap;
    if (sc && document.activeElement !== sc) { var n = GIS.getScale ? GIS.getScale() : 0; sc.value = n ? Math.round(n) : ""; }
    if (ro && document.activeElement !== ro) ro.value = GIS.getRotation ? Math.round(GIS.getRotation() * 10) / 10 : 0;
  }

  /* ---------------------------------------------------- item properties */

  var SCALE_STYLES = [["single", "Single box"], ["double", "Double box"], ["ticks-middle", "Line ticks middle"], ["ticks-down", "Line ticks down"], ["ticks-up", "Line ticks up"], ["stepped", "Stepped line"], ["hollow", "Hollow"], ["numeric", "Numeric (1:n)"]];
  var SCALE_UNITS = [["auto", "Auto (m / km)"], ["auto-imperial", "Auto (ft / mi)"], ["m", "Meters"], ["km", "Kilometers"], ["ft", "Feet"], ["mi", "Miles"], ["nmi", "Nautical miles"]];
  var NORTH_STYLES = [["arrow", "Split arrow"], ["half", "Half arrow"], ["triangle", "Solid triangle"], ["line", "Line arrow"], ["circle", "Circle arrow"], ["compass4", "Compass rose (4)"], ["compass8", "Compass rose (8)"], ["star", "Star"]];

  function selectedItem() {
    var fc = window.fabricCanvas, o = fc && fc.getActiveObject();
    return o && o.gisItem ? o : null;
  }

  function renderItemProps() {
    var box = $("gisItemProps");
    if (!box) return;
    var o = selectedItem();
    if (!o) { box.innerHTML = ""; return; }
    var p = o.gisOpts, h = '<div class="gis-style-name">' + esc(o.layerName || o.gisItem) + "</div>";
    if (o.gisItem === "legend") {
      h += field("Title", text("item:title", p.title)) + pair(field("Font size", num("item:fontSize", p.fontSize, 6, 36, 1)), field("Background", color("item:background", p.background || "#ffffff")));
      h += check("item:frame", p.frame, "Frame") + check("item:showLayerNames", p.showLayerNames, "Layer headings");
    } else if (o.gisItem === "scalebar") {
      h += field("Style", select("item:style", SCALE_STYLES, p.style)) + field("Units", select("item:units", SCALE_UNITS, p.units));
      h += pair(field("Segments", num("item:segments", p.segments, 1, 10, 1)), field("Target width (px)", num("item:width", p.width, 40, 800, 1)));
      h += pair(field("Height", num("item:height", p.height, 2, 30, 1)), field("Font size", num("item:fontSize", p.fontSize, 6, 30, 1)));
      h += pair(field("Labels", select("item:labels", [["all", "Every segment"], ["ends", "Ends only"]], p.labels)), field("Color", color("item:color", p.color)));
      h += check("item:frame", p.frame, "Background frame");
    } else if (o.gisItem === "north") {
      h += field("Style", select("item:style", NORTH_STYLES, p.style)) + pair(field("Size", num("item:size", p.size, 16, 300, 1)), field("Color", color("item:color", p.color)));
      h += check("item:followMap", p.followMap, "Follow map rotation");
    } else if (o.gisItem === "colorbar") {
      var srcs = GIS.layers.filter(function (l) { return l.kind === "raster" || (l.kind === "vector" && l.style.symbology === "graduated"); });
      h += field("Layer", '<select data-bind="item:layerId">' + opt("", "Auto", !p.layerId) + options(srcs.map(function (l) { return [l.id, l.name]; }), p.layerId) + "</select>");
      h += pair(field("Mode", select("item:mode", [["auto", "Follow layer"], ["continuous", "Continuous"], ["discrete", "Discrete"]], p.mode)),
        field("Ends", select("item:extend", [["neither", "Square"], ["both", "Pointed, both"], ["min", "Pointed, min"], ["max", "Pointed, max"]], p.extend)));
      if (p.mode === "discrete") h += field("Classes", num("item:classes", p.classes, 2, 20, 1));
      h += pair(field("Orientation", select("item:orientation", [["horizontal", "Horizontal"], ["vertical", "Vertical"]], p.orientation)), field("Title", text("item:title", p.title)));
      h += pair(field("Length", num("item:length", p.length, 40, 900, 1)), field("Thickness", num("item:thickness", p.thickness, 4, 60, 1)));
      h += pair(field("Ticks", num("item:ticks", p.ticks, 2, 12, 1)), field("Decimals", select("item:decimals", [[-1, "Auto"], [0, "0"], [1, "1"], [2, "2"], [3, "3"]], p.decimals)));
      h += pair(field("Font size", num("item:fontSize", p.fontSize, 6, 30, 1)), field("Color", color("item:color", p.color)));
      h += check("item:frame", p.frame, "Background frame");
    } else if (o.gisItem === "inset") {
      h += field("Basemap", select("item:basemap", GIS.BASEMAPS.map(function (b) { return [b.id, b.label]; }), p.basemap));
      h += pair(field("Zoom offset", num("item:zoomOffset", p.zoomOffset, -12, 0, 1)), field("Extent color", color("item:extentColor", p.extentColor)));
      h += field("Frame width", num("item:frameWidth", p.frameWidth, 0, 8, 0.5)) + check("item:showLayers", p.showLayers, "Show layers");
    }
    box.innerHTML = h;
  }

  /* --------------------------------------------------------- binding */

  function parse(el) {
    if (el.type === "checkbox") return el.checked;
    if (el.type === "number" || el.type === "range") { var v = parseFloat(el.value); return isFinite(v) ? v : 0; }
    return el.value;
  }

  var RASTER_REPAINT = { mode: 1, band: 1, ramp: 1, reverse: 1, auto: 1, min: 1, max: 1, classMode: 1, classes: 1 };

  function onBind(el) {
    var b = el.dataset.bind.split(":"), scope = b[0], key = b[1], v = parse(el), l = GIS.active();
    if (scope === "layer" && l) {
      var prevTemplate = l.style.labelTemplate;
      if (key === "field" || key === "joinField") l.style.catColors = {};
      l.style[key] = v;
      GIS.emit("style");
      if (/^(field|joinField|classes|method|ramp|reverse|labelField|renderer|sizeField)$/.test(key) || (key === "labelTemplate" && !!v !== !!prevTemplate)) renderStyle();
    } else if (scope === "layerTop" && l) {
      l[key] = v;
      GIS.emit(key === "url" ? "layers" : "style");
    } else if (scope === "raster" && l) {
      if (key === "band") v = +v;
      l.raster[key] = v;
      if (RASTER_REPAINT[key]) GIS.raster.restyle(l); else GIS.emit("style");
      renderStyle();
    } else if (scope === "rasterRgb" && l) {
      l.raster.rgb[+key] = +v;
      GIS.raster.restyle(l);
    } else if (scope === "map") {
      state[key] = v;
      if (key === "mapGridUtmZone") state[key] = +v;
      if (key === "mapGridType") state.mapGridInterval = 0; // degrees vs metres
      if (key === "mapLock") { if (v && GIS.mapActions) GIS.mapActions.setInteractive(false); renderView(); }
      if (key === "mapGridType") renderView();
      if (typeof render === "function" && state.chartType === TYPE) render();
      if (typeof historyNotifyChange === "function") historyNotifyChange();
    } else if (scope === "item") {
      var o = selectedItem();
      if (key === "decimals") v = +v;
      if (o) { var patch = {}; patch[key] = v; GIS.items.update(o, patch); if (/^(mode|layerId)$/.test(key)) setTimeout(renderItemProps, 0); }
    }
  }

  function wireStatic() {
    var panel = $(PANEL_ID);
    panel.addEventListener("input", function (e) { if (e.target.dataset && e.target.dataset.bind && e.target.type !== "checkbox" && e.target.tagName !== "SELECT") onBind(e.target); });
    panel.addEventListener("change", function (e) {
      var t = e.target;
      if (t.dataset && t.dataset.bind && (t.type === "checkbox" || t.tagName === "SELECT")) onBind(t);
      if (t.dataset && t.dataset.cat != null) {
        var l = GIS.active(), c = GIS.sym.categories(l)[+t.dataset.cat];
        l.style.catColors = Object.assign({}, l.style.catColors); l.style.catColors[c.value] = t.value;
        GIS.emit("style");
      }
    });
    panel.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var l = GIS.active();
      if (b.dataset.sym && l) {
        l.style.symbology = b.dataset.sym;
        var f = GIS.fields(l);
        if (b.dataset.sym === "graduated" && l.style.field !== GIS.TABLE_FIELD && f.numeric.indexOf(l.style.field) < 0) l.style.field = f.numeric[0] || "";
        if (b.dataset.sym === "categorized" && !l.style.field) l.style.field = f.all[0] || "";
        GIS.emit("style"); renderStyle();
      } else if (b.id === "gisRecolor" && l) { l.style.catColors = {}; GIS.emit("style"); renderStyle(); }
      else if (b.dataset.add) { enterMapMode(); GIS.items.add(b.dataset.add); }
      else if (b.id === "gisMoveBtn") GIS.mapActions && GIS.mapActions.setInteractive(true);
      else if (b.id === "gisZoomAll") GIS.mapActions && GIS.mapActions.fitAll();
      else if (b.id === "gisZoomLayer") GIS.mapActions && GIS.mapActions.zoomToLayer(GIS.active());
    });
    panel.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      if (e.target.id === "gisScale") GIS.setScale(parseFloat(e.target.value));
      if (e.target.id === "gisRotation") GIS.setRotation(parseFloat(e.target.value));
    });
    panel.addEventListener("focusout", function (e) {
      if (e.target.id === "gisScale" && e.target.value) GIS.setScale(parseFloat(e.target.value));
      if (e.target.id === "gisRotation") GIS.setRotation(parseFloat(e.target.value));
    });

    $("gisVectorFile").addEventListener("change", function () {
      var files = Array.prototype.slice.call(this.files || []);
      this.value = "";
      files.forEach(function (file) {
        var reader = new FileReader();
        reader.onload = function () {
          try { enterMapMode(); GIS.addVector(JSON.parse(reader.result), file.name.replace(/\.(geo|topo)?json$/i, "")); setStatus(""); }
          catch (err) { setStatus(file.name + ": " + err.message, false); }
        };
        reader.readAsText(file);
      });
    });
    $("gisRasterFile").addEventListener("change", function () {
      var file = this.files && this.files[0];
      this.value = "";
      if (!file) return;
      setStatus("Reading " + file.name + "…", true);
      file.arrayBuffer().then(function (buf) { enterMapMode(); return GIS.raster.loadGeoTIFF(buf, file.name.replace(/\.tiff?$/i, "")); })
        .then(function () { setStatus(""); })
        .catch(function (err) { setStatus(file.name + ": " + err.message, false); });
    });
    $("gisUrlBtn").addEventListener("click", function () { var w = $("gisUrlWrap"); w.style.display = w.style.display === "none" ? "" : "none"; $("gisXyzWrap").style.display = "none"; });
    $("gisXyzBtn").addEventListener("click", function () { var w = $("gisXyzWrap"); w.style.display = w.style.display === "none" ? "" : "none"; $("gisUrlWrap").style.display = "none"; });
    $("gisXyzPreset").addEventListener("change", function () { var b = GIS.BASEMAPS.filter(function (x) { return x.id === this.value; }, this)[0]; $("gisXyzUrl").value = b ? b.tiles : ""; });
    $("gisXyzAdd").addEventListener("click", function () {
      var url = $("gisXyzUrl").value.trim();
      if (!/\{z\}/.test(url)) { setStatus("The URL needs {z}, {x} and {y}.", false); return; }
      var pre = GIS.BASEMAPS.filter(function (x) { return x.tiles === url; })[0];
      enterMapMode();
      GIS.addXYZ(url, pre ? pre.label : "XYZ tiles", pre ? pre.attr : "");
      setStatus("");
    });
    $("gisUrlLoad").addEventListener("click", function () {
      var t = $("gisUrlText").value.trim();
      if (!t) return;
      if (/^https?:\/\//i.test(t)) {
        setStatus("Downloading…", true);
        fetch(t).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return /\.tiff?(\?|$)/i.test(t) ? r.arrayBuffer().then(function (b) { return { tiff: b }; }) : r.json(); })
          .then(function (obj) {
            enterMapMode();
            var name = decodeURIComponent(t.split("/").pop().split("?")[0]) || "Layer";
            return obj.tiff ? GIS.raster.loadGeoTIFF(obj.tiff, name) : GIS.addVector(obj, name.replace(/\.(geo|topo)?json$/i, ""));
          })
          .then(function () { setStatus(""); })
          .catch(function (err) { setStatus(err.message, false); });
        return;
      }
      try { enterMapMode(); GIS.addVector(JSON.parse(t), "Pasted layer"); setStatus(""); } catch (err) { setStatus(err.message, false); }
    });
    $("gisSampleBtn").addEventListener("click", function () { loadSample(); });
    $("gisTableBtn").addEventListener("click", function () {
      if (GIS.attributeTable.isOpen()) GIS.attributeTable.hide();
      else { var l = GIS.active(); GIS.attributeTable.show(l && l.kind === "vector" ? l.id : null); }
    });
    $("gisBasemap").addEventListener("change", function () { state.mapBasemap = this.value; if (state.chartType === TYPE) render(); });
    wireLayerList();
  }

  function loadSample() {
    setStatus("Loading sample…", true);
    return GIS.loadSample().then(function (fc) {
      enterMapMode();
      var l = GIS.addVector(fc, "ASEAN countries");
      Object.assign(l.style, { symbology: "graduated", field: "population_m", labelField: "name", ramp: "YlGn" });
      GIS.emit("style");
      GIS.emit("active", l.id); // re-render the style section with the new symbology
      setStatus("");
      return l;
    }).catch(function (e) { setStatus("Could not load the sample: " + e.message, false); });
  }
  GIS.loadSampleLayer = loadSample;

  function refreshAll() { renderLayerList(); renderStyle(); renderView(); renderItemProps(); }

  // Switches the page's chart block to the map.
  function enterMapMode() {
    if (state.chartType !== TYPE) selectChartType(TYPE);
    document.body.classList.add("gis-mode");
  }
  GIS.enterMapMode = enterMapMode;

  GIS.on("layers", function () { renderLayerList(); renderStyle(); });
  GIS.on("active", function () { renderLayerList(); renderStyle(); });
  GIS.on("selection", renderLayerList);
  GIS.on("data", function () { renderStyle(); });
  GIS.onView(function () { syncViewInputs(); });

  function wireCanvas() {
    var fc = window.fabricCanvas;
    if (!fc || fc._gisPanelWired) return;
    fc._gisPanelWired = true;
    ["selection:created", "selection:updated", "selection:cleared"].forEach(function (ev) { fc.on(ev, renderItemProps); });
  }
  document.addEventListener("ploots:canvasready", wireCanvas);

  // Leaving the map type (e.g. picking a chart) leaves map mode.
  var orig = window.selectChartType;
  window.selectChartType = function (v) {
    orig(v);
    document.body.classList.toggle("gis-mode", v === TYPE);
    if (v !== TYPE && GIS.attributeTable) GIS.attributeTable.hide();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { buildPanel(); wireCanvas(); });
  else { buildPanel(); wireCanvas(); }
})();
