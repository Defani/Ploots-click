// Canva-style floating toolbars. The per-type format bars (text, shape, image,
// formula, chart) float at the top of the canvas area instead of living in the
// header, and a small action pill (#tfbMini) hovers just above the selection.
//
// The original controls (font, size, B/I/U, sup/sub, color) keep their fmt*
// ids and are still wired by 08-format-bars.js. This file adds the extra
// Canva controls: size stepper, strikethrough, case, cycling alignment,
// bullets, spacing, transparency, effects and position.
(function () {

  var ALIGNS = ['left', 'center', 'right', 'justify'];
  var ALIGN_LABEL = { left: 'left', center: 'center', right: 'right', justify: 'justify' };
  var BULLET = '• ';
  var FX_DEFAULT_COLOR = { shadow: '#000000', lift: '#000000', outline: '#18a0fb', hollow: null, background: '#ffd84d' };

  function $(id) { return document.getElementById(id); }

  function activeText() {
    if (!fabricCanvas) return null;
    var o = fabricCanvas.getActiveObject();
    return isTextObject(o) ? o : null;
  }

  // Any selected object except the chart's transparent proxy.
  function activeObj() {
    if (!fabricCanvas) return null;
    var o = fabricCanvas.getActiveObject();
    return o && o !== chartProxyObj ? o : null;
  }

  // Whichever floating bar (text, shape, image, formula, chart, ...) is showing.
  function activeBar() {
    return document.querySelector('#paneLayout > .tfb-bar.active');
  }

  function notifyHistory() {
    if (typeof historyNotifyChange === 'function') historyNotifyChange();
  }

  // Whole-object change: apply, re-measure and record for undo.
  function applyToText(fn) {
    var o = activeText();
    if (!o) return;
    fn(o);
    o.dirty = true;
    o.setCoords();
    fabricCanvas.requestRenderAll();
    notifyHistory();
    syncExtras(o);
  }

  function applyToObj(fn) {
    var o = activeObj();
    if (!o) return;
    fn(o);
    o.dirty = true;
    fabricCanvas.requestRenderAll();
    notifyHistory();
  }

  // ---- Existing-helper hooks ----------------------------------------------

  // Toolbar edits go through withActiveText (09-panels-helpers.js) but never
  // reached the undo stack; record them here.
  var baseWithActiveText = window.withActiveText;
  window.withActiveText = function (fn) {
    baseWithActiveText(fn);
    if (activeText()) notifyHistory();
  };

  var baseSetTextAlign = window.setTextAlign;
  window.setTextAlign = function (a) {
    baseSetTextAlign(a);
    syncAlignIcon(a);
  };

  var baseUpdateTextPanel = window.updateTextPanel;
  window.updateTextPanel = function (o) {
    baseUpdateTextPanel(o);
    syncExtras(o);
  };

  // Every per-type bar floats above the canvas the same way.
  ['showTextFormatBar', 'showShapeFormatBar', 'showImageFormatBar', 'showMathFormatBar', 'showChartFormatBar'].forEach(function (name) {
    var base = window[name];
    if (typeof base !== 'function') return;
    window[name] = function () {
      base.apply(this, arguments);
      refreshFloating();
    };
  });

  var baseHideFormatBars = window.hideFormatBars;
  window.hideFormatBars = function () {
    baseHideFormatBars();
    var gen = $('objFormatBar');
    if (gen) gen.classList.remove('active');
    closePops();
    hideMini();
  };

  function refreshFloating() {
    positionBar();
    showMini();
  }
  window.tfbRefreshFloating = refreshFloating;

  // ---- Sync UI from the selected object -----------------------------------

  function syncAlignIcon(a) {
    a = ALIGNS.indexOf(a) === -1 ? 'left' : a;
    var icon = $('fmtAlignIcon');
    if (icon) icon.textContent = 'format_align_' + a;
    var btn = $('fmtAlignCycle');
    if (btn) btn.title = 'Alignment: ' + ALIGN_LABEL[a];
  }

  function isUpper(text) {
    return /[a-z]/i.test(text) && text === text.toUpperCase();
  }

  function hasBullets(text) {
    return text.split('\n').every(function (l) { return l.indexOf(BULLET) === 0; });
  }

  function syncExtras(o) {
    if (!o) return;
    var strike = $('fmtStrike');
    if (strike) strike.classList.toggle('active', !!o.linethrough);
    var cse = $('fmtCase');
    if (cse) cse.classList.toggle('active', isUpper(o.text || ''));
    var list = $('fmtList');
    if (list) list.classList.toggle('active', hasBullets(o.text || ''));
    syncAlignIcon(o.textAlign);
    var size = $('fmtSize');
    if (size && document.activeElement !== size) size.value = Math.round(o.fontSize || 24);
    syncMiniLock(o);
  }

  // ---- Bar placement --------------------------------------------------------

  // #canvasScroll fills the whole pane; the rulers, layers panel and pan
  // scrollbars are overlaid on its edges. Return the part left uncovered.
  function visibleCanvasRect() {
    var b = $('canvasScroll').getBoundingClientRect();
    var r = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    function edge(id, side) {
      var el = $(id);
      if (!el || !el.offsetWidth || !el.offsetHeight) return;
      var e = el.getBoundingClientRect();
      if (side === 'top') r.top = Math.max(r.top, e.bottom);
      else if (side === 'left') r.left = Math.max(r.left, e.right);
      else if (side === 'right') r.right = Math.min(r.right, e.left);
      else r.bottom = Math.min(r.bottom, e.top);
    }
    edge('rulerTop', 'top');
    edge('rulerLeft', 'left');
    edge('canvasVScroll', 'right');
    edge('canvasHScroll', 'bottom');
    r.width = r.right - r.left;
    r.height = r.bottom - r.top;
    return r;
  }
  window.plootsVisibleCanvasRect = visibleCanvasRect;

  // Center the bar over the visible canvas area.
  function positionBar() {
    var bar = activeBar(), pane = $('paneLayout');
    if (!bar || !pane || !$('canvasScroll')) return;
    var p = pane.getBoundingClientRect(), s = visibleCanvasRect();
    var maxW = Math.max(200, Math.round(s.width - 24));
    if (maxW !== bar._tfbFitW) {
      bar.style.maxWidth = maxW + 'px';
      if (bar.id === 'textFormatBar') fitBar();
      // Still too wide with everything collapsed (very narrow canvas): let it
      // spill over the rulers/layers panel rather than hide controls.
      if (bar.scrollWidth > bar.clientWidth) bar.style.maxWidth = Math.round(p.width - 16) + 'px';
      bar._tfbFitW = maxW;
    }
    var half = bar.offsetWidth / 2;
    var cx = Math.min(Math.max(s.left - p.left + s.width / 2, half + 8), p.width - half - 8);
    bar.style.left = Math.round(cx) + 'px';
    bar.style.top = Math.round(s.top - p.top + 10) + 'px';
  }

  // Like Canva, buttons that don't fit move into a "⋯" popover, least
  // important first. Placeholders remember where each one goes back.
  var OVERFLOW_ORDER = ['fmtSub', 'fmtSuper', 'fmtOpacityBtn', 'fmtSpacingBtn', 'fmtList', 'fmtCase', 'fmtStrike', 'fmtAlignCycle'];
  var placeholders = {};

  function fitBar() {
    var bar = $('textFormatBar'), row = $('tfbMoreRow'), more = $('fmtMoreBtn');
    if (!bar || !row || !more) return;
    OVERFLOW_ORDER.forEach(function (id) {
      var ph = placeholders[id];
      if (ph && $(id).parentNode !== bar) ph.parentNode.insertBefore($(id), ph);
    });
    more.hidden = true;
    if (bar.scrollWidth <= bar.clientWidth) return;
    more.hidden = false;
    for (var i = 0; i < OVERFLOW_ORDER.length && bar.scrollWidth > bar.clientWidth; i++) {
      row.insertBefore($(OVERFLOW_ORDER[i]), row.firstChild);
    }
  }

  // ---- Mini action pill above the object ------------------------------------

  var transforming = false, miniRaf = 0;

  function showMini() {
    var mini = $('tfbMini');
    var o = activeObj();
    if (!mini || !o) return;
    // Lock applies to a single object; a multi-selection can't be locked.
    $('tfbMiniLock').hidden = o.type === 'activeSelection';
    syncMiniLock(o);
    mini.classList.add('show');
    positionMini();
  }

  function hideMini() {
    var mini = $('tfbMini');
    if (mini) mini.classList.remove('show');
  }

  function positionMini() {
    var mini = $('tfbMini'), pane = $('paneLayout'), scroll = $('canvasScroll'), bar = activeBar();
    var o = activeObj();
    if (!mini || !pane || !scroll || !o || transforming) { hideMini(); return; }
    mini.classList.add('show');
    var cr = fabricCanvas.upperCanvasEl.getBoundingClientRect();
    var sc = cr.width / fabricCanvas.getWidth();
    var br = o.getBoundingRect();
    var p = pane.getBoundingClientRect(), s = visibleCanvasRect();
    var objTop = cr.top + br.top * sc, objBottom = objTop + br.height * sc;
    var cx = cr.left + (br.left + br.width / 2) * sc;
    // Clear the rotation handle, which Fabric draws above the object.
    var mtr = o.controls && o.controls.mtr;
    var rotGap = o.hasControls && mtr && mtr.y < 0 && o.isControlVisible('mtr') ? Math.abs(mtr.offsetY || 0) : 0;
    var h = mini.offsetHeight, w = mini.offsetWidth;
    var barBottom = bar ? bar.getBoundingClientRect().bottom : s.top;
    var top = objTop - rotGap - 10 - h;
    if (top < barBottom + 6) top = objBottom + 12; // no room above: drop below
    if (objBottom < s.top || objTop > s.bottom || top + h > s.bottom) { mini.classList.remove('show'); return; }
    var left = Math.min(Math.max(cx - w / 2, s.left + 6), s.right - w - 6);
    mini.style.left = Math.round(left - p.left) + 'px';
    mini.style.top = Math.round(top - p.top) + 'px';
  }

  function scheduleMini() {
    if (miniRaf) return;
    miniRaf = requestAnimationFrame(function () {
      miniRaf = 0;
      if (activeBar()) {
        positionBar();
        positionMini();
      }
    });
  }

  function syncMiniLock(o) {
    var locked = !!(o && o.lockMovementX);
    var icon = $('tfbMiniLockIcon'), btn = $('tfbMiniLock');
    if (icon) icon.textContent = locked ? 'lock' : 'lock_open';
    if (btn) {
      btn.classList.toggle('active', locked);
      btn.title = locked ? 'Unlock' : 'Lock';
    }
  }

  // ---- Popovers -------------------------------------------------------------

  var POPS = [
    ['fmtSpacingBtn', 'tfbSpacingPop'],
    ['fmtOpacityBtn', 'tfbOpacityPop'],
    ['fmtEffectsBtn', 'tfbEffectsPop'],
    ['fmtPositionBtn', 'tfbPositionPop'],
    ['fmtMoreBtn', 'tfbMorePop'],
    ['objBorderBtn', 'objBorderPop'],
    ['objOpacityBtn', 'tfbOpacityPop'],
    ['objPositionBtn', 'tfbPositionPop'],
    ['imgBorderBtn', 'imgBorderPop'],
    ['imgOpacityBtn', 'tfbOpacityPop'],
    ['imgPositionBtn', 'tfbPositionPop'],
    ['mathOpacityBtn', 'tfbOpacityPop'],
    ['mathPositionBtn', 'tfbPositionPop'],
    ['genOpacityBtn', 'tfbOpacityPop'],
    ['genPositionBtn', 'tfbPositionPop']
  ];

  function closePops() {
    POPS.forEach(function (pair) {
      var b = $(pair[0]), p = $(pair[1]);
      if (b) b.classList.remove('active');
      if (p) p.classList.remove('open');
    });
  }

  function togglePop(btnId, popId) {
    var btn = $(btnId), pop = $(popId);
    if (!btn || !pop) return;
    var willOpen = !pop.classList.contains('open');
    closePops();
    if (!willOpen) return;
    syncPop(popId);
    pop.classList.add('open');
    btn.classList.add('active');
    // A button living in the "⋯" popover disappears once that closes, so
    // anchor its popover to the "⋯" button instead.
    var anchor = btn.closest('#tfbMorePop') ? $('fmtMoreBtn') : btn;
    if (typeof positionFloatingPopover === 'function') positionFloatingPopover(anchor, pop);
  }

  function syncPop(popId) {
    var pop = $(popId);
    if (pop) pop.dispatchEvent(new CustomEvent('tfb:popopen'));
    var obj = activeObj();
    if (popId === 'tfbOpacityPop' && obj) {
      setRange('tfbOpacity', 'tfbOpacityVal', Math.round((obj.opacity == null ? 1 : obj.opacity) * 100));
      return;
    }
    var o = activeText();
    if (!o) return;
    if (popId === 'tfbSpacingPop') {
      setRange('tfbLetter', 'tfbLetterVal', Math.round(o.charSpacing || 0));
      setRange('tfbLine', 'tfbLineVal', +(o.lineHeight || 1.16).toFixed(2));
    } else if (popId === 'tfbOpacityPop') {
      setRange('tfbOpacity', 'tfbOpacityVal', Math.round((o.opacity == null ? 1 : o.opacity) * 100));
    } else if (popId === 'tfbEffectsPop') {
      syncFxUi(o);
    }
  }

  function setRange(inputId, outId, v) {
    var i = $(inputId), out = $(outId);
    if (i) i.value = v;
    if (out) out.textContent = v;
  }

  // ---- Effects --------------------------------------------------------------

  function readFx(o) {
    if (o.tfbFx && o.tfbFx.type) return o.tfbFx;
    // Objects restored by undo lose custom props; infer from Fabric props.
    var type = 'none';
    if (o.stroke && o.strokeWidth > 0 && (o.fill === 'transparent' || o.fill === 'rgba(0,0,0,0)')) type = 'hollow';
    else if (o.backgroundColor) type = 'background';
    else if (o.stroke && o.strokeWidth > 0) type = 'outline';
    else if (o.shadow) type = o.shadow.offsetX ? 'shadow' : 'lift';
    return { type: type, size: 50, color: FX_DEFAULT_COLOR[type] || '#000000' };
  }

  function solidFill(o) {
    return typeof o.fill === 'string' && o.fill.charAt(0) === '#' ? o.fill.slice(0, 7) : '#1a1a1a';
  }

  function clearFx(o) {
    if (o.tfbFx && o.tfbFx.type === 'hollow' && o.tfbFill) o.set('fill', o.tfbFill);
    o.set({ shadow: null, stroke: null, strokeWidth: 0, backgroundColor: '', paintFirst: 'fill' });
  }

  function applyFx(o, fx) {
    clearFx(o);
    var k = fx.size / 100, fs = o.fontSize || 24;
    switch (fx.type) {
      case 'shadow':
        o.set('shadow', new fabric.Shadow({ color: cpToRgbaFromHex(fx.color, 0.15 + 0.7 * k), blur: fs * 0.1, offsetX: fs * 0.06, offsetY: fs * 0.06 }));
        break;
      case 'lift':
        o.set('shadow', new fabric.Shadow({ color: cpToRgbaFromHex(fx.color, 0.1 + 0.6 * k), blur: fs * 0.35, offsetX: 0, offsetY: fs * 0.1 }));
        break;
      case 'outline':
        o.set({ stroke: fx.color, strokeWidth: Math.max(0.5, fs * 0.16 * k), paintFirst: 'stroke', strokeLineJoin: 'round' });
        break;
      case 'hollow':
        o.tfbFill = solidFill(o);
        o.set({ fill: 'transparent', stroke: fx.color || o.tfbFill, strokeWidth: Math.max(0.5, fs * 0.08 * k), paintFirst: 'fill', strokeLineJoin: 'round' });
        break;
      case 'background':
        o.set('backgroundColor', cpToRgbaFromHex(fx.color, Math.max(0.05, k)));
        break;
    }
    o.tfbFx = fx.type === 'none' ? null : fx;
  }

  function syncFxUi(o) {
    var fx = readFx(o);
    Array.prototype.forEach.call(document.querySelectorAll('#tfbFxGrid .tfb-fx'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-fx') === fx.type);
    });
    var opts = $('tfbFxOpts');
    if (opts) opts.classList.toggle('show', fx.type !== 'none');
    setRange('tfbFxSize', 'tfbFxSizeVal', fx.size);
    var sw = $('tfbFxColorSwatch');
    if (sw) sw.style.background = fx.color || solidFill(o);
  }

  function updateFx(patch) {
    applyToText(function (o) {
      var fx = readFx(o), next = { type: fx.type, size: fx.size, color: fx.color };
      for (var k in patch) next[k] = patch[k];
      if (patch.type && patch.type !== fx.type) {
        next.color = patch.type === 'hollow' ? solidFill(o) : FX_DEFAULT_COLOR[patch.type] || '#000000';
      }
      applyFx(o, next);
      syncFxUi(o);
    });
  }

  // ---- Text transforms ------------------------------------------------------

  // Replace the whole text while keeping per-character styles aligned.
  // Textbox styles are keyed by unwrapped line, then char index.
  function shiftLineStyles(o, line, delta) {
    var ls = o.styles && o.styles[line];
    if (!ls) return;
    var next = {};
    Object.keys(ls).forEach(function (k) {
      var i = +k + delta;
      if (i >= 0) next[i] = ls[k];
    });
    o.styles[line] = next;
  }

  function toggleBullets(o) {
    if (o.isEditing) o.exitEditing();
    var lines = (o.text || '').split('\n');
    var on = hasBullets(o.text || '');
    lines = lines.map(function (l, i) {
      shiftLineStyles(o, i, on ? -BULLET.length : BULLET.length);
      return on ? l.slice(BULLET.length) : BULLET + l;
    });
    o.set('text', lines.join('\n'));
  }

  function toggleCase(o) {
    if (o.isEditing) o.exitEditing();
    var t = o.text || '';
    if (isUpper(t)) {
      // Restore the original casing when it still matches, else lowercase.
      o.set('text', o.tfbCaseOrig && o.tfbCaseOrig.toUpperCase() === t ? o.tfbCaseOrig : t.toLowerCase());
      o.tfbCaseOrig = null;
    } else {
      o.tfbCaseOrig = t;
      o.set('text', t.toUpperCase());
    }
  }

  // ---- Position -------------------------------------------------------------

  function applyPosition(pos) {
    var o = activeObj();
    if (!o) return;
    var arrange = { forward: 'bringForward', backward: 'sendBackwards', front: 'bringToFront', back: 'sendToBack' };
    if (arrange[pos]) {
      fabricCanvas[arrange[pos]](o);
      if (typeof refreshLayersPanel === 'function') refreshLayersPanel();
      notifyHistory();
    } else {
      var br = o.getBoundingRect(true, true);
      var W = state.canvasWidthPx, H = state.canvasHeightPx, dx = 0, dy = 0;
      if (pos === 'left') dx = -br.left;
      else if (pos === 'center') dx = (W - br.width) / 2 - br.left;
      else if (pos === 'right') dx = W - br.width - br.left;
      else if (pos === 'top') dy = -br.top;
      else if (pos === 'middle') dy = (H - br.height) / 2 - br.top;
      else if (pos === 'bottom') dy = H - br.height - br.top;
      o.set({ left: o.left + dx, top: o.top + dy });
      o.setCoords();
      fabricCanvas.fire('object:modified', { target: o });
    }
    fabricCanvas.requestRenderAll();
    scheduleMini();
  }

  // ---- Wiring ---------------------------------------------------------------

  function on(id, ev, fn) {
    var el = $(id);
    if (el) el.addEventListener(ev, fn);
  }

  function stepSize(delta) {
    var inp = $('fmtSize');
    if (!inp) return;
    inp.value = Math.min(400, Math.max(1, (parseInt(inp.value, 10) || 24) + delta));
    inp.dispatchEvent(new Event('input'));
    scheduleMini();
  }

  function wire() {
    var bar = $('textFormatBar');
    if (!bar) return;

    // Keep focus (and the text selection while editing) on the canvas when a
    // toolbar button is pressed; inputs and selects still take focus.
    var bars = Array.prototype.slice.call(document.querySelectorAll('#paneLayout > .tfb-bar'));
    bars.concat([$('tfbMini')], POPS.map(function (pair) { return $(pair[1]); })).forEach(function (el) {
      el && el.addEventListener('mousedown', function (e) {
        if (!e.target.closest('input,select')) e.preventDefault();
      });
    });

    OVERFLOW_ORDER.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      var ph = document.createComment(id);
      el.parentNode.insertBefore(ph, el.nextSibling);
      placeholders[id] = ph;
    });

    on('fmtSizeDec', 'click', function () { stepSize(-1); });
    on('fmtSizeInc', 'click', function () { stepSize(1); });
    on('fmtSize', 'input', scheduleMini);

    on('fmtStrike', 'click', function () {
      var btn = this;
      withActiveText(function (o, sel) {
        var cur = sel ? (o.getSelectionStyles()[0] || {}).linethrough : o.linethrough;
        var v = !cur;
        sel ? o.setSelectionStyles({ linethrough: v }) : o.set('linethrough', v);
        btn.classList.toggle('active', v);
      });
    });

    on('fmtCase', 'click', function () { applyToText(toggleCase); });
    on('fmtList', 'click', function () { applyToText(toggleBullets); });

    on('fmtAlignCycle', 'click', function () {
      var o = activeText();
      if (!o) return;
      var next = ALIGNS[(ALIGNS.indexOf(o.textAlign) + 1) % ALIGNS.length];
      setTextAlign(next);
    });

    POPS.forEach(function (pair) {
      on(pair[0], 'click', function (e) { e.stopPropagation(); togglePop(pair[0], pair[1]); });
    });

    on('tfbLetter', 'input', function () {
      var v = parseInt(this.value, 10) || 0;
      $('tfbLetterVal').textContent = v;
      applyToText(function (o) { o.set('charSpacing', v); });
    });
    on('tfbLine', 'input', function () {
      var v = parseFloat(this.value) || 1.16;
      $('tfbLineVal').textContent = v.toFixed(2);
      applyToText(function (o) { o.set('lineHeight', v); });
    });
    on('tfbOpacity', 'input', function () {
      var v = parseInt(this.value, 10);
      $('tfbOpacityVal').textContent = v;
      applyToObj(function (o) { o.set('opacity', v / 100); });
    });

    Array.prototype.forEach.call(document.querySelectorAll('#tfbFxGrid .tfb-fx'), function (b) {
      b.addEventListener('click', function () { updateFx({ type: b.getAttribute('data-fx') }); });
    });
    on('tfbFxSize', 'input', function () {
      $('tfbFxSizeVal').textContent = this.value;
      updateFx({ size: parseInt(this.value, 10) || 0 });
    });
    on('tfbFxColorBtn', 'click', function () {
      var o = activeText();
      if (!o) return;
      var fx = readFx(o);
      openColorPicker({
        title: 'Effect color', hex: fx.color || solidFill(o), alpha: 1, showAlpha: false, anchorBtn: this,
        onChange: function (hex) { updateFx({ color: hex }); }
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('#tfbPositionPop .tfb-pos'), function (b) {
      b.addEventListener('click', function () { applyPosition(b.getAttribute('data-pos')); });
    });

    on('tfbMiniDup', 'click', duplicateActiveObject);
    on('tfbMiniDel', 'click', deleteActiveObject);
    on('tfbMiniLock', 'click', function () {
      toggleActiveObjectLock();
      syncMiniLock(activeObj());
    });
    on('tfbMiniMore', 'click', function (e) {
      var r = this.getBoundingClientRect();
      e.stopPropagation();
      showCtxMenu(r.left, r.bottom + 6);
    });

    // Close popovers on outside click (the color picker panel counts as inside,
    // since the Effects color chip opens it).
    document.addEventListener('mousedown', function (e) {
      if (e.target.closest('.tfb-pop,#cpPanel,#cpBackdrop')) return;
      if (POPS.some(function (pair) { var b = $(pair[0]); return b && b.contains(e.target); })) return;
      closePops();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closePops(); return; }
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      var pane = $('paneLayout');
      if (!pane || !pane.classList.contains('active')) return; // e.g. typing in Data View
      var o = activeText();
      if (!o || (e.target !== o.hiddenTextarea && e.target.closest && e.target.closest('input,textarea,select'))) return;
      var map = { b: 'fmtBold', i: 'fmtItalic', u: 'fmtUnderline' };
      var id = map[e.key.toLowerCase()];
      if (!id) return;
      e.preventDefault();
      $(id).click();
    });

    window.addEventListener('resize', function () {
      if (activeBar()) { positionBar(); scheduleMini(); }
    });
    on('canvasScroll', 'scroll', scheduleMini);
  }

  function wireCanvas() {
    if (!fabricCanvas) return;
    fabricCanvas.on('after:render', scheduleMini);
    ['object:moving', 'object:scaling', 'object:rotating'].forEach(function (ev) {
      fabricCanvas.on(ev, function (e) {
        if (e.target && e.target !== chartProxyObj) { transforming = true; hideMini(); closePops(); }
      });
    });
    fabricCanvas.on('mouse:up', function () {
      if (!transforming) return;
      transforming = false;
      scheduleMini();
    });
    fabricCanvas.on('text:changed', function (e) { syncExtras(e.target); });
  }

  document.addEventListener('DOMContentLoaded', wire);
  // Fired by 12-theme-init.js right after initFabricCanvas().
  if (fabricCanvas) wireCanvas();
  else document.addEventListener('ploots:canvasready', wireCanvas);
})();
