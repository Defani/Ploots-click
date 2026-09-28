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
    legend: { title: "Legend", fontSize: 11, frame: true, background: "#ffffff", showLayerNames: true },
    scalebar: { style: "single", segments: 4, units: "auto", width: 170, height: 6, fontSize: 10, frame: false, color: INK, labels: "all" },
    north: { style: "arrow", size: 56, color: INK, followMap: true },
    inset: { basemap: "positron", zoomOffset: -4, w: 220, h: 160, extentColor: "#e03131", showLayers: false, frameWidth: 1 }
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
    function nLabel(x, y) {
      var p = rot([[0, -R * 0.98]], deg)[0];
      parts.push(text("N", cx + p[0], cy + p[1] - fs * 0.35, fs, { originX: "center", originY: "center", fontWeight: "bold", fill: c }));
    }
    var a = R * 0.72, b = R * 0.24;
    switch (o.style) {
      case "half":
        parts.push(path(poly([[0, -a], [b, a], [0, a * 0.55]], deg, cx, cy), c));
        parts.push(path(poly([[0, -a], [-b, a], [0, a * 0.55]], deg, cx, cy), "#fff", c, 1));
        nLabel(); break;
      case "compass4":
        [[0, 1], [90, 0], [180, 1], [270, 0]].forEach(function (q) {
          parts.push(path(poly([[0, -a], [b * 0.8, 0], [0, 0]], deg + q[0], cx, cy), q[1] ? c : "#fff", c, 0.8));
          parts.push(path(poly([[0, -a], [-b * 0.8, 0], [0, 0]], deg + q[0], cx, cy), q[1] ? "#fff" : c, c, 0.8));
        });
        nLabel(); break;
      case "compass8":
        [45, 135, 225, 315].forEach(function (q) {
          parts.push(path(poly([[0, -a * 0.62], [b * 0.55, 0], [-b * 0.55, 0]], deg + q, cx, cy), "#fff", c, 0.7));
        });
        [0, 90, 180, 270].forEach(function (q, i) {
          parts.push(path(poly([[0, -a], [b * 0.7, 0], [0, 0]], deg + q, cx, cy), i % 2 ? "#fff" : c, c, 0.8));
          parts.push(path(poly([[0, -a], [-b * 0.7, 0], [0, 0]], deg + q, cx, cy), i % 2 ? c : "#fff", c, 0.8));
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
        parts.push(path(poly([[0, -a * 0.85], [-b, a * 0.5], [0, a * 0.25]], deg, cx, cy), "#fff", c, 0.8));
        nLabel(); break;
      case "star":
        parts.push(new fabric.Circle({ left: cx, top: cy, radius: a * 0.55, originX: "center", originY: "center", fill: "rgba(0,0,0,0)", stroke: c, strokeWidth: 1, selectable: false, evented: false }));
        [0, 90, 180, 270].forEach(function (q, i) {
          parts.push(path(poly([[0, -a], [b * 0.45, -b * 0.45], [0, 0]], deg + q, cx, cy), i ? "#fff" : c, c, 0.7));
          parts.push(path(poly([[0, -a], [-b * 0.45, -b * 0.45], [0, 0]], deg + q, cx, cy), c, c, 0.7));
        });
        nLabel(); break;
      default: // "arrow": split arrow
        parts.push(path(poly([[0, -a], [b, a], [0, a * 0.6]], deg, cx, cy), c));
        parts.push(path(poly([[0, -a], [-b, a], [0, a * 0.6]], deg, cx, cy), "#fff", c, 1));
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

  function buildLegend(o) {
    var fs = o.fontSize, row = fs + 8, sw = 18, pad = 10, parts = [], y = pad, maxW = 0;
    var bg = rect(0, 0, 10, 10, o.background || "rgba(0,0,0,0)", o.frame ? "#9a978c" : null, 0.8);
    parts.push(bg);
    if (o.title) {
      var t = text(o.title, pad, y, fs + 2, { fontWeight: "bold" });
      parts.push(t); maxW = t.width; y += t.height + 6;
    }
    var layers = GIS.layers.filter(function (l) { return l.visible && l.kind !== "xyz"; });
    layers.forEach(function (l) {
      var entries = GIS.sym.legendEntries(l), kind = l.kind === "vector" ? GIS.geometryKind(l) : "raster";
      // Single symbol: one row, swatch + layer name. Otherwise an optional
      // bold layer heading, then one row per class/category.
      if (entries.length === 1 && !entries[0].label) {
        var one = text(l.name, pad + sw + 8, y + row / 2 - 2 - fs * 0.62, fs);
        drawSwatch(entries[0].color, l, kind, pad, y + row / 2 - 2);
        parts.push(one); maxW = Math.max(maxW, sw + 8 + one.width); y += row;
        return;
      }
      if (o.showLayerNames) {
        var hdr = text(l.name, pad, y, fs, { fontWeight: "bold" });
        parts.push(hdr); maxW = Math.max(maxW, hdr.width); y += row;
      }
      if (l.kind === "raster" && l.raster.legend) {
        var lg = l.raster.legend, gw = 14, gh = Math.max(60, fs * 6);
        var grad = new fabric.Rect({ left: pad, top: y, width: gw, height: gh, selectable: false, evented: false, stroke: "#9a978c", strokeWidth: 0.6 });
        grad.set("fill", new fabric.Gradient({ type: "linear", coords: { x1: 0, y1: 0, x2: 0, y2: gh },
          colorStops: lg.colors.map(function (c, i) { return { offset: i / (lg.colors.length - 1 || 1), color: c }; }).reverse().map(function (s, i, arr) { return { offset: i / (arr.length - 1 || 1), color: s.color }; }) }));
        parts.push(grad);
        var hi = text(numFmt(lg.max), pad + gw + 8, y - 2, fs), lo = text(numFmt(lg.min), pad + gw + 8, y + gh - fs - 2, fs);
        parts.push(hi, lo); maxW = Math.max(maxW, gw + 8 + Math.max(hi.width, lo.width)); y += gh + 8;
        return;
      }
      entries.forEach(function (e) {
        var cy = y + row / 2 - 2;
        if (e.color) drawSwatch(e.color, l, kind, pad, cy);
        var t2 = text(e.label || l.name, pad + (e.color ? sw + 8 : 0), cy - fs * 0.62, fs);
        parts.push(t2); maxW = Math.max(maxW, (e.color ? sw + 8 : 0) + t2.width); y += row;
      });
    });
    function drawSwatch(color, l, kind, x, cy) {
      var s = l.style;
      if (kind === "line") parts.push(new fabric.Line([x, cy, x + sw, cy], { stroke: color, strokeWidth: Math.min(6, s.lineWidth + 1), selectable: false, evented: false }));
      else if (kind === "point") parts.push(new fabric.Circle({ left: x + sw / 2, top: cy, originX: "center", originY: "center", radius: Math.min(7, s.pointRadius), fill: color, stroke: s.strokeColor, strokeWidth: Math.min(2, s.strokeWidth), selectable: false, evented: false }));
      else parts.push(new fabric.Rect({ left: x, top: cy - 6, width: sw, height: 12, fill: color, opacity: Math.max(0.15, s.fillOpacity), stroke: s.strokeWidth > 0 ? (/^#?f{3,6}$/i.test(s.strokeColor) ? "#9a978c" : s.strokeColor) : null, strokeWidth: 0.8, selectable: false, evented: false }));
    }
    if (!layers.length) { var e0 = text("No layers", pad, y, fs, { fill: "#8a8a8a" }); parts.push(e0); maxW = e0.width; y += row; }
    bg.set({ width: maxW + pad * 2, height: y + pad - 4 });
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
    var parts = type === "legend" ? buildLegend(opts) : type === "scalebar" ? buildScale(opts) : buildNorth(opts);
    return new fabric.Group(parts, { subTargetCheck: false });
  }

  function place(obj, like, type) {
    var canvas = fc();
    obj.gisItem = type;
    obj.gisOpts = like ? like.gisOpts : obj.gisOpts;
    obj.layerName = { legend: "Legend", scalebar: "Scale bar", north: "North arrow", inset: "Inset map" }[type];
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
    var pos = type === "legend" ? [b.x + b.w - w - m, b.y + b.h - h - m] : type === "scalebar" ? [b.x + m + 8, b.y + b.h - h - m - 6] : [b.x + b.w - w - m, b.y + m];
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
    items().forEach(function (o) { if (o.gisItem === "legend" || (o.gisItem === "inset" && o.gisOpts.showLayers)) rebuild(o); });
  });

  // Resizing an inset re-renders it at the new size instead of stretching.
  function wireCanvas() {
    var canvas = fc();
    if (!canvas || canvas._gisItemsWired) return;
    canvas._gisItemsWired = true;
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

  GIS.items = { add: add, update: update, rebuild: rebuild, all: items, UNITS: Object.keys(UNITS) };
})();
