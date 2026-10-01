/* ==========================================================================
   GIS — project files (.gcsproj), like a QGIS .qgz or an ArcGIS .aprx.

   One JSON file holds the whole studio, so a map and its layouts are opened
   again instead of rebuilt:
     maps      every map of the project with its layers (vector data,
               raster bands, tile URLs), symbology, labels, basemap and view
     layout    the page (paper size), the map frame and every layout item:
               titles, boxes, legend, scale bar, north arrow, insets, extra
               map frames, grid settings
     chart     the chart settings and the Data View table
   Raster layers keep their bands (base64), so they can be restyled after
   opening. Nothing is uploaded: the file is saved where the user chooses.

   Save (Ctrl+S) writes back to the same file when it was opened or saved
   with the file picker; Save as… asks for a name. Open (Ctrl+O), the Files
   panel (double-click a .gcsproj) and Home › Map › Open project load one.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var FORMAT = "gcsproj", VERSION = 1, EXT = ".gcsproj";
  var handle = null, projName = "Untitled project";
  function $(id) { return document.getElementById(id); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function toast(m) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(m); }

  /* ------------------------------------------------------------- pack */

  function b64(u8) {
    var s = "", CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(s), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  var TYPED = { Int8Array: Int8Array, Uint8Array: Uint8Array, Uint8ClampedArray: Uint8ClampedArray, Int16Array: Int16Array, Uint16Array: Uint16Array,
    Int32Array: Int32Array, Uint32Array: Uint32Array, Float32Array: Float32Array, Float64Array: Float64Array };
  // Layer -> plain JSON (runtime-only fields, functions and selections dropped).
  function packLayer(l) {
    var out = JSON.parse(JSON.stringify(l, function (k, v) {
      if (k === "selection" || k === "bands" || (k && k.charAt(0) === "_")) return undefined;
      if (typeof v === "function") return undefined;
      if (v instanceof Set) return [];
      return v;
    }));
    if (l.kind === "raster" && l.raster && l.raster.bands) {
      out.raster.bands = l.raster.bands.map(function (b) {
        return { type: b.constructor && b.constructor.name || "Float32Array", data: b64(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)) };
      });
    }
    return out;
  }
  function unpackLayer(p) {
    var l = JSON.parse(JSON.stringify(p));
    if (l.kind === "vector") { l.selection = new Set(); GIS.ensureStyle(l); }
    if (l.kind === "raster" && l.raster && l.raster.bands) {
      l.raster.bands = p.raster.bands.map(function (b) { var u = unb64(b.data), C = TYPED[b.type] || Float32Array; return new C(u.buffer, 0, u.byteLength / C.BYTES_PER_ELEMENT); });
    }
    return l;
  }

  function snapshot() {
    var am = GIS.activeMap();
    if (am) am.basemap = state.mapBasemap;
    var an = GIS.analysis && GIS.analysis.map && GIS.analysis.map(), aview = null;
    if (an) { var c = an.getCenter(); aview = { center: [c.lng, c.lat], zoom: an.getZoom(), bearing: an.getBearing(), pitch: an.getPitch() }; if (am) am.view = aview; }
    var hs = typeof historySnapshot === "function" ? historySnapshot() : { chart: {}, dv: null, layout: null };
    return {
      format: FORMAT, version: VERSION, app: "GIS Consultant Studio " + (window.PLOOTS_VERSION || ""),
      name: projName, saved: new Date().toISOString(),
      workspace: GIS.workspaceView ? GIS.workspaceView() : null,
      gisMode: document.body.classList.contains("gis-mode"),
      page: [state.canvasWidthPx, state.canvasHeightPx],
      state: hs.chart, dv: hs.dv, layout: hs.layout,
      maps: GIS.maps.map(function (m) {
        return { id: m.id, name: m.name, basemap: GIS.mapBasemap(m), activeId: m.activeId, view: m === am ? aview : m.view, layers: m.layers.map(packLayer) };
      }),
      activeMapId: GIS.activeMapId
    };
  }

  /* ----------------------------------------------------------- restore */

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function restore(p) {
    if (!p || p.format !== FORMAT) throw new Error("This is not a GIS Consultant Studio project.");
    GIS.restoring = true;
    projName = p.name || projName;
    // Maps and layers
    GIS.maps.splice(0, GIS.maps.length);
    var maxL = 0, maxM = 0;
    (p.maps || []).forEach(function (m) {
      var layers = (m.layers || []).map(unpackLayer);
      layers.forEach(function (l) { var n = parseInt(String(l.id).replace(/\D/g, ""), 10); if (n > maxL) maxL = n; });
      var n2 = parseInt(String(m.id).replace(/\D/g, ""), 10); if (n2 > maxM) maxM = n2;
      GIS.maps.push({ id: m.id, name: m.name, basemap: m.basemap, activeId: m.activeId, view: m.view, layers: layers });
    });
    if (!GIS.maps.length) GIS.maps.push({ id: "M1", name: "Map 1", basemap: state.mapBasemap, activeId: null, view: null, layers: [] });
    if (GIS.reserveIds) GIS.reserveIds(maxL, maxM);
    GIS.activeMapId = GIS.mapById(p.activeMapId) ? p.activeMapId : GIS.maps[0].id;
    var act = GIS.activeMap();
    GIS.layers = act.layers;
    GIS.activeId = act.activeId || (act.layers[0] && act.layers[0].id) || null;

    if (p.gisMode !== false) GIS.enterMapMode();
    // Page size first, so the layout lands where it was.
    var MM = GIS.cartography && GIS.cartography.MM;
    if (p.page && MM && GIS.cartography.setPage) GIS.cartography.setPage(p.page[0] / MM, p.page[1] / MM);
    var allLayers = [];
    GIS.maps.forEach(function (m) { allLayers = allLayers.concat(m.layers); });
    return Promise.resolve(GIS.native ? GIS.native.reopen(allLayers) : null).then(function () { return wait(150); }).then(function () {
      return new Promise(function (res) {
        if (typeof historyApply !== "function") { Object.assign(state, p.state || {}); res(); return; }
        historyApply({ chart: p.state || {}, dv: p.dv || { header: [], rows: [], roles: [], shape: "wide" }, layout: p.layout });
        // historyApply rebuilds the page asynchronously (fabric loadFromJSON).
        (function until(n) { if (!window.historyRestoring || n > 60) res(); else setTimeout(function () { until(n + 1); }, 50); })(0);
      });
    }).then(function () {
      state.mapBasemap = act.basemap || state.mapBasemap;
      GIS.emit("maps", act); GIS.emit("layers"); GIS.emit("style");
      if (GIS.refreshBasemap) GIS.refreshBasemap();
      if (p.workspace && GIS.setWorkspaceView) GIS.setWorkspaceView(p.workspace);
      return wait(700);
    }).then(function () {
      if (GIS.applyViews) GIS.applyViews(act.view);
      GIS.restoring = false;
      // Layout items come back as plain groups: draw them again (insets, map frames).
      if (GIS.items) GIS.items.all().forEach(function (o) { try { GIS.items.rebuild(o); } catch (e) { } });
      if (GIS.mapFrames) GIS.mapFrames.all().forEach(function (o) { try { GIS.mapFrames.rebuild(o); } catch (e) { } });
      if (typeof render === "function") render();
      if (typeof historyPush === "function") historyPush();
      if (GIS.refreshPanel) GIS.refreshPanel();
      toast("Opened " + projName);
    });
  }

  /* ---------------------------------------------------------- save/open */

  var PICK = { types: [{ description: "GIS Consultant Studio project", accept: { "application/json": [EXT] } }] };
  function fileName() { return (projName || "project").replace(/[\\/:*?"<>|]+/g, "-") + EXT; }
  function blob() { return new Blob([JSON.stringify(snapshot())], { type: "application/json" }); }
  function save(as) {
    if (!as && handle) {
      return handle.createWritable().then(function (w) { return w.write(blob()).then(function () { return w.close(); }); })
        .then(function () { toast("Saved " + handle.name); }, function (e) { toast("Could not save: " + (e.message || e)); });
    }
    if (as || !projName || projName === "Untitled project") {
      var n = window.prompt("Project name", projName === "Untitled project" ? "" : projName);
      if (n === null) return Promise.resolve();
      projName = n.trim() || projName;
    }
    if (typeof window.showSaveFilePicker === "function") {
      return window.showSaveFilePicker(Object.assign({ suggestedName: fileName() }, PICK)).then(function (fh) {
        handle = fh; projName = fh.name.replace(/\.gcsproj$/i, "");
        return fh.createWritable().then(function (w) { return w.write(blob()).then(function () { return w.close(); }); }).then(function () { toast("Saved " + fh.name); });
      }, function (e) { if (e && e.name !== "AbortError") toast("Could not save: " + (e.message || e)); });
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob()); a.download = fileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    return Promise.resolve();
  }
  function openFile(file, fh) {
    return file.text().then(function (t) { return restore(JSON.parse(t)); }).then(function () {
      handle = fh || null;
      projName = file.name.replace(/\.gcsproj$/i, "") || projName;
    }).catch(function (e) { GIS.restoring = false; toast("Could not open " + file.name + ": " + (e.message || e)); throw e; });
  }
  function open() {
    if (typeof window.showOpenFilePicker === "function") {
      return window.showOpenFilePicker(Object.assign({ multiple: false }, PICK)).then(function (hs) {
        return hs[0].getFile().then(function (f) { return openFile(f, hs[0]); });
      }, function (e) { if (e && e.name !== "AbortError") toast(e.message || String(e)); });
    }
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = EXT + ",application/json";
    inp.onchange = function () { if (inp.files[0]) openFile(inp.files[0]); };
    inp.click();
    return Promise.resolve();
  }
  // A new, empty project (Home › Map › Blank keeps working as before).
  function reset() { handle = null; projName = "Untitled project"; }

  /* --------------------------------------------------------------- UI */

  function build() {
    var center = document.querySelector(".topbar-center");
    if (!center || $("gcsProjBtns")) return;
    var g = document.createElement("div");
    g.id = "gcsProjBtns"; g.className = "tool-group gcs-proj nav-gis-only";
    g.innerHTML = '<button type="button" class="tool-btn" data-p="open" title="Open project (Ctrl+O)">' + sym("folder_open") + "</button>" +
      '<button type="button" class="tool-btn" data-p="save" title="Save project (Ctrl+S)">' + sym("save") + "</button>" +
      '<button type="button" class="tool-btn" data-p="saveas" title="Save project as…">' + sym("save_as") + "</button>";
    center.insertBefore(g, center.firstChild);
    g.addEventListener("click", function (e) {
      var b = e.target.closest("[data-p]"); if (!b) return;
      if (b.dataset.p === "open") open(); else save(b.dataset.p === "saveas");
    });
  }
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || !document.body.classList.contains("gis-mode")) return;
    var k = e.key.toLowerCase();
    if (k === "s") { e.preventDefault(); save(e.shiftKey); }
    else if (k === "o") { e.preventDefault(); open(); }
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(build, 400); }); else setTimeout(build, 400);

  GIS.project = { save: save, open: open, openFile: openFile, snapshot: snapshot, restore: restore, reset: reset, name: function () { return projName; }, EXT: EXT };
})();
