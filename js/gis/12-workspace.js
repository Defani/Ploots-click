/* ==========================================================================
   GIS workspace — Analysis and Cartography, like QGIS's map canvas and
   print layout.

   Analysis     the map fills the workspace (always live: pan, select,
                identify, measure), with a status bar (coordinates under the
                cursor, scale, zoom, CRS, layers). The rail shows the GIS
                panels: Files (browser), Layers, Styling, Processing,
                Catalog, Kobo, Plugins.
   Cartography  the page with the map frame, legend, scale bar and the
                other page items; the rail adds Map frame, Canvas, Design,
                Objects, Shapes, LaTeX and Export.

   In the map workspace no chart menus are shown. The choice is in the top
   bar (Analysis | Cartography) and remembered. Adding a page item (text,
   shape, image) from Analysis switches to Cartography.

   The Layers and Styling panels are the Map panel's own sections, moved
   into panels of their own, so all their controls keep working. Layers
   and Layer styling are tabs of one dock on the right (like QGIS), so
   they stay in view while the left panels (Files, Catalog, Kobo...) are
   in use, without taking two columns.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var KEY = "ploots-gis-view";
  var view = "analysis";
  try { view = localStorage.getItem(KEY) || "analysis"; } catch (e) { }

  function $(id) { return document.getElementById(id); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function isGis() { return document.body.classList.contains("gis-mode"); }

  /* ------------------------------------------------------------- panes */

  var pane = null, host = null, status = null;
  function buildPane() {
    if (pane) return;
    var layout = $("paneLayout");
    pane = document.createElement("div");
    pane.className = "view-pane gisw";
    pane.id = "paneGis";
    pane.innerHTML =
      '<div class="gisw-map" id="gisAnalysisHost"></div>' +
      '<div class="gisw-status" id="gisStatusBar">' +
        '<span data-s="coord" title="Coordinates under the cursor (WGS 84)">' + sym("my_location") + "<b>—</b></span>" +
        '<span data-s="scale" title="Scale on screen">' + sym("straighten") + "<b>—</b></span>" +
        '<span data-s="zoom" title="Zoom level">' + sym("zoom_in") + "<b>—</b></span>" +
        '<span data-s="rot" title="Rotation">' + sym("explore") + "<b>0°</b></span>" +
        '<span data-s="crs" title="Coordinate reference system">' + sym("public") + "<b>EPSG:4326</b></span>" +
        '<span data-s="layers">' + sym("layers") + "<b>0 layers</b></span>" +
        '<span class="gisw-grow"></span>' +
        '<button type="button" data-a="to-layout" title="Use this extent for the layout map">' + sym("move_down") + "Extent to layout</button>" +
        '<button type="button" data-a="from-layout" title="Show the layout map\'s extent here">' + sym("move_up") + "From layout</button>" +
      "</div>";
    layout.parentNode.insertBefore(pane, layout.nextSibling);
    host = $("gisAnalysisHost");
    status = $("gisStatusBar");
    // The map follows its box (panels and the dock open and close).
    if (window.ResizeObserver) {
      var rq = 0;
      new ResizeObserver(function () {
        cancelAnimationFrame(rq);
        rq = requestAnimationFrame(function () { if (GIS.analysis && GIS.analysis.resize) GIS.analysis.resize(); });
      }).observe(host);
    }
    status.addEventListener("click", function (e) {
      var b = e.target.closest("[data-a]");
      if (!b) return;
      if (b.dataset.a === "to-layout") { GIS.analysis.toLayout(); toast("Layout map set to this extent"); }
      else GIS.analysis.fromLayout();
    });
  }

  function fmtCoord(ll) {
    function dms(v, p, n) { var a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60; return d + "°" + String(m).padStart(2, "0") + "′" + s.toFixed(1).padStart(4, "0") + "″" + (v >= 0 ? p : n); }
    return ll.lat.toFixed(5) + ", " + ll.lng.toFixed(5) + "  ·  " + dms(ll.lat, "N", "S") + " " + dms(ll.lng, "E", "W");
  }
  function screenScale(map) {
    var c = map.getContainer(), y = c.clientHeight / 2, x = c.clientWidth / 2;
    var a = map.unproject([x - 50, y]), b = map.unproject([x + 50, y]);
    var mpp = d3.geoDistance([a.lng, a.lat], [b.lng, b.lat]) * 6371008.8 / 100;
    return mpp / (0.0254 / 96);
  }
  function niceScale(n) { if (!isFinite(n) || n <= 0) return "—"; var p = Math.pow(10, Math.floor(Math.log10(n)) - 1); return "1:" + (Math.round(n / p) * p).toLocaleString("en-US"); }
  function setStatus(k, v) { var el = status && status.querySelector('[data-s="' + k + '"] b'); if (el) el.textContent = v; }
  function refreshStatus() {
    var map = GIS.analysis.map();
    if (!map || !status) return;
    setStatus("scale", niceScale(screenScale(map)));
    setStatus("zoom", map.getZoom().toFixed(2));
    setStatus("rot", Math.round(-map.getBearing()) + "°");
    var n = GIS.layers.length, feats = GIS.layers.reduce(function (s, l) { return s + (l.data ? l.data.features.length : 0); }, 0);
    setStatus("layers", n + " layer" + (n === 1 ? "" : "s") + (feats ? " · " + feats.toLocaleString("en-US") + " features" : ""));
  }

  var wired = false;
  function mountMap() {
    buildPane();
    return GIS.analysis.mount(host).then(function (v) {
      if (!wired || v.map !== wiredMap) {
        wired = true; wiredMap = v.map;
        v.map.on("mousemove", function (e) { setStatus("coord", fmtCoord(e.lngLat)); });
        v.map.on("mouseout", function () { setStatus("coord", "—"); });
        v.map.on("move", refreshStatus);
        v.map.on("load", refreshStatus);
      }
      setTimeout(function () { GIS.analysis.resize(); refreshStatus(); }, 30);
    });
  }
  var wiredMap = null;

  /* -------------------------------------------------------- view switch */

  var seg = null;
  function buildSeg() {
    if (seg) return;
    var bar = $("mainTools");
    seg = document.createElement("div");
    seg.className = "tool-group gisw-seg";
    seg.innerHTML = '<button type="button" data-v="analysis" title="Analysis: the map, layers, styling and processing">' + sym("travel_explore") + "<span>Analysis</span></button>" +
      '<button type="button" data-v="cartography" title="Cartography: the page layout for printing and export">' + sym("print") + "<span>Cartography</span></button>";
    bar.insertBefore(seg, bar.firstChild);
    seg.addEventListener("click", function (e) { var b = e.target.closest("[data-v]"); if (b) setGisView(b.dataset.v); });
  }

  var baseSetView = null;
  function showPane(analysis) {
    var layout = $("paneLayout"), data = $("paneData");
    if (analysis) {
      if (data) data.classList.remove("active");
      if (layout) layout.classList.remove("active");
      pane.classList.add("active");
    } else {
      pane.classList.remove("active");
      if (baseSetView) baseSetView("layout");
    }
  }

  function setGisView(v) {
    view = v === "cartography" ? "cartography" : "analysis";
    try { localStorage.setItem(KEY, view); } catch (e) { }
    apply();
  }
  GIS.setWorkspaceView = setGisView;
  GIS.workspaceView = function () { return isGis() ? view : null; };

  function apply() {
    buildPane(); buildSeg(); buildPanels();
    var gis = isGis(), analysis = gis && view === "analysis";
    document.body.classList.toggle("gis-analysis", analysis);
    document.body.classList.toggle("gis-carto", gis && !analysis);
    Array.prototype.forEach.call(seg.querySelectorAll("[data-v]"), function (b) { b.classList.toggle("active", b.dataset.v === view); });
    // The page's Layers panel lists page objects; in the map workspace it is "Objects".
    var nl = document.querySelector("#navLayers .nav-lbl");
    if (nl) nl.textContent = gis ? "Objects" : "Layers";
    if (!gis) { if (pane.classList.contains("active")) showPane(false); return; }
    // A panel that belongs to the other view closes.
    var open = document.querySelector(".nav-btn.active[data-panel]");
    if (open && getComputedStyle(open).display === "none" && window.closeSidebar) window.closeSidebar();
    if (analysis) { if (GIS.mapActions) GIS.mapActions.setInteractive(false); showPane(true); mountMap(); }
    else { showPane(false); if (typeof render === "function") render(); }
  }

  // Page tools used from Analysis switch to Cartography.
  function hookSetView() {
    if (baseSetView || typeof window.setView !== "function") return;
    baseSetView = window.setView;
    window.setView = function (t) {
      if (document.body.classList.contains("gis-analysis") && t === "layout") { setGisView("cartography"); return; }
      if (t === "data" && pane) pane.classList.remove("active");
      return baseSetView.apply(this, arguments);
    };
  }

  /* ------------------------------------------------------------ panels */
  // Layers and Styling as panels of their own (sections moved out of the
  // Map panel, which keeps the cartography settings as "Map frame").

  var panelsBuilt = false;
  function railButton(panelId, icon, label, cls, before) {
    var nav = document.querySelector(".sidebar-nav"), b = document.createElement("button");
    b.className = "nav-btn " + cls;
    b.setAttribute("data-panel", panelId);
    b.title = label;
    b.innerHTML = sym(icon) + '<span class="nav-lbl">' + label + "</span>";
    if (before) before.before(b); else nav.appendChild(b);
    b.addEventListener("click", function () { if (b.classList.contains("active")) window.closeSidebar(); else activateSidebarPanel(panelId); });
    return b;
  }
  function moveSection(sectionId, target) {
    var s = document.querySelector('#panel-map [data-section="' + sectionId + '"]');
    if (!s) return false;
    s.classList.add("open");
    target.appendChild(s);
    return true;
  }
  /* Right dock with tabs, like QGIS's tabbed docks: Layers and Layer
     styling share one column and the tabs switch between them. The dock is
     resized from its left edge and can be hidden to a thin strip. */
  var DOCK_KEY = "ploots-gis-dock", dock = null, tabs = {}, railBtns = {};
  var DOCK_TABS = [["layers", "Layers", "layers"], ["style", "Layer styling", "palette"]];
  var dockState = { open: true, tab: "layers", width: 300 };
  try {
    var ds = JSON.parse(localStorage.getItem(DOCK_KEY) || "null");
    if (ds && ds.tab) dockState = { open: ds.open !== false, tab: ds.tab === "style" ? "style" : "layers", width: +ds.width || 300 };
  } catch (e) { }
  function saveDock() { try { localStorage.setItem(DOCK_KEY, JSON.stringify(dockState)); } catch (e) { } }
  function resized() {
    if (typeof onCanvasSizeChanged === "function") setTimeout(onCanvasSizeChanged, 50);
    if (GIS.analysis && GIS.analysis.resize) setTimeout(GIS.analysis.resize, 60);
  }
  function syncDock() {
    dock.classList.toggle("collapsed", !dockState.open);
    dock.style.width = dockState.open ? dockState.width + "px" : "";
    DOCK_TABS.forEach(function (d) {
      var k = d[0], on = k === dockState.tab;
      tabs[k].btn.classList.toggle("active", on);
      tabs[k].body.hidden = !on;
      if (railBtns[k]) railBtns[k].classList.toggle("active", dockState.open && on);
    });
  }
  // Show a tab; asking again for the tab already shown hides the dock.
  function showTab(k, toggle) {
    var was = dockState.open;
    if (toggle && dockState.open && dockState.tab === k) dockState.open = false;
    else { dockState.open = true; dockState.tab = k; }
    saveDock(); syncDock();
    if (was !== dockState.open) resized();
  }
  function hideDock() { dockState.open = false; saveDock(); syncDock(); resized(); }
  function buildDock() {
    dock = document.createElement("aside");
    dock.className = "gisw-dock";
    dock.id = "gisDock";
    dock.innerHTML =
      '<div class="gisw-dock-grip" title="Drag to resize"></div>' +
      '<div class="gisw-dock-strip">' + DOCK_TABS.map(function (d) {
        return '<button type="button" data-tab="' + d[0] + '" title="Show ' + d[1] + '">' + sym(d[2]) + "<span>" + d[1] + "</span></button>";
      }).join("") + "</div>" +
      '<div class="gisw-dock-tabs" role="tablist">' + DOCK_TABS.map(function (d) {
        return '<button type="button" role="tab" data-tab="' + d[0] + '">' + sym(d[2]) + "<span>" + d[1] + "</span></button>";
      }).join("") +
        '<button type="button" class="gisw-dock-hide" title="Hide the dock">' + sym("keyboard_double_arrow_right") + "</button></div>" +
      DOCK_TABS.map(function (d) { return '<div class="gisw-dock-body" data-body="' + d[0] + '"></div>'; }).join("");
    DOCK_TABS.forEach(function (d) {
      tabs[d[0]] = { btn: dock.querySelector('.gisw-dock-tabs [data-tab="' + d[0] + '"]'), body: dock.querySelector('[data-body="' + d[0] + '"]') };
    });
    dock.addEventListener("click", function (e) {
      if (e.target.closest(".gisw-dock-hide")) { hideDock(); return; }
      var b = e.target.closest(".gisw-dock-tabs [data-tab], .gisw-dock-strip [data-tab]");
      if (b) showTab(b.dataset.tab);
    });
    var grip = dock.querySelector(".gisw-dock-grip");
    grip.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      var x0 = e.clientX, w0 = dock.offsetWidth;
      document.body.classList.add("gisw-resizing");
      function move(ev) {
        dockState.width = Math.max(240, Math.min(600, w0 + (x0 - ev.clientX)));
        dock.style.width = dockState.width + "px";
        if (GIS.analysis && GIS.analysis.resize) GIS.analysis.resize();
      }
      function up() {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        document.body.classList.remove("gisw-resizing");
        saveDock(); resized();
      }
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
    });
    document.querySelector(".app").appendChild(dock);
  }
  function dockRailButton(k, icon, label, before) {
    var b = document.createElement("button");
    b.className = "nav-btn nav-gis nav-dock";
    b.title = label + " (right dock)";
    b.innerHTML = sym(icon) + '<span class="nav-lbl">' + label + "</span>";
    if (before) before.before(b); else document.querySelector(".sidebar-nav").appendChild(b);
    b.addEventListener("click", function () { showTab(k, true); });
    railBtns[k] = b;
  }

  function buildPanels() {
    if (panelsBuilt || !$("panel-map")) return;
    panelsBuilt = true;
    var nav = document.querySelector(".sidebar-nav");
    var mapBtn = nav.querySelector('[data-panel="panel-map"]');
    buildDock();
    var layers = tabs.layers.body, style = tabs.style.body;
    moveSection("gisLayers", layers);
    moveSection("gisStyle", style);
    // Add data: one small rail button per source, like QGIS's Manage
    // Layers toolbar. Files open the file dialog straight away; XYZ and URL
    // open their form in a popover beside the rail. The Layers tab keeps
    // only the layer list (the basemap is in the top bar's Basemap menu).
    var lsec = $("gisLayers"), keep = {};
    Array.prototype.forEach.call(lsec.querySelectorAll(".gis-layer-actions button"), function (btn) { keep[btn.id || btn.querySelector("input").id] = btn; });
    var hold = document.createElement("div");
    hold.className = "gisw-hold";
    hold.hidden = true;
    Array.prototype.forEach.call(lsec.querySelectorAll(".gis-layer-actions"), function (a) {
      Array.prototype.slice.call(a.children).forEach(function (c) { hold.appendChild(c); });
      a.remove();
    });
    document.body.appendChild(hold);
    var pop = document.createElement("div");
    pop.className = "gisw-addpop";
    pop.hidden = true;
    ["gisXyzWrap", "gisUrlWrap"].forEach(function (id) { var w = $(id); if (w) { pop.appendChild(w); w.style.display = "none"; } });
    document.body.appendChild(pop);
    if (GIS.wirePanelRoot) GIS.wirePanelRoot(pop);
    var sec = $("gisBasemapSec");
    if (sec && sec.closest(".side-section")) sec.closest(".side-section").hidden = true;
    function closePop() { pop.hidden = true; railAdd.forEach(function (x) { x.classList.remove("active"); }); }
    function openPop(kind, btn) {
      if (!pop.hidden && pop.dataset.kind === kind) { closePop(); return; }
      pop.dataset.kind = kind;
      $("gisXyzWrap").style.display = kind === "xyz" ? "" : "none";
      $("gisUrlWrap").style.display = kind === "url" ? "" : "none";
      pop.hidden = false;
      railAdd.forEach(function (x) { x.classList.toggle("active", x === btn); });
      var r = btn.getBoundingClientRect();
      pop.style.left = r.right + 8 + "px";
      pop.style.top = Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, r.top)) + "px";
      var f = pop.querySelector(kind === "xyz" ? "#gisXyzUrl" : "#gisUrlText");
      if (f) f.focus();
    }
    GIS.openAddForm = function (kind) {
      if (GIS.enterMapMode) GIS.enterMapMode();
      var btn = railAdd.filter(function (x) { return x.dataset.add === kind; })[0];
      if (btn) openPop(kind, btn);
    };
    document.addEventListener("mousedown", function (e) { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest(".nav-add")) closePop(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !pop.hidden) closePop(); });
    // Loading from the URL / XYZ form closes the popover.
    ["gisUrlLoad", "gisXyzAdd"].forEach(function (id) { var x = $(id); if (x) x.addEventListener("click", function () { setTimeout(closePop, 0); }); });
    var ADD = [["vector", "polyline", "Vector", "Add a vector layer (GeoJSON, Shapefile, KML/KMZ, GPX, TopoJSON)"],
      ["raster", "grid_on", "Raster", "Add a raster layer (GeoTIFF)"],
      ["xyz", "travel_explore", "XYZ", "Add an XYZ tile layer"],
      ["url", "link", "URL", "Add a layer from a URL or pasted GeoJSON"],
      ["sample", "public", "Sample", "Add the sample layer"]];
    var anchor = nav.querySelector('[data-panel="panel-files"]');
    anchor = anchor ? anchor.nextSibling : mapBtn;
    var head = document.createElement("div");
    head.className = "nav-gis nav-add-sep";
    head.textContent = "Add";
    anchor.before(head);
    var railAdd = ADD.map(function (d) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "nav-btn nav-gis nav-add";
      b.dataset.add = d[0];
      b.title = d[3];
      b.innerHTML = sym(d[1]) + '<span class="nav-lbl">' + d[2] + "</span>";
      anchor.before(b);
      b.addEventListener("click", function () {
        if (d[0] === "vector" || d[0] === "raster") { closePop(); $(d[0] === "vector" ? "gisVectorFile" : "gisRasterFile").click(); }
        else if (d[0] === "sample") { closePop(); if (keep.gisSampleBtn) keep.gisSampleBtn.click(); }
        else openPop(d[0], b);
      });
      return b;
    });
    var tail = document.createElement("div");
    tail.className = "nav-gis nav-add-sep";
    anchor.before(tail);
    // The moved sections keep the Map panel's input handling.
    if (GIS.wirePanelRoot) { GIS.wirePanelRoot(layers); GIS.wirePanelRoot(style); }
    dockRailButton("layers", "layers", "Layers", mapBtn);
    dockRailButton("style", "palette", "Styling", mapBtn);
    syncDock();
    // The Map panel keeps view, grid, frame and layout items: the map frame.
    if (mapBtn) {
      mapBtn.classList.add("nav-carto");
      var lbl = mapBtn.querySelector(".nav-lbl");
      if (lbl) lbl.textContent = "Map frame";
      mapBtn.title = "Map frame: view, grid, frame and layout items";
      var t = document.querySelector("#panel-map .sp-title");
      if (t) t.textContent = "Map frame";
    }
    // Processing (js/gis/13-processing.js) adds its own button next to these.
    if (GIS.processing && GIS.processing.build) GIS.processing.build(mapBtn);
  }
  // Panels that used to open "panel-map" for layers or styling now open these.
  // From Layout view the layer list and styling are in Data view (the layout's own Items tab lists the layers too).
  GIS.openLayersPanel = function () { if (GIS.enterMapMode) GIS.enterMapMode(); if (view !== "analysis") setGisView("analysis"); buildPanels(); showTab("layers"); };
  GIS.openStylingPanel = function () { if (GIS.enterMapMode) GIS.enterMapMode(); if (view !== "analysis") setGisView("analysis"); buildPanels(); showTab("style"); };

  function toast(m) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(m); }

  /* -------------------------------------------------------------- boot */

  // In Layout view the left sidebar is hidden (QGIS's layout window has no
  // data panels). A menu that opens one of them from there (Add layer, Data
  // catalog, GFW, Kobo…) goes to Data view first, so the panel is never
  // opened out of sight; the layout's own panels show in the right dock.
  function hookPanels() {
    if (window._gcsPanelHook || typeof window.activateSidebarPanel !== "function") return;
    window._gcsPanelHook = true;
    var base = window.activateSidebarPanel;
    window.activateSidebarPanel = function (id) {
      if (document.body.classList.contains("gis-carto")) {
        var el = document.getElementById(id), dockPane = el && el.closest("#cartoDock .cd-pane");
        if (dockPane) { var t = document.querySelector('#cartoDock .cd-tabs [data-t="' + dockPane.dataset.t + '"]'); if (t) t.click(); return; }
        setGisView("analysis");
      }
      return base.apply(this, arguments);
    };
  }

  function boot() {
    buildPane(); buildSeg(); buildPanels(); hookSetView(); hookPanels();
    // Follow the map workspace switching on and off.
    new MutationObserver(function () {
      var gis = isGis();
      if (gis !== lastGis) { lastGis = gis; apply(); }
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    var lastGis = isGis();
    if (lastGis) apply();
    GIS.on("layers", refreshStatus);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 0); }); else setTimeout(boot, 0);
})();
