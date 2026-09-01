// "Axis Tick Line" quick-adjust block, docked at the bottom of the left
// sidebar's Format Axis tab (panel-axis) — no longer a floating popup over
// the canvas on chart click. Two shared sliders: line thickness and tick
// length, each applying to X and Y together (the fine-grained per-axis
// controls, if a user really wants asymmetric axes, live in the Format Axis
// panel above it — this quick block is just the common "adjust both at
// once" shortcut).
function syncAxisTickFloat() {
  if (typeof state === 'undefined') return;
  var w = isFinite(state.xAxisTickWidth) ? state.xAxisTickWidth
    : (isFinite(state.yAxisTickWidth) ? state.yAxisTickWidth : (state.axisLineWidth || 1.2));
  var len = isFinite(state.xAxisTicksLength) ? state.xAxisTicksLength
    : (isFinite(state.yAxisTicksLength) ? state.yAxisTicksLength : 6);
  var ws = document.getElementById('tickWidthFloat');
  var wv = document.getElementById('tickWidthFloatVal');
  var ls = document.getElementById('tickLengthFloat');
  var lv = document.getElementById('tickLengthFloatVal');
  if (ws) ws.value = w;
  if (wv) wv.textContent = (Math.round(w * 10) / 10) + 'px';
  if (ls) ls.value = len;
  if (lv) lv.textContent = Math.round(len) + 'px';
}
window.syncAxisTickFloat = syncAxisTickFloat;

document.addEventListener('DOMContentLoaded', function () {
  var ws = document.getElementById('tickWidthFloat');
  var ls = document.getElementById('tickLengthFloat');
  if (ws) ws.addEventListener('input', function () {
    var v = parseFloat(this.value);
    isFinite(v) || (v = 1.6);
    state.xAxisTickWidth = v;
    state.yAxisTickWidth = v;
    syncAxisTickFloat();
    if (typeof render === 'function') render();
  });
  if (ls) ls.addEventListener('input', function () {
    var v = parseFloat(this.value);
    isFinite(v) || (v = 6);
    state.xAxisTicksLength = v;
    state.yAxisTicksLength = v;
    syncAxisTickFloat();
    if (typeof render === 'function') render();
  });

  // Docked panel is always in the DOM now (no more show/hide on chart
  // click), so populate it once up front instead of waiting for a chart
  // selection event.
  syncAxisTickFloat();
});

// --- Shared floating-popover positioner -----------------------------------
// Header popovers (draw tool options, chart "Display" options) live inside
// .topbar-center, which needs overflow-x:auto for its scroll-fade behaviour.
// That forces overflow-y to auto/hidden too, so any absolutely-positioned
// popover taller than the header was getting clipped/cut off ("tata letak
// head" bug). Fix: position them with `position:fixed`, computed here from
// the trigger button's live position, so they render above the clipping
// ancestor instead of being cut off by it.
function positionFloatingPopover(anchorEl, popoverEl) {
  if (!anchorEl || !popoverEl) return;
  var rect = anchorEl.getBoundingClientRect();
  popoverEl.style.left = Math.round(rect.left) + 'px';
  popoverEl.style.top = Math.round(rect.bottom + 8) + 'px';
  var pw = popoverEl.offsetWidth || 250;
  var maxLeft = window.innerWidth - pw - 8;
  if (rect.left > maxLeft) popoverEl.style.left = Math.max(8, maxLeft) + 'px';
  var ph = popoverEl.offsetHeight || 0;
  if (ph && rect.bottom + 8 + ph > window.innerHeight) {
    popoverEl.style.top = Math.max(8, window.innerHeight - ph - 8) + 'px';
  }
}
window.positionFloatingPopover = positionFloatingPopover;
