/* ==========================================================================
   Ridge Plot (joyplot) — registers the chart type and its sample data:
   stacked, overlapping KDE distributions, one per series, on a shared value
   axis (e.g. NDVI per tahun/site).

   Drawn by the D3 engine (js/d3-engine/05-special.js) on the shared frame,
   so Format Axis settings apply to its value axis. Each visible series
   supplies one array of raw values (at least 2) and becomes one ridge.
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
})();
