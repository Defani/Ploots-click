// Extra controls for the floating shape / image / formula bars and the
// fallback bar for groups, drawings and multi-selections. The bars themselves
// float via 24-text-float-bar.js; the original inputs (shapeStrokeWidth,
// imgBorderWidth, ...) are still wired by 08-format-bars.js.
(function () {

  function $(id) { return document.getElementById(id); }
  function active() { return fabricCanvas ? fabricCanvas.getActiveObject() : null; }

  function out(id, v) { var el = $(id); if (el) el.textContent = v; }

  // Paint a chip: solid, rgba, gradient or "none" (red diagonal).
  function paintChip(id, paint) {
    var chip = $(id);
    if (!chip) return;
    var none = !paint || paint === 'transparent';
    chip.classList.toggle('none', none);
    if (none) { chip.style.background = ''; return; }
    if (paint.colorStops && typeof cpGradientFromFabric === 'function') {
      chip.style.background = cpGradientCss(cpGradientFromFabric(paint));
    } else {
      chip.style.background = paint;
    }
  }

  function dashOf(o) {
    if (!o.stroke || !(o.strokeWidth > 0)) return 'none';
    var d = o.strokeDashArray;
    return !d || !d.length ? 'solid' : d[0] === d[1] ? 'dashed' : 'dotted';
  }

  function syncShapeBar(o) {
    if (!o) return;
    paintChip('shapeFillColorSwatch', o.fill);
    paintChip('shapeStrokeColorSwatch', o.strokeWidth > 0 ? o.stroke : null);
    $('shapeFillColorBtn').hidden = o.type === 'line';
    var dash = dashOf(o);
    Array.prototype.forEach.call(document.querySelectorAll('#objDashRow button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-dash') === dash);
    });
    out('objStrokeWVal', Math.round(o.strokeWidth || 0));
    out('objStrokeOpVal', Math.round(parseFloat($('shapeStrokeOpacity').value || 1) * 100));
    var isRect = o.type === 'rect';
    $('objRadiusWrap').hidden = !isRect;
    if (isRect) {
      $('objRadius').value = Math.round(o.rx || 0);
      out('objRadiusVal', Math.round(o.rx || 0));
    }
  }

  function syncImageBar(o) {
    if (!o) return;
    paintChip('imgBorderColorSwatch', o.strokeWidth > 0 ? o.stroke : null);
    out('imgBorderWVal', Math.round(o.strokeWidth || 0));
    out('imgRadiusVal', Math.round(o.clipPath && o.clipPath.rx ? o.clipPath.rx : 0));
  }

  // Keep chips/labels in step whenever the existing panels resync.
  var baseShape = window.updateShapePanel;
  window.updateShapePanel = function (o) { baseShape(o); syncShapeBar(o); };
  var baseImage = window.updateImagePanel;
  window.updateImagePanel = function (o) { baseImage(o); syncImageBar(o); };

  function commit(o) {
    o.dirty = true;
    o.setCoords();
    fabricCanvas.requestRenderAll();
    if (typeof historyNotifyChange === 'function') historyNotifyChange();
    if (typeof scheduleLayersRefresh === 'function') scheduleLayersRefresh();
    if (typeof syncDesignPanel === 'function') syncDesignPanel();
  }

  // ---- Shape fill: open the gradient-capable picker ---------------------------

  function openShapeFill(btn) {
    var o = active();
    if (!o || typeof isShapeObject !== 'function' || !isShapeObject(o)) return;
    var f = o.fill, grad = f && f.colorStops ? cpGradientFromFabric(f, o) : null;
    var p = !grad && typeof f === 'string' ? cpParseColor(f) : null;
    var hex = grad ? grad.stops[0].hex : p ? cpRgbToHex(p.r, p.g, p.b) : '#d9d9d9';
    openColorPicker({
      title: 'Fill color', hex: hex, alpha: grad ? grad.stops[0].a : p ? p.a : 1, showAlpha: true, anchorBtn: btn,
      allowGradient: true, gradient: grad,
      onChange: function (h, a) { o.set('fill', a < 1 ? cpRgba(h, a) : h); commit(o); syncShapeBar(o); },
      onGradient: function (g) { o.set('fill', cpGradientToFabric(g)); commit(o); syncShapeBar(o); }
    });
  }

  // ---- Generic bar for groups, drawings and multi-selections -----------------

  function anyBarActive() {
    return !!document.querySelector('#paneLayout > .tfb-bar.active');
  }

  function onSelection() {
    var o = active(), bar = $('objFormatBar');
    if (!bar) return;
    bar.classList.remove('active');
    if (!o || o === chartProxyObj || anyBarActive()) return;
    var label = o.type === 'activeSelection' ? o.size() + ' objects'
      : o.type === 'group' ? 'Group'
      : o.type === 'path' ? 'Drawing'
      : (typeof baseTypeInfo === 'function' ? baseTypeInfo(o).label : 'Object');
    out('objBarLabel', label);
    $('genGroupBtn').hidden = o.type !== 'activeSelection';
    $('genUngroupBtn').hidden = o.type !== 'group' || !!o.isMathObject;
    bar.classList.add('active');
    if (typeof tfbRefreshFloating === 'function') tfbRefreshFloating();
  }

  // ---- Wiring -----------------------------------------------------------------

  function wire() {
    var shapeBar = $('shapeFormatBar');
    if (!shapeBar) return;

    // Intercept before 08-format-bars.js's solid-only fill picker.
    shapeBar.addEventListener('click', function (e) {
      var btn = e.target.closest('#shapeFillColorBtn');
      if (btn) {
        e.stopPropagation();
        openShapeFill(btn);
        return;
      }
      // Picking a border color with no border yet should show one, as in Canva.
      var o = active();
      if (e.target.closest('#shapeStrokeColorBtn') && o && (!o.stroke || !(o.strokeWidth > 0))) {
        o.set({ strokeWidth: 2, stroke: o.stroke || '#000000' });
        commit(o);
        updateShapePanel(o);
      }
    }, true);

    Array.prototype.forEach.call(document.querySelectorAll('#objDashRow button'), function (b) {
      b.addEventListener('click', function () {
        var o = active();
        if (!o) return;
        var style = b.getAttribute('data-dash');
        var width = $('shapeStrokeWidth');
        if (style === 'none') {
          o.set('strokeWidth', 0);
        } else {
          // Fabric's default strokeWidth is 1 even with no stroke color.
          if (!o.stroke || !(o.strokeWidth > 0)) o.set({ stroke: o.stroke || '#000000', strokeWidth: 2 });
          width.value = o.strokeWidth;
          var sel = $('shapeDashStyle');
          sel.value = style;
          sel.dispatchEvent(new Event('change'));
        }
        commit(o);
        updateShapePanel(o);
      });
    });

    $('shapeStrokeWidth').addEventListener('input', function () {
      out('objStrokeWVal', this.value);
      var o = active();
      if (!o) return;
      if (o.strokeWidth > 0 && !o.stroke) o.set('stroke', '#000000');
      // Dash lengths are proportional to the weight; re-derive them.
      var sel = $('shapeDashStyle');
      if (sel.value !== 'solid') sel.dispatchEvent(new Event('change'));
      commit(o);
      syncShapeBar(o);
    });
    $('shapeStrokeOpacity').addEventListener('input', function () {
      out('objStrokeOpVal', Math.round(this.value * 100));
      var o = active();
      if (o) commit(o);
    });
    $('objRadius').addEventListener('input', function () {
      var o = active(), r = parseInt(this.value, 10) || 0;
      out('objRadiusVal', r);
      if (o && o.type === 'rect') { o.set({ rx: r, ry: r }); commit(o); }
    });
    ['shapeJoinStyle', 'shapeCapStyle'].forEach(function (id) {
      $(id).addEventListener('change', function () { var o = active(); if (o) commit(o); });
    });

    $('objBorderPop').addEventListener('tfb:popopen', function () { var o = active(); if (o) updateShapePanel(o); });
    $('imgBorderPop').addEventListener('tfb:popopen', function () { var o = active(); if (o) updateImagePanel(o); });
    $('imgBorderWidth').addEventListener('input', function () {
      out('imgBorderWVal', this.value);
      var o = active();
      if (o) { commit(o); syncImageBar(o); }
    });
    $('imgCornerRadius').addEventListener('input', function () {
      out('imgRadiusVal', this.value);
      var o = active();
      if (o) commit(o);
    });
    ['imgFlipH', 'imgFlipV', 'imgShadowToggle', 'imgGrayscaleToggle'].forEach(function (id) {
      $(id).addEventListener('click', function () { var o = active(); if (o) commit(o); });
    });

    function stepMath(d) {
      var inp = $('fmtMathSize');
      inp.value = Math.min(400, Math.max(8, (parseInt(inp.value, 10) || 32) + d));
      inp.dispatchEvent(new Event('change'));
    }
    $('mathSizeDec').addEventListener('click', function () { stepMath(-2); });
    $('mathSizeInc').addEventListener('click', function () { stepMath(2); });

    $('genGroupBtn').addEventListener('click', function () {
      if (typeof groupActiveObjects === 'function') groupActiveObjects();
      onSelection();
    });
    $('genUngroupBtn').addEventListener('click', function () {
      if (typeof ungroupActiveObject === 'function') ungroupActiveObject();
      onSelection();
    });
  }

  function wireCanvas() {
    if (!fabricCanvas) return;
    // Registered after 07-selection.js's handleSelection, so the type bars
    // have already been decided by the time this runs.
    fabricCanvas.on('selection:created', onSelection);
    fabricCanvas.on('selection:updated', onSelection);
  }

  document.addEventListener('DOMContentLoaded', wire);
  if (fabricCanvas) wireCanvas();
  else document.addEventListener('ploots:canvasready', wireCanvas);
})();
