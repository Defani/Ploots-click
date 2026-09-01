// Custom themed pan scrollbars for #canvasScroll (bottom = horizontal,
// right = vertical), replacing the native browser scrollbar (hidden via
// CSS). Pure DOM/scrollLeft-scrollTop plumbing — the actual panning is
// still just the browser scrolling the native overflow:auto container;
// this only supplies the visible track/thumb/arrow UI on top of it.
//
// Re-synced from three places: native scroll (user dragged a thumb, used
// a wheel, or arrow-key scrolled), container resize, and zoom changes
// (syncStageSize() in 01-canvas-core.js calls window.syncPanScrollbars()
// after it resizes the stage wrapper, since that's what changes
// scrollWidth/scrollHeight without necessarily resizing the container).

document.addEventListener('DOMContentLoaded', function () {
  var scroller = document.getElementById('canvasScroll');
  var hWrap = document.getElementById('canvasHScroll');
  var vWrap = document.getElementById('canvasVScroll');
  var hTrack = document.getElementById('chsTrack');
  var hThumb = document.getElementById('chsThumb');
  var vTrack = document.getElementById('cvsTrack');
  var vThumb = document.getElementById('cvsThumb');
  var hLeftBtn = document.getElementById('chsLeft');
  var hRightBtn = document.getElementById('chsRight');
  var vUpBtn = document.getElementById('cvsUp');
  var vDownBtn = document.getElementById('cvsDown');
  if (!scroller || !hWrap || !vWrap || !hTrack || !hThumb || !vTrack || !vThumb) return;

  var ARROW_STEP = 60;
  var MIN_THUMB = 24;

  function syncPanScrollbars() {
    var maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    var maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);

    var hEnabled = maxScrollLeft > 1;
    hWrap.classList.toggle('disabled', !hEnabled);
    var trackW = hTrack.clientWidth;
    if (hEnabled && trackW > 0) {
      var thumbW = Math.min(trackW, Math.max(MIN_THUMB, trackW * (scroller.clientWidth / scroller.scrollWidth)));
      var thumbX = (trackW - thumbW) * (scroller.scrollLeft / maxScrollLeft);
      hThumb.style.width = thumbW + 'px';
      hThumb.style.left = thumbX + 'px';
    } else {
      hThumb.style.width = '100%';
      hThumb.style.left = '0px';
    }

    var vEnabled = maxScrollTop > 1;
    vWrap.classList.toggle('disabled', !vEnabled);
    var trackH = vTrack.clientHeight;
    if (vEnabled && trackH > 0) {
      var thumbH = Math.min(trackH, Math.max(MIN_THUMB, trackH * (scroller.clientHeight / scroller.scrollHeight)));
      var thumbY = (trackH - thumbH) * (scroller.scrollTop / maxScrollTop);
      vThumb.style.height = thumbH + 'px';
      vThumb.style.top = thumbY + 'px';
    } else {
      vThumb.style.height = '100%';
      vThumb.style.top = '0px';
    }
  }
  window.syncPanScrollbars = syncPanScrollbars;

  scroller.addEventListener('scroll', syncPanScrollbars);
  window.addEventListener('resize', syncPanScrollbars);
  if (window.ResizeObserver) new ResizeObserver(syncPanScrollbars).observe(scroller);

  if (hLeftBtn) hLeftBtn.addEventListener('click', function () { scroller.scrollLeft -= ARROW_STEP; });
  if (hRightBtn) hRightBtn.addEventListener('click', function () { scroller.scrollLeft += ARROW_STEP; });
  if (vUpBtn) vUpBtn.addEventListener('click', function () { scroller.scrollTop -= ARROW_STEP; });
  if (vDownBtn) vDownBtn.addEventListener('click', function () { scroller.scrollTop += ARROW_STEP; });

  function wireThumbDrag(thumb, track, axis) {
    thumb.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      thumb.classList.add('dragging');
      var startPos = axis === 'x' ? e.clientX : e.clientY;
      var startScroll = axis === 'x' ? scroller.scrollLeft : scroller.scrollTop;
      var trackSize = axis === 'x' ? track.clientWidth : track.clientHeight;
      var thumbSize = axis === 'x' ? thumb.offsetWidth : thumb.offsetHeight;
      var maxScroll = axis === 'x'
        ? Math.max(0, scroller.scrollWidth - scroller.clientWidth)
        : Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      var freeTrack = Math.max(1, trackSize - thumbSize);
      var ratio = maxScroll / freeTrack;

      function onMove(ev) {
        var pos = axis === 'x' ? ev.clientX : ev.clientY;
        var delta = (pos - startPos) * ratio;
        var next = Math.max(0, Math.min(maxScroll, startScroll + delta));
        if (axis === 'x') scroller.scrollLeft = next; else scroller.scrollTop = next;
      }
      function onUp() {
        thumb.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
  wireThumbDrag(hThumb, hTrack, 'x');
  wireThumbDrag(vThumb, vTrack, 'y');

  // Clicking the bare track (not the thumb) jumps roughly to that spot,
  // centering the thumb under the click.
  function wireTrackClick(track, thumb, axis) {
    track.addEventListener('mousedown', function (e) {
      if (e.target === thumb) return;
      var rect = track.getBoundingClientRect();
      var trackSize = axis === 'x' ? rect.width : rect.height;
      var thumbSize = axis === 'x' ? thumb.offsetWidth : thumb.offsetHeight;
      var clickPos = axis === 'x' ? (e.clientX - rect.left) : (e.clientY - rect.top);
      var maxScroll = axis === 'x'
        ? Math.max(0, scroller.scrollWidth - scroller.clientWidth)
        : Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      var freeTrack = Math.max(1, trackSize - thumbSize);
      var target = ((clickPos - thumbSize / 2) / freeTrack) * maxScroll;
      var next = Math.max(0, Math.min(maxScroll, target));
      if (axis === 'x') scroller.scrollLeft = next; else scroller.scrollTop = next;
    });
  }
  wireTrackClick(hTrack, hThumb, 'x');
  wireTrackClick(vTrack, vThumb, 'y');

  syncPanScrollbars();
});
