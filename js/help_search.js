// Menu search / help panel (right side) - like RStudio's Help pane search:
// type a keyword, get a short explanation of the matching menu + a button
// that jumps straight to it in the left sidebar. Pure UI chrome, does not
// touch chart state.
(function () {
  var HELP_INDEX = [
    { title: 'Canvas size', panel: 'panel-canvas', section: 'canvas-size', icon: 'aspect_ratio',
      desc: 'Set the page width and height in px, mm or cm.',
      kw: 'size resolution page width height px mm cm canvas custom' },
    { title: 'Page templates', panel: 'panel-canvas', section: 'canvas-templates', icon: 'grid_view',
      desc: 'Ready-made page sizes: A4, Letter, Legal, slides, social media.',
      kw: 'template preset size a4 letter slide' },
    { title: 'Canvas color', panel: 'panel-canvas', section: 'canvas-color', icon: 'format_color_fill',
      desc: 'Page background color, including transparent for PNG export.',
      kw: 'color background canvas transparent' },
    { title: 'Chart type', panel: 'panel-chart', section: 'chart-type', icon: 'bar_chart',
      desc: 'Switch the chart type (bar, line, pie, ...) and set bar spacing.',
      kw: 'chart type graph bar line pie spacing' },
    { title: 'Orientation', panel: 'panel-chart', section: 'orientation', icon: 'swap_horiz',
      desc: 'Vertical or horizontal chart.',
      kw: 'orientation horizontal vertical' },
    { title: 'Error bars', panel: 'panel-chart', section: 'error-bars', icon: 'linear_scale',
      desc: 'Percent or fixed error bars: cap length, thickness and color.',
      kw: 'error bar errorbar margin' },
    { title: 'Line & scatter style', panel: 'panel-chart', section: 'line-scatter-style', icon: 'show_chart',
      desc: 'Line shape, markers, line width and area fill for line, area and scatter charts.',
      kw: 'line marker width area fill scatter point dash' },
    { title: 'Axis range', panel: 'panel-axis', section: 'axis-range', icon: 'straighten',
      desc: 'Minimum, maximum and tick interval of the X and Y axes, automatic or fixed.',
      kw: 'range axis min max interval tick step' },
    { title: 'Tick marks', panel: 'panel-axis', section: 'tick-marks', icon: 'dashboard',
      desc: 'Major and minor ticks on X/Y: show or hide, inside or outside, length.',
      kw: 'tick minor major position length' },
    { title: 'Grid lines', panel: 'panel-axis', section: 'grid-lines', icon: 'grid_4x4',
      desc: 'Major and minor grid lines on the X and Y axes.',
      kw: 'grid line major minor' },
    { title: 'Axis labels', panel: 'panel-axis', section: 'axis-labels', icon: 'title',
      desc: 'X/Y axis titles, body font, font size and wrapping of long labels.',
      kw: 'axis title label font wrap' },
    { title: 'Legend', panel: 'panel-legend', section: 'legend-settings', icon: 'format_list_bulleted',
      desc: 'Show or hide the legend: position, title, font size, columns and border.',
      kw: 'legend key position columns border' },
    { title: 'Visual style', panel: 'panel-color', section: 'visual-style', icon: 'style',
      desc: 'Tell series apart by color, pattern, or both.',
      kw: 'color pattern visual style hatch' },
    { title: 'Series', panel: 'panel-color', section: 'series', icon: 'format_list_bulleted',
      desc: 'Name, color and visibility of each data series.',
      kw: 'series data color name show hide' },
    { title: 'Color palette', panel: 'panel-color', section: 'color-palette', icon: 'palette',
      desc: 'Search and pick a color palette for the whole chart.',
      kw: 'palette color scheme search' },
    { title: 'Shapes', panel: 'panel-shapes', section: null, icon: 'shapes',
      desc: 'Add basic shapes, lines and arrows, stars or symbols to the page.',
      kw: 'shape line arrow star symbol rectangle circle' },
    { title: 'LaTeX editor', panel: 'panel-latex', section: 'latex-editor', icon: 'functions',
      desc: 'Type a LaTeX formula and place it on the page.',
      kw: 'latex formula math equation editor' },
    { title: 'Symbol catalog', panel: 'panel-latex', section: 'symbol-catalog', icon: 'category',
      desc: 'Insert math symbols (Greek letters, operators, units) into formulas or text.',
      kw: 'symbol catalog greek math operator unit' },
    { title: 'Export', panel: 'panel-export', section: null, icon: 'file_save',
      desc: 'Save as PNG, JPG, SVG or PDF with DPI, file name and background.',
      kw: 'export save download png jpg svg pdf dpi resolution file name' },
    { title: 'Data View', navBtnId: 'navDataToggle', panel: null, section: null, icon: 'database',
      desc: 'Spreadsheet view of the chart data: import, edit, statistics.',
      kw: 'data view table spreadsheet import excel csv edit statistics' },
    { title: 'Map layers', panel: 'panel-map', section: 'gisLayers', icon: 'layers',
      desc: 'Add vector (GeoJSON), raster (GeoTIFF) and XYZ tile layers; order, hide, rename.',
      kw: 'map gis layer vector raster geojson geotiff xyz tiles spatial' },
    { title: 'Symbology', panel: 'panel-map', section: 'gisStyle', icon: 'palette',
      desc: 'Single, categorized or graduated colors, labels, stroke and opacity.',
      kw: 'map symbology categorized graduated jenks quantile classes ramp label template halo proportional symbols circles heatmap density' },
    { title: 'Basemap', panel: 'panel-map', section: 'gisBasemapSec', icon: 'map',
      desc: 'OpenFreeMap, OpenStreetMap, CARTO, Esri imagery and more.',
      kw: 'map basemap background tiles satellite imagery openstreetmap' },
    { title: 'Map view', panel: 'panel-map', section: 'gisView', icon: 'explore',
      desc: 'Scale 1:n, rotation, lock, and moving the map content.',
      kw: 'map scale rotation lock pan zoom extent move content' },
    { title: 'Map grid', panel: 'panel-map', section: 'gisGrid', icon: 'grid_4x4',
      desc: 'Coordinate grid (graticule) with frame labels.',
      kw: 'map grid graticule coordinates latitude longitude dms utm meters easting northing outside frame' },
    { title: 'Layout items', panel: 'panel-map', section: 'gisItemsSec', icon: 'dashboard_customize',
      desc: 'Legend, scale bar, north arrow, inset map and color bar as movable page items.',
      kw: 'map legend scale bar north arrow inset overview layout color bar colorbar colormap extend' },
    { title: 'Data catalog', panel: 'panel-catalog', section: null, icon: 'travel_explore',
      desc: 'Government (Kemenhut/KLHK, BNPB, BIG) and GFW layers, GBIF and iNaturalist species records.',
      kw: 'catalog data gfw global forest watch klhk kemenhut kehutanan bnpb big government gbif inaturalist species occurrence download' },
    { title: 'Attribute table', panel: 'panel-map', section: 'gisLayers', icon: 'table',
      desc: 'View, edit, select and export features of a vector layer.',
      kw: 'attribute table features select edit export csv geojson' },
    { title: 'Layer menu', panel: 'panel-map', section: 'gisLayers', icon: 'more_vert',
      desc: 'Right-click a layer: filter, select by expression, field calculator, legend, properties, duplicate.',
      kw: 'layer menu context right click filter definition query select by expression field calculator properties scale visibility duplicate rename legend feature count' },
    { title: 'KoboToolbox', panel: 'panel-kobo', section: null, icon: 'fact_check',
      run: function () { if (window.PlootsGIS) window.PlootsGIS.enterMapMode(); window.activateSidebarPanel('panel-kobo'); },
      desc: 'Connect a Kobo form; monitoring dashboard with daily recap per enumerator, routes and data.',
      kw: 'kobo kobotoolbox survey form submission enumerator monitoring dashboard recap route daily rekap proxy' },
    { title: 'Files', panel: 'panel-files', section: null, icon: 'folder_open',
      desc: 'Connect folders on this computer and open CSV, Excel, GeoJSON, GeoTIFF and images from them.',
      kw: 'files folder browser open directory csv excel geojson tiff image explorer local disk connect' },
    { title: 'About', panel: null, section: null, icon: 'info',
      desc: 'GIS Consultant Studio, a private tool of Defani Arman Alfitriansyah.',
      kw: 'about version author defani license intro',
      run: function () { if (window.PlootsIntro) window.PlootsIntro.about(); } },
    { title: 'Plugins', panel: 'panel-plugins', section: null, icon: 'extension',
      desc: 'Install, enable and write plugins (.zip, folder or URL).',
      kw: 'plugin plugins add-on addon extension install zip manage new plugin develop api' },
    { title: 'Claude chat', panel: null, section: null, icon: 'smart_toy',
      run: function () { if (window.PlootsGIS) window.PlootsGIS.enterMapMode(); if (window.PlootsBridge) window.PlootsBridge.open(); },
      desc: 'Chat bubble connected to Claude through the geolibre-live MCP bridge.',
      kw: 'claude ai chat assistant bubble mcp bridge geolibre live ask' },
    { title: 'Measure', panel: 'panel-map', section: 'gisView', icon: 'straighten',
      desc: 'Measure line length or area from the Tools menu or the map tool bar.',
      kw: 'measure distance length area perimeter ruler tools zoom extent previous next' }
  ];

  var panelEl, backdropEl, inputEl, listEl;
  var current = HELP_INDEX;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function render(items) {
    if (!items.length) {
      listEl.innerHTML = '<div class="hs-empty">No matching menu.</div>';
      return;
    }
    listEl.innerHTML = items.map(function (it, i) {
      return '' +
        '<div class="hs-item">' +
          '<div class="hs-item-title"><span class="material-symbols-outlined">' + it.icon + '</span>' + escapeHtml(it.title) + '</div>' +
          '<div class="hs-item-desc">' + escapeHtml(it.desc) + '</div>' +
          '<button type="button" class="hs-open-btn" data-idx="' + i + '"><span class="material-symbols-outlined">open_in_new</span>Open</button>' +
        '</div>';
    }).join('');
    listEl._items = items;
  }

  function filterItems(query) {
    query = (query || '').trim().toLowerCase();
    if (!query) return HELP_INDEX;
    var tokens = query.split(/\s+/);
    return HELP_INDEX.filter(function (it) {
      var hay = (it.title + ' ' + it.desc + ' ' + it.kw).toLowerCase();
      return tokens.every(function (t) { return hay.indexOf(t) !== -1; });
    });
  }

  function openPanel() {
    panelEl.classList.add('open');
    backdropEl.classList.add('open');
    inputEl.value = '';
    current = HELP_INDEX;
    render(current);
    setTimeout(function () { inputEl.focus(); }, 220);
  }

  function closePanel() {
    panelEl.classList.remove('open');
    backdropEl.classList.remove('open');
  }

  function jumpTo(entry) {
    closePanel();
    if (entry.run) { entry.run(); return; }
    // The Axis menu now lives docked in the left sidebar (panel-axis), so it
    // uses the same generic activateSidebarPanel path as every other panel.
    if (entry.navBtnId) {
      var btn = document.getElementById(entry.navBtnId);
      if (btn) btn.click();
    } else if (entry.panel) {
      if (typeof window.activateSidebarPanel === 'function') {
        window.activateSidebarPanel(entry.panel);
      } else {
        var navBtn = document.querySelector('.nav-btn[data-panel="' + entry.panel + '"]');
        if (navBtn) navBtn.click();
      }
    }
    if (entry.panel && entry.section) {
      setTimeout(function () {
        var sec = document.querySelector('#' + entry.panel + ' .side-section[data-section="' + entry.section + '"]');
        if (!sec) return;
        sec.classList.add('open');
        sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        sec.classList.add('hs-flash');
        setTimeout(function () { sec.classList.remove('hs-flash'); }, 1500);
      }, 150);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    panelEl = document.getElementById('hsPanel');
    backdropEl = document.getElementById('hsBackdrop');
    inputEl = document.getElementById('hsSearchInput');
    listEl = document.getElementById('hsList');
    if (!panelEl) return;

    var triggerBtn = document.getElementById('helpSearchBtn');
    if (triggerBtn) triggerBtn.addEventListener('click', openPanel);

    var closeBtn = document.getElementById('hsClose');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);
    backdropEl.addEventListener('click', closePanel);

    inputEl.addEventListener('input', function () {
      current = filterItems(inputEl.value);
      render(current);
    });

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.hs-open-btn');
      if (!btn) return;
      var idx = parseInt(btn.getAttribute('data-idx'), 10);
      var entry = (listEl._items || HELP_INDEX)[idx];
      if (entry) jumpTo(entry);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panelEl.classList.contains('open')) closePanel();
    });
  });
})();
