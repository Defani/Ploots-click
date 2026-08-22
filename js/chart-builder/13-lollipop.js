/* ==========================================================================
   Lollipop chart — adds a "Lollipop" chart type to the chart-builder.

   Plotly has no native lollipop trace, but unlike the radial-rings chart
   this one maps cleanly onto real Plotly traces: a thin "stem" line per
   category (baseline 0 -> value, using null-separated segments in one
   scatter trace) plus a "head" marker trace on top. Because it's a genuine
   Plotly graph in #plotlyDiv, the existing Plotly.toImage()-based
   exportSvgFile/exportPngFile keep working unmodified — no export override
   needed here (contrast with 12-radial-rings.js, which isn't Plotly-backed
   and does need one).

   Multiple visible series are grouped side-by-side within each category
   slot (same idea as bar-group), using a numeric axis with tickvals/
   ticktext standing in for the category labels so fractional offsets are
   possible. Series share a legendgroup with their stem so toggling the
   legend entry hides both the stem and the head together.
   ========================================================================== */
(function () {
  "use strict";

  var LOLLIPOP_TYPE = "lollipop";

  if (typeof CHART_TYPE_DEFS !== "undefined") {
    CHART_TYPE_DEFS.push({ category: "Bar", value: LOLLIPOP_TYPE, label: "Lollipop" });
  }
  if (typeof SAMPLE_DATA_BY_TYPE !== "undefined") {
    SAMPLE_DATA_BY_TYPE[LOLLIPOP_TYPE] = "Plot\tAvicennia marina\tRhizophora stylosa\nP1\t42.3\t58.9\nP2\t38.7\t63.2\nP3\t51.2\t49.7\nP4\t29.8\t55.4\nP5\t45.6\t60.1";
  }
  if (typeof buildChartTypeGrid === "function") buildChartTypeGrid();
  if (typeof syncChartTypeGridActive === "function") syncChartTypeGridActive();

  function renderLollipop() {
    var box = state.chartBox, w = box.w, h = box.h;
    var i = state.fontBody, s = state.bodyFontSize || 12, S = s + 1;
    var c = state.orientation === "vertical";
    var xLabelEl = document.getElementById("xLabel"), yLabelEl = document.getElementById("yLabel");
    var l = state.showXAxisLabel ? (xLabelEl ? xLabelEl.value : "") : "";
    var n = state.showYAxisLabel ? (yLabelEl ? yLabelEl.value : "") : "";
    var d = typeof wrappedCategories === "function" ? wrappedCategories() : state.categories;
    var x = state.seriesNames.filter(function (sn) { return state.seriesMeta[sn].visible; });
    if (!x.length || !state.categories.length) { if (typeof renderBlankCanvas === "function") renderBlankCanvas(); return; }

    var y = state.axisLineWidth || 1;
    var gray = typeof isGrayscaleMode === "function" && isGrayscaleMode();
    var fmt = function (v) { return typeof formatValue === "function" ? formatValue(v, state.valueFormat || "auto") : String(v); };
    var nSeries = x.length;
    var groupWidth = 0.62;
    var traces = [];

    x.forEach(function (sn, si) {
      var vals = state.seriesData[sn];
      var color = gray ? grayForIndex(si) : state.seriesMeta[sn].color;
      var offset = nSeries > 1 ? (si - (nSeries - 1) / 2) * (groupWidth / nSeries) : 0;
      var pos = d.map(function (_, ci) { return ci + offset; });

      var stemPos = [], stemVal = [];
      pos.forEach(function (p, ci) {
        var v = vals[ci] || 0;
        stemPos.push(p, p, null);
        stemVal.push(0, v, null);
      });
      var stemTrace = {
        type: "scatter",
        mode: "lines",
        line: { color: color, width: state.lineWidth || 2.2 },
        hoverinfo: "skip",
        showlegend: false,
        legendgroup: sn
      };
      if (c) { stemTrace.x = stemPos; stemTrace.y = stemVal; } else { stemTrace.y = stemPos; stemTrace.x = stemVal; }
      traces.push(stemTrace);

      var headTrace = {
        type: "scatter",
        mode: state.showValues ? "markers+text" : "markers",
        name: state.seriesMeta[sn].label || sn,
        legendgroup: sn,
        marker: {
          color: gray ? "#ffffff" : color,
          size: 12,
          line: { color: SHAPE_INK, width: state.outlineMarker ? 1.4 : 0 }
        },
        hovertemplate: (state.seriesMeta[sn].label || sn) + ": %{" + (c ? "y" : "x") + "}<extra></extra>"
      };
      if (c) { headTrace.x = pos; headTrace.y = vals; } else { headTrace.y = pos; headTrace.x = vals; }
      if (state.showValues) {
        headTrace.text = vals.map(fmt);
        headTrace.textposition = c ? "top center" : "middle right";
        headTrace.textfont = { family: i, size: Math.max(s - 2, 8), color: TEXT_INK };
      }
      traces.push(headTrace);
    });

    var tickvals = d.map(function (_, ci) { return ci; });
    var posAxis = {
      tickmode: "array", tickvals: tickvals, ticktext: d,
      title: { text: c ? l : n, font: { family: i, size: S, color: AXIS_INK } },
      tickfont: { family: i, color: AXIS_INK },
      showgrid: false, linecolor: AXIS_INK, linewidth: y, zeroline: false,
      range: [-0.6, d.length - 1 + 0.6]
    };
    var valAxis = {
      title: { text: c ? n : l, font: { family: i, size: S, color: AXIS_INK } },
      tickfont: { family: i, color: AXIS_INK },
      gridcolor: "#e4e2d8", showgrid: !!state[(c ? "y" : "x") + "AxisGridShow"],
      zeroline: true, zerolinecolor: AXIS_INK, linecolor: AXIS_INK, linewidth: y
    };

    var rangeKey = c ? "y" : "x";
    if ("custom" === state[rangeKey + "AxisRangeMode"] && isFinite(state[rangeKey + "AxisMin"]) && isFinite(state[rangeKey + "AxisMax"])) {
      valAxis.range = [state[rangeKey + "AxisMin"], state[rangeKey + "AxisMax"]];
      valAxis.autorange = false;
    }
    if ("custom" === state[rangeKey + "AxisTickMode"] && isFinite(state[rangeKey + "AxisTickStep"]) && state[rangeKey + "AxisTickStep"] > 0) {
      valAxis.dtick = state[rangeKey + "AxisTickStep"];
    }
    if (state[rangeKey + "AxisTicksShow"]) {
      valAxis.ticks = state[rangeKey + "AxisTicksPosition"] || "outside";
      valAxis.ticklen = state[rangeKey + "AxisTicksLength"] || 6;
      valAxis.tickwidth = y;
      valAxis.tickcolor = AXIS_INK;
    }
    var minorShow = !!state[rangeKey + "AxisMinorTicksShow"];
    var minorGridShow = !!state[rangeKey + "AxisMinorGridShow"];
    if (minorShow || minorGridShow) {
      var minorLen = state[rangeKey + "AxisTicksLength"] || 6;
      var minorPos = state[rangeKey + "AxisTicksPosition"] || "outside";
      var minor = {
        ticks: minorShow ? minorPos : "",
        ticklen: Math.max(2, 0.55 * minorLen),
        tickwidth: Math.max(0.5, 0.7 * y),
        tickcolor: AXIS_INK,
        showgrid: minorGridShow,
        gridcolor: "#e4e2d8",
        gridwidth: 0.6
      };
      var minorMode = state[rangeKey + "AxisMinorTicksMode"];
      if ("manual" === minorMode && isFinite(state[rangeKey + "AxisMinorTicksStep"]) && state[rangeKey + "AxisMinorTicksStep"] > 0) {
        minor.dtick = state[rangeKey + "AxisMinorTicksStep"];
      } else if ("divide" === minorMode && isFinite(valAxis.dtick) && valAxis.dtick > 0) {
        var minorDiv = Math.max(2, Math.round(state[rangeKey + "AxisMinorTicksDivide"] || 5));
        minor.dtick = valAxis.dtick / minorDiv;
      }
      valAxis.minor = minor;
    } else {
      valAxis.minor = { ticks: "", showgrid: false };
    }

    var layout = {
      width: w, height: h,
      paper_bgcolor: typeof chartBgColor === "function" ? chartBgColor() : "#ffffff",
      plot_bgcolor: typeof chartBgColor === "function" ? chartBgColor() : "#ffffff",
      font: { family: i, size: s, color: TEXT_INK },
      margin: { t: 30, r: 40, b: 60, l: 65 },
      showlegend: state.showLegend && nSeries > 1
    };
    if (layout.showlegend && typeof buildLegendLayout === "function") {
      layout.legend = buildLegendLayout(TEXT_INK, i, state.legendFontSize || s);
      layout.legend.groupclick = "togglegroup";
    }
    if (c) { layout.xaxis = posAxis; layout.yaxis = valAxis; } else { layout.yaxis = posAxis; layout.xaxis = valAxis; }

    if (state.outlineFrame) {
      [layout.xaxis, layout.yaxis].forEach(function (ax) {
        var fbw = state.frameBorderWidth || 1.4;
        ax.mirror = state.mirrorAxisTicks ? "ticks" : true; ax.linewidth = fbw; ax.linecolor = SHAPE_INK; ax.showline = true;
        if (ax.ticks) { ax.tickwidth = fbw; ax.tickcolor = SHAPE_INK; }
        if (ax.minor && ax.minor.ticks) { ax.minor.tickwidth = Math.max(0.5, 0.7 * fbw); ax.minor.tickcolor = SHAPE_INK; }
      });
    }
    [layout.xaxis, layout.yaxis].forEach(function (ax) { ax.automargin = true; });

    Plotly.newPlot("plotlyDiv", traces, layout, {
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

  window.renderLollipop = renderLollipop;

  var originalRender = window.render;
  if (typeof originalRender === "function") {
    window.render = function () {
      if (state.chartType === LOLLIPOP_TYPE) {
        if (state.categories.length === 0) return;
        renderLollipop();
        return;
      }
      return originalRender();
    };
  }
})();
