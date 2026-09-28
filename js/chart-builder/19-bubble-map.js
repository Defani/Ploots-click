/* ==========================================================================
   Bubble Map — registers the "Bubble Map" chart type and its sample data:
   point locations sized and coloured by value. Complements the choropleth
   (which colours whole regions) for site-level data like sample plots,
   hotspot points or survey stations.

   Drawn by the D3 engine (js/d3-engine/06-geo.js). Data model: each
   category row is a point "Label|lat,lon" (e.g. "Titik Api A|-2.50,113.90";
   the "Label|" part is optional); the first visible series gives the value
   that drives both bubble size and colour.
   ========================================================================== */
(function () {
  "use strict";

  var BUBBLE_MAP_TYPE = "bubble-map";

  if (typeof CHART_TYPE_DEFS !== "undefined") {
    CHART_TYPE_DEFS.push({ category: "Map", value: BUBBLE_MAP_TYPE, label: "Bubble Map", icon: "mdi:map-marker-radius" });
  }
  if (typeof SAMPLE_DATA_BY_TYPE !== "undefined") {
    SAMPLE_DATA_BY_TYPE[BUBBLE_MAP_TYPE] = "Titik\tLuas Terdampak (ha)\nTitik Api A|-2.50,113.90\t45\nTitik Api B|-1.80,111.40\t28\nTitik Api C|-3.20,114.60\t62\nTitik Api D|-0.90,109.80\t15\nTitik Api E|-2.10,116.20\t37\nTitik Api F|-1.40,101.30\t53\nTitik Api G|-2.80,104.70\t20\nTitik Api H|-0.50,117.10\t41";
  }
  if (typeof buildChartTypeGrid === "function") buildChartTypeGrid();
  if (typeof syncChartTypeGridActive === "function") syncChartTypeGridActive();
})();
