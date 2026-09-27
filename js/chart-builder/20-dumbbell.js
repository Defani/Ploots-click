/* ==========================================================================
   Dumbbell / Slope chart — one connector line per category through every
   visible series' value at that category, with a colored marker per series
   on top (classic "before vs after" dumbbell when there are exactly 2
   visible series; generalizes to a multi-point slope line per category
   when there are more).

   Like Lollipop, this needs no native Plotly trace and no export override:
   it's built from ordinary "lines" + "markers" scatter traces (one neutral
   connector line per category, one colored marker trace per series so the
   legend and per-series color/visibility toggles keep working), so the
   existing Plotly.toImage()-based export already handles it.

   Data model: identical to bar-group — state.categories are the row labels,
   each visible series is one column/condition (e.g. "2015" vs "2023").
   Needs at least 2 visible series to draw a connector; with only 1 it falls
   back to the blank-canvas message rather than drawing floating dots.
   ========================================================================== */
(function () {
  "use strict";

  var DUMBBELL_TYPE = "dumbbell";

  if (typeof CHART_TYPE_DEFS !== "undefined") {
    CHART_TYPE_DEFS.push({ category: "Bar", value: DUMBBELL_TYPE, label: "Dumbbell / Slope", icon: "mdi:dumbbell" });
  }
  if (typeof SAMPLE_DATA_BY_TYPE !== "undefined") {
    SAMPLE_DATA_BY_TYPE[DUMBBELL_TYPE] = "Provinsi\tLuas 2015 (ribu ha)\tLuas 2023 (ribu ha)\nKalimantan Barat\t980\t845\nKalimantan Tengah\t1240\t1080\nKalimantan Timur\t760\t690\nSumatra Selatan\t540\t410\nRiau\t620\t470\nJambi\t410\t355\nPapua\t2150\t2040";
  }
  if (typeof buildChartTypeGrid === "function") buildChartTypeGrid();
  if (typeof syncChartTypeGridActive === "function") syncChartTypeGridActive();

  function renderDumbbell() {
    var box = state.chartBox, w = box.w, h = box.h;
    var i = state.fontBody, s = state.bodyFontSize || 12, S = s + 1;
    var c = state.orientation === "vertical";
    var xLabelEl = document.getElementById("xLabel"), yLabelEl = document.getElementById("yLabel");
    var l = state.showXAxisLabel ? (xLabelEl ? xLabelEl.value : "") : "";
    var n = state.showYAxisLabel ? (yLabelEl ? yLabelEl.value : "") : "";
    var d = typeof wrappedCategories === "function" ? wrappedCategories() : state.categories;
    var x = state.seriesNames.filter(function (sn) { return state.seriesMeta[sn].visible; });
    if (x.length < 2 || !state.categories.length) {
      showDumbbellPlaceholder(x.length < 2 ? "Butuh minimal 2 seri visible (mis. \"sebelum\" & \"sesudah\") untuk Dumbbell chart." : null);
      return;
    }

    var y = state.axisLineWidth || 1;
    var gray = typeof isGrayscaleMode === "function" && isGrayscaleMode();
    var fmt = function (v) { return typeof formatValue === "function" ? formatValue(v, state.valueFormat || "auto") : String(v); };
    var nSeries = x.length;
    var pos = d.map(function (_, ci) { return ci; });
    var traces = [];

    // One neutral connector line per category, threaded through every
    // visible series' value at that row (drawn first so markers sit on top).
    var connLine = [], connVal = [];
    pos.forEach(function (p, ci) {
      x.forEach(function (sn) {
        var v = state.seriesData[sn][ci] || 0;
        connLine.push(p);
        connVal.push(v);
      });
      connLine.push(null);
      connVal.push(null);
    });
    var connectorTrace = {
      type: "scatter",
      mode: "lines",
      line: { color: gray ? "#9a9a96" : "#b9b6a8", width: state.lineWidth ? Math.max(1.5, state.lineWidth * 0.7) : 2 },
      hoverinfo: "skip",
      showlegend: false
    };
    if (c) { connectorTrace.x = connLine; connectorTrace.y = connVal; } else { connectorTrace.y = connLine; connectorTrace.x = connVal; }
    traces.push(connectorTrace);

    x.forEach(function (sn, si) {
      var vals = state.seriesData[sn];
      var color = gray ? grayForIndex(si) : state.seriesMeta[sn].color;
      var markerTrace = {
        type: "scatter",
        mode: state.showValues ? "markers+text" : "markers",
        name: state.seriesMeta[sn].label || sn,
        marker: {
          color: gray ? color : color,
          size: 12,
          line: { color: SHAPE_INK, width: state.outlineMarker ? 1.4 : 0 }
        },
        hovertemplate: (state.seriesMeta[sn].label || sn) + ": %{" + (c ? "y" : "x") + "}<extra></extra>"
      };
      if (c) { markerTrace.x = pos; markerTrace.y = vals; } else { markerTrace.y = pos; markerTrace.x = vals; }
      if (state.showValues) {
        markerTrace.text = vals.map(fmt);
        markerTrace.textposition = c ? (si === 0 ? "bottom center" : "top center") : (si === 0 ? "middle left" : "middle right");
        markerTrace.textfont = { family: i, size: Math.max(s - 2, 8), color: TEXT_INK };
      }
      traces.push(markerTrace);
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

    var layout = {
      width: w, height: h,
      paper_bgcolor: typeof chartBgColor === "function" ? chartBgColor() : "#ffffff",
      plot_bgcolor: typeof chartBgColor === "function" ? chartBgColor() : "#ffffff",
      font: { family: i, size: s, color: TEXT_INK },
      margin: { t: 30, r: 40, b: 60, l: 65 },
      showlegend: state.showLegend
    };
    if (layout.showlegend && typeof buildLegendLayout === "function") {
      layout.legend = buildLegendLayout(TEXT_INK, i, state.legendFontSize || s);
    }
    if (c) { layout.xaxis = posAxis; layout.yaxis = valAxis; } else { layout.yaxis = posAxis; layout.xaxis = valAxis; }

    if (state.outlineFrame) {
      [layout.xaxis, layout.yaxis].forEach(function (ax) {
        var fbw = state.frameBorderWidth || 1.4;
        ax.mirror = state.mirrorAxisTicks ? "ticks" : true; ax.linewidth = fbw; ax.linecolor = SHAPE_INK; ax.showline = true;
        if (ax.ticks) { ax.tickcolor = SHAPE_INK; }
      });
    }
    [layout.xaxis, layout.yaxis].forEach(function (ax) { ax.automargin = true; });

    // Format Axis settings (log, number format, labels, line) — 07-render.js
    // applies these for the standard charts; this renderer builds its own layout.
    if (typeof applyAxisLegendStyle === "function") applyAxisLegendStyle(layout, traces);
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

  function showDumbbellPlaceholder(msg) {
    if (msg && typeof renderBlankCanvas === "function") {
      // Reuse renderBlankCanvas's empty-canvas sizing, then overlay the message.
      renderBlankCanvas();
      var el = document.getElementById("plotlyDiv");
      if (el) {
        var note = document.createElement("div");
        note.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:" + state.fontBody + ";color:#8a8a8a;font-size:13px;text-align:center;padding:20px;box-sizing:border-box;pointer-events:none;";
        note.textContent = msg;
        if (getComputedStyle(el).position === "static") el.style.position = "relative";
        el.appendChild(note);
      }
      return;
    }
    if (typeof renderBlankCanvas === "function") renderBlankCanvas();
  }

  window.renderDumbbell = renderDumbbell;

  var originalRender = window.render;
  if (typeof originalRender === "function") {
    window.render = function () {
      if (state.chartType === DUMBBELL_TYPE) {
        if (state.categories.length === 0) return;
        renderDumbbell();
        return;
      }
      return originalRender();
    };
  }
})();
