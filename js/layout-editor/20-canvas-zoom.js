// Bottom-right canvas zoom bar. state.canvasZoom === null means "fit to
// window" (the previous, only, behaviour); a number means the user picked a
// manual zoom level, which syncStageSize() (01-canvas-core.js) now reads.
function syncZoomControl(scale) {
  var pct = Math.round(scale * 100);
  var slider = document.getElementById('czZoomSlider');
  var label = document.getElementById('czZoomPct');
  if (slider && document.activeElement !== slider) {
    slider.value = Math.min(300, Math.max(10, pct));
  }
  if (label) label.textContent = pct + '%';
}
window.syncZoomControl = syncZoomControl;

document.addEventListener('DOMContentLoaded', function () {
  var slider = document.getElementById('czZoomSlider');
  var zoomOut = document.getElementById('czZoomOut');
  var zoomIn = document.getElementById('czZoomIn');
  var pctBtn = document.getElementById('czZoomPct');

  function setZoomPct(pctValue) {
    var clamped = Math.min(300, Math.max(10, pctValue));
    state.canvasZoom = clamped / 100;
    if (typeof syncStageSize === 'function') syncStageSize();
  }
  // Exposed so other modules (e.g. mouse-wheel zoom on the canvas rulers/
  // stage) can reuse the same clamped zoom logic instead of touching
  // state.canvasZoom directly.
  window.setCanvasZoomPct = setZoomPct;
  window.getCanvasZoomPct = function () {
    return slider ? (parseFloat(slider.value) || 100) : Math.round((state.canvasZoom || 1) * 100);
  };

  if (slider) slider.addEventListener('input', function () {
    setZoomPct(parseFloat(this.value) || 100);
  });
  if (zoomOut) zoomOut.addEventListener('click', function () {
    var cur = slider ? (parseFloat(slider.value) || 100) : 100;
    setZoomPct(cur - 10);
  });
  if (zoomIn) zoomIn.addEventListener('click', function () {
    var cur = slider ? (parseFloat(slider.value) || 100) : 100;
    setZoomPct(cur + 10);
  });
  // Clicking the percentage label resets back to "fit to window".
  if (pctBtn) pctBtn.addEventListener('click', function () {
    state.canvasZoom = null;
    if (typeof syncStageSize === 'function') syncStageSize();
  });
});
