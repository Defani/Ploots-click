/* ==========================================================================
   Bubble chart — registers the "Bubble" chart type and its sample data.

   Drawn by the D3 engine (js/d3-engine/05-special.js). Data model: X comes
   from the category column; series are read in pairs (Y, size), so a table
   "X | Y1 | Size1 | Y2 | Size2" gives two bubble series. Bubble area is
   proportional to the size value on one scale across all pairs.
   ========================================================================== */
(function () {
  "use strict";

  var BUBBLE_TYPE = "bubble";

  if (typeof CHART_TYPE_DEFS !== "undefined") {
    CHART_TYPE_DEFS.push({ category: "Line & Area", value: BUBBLE_TYPE, label: "Bubble", icon: "mdi:chart-bubble" });
  }
  if (typeof SAMPLE_DATA_BY_TYPE !== "undefined") {
    SAMPLE_DATA_BY_TYPE[BUBBLE_TYPE] = "IRECI\tAGC Avicennia (ton/ha)\tLuas Plot Avicennia (ha)\tAGC Rhizophora (ton/ha)\tLuas Plot Rhizophora (ha)\n0.38\t34.2\t1.4\t46.1\t1.1\n0.44\t38.9\t1.8\t51.4\t1.6\n0.51\t45.6\t2.3\t58.9\t2.0\n0.57\t49.8\t1.6\t63.2\t2.4\n0.63\t55.3\t2.7\t69.4\t1.8\n0.69\t61.7\t2.1\t74.8\t2.6\n0.75\t68.2\t3.0\t80.1\t2.2";
  }
  if (typeof buildChartTypeGrid === "function") buildChartTypeGrid();
  if (typeof syncChartTypeGridActive === "function") syncChartTypeGridActive();
})();
