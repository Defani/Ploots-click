/* ==========================================================================
   GIS — digitizing (the "Draw" menu of the Analysis view), like QGIS's
   editing toolbar.

   New point / line / polygon layer, or add features to the active layer:
     Point       click
     Line        click the vertices; double-click or Enter finishes
     Polygon     click the vertices; double-click or Enter closes it
     Rectangle   two corners
     Circle      centre, then a point on the edge
   While drawing: Backspace removes the last vertex, Esc cancels, and the
   cursor snaps to vertices of the target layer (12 px, can be switched
   off). After each feature a small form asks for its attributes, then
   drawing continues with the next one (Esc to stop).

   Edit vertices: click a feature of the active layer; drag its vertices,
   drag a midpoint to add a vertex, Alt+click (or right-click) a vertex to
   delete it; Enter or "Done" saves. Delete selected removes the selected
   features of the active layer.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var SRC = "ploots-draw", SNAP_PX = 12;
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function toast(m) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(m); }
  function map() { return GIS.analysis && GIS.analysis.map(); }
  var KIND = { point: "point", line: "line", polygon: "polygon", rect: "polygon", circle: "polygon" };

  var S = null; // { mode, kind, layerId, newName, pts, hover, snap, edit }

  /* ---------------------------------------------------------- overlay */

  function ensureLayers(m) {
    if (m.getSource(SRC)) return;
    m.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addLayer({ id: SRC + "-fill", type: "fill", source: SRC, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#ff5a1f", "fill-opacity": 0.18 } });
    m.addLayer({ id: SRC + "-line", type: "line", source: SRC, filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": "#ff5a1f", "line-width": 2, "line-dasharray": ["case", ["==", ["get", "k"], "rubber"], ["literal", [2, 2]], ["literal", [1, 0]]] } });
    m.addLayer({ id: SRC + "-mid", type: "circle", source: SRC, filter: ["==", ["get", "k"], "mid"], paint: { "circle-radius": 4, "circle-color": "#ffffff", "circle-opacity": 0.85, "circle-stroke-color": "#ff5a1f", "circle-stroke-width": 1.2 } });
    m.addLayer({ id: SRC + "-vx", type: "circle", source: SRC, filter: ["==", ["get", "k"], "vx"], paint: { "circle-radius": 5, "circle-color": "#ff5a1f", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
    m.addLayer({ id: SRC + "-snap", type: "circle", source: SRC, filter: ["==", ["get", "k"], "snap"], paint: { "circle-radius": 8, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ff00aa", "circle-stroke-width": 2 } });
  }
  function F(geom, k) { return { type: "Feature", properties: { k: k || "" }, geometry: geom }; }
  function paint() {
    var m = map();
    if (!m) return;
    if (!m.getSource(SRC)) { if (!m.isStyleLoaded()) return; ensureLayers(m); }
    var out = [];
    if (S && S.edit) {
      var g = S.edit.geom;
      out.push(F(g, "shape"));
      editVertices().forEach(function (v, i) { out.push(F({ type: "Point", coordinates: v.c }, "vx")); });
      editMidpoints().forEach(function (v) { out.push(F({ type: "Point", coordinates: v.c }, "mid")); });
    } else if (S) {
      var pts = S.pts.slice(), h = S.hover;
      var geom = previewGeom(pts, h);
      if (geom) out.push(F(geom, "shape"));
      if (h && pts.length && (S.kind === "line" || S.kind === "polygon") && S.mode !== "rect" && S.mode !== "circle") out.push(F({ type: "LineString", coordinates: [pts[pts.length - 1], h] }, "rubber"));
      pts.forEach(function (p) { out.push(F({ type: "Point", coordinates: p }, "vx")); });
      if (S.snapped && h) out.push(F({ type: "Point", coordinates: h }, "snap"));
    }
    m.getSource(SRC).setData({ type: "FeatureCollection", features: out });
  }
  function previewGeom(pts, h) {
    var all = h ? pts.concat([h]) : pts;
    if (S.mode === "rect" && pts.length === 1 && h) return rectGeom(pts[0], h);
    if (S.mode === "circle" && pts.length === 1 && h) return circleGeom(pts[0], h);
    if (S.kind === "polygon" && all.length >= 3) return { type: "Polygon", coordinates: [all.concat([all[0]])] };
    if (all.length >= 2 && S.kind !== "point") return { type: "LineString", coordinates: all };
    return null;
  }
  function rectGeom(a, b) { return { type: "Polygon", coordinates: [[a, [b[0], a[1]], b, [a[0], b[1]], a]] }; }
  function circleGeom(c, e) {
    var R = 6371008.8, toR = Math.PI / 180, lat1 = c[1] * toR, lon1 = c[0] * toR;
    var d = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin((e[1] - c[1]) * toR / 2), 2) + Math.cos(lat1) * Math.cos(e[1] * toR) * Math.pow(Math.sin((e[0] - c[0]) * toR / 2), 2)));
    var ring = [];
    for (var i = 0; i <= 64; i++) {
      var br = i / 64 * 2 * Math.PI;
      var lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
      var lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
      ring.push([lon2 / toR, lat2 / toR]);
    }
    ring[64] = ring[0];
    return { type: "Polygon", coordinates: [ring] };
  }

  /* -------------------------------------------------------- snapping */

  function targetLayer() { return S && S.layerId ? GIS.get(S.layerId) : null; }
  function snapPoint(e) {
    var m = map(), l = targetLayer(), best = null, bd = SNAP_PX * SNAP_PX;
    var cands = [];
    if (l && l.data) {
      var b = m.getBounds(), n = 0;
      l.data.features.forEach(function (f) {
        (function walk(c) {
          if (n > 30000) return;
          if (typeof c[0] === "number") { if (c[0] >= b.getWest() && c[0] <= b.getEast() && c[1] >= b.getSouth() && c[1] <= b.getNorth()) { cands.push(c); n++; } }
          else c.forEach(walk);
        })(f.geometry ? f.geometry.coordinates : []);
      });
    }
    if (S.pts.length) cands = cands.concat(S.pts);
    cands.forEach(function (c) {
      var p = m.project(c), dx = p.x - e.point.x, dy = p.y - e.point.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = c; }
    });
    return best;
  }
  function pointAt(e) {
    if (S.snap) { var s = snapPoint(e); S.snapped = !!s; if (s) return s.slice(0, 2); }
    else S.snapped = false;
    return [e.lngLat.lng, e.lngLat.lat];
  }

  /* ---------------------------------------------------------- drawing */

  function start(mode, opts) {
    opts = opts || {};
    if (GIS.enterMapMode) GIS.enterMapMode();
    if (GIS.setWorkspaceView && GIS.workspaceView() !== "analysis") GIS.setWorkspaceView("analysis");
    stop(true);
    var m = map();
    if (!m) { setTimeout(function () { start(mode, opts); }, 400); return; }
    var kind = KIND[mode], l = opts.newName ? null : GIS.active();
    if (l && (l.kind !== "vector" || GIS.geometryKind(l) !== kind)) l = null;
    S = { mode: mode, kind: kind, layerId: l ? l.id : null, newName: opts.newName || (l ? null : { point: "Drawn points", line: "Drawn lines", polygon: "Drawn polygons" }[kind]), pts: [], hover: null, snap: S_SNAP };
    if (GIS.mapActions) GIS.mapActions.setTool("pan");
    m.doubleClickZoom.disable();
    m.getCanvas().style.cursor = "crosshair";
    m.on("click", onClick); m.on("mousemove", onMove); m.on("dblclick", onDbl); m.on("contextmenu", onContext);
    document.addEventListener("keydown", onKey, true);
    hud();
    paint();
  }
  var S_SNAP = true;
  function stop(silent) {
    var m = map();
    if (m) {
      m.off("click", onClick); m.off("mousemove", onMove); m.off("dblclick", onDbl); m.off("contextmenu", onContext);
      m.off("mousedown", onEditDown);
      m.doubleClickZoom.enable();
      m.dragPan.enable();
      m.getCanvas().style.cursor = "";
    }
    document.removeEventListener("keydown", onKey, true);
    S = null;
    paint();
    hud();
  }
  function onMove(e) {
    if (!S || S.edit) return;
    S.hover = pointAt(e);
    paint();
  }
  function onClick(e) {
    if (!S || S.edit) return;
    var p = pointAt(e);
    if (S.kind === "point") { finish([p]); return; }
    // A click right after a double-click's first click is ignored by onDbl.
    S.pts.push(p);
    if ((S.mode === "rect" || S.mode === "circle") && S.pts.length === 2) { finish(S.pts); return; }
    paint();
    hud();
  }
  function onDbl(e) {
    if (!S || S.edit) return;
    e.preventDefault();
    // The double-click's second click added a duplicate vertex.
    if (S.pts.length >= 2) { var a = S.pts[S.pts.length - 1], b = S.pts[S.pts.length - 2]; if (a[0] === b[0] && a[1] === b[1]) S.pts.pop(); }
    finish(S.pts);
  }
  function onContext(e) { if (S && !S.edit && S.pts.length) { e.preventDefault(); S.pts.pop(); paint(); hud(); } }
  function onKey(e) {
    if (!S) return;
    if (e.target && e.target.closest && e.target.closest("input,textarea,select,.gis-dlg")) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (S.edit) cancelEdit(); else if (S.pts.length) { S.pts = []; paint(); hud(); } else stop(); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (S.edit) saveEdit(); else finish(S.pts); }
    else if (e.key === "Backspace" && !S.edit && S.pts.length) { e.preventDefault(); S.pts.pop(); paint(); hud(); }
  }
  function finish(pts) {
    if (!S) return;
    var g = null;
    if (S.kind === "point" && pts.length) g = { type: "Point", coordinates: pts[0] };
    else if (S.mode === "rect" && pts.length === 2) g = rectGeom(pts[0], pts[1]);
    else if (S.mode === "circle" && pts.length === 2) g = circleGeom(pts[0], pts[1]);
    else if (S.kind === "line" && pts.length >= 2) g = { type: "LineString", coordinates: pts };
    else if (S.kind === "polygon" && pts.length >= 3) g = { type: "Polygon", coordinates: [pts.concat([pts[0]])] };
    if (!g) { toast(S.kind === "polygon" ? "A polygon needs at least 3 vertices." : "A line needs at least 2 vertices."); return; }
    S.pts = []; S.hover = null;
    paint();
    hud();
    attributes(targetLayer(), function (props) {
      if (!S) return;
      var l = targetLayer();
      var f = { type: "Feature", properties: props || {}, geometry: g };
      if (!l) {
        l = GIS.addVector({ type: "FeatureCollection", features: [f] }, S.newName);
        S.layerId = l.id; S.newName = null;
      } else {
        l.data.features.push(f);
        l.rev = (l.rev || 0) + 1;
        GIS.emit("data");
        GIS.emit("layers");
      }
      if (typeof historyNotifyChange === "function") historyNotifyChange();
      hud();
    });
  }

  // The attribute form after each feature.
  function attributes(l, done) {
    var fields = l ? GIS.fields(l).all.filter(function (k) { return k.indexOf("__") !== 0; }) : ["name"];
    if (!fields.length) fields = ["name"];
    var back = document.createElement("div");
    back.className = "gis-dlg-back";
    back.innerHTML = '<div class="gis-dlg dg-form" role="dialog"><div class="gis-dlg-head"><span>' + sym("edit_note") + "Feature attributes</span></div>" +
      '<div class="gis-dlg-body">' + fields.map(function (k, i) {
        return '<label class="field-label">' + esc(k) + '</label><input type="text" data-k="' + esc(k) + '"' + (i ? "" : " autofocus") + ">";
      }).join("") + '<p class="dg-hint">Empty fields stay empty. Enter saves.</p></div>' +
      '<div class="gis-dlg-foot"><button type="button" data-skip>Skip</button><button type="button" class="btn-primary" data-ok>Save</button></div></div>';
    document.body.appendChild(back);
    var first = back.querySelector("input");
    if (first) setTimeout(function () { first.focus(); }, 30);
    function close(save) {
      var props = {};
      if (save) Array.prototype.forEach.call(back.querySelectorAll("[data-k]"), function (i) {
        var v = i.value.trim();
        if (v === "") return;
        props[i.dataset.k] = v !== "" && isFinite(Number(v)) && !/^0\d/.test(v) ? Number(v) : v;
      });
      back.remove();
      done(props);
    }
    back.querySelector("[data-ok]").addEventListener("click", function () { close(true); });
    back.querySelector("[data-skip]").addEventListener("click", function () { close(false); });
    back.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); close(true); } else if (e.key === "Escape") { e.preventDefault(); close(false); } e.stopPropagation(); });
  }

  /* ---------------------------------------------------- vertex editing */

  function startEdit() {
    var l = GIS.active();
    if (!l || l.kind !== "vector") { toast("Choose a vector layer to edit (Layers)."); return; }
    start(GIS.geometryKind(l) === "point" ? "point" : GIS.geometryKind(l));
    S.layerId = l.id; S.newName = null; S.editing = true;
    map().on("mousedown", onEditDown);
    map().off("click", onClick);
    map().on("click", onEditClick);
    hud();
  }
  function ringsOf(g) {
    // Every editable vertex list with a flag for closed rings.
    var out = [];
    if (g.type === "Point") out.push({ list: [g.coordinates], closed: false, single: true });
    else if (g.type === "MultiPoint" || g.type === "LineString") out.push({ list: g.coordinates, closed: false });
    else if (g.type === "MultiLineString" || g.type === "Polygon") g.coordinates.forEach(function (r) { out.push({ list: r, closed: g.type === "Polygon" }); });
    else if (g.type === "MultiPolygon") g.coordinates.forEach(function (p) { p.forEach(function (r) { out.push({ list: r, closed: true }); }); });
    return out;
  }
  function editVertices() {
    var out = [];
    ringsOf(S.edit.geom).forEach(function (r, ri) { var n = r.closed ? r.list.length - 1 : r.list.length; for (var i = 0; i < n; i++) out.push({ r: ri, i: i, c: r.list[i] }); });
    return out;
  }
  function editMidpoints() {
    var out = [];
    ringsOf(S.edit.geom).forEach(function (r, ri) {
      if (r.single) return;
      for (var i = 0; i < r.list.length - 1; i++) { var a = r.list[i], b = r.list[i + 1]; out.push({ r: ri, i: i, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }); }
    });
    return out;
  }
  function onEditClick(e) {
    if (!S || !S.editing) return;
    if (S.edit) return;
    var l = targetLayer(), m = map();
    var ids = ["-fill", "-line", "-point", "-outline"].map(function (s) { return "gis-" + l.id + s; }).filter(function (id) { return m.getLayer(id); });
    var hit = m.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]], { layers: ids })[0];
    if (!hit || hit.properties.__i == null) { toast("Click a feature of " + l.name + " to edit its vertices."); return; }
    var idx = +hit.properties.__i;
    S.edit = { idx: idx, geom: JSON.parse(JSON.stringify(l.data.features[idx].geometry)), orig: l.data.features[idx].geometry };
    paint(); hud();
  }
  function near(list, e, px) {
    var m = map(), best = null, bd = px * px;
    list.forEach(function (v) { var p = m.project(v.c), d = (p.x - e.point.x) * (p.x - e.point.x) + (p.y - e.point.y) * (p.y - e.point.y); if (d < bd) { bd = d; best = v; } });
    return best;
  }
  function onEditDown(e) {
    if (!S || !S.edit) return;
    var m = map(), v = near(editVertices(), e, 10), mid = v ? null : near(editMidpoints(), e, 9);
    var rings = ringsOf(S.edit.geom);
    if (v && (e.originalEvent.altKey || e.originalEvent.button === 2)) {
      var r = rings[v.r], min = r.single ? 1 : r.closed ? 4 : 2;
      if (r.list.length - (r.closed ? 0 : 0) <= min) { toast("That would leave too few vertices."); return; }
      r.list.splice(v.i, 1);
      if (r.closed && v.i === 0) r.list[r.list.length - 1] = r.list[0].slice();
      paint();
      return;
    }
    if (!v && !mid) return;
    e.preventDefault();
    m.dragPan.disable();
    var r2 = rings[(v || mid).r], i = v ? v.i : mid.i + 1;
    if (mid) r2.list.splice(i, 0, mid.c.slice());
    function move(ev) {
      var p = S.snap ? (snapPoint(ev) || [ev.lngLat.lng, ev.lngLat.lat]) : [ev.lngLat.lng, ev.lngLat.lat];
      r2.list[i] = p.slice(0, 2);
      if (r2.closed && i === 0) r2.list[r2.list.length - 1] = p.slice(0, 2);
      if (r2.closed && i === r2.list.length - 1) r2.list[0] = p.slice(0, 2);
      if (r2.single) S.edit.geom.coordinates = p.slice(0, 2);
      paint();
    }
    function up() { m.off("mousemove", move); m.off("mouseup", up); m.dragPan.enable(); }
    m.on("mousemove", move); m.on("mouseup", up);
  }
  function saveEdit() {
    var l = targetLayer();
    if (!S || !S.edit || !l) return;
    l.data.features[S.edit.idx].geometry = S.edit.geom;
    l.rev = (l.rev || 0) + 1;
    GIS.emit("data"); GIS.emit("layers");
    if (typeof historyNotifyChange === "function") historyNotifyChange();
    S.edit = null; paint(); hud();
    toast("Vertices saved");
  }
  function cancelEdit() { if (S) { S.edit = null; paint(); hud(); } }

  function deleteSelected() {
    var l = GIS.active();
    if (!l || l.kind !== "vector" || !l.selection.size) { toast("Select features of a vector layer first."); return; }
    var n = l.selection.size;
    if (!window.confirm("Delete " + n + " selected feature" + (n === 1 ? "" : "s") + " from " + l.name + "?")) return;
    l.data.features = l.data.features.filter(function (f, i) { return !l.selection.has(i); });
    l.selection = new Set();
    l.rev = (l.rev || 0) + 1;
    GIS.emit("selection"); GIS.emit("data"); GIS.emit("layers");
    if (typeof historyNotifyChange === "function") historyNotifyChange();
  }

  /* ---------------------------------------------------------------- UI */

  var bar = null;
  function hud() {
    var host = document.getElementById("gisAnalysisHost");
    if (!S) { if (bar) { bar.remove(); bar = null; } return; }
    if (!bar || !host.contains(bar)) {
      if (bar) bar.remove();
      bar = document.createElement("div");
      bar.className = "dg-hud";
      host.appendChild(bar);
      bar.addEventListener("click", function (e) {
        var b = e.target.closest("[data-a]");
        if (!b || !S) return;
        var a = b.dataset.a;
        if (a === "done") { if (S.edit) saveEdit(); else if (S.pts.length) finish(S.pts); else stop(); }
        else if (a === "cancel") { if (S.edit) cancelEdit(); else stop(); }
        else if (a === "undo") { S.pts.pop(); paint(); hud(); }
        else if (a === "snap") { S.snap = S_SNAP = !S.snap; hud(); }
      });
    }
    var l = targetLayer(), what = S.editing ? "Edit vertices" : { point: "Point", line: "Line", polygon: "Polygon", rect: "Rectangle", circle: "Circle" }[S.mode];
    var tip = S.editing ? (S.edit ? "Drag vertices · drag a midpoint to add · Alt+click to delete · Enter saves" : "Click a feature to edit")
      : S.kind === "point" ? "Click to add points · Esc to stop"
      : S.mode === "rect" ? "Click two corners" : S.mode === "circle" ? "Click the centre, then the edge"
      : S.pts.length ? S.pts.length + " vertices · double-click or Enter to finish · Backspace undo" : "Click to add vertices";
    bar.innerHTML = sym(S.editing ? "edit" : "draw") + "<b>" + what + "</b><span>" + esc(l ? l.name : S.newName + " (new layer)") + "</span><em>" + esc(tip) + "</em>" +
      '<button type="button" data-a="snap" class="' + (S.snap ? "on" : "") + '" title="Snap to vertices">' + sym("my_location") + "Snap</button>" +
      (!S.editing && S.pts.length ? '<button type="button" data-a="undo" title="Remove the last vertex (Backspace)">' + sym("undo") + "</button>" : "") +
      '<button type="button" data-a="done" class="dg-done">' + sym("check") + (S.edit ? "Save" : "Done") + '</button><button type="button" data-a="cancel" title="Esc">' + sym("close") + "</button>";
  }

  function menu(anchor) {
    var old = document.querySelector(".dg-menu");
    if (old) { old.remove(); return; }
    var l = GIS.active(), k = l && l.kind === "vector" ? GIS.geometryKind(l) : null;
    var m = document.createElement("div");
    m.className = "gis-ctx open dg-menu";
    function b(v, icon, label, dis) { return '<button type="button" data-v="' + v + '"' + (dis ? " disabled" : "") + ">" + sym(icon) + "<span>" + label + "</span></button>"; }
    m.innerHTML = '<div class="gis-ctx-head">New layer</div>' + b("new:point", "scatter_plot", "New point layer…") + b("new:line", "polyline", "New line layer…") + b("new:polygon", "pentagon", "New polygon layer…") +
      '<div class="gis-ctx-sep"></div><div class="gis-ctx-head">Add to ' + esc(l && k ? l.name : "the active layer") + "</div>" +
      b("point", "location_on", "Point", k && k !== "point") + b("line", "timeline", "Line", k && k !== "line") + b("polygon", "pentagon", "Polygon", k && k !== "polygon") +
      b("rect", "rectangle", "Rectangle", k && k !== "polygon") + b("circle", "circle", "Circle", k && k !== "polygon") +
      '<div class="gis-ctx-sep"></div>' + b("edit", "edit", "Edit vertices", !k) + b("delete", "delete", "Delete selected features", !(l && l.selection && l.selection.size)) +
      '<div class="gis-ctx-sep"></div><button type="button" data-v="snap">' + sym(S_SNAP ? "check_box" : "check_box_outline_blank") + "<span>Snap to vertices</span></button>";
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    m.style.left = Math.min(window.innerWidth - m.offsetWidth - 6, r.left) + "px";
    m.style.top = r.bottom + 4 + "px";
    m.addEventListener("click", function (e) {
      var t = e.target.closest("[data-v]");
      if (!t || t.disabled) return;
      m.remove();
      var v = t.dataset.v;
      if (v.indexOf("new:") === 0) {
        var kind = v.slice(4), name = window.prompt("Name of the new " + kind + " layer", { point: "Points", line: "Lines", polygon: "Polygons" }[kind]);
        if (name == null) return;
        start(kind, { newName: name.trim() || kind });
      } else if (v === "edit") startEdit();
      else if (v === "delete") deleteSelected();
      else if (v === "snap") S_SNAP = !S_SNAP;
      else start(v);
    });
    setTimeout(function () {
      document.addEventListener("mousedown", function off(e) { if (!m.contains(e.target) && !anchor.contains(e.target)) { m.remove(); document.removeEventListener("mousedown", off, true); } }, true);
    }, 0);
  }

  // Top bar: "Draw" next to Geoprocessing (Analysis only).
  function addButton() {
    var geo = Array.prototype.filter.call(document.querySelectorAll("#mainTools .tb-btn"), function (b) { return /Geoprocessing/.test(b.textContent); })[0];
    if (!geo || document.querySelector(".tb-draw")) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "tool-btn tb-btn tb-drop tb-ana tb-draw";
    b.title = "Draw and edit features (digitizing)";
    b.innerHTML = sym("draw") + '<span class="tb-lbl">Draw</span>';
    geo.before(b);
    b.addEventListener("click", function () { menu(b); });
  }
  // Leaving the Analysis view ends drawing.
  new MutationObserver(function () { if (S && !document.body.classList.contains("gis-analysis")) stop(); })
    .observe(document.body, { attributes: true, attributeFilter: ["class"] });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(addButton, 100); }); else setTimeout(addButton, 100);

  GIS.digitize = { start: start, stop: function () { stop(); }, edit: startEdit, deleteSelected: deleteSelected, active: function () { return !!S; }, menu: menu };
})();
