/* ==========================================================================
   Ploots D3 engine — cartesian core chart types.

   bar-single, bar-group, bar-stack, line, area, scatter.

   Behaviour kept from the Plotly version (07-render.js):
     - same state keys, same defaults, same colours/patterns per series
     - value axis starts at zero (Plotly rangemode "tozero")
     - numeric-looking categories give a numeric X axis for line / area /
       scatter (Plotly auto-typed string numbers the same way), category
       labels otherwise; bars always use one slot per category
     - error bars: percent-of-value or fixed, per visible series
     - secondary axis: series with axis "y2" -> right axis (top axis for
       horizontal bars)

   Deliberate changes:
     - Regression trend line is fitted against the real X values when the
       X axis is numeric. Plotly's version regressed on the row index, so
       unevenly spaced X values gave a wrong slope and intercept.
     - Stacked bars stack positive and negative values separately (a
       diverging stack) instead of letting them overlap.
     - Smooth lines use a monotone curve, which never overshoots the data
       (Plotly's spline could draw peaks that are not in the data).
   ========================================================================== */
(function () {
  "use strict";

  var PD = window.PlootsD3;
  function fin(v) { return typeof v === "number" && isFinite(v); }

  function common() {
    var st = window.state;
    var xl = document.getElementById("xLabel"), yl = document.getElementById("yLabel"), y2l = document.getElementById("y2Label");
    var o = xl ? xl.value : "", r = yl ? yl.value : "";
    var l = st.showXAxisLabel ? o : "", n = st.showYAxisLabel ? r : "";
    if (st.xAxisTitleDetached) l = "";
    if (st.yAxisTitleDetached) n = "";
    var vis = st.seriesNames.filter(function (e) { return st.seriesMeta[e] && st.seriesMeta[e].visible; });
    return {
      st: st,
      vertical: st.orientation === "vertical",
      cats: typeof wrappedCategories === "function" ? wrappedCategories() : st.categories,
      vis: vis,
      catTitle: l, valTitle: n, y2Title: y2l ? y2l.value : "",
      outline: st.outlineMarker ? 1.1 : 0,
      fmt: function (v) { return typeof formatValue === "function" ? formatValue(v, st.valueFormat || "auto") : String(v); },
      ink: PD.ink(),
      palette: PALETTES[st.paletteIdx].colors,
      halo: (typeof chartBgColor === "function" && chartBgColor() !== "rgba(0,0,0,0)") ? chartBgColor() : "#ffffff"
    };
  }

  function seriesLineColor(C, e, k) {
    return isGrayscaleMode() ? grayForIndex(k) : C.st.seriesMeta[e].color;
  }

  function errAmount(v) {
    var eb = window.state.errorBars;
    if (!eb || !eb.enabled || !fin(v)) return null;
    var val = eb.value || 0;
    return eb.mode === "percent" ? Math.abs(v * val / 100) : val;
  }

  function drawErrorBar(g, dir, at, p0, p1, color) {
    var eb = window.state.errorBars;
    var thick = fin(eb.thickness) ? eb.thickness : 1.2, cap = fin(eb.capWidth) ? eb.capWidth : 3;
    var eg = g.append("g").attr("class", "errorbar").attr("stroke", color).attr("stroke-width", thick).attr("fill", "none");
    if (dir === "v") {
      eg.append("line").attr("x1", at).attr("x2", at).attr("y1", p0).attr("y2", p1);
      eg.append("line").attr("x1", at - cap).attr("x2", at + cap).attr("y1", p0).attr("y2", p0);
      eg.append("line").attr("x1", at - cap).attr("x2", at + cap).attr("y1", p1).attr("y2", p1);
    } else {
      eg.append("line").attr("y1", at).attr("y2", at).attr("x1", p0).attr("x2", p1);
      eg.append("line").attr("y1", at - cap).attr("y2", at + cap).attr("x1", p0).attr("x2", p0);
      eg.append("line").attr("y1", at - cap).attr("y2", at + cap).attr("x1", p1).attr("x2", p1);
    }
  }

  function errColor(seriesColor) {
    var eb = window.state.errorBars;
    return eb && eb.colorMatch && seriesColor ? seriesColor : PD.ink().shape;
  }

  // Least-squares line y = a + b x on paired finite values.
  function fitLinear(xs, ys) {
    var n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var i = 0; i < xs.length; i++) {
      if (!fin(xs[i]) || !fin(ys[i])) continue;
      n++; sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i];
    }
    if (n < 2) return null;
    var den = n * sxx - sx * sx;
    if (den === 0) return null;
    var b = (n * sxy - sx * sy) / den;
    return { slope: b, intercept: (sy - b * sx) / n, n: n };
  }
  PD.fitLinear = fitLinear;

  function historyPing() { if (typeof historyNotifyChange === "function") historyNotifyChange(); }

  /* ================================================================ bars */

  function renderBars(gd, mode) {
    var C = common(), st = C.st;
    var vis = mode === "single" ? C.vis.slice(0, 1) : C.vis;
    if (!vis.length) return PD.renderBlank(gd);
    var nCat = st.categories.length, c = C.vertical;
    var catName = c ? "x" : "y", valName = c ? "y" : "x", secName = c ? "y2" : "x2";
    function onSec(e) { return mode !== "single" && st.seriesMeta[e].axis === "y2"; }
    var hasSec = vis.some(onSec);
    var percent = mode === "stack" && st.stackedPercent;

    // ---- segments: {e, k (series index), i (category), v0, v1, raw, sec}
    var segs = [], valVals = [], secVals = [];
    if (mode === "stack") {
      var totals = {};
      if (percent) {
        vis.forEach(function (e) {
          st.seriesData[e].forEach(function (v, i) {
            if (!fin(v)) return;
            var key = (onSec(e) ? "s" : "p") + i;
            totals[key] = (totals[key] || 0) + Math.abs(v);
          });
        });
      }
      var accPos = {}, accNeg = {};
      vis.forEach(function (e, k) {
        st.seriesData[e].forEach(function (raw, i) {
          if (!fin(raw)) return;
          var sec = onSec(e), key = (sec ? "s" : "p") + i;
          var v = percent ? (totals[key] ? raw / totals[key] * 100 : 0) : raw;
          var acc = v >= 0 ? accPos : accNeg, base = acc[key] || 0;
          acc[key] = base + v;
          segs.push({ e: e, k: k, i: i, v0: base, v1: base + v, raw: raw, sec: sec });
          var ea = errAmount(v);
          (sec ? secVals : valVals).push(base + v + (ea || 0) * (v >= 0 ? 1 : -1), base);
        });
      });
    } else {
      vis.forEach(function (e, k) {
        st.seriesData[e].forEach(function (v, i) {
          if (!fin(v)) return;
          var sec = onSec(e);
          segs.push({ e: e, k: k, i: i, v0: 0, v1: v, raw: v, sec: sec });
          var ea = errAmount(v) || 0;
          (sec ? secVals : valVals).push(v, v + ea, v - ea);
        });
      });
    }

    // ---- fills
    var defs = null, fills = {};
    function barFill(e, i) {
      if (mode === "single") {
        var K = C.palette, color = isGrayscaleMode() ? "#ffffff" : K[i % K.length];
        if (!isPatternish()) return color;
        var key = "c" + i;
        if (!fills[key]) fills[key] = PD.patternFill(defs, HATCH_DEFS[i % HATCH_DEFS.length].shape,
          isGrayscaleMode() ? C.ink.shape : "rgba(255,255,255,0.65)", color, st.patternSize, st.patternSolidity);
        return fills[key];
      }
      var base = baseMarkerColor(e);
      if (!isPatternish()) return base;
      if (!fills[e]) {
        var p = buildMarkerPattern(e);
        fills[e] = PD.patternFill(defs, p.shape, p.fgcolor, p.bgcolor, p.size, p.solidity);
      }
      return fills[e];
    }

    // ---- axes
    var pctFixed = percent && !segs.some(function (sg) { return sg.v1 < sg.v0; }) ? [0, 100] : null;
    var axes = {};
    axes[catName] = {
      kind: "band", n: nCat, labels: C.cats, title: C.catTitle,
      paddingInner: fin(st.barGap) ? st.barGap : 0.22, paddingOuter: (fin(st.barGap) ? st.barGap : 0.22) / 2
    };
    axes[valName] = {
      kind: "linear", values: valVals, tozero: true, pad: 0.05, fixedDomain: pctFixed,
      padHiExtra: st.showValues ? 0.06 : 0, zeroline: true, title: C.valTitle
    };
    if (hasSec) axes[secName] = { kind: "linear", values: secVals, tozero: true, fixedDomain: pctFixed, pad: 0.05, padHiExtra: st.showValues ? 0.06 : 0, title: C.y2Title };

    // ---- legend
    var legendItems;
    // Legend swatches are drawn after the defs exist, so fills are
    // resolved lazily in draw(); here we only describe them.
    legendItems = (mode === "single" ? [vis[0]] : vis).map(function (e) {
      return { series: e, label: st.seriesMeta[e].label || e, kind: "bar", stroke: C.outline ? C.ink.shape : "none", strokeW: C.outline };
    });

    var ctxRef;
    var ctx = PD.cartesian(gd, {
      axes: axes,
      legendItems: legendItems,
      onLegendMoved: historyPing,
      draw: function (ctx) {
        ctxRef = ctx;
        defs = ctx.defs;
        legendItems.forEach(function (it) { it.fill = barFill(it.series, 0); it.color = it.fill; });
        var cat = ctx.axes[catName], band = cat.scale, bw = band.bandwidth(), step = band.step();
        var fixedW = st.barWidth && st.barWidth > 0 ? Math.min(st.barWidth * step, step) : 0;
        var slots = mode === "group" ? vis.length : 1;
        var sub = null, thick;
        if (mode === "group") {
          if (fixedW) thick = fixedW;
          else {
            var gg = fin(st.barGroupGap) ? st.barGroupGap : 0.12;
            sub = d3.scaleBand().domain(d3.range(slots)).range([0, bw]).paddingInner(gg).paddingOuter(gg / 2);
            thick = sub.bandwidth();
          }
        } else thick = fixedW || bw;

        function slotStart(i, k) {
          if (mode !== "group") return band(i) + (bw - thick) / 2;
          if (sub) return band(i) + sub(k);
          return band(i) + bw / 2 - thick * slots / 2 + k * thick;
        }

        var g = ctx.marks.append("g").attr("class", "bars");
        var labels = ctx.over.append("g").attr("class", "value-labels");
        var errs = ctx.over.append("g").attr("class", "errorbars");
        var fsVal = Math.max((st.bodyFontSize || 12) - 2, 8);

        segs.forEach(function (sg) {
          var vax = ctx.axes[sg.sec ? secName : valName], vs = vax.scale;
          var dom = vs.domain(), lo = Math.min(dom[0], dom[1]);
          var a0 = (vax.cfg.log && sg.v0 <= 0) ? lo : sg.v0;
          var p0 = vs(a0), p1 = vs(sg.v1);
          var q = slotStart(sg.i, sg.k);
          var rect = g.append("rect").attr("fill", barFill(sg.e, sg.i))
            .attr("stroke", C.outline ? C.ink.shape : "none").attr("stroke-width", C.outline);
          if (c) rect.attr("x", q).attr("width", thick).attr("y", Math.min(p0, p1)).attr("height", Math.abs(p1 - p0));
          else rect.attr("y", q).attr("height", thick).attr("x", Math.min(p0, p1)).attr("width", Math.abs(p1 - p0));

          var mid = q + thick / 2;
          var ea = errAmount(sg.v1 - sg.v0);
          if (ea) {
            var e0 = vs(sg.v1 - ea), e1 = vs(sg.v1 + ea);
            drawErrorBar(errs, c ? "v" : "h", mid, e0, e1, errColor(st.seriesMeta[sg.e].color));
          }
          if (st.showValues) {
            var txt = C.fmt(sg.raw), neg = sg.v1 < sg.v0;
            if (mode === "stack") {
              if (Math.abs(p1 - p0) >= fsVal * (c ? 1.1 : 0.5) + (c ? 0 : PD.textWidth(txt, fsVal, st.fontBody))) {
                PD.richText(labels, txt, { x: c ? mid : (p0 + p1) / 2, y: c ? (p0 + p1) / 2 : mid, size: fsVal, family: st.fontBody, color: C.ink.text, anchor: "middle", valign: "middle", halo: C.halo });
              }
            } else if (c) {
              // Label sits past the error bar, not on top of it.
              var tip = ea ? vs(neg ? sg.v1 - ea : sg.v1 + ea) : p1;
              PD.richText(labels, txt, { x: mid, y: neg ? tip + 3 : tip - 3, size: fsVal, family: st.fontBody, color: C.ink.text, anchor: "middle", valign: neg ? "top" : "bottom", halo: C.halo });
            } else {
              var tipH = ea ? vs(neg ? sg.v1 - ea : sg.v1 + ea) : p1;
              PD.richText(labels, txt, { x: neg ? tipH - 4 : tipH + 4, y: mid, size: fsVal, family: st.fontBody, color: C.ink.text, anchor: neg ? "end" : "start", valign: "middle", halo: C.halo });
            }
          }
        });
      }
    });
    return ctx;
  }

  /* ========================================================= line / area / scatter */

  function renderXY(gd, type) {
    var C = common(), st = C.st, vis = C.vis;
    if (!vis.length) return PD.renderBlank(gd);
    var nCat = st.categories.length;
    var numericX = PD.isNumericCategory(st.categories);
    var xs = numericX ? st.categories.map(function (v) { return parseFloat(v); }) : d3.range(nCat);
    var isScatter = type === "scatter", isArea = type === "area";
    var showMarkers = isScatter || !!st.lineShowMarkers;
    var mSize = isScatter ? 10 : 7;
    var lw = st.lineWidth || 2.6;

    function onSec(e) { return st.seriesMeta[e].axis === "y2"; }
    var hasSec = vis.some(onSec);

    // regression fits (need them before the domain is known)
    var fits = {};
    if (st.regressionEnabled) {
      vis.forEach(function (e) {
        var f = fitLinear(xs, st.seriesData[e]);
        if (f) fits[e] = f;
      });
    }
    var yVals = [], y2Vals = [];
    vis.forEach(function (e) {
      var tgt = onSec(e) ? y2Vals : yVals;
      st.seriesData[e].forEach(function (v) {
        if (!fin(v)) return;
        var ea = errAmount(v) || 0;
        tgt.push(v + ea, v - ea);
      });
      if (fits[e]) {
        var xf = xs.filter(fin), a = d3.min(xf), b = d3.max(xf);
        tgt.push(fits[e].intercept + fits[e].slope * a, fits[e].intercept + fits[e].slope * b);
      }
    });

    var axes = {
      x: numericX
        ? { kind: "linear", values: xs, pad: isScatter ? 0.05 : 0, noNice: !isScatter, title: C.catTitle }
        : { kind: "point", n: nCat, labels: C.cats, padding: isScatter ? 0.5 : 0, title: C.catTitle },
      y: { kind: "linear", values: yVals, tozero: true, pad: 0.05, padHiExtra: st.showValues ? 0.05 : 0, zeroline: true, title: C.valTitle }
    };
    if (hasSec) axes.y2 = { kind: "linear", values: y2Vals, tozero: true, pad: 0.05, title: C.y2Title };

    var order = vis.slice();
    if (isArea) {
      order.sort(function (a, b) {
        function sum(e) { return st.seriesData[e].reduce(function (s, v) { return s + (fin(v) ? v : 0); }, 0); }
        return sum(b) - sum(a);
      });
    }

    var legendItems = [];
    vis.forEach(function (e, k) {
      var col = seriesLineColor(C, e, k), meta = st.seriesMeta[e];
      var dash = isScatter ? (st.scatterLineDash || "solid") : (isPatternish() ? DASH_CYCLE[k % DASH_CYCLE.length] : "solid");
      if (isArea) {
        legendItems.push({ label: meta.label || e, kind: "area", color: col, fill: hexToRgba(col, st.areaFillMode === "solid" ? 1 : (fin(st.areaFillOpacity) ? st.areaFillOpacity : 0.5)) });
      } else if (isScatter) {
        legendItems.push({ label: meta.label || e, kind: "marker", color: col, marker: meta.marker || "circle", markerSize: mSize, outlineW: C.outline, withLine: !!st.scatterShowLine, dash: dash, lineW: lw });
      } else {
        legendItems.push({ label: meta.label || e, kind: "line", color: col, dash: dash, lineW: lw, marker: showMarkers ? (meta.marker || "circle") : null, markerSize: mSize, outlineW: C.outline });
      }
      if (fits[e]) legendItems.push({ label: (meta.label || e) + " (trend)", kind: "trend", color: col, lineW: 1.5 });
    });

    return PD.cartesian(gd, {
      axes: axes,
      legendItems: legendItems,
      onLegendMoved: historyPing,
      draw: function (ctx) {
        var X = ctx.axes.x;
        function xp(i) { return numericX ? X.scale(xs[i]) : X.pos(i); }
        var fsVal = Math.max((st.bodyFontSize || 12) - 2, 8);
        var gLines = ctx.marks.append("g").attr("class", "series");
        var gMarks = ctx.over.append("g").attr("class", "markers").attr("clip-path", ctx.marks.attr("clip-path"));
        var gErr = ctx.over.append("g").attr("class", "errorbars");
        var gVal = ctx.over.append("g").attr("class", "value-labels");

        order.forEach(function (e) {
          var k = vis.indexOf(e), meta = st.seriesMeta[e], col = seriesLineColor(C, e, k);
          var Y = ctx.axes[onSec(e) ? "y2" : "y"], ys = Y.scale;
          var data = st.seriesData[e];
          var pts = data.map(function (v, i) { return { i: i, v: v, ok: fin(v) && fin(xs[i]) && (!Y.cfg.log || v > 0) }; });
          var curve = (!isScatter && st.lineShape !== "linear") ? d3.curveMonotoneX : d3.curveLinear;
          var dash = isScatter ? (st.scatterLineDash || "solid") : (isPatternish() ? DASH_CYCLE[k % DASH_CYCLE.length] : "solid");
          var sg = gLines.append("g").attr("class", "series-" + k);

          if (isArea) {
            var dom = ys.domain(), lo = Math.min(dom[0], dom[1]), hi = Math.max(dom[0], dom[1]);
            var base = ys(Math.min(Math.max(0, lo), hi));
            var area = d3.area().defined(function (p) { return p.ok; }).curve(curve)
              .x(function (p) { return xp(p.i); }).y0(base).y1(function (p) { return ys(p.v); });
            sg.append("path").attr("d", area(pts))
              .attr("fill", hexToRgba(col, st.areaFillMode === "solid" ? 1 : (fin(st.areaFillOpacity) ? st.areaFillOpacity : 0.5)))
              .attr("stroke", "none");
          }
          if (!isScatter || st.scatterShowLine) {
            var line = d3.line().defined(function (p) { return p.ok; }).curve(curve)
              .x(function (p) { return xp(p.i); }).y(function (p) { return ys(p.v); });
            sg.append("path").attr("d", line(pts)).attr("fill", "none").attr("stroke", col)
              .attr("stroke-width", lw).attr("stroke-linejoin", "round").attr("stroke-linecap", "round")
              .attr("stroke-dasharray", PD.dashArray(dash, lw));
          }
          pts.forEach(function (p) {
            if (!p.ok) return;
            var x = xp(p.i), y = ys(p.v), ea = errAmount(p.v);
            if (ea) drawErrorBar(gErr, "v", x, ys(p.v - ea), ys(p.v + ea), errColor(col));
            if (showMarkers) PD.drawMarker(gMarks, x, y, meta.marker || "circle", mSize, col, C.outline, C.ink.shape);
            if (st.showValues) {
              PD.richText(gVal, C.fmt(p.v), { x: x, y: y - (showMarkers ? mSize / 2 : 0) - 4, size: fsVal, family: st.fontBody, color: C.ink.text, anchor: "middle", valign: "bottom", halo: C.halo });
            }
          });

          var f = fits[e];
          if (f) {
            var xf = xs.filter(fin), a = d3.min(xf), b = d3.max(xf);
            var samp = d3.range(41).map(function (j) {
              var xv = a + (b - a) * j / 40;
              return [numericX ? X.scale(xv) : X.pos(0) + (X.pos(nCat - 1) - X.pos(0)) * (xv - a) / ((b - a) || 1), ys(f.intercept + f.slope * xv)];
            });
            sg.append("path").attr("class", "trend").attr("d", d3.line()(samp)).attr("fill", "none")
              .attr("stroke", col).attr("stroke-width", 1.5).attr("stroke-dasharray", PD.dashArray("dot", 1.5));
          }
        });
      }
    });
  }

  PD.renderBlank = function (gd) {
    var st = window.state, b = st.chartBox;
    PD.mount(gd, b.w, b.h, typeof chartBgColor === "function" ? chartBgColor() : "#fff");
    gd._plootsD3 = null;
  };

  PD.renderers["bar-single"] = function (gd) { return renderBars(gd, "single"); };
  PD.renderers["bar-group"] = function (gd) { return renderBars(gd, "group"); };
  PD.renderers["bar-stack"] = function (gd) { return renderBars(gd, "stack"); };
  PD.renderers["line"] = function (gd) { return renderXY(gd, "line"); };
  PD.renderers["area"] = function (gd) { return renderXY(gd, "area"); };
  PD.renderers["scatter"] = function (gd) { return renderXY(gd, "scatter"); };
})();
