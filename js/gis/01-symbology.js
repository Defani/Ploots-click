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

  // Per-feature value as the colour expression expects it (__v).
  function symValues(layer) {
    var graduated = layer.style.symbology === "graduated";
    return values(layer).map(function (v) { return v == null ? null : graduated ? (isFinite(Number(v)) ? Number(v) : null) : String(v); });
  }

  // Label text: a template with {field} placeholders, or a single field.
  function labelText(layer, f) {
    var s = layer.style, p = f.properties;
    if (s.labelTemplate) {
      var out = s.labelTemplate.replace(/\{([^}]+)\}/g, function (m, k) {
        var v = p[k.trim()];
        return v == null ? "" : typeof v === "number" ? fmt(v) : String(v);
      });
      return out.trim() ? out : null;
    }
    if (!s.labelField) return null;
    var v = p[s.labelField];
    return v == null || v === "" ? null : typeof v === "number" ? fmt(v) : String(v);
  }
  function hasLabels(layer) { return !!(layer.style.labelTemplate || layer.style.labelField); }

  // Anchor point of a feature: the point itself, a line's middle vertex, or
  // the centroid of a polygon's largest part.
  function anchor(f) {
    var g = f.geometry;
    if (g.type === "Point") return g.coordinates;
    if (g.type === "MultiPoint") return g.coordinates[0];
    if (g.type === "LineString" || g.type === "MultiLineString") {
      var line = g.type === "LineString" ? g.coordinates : g.coordinates.reduce(function (a, c) { return c.length > a.length ? c : a; }, []);
      return line[Math.floor(line.length / 2)];
    }
    if (g.type === "Polygon" || g.type === "MultiPolygon") {
      var polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      var best = polys.reduce(function (a, pp) { var ar = Math.abs(d3.polygonArea(pp[0])); return ar > a.ar ? { ar: ar, ring: pp[0] } : a; }, { ar: -1, ring: null });
      return best.ring ? d3.polygonCentroid(best.ring) : null;
    }
    return null;
  }
  function isLine(f) { return /LineString$/.test(f.geometry.type); }
  // Line labels follow the line unless placement is set to "point".
  function linesFollow(layer) { return layer.style.labelPlacement !== "point"; }

  function styledData(layer) {
    var vals = symValues(layer), follow = linesFollow(layer), lab = hasLabels(layer), keep = GIS.filterMask(layer), feats = [];
    layer.data.features.forEach(function (f, i) {
      if (keep && !keep[i]) return;
      var extra = { __v: vals[i], __i: i };
      if (lab && follow && isLine(f)) extra.__label = labelText(layer, f) || "";
      feats.push({ type: "Feature", id: i, geometry: f.geometry, properties: Object.assign({}, f.properties, extra) });
    });
    return { type: "FeatureCollection", features: feats };
  }

  // Label points (lines that follow their geometry are labelled from the
  // main source instead).
  function labelData(layer) {
    var feats = [], follow = linesFollow(layer), keep = GIS.filterMask(layer);
    if (hasLabels(layer)) layer.data.features.forEach(function (f, i) {
      if ((follow && isLine(f)) || (keep && !keep[i])) return;
      var txt = labelText(layer, f), pt = txt && anchor(f);
      if (pt) feats.push({ type: "Feature", geometry: { type: "Point", coordinates: pt }, properties: { t: txt } });
    });
    return { type: "FeatureCollection", features: feats };
  }

  /* ---------------------------------------- proportional size & heatmap */

  function numbersOf(layer, field) {
    return layer.data.features.map(function (f) { var v = Number(f.properties[field]); return f.properties[field] == null || f.properties[field] === "" || !isFinite(v) ? null : v; });
  }
  // Radius for a value: "sqrt" keeps circle AREA proportional to the value
  // (true proportional symbols, from zero); "linear" spreads min..max over
  // the size range.
  function sizeScale(layer) {
    var s = layer.style, vals = numbersOf(layer, s.sizeField).filter(fin);
    var lo = d3.min(vals), hi = d3.max(vals);
    if (!vals.length) return null;
    function r(v) {
      if (!fin(v)) return 0;
      if (s.sizeScale === "linear") return s.sizeMin + (s.sizeMax - s.sizeMin) * ((v - lo) / ((hi - lo) || 1));
      return Math.max(s.sizeMin, s.sizeMax * Math.sqrt(Math.max(0, v) / (Math.max(Math.abs(hi), 1e-12))));
    }
    return { r: r, min: lo, max: hi };
  }

  // One point per feature carrying colour value, radius and heat weight.
  function pointData(layer) {
    var s = layer.style, vals = symValues(layer), sc = s.renderer === "proportional" && s.sizeField ? sizeScale(layer) : null;
    var sizes = sc ? numbersOf(layer, s.sizeField) : null, heat = s.renderer === "heatmap" && s.heatField ? numbersOf(layer, s.heatField) : null;
    var hmax = heat ? d3.max(heat.filter(fin)) || 1 : 1, feats = [], keep = GIS.filterMask(layer);
    layer.data.features.forEach(function (f, i) {
      if (keep && !keep[i]) return;
      var pt = anchor(f);
      if (!pt) return;
      var p = { __v: vals[i], __i: i, __r: sc ? sc.r(sizes[i]) : s.pointRadius, __w: heat ? (fin(heat[i]) ? Math.max(0, heat[i] / hmax) : 0) : 1 };
      if (sc && !fin(sizes[i])) return;
      feats.push({ type: "Feature", id: i, geometry: { type: "Point", coordinates: pt }, properties: p });
    });
    // Big circles first so small ones stay visible on top.
    if (sc) feats.sort(function (a, b) { return b.properties.__r - a.properties.__r; });
    return { type: "FeatureCollection", features: feats };
  }

  // Three nested reference circles for the legend (max, middle, small).
  function sizeLegend(layer) {
    var sc = sizeScale(layer);
    if (!sc) return null;
    var hi = sc.max, vals = [hi, hi / 2, hi / 8].map(function (v) { var p = Math.pow(10, Math.floor(Math.log10(Math.abs(v) || 1))); return Math.round(v / p * 2) / 2 * p; });
    if (layer.style.sizeScale === "linear") vals = [sc.max, (sc.max + sc.min) / 2, sc.min];
    vals = Array.from(new Set(vals.filter(function (v) { return v > 0 || layer.style.sizeScale === "linear"; })));
    return vals.map(function (v) { return { value: v, r: sc.r(v) }; });
  }

  // Legend rows for one layer: [{ color, label }] (color null = note row).
  function legendEntries(layer) {
    if (layer.kind === "mvt") return [{ color: layer.color, label: "" }];
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
    pointData: pointData, sizeLegend: sizeLegend, labelText: labelText, hasLabels: hasLabels,
    RAMPS: ["YlGn", "Greens", "Blues", "YlGnBu", "GnBu", "BuPu", "OrRd", "YlOrRd", "Reds", "Purples", "Grayscale", "Viridis", "Magma", "Cividis", "Turbo", "RdYlGn", "Spectral", "BrBG", "Terrain"]
  };
})();
