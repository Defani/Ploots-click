/* ==========================================================================
   Sunburst — first chart type on the new "D3 Engine" track.

   Plotly has no partition/hierarchy trace in the vendored cartesian bundle,
   and hierarchical charts (sunburst, and more D3-only chart types planned
   later: icicle, treemap-d3, chord, force graph, ...) need a real d3.js
   instance (d3.hierarchy / d3.partition / d3.arc), not something worth
   hand-rolling. So this is the first chart type backed by an actual D3.js
   library, lazy-loaded on demand the first time a "D3 Engine" chart type is
   selected (see PlootsLazy.ensureD3 in js/lazy-loader.js) — same on-demand
   pattern already used for the Plotly geo bundle / XLSX / AG Grid.

   Like radial-rings, this is NOT a Plotly graph — it's raw SVG drawn
   straight into #plotlyDiv, so exportSvgFile/exportPngFile are wrapped
   here (chaining to radial-rings' own wrap) and the multi-format export
   panel's isRawSvgChartType() check (js/chart-builder/08-helpers-export.js)
   includes "sunburst" alongside "radial-rings".

   Data model: reuses the same flat state.categories / state.seriesData as
   every other chart type (Data tab, CSV/Excel import, palette picker all
   work unmodified) — but state.categories holds a slash-delimited path per
   row (e.g. "Vegetasi/Mangrove/Rapat") instead of a flat label, and only
   the first VISIBLE series supplies the values (same convention already
   used by choropleth's z-values). Rows are folded into a tree by shared
   path prefixes.

   Interaction: click a segment to zoom into it (standard D3 zoomable-
   sunburst technique — remap x/y into the clicked node's window); click
   the center circle to reset back to the full chart. Clicking "Sunburst"
   again in the sidebar also resets the zoom, since re-selecting an already-
   active chart type has no other effect.
   ========================================================================== */
(function () {
  "use strict";

  var SUNBURST_TYPE = "sunburst";

  if (typeof CHART_TYPE_DEFS !== "undefined") {
    CHART_TYPE_DEFS.push({ category: "D3 Engine", value: SUNBURST_TYPE, label: "Sunburst" });
  }
  if (typeof SAMPLE_DATA_BY_TYPE !== "undefined") {
    SAMPLE_DATA_BY_TYPE[SUNBURST_TYPE] = "Kelas\tLuas (ha)\nVegetasi/Mangrove/Rapat\t185.4\nVegetasi/Mangrove/Sedang\t122.7\nVegetasi/Mangrove/Jarang\t76.3\nVegetasi/Non-Mangrove/Hutan Sekunder\t64.8\nVegetasi/Non-Mangrove/Semak Belukar\t41.2\nNon-Vegetasi/Tambak\t98.5\nNon-Vegetasi/Lahan Terbuka\t53.1\nNon-Vegetasi/Tubuh Air\t37.9";
  }
  if (typeof buildChartTypeGrid === "function") buildChartTypeGrid();
  if (typeof syncChartTypeGridActive === "function") syncChartTypeGridActive();

  if (state.sunburstFocusPath === undefined) state.sunburstFocusPath = "";

  function esc(s) {
    return (s == null ? "" : String(s)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function shadeColor(hex, idx, n) {
    if (!hex) return hex;
    hex = String(hex).replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join("");
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "#" + hex;
    var r = parseInt(hex.substr(0, 2), 16), g = parseInt(hex.substr(2, 2), 16), b = parseInt(hex.substr(4, 2), 16);
    var t = n > 1 ? idx / (n - 1) : 0;
    var amt = 0.28 * t;
    r = Math.round(r + (255 - r) * amt);
    g = Math.round(g + (255 - g) * amt);
    b = Math.round(b + (255 - b) * amt);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  // ---- fold flat "A/B/C" rows into a tree ---------------------------------
  function buildHierarchyData() {
    var visible = state.seriesNames.filter(function (n) { return state.seriesMeta[n].visible; });
    var seriesName = visible[0];
    if (!seriesName) return null;
    var values = state.seriesData[seriesName] || [];
    var root = { name: "Total", children: [] };
    state.categories.forEach(function (catPath, i) {
      var parts = String(catPath == null ? "" : catPath).split("/").map(function (s) { return s.trim(); }).filter(Boolean);
      if (!parts.length) return;
      var node = root;
      parts.forEach(function (part, depth) {
        node.children = node.children || [];
        var existing = node.children.filter(function (c) { return c.name === part; })[0];
        if (!existing) { existing = { name: part }; node.children.push(existing); }
        node = existing;
        if (depth === parts.length - 1) {
          var v = values[i];
          node.value = (node.value || 0) + (isFinite(v) ? v : 0);
        }
      });
    });
    return root;
  }

  function nodePathKey(d) {
    return d.ancestors().reverse().slice(1).map(function (a) { return a.data.name; }).join("/");
  }
  function breadcrumb(d) {
    return d.ancestors().reverse().slice(1).map(function (a) { return a.data.name; }).join(" / ");
  }
  function findFocusNode(root) {
    var key = state.sunburstFocusPath;
    if (!key) return root;
    var target = null;
    root.each(function (d) { if (d.depth > 0 && nodePathKey(d) === key) target = d; });
    return target || root;
  }

  function showSunburstPlaceholder(msg) {
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

  function renderSunburst() {
    var box = state.chartBox, w = box.w, h = box.h;
    var el = document.getElementById("plotlyDiv");
    if (!el) return;

    if (typeof d3 === "undefined" || !d3.hierarchy) {
      showSunburstPlaceholder("Memuat D3\u2026");
      PlootsLazy.ensureD3().then(function () {
        if (state.chartType === SUNBURST_TYPE) render();
      });
      return;
    }

    var data = buildHierarchyData();
    if (!data || !data.children || !data.children.length) {
      if (typeof renderBlankCanvas === "function") renderBlankCanvas();
      return;
    }

    var root = d3.hierarchy(data).sum(function (d) { return d.value || 0; }).sort(function (a, b) { return b.value - a.value; });
    var radius = Math.min(w, h) / 2 - 2;
    d3.partition().size([2 * Math.PI, radius])(root);

    var p = findFocusNode(root);
    var allNodes = root.descendants().filter(function (d) { return d.depth > 0; });

    var colors = PALETTES[state.paletteIdx].colors;
    var gray = typeof isGrayscaleMode === "function" && isGrayscaleMode();
    var topIdx = {};
    (root.children || []).forEach(function (c, i) { topIdx[c.data.name] = i; });
    function nodeColor(d) {
      var top = d;
      while (top.depth > 1) top = top.parent;
      var idx = topIdx[top.data.name] || 0;
      var base = gray ? grayForIndex(idx) : colors[idx % colors.length];
      return d.depth > 1 ? shadeColor(base, d.depth - 1, 4) : base;
    }

    function xy(d) {
      var span = (p.x1 - p.x0) || 1;
      var x0 = Math.max(0, Math.min(1, (d.x0 - p.x0) / span)) * 2 * Math.PI;
      var x1 = Math.max(0, Math.min(1, (d.x1 - p.x0) / span)) * 2 * Math.PI;
      var y0 = Math.max(0, d.y0 - p.y0);
      var y1 = Math.max(0, d.y1 - p.y0);
      return { x0: x0, x1: x1, y0: y0, y1: y1 };
    }

    var arc = d3.arc()
      .startAngle(function (d) { return xy(d).x0; })
      .endAngle(function (d) { return xy(d).x1; })
      .padAngle(function (d) { var c = xy(d); return Math.min((c.x1 - c.x0) / 2, 0.004); })
      .padRadius(radius / 2)
      .innerRadius(function (d) { return xy(d).y0; })
      .outerRadius(function (d) { return Math.max(xy(d).y0, xy(d).y1 - 1); });

    var visibleNodes = allNodes.filter(function (d) {
      if (d.depth < p.depth) return false;
      var c = xy(d);
      return c.x1 > c.x0 && c.y0 < radius + 0.5 && c.y1 <= radius + 0.5;
    });

    var bg = typeof chartBgColor === "function" ? chartBgColor() : "#ffffff";
    var textColor = gray ? "#ffffff" : "#1a1a1a";
    var cx = w / 2, cy = h / 2;
    var svg = [];
    svg.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">');
    if (bg !== "rgba(0,0,0,0)") svg.push('<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + bg + '"/>');
    svg.push('<g transform="translate(' + cx + ',' + cy + ')">');

    visibleNodes.forEach(function (d) {
      var pathD = arc(d);
      if (!pathD) return;
      var fill = nodeColor(d);
      var valTxt = typeof formatValue === "function" ? formatValue(d.value, state.valueFormat || "auto") : d.value;
      svg.push('<path d="' + pathD + '" fill="' + fill + '" stroke="' + bg + '" stroke-width="1" data-sb-path="' + esc(nodePathKey(d)) + '" style="cursor:pointer"><title>' + esc(breadcrumb(d) + "\n" + valTxt) + '</title></path>');
      var c = xy(d);
      var angle = (c.x0 + c.x1) / 2;
      var rMid = (c.y0 + c.y1) / 2;
      var arcLen = (c.x1 - c.x0) * rMid;
      if (arcLen > 14 && rMid > 8) {
        var deg = angle * 180 / Math.PI - 90;
        var flip = angle > Math.PI ? 180 : 0;
        svg.push('<text transform="rotate(' + deg + ') translate(' + rMid + ',0) rotate(' + flip + ')" text-anchor="middle" dy="0.32em" font-size="10" font-family="' + esc(state.fontBody) + '" fill="' + textColor + '" pointer-events="none">' + esc(d.data.name) + '</text>');
      }
    });

    svg.push('</g>');

    var centerR = Math.max(20, radius * 0.14);
    svg.push('<g transform="translate(' + cx + ',' + cy + ')" data-sb-center="1" style="cursor:' + (p.depth > 0 ? "pointer" : "default") + '">');
    svg.push('<circle r="' + centerR + '" fill="' + bg + '" stroke="' + (gray ? "#ffffff" : "#c9c7ba") + '" stroke-width="1"/>');
    svg.push('<text text-anchor="middle" dy="0.32em" font-size="11" font-family="' + esc(state.fontBody) + '" fill="' + textColor + '">' + esc(p.depth === 0 ? "Total" : p.data.name) + '</text>');
    svg.push('</g>');
    svg.push('</svg>');

    el.innerHTML = svg.join("");
    state.chartRenderedW = w;
    state.chartRenderedH = h;

    Array.prototype.forEach.call(el.querySelectorAll("[data-sb-path]"), function (node) {
      node.addEventListener("click", function () {
        state.sunburstFocusPath = node.getAttribute("data-sb-path");
        renderSunburst();
      });
    });
    var centerEl = el.querySelector("[data-sb-center]");
    if (centerEl && p.depth > 0) {
      centerEl.addEventListener("click", function () {
        state.sunburstFocusPath = p.parent && p.parent.depth > 0 ? nodePathKey(p.parent) : "";
        renderSunburst();
      });
    }
  }

  window.renderSunburst = renderSunburst;

  var originalRender = window.render;
  if (typeof originalRender === "function") {
    window.render = function () {
      if (state.chartType === SUNBURST_TYPE) {
        if (state.categories.length === 0) return;
        var visible = state.seriesNames.filter(function (n) { return state.seriesMeta[n].visible; });
        if (!visible.length) { if (typeof renderBlankCanvas === "function") renderBlankCanvas(); return; }
        renderSunburst();
        return;
      }
      return originalRender();
    };
  }

  // Re-selecting Sunburst (already active or not) resets the zoom, since a
  // sidebar click that lands on the already-active chart type otherwise
  // has no other visible effect.
  var originalSelectChartType = window.selectChartType;
  if (typeof originalSelectChartType === "function") {
    window.selectChartType = function (v) {
      if (v === SUNBURST_TYPE) state.sunburstFocusPath = "";
      originalSelectChartType(v);
    };
  }

  function getSunburstSvgEl() {
    var el = document.getElementById("plotlyDiv");
    return el ? el.querySelector("svg") : null;
  }

  var originalExportSvg = window.exportSvgFile;
  window.exportSvgFile = function () {
    if (state.chartType === SUNBURST_TYPE) {
      var svgEl = getSunburstSvgEl();
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
    if (state.chartType === SUNBURST_TYPE) {
      var svgEl = getSunburstSvgEl();
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
