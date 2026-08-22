/* ==========================================================================
   Bubble chart — adds a "Bubble" chart type to the chart-builder.

   True XY bubble: the category column becomes the X axis (must be numeric,
   e.g. a vegetation index or continuous predictor) and series columns are
   read in pairs — (Y, Size), (Y, Size), ... — so a single table can hold
   several bubble groups (e.g. one pair per species/zone). If a trailing
   series has no size partner it falls back to a constant marker size.

   This is a genuine Plotly "scatter" trace with marker.size driven by the
   size column (sizemode:"area", so bubble AREA — not radius — scales
   linearly with the value, which is the correct convention for bubble
   charts). Because it renders into #plotlyDiv via Plotly.newPlot, the
   existing Plotly.toImage()-based export keeps working unmodified — no
   export override needed (contrast with 12-radial-rings.js).
   ========================================================================== */
(function () {
  "use strict";

  var BUBBLE_TYPE = "bubble";
  var MAX_BUBBLE_PX = 46;   // largest bubble diameter target, in px, at render width
  var MIN_BUBBLE_PX = 10;   // smallest bubble diameter for the smallest nonzero value
  var FALLBACK_SIZE_PX = 16;

  if (typeof CHART_TYPE_DEFS !== "undefined") {
    CHART_TYPE_DEFS.push({ category: "Line & Area", value: BUBBLE_TYPE, label: "Bubble" });
  }
  if (typeof SAMPLE_DATA_BY_TYPE !== "undefined") {
    SAMPLE_DATA_BY_TYPE[BUBBLE_TYPE] = "IRECI\tAGC Avicennia (ton/ha)\tLuas Plot Avicennia (ha)\tAGC Rhizophora (ton/ha)\tLuas Plot Rhizophora (ha)\n0.38\t34.2\t1.4\t46.1\t1.1\n0.44\t38.9\t1.8\t51.4\t1.6\n0.51\t45.6\t2.3\t58.9\t2.0\n0.57\t49.8\t1.6\t63.2\t2.4\n0.63\t55.3\t2.7\t69.4\t1.8\n0.69\t61.7\t2.1\t74.8\t2.6\n0.75\t68.2\t3.0\t80.1\t2.2";
  }
  if (typeof buildChartTypeGrid === "function") buildChartTypeGrid();
  if (typeof syncChartTypeGridActive === "function") syncChartTypeGridActive();

  function toNum(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function renderBubble() {
    var box = state.chartBox, w = box.w, h = box.h;
    var i = state.fontBody, s = state.bodyFontSize || 12, S = s + 1;
    var xLabelEl = document.getElementById("xLabel"), yLabelEl = document.getElementById("yLabel");
    var l = state.showXAxisLabel ? (xLabelEl ? xLabelEl.value : "") : "";
    var n = state.showYAxisLabel ? (yLabelEl ? yLabelEl.value : "") : "";
    var names = state.seriesNames || [];
    if (!names.length || !state.categories.length) { if (typeof renderBlankCanvas === "function") renderBlankCanvas(); return; }

    var xVals = state.categories.map(toNum);
    var gray = typeof isGrayscaleMode === "function" && isGrayscaleMode();
    var fmt = function (v) { return typeof formatValue === "function" ? formatValue(v, state.valueFormat || "auto") : String(v); };
    var y0 = state.axisLineWidth || 1;
    var u = state.outlineMarker ? 1.4 : 0;

    // Pair up series into (Y, Size) groups.
    var groups = [];
    for (var gi = 0; gi < names.length; gi += 2) {
      groups.push({ ySeries: names[gi], sizeSeries: names[gi + 1] || null });
    }

    // Global size scale so bubbles across every group stay comparable.
    var maxSize = 0;
    groups.forEach(function (g) {
      if (!g.sizeSeries) return;
      (state.seriesData[g.sizeSeries] || []).forEach(function (v) { if (v > maxSize) maxSize = v; });
    });
    var sizeref = maxSize > 0 ? (2 * maxSize) / Math.pow(MAX_BUBBLE_PX, 2) : 1;

    var traces = [];
    groups.forEach(function (g, gi) {
      var yVals = state.seriesData[g.ySeries];
      if (!yVals) return;
      var meta = state.seriesMeta[g.ySeries];
      if (meta && meta.visible === false) return;
      var color = gray ? grayForIndex(gi) : (meta ? meta.color : "#3d6363");
      var sizeVals = g.sizeSeries ? state.seriesData[g.sizeSeries] : null;
      var markerSize = sizeVals
        ? sizeVals.map(function (v) { return Math.max(v, maxSize > 0 ? maxSize * 0.01 : 0.01); })
        : yVals.map(function () { return FALLBACK_SIZE_PX; });

      var trace = {
        type: "scatter",
        mode: state.showValues ? "markers+text" : "markers",
        name: (meta ? meta.label : g.ySeries) || g.ySeries,
        x: xVals,
        y: yVals,
        marker: {
          color: gray ? "#ffffff" : color,
          opacity: 0.78,
          size: markerSize,
          sizemode: sizeVals ? "area" : "diameter",
          sizeref: sizeVals ? sizeref : 1,
          sizemin: sizeVals ? MIN_BUBBLE_PX / 2 : FALLBACK_SIZE_PX / 2,
          line: { color: SHAPE_INK, width: u }
        }
      };
      var sizeLabel = g.sizeSeries ? ((state.seriesMeta[g.sizeSeries] && state.seriesMeta[g.sizeSeries].label) || g.sizeSeries) : null;
      trace.hovertemplate = (l || "X") + ": %{x}<br>" + ((meta ? meta.label : g.ySeries) || "Y") + ": %{y}" +
        (sizeVals ? "<br>" + sizeLabel + ": %{marker.size}" : "") + "<extra></extra>";
      if (state.showValues) {
        trace.text = yVals.map(fmt);
        trace.textposition = "top center";
        trace.textfont = { family: i, size: Math.max(s - 2, 8), color: TEXT_INK };
      }
      traces.push(trace);
    });

    if (!traces.length) { if (typeof renderBlankCanvas === "function") renderBlankCanvas(); return; }

    var xAxis = {
      title: { text: l, font: { family: i, size: S, color: AXIS_INK } },
      tickfont: { family: i, color: AXIS_INK },
      showgrid: false, linecolor: AXIS_INK, linewidth: y0, zeroline: false
    };
    var yAxis = {
      title: { text: n, font: { family: i, size: S, color: AXIS_INK } },
      tickfont: { family: i, color: AXIS_INK },
      gridcolor: "#e4e2d8", showgrid: !!state.yAxisGridShow,
      zeroline: true, zerolinecolor: AXIS_INK, linecolor: AXIS_INK, linewidth: y0
    };

    ["x", "y"].forEach(function (axKey) {
      var ax = axKey === "x" ? xAxis : yAxis;
      if ("custom" === state[axKey + "AxisRangeMode"] && isFinite(state[axKey + "AxisMin"]) && isFinite(state[axKey + "AxisMax"])) {
        ax.range = [state[axKey + "AxisMin"], state[axKey + "AxisMax"]];
        ax.autorange = false;
      }
      if ("custom" === state[axKey + "AxisTickMode"] && isFinite(state[axKey + "AxisTickStep"]) && state[axKey + "AxisTickStep"] > 0) {
        ax.dtick = state[axKey + "AxisTickStep"];
      }
      if (state[axKey + "AxisTicksShow"]) {
        ax.ticks = state[axKey + "AxisTicksPosition"] || "outside";
        ax.ticklen = state[axKey + "AxisTicksLength"] || 6;
        ax.tickwidth = y0;
        ax.tickcolor = AXIS_INK;
      }
      var minorShow = !!state[axKey + "AxisMinorTicksShow"];
      var minorGridShow = !!state[axKey + "AxisMinorGridShow"];
      if (minorShow || minorGridShow) {
        var minorLen = state[axKey + "AxisTicksLength"] || 6;
        var minorPos = state[axKey + "AxisTicksPosition"] || "outside";
        var minor = {
          ticks: minorShow ? minorPos : "",
          ticklen: Math.max(2, 0.55 * minorLen),
          tickwidth: Math.max(0.5, 0.7 * y0),
          tickcolor: AXIS_INK,
          showgrid: minorGridShow,
          gridcolor: "#e4e2d8",
          gridwidth: 0.6
        };
        var minorMode = state[axKey + "AxisMinorTicksMode"];
        if ("manual" === minorMode && isFinite(state[axKey + "AxisMinorTicksStep"]) && state[axKey + "AxisMinorTicksStep"] > 0) {
          minor.dtick = state[axKey + "AxisMinorTicksStep"];
        } else if ("divide" === minorMode && isFinite(ax.dtick) && ax.dtick > 0) {
          var minorDiv = Math.max(2, Math.round(state[axKey + "AxisMinorTicksDivide"] || 5));
          minor.dtick = ax.dtick / minorDiv;
        }
        ax.minor = minor;
      } else {
        ax.minor = { ticks: "", showgrid: false };
      }
      ax.automargin = true;
    });

    var layout = {
      width: w, height: h,
      paper_bgcolor: typeof chartBgColor === "function" ? chartBgColor() : "#ffffff",
      plot_bgcolor: typeof chartBgColor === "function" ? chartBgColor() : "#ffffff",
      font: { family: i, size: s, color: TEXT_INK },
      margin: { t: 30, r: 40, b: 60, l: 65 },
      xaxis: xAxis, yaxis: yAxis,
      showlegend: state.showLegend && traces.length > 1
    };
    if (layout.showlegend && typeof buildLegendLayout === "function") {
      layout.legend = buildLegendLayout(TEXT_INK, i, state.legendFontSize || s);
    }
    if (state.outlineFrame) {
      [layout.xaxis, layout.yaxis].forEach(function (ax) {
        var fbw = state.frameBorderWidth || 1.4;
        ax.mirror = state.mirrorAxisTicks ? "ticks" : true; ax.linewidth = fbw; ax.linecolor = SHAPE_INK; ax.showline = true;
        if (ax.ticks) { ax.tickwidth = fbw; ax.tickcolor = SHAPE_INK; }
        if (ax.minor && ax.minor.ticks) { ax.minor.tickwidth = Math.max(0.5, 0.7 * fbw); ax.minor.tickcolor = SHAPE_INK; }
      });
    }

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

  window.renderBubble = renderBubble;

  var originalRender = window.render;
  if (typeof originalRender === "function") {
    window.render = function () {
      if (state.chartType === BUBBLE_TYPE) {
        if (state.categories.length === 0) return;
        renderBubble();
        return;
      }
      return originalRender();
    };
  }
})();
