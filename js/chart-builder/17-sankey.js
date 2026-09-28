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
    SAMPLE_DATA_BY_TYPE[SANKEY_TYPE] = "Flow\tArea (ha)\nPrimary Forest -> Secondary Forest\t120\nPrimary Forest -> Plantation\t85\nSecondary Forest -> Plantation\t150\nSecondary Forest -> Open Land\t40\nPlantation -> Open Land\t30\nOpen Land -> Settlement\t25";
  }
  if (typeof buildChartTypeGrid === "function") buildChartTypeGrid();
  if (typeof syncChartTypeGridActive === "function") syncChartTypeGridActive();
})();
