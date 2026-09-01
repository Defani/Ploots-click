/* ==========================================================================
   Sankey — flow diagram, e.g. transisi tutupan lahan (Hutan Primer -> Hutan
   Sekunder -> Perkebunan -> ...).

   Unlike sunburst/radial-rings/ridge-plot, this one IS a real Plotly graph:
   Plotly ships a native "sankey" trace, so this just calls Plotly.newPlot()
   like every chart type already in 07-render.js's switch. That also means
   the existing exportSvgFile/exportPngFile and the multi-format export
   panel (js/chart-builder/08-helpers-export.js) already work unmodified —
   isRawSvgChartType() there correctly stays false for "sankey", so it falls
   through to the normal Plotly.toImage() path. No export wrapping, no
   lazy-loaded library, no changes needed outside this file except the
   index.html script tag.

   Data model: same flat state.categories / state.seriesData used by every
   other chart type, but each category row encodes a flow as
   "Source -> Target" (arrow-delimited, e.g. "Hutan Primer -> Hutan
   Sekunder") instead of a plain label — same idea as sunburst's slash-
   delimited hierarchy paths. Only the first VISIBLE series supplies link
   values (again mirroring sunburst / choropleth's "first visible series"
   convention). Node list and colors are derived from the set of distinct
   source/target names, in order of first appearance.
   ========================================================================== */
(function () {
  "use strict";

  var SANKEY_TYPE = "sankey";

  if (typeof CHART_TYPE_DEFS !== "undefined") {
    CHART_TYPE_DEFS.push({ category: "Other", value: SANKEY_TYPE, label: "Sankey", icon: "mdi:chart-sankey" });
  }
  if (typeof SAMPLE_DATA_BY_TYPE !== "undefined") {
    SAMPLE_DATA_BY_TYPE[SANKEY_TYPE] = "Alur\tLuas (ha)\nHutan Primer -> Hutan Sekunder\t120\nHutan Primer -> Perkebunan\t85\nHutan Sekunder -> Perkebunan\t150\nHutan Sekunder -> Lahan Terbuka\t40\nPerkebunan -> Lahan Terbuka\t30\nLahan Terbuka -> Pemukiman\t25";
  }
  if (typeof buildChartTypeGrid === "function") buildChartTypeGrid();
  if (typeof syncChartTypeGridActive === "function") syncChartTypeGridActive();

  // "A -> B" (or "A>B", "A -->B", etc.) -> {source:"A", target:"B"}.
  // Only the first and last segment are used, so "A -> B -> C" rows (if any
  // slip in) degrade to a single A -> C link rather than throwing.
  function parseFlow(catPath) {
    var parts = String(catPath == null ? "" : catPath)
      .split("->")
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    if (parts.length < 2) return null;
    return { source: parts[0], target: parts[parts.length - 1] };
  }

  function buildSankeyData() {
    var visible = state.seriesNames.filter(function (n) { return state.seriesMeta[n].visible; });
    var seriesName = visible[0];
    if (!seriesName) return null;
    var values = state.seriesData[seriesName] || [];

    var nodes = [];
    var nodeIndex = {};
    function idx(name) {
      if (!(name in nodeIndex)) { nodeIndex[name] = nodes.length; nodes.push(name); }
      return nodeIndex[name];
    }

    var source = [], target = [], value = [];
    state.categories.forEach(function (catPath, i) {
      var f = parseFlow(catPath);
      if (!f) return;
      var v = values[i];
      if (!isFinite(v) || v <= 0) return;
      source.push(idx(f.source));
      target.push(idx(f.target));
      value.push(v);
    });

    if (!nodes.length || !value.length) return null;
    return { nodes: nodes, source: source, target: target, value: value };
  }

  function renderSankey() {
    var box = state.chartBox, w = box.w, h = box.h;
    var data = buildSankeyData();
    if (!data) {
      if (typeof renderBlankCanvas === "function") renderBlankCanvas();
      return;
    }

    var colors = PALETTES[state.paletteIdx].colors;
    var gray = typeof isGrayscaleMode === "function" && isGrayscaleMode();
    var nodeColors = data.nodes.map(function (n, i) {
      return gray ? grayForIndex(i) : colors[i % colors.length];
    });
    var linkColors = data.source.map(function (si) { return hexToRgba(nodeColors[si], 0.42); });

    var trace = {
      type: "sankey",
      orientation: "h",
      arrangement: "snap",
      node: {
        pad: 14,
        thickness: 16,
        label: data.nodes,
        color: nodeColors,
        line: { color: gray ? "#ffffff" : "#3a3a36", width: 0.5 }
      },
      link: {
        source: data.source,
        target: data.target,
        value: data.value,
        color: linkColors
      }
    };

    var layout = {
      width: w,
      height: h,
      paper_bgcolor: typeof chartBgColor === "function" ? chartBgColor() : "#ffffff",
      plot_bgcolor: typeof chartBgColor === "function" ? chartBgColor() : "#ffffff",
      font: { family: state.fontBody, size: state.bodyFontSize || 12, color: "#1a1a1a" },
      margin: { t: 20, r: 20, b: 20, l: 20 }
    };

    Plotly.newPlot("plotlyDiv", [trace], layout, {
      responsive: false,
      displaylogo: false,
      displayModeBar: true,
      modeBarButtonsToRemove: ["lasso2d", "select2d"]
    }).then(function () {
      try { Plotly.Plots.resize("plotlyDiv"); } catch (e) {}
      state.chartRenderedW = w;
      state.chartRenderedH = h;
    });
  }

  window.renderSankey = renderSankey;

  var originalRender = window.render;
  if (typeof originalRender === "function") {
    window.render = function () {
      if (state.chartType === SANKEY_TYPE) {
        if (state.categories.length === 0) return;
        var visible = state.seriesNames.filter(function (n) { return state.seriesMeta[n].visible; });
        if (!visible.length) { if (typeof renderBlankCanvas === "function") renderBlankCanvas(); return; }
        renderSankey();
        return;
      }
      return originalRender();
    };
  }
})();
