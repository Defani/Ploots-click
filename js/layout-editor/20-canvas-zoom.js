// Canvas zoom: the floating zoom pill (bottom-right), keyboard shortcuts and
// the anchor-preserving zoom used by Ctrl/pinch-wheel in canvas_ruler.js.
// state.canvasZoom === null means "fit to window"; a number is a manual zoom
// level, which syncStageSize() (01-canvas-core.js) reads.
var ZOOM_LEVELS = [10, 25, 33, 50, 67, 75, 100, 125, 150, 200, 250, 300];
var ZOOM_MIN = 10, ZOOM_MAX = 300;
var canvasScaleNow = 1; // the scale syncStageSize() actually applied

function syncZoomControl(scale) {
  canvasScaleNow = scale;
  var pct = Math.round(scale * 100);
  var slider = document.getElementById('czZoomSlider');
  var label = document.getElementById('czZoomPct');
  if (slider && document.activeElement !== slider) slider.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pct));
  if (slider) slider.style.setProperty('--cz-fill', ((Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pct)) - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN) * 100) + '%');
  if (label) label.textContent = pct + '%';
  var fitItem = document.getElementById('czFit');
  if (fitItem) fitItem.classList.toggle('active', state.canvasZoom == null);
}
window.syncZoomControl = syncZoomControl;

// Zoom to `pct`, keeping the page point under (clientX, clientY) fixed on
// screen. Without a point, the center of the visible canvas area is used.
function setCanvasZoom(pct, clientX, clientY) {
  var scroller = document.getElementById('canvasScroll');
  var wrapper = document.getElementById('canvasStageWrapper');
  var next = pct == null ? null : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pct)) / 100;
  if (!scroller || !wrapper) {
    state.canvasZoom = next;
    if (typeof syncStageSize === 'function') syncStageSize();
    return;
  }
  var sr = scroller.getBoundingClientRect();
  if (clientX == null) { clientX = sr.left + sr.width / 2; clientY = sr.top + sr.height / 2; }
  var before = wrapper.getBoundingClientRect();
  var u = (clientX - before.left) / canvasScaleNow; // page coordinates under the anchor
  var v = (clientY - before.top) / canvasScaleNow;
  state.canvasZoom = next;
  if (typeof syncStageSize === 'function') syncStageSize();
  var after = wrapper.getBoundingClientRect();
  scroller.scrollLeft += after.left + u * canvasScaleNow - clientX;
  scroller.scrollTop += after.top + v * canvasScaleNow - clientY;
  if (typeof syncPanScrollbars === 'function') syncPanScrollbars();
}
window.setCanvasZoom = setCanvasZoom;

// Kept for older callers: percentage in, current percentage out.
window.setCanvasZoomPct = function (pct, clientX, clientY) { setCanvasZoom(pct, clientX, clientY); };
// Unrounded, so many tiny pinch steps accumulate instead of rounding away.
window.getCanvasZoomPct = function () { return canvasScaleNow * 100; };

function zoomStep(dir) {
  var cur = Math.round(canvasScaleNow * 100);
  var target = dir > 0
    ? ZOOM_LEVELS.filter(function (z) { return z > cur + 0.5; })[0]
    : ZOOM_LEVELS.filter(function (z) { return z < cur - 0.5; }).pop();
  setCanvasZoom(target == null ? (dir > 0 ? ZOOM_MAX : ZOOM_MIN) : target);
}

document.addEventListener('DOMContentLoaded', function () {
  var slider = document.getElementById('czZoomSlider');
  var zoomOut = document.getElementById('czZoomOut');
  var zoomIn = document.getElementById('czZoomIn');
  var pctBtn = document.getElementById('czZoomPct');
  var menu = document.getElementById('czMenu');

  if (slider) slider.addEventListener('input', function () { setCanvasZoom(parseFloat(this.value) || 100); });
  if (zoomOut) zoomOut.addEventListener('click', function () { zoomStep(-1); });
  if (zoomIn) zoomIn.addEventListener('click', function () { zoomStep(1); });

  function closeMenu() {
    if (!menu) return;
    menu.classList.remove('open');
    if (pctBtn) pctBtn.setAttribute('aria-expanded', 'false');
  }
  if (pctBtn && menu) {
    pctBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !menu.classList.contains('open');
      menu.classList.toggle('open', open);
      pctBtn.setAttribute('aria-expanded', String(open));
    });
    menu.addEventListener('click', function (e) {
      var item = e.target.closest('[data-zoom]');
      if (!item) return;
      var z = item.getAttribute('data-zoom');
      if (z === 'fit') setCanvasZoom(null);
      else if (z === 'in') zoomStep(1);
      else if (z === 'out') zoomStep(-1);
      else setCanvasZoom(parseFloat(z));
      closeMenu();
    });
    document.addEventListener('mousedown', function (e) {
      if (!menu.contains(e.target) && e.target !== pctBtn && !pctBtn.contains(e.target)) closeMenu();
    });
  }

  // Figma-style shortcuts, only while the layout editor is showing and the
  // user isn't typing. Ctrl/Cmd +/-/0 would otherwise zoom the whole page.
  document.addEventListener('keydown', function (e) {
    var pane = document.getElementById('paneLayout');
    if (!pane || !pane.classList.contains('active')) return;
    var t = e.target;
    if (t && t.closest && t.closest('input,textarea,select,[contenteditable]')) return;
    if (typeof fabricCanvas !== 'undefined' && fabricCanvas) {
      var a = fabricCanvas.getActiveObject();
      if (a && a.isEditing) return;
    }
    if (e.key === 'Escape') closeMenu();
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomStep(1); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomStep(-1); }
      else if (e.key === '0') { e.preventDefault(); setCanvasZoom(100); }
    } else if (e.shiftKey && (e.key === '!' || e.code === 'Digit1')) {
      e.preventDefault();
      setCanvasZoom(null);
    }
  });
});
