/* ==========================================================================
   Scatter Matrix (SPLOM) — grid of pairwise scatter plots across every
   visible series, for eyeballing correlation between several numeric
   variables at once (e.g. NDVI vs curah hujan vs elevasi vs tutupan kanopi).

   Like Sankey, this IS a real Plotly graph — Plotly ships a native "splom"
   trace — so it's just Plotly.newPlot() like the rest of 07-render.js's
   switch. exportSvgFile/exportPngFile and the multi-format export panel's
   isRawSvgChartType() check need no changes: they already fall through to
   Plotly.toImage() for any chart type not in that raw-SVG list.

   Data model: unlike every other chart type, a scatter matrix needs several
   full numeric variables side by side rather than one value per category
   row — so this reuses the data exactly as entered in the Data tab, with
   each VISIBLE series treated as one variable/dimension (state.categories
   rows are just the sample index, same role they play for box/violin and
   ridge-plot). At least 2 visible series are required to draw anything.
   ========================================================================== */
(function () {
  "use strict";

  var SPLOM_TYPE = "scatter-matrix";

  if (typeof CHART_TYPE_DEFS !== "undefined") {
    CHART_TYPE_DEFS.push({ category: "Other", value: SPLOM_TYPE, label: "Scatter Matrix", icon: "mdi:grid" });
  }
  if (typeof SAMPLE_DATA_BY_TYPE !== "undefined") {
    SAMPLE_DATA_BY_TYPE[SPLOM_TYPE] = "Plot\tNDVI\tCurah Hujan (mm)\tElevasi (m)\tTutupan Kanopi (%)\n1\t0.41\t1850\t120\t55\n2\t0.55\t2100\t340\t72\n3\t0.62\t2250\t410\t80\n4\t0.35\t1600\t80\t40\n5\t0.58\t2180\t390\t76\n6\t0.47\t1950\t260\t62\n7\t0.29\t1450\t60\t30\n8\t0.66\t2300\t450\t85\n9\t0.51\t2020\t300\t68\n10\t0.38\t1700\t150\t45\n11\t0.60\t2220\t400\t78\n12\t0.44\t1880\t220\t58\n13\t0.33\t1550\t90\t36\n14\t0.53\t2060\t320\t70\n15\t0.27\t1400\t50\t28";
  }
  if (typeof buildChartTypeGrid === "function") buildChartTypeGrid();
  if (typeof syncChartTypeGridActive === "function") syncChartTypeGridActive();

  function gatherDimensions() {
    var visible = state.seriesNames.filter(function (n) { return state.seriesMeta[n].visible; });
    return visible.map(function (name) {
      return {
        label: state.seriesMeta[name].label || name,
        values: (state.seriesData[name] || []).map(function (v) { return typeof v === "number" && isFinite(v) ? v : null; })
      };
    });
  }

  function renderScatterMatrix() {
    var box = state.chartBox, w = box.w, h = box.h;
    var dims = gatherDimensions();
    if (dims.length < 2) {
      if (typeof renderBlankCanvas === "function") renderBlankCanvas();
      return;
    }

    var colors = PALETTES[state.paletteIdx].colors;
    var gray = typeof isGrayscaleMode === "function" && isGrayscaleMode();
    var pointColor = gray ? grayForIndex(0) : colors[0];

    var trace = {
      type: "splom",
      dimensions: dims.map(function (d) { return { label: d.label, values: d.values }; }),
      showupperhalf: true,
      diagonal: { visible: false },
      marker: {
        color: pointColor,
        size: 5,
        opacity: 0.75,
        line: { color: gray ? "#ffffff" : "#3a3a36", width: 0.5 }
      }
    };

    var axisStyle = {
      tickfont: { family: state.fontBody, size: 9, color: "#4a4a46" },
      gridcolor: "#e4e2d8",
      showline: true,
      linecolor: "#1a1a1a"
    };
    var layout = {
      width: w,
      height: h,
      paper_bgcolor: typeof chartBgColor === "function" ? chartBgColor() : "#ffffff",
      plot_bgcolor: typeof chartBgColor === "function" ? chartBgColor() : "#ffffff",
      font: { family: state.fontBody, size: state.bodyFontSize || 12, color: "#1a1a1a" },
      margin: { t: 20, r: 20, b: 20, l: 20 },
      hovermode: "closest"
    };
    dims.forEach(function (d, i) {
      var n = i === 0 ? "" : i + 1;
      layout["xaxis" + n] = axisStyle;
      layout["yaxis" + n] = axisStyle;
    });

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

  window.renderScatterMatrix = renderScatterMatrix;

  var originalRender = window.render;
  if (typeof originalRender === "function") {
    window.render = function () {
      if (state.chartType === SPLOM_TYPE) {
        if (state.categories.length === 0) { if (typeof renderBlankCanvas === "function") renderBlankCanvas(); return; }
        renderScatterMatrix();
        return;
      }
      return originalRender();
    };
  }
})();
