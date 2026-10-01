/* ==========================================================================
   GIS — native vector engine (desktop app only; desktop/src-tauri/src/
   native_vec.rs).

   A big shapefile (a national village layer, a 1 GB cadastre…) is opened
   in place by the desktop app, the way QGIS reads it: only its index is
   read, and the map asks for vector tiles that are cut from the file on
   demand, simplified for the zoom. Nothing is loaded into the page, so a
   layer of 80 000 polygons pans and zooms like a basemap.

   Add layer › Big file (native, fast) picks the file; the layer is a vector
   tile layer ("mvt") that keeps its file path, so a saved project opens it
   again. Shapefiles in WGS 84 (longitude/latitude); others open the normal
   way (they are reprojected there).
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var T = window.__TAURI__;
  var available = !!(T && T.core && T.core.invoke);
  function toast(m) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(m); }
  // Custom schemes are http://<scheme>.localhost on Windows (WebView2), <scheme>://localhost elsewhere.
  function base() { return /Windows/i.test(navigator.userAgent) ? "http://gcs.localhost/" : "gcs://localhost/"; }
  // The attributes carried in the tiles: name and code fields first (for labels,
  // identify and categories), a few at most so the tiles stay small.
  function pickFields(fields) {
    var pref = fields.filter(function (f) { return /^(NAM|NAME|WADM|KODE|KD|NAMA|DESA|KEC|KAB|PROV|FUNGSI|KELAS|JENIS|TYPE|CLASS)/i.test(f); });
    return (pref.length ? pref : fields).slice(0, 6);
  }
  function tileUrl(info, fields) { return base() + "tile/" + info.id + "/{z}/{x}/{y}.pbf?f=" + encodeURIComponent(fields.join(",")); }

  function addLayer(info, opts) {
    opts = opts || {};
    var fields = opts.fields || pickFields(info.fields || []);
    if (GIS.enterMapMode) GIS.enterMapMode();
    var l = GIS.addMVT(tileUrl(info, fields), "data", opts.name || info.name, opts.attribution || "");
    l.native = { path: info.path, id: info.id, fields: fields, allFields: info.fields, count: info.count, kind: info.kind };
    l.bbox = info.bbox;
    l.maxzoom = 16;
    if (info.kind === "line") l.fillOpacity = 0;
    GIS.emit("layers"); GIS.emit("style");
    return l;
  }
  function zoomTo(l) {
    var m = GIS.map && GIS.map();
    if (m && l && l.bbox) m.fitBounds([[l.bbox[0], l.bbox[1]], [l.bbox[2], l.bbox[3]]], { padding: 30, animate: false });
  }

  function open(path) {
    if (!available) return Promise.reject(new Error("The native engine is part of the desktop app."));
    toast("Opening " + path.split(/[\\/]/).pop() + "…");
    return T.core.invoke("native_open", { path: path }).then(function (info) {
      var l = addLayer(info);
      zoomTo(l);
      toast(info.name + ": " + Number(info.count).toLocaleString() + " features, drawn natively");
      return l;
    }, function (e) { toast(String(e && e.message || e)); throw e; });
  }
  function pick() {
    if (!available) { toast("Big files open natively in the desktop app."); return Promise.resolve(null); }
    return T.core.invoke("native_pick").then(function (path) { return path ? open(path) : null; });
  }
  // After a project is opened: open the native layers' files again (new ids).
  function reopen(layers) {
    if (!available) return Promise.resolve();
    return Promise.all(layers.filter(function (l) { return l.native && l.native.path; }).map(function (l) {
      return T.core.invoke("native_open", { path: l.native.path }).then(function (info) {
        l.native.id = info.id; l.native.count = info.count; l.bbox = info.bbox;
        l.url = tileUrl(info, l.native.fields || pickFields(info.fields || []));
        l.rev = (l.rev || 0) + 1;
      }, function (e) { toast(l.name + ": " + (e && e.message || e)); });
    }));
  }
  // One feature with all its attributes (identify).
  function feature(l, fid) {
    if (!available || !l || !l.native) return Promise.resolve(null);
    return T.core.invoke("native_feature", { id: l.native.id, fid: fid });
  }
  // Closing the layer frees the file.
  GIS.on("layers", function () {
    if (!available) return;
    var open = {};
    GIS.maps.forEach(function (m) { m.layers.forEach(function (l) { if (l.native) open[l.native.id] = true; }); });
    Object.keys(known).forEach(function (id) { if (!open[id]) { delete known[id]; T.core.invoke("native_close", { id: +id }).catch(function () { }); } });
    Object.keys(open).forEach(function (id) { known[id] = true; });
  });
  var known = {};

  GIS.native = { available: available, pick: pick, open: open, reopen: reopen, feature: feature, zoomTo: zoomTo };
})();
