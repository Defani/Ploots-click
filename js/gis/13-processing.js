/* ==========================================================================
   GIS — Processing toolbox and the Geoprocessing menu (like QGIS).

   Toolbox      a left panel with the tools in category folders (Vector
                geoprocessing, geometry, analysis, creation, selection,
                conversion, interpolation, clustering, general), a search box and a
                "Recently used" folder.
   Geoprocessing  the top bar menu with the common overlay tools (buffer,
                clip, difference, intersection, union, dissolve, convex
                hull), as in QGIS's Vector ▸ Geoprocessing Tools.

   Every tool opens a dialog with its parameters (input layers, fields,
   distances ...) and writes a new layer, like QGIS's temporary outputs.
   Inputs can be limited to the selected features. The geometry work is
   done by Turf.js (MIT), loaded the first time a tool runs.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var TURF = "https://cdn.jsdelivr.net/npm/@turf/turf@7.2.0/turf.min.js";
  var RECENT = "ploots-processing-recent";

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function toast(m) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(m); }

  var turfP = null;
  function ensureTurf() {
    if (window.turf && turf.buffer) return Promise.resolve();
    if (!turfP) turfP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = TURF; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { turfP = null; rej(new Error("Could not load Turf.js (the geometry engine).")); };
      document.head.appendChild(s);
    });
    return turfP;
  }

  /* ----------------------------------------------------------- helpers */

  var UNITS = [["kilometers", "Kilometers"], ["meters", "Meters"], ["miles", "Miles"], ["nauticalmiles", "Nautical miles"], ["degrees", "Degrees"]];
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fc(features) { return { type: "FeatureCollection", features: features }; }
  function kindOf(f) { var t = f.geometry && f.geometry.type || ""; return /Polygon/.test(t) ? "polygon" : /LineString/.test(t) ? "line" : /Point/.test(t) ? "point" : ""; }
  // The features of a layer (copies), optionally only the selected ones.
  function feats(l, selectedOnly) {
    if (!l) throw new Error("Choose a layer.");
    var out = [];
    l.data.features.forEach(function (f, i) { if (f.geometry && (!selectedOnly || l.selection.has(i))) out.push(clone(f)); });
    if (!out.length) throw new Error(selectedOnly ? "No features are selected in " + l.name + "." : l.name + " has no features.");
    return out;
  }
  function only(list, kind, what) {
    var r = list.filter(function (f) { return kindOf(f) === kind; });
    if (!r.length) throw new Error((what || "The layer") + " has no " + kind + " features.");
    return r;
  }
  // Flatten multi-geometries into single parts (keeps properties).
  function single(list) { var out = []; list.forEach(function (f) { turf.flatten(f).features.forEach(function (g) { g.properties = f.properties; out.push(g); }); }); return out; }
  function unionAll(polys) {
    if (!polys.length) return null;
    if (polys.length === 1) return polys[0];
    return turf.union(fc(polys.map(function (p) { return turf.feature(p.geometry); })));
  }
  function bboxOverlap(a, b) { return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]); }
  function midpoint(line) { var len = turf.length(line); return turf.along(line, len / 2); }
  function inside(pt, mask) { return turf.booleanPointInPolygon(pt, mask); }
  // Lines cut by a polygon mask; keep the pieces inside (or outside).
  function cutLines(lines, mask, keepInside) {
    var out = [], edge = turf.polygonToLine(mask);
    var edges = edge.type === "FeatureCollection" ? edge.features : [edge];
    single(lines).forEach(function (l) {
      var pieces = [l];
      edges.forEach(function (e) {
        var next = [];
        pieces.forEach(function (p) { var s = turf.lineSplit(p, e); if (s.features.length) s.features.forEach(function (q) { next.push(q); }); else next.push(p); });
        pieces = next;
      });
      pieces.forEach(function (p) { if (turf.length(p) > 0 && inside(midpoint(p), mask) === keepInside) { p.properties = l.properties; out.push(p); } });
    });
    return out;
  }
  function numVals(list, field) { return list.map(function (f) { return Number(f.properties[field]); }).filter(function (v) { return isFinite(v); }); }

  /* ------------------------------------------------------------- tools */
  // Parameter types: layer (geom: polygon | line | point | any), layer2,
  // field (of: parameter id, numeric), number, select, check, text.

  function P_in(geom, label) { return { id: "input", type: "layer", label: label || "Input layer", geom: geom || "any", sel: true }; }
  function P_ov(geom, label) { return { id: "overlay", type: "layer", label: label || "Overlay layer", geom: geom || "polygon", sel: true }; }
  function P_units(v) { return { id: "units", type: "select", label: "Units", options: UNITS, value: v || "kilometers" }; }

  var TOOLS = [
    /* Vector geoprocessing */
    { id: "buffer", cat: "Vector geoprocessing", name: "Buffer", icon: "radio_button_checked", geo: true,
      help: "A zone of the given distance around every feature.",
      params: [P_in(), { id: "dist", type: "number", label: "Distance", value: 1, step: "any" }, P_units(), { id: "steps", type: "number", label: "Segments per quarter circle", value: 8, min: 1, max: 64 }, { id: "dissolve", type: "check", label: "Dissolve result" }],
      run: function (p) {
        var out = feats(p.input, p.input_sel).map(function (f) { var b = turf.buffer(f, +p.dist, { units: p.units, steps: +p.steps || 8 }); if (b) b.properties = f.properties; return b; }).filter(Boolean);
        if (p.dissolve) { var u = unionAll(out); out = u ? [u] : []; }
        return out;
      } },
    { id: "clip", cat: "Vector geoprocessing", name: "Clip", icon: "content_cut", geo: true,
      help: "The parts of the input features inside the overlay polygons.",
      params: [P_in(), P_ov("polygon")],
      run: function (p) {
        var mask = unionAll(only(feats(p.overlay, p.overlay_sel), "polygon", p.overlay.name)), out = [], list = feats(p.input, p.input_sel);
        list.forEach(function (f) {
          var k = kindOf(f);
          if (k === "polygon") { var g = turf.intersect(fc([f, mask])); if (g) { g.properties = f.properties; out.push(g); } }
          else if (k === "point") single([f]).forEach(function (q) { if (inside(q, mask)) out.push(q); });
        });
        return out.concat(cutLines(list.filter(function (f) { return kindOf(f) === "line"; }), mask, true));
      } },
    { id: "difference", cat: "Vector geoprocessing", name: "Difference", icon: "difference", geo: true,
      help: "The parts of the input features outside the overlay polygons.",
      params: [P_in(), P_ov("polygon")],
      run: function (p) {
        var mask = unionAll(only(feats(p.overlay, p.overlay_sel), "polygon", p.overlay.name)), out = [], list = feats(p.input, p.input_sel);
        list.forEach(function (f) {
          var k = kindOf(f);
          if (k === "polygon") { var g = turf.difference(fc([f, mask])); if (g) { g.properties = f.properties; out.push(g); } }
          else if (k === "point") single([f]).forEach(function (q) { if (!inside(q, mask)) out.push(q); });
        });
        return out.concat(cutLines(list.filter(function (f) { return kindOf(f) === "line"; }), mask, false));
      } },
    { id: "intersection", cat: "Vector geoprocessing", name: "Intersection", icon: "join_inner", geo: true,
      help: "Where input and overlay polygons overlap, with the attributes of both.",
      params: [P_in("polygon"), P_ov("polygon"), { id: "prefix", type: "text", label: "Prefix for overlay fields", value: "ov_" }],
      run: function (p) {
        var A = only(feats(p.input, p.input_sel), "polygon"), B = only(feats(p.overlay, p.overlay_sel), "polygon", p.overlay.name), out = [];
        var bb = B.map(function (b) { return turf.bbox(b); });
        A.forEach(function (a) {
          var ab = turf.bbox(a);
          B.forEach(function (b, j) {
            if (!bboxOverlap(ab, bb[j])) return;
            var g = turf.intersect(fc([a, b]));
            if (!g) return;
            g.properties = Object.assign({}, a.properties);
            Object.keys(b.properties).forEach(function (k) { g.properties[(p.prefix || "") + k] = b.properties[k]; });
            out.push(g);
          });
        });
        return out;
      } },
    { id: "union", cat: "Vector geoprocessing", name: "Union (dissolve all)", icon: "join_full", geo: true,
      help: "One polygon covering the polygons of both layers.",
      params: [P_in("polygon"), { id: "overlay", type: "layer", label: "Second layer (optional)", geom: "polygon", optional: true, sel: true }],
      run: function (p) {
        var list = only(feats(p.input, p.input_sel), "polygon");
        if (p.overlay) list = list.concat(only(feats(p.overlay, p.overlay_sel), "polygon", p.overlay.name));
        var u = unionAll(list);
        if (u) u.properties = { features: list.length };
        return u ? [u] : [];
      } },
    { id: "dissolve", cat: "Vector geoprocessing", name: "Dissolve", icon: "blur_linear", geo: true,
      help: "Merges polygons, all together or per value of a field.",
      params: [P_in("polygon"), { id: "field", type: "field", label: "Dissolve field (optional)", of: "input", optional: true }],
      run: function (p) {
        var list = only(feats(p.input, p.input_sel), "polygon"), groups = {}, order = [];
        list.forEach(function (f) { var k = p.field ? String(f.properties[p.field]) : "all"; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(f); });
        return order.map(function (k) {
          var u = unionAll(groups[k]);
          if (!u) return null;
          u.properties = p.field ? {} : {};
          if (p.field) u.properties[p.field] = groups[k][0].properties[p.field];
          u.properties.count = groups[k].length;
          return u;
        }).filter(Boolean);
      } },
    { id: "convex", cat: "Vector geoprocessing", name: "Convex hull", icon: "pentagon", geo: true,
      help: "The smallest convex polygon around the features, per feature or for the whole layer.",
      params: [P_in(), { id: "each", type: "check", label: "One hull per feature" }],
      run: function (p) {
        var list = feats(p.input, p.input_sel);
        if (p.each) return list.map(function (f) { var h = turf.convex(f); if (h) h.properties = f.properties; return h; }).filter(Boolean);
        var h = turf.convex(fc(list));
        if (h) h.properties = { features: list.length };
        return h ? [h] : [];
      } },

    { id: "concave", cat: "Vector geoprocessing", name: "Concave hull", icon: "hexagon", geo: true,
      help: "A hull that follows the points more closely than a convex hull.",
      params: [P_in(), { id: "edge", type: "number", label: "Maximum edge length", value: 50, step: "any" }, P_units()],
      run: function (p) {
        var pts = [];
        feats(p.input, p.input_sel).forEach(function (f) { turf.explode(f).features.forEach(function (v) { pts.push(v); }); });
        var h = turf.concave(fc(pts), { maxEdge: +p.edge, units: p.units });
        if (!h) throw new Error("No hull with that edge length; try a larger value.");
        h.properties = { points: pts.length };
        return [h];
      } },
    { id: "bufferfield", cat: "Vector geoprocessing", name: "Buffer by field (variable distance)", icon: "radio_button_partial", geo: true,
      params: [P_in(), { id: "field", type: "field", label: "Distance field", of: "input", numeric: true }, P_units(), { id: "dissolve", type: "check", label: "Dissolve result" }],
      run: function (p) {
        var out = feats(p.input, p.input_sel).map(function (f) { var d = Number(f.properties[p.field]); if (!(d > 0)) return null; var b = turf.buffer(f, d, { units: p.units }); if (b) b.properties = f.properties; return b; }).filter(Boolean);
        if (p.dissolve) { var u = unionAll(out); out = u ? [u] : []; }
        return out;
      } },


    /* Vector geometry */
    { id: "centroids", cat: "Vector geometry", name: "Centroids", icon: "adjust",
      params: [P_in()],
      run: function (p) { return feats(p.input, p.input_sel).map(function (f) { var c = turf.centroid(f); c.properties = f.properties; return c; }); } },
    { id: "pointonsurface", cat: "Vector geometry", name: "Point on surface", icon: "location_on",
      help: "A point guaranteed to lie on each feature (unlike a centroid).",
      params: [P_in()],
      run: function (p) { return feats(p.input, p.input_sel).map(function (f) { var c = turf.pointOnFeature(f); c.properties = f.properties; return c; }); } },
    { id: "bbox", cat: "Vector geometry", name: "Bounding boxes", icon: "crop_square",
      params: [P_in(), { id: "all", type: "check", label: "One box for the whole layer" }],
      run: function (p) {
        var list = feats(p.input, p.input_sel);
        if (p.all) return [turf.bboxPolygon(turf.bbox(fc(list)), { properties: { features: list.length } })];
        return list.map(function (f) { return turf.bboxPolygon(turf.bbox(f), { properties: f.properties }); });
      } },
    { id: "simplify", cat: "Vector geometry", name: "Simplify", icon: "timeline",
      help: "Fewer vertices (Douglas-Peucker). Tolerance is in degrees (0.001 ≈ 110 m).",
      params: [P_in(), { id: "tol", type: "number", label: "Tolerance (degrees)", value: 0.001, step: "any" }, { id: "hq", type: "check", label: "Higher quality (slower)" }],
      run: function (p) { return turf.simplify(fc(feats(p.input, p.input_sel)), { tolerance: +p.tol, highQuality: !!p.hq }).features; } },
    { id: "smooth", cat: "Vector geometry", name: "Smooth lines", icon: "gesture",
      params: [P_in("line"), { id: "res", type: "number", label: "Resolution (ms of spline)", value: 10000, step: 1000 }, { id: "sharp", type: "number", label: "Sharpness", value: 0.85, step: 0.05, min: 0, max: 1 }],
      run: function (p) { return single(only(feats(p.input, p.input_sel), "line")).map(function (f) { var s = turf.bezierSpline(f, { resolution: +p.res, sharpness: +p.sharp }); s.properties = f.properties; return s; }); } },
    { id: "poly2line", cat: "Vector geometry", name: "Polygons to lines", icon: "polyline",
      params: [P_in("polygon")],
      run: function (p) { var out = []; only(feats(p.input, p.input_sel), "polygon").forEach(function (f) { var r = turf.polygonToLine(f); (r.type === "FeatureCollection" ? r.features : [r]).forEach(function (g) { g.properties = f.properties; out.push(g); }); }); return out; } },
    { id: "line2poly", cat: "Vector geometry", name: "Lines to polygons", icon: "pentagon",
      params: [P_in("line")],
      run: function (p) { return single(only(feats(p.input, p.input_sel), "line")).map(function (f) { try { var g = turf.lineToPolygon(f); g.properties = f.properties; return g; } catch (e) { return null; } }).filter(Boolean); } },
    { id: "vertices", cat: "Vector geometry", name: "Extract vertices", icon: "scatter_plot",
      params: [P_in()],
      run: function (p) { var out = []; feats(p.input, p.input_sel).forEach(function (f) { turf.explode(f).features.forEach(function (v, i) { v.properties = Object.assign({ vertex: i }, f.properties); out.push(v); }); }); return out; } },
    { id: "singleparts", cat: "Vector geometry", name: "Multipart to singleparts", icon: "call_split",
      params: [P_in()],
      run: function (p) { return single(feats(p.input, p.input_sel)); } },
    { id: "geomattrs", cat: "Vector geometry", name: "Add geometry attributes", icon: "straighten",
      help: "Area (m², ha), perimeter and length (m) on the ellipsoid, and x / y of points.",
      params: [P_in()],
      run: function (p) {
        return feats(p.input, p.input_sel).map(function (f) {
          var k = kindOf(f), pr = f.properties = Object.assign({}, f.properties);
          if (k === "polygon") { var a = turf.area(f); pr.area_m2 = +a.toFixed(2); pr.area_ha = +(a / 1e4).toFixed(4); pr.perim_m = +(turf.length(turf.polygonToLine(f), { units: "kilometers" }) * 1000).toFixed(2); }
          else if (k === "line") pr.length_m = +(turf.length(f, { units: "kilometers" }) * 1000).toFixed(2);
          else if (k === "point" && f.geometry.type === "Point") { pr.x = f.geometry.coordinates[0]; pr.y = f.geometry.coordinates[1]; }
          return f;
        });
      } },
    { id: "offset", cat: "Vector geometry", name: "Offset lines", icon: "align_horizontal_left",
      params: [P_in("line"), { id: "dist", type: "number", label: "Distance (negative = left)", value: 0.1, step: "any" }, P_units()],
      run: function (p) { return single(only(feats(p.input, p.input_sel), "line")).map(function (f) { var o = turf.lineOffset(f, +p.dist, { units: p.units }); o.properties = f.properties; return o; }); } },
    { id: "chunk", cat: "Vector geometry", name: "Split lines by length", icon: "linear_scale",
      params: [P_in("line"), { id: "len", type: "number", label: "Segment length", value: 1, step: "any" }, P_units()],
      run: function (p) { var out = []; only(feats(p.input, p.input_sel), "line").forEach(function (f) { turf.lineChunk(f, +p.len, { units: p.units }).features.forEach(function (g, i) { g.properties = Object.assign({ part: i + 1 }, f.properties); out.push(g); }); }); return out; } },
    { id: "along", cat: "Vector geometry", name: "Points along lines", icon: "more_horiz",
      params: [P_in("line"), { id: "step", type: "number", label: "Distance between points", value: 1, step: "any" }, P_units()],
      run: function (p) {
        var out = [];
        single(only(feats(p.input, p.input_sel), "line")).forEach(function (f) {
          var len = turf.length(f, { units: p.units }), d = +p.step;
          if (!(d > 0)) throw new Error("The distance must be greater than 0.");
          for (var s = 0; s <= len + 1e-9 && out.length < 200000; s += d) { var pt = turf.along(f, s, { units: p.units }); pt.properties = Object.assign({ distance: +s.toFixed(6) }, f.properties); out.push(pt); }
        });
        return out;
      } },

    /* Vector analysis */
    { id: "countpoints", cat: "Vector analysis", name: "Count points in polygon", icon: "pin_drop",
      params: [{ id: "polys", type: "layer", label: "Polygons", geom: "polygon", sel: true }, { id: "points", type: "layer", label: "Points", geom: "point", sel: true },
        { id: "field", type: "field", label: "Also sum this field (optional)", of: "points", numeric: true, optional: true }, { id: "name", type: "text", label: "Count field name", value: "NUMPOINTS" }],
      run: function (p) {
        var pts = single(only(feats(p.points, p.points_sel), "point", p.points.name));
        return only(feats(p.polys, p.polys_sel), "polygon").map(function (f) {
          var bb = turf.bbox(f), n = 0, sum = 0;
          pts.forEach(function (q) { var c = q.geometry.coordinates; if (c[0] >= bb[0] && c[0] <= bb[2] && c[1] >= bb[1] && c[1] <= bb[3] && inside(q, f)) { n++; if (p.field) sum += Number(q.properties[p.field]) || 0; } });
          f.properties = Object.assign({}, f.properties);
          f.properties[p.name || "NUMPOINTS"] = n;
          if (p.field) f.properties["SUM_" + p.field] = sum;
          return f;
        });
      } },
    { id: "nearesthub", cat: "Vector analysis", name: "Distance to nearest hub", icon: "hub",
      params: [{ id: "input", type: "layer", label: "Source points", geom: "point", sel: true }, { id: "hubs", type: "layer", label: "Hubs", geom: "point", sel: true },
        { id: "field", type: "field", label: "Hub name field", of: "hubs", optional: true }, P_units()],
      run: function (p) {
        var hubs = fc(single(only(feats(p.hubs, p.hubs_sel), "point", p.hubs.name)));
        return single(only(feats(p.input, p.input_sel), "point")).map(function (f) {
          var n = turf.nearestPoint(f, hubs);
          f.properties = Object.assign({}, f.properties, { hub_dist: +turf.distance(f, n, { units: p.units }).toFixed(4) });
          if (p.field) f.properties.hub_name = n.properties[p.field];
          return f;
        });
      } },
    { id: "lineintersect", cat: "Vector analysis", name: "Line intersections", icon: "close",
      params: [P_in("line", "Lines"), { id: "overlay", type: "layer", label: "Intersecting lines", geom: "line", sel: true }],
      run: function (p) {
        var A = single(only(feats(p.input, p.input_sel), "line")), B = single(only(feats(p.overlay, p.overlay_sel), "line", p.overlay.name)), out = [];
        A.forEach(function (a) { var ab = turf.bbox(a); B.forEach(function (b) { if (!bboxOverlap(ab, turf.bbox(b))) return; turf.lineIntersect(a, b).features.forEach(function (x) { x.properties = Object.assign({}, a.properties); out.push(x); }); }); });
        return out;
      } },
    { id: "stats", cat: "Vector analysis", name: "Basic statistics for fields", icon: "functions", table: true,
      params: [P_in(), { id: "field", type: "field", label: "Field", of: "input", numeric: true }],
      run: function (p) {
        var v = numVals(feats(p.input, p.input_sel), p.field).sort(function (a, b) { return a - b; });
        if (!v.length) throw new Error("No numeric values in " + p.field + ".");
        var n = v.length, sum = v.reduce(function (a, b) { return a + b; }, 0), mean = sum / n;
        var sd = Math.sqrt(v.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (n > 1 ? n - 1 : 1));
        function q(f) { var i = (n - 1) * f, lo = Math.floor(i); return v[lo] + (v[Math.min(n - 1, lo + 1)] - v[lo]) * (i - lo); }
        return { rows: [["Count", n], ["Sum", sum], ["Mean", mean], ["Median", q(0.5)], ["Std. deviation", sd], ["Minimum", v[0]], ["Maximum", v[n - 1]], ["Range", v[n - 1] - v[0]], ["1st quartile", q(0.25)], ["3rd quartile", q(0.75)], ["IQR", q(0.75) - q(0.25)], ["Coefficient of variation", mean ? sd / mean : NaN]] };
      } },

    { id: "sumlines", cat: "Vector analysis", name: "Sum line lengths in polygons", icon: "polyline",
      params: [{ id: "polys", type: "layer", label: "Polygons", geom: "polygon", sel: true }, { id: "lines", type: "layer", label: "Lines", geom: "line", sel: true }, P_units()],
      run: function (p) {
        var lines = single(only(feats(p.lines, p.lines_sel), "line", p.lines.name));
        return only(feats(p.polys, p.polys_sel), "polygon").map(function (f) {
          var bb = turf.bbox(f), len = 0, n = 0;
          cutLines(lines.filter(function (l) { return bboxOverlap(bb, turf.bbox(l)); }), f, true).forEach(function (piece) { len += turf.length(piece, { units: p.units }); n++; });
          f.properties = Object.assign({}, f.properties, { line_len: +len.toFixed(4), line_count: n });
          return f;
        });
      } },
    { id: "meancoords", cat: "Vector analysis", name: "Mean coordinate(s)", icon: "center_focus_weak",
      params: [P_in(), { id: "group", type: "field", label: "Per value of (optional)", of: "input", optional: true }, { id: "weight", type: "field", label: "Weight field (optional)", of: "input", numeric: true, optional: true }],
      run: function (p) {
        var groups = {}, keys = [];
        feats(p.input, p.input_sel).forEach(function (f) { var k = p.group ? String(f.properties[p.group]) : "all"; if (!groups[k]) { groups[k] = []; keys.push(k); } groups[k].push(f); });
        return keys.map(function (k) {
          var sx = 0, sy = 0, sw = 0;
          groups[k].forEach(function (f) { var c = turf.centroid(f).geometry.coordinates, w = p.weight ? Number(f.properties[p.weight]) || 0 : 1; sx += c[0] * w; sy += c[1] * w; sw += w; });
          if (!sw) return null;
          var pr = { count: groups[k].length };
          if (p.group) pr[p.group] = groups[k][0].properties[p.group];
          return turf.point([sx / sw, sy / sw], pr);
        }).filter(Boolean);
      } },

    /* Vector creation */
    { id: "grid", cat: "Vector creation", name: "Create grid", icon: "grid_4x4",
      help: "Square, hexagon, triangle or point grid over a layer's extent (or the current map view).",
      params: [{ id: "input", type: "layer", label: "Extent from layer (optional)", geom: "any", optional: true }, { id: "shape", type: "select", label: "Grid type", options: [["square", "Squares"], ["hex", "Hexagons"], ["triangle", "Triangles"], ["point", "Points"]], value: "hex" },
        { id: "size", type: "number", label: "Cell size", value: 10, step: "any" }, P_units(), { id: "mask", type: "check", label: "Only cells over the layer's polygons" }],
      run: function (p) {
        var bb = p.input ? turf.bbox(fc(feats(p.input, false))) : viewBbox(), fn = { square: turf.squareGrid, hex: turf.hexGrid, triangle: turf.triangleGrid, point: turf.pointGrid }[p.shape];
        var mask = p.mask && p.input ? unionAll(feats(p.input, false).filter(function (f) { return kindOf(f) === "polygon"; })) : null;
        var g = fn(bb, +p.size, { units: p.units, mask: mask || undefined }).features;
        if (g.length > 200000) throw new Error("That makes " + g.length + " cells; use a larger cell size.");
        g.forEach(function (f, i) { f.properties = { id: i + 1 }; });
        return g;
      } },
    { id: "random", cat: "Vector creation", name: "Random points", icon: "grain",
      params: [{ id: "input", type: "layer", label: "Inside polygons of (optional)", geom: "polygon", optional: true }, { id: "count", type: "number", label: "Number of points", value: 100, min: 1, max: 100000 }],
      run: function (p) {
        var n = Math.min(100000, Math.max(1, +p.count | 0));
        if (!p.input) return turf.randomPoint(n, { bbox: viewBbox() }).features;
        var mask = unionAll(only(feats(p.input, false), "polygon")), bb = turf.bbox(mask), out = [], tries = 0;
        while (out.length < n && tries++ < n * 200) { var q = turf.randomPoint(1, { bbox: bb }).features[0]; if (inside(q, mask)) { q.properties = { id: out.length + 1 }; out.push(q); } }
        return out;
      } },
    { id: "voronoi", cat: "Vector creation", name: "Voronoi polygons", icon: "hive",
      params: [P_in("point", "Points"), { id: "pad", type: "number", label: "Buffer region (% of extent)", value: 10, min: 0, max: 100 }],
      run: function (p) {
        var pts = single(only(feats(p.input, p.input_sel), "point")), bb = turf.bbox(fc(pts)), dx = (bb[2] - bb[0]) * (+p.pad / 100), dy = (bb[3] - bb[1]) * (+p.pad / 100);
        var v = turf.voronoi(fc(pts), { bbox: [bb[0] - dx, bb[1] - dy, bb[2] + dx, bb[3] + dy] });
        return v.features.map(function (f, i) { if (f) f.properties = pts[i].properties; return f; }).filter(Boolean);
      } },
    { id: "tin", cat: "Vector creation", name: "Delaunay triangulation (TIN)", icon: "change_history",
      params: [P_in("point", "Points"), { id: "field", type: "field", label: "Z value field (optional)", of: "input", numeric: true, optional: true }],
      run: function (p) { return turf.tin(fc(single(only(feats(p.input, p.input_sel), "point"))), p.field || undefined).features; } },

    /* Vector selection */
    { id: "selectloc", cat: "Vector selection", name: "Select by location", icon: "select", noLayer: true,
      params: [P_in("any", "Select features from"), { id: "overlay", type: "layer", label: "By comparing to", geom: "any", sel: true },
        { id: "pred", type: "select", label: "Where the features", options: [["intersect", "intersect"], ["within", "are within"], ["contain", "contain"], ["disjoint", "are disjoint"]], value: "intersect" }],
      run: function (p) {
        var ov = feats(p.overlay, p.overlay_sel), set = new Set();
        p.input.data.features.forEach(function (f, i) { if (f.geometry && matchLoc(f, ov, p.pred)) set.add(i); });
        p.input.selection = set;
        GIS.setActive(p.input.id);
        GIS.emit("selection");
        return { message: set.size + " of " + p.input.data.features.length + " features selected in " + p.input.name + "." };
      } },
    { id: "extractloc", cat: "Vector selection", name: "Extract by location", icon: "filter_alt",
      params: [P_in("any", "Extract features from"), { id: "overlay", type: "layer", label: "By comparing to", geom: "any", sel: true },
        { id: "pred", type: "select", label: "Where the features", options: [["intersect", "intersect"], ["within", "are within"], ["contain", "contain"], ["disjoint", "are disjoint"]], value: "intersect" }],
      run: function (p) { var ov = feats(p.overlay, p.overlay_sel); return feats(p.input, p.input_sel).filter(function (f) { return matchLoc(f, ov, p.pred); }); } },

    /* Interpolation */
    { id: "idw", cat: "Interpolation", name: "IDW interpolation", icon: "blur_on",
      help: "Inverse distance weighting of a numeric field into a grid.",
      params: [P_in("point", "Points"), { id: "field", type: "field", label: "Value field", of: "input", numeric: true }, { id: "size", type: "number", label: "Cell size", value: 5, step: "any" }, P_units(),
        { id: "shape", type: "select", label: "Output", options: [["square", "Squares"], ["hex", "Hexagons"], ["triangle", "Triangles"], ["point", "Points"]], value: "square" }, { id: "weight", type: "number", label: "Power", value: 2, step: 0.5 }],
      run: function (p) {
        var pts = single(only(feats(p.input, p.input_sel), "point")).filter(function (f) { return isFinite(Number(f.properties[p.field])); });
        pts.forEach(function (f) { f.properties[p.field] = Number(f.properties[p.field]); });
        var g = turf.interpolate(fc(pts), +p.size, { gridType: p.shape, property: p.field, units: p.units, weight: +p.weight }).features;
        if (g.length > 200000) throw new Error("Too many cells; use a larger cell size.");
        return g;
      } },
    { id: "contours", cat: "Interpolation", name: "Contours from points", icon: "landscape",
      help: "IDW grid of a numeric field, then contour lines (isolines) or filled bands.",
      params: [P_in("point", "Points"), { id: "field", type: "field", label: "Value field", of: "input", numeric: true }, { id: "size", type: "number", label: "Grid cell size", value: 5, step: "any" }, P_units(),
        { id: "classes", type: "number", label: "Number of levels", value: 8, min: 2, max: 50 }, { id: "bands", type: "check", label: "Filled bands (polygons) instead of lines" }],
      run: function (p) {
        var pts = single(only(feats(p.input, p.input_sel), "point")).filter(function (f) { return isFinite(Number(f.properties[p.field])); });
        pts.forEach(function (f) { f.properties[p.field] = Number(f.properties[p.field]); });
        var grid = turf.interpolate(fc(pts), +p.size, { gridType: "point", property: p.field, units: p.units });
        var v = numVals(grid.features, p.field), lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), n = Math.max(2, +p.classes | 0), br = [];
        for (var i = 0; i <= n; i++) br.push(+(lo + (hi - lo) * i / n).toPrecision(6));
        return (p.bands ? turf.isobands(grid, br, { zProperty: p.field }) : turf.isolines(grid, br, { zProperty: p.field })).features.filter(function (f) { return f.geometry && f.geometry.coordinates.length; });
      } },

    /* Clustering */
    { id: "dbscan", cat: "Clustering", name: "DBSCAN clustering", icon: "bubble_chart",
      params: [P_in("point", "Points"), { id: "dist", type: "number", label: "Maximum distance", value: 1, step: "any" }, P_units(), { id: "min", type: "number", label: "Minimum cluster size", value: 3, min: 1 }],
      run: function (p) { return turf.clustersDbscan(fc(single(only(feats(p.input, p.input_sel), "point"))), +p.dist, { units: p.units, minPoints: +p.min }).features; } },
    { id: "kmeans", cat: "Clustering", name: "K-means clustering", icon: "workspaces",
      params: [P_in("point", "Points"), { id: "k", type: "number", label: "Number of clusters", value: 5, min: 1 }],
      run: function (p) { return turf.clustersKmeans(fc(single(only(feats(p.input, p.input_sel), "point"))), { numberOfClusters: +p.k }).features.map(function (f) { delete f.properties.centroid; return f; }); } },

    /* Conversion */
    { id: "pointstopath", cat: "Conversion", name: "Points to path", icon: "route",
      help: "Joins points into lines, in the order of a field, one line per group.",
      params: [P_in("point", "Points"), { id: "order", type: "field", label: "Order by (optional; else layer order)", of: "input", optional: true }, { id: "group", type: "field", label: "One path per value of (optional)", of: "input", optional: true }],
      run: function (p) {
        var pts = single(only(feats(p.input, p.input_sel), "point")), groups = {}, keys = [];
        pts.forEach(function (f, i) { f._i = i; var k = p.group ? String(f.properties[p.group]) : "all"; if (!groups[k]) { groups[k] = []; keys.push(k); } groups[k].push(f); });
        return keys.map(function (k) {
          var g = groups[k].slice();
          if (p.order) g.sort(function (a, b) { var x = a.properties[p.order], y = b.properties[p.order]; var nx = Number(x), ny = Number(y); return isFinite(nx) && isFinite(ny) ? nx - ny : String(x).localeCompare(String(y)); });
          if (g.length < 2) return null;
          var line = turf.lineString(g.map(function (f) { return f.geometry.coordinates; }));
          line.properties = { points: g.length, length_km: +turf.length(line).toFixed(4) };
          if (p.group) line.properties[p.group] = g[0].properties[p.group];
          if (p.order) { line.properties.begin = g[0].properties[p.order]; line.properties.end = g[g.length - 1].properties[p.order]; }
          return line;
        }).filter(Boolean);
      } },
    { id: "tosegments", cat: "Conversion", name: "Lines to segments", icon: "linear_scale",
      params: [P_in("line")],
      run: function (p) { var out = []; only(feats(p.input, p.input_sel), "line").forEach(function (f) { turf.lineSegment(f).features.forEach(function (s, i) { s.properties = Object.assign({ segment: i + 1 }, f.properties); out.push(s); }); }); return out; } },
    { id: "towkt", cat: "Conversion", name: "Geometry to WKT field", icon: "data_object",
      params: [P_in(), { id: "name", type: "text", label: "Field name", value: "wkt" }],
      run: function (p) { return feats(p.input, p.input_sel).map(function (f) { f.properties = Object.assign({}, f.properties); f.properties[p.name || "wkt"] = toWKT(f.geometry); return f; }); } },
    { id: "fromwkt", cat: "Conversion", name: "WKT field to geometry", icon: "shape_line",
      help: "Builds the geometry of each feature from a WKT text field (POINT, LINESTRING, POLYGON and MULTI…).",
      params: [P_in("any", "Layer with a WKT field"), { id: "field", type: "field", label: "WKT field", of: "input" }],
      run: function (p) {
        return feats(p.input, p.input_sel).map(function (f) { var g = fromWKT(f.properties[p.field]); if (!g) return null; return { type: "Feature", properties: f.properties, geometry: g }; }).filter(Boolean);
      } },
    { id: "toutm", cat: "Conversion", name: "Add UTM coordinates", icon: "grid_on",
      help: "UTM easting / northing (WGS 84) of points or of each feature's centroid; zone chosen per feature or fixed.",
      params: [P_in(), { id: "zone", type: "number", label: "Zone (0 = automatic)", value: 0, min: 0, max: 60 }],
      run: function (p) {
        return feats(p.input, p.input_sel).map(function (f) {
          var c = f.geometry.type === "Point" ? f.geometry.coordinates : turf.centroid(f).geometry.coordinates;
          var u = utm(c[0], c[1], +p.zone || 0);
          f.properties = Object.assign({}, f.properties, { utm_zone: u.zone + (c[1] < 0 ? "S" : "N"), utm_e: +u.e.toFixed(2), utm_n: +u.n.toFixed(2) });
          return f;
        });
      } },
    { id: "todms", cat: "Conversion", name: "Add coordinates (decimal and DMS)", icon: "my_location",
      params: [P_in()],
      run: function (p) {
        return feats(p.input, p.input_sel).map(function (f) {
          var c = f.geometry.type === "Point" ? f.geometry.coordinates : turf.centroid(f).geometry.coordinates;
          f.properties = Object.assign({}, f.properties, { lon: +c[0].toFixed(7), lat: +c[1].toFixed(7), lon_dms: dmsStr(c[0], "E", "W"), lat_dms: dmsStr(c[1], "N", "S") });
          return f;
        });
      } },
    { id: "saveas", cat: "Conversion", name: "Convert format (save as)", icon: "save_as", table: true,
      help: "Writes the layer as GeoJSON, Shapefile (.zip), KML, GPX or CSV.",
      params: [P_in(), { id: "fmt", type: "select", label: "Format", options: [["geojson", "GeoJSON"], ["shp", "ESRI Shapefile (.zip)"], ["kml", "KML (Google Earth)"], ["gpx", "GPX"], ["csv", "CSV"]], value: "shp" }],
      run: function (p) {
        if (p.fmt === "geojson") GIS.exportGeoJSON(p.input, p.input_sel);
        else if (p.fmt === "csv") GIS.exportCSV(p.input, p.input_sel);
        else GIS.exportFormat(p.input, p.fmt, p.input_sel);
        return { message: p.input.name + " written as " + p.fmt.toUpperCase() + "." };
      } },

    /* Vector general */
    { id: "merge", cat: "Vector general", name: "Merge vector layers", icon: "merge",
      params: [P_in("any", "First layer"), { id: "overlay", type: "layer", label: "Second layer", geom: "any", sel: true }, { id: "tag", type: "check", label: "Add a field with the source layer name", value: true }],
      run: function (p) {
        function tag(list, l) { if (p.tag) list.forEach(function (f) { f.properties = Object.assign({ layer: l.name }, f.properties); }); return list; }
        return tag(feats(p.input, p.input_sel), p.input).concat(tag(feats(p.overlay, p.overlay_sel), p.overlay));
      } },
    { id: "joinfield", cat: "Vector general", name: "Join attributes by field value", icon: "join_left",
      params: [P_in("any", "Input layer"), { id: "field", type: "field", label: "Table field", of: "input" }, { id: "overlay", type: "layer", label: "Layer to join", geom: "any" },
        { id: "field2", type: "field", label: "Field of layer to join", of: "overlay" }, { id: "prefix", type: "text", label: "Prefix for joined fields", value: "j_" }],
      run: function (p) {
        var map = {};
        p.overlay.data.features.forEach(function (f) { var k = String(f.properties[p.field2]); if (!(k in map)) map[k] = f.properties; });
        var hit = 0, out = feats(p.input, p.input_sel).map(function (f) {
          var j = map[String(f.properties[p.field])];
          f.properties = Object.assign({}, f.properties);
          if (j) { hit++; Object.keys(j).forEach(function (k) { f.properties[(p.prefix || "") + k] = j[k]; }); }
          return f;
        });
        if (!hit) throw new Error("No values of " + p.field + " match " + p.field2 + ".");
        return out;
      } },
    { id: "spatialjoin", cat: "Vector general", name: "Join attributes by location", icon: "join",
      help: "Adds the attributes of the first overlapping feature of the join layer.",
      params: [P_in("any", "Input layer"), { id: "overlay", type: "layer", label: "Join layer", geom: "any", sel: true }, { id: "prefix", type: "text", label: "Prefix for joined fields", value: "j_" }, { id: "keep", type: "check", label: "Keep features without a match", value: true }],
      run: function (p) {
        var J = feats(p.overlay, p.overlay_sel), bbs = J.map(function (g) { return turf.bbox(g); });
        return feats(p.input, p.input_sel).map(function (f) {
          var fb = turf.bbox(f), m = null;
          for (var i = 0; i < J.length && !m; i++) if (bboxOverlap(fb, bbs[i]) && turf.booleanIntersects(f, J[i])) m = J[i];
          if (!m && !p.keep) return null;
          f.properties = Object.assign({}, f.properties);
          if (m) Object.keys(m.properties).forEach(function (k) { f.properties[(p.prefix || "") + k] = m.properties[k]; });
          return f;
        }).filter(Boolean);
      } },
    { id: "splitfield", cat: "Vector general", name: "Split layer by field", icon: "call_split", noLayer: true,
      params: [P_in(), { id: "field", type: "field", label: "Unique values of", of: "input" }],
      run: function (p) {
        var groups = {}, keys = [];
        feats(p.input, p.input_sel).forEach(function (f) { var k = String(f.properties[p.field]); if (!groups[k]) { groups[k] = []; keys.push(k); } groups[k].push(f); });
        if (keys.length > 60) throw new Error(keys.length + " values; that would make too many layers.");
        keys.forEach(function (k) { GIS.addVector(fc(groups[k]), p.input.name + " — " + p.field + " = " + k); });
        return { message: keys.length + " layers created from " + p.field + "." };
      } },
    { id: "dedupe", cat: "Vector general", name: "Delete duplicate geometries", icon: "layers_clear",
      params: [P_in()],
      run: function (p) { var seen = {}; return feats(p.input, p.input_sel).filter(function (f) { var k = JSON.stringify(f.geometry.coordinates); if (seen[k]) return false; seen[k] = 1; return true; }); } },
    /* Field data */
    { id: "enumroutes", cat: "Field data", name: "Enumerator routes", icon: "route",
      help: "Joins each enumerator's survey points in the order they were collected into a route line (per day if chosen), with the number of interviews, distance and time on the road.",
      params: [P_in("point"), { id: "who", type: "field", label: "Enumerator field", of: "input" },
        { id: "when", type: "field", label: "Time field (submission or interview time)", of: "input" },
        { id: "perday", type: "check", label: "One route per day", value: true }],
      run: function (p) {
        var groups = {}, keys = [];
        feats(p.input, p.input_sel).forEach(function (f) {
          if (!f.geometry || f.geometry.type !== "Point") return;
          var who = String(f.properties[p.who] == null ? "(none)" : f.properties[p.who]).trim(), t = String(f.properties[p.when] || "");
          var k = who + (p.perday ? " | " + t.slice(0, 10) : "");
          if (!groups[k]) { groups[k] = { who: who, day: p.perday ? t.slice(0, 10) : "", pts: [] }; keys.push(k); }
          groups[k].pts.push({ t: t, c: f.geometry.coordinates });
        });
        return keys.map(function (k) {
          var g = groups[k];
          g.pts.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
          var coords = g.pts.map(function (q) { return q.c; }), km = 0;
          for (var i = 1; i < coords.length; i++) km += turf.distance(coords[i - 1], coords[i], { units: "kilometers" });
          var t0 = Date.parse(g.pts[0].t), t1 = Date.parse(g.pts[g.pts.length - 1].t);
          var props = { enumerator: g.who, day: g.day, interviews: coords.length, distance_km: +km.toFixed(2),
            first: g.pts[0].t, last: g.pts[g.pts.length - 1].t, hours: isFinite(t1 - t0) ? +((t1 - t0) / 36e5).toFixed(2) : null };
          return coords.length > 1 ? turf.lineString(coords, props) : turf.point(coords[0], props);
        });
      } }
  ];
  var CATS = [["Vector geoprocessing", "layers"], ["Vector geometry", "shape_line"], ["Vector analysis", "analytics"], ["Vector creation", "add_box"],
    ["Vector selection", "select"], ["Conversion", "swap_horiz"], ["Interpolation", "blur_on"], ["Clustering", "bubble_chart"], ["Field data", "route"], ["Vector general", "category"]];

  /* ------------------------------------------------ conversion helpers */

  function toWKT(g) {
    function pt(c) { return c[0] + " " + c[1]; }
    function ring(r) { return "(" + r.map(pt).join(", ") + ")"; }
    function poly(p) { return "(" + p.map(ring).join(", ") + ")"; }
    switch (g.type) {
      case "Point": return "POINT (" + pt(g.coordinates) + ")";
      case "MultiPoint": return "MULTIPOINT (" + g.coordinates.map(function (c) { return "(" + pt(c) + ")"; }).join(", ") + ")";
      case "LineString": return "LINESTRING " + ring(g.coordinates);
      case "MultiLineString": return "MULTILINESTRING (" + g.coordinates.map(ring).join(", ") + ")";
      case "Polygon": return "POLYGON " + poly(g.coordinates);
      case "MultiPolygon": return "MULTIPOLYGON (" + g.coordinates.map(poly).join(", ") + ")";
    }
    return "";
  }
  function fromWKT(s) {
    s = String(s || "").trim();
    var m = s.match(/^(MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|POINT|LINESTRING|POLYGON)\s*(Z|M|ZM)?\s*(\(.*\))$/i);
    if (!m) return null;
    var type = m[1].toUpperCase(), body = m[3], pos = 0;
    function list() {
      // Nested parentheses into arrays of coordinate pairs.
      var out = [], cur = "";
      pos++; // (
      while (pos < body.length) {
        var ch = body[pos];
        if (ch === "(") { out.push(list()); cur = ""; continue; }
        if (ch === ")") { pos++; if (cur.trim()) out.push(cur.trim().split(/\s+/).slice(0, 2).map(Number)); return out; }
        if (ch === ",") { if (cur.trim()) out.push(cur.trim().split(/\s+/).slice(0, 2).map(Number)); cur = ""; pos++; continue; }
        cur += ch; pos++;
      }
      return out;
    }
    var c = list();
    var T = { POINT: "Point", LINESTRING: "LineString", POLYGON: "Polygon", MULTIPOINT: "MultiPoint", MULTILINESTRING: "MultiLineString", MULTIPOLYGON: "MultiPolygon" }[type];
    if (T === "Point") c = c[0];
    if (T === "MultiPoint") c = c.map(function (x) { return Array.isArray(x[0]) ? x[0] : x; });
    return { type: T, coordinates: c };
  }
  // UTM forward (WGS 84, Snyder / Krüger series).
  function utm(lon, lat, zone) {
    zone = zone || Math.min(60, Math.floor((lon + 180) / 6) + 1);
    var a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    var phi = lat * Math.PI / 180, lam0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180, lam = lon * Math.PI / 180;
    var N = a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi)), T = Math.tan(phi) * Math.tan(phi), C = ep2 * Math.cos(phi) * Math.cos(phi), A = Math.cos(phi) * (lam - lam0);
    var M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi) +
      (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi) - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi));
    var e = k0 * N * (A + (1 - T + C) * Math.pow(A, 3) / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120) + 500000;
    var n = k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720));
    if (lat < 0) n += 10000000;
    return { zone: zone, e: e, n: n };
  }
  function dmsStr(v, pos, neg) {
    var a = Math.abs(v), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), s = (mf - m) * 60;
    if (s >= 59.995) { s = 0; m++; } if (m >= 60) { m = 0; d++; }
    return d + "°" + String(m).padStart(2, "0") + "'" + s.toFixed(2).padStart(5, "0") + '"' + (v >= 0 ? pos : neg);
  }

  function matchLoc(f, ov, pred) {
    var fb = turf.bbox(f);
    var hit = ov.some(function (g) {
      if (pred !== "disjoint" && !bboxOverlap(fb, turf.bbox(g))) return false;
      try {
        if (pred === "within") return turf.booleanWithin(f, g);
        if (pred === "contain") return turf.booleanContains(f, g);
        return turf.booleanIntersects(f, g);
      } catch (e) { return turf.booleanIntersects(f, g); }
    });
    return pred === "disjoint" ? !ov.some(function (g) { return turf.booleanIntersects(f, g); }) : hit;
  }
  function viewBbox() {
    var m = GIS.map && GIS.map();
    if (!m) return [-180, -85, 180, 85];
    var b = m.getBounds();
    return [Math.max(-180, b.getWest()), Math.max(-85, b.getSouth()), Math.min(180, b.getEast()), Math.min(85, b.getNorth())];
  }

  /* ------------------------------------------------------------ dialog */

  function vectorLayers(geom) {
    return GIS.layers.filter(function (l) { return l.kind === "vector" && (geom === "any" || !geom || GIS.geometryKind(l) === geom); });
  }
  function recent() { try { return JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch (e) { return []; } }
  function remember(id) { try { var r = recent().filter(function (x) { return x !== id; }); r.unshift(id); localStorage.setItem(RECENT, JSON.stringify(r.slice(0, 6))); } catch (e) { } }

  function openTool(id) {
    var t = TOOLS.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    if (GIS.enterMapMode) GIS.enterMapMode();
    var back = document.createElement("div");
    back.className = "gis-dlg-back";
    back.innerHTML = '<div class="gis-dlg gproc-dlg" role="dialog" aria-label="' + esc(t.name) + '">' +
      '<div class="gis-dlg-head"><span>' + sym(t.icon) + esc(t.name) + '<em>' + esc(t.cat) + '</em></span><button type="button" data-close title="Close">' + sym("close") + "</button></div>" +
      '<div class="gis-dlg-body">' + (t.help ? '<p class="gproc-help">' + esc(t.help) + "</p>" : "") + '<div class="gproc-form"></div>' +
        (t.table || t.noLayer ? "" : '<label class="field-label">Output layer name</label><input type="text" data-out value="">') +
        '<div class="gproc-msg" hidden></div><div class="gproc-result" hidden></div></div>' +
      '<div class="gis-dlg-foot"><button type="button" data-close>Close</button><button type="button" class="btn-primary" data-run>' + sym("play_arrow") + "Run</button></div></div>";
    document.body.appendChild(back);
    var form = back.querySelector(".gproc-form"), msg = back.querySelector(".gproc-msg"), res = back.querySelector(".gproc-result"), out = back.querySelector("[data-out]");
    var values = {};
    t.params.forEach(function (p) { if (p.value !== undefined) values[p.id] = p.value; });
    // Default input: the active layer when it fits.
    t.params.forEach(function (p) {
      if (p.type !== "layer") return;
      var list = vectorLayers(p.geom), act = GIS.active();
      if (p.optional) { values[p.id] = values[p.id] || ""; return; }
      var used = t.params.filter(function (q) { return q.type === "layer" && q !== p; }).map(function (q) { return values[q.id]; });
      var pick = act && list.indexOf(act) >= 0 && used.indexOf(act.id) < 0 ? act : list.filter(function (l) { return used.indexOf(l.id) < 0; })[0] || list[0];
      values[p.id] = pick ? pick.id : "";
    });
    function layerOf(id) { return GIS.get(id); }
    function draw() {
      var h = "";
      t.params.forEach(function (p) {
        var v = values[p.id];
        if (p.type === "layer") {
          var list = vectorLayers(p.geom);
          h += '<label class="field-label">' + esc(p.label) + (p.geom && p.geom !== "any" ? ' <em class="gproc-geom">' + p.geom + "</em>" : "") + "</label>" +
            '<select data-p="' + p.id + '">' + (p.optional ? '<option value="">— None —</option>' : "") +
            list.map(function (l) { return '<option value="' + l.id + '"' + (l.id === v ? " selected" : "") + ">" + esc(l.name) + "</option>"; }).join("") +
            (list.length ? "" : '<option value="" disabled selected>No ' + (p.geom === "any" ? "vector" : p.geom) + " layers</option>") + "</select>";
          var L = layerOf(v);
          if (p.sel && L && L.selection && L.selection.size) h += '<label class="check-row gproc-sel"><input type="checkbox" data-p="' + p.id + '_sel"' + (values[p.id + "_sel"] ? " checked" : "") + ">Selected features only (" + L.selection.size + ")</label>";
        } else if (p.type === "field") {
          var src = layerOf(values[p.of]), f = src ? GIS.fields(src) : { all: [], numeric: [] }, fl = p.numeric ? f.numeric : f.all;
          if (!p.optional && (v == null || fl.indexOf(v) < 0)) values[p.id] = v = fl[0] || "";
          h += '<label class="field-label">' + esc(p.label) + '</label><select data-p="' + p.id + '">' + (p.optional ? '<option value="">— None —</option>' : "") +
            fl.map(function (k) { return '<option' + (k === v ? " selected" : "") + ">" + esc(k) + "</option>"; }).join("") + "</select>";
        } else if (p.type === "number") {
          h += '<label class="field-label">' + esc(p.label) + '</label><input type="number" data-p="' + p.id + '" value="' + esc(v) + '"' + (p.min != null ? ' min="' + p.min + '"' : "") + (p.max != null ? ' max="' + p.max + '"' : "") + ' step="' + (p.step || 1) + '">';
        } else if (p.type === "select") {
          h += '<label class="field-label">' + esc(p.label) + '</label><select data-p="' + p.id + '">' + p.options.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>";
        } else if (p.type === "check") {
          h += '<label class="check-row"><input type="checkbox" data-p="' + p.id + '"' + (v ? " checked" : "") + ">" + esc(p.label) + "</label>";
        } else if (p.type === "text") {
          h += '<label class="field-label">' + esc(p.label) + '</label><input type="text" data-p="' + p.id + '" value="' + esc(v) + '">';
        }
      });
      form.innerHTML = h;
      if (out && !out.dataset.touched) { var L0 = layerOf(values.input) || layerOf(values.polys); out.value = t.name + (L0 ? " — " + L0.name : ""); }
    }
    draw();
    if (out) out.addEventListener("input", function () { out.dataset.touched = "1"; });
    form.addEventListener("change", function (e) {
      var el = e.target.closest("[data-p]");
      if (!el) return;
      values[el.dataset.p] = el.type === "checkbox" ? el.checked : el.value;
      if (el.tagName === "SELECT" && t.params.some(function (p) { return p.id === el.dataset.p && p.type === "layer"; })) draw();
    });
    form.addEventListener("input", function (e) { var el = e.target.closest("[data-p]"); if (el && el.type !== "checkbox" && el.tagName !== "SELECT") values[el.dataset.p] = el.value; });
    function close() { back.remove(); document.removeEventListener("keydown", key, true); }
    function key(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
    document.addEventListener("keydown", key, true);
    back.addEventListener("mousedown", function (e) { if (e.target === back) close(); });
    Array.prototype.forEach.call(back.querySelectorAll("[data-close]"), function (b) { b.addEventListener("click", close); });
    var runBtn = back.querySelector("[data-run]");
    runBtn.addEventListener("click", function () {
      msg.hidden = true; res.hidden = true;
      var p = {};
      t.params.forEach(function (q) {
        var v = values[q.id];
        p[q.id] = q.type === "layer" ? (v ? layerOf(v) : null) : v;
        if (q.type === "layer") p[q.id + "_sel"] = !!values[q.id + "_sel"];
      });
      var missing = t.params.filter(function (q) { return q.type === "layer" && !q.optional && !p[q.id]; })[0];
      if (missing) { show("Choose " + missing.label.toLowerCase() + ".", true); return; }
      runBtn.disabled = true;
      runBtn.innerHTML = sym("hourglass_top") + "Running…";
      ensureTurf().then(function () {
        return new Promise(function (r) { setTimeout(r, 30); });
      }).then(function () {
        var t0 = performance.now(), r = t.run(p), ms = Math.round(performance.now() - t0);
        remember(t.id);
        if (r && r.rows) {
          res.innerHTML = '<table class="gproc-table">' + r.rows.map(function (x) { return "<tr><th>" + esc(x[0]) + "</th><td>" + esc(typeof x[1] === "number" ? (+x[1].toPrecision(10)).toLocaleString("en-US", { maximumFractionDigits: 6 }) : x[1]) + "</td></tr>"; }).join("") + "</table>";
          res.hidden = false;
          show(t.name + " — " + p.field + " (" + ms + " ms)");
          return;
        }
        if (r && r.message) { show(r.message); return; }
        var list = (r || []).filter(function (f) { return f && f.geometry; });
        if (!list.length) { show("The result is empty (no features).", true); return; }
        var l = GIS.addVector(fc(list), (out && out.value.trim()) || t.name);
        show(list.length.toLocaleString("en-US") + " feature" + (list.length === 1 ? "" : "s") + " → layer \"" + l.name + "\" (" + ms + " ms)");
        toast(t.name + ": " + list.length + " features");
      }).catch(function (e) {
        show(e.message || String(e), true);
      }).then(function () { runBtn.disabled = false; runBtn.innerHTML = sym("play_arrow") + "Run"; });
    });
    function show(text, err) { msg.textContent = text; msg.className = "gproc-msg" + (err ? " err" : ""); msg.hidden = false; }
  }

  /* ----------------------------------------------------------- toolbox */

  var PANEL = "panel-gis-toolbox", OPEN = "ploots-processing-open";
  function openFolders() { try { return JSON.parse(localStorage.getItem(OPEN) || '["Vector geoprocessing"]'); } catch (e) { return ["Vector geoprocessing"]; } }
  function build(before) {
    if ($(PANEL)) return;
    var p = document.createElement("div");
    p.id = PANEL;
    p.className = "sidebar-panel";
    p.innerHTML = '<div class="sp-head"><span class="sp-title">Processing toolbox</span><button type="button" class="sp-close" title="Close panel">' + sym("keyboard_double_arrow_left") + "</button></div>" +
      '<div class="gproc-box"><div class="gproc-search">' + sym("search") + '<input type="search" placeholder="Search tools" spellcheck="false"></div><div class="gproc-tree"></div></div>';
    document.querySelector(".sidebar").appendChild(p);
    p.querySelector(".sp-close").addEventListener("click", function () { window.closeSidebar(); });
    var tree = p.querySelector(".gproc-tree"), q = p.querySelector("input");
    function row(t) { return '<button type="button" class="gproc-tool" data-tool="' + t.id + '" title="' + esc(t.help || t.name) + '">' + sym(t.icon) + "<span>" + esc(t.name) + "</span></button>"; }
    function draw() {
      var term = q.value.trim().toLowerCase(), open = openFolders(), h = "";
      if (term) {
        var hits = TOOLS.filter(function (t) { return (t.name + " " + t.cat + " " + (t.help || "")).toLowerCase().indexOf(term) >= 0; });
        h = hits.length ? hits.map(row).join("") : '<div class="gproc-empty">No tools match.</div>';
      } else {
        var rec = recent().map(function (id) { return TOOLS.filter(function (t) { return t.id === id; })[0]; }).filter(Boolean);
        var folders = (rec.length ? [["Recently used", "history", rec]] : []).concat(CATS.map(function (c) { return [c[0], c[1], TOOLS.filter(function (t) { return t.cat === c[0]; })]; }));
        folders.forEach(function (f) {
          var on = open.indexOf(f[0]) >= 0;
          h += '<div class="gproc-folder' + (on ? " open" : "") + '"><button type="button" class="gproc-fhead" data-folder="' + esc(f[0]) + '">' +
            '<span class="material-symbols-outlined gproc-chev">chevron_right</span>' + sym(on ? "folder_open" : "folder") + "<span>" + esc(f[0]) + '</span><em>' + f[2].length + "</em></button>" +
            '<div class="gproc-items">' + f[2].map(row).join("") + "</div></div>";
        });
      }
      tree.innerHTML = h;
    }
    draw();
    q.addEventListener("input", draw);
    tree.addEventListener("click", function (e) {
      var f = e.target.closest("[data-folder]");
      if (f) {
        var open = openFolders(), k = f.dataset.folder, i = open.indexOf(k);
        if (i >= 0) open.splice(i, 1); else open.push(k);
        try { localStorage.setItem(OPEN, JSON.stringify(open)); } catch (x) { }
        draw(); return;
      }
      var t = e.target.closest("[data-tool]");
      if (t) { openTool(t.dataset.tool); setTimeout(draw, 0); }
    });
    // Rail button (GIS only).
    var nav = document.querySelector(".sidebar-nav"), b = document.createElement("button");
    b.className = "nav-btn nav-gis";
    b.setAttribute("data-panel", PANEL);
    b.title = "Processing toolbox";
    b.innerHTML = sym("home_repair_service") + '<span class="nav-lbl">Toolbox</span>';
    if (before) before.before(b); else nav.appendChild(b);
    b.addEventListener("click", function () { if (b.classList.contains("active")) window.closeSidebar(); else { draw(); activateSidebarPanel(PANEL); } });
  }

  // The top bar's Geoprocessing menu.
  function menu(anchor) {
    var old = document.querySelector(".gproc-menu");
    if (old) { old.remove(); return; }
    var m = document.createElement("div");
    m.className = "gis-ctx open gproc-menu";
    var h = '<div class="gis-ctx-head">Geoprocessing</div>' + TOOLS.filter(function (t) { return t.geo; }).map(function (t) {
      return '<button type="button" data-tool="' + t.id + '">' + sym(t.icon) + "<span>" + esc(t.name) + "…</span></button>";
    }).join("") + '<div class="gis-ctx-sep"></div>' +
      CATS.filter(function (c) { return c[0] !== "Vector geoprocessing"; }).map(function (c) {
        return '<div class="gis-ctx-sub"><button type="button" class="gis-ctx-subbtn">' + sym(c[1]) + "<span>" + esc(c[0]) + '</span><span class="material-symbols-outlined gis-ctx-arrow">chevron_right</span></button><div class="gis-ctx-subm">' +
          TOOLS.filter(function (t) { return t.cat === c[0]; }).map(function (t) { return '<button type="button" data-tool="' + t.id + '">' + sym(t.icon) + "<span>" + esc(t.name) + "…</span></button>"; }).join("") + "</div></div>";
      }).join("") +
      '<div class="gis-ctx-sep"></div><button type="button" data-toolbox="1">' + sym("home_repair_service") + "<span>Processing toolbox</span></button>";
    m.innerHTML = h;
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    m.style.left = Math.min(window.innerWidth - m.offsetWidth - 6, r.left) + "px";
    m.style.top = r.bottom + 4 + "px";
    m.classList.toggle("sub-left", r.left + m.offsetWidth + 230 > window.innerWidth);
    m.addEventListener("click", function (e) {
      var t = e.target.closest("[data-tool]"), tb = e.target.closest("[data-toolbox]");
      if (!t && !tb) return;
      m.remove();
      if (t) openTool(t.dataset.tool); else openToolbox();
    });
    setTimeout(function () {
      document.addEventListener("mousedown", function off(e) { if (!m.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) { m.remove(); document.removeEventListener("mousedown", off, true); } }, true);
    }, 0);
  }
  function openToolbox() { if (GIS.enterMapMode) GIS.enterMapMode(); build(); activateSidebarPanel(PANEL); }

  GIS.processing = { build: build, open: openTool, menu: menu, openToolbox: openToolbox, TOOLS: TOOLS, ensureTurf: ensureTurf, toWKT: toWKT, fromWKT: fromWKT };
})();
