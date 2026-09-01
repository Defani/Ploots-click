// Canvas rulers: only the top (horizontal) and left (vertical) rulers exist.
// Plain drag on a ruler pans the canvas (canvasScroll). Alt+drag on a ruler
// still creates a snap guide, same behavior as before. Mouse wheel over the
// canvas area zooms in/out instead of scrolling.

function rulerPxPerUnit(unit) {
  return unit === 'mm' ? 96 / 25.4 : unit === 'cm' ? 96 / 2.54 : 1;
}

function rulerNiceStep(raw) {
  if (!isFinite(raw) || raw <= 0) return 1;
  var mag = Math.pow(10, Math.floor(Math.log10(raw)));
  var n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

function rulerToken(varName, fallback) {
  var v = getComputedStyle(document.documentElement).getPropertyValue(varName);
  v = (v || '').trim();
  return v || fallback;
}

function rulerPrepCanvas(canvas, w, h) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  var dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

var RULER_THICKNESS = 22;

// vertical: true for the left (vertical) ruler, false for the top (horizontal) one.
function rulerDrawBand(ctx, lengthPx, thicknessPx, originOffset, stageScale, vertical, lineColor, textColor, accentColor, bgColor, unit, pxPerUnit, spanUnits, fmt) {
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, vertical ? thicknessPx : lengthPx, vertical ? lengthPx : thicknessPx);
  ctx.font = '9px Inter, sans-serif';
  ctx.textBaseline = 'alphabetic';

  var pxPerUnitScreen = pxPerUnit * stageScale;
  var step = rulerNiceStep(40 / pxPerUnitScreen);
  var minorStep = step / 5;
  if (minorStep * pxPerUnitScreen < 3) minorStep = step;

  var edgeNear = 0; // near the canvas content
  var edgeFar = thicknessPx;
  var dir = 1;

  var eps = minorStep / 1000;
  for (var u = 0; u <= spanUnits + eps; u += minorStep) {
    var pos = originOffset + u * pxPerUnit * stageScale;
    if (pos < -4 || pos > lengthPx + 4) continue;
    var isMajor = Math.abs(u / step - Math.round(u / step)) < 1e-4;
    var tickLen = isMajor ? 8 : 4;
    var tickEnd = edgeNear + dir * tickLen;

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(edgeNear, Math.round(pos) + 0.5);
      ctx.lineTo(tickEnd, Math.round(pos) + 0.5);
    } else {
      ctx.moveTo(Math.round(pos) + 0.5, edgeNear);
      ctx.lineTo(Math.round(pos) + 0.5, tickEnd);
    }
    ctx.stroke();

    if (isMajor && pos > 10) {
      ctx.fillStyle = textColor;
      var textPos = edgeFar - tickLen - 3;
      if (vertical) {
        ctx.save();
        ctx.translate(textPos, pos - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'right';
        ctx.fillText(fmt(u), 0, 0);
        ctx.restore();
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(fmt(u), pos + 3, textPos);
      }
    }
  }

  // Bounds markers (start/end of the canvas page).
  [0, spanUnits].forEach(function (u) {
    var pos = originOffset + u * pxPerUnit * stageScale;
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(edgeNear, Math.round(pos) + 0.5);
      ctx.lineTo(2, Math.round(pos) + 0.5);
    } else {
      ctx.moveTo(Math.round(pos) + 0.5, edgeNear);
      ctx.lineTo(Math.round(pos) + 0.5, 2);
    }
    ctx.stroke();
  });
}

function updateRulers() {
  var pane = document.getElementById('paneLayout');
  var stage = document.getElementById('canvasStage');
  var rulerTop = document.getElementById('rulerTop');
  var rulerLeft = document.getElementById('rulerLeft');
  var unitLabel = document.getElementById('rulerUnitLabel');
  if (!pane || !stage || !rulerTop || !rulerLeft || !pane.classList.contains('active')) return;

  if (unitLabel) unitLabel.textContent = state.canvasUnit;

  var paneRect = pane.getBoundingClientRect();
  var stageRect = stage.getBoundingClientRect();
  if (paneRect.width === 0 || paneRect.height === 0 || stageRect.width === 0 || stageRect.height === 0) return;

  var stageScale = stageRect.width / state.canvasWidthPx;
  var originX = stageRect.left - paneRect.left - RULER_THICKNESS;
  var originY = stageRect.top - paneRect.top - RULER_THICKNESS;
  var topLength = Math.max(0, paneRect.width - RULER_THICKNESS);
  var leftLength = Math.max(0, paneRect.height - RULER_THICKNESS);

  var lineColor = rulerToken('--line-strong', '#c9c9c9');
  var textColor = rulerToken('--ink-soft', '#8a8a8a');
  var accentColor = rulerToken('--accent', '#2f6360');
  var bgColor = rulerToken('--panel-2', '#f5f5f5');
  var unit = state.canvasUnit;
  var pxPerUnit = rulerPxPerUnit(unit);
  if (pxPerUnit * stageScale <= 0) return;

  var spanXUnits = state.canvasWidthPx / pxPerUnit;
  var spanYUnits = state.canvasHeightPx / pxPerUnit;
  var fmt = function (v) {
    var r = Math.round(v * 100) / 100;
    return Math.abs(r - Math.round(r)) < 1e-6 ? String(Math.round(r)) : String(r);
  };

  rulerDrawBand(rulerPrepCanvas(rulerTop, topLength, RULER_THICKNESS), topLength, RULER_THICKNESS, originX, stageScale, false, lineColor, textColor, accentColor, bgColor, unit, pxPerUnit, spanXUnits, fmt);
  rulerDrawBand(rulerPrepCanvas(rulerLeft, RULER_THICKNESS, leftLength), leftLength, RULER_THICKNESS, originY, stageScale, true, lineColor, textColor, accentColor, bgColor, unit, pxPerUnit, spanYUnits, fmt);
}

function rulerStageLocalPoint(clientX, clientY) {
  var stage = document.getElementById('canvasStage');
  var rect = stage.getBoundingClientRect();
  var scale = rect.width / state.canvasWidthPx || 1;
  return {
    x: (clientX - rect.left) / scale,
    y: (clientY - rect.top) / scale,
    insideX: clientX >= rect.left && clientX <= rect.right,
    insideY: clientY >= rect.top && clientY <= rect.bottom
  };
}

function renderGuides() {
  var stage = document.getElementById('canvasStage');
  if (!stage || !state.guidesH || !state.guidesV) return;
  var old = stage.querySelectorAll('.canvas-guide');
  for (var i = 0; i < old.length; i++) old[i].remove();
  state.guidesH.forEach(function (y, idx) {
    var el = document.createElement('div');
    el.className = 'canvas-guide horiz';
    el.style.top = Math.round(y) + 'px';
    bindGuideDrag(el, 'h', idx);
    stage.appendChild(el);
  });
  state.guidesV.forEach(function (x, idx) {
    var el = document.createElement('div');
    el.className = 'canvas-guide vert';
    el.style.left = Math.round(x) + 'px';
    bindGuideDrag(el, 'v', idx);
    stage.appendChild(el);
  });
}

function bindGuideDrag(el, axis, idx) {
  el.addEventListener('mousedown', function (e) {
    e.stopPropagation();
    e.preventDefault();
    el.classList.add('dragging');
    document.body.style.cursor = axis === 'h' ? 'ns-resize' : 'ew-resize';
    var newPos = null, removing = false;
    function onMove(me) {
      var p = rulerStageLocalPoint(me.clientX, me.clientY);
      if (axis === 'h') {
        removing = !p.insideY;
        newPos = Math.max(0, Math.min(state.canvasHeightPx, p.y));
        el.style.top = Math.round(newPos) + 'px';
      } else {
        removing = !p.insideX;
        newPos = Math.max(0, Math.min(state.canvasWidthPx, p.x));
        el.style.left = Math.round(newPos) + 'px';
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', function () {
      window.removeEventListener('mousemove', onMove);
      document.body.style.cursor = '';
      el.classList.remove('dragging');
      var arr = axis === 'h' ? state.guidesH : state.guidesV;
      if (removing) { arr.splice(idx, 1); renderGuides(); }
      else if (newPos != null) arr[idx] = newPos;
    }, { once: true });
  });
  el.addEventListener('dblclick', function (e) {
    e.stopPropagation();
    (axis === 'h' ? state.guidesH : state.guidesV).splice(idx, 1);
    renderGuides();
  });
}

// Alt+drag from a ruler still creates a new guide (old ruler-drag behavior).
function startRulerGuideDrag(e, axis) {
  e.preventDefault();
  var pane = document.getElementById('paneLayout');
  if (!pane) return;
  var preview = document.createElement('div');
  preview.className = 'ruler-guide-preview ' + (axis === 'h' ? 'horiz' : 'vert');
  pane.appendChild(preview);
  document.body.style.cursor = axis === 'h' ? 'ns-resize' : 'ew-resize';
  place(e.clientX, e.clientY);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', function (up) {
    window.removeEventListener('mousemove', onMove);
    document.body.style.cursor = '';
    preview.remove();
    var p = rulerStageLocalPoint(up.clientX, up.clientY);
    if (axis === 'h' && p.insideX && p.insideY) {
      state.guidesH.push(Math.max(0, Math.min(state.canvasHeightPx, p.y)));
      renderGuides();
    } else if (axis === 'v' && p.insideX && p.insideY) {
      state.guidesV.push(Math.max(0, Math.min(state.canvasWidthPx, p.x)));
      renderGuides();
    }
  }, { once: true });

  function place(clientX, clientY) {
    var paneRect = pane.getBoundingClientRect();
    if (axis === 'h') preview.style.top = (clientY - paneRect.top) + 'px';
    else preview.style.left = (clientX - paneRect.left) + 'px';
  }
  function onMove(me) { place(me.clientX, me.clientY); }
}

// Plain drag on a ruler pans the canvas viewport (scrolls canvasScroll).
function startRulerPan(e, axis, rulerEl) {
  e.preventDefault();
  var scroller = document.getElementById('canvasScroll');
  if (!scroller) return;
  rulerEl.classList.add('ruler-panning');
  var startX = e.clientX, startY = e.clientY;
  var startScrollLeft = scroller.scrollLeft, startScrollTop = scroller.scrollTop;
  function onMove(me) {
    if (axis === 'h') scroller.scrollLeft = startScrollLeft - (me.clientX - startX);
    else scroller.scrollTop = startScrollTop - (me.clientY - startY);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', function () {
    window.removeEventListener('mousemove', onMove);
    rulerEl.classList.remove('ruler-panning');
  }, { once: true });
}

(function () {
  var scroller = document.getElementById('canvasScroll');
  if (scroller) scroller.addEventListener('scroll', function () { updateRulers(); });
  window.addEventListener('resize', function () { updateRulers(); });

  var rulerTop = document.getElementById('rulerTop');
  var rulerLeft = document.getElementById('rulerLeft');
  if (rulerTop) rulerTop.addEventListener('mousedown', function (e) {
    if (e.altKey) startRulerGuideDrag(e, 'h');
    else startRulerPan(e, 'h', rulerTop);
  });
  if (rulerLeft) rulerLeft.addEventListener('mousedown', function (e) {
    if (e.altKey) startRulerGuideDrag(e, 'v');
    else startRulerPan(e, 'v', rulerLeft);
  });

  // Mouse wheel over the canvas area zooms in/out instead of scrolling.
  if (scroller) scroller.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (typeof window.getCanvasZoomPct !== 'function' || typeof window.setCanvasZoomPct !== 'function') return;
    var cur = window.getCanvasZoomPct();
    var step = Math.max(2, Math.round(cur * 0.08));
    window.setCanvasZoomPct(cur + (e.deltaY < 0 ? step : -step));
  }, { passive: false });

  updateRulers();
  if (typeof renderGuides === 'function') renderGuides();
})();
