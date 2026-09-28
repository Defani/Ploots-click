/* ==========================================================================
   Lollipop chart — registers the "Lollipop" chart type and its sample data.

   Drawn by the D3 engine (js/d3-engine/05-special.js): a stem from 0 plus a
   head per series, series grouped side by side within each category.
   ========================================================================== */
(function () {
  "use strict";

  var LOLLIPOP_TYPE = "lollipop";

  if (typeof CHART_TYPE_DEFS !== "undefined") {
    CHART_TYPE_DEFS.push({ category: "Bar", value: LOLLIPOP_TYPE, label: "Lollipop", icon: "gicon:bubble_chart" });
  }
  if (typeof SAMPLE_DATA_BY_TYPE !== "undefined") {
    SAMPLE_DATA_BY_TYPE[LOLLIPOP_TYPE] = "Plot\tAvicennia marina\tRhizophora stylosa\nP1\t42.3\t58.9\nP2\t38.7\t63.2\nP3\t51.2\t49.7\nP4\t29.8\t55.4\nP5\t45.6\t60.1";
  }
  if (typeof buildChartTypeGrid === "function") buildChartTypeGrid();
  if (typeof syncChartTypeGridActive === "function") syncChartTypeGridActive();
})();
