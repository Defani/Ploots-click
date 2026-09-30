/* ==========================================================================
   GIS — layout items: legend, scale bar, north arrow, inset map.

   Like QGIS print-layout items, each is a free object on the page (a Fabric
   group or image) that can be moved, resized and layered like any shape,
   and stays linked to the map:
     - scale bar      redrawn from the map's metres-per-pixel on every move
     - north arrow    follows the map rotation (optional)
     - legend         rebuilt from the layers' symbology
     - inset map      an overview map rendered off-screen, with the main
                      map's extent drawn on it; refreshed when the view settles

   Each item carries gisItem (type) and gisOpts (settings). A rebuild swaps
   the object for a new one at the same place and z-order, with the undo
   history paused so panning the map doesn't create undo steps.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var INK = "#1a1a1a";

  var DEFAULTS = {
    legend: { title: "Legend", fontSize: 11, frame: true, background: "#ffffff", showLayerNames: true, boxW: 0, boxH: 0, hidden: [], hiddenEntries: {}, onlyVisible: true },
    scalebar: { style: "single", segments: 4, units: "auto", width: 170, height: 6, fontSize: 10, frame: false, color: INK, labels: "all" },
    north: { style: "arrow", size: 56, color: INK, fill2: "#ffffff", label: true, followMap: true },
    inset: { basemap: "positron", zoomOffset: -4, w: 220, h: 160, extentColor: "#e03131", showLayers: false, frameWidth: 1 },
    colorbar: { layerId: null, mode: "auto", classes: 6, orientation: "horizontal", length: 220, thickness: 12, extend: "neither", ticks: 5, decimals: -1, title: "", fontSize: 10, frame: true, color: INK }
  };
  GIS.ITEM_DEFAULTS = DEFAULTS;

  function fc() { return window.fabricCanvas; }
  function font() { return state.fontBody || "Poppins"; }
  function items() { return fc() ? fc().getObjects().filter(function (o) { return o.gisItem; }) : []; }

  function text(str, x, y, size, opts) {
    return new fabric.Text(String(str), Object.assign({ left: x, top: y, fontSize: size, fontFamily: font(), fill: INK, selectable: false, evented: false }, opts || {}));
  }
  function rect(x, y, w, h, fill, stroke, sw) {
    return new fabric.Rect({ left: x, top: y, width: w, height: h, fill: fill, stroke: stroke || null, strokeWidth: stroke ? (sw || 1) : 0, selectable: false, evented: false, strokeUniform: true });
  }
  function path(d, fill, stroke, sw) {
    return new fabric.Path(d, { fill: fill, stroke: stroke || null, strokeWidth: stroke ? (sw || 1) : 0, selectable: false, evented: false, strokeLineJoin: "round" });
  }

  /* ------------------------------------------------------------ north */

  function rot(pts, deg) {
    var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return pts.map(function (p) { return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; });
  }
  function poly(pts, deg, cx, cy) { return "M" + rot(pts, deg).map(function (p) { return (p[0] + cx).toFixed(2) + "," + (p[1] + cy).toFixed(2); }).join("L") + "Z"; }

  function buildNorth(o) {
    var S = o.size, R = S / 2, c = o.color, deg = o.followMap && GIS.map() ? -GIS.map().getBearing() : 0;
    var cx = R, cy = R + S * 0.18, parts = [rect(0, 0, S, S * 1.18, "rgba(0,0,0,0)")];
    var fs = Math.max(9, S * 0.24);
    var F = o.fill2 || "#ffffff";
    function tri(pts, fill, stroke, sw, d) { parts.push(path(poly(pts, d == null ? deg : d, cx, cy), fill, stroke, sw)); }
    function circ(r, fill, stroke, sw) { parts.push(new fabric.Circle({ left: cx, top: cy, radius: r, originX: "center", originY: "center", fill: fill || "rgba(0,0,0,0)", stroke: stroke || null, strokeWidth: stroke ? (sw || 1) : 0, selectable: false, evented: false })); }
    function seg(p1, p2, w, d) { var l = rot([p1, p2], d == null ? deg : d); parts.push(new fabric.Line([l[0][0] + cx, l[0][1] + cy, l[1][0] + cx, l[1][1] + cy], { stroke: c, strokeWidth: w, selectable: false, evented: false, strokeLineCap: "round" })); }
    // One compass point: two halves, dark on the right or the left.
    function point(len, w, d, darkRight) { tri([[0, -len], [w, 0], [0, 0]], darkRight ? c : F, c, 0.7, d); tri([[0, -len], [-w, 0], [0, 0]], darkRight ? F : c, c, 0.7, d); }
    function cardinals() {
      if (o.label === false) return;
      ["N", "E", "S", "W"].forEach(function (L, i) {
        var p = rot([[0, -R * 0.98]], deg + i * 90)[0];
        parts.push(text(L, cx + p[0], cy + p[1], i ? fs * 0.7 : fs, { originX: "center", originY: "center", fontWeight: "bold", fill: c }));
      });
    }
    function nLabel(x, y) {
      if (o.label === false) return;
      var p = rot([[0, -R * 0.98]], deg)[0];
      parts.push(text("N", cx + p[0], cy + p[1] - fs * 0.35, fs, { originX: "center", originY: "center", fontWeight: "bold", fill: c }));
    }
    var a = R * 0.72, b = R * 0.24;
    switch (o.style) {
      case "diamond":
        tri([[0, -a], [b, 0], [0, 0]], c); tri([[0, -a], [-b, 0], [0, 0]], F, c, 1);
        tri([[0, a], [b, 0], [0, 0]], F, c, 1); tri([[0, a], [-b, 0], [0, 0]], c);
        nLabel(); break;
      case "needle":
        var nw = b * 0.55;
        tri([[0, -a], [nw, 0], [-nw, 0]], c); tri([[0, a], [nw, 0], [-nw, 0]], F, c, 1);
        circ(b * 0.28, F, c, 1); nLabel(); break;
      case "chevron":
        tri([[0, -a], [a * 0.62, a * 0.6], [0, a * 0.12], [-a * 0.62, a * 0.6]], c); nLabel(); break;
      case "block":
        tri([[0, -a], [b * 1.5, -a + b * 1.8], [b * 0.5, -a + b * 1.8], [b * 0.5, a], [-b * 0.5, a], [-b * 0.5, -a + b * 1.8], [-b * 1.5, -a + b * 1.8]], c); nLabel(); break;
      case "arrowN":
        tri([[0, -a], [b, -a * 0.2], [0, -a * 0.38]], c); tri([[0, -a], [-b, -a * 0.2], [0, -a * 0.38]], F, c, 1);
        var np = rot([[0, a * 0.42]], deg)[0];
        parts.push(text("N", cx + np[0], cy + np[1], fs * 1.7, { originX: "center", originY: "center", fontWeight: "bold", fill: c, angle: deg }));
        break;
      case "minimal":
        tri([[0, -a], [b * 0.8, -a + b * 1.4], [-b * 0.8, -a + b * 1.4]], c);
        var mp = rot([[0, a * 0.25]], deg)[0];
        parts.push(text("N", cx + mp[0], cy + mp[1], fs * 1.9, { originX: "center", originY: "center", fontWeight: "bold", fill: c, angle: deg }));
        break;
      case "compass16":
        [[22.5, 0.46, 0.34], [67.5, 0.46, 0.34], [112.5, 0.46, 0.34], [157.5, 0.46, 0.34], [202.5, 0.46, 0.34], [247.5, 0.46, 0.34], [292.5, 0.46, 0.34], [337.5, 0.46, 0.34]].forEach(function (q) { point(a * q[1], b * q[2], deg + q[0], false); });
        [45, 135, 225, 315].forEach(function (q) { point(a * 0.68, b * 0.5, deg + q, true); });
        [0, 90, 180, 270].forEach(function (q, i) { point(a, b * 0.7, deg + q, i % 2 === 0); });
        cardinals(); break;
      case "nautical":
        circ(a * 0.95, null, c, Math.max(1, S * 0.02)); circ(a * 0.8, null, c, Math.max(0.6, S * 0.012));
        for (var t = 0; t < 360; t += 10) { var lg = t % 30 === 0; seg([0, -a * 0.95], [0, -a * (lg ? 0.8 : 0.87)], Math.max(0.6, S * 0.012), deg + t); }
        [45, 135, 225, 315].forEach(function (q) { point(a * 0.45, b * 0.4, deg + q, true); });
        [0, 90, 180, 270].forEach(function (q, i) { point(a * 0.78, b * 0.55, deg + q, i % 2 === 0); });
        cardinals(); break;
      case "ring":
        circ(a * 0.95, null, c, Math.max(1.2, S * 0.035)); circ(a * 0.8, null, c, Math.max(0.6, S * 0.015));
        tri([[0, -a * 0.72], [b * 0.85, a * 0.5], [0, a * 0.25]], c); tri([[0, -a * 0.72], [-b * 0.85, a * 0.5], [0, a * 0.25]], F, c, 0.8);
        nLabel(); break;
      case "disc":
        circ(a * 0.92, c);
        tri([[0, -a * 0.72], [b * 0.9, a * 0.5], [0, a * 0.22], [-b * 0.9, a * 0.5]], F);
        nLabel(); break;
      case "badge":
        parts.push(new fabric.Rect({ left: cx - a, top: cy - a, width: 2 * a, height: 2 * a, rx: S * 0.1, ry: S * 0.1, fill: F, stroke: c, strokeWidth: Math.max(1, S * 0.03), selectable: false, evented: false }));
        tri([[0, -a * 0.75], [b * 0.9, a * 0.55], [0, a * 0.25], [-b * 0.9, a * 0.55]], c);
        nLabel(); break;
      case "tail":
        seg([0, -a * 0.4], [0, a * 0.95], Math.max(1.4, S * 0.05));
        tri([[0, -a], [b, -a * 0.35], [-b, -a * 0.35]], c);
        tri([[0, a * 0.5], [b * 0.8, a * 0.95], [b * 0.8, a * 0.72], [0, a * 0.28]], c); tri([[0, a * 0.5], [-b * 0.8, a * 0.95], [-b * 0.8, a * 0.72], [0, a * 0.28]], c);
        nLabel(); break;
      case "shaded":
        tri([[0, -a], [b * 1.2, a * 0.7], [0, a * 0.35]], c);
        parts.push(path(poly([[0, -a], [-b * 1.2, a * 0.7], [0, a * 0.35]], deg, cx, cy), c)); parts[parts.length - 1].set("opacity", 0.45);
        nLabel(); break;
      case "trueMag":
        seg([0, a * 0.95], [0, -a * 0.62], Math.max(1, S * 0.03));
        var sp = [], st = -a * 0.8;
        for (var k = 0; k < 10; k++) { var rr = k % 2 ? b * 0.22 : b * 0.55, an = k * Math.PI / 5; sp.push([Math.sin(an) * rr, st - Math.cos(an) * rr]); }
        tri(sp, c);
        seg([0, a * 0.95], [0, -a * 0.55], Math.max(1, S * 0.025), deg + 10);
        tri([[0, -a * 0.72], [b * 0.4, -a * 0.45], [0, -a * 0.5]], c, null, 0, deg + 10);
        var mn = rot([[0, -a * 0.95]], deg + 16)[0];
        parts.push(text("MN", cx + mn[0] + fs * 0.5, cy + mn[1], fs * 0.55, { originX: "center", originY: "center", fontWeight: "bold", fill: c }));
        break;
      case "half":
        parts.push(path(poly([[0, -a], [b, a], [0, a * 0.55]], deg, cx, cy), c));
        parts.push(path(poly([[0, -a], [-b, a], [0, a * 0.55]], deg, cx, cy), F, c, 1));
        nLabel(); break;
      case "compass4":
        [[0, 1], [90, 0], [180, 1], [270, 0]].forEach(function (q) {
          parts.push(path(poly([[0, -a], [b * 0.8, 0], [0, 0]], deg + q[0], cx, cy), q[1] ? c : F, c, 0.8));
          parts.push(path(poly([[0, -a], [-b * 0.8, 0], [0, 0]], deg + q[0], cx, cy), q[1] ? F : c, c, 0.8));
        });
        nLabel(); break;
      case "compass8":
        [45, 135, 225, 315].forEach(function (q) {
          parts.push(path(poly([[0, -a * 0.62], [b * 0.55, 0], [-b * 0.55, 0]], deg + q, cx, cy), F, c, 0.7));
        });
        [0, 90, 180, 270].forEach(function (q, i) {
          parts.push(path(poly([[0, -a], [b * 0.7, 0], [0, 0]], deg + q, cx, cy), i % 2 ? F : c, c, 0.8));
          parts.push(path(poly([[0, -a], [-b * 0.7, 0], [0, 0]], deg + q, cx, cy), i % 2 ? c : F, c, 0.8));
        });
        ["N", "E", "S", "W"].forEach(function (L, i) {
          var p = rot([[0, -R * 0.98]], deg + i * 90)[0];
          parts.push(text(L, cx + p[0], cy + p[1], i ? fs * 0.7 : fs, { originX: "center", originY: "center", fontWeight: "bold", fill: c }));
        });
        break;
      case "triangle":
        parts.push(path(poly([[0, -a], [a * 0.55, a * 0.75], [-a * 0.55, a * 0.75]], deg, cx, cy), c));
        nLabel(); break;
      case "line":
        parts.push(path(poly([[0, -a], [b * 0.9, -a + b * 1.6], [0, -a + b * 1.2], [-b * 0.9, -a + b * 1.6]], deg, cx, cy), c));
        var l1 = rot([[0, -a + b], [0, a]], deg);
        parts.push(new fabric.Line([l1[0][0] + cx, l1[0][1] + cy, l1[1][0] + cx, l1[1][1] + cy], { stroke: c, strokeWidth: Math.max(1.2, S * 0.04), selectable: false, evented: false }));
        nLabel(); break;
      case "circle":
        parts.push(new fabric.Circle({ left: cx, top: cy, radius: a * 0.95, originX: "center", originY: "center", fill: "rgba(0,0,0,0)", stroke: c, strokeWidth: Math.max(1, S * 0.03), selectable: false, evented: false }));
        parts.push(path(poly([[0, -a * 0.85], [b, a * 0.5], [0, a * 0.25]], deg, cx, cy), c));
        parts.push(path(poly([[0, -a * 0.85], [-b, a * 0.5], [0, a * 0.25]], deg, cx, cy), F, c, 0.8));
        nLabel(); break;
      case "star":
        parts.push(new fabric.Circle({ left: cx, top: cy, radius: a * 0.55, originX: "center", originY: "center", fill: "rgba(0,0,0,0)", stroke: c, strokeWidth: 1, selectable: false, evented: false }));
        [0, 90, 180, 270].forEach(function (q, i) {
          parts.push(path(poly([[0, -a], [b * 0.45, -b * 0.45], [0, 0]], deg + q, cx, cy), i ? F : c, c, 0.7));
          parts.push(path(poly([[0, -a], [-b * 0.45, -b * 0.45], [0, 0]], deg + q, cx, cy), c, c, 0.7));
        });
        nLabel(); break;
      default: // "arrow": split arrow
        parts.push(path(poly([[0, -a], [b, a], [0, a * 0.6]], deg, cx, cy), c));
        parts.push(path(poly([[0, -a], [-b, a], [0, a * 0.6]], deg, cx, cy), F, c, 1));
        nLabel();
    }
    return parts;
  }

  /* --------------------------------------------------------- scale bar */

  var UNITS = { m: 1, km: 1000, ft: 0.3048, mi: 1609.344, nmi: 1852 };
  function nice(x) {
    var p = Math.pow(10, Math.floor(Math.log10(x))), d = x / p;
    return (d >= 5 ? 5 : d >= 2.5 ? 2.5 : d >= 2 ? 2 : 1) * p;
  }
  function numFmt(v) {
    var a = Math.abs(v), d = a >= 100 ? 0 : a >= 1 ? 2 : 4;
    return (+v).toLocaleString("en-US", { maximumFractionDigits: d });
  }

  function scaleSpec(o) {
    var mpp = GIS.metresPerPixel ? GIS.metresPerPixel() : 0;
    if (!mpp) return null;
    var n = Math.max(1, Math.min(10, o.segments | 0 || 4));
    var unit = o.units;
    if (unit === "auto") unit = o.width * mpp >= 1000 ? "km" : "m";
    if (unit === "auto-imperial") unit = o.width * mpp >= 1609 ? "mi" : "ft";
    var per = UNITS[unit] || 1;
    var seg = nice(o.width * mpp / per / n);
    return { unit: unit, seg: seg, n: n, segPx: seg * per / mpp, scale: GIS.getScale() };
  }

  function buildScale(o) {
    var sp = scaleSpec(o), c = o.color, fs = o.fontSize, h = o.height, parts = [];
    if (!sp) return [text("Scale bar: map not ready", 0, 0, fs)];
    if (o.style === "numeric") {
      var t = text("1:" + Math.round(sp.scale).toLocaleString("en-US"), 0, 0, fs + 2, { fill: c });
      if (o.frame) parts.push(rect(-6, -4, t.width + 12, t.height + 8, "#fff", "#9a978c", 0.8));
      parts.push(t);
      return parts;
    }
    var w = sp.segPx, n = sp.n, top = fs + 4, total = w * n;
    if (o.frame) parts.push(rect(-8, -4, total + 16 + fs * 2.2, top + h * (o.style === "double" ? 2 : 1) + 10, "#fff", "#9a978c", 0.8));
    var line = function (x1, y1, x2, y2) { parts.push(new fabric.Line([x1, y1, x2, y2], { stroke: c, strokeWidth: 1.2, selectable: false, evented: false, strokeLineCap: "square" })); };
    switch (o.style) {
      case "double":
        for (var i = 0; i < n; i++) {
          parts.push(rect(i * w, top, w, h, i % 2 ? "#fff" : c, c, 0.8));
          parts.push(rect(i * w, top + h, w, h, i % 2 ? c : "#fff", c, 0.8));
        }
        break;
      case "ticks-middle": case "ticks-down": case "ticks-up":
        var y = o.style === "ticks-up" ? top + h : o.style === "ticks-down" ? top : top + h / 2;
        line(0, y, total, y);
        for (var j = 0; j <= n; j++) {
          var y1 = o.style === "ticks-up" ? top : top, y2 = o.style === "ticks-down" ? top + h : top + h;
          if (o.style === "ticks-middle") { y1 = top; y2 = top + h; }
          line(j * w, y1, j * w, y2);
        }
        break;
      case "stepped":
        var d = "M0," + (top + h);
        for (var k = 0; k < n; k++) d += "L" + (k * w) + "," + (k % 2 ? top + h : top) + "L" + ((k + 1) * w) + "," + (k % 2 ? top + h : top);
        d += "L" + total + "," + (top + h);
        parts.push(path(d, null, c, 1.2));
        break;
      case "hollow":
        parts.push(rect(0, top, total, h, "#fff", c, 1));
        for (var q = 0; q < n; q += 2) parts.push(rect(q * w, top + h / 2, w, h / 2, c));
        break;
      default: // single box
        for (var m = 0; m < n; m++) parts.push(rect(m * w, top, w, h, m % 2 ? "#fff" : c, c, 0.8));
    }
    // Labels that would touch are thinned to the ends (and the middle).
    var widest = text(numFmt(sp.seg * n) + " " + sp.unit, 0, 0, fs).width;
    var crowded = w < widest * 0.75 + 6;
    var every = o.labels === "ends" || crowded ? (n % 2 === 0 && n > 2 && w * n / 2 > widest ? [0, n / 2, n] : [0, n]) : d3.range(0, n + 1);
    every.forEach(function (k2) {
      var label = numFmt(sp.seg * k2) + (k2 === n ? " " + sp.unit : "");
      parts.push(text(label, k2 * w, 0, fs, { originX: k2 === 0 ? "left" : "center", fill: c }));
    });
    return parts;
  }

  /* ------------------------------------------------------------ legend */

  function lname(l) { return l.legendName || l.name; }

  // Layers a legend lists: visible (unless the legend also lists hidden
  // layers), not a tile layer, "Show in legend" on, and not removed from
  // this legend.
  GIS.legendLayers = function (o) {
    o = o || {};
    return GIS.layers.filter(function (l) {
      return l.kind !== "xyz" && (l.visible || o.onlyVisible === false) && l.legend !== false && (o.hidden || []).indexOf(l.id) < 0;
    });
  };

  function buildLegend(o) {
    // Spacing (Legend ▸ Spacing): rows, symbol size, symbol-label gap, columns, padding.
    var fs = o.fontSize, row = fs + (o.rowGap != null ? +o.rowGap : 8), sw = +o.symbolW || 18, lg = o.labelGap != null ? +o.labelGap : 8, pad = o.pad != null ? +o.pad : 10, parts = [], y = pad, maxW = 0;
    var bg = rect(0, 0, 10, 10, o.background || "rgba(0,0,0,0)", o.frame ? "#9a978c" : null, 0.8);
    parts.push(bg);
    if (o.title) {
      var t = text(o.title, pad, y, fs + 2, { fontWeight: "bold" });
      parts.push(t); maxW = t.width; y += t.height + 6;
    }
    var titleBottom = y, blk = -1, blockTop = [], blockW = [];
    function newBlock() { blk++; blockTop[blk] = y; blockW[blk] = 0; }
    function add() {
      for (var i = 0; i < arguments.length; i++) {
        var p = arguments[i];
        p.__blk = blk;
        p.setCoords();
        var br = p.getBoundingRect(true, true);
        blockW[blk] = Math.max(blockW[blk], br.left + br.width - pad);
        parts.push(p);
      }
    }
    var layers = GIS.legendLayers(o);
    layers.forEach(function (l) {
      var hiddenE = (o.hiddenEntries || {})[l.id] || [];
      var entries = GIS.sym.legendEntries(l).filter(function (e) { return hiddenE.indexOf(String(e.label)) < 0; }), kind = l.kind === "vector" ? GIS.geometryKind(l) : "raster";
      var ren = l.kind === "vector" ? l.style.renderer || "simple" : "simple";
      // Heatmap: the layer name and a Low -> High ramp.
      if (ren === "heatmap") {
        newBlock();
        var hh = text(lname(l), pad, y, fs, { fontWeight: "bold" });
        add(hh); maxW = Math.max(maxW, hh.width); y += row;
        newBlock();
        var hw = Math.max(100, fs * 10), hc = GIS.sym.rampColors(l.style.heatRamp, false);
        var hb = new fabric.Rect({ left: pad, top: y, width: hw, height: 10, stroke: "#9a978c", strokeWidth: 0.6, selectable: false, evented: false });
        hb.set("fill", new fabric.Gradient({ type: "linear", coords: { x1: 0, y1: 0, x2: hw, y2: 0 },
          colorStops: [{ offset: 0, color: "rgba(255,255,255,0)" }].concat(hc.map(function (c, i) { return { offset: 0.08 + 0.92 * i / (hc.length - 1 || 1), color: c }; })) }));
        add(hb, text("Low", pad, y + 13, fs - 1, { fill: "#4a4a46" }), text("High", pad + hw, y + 13, fs - 1, { originX: "right", fill: "#4a4a46" }));
        maxW = Math.max(maxW, hw); y += 13 + fs + 8;
        return;
      }
      var sizes = ren === "proportional" && l.style.sizeField ? GIS.sym.sizeLegend(l) : null;
      // Proportional circles: nested reference circles with leader lines.
      function drawSizes(fill) {
        if (!sizes || !sizes.length) return;
        newBlock();
        var rMax = sizes[0].r, cx = pad + rMax, base = y + 2 * rMax, lx = pad + 2 * rMax + 10;
        var st = text(l.style.sizeField, pad, y, fs - 1, { fill: "#4a4a46", fontStyle: "italic" });
        add(st); y += st.height + 4; base = y + 2 * rMax;
        sizes.forEach(function (sr) {
          add(new fabric.Circle({ left: cx, top: base - sr.r, radius: sr.r, originX: "center", originY: "center", fill: fill || "rgba(0,0,0,0)",
            opacity: fill ? Math.max(0.15, l.style.fillOpacity) : 1, stroke: INK, strokeWidth: 0.8, selectable: false, evented: false }));
          var ty = base - 2 * sr.r;
          add(new fabric.Line([cx, ty, lx - 3, ty], { stroke: "#8a8a8a", strokeWidth: 0.6, strokeDashArray: [2, 2], selectable: false, evented: false }));
          var tv = text(numFmt(sr.value), lx, ty - fs * 0.62, fs);
          add(tv); maxW = Math.max(maxW, lx - pad + tv.width);
        });
        y = base + 10;
      }
      // Single symbol: one row, swatch + layer name. Otherwise an optional
      // bold layer heading, then one row per class/category.
      if (sizes && entries.length === 1 && !entries[0].label) {
        newBlock();
        var ph = text(lname(l), pad, y, fs, { fontWeight: "bold" });
        add(ph); maxW = Math.max(maxW, ph.width); y += row;
        drawSizes(entries[0].color);
        return;
      }
      if (entries.length === 1 && !entries[0].label) {
        newBlock();
        var one = text(lname(l), pad + sw + lg, y + row / 2 - 2 - fs * 0.62, fs);
        drawSwatch(entries[0].color, l, kind, pad, y + row / 2 - 2);
        add(one); maxW = Math.max(maxW, sw + lg + one.width); y += row;
        return;
      }
      if (o.showLayerNames) {
        newBlock();
        var hdr = text(lname(l), pad, y, fs, { fontWeight: "bold" });
        add(hdr); maxW = Math.max(maxW, hdr.width); y += row;
      }
      if (l.kind === "raster" && l.raster.legend && l.raster.legend.classColors) {
        var dl = l.raster.legend;
        dl.classColors.slice().reverse().forEach(function (c, ri) {
          newBlock();
          var i = dl.classColors.length - 1 - ri, cy2 = y + row / 2 - 2;
          add(new fabric.Rect({ left: pad, top: cy2 - 6, width: sw, height: 12, fill: c, stroke: "#9a978c", strokeWidth: 0.6, selectable: false, evented: false }));
          var tl = text(numFmt(dl.breaks[i]) + " – " + numFmt(dl.breaks[i + 1]), pad + sw + lg, cy2 - fs * 0.62, fs);
          add(tl); maxW = Math.max(maxW, sw + lg + tl.width); y += row;
        });
        return;
      }
      if (l.kind === "raster" && l.raster.legend) {
        newBlock();
        var lg = l.raster.legend, gw = 14, gh = Math.max(60, fs * 6);
        var grad = new fabric.Rect({ left: pad, top: y, width: gw, height: gh, selectable: false, evented: false, stroke: "#9a978c", strokeWidth: 0.6 });
        grad.set("fill", new fabric.Gradient({ type: "linear", coords: { x1: 0, y1: 0, x2: 0, y2: gh },
          colorStops: lg.colors.map(function (c, i) { return { offset: i / (lg.colors.length - 1 || 1), color: c }; }).reverse().map(function (s, i, arr) { return { offset: i / (arr.length - 1 || 1), color: s.color }; }) }));
        add(grad);
        var hi = text(numFmt(lg.max), pad + gw + 8, y - 2, fs), lo = text(numFmt(lg.min), pad + gw + 8, y + gh - fs - 2, fs);
        add(hi, lo); maxW = Math.max(maxW, gw + 8 + Math.max(hi.width, lo.width)); y += gh + 8;
        return;
      }
      entries.forEach(function (e) {
        newBlock();
        var cy = y + row / 2 - 2;
        if (e.color) drawSwatch(e.color, l, kind, pad, cy);
        var t2 = text(e.label || lname(l), pad + (e.color ? sw + lg : 0), cy - fs * 0.62, fs);
        add(t2); maxW = Math.max(maxW, (e.color ? sw + lg : 0) + t2.width); y += row;
      });
      if (sizes) { y += 4; drawSizes(null); }
    });
    function drawSwatch(color, l, kind, x, cy) {
      var s = l.style || { fillOpacity: 0.45, strokeWidth: 0.8, strokeColor: "#9a978c", lineWidth: 1, pointRadius: 4, renderer: "simple" };
      if (s && s.renderer === "proportional") kind = "point";
      var so = s.strokeOpacity != null ? +s.strokeOpacity : 1;
      if (kind === "line") {
        if (s.lineCasing && s.strokeWidth > 0) add(new fabric.Line([x, cy, x + sw, cy], { stroke: s.strokeColor, opacity: so, strokeWidth: Math.min(10, s.lineWidth + 1 + 2 * s.strokeWidth), strokeLineCap: "round", selectable: false, evented: false }));
        add(new fabric.Line([x, cy, x + sw, cy], { stroke: color, strokeWidth: Math.min(6, s.lineWidth + 1), strokeLineCap: "round", selectable: false, evented: false }));
      }
      else if (kind === "point") add(new fabric.Circle({ left: x + sw / 2, top: cy, originX: "center", originY: "center", radius: Math.min(7, s.pointRadius), fill: color, stroke: s.strokeWidth > 0 ? s.strokeColor : null, strokeWidth: Math.min(2, s.strokeWidth), selectable: false, evented: false }));
      else {
        // The patch's fill takes the fill opacity; its outline follows the
        // layer's outline (a white one shows grey on the white legend).
        add(new fabric.Rect({ left: x, top: cy - 6, width: sw, height: 12, fill: color, opacity: Math.max(0.15, s.fillOpacity), selectable: false, evented: false }));
        if (s.strokeWidth > 0) add(new fabric.Rect({ left: x, top: cy - 6, width: sw, height: 12, fill: "rgba(0,0,0,0)", opacity: so, stroke: /^#?f{3,6}$/i.test(s.strokeColor) ? "#9a978c" : s.strokeColor, strokeWidth: Math.min(3, Math.max(0.6, s.strokeWidth)), strokeDashArray: s.strokeDash && s.strokeDash !== "solid" ? (s.strokeDash === "dot" ? [1, 2] : [4, 2]) : null, strokeUniform: true, selectable: false, evented: false }));
      }
    }
    if (!layers.length) { var e0 = text("No layers", pad, y, fs, { fill: "#8a8a8a" }); parts.push(e0); maxW = e0.width; y += row; }
    blockTop.push(y);
    var avail = o.boxH > 0 ? Math.max(row, o.boxH - titleBottom - pad) : Infinity, gap = o.colGap != null ? +o.colGap : 16;
    var col = 0, colY = 0, colOf = [], shiftY = [], colW = [0], colH = [0];
    for (var k = 0; k <= blk; k++) {
      var h = blockTop[k + 1] - blockTop[k];
      if (colY > 0 && colY + h > avail) { col++; colY = 0; colW[col] = 0; colH[col] = 0; }
      colOf[k] = col; shiftY[k] = titleBottom + colY - blockTop[k];
      colY += h; colW[col] = Math.max(colW[col], blockW[k]); colH[col] = colY;
    }
    var colX = [0];
    for (var c = 1; c < colW.length; c++) colX[c] = colX[c - 1] + colW[c - 1] + gap;
    parts.forEach(function (p) {
      if (p.__blk === undefined || p.__blk < 0) return;
      p.set({ left: p.left + colX[colOf[p.__blk]], top: p.top + shiftY[p.__blk] });
    });
    var contentW = Math.max(maxW, colX[colW.length - 1] + colW[colW.length - 1]);
    var contentH = titleBottom + d3.max(colH) + pad - 4;
    bg.set({ width: Math.max(contentW + pad * 2, o.boxW || 0), height: Math.max(contentH, o.boxH || 0) });
    return parts;
  }

  /* --------------------------------------------------------- color bar */

  // Like matplotlib's colorbar: a continuous gradient or discrete blocks,
  // square ends or pointed "extend" ends (both / min / max), horizontal or
  // vertical, with ticks and a title. Its source is a raster layer or a
  // graduated vector layer (the chosen one, else the first that fits).
  function colorbarSource(o) {
    function fits(l) { return l && ((l.kind === "raster" && l.raster.legend) || (l.kind === "vector" && l.style.symbology === "graduated" && l.style.field)); }
    var layer = GIS.get(o.layerId);
    if (!fits(layer)) layer = GIS.layers.filter(fits)[0];
    if (!layer) return null;
    if (layer.kind === "raster") {
      var lg = layer.raster.legend;
      return { layer: layer, min: lg.min, max: lg.max, ramp: lg.colors, classes: lg.classColors, breaks: lg.breaks };
    }
    var cls = GIS.sym.classes(layer);
    if (!cls.colors.length) return null;
    return { layer: layer, min: cls.lo, max: cls.hi, ramp: cls.colors, classes: cls.colors, breaks: [cls.lo].concat(cls.breaks).concat([cls.hi]) };
  }

  function buildColorbar(o) {
    var src = colorbarSource(o), fs = o.fontSize, c = o.color, parts = [];
    if (!src) return [text("Color bar: add a raster or a graduated layer", 0, 0, fs, { fill: "#8a8a8a" })];
    var L = o.length, T = o.thickness, vert = o.orientation === "vertical", span = (src.max - src.min) || 1;
    var tri = Math.max(6, T * 1.15);
    var e0 = o.extend === "both" || o.extend === "min" ? tri : 0, e1 = o.extend === "both" || o.extend === "max" ? tri : 0;
    // (a along the bar from min, b across it) -> local x, y; vertical bars
    // run bottom (min) to top (max).
    function P(a, b) { return vert ? [b, e1 + L - a] : [e0 + a, b]; }
    function poly(pts, fill, stroke) {
      return new fabric.Polygon(pts.map(function (p) { return { x: p[0], y: p[1] }; }), { fill: fill, stroke: stroke || null, strokeWidth: stroke ? 0.8 : 0, selectable: false, evented: false, objectCaching: false });
    }

    var discrete = o.mode === "discrete" || (o.mode === "auto" && !!src.classes);
    var blocks, bounds;
    if (discrete) {
      if (src.classes && o.mode === "auto") { blocks = src.classes; bounds = src.breaks; }
      else {
        var n = Math.max(2, Math.min(20, o.classes | 0 || 6)), it = d3.interpolateRgbBasis(src.ramp);
        blocks = d3.range(n).map(function (i) { return d3.color(it(i / (n - 1))).formatHex(); });
        bounds = d3.range(n + 1).map(function (i) { return src.min + span * i / n; });
      }
      // Equal-sized blocks (matplotlib's uniform spacing) with boundary ticks.
      blocks.forEach(function (col, i) {
        var a0 = L * i / blocks.length, a1 = L * (i + 1) / blocks.length;
        parts.push(poly([P(a0, 0), P(a1, 0), P(a1, T), P(a0, T)], col));
      });
    } else {
      var p0 = P(0, 0), p1 = P(L, T);
      var r = new fabric.Rect({ left: Math.min(p0[0], p1[0]), top: Math.min(p0[1], p1[1]), width: vert ? T : L, height: vert ? L : T, selectable: false, evented: false });
      var stops = src.ramp.map(function (col, i) { return { offset: i / (src.ramp.length - 1 || 1), color: col }; });
      r.set("fill", new fabric.Gradient({ type: "linear", coords: vert ? { x1: 0, y1: L, x2: 0, y2: 0 } : { x1: 0, y1: 0, x2: L, y2: 0 }, colorStops: stops }));
      parts.push(r);
    }
    var first = discrete ? blocks[0] : src.ramp[0], last = discrete ? blocks[blocks.length - 1] : src.ramp[src.ramp.length - 1];
    if (e0) parts.push(poly([P(0, 0), P(0, T), P(-e0, T / 2)], first));
    if (e1) parts.push(poly([P(L, 0), P(L, T), P(L + e1, T / 2)], last));
    var outline = [P(0, 0), P(L, 0)];
    if (e1) outline.push(P(L + e1, T / 2));
    outline.push(P(L, T), P(0, T));
    if (e0) outline.push(P(-e0, T / 2));
    parts.push(poly(outline, "rgba(0,0,0,0)", c));
    if (discrete) for (var k = 1; k < blocks.length; k++) {
      var d0 = P(L * k / blocks.length, 0), d1 = P(L * k / blocks.length, T);
      parts.push(new fabric.Line([d0[0], d0[1], d1[0], d1[1]], { stroke: c, strokeWidth: 0.5, selectable: false, evented: false }));
    }

    // Ticks and labels on the outer side (below / right).
    var values = discrete ? bounds.slice() : d3.ticks(src.min, src.max, Math.max(2, o.ticks | 0)).filter(function (v) { return v >= src.min - 1e-9 && v <= src.max + 1e-9; });
    if (discrete && values.length > 2) {
      var perTick = L / (values.length - 1), wmax = d3.max(values, function (v) { return text(fmtTick(v), 0, 0, fs).width; });
      if (!vert && perTick < wmax + 4) { var step = Math.ceil((wmax + 4) / perTick); values = values.filter(function (v, i) { return i % step === 0 || i === values.length - 1; }); }
      if (vert && perTick < fs + 2) { var step2 = Math.ceil((fs + 2) / perTick); values = values.filter(function (v, i) { return i % step2 === 0 || i === values.length - 1; }); }
    }
    function fmtTick(v) { return o.decimals >= 0 ? (+v).toFixed(o.decimals) : numFmt(v); }
    function posOf(v, i) { return discrete ? L * bounds.indexOf(v) / blocks.length : (v - src.min) / span * L; }
    var maxLabel = 0;
    values.forEach(function (v, i) {
      var a = posOf(v, i), t0 = P(a, T), t1 = P(a, T + 4);
      parts.push(new fabric.Line([t0[0], t0[1], t1[0], t1[1]], { stroke: c, strokeWidth: 0.8, selectable: false, evented: false }));
      var lp = P(a, T + 6), lbl = text(fmtTick(v), lp[0], lp[1], fs, { fill: c });
      if (vert) lbl.set({ originY: "center" }); else lbl.set({ originX: "center" });
      maxLabel = Math.max(maxLabel, vert ? lbl.width : lbl.height);
      parts.push(lbl);
    });
    if (o.title) {
      if (vert) parts.push(text(o.title, T + 6 + maxLabel + 6 + fs * 0.6, e1 + L / 2, fs + 1, { originX: "center", originY: "center", angle: -90, fill: c }));
      else parts.push(text(o.title, e0 + L / 2, -fs - 8, fs + 1, { originX: "center", fill: c }));
    }
    if (o.frame) {
      var tmp = new fabric.Group(parts), pad = 8;
      var bx = tmp.left, by = tmp.top, bw = tmp.width, bh = tmp.height;
      tmp.destroy();
      parts.unshift(rect(bx - pad, by - pad, bw + pad * 2, bh + pad * 2, "#ffffff", "#9a978c", 0.8));
    }
    return parts;
  }

  /* ------------------------------------------------------------- inset */

  var inset = { map: null, div: null, busy: null };

  function insetMap(o) {
    return PlootsLazy.ensureMapLibre().then(function () {
      if (!inset.div) {
        inset.div = document.createElement("div");
        inset.div.style.cssText = "position:fixed;left:-10000px;top:0;width:10px;height:10px;";
        document.body.appendChild(inset.div);
      }
      inset.div.style.width = Math.round(o.w) + "px";
      inset.div.style.height = Math.round(o.h) + "px";
      var style = GIS.styleFor(o.basemap);
      if (!inset.map) {
        inset.map = new maplibregl.Map({ container: inset.div, style: style, interactive: false, attributionControl: false,
          canvasContextAttributes: { preserveDrawingBuffer: true }, preserveDrawingBuffer: true, fadeDuration: 0, pixelRatio: 2 });
        inset.basemap = o.basemap;
      } else {
        inset.map.resize();
        if (inset.basemap !== o.basemap) { inset.basemap = o.basemap; inset.map.setStyle(style); }
      }
      return new Promise(function (res) { if (inset.map.loaded() && inset.map.isStyleLoaded()) res(inset.map); else inset.map.once("idle", function () { res(inset.map); }); });
    });
  }

  function renderInset(o) {
    var main = GIS.map();
    if (!main) return Promise.resolve(null);
    return insetMap(o).then(function (im) {
      // Optional: the layers themselves, drawn from the main map's sources.
      ["gis-inset-fill", "gis-inset-line"].forEach(function (id) { if (im.getLayer(id)) im.removeLayer(id); });
      if (im.getSource("gis-inset")) im.removeSource("gis-inset");
      if (o.showLayers) {
        var feats = [];
        GIS.vectors().forEach(function (l) { if (l.visible) feats = feats.concat(l.data.features); });
        im.addSource("gis-inset", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
        im.addLayer({ id: "gis-inset-fill", type: "fill", source: "gis-inset", filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false], paint: { "fill-color": "#7a8a86", "fill-opacity": 0.5 } });
        im.addLayer({ id: "gis-inset-line", type: "line", source: "gis-inset", paint: { "line-color": "#4a5a56", "line-width": 0.6 } });
      }
      var c = main.getCenter();
      im.jumpTo({ center: c, zoom: Math.max(0, main.getZoom() + (+o.zoomOffset || -4)), bearing: 0 });
      return new Promise(function (res) {
        im.once("idle", function () {
          var W = Math.round(o.w), H = Math.round(o.h), k = 2;
          var cv = document.createElement("canvas");
          cv.width = W * k; cv.height = H * k;
          var ctx = cv.getContext("2d");
          try { ctx.drawImage(im.getCanvas(), 0, 0, cv.width, cv.height); } catch (e) { }
          // Main map extent (its four corners, so rotation shows).
          var mc = main.getContainer(), cw = mc.clientWidth, ch = mc.clientHeight;
          var corners = [[0, 0], [cw, 0], [cw, ch], [0, ch]].map(function (p) { var ll = main.unproject(p); return im.project(ll); });
          ctx.save(); ctx.scale(k, k);
          ctx.beginPath();
          corners.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
          ctx.closePath();
          ctx.fillStyle = o.extentColor + "22"; ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = o.extentColor; ctx.stroke();
          if (o.frameWidth > 0) { ctx.lineWidth = o.frameWidth; ctx.strokeStyle = INK; ctx.strokeRect(o.frameWidth / 2, o.frameWidth / 2, W - o.frameWidth, H - o.frameWidth); }
          ctx.restore();
          res(cv.toDataURL("image/png"));
        });
        im.triggerRepaint();
      });
    });
  }

  /* ------------------------------------------------------- lifecycle */

  function pauseHistory(fn) {
    var prev = window.historyRestoring;
    window.historyRestoring = true;
    try { fn(); } finally { window.historyRestoring = prev; }
  }

  function makeGroup(type, opts) {
    var parts = type === "legend" ? buildLegend(opts) : type === "scalebar" ? buildScale(opts) : type === "colorbar" ? buildColorbar(opts) : buildNorth(opts);
    return new fabric.Group(parts, { subTargetCheck: false });
  }

  function place(obj, like, type) {
    var canvas = fc();
    obj.gisItem = type;
    obj.gisOpts = like ? like.gisOpts : obj.gisOpts;
    obj.layerName = { legend: "Legend", scalebar: "Scale bar", north: "North arrow", inset: "Inset map", colorbar: "Color bar" }[type];
    // A north arrow only scales proportionally (corner handles).
    if (type === "north") obj.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false });
    if (like) {
      obj.set({ left: like.left, top: like.top, scaleX: like.scaleX, scaleY: like.scaleY, angle: like.angle, originX: like.originX, originY: like.originY });
      if (like.lockMovementX) obj.set({ lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true, lockRotation: true });
      if (like.layerName) obj.layerName = like.layerName;
    }
    obj.setCoords();
    pauseHistory(function () {
      if (like) {
        var idx = canvas.getObjects().indexOf(like), wasActive = canvas.getActiveObject() === like;
        canvas.remove(like);
        canvas.insertAt(obj, Math.max(0, idx));
        if (wasActive) canvas.setActiveObject(obj);
      } else canvas.add(obj);
    });
    canvas.requestRenderAll();
    return obj;
  }

  function rebuild(obj) {
    if (!fc() || !obj || !obj.gisItem) return;
    var type = obj.gisItem, o = obj.gisOpts;
    if (type === "inset") {
      renderInset(o).then(function (url) {
        if (!url || fc().getObjects().indexOf(obj) < 0) return;
        pauseHistory(function () {
          obj.setSrc(url, function () {
            obj.set({ width: o.w * 2, height: o.h * 2, scaleX: obj.scaleX, scaleY: obj.scaleY });
            obj.setCoords(); fc().requestRenderAll();
          });
        });
      });
      return;
    }
    place(makeGroup(type, o), obj, type);
  }

  function add(type) {
    var canvas = fc();
    if (!canvas) return null;
    var o = JSON.parse(JSON.stringify(DEFAULTS[type]));
    var b = state.chartBox, m = 16, obj;
    if (type === "inset") {
      o.w = Math.round(Math.min(260, b.w * 0.28)); o.h = Math.round(o.w * 0.72);
      obj = new fabric.Image(document.createElement("canvas"), { left: b.x + m, top: b.y + m, width: o.w * 2, height: o.h * 2, scaleX: 0.5, scaleY: 0.5 });
      obj.gisOpts = o;
      place(obj, null, "inset");
      canvas.setActiveObject(obj);
      rebuild(obj);
      return obj;
    }
    var g = makeGroup(type, o);
    g.gisOpts = o;
    var w = g.width, h = g.height;
    var pos = type === "colorbar" ? [b.x + (b.w - w) / 2, b.y + b.h - h - m - 10] : type === "legend" ? [b.x + b.w - w - m, b.y + b.h - h - m] : type === "scalebar" ? [b.x + m + 8, b.y + b.h - h - m - 6] : [b.x + b.w - w - m, b.y + m];
    g.set({ left: pos[0], top: pos[1] });
    place(g, null, type);
    canvas.setActiveObject(g);
    canvas.requestRenderAll();
    if (typeof historyNotifyChange === "function") historyNotifyChange();
    return g;
  }

  function update(obj, patch) {
    if (!obj || !obj.gisItem) return;
    obj.gisOpts = Object.assign({}, obj.gisOpts, patch);
    rebuild(obj);
    if (typeof historyNotifyChange === "function") historyNotifyChange();
  }

  var pendingView = 0, pendingInset = 0;
  GIS.onView(function (final) {
    if (!pendingView) pendingView = requestAnimationFrame(function () {
      pendingView = 0;
      items().forEach(function (o) { if (o.gisItem === "scalebar" || (o.gisItem === "north" && o.gisOpts.followMap)) rebuild(o); });
    });
    if (final) { clearTimeout(pendingInset); pendingInset = setTimeout(function () { items().forEach(function (o) { if (o.gisItem === "inset") rebuild(o); }); }, 200); }
  });
  GIS.on("*", function (arg, evt) {
    if (evt === "selection" || evt === "interactive" || evt === "active") return;
    items().forEach(function (o) { if (o.gisItem === "legend" || o.gisItem === "colorbar" || (o.gisItem === "inset" && o.gisOpts.showLayers)) rebuild(o); });
  });

  // Resizing an inset re-renders it at the new size instead of stretching.
  function wireCanvas() {
    var canvas = fc();
    if (!canvas || canvas._gisItemsWired) return;
    canvas._gisItemsWired = true;
    // Resizing a legend, color bar, scale bar or north arrow re-lays it out
    // at the new size instead of stretching it, so text keeps its size and
    // shape (QGIS item behaviour):
    //   legend     the box grows; entries flow into columns to fit its height
    //   color bar  along the bar -> length, across -> thickness
    //   scale bar  width -> target length, height -> bar height
    //   north      proportional size, redrawn crisp
    canvas.on("object:modified", function (e) {
      var o = e.target;
      if (!o || !o.gisItem || o.gisItem === "inset") return;
      var sx = o.scaleX || 1, sy = o.scaleY || 1;
      if (Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
      var w = o.width, h = o.height, dw = w * sx - w, dh = h * sy - h, p = o.gisOpts, patch = {};
      function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
      if (o.gisItem === "legend") {
        patch = { boxW: Math.round(w * sx), boxH: Math.round(h * sy) };
      } else if (o.gisItem === "colorbar") {
        var vert = p.orientation === "vertical";
        patch = { length: Math.round(clamp(p.length + (vert ? dh : dw), 40, 1200)), thickness: Math.round(clamp(p.thickness + (vert ? dw : dh), 4, 80)) };
      } else if (o.gisItem === "scalebar") {
        patch = { width: Math.round(clamp(p.width + dw, 40, 1200)), height: Math.round(clamp(p.height + dh, 2, 40)) };
      } else if (o.gisItem === "north") {
        patch = { size: Math.round(clamp(p.size * Math.max(sx, sy), 16, 400)) };
      }
      o.gisOpts = Object.assign({}, p, patch);
      o.set({ scaleX: 1, scaleY: 1 });
      rebuild(o);
      if (typeof historyNotifyChange === "function") historyNotifyChange();
    });
    canvas.on("object:modified", function (e) {
      var o = e.target;
      if (!o || o.gisItem !== "inset") return;
      var w = Math.round(o.width * o.scaleX), h = Math.round(o.height * o.scaleY);
      if (Math.abs(w - o.gisOpts.w) < 2 && Math.abs(h - o.gisOpts.h) < 2) return;
      o.gisOpts = Object.assign({}, o.gisOpts, { w: w, h: h });
      o.set({ scaleX: 0.5, scaleY: 0.5 });
      rebuild(o);
    });
    if (typeof HISTORY_OBJ_PROPS !== "undefined") ["gisItem", "gisOpts"].forEach(function (p) { if (HISTORY_OBJ_PROPS.indexOf(p) < 0) HISTORY_OBJ_PROPS.push(p); });
  }
  document.addEventListener("ploots:canvasready", wireCanvas);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireCanvas); else wireCanvas();

  // A north arrow drawn as SVG (for the style picker).
  function northSVG(style, color, fill2) {
    var g = new fabric.Group(buildNorth({ style: style, size: 56, color: color || INK, fill2: fill2 || "#ffffff", label: true, followMap: false }));
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + [g.left, g.top, g.width, g.height].join(" ") + '">' + g.toSVG() + "</svg>";
  }
  GIS.items = { add: add, update: update, rebuild: rebuild, all: items, UNITS: Object.keys(UNITS), northSVG: northSVG };
})();
