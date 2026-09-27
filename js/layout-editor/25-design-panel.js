// Figma-style "Design" tab in the right panel: position, rotation, size,
// opacity, corner radius, fill (solid or gradient), stroke and drop shadow for
// the current selection, or page size/background when nothing is selected.
// Lengths are shown in the canvas unit (px/mm/cm) picked in the sidebar.
(function () {

  var UNIT_PX = { px: 1, mm: 96 / 25.4, cm: 96 / 2.54 };
  var PANE_KEY = 'plootsRightPane';
  var syncRaf = 0;

  function $(id) { return document.getElementById(id); }
  function unit() { return (typeof state !== 'undefined' && UNIT_PX[state.canvasUnit]) ? state.canvasUnit : 'px'; }
  function toUnit(px) {
    var u = unit(), v = px / UNIT_PX[u];
    return u === 'px' ? String(Math.round(v)) : String(+v.toFixed(u === 'mm' ? 1 : 2));
  }
  function fromUnit(str) {
    var v = parseFloat(String(str).replace(',', '.'));
    return isFinite(v) ? v * UNIT_PX[unit()] : null;
  }
  function round(v, d) { var k = Math.pow(10, d || 0); return Math.round(v * k) / k; }

  // ---- Selection helpers ------------------------------------------------------

  function active() { return fabricCanvas ? fabricCanvas.getActiveObject() : null; }
  function isChart(o) { return !!o && o === chartProxyObj; }
  function isSel(o) { return !!o && o.type === 'activeSelection'; }
  function isImg(o) { return !!o && o.type === 'image'; }
  function isTextObj(o) { return typeof isTextObject === 'function' && isTextObject(o); }
  function hasFill(o) {
    if (!o || isChart(o) || o.isMathObject) return false;
    return ['rect', 'ellipse', 'circle', 'triangle', 'polygon', 'textbox', 'i-text', 'text'].indexOf(o.type) !== -1;
  }
  function hasStroke(o) { return !!o && !isChart(o) && !isSel(o) && !o.isMathObject && o.type !== 'group'; }
  function hasRadius(o) { return !!o && (o.type === 'rect' && !isChart(o) || isImg(o)); }

  function typeInfo(o) {
    if (!o) return { name: 'Page', icon: 'description' };
    if (isChart(o)) return { name: 'Chart', icon: 'bar_chart' };
    if (isSel(o)) return { name: o.size() + ' objects', icon: 'select_all' };
    if (typeof baseTypeInfo === 'function') {
      var i = baseTypeInfo(o);
      var name = (typeof layerDisplayName === 'function') ? layerDisplayName(o) : i.label;
      return { name: name, icon: i.icon };
    }
    return { name: o.type, icon: 'category' };
  }

  // Unrotated, unstroked size — what Figma calls W/H.
  function sizeOf(o) { return { w: (o.width || 0) * Math.abs(o.scaleX || 1), h: (o.height || 0) * Math.abs(o.scaleY || 1) }; }

  function commit(o, opts) {
    if (!o) return;
    o.setCoords();
    if (isChart(o) && typeof syncProxyToChart === 'function') {
      syncProxyToChart();
      if (typeof commitChartResize === 'function') commitChartResize();
    }
    o.dirty = true;
    fabricCanvas.requestRenderAll();
    if (!opts || !opts.quiet) fabricCanvas.fire('object:modified', { target: o });
    scheduleSync();
  }

  // ---- Paint helpers ----------------------------------------------------------

  function parsePaint(c) {
    var p = typeof c === 'string' ? cpParseColor(c) : null;
    if (!p || c === 'transparent') return null;
    return { hex: cpRgbToHex(p.r, p.g, p.b), a: p.a };
  }
  function paintString(hex, a) { return a >= 1 ? hex : cpRgba(hex, a); }
  function setChip(chip, css) {
    chip.firstChild.style.background = css || 'transparent';
  }

  // ---- Sync UI from selection -------------------------------------------------

  function show(id, on) { var el = $(id); if (el) el.hidden = !on; }
  function setVal(id, v) {
    var el = $(id);
    if (el && document.activeElement !== el) el.value = v;
  }

  function sync() {
    syncRaf = 0;
    if (!fabricCanvas || !$('designBody')) return;
    var o = active();
    var info = typeInfo(o);
    $('dpTypeIcon').textContent = info.icon;
    $('dpTypeName').textContent = info.name;
    $('dpTypeName').title = info.name;

    show('dpSecPage', !o);
    show('dpSecPos', !!o);
    show('dpSecLayout', !!o);
    show('dpSecAppear', !!o && !isChart(o));
    show('dpSecFill', hasFill(o));
    show('dpSecStroke', hasStroke(o));
    show('dpSecShadow', !!o && !isChart(o) && !isSel(o));

    if (!o) { syncPage(); return; }

    $('dpAlignLabel').textContent = isSel(o) ? 'Align selection' : 'Align to page';
    setVal('dpX', toUnit(o.left || 0));
    setVal('dpY', toUnit(o.top || 0));
    show('dpRotWrap', !isChart(o));
    setVal('dpRot', round(o.angle || 0, 1));
    $('dpFlipH').classList.toggle('active', !!o.flipX);
    $('dpFlipV').classList.toggle('active', !!o.flipY);

    var sz = sizeOf(o);
    setVal('dpW', toUnit(sz.w));
    setVal('dpH', toUnit(sz.h));
    // Textbox height follows its content, like Figma's "auto height".
    var autoH = isTextObj(o);
    $('dpH').disabled = autoH;
    $('dpH').parentNode.classList.toggle('dp-disabled', autoH);
    $('dpH').title = autoH ? 'Height follows the text' : '';
    $('dpRatio').classList.toggle('active', !!o.dpLockRatio);

    if (!isChart(o)) {
      setVal('dpOpacity', Math.round((o.opacity == null ? 1 : o.opacity) * 100));
      var hidden = o.visible === false;
      $('dpVis').querySelector('span').textContent = hidden ? 'visibility_off' : 'visibility';
      $('dpVis').title = hidden ? 'Show object' : 'Hide object';
      show('dpRadiusWrap', hasRadius(o));
      if (hasRadius(o)) setVal('dpRadius', toUnit(isImg(o) ? (o.clipPath && o.clipPath.rx) || 0 : o.rx || 0));
    }

    if (hasFill(o)) syncFill(o);
    if (hasStroke(o)) syncStroke(o);
    if (!isChart(o) && !isSel(o)) syncShadow(o);
  }

  function syncFill(o) {
    var f = o.fill, grad = f && f.colorStops ? cpGradientFromFabric(f, o) : null;
    var paint = grad ? null : parsePaint(f);
    var has = !!(grad || paint);
    show('dpFillRow', has);
    show('dpFillAdd', !has);
    if (!has) return;
    var hex = $('dpFillHex'), alpha = $('dpFillAlpha');
    if (grad) {
      setChip($('dpFillChip'), cpGradientCss(grad));
      hex.readOnly = true;
      setVal('dpFillHex', grad.type === 'radial' ? 'Radial' : 'Linear');
      alpha.parentNode.hidden = true;
    } else {
      setChip($('dpFillChip'), cpRgba(paint.hex, paint.a));
      hex.readOnly = false;
      setVal('dpFillHex', paint.hex.slice(1).toUpperCase());
      alpha.parentNode.hidden = false;
      setVal('dpFillAlpha', Math.round(paint.a * 100));
    }
  }

  function syncStroke(o) {
    var paint = o.strokeWidth > 0 ? parsePaint(o.stroke) : null;
    show('dpStrokeBody', !!paint);
    show('dpStrokeAdd', !paint);
    if (!paint) return;
    setChip($('dpStrokeChip'), cpRgba(paint.hex, paint.a));
    setVal('dpStrokeHex', paint.hex.slice(1).toUpperCase());
    setVal('dpStrokeAlpha', Math.round(paint.a * 100));
    setVal('dpStrokeW', round(o.strokeWidth || 0, 2));
    var d = o.strokeDashArray;
    $('dpStrokeDash').value = !d || !d.length ? 'solid' : d[0] === d[1] ? 'dashed' : 'dotted';
  }

  function syncShadow(o) {
    var s = o.shadow;
    show('dpShadowBody', !!s);
    show('dpShadowAdd', !s);
    if (!s) return;
    var paint = parsePaint(s.color) || { hex: '#000000', a: 0.25 };
    setChip($('dpShadowChip'), cpRgba(paint.hex, paint.a));
    setVal('dpShadowHex', paint.hex.slice(1).toUpperCase());
    setVal('dpShadowAlpha', Math.round(paint.a * 100));
    setVal('dpShadowX', round(s.offsetX || 0, 1));
    setVal('dpShadowY', round(s.offsetY || 0, 1));
    setVal('dpShadowBlur', round(s.blur || 0, 1));
  }

  function syncPage() {
    setVal('dpPageW', toUnit(state.canvasWidthPx));
    setVal('dpPageH', toUnit(state.canvasHeightPx));
    var bg = state.canvasBg || '#ffffff';
    setChip($('dpPageBgChip'), bg === 'transparent' ? 'transparent' : bg);
    setVal('dpPageBgHex', bg === 'transparent' ? 'None' : bg.replace('#', '').toUpperCase());
  }

  function scheduleSync() {
    if (syncRaf) return;
    syncRaf = requestAnimationFrame(sync);
  }
  window.syncDesignPanel = scheduleSync;

  // ---- Edits ------------------------------------------------------------------

  function setPos(axis, px) {
    var o = active();
    if (!o || px == null) return;
    o.set(axis === 'x' ? 'left' : 'top', px);
    commit(o);
  }

  function setSize(dim, px) {
    var o = active();
    if (!o || px == null || px <= 0) return;
    var sz = sizeOf(o), ratio = sz.h ? sz.w / sz.h : 1;
    var w = dim === 'w' ? px : (o.dpLockRatio ? px * ratio : sz.w);
    var h = dim === 'h' ? px : (o.dpLockRatio ? px / ratio : sz.h);
    if (isChart(o)) {
      o.set({ width: w, height: h, scaleX: 1, scaleY: 1 });
    } else if (isTextObj(o)) {
      o.set('width', w / Math.abs(o.scaleX || 1));
    } else if (o.type === 'rect' && !isSel(o)) {
      // Resize the geometry itself so strokes and corner radius don't stretch.
      o.set({ width: w / Math.abs(o.scaleX || 1), height: h / Math.abs(o.scaleY || 1) });
    } else if (o.type === 'ellipse') {
      o.set({ rx: w / 2 / Math.abs(o.scaleX || 1), ry: h / 2 / Math.abs(o.scaleY || 1) });
    } else {
      o.set({ scaleX: w / (o.width || 1), scaleY: h / (o.height || 1) });
    }
    commit(o);
  }

  function alignTo(where) {
    var o = active();
    if (!o) return;
    if (isSel(o)) {
      // Align each object within the selection's bounds.
      var objs = o.getObjects();
      fabricCanvas.discardActiveObject();
      var rects = objs.map(function (x) { return x.getBoundingRect(true, true); });
      var L = Math.min.apply(null, rects.map(function (r) { return r.left; }));
      var T = Math.min.apply(null, rects.map(function (r) { return r.top; }));
      var R = Math.max.apply(null, rects.map(function (r) { return r.left + r.width; }));
      var B = Math.max.apply(null, rects.map(function (r) { return r.top + r.height; }));
      objs.forEach(function (x, i) { moveBox(x, rects[i], where, L, T, R, B); });
      var sel = new fabric.ActiveSelection(objs, { canvas: fabricCanvas });
      fabricCanvas.setActiveObject(sel);
      objs.forEach(function (x) { fabricCanvas.fire('object:modified', { target: x }); });
      fabricCanvas.requestRenderAll();
      scheduleSync();
      return;
    }
    moveBox(o, o.getBoundingRect(true, true), where, 0, 0, state.canvasWidthPx, state.canvasHeightPx);
    commit(o);
  }

  function moveBox(o, r, where, L, T, R, B) {
    var dx = 0, dy = 0;
    if (where === 'left') dx = L - r.left;
    else if (where === 'center') dx = (L + R) / 2 - (r.left + r.width / 2);
    else if (where === 'right') dx = R - (r.left + r.width);
    else if (where === 'top') dy = T - r.top;
    else if (where === 'middle') dy = (T + B) / 2 - (r.top + r.height / 2);
    else if (where === 'bottom') dy = B - (r.top + r.height);
    o.set({ left: o.left + dx, top: o.top + dy });
    o.setCoords();
  }

  function editFill(o, anchor) {
    var f = o.fill, grad = f && f.colorStops ? cpGradientFromFabric(f, o) : null;
    var paint = grad ? { hex: grad.stops[0].hex, a: grad.stops[0].a } : (parsePaint(f) || { hex: '#d9d9d9', a: 1 });
    openColorPicker({
      title: 'Fill', hex: paint.hex, alpha: paint.a, showAlpha: true, anchorBtn: anchor,
      allowGradient: true, gradient: grad,
      onChange: function (hex, a) { o.set('fill', paintString(hex, a)); commit(o, { quiet: true }); notify(o); },
      onGradient: function (g) { o.set('fill', cpGradientToFabric(g)); commit(o, { quiet: true }); notify(o); }
    });
  }

  function editSolid(o, anchor, title, get, set) {
    var p = get() || { hex: '#000000', a: 1 };
    openColorPicker({
      title: title, hex: p.hex, alpha: p.a, showAlpha: true, anchorBtn: anchor,
      onChange: function (hex, a) { set(hex, a); commit(o, { quiet: true }); notify(o); }
    });
  }

  // Debounced undo entry + layers thumbnail refresh for live color drags.
  function notify(o) {
    if (typeof historyNotifyChange === 'function') historyNotifyChange();
    if (typeof scheduleLayersRefresh === 'function') scheduleLayersRefresh();
  }

  function setShadow(o, patch) {
    var s = o.shadow || { color: 'rgba(0,0,0,0.25)', blur: 8, offsetX: 0, offsetY: 4 };
    var next = { color: s.color, blur: s.blur, offsetX: s.offsetX, offsetY: s.offsetY };
    for (var k in patch) next[k] = patch[k];
    o.set('shadow', new fabric.Shadow(next));
    if (o.tfbFx) o.tfbFx = null; // hand-edited: no longer a text-bar preset
    commit(o);
  }

  // ---- Wiring -----------------------------------------------------------------

  // Commit on Enter/blur; Arrow keys step by 1 (Shift: 10), like Figma.
  function bindNum(id, apply, step) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('change', function () { apply(el.value); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { el.blur(); return; }
      if (e.key === 'Escape') { scheduleSync(); el.blur(); return; }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      var v = parseFloat(String(el.value).replace(',', '.')) || 0;
      var base = step === 'len' ? { px: 1, mm: 0.5, cm: 0.05 }[unit()] : (step || 1);
      var s = base * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
      el.value = round(v + s, 3);
      apply(el.value);
    });
    el.addEventListener('focus', function () { el.select(); });
  }

  // Drag the field's label horizontally to scrub its value.
  function bindScrub(label) {
    var input = $(label.getAttribute('data-for'));
    if (!input) return;
    label.addEventListener('mousedown', function (e) {
      if (input.disabled) return;
      e.preventDefault();
      var x0 = e.clientX, v0 = parseFloat(String(input.value).replace(',', '.')) || 0, moved = false;
      function move(ev) {
        var dx = ev.clientX - x0;
        if (!moved && Math.abs(dx) < 2) return;
        moved = true;
        var k = unit() === 'px' || !/^dp(X|Y|W|H|Radius|PageW|PageH)$/.test(input.id) ? 1 : 0.1;
        input.value = round(v0 + Math.round(dx) * k * (ev.shiftKey ? 10 : 1), 2);
        input.dispatchEvent(new Event('change'));
      }
      function up() {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
        if (!moved) { input.focus(); }
      }
      document.body.style.cursor = 'ew-resize';
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  function onObj(fn) {
    return function () {
      var o = active();
      if (o) fn(o, this);
    };
  }

  function wire() {
    var panel = $('layersPanel');
    if (!panel || !$('designBody')) return;

    // Tabs
    var pane = 'design';
    try { pane = localStorage.getItem(PANE_KEY) || 'design'; } catch (e) { }
    function setPane(p) {
      panel.classList.toggle('rp-design', p === 'design');
      Array.prototype.forEach.call(panel.querySelectorAll('.rp-tab'), function (t) {
        var on = t.getAttribute('data-pane') === p;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on);
      });
      try { localStorage.setItem(PANE_KEY, p); } catch (e) { }
      if (p === 'design') scheduleSync();
    }
    Array.prototype.forEach.call(panel.querySelectorAll('.rp-tab'), function (t) {
      t.addEventListener('click', function () { setPane(t.getAttribute('data-pane')); });
    });
    setPane(pane);

    Array.prototype.forEach.call(document.querySelectorAll('#designBody .dp-scrub'), bindScrub);

    // Page
    bindNum('dpPageW', function (v) { setPageDim('chartWidth', v); });
    bindNum('dpPageH', function (v) { setPageDim('chartHeight', v); });
    $('dpPageBgChip').addEventListener('click', function () {
      var bg = state.canvasBg && state.canvasBg !== 'transparent' ? state.canvasBg : '#ffffff';
      openColorPicker({ title: 'Page background', hex: bg, alpha: 1, showAlpha: false, anchorBtn: this,
        onChange: function (hex) { if (typeof setCanvasBg === 'function') setCanvasBg(hex); scheduleSync(); } });
    });
    $('dpPageBgHex').addEventListener('change', function () {
      var rgb = cpHexToRgb(this.value);
      if (rgb && typeof setCanvasBg === 'function') setCanvasBg(cpRgbToHex(rgb.r, rgb.g, rgb.b));
      this.blur(); scheduleSync();
    });

    // Position / rotation / size
    Array.prototype.forEach.call(document.querySelectorAll('#dpSecPos [data-align]'), function (b) {
      b.addEventListener('click', function () { alignTo(b.getAttribute('data-align')); });
    });
    bindNum('dpX', function (v) { setPos('x', fromUnit(v)); }, 'len');
    bindNum('dpY', function (v) { setPos('y', fromUnit(v)); }, 'len');
    bindNum('dpRot', function (v) {
      var o = active(), a = parseFloat(v);
      if (!o || !isFinite(a)) return;
      o.rotate(((a % 360) + 360) % 360);
      commit(o);
    });
    $('dpRot90').addEventListener('click', onObj(function (o) { o.rotate(((o.angle || 0) + 90) % 360); commit(o); }));
    $('dpFlipH').addEventListener('click', onObj(function (o) { o.set('flipX', !o.flipX); commit(o); }));
    $('dpFlipV').addEventListener('click', onObj(function (o) { o.set('flipY', !o.flipY); commit(o); }));
    bindNum('dpW', function (v) { setSize('w', fromUnit(v)); }, 'len');
    bindNum('dpH', function (v) { setSize('h', fromUnit(v)); }, 'len');
    $('dpRatio').addEventListener('click', onObj(function (o) { o.dpLockRatio = !o.dpLockRatio; scheduleSync(); }));

    // Appearance
    bindNum('dpOpacity', function (v) {
      var o = active(), n = parseFloat(v);
      if (!o || !isFinite(n)) return;
      o.set('opacity', Math.min(100, Math.max(0, n)) / 100);
      commit(o);
    });
    bindNum('dpRadius', function (v) {
      var o = active(), r = fromUnit(v);
      if (!o || r == null) return;
      r = Math.max(0, r);
      if (isImg(o)) applyImageCornerRadius(o, r);
      else o.set({ rx: r, ry: r });
      commit(o);
    });
    $('dpVis').addEventListener('click', onObj(function (o) {
      if (typeof toggleLayerVisibility === 'function') toggleLayerVisibility(o);
      scheduleSync();
    }));

    // Fill
    $('dpFillChip').addEventListener('click', onObj(function (o, btn) { editFill(o, btn); }));
    $('dpFillHex').addEventListener('click', onObj(function (o, el) { if (el.readOnly) editFill(o, $('dpFillChip')); }));
    $('dpFillHex').addEventListener('change', onObj(function (o, el) {
      var rgb = cpHexToRgb(el.value), p = parsePaint(o.fill) || { a: 1 };
      if (rgb) { o.set('fill', paintString(cpRgbToHex(rgb.r, rgb.g, rgb.b), p.a)); commit(o); }
      el.blur(); scheduleSync();
    }));
    bindNum('dpFillAlpha', function (v) {
      var o = active(), p = o && parsePaint(o.fill), n = parseFloat(v);
      if (!p || !isFinite(n)) return;
      o.set('fill', paintString(p.hex, Math.min(100, Math.max(0, n)) / 100));
      commit(o);
    });
    $('dpFillAdd').addEventListener('click', onObj(function (o) {
      o.set('fill', o.tfbFill || (isTextObj(o) ? '#1a1a1a' : '#d9d9d9'));
      commit(o);
    }));
    $('dpFillRemove').addEventListener('click', onObj(function (o) {
      if (typeof o.fill === 'string') o.tfbFill = o.fill;
      o.set('fill', 'transparent');
      commit(o);
    }));

    // Stroke
    $('dpStrokeChip').addEventListener('click', onObj(function (o, btn) {
      editSolid(o, btn, 'Stroke', function () { return parsePaint(o.stroke); },
        function (hex, a) { o.set('stroke', paintString(hex, a)); });
    }));
    $('dpStrokeHex').addEventListener('change', onObj(function (o, el) {
      var rgb = cpHexToRgb(el.value), p = parsePaint(o.stroke) || { a: 1 };
      if (rgb) { o.set('stroke', paintString(cpRgbToHex(rgb.r, rgb.g, rgb.b), p.a)); commit(o); }
      el.blur(); scheduleSync();
    }));
    bindNum('dpStrokeAlpha', function (v) {
      var o = active(), p = o && parsePaint(o.stroke), n = parseFloat(v);
      if (!p || !isFinite(n)) return;
      o.set('stroke', paintString(p.hex, Math.min(100, Math.max(0, n)) / 100));
      commit(o);
    });
    bindNum('dpStrokeW', function (v) {
      var o = active(), n = parseFloat(v);
      if (!o || !isFinite(n)) return;
      o.set('strokeWidth', Math.max(0, n));
      applyDash(o, $('dpStrokeDash').value);
      commit(o);
    });
    $('dpStrokeDash').addEventListener('change', onObj(function (o, el) { applyDash(o, el.value); commit(o); }));
    $('dpStrokeAdd').addEventListener('click', onObj(function (o) {
      o.set({ stroke: '#000000', strokeWidth: isTextObj(o) ? 1 : 2, strokeDashArray: null });
      if (isTextObj(o)) o.set('paintFirst', 'stroke');
      commit(o);
    }));
    $('dpStrokeRemove').addEventListener('click', onObj(function (o) {
      o.set({ stroke: null, strokeWidth: 0 });
      commit(o);
    }));

    // Shadow
    $('dpShadowAdd').addEventListener('click', onObj(function (o) { setShadow(o, {}); }));
    $('dpShadowRemove').addEventListener('click', onObj(function (o) { o.set('shadow', null); o.tfbFx = null; commit(o); }));
    $('dpShadowChip').addEventListener('click', onObj(function (o, btn) {
      editSolid(o, btn, 'Shadow', function () { return o.shadow && parsePaint(o.shadow.color); },
        function (hex, a) { var s = o.shadow; o.set('shadow', new fabric.Shadow({ color: cpRgba(hex, a), blur: s.blur, offsetX: s.offsetX, offsetY: s.offsetY })); });
    }));
    $('dpShadowHex').addEventListener('change', onObj(function (o, el) {
      var rgb = cpHexToRgb(el.value), p = parsePaint(o.shadow && o.shadow.color) || { a: 0.25 };
      if (rgb) setShadow(o, { color: cpRgba(cpRgbToHex(rgb.r, rgb.g, rgb.b), p.a) });
      el.blur();
    }));
    bindNum('dpShadowAlpha', function (v) {
      var o = active(), p = o && o.shadow && parsePaint(o.shadow.color), n = parseFloat(v);
      if (p && isFinite(n)) setShadow(o, { color: cpRgba(p.hex, Math.min(100, Math.max(0, n)) / 100) });
    });
    bindNum('dpShadowX', function (v) { var o = active(), n = parseFloat(v); if (o && o.shadow && isFinite(n)) setShadow(o, { offsetX: n }); });
    bindNum('dpShadowY', function (v) { var o = active(), n = parseFloat(v); if (o && o.shadow && isFinite(n)) setShadow(o, { offsetY: n }); });
    bindNum('dpShadowBlur', function (v) { var o = active(), n = parseFloat(v); if (o && o.shadow && isFinite(n)) setShadow(o, { blur: Math.max(0, n) }); });

    // Unit changes in the sidebar reformat every length field.
    ['unitPx', 'unitMm', 'unitCm'].forEach(function (id) {
      var b = $(id);
      b && b.addEventListener('click', function () { setTimeout(scheduleSync, 0); });
    });
  }

  function applyDash(o, style) {
    var w = o.strokeWidth || 1;
    o.set('strokeDashArray', style === 'dashed' ? [3 * w, 3 * w] : style === 'dotted' ? [w, 2 * w] : null);
  }

  // Page size goes through the sidebar inputs so templates/units stay in sync.
  function setPageDim(inputId, v) {
    var px = fromUnit(v), side = $(inputId);
    if (px == null || px <= 0 || !side) return;
    side.value = typeof fromBaselinePx === 'function' ? fromBaselinePx(Math.round(px), state.canvasUnit) : Math.round(px);
    side.dispatchEvent(new Event('input'));
    scheduleSync();
  }

  function wireCanvas() {
    if (!fabricCanvas) return;
    ['selection:created', 'selection:updated', 'selection:cleared', 'object:moving', 'object:scaling',
      'object:rotating', 'object:modified', 'object:removed', 'text:changed'].forEach(function (ev) {
      fabricCanvas.on(ev, scheduleSync);
    });
    scheduleSync();
  }

  document.addEventListener('DOMContentLoaded', wire);
  if (fabricCanvas) wireCanvas();
  else document.addEventListener('ploots:canvasready', wireCanvas);
})();
