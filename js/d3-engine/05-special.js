/* ==========================================================================
   Ploots D3 engine — specialised chart types.

   lollipop, dumbbell, bubble, scatter-matrix, sankey, ridge-plot, plus
   radial-rings and sunburst (already hand-drawn SVG; registered here so
   every chart type goes through the same render/export path).

   Behaviour kept from the previous renderers (13/14/17/18/19/20 in
   js/chart-builder/):
     - lollipop: stem from 0 plus a 12px head per series, series grouped
       side by side in each category, legend only with 2+ series
     - dumbbell: needs 2+ visible series; neutral connector per category
       through every series' value, one coloured marker per series; first
       series' value labels below/left, the others above/right
     - bubble: series paired as (Y, size); X from the category column;
       bubble area proportional to the size value on one scale across all
       pairs (largest ≈ 32px across, smallest 5px)
     - scatter-matrix: every visible series is one variable; all pairwise
       scatter panels, diagonal left free
     - sankey: rows "Source -> Target", first visible series = link value,
       nodes in order of first appearance, links tinted by their source
     - ridge-plot: one Gaussian KDE per series on a shared value axis,
       first series on top, ridges may rise into the row above

   Deliberate changes:
     - Ridge plot now uses the shared frame, so the Format Axis panel,
       tick/grid settings, fonts and number formats apply to its value axis
       (the old SVG ignored all of them).
     - Scatter matrix labels each variable in its (otherwise empty)
       diagonal panel.
   ========================================================================== */
(function () {
  "use strict";

  var PD = window.PlootsD3;
  function fin(v) { return typeof v === "number" && isFinite(v); }
  function historyPing() { if (typeof historyNotifyChange === "function") historyNotifyChange(); }

  function base() {
    var st = window.state;
    var xl = document.getElementById("xLabel"), yl = document.getElementById("yLabel");
    return {
      st: st,
      vertical: st.orientation === "vertical",
      vis: st.seriesNames.filter(function (e) { return st.seriesMeta[e] && st.seriesMeta[e].visible; }),
      cats: typeof wrappedCategories === "function" ? wrappedCategories() : st.categories,
      xTitle: st.showXAxisLabel && !st.xAxisTitleDetached && xl ? xl.value : "",
      yTitle: st.showYAxisLabel && !st.yAxisTitleDetached && yl ? yl.value : "",
      font: st.fontBody, size: st.bodyFontSize || 12,
      ink: PD.ink(),
      gray: isGrayscaleMode(),
      palette: PALETTES[st.paletteIdx].colors,
      fmt: function (v) { return typeof formatValue === "function" ? formatValue(v, st.valueFormat || "auto") : String(v); },
      bg: typeof chartBgColor === "function" ? chartBgColor() : "#fff"
    };
  }
  function halo(C) { return C.bg !== "rgba(0,0,0,0)" ? C.bg : "#ffffff"; }

  // Centred grey message in place of a chart (e.g. dumbbell with 1 series).
  PD.placeholder = function (gd, msg) {
    var st = window.state, b = st.chartBox, C = base();
    var svg = PD.mount(gd, b.w, b.h, C.bg);
    gd._plootsD3 = null;
    PD.richText(svg, msg, { x: b.w / 2, y: b.h / 2, size: 13, family: C.font, color: "#8a8a8a", anchor: "middle", valign: "middle" });
  };

  /* ===================================================== lollipop / dumbbell */

  function renderStems(gd, kind) {
    var C = base(), st = C.st, vis = C.vis, c = C.vertical;
    if (kind === "dumbbell" && vis.length < 2) {
      return PD.placeholder(gd, "Butuh minimal 2 seri visible (mis. \"sebelum\" & \"sesudah\") untuk Dumbbell chart.");
    }
    if (!vis.length) return PD.renderBlank(gd);
    var catName = c ? "x" : "y", valName = c ? "y" : "x";
    var vals = [];
    vis.forEach(function (e) { st.seriesData[e].forEach(function (v) { if (fin(v)) vals.push(v); }); });
    var axes = {};
    axes[catName] = { kind: "band", n: st.categories.length, labels: C.cats, title: c ? C.xTitle : C.yTitle, paddingInner: 0, paddingOuter: 0.1 };
    axes[valName] = { kind: "linear", values: vals, tozero: kind === "lollipop", pad: 0.05, padHiExtra: st.showValues ? 0.06 : 0, zeroline: true, title: c ? C.yTitle : C.xTitle };
    var outlineW = st.outlineMarker ? 1.4 : 0;
    function color(e, k) { return C.gray ? grayForIndex(k) : st.seriesMeta[e].color; }
    var legendItems = (vis.length > 1 ? vis : []).map(function (e, k) {
      var col = color(e, k);
      return { label: st.seriesMeta[e].label || e, kind: "marker", color: col, marker: "circle", markerSize: 10,
        markerFill: kind === "lollipop" && C.gray ? "#ffffff" : col, outlineW: outlineW || (C.gray ? 1 : 0), withLine: kind === "lollipop", lineW: 2 };
    });

    return PD.cartesian(gd, {
      axes: axes,
      legendItems: legendItems,
      onLegendMoved: historyPing,
      draw: function (ctx) {
        var cat = ctx.axes[catName], val = ctx.axes[valName].scale, step = cat.scale.step();
        var n = vis.length, gw = 0.62;
        function at(i, k) { // position of series k in category i
          var off = kind === "lollipop" && n > 1 ? (k - (n - 1) / 2) * (gw / n) * step : 0;
          return cat.pos(i) + off;
        }
        function pt(i, k, v) { return c ? [at(i, k), val(v)] : [val(v), at(i, k)]; }
        var gl = ctx.marks.append("g").attr("class", kind === "lollipop" ? "stems" : "connectors");
        var gm = ctx.over.append("g").attr("class", "markers").attr("clip-path", ctx.marks.attr("clip-path"));
        var gv = ctx.over.append("g").attr("class", "value-labels");
        var fsVal = Math.max(C.size - 2, 8);

        if (kind === "dumbbell") {
          var lw = st.lineWidth ? Math.max(1.5, st.lineWidth * 0.7) : 2;
          st.categories.forEach(function (_, i) {
            var pts = vis.map(function (e) { return st.seriesData[e][i]; }).filter(fin);
            if (pts.length < 2) return;
            var a = pt(i, 0, d3.min(pts)), b = pt(i, 0, d3.max(pts));
            gl.append("line").attr("x1", a[0]).attr("y1", a[1]).attr("x2", b[0]).attr("y2", b[1])
              .attr("stroke", C.gray ? "#9a9a96" : "#b9b6a8").attr("stroke-width", lw).attr("stroke-linecap", "round");
          });
        }
        vis.forEach(function (e, k) {
          var col = color(e, k);
          st.seriesData[e].forEach(function (v, i) {
            if (!fin(v)) return;
            var p = pt(i, k, v);
            if (kind === "lollipop") {
              var z = pt(i, k, 0);
              gl.append("line").attr("x1", z[0]).attr("y1", z[1]).attr("x2", p[0]).attr("y2", p[1])
                .attr("stroke", col).attr("stroke-width", st.lineWidth || 2.2);
            }
            PD.drawMarker(gm, p[0], p[1], "circle", 12, kind === "lollipop" && C.gray ? "#ffffff" : col, outlineW || (C.gray && kind === "lollipop" ? 1 : 0), C.ink.shape);
            if (st.showValues) {
              var before = kind === "dumbbell" && k === 0;
              if (c) PD.richText(gv, C.fmt(v), { x: p[0], y: before ? p[1] + 10 : p[1] - 10, size: fsVal, family: C.font, color: C.ink.text, anchor: "middle", valign: before ? "top" : "bottom", halo: halo(C) });
              else PD.richText(gv, C.fmt(v), { x: before ? p[0] - 10 : p[0] + 10, y: p[1], size: fsVal, family: C.font, color: C.ink.text, anchor: before ? "end" : "start", valign: "middle", halo: halo(C) });
            }
          });
        });
      }
    });
  }

  /* ============================================================== bubble */

  function renderBubble(gd) {
    var C = base(), st = C.st, names = st.seriesNames || [];
    if (!names.length || !st.categories.length) return PD.renderBlank(gd);
    var xs = st.categories.map(function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; });
    var groups = [];
    for (var gi = 0; gi < names.length; gi += 2) groups.push({ y: names[gi], size: names[gi + 1] || null, k: gi / 2 });
    groups = groups.filter(function (g) { return st.seriesData[g.y] && !(st.seriesMeta[g.y] && st.seriesMeta[g.y].visible === false); });
    if (!groups.length) return PD.renderBlank(gd);
    var maxSize = 0;
    groups.forEach(function (g) { if (g.size) (st.seriesData[g.size] || []).forEach(function (v) { if (fin(v) && v > maxSize) maxSize = v; }); });
    // Plotly sizemode "area": diameter = sqrt(size / sizeref), sizeref = 2·max / 46².
    var sizeref = maxSize > 0 ? 2 * maxSize / (46 * 46) : 1;
    function diam(g, i) {
      if (!g.size) return 16;
      var v = st.seriesData[g.size][i];
      return Math.max(5, Math.sqrt(Math.max(fin(v) ? v : 0, maxSize * 0.01) / sizeref));
    }
    var yv = [];
    groups.forEach(function (g) { st.seriesData[g.y].forEach(function (v) { if (fin(v)) yv.push(v); }); });
    var outlineW = st.outlineMarker ? 1.4 : 0;
    function color(g) { return C.gray ? grayForIndex(g.k) : (st.seriesMeta[g.y] ? st.seriesMeta[g.y].color : "#3d6363"); }
    var legendItems = groups.length > 1 ? groups.map(function (g) {
      var col = color(g);
      return { label: (st.seriesMeta[g.y] && st.seriesMeta[g.y].label) || g.y, kind: "marker", color: col, marker: "circle", markerSize: 10, markerFill: C.gray ? "#ffffff" : col, outlineW: outlineW || (C.gray ? 1 : 0) };
    }) : [];
    return PD.cartesian(gd, {
      axes: {
        x: { kind: "linear", values: xs, pad: 0.08, title: C.xTitle },
        y: { kind: "linear", values: yv, pad: 0.1, zeroline: true, title: C.yTitle }
      },
      legendItems: legendItems,
      onLegendMoved: historyPing,
      draw: function (ctx) {
        var X = ctx.axes.x.scale, Y = ctx.axes.y.scale;
        var gm = ctx.marks.append("g").attr("class", "bubbles"), gv = ctx.over.append("g").attr("class", "value-labels");
        var fsVal = Math.max(C.size - 2, 8);
        groups.forEach(function (g) {
          var col = color(g);
          st.seriesData[g.y].forEach(function (v, i) {
            if (!fin(v) || !fin(xs[i])) return;
            var d = diam(g, i), x = X(xs[i]), y = Y(v);
            gm.append("circle").attr("cx", x).attr("cy", y).attr("r", d / 2).attr("fill", C.gray ? "#ffffff" : col).attr("fill-opacity", 0.78)
              .attr("stroke", outlineW || C.gray ? C.ink.shape : "none").attr("stroke-width", outlineW || (C.gray ? 1 : 0));
            if (st.showValues) PD.richText(gv, C.fmt(v), { x: x, y: y - d / 2 - 3, size: fsVal, family: C.font, color: C.ink.text, anchor: "middle", valign: "bottom", halo: halo(C) });
          });
        });
      }
    });
  }

  /* ====================================================== scatter matrix */

  function renderSplom(gd) {
    var C = base(), st = C.st;
    var dims = C.vis.map(function (e) {
      return { label: st.seriesMeta[e].label || e, values: (st.seriesData[e] || []).map(function (v) { return fin(v) ? v : null; }) };
    });
    if (dims.length < 2) return PD.renderBlank(gd);
    var W = st.chartBox.w, H = st.chartBox.h, n = dims.length, gap = 8, fsT = 9;
    var scales = dims.map(function (d) {
      var ext = d3.extent(d.values.filter(fin));
      if (ext[0] == null) ext = [0, 1];
      if (ext[0] === ext[1]) ext = [ext[0] - 1, ext[1] + 1];
      var pad = (ext[1] - ext[0]) * 0.06;
      return d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).nice(4);
    });
    var tickW = d3.max(scales, function (s) { var f = s.tickFormat(4); return d3.max(s.ticks(4), function (t) { return PD.textWidth(f(t), fsT, C.font); }); }) || 20;
    var m = { t: 20, r: 20, b: 20 + fsT + 8, l: 20 + tickW + 6 };
    var cw = (W - m.l - m.r - gap * (n - 1)) / n, ch = (H - m.t - m.b - gap * (n - 1)) / n;
    var svg = PD.mount(gd, W, H, C.bg), defs = svg.select("defs");
    gd._plootsD3 = null;
    var pointColor = C.gray ? grayForIndex(0) : C.palette[0], ptLine = C.gray ? "#ffffff" : "#3a3a36";
    for (var r = 0; r < n; r++) {
      for (var col = 0; col < n; col++) {
        var x0 = m.l + col * (cw + gap), y0 = m.t + r * (ch + gap);
        var cell = svg.append("g").attr("class", "splom-cell").attr("transform", "translate(" + x0 + "," + y0 + ")");
        var xs = scales[col].copy().range([0, cw]), ys = scales[r].copy().range([ch, 0]);
        cell.append("rect").attr("width", cw).attr("height", ch).attr("fill", "none").attr("stroke", "#1a1a1a").attr("stroke-width", 0.8);
        if (r === col) {
          PD.richText(cell, dims[r].label, { x: cw / 2, y: ch / 2, size: C.size, family: C.font, color: C.ink.text, anchor: "middle", valign: "middle", weight: "600" });
        } else {
          var cid = "pd-sp-" + r + "-" + col + "-" + Math.random().toString(36).slice(2, 6);
          defs.append("clipPath").attr("id", cid).append("rect").attr("width", cw).attr("height", ch);
          var grid = cell.append("g");
          xs.ticks(4).forEach(function (t) { grid.append("line").attr("x1", xs(t)).attr("x2", xs(t)).attr("y1", 0).attr("y2", ch).attr("stroke", "#e4e2d8").attr("stroke-width", 0.8); });
          ys.ticks(4).forEach(function (t) { grid.append("line").attr("y1", ys(t)).attr("y2", ys(t)).attr("x1", 0).attr("x2", cw).attr("stroke", "#e4e2d8").attr("stroke-width", 0.8); });
          var pts = cell.append("g").attr("clip-path", "url(#" + cid + ")");
          dims[col].values.forEach(function (xv, i) {
            var yv = dims[r].values[i];
            if (!fin(xv) || !fin(yv)) return;
            pts.append("circle").attr("cx", xs(xv)).attr("cy", ys(yv)).attr("r", 2.5).attr("fill", pointColor).attr("fill-opacity", 0.75)
              .attr("stroke", ptLine).attr("stroke-width", 0.5);
          });
        }
        if (r === n - 1) {
          var fx = scales[col].tickFormat(4);
          xs.ticks(4).forEach(function (t) { PD.richText(cell, fx(t), { x: xs(t), y: ch + 4, size: fsT, family: C.font, color: "#4a4a46", anchor: "middle", valign: "top" }); });
        }
        if (col === 0) {
          var fy = scales[r].tickFormat(4);
          ys.ticks(4).forEach(function (t) { PD.richText(cell, fy(t), { x: -4, y: ys(t), size: fsT, family: C.font, color: "#4a4a46", anchor: "end", valign: "middle" }); });
        }
      }
    }
  }

  /* ============================================================== sankey */

  function sankeyData(st, vis) {
    var e = vis[0];
    if (!e) return null;
    var vals = st.seriesData[e] || [], nodes = [], index = {}, links = [];
    function idx(name) { if (!(name in index)) { index[name] = nodes.length; nodes.push({ name: name, i: nodes.length, ins: [], outs: [] }); } return index[name]; }
    st.categories.forEach(function (row, i) {
      var parts = String(row == null ? "" : row).split("->").map(function (s) { return s.trim(); }).filter(Boolean);
      var v = vals[i];
      if (parts.length < 2 || !fin(v) || v <= 0) return;
      var s = idx(parts[0]), t = idx(parts[parts.length - 1]);
      if (s === t) return;
      var l = { s: s, t: t, v: v };
      links.push(l);
      nodes[s].outs.push(l); nodes[t].ins.push(l);
    });
    return links.length ? { nodes: nodes, links: links } : null;
  }

  // Minimal Sankey layout (columns by longest path from a source, heights by
  // throughput, a few relaxation passes to straighten links) — the same idea
  // as d3-sankey, which isn't part of the bundled D3.
  function layoutSankey(data, w, h, nodeW, pad) {
    var nodes = data.nodes, links = data.links;
    nodes.forEach(function (n) {
      n.value = Math.max(d3.sum(n.ins, function (l) { return l.v; }), d3.sum(n.outs, function (l) { return l.v; }));
      n.col = 0;
    });
    // longest path, guarded against cycles
    for (var pass = 0; pass < nodes.length; pass++) {
      var changed = false;
      links.forEach(function (l) { if (nodes[l.t].col < nodes[l.s].col + 1 && nodes[l.s].col + 1 < nodes.length) { nodes[l.t].col = nodes[l.s].col + 1; changed = true; } });
      if (!changed) break;
    }
    // sinks go to the last column
    var maxCol = d3.max(nodes, function (n) { return n.col; }) || 0;
    nodes.forEach(function (n) { if (!n.outs.length) n.col = maxCol; });
    var cols = d3.range(maxCol + 1).map(function (c) { return nodes.filter(function (n) { return n.col === c; }); });
    var ky = d3.min(cols, function (col) { return (h - (col.length - 1) * pad) / (d3.sum(col, function (n) { return n.value; }) || 1); });
    nodes.forEach(function (n) {
      n.x0 = maxCol ? n.col * (w - nodeW) / maxCol : (w - nodeW) / 2;
      n.x1 = n.x0 + nodeW;
      n.h = Math.max(1, n.value * ky);
    });
    cols.forEach(function (col) {
      var y = 0;
      col.forEach(function (n) { n.y0 = y; y += n.h + pad; });
      var extra = h - (y - pad);
      col.forEach(function (n) { n.y0 += extra / 2; n.y1 = n.y0 + n.h; });
    });
    function centre(n) { return (n.y0 + n.y1) / 2; }
    function resolve(col) {
      col.sort(function (a, b) { return a.y0 - b.y0; });
      var y = 0;
      col.forEach(function (n) { if (n.y0 < y) n.y0 = y; n.y1 = n.y0 + n.h; y = n.y1 + pad; });
      var over = y - pad - h;
      if (over > 0) {
        y = h;
        for (var i = col.length - 1; i >= 0; i--) {
          var n = col[i];
          if (n.y1 > y) { n.y1 = y; n.y0 = y - n.h; }
          y = n.y0 - pad;
        }
      }
    }
    for (var it = 0; it < 8; it++) {
      var alpha = Math.pow(0.9, it);
      cols.forEach(function (col, ci) {
        col.forEach(function (n) {
          var ls = ci ? n.ins : n.outs, wsum = d3.sum(ls, function (l) { return l.v; });
          if (!wsum) return;
          var target = d3.sum(ls, function (l) { return centre(nodes[ci ? l.s : l.t]) * l.v; }) / wsum;
          var dy = (target - centre(n)) * alpha;
          n.y0 += dy; n.y1 += dy;
        });
        resolve(col);
      });
    }
    // link attachment points, ordered by the other end's position
    nodes.forEach(function (n) {
      n.outs.sort(function (a, b) { return nodes[a.t].y0 - nodes[b.t].y0; });
      n.ins.sort(function (a, b) { return nodes[a.s].y0 - nodes[b.s].y0; });
      var y = n.y0;
      n.outs.forEach(function (l) { l.w = l.v * ky; l.y0 = y + l.w / 2; y += l.w; });
      y = n.y0;
      n.ins.forEach(function (l) { l.y1 = y + l.v * ky / 2; y += l.v * ky; });
    });
    return { maxCol: maxCol };
  }

  function renderSankey(gd) {
    var C = base(), st = C.st, data = sankeyData(st, C.vis);
    if (!data) return PD.renderBlank(gd);
    // Every label sits to the right of its node, so each gap holds one label;
    // the right margin makes room for the last column's (the sinks') labels.
    var sinkLabelW = d3.max(data.nodes, function (n) { return n.outs.length ? 0 : PD.richSize(n.name, C.size, C.font).w; }) || 0;
    var W = st.chartBox.w, H = st.chartBox.h, m = { t: 20, r: 20 + sinkLabelW + 6, b: 20, l: 20 }, nodeW = 16, pad = 14;
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    layoutSankey(data, iw, ih, nodeW, pad);
    var svg = PD.mount(gd, W, H, C.bg);
    gd._plootsD3 = null;
    var g = svg.append("g").attr("class", "sankey").attr("transform", "translate(" + m.l + "," + m.t + ")");
    var nodeColor = data.nodes.map(function (n, i) { return C.gray ? grayForIndex(i) : C.palette[i % C.palette.length]; });
    // Links are filled ribbons (top and bottom edge curves), not thick strokes:
    // a stroke wider than the column gap folds over itself on the curve.
    var lg = g.append("g").attr("class", "links");
    data.links.forEach(function (l) {
      var s = data.nodes[l.s], t = data.nodes[l.t], x0 = s.x1, x1 = t.x0, xm = (x0 + x1) / 2, hw = Math.max(0.5, l.w / 2);
      var a0 = l.y0 - hw, a1 = l.y1 - hw, b0 = l.y0 + hw, b1 = l.y1 + hw;
      lg.append("path").attr("d", "M" + x0 + "," + a0 + "C" + xm + "," + a0 + " " + xm + "," + a1 + " " + x1 + "," + a1 +
        "L" + x1 + "," + b1 + "C" + xm + "," + b1 + " " + xm + "," + b0 + " " + x0 + "," + b0 + "Z")
        .attr("fill", hexToRgba(nodeColor[l.s], 0.42));
    });
    var ng = g.append("g").attr("class", "nodes");
    data.nodes.forEach(function (n, i) {
      ng.append("rect").attr("x", n.x0).attr("y", n.y0).attr("width", nodeW).attr("height", Math.max(1, n.y1 - n.y0))
        .attr("fill", nodeColor[i]).attr("stroke", C.gray ? "#ffffff" : "#3a3a36").attr("stroke-width", 0.5);
      PD.richText(ng, n.name, { x: n.x1 + 6, y: (n.y0 + n.y1) / 2, size: C.size, family: C.font, color: "#1a1a1a", anchor: "start", valign: "middle", halo: halo(C), haloW: 3 });
    });
  }

  /* ========================================================== ridge plot */

  function renderRidge(gd) {
    var C = base(), st = C.st;
    var rows = C.vis.map(function (e) {
      return { e: e, label: st.seriesMeta[e].label || e, values: (st.seriesData[e] || []).filter(fin) };
    }).filter(function (r) { return r.values.length >= 2; });
    if (!rows.length) return PD.placeholder(gd, "Butuh minimal 1 seri numerik (≥ 2 titik) untuk menghitung KDE.");
    var all = [];
    rows.forEach(function (r) { all = all.concat(r.values); });
    var lo = d3.min(all), hi = d3.max(all), pad = (hi - lo) * 0.15 || Math.abs(hi || 1) * 0.15 || 1;
    var xs = d3.range(120).map(function (i) { return lo - pad + (hi - lo + 2 * pad) * i / 119; });
    rows.forEach(function (r) {
      var sd = d3.deviation(r.values) || 0, n = r.values.length;
      var bw = sd > 0 ? 1.06 * sd * Math.pow(n, -0.2) : ((hi - lo + 2 * pad) / 20 || 1);
      r.dens = xs.map(function (x) {
        var s = 0;
        for (var i = 0; i < n; i++) { var u = (x - r.values[i]) / bw; s += Math.exp(-0.5 * u * u); }
        return s / (n * bw * Math.sqrt(2 * Math.PI));
      });
    });
    var maxD = d3.max(rows, function (r) { return d3.max(r.dens); }) || 1;
    return PD.cartesian(gd, {
      axes: {
        // No axis title: the Y-label field holds the first series' name here.
        x: { kind: "linear", values: [lo - pad, hi + pad], noNice: true },
        // Ridges rise up to 1.7 rows; give the top row that headroom
        // (range runs top -> bottom; align 1 puts the outer padding before the
        // first band, i.e. at the top).
        y: { kind: "band", n: rows.length, labels: rows.map(function (r) { return r.label; }), reverse: true, paddingInner: 0, paddingOuter: 0.4, align: 1 }
      },
      legendItems: [],
      draw: function (ctx) {
        var X = ctx.axes.x.scale, Y = ctx.axes.y.scale, rowH = Y.bandwidth(), amp = rowH * 1.7 / maxD;
        var g = ctx.marks.append("g").attr("class", "ridges");
        // bottom row first so upper ridges overlap the ones below
        for (var k = rows.length - 1; k >= 0; k--) {
          var r = rows[k], base0 = Y(k) + rowH, color = C.gray ? grayForIndex(k) : C.palette[k % C.palette.length];
          var area = d3.area().x(function (d, i) { return X(xs[i]); }).y0(base0).y1(function (d) { return base0 - d * amp; });
          g.append("path").attr("d", area(r.dens)).attr("fill", isPatternish() ? color : hexToRgba(color, 0.82))
            .attr("stroke", C.gray ? "#ffffff" : "#3a3a36").attr("stroke-width", 1);
          g.append("line").attr("x1", X.range()[0]).attr("x2", X.range()[1]).attr("y1", base0).attr("y2", base0).attr("stroke", "#c9c7ba").attr("stroke-width", 0.75);
        }
      }
    });
  }

  /* ============================================ hand-drawn SVG chart types */

  // Radial rings and sunburst already draw their own <svg>; running them
  // through PlootsD3 gives them the same render/export/blank-canvas path.
  function wrapLegacy(fnName) {
    return function (gd) {
      if (typeof window[fnName] === "function") window[fnName]();
      gd._plootsD3 = null;
    };
  }

  PD.renderers["lollipop"] = function (gd) { return renderStems(gd, "lollipop"); };
  PD.renderers["dumbbell"] = function (gd) { return renderStems(gd, "dumbbell"); };
  PD.renderers["bubble"] = function (gd) { return renderBubble(gd); };
  PD.renderers["scatter-matrix"] = function (gd) { return renderSplom(gd); };
  PD.renderers["sankey"] = function (gd) { return renderSankey(gd); };
  PD.renderers["ridge-plot"] = function (gd) { return renderRidge(gd); };
  PD.renderers["radial-rings"] = wrapLegacy("renderRadialRings");
  PD.renderers["sunburst"] = wrapLegacy("renderSunburst");
})();
