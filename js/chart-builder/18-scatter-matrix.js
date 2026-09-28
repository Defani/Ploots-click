/* ==========================================================================
   Scatter Matrix (SPLOM) — registers the "Scatter Matrix" chart type and
   its sample data: a grid of pairwise scatter plots across every visible
   series, for eyeballing correlation between several numeric variables
   (e.g. NDVI vs curah hujan vs elevasi vs tutupan kanopi).

   Drawn by the D3 engine (js/d3-engine/05-special.js). Each visible series
   is one variable; category rows are just the sample index. Needs at
   least 2 visible series.
   ========================================================================== */
(function () {
  "use strict";

  var SPLOM_TYPE = "scatter-matrix";

  if (typeof CHART_TYPE_DEFS !== "undefined") {
    CHART_TYPE_DEFS.push({ category: "Other", value: SPLOM_TYPE, label: "Scatter Matrix", icon: "mdi:grid" });
  }
  if (typeof SAMPLE_DATA_BY_TYPE !== "undefined") {
    SAMPLE_DATA_BY_TYPE[SPLOM_TYPE] = "Plot\tNDVI\tRainfall (mm)\tElevation (m)\tCanopy Cover (%)\n1\t0.41\t1850\t120\t55\n2\t0.55\t2100\t340\t72\n3\t0.62\t2250\t410\t80\n4\t0.35\t1600\t80\t40\n5\t0.58\t2180\t390\t76\n6\t0.47\t1950\t260\t62\n7\t0.29\t1450\t60\t30\n8\t0.66\t2300\t450\t85\n9\t0.51\t2020\t300\t68\n10\t0.38\t1700\t150\t45\n11\t0.60\t2220\t400\t78\n12\t0.44\t1880\t220\t58\n13\t0.33\t1550\t90\t36\n14\t0.53\t2060\t320\t70\n15\t0.27\t1400\t50\t28";
  }
  if (typeof buildChartTypeGrid === "function") buildChartTypeGrid();
  if (typeof syncChartTypeGridActive === "function") syncChartTypeGridActive();
})();
