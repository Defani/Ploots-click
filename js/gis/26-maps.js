/* ==========================================================================
   GIS — several maps in one project, and map frames (like ArcGIS Pro).

   Maps       the bar at the top of the Layers tab: switch map, new map,
              duplicate (copies its layers and style), rename, delete.
              Each map keeps its own layers, basemap and last view; the
              Analysis view shows the active map.
   Frames     the page's main map frame shows the active map or a chosen
              one (Map frame panel ▸ Map in this frame). More map frames
              can be added from the Cartography toolbar ("Map frame"), each
              showing any map at its own extent: drawn off-screen at 2x
              and placed as a picture, redrawn when that map changes.
              Resizing a frame keeps its scale and shows more or less.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  function $(id) { return document.getElementById(id); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fc() { return window.fabricCanvas; }
  function toast(m) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(m); }

  /* ------------------------------------------------------- maps bar */

  var bar = null;
  function drawBar() {
    var list = $("gisLayerList");
    if (!list) return;
    if (!bar || !document.body.contains(bar)) {
      bar = document.createElement("div");
      bar.className = "gmaps-bar";
      list.parentNode.insertBefore(bar, list);
      bar.addEventListener("change", function (e) { if (e.target.matches("select")) GIS.setActiveMap(e.target.value); });
      bar.addEventListener("click", function (e) {
        var b = e.target.closest("[data-m]");
        if (!b) return;
        var cur = GIS.activeMap();
        if (b.dataset.m === "new") {
          var n = window.prompt("Name of the new map", "Map " + (GIS.maps.length + 1));
          if (n == null) return;
          GIS.setActiveMap(GIS.addMap(n.trim() || "Map " + (GIS.maps.length + 1)).id);
        } else if (b.dataset.m === "dup") {
          GIS.setActiveMap(GIS.addMap(cur.name + " (copy)", cur).id);
        } else if (b.dataset.m === "ren") {
          var r = window.prompt("Rename map", cur.name);
          if (r && r.trim()) GIS.renameMap(cur.id, r.trim());
        } else if (b.dataset.m === "del") {
          if (GIS.maps.length < 2) { toast("A project keeps at least one map."); return; }
          if (!window.confirm("Delete the map \"" + cur.name + "\" and its " + cur.layers.length + " layer(s)?")) return;
          GIS.removeMap(cur.id);
        }
      });
    }
    var act = GIS.activeMap();
    bar.innerHTML = sym("map") +
      '<select title="Active map">' + GIS.maps.map(function (m) { return '<option value="' + m.id + '"' + (m === act ? " selected" : "") + ">" + esc(m.name) + " (" + m.layers.length + ")</option>"; }).join("") + "</select>" +
      '<button type="button" data-m="new" title="New map">' + sym("add") + "</button>" +
      '<button type="button" data-m="dup" title="Duplicate this map (layers and styles)">' + sym("content_copy") + "</button>" +
      '<button type="button" data-m="ren" title="Rename this map">' + sym("edit") + "</button>" +
      '<button type="button" data-m="del" title="Delete this map"' + (GIS.maps.length < 2 ? " disabled" : "") + ">" + sym("delete") + "</button>";
  }
  GIS.on("maps", function () { drawBar(); if (GIS.refreshPanel) GIS.refreshPanel(); if (typeof render === "function" && state.chartType === GIS.TYPE) render(); });
  GIS.on("layers", drawBar);

  /* ----------------------------------------------------- map frames */

  var DEF = { mapId: null, w: 320, h: 220, center: null, zoom: null, bearing: 0, frameWidth: 1, frameColor: "#1a1a1a" };
  function frames() { return fc() ? fc().getObjects().filter(function (o) { return o.gisItem === "mapframe"; }) : []; }
  function nameOf(o) { var m = GIS.mapById(o.gisOpts.mapId); return "Map frame — " + (m ? m.name : "missing map"); }

  function add(mapId) {
    var c = fc(), m = GIS.mapById(mapId);
    if (!c || !m) return null;
    var o = Object.assign({}, DEF, { mapId: mapId });
    if (m === GIS.activeMap() && GIS.analysis && GIS.analysis.map()) { var am = GIS.analysis.map(), cc = am.getCenter(); o.center = [cc.lng, cc.lat]; o.zoom = am.getZoom() - 1; }
    else if (m.view) { o.center = m.view.center; o.zoom = m.view.zoom - 1; }
    var b = state.chartBox;
    var img = new fabric.Image(document.createElement("canvas"), { left: b.x + 20, top: b.y + 20, width: o.w * 2, height: o.h * 2, scaleX: 0.5, scaleY: 0.5 });
    img.gisItem = "mapframe";
    img.gisOpts = o;
    img.layerName = nameOf(img);
    c.add(img);
    c.setActiveObject(img);
    rebuild(img);
    if (typeof historyNotifyChange === "function") historyNotifyChange();
    return img;
  }

  var busy = new WeakMap();
  function rebuild(obj) {
    var o = obj.gisOpts;
    if (o.mapId !== o._lastMap) { if (o._lastMap) { o.center = null; o.zoom = null; } o._lastMap = o.mapId; }
    obj.layerName = nameOf(obj);
    var token = {};
    busy.set(obj, token);
    return GIS.renderMapImage(o.mapId, { w: o.w, h: o.h, center: o.center, zoom: o.zoom, bearing: o.bearing }).then(function (url) {
      if (!url || busy.get(obj) !== token || fc().getObjects().indexOf(obj) < 0) return;
      var prev = window.historyRestoring;
      window.historyRestoring = true;
      obj.setSrc(url, function () {
        obj.set({ width: o.w * 2, height: o.h * 2, scaleX: 0.5, scaleY: 0.5, stroke: o.frameWidth > 0 ? o.frameColor : null, strokeWidth: o.frameWidth > 0 ? o.frameWidth * 2 : 0, strokeUniform: false });
        obj.setCoords();
        fc().requestRenderAll();
        window.historyRestoring = prev;
      });
    });
  }

  function action(obj, a) {
    var o = obj.gisOpts;
    if (a === "view") {
      var am = GIS.analysis && GIS.analysis.map();
      if (!am) { toast("Open the Analysis view once to set its extent."); return; }
      var c = am.getCenter();
      o.center = [c.lng, c.lat];
      // The frame is smaller than the Analysis map: keep what it shows.
      o.zoom = am.getZoom() + Math.log2(Math.min(o.w / am.getCanvas().clientWidth, o.h / am.getCanvas().clientHeight));
      o.bearing = am.getBearing();
    } else if (a === "fit") { o.center = null; o.zoom = null; }
    else if (a === "in" || a === "out") {
      if (o.zoom == null) { toast("Use \"Analysis view\" first, or zoom after the frame is drawn."); return; }
      o.zoom += a === "in" ? 0.5 : -0.5;
    }
    rebuild(obj);
    if (typeof historyNotifyChange === "function") historyNotifyChange();
  }

  // Redraw frames when their map changes (the active map emits the events).
  var pend = 0;
  GIS.on("*", function (arg, evt) {
    if (evt === "selection" || evt === "interactive" || evt === "active") return;
    clearTimeout(pend);
    pend = setTimeout(function () {
      frames().forEach(function (f) { if (evt === "maps" || f.gisOpts.mapId === GIS.activeMapId) rebuild(f); });
    }, 350);
  });

  // Resizing keeps the scale: the frame shows more (or less) of the map.
  function wireCanvas() {
    var c = fc();
    if (!c || c._mfWired) return;
    c._mfWired = true;
    c.on("object:modified", function (e) {
      var obj = e.target;
      if (!obj || obj.gisItem !== "mapframe") return;
      var w = obj.width * obj.scaleX, h = obj.height * obj.scaleY;
      if (Math.abs(w - obj.gisOpts.w) < 1 && Math.abs(h - obj.gisOpts.h) < 1) return;
      obj.gisOpts.w = Math.round(w); obj.gisOpts.h = Math.round(h);
      rebuild(obj);
    });
  }
  document.addEventListener("ploots:canvasready", wireCanvas);
  setTimeout(wireCanvas, 500);

  // Cartography toolbar: "Map frame" with the list of maps.
  function addToolbarButton() {
    var grp = document.querySelector(".carto-bar .carto-grp:nth-child(2)");
    if (!grp || grp.querySelector('[data-act="mapframe"]')) return;
    var b = document.createElement("button");
    b.type = "button";
    b.dataset.act = "mapframe";
    b.title = "Add a map frame (any map of the project)";
    b.innerHTML = sym("add_photo_alternate");
    grp.insertBefore(b, grp.firstChild);
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      var old = document.querySelector(".gmaps-menu");
      if (old) { old.remove(); return; }
      var m = document.createElement("div");
      m.className = "gis-ctx open gmaps-menu";
      m.innerHTML = '<div class="gis-ctx-head">Add a map frame showing</div>' + GIS.maps.map(function (x) { return '<button type="button" data-id="' + x.id + '">' + sym("map") + "<span>" + esc(x.name) + " · " + x.layers.length + " layer(s)</span></button>"; }).join("") +
        '<div class="gis-ctx-sep"></div><button type="button" data-id="__new">' + sym("add") + "<span>New map…</span></button>";
      document.body.appendChild(m);
      var r = b.getBoundingClientRect();
      m.style.left = r.left + "px"; m.style.top = r.bottom + 6 + "px";
      m.addEventListener("click", function (ev) {
        var t = ev.target.closest("[data-id]");
        if (!t) return;
        m.remove();
        if (t.dataset.id === "__new") { var n = window.prompt("Name of the new map", "Map " + (GIS.maps.length + 1)); if (!n) return; var nm = GIS.addMap(n.trim()); toast(nm.name + " created: add layers to it in Analysis (switch map in the Layers tab)."); add(nm.id); return; }
        add(t.dataset.id);
      });
      setTimeout(function () { document.addEventListener("mousedown", function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener("mousedown", off, true); } }, true); }, 0);
    });
  }

  function boot() { drawBar(); addToolbarButton(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 150); }); else setTimeout(boot, 150);

  GIS.mapFrames = { add: add, rebuild: rebuild, action: action, all: frames };
})();
