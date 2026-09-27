/* ==========================================================================
   Ploots D3 engine — cartesian frame.

   PlootsD3.cartesian(gd, def) lays out and draws everything around the data:
   scales, grid, zero line, axis lines, ticks, tick labels, axis titles,
   frame, legend. The chart-type renderer supplies the axis specs and a
   draw(ctx) callback that paints the marks into ctx.marks (clipped to the
   plot area) and ctx.over (not clipped: value labels, error-bar caps).

   Margins are computed, not guessed: the loop measures real tick labels,
   titles and the legend, sizes the plot area, rebuilds the scales, and
   repeats until the margins stop changing (max 4 passes). The base margins
   (t30 r40 b60 l65) match the old Plotly layout, so a chart only grows its
   margins when its labels need the room — same rule as Plotly's automargin.

   Axis settings are read from the same `state` keys the sidebar, the Format
   Axis panel and the quick bars already write (xAxisTicksShow,
   yAxisGridShow, xAxisRangeMode, ...). Keys are physical: "x" is the
   horizontal axis, "y" the vertical one — exactly how Plotly's layout.xaxis
   / layout.yaxis mapped them, so saved states keep their meaning.
   ========================================================================== */
(function () {
  "use strict";

  var PD = window.PlootsD3;
  var BASE_MARGIN = { t: 30, r: 40, b: 60, l: 65 };

  function S() { return window.state; }
  // Snap a hairline to the pixel grid so a 1px line covers one pixel row
  // instead of two half-tone rows (Plotly does the same).
  function crisp(p, w) { return Math.round(w || 1) % 2 ? Math.round(p - 0.5) + 0.5 : Math.round(p); }
  function fin(v) { return typeof v === "number" && isFinite(v); }

  /* --------------------------------------------------- axis config/state */

  function axisSettings(prefix, secondary) {
    var st = S(), p = prefix;
    var lineW = st.axisLineWidth || 1;
    var ticklen = fin(st[p + "AxisTicksLength"]) ? st[p + "AxisTicksLength"] : 6;
    var tickW = fin(st[p + "AxisTickWidth"]) ? st[p + "AxisTickWidth"] : lineW;
    return {
      ticksShow: secondary ? true : !!st[p + "AxisTicksShow"],
      ticksPos: st[p + "AxisTicksPosition"] || "outside",
      ticklen: ticklen,
      tickW: tickW,
      minorShow: secondary ? false : !!st[p + "AxisMinorTicksShow"],
      minorGrid: secondary ? false : !!st[p + "AxisMinorGridShow"],
      minorMode: st[p + "AxisMinorTicksMode"] || "auto",
      minorStep: st[p + "AxisMinorTicksStep"],
      minorDivide: Math.max(2, Math.round(st[p + "AxisMinorTicksDivide"] || 5)),
      grid: secondary ? false : !!st[p + "AxisGridShow"],
      labelsShow: st[p + "AxisTickLabelsShow"] !== false,
      numFmt: st[p + "AxisNumberFormat"] || "auto",
      lineColor: st[p + "AxisLineColor"] || PD.ink().axis,
      lineW: (fin(st[p + "AxisLineWidth"]) && st[p + "AxisLineWidth"] > 0) ? st[p + "AxisLineWidth"] : lineW,
      log: secondary ? false : !!st[p + "AxisLogScale"],
      rangeCustom: !secondary && st[p + "AxisRangeMode"] === "custom" && fin(st[p + "AxisMin"]) && fin(st[p + "AxisMax"]) && st[p + "AxisMin"] !== st[p + "AxisMax"],
      rmin: st[p + "AxisMin"], rmax: st[p + "AxisMax"],
      dtick: (!secondary && st[p + "AxisTickMode"] === "custom" && fin(st[p + "AxisTickStep"]) && st[p + "AxisTickStep"] > 0) ? st[p + "AxisTickStep"] : null
    };
  }

  /* -------------------------------------------------------- domains/ticks */

  function numericDomain(ax) {
    var cfg = ax.cfg;
    if (cfg.rangeCustom) return { d: [cfg.rmin, cfg.rmax], fixed: true };
    if (ax.fixedDomain) return { d: ax.fixedDomain.slice(), fixed: true };
    var vals = (ax.values || []).filter(fin);
    if (cfg.log) vals = vals.filter(function (v) { return v > 0; });
    var lo = d3.min(vals), hi = d3.max(vals);
    if (lo == null) { lo = cfg.log ? 1 : 0; hi = cfg.log ? 10 : 1; }
    if (ax.tozero && !cfg.log) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (lo === hi) {
      var dd = cfg.log ? lo * 0.5 : (Math.abs(lo) * 0.1 || 1);
      lo -= dd; hi += dd;
      if (cfg.log && lo <= 0) lo = hi / 10;
    }
    var pad = ax.pad || 0, padHi = pad + (ax.padHiExtra || 0);
    if (cfg.log) {
      var l0 = Math.log10(lo), l1 = Math.log10(hi), sp = l1 - l0;
      return { d: [Math.pow(10, l0 - sp * pad), Math.pow(10, l1 + sp * padHi)], fixed: false };
    }
    var span = hi - lo;
    var anchoredLo = ax.tozero && lo === 0, anchoredHi = ax.tozero && hi === 0;
    return { d: [anchoredLo ? lo : lo - span * pad, anchoredHi ? hi : hi + span * padHi], fixed: false };
  }

  function stepTicks(d, step, t0) {
    var a = Math.min(d[0], d[1]), b = Math.max(d[0], d[1]), out = [];
    var k0 = Math.ceil((a - t0) / step - 1e-9), k1 = Math.floor((b - t0) / step + 1e-9);
    if (k1 - k0 > 500) return null;
    for (var k = k0; k <= k1; k++) out.push(+(t0 + k * step).toPrecision(12));
    return out;
  }

  function buildScale(ax, range) {
    var sc;
    if (ax.kind === "band") {
      sc = d3.scaleBand().domain(d3.range(ax.n)).range(range)
        .paddingInner(ax.paddingInner || 0).paddingOuter(ax.paddingOuter || 0);
      ax.majors = d3.range(ax.n);
      ax.minors = [];
      ax.pos = function (i) { return sc(i) + sc.bandwidth() / 2; };
      ax.fmt = function (i) { return ax.labels[i]; };
    } else if (ax.kind === "point") {
      sc = d3.scalePoint().domain(d3.range(ax.n)).range(range).padding(ax.padding || 0);
      ax.majors = d3.range(ax.n);
      ax.minors = [];
      ax.pos = function (i) { return sc(i); };
      ax.fmt = function (i) { return ax.labels[i]; };
    } else {
      var dom = numericDomain(ax);
      var len = Math.abs(range[1] - range[0]);
      var count = Math.max(2, Math.round(len / (ax.dir === "h" ? 90 : 55)));
      sc = (ax.cfg.log ? d3.scaleLog() : d3.scaleLinear()).domain(dom.d).range(range);
      if (!dom.fixed && !ax.noNice) sc.nice(count);
      var d = sc.domain(), majors, minors = [];
      if (ax.cfg.log) {
        var all = sc.ticks(count * 2), decades = Math.log10(d[1] / d[0]);
        majors = all.filter(function (v) {
          var m = v / Math.pow(10, Math.floor(Math.log10(v) + 1e-9));
          m = Math.round(m * 1e6) / 1e6;
          return decades > 2.5 ? m === 1 : (m === 1 || m === 2 || m === 5);
        });
        if (majors.length < 2) majors = all.slice();
        minors = all.filter(function (v) { return majors.indexOf(v) === -1; });
      } else {
        majors = null;
        if (ax.cfg.dtick) {
          majors = stepTicks(d, ax.cfg.dtick, ax.cfg.rangeCustom ? ax.cfg.rmin : 0);
        }
        if (!majors) majors = sc.ticks(count);
        var step = majors.length > 1 ? Math.abs(majors[1] - majors[0]) : Math.abs(d[1] - d[0]);
        var ms = null;
        if (ax.cfg.minorMode === "manual" && fin(ax.cfg.minorStep) && ax.cfg.minorStep > 0) ms = ax.cfg.minorStep;
        else if (ax.cfg.minorMode === "divide") ms = step / ax.cfg.minorDivide;
        else {
          var lead = Math.round(step / Math.pow(10, Math.floor(Math.log10(step) + 1e-9)));
          ms = step / (lead === 2 ? 4 : 5);
        }
        if (ms > 0 && (ax.cfg.minorShow || ax.cfg.minorGrid)) {
          var t0 = majors.length ? majors[0] : 0;
          minors = (stepTicks(d, ms, t0) || []).filter(function (v) {
            return !majors.some(function (m) { return Math.abs(m - v) < ms * 1e-6; });
          });
        }
      }
      ax.majors = majors;
      ax.minors = minors;
      ax.pos = function (v) { return sc(v); };
      var f = PD.axisFormatter(ax.cfg.numFmt, majors, ax.cfg.log);
      ax.fmt = f;
    }
    ax.scale = sc;
    return sc;
  }

  /* ------------------------------------------------------ axis thickness */

  // How far an axis' decorations (outside ticks, labels, title) reach out
  // from the plot edge, in px. Also decides label rotation for horizontal
  // category axes.
  function measureAxis(ax, font, size) {
    var cfg = ax.cfg, st = S();
    var tickOut = cfg.ticksShow && cfg.ticksPos === "outside" ? cfg.ticklen : 0;
    var labels = cfg.labelsShow ? ax.majors.map(function (v) { return ax.fmt(v); }) : [];
    var sizes = labels.map(function (t) { return PD.richSize(t, size, font); });
    var maxW = d3.max(sizes, function (s) { return s.w; }) || 0;
    var maxH = d3.max(sizes, function (s) { return s.h; }) || 0;
    ax.rotate = 0;
    var labelExtent;
    if (ax.dir === "h") {
      if ((ax.kind === "band" || ax.kind === "point") && labels.length > 1) {
        var step = Math.abs(ax.pos(1) - ax.pos(0));
        if (maxW > step * 0.92) ax.rotate = -45;
      }
      labelExtent = ax.rotate ? (maxW * Math.SQRT1_2 + maxH * Math.SQRT1_2) : maxH;
    } else {
      labelExtent = maxW;
    }
    var gap = labels.length ? 4 : 0;
    var titleSz = ax.title ? PD.richSize(ax.title, size + 1, font) : null;
    var titleExt = titleSz ? (ax.dir === "h" ? titleSz.h : titleSz.h) + 10 : 0;
    ax.labelOffset = tickOut + gap;
    ax.titleOffset = tickOut + gap + labelExtent + 8;
    ax.extent = tickOut + gap + labelExtent + titleExt + 4;
    ax.labelSizes = sizes;
    ax.maxLabelW = maxW;
    return ax.extent;
  }

  /* --------------------------------------------------------------- legend */

  function legendLayout(items, font, fs) {
    var st = S();
    if (!st.showLegend || st.legendDetached || !items.length) return null;
    var hint = st.legendCustomPos ? null : (LEGEND_HINTS[st.legendPos] || LEGEND_HINTS["top-right"]);
    var horizontal = hint ? hint.orientation === "h" : false;
    var rowH = Math.max(fs * 1.4, 16);
    var allBars = items.every(function (it) { return it.kind === "bar" || it.kind === "area"; });
    var swW = allBars ? 16 : 30;
    items.forEach(function (it) { it.w = swW + 6 + PD.richSize(it.label, fs, font).w; it.swW = swW; });
    var pad = st.legendBorder ? 7 : 2;
    var titleH = st.legendTitle ? fs * 1.35 + 3 : 0;
    var placed = [], w = 0, h = 0;
    if (horizontal) {
      var maxRow = Math.max(160, (st.chartBox.w || 600) - 40), x = 0, y = 0;
      items.forEach(function (it) {
        if (x > 0 && x + it.w > maxRow) { x = 0; y += rowH; }
        placed.push({ it: it, x: x, y: y });
        x += it.w + 18;
        w = Math.max(w, x - 18);
      });
      h = y + rowH;
    } else {
      var cols = Math.max(1, Math.min(4, st.legendCols || 1));
      if (hint && hint.orientation !== "v") cols = 1;
      var colW = [], rows = Math.ceil(items.length / cols);
      items.forEach(function (it, k) { var c = k % cols; colW[c] = Math.max(colW[c] || 0, it.w); });
      var colX = [], acc = 0;
      colW.forEach(function (cw, c) { colX[c] = acc; acc += cw + 16; });
      items.forEach(function (it, k) { placed.push({ it: it, x: colX[k % cols], y: Math.floor(k / cols) * rowH }); });
      w = acc - 16; h = rows * rowH;
    }
    if (st.legendTitle) w = Math.max(w, PD.richSize(st.legendTitle, fs, font).w);
    return { placed: placed, w: w + 2 * pad, h: h + titleH + 2 * pad, pad: pad, titleH: titleH, rowH: rowH, hint: hint };
  }

  function legendPosition(L, plot, ext) {
    var st = S();
    if (st.legendCustomPos) {
      return { x: plot.l + st.legendCustomPos.x * plot.w, y: plot.t + (1 - st.legendCustomPos.y) * plot.h };
    }
    var key = st.legendPos || "top-right", gap = 8;
    var r = plot.l + plot.w, b = plot.t + plot.h;
    switch (key) {
      case "top-left": return { x: plot.l, y: plot.t - ext.t - gap - L.h };
      case "top-center": return { x: plot.l + (plot.w - L.w) / 2, y: plot.t - ext.t - gap - L.h };
      case "bottom-center": return { x: plot.l + (plot.w - L.w) / 2, y: b + ext.b + gap };
      case "right-middle": return { x: r + ext.r + gap + 4, y: plot.t + (plot.h - L.h) / 2 };
      case "left-middle": return { x: plot.l - ext.l - gap - 4 - L.w, y: plot.t + (plot.h - L.h) / 2 };
      case "inside-top-right": return { x: r - L.w - 6, y: plot.t + 6 };
      default: return { x: r - L.w, y: plot.t - ext.t - gap - L.h };
    }
  }

  function drawLegendSwatch(g, it, cx, cy) {
    var ink = PD.ink();
    var x0 = cx, w = it.swW;
    if (it.kind === "bar" || it.kind === "area") {
      var s = 13;
      g.append("rect").attr("x", x0 + (w - s) / 2).attr("y", cy - s / 2).attr("width", s).attr("height", s)
        .attr("fill", it.fill || it.color).attr("stroke", it.stroke || (it.kind === "area" ? it.color : "none"))
        .attr("stroke-width", it.strokeW || (it.kind === "area" ? 1.5 : 0));
      return;
    }
    if (it.kind === "line" || it.kind === "trend" || (it.kind === "marker" && it.withLine)) {
      g.append("line").attr("x1", x0).attr("x2", x0 + w).attr("y1", cy).attr("y2", cy)
        .attr("stroke", it.color).attr("stroke-width", Math.min(it.lineW || 2, 4))
        .attr("stroke-dasharray", PD.dashArray(it.kind === "trend" ? "dot" : it.dash, Math.min(it.lineW || 2, 4)));
    }
    if (it.marker) {
      PD.drawMarker(g, x0 + w / 2, cy, it.marker, Math.min(it.markerSize || 8, 10), it.markerFill || it.color, it.outlineW || 0, ink.shape);
    }
  }

  function drawLegend(svg, L, pos, font, fs, plot, onMoved) {
    var st = S(), ink = PD.ink();
    var g = svg.append("g").attr("class", "legend").attr("transform", "translate(" + pos.x + "," + pos.y + ")");
    g.append("rect").attr("class", "legend-bg").attr("width", L.w).attr("height", L.h)
      .attr("fill", st.legendBorder ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0)")
      .attr("stroke", st.legendBorder ? ink.text : "none").attr("stroke-width", st.legendBorder ? 1 : 0);
    if (st.legendTitle) {
      PD.richText(g, st.legendTitle, { x: L.pad, y: L.pad, size: fs, family: font, color: ink.text, valign: "top", weight: "600" });
    }
    L.placed.forEach(function (p) {
      var gy = L.pad + L.titleH + p.y + L.rowH / 2, gx = L.pad + p.x;
      var ig = g.append("g").attr("class", "legend-item");
      drawLegendSwatch(ig, p.it, gx, gy);
      PD.richText(ig, p.it.label, { x: gx + p.it.swW + 6, y: gy, size: fs, family: font, color: ink.text, valign: "middle" });
    });
    // Drag to reposition. The Fabric overlay lets the pointer through while
    // hovering a legend (14-legend-hover.js looks for g.legend), same as it
    // did for Plotly's draggable legend. Position is stored in paper
    // coordinates (fractions of the plot area), like legendCustomPos was.
    g.style("cursor", "move").call(d3.drag()
      .on("start", function (ev) { this.__o = { x: ev.x - pos.x, y: ev.y - pos.y }; })
      .on("drag", function (ev) {
        pos.x = ev.x - this.__o.x; pos.y = ev.y - this.__o.y;
        g.attr("transform", "translate(" + pos.x + "," + pos.y + ")");
      })
      .on("end", function () {
        st.legendCustomPos = { x: (pos.x - plot.l) / plot.w, y: 1 - (pos.y - plot.t) / plot.h };
        if (onMoved) onMoved();
      }));
    return g;
  }

  /* -------------------------------------------------------- axis drawing */

  function drawGrid(layer, ax, plot, minor) {
    var vals = minor ? ax.minors : ax.majors;
    var on = minor ? ax.cfg.minorGrid : ax.cfg.grid;
    if (!on || !vals.length) return;
    var ink = PD.ink();
    vals.forEach(function (v) {
      var p = crisp(ax.pos(v), 1);
      var l = layer.append("line").attr("stroke", ink.grid).attr("stroke-width", minor ? 0.6 : 1);
      if (ax.dir === "h") l.attr("x1", p).attr("x2", p).attr("y1", plot.t).attr("y2", plot.t + plot.h);
      else l.attr("y1", p).attr("y2", p).attr("x1", plot.l).attr("x2", plot.l + plot.w);
    });
  }

  // side: "bottom" | "top" | "left" | "right"
  function drawTicks(g, ax, side, plot, len, width, color, vals) {
    var inside = ax.cfg.ticksPos === "inside";
    var sgn = (side === "bottom" || side === "right") ? 1 : -1;
    if (inside) sgn = -sgn;
    vals.forEach(function (v) {
      var p = crisp(ax.pos(v), width), l = g.append("line").attr("stroke", color).attr("stroke-width", width);
      if (side === "bottom" || side === "top") {
        var y0 = side === "bottom" ? plot.t + plot.h : plot.t;
        l.attr("x1", p).attr("x2", p).attr("y1", y0).attr("y2", y0 + sgn * len);
      } else {
        var x0 = side === "left" ? plot.l : plot.l + plot.w;
        l.attr("y1", p).attr("y2", p).attr("x1", x0).attr("x2", x0 + sgn * len);
      }
    });
  }

  function drawAxis(svg, ax, side, plot, font, size, frame) {
    var ink = PD.ink(), cfg = ax.cfg;
    var g = svg.append("g").attr("class", "axis axis-" + ax.name);
    var horiz = side === "bottom" || side === "top";
    // axis line
    if (!frame) {
      var ln = g.append("line").attr("class", "axis-line").attr("stroke", cfg.lineColor).attr("stroke-width", cfg.lineW)
        .attr("stroke-linecap", "square");
      if (horiz) {
        var y = crisp(side === "bottom" ? plot.t + plot.h : plot.t, cfg.lineW);
        ln.attr("x1", plot.l).attr("x2", plot.l + plot.w).attr("y1", y).attr("y2", y);
      } else {
        var x = crisp(side === "left" ? plot.l : plot.l + plot.w, cfg.lineW);
        ln.attr("x1", x).attr("x2", x).attr("y1", plot.t).attr("y2", plot.t + plot.h);
      }
    }
    var tickColor = frame ? ink.shape : ink.axis;
    if (cfg.ticksShow) drawTicks(g, ax, side, plot, cfg.ticklen, cfg.tickW, tickColor, ax.majors);
    if (cfg.minorShow && ax.minors.length) drawTicks(g, ax, side, plot, Math.max(2, cfg.ticklen * 0.55), Math.max(0.5, cfg.tickW * 0.7), tickColor, ax.minors);
    // tick labels
    if (cfg.labelsShow) {
      var lg = g.append("g").attr("class", "tick-labels");
      ax.majors.forEach(function (v) {
        var p = ax.pos(v), txt = ax.fmt(v);
        if (side === "bottom") {
          if (ax.rotate) PD.richText(lg, txt, { x: p, y: plot.t + plot.h + ax.labelOffset + 2, size: size, family: font, color: ink.axis, anchor: "end", valign: "middle", rotate: ax.rotate });
          else PD.richText(lg, txt, { x: p, y: plot.t + plot.h + ax.labelOffset, size: size, family: font, color: ink.axis, anchor: "middle", valign: "top" });
        } else if (side === "top") {
          PD.richText(lg, txt, { x: p, y: plot.t - ax.labelOffset, size: size, family: font, color: ink.axis, anchor: "middle", valign: "bottom" });
        } else if (side === "left") {
          PD.richText(lg, txt, { x: plot.l - ax.labelOffset, y: p, size: size, family: font, color: ink.axis, anchor: "end", valign: "middle" });
        } else {
          PD.richText(lg, txt, { x: plot.l + plot.w + ax.labelOffset, y: p, size: size, family: font, color: ink.axis, anchor: "start", valign: "middle" });
        }
      });
    }
    // title
    if (ax.title) {
      var ts = size + 1, off = ax.titleOffset + 2;
      if (side === "bottom") PD.richText(g, ax.title, { x: plot.l + plot.w / 2, y: plot.t + plot.h + off, size: ts, family: font, color: ink.axis, anchor: "middle", valign: "top", cls: "axis-title" });
      else if (side === "top") PD.richText(g, ax.title, { x: plot.l + plot.w / 2, y: plot.t - off, size: ts, family: font, color: ink.axis, anchor: "middle", valign: "bottom", cls: "axis-title" });
      else if (side === "left") PD.richText(g, ax.title, { x: plot.l - off, y: plot.t + plot.h / 2, size: ts, family: font, color: ink.axis, anchor: "middle", valign: "bottom", rotate: -90, cls: "axis-title" });
      else PD.richText(g, ax.title, { x: plot.l + plot.w + off, y: plot.t + plot.h / 2, size: ts, family: font, color: ink.axis, anchor: "middle", valign: "bottom", rotate: 90, cls: "axis-title" });
    }
    return g;
  }

  /* ---------------------------------------------------------------- main */

  var SIDE = { x: "bottom", y: "left", y2: "right", x2: "top" };

  /* def = {
       axes: { x: axisSpec, y: axisSpec, y2?: axisSpec, x2?: axisSpec },
       legendItems: [ {label, kind, color, fill, dash, lineW, marker, ...} ],
       draw: function (ctx) {}
     }
     axisSpec = { kind: "band"|"point"|"linear", labels, n, values, tozero,
                  pad, padHiExtra, paddingInner, paddingOuter, padding,
                  title, zeroline, reverse, noNice } */
  PD.cartesian = function (gd, def) {
    var st = S(), box = st.chartBox, W = box.w, H = box.h;
    var font = st.fontBody, size = st.bodyFontSize || 12;
    var fs = st.legendFontSize || size;
    var ink = PD.ink();

    var axes = {};
    Object.keys(def.axes).forEach(function (name) {
      var a = def.axes[name];
      if (!a) return;
      a.name = name;
      a.dir = (name === "x" || name === "x2") ? "h" : "v";
      a.side = SIDE[name];
      a.cfg = axisSettings(name.charAt(0), name.length > 1);
      axes[name] = a;
    });

    var L = legendLayout(def.legendItems || [], font, fs);
    var m = { t: BASE_MARGIN.t, r: BASE_MARGIN.r, b: BASE_MARGIN.b, l: BASE_MARGIN.l };
    var plot, ext;
    for (var pass = 0; pass < 4; pass++) {
      plot = { l: m.l, t: m.t, w: Math.max(40, W - m.l - m.r), h: Math.max(40, H - m.t - m.b) };
      ext = { t: 0, r: 0, b: 0, l: 0 };
      Object.keys(axes).forEach(function (name) {
        var a = axes[name];
        var range = a.dir === "h" ? [plot.l, plot.l + plot.w] : (a.reverse ? [plot.t, plot.t + plot.h] : [plot.t + plot.h, plot.t]);
        buildScale(a, range);
        var e = measureAxis(a, font, size);
        ext[{ bottom: "b", top: "t", left: "l", right: "r" }[a.side]] = e;
      });
      // mirrored ticks / frame still take a little room on the free sides
      if (!axes.y2 && st.outlineFrame && st.mirrorAxisTicks && axes.y.cfg.ticksShow && axes.y.cfg.ticksPos === "outside") ext.r = Math.max(ext.r, axes.y.cfg.ticklen);
      if (!axes.x2 && st.outlineFrame && st.mirrorAxisTicks && axes.x.cfg.ticksShow && axes.x.cfg.ticksPos === "outside") ext.t = Math.max(ext.t, axes.x.cfg.ticklen);
      // last horizontal tick label may hang past the plot edge
      if (axes.x && axes.x.labelSizes.length && !axes.x.rotate) {
        var lastP = axes.x.pos(axes.x.majors[axes.x.majors.length - 1]);
        var hang = lastP + axes.x.labelSizes[axes.x.labelSizes.length - 1].w / 2 - (plot.l + plot.w);
        ext.r = Math.max(ext.r, hang + 4);
      }
      if (axes.x && axes.x.rotate && axes.x.labelSizes.length) {
        var firstP = axes.x.pos(axes.x.majors[0]);
        var over = axes.x.maxLabelW * Math.SQRT1_2 - (firstP - 4);
        ext.l = Math.max(ext.l, over);
      }
      var need = { t: ext.t + 6, r: ext.r + 6, b: ext.b + 6, l: ext.l + 6 };
      if (L && !st.legendCustomPos) {
        var key = st.legendPos || "top-right";
        if (/^top/.test(key)) need.t = ext.t + 8 + L.h + 6;
        else if (key === "bottom-center") need.b = ext.b + 8 + L.h + 6;
        else if (key === "right-middle") need.r = ext.r + 12 + L.w + 6;
        else if (key === "left-middle") need.l = ext.l + 12 + L.w + 6;
      }
      var nm = {
        t: Math.ceil(Math.max(BASE_MARGIN.t, need.t)), r: Math.ceil(Math.max(BASE_MARGIN.r, need.r)),
        b: Math.ceil(Math.max(BASE_MARGIN.b, need.b)), l: Math.ceil(Math.max(BASE_MARGIN.l, need.l))
      };
      if (nm.t === m.t && nm.r === m.r && nm.b === m.b && nm.l === m.l) break;
      m = nm;
    }

    var svg = PD.mount(gd, W, H, typeof chartBgColor === "function" ? chartBgColor() : "#fff");
    var defs = svg.select("defs");
    var clipId = "pd-clip-" + Math.random().toString(36).slice(2, 8);
    defs.append("clipPath").attr("id", clipId).append("rect")
      .attr("x", plot.l).attr("y", plot.t).attr("width", plot.w).attr("height", plot.h);

    var gridL = svg.append("g").attr("class", "grid");
    Object.keys(axes).forEach(function (n) { drawGrid(gridL, axes[n], plot, true); });
    Object.keys(axes).forEach(function (n) { drawGrid(gridL, axes[n], plot, false); });

    // zero lines
    Object.keys(axes).forEach(function (n) {
      var a = axes[n];
      if (!a.zeroline || a.kind !== "linear" || a.cfg.log) return;
      var d = a.scale.domain(), lo = Math.min(d[0], d[1]), hi = Math.max(d[0], d[1]);
      if (!(0 > lo && 0 < hi)) return;
      var p = crisp(a.pos(0), 1);
      var l = gridL.append("line").attr("class", "zeroline").attr("stroke", ink.axis).attr("stroke-width", 1);
      if (a.dir === "h") l.attr("x1", p).attr("x2", p).attr("y1", plot.t).attr("y2", plot.t + plot.h);
      else l.attr("x1", plot.l).attr("x2", plot.l + plot.w).attr("y1", p).attr("y2", p);
    });

    var marks = svg.append("g").attr("class", "marks").attr("clip-path", "url(#" + clipId + ")");
    var over = svg.append("g").attr("class", "marks-over");

    var ctx = { svg: svg, defs: defs, plot: plot, axes: axes, marks: marks, over: over, font: font, size: size, W: W, H: H };
    def.draw(ctx);

    // frame / axes on top of the data
    var frame = !!st.outlineFrame;
    if (frame) {
      svg.append("rect").attr("class", "frame").attr("x", plot.l).attr("y", plot.t).attr("width", plot.w).attr("height", plot.h)
        .attr("fill", "none").attr("stroke", ink.shape).attr("stroke-width", st.frameBorderWidth || 1.4);
    }
    Object.keys(axes).forEach(function (n) { drawAxis(svg, axes[n], axes[n].side, plot, font, size, frame); });
    if (frame && st.mirrorAxisTicks) {
      var mg = svg.append("g").attr("class", "axis-mirror");
      if (!axes.y2 && axes.y.cfg.ticksShow) drawTicks(mg, axes.y, "right", plot, axes.y.cfg.ticklen, axes.y.cfg.tickW, ink.shape, axes.y.majors);
      if (!axes.x2 && axes.x.cfg.ticksShow) drawTicks(mg, axes.x, "top", plot, axes.x.cfg.ticklen, axes.x.cfg.tickW, ink.shape, axes.x.majors);
    }

    if (L) drawLegend(svg, L, legendPosition(L, plot, ext), font, fs, plot, def.onLegendMoved);

    // Geometry for the Format Axis click strips (22-axis-format-panel.js).
    gd._plootsD3 = { width: W, height: H, plot: plot };
    return ctx;
  };

  PD.axisSettings = axisSettings;
})();
