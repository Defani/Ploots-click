/* ==========================================================================
   Home screen — the start page: make a chart or a map.

   Shown when the app opens and from the Home button at the top of the
   left rail. "Chart" returns the page to a chart type and opens the Chart
   panel; "Map" switches the chart block to the MapLibre map frame and opens
   the Map panel. Each has a blank and a sample start.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var el = null;

  function build() {
    if (el) return el;
    el = document.createElement("div");
    el.className = "home-screen";
    el.innerHTML =
      '<div class="home-card-wrap">' +
        '<div class="home-head"><h1>Ploots Click</h1><p>What do you want to make?</p></div>' +
        '<div class="home-cards">' +
          '<div class="home-card" data-mode="chart">' +
            '<span class="material-symbols-outlined home-icon">bar_chart</span>' +
            "<h2>Chart</h2><p>Charts from tables: bar, line, scatter, distributions, flows.</p>" +
            '<div class="home-actions"><button data-go="chart-blank">Blank</button><button data-go="chart-sample" class="btn-primary">Sample data</button></div>' +
          "</div>" +
          '<div class="home-card" data-mode="map">' +
            '<span class="material-symbols-outlined home-icon">map</span>' +
            "<h2>Map</h2><p>Spatial data: vector and raster layers, symbology, map layout.</p>" +
            '<div class="home-actions"><button data-go="map-blank">Blank</button><button data-go="map-sample" class="btn-primary">Sample map</button></div>' +
          "</div>" +
          '<div class="home-card" data-mode="agro">' +
            '<span class="material-symbols-outlined home-icon">forest</span>' +
            "<h2>Agroforestry</h2><p>Gayo coffee under lamtoro shade: plant, grow and see the plot in 2D and 3D; SExI-FS data.</p>" +
            '<div class="home-actions"><button data-go="agro" class="btn-primary">Open simulator</button></div>' +
          "</div>" +
        "</div>" +
        '<div class="home-foot"><button type="button" data-files><span class="material-symbols-outlined">folder_open</span>Open from a folder</button>' +
          '<span>Private tool of <b>Defani Arman Alfitriansyah</b></span><button type="button" data-about>About</button></div>' +
        '<button class="home-close" title="Close"><span class="material-symbols-outlined">close</span></button>' +
      "</div>";
    document.body.appendChild(el);
    el.addEventListener("click", function (e) {
      if (e.target === el || e.target.closest(".home-close")) { hide(); return; }
      if (e.target.closest("[data-about]")) { if (window.PlootsIntro) window.PlootsIntro.about(); return; }
      if (e.target.closest("[data-files]")) { hide(); activateSidebarPanel("panel-files"); return; }
      var b = e.target.closest("[data-go]");
      if (b) go(b.dataset.go);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && el.classList.contains("show")) hide(); });
    return el;
  }

  function show() { build().classList.add("show"); }
  function hide() { if (el) el.classList.remove("show"); }

  function go(what) {
    hide();
    if (what === "agro") { if (window.PlootsAgro) window.PlootsAgro.open(); return; }
    if (what.indexOf("chart") === 0) {
      if (state.chartType === GIS.TYPE) selectChartType("bar-group");
      if (what === "chart-sample") { var s = document.getElementById("loadSampleBtn"); if (s) s.click(); }
      activateSidebarPanel("panel-chart");
      return;
    }
    GIS.enterMapMode();
    activateSidebarPanel("panel-map");
    if (what === "map-sample" && !GIS.layers.length) GIS.loadSampleLayer();
  }

  function addNavButton() {
    var nav = document.querySelector(".sidebar-nav");
    if (!nav || nav.querySelector(".nav-home")) return;
    var b = document.createElement("button");
    b.className = "nav-btn nav-home";
    b.title = "Home";
    b.innerHTML = '<span class="material-symbols-outlined">home</span><span class="nav-lbl">Home</span>';
    b.addEventListener("click", show);
    nav.insertBefore(b, nav.firstChild);
  }

  function init() { addNavButton(); show(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  window.PlootsHome = { show: show, hide: hide };
})();
