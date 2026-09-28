/* ==========================================================================
   GIS — symbology (QGIS-style Single / Categorized / Graduated).

   Everything works on a per-feature value "__v" that styledData() writes
   into a copy of the layer's features, so the MapLibre expressions are the
   same whether the value comes from a property or a Data-table join.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  function fin(v) { return typeof v === "number" && isFinite(v); }
  function fmt(v) { return typeof formatValue === "function" ? formatValue(v, state.valueFormat || "auto") : String(v); }

  function palette() { return PALETTES[state.paletteIdx].colors; }

  function rampColors(name, reverse) {
    var p = PALETTES.filter(function (q) { return q.name === name || q.name === "ColorBrewer " + name; })[0];
    var c = p ? p.colors.slice() : ["#f7fcb9", "#31a354"];
    return reverse ? c.reverse() : c;
  }

  function values(layer) {
    var table = layer.style.field === GIS.TABLE_FIELD ? GIS.table() : null;
    return layer.data.features.map(function (f) {
      var v = GIS.valueOf(layer, f, table);
      return v === undefined || v === "" ? null : v;
    });
  }

  function categories(layer) {
    if (!layer || layer.kind !== "vector" || !layer.style.field) return [];
    var counts = {}, order = [];
    values(layer).forEach(function (v) {
      if (v == null) return;
      var k = String(v);
      if (!(k in counts)) { counts[k] = 0; order.push(k); }
      counts[k]++;
    });
    var numeric = order.every(function (k) { return isFinite(Number(k)); });
    order.sort(numeric ? function (a, b) { return a - b; } : function (a, b) { return a.localeCompare(b); });
    var pal = palette(), over = layer.style.catColors || {};
    return order.map(function (k, i) { return { value: k, count: counts[k], color: over[k] || pal[i % pal.length] }; });
  }

  // Jenks natural breaks (Fisher's dynamic programme) on sorted data;
  // returns the first value of classes 2..n (the step expression's stops).
  function jenks(data, n) {
    var m = data.length, i, j, l, lower = [], variance = [];
    for (i = 0; i <= m; i++) { lower.push(new Array(n + 1).fill(0)); variance.push(new Array(n + 1).fill(0)); }
    for (j = 1; j <= n; j++) { lower[1][j] = 1; for (i = 2; i <= m; i++) variance[i][j] = Infinity; }
    for (l = 2; l <= m; l++) {
      var s1 = 0, s2 = 0, w = 0, v = 0;
      for (var k = 1; k <= l; k++) {
        var lo = l - k + 1, val = data[lo - 1];
        s2 += val * val; s1 += val; w++;
        v = s2 - (s1 * s1) / w;
        if (lo - 1 !== 0) {
          for (j = 2; j <= n; j++) {
            if (variance[l][j] >= v + variance[lo - 1][j - 1]) { lower[l][j] = lo; variance[l][j] = v + variance[lo - 1][j - 1]; }
          }
        }
      }
      lower[l][1] = 1; variance[l][1] = v;
    }
    var out = [], kk = m;
    for (j = n; j >= 2; j--) { out.unshift(data[Math.max(0, lower[kk][j] - 1)]); kk = lower[kk][j] - 1; }
    return out;
  }

  function classes(layer) {
    var empty = { breaks: [], colors: [], labels: [], counts: [], lo: 0, hi: 0 };
    if (!layer || layer.kind !== "vector" || !layer.style.field) return empty;
    var s = layer.style;
    var vals = values(layer).map(Number).filter(fin).sort(d3.ascending);
    if (!vals.length) return empty;
    var n = Math.max(2, Math.min(9, s.classes || 5)), lo = vals[0], hi = vals[vals.length - 1], th;
    if (lo === hi) th = [];
    else if (s.method === "equal") th = d3.range(1, n).map(function (i) { return lo + (hi - lo) * i / n; });
    else if (s.method === "quantile") th = d3.range(1, n).map(function (i) { return d3.quantileSorted(vals, i / n); });
    else {
      var sample = vals.length > 1000 ? d3.range(1000).map(function (i) { return vals[Math.round(i * (vals.length - 1) / 999)]; }) : vals;
      var uniq = Array.from(new Set(sample));
      th = uniq.length <= n ? uniq.slice(1) : jenks(sample, n);
    }
    th = Array.from(new Set(th.filter(function (t) { return t > lo && t <= hi; }))).sort(d3.ascending);
    var k = th.length + 1, interp = d3.interpolateRgbBasis(rampColors(s.ramp, s.reverse));
    var colors = d3.range(k).map(function (i) { return d3.color(interp(k === 1 ? 1 : i / (k - 1))).formatHex(); });
    var edges = [lo].concat(th).concat([hi]);
    var counts = d3.range(k).map(function () { return 0; });
    vals.forEach(function (v) { counts[d3.bisectRight(th, v)]++; });
    return {
      breaks: th, colors: colors, counts: counts, lo: lo, hi: hi,
      labels: d3.range(k).map(function (i) { return fmt(edges[i]) + " – " + fmt(edges[i + 1]); })
    };
  }

  function colorExpression(layer) {
    var s = layer.style;
    if (s.symbology === "single" || !s.field) return s.singleColor;
    if (s.symbology === "categorized") {
      var cats = categories(layer);
      if (!cats.length) return s.missingColor;
      var m = ["match", ["to-string", ["get", "__v"]]];
      cats.forEach(function (c) { m.push(c.value, c.color); });
      m.push(s.missingColor);
      return m;
    }
    var cls = classes(layer);
    if (!cls.colors.length) return s.missingColor;
    var step = ["step", ["get", "__v"], cls.colors[0]];
    cls.breaks.forEach(function (b, i) { step.push(b, cls.colors[i + 1]); });
    return ["case", ["==", ["typeof", ["get", "__v"]], "number"], step, s.missingColor];
  }

  function styledData(layer) {
    var graduated = layer.style.symbology === "graduated", vals = values(layer);
    return {
      type: "FeatureCollection",
      features: layer.data.features.map(function (f, i) {
        var v = vals[i];
        if (v != null) v = graduated ? (isFinite(Number(v)) ? Number(v) : null) : String(v);
        return { type: "Feature", id: i, geometry: f.geometry, properties: Object.assign({}, f.properties, { __v: v, __i: i }) };
      })
    };
  }

  // One label point per feature: centroid of a polygon's largest part, a
  // line's middle vertex, or the point itself.
  function labelData(layer) {
    var field = layer.style.labelField, feats = [];
    if (field) layer.data.features.forEach(function (f) {
      var t = f.properties[field];
      if (t == null || t === "") return;
      var g = f.geometry, pt = null;
      if (g.type === "Point") pt = g.coordinates;
      else if (g.type === "MultiPoint") pt = g.coordinates[0];
      else if (g.type === "LineString" || g.type === "MultiLineString") {
        var line = g.type === "LineString" ? g.coordinates : g.coordinates.reduce(function (a, b) { return b.length > a.length ? b : a; }, []);
        pt = line[Math.floor(line.length / 2)];
      } else if (g.type === "Polygon" || g.type === "MultiPolygon") {
        var polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
        var best = polys.reduce(function (a, p) { var ar = Math.abs(d3.polygonArea(p[0])); return ar > a.ar ? { ar: ar, ring: p[0] } : a; }, { ar: -1, ring: null });
        if (best.ring) pt = d3.polygonCentroid(best.ring);
      }
      if (pt) feats.push({ type: "Feature", geometry: { type: "Point", coordinates: pt }, properties: { t: String(t) } });
    });
    return { type: "FeatureCollection", features: feats };
  }

  // Legend rows for one layer: [{ color, label }] (color null = note row).
  function legendEntries(layer) {
    if (layer.kind !== "vector") return [];
    var s = layer.style;
    if (s.symbology === "single" || !s.field) return [{ color: s.singleColor, label: "" }];
    if (s.symbology === "categorized") {
      var cats = categories(layer), out = cats.slice(0, 30).map(function (c) { return { color: c.color, label: c.value }; });
      if (cats.length > 30) out.push({ color: null, label: "… " + (cats.length - 30) + " more" });
      return out;
    }
    var cls = classes(layer);
    return cls.colors.map(function (c, i) { return { color: c, label: cls.labels[i] }; });
  }

  GIS.sym = {
    palette: palette, rampColors: rampColors, categories: categories, classes: classes,
    colorExpression: colorExpression, styledData: styledData, labelData: labelData, legendEntries: legendEntries,
    RAMPS: ["YlGn", "Greens", "Blues", "YlGnBu", "GnBu", "BuPu", "OrRd", "YlOrRd", "Reds", "Purples", "Grayscale", "Viridis", "Magma", "Cividis", "Turbo", "RdYlGn", "Spectral", "BrBG", "Terrain"]
  };
})();
