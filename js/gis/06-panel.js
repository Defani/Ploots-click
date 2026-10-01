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

  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function field(label, control) { return '<label class="field-label">' + label + "</label>" + control; }
  function pair(a, b) { return '<div class="num-pair" style="margin-top:8px;"><div>' + a + "</div><div>" + b + "</div></div>"; }
  function num(bind, v, min, max, step) { return '<input type="number" data-bind="' + bind + '" value="' + esc(v) + '"' + (min != null ? ' min="' + min + '"' : "") + (max != null ? ' max="' + max + '"' : "") + ' step="' + (step || "any") + '">'; }
  function color(bind, v) { return '<input type="color" class="full-color-picker" data-bind="' + bind + '" value="' + esc(v) + '">'; }
  function check(bind, v, label) { var id = "gb_" + bind.replace(/\W/g, "_"); return '<div class="check-row"><input type="checkbox" id="' + id + '" data-bind="' + bind + '"' + (v ? " checked" : "") + '><label for="' + id + '">' + label + "</label></div>"; }
  function select(bind, list, v) { return '<select data-bind="' + bind + '">' + options(list, v) + "</select>"; }
  // A ramp list; js/gis/14-ramp-picker.js turns it into a picker with previews.
  function rampSelect(bind, v, kind) {
    var h = kind === "qual" ? opt("", "Active chart palette", !v) : "";
    GIS.sym.RAMP_GROUPS.forEach(function (g) {
      h += '<optgroup label="' + esc(g.label) + '">' + options(g.names.map(function (x) { return [x, x.replace(/^ColorBrewer /, "")]; }), v) + "</optgroup>";
    });
    return '<select data-bind="' + bind + '" data-ramp="' + (kind || "ramp") + '">' + h + "</select>";
  }
  // A slider with its number beside it; both edit the same value live.
  function slideNum(bind, v, min, max, step) {
    return '<div class="gis-slidenum">' + range(bind, v, min, max, step) + num(bind, v, 0, null, step) + "</div>";
  }
  var JOINS = [["round", "Round"], ["miter", "Miter"], ["bevel", "Bevel"]];
  // Quick outline presets: [id, label, color, width].
  var OUTLINE_PRESETS = [["none", "None", "#bbbbbb", 0], ["hair", "Hairline", "#ffffff", 0.4], ["white", "White", "#ffffff", 1], ["dark", "Dark", "#333333", 1], ["bold", "Bold", "#111111", 2.5]];
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
          '<button class="file-btn" title="Add vector layer (GeoJSON, TopoJSON, Shapefile, KML/KMZ, GPX)"><span class="material-symbols-outlined">polyline</span>Vector<input type="file" id="gisVectorFile" accept=".json,.geojson,.topojson,.shp,.shx,.dbf,.prj,.cpg,.kml,.kmz,.gpx,.zip,application/json,application/geo+json" multiple></button>' +
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
      section("gisBasemapSec", "map", "Basemap", '<select id="gisBasemap">' + basemapOptions() + "</select>", true) +
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

  // Basemap <option>s grouped like the catalog (vector styles, imagery, ...).
  function basemapOptions() {
    var groups = [];
    GIS.BASEMAPS.forEach(function (b) { if (groups.indexOf(b.group) < 0) groups.push(b.group); });
    return groups.map(function (g) {
      return '<optgroup label="' + esc(g) + '">' + GIS.BASEMAPS.filter(function (b) { return b.group === g; }).map(function (b) { return opt(b.id, b.label, b.id === state.mapBasemap); }).join("") + "</optgroup>";
    }).join("");
  }

  function setStatus(msg, ok) {
    var el = $("gisStatus");
    if (!el) return;
    el.style.display = msg ? "" : "none";
    el.className = "status " + (ok ? "ok" : "error");
    el.textContent = msg || "";
  }

  /* -------------------------------------------------------- layer list */

  var KIND_ICON = { vector: "polyline", raster: "grid_on", xyz: "travel_explore", mvt: "layers" };

  function renderLayerList() {
    var box = $("gisLayerList");
    if (!box) return;
    if (!GIS.layers.length) { box.innerHTML = '<div class="gis-empty">No layers</div>'; return; }
    var act = GIS.active();
    box.innerHTML = GIS.layers.map(function (l) {
      var vec = l.kind === "vector", entries = vec || l.kind === "mvt" ? GIS.sym.legendEntries(l) : [];
      var many = entries.length > 1, open = many && expanded[l.id];
      var sel = vec && l.selection.size ? '<em class="gis-sel-badge" title="Selected">' + l.selection.size + "</em>" : "";
      var count = "";
      if (vec && l.showCount) {
        var mask = GIS.filterMask(l), shown = mask ? mask.filter(Boolean).length : l.data.features.length;
        count = '<span class="gis-count">[' + shown.toLocaleString("en-US") + "]</span>";
      }
      var icon = entries.length === 1 && entries[0].color ? swatch(l, entries[0].color) : '<span class="material-symbols-outlined gis-kind">' + KIND_ICON[l.kind] + "</span>";
      var h = '<div class="gis-layer' + (act && act.id === l.id ? " active" : "") + (l.visible ? "" : " off") + '" data-id="' + l.id + '" draggable="true">' +
        (many ? '<button class="gis-twisty" data-tw="' + l.id + '" title="' + (open ? "Collapse" : "Expand") + '"><span class="material-symbols-outlined">' + (open ? "expand_more" : "chevron_right") + "</span></button>" : '<span class="gis-twisty-sp"></span>') +
        '<input type="checkbox" data-vis="' + l.id + '"' + (l.visible ? " checked" : "") + ' title="Show / hide">' + icon +
        '<span class="gis-layer-name">' + esc(l.name) + "</span>" + count +
        (l.filter ? '<span class="material-symbols-outlined gis-flag" title="Filter: ' + esc(l.filter) + '">filter_alt</span>' : "") +
        (l.legend === false && l.kind !== "xyz" ? '<span class="material-symbols-outlined gis-flag" title="Not in legend">format_list_bulleted</span>' : "") +
        (l.minScale > 0 || l.maxScale > 0 ? '<span class="material-symbols-outlined gis-flag" title="Scale dependent visibility">zoom_out_map</span>' : "") + sel +
        (l.kind !== "xyz" && l.kind !== "mvt" ? '<button data-zoom="' + l.id + '" title="Zoom to layer"><span class="material-symbols-outlined">zoom_in_map</span></button>' : "") +
        (vec ? '<button data-table="' + l.id + '" title="Open attribute table"><span class="material-symbols-outlined">table</span></button>' : "") +
        '<button data-menu="' + l.id + '" title="Layer menu"><span class="material-symbols-outlined">more_vert</span></button>' +
        "</div>";
      if (open) {
        h += '<div class="gis-layer-entries">' + entries.map(function (e) {
          return '<div class="gis-entry">' + (e.color ? swatch(l, e.color) : '<span class="gis-sw-sp"></span>') + "<span>" + esc(e.label) + "</span></div>";
        }).join("") + "</div>";
      }
      return h;
    }).join("");
  }
  var expanded = {};
  // Symbol preview in the layer list: polygon square, line stroke or dot.
  function swatch(l, color) {
    var kind = l.kind === "vector" ? GIS.geometryKind(l) : "polygon";
    if (l.kind === "vector" && l.style.renderer === "heatmap") return '<span class="material-symbols-outlined gis-kind">local_fire_department</span>';
    return '<span class="gis-sw gis-sw-' + kind + '" style="--c:' + esc(color) + '"></span>';
  }

  // Rename a layer in the list: the name becomes a text box; Enter or
  // leaving it saves, Escape cancels.
  function renameInline(id) {
    var l = GIS.get(id), row = document.querySelector('#gisLayerList .gis-layer[data-id="' + id + '"]');
    var span = row && row.querySelector(".gis-layer-name");
    if (!l || !span) return;
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "gis-layer-rename";
    inp.value = l.name;
    span.replaceWith(inp);
    row.draggable = false;
    inp.focus();
    inp.select();
    var done = false;
    function finish(save) {
      if (done) return;
      done = true;
      var v = inp.value.trim();
      if (save && v && v !== l.name) { l.name = v; GIS.emit("layers"); if (typeof historyNotifyChange === "function") historyNotifyChange(); }
      else renderLayerList();
    }
    inp.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    inp.addEventListener("blur", function () { finish(true); });
    ["click", "dblclick", "mousedown"].forEach(function (ev) { inp.addEventListener(ev, function (e) { e.stopPropagation(); }); });
  }
  GIS.renameLayer = renameInline;

  function wireLayerList() {
    var box = $("gisLayerList"), dragId = null;
    box.addEventListener("click", function (e) {
      var t = e.target, b = t.closest("button");
      if (b) {
        if (b.dataset.zoom) GIS.mapActions && GIS.mapActions.zoomToLayer(GIS.get(b.dataset.zoom));
        else if (b.dataset.table) { GIS.setActive(b.dataset.table); GIS.attributeTable.show(b.dataset.table); }
        else if (b.dataset.tw) { expanded[b.dataset.tw] = !expanded[b.dataset.tw]; renderLayerList(); }
        else if (b.dataset.menu) { var r = b.getBoundingClientRect(); GIS.layerMenu(b.dataset.menu, r.left, r.bottom + 4); }
        return;
      }
      if (t.dataset.vis) { var l = GIS.get(t.dataset.vis); l.visible = t.checked; GIS.emit("style"); return; }
      var row = t.closest(".gis-layer");
      if (row) GIS.setActive(row.dataset.id);
    });
    // Double-click the name: rename in place; elsewhere on the row:
    // properties (QGIS). F2 renames the active layer. Right-click: menu.
    box.addEventListener("dblclick", function (e) {
      var r = e.target.closest(".gis-layer");
      if (!r || e.target.closest("button,input")) return;
      if (e.target.closest(".gis-layer-name")) { renameInline(r.dataset.id); return; }
      GIS.layerProperties(GIS.get(r.dataset.id));
    });
    box.tabIndex = 0;
    box.addEventListener("keydown", function (e) {
      if (e.key === "F2" && GIS.active() && !e.target.closest("input")) { e.preventDefault(); renameInline(GIS.active().id); }
    });
    box.addEventListener("contextmenu", function (e) {
      var r = e.target.closest(".gis-layer");
      if (!r) return;
      e.preventDefault();
      GIS.layerMenu(r.dataset.id, e.clientX, e.clientY);
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
  var DASHES = [["solid", "Solid"], ["dash", "Dash"], ["dot", "Dot"], ["dashdot", "Dash dot"]];
  var METHODS = [["jenks", "Natural breaks (Jenks)"], ["quantile", "Quantile"], ["equal", "Equal interval"]];

  function renderStyle() {
    var box = $("gisStyle"), l = GIS.active();
    if (!box) return;
    if (!l) { box.innerHTML = '<div class="gis-empty">No layer selected</div>'; return; }
    var h = '<div class="gis-style-name">' + esc(l.name) + "</div>";
    h += field("Layer opacity", range("layerTop:opacity", l.opacity, 0, 1, 0.05));
    if (l.kind === "xyz") { box.innerHTML = h + field("Tile URL", text("layerTop:url", l.url)); return; }
    if (l.kind === "mvt") {
      h += pair(field("Fill color", color("layerTop:color", l.color)), field("Outline color", color("layerTop:outlineColor", l.outlineColor || l.color)));
      h += field("Fill opacity", range("layerTop:fillOpacity", l.fillOpacity != null ? l.fillOpacity : 0.45, 0, 1, 0.05));
      h += pair(field("Line width", num("layerTop:lineWidth", l.lineWidth != null ? l.lineWidth : 0.8, 0, 20, 0.1)), field("Line style", select("layerTop:lineDash", DASHES, l.lineDash || "solid")));
      h += field("Point size", num("layerTop:pointRadius", l.pointRadius || 4, 1, 40, 0.5));
      box.innerHTML = h + '<div class="gis-meta">Vector tiles · ' + esc(l.sourceLayer) + "</div>";
      return;
    }
    if (l.kind === "raster") {
      var r = l.raster, bands = r.bands.map(function (b, i) { return [i, "Band " + (i + 1)]; });
      h += field("Render type", select("raster:mode", [["single", "Singleband pseudocolor"]].concat(r.bands.length >= 3 ? [["rgb", "Multiband color (RGB)"]] : []), r.mode));
      if (r.mode === "rgb") {
        h += pair(field("Red", select("rasterRgb:0", bands, r.rgb[0])), field("Green", select("rasterRgb:1", bands, r.rgb[1])));
        h += field("Blue", select("rasterRgb:2", bands, r.rgb[2]));
      } else {
        h += field("Band", select("raster:band", bands, r.band));
        h += field("Color ramp", rampSelect("raster:ramp", r.ramp));
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
      h += field("Color ramp", rampSelect("layer:heatRamp", s.heatRamp));
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
        h += field("Palette", rampSelect("layer:catPalette", s.catPalette || "", "qual"));
        var cats = GIS.sym.categories(l);
        h += '<div class="gj-class-list">' + (cats.length ? cats.slice(0, 80).map(function (c, i) {
          return '<div class="gj-class-row"><input type="color" data-cat="' + i + '" value="' + c.color + '"><span title="' + esc(c.value) + '">' + esc(c.value) + "</span><em>" + c.count + "</em></div>";
        }).join("") : '<div class="gis-empty">No values</div>') + "</div>";
        h += '<button id="gisRecolor" style="width:100%;margin-top:6px;">Classify with active palette</button>';
      } else if (s.symbology === "graduated") {
        h += pair(field("Classes", num("layer:classes", s.classes, 2, 9, 1)), field("Mode", select("layer:method", METHODS, s.method)));
        h += field("Color ramp", rampSelect("layer:ramp", s.ramp));
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
    if (kind === "point") h += field("Point size", slideNum("layer:pointRadius", s.pointRadius, 1, 40, 0.5));
    if (kind === "line") h += field("Line width", slideNum("layer:lineWidth", s.lineWidth, 0.2, 20, 0.2)) + field("Line style", select("layer:lineDash", DASHES, s.lineDash));
    // Outline: one group for polygon edges, point rings and line casings.
    // Every control applies as it changes.
    h += '<div class="gis-subhead">' + (kind === "point" ? "Outline (ring)" : kind === "line" ? "Outline (casing)" : "Outline") + "</div>";
    if (kind === "line") h += check("layer:lineCasing", s.lineCasing, "Draw an outline around the line");
    if (kind !== "line" || s.lineCasing) {
      h += pair(field("Color", color("layer:strokeColor", s.strokeColor)), field("Opacity", range("layer:strokeOpacity", s.strokeOpacity != null ? s.strokeOpacity : 1, 0, 1, 0.05)));
      h += field("Width", slideNum("layer:strokeWidth", s.strokeWidth, 0, 10, 0.1));
      if (kind === "polygon") h += pair(field("Style", select("layer:strokeDash", DASHES, s.strokeDash)), field("Join", select("layer:strokeJoin", JOINS, s.strokeJoin || "round")));
      else if (kind === "line") h += field("Join", select("layer:strokeJoin", JOINS, s.strokeJoin || "round"));
      h += '<div class="gis-outline-presets">' + OUTLINE_PRESETS.map(function (p) {
        return '<button type="button" data-outline="' + p[0] + '" title="' + p[1] + '"><i style="border:' + Math.max(1, Math.min(3, p[3])) + "px solid " + p[2] + '"></i>' + p[1] + "</button>";
      }).join("") + "</div>";
    }
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
      (GIS.maps.length > 1 ? field("Map in this frame", select("map:layoutMapId", [["", "Active map (" + GIS.activeMap().name + ")"]].concat(GIS.maps.map(function (m) { return [m.id, m.name]; })), state.layoutMapId || "")) : "") +
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
        : field("Format", select("map:mapGridFormat", [["dms", "Degrees, minutes (seconds when needed)"], ["dmsfull", "D° M′ S″ (always)"], ["decimal", "Decimal degrees"]], state.mapGridFormat))) +
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
  var NORTH_STYLES = [["arrow", "Split arrow"], ["half", "Half arrow"], ["triangle", "Solid triangle"], ["line", "Line arrow"], ["circle", "Circle arrow"], ["compass4", "Compass rose (4)"], ["compass8", "Compass rose (8)"], ["star", "Star"],
    ["diamond", "Diamond"], ["needle", "Compass needle"], ["chevron", "Chevron"], ["block", "Block arrow"], ["arrowN", "Arrow over N"], ["minimal", "Minimal N"], ["compass16", "Compass rose (16)"],
    ["nautical", "Nautical rose"], ["ring", "Ring arrow"], ["disc", "Disc"], ["badge", "Badge"], ["tail", "Fletched arrow"], ["shaded", "Shaded arrow"], ["trueMag", "True and magnetic north"]];

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
      h += check("item:onlyVisible", p.onlyVisible !== false, "Only visible layers");
      if (p.boxW || p.boxH) h += '<button id="gisLegendFit" style="width:100%;margin-top:8px;">Fit to content</button>';
      h += '<div class="gis-subhead">Spacing</div>' +
        pair(field("Between rows", num("item:rowGap", p.rowGap != null ? p.rowGap : 8, 0, 60, 1)), field("Symbol width", num("item:symbolW", p.symbolW || 18, 6, 80, 1))) +
        pair(field("Symbol to label", num("item:labelGap", p.labelGap != null ? p.labelGap : 8, 0, 60, 1)), field("Between columns", num("item:colGap", p.colGap != null ? p.colGap : 16, 0, 120, 1))) +
        field("Padding", num("item:pad", p.pad != null ? p.pad : 10, 0, 60, 1));
      h += '<label class="field-label">Legend items</label><div class="gis-legend-pick">' + legendPick(p) + "</div>";
    } else if (o.gisItem === "scalebar") {
      h += field("Style", select("item:style", SCALE_STYLES, p.style)) + field("Units", select("item:units", SCALE_UNITS, p.units));
      h += pair(field("Segments", num("item:segments", p.segments, 1, 10, 1)), field("Target width (px)", num("item:width", p.width, 40, 800, 1)));
      h += pair(field("Height", num("item:height", p.height, 2, 30, 1)), field("Font size", num("item:fontSize", p.fontSize, 6, 30, 1)));
      h += pair(field("Labels", select("item:labels", [["all", "Every segment"], ["ends", "Ends only"]], p.labels)), field("Color", color("item:color", p.color)));
      h += check("item:frame", p.frame, "Background frame");
    } else if (o.gisItem === "north") {
      h += '<label class="field-label">Style</label><div class="north-grid">' + NORTH_STYLES.map(function (s) {
        return '<button type="button" data-north="' + s[0] + '" title="' + esc(s[1]) + '"' + (s[0] === p.style ? ' class="active"' : "") + ">" + (GIS.items.northSVG ? GIS.items.northSVG(s[0], p.color, p.fill2) : esc(s[1])) + "</button>";
      }).join("") + "</div>";
      h += pair(field("Size", num("item:size", p.size, 16, 300, 1)), field("Color", color("item:color", p.color)));
      h += field("Accent (light parts)", color("item:fill2", p.fill2 || "#ffffff"));
      h += check("item:label", p.label !== false, "Show the N (and E S W) letters") + check("item:followMap", p.followMap, "Follow map rotation");
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
    } else if (o.gisItem === "mapframe") {
      h += field("Map", select("item:mapId", GIS.maps.map(function (m) { return [m.id, m.name]; }), p.mapId));
      h += '<div class="gis-layer-actions" style="margin-top:8px;"><button data-mf="view" title="Show the extent of the Analysis map">' + sym("travel_explore") + 'Analysis view</button><button data-mf="fit">' + sym("fit_screen") + "Fit layers</button></div>" +
        '<div class="gis-layer-actions"><button data-mf="in">' + sym("zoom_in") + 'Zoom in</button><button data-mf="out">' + sym("zoom_out") + "Zoom out</button></div>";
      h += pair(field("Frame width", num("item:frameWidth", p.frameWidth, 0, 8, 0.5)), field("Frame color", color("item:frameColor", p.frameColor)));
    } else if (o.gisItem === "inset") {
      h += field("Basemap", select("item:basemap", GIS.BASEMAPS.map(function (b) { return [b.id, b.label]; }), p.basemap));
      h += pair(field("Zoom offset", num("item:zoomOffset", p.zoomOffset, -12, 0, 1)), field("Extent color", color("item:extentColor", p.extentColor)));
      h += field("Frame width", num("item:frameWidth", p.frameWidth, 0, 8, 0.5)) + check("item:showLayers", p.showLayers, "Show layers");
    }
    box.innerHTML = h;
  }

  // Checklist of layers, and of the classes of each listed layer.
  function legendPick(p) {
    var hidden = p.hidden || [], he = p.hiddenEntries || {};
    var rows = GIS.layers.filter(function (l) { return l.kind !== "xyz"; }).map(function (l) {
      var on = hidden.indexOf(l.id) < 0 && l.legend !== false, entries = GIS.sym.legendEntries(l);
      var h = '<label class="check-row gis-lp-layer' + (l.visible || p.onlyVisible === false ? "" : " off") + '"><input type="checkbox" data-lp-layer="' + l.id + '"' + (on ? " checked" : "") + ">" + esc(l.legendName || l.name) + "</label>";
      if (on && entries.length > 1) {
        h += '<div class="gis-lp-entries">' + entries.map(function (e) {
          var lab = String(e.label), off = (he[l.id] || []).indexOf(lab) >= 0;
          return '<label class="check-row"><input type="checkbox" data-lp-entry="' + l.id + '" data-lp-label="' + esc(lab) + '"' + (off ? "" : " checked") + ">" +
            (e.color ? '<i style="background:' + esc(e.color) + '"></i>' : "") + esc(lab) + "</label>";
        }).join("") + "</div>";
      }
      return h;
    });
    return rows.join("") || '<div class="gis-empty">No layers</div>';
  }
  function onLegendPick(el) {
    var o = selectedItem();
    if (!o || o.gisItem !== "legend") return;
    var p = o.gisOpts;
    if (el.dataset.lpLayer) {
      var id = el.dataset.lpLayer, l = GIS.get(id), hidden = (p.hidden || []).filter(function (x) { return x !== id; });
      if (!el.checked) hidden.push(id);
      else if (l && l.legend === false) { l.legend = true; GIS.emit("layers"); }
      GIS.items.update(o, { hidden: hidden });
    } else {
      var lid = el.dataset.lpEntry, lab = el.dataset.lpLabel, he = JSON.parse(JSON.stringify(p.hiddenEntries || {}));
      var list = (he[lid] || []).filter(function (x) { return x !== lab; });
      if (!el.checked) list.push(lab);
      he[lid] = list;
      GIS.items.update(o, { hiddenEntries: he });
    }
    renderItemProps();
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
    // Keep twin controls (slider + number) in step.
    document.querySelectorAll('[data-bind="' + el.dataset.bind + '"]').forEach(function (t) { if (t !== el && t.type !== "checkbox" && t.value !== el.value) t.value = el.value; });
    if (scope === "layer" && l) {
      var prevTemplate = l.style.labelTemplate;
      if (key === "field" || key === "joinField" || key === "catPalette") l.style.catColors = {};
      l.style[key] = v;
      GIS.emit("style");
      if (/^(field|joinField|classes|method|ramp|reverse|labelField|renderer|sizeField|catPalette|lineCasing)$/.test(key) || (key === "labelTemplate" && !!v !== !!prevTemplate)) renderStyle();
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
      if (key === "mapGridType" || key === "layoutMapId") renderView();
      if (typeof render === "function" && state.chartType === TYPE) render();
      if (typeof historyNotifyChange === "function") historyNotifyChange();
    } else if (scope === "item") {
      var o = selectedItem();
      if (key === "decimals") v = +v;
      if (o) { var patch = {}; patch[key] = v; GIS.items.update(o, patch); if (/^(mode|layerId)$/.test(key)) setTimeout(renderItemProps, 0); }
    }
  }

  // Delegated input handling for the panel and for its sections that the
  // GIS workspace (12-workspace.js) moves into the right dock.
  function wireRoot(panel) {
    if (!panel || panel._gisWired) return;
    panel._gisWired = true;
    panel.addEventListener("input", function (e) { if (e.target.dataset && e.target.dataset.bind && e.target.type !== "checkbox" && e.target.tagName !== "SELECT") onBind(e.target); });
    panel.addEventListener("change", function (e) {
      var t = e.target;
      if (t.dataset && t.dataset.bind && (t.type === "checkbox" || t.tagName === "SELECT")) onBind(t);
      if (t.dataset && (t.dataset.lpLayer || t.dataset.lpEntry)) onLegendPick(t);
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
      else if (b.dataset.outline && l) {
        var pr = OUTLINE_PRESETS.filter(function (p) { return p[0] === b.dataset.outline; })[0];
        l.style.strokeWidth = pr[3];
        if (pr[3] > 0) { l.style.strokeColor = pr[2]; l.style.strokeOpacity = 1; }
        GIS.emit("style"); renderStyle();
      }
      else if (b.dataset.add) { enterMapMode(); GIS.items.add(b.dataset.add); }
      else if (b.dataset.mf) { var mfo = selectedItem(); if (mfo && GIS.mapFrames) GIS.mapFrames.action(mfo, b.dataset.mf); }
      else if (b.dataset.north) { var no = selectedItem(); if (no) { GIS.items.update(no, { style: b.dataset.north }); setTimeout(renderItemProps, 0); } }
      else if (b.id === "gisLegendFit") { var lo = selectedItem(); if (lo) { GIS.items.update(lo, { boxW: 0, boxH: 0 }); setTimeout(renderItemProps, 0); } }
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
  }
  GIS.wirePanelRoot = wireRoot;

  function wireStatic() {
    wireRoot($(PANEL_ID));

    $("gisVectorFile").addEventListener("change", function () {
      var files = Array.prototype.slice.call(this.files || []);
      this.value = "";
      // Shapefile parts, KML / KMZ, GPX and zips go through PlootsFormats.
      var other = files.filter(function (f) { return /\.(shp|shx|dbf|prj|cpg|kml|kmz|gpx|zip)$/i.test(f.name); });
      files = files.filter(function (f) { return other.indexOf(f) < 0; });
      if (other.length && window.PlootsFormats) {
        setStatus("Reading " + other.length + " file" + (other.length === 1 ? "" : "s") + "…", true);
        window.PlootsFormats.read(other).then(function (layers) {
          enterMapMode();
          layers.forEach(function (x) { GIS.addVector(x.geojson, x.name); });
          setStatus(layers.map(function (x) { return x.note; }).filter(Boolean).join(" ") || "", true);
        }).catch(function (err) { setStatus(err.message, false); });
      }
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
    $("gisBasemap").addEventListener("change", function () {
      state.mapBasemap = this.value; if (state.chartType === TYPE) render(); if (GIS.refreshBasemap) GIS.refreshBasemap();
    });
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
  GIS.refreshPanel = refreshAll;

  // Switches the page's chart block to the map.
  function enterMapMode() {
    if (state.chartType !== TYPE) selectChartType(TYPE);
    document.body.classList.add("gis-mode");
  }
  GIS.enterMapMode = enterMapMode;

  GIS.on("layers", function () { renderLayerList(); renderStyle(); renderItemProps(); });
  GIS.on("style", renderLayerList);
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
