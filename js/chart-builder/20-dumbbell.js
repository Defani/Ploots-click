/* ==========================================================================
   Dumbbell / Slope chart — registers the chart type and its sample data:
   one connector per category through every visible series' value, with a
   coloured marker per series (classic "before vs after" with 2 series, a
   multi-point slope line with more).

   Drawn by the D3 engine (js/d3-engine/05-special.js). Data model is the
   same as bar-group: categories are the rows, each visible series one
   condition (e.g. "2015" vs "2023"). Needs at least 2 visible series.
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
})();
