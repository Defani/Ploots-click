// Collapsible sidebar sections (Custom Size/Templates, Axis Range/Tick Marks/Grid Lines, LaTeX/Symbols).
// Pure UI chrome - does not touch any chart state.
(function () {
  function toggleSection(head) {
    var section = head.closest('.side-section');
    if (section) section.classList.toggle('open');
  }
  document.addEventListener('click', function (e) {
    var head = e.target.closest('.side-section-head');
    if (head) toggleSection(head);
  });

  // Sticky title bar for every sidebar panel (replaces a leading <h2> title),
  // with a close button that collapses the sidebar like re-clicking the rail.
  var TITLES = {
    'panel-canvas': 'Canvas', 'panel-chart': 'Chart', 'panel-axis': 'Axis',
    'panel-legend': 'Legend', 'panel-shapes': 'Shapes', 'panel-color': 'Color & style',
    'panel-latex': 'LaTeX & symbols', 'panel-export': 'Export'
  };
  Array.prototype.forEach.call(document.querySelectorAll('.sidebar-panel'), function (panel) {
    var first = panel.firstElementChild;
    if (first && first.tagName === 'H2') first.classList.add('sp-legacy-title');
    var head = document.createElement('div');
    head.className = 'sp-head';
    var title = document.createElement('span');
    title.className = 'sp-title';
    title.textContent = TITLES[panel.id] || (first && first.tagName === 'H2' ? first.textContent.trim() : '');
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'sp-close';
    close.title = 'Close panel';
    close.setAttribute('aria-label', 'Close panel');
    close.innerHTML = '<span class="material-symbols-outlined">keyboard_double_arrow_left</span>';
    close.addEventListener('click', function () { if (window.closeSidebar) window.closeSidebar(); });
    head.appendChild(title);
    head.appendChild(close);
    panel.insertBefore(head, panel.firstChild);

    // A panel of all-collapsed sections looks empty; open the first one.
    var sections = panel.querySelectorAll(':scope > .side-section');
    if (sections.length && !panel.querySelector(':scope > .side-section.open')) sections[0].classList.add('open');
  });
})();
