// Click directly on an axis (its line or its tick labels) in the rendered
// chart to open a WPS/Excel-style "Format Axis" panel scoped to just that
// axis: Axis Options, Tick Marks, Labels, Number, Fill & Line.
//
// Two hooks are consumed by render() (js/chart-builder/07-render.js), which
// already calls them defensively if defined:
//   - applyAxisLegendStyle(layout, traces)  -> before Plotly.newPlot
//   - bindAxisLegendInteractions()          -> after the chart re-renders
//
// Number-format presets intentionally mirror the existing "value label"
// format select (#valueFormatSelect / formatValue()) so the same mental
// model applies to axis tick labels.

var AXIS_FORMAT_PRESETS = {
  auto: {},
  int: { tickformat: 'd' },
  dec1: { tickformat: '.1f' },
  dec2: { tickformat: '.2f' },
  thousands: { tickformat: ',d' },
  percent: { tickformat: ',.1f', ticksuffix: '%' },
  currency: { tickformat: ',d', tickprefix: 'Rp ' }
};

// true / false for an axis whose trace data is all-numeric / not, or null
// when no trace carries data on that axis (e.g. a histogram's count axis).
function axisDataIsNumeric(traces, prefix) {
  var seen = 0;
  for (var i = 0; i < (traces || []).length; i++) {
    var arr = traces[i] && traces[i][prefix];
    if (!arr || !arr.length) continue;
    for (var j = 0; j < arr.length; j++) {
      var v = arr[j];
      if (v == null || v === '') continue;
      seen++;
      var n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? +v : NaN);
      if (!isFinite(n)) return false;
    }
  }
  return seen ? true : null;
}

// Plotly reads a log axis's range and dtick in log10 units, so a custom
// range of 10–100 used to render as 10^10–10^100. Convert what we can and
// let Plotly pick ticks where a linear step has no log equivalent.
function convertAxisToLog(axis) {
  axis.type = 'log';
  if (Array.isArray(axis.range) && axis.autorange === false) {
    var lo = +axis.range[0], hi = +axis.range[1];
    if (lo > 0 && hi > 0) axis.range = [Math.log10(lo), Math.log10(hi)];
    else { delete axis.range; axis.autorange = true; }
  }
  if (typeof axis.dtick === 'number') {
    delete axis.dtick;
    delete axis.tick0;
    if (axis.tickmode === 'linear') delete axis.tickmode;
  }
  if (axis.minor) { delete axis.minor.dtick; delete axis.minor.tick0; }
  delete axis.rangemode; // "tozero" has no meaning on a log axis
}

function applyAxisLegendStyle(layout, traces) {
  ['x', 'y'].forEach(function (prefix) {
    var axisKey = prefix + 'axis';
    var axis = layout[axisKey];
    if (!axis) return;

    // Log only makes sense on numeric axes; on a category axis it wipes out
    // every label, so leave those alone.
    if (state[prefix + 'AxisLogScale'] && axis.type !== 'category' && axisDataIsNumeric(traces, prefix) !== false) {
      convertAxisToLog(axis);
    }

    var fmt = AXIS_FORMAT_PRESETS[state[prefix + 'AxisNumberFormat']] || AXIS_FORMAT_PRESETS.auto;
    if (fmt.tickformat) axis.tickformat = fmt.tickformat;
    if (fmt.ticksuffix) axis.ticksuffix = fmt.ticksuffix;
    if (fmt.tickprefix) axis.tickprefix = fmt.tickprefix;

    if (state[prefix + 'AxisTickLabelsShow'] === false) axis.showticklabels = false;

    if (state[prefix + 'AxisLineColor']) axis.linecolor = state[prefix + 'AxisLineColor'];
    if (Number.isFinite(state[prefix + 'AxisLineWidth']) && state[prefix + 'AxisLineWidth'] > 0) {
      axis.linewidth = state[prefix + 'AxisLineWidth'];
    }
  });
}

// ---------------------------------------------------------------------
// Panel markup
// ---------------------------------------------------------------------

var axisFormatCurrentPrefix = null;

function axisFormatSectionHtml(id, icon, label, bodyHtml, openByDefault) {
  return '' +
    '<div class="side-section' + (openByDefault ? ' open' : '') + '" data-section="' + id + '">' +
    '  <div class="side-section-head"><span class="ss-lbl"><span class="material-symbols-outlined">' + icon + '</span>' + label + '</span><span class="material-symbols-outlined ss-chev">expand_more</span></div>' +
    '  <div class="side-section-body">' + bodyHtml + '</div>' +
    '</div>';
}

function axisFormatBuildHtml(prefix) {
  var P = prefix; // 'x' or 'y'
  var axisLabel = P.toUpperCase() + '-axis';
  var rangeMode = state[P + 'AxisRangeMode'] || 'auto';
  var log = !!state[P + 'AxisLogScale'];
  var ticksShow = state[P + 'AxisTicksShow'] !== false;
  var minorShow = state[P + 'AxisMinorTicksShow'] !== false;
  var ticksPos = state[P + 'AxisTicksPosition'] || 'outside';
  var ticksLen = Number.isFinite(state[P + 'AxisTicksLength']) ? state[P + 'AxisTicksLength'] : 6;
  var labelsShow = state[P + 'AxisTickLabelsShow'] !== false;
  var numFmt = state[P + 'AxisNumberFormat'] || 'auto';
  var lineColor = state[P + 'AxisLineColor'] || '#1a1a1a';
  var lineWidth = Number.isFinite(state[P + 'AxisLineWidth']) ? state[P + 'AxisLineWidth'] : (state.axisLineWidth || 1);

  var axisOptionsBody =
    '<label class="field-label" style="margin-top:0;">Range</label>' +
    '<div class="toggle-group">' +
    '  <button type="button" class="afp-btn' + (rangeMode === 'auto' ? ' active' : '') + '" data-afp-range="auto">Auto</button>' +
    '  <button type="button" class="afp-btn' + (rangeMode === 'custom' ? ' active' : '') + '" data-afp-range="custom">Custom</button>' +
    '</div>' +
    '<div class="num-pair" style="margin-top:8px;' + (rangeMode === 'custom' ? '' : 'display:none;') + '" id="afpRangeInputs">' +
    '  <div><label class="field-label" style="margin-top:0;">Min</label><input type="number" step="any" id="afpMin" value="' + (state[P + 'AxisMin'] != null ? state[P + 'AxisMin'] : '') + '"></div>' +
    '  <div><label class="field-label" style="margin-top:0;">Max</label><input type="number" step="any" id="afpMax" value="' + (state[P + 'AxisMax'] != null ? state[P + 'AxisMax'] : '') + '"></div>' +
    '</div>' +
    '<div class="check-row" style="margin-top:12px;"><input type="checkbox" id="afpLog"' + (log ? ' checked' : '') + '><label for="afpLog">Logarithmic scale</label></div>';

  var tickMarksBody =
    '<div class="check-row" style="margin-top:0;"><input type="checkbox" id="afpTicksShow"' + (ticksShow ? ' checked' : '') + '><label for="afpTicksShow">Show major ticks</label></div>' +
    '<div class="num-pair" style="margin-top:6px;">' +
    '  <div><label class="field-label" style="margin-top:0;">Position</label>' +
    '    <div class="toggle-group">' +
    '      <button type="button" class="afp-btn' + (ticksPos === 'outside' ? ' active' : '') + '" data-afp-tickpos="outside">Outside</button>' +
    '      <button type="button" class="afp-btn' + (ticksPos === 'inside' ? ' active' : '') + '" data-afp-tickpos="inside">Inside</button>' +
    '    </div>' +
    '  </div>' +
    '  <div><label class="field-label" style="margin-top:0;">Length</label><input type="number" id="afpTickLen" value="' + ticksLen + '" min="1" max="30" step="1"></div>' +
    '</div>' +
    '<div class="check-row" style="margin-top:10px;"><input type="checkbox" id="afpMinorShow"' + (minorShow ? ' checked' : '') + '><label for="afpMinorShow">Show minor ticks</label></div>';

  var labelsBody =
    '<div class="check-row" style="margin-top:0;"><input type="checkbox" id="afpLabelsShow"' + (labelsShow ? ' checked' : '') + '><label for="afpLabelsShow">Show tick labels</label></div>';

  var numberBody =
    '<label class="field-label" style="margin-top:0;">Format</label>' +
    '<select id="afpNumberFormat">' +
    '  <option value="auto"' + (numFmt === 'auto' ? ' selected' : '') + '>Auto</option>' +
    '  <option value="int"' + (numFmt === 'int' ? ' selected' : '') + '>Integer</option>' +
    '  <option value="dec1"' + (numFmt === 'dec1' ? ' selected' : '') + '>1 decimal</option>' +
    '  <option value="dec2"' + (numFmt === 'dec2' ? ' selected' : '') + '>2 decimals</option>' +
    '  <option value="thousands"' + (numFmt === 'thousands' ? ' selected' : '') + '>Thousands (1,234)</option>' +
    '  <option value="percent"' + (numFmt === 'percent' ? ' selected' : '') + '>Percent (12.3%)</option>' +
    '  <option value="currency"' + (numFmt === 'currency' ? ' selected' : '') + '>Currency (Rp)</option>' +
    '</select>';

  var fillLineBody =
    '<label class="field-label" style="margin-top:0;">Line color</label>' +
    '<input type="color" id="afpLineColor" value="' + lineColor + '" style="width:100%; height:34px; padding:2px; border:1px solid var(--line-strong); border-radius:0; cursor:pointer;">' +
    '<label class="field-label">Line width (X + Y)</label>' +
    '<input type="number" id="afpLineWidth" value="' + lineWidth + '" min="0.2" max="10" step="0.2">';

  return '' +
    axisFormatSectionHtml('afp-axis-options', 'straighten', 'Axis Options', axisOptionsBody, true) +
    axisFormatSectionHtml('afp-tick-marks', 'dashboard', 'Tick Marks', tickMarksBody, false) +
    axisFormatSectionHtml('afp-labels', 'label', 'Labels', labelsBody, false) +
    axisFormatSectionHtml('afp-number', 'tag', 'Number', numberBody, false) +
    axisFormatSectionHtml('afp-fill-line', 'palette', 'Fill & Line', fillLineBody, false);
}

// Docked in the left sidebar (panel-axis) — no floating position, no close
// button. Opening it just fills in the content for the given axis and makes
// sure the sidebar tab is the active one.
function openAxisFormatPanel(prefix) {
  var panel = document.getElementById('axisFormatPanel');
  if (!panel) return;
  axisFormatCurrentPrefix = prefix;
  panel.innerHTML = axisFormatBuildHtml(prefix);

  var switchWrap = document.getElementById('afpAxisSwitch');
  if (switchWrap) {
    switchWrap.querySelectorAll('[data-afp-switch]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-afp-switch') === prefix);
    });
  }

  if (typeof activateSidebarPanel === 'function') activateSidebarPanel('panel-axis');
}

// Delegated input handling — the panel body is rebuilt on every open, so a
// single listener attached once to the (stable) container covers all of it.
document.addEventListener('DOMContentLoaded', function () {
  var panel = document.getElementById('axisFormatPanel');
  if (!panel) return;

  panel.addEventListener('click', function (e) {
    var rangeBtn = e.target.closest('[data-afp-range]');
    if (rangeBtn && axisFormatCurrentPrefix) {
      var P = axisFormatCurrentPrefix;
      var mode = rangeBtn.getAttribute('data-afp-range');
      state[P + 'AxisRangeMode'] = mode;
      var inputsWrap = panel.querySelector('#afpRangeInputs');
      panel.querySelectorAll('[data-afp-range]').forEach(function (b) { b.classList.toggle('active', b === rangeBtn); });
      if (inputsWrap) inputsWrap.style.display = mode === 'custom' ? 'flex' : 'none';
      if (mode === 'custom') {
        var minEl = panel.querySelector('#afpMin'), maxEl = panel.querySelector('#afpMax');
        if (minEl && minEl.value !== '') state[P + 'AxisMin'] = parseFloat(minEl.value);
        if (maxEl && maxEl.value !== '') state[P + 'AxisMax'] = parseFloat(maxEl.value);
      }
      if (typeof render === 'function') render();
      return;
    }

    var tickPosBtn = e.target.closest('[data-afp-tickpos]');
    if (tickPosBtn && axisFormatCurrentPrefix) {
      var P2 = axisFormatCurrentPrefix;
      state[P2 + 'AxisTicksPosition'] = tickPosBtn.getAttribute('data-afp-tickpos');
      panel.querySelectorAll('[data-afp-tickpos]').forEach(function (b) { b.classList.toggle('active', b === tickPosBtn); });
      if (typeof render === 'function') render();
      return;
    }
  });

  panel.addEventListener('change', function (e) {
    if (!axisFormatCurrentPrefix) return;
    var P = axisFormatCurrentPrefix;
    var t = e.target;
    if (t.id === 'afpMin' || t.id === 'afpMax') {
      var key = t.id === 'afpMin' ? P + 'AxisMin' : P + 'AxisMax';
      state[key] = t.value === '' ? null : parseFloat(t.value);
    } else if (t.id === 'afpLog') {
      state[P + 'AxisLogScale'] = !!t.checked;
    } else if (t.id === 'afpTicksShow') {
      state[P + 'AxisTicksShow'] = !!t.checked;
    } else if (t.id === 'afpTickLen') {
      state[P + 'AxisTicksLength'] = parseFloat(t.value) || 6;
    } else if (t.id === 'afpMinorShow') {
      state[P + 'AxisMinorTicksShow'] = !!t.checked;
    } else if (t.id === 'afpLabelsShow') {
      state[P + 'AxisTickLabelsShow'] = !!t.checked;
    } else if (t.id === 'afpNumberFormat') {
      state[P + 'AxisNumberFormat'] = t.value;
    } else if (t.id === 'afpLineColor') {
      state[P + 'AxisLineColor'] = t.value;
    } else if (t.id === 'afpLineWidth') {
      if (typeof setAxisLineThickness === 'function') { setAxisLineThickness(t.value, t); return; }
      state[P + 'AxisLineWidth'] = parseFloat(t.value) || null;
    } else {
      return;
    }
    if (typeof render === 'function') render();
  });

  // X-axis / Y-axis switch at the top of the docked panel.
  var switchWrap = document.getElementById('afpAxisSwitch');
  if (switchWrap) {
    switchWrap.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-afp-switch]');
      if (!btn) return;
      openAxisFormatPanel(btn.getAttribute('data-afp-switch'));
    });
  }

  // Pre-fill with the X-axis so the tab isn't empty the first time someone
  // opens it from the sidebar nav (without switching to that tab now).
  axisFormatCurrentPrefix = 'x';
  panel.innerHTML = axisFormatBuildHtml('x');
});

// ---------------------------------------------------------------------
// Click-on-axis detection
// ---------------------------------------------------------------------
//
// The fabric.js overlay (#fabricCanvasWrap) normally sits above the Plotly
// chart and grabs every mousedown for shape selection/dragging. We compute
// the on-screen rectangles occupied by each axis's tick-label strip from
// Plotly's own internal layout (_fullLayout), and — only when a mousedown
// lands in one of those strips — intercept it (capture phase, so fabric
// never sees it) and open the Format Axis panel instead.

var axisFormatInteractionsBound = false;

function axisFormatGetAxisStrips() {
  var gd = document.getElementById('plotlyDiv');
  var pane = document.getElementById('paneLayout');
  if (!gd || !gd._fullLayout || !pane || !pane.classList.contains('active')) return null;
  // Only a live cartesian Plotly plot has clickable axes. Raw-SVG charts
  // (sunburst, radial rings, ridge) and map placeholders replace the div's
  // content, so a leftover _fullLayout must not create phantom axis strips.
  if (!gd.querySelector('.cartesianlayer .xy')) return null;
  var fl = gd._fullLayout;
  var xa = fl.xaxis, ya = fl.yaxis;
  if (!xa || !ya || !xa._length || !ya._length) return null;

  var rect = gd.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  var baseW = fl.width || state.chartRenderedW || rect.width;
  var scale = rect.width / baseW;

  var plotLeft = rect.left + xa._offset * scale;
  var plotRight = plotLeft + xa._length * scale;
  var plotTop = rect.top + ya._offset * scale;
  var plotBottom = plotTop + ya._length * scale;

  return {
    x: { left: plotLeft, right: plotRight, top: plotBottom, bottom: rect.bottom },
    y: { left: rect.left, right: plotLeft, top: plotTop, bottom: plotBottom }
  };
}

function axisFormatPointInStrip(strip, clientX, clientY) {
  return strip && clientX >= strip.left && clientX <= strip.right && clientY >= strip.top && clientY <= strip.bottom;
}

function bindAxisLegendInteractions() {
  if (axisFormatInteractionsBound) return;
  axisFormatInteractionsBound = true;

  document.addEventListener('mousedown', function (e) {
    if (elementsLocked) return;
    if (typeof pen !== 'undefined' && pen.active) return; // the Pen tool owns the canvas
    if (e.target.closest && e.target.closest('#axisFormatPanel')) return;
    // If the chart block is already selected in fabric (resize/move handles
    // visible), let those handles work as normal instead of stealing the
    // click — otherwise a corner handle that overlaps an axis strip would
    // never be grabbable. Click away to deselect, then click the axis again.
    if (typeof fabricCanvas !== 'undefined' && fabricCanvas && chartProxyObj && fabricCanvas.getActiveObject() === chartProxyObj) return;
    var strips = axisFormatGetAxisStrips();
    if (!strips) return;
    var prefix = null;
    if (axisFormatPointInStrip(strips.x, e.clientX, e.clientY)) prefix = 'x';
    else if (axisFormatPointInStrip(strips.y, e.clientX, e.clientY)) prefix = 'y';
    if (!prefix) return;
    e.preventDefault();
    e.stopPropagation();
    openAxisFormatPanel(prefix);
  }, true);
}
