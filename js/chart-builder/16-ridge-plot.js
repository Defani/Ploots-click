/* ==========================================================================
   Ridge Plot (joyplot) — stacked, overlapping KDE distributions, one per
   series, sharing a common value axis. Good for comparing the shape of a
   numeric variable across several groups (e.g. NDVI per tahun/site) at a
   glance.

   Like radial-rings, this is NOT rendered with Plotly: there is no native
   "ridgeline" trace, and the geometry (overlapping density curves, shared
   x-domain, per-row baselines) doesn't map onto anything in the vendored
   cartesian bundle, so it's drawn as plain SVG straight into #plotlyDiv —
   same approach as radial-rings and sunburst. No extra library is loaded
   for this one (unlike sunburst's d3.hierarchy/d3.arc); the KDE math below
   is small enough to hand-roll, so there's no lazy-load step.

   Data model: reuses the same flat state.categories / state.seriesData as
   box/violin — each VISIBLE series supplies one full array of raw numeric
   values (state.categories itself is not used as labels here, exactly like
   the box/violin case), and each such series becomes one ridge. This means
   Data tab, CSV/Excel import, per-series visibility, and the palette picker
   all work unmodified.

   Integration notes (outside this file):
   1. Add <script src="js/chart-builder/16-ridge-plot.js"></script> to
      index.html, after 15-sunburst.js.
   2. js/chart-builder/08-helpers-export.js has its own separate multi-format
      export panel with its own isRawSvgChartType() check (currently
      "radial-rings" / "sunburst") — add "ridge-plot" there too, the same
      way it was extended when sunburst was added. This file only wraps the
      toolbar's single-shot exportSvgFile/exportPngFile; it can't reach into
      that helper's local function scope.
   ========================================================================== */
(function () {
  "use strict";

  var RIDGE_TYPE = "ridge-plot";

  if (typeof CHART_TYPE_DEFS !== "undefined") {
    CHART_TYPE_DEFS.push({ category: "Distribution", value: RIDGE_TYPE, label: "Ridge Plot", icon: "mdi:chart-bell-curve" });
  }
  if (typeof SAMPLE_DATA_BY_TYPE !== "undefined") {
    SAMPLE_DATA_BY_TYPE[RIDGE_TYPE] = "Plot\tNDVI 2021\tNDVI 2022\tNDVI 2023\tNDVI 2024\n1\t0.41\t0.48\t0.55\t0.60\n2\t0.38\t0.44\t0.52\t0.58\n3\t0.52\t0.55\t0.59\t0.63\n4\t0.35\t0.40\t0.46\t0.51\n5\t0.60\t0.62\t0.65\t0.68\n6\t0.44\t0.47\t0.53\t0.57\n7\t0.49\t0.53\t0.58\t0.62\n8\t0.33\t0.39\t0.45\t0.49\n9\t0.57\t0.60\t0.63\t0.66\n10\t0.46\t0.50\t0.54\t0.59\n11\t0.40\t0.45\t0.50\t0.55\n12\t0.55\t0.58\t0.61\t0.64\n13\t0.37\t0.42\t0.48\t0.53\n14\t0.51\t0.54\t0.57\t0.61\n15\t0.43\t0.46\t0.52\t0.56\n16\t0.59\t0.61\t0.64\t0.67\n17\t0.36\t0.41\t0.47\t0.52\n18\t0.53\t0.56\t0.60\t0.63\n19\t0.47\t0.51\t0.56\t0.60\n20\t0.42\t0.48\t0.54\t0.58";
  }
  if (typeof buildChartTypeGrid === "function") buildChartTypeGrid();
  if (typeof syncChartTypeGridActive === "function") syncChartTypeGridActive();

  function esc(s) {
    return (s == null ? "" : String(s)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---- stats helpers -------------------------------------------------------
  function mean(a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; }
  function stdev(a) {
    if (a.length < 2) return 0;
    var m = mean(a);
    var v = a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (a.length - 1);
    return Math.sqrt(v);
  }
  // Silverman's rule of thumb for Gaussian KDE bandwidth.
  function silvermanBandwidth(a) {
    var sd = stdev(a);
    var n = a.length;
    if (!(sd > 0) || n < 2) return null;
    return 1.06 * sd * Math.pow(n, -1 / 5);
  }
  function gaussianKernel(u) {
    return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
  }
  // Evaluate a Gaussian KDE for `values` at each point in `xs`.
  function kdeAt(values, h, xs) {
    var n = values.length;
    return xs.map(function (x) {
      var sum = 0;
      for (var i = 0; i < n; i++) sum += gaussianKernel((x - values[i]) / h);
      return sum / (n * h);
    });
  }
  function linspace(lo, hi, n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(lo + ((hi - lo) * i) / (n - 1));
    return out;
  }

  // ---- gather per-series numeric samples, same convention as box/violin --
  function gatherSeries() {
    var visible = state.seriesNames.filter(function (n) { return state.seriesMeta[n].visible; });
    var rows = [];
    visible.forEach(function (name) {
      var raw = (state.seriesData[name] || []).filter(function (v) { return isFinite(v); });
      if (raw.length >= 2) rows.push({ name: name, label: state.seriesMeta[name].label || name, values: raw });
    });
    return rows;
  }

  function showRidgePlaceholder(msg) {
    var el = document.getElementById("plotlyDiv");
    if (!el) return;
    var w = state.chartBox.w, h = state.chartBox.h;
    var bg = typeof chartBgColor === "function" ? chartBgColor() : "#ffffff";
    el.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;align-items:center;justify-content:center;width:" + w + "px;height:" + h + "px;font-family:" + state.fontBody + ";color:#8a8a8a;font-size:13px;background:" + bg + ";text-align:center;padding:20px;box-sizing:border-box;";
    wrap.textContent = msg;
    el.appendChild(wrap);
  }

  function renderRidgePlot() {
    var box = state.chartBox, w = box.w, h = box.h;
    var el = document.getElementById("plotlyDiv");
    if (!el) return;

    var groups = gatherSeries();
    if (groups.length < 1) {
      showRidgePlaceholder("Butuh minimal 1 seri numerik (\u2265 2 titik) untuk menghitung KDE.");
      return;
    }

    // Shared x-domain (value axis) across every ridge, so shapes stay comparable.
    var allValues = [];
    groups.forEach(function (g) { allValues = allValues.concat(g.values); });
    var dataMin = Math.min.apply(null, allValues), dataMax = Math.max.apply(null, allValues);
    var pad = (dataMax - dataMin) * 0.15 || Math.abs(dataMax || 1) * 0.15 || 1;
    var domainMin = dataMin - pad, domainMax = dataMax + pad;

    var CURVE_N = 120;
    var xs = linspace(domainMin, domainMax, CURVE_N);
    var curves = groups.map(function (g) {
      var h_bw = silvermanBandwidth(g.values) || (domainMax - domainMin) / 20 || 1;
      return { group: g, density: kdeAt(g.values, h_bw, xs) };
    });
    var globalMaxDensity = Math.max.apply(null, curves.map(function (c) { return Math.max.apply(null, c.density); }));
    if (!(globalMaxDensity > 0)) globalMaxDensity = 1;

    var leftMargin = 96, rightMargin = 20, topMargin = 16, bottomMargin = 42;
    var plotW = Math.max(10, w - leftMargin - rightMargin);
    var plotH = Math.max(10, h - topMargin - bottomMargin);
    var n = curves.length;
    var rowH = plotH / n;
    var OVERLAP = 1.7; // how far a ridge's peak may rise into the row above (ggridges-style "scale")
    var ampScale = rowH * OVERLAP / globalMaxDensity;

    function xPix(v) { return leftMargin + ((v - domainMin) / (domainMax - domainMin)) * plotW; }
    function rowBaseline(rowIdx) { return topMargin + rowIdx * rowH + rowH; }

    var colors = PALETTES[state.paletteIdx].colors;
    var gray = typeof isGrayscaleMode === "function" && isGrayscaleMode();
    var bg = typeof chartBgColor === "function" ? chartBgColor() : "#ffffff";
    var textColor = "#1a1a1a";

    var svg = [];
    svg.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">');
    if (bg !== "rgba(0,0,0,0)") svg.push('<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + bg + '"/>');

    // Draw back-to-front: first series in the list sits at the top and is
    // drawn LAST so its ridge visually overlaps the ones below it.
    for (var rowIdx = n - 1; rowIdx >= 0; rowIdx--) {
      var c = curves[rowIdx];
      var baseline = rowBaseline(rowIdx);
      var color = gray ? grayForIndex(rowIdx) : colors[rowIdx % colors.length];
      var pts = xs.map(function (x, i) { return [xPix(x), baseline - c.density[i] * ampScale]; });

      var d = "M" + pts[0][0].toFixed(1) + "," + baseline.toFixed(1);
      pts.forEach(function (p) { d += " L" + p[0].toFixed(1) + "," + p[1].toFixed(1); });
      d += " L" + pts[pts.length - 1][0].toFixed(1) + "," + baseline.toFixed(1) + " Z";

      svg.push('<path d="' + d + '" fill="' + (isPatternish && isPatternish() ? color : hexToRgba(color, 0.82)) + '" stroke="' + (gray ? "#ffffff" : "#3a3a36") + '" stroke-width="1"><title>' + esc(c.group.label) + "\n" + "n=" + c.group.values.length + '</title></path>');
      svg.push('<line x1="' + leftMargin + '" y1="' + baseline.toFixed(1) + '" x2="' + (leftMargin + plotW).toFixed(1) + '" y2="' + baseline.toFixed(1) + '" stroke="#c9c7ba" stroke-width="0.75"/>');
      svg.push('<text x="' + (leftMargin - 10) + '" y="' + (baseline - 4).toFixed(1) + '" text-anchor="end" font-size="11" font-family="' + esc(state.fontBody) + '" fill="' + textColor + '">' + esc(c.group.label) + '</text>');
    }

    // Shared value axis at the bottom.
    var axisY = topMargin + plotH;
    svg.push('<line x1="' + leftMargin + '" y1="' + axisY.toFixed(1) + '" x2="' + (leftMargin + plotW).toFixed(1) + '" y2="' + axisY.toFixed(1) + '" stroke="#1a1a1a" stroke-width="1"/>');
    var TICKS = 5;
    for (var t = 0; t <= TICKS; t++) {
      var v = domainMin + ((domainMax - domainMin) * t) / TICKS;
      var tx = xPix(v);
      var label = typeof formatValue === "function" ? formatValue(v, state.valueFormat || "auto") : v.toFixed(2);
      svg.push('<line x1="' + tx.toFixed(1) + '" y1="' + axisY.toFixed(1) + '" x2="' + tx.toFixed(1) + '" y2="' + (axisY + 5).toFixed(1) + '" stroke="#1a1a1a" stroke-width="1"/>');
      svg.push('<text x="' + tx.toFixed(1) + '" y="' + (axisY + 18).toFixed(1) + '" text-anchor="middle" font-size="10" font-family="' + esc(state.fontBody) + '" fill="' + textColor + '">' + esc(label) + '</text>');
    }

    svg.push('</svg>');
    el.innerHTML = svg.join("");
    state.chartRenderedW = w;
    state.chartRenderedH = h;
  }

  window.renderRidgePlot = renderRidgePlot;

  var originalRender = window.render;
  if (typeof originalRender === "function") {
    window.render = function () {
      if (state.chartType === RIDGE_TYPE) {
        if (state.categories.length === 0) return;
        renderRidgePlot();
        return;
      }
      return originalRender();
    };
  }

  // ---- export wiring (chains onto sunburst's / radial-rings' own wrap) ----
  function getRidgeSvgEl() {
    var el = document.getElementById("plotlyDiv");
    return el ? el.querySelector("svg") : null;
  }

  var originalExportSvg = window.exportSvgFile;
  window.exportSvgFile = function () {
    if (state.chartType === RIDGE_TYPE) {
      var svgEl = getRidgeSvgEl();
      if (!svgEl) return;
      var xml = new XMLSerializer().serializeToString(svgEl);
      if (!/^<\?xml/.test(xml)) xml = '<?xml version="1.0" standalone="no"?>\r\n' + xml;
      var blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "chart.svg";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return;
    }
    return originalExportSvg && originalExportSvg();
  };

  function svgElToPngDataUrl(svgEl, w, h, scale) {
    return new Promise(function (resolve, reject) {
      var xml = new XMLSerializer().serializeToString(svgEl);
      var svg64 = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = Math.round(w * scale);
        c.height = Math.round(h * scale);
        var ctx = c.getContext("2d");
        ctx.fillStyle = typeof chartBgColor === "function" ? chartBgColor() : "#ffffff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = svg64;
    });
  }

  var originalExportPng = window.exportPngFile;
  window.exportPngFile = function () {
    if (state.chartType === RIDGE_TYPE) {
      var svgEl = getRidgeSvgEl();
      if (!svgEl) return;
      var dpiSel = document.getElementById("dpiSelect");
      var dpi = parseInt(dpiSel && dpiSel.value) || 300;
      var scale = dpi / 96;
      var cw = state.canvasWidthPx, ch = state.canvasHeightPx, r = state.chartBox;
      svgElToPngDataUrl(svgEl, r.w, r.h, scale).then(function (dataUrl) {
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(cw * scale);
        canvas.height = Math.round(ch * scale);
        var ctx = canvas.getContext("2d");
        var pageBg = (typeof state !== "undefined" && state.canvasBg && state.canvasBg !== "transparent") ? state.canvasBg : "#ffffff";
        ctx.fillStyle = pageBg;
        if (!(typeof state !== "undefined" && state.canvasBg === "transparent")) {
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        var img = new Image();
        img.onload = function () {
          ctx.drawImage(img, r.x * scale, r.y * scale, r.w * scale, r.h * scale);
          function finish() {
            var a = document.createElement("a");
            a.href = canvas.toDataURL("image/png");
            a.download = "layout_" + dpi + "dpi.png";
            a.click();
          }
          if (typeof getFabricOverlayDataUrl === "function") {
            var overlay = getFabricOverlayDataUrl(scale);
            if (overlay) {
              var oimg = new Image();
              oimg.onload = function () { ctx.drawImage(oimg, 0, 0, canvas.width, canvas.height); finish(); };
              oimg.src = overlay;
              return;
            }
          }
          finish();
        };
        img.src = dataUrl;
      });
      return;
    }
    return originalExportPng && originalExportPng();
  };
})();
