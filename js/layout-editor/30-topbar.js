// Top bar: labeled tool buttons in groups, instead of a row of bare icons,
// with the most used sidebar actions one click away. The groups follow the
// workspace:
//   always  Undo/Redo · Insert (Text, Shape, Image, Pen, Formula) · Export
//   charts  Chart type ▾ · Data · Palette ▾ · Legend
//   maps    Add layer ▾ · Basemap ▾ · Attributes · Move · Tools ▾ · Grid · Map items ▾
// The existing Text/Shape/Image/Pen/Lock buttons keep their ids and
// handlers; they only gain a label. Menus open in a floating panel on
// <body>, so the scrollable top bar never clips them.
(function () {
  'use strict';

  var bar = document.getElementById('mainTools');
  if (!bar) return;
  var GIS = window.PlootsGIS;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  // Give an existing icon button a label.
  function label(id, text) {
    var b = $(id);
    if (!b || b.querySelector('.tb-lbl')) return;
    b.classList.add('tb-btn');
    b.insertAdjacentHTML('beforeend', '<span class="tb-lbl">' + text + '</span>');
  }
  label('toolAddText', 'Text');
  label('toolAddShape', 'Shape');
  label('toolAddImage', 'Image');
  label('toolDraw', 'Pen');

  function button(icon, text, title, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool-btn tb-btn' + (cls ? ' ' + cls : '');
    b.title = title || text;
    b.innerHTML = '<span class="material-symbols-outlined">' + icon + '</span><span class="tb-lbl">' + text + '</span>';
    return b;
  }
  function group(cls) {
    var g = document.createElement('div');
    g.className = 'tool-group tb-group' + (cls ? ' ' + cls : '');
    return g;
  }

  // Formula joins the Insert group, right after Pen.
  var insertGroup = $('toolAddText').parentNode;
  insertGroup.classList.add('tb-insert');
  var formula = button('function', 'Formula', 'Insert a LaTeX formula');
  formula.addEventListener('click', function () { activateSidebarPanel('panel-latex'); });
  insertGroup.appendChild(formula);

  /* ------------------------------------------------------------ menus */

  var menu = document.createElement('div');
  menu.className = 'tb-menu';
  document.body.appendChild(menu);
  var menuOwner = null;
  function closeMenu() { menu.classList.remove('open'); if (menuOwner) menuOwner.classList.remove('active'); menuOwner = null; }
  function openMenu(btn, html, onClick, wide) {
    if (menuOwner === btn) { closeMenu(); return; }
    closeMenu();
    menu.innerHTML = html;
    menu.classList.toggle('wide', !!wide);
    menu.classList.add('open');
    var r = btn.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.left)) + 'px';
    menu.style.top = (r.bottom + 6) + 'px';
    menuOwner = btn;
    btn.classList.add('active');
    menu.onclick = function (e) {
      var it = e.target.closest('[data-v]');
      if (!it) return;
      closeMenu();
      onClick(it.getAttribute('data-v'));
    };
  }
  document.addEventListener('mousedown', function (e) {
    if (!menu.classList.contains('open')) return;
    if (menu.contains(e.target) || (menuOwner && menuOwner.contains(e.target))) return;
    closeMenu();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('resize', closeMenu);

  function item(v, icon, text, checked, extra) {
    return '<button type="button" class="tb-item' + (checked ? ' checked' : '') + '" data-v="' + esc(v) + '">' +
      (icon || '') + '<span class="tb-item-lbl">' + esc(text) + '</span>' + (extra || '') +
      (checked ? '<span class="material-symbols-outlined tb-check">check</span>' : '') + '</button>';
  }
  function sym(name) { return '<span class="material-symbols-outlined">' + name + '</span>'; }
  function head(text) { return '<div class="tb-menu-head">' + esc(text) + '</div>'; }

  /* ----------------------------------------------------------- charts */

  var chartGroup = group('tb-chart');
  var typeBtn = button('bar_chart', 'Chart type', 'Change the chart type', 'tb-drop');
  var dataBtn = button('database', 'Data', 'Open the Data View');
  var palBtn = button('palette', 'Palette', 'Color palette', 'tb-drop');
  var legendBtn = button('format_list_bulleted', 'Legend', 'Show or hide the legend');
  [typeBtn, dataBtn, palBtn, legendBtn].forEach(function (b) { chartGroup.appendChild(b); });

  typeBtn.addEventListener('click', function () {
    var cats = [], html = '';
    CHART_TYPE_DEFS.forEach(function (d) { if (cats.indexOf(d.category) < 0) cats.push(d.category); });
    cats.forEach(function (c) {
      html += head(c) + '<div class="tb-grid">';
      CHART_TYPE_DEFS.filter(function (d) { return d.category === c; }).forEach(function (d) {
        html += '<button type="button" class="tb-tile' + (d.value === state.chartType ? ' checked' : '') + '" data-v="' + d.value + '">' +
          '<iconify-icon icon="' + d.icon + '"></iconify-icon><span>' + esc(d.label) + '</span></button>';
      });
      html += '</div>';
    });
    openMenu(typeBtn, html, function (v) { selectChartType(v); }, true);
  });
  dataBtn.addEventListener('click', function () { var d = $('navDataToggle'); if (d) d.click(); });
  palBtn.addEventListener('click', function () {
    var html = head('Palettes');
    PALETTES.slice(0, 24).forEach(function (p, i) {
      var strip = '<span class="tb-strip">' + p.colors.slice(0, 8).map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '</span>';
      html += item(i, strip, p.name, i === state.paletteIdx);
    });
    html += '<div class="tb-sep"></div>' + item('more', sym('palette'), 'All palettes…');
    openMenu(palBtn, html, function (v) {
      if (v === 'more') { activateSidebarPanel('panel-color'); return; }
      state.paletteIdx = +v;
      if (typeof reassignPaletteColors === 'function') reassignPaletteColors();
      if (typeof renderSeriesList === 'function') renderSeriesList();
      if (typeof buildPaletteGrid === 'function') buildPaletteGrid();
      render();
    });
  });
  legendBtn.addEventListener('click', function () {
    var cb = $('showLegend');
    if (!cb) return;
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    syncState();
  });

  /* ------------------------------------------------------------- maps */

  var mapGroup = group('tb-map');
  var addBtn = button('add_circle', 'Add layer', 'Add a layer', 'tb-drop');
  var bmBtn = button('map', 'Basemap', 'Basemap', 'tb-drop');
  var attrBtn = button('table', 'Attributes', 'Attribute table');
  var moveBtn = button('open_with', 'Move', 'Move the map content (pan, select, identify)');
  var toolsBtn = button('construction', 'Tools', 'Map tools', 'tb-drop');
  var gridBtn = button('grid_4x4', 'Grid', 'Coordinate grid');
  var itemsBtn = button('dashboard_customize', 'Map items', 'Add a layout item', 'tb-drop');
  var geoBtn = button('hub', 'Geoprocessing', 'Geoprocessing tools and the Processing toolbox', 'tb-drop');
  [addBtn, bmBtn, attrBtn, moveBtn, toolsBtn, geoBtn, gridBtn, itemsBtn].forEach(function (b) { mapGroup.appendChild(b); });
  geoBtn.addEventListener('click', function () { if (GIS.processing) GIS.processing.menu(geoBtn); });
  // Page-only map buttons (hidden in the Analysis view).
  [moveBtn, gridBtn, itemsBtn].forEach(function (b) { b.classList.add('tb-carto'); });

  function mapPanel() { if (GIS && GIS.openLayersPanel) { GIS.openLayersPanel(); return; } if (GIS) GIS.enterMapMode(); activateSidebarPanel('panel-map'); }
  addBtn.addEventListener('click', function () {
    openMenu(addBtn,
      item('vector', sym('polyline'), 'Vector (GeoJSON, TopoJSON)') + item('raster', sym('grid_on'), 'Raster (GeoTIFF)') +
      item('xyz', sym('travel_explore'), 'XYZ tiles') + item('url', sym('link'), 'From URL or text') +
      '<div class="tb-sep"></div>' + item('catalog', sym('travel_explore'), 'Data catalog (GFW, government, GBIF…)') + item('sample', sym('public'), 'Sample layer'),
      function (v) {
        if (v === 'vector' || v === 'raster') { var inp = $(v === 'vector' ? 'gisVectorFile' : 'gisRasterFile'); if (inp) inp.click(); return; }
        if (v === 'sample') { GIS.loadSampleLayer(); return; }
        if (v === 'catalog') { GIS.openCatalog(); return; }
        if (GIS.openAddForm) { GIS.openAddForm(v); return; }
        mapPanel();
        var btn = $(v === 'xyz' ? 'gisXyzBtn' : 'gisUrlBtn'), wrap = $(v === 'xyz' ? 'gisXyzWrap' : 'gisUrlWrap');
        if (btn && wrap && wrap.style.display === 'none') btn.click();
      });
  });
  bmBtn.addEventListener('click', function () {
    if (GIS.basemapGallery) { GIS.basemapGallery.open(bmBtn); return; }
    var html = '', group = null;
    GIS.BASEMAPS.forEach(function (b) {
      if (b.group !== group) { group = b.group; html += head(group); }
      html += item(b.id, sym(b.id === 'none' ? 'block' : b.tiles ? 'satellite_alt' : 'map'), b.label, b.id === state.mapBasemap);
    });
    openMenu(bmBtn, html, function (v) {
      state.mapBasemap = v; render(); if (GIS.refreshBasemap) GIS.refreshBasemap(); if (GIS.refreshPanel) GIS.refreshPanel();
    });
  });
  attrBtn.addEventListener('click', function () {
    if (GIS.attributeTable.isOpen()) GIS.attributeTable.hide();
    else { var l = GIS.active(); GIS.attributeTable.show(l && l.kind === 'vector' ? l.id : null); }
    setTimeout(syncState, 50);
  });
  moveBtn.addEventListener('click', function () { if (GIS.mapActions) GIS.mapActions.setInteractive(!GIS.mapActions.isInteractive()); });
  toolsBtn.addEventListener('click', function () {
    var A = GIS.mapActions, on = A && A.isInteractive(), cur = on ? A.tool() : '';
    var l = GIS.active(), vec = l && l.kind === 'vector';
    function t(v, icon, text) { return item('tool:' + v, sym(icon), text, cur === v); }
    openMenu(toolsBtn,
      head('Navigate') + t('pan', 'pan_tool', 'Pan') + t('identify', 'info', 'Identify features') +
      item('full', sym('fit_screen'), 'Zoom full') + item('layer', sym('zoom_in_map'), 'Zoom to layer') +
      head('Select') + t('select', 'arrow_selector_tool', 'Select features') + item('expr', sym('rule'), 'Select by expression…') + item('clear', sym('deselect'), 'Clear selection') +
      head('Measure') + t('measure', 'straighten', 'Measure line') + t('area', 'square_foot', 'Measure area') +
      head('Layer') + item('filter', sym('filter_alt'), 'Filter…') + item('calc', sym('calculate'), 'Field calculator…') + item('props', sym('tune'), 'Layer properties…'),
      function (v) {
        if (!A) return;
        if (v.indexOf('tool:') === 0) { A.setInteractive(true); A.setTool(v.slice(5)); return; }
        if (v === 'full') A.fitAll();
        else if (v === 'layer') A.zoomToLayer(GIS.active());
        else if (v === 'clear') A.clearSelection();
        else if (!l) return;
        else if (v === 'props') GIS.layerProperties(l);
        else if (!vec) return;
        else if (v === 'expr') GIS.exprDialog(l, 'select');
        else if (v === 'filter') GIS.exprDialog(l, 'filter');
        else if (v === 'calc') GIS.fieldCalculator(l);
      });
  });
  gridBtn.addEventListener('click', function () {
    state.mapGrid = !state.mapGrid;
    render();
    if (GIS.refreshPanel) GIS.refreshPanel();
    syncState();
  });
  itemsBtn.addEventListener('click', function () {
    openMenu(itemsBtn,
      item('legend', sym('format_list_bulleted'), 'Legend') + item('scalebar', sym('straighten'), 'Scale bar') +
      item('north', sym('navigation'), 'North arrow') + item('inset', sym('picture_in_picture'), 'Inset map') +
      item('colorbar', sym('gradient'), 'Color bar'),
      function (v) { GIS.items.add(v); });
  });

  /* ------------------------------------------------------------ place */

  var anchor = insertGroup.nextElementSibling; // the Lock group
  bar.insertBefore(chartGroup, anchor);
  bar.insertBefore(mapGroup, anchor);

  // Export: a primary button at the right end of the top bar.
  var right = document.querySelector('.topbar-right');
  var exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'btn-primary tb-export';
  exportBtn.title = 'Export';
  exportBtn.innerHTML = '<span class="material-symbols-outlined">ios_share</span>Export';
  exportBtn.addEventListener('click', function () { activateSidebarPanel('panel-export'); });
  if (right) right.insertBefore(exportBtn, right.firstChild);

  // Toggle states follow the app.
  function syncState() {
    legendBtn.classList.toggle('on', !!state.showLegend);
    gridBtn.classList.toggle('on', !!state.mapGrid);
    attrBtn.classList.toggle('on', !!(GIS && GIS.attributeTable && GIS.attributeTable.isOpen()));
    moveBtn.classList.toggle('on', !!(GIS && GIS.mapActions && GIS.mapActions.isInteractive()));
    var def = typeof CHART_TYPE_DEFS !== 'undefined' && CHART_TYPE_DEFS.filter(function (d) { return d.value === state.chartType; })[0];
    typeBtn.querySelector('.tb-lbl').textContent = def ? def.label.replace(/ \(.*\)$/, '') : 'Chart type';
  }
  if (GIS) { GIS.on('*', function () { syncState(); }); }
  var sel = window.selectChartType;
  window.selectChartType = function (v) { sel.apply(this, arguments); syncState(); };
  syncState();
})();
