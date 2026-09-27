// Figma-style selection HUD: a "W × H" badge under the selected object and
// dashed guides from the object to the page's left and top edges, each with
// its distance. Drawn as a DOM/SVG overlay (not on the Fabric canvas) so it
// never ends up in exported images.
(function () {

  var UNIT_PX = { px: 1, mm: 96 / 25.4, cm: 96 / 2.54 };
  var raf = 0, hidden = false;

  function $(id) { return document.getElementById(id); }

  function fmt(px) {
    var u = (typeof state !== 'undefined' && UNIT_PX[state.canvasUnit]) ? state.canvasUnit : 'px';
    var v = px / UNIT_PX[u];
    return u === 'px' ? String(Math.round(v)) : String(+v.toFixed(u === 'mm' ? 1 : 2));
  }

  function hide() {
    var hud = $('selHud');
    if (hud) hud.classList.remove('show');
  }

  function draw() {
    raf = 0;
    var hud = $('selHud'), pane = $('paneLayout');
    var o = fabricCanvas && fabricCanvas.getActiveObject();
    if (!hud || !pane || !o || hidden || o.isEditing || typeof window.plootsVisibleCanvasRect !== 'function') { hide(); return; }

    var vis = window.plootsVisibleCanvasRect(), p = pane.getBoundingClientRect();
    var cr = fabricCanvas.upperCanvasEl.getBoundingClientRect();
    var sc = cr.width / fabricCanvas.getWidth();
    // Screen box of the object, and its page-space box for the numbers.
    var br = o.getBoundingRect();
    var abs = o.getBoundingRect(true, true);
    var x0 = cr.left + br.left * sc - vis.left, y0 = cr.top + br.top * sc - vis.top;
    var w = br.width * sc, h = br.height * sc;
    var pageL = cr.left - vis.left, pageT = cr.top - vis.top;

    hud.style.left = (vis.left - p.left) + 'px';
    hud.style.top = (vis.top - p.top) + 'px';
    hud.style.width = vis.width + 'px';
    hud.style.height = vis.height + 'px';
    hud.classList.add('show');

    // Size badge (unrotated W × H, like Figma).
    var sw = (o.width || 0) * Math.abs(o.scaleX || 1), sh = (o.height || 0) * Math.abs(o.scaleY || 1);
    var badge = $('selHudBadge');
    badge.textContent = fmt(sw) + ' × ' + fmt(sh);
    badge.style.left = (x0 + w / 2) + 'px';
    badge.style.top = (y0 + h + 8) + 'px';

    guide($('selHudLineX'), $('selHudDistX'), abs.left, pageL, y0 + h / 2, x0, true);
    guide($('selHudLineY'), $('selHudDistY'), abs.top, pageT, x0 + w / 2, y0, false);
  }

  // Dashed line from the page edge to the object, with the gap in page units.
  function guide(line, label, gapPx, edge, cross, objEdge, horizontal) {
    var show = gapPx > 0.5 && objEdge - edge > 12;
    line.style.display = label.style.display = show ? '' : 'none';
    if (!show) return;
    if (horizontal) {
      line.setAttribute('x1', edge); line.setAttribute('x2', objEdge);
      line.setAttribute('y1', cross); line.setAttribute('y2', cross);
      label.style.left = (edge + objEdge) / 2 + 'px';
      label.style.top = cross + 'px';
    } else {
      line.setAttribute('x1', cross); line.setAttribute('x2', cross);
      line.setAttribute('y1', edge); line.setAttribute('y2', objEdge);
      label.style.left = cross + 'px';
      label.style.top = (edge + objEdge) / 2 + 'px';
    }
    label.textContent = fmt(gapPx);
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(draw);
  }

  function wireCanvas() {
    if (!fabricCanvas) return;
    fabricCanvas.on('after:render', schedule);
    fabricCanvas.on('selection:cleared', hide);
    // Rotating makes the axis-aligned guides noisy; hide until release.
    fabricCanvas.on('object:rotating', function () { hidden = true; hide(); });
    fabricCanvas.on('mouse:up', function () { if (hidden) { hidden = false; schedule(); } });
    var scroll = $('canvasScroll');
    scroll && scroll.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    ['unitPx', 'unitMm', 'unitCm'].forEach(function (id) {
      var b = $(id);
      b && b.addEventListener('click', function () { setTimeout(schedule, 0); });
    });
  }

  if (fabricCanvas) wireCanvas();
  else document.addEventListener('ploots:canvasready', wireCanvas);
})();
