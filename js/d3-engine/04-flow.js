/* ==========================================================================
   Ploots D3 engine — flow and composition chart types.

   waterfall, funnel, treemap.

   Behaviour kept from the Plotly version (07-render.js):
     - waterfall: first visible series, every value a relative step,
       increases in palette[0], decreases in palette[3] (or [1]), connector
       lines between steps, horizontal when orientation is horizontal,
       value labels outside each step
     - funnel: first visible series, stages top to bottom, bars centred,
       one colour/hatch per stage, value inside each bar
     - treemap: first visible series as a flat treemap, one colour per
       category, "label" or "label + value" text
     - no legend on any of the three
   ========================================================================== */
(function () {
  "use strict";

  var PD = window.PlootsD3;
  function fin(v) { return typeof v === "number" && isFinite(v); }

  function base() {
    var st = window.state;
    var xl = document.getElementById("xLabel"), yl = document.getElementById("yLabel");
    return {
      st: st,
      vis: st.seriesNames.filter(function (e) { return st.seriesMeta[e] && st.seriesMeta[e].visible; }),
      cats: typeof wrappedCategories === "function" ? wrappedCategories() : st.categories,
      catTitle: st.showXAxisLabel && !st.xAxisTitleDetached && xl ? xl.value : "",
      valTitle: st.showYAxisLabel && !st.yAxisTitleDetached && yl ? yl.value : "",
      font: st.fontBody, size: st.bodyFontSize || 12,
      outline: st.outlineMarker ? 1.1 : 0,
      ink: PD.ink(),
      palette: PALETTES[st.paletteIdx].colors,
      fmt: function (v) { return typeof formatValue === "function" ? formatValue(v, st.valueFormat || "auto") : String(v); },
      bg: typeof chartBgColor === "function" ? chartBgColor() : "#fff"
    };
  }
  function halo(C) { return C.bg !== "rgba(0,0,0,0)" ? C.bg : "#ffffff"; }

  /* ========================================================== waterfall */

  function renderWaterfall(gd) {
    var C = base(), st = C.st, e = C.vis[0];
    if (!e) return PD.renderBlank(gd);
    var vals = st.seriesData[e], vertical = st.orientation === "vertical";
    var up = isGrayscaleMode() ? grayForIndex(0) : C.palette[0];
    var down = isGrayscaleMode() ? grayForIndex(1) : (C.palette[3] || C.palette[1]);
    var steps = [], cum = 0, span = [0];
    vals.forEach(function (v, i) {
      if (!fin(v)) return;
      steps.push({ i: i, v: v, from: cum, to: cum + v });
      cum += v;
      span.push(cum);
    });
    if (!steps.length) return PD.renderBlank(gd);
    var catName = vertical ? "x" : "y", valName = vertical ? "y" : "x", axes = {};
    var gap = fin(st.barGap) ? st.barGap : 0.22;
    axes[catName] = { kind: "band", n: st.categories.length, labels: C.cats, title: C.catTitle, paddingInner: gap, paddingOuter: gap / 2 };
    axes[valName] = { kind: "linear", values: span, tozero: true, pad: 0.05, padHiExtra: st.showValues ? 0.06 : 0, zeroline: true, title: C.valTitle };

    return PD.cartesian(gd, {
      axes: axes,
      legendItems: [],
      draw: function (ctx) {
        var cat = ctx.axes[catName].scale, val = ctx.axes[valName].scale, bw = cat.bandwidth();
        var g = ctx.marks.append("g").attr("class", "bars"), conn = ctx.marks.append("g").attr("class", "connectors");
        var labels = ctx.over.append("g").attr("class", "value-labels"), fsVal = Math.max(C.size - 2, 8);
        steps.forEach(function (s, j) {
          var q = cat(s.i), p0 = val(s.from), p1 = val(s.to), fill = s.v >= 0 ? up : down;
          var r = g.append("rect").attr("fill", fill).attr("stroke", C.outline ? C.ink.shape : "none").attr("stroke-width", C.outline);
          if (vertical) r.attr("x", q).attr("width", bw).attr("y", Math.min(p0, p1)).attr("height", Math.max(1, Math.abs(p1 - p0)));
          else r.attr("y", q).attr("height", bw).attr("x", Math.min(p0, p1)).attr("width", Math.max(1, Math.abs(p1 - p0)));
          var next = steps[j + 1];
          if (next) {
            var a = q + bw, b = cat(next.i);
            if (vertical) conn.append("line").attr("x1", a).attr("x2", b).attr("y1", p1).attr("y2", p1);
            else conn.append("line").attr("y1", a).attr("y2", b).attr("x1", p1).attr("x2", p1);
          }
          if (st.showValues) {
            var txt = C.fmt(s.v), neg = s.v < 0, mid = q + bw / 2;
            if (vertical) PD.richText(labels, txt, { x: mid, y: neg ? Math.max(p0, p1) + 3 : Math.min(p0, p1) - 3, size: fsVal, family: C.font, color: C.ink.text, anchor: "middle", valign: neg ? "top" : "bottom", halo: halo(C) });
            else PD.richText(labels, txt, { x: neg ? Math.min(p0, p1) - 4 : Math.max(p0, p1) + 4, y: mid, size: fsVal, family: C.font, color: C.ink.text, anchor: neg ? "end" : "start", valign: "middle", halo: halo(C) });
          }
        });
        conn.selectAll("line").attr("stroke", C.ink.axis).attr("stroke-width", 1);
      }
    });
  }

  /* ============================================================= funnel */

  function renderFunnel(gd) {
    var C = base(), st = C.st, e = C.vis[0];
    if (!e) return PD.renderBlank(gd);
    var vals = st.seriesData[e];
    var mx = d3.max(vals.filter(fin).map(Math.abs)) || 1;
    return PD.cartesian(gd, {
      axes: {
        // Stage widths are centred on 0; the value axis carries no meaning
        // to read off, so it is not drawn (Plotly's looked empty anyway).
        x: { kind: "linear", hidden: true, fixedDomain: [-mx / 2 * 1.02, mx / 2 * 1.02] },
        y: { kind: "band", n: st.categories.length, labels: C.cats, reverse: true, paddingInner: 0.12, paddingOuter: 0.06 }
      },
      legendItems: [],
      draw: function (ctx) {
        var X = ctx.axes.x.scale, Y = ctx.axes.y.scale, bh = Y.bandwidth();
        var conn = ctx.marks.append("g").attr("class", "connectors"), g = ctx.marks.append("g").attr("class", "bars");
        var labels = ctx.over.append("g").attr("class", "value-labels"), fsVal = Math.max(C.size - 1, 9);
        var prev = null;
        vals.forEach(function (v, i) {
          if (!fin(v)) { prev = null; return; }
          var half = Math.abs(v) / 2, x0 = X(-half), x1 = X(half), y = Y(i);
          g.append("rect").attr("x", x0).attr("width", Math.max(1, x1 - x0)).attr("y", y).attr("height", bh)
            .attr("fill", PD.categoryFill(ctx.defs, C, i)).attr("stroke", C.outline ? C.ink.shape : "none").attr("stroke-width", C.outline);
          if (prev) {
            conn.append("path").attr("d", "M" + prev.x0 + "," + prev.y1 + "L" + prev.x1 + "," + prev.y1 + "L" + x1 + "," + y + "L" + x0 + "," + y + "Z")
              .attr("fill", "rgba(68,68,68,0.08)");
          }
          prev = { x0: x0, x1: x1, y1: y + bh };
          if (st.showValues) PD.richText(labels, C.fmt(v), { x: (x0 + x1) / 2, y: y + bh / 2, size: fsVal, family: C.font, color: C.ink.text, anchor: "middle", valign: "middle", halo: halo(C), haloW: isPatternish() ? fsVal * 0.55 : null });
        });
      }
    });
  }

  /* ============================================================ treemap */

  function renderTreemap(gd) {
    var C = base(), st = C.st, e = C.vis[0];
    if (!e) return PD.renderBlank(gd);
    var vals = st.seriesData[e];
    var leaves = [];
    C.cats.forEach(function (label, k) { if (fin(vals[k]) && vals[k] > 0) leaves.push({ k: k, label: label, v: vals[k] }); });
    if (!leaves.length) return PD.renderBlank(gd);
    var W = st.chartBox.w, H = st.chartBox.h, m = { t: 30, r: 40, b: 60, l: 65 };
    var root = d3.hierarchy({ children: leaves }).sum(function (d) { return d.v || 0; }).sort(function (a, b) { return b.value - a.value; });
    d3.treemap().tile(d3.treemapSquarify).size([Math.max(40, W - m.l - m.r), Math.max(40, H - m.t - m.b)]).paddingInner(2)(root);
    var svg = PD.mount(gd, W, H, C.bg);
    gd._plootsD3 = null;
    var g = svg.append("g").attr("class", "treemap").attr("transform", "translate(" + m.l + "," + m.t + ")");
    var fsT = Math.max(C.size - 1, 9), stroke = C.outline || 0;
    root.leaves().forEach(function (n) {
      var d = n.data, k = d.k, w = n.x1 - n.x0, h = n.y1 - n.y0;
      var color = isGrayscaleMode() ? grayForIndex(k) : C.palette[k % C.palette.length];
      g.append("rect").attr("x", n.x0).attr("y", n.y0).attr("width", w).attr("height", h)
        .attr("fill", color).attr("stroke", stroke ? C.ink.shape : "none").attr("stroke-width", stroke);
      var txt = st.showValues ? d.label + "<br>" + C.fmt(d.v) : d.label, sz = PD.richSize(txt, fsT, C.font);
      if (sz.w + 8 <= w && sz.h + 6 <= h) {
        PD.richText(g, txt, { x: n.x0 + 4, y: n.y0 + 4, size: fsT, family: C.font, color: C.ink.text, valign: "top" });
      }
    });
  }

  PD.renderers["waterfall"] = function (gd) { return renderWaterfall(gd); };
  PD.renderers["funnel"] = function (gd) { return renderFunnel(gd); };
  PD.renderers["treemap"] = function (gd) { return renderTreemap(gd); };
})();
