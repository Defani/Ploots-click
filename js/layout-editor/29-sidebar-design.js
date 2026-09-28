// One sidebar on the left. The Design and Layers panels (25-design-panel.js,
// 21-layers-panel.js) used to float on the right of the canvas; they now live
// in the left sidebar like every other panel, opened from their own rail
// buttons, so all settings are in one place and the canvas keeps its width.
//
// The rail is also grouped by task, and each mode shows only its own menus:
//   Home | Data (charts) or Map (maps) | Canvas, Design, Layers |
//   Chart, Axis, Legend, Style (charts) | Shapes, LaTeX | Export
(function () {
  'use strict';

  var nav = document.querySelector('.sidebar-nav');
  var sidebar = document.querySelector('.sidebar');
  var lp = document.getElementById('layersPanel');
  if (!nav || !sidebar || !lp) return;

  // Host panel for the Design/Layers panel.
  var host = document.createElement('div');
  host.id = 'panel-design';
  host.className = 'sidebar-panel';
  host.innerHTML = '<div class="sp-head"><span class="sp-title">Design</span>' +
    '<button type="button" class="sp-close" title="Close panel" aria-label="Close panel"><span class="material-symbols-outlined">keyboard_double_arrow_left</span></button></div>';
  host.appendChild(lp);
  sidebar.appendChild(host);
  host.querySelector('.sp-close').addEventListener('click', function () { if (window.closeSidebar) window.closeSidebar(); });

  function railButton(id, icon, label) {
    var b = document.createElement('button');
    b.className = 'nav-btn';
    b.id = id;
    b.title = label;
    b.innerHTML = '<span class="material-symbols-outlined">' + icon + '</span><span class="nav-lbl">' + label + '</span>';
    return b;
  }
  var designBtn = railButton('navDesign', 'tune', 'Design');
  var layersBtn = railButton('navLayers', 'stacks', 'Layers');

  function currentPane() { return lp.classList.contains('rp-design') ? 'design' : 'layers'; }
  function isOpen(pane) {
    return host.classList.contains('active') && !sidebar.classList.contains('closed') && currentPane() === pane;
  }
  function open(pane, btn) {
    if (isOpen(pane)) { window.closeSidebar(); return; }
    activateSidebarPanel('panel-design');
    var tab = lp.querySelector('.rp-tab[data-pane="' + pane + '"]');
    if (tab) tab.click();
    host.querySelector('.sp-title').textContent = pane === 'design' ? 'Design' : 'Layers';
    document.querySelectorAll('.sidebar-nav .nav-btn').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
  }
  designBtn.addEventListener('click', function () { open('design', designBtn); });
  layersBtn.addEventListener('click', function () { open('layers', layersBtn); });

  // Other rail buttons clear ours (activateSidebarPanel only knows data-panel).
  nav.addEventListener('click', function (e) {
    var b = e.target.closest('.nav-btn');
    if (b && b !== designBtn && b !== layersBtn) { designBtn.classList.remove('active'); layersBtn.classList.remove('active'); }
  }, true);

  // Regroup the rail.
  function sep() { var s = document.createElement('div'); s.className = 'nav-sep'; return s; }
  function btn(panel) { return nav.querySelector('.nav-btn[data-panel="' + panel + '"]'); }
  var canvas = btn('panel-canvas'), chart = btn('panel-chart'), axis = btn('panel-axis'), legend = btn('panel-legend');
  var style = btn('panel-color'), shapes = btn('panel-shapes'), latex = btn('panel-latex');
  if (canvas) {
    canvas.after(designBtn);
    designBtn.after(layersBtn);
    var s1 = sep(); s1.classList.add('nav-sep-chart'); layersBtn.after(s1);
    var chain = [chart, axis, legend, style].filter(Boolean), prev = s1;
    chain.forEach(function (b) { prev.after(b); prev = b; });
    var s2 = sep(); prev.after(s2);
    if (shapes) { s2.after(shapes); if (latex) shapes.after(latex); }
  }
})();
