/* ==========================================================================
   Sankey — registers the "Sankey" chart type and its sample data, e.g.
   transisi tutupan lahan (Hutan Primer -> Hutan Sekunder -> Perkebunan).

   Drawn by the D3 engine (js/d3-engine/05-special.js). Data model: each
   category row is a flow "Source -> Target"; the first visible series
   gives the link values. Nodes are the distinct names in order of first
   appearance.
   ========================================================================== */
(function () {
  "use strict";

  var SANKEY_TYPE = "sankey";

  if (typeof CHART_TYPE_DEFS !== "undefined") {
    CHART_TYPE_DEFS.push({ category: "Other", value: SANKEY_TYPE, label: "Sankey", icon: "mdi:chart-sankey" });
  }
  if (typeof SAMPLE_DATA_BY_TYPE !== "undefined") {
    SAMPLE_DATA_BY_TYPE[SANKEY_TYPE] = "Alur\tLuas (ha)\nHutan Primer -> Hutan Sekunder\t120\nHutan Primer -> Perkebunan\t85\nHutan Sekunder -> Perkebunan\t150\nHutan Sekunder -> Lahan Terbuka\t40\nPerkebunan -> Lahan Terbuka\t30\nLahan Terbuka -> Pemukiman\t25";
  }
  if (typeof buildChartTypeGrid === "function") buildChartTypeGrid();
  if (typeof syncChartTypeGridActive === "function") syncChartTypeGridActive();
})();
