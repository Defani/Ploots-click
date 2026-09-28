/* ==========================================================================
   Choropleth Map — registers the chart type's settings (state defaults)
   and the "Choropleth map" sidebar section, shown only while this chart
   type is active.

   The map itself is drawn by the D3 engine (js/d3-engine/06-geo.js), which
   reads every state.choropleth* value set here: world atlas (scope +
   projection) or custom GeoJSON with featureidkey and fit-to-bounds,
   continuous or classed (equal interval / quantile) colouring, manual z
   range, reversed scale and the colour for regions without data.
   ========================================================================== */
(function () {
  "use strict";
  // ---- state defaults (added once; harmless if this file loads twice) ----
  function ensureChoroplethState() {
    if (state.choroplethGeoMode === undefined) state.choroplethGeoMode = "world"; // "world" | "custom"
    if (state.choroplethGeoJsonText === undefined) state.choroplethGeoJsonText = "";
    if (state.choroplethGeoJsonObj === undefined) state.choroplethGeoJsonObj = null;
    if (state.choroplethFeatureIdKey === undefined) state.choroplethFeatureIdKey = ""; // "" -> use feature.id
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

  // ==========================================================================
  // Sidebar panel: "Choropleth map" — injected once into #panel-chart,
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
        '<div class="side-section-head"><span class="ss-lbl"><span class="material-symbols-outlined">public</span>Choropleth map</span><span class="material-symbols-outlined ss-chev">expand_more</span></div>' +
        '<div class="side-section-body">' +

          '<label class="field-label" style="margin-top:2px;">Base map</label>' +
          '<div class="toggle-group">' +
            '<button id="choroGeoModeWorld" class="active">World (countries)</button>' +
            '<button id="choroGeoModeCustom">Custom GeoJSON</button>' +
          '</div>' +

          '<div id="choroWorldWrap">' +
            '<label class="field-label">Scope</label>' +
            '<select id="choroScope">' +
              '<option value="world">World</option>' +
              '<option value="asia">Asia</option>' +
              '<option value="africa">Africa</option>' +
              '<option value="europe">Europe</option>' +
              '<option value="north america">North America</option>' +
              '<option value="south america">South America</option>' +
              '<option value="usa">USA</option>' +
            '</select>' +
            '<label class="field-label">Projection</label>' +
            '<select id="choroProjection">' +
              '<option value="natural earth">Natural earth</option>' +
              '<option value="equirectangular">Equirectangular</option>' +
              '<option value="mercator">Mercator</option>' +
              '<option value="orthographic">Orthographic (globe)</option>' +
              '<option value="conic conformal">Conic conformal</option>' +
              '<option value="azimuthal equal area">Azimuthal equal area</option>' +
            '</select>' +
          '</div>' +

          '<div id="choroCustomWrap" style="display:none;">' +
            '<label class="field-label" style="margin-top:14px;">GeoJSON (paste text)</label>' +
            '<textarea id="choroGeoJsonText" placeholder=\'{"type":"FeatureCollection","features":[...]}\' style="height:80px;font-size:11px;"></textarea>' +
            '<div class="row" style="margin-top:6px;">' +
              '<button id="choroParseBtn">Load text</button>' +
              '<button class="file-btn" id="choroFileBtnWrap">Upload file<input type="file" id="choroFileInput" accept=".json,.geojson,application/json"></button>' +
            '</div>' +
            '<button id="choroLoadExampleBtn" style="width:100%;margin-top:6px;">Sample: Indonesian provinces</button>' +
            '<p class="status" id="choroGeoStatus" style="display:none;"></p>' +
            '<label class="field-label">Feature ID key</label>' +
            '<input type="text" id="choroFeatureIdKey" placeholder="properties.name (empty = feature id)">' +
            '<div class="check-row"><input type="checkbox" id="choroFitBounds" checked><label for="choroFitBounds">Zoom to features</label></div>' +
          '</div>' +

          '<label class="field-label" style="margin-top:14px;">Color mode</label>' +
          '<div class="toggle-group">' +
            '<button id="choroColorContinuous" class="active">Continuous</button>' +
            '<button id="choroColorClassed">Classed</button>' +
          '</div>' +
          '<div id="choroClassedWrap" style="display:none;">' +
            '<div class="num-pair" style="margin-top:8px;">' +
              '<div><label class="field-label" style="margin-top:0;">Classes</label><input type="number" id="choroClasses" value="5" min="2" max="9" step="1"></div>' +
              '<div><label class="field-label" style="margin-top:0;">Method</label><select id="choroClassMethod"><option value="equal">Equal interval</option><option value="quantile">Quantile</option></select></div>' +
            '</div>' +
          '</div>' +

          '<label class="field-label">Value range</label>' +
          '<div class="toggle-group">' +
            '<button id="choroZAuto" class="active">Auto</button>' +
            '<button id="choroZCustom">Custom</button>' +
          '</div>' +
          '<div class="num-pair" id="choroZInputs" style="margin-top:8px;display:none;">' +
            '<div><label class="field-label" style="margin-top:0;">Min</label><input type="number" id="choroZMin" step="any"></div>' +
            '<div><label class="field-label" style="margin-top:0;">Max</label><input type="number" id="choroZMax" step="any"></div>' +
          '</div>' +

          '<div class="check-row" style="margin-top:14px;"><input type="checkbox" id="choroReverseScale"><label for="choroReverseScale">Reverse color scale</label></div>' +
          '<label class="field-label">No-data color</label>' +
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
      setGeoStatus("Invalid GeoJSON: a FeatureCollection with a \"features\" array is required.", false);
      return;
    }
    state.choroplethGeoJsonObj = obj;
    setGeoStatus((sourceLabel || "GeoJSON") + " loaded: " + obj.features.length + " features.", true);
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
      if (!txt) { setGeoStatus("Paste GeoJSON text first.", false); return; }
      try {
        var obj = JSON.parse(txt);
        state.choroplethGeoJsonText = txt;
        var key = document.getElementById("choroFeatureIdKey");
        if (!key.value && obj.features && obj.features[0]) key.value = detectNameKey(obj.features[0]);
        state.choroplethFeatureIdKey = key.value;
        applyParsedGeoJson(obj, "GeoJSON dari teks");
      } catch (e) {
        setGeoStatus("Could not parse JSON: " + e.message, false);
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
          setGeoStatus("Could not parse the file: " + e.message, false);
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
      setGeoStatus("Downloading the province sample…", true);
      fetch("https://raw.githubusercontent.com/superpikar/indonesia-geojson/master/indonesia-province-simple.json")
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (obj) {
          textArea.value = JSON.stringify(obj);
          state.choroplethGeoJsonText = textArea.value;
          var key = document.getElementById("choroFeatureIdKey");
          key.value = detectNameKey(obj.features && obj.features[0]);
          state.choroplethFeatureIdKey = key.value;
          applyParsedGeoJson(obj, "Indonesian provinces sample");
        })
        .catch(function (e) {
          setGeoStatus("Could not download the sample (check your connection): " + e.message, false);
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

  // Keep the sidebar section's visibility in sync with the active type.
  var originalSelectChartType = window.selectChartType;
  if (typeof originalSelectChartType === "function") {
    window.selectChartType = function (v) {
      originalSelectChartType(v);
      updateChoroplethSectionVisibility();
    };
  }
})();
