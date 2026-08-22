// Contextual quick controls in the top header format bar, shown when a chart
// is selected on canvas. Mirrors + stays in sync with the equivalent sidebar
// controls, so the most-used settings for the current chart type don't
// require opening the sidebar.
(function () {

  var ORIENT_TYPES = ['bar-single', 'bar-group', 'bar-stack', 'waterfall'];
  var ERROR_BAR_TYPES = ['bar-single', 'bar-group', 'bar-stack', 'line', 'area', 'scatter'];

  function syncChartQuickBar() {
    if (typeof state === 'undefined') return;
    var t = state.chartType;
    var showOrient = ORIENT_TYPES.indexOf(t) !== -1;
    var showErrorBar = ERROR_BAR_TYPES.indexOf(t) !== -1;
    var showStackedPct = t === 'bar-stack';

    var orientSep = document.getElementById('chartOrientSep');
    var orientGrp = document.getElementById('chartOrientQuick');
    if (orientSep) orientSep.style.display = showOrient ? '' : 'none';
    if (orientGrp) orientGrp.style.display = showOrient ? 'flex' : 'none';

    var ebSep = document.getElementById('chartErrorBarSep');
    var ebBtn = document.getElementById('chartErrorBarQuick');
    if (ebSep) ebSep.style.display = showErrorBar ? '' : 'none';
    if (ebBtn) ebBtn.style.display = showErrorBar ? 'flex' : 'none';

    var spBtn = document.getElementById('chartStackedPercentQuick');
    if (spBtn) spBtn.style.display = showStackedPct ? 'flex' : 'none';

    var ov = document.getElementById('chartOrientVertQuick');
    var oh = document.getElementById('chartOrientHorizQuick');
    if (ov) ov.classList.toggle('active', state.orientation === 'vertical');
    if (oh) oh.classList.toggle('active', state.orientation === 'horizontal');

    if (ebBtn) ebBtn.classList.toggle('active', !!(state.errorBars && state.errorBars.enabled));
    if (spBtn) spBtn.classList.toggle('active', !!state.stackedPercent);

    var frameBtn = document.getElementById('chartFrameQuick');
    if (frameBtn) frameBtn.classList.toggle('active', !!state.outlineFrame);
    var labelsBtn = document.getElementById('chartLabelsQuick');
    if (labelsBtn) labelsBtn.classList.toggle('active', !!state.showValues);

    var opacitySlider = document.getElementById('chartAreaOpacityQuick');
    if (opacitySlider) {
      opacitySlider.style.display = (t === 'area') ? 'inline-block' : 'none';
      opacitySlider.disabled = state.areaFillMode === 'solid';
      opacitySlider.value = isFinite(state.areaFillOpacity) ? state.areaFillOpacity : 0.5;
    }
  }
  window.syncChartQuickBar = syncChartQuickBar;

  function quickSetOrientation(o) {
    state.orientation = o;
    var vertBtn = document.getElementById('orientVert');
    var horizBtn = document.getElementById('orientHoriz');
    if (vertBtn) vertBtn.classList.toggle('active', o === 'vertical');
    if (horizBtn) horizBtn.classList.toggle('active', o === 'horizontal');
    syncChartQuickBar();
    if (typeof render === 'function') render();
  }

  function quickToggleErrorBars() {
    state.errorBars.enabled = !state.errorBars.enabled;
    var sebCk = document.getElementById('showErrorBars');
    if (sebCk) sebCk.checked = state.errorBars.enabled;
    var ebSettings = document.getElementById('errorBarSettings');
    if (ebSettings) ebSettings.style.display = state.errorBars.enabled ? 'block' : 'none';
    syncChartQuickBar();
    if (typeof render === 'function') render();
  }

  function quickToggleStackedPercent() {
    state.stackedPercent = !state.stackedPercent;
    var stp = document.getElementById('stackedPercent');
    if (stp) stp.checked = state.stackedPercent;
    syncChartQuickBar();
    if (typeof render === 'function') render();
  }

  function quickToggleFrame() {
    state.outlineFrame = !state.outlineFrame;
    var of = document.getElementById('outlineFrame');
    if (of) of.checked = state.outlineFrame;
    syncChartQuickBar();
    if (typeof render === 'function') render();
  }

  function quickToggleLabels() {
    state.showValues = !state.showValues;
    var sv = document.getElementById('showValues');
    if (sv) sv.checked = state.showValues;
    syncChartQuickBar();
    if (typeof render === 'function') render();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var ovq = document.getElementById('chartOrientVertQuick');
    if (ovq) ovq.addEventListener('click', function () { quickSetOrientation('vertical'); });
    var ohq = document.getElementById('chartOrientHorizQuick');
    if (ohq) ohq.addEventListener('click', function () { quickSetOrientation('horizontal'); });

    var ebq = document.getElementById('chartErrorBarQuick');
    if (ebq) ebq.addEventListener('click', quickToggleErrorBars);

    var spq = document.getElementById('chartStackedPercentQuick');
    if (spq) spq.addEventListener('click', quickToggleStackedPercent);

    var frq = document.getElementById('chartFrameQuick');
    if (frq) frq.addEventListener('click', quickToggleFrame);
    var lbq = document.getElementById('chartLabelsQuick');
    if (lbq) lbq.addEventListener('click', quickToggleLabels);

    var aoq = document.getElementById('chartAreaOpacityQuick');
    if (aoq) aoq.addEventListener('input', function () {
      var v = parseFloat(this.value);
      state.areaFillOpacity = isFinite(v) ? v : 0.5;
      var sideSlider = document.getElementById('areaFillOpacity');
      if (sideSlider) sideSlider.value = state.areaFillOpacity;
      if (typeof render === 'function') render();
    });

    // Keep the quick bar in sync if the equivalent sidebar controls are used directly.
    var ov = document.getElementById('orientVert');
    if (ov) ov.addEventListener('click', function () { setTimeout(syncChartQuickBar, 0); });
    var oh = document.getElementById('orientHoriz');
    if (oh) oh.addEventListener('click', function () { setTimeout(syncChartQuickBar, 0); });
    var seb = document.getElementById('showErrorBars');
    if (seb) seb.addEventListener('change', function () { setTimeout(syncChartQuickBar, 0); });
    var stp = document.getElementById('stackedPercent');
    if (stp) stp.addEventListener('change', function () { setTimeout(syncChartQuickBar, 0); });
    var afo = document.getElementById('areaFillOpacity');
    if (afo) afo.addEventListener('input', function () { setTimeout(syncChartQuickBar, 0); });
    var aft = document.getElementById('areaFillTransparent');
    if (aft) aft.addEventListener('click', function () { setTimeout(syncChartQuickBar, 0); });
    var afs = document.getElementById('areaFillSolid');
    if (afs) afs.addEventListener('click', function () { setTimeout(syncChartQuickBar, 0); });
  });
})();
