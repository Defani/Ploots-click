/* ==========================================================================
   Choropleth Map — adds a "Choropleth Map" chart type to the chart-builder.

   vendor/plotly-cartesian.min.js does NOT ship the choropleth/scattergeo
   trace modules (Plotly's "cartesian" partial bundle intentionally excludes
   them). So the "geo" partial bundle is lazy-loaded on demand, on its own
   Tier-3 entry in js/lazy-loader.js (PlootsLazy.ensurePlotlyGeo) — the exact
   same on-demand pattern already used for AG Grid / XLSX / jStat. This file
   does not change when or how those load.

   Once fetched, the geo bundle's UMD wrapper overwrites window.Plotly (every
   plotly.js bundle does `window.Plotly = Plotly` on load) — so the original
   cartesian instance is cached up front and swapped back in (no network
   refetch, just a reference swap) whenever the user leaves the map chart
   type, so every other chart type keeps working exactly as before.

   v2 additions (this file):
     - Custom GeoJSON support (trace.geojson + featureidkey) so the map is
       not limited to Plotly's built-in world/country atlas — this is what
       makes province/kabupaten-level thematic maps (e.g. AGC per kabupaten)
       possible, not just country-level maps.
     - Classed/binned choropleth (equal-interval or quantile), in addition
       to the original continuous gradient — standard practice for thematic
       biomass/carbon maps.
     - Manual z-range (zmin/zmax) so multiple maps (e.g. different years)
       can share one color scale for a fair visual comparison.
     - Reversescale toggle, missing-data land color, scope + projection
       controls for the built-in world atlas mode.
     - A "Peta (Choropleth)" sidebar section, shown only while this chart
       type is active, following the same side-section markup/toggle
       pattern already used elsewhere in index.html (js/ui_sections.js
       handles the open/close click delegation for any .side-section, so
       nothing else needs to change for a section injected at runtime).
   ========================================================================== */
(function () {
  "use strict";

  var cartesianPlotly = window.Plotly; // cached at boot, before any swap
  var geoActive = false;

  // ---- state defaults (added once; harmless if this file loads twice) ----
  function ensureChoroplethState() {
    if (state.choroplethGeoMode === undefined) state.choroplethGeoMode = "world"; // "world" | "custom"
    if (state.choroplethGeoJsonText === undefined) state.choroplethGeoJsonText = "";
    if (state.choroplethGeoJsonObj === undefined) state.choroplethGeoJsonObj = null;
    if (state.choroplethFeatureIdKey === undefined) state.choroplethFeatureIdKey = ""; // "" -> Plotly default "id"
    if (state.choroplethFitBounds === undefined) state.choroplethFitBounds = true;
    if (state.choroplethScope === undefined) state.choroplethScope = "world";
    if (state.choroplethProjection === undefined) state.choroplethProjection = "natural earth";
    if (state.choroplethReverseScale === undefined) state.choroplethReverseScale = false;
    if (state.choroplethMissingColor === undefined) state.choroplethMissingColor = "#f0eee4";
    if (state.choroplethColorMode === undefined) state.choroplethColorMode = "continuous"; // "continuous" | "classed"
    if (state.choroplethClasses === undefined) state.choroplethClasses = 5;
    if (state.choroplethClassMethod === undefined) state.choroplethClassMethod = "equal"; // "equal" | "quantile"
    if (state.choroplethZMode === undefined) state.choroplethZMode = "auto"; // "auto" | "custom"
    if (state.choroplethZMin === undefined) state.choroplethZMin = null;
    if (state.choroplethZMax === undefined) state.choroplethZMax = null;
  }
  ensureChoroplethState();

  function ensureChoroplethPlotly() {
    return PlootsLazy.ensurePlotlyGeo().then(function () {
      geoActive = true;
    });
  }

  function restoreCartesianPlotly() {
    if (geoActive) {
      window.Plotly = cartesianPlotly;
      geoActive = false;
    }
  }

  function looksIso3(codes) {
    return codes.length > 0 && codes.every(function (c) {
      return /^[A-Za-z]{3}$/.test((c == null ? "" : String(c)).trim());
    });
  }

  function showMapPlaceholder(msg) {
    var el = document.getElementById("plotlyDiv");
    if (!el) return;
    var w = state.chartBox.w, h = state.chartBox.h;
    el.innerHTML = "";
    var wrap = document.createElement("div");
    var bg = (typeof chartBgColor === "function" ? chartBgColor() : "#ffffff");
    wrap.style.cssText = "display:flex;align-items:center;justify-content:center;width:" + w + "px;height:" + h + "px;font-family:" + state.fontBody + ";color:#5c5c58;font-size:13px;background:" + bg + ";text-align:center;padding:20px;box-sizing:border-box;";
    wrap.textContent = msg;
    el.appendChild(wrap);
  }

  // ---- classed (binned) colorscale ----------------------------------------
  // Builds a step-function Plotly colorscale (array of [pos,color] stops
  // with each class repeated at its boundaries) instead of a continuous
  // gradient, plus the class breakpoints for the colorbar ticks. Standard
  // choropleth cartography practice for thematic maps (e.g. discrete AGC
  // or carbon-stock classes) where a continuous ramp is harder to read.
  function buildClassedScale(zValues, nClasses, method, baseColors, zminIn, zmaxIn) {
    var valid = zValues.filter(function (v) { return typeof v === "number" && isFinite(v); });
    if (!valid.length) return null;
    nClasses = Math.max(2, Math.min(9, Math.round(nClasses) || 5));
    var lo = isFinite(zminIn) ? zminIn : Math.min.apply(null, valid);
    var hi = isFinite(zmaxIn) ? zmaxIn : Math.max.apply(null, valid);
    if (hi <= lo) hi = lo + 1;

    var breaks = [lo];
    if ("quantile" === method) {
      var sorted = valid.slice().sort(function (a, b) { return a - b; });
      for (var i = 1; i < nClasses; i++) {
        var idx = Math.min(sorted.length - 1, Math.floor((i / nClasses) * sorted.length));
        breaks.push(sorted[idx]);
      }
    } else {
      for (var j = 1; j < nClasses; j++) breaks.push(lo + (hi - lo) * (j / nClasses));
    }
    breaks.push(hi);
    // enforce strictly increasing breakpoints (quantile ties on skewed data)
    for (var k = 1; k < breaks.length; k++) {
      if (breaks[k] <= breaks[k - 1]) breaks[k] = breaks[k - 1] + (hi - lo) * 1e-6 + 1e-9;
    }
    hi = breaks[breaks.length - 1];

    var classColors = [];
    for (var c = 0; c < nClasses; c++) classColors.push(baseColors[c % baseColors.length]);

    var scale = [];
    for (var s = 0; s < nClasses; s++) {
      var p0 = (breaks[s] - lo) / (hi - lo);
      var p1 = (breaks[s + 1] - lo) / (hi - lo);
      p0 = Math.max(0, Math.min(1, p0));
      p1 = Math.max(0, Math.min(1, p1));
      scale.push([p0, classColors[s]]);
      scale.push([p1, classColors[s]]);
    }
    scale[0][0] = 0;
    scale[scale.length - 1][0] = 1;
    return { scale: scale, breaks: breaks, zmin: lo, zmax: hi };
  }

  function reverseColorscale(scale) {
    var colors = scale.map(function (s) { return s[1]; }).reverse();
    return scale.map(function (s, i) { return [s[0], colors[i]]; });
  }

  function renderChoropleth() {
    var box = state.chartBox, w = box.w, h = box.h;
    var seriesName = state.seriesNames.filter(function (n) { return state.seriesMeta[n].visible; })[0];
    if (!seriesName) { renderBlankCanvas(); return; }

    if (!geoActive) {
      showMapPlaceholder("Loading map…");
      ensureChoroplethPlotly().then(function () {
        if ("choropleth" === state.chartType) render();
      });
      return;
    }

    var custom = "custom" === state.choroplethGeoMode;
    if (custom && !state.choroplethGeoJsonObj) {
      showMapPlaceholder("Tempel atau unggah GeoJSON kustom di panel \"Peta (Choropleth)\" pada sidebar untuk merender peta ini (misalnya batas provinsi/kabupaten).");
      return;
    }

    var locations = state.categories;
    var z = state.seriesData[seriesName];
    var colors = PALETTES[state.paletteIdx].colors;
    var label = state.seriesMeta[seriesName].label || seriesName;
    var fmt = function (v) { return formatValue(v, state.valueFormat || "auto"); };

    var colorscale, zmin, zmax, colorbarExtra = {};
    if ("classed" === state.choroplethColorMode) {
      var classed = buildClassedScale(z, state.choroplethClasses, state.choroplethClassMethod, colors, state.choroplethZMin, state.choroplethZMax);
      if (classed) {
        colorscale = state.choroplethReverseScale ? reverseColorscale(classed.scale) : classed.scale;
        zmin = classed.zmin;
        zmax = classed.zmax;
        colorbarExtra = {
          tickmode: "array",
          tickvals: classed.breaks,
          ticktext: classed.breaks.map(fmt)
        };
      }
    }
    if (!colorscale) {
      var base = isGrayscaleMode() ? "Greys" : plotlyColorscaleFromPalette(colors);
      colorscale = state.choroplethReverseScale && Array.isArray(base) ? reverseColorscale(base) : base;
      if ("custom" === state.choroplethZMode && isFinite(state.choroplethZMin) && isFinite(state.choroplethZMax)) {
        zmin = state.choroplethZMin;
        zmax = state.choroplethZMax;
      }
    }

    var trace = {
      type: "choropleth",
      locations: locations,
      z: z,
      customdata: locations,
      text: z.map(fmt),
      hovertemplate: "%{customdata}<br>" + escapeHtml(label) + ": %{text}<extra></extra>",
      colorscale: colorscale,
      marker: { line: { color: "#ffffff", width: state.outlineFrame ? 1 : 0.5 } },
      colorbar: Object.assign({
        title: { text: label, font: { family: state.fontBody, size: state.bodyFontSize || 12, color: TEXT_INK } },
        thickness: 14,
        outlinewidth: 0,
        tickfont: { family: state.fontBody, size: Math.max((state.bodyFontSize || 12) - 2, 9), color: TEXT_INK }
      }, colorbarExtra),
      showscale: state.showLegend
    };
    if (isFinite(zmin)) trace.zmin = zmin;
    if (isFinite(zmax)) trace.zmax = zmax;

    if (custom) {
      trace.geojson = state.choroplethGeoJsonObj;
      if (state.choroplethFeatureIdKey) trace.featureidkey = state.choroplethFeatureIdKey;
    } else {
      trace.locationmode = looksIso3(locations) ? "ISO-3" : "country names";
    }

    var geo = {
      showframe: false,
      showcoastlines: true,
      coastlinecolor: "#cfcabb",
      showland: true,
      landcolor: state.choroplethMissingColor,
      showocean: false,
      showcountries: !custom,
      countrycolor: "#ffffff",
      bgcolor: "#ffffff"
    };
    if (custom) {
      geo.fitbounds = state.choroplethFitBounds ? "geojson" : false;
      geo.visible = true;
    } else {
      geo.scope = state.choroplethScope || "world";
      geo.projection = { type: state.choroplethProjection || "natural earth" };
    }

    var layout = {
      width: w,
      height: h,
      paper_bgcolor: typeof chartBgColor === "function" ? chartBgColor() : "#ffffff",
      font: { family: state.fontBody, size: state.bodyFontSize || 12, color: TEXT_INK },
      margin: { t: 15, r: 15, b: 15, l: 15 },
      geo: geo,
      showlegend: false
    };

    Plotly.newPlot("plotlyDiv", [trace], layout, {
      responsive: false,
      displaylogo: false,
      displayModeBar: true,
      modeBarButtonsToRemove: ["lasso2d", "select2d"]
    }).then(function () {
      try { Plotly.Plots.resize("plotlyDiv"); } catch (e) {}
      state.chartRenderedW = w;
      state.chartRenderedH = h;
    }).catch(function (err) {
      showMapPlaceholder("Gagal merender peta: " + (err && err.message ? err.message : "periksa GeoJSON/featureidkey."));
    });
  }

  window.renderChoropleth = renderChoropleth;

  // ==========================================================================
  // Sidebar panel: "Peta (Choropleth)" — injected once into #panel-chart,
  // right after the existing "Chart Type" section, following the same
  // .side-section / .side-section-head / .side-section-body markup used
  // throughout index.html. js/ui_sections.js already delegates the
  // open/close click handler to any .side-section on the page, so no extra
  // wiring is needed for the collapse/expand behavior itself.
  // ==========================================================================
  var SECTION_ID = "choroplethSettingsSection";

  function buildPanelHtml() {
    return (
      '<div class="side-section" id="' + SECTION_ID + '" data-section="choropleth-map" style="display:none;">' +
        '<div class="side-section-head"><span class="ss-lbl"><span class="material-symbols-outlined">public</span>Peta (Choropleth)</span><span class="material-symbols-outlined ss-chev">expand_more</span></div>' +
        '<div class="side-section-body">' +

          '<label class="field-label" style="margin-top:2px;">Basis peta</label>' +
          '<div class="toggle-group">' +
            '<button id="choroGeoModeWorld" class="active">Dunia (negara)</button>' +
            '<button id="choroGeoModeCustom">GeoJSON kustom</button>' +
          '</div>' +

          '<div id="choroWorldWrap">' +
            '<label class="field-label">Cakupan (scope)</label>' +
            '<select id="choroScope">' +
              '<option value="world">World</option>' +
              '<option value="asia">Asia</option>' +
              '<option value="africa">Africa</option>' +
              '<option value="europe">Europe</option>' +
              '<option value="north america">North America</option>' +
              '<option value="south america">South America</option>' +
              '<option value="usa">USA</option>' +
            '</select>' +
            '<label class="field-label">Proyeksi</label>' +
            '<select id="choroProjection">' +
              '<option value="natural earth">Natural earth</option>' +
              '<option value="equirectangular">Equirectangular</option>' +
              '<option value="mercator">Mercator</option>' +
              '<option value="orthographic">Orthographic (globe)</option>' +
              '<option value="conic conformal">Conic conformal</option>' +
              '<option value="azimuthal equal area">Azimuthal equal area</option>' +
            '</select>' +
            '<p class="cp-hint">Kolom data (kategori) diisi kode ISO-3 (mis. IDN) atau nama negara. Untuk peta administratif Indonesia (provinsi/kabupaten), gunakan "GeoJSON kustom".</p>' +
          '</div>' +

          '<div id="choroCustomWrap" style="display:none;">' +
            '<label class="field-label" style="margin-top:14px;">GeoJSON (tempel teks)</label>' +
            '<textarea id="choroGeoJsonText" placeholder=\'{"type":"FeatureCollection","features":[...]}\' style="height:80px;font-size:11px;"></textarea>' +
            '<div class="row" style="margin-top:6px;">' +
              '<button id="choroParseBtn">Muat dari teks</button>' +
              '<button class="file-btn" id="choroFileBtnWrap">Unggah file<input type="file" id="choroFileInput" accept=".json,.geojson,application/json"></button>' +
            '</div>' +
            '<button id="choroLoadExampleBtn" style="width:100%;margin-top:6px;">Contoh: batas provinsi Indonesia</button>' +
            '<p class="status" id="choroGeoStatus" style="display:none;"></p>' +
            '<label class="field-label">Kunci ID fitur (featureidkey)</label>' +
            '<input type="text" id="choroFeatureIdKey" placeholder="properties.name (kosongkan = pakai id bawaan)">' +
            '<p class="cp-hint">Nilai pada kolom kategori data harus persis sama dengan nilai properti ini di setiap fitur GeoJSON (case-sensitive).</p>' +
            '<div class="check-row"><input type="checkbox" id="choroFitBounds" checked><label for="choroFitBounds">Zoom otomatis ke wilayah (fitbounds)</label></div>' +
          '</div>' +

          '<label class="field-label" style="margin-top:14px;">Mode warna</label>' +
          '<div class="toggle-group">' +
            '<button id="choroColorContinuous" class="active">Kontinu</button>' +
            '<button id="choroColorClassed">Berkelas</button>' +
          '</div>' +
          '<div id="choroClassedWrap" style="display:none;">' +
            '<div class="num-pair" style="margin-top:8px;">' +
              '<div><label class="field-label" style="margin-top:0;">Jumlah kelas</label><input type="number" id="choroClasses" value="5" min="2" max="9" step="1"></div>' +
              '<div><label class="field-label" style="margin-top:0;">Metode</label><select id="choroClassMethod"><option value="equal">Interval sama</option><option value="quantile">Kuantil</option></select></div>' +
            '</div>' +
          '</div>' +

          '<label class="field-label">Rentang nilai (z)</label>' +
          '<div class="toggle-group">' +
            '<button id="choroZAuto" class="active">Otomatis</button>' +
            '<button id="choroZCustom">Kustom</button>' +
          '</div>' +
          '<div class="num-pair" id="choroZInputs" style="margin-top:8px;display:none;">' +
            '<div><label class="field-label" style="margin-top:0;">Min</label><input type="number" id="choroZMin" step="any"></div>' +
            '<div><label class="field-label" style="margin-top:0;">Max</label><input type="number" id="choroZMax" step="any"></div>' +
          '</div>' +
          '<p class="cp-hint">Set manual agar beberapa peta (mis. AGC 2019 vs 2024) memakai skala warna yang sama untuk perbandingan yang adil.</p>' +

          '<div class="check-row" style="margin-top:14px;"><input type="checkbox" id="choroReverseScale"><label for="choroReverseScale">Balik arah skala warna</label></div>' +
          '<label class="field-label">Warna wilayah tanpa data</label>' +
          '<input type="color" class="full-color-picker" id="choroMissingColor" value="#f0eee4">' +

        '</div>' +
      '</div>'
    );
  }

  function injectPanel() {
    if (document.getElementById(SECTION_ID)) return;
    var anchor = document.querySelector('#panel-chart .side-section[data-section="chart-type"]');
    if (!anchor) return;
    var tmp = document.createElement("div");
    tmp.innerHTML = buildPanelHtml();
    var section = tmp.firstElementChild;
    anchor.parentNode.insertBefore(section, anchor.nextSibling);
    wirePanel();
  }

  function setGeoStatus(msg, ok) {
    var el = document.getElementById("choroGeoStatus");
    if (!el) return;
    el.textContent = msg;
    el.className = "status " + (ok ? "ok" : "error");
    el.style.display = msg ? "block" : "none";
  }

  function applyParsedGeoJson(obj, sourceLabel) {
    if (!obj || !Array.isArray(obj.features)) {
      setGeoStatus("GeoJSON tidak valid: butuh FeatureCollection dengan array \"features\".", false);
      return;
    }
    state.choroplethGeoJsonObj = obj;
    setGeoStatus((sourceLabel || "GeoJSON") + " dimuat — " + obj.features.length + " fitur.", true);
    if ("choropleth" === state.chartType) render();
  }

  function detectNameKey(feature) {
    if (!feature || !feature.properties) return "";
    var props = feature.properties;
    var keys = Object.keys(props);
    for (var i = 0; i < keys.length; i++) {
      var v = props[keys[i]];
      if (typeof v === "string" && v.length > 1 && v.length < 60) return "properties." + keys[i];
    }
    return keys.length ? "properties." + keys[0] : "";
  }

  function wirePanel() {
    var geoModeWorld = document.getElementById("choroGeoModeWorld");
    var geoModeCustom = document.getElementById("choroGeoModeCustom");
    var worldWrap = document.getElementById("choroWorldWrap");
    var customWrap = document.getElementById("choroCustomWrap");

    function setGeoMode(mode) {
      state.choroplethGeoMode = mode;
      geoModeWorld.classList.toggle("active", "world" === mode);
      geoModeCustom.classList.toggle("active", "custom" === mode);
      worldWrap.style.display = "world" === mode ? "" : "none";
      customWrap.style.display = "custom" === mode ? "" : "none";
      if ("choropleth" === state.chartType) render();
    }
    geoModeWorld.addEventListener("click", function () { setGeoMode("world"); });
    geoModeCustom.addEventListener("click", function () { setGeoMode("custom"); });

    var scopeSel = document.getElementById("choroScope");
    scopeSel.addEventListener("change", function () { state.choroplethScope = this.value; if ("choropleth" === state.chartType) render(); });

    var projSel = document.getElementById("choroProjection");
    projSel.addEventListener("change", function () { state.choroplethProjection = this.value; if ("choropleth" === state.chartType) render(); });

    var textArea = document.getElementById("choroGeoJsonText");
    var parseBtn = document.getElementById("choroParseBtn");
    parseBtn.addEventListener("click", function () {
      var txt = textArea.value.trim();
      if (!txt) { setGeoStatus("Tempel teks GeoJSON terlebih dahulu.", false); return; }
      try {
        var obj = JSON.parse(txt);
        state.choroplethGeoJsonText = txt;
        var key = document.getElementById("choroFeatureIdKey");
        if (!key.value && obj.features && obj.features[0]) key.value = detectNameKey(obj.features[0]);
        state.choroplethFeatureIdKey = key.value;
        applyParsedGeoJson(obj, "GeoJSON dari teks");
      } catch (e) {
        setGeoStatus("Gagal parse JSON: " + e.message, false);
      }
    });

    var fileInput = document.getElementById("choroFileInput");
    fileInput.addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var obj = JSON.parse(reader.result);
          textArea.value = reader.result;
          state.choroplethGeoJsonText = reader.result;
          var key = document.getElementById("choroFeatureIdKey");
          if (!key.value && obj.features && obj.features[0]) key.value = detectNameKey(obj.features[0]);
          state.choroplethFeatureIdKey = key.value;
          applyParsedGeoJson(obj, f.name);
        } catch (e) {
          setGeoStatus("Gagal parse file: " + e.message, false);
        }
      };
      reader.readAsText(f);
    });

    // Quick-start example: Indonesia province boundaries (34-province
    // dataset from the public superpikar/indonesia-geojson repo, fetched
    // client-side — this runs in the deployed app in the user's own
    // browser, not through any sandboxed network). Property key is
    // auto-detected rather than hardcoded, since the exact schema wasn't
    // verified here.
    var exampleBtn = document.getElementById("choroLoadExampleBtn");
    exampleBtn.addEventListener("click", function () {
      setGeoStatus("Mengunduh contoh GeoJSON provinsi…", true);
      fetch("https://raw.githubusercontent.com/superpikar/indonesia-geojson/master/indonesia-province-simple.json")
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (obj) {
          textArea.value = JSON.stringify(obj);
          state.choroplethGeoJsonText = textArea.value;
          var key = document.getElementById("choroFeatureIdKey");
          key.value = detectNameKey(obj.features && obj.features[0]);
          state.choroplethFeatureIdKey = key.value;
          applyParsedGeoJson(obj, "Contoh provinsi Indonesia");
        })
        .catch(function (e) {
          setGeoStatus("Gagal mengunduh contoh (periksa koneksi): " + e.message, false);
        });
    });

    var keyInput = document.getElementById("choroFeatureIdKey");
    keyInput.addEventListener("input", function () { state.choroplethFeatureIdKey = this.value.trim(); if ("choropleth" === state.chartType) render(); });

    var fitBoundsCk = document.getElementById("choroFitBounds");
    fitBoundsCk.addEventListener("change", function () { state.choroplethFitBounds = this.checked; if ("choropleth" === state.chartType) render(); });

    var colorCont = document.getElementById("choroColorContinuous");
    var colorClassed = document.getElementById("choroColorClassed");
    var classedWrap = document.getElementById("choroClassedWrap");
    function setColorMode(mode) {
      state.choroplethColorMode = mode;
      colorCont.classList.toggle("active", "continuous" === mode);
      colorClassed.classList.toggle("active", "classed" === mode);
      classedWrap.style.display = "classed" === mode ? "" : "none";
      if ("choropleth" === state.chartType) render();
    }
    colorCont.addEventListener("click", function () { setColorMode("continuous"); });
    colorClassed.addEventListener("click", function () { setColorMode("classed"); });

    var classesInput = document.getElementById("choroClasses");
    classesInput.addEventListener("input", function () { state.choroplethClasses = parseInt(this.value) || 5; if ("choropleth" === state.chartType) render(); });
    var methodSel = document.getElementById("choroClassMethod");
    methodSel.addEventListener("change", function () { state.choroplethClassMethod = this.value; if ("choropleth" === state.chartType) render(); });

    var zAuto = document.getElementById("choroZAuto");
    var zCustom = document.getElementById("choroZCustom");
    var zInputs = document.getElementById("choroZInputs");
    function setZMode(mode) {
      state.choroplethZMode = mode;
      zAuto.classList.toggle("active", "auto" === mode);
      zCustom.classList.toggle("active", "custom" === mode);
      zInputs.style.display = "custom" === mode ? "flex" : "none";
      if ("choropleth" === state.chartType) render();
    }
    zAuto.addEventListener("click", function () { setZMode("auto"); });
    zCustom.addEventListener("click", function () { setZMode("custom"); });
    var zMinInput = document.getElementById("choroZMin");
    zMinInput.addEventListener("input", function () { state.choroplethZMin = "" === this.value ? null : parseFloat(this.value); if ("choropleth" === state.chartType) render(); });
    var zMaxInput = document.getElementById("choroZMax");
    zMaxInput.addEventListener("input", function () { state.choroplethZMax = "" === this.value ? null : parseFloat(this.value); if ("choropleth" === state.chartType) render(); });

    var reverseCk = document.getElementById("choroReverseScale");
    reverseCk.addEventListener("change", function () { state.choroplethReverseScale = this.checked; if ("choropleth" === state.chartType) render(); });

    var missingColorInput = document.getElementById("choroMissingColor");
    missingColorInput.addEventListener("input", function () { state.choroplethMissingColor = this.value; if ("choropleth" === state.chartType) render(); });
  }

  function updateChoroplethSectionVisibility() {
    var el = document.getElementById(SECTION_ID);
    if (!el) return;
    el.style.display = "choropleth" === state.chartType ? "" : "none";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectPanel);
  } else {
    injectPanel();
  }

  // Leaving the map type: swap the cached cartesian Plotly instance back in
  // immediately (no refetch) before the normal render pipeline runs again,
  // and keep the sidebar section's visibility in sync with the active type.
  var originalSelectChartType = window.selectChartType;
  if (typeof originalSelectChartType === "function") {
    window.selectChartType = function (v) {
      if ("choropleth" !== v && "choropleth" === state.chartType) restoreCartesianPlotly();
      originalSelectChartType(v);
      updateChoroplethSectionVisibility();
    };
  }
})();
