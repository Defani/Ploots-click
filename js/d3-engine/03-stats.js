/* ==========================================================================
   Ploots D3 engine — part-of-whole and distribution chart types.

   pie, donut, histogram, box, violin, heatmap.

   Behaviour kept from the Plotly version (07-render.js):
     - pie/donut: first visible series, one colour (or hatch) per category,
       "label + percent" text (+ value when value labels are on), a
       "Series: …" caption under the chart, legend of categories
     - histogram: every visible series overlaid at 75% opacity
     - box: quartiles by linear interpolation (Plotly's default method),
       whiskers to the furthest point within 1.5 × IQR, outliers as points
     - violin: Gaussian KDE with Silverman's bandwidth, inner box
     - heatmap: rows = series (first at the bottom), columns = categories,
       colour bar

   Deliberate changes:
     - Heatmap colours always run light (low) to dark (high). Qualitative
       palettes used to be stretched across the value range, giving
       neighbouring values unrelated hues; see heatStops(). Grayscale is
       now light-to-dark too (Plotly's Greys ran black-to-white), and value
       labels switch to white on dark cells.
     - Histogram bins are shared by all overlaid series, so their bars line
       up (Plotly binned each series on its own and they could straddle).
     - Pie slices too thin for an inside label get an outside label with a
       leader line instead of being dropped.
   ========================================================================== */
(function () {
  "use strict";

  var PD = window.PlootsD3;
  function fin(v) { return typeof v === "number" && isFinite(v); }

  function base() {
    var st = window.state;
    var xl = document.getElementById("xLabel"), yl = document.getElementById("yLabel");
    var catT = st.showXAxisLabel && !st.xAxisTitleDetached && xl ? xl.value : "";
    var valT = st.showYAxisLabel && !st.yAxisTitleDetached && yl ? yl.value : "";
    return {
      st: st,
      vis: st.seriesNames.filter(function (e) { return st.seriesMeta[e] && st.seriesMeta[e].visible; }),
      cats: typeof wrappedCategories === "function" ? wrappedCategories() : st.categories,
      catTitle: catT, valTitle: valT,
      font: st.fontBody, size: st.bodyFontSize || 12,
      outline: st.outlineMarker ? 1.1 : 0,
      ink: PD.ink(),
      palette: PALETTES[st.paletteIdx].colors,
      fmt: function (v) { return typeof formatValue === "function" ? formatValue(v, st.valueFormat || "auto") : String(v); },
      bg: typeof chartBgColor === "function" ? chartBgColor() : "#fff"
    };
  }
  function historyPing() { if (typeof historyNotifyChange === "function") historyNotifyChange(); }
  function numbers(arr) { return (arr || []).filter(fin); }

  // Fill for category k in single-series, colour-per-category charts
  // (pie, donut, funnel): palette colour, white in grayscale, hatch if on.
  PD.categoryFill = function (defs, C, k) {
    var color = isGrayscaleMode() ? "#ffffff" : C.palette[k % C.palette.length];
    if (!isPatternish()) return color;
    return PD.patternFill(defs, HATCH_DEFS[k % HATCH_DEFS.length].shape,
      isGrayscaleMode() ? C.ink.shape : "rgba(255,255,255,0.65)", color, C.st.patternSize, C.st.patternSolidity);
  };
  // Series fill (histogram, box): palette/series colour or its hatch.
  PD.seriesFill = function (defs, e, cache) {
    if (!isPatternish()) return baseMarkerColor(e);
    if (!cache[e]) {
      var p = buildMarkerPattern(e);
      cache[e] = PD.patternFill(defs, p.shape, p.fgcolor, p.bgcolor, p.size, p.solidity);
    }
    return cache[e];
  };

  /* ================================================================ pie */

  function renderPie(gd, donut) {
    var C = base(), st = C.st, e = C.vis[0];
    if (!e) return PD.renderBlank(gd);
    var W = st.chartBox.w, H = st.chartBox.h;
    var vals = st.seriesData[e];
    var slices = [];
    C.cats.forEach(function (label, k) {
      var v = vals[k];
      if (fin(v) && v > 0) slices.push({ k: k, label: label, v: v });
    });
    if (!slices.length) return PD.renderBlank(gd);
    var total = d3.sum(slices, function (s) { return s.v; });
    // Plotly sorted slices largest first, clockwise from 12 o'clock.
    slices.sort(function (a, b) { return b.v - a.v; });

    var fs = st.legendFontSize || C.size;
    var items = C.cats.map(function (label, k) { return { k: k, label: label, kind: "bar" }; })
      .filter(function (it) { return fin(vals[it.k]) && vals[it.k] > 0; });
    var L = PD.legendFor(items, C.font, fs);
    var R = PD.legendReserve(L);
    var area = { l: 40 + R.l, t: 30 + R.t, w: W - 80 - R.l - R.r, h: H - 30 - 50 - R.t - R.b };
    area.w = Math.max(60, area.w); area.h = Math.max(60, area.h);

    var svg = PD.mount(gd, W, H, C.bg), defs = svg.select("defs");
    gd._plootsD3 = null; // no clickable axes
    items.forEach(function (it) { it.fill = PD.categoryFill(defs, C, it.k); it.color = it.fill; });
    var stroke = C.outline || (isGrayscaleMode() ? 1 : 0);

    var textSize = Math.max(C.size - 1, 9);
    var labelOf = function (s) {
      var pct = d3.format(".1f")(s.v / total * 100) + "%";
      return st.showValues ? s.label + "<br>" + C.fmt(s.v) + "<br>" + pct : s.label + "<br>" + pct;
    };
    // Leave room around the pie for outside labels.
    var outerR = Math.max(20, Math.min(area.w, area.h) / 2 * 0.82);
    var innerR = donut ? outerR * 0.45 : 0;
    var cx = area.l + area.w / 2, cy = area.t + area.h / 2;
    var arcs = d3.pie().sort(null).value(function (s) { return s.v; })(slices);
    var arc = d3.arc().innerRadius(innerR).outerRadius(outerR);
    var g = svg.append("g").attr("class", "pie").attr("transform", "translate(" + cx + "," + cy + ")");
    g.selectAll("path").data(arcs).enter().append("path")
      .attr("d", arc).attr("fill", function (a) { return PD.categoryFill(defs, C, a.data.k); })
      .attr("stroke", stroke ? C.ink.shape : "none").attr("stroke-width", stroke);

    var tg = g.append("g").attr("class", "pie-labels");
    var halo = C.bg !== "rgba(0,0,0,0)" ? C.bg : "#ffffff";
    arcs.forEach(function (a) {
      var txt = labelOf(a.data), sz = PD.richSize(txt, textSize, C.font);
      var mid = (a.startAngle + a.endAngle) / 2, span = a.endAngle - a.startAngle;
      var rIn = donut ? (innerR + outerR) / 2 : outerR * 0.62;
      var chord = 2 * rIn * Math.sin(Math.min(span, Math.PI) / 2);
      var fitsInside = span > 0.35 && sz.w < chord * 0.95 && sz.h < (outerR - innerR) * 0.9;
      if (fitsInside) {
        // Over hatching the label needs a thick halo to stay readable.
        PD.richText(tg, txt, { x: Math.sin(mid) * rIn, y: -Math.cos(mid) * rIn, size: textSize, family: C.font, color: C.ink.text, anchor: "middle", valign: "middle", halo: isPatternish() ? halo : null, haloW: textSize * 0.55 });
      } else {
        var p0 = [Math.sin(mid) * outerR, -Math.cos(mid) * outerR];
        var p1 = [Math.sin(mid) * (outerR + 12), -Math.cos(mid) * (outerR + 12)];
        var right = Math.sin(mid) >= 0;
        var p2 = [p1[0] + (right ? 10 : -10), p1[1]];
        tg.append("polyline").attr("points", [p0, p1, p2].map(function (p) { return p.join(","); }).join(" "))
          .attr("fill", "none").attr("stroke", C.ink.axis).attr("stroke-width", 0.8);
        PD.richText(tg, txt, { x: p2[0] + (right ? 3 : -3), y: p2[1], size: textSize, family: C.font, color: C.ink.text, anchor: right ? "start" : "end", valign: "middle" });
      }
    });

    PD.richText(svg, "Series: " + (st.seriesMeta[e].label || e), {
      x: area.l + area.w / 2, y: Math.min(H - 8, area.t + area.h + 30), size: Math.max(C.size - 1, 9),
      family: C.font, color: "#5c5c58", anchor: "middle", valign: "bottom"
    });
    PD.drawLegendIn(svg, L, area, C.font, fs, historyPing);
  }

  /* ========================================================== histogram */

  function renderHistogram(gd) {
    var C = base(), st = C.st, vis = C.vis;
    if (!vis.length) return PD.renderBlank(gd);
    var all = [];
    vis.forEach(function (e) { all = all.concat(numbers(st.seriesData[e])); });
    if (!all.length) return PD.renderBlank(gd);
    var ext = d3.extent(all);
    if (ext[0] === ext[1]) ext = [ext[0] - 0.5, ext[1] + 0.5];
    var n = d3.max(vis, function (e) { return numbers(st.seriesData[e]).length; });
    var count = Math.max(3, Math.ceil(Math.log2(n) + 1)); // Sturges
    var xs = d3.scaleLinear().domain(ext).nice(count);
    var thresholds = xs.ticks(count);
    var binner = d3.bin().domain(xs.domain()).thresholds(thresholds);
    var bins = {}, maxCount = 0;
    vis.forEach(function (e) {
      bins[e] = binner(numbers(st.seriesData[e]));
      bins[e].forEach(function (b) { maxCount = Math.max(maxCount, b.length); });
    });

    var cache = {}, defs;
    var legendItems = vis.map(function (e) {
      return { series: e, label: st.seriesMeta[e].label || e, kind: "bar", stroke: C.outline ? C.ink.shape : "none", strokeW: C.outline };
    });
    return PD.cartesian(gd, {
      axes: {
        x: { kind: "linear", fixedDomain: xs.domain(), values: xs.domain(), title: st.orientation === "vertical" ? C.valTitle : C.catTitle },
        y: { kind: "linear", values: [0, maxCount], tozero: true, pad: 0.05, title: "Frequency" }
      },
      legendItems: legendItems,
      onLegendMoved: historyPing,
      draw: function (ctx) {
        defs = ctx.defs;
        legendItems.forEach(function (it) { it.fill = PD.seriesFill(defs, it.series, cache); it.color = it.fill; });
        var X = ctx.axes.x.scale, Y = ctx.axes.y.scale, g = ctx.marks.append("g").attr("class", "bars");
        vis.forEach(function (e) {
          var fill = PD.seriesFill(defs, e, cache), sg = g.append("g").attr("opacity", 0.75);
          bins[e].forEach(function (b) {
            if (!b.length) return;
            var x0 = X(b.x0), x1 = X(b.x1);
            sg.append("rect").attr("x", Math.min(x0, x1) + 0.5).attr("width", Math.max(0, Math.abs(x1 - x0) - 1))
              .attr("y", Y(b.length)).attr("height", Math.abs(Y(0) - Y(b.length)))
              .attr("fill", fill).attr("stroke", C.outline ? C.ink.shape : "none").attr("stroke-width", C.outline);
          });
        });
      }
    });
  }

  /* ======================================================== box / violin */

  function boxStats(vals) {
    var s = vals.slice().sort(d3.ascending);
    var q1 = d3.quantileSorted(s, 0.25), med = d3.quantileSorted(s, 0.5), q3 = d3.quantileSorted(s, 0.75);
    var iqr = q3 - q1, loF = q1 - 1.5 * iqr, hiF = q3 + 1.5 * iqr;
    var inside = s.filter(function (v) { return v >= loF && v <= hiF; });
    return {
      q1: q1, med: med, q3: q3, sorted: s,
      lo: inside.length ? inside[0] : q1, hi: inside.length ? inside[inside.length - 1] : q3,
      outliers: s.filter(function (v) { return v < loF || v > hiF; })
    };
  }

  // Gaussian KDE, Silverman's rule-of-thumb bandwidth (Plotly's default).
  function kde(sorted) {
    var n = sorted.length, sd = d3.deviation(sorted) || 0;
    var iqr = d3.quantileSorted(sorted, 0.75) - d3.quantileSorted(sorted, 0.25);
    var spread = Math.min(sd, iqr / 1.349) || sd || Math.abs(sorted[0]) * 0.1 || 1;
    var bw = 1.059 * spread * Math.pow(n, -0.2);
    var lo = sorted[0] - 2 * bw, hi = sorted[n - 1] + 2 * bw; // Plotly spanmode "soft"
    var pts = d3.range(81).map(function (j) {
      var x = lo + (hi - lo) * j / 80, sum = 0;
      for (var i = 0; i < n; i++) { var u = (x - sorted[i]) / bw; sum += Math.exp(-0.5 * u * u); }
      return [x, sum / (n * bw * Math.sqrt(2 * Math.PI))];
    });
    return { pts: pts, lo: lo, hi: hi };
  }

  function renderBoxViolin(gd, violin) {
    var C = base(), st = C.st;
    var vis = C.vis.filter(function (e) { return numbers(st.seriesData[e]).length; });
    if (!vis.length) return PD.renderBlank(gd);
    var stats = {}, dens = {}, values = [];
    vis.forEach(function (e) {
      var v = numbers(st.seriesData[e]);
      stats[e] = boxStats(v);
      values = values.concat(v);
      if (violin && v.length > 1) { dens[e] = kde(stats[e].sorted); values.push(dens[e].lo, dens[e].hi); }
    });
    var lineW = st.outlineMarker ? 1.2 : 0.6;
    var legendItems = vis.map(function (e, k) {
      var col = isGrayscaleMode() ? grayForIndex(k) : st.seriesMeta[e].color;
      return { label: st.seriesMeta[e].label || e, kind: "bar", color: hexToRgba(col, 0.55), fill: hexToRgba(col, 0.55), stroke: C.ink.shape, strokeW: lineW };
    });
    return PD.cartesian(gd, {
      axes: {
        x: { kind: "band", n: vis.length, labels: vis.map(function (e) { return st.seriesMeta[e].label || e; }), title: "Series", paddingInner: 0.3, paddingOuter: 0.15 },
        y: { kind: "linear", values: values, pad: 0.05, title: C.valTitle }
      },
      legendItems: legendItems,
      onLegendMoved: historyPing,
      draw: function (ctx) {
        var X = ctx.axes.x, Y = ctx.axes.y.scale, bw = X.scale.bandwidth();
        var g = ctx.marks.append("g").attr("class", violin ? "violins" : "boxes");
        vis.forEach(function (e, k) {
          var col = isGrayscaleMode() ? grayForIndex(k) : st.seriesMeta[e].color;
          var s = stats[e], cx = X.pos(k), sg = g.append("g");
          if (violin && dens[e]) {
            var maxD = d3.max(dens[e].pts, function (p) { return p[1]; }) || 1, half = bw / 2 * 0.95;
            var area = d3.area().curve(d3.curveBasis)
              .y(function (p) { return Y(p[0]); })
              .x0(function (p) { return cx - p[1] / maxD * half; })
              .x1(function (p) { return cx + p[1] / maxD * half; });
            sg.append("path").attr("d", area(dens[e].pts)).attr("fill", hexToRgba(col, 0.55)).attr("stroke", C.ink.shape).attr("stroke-width", lineW);
            // inner box: IQR bar, whisker line, median tick
            var ib = Math.max(4, bw * 0.12);
            sg.append("line").attr("x1", cx).attr("x2", cx).attr("y1", Y(s.lo)).attr("y2", Y(s.hi)).attr("stroke", C.ink.shape).attr("stroke-width", 1);
            sg.append("rect").attr("x", cx - ib / 2).attr("width", ib).attr("y", Y(s.q3)).attr("height", Math.abs(Y(s.q1) - Y(s.q3)))
              .attr("fill", "#ffffff").attr("stroke", C.ink.shape).attr("stroke-width", 1);
            sg.append("line").attr("x1", cx - ib / 2).attr("x2", cx + ib / 2).attr("y1", Y(s.med)).attr("y2", Y(s.med)).attr("stroke", C.ink.shape).attr("stroke-width", 2);
            return;
          }
          var w = bw * 0.8, cap = w * 0.5, stroke = C.ink.shape, sw = Math.max(lineW, 1);
          sg.append("line").attr("x1", cx).attr("x2", cx).attr("y1", Y(s.hi)).attr("y2", Y(s.q3)).attr("stroke", stroke).attr("stroke-width", sw);
          sg.append("line").attr("x1", cx).attr("x2", cx).attr("y1", Y(s.q1)).attr("y2", Y(s.lo)).attr("stroke", stroke).attr("stroke-width", sw);
          sg.append("line").attr("x1", cx - cap / 2).attr("x2", cx + cap / 2).attr("y1", Y(s.hi)).attr("y2", Y(s.hi)).attr("stroke", stroke).attr("stroke-width", sw);
          sg.append("line").attr("x1", cx - cap / 2).attr("x2", cx + cap / 2).attr("y1", Y(s.lo)).attr("y2", Y(s.lo)).attr("stroke", stroke).attr("stroke-width", sw);
          sg.append("rect").attr("x", cx - w / 2).attr("width", w).attr("y", Y(s.q3)).attr("height", Math.abs(Y(s.q1) - Y(s.q3)))
            .attr("fill", hexToRgba(col, 0.55)).attr("stroke", stroke).attr("stroke-width", sw);
          sg.append("line").attr("x1", cx - w / 2).attr("x2", cx + w / 2).attr("y1", Y(s.med)).attr("y2", Y(s.med)).attr("stroke", stroke).attr("stroke-width", sw + 0.8);
          s.outliers.forEach(function (v) { PD.drawMarker(ctx.over, cx, Y(v), "circle", 6, col, C.outline, C.ink.shape); });
        });
      }
    });
  }

  /* ============================================================ heatmap */

  // A heatmap needs an ordered (light -> dark) scale. Palettes whose
  // lightness already runs one way are used as they are, lightest = lowest.
  // Qualitative palettes (the old Plotly version stretched those too, so
  // neighbouring values got unrelated hues) become a ramp from near-white
  // through the palette's first colour to a dark shade of it.
  function heatStops(palette) {
    var L = palette.map(function (c) { return d3.lab(c).l; });
    var inc = L.every(function (v, i) { return !i || v >= L[i - 1]; });
    var dec = L.every(function (v, i) { return !i || v <= L[i - 1]; });
    if ((inc || dec) && d3.max(L) - d3.min(L) > 30) {
      return palette.slice().sort(function (a, b) { return d3.lab(b).l - d3.lab(a).l; });
    }
    var h = d3.hcl(palette[0]);
    var dark = d3.hcl(h.h, Math.max(h.c, 30), Math.max(15, Math.min(h.l, 60) - 30));
    return ["#f7f7f4", d3.hcl(h.h, h.c, Math.max(h.l, 55)).formatHex(), dark.formatHex()];
  }

  function renderHeatmap(gd) {
    var C = base(), st = C.st, vis = C.vis;
    if (!vis.length) return PD.renderBlank(gd);
    var z = vis.map(function (e) { return st.seriesData[e]; });
    var flat = [];
    z.forEach(function (row) { flat = flat.concat(numbers(row)); });
    if (!flat.length) return PD.renderBlank(gd);
    var zmin = d3.min(flat), zmax = d3.max(flat);
    if (zmin === zmax) { zmin -= 0.5; zmax += 0.5; }
    var stops = isGrayscaleMode() ? ["#f5f5f5", "#1a1a1a"] : heatStops(C.palette);
    var color = d3.scaleLinear().domain(stops.map(function (c, i) { return zmin + (zmax - zmin) * i / (stops.length - 1 || 1); }))
      .range(stops).interpolate(d3.interpolateRgb).clamp(true);
    var cbTicks = d3.scaleLinear().domain([zmin, zmax]).nice(5).ticks(5).filter(function (v) { return v >= zmin && v <= zmax; });
    var cbFmt = PD.axisFormatter("auto", cbTicks, false);
    var cbLabelW = d3.max(cbTicks, function (v) { return PD.textWidth(cbFmt(v), C.size, C.font); }) || 0;

    return PD.cartesian(gd, {
      axes: {
        x: { kind: "band", n: st.categories.length, labels: C.cats, title: C.catTitle },
        y: { kind: "band", n: vis.length, labels: vis.map(function (e) { return st.seriesMeta[e].label || e; }), title: "Series" }
      },
      legendItems: [],
      reserve: { r: 18 + 14 + 6 + cbLabelW },
      draw: function (ctx) {
        var X = ctx.axes.x.scale, Y = ctx.axes.y.scale, g = ctx.marks.append("g").attr("class", "cells");
        var tv = ctx.over.append("g").attr("class", "value-labels"), fsVal = Math.max(C.size - 2, 8);
        z.forEach(function (row, r) {
          row.forEach(function (v, c) {
            if (!fin(v)) return;
            var x = X(c) + 1, y = Y(r) + 1, w = Math.max(0, X.bandwidth() - 2), h = Math.max(0, Y.bandwidth() - 2);
            var fillC = color(v);
            g.append("rect").attr("x", x).attr("y", y).attr("width", w).attr("height", h).attr("fill", fillC);
            if (st.showValues) PD.richText(tv, d3.format(".1f")(v), { x: x + w / 2, y: y + h / 2, size: fsVal, family: C.font, color: d3.lab(fillC).l < 55 ? "#ffffff" : "#1a1a1a", anchor: "middle", valign: "middle" });
          });
        });
        // colour bar
        var p = ctx.plot, bx = p.l + p.w + 18, bwid = 14, gid = "pd-cb-" + Math.random().toString(36).slice(2, 8);
        var lg = ctx.defs.append("linearGradient").attr("id", gid).attr("x1", 0).attr("y1", 1).attr("x2", 0).attr("y2", 0);
        stops.forEach(function (c, i) { lg.append("stop").attr("offset", (i / (stops.length - 1 || 1) * 100) + "%").attr("stop-color", c); });
        var cb = ctx.svg.append("g").attr("class", "colorbar");
        cb.append("rect").attr("x", bx).attr("y", p.t).attr("width", bwid).attr("height", p.h).attr("fill", "url(#" + gid + ")")
          .attr("stroke", C.ink.axis).attr("stroke-width", 0.6);
        var cs = d3.scaleLinear().domain([zmin, zmax]).range([p.t + p.h, p.t]);
        cbTicks.forEach(function (v) {
          var y = cs(v);
          cb.append("line").attr("x1", bx + bwid).attr("x2", bx + bwid + 4).attr("y1", y).attr("y2", y).attr("stroke", C.ink.axis).attr("stroke-width", 1);
          PD.richText(cb, cbFmt(v), { x: bx + bwid + 6, y: y, size: C.size, family: C.font, color: C.ink.axis, valign: "middle" });
        });
      }
    });
  }

  PD.renderers["pie"] = function (gd) { return renderPie(gd, false); };
  PD.renderers["donut"] = function (gd) { return renderPie(gd, true); };
  PD.renderers["histogram"] = function (gd) { return renderHistogram(gd); };
  PD.renderers["box"] = function (gd) { return renderBoxViolin(gd, false); };
  PD.renderers["violin"] = function (gd) { return renderBoxViolin(gd, true); };
  PD.renderers["heatmap"] = function (gd) { return renderHeatmap(gd); };
})();
