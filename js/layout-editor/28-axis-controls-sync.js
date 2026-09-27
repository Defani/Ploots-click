// The Axis tab has three sets of controls writing the same state: the
// per-axis "Format Axis" panel (22-axis-format-panel.js), the older Axis
// Range / Tick Marks / Grid Lines sections (09-event-wiring.js) and the
// "Quick adjust" sliders (19-axis-tick-float.js). None of them updated the
// others, so after using one the rest showed stale values (and undo left all
// of them stale). Every edit ends in render(), so resync everything from
// state after each render.
(function () {

  function $(id) { return document.getElementById(id); }
  function focused(el) { return el && el === document.activeElement; }
  function val(el, v) { if (el && !focused(el)) el.value = v == null ? '' : v; }
  function checked(el, v) { if (el) el.checked = !!v; }
  function active(el, on) { if (el) el.classList.toggle('active', !!on); }
  function shown(el, on, display) { if (el) el.style.display = on ? (display || 'block') : 'none'; }

  function syncLegacy(p) {
    var rangeMode = state[p + 'AxisRangeMode'] || 'auto';
    active($(p + 'RangeAuto'), rangeMode === 'auto');
    active($(p + 'RangeCustom'), rangeMode === 'custom');
    shown($(p + 'RangeInputs'), rangeMode === 'custom', 'flex');
    val($(p + 'RangeMin'), state[p + 'AxisMin']);
    val($(p + 'RangeMax'), state[p + 'AxisMax']);

    var tickMode = state[p + 'AxisTickMode'] || 'auto';
    active($(p + 'TickAuto'), tickMode === 'auto');
    active($(p + 'TickCustom'), tickMode === 'custom');
    shown($(p + 'TickInputs'), tickMode === 'custom', 'flex');
    val($(p + 'TickStep'), state[p + 'AxisTickStep']);

    var ticksShow = state[p + 'AxisTicksShow'] !== false;
    checked($(p + 'TicksShow'), ticksShow);
    shown($(p + 'TicksSettings'), ticksShow);
    var pos = state[p + 'AxisTicksPosition'] || 'outside';
    active($(p + 'TicksPosOutside'), pos === 'outside');
    active($(p + 'TicksPosInside'), pos === 'inside');
    val($(p + 'TicksLength'), isFinite(state[p + 'AxisTicksLength']) ? state[p + 'AxisTicksLength'] : 6);

    var minorShow = state[p + 'AxisMinorTicksShow'] !== false;
    checked($(p + 'MinorTicksShow'), minorShow);
    shown($(p + 'MinorTicksSettings'), minorShow);
    var minorMode = state[p + 'AxisMinorTicksMode'] || 'auto';
    ['Auto', 'Divide', 'Manual'].forEach(function (m) { active($(p + 'MinorMode' + m), m.toLowerCase() === minorMode); });
    shown($(p + 'MinorDivideInputs'), minorMode === 'divide', 'flex');
    shown($(p + 'MinorManualInputs'), minorMode === 'manual', 'flex');
    val($(p + 'MinorDivideCount'), state[p + 'AxisMinorTicksDivide']);
    val($(p + 'MinorStep'), state[p + 'AxisMinorTicksStep']);

    checked($(p + 'GridShow'), state[p + 'AxisGridShow']);
    checked($(p + 'MinorGridShow'), state[p + 'AxisMinorGridShow']);
  }

  // Rebuild the Format Axis panel for its current axis, keeping which
  // sections are expanded. Skipped while the user is typing in it.
  function syncFormatPanel() {
    var panel = $('axisFormatPanel');
    if (!panel || typeof axisFormatBuildHtml !== 'function' || !axisFormatCurrentPrefix) return;
    if (panel.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') return;
    var open = {};
    Array.prototype.forEach.call(panel.querySelectorAll('.side-section'), function (s) {
      open[s.getAttribute('data-section')] = s.classList.contains('open');
    });
    panel.innerHTML = axisFormatBuildHtml(axisFormatCurrentPrefix);
    Array.prototype.forEach.call(panel.querySelectorAll('.side-section'), function (s) {
      var id = s.getAttribute('data-section');
      if (id in open) s.classList.toggle('open', open[id]);
    });
  }

  function syncAxisControls() {
    if (typeof state === 'undefined') return;
    syncLegacy('x');
    syncLegacy('y');
    syncFormatPanel();
    if (typeof syncAxisTickFloat === 'function') syncAxisTickFloat();
  }
  window.syncAxisControls = syncAxisControls;

  var baseRender = window.render;
  if (typeof baseRender === 'function') {
    window.render = function () {
      var r = baseRender.apply(this, arguments);
      syncAxisControls();
      return r;
    };
  }
})();
