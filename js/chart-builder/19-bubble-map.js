/* ==========================================================================
   Bubble Map — point locations (lat/lon) sized (and colored) by value.
   Complements Choropleth Map: choropleth colors whole regions/polygons,
   this places a dot at an exact coordinate — the natural fit for site-level
   data like sample plots, hotspot points, or survey stations rather than
   province/country aggregates.

   scattergeo ships inside vendor/plotly-ploots.min.js together with every
   other trace type, so this renders with the one global Plotly instance
   (no lazy bundle, no window.Plotly swap). Topojson is served locally from
   vendor/topojson/ — see 11-choropleth.js.

   Data model: each category row is a point, encoded as
   "Label|lat,lon" (e.g. "Titik Api A|-2.50,113.90"); the "Label|" part is
   optional — a bare "lat,lon" is used as its own label. Only the first
   VISIBLE series supplies the value that drives both bubble size and color
   (same "first visible series" convention as choropleth/sunburst).
   ========================================================================== */
(function () {
  "use strict";

  var BUBBLE_MAP_TYPE = "bubble-map";
  var PLOOTS_TOPOJSON_URL = new URL("vendor/topojson/", document.baseURI).href;

  if (typeof CHART_TYPE_DEFS !== "undefined") {
    CHART_TYPE_DEFS.push({ category: "Map", value: BUBBLE_MAP_TYPE, label: "Bubble Map", icon: "mdi:map-marker-radius" });
  }
  if (typeof SAMPLE_DATA_BY_TYPE !== "undefined") {
    SAMPLE_DATA_BY_TYPE[BUBBLE_MAP_TYPE] = "Titik\tLuas Terdampak (ha)\nTitik Api A|-2.50,113.90\t45\nTitik Api B|-1.80,111.40\t28\nTitik Api C|-3.20,114.60\t62\nTitik Api D|-0.90,109.80\t15\nTitik Api E|-2.10,116.20\t37\nTitik Api F|-1.40,101.30\t53\nTitik Api G|-2.80,104.70\t20\nTitik Api H|-0.50,117.10\t41";
  }
  if (typeof buildChartTypeGrid === "function") buildChartTypeGrid();
  if (typeof syncChartTypeGridActive === "function") syncChartTypeGridActive();

  function showMapPlaceholder(msg) {
    var el = document.getElementById("plotlyDiv");
    if (!el) return;
    var w = state.chartBox.w, h = state.chartBox.h;
    var bg = typeof chartBgColor === "function" ? chartBgColor() : "#ffffff";
    try { if (el._fullLayout) Plotly.purge(el); } catch (e) {}
    el.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.className = "ploots-map-placeholder";
    wrap.style.cssText = "display:flex;align-items:center;justify-content:center;width:" + w + "px;height:" + h + "px;font-family:" + state.fontBody + ";color:#5c5c58;font-size:13px;background:" + bg + ";text-align:center;padding:20px;box-sizing:border-box;";
    wrap.textContent = msg;
    el.appendChild(wrap);
  }

  // "Label|lat,lon" or bare "lat,lon" -> {label, lat, lon}
  function parsePoint(catText) {
    var raw = String(catText == null ? "" : catText);
    var pipeIdx = raw.indexOf("|");
    var label = pipeIdx === -1 ? raw.trim() : raw.slice(0, pipeIdx).trim();
    var coordStr = pipeIdx === -1 ? raw : raw.slice(pipeIdx + 1);
    var nums = coordStr.split(",").map(function (s) { return parseFloat(String(s).trim()); });
    if (nums.length < 2 || !isFinite(nums[0]) || !isFinite(nums[1])) return null;
    return { label: label || coordStr.trim(), lat: nums[0], lon: nums[1] };
  }

  function buildPoints() {
    var seriesName = state.seriesNames.filter(function (n) { return state.seriesMeta[n].visible; })[0];
    if (!seriesName) return null;
    var values = state.seriesData[seriesName] || [];
    var lats = [], lons = [], labels = [], vals = [];
    state.categories.forEach(function (catText, i) {
      var p = parsePoint(catText);
      var v = values[i];
      if (!p || typeof v !== "number" || !isFinite(v)) return;
      lats.push(p.lat);
      lons.push(p.lon);
      labels.push(p.label);
      vals.push(v);
    });
    if (!vals.length) return null;
    return { lat: lats, lon: lons, label: labels, value: vals, seriesLabel: state.seriesMeta[seriesName].label || seriesName };
  }

  function renderBubbleMap() {
    var box = state.chartBox, w = box.w, h = box.h;
    var points = buildPoints();
    if (!points) {
      if (typeof renderBlankCanvas === "function") renderBlankCanvas();
      return;
    }

    var colors = PALETTES[state.paletteIdx].colors;
    var gray = typeof isGrayscaleMode === "function" && isGrayscaleMode();
    var colorscale = gray ? "Greys" : (typeof plotlyColorscaleFromPalette === "function" ? plotlyColorscaleFromPalette(colors) : undefined);

    var maxVal = Math.max.apply(null, points.value);
    var minVal = Math.min.apply(null, points.value);
    // Area-proportional sizing (sizemode "area" + sizeref) so bubble AREA,
    // not radius, scales with value — the correct convention for bubble
    // maps/charts, avoiding the classic "radius scaling" perception bias.
    var maxDiameterPx = 46;
    var sizeref = (2 * maxVal) / Math.pow(maxDiameterPx, 2) || 1;

    var trace = {
      type: "scattergeo",
      mode: "markers",
      lat: points.lat,
      lon: points.lon,
      text: points.label.map(function (l, i) {
        return l + "<br>" + points.seriesLabel + ": " + (typeof formatValue === "function" ? formatValue(points.value[i], state.valueFormat || "auto") : points.value[i]);
      }),
      hoverinfo: "text",
      marker: {
        size: points.value,
        sizemode: "area",
        sizeref: sizeref,
        sizemin: 4,
        color: points.value,
        colorscale: colorscale,
        cmin: minVal,
        cmax: maxVal,
        showscale: true,
        colorbar: { title: { text: points.seriesLabel } },
        line: { color: gray ? "#ffffff" : "#3a3a36", width: 0.6 },
        opacity: 0.85
      }
    };

    var geo = {
      showframe: false,
      showcoastlines: true,
      coastlinecolor: "#cfcabb",
      showland: true,
      landcolor: "#f0eee4",
      showocean: false,
      showcountries: true,
      countrycolor: "#ffffff",
      bgcolor: "#ffffff",
      fitbounds: "locations"
    };

    var layout = {
      width: w,
      height: h,
      paper_bgcolor: typeof chartBgColor === "function" ? chartBgColor() : "#ffffff",
      font: { family: state.fontBody, size: state.bodyFontSize || 12, color: "#1a1a1a" },
      margin: { t: 15, r: 15, b: 15, l: 15 },
      geo: geo,
      showlegend: false
    };

    var ph = document.querySelector("#plotlyDiv > .ploots-map-placeholder");
    if (ph) ph.remove();
    Plotly.newPlot("plotlyDiv", [trace], layout, {
      responsive: false,
      displaylogo: false,
      displayModeBar: true,
      modeBarButtonsToRemove: ["lasso2d", "select2d"],
      topojsonURL: PLOOTS_TOPOJSON_URL
    }).then(function () {
      try { Plotly.Plots.resize("plotlyDiv"); } catch (e) {}
      state.chartRenderedW = w;
      state.chartRenderedH = h;
    });
  }

  window.renderBubbleMap = renderBubbleMap;

  var originalRender = window.render;
  if (typeof originalRender === "function") {
    window.render = function () {
      if (state.chartType === BUBBLE_MAP_TYPE) {
        if (state.categories.length === 0) { if (typeof renderBlankCanvas === "function") renderBlankCanvas(); return; }
        renderBubbleMap();
        return;
      }
      return originalRender();
    };
  }

})();
