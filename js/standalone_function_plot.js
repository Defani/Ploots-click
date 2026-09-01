/* ===================== STANDALONE FUNCTION PLOT STUDIO =====================
   A third top-level view (#paneFunc), independent from the chart-linked
   "Function Plot" panel in js/function_plot.js. That panel draws a curve as
   an extra trace on top of an EXISTING line/area/scatter chart's own data
   axes. This file is a fully standalone plotter: its own Plotly figure, its
   own axis range, its own PNG/SVG export - never reads or writes
   state.categories / state.series / state.chartType.

   Supports 5 function kinds, each rendered as its own Plotly trace:
     - explicit   y = f(x)                    -> scatter/lines
     - parametric x(t), y(t)                  -> scatter/lines
     - polar      r(theta)                    -> scatter/lines (converted to x/y)
     - implicit   f(x,y) = g(x,y)              -> contour trace, single level at 0
     - piecewise  f_i(x) on condition_i(x)     -> scatter/lines with gaps at
                                                   piece boundaries

   Reuses fnLatexToMathJs() from js/function_plot.js (loaded just before this
   file, same global scope, same project convention) for the LaTeX-ish ->
   math.js string translation - it's generic over variable names, so it works
   unchanged for x, t, or theta.

   Libraries paired in: math.js (expression evaluation, already loaded),
   Plotly.js (rendering + PNG/SVG export, already bundled locally), and KaTeX
   (fast, synchronous LaTeX preview of whatever the user is typing - loaded
   via CDN in index.html alongside MathJax). Degrades gracefully: if KaTeX
   isn't ready yet the preview box just shows the raw text instead. */

var FS_SAMPLES = 500;
var FS_IMPLICIT_GRID = 160;
var fsIdCounter = 0;
var fsPlotted = false;

var fsState = {
  entries: [],
  xMin: -10, xMax: 10, yMin: -10, yMax: 10,
  autoRange: true,
  showGrid: true,
  equalAspect: false,
  csv: { header: [], rows: [] }
};

/* ===================== small DOM/eval helpers ===================== */

function fsEl(id){ return document.getElementById(id); }

function fsShowStatus(kind, msg){
  var el = fsEl('fsStatus');
  if(!el) return;
  if(!msg){ el.className = 'status'; el.textContent = ''; return; }
  el.className = 'status ' + kind;
  el.textContent = msg;
}

/* Same clipping convention as the chart-linked function plot: null (gap)
   instead of a runaway spike near asymptotes. */
function fsSafeEval(compiled, scope){
  try{
    var y = compiled.evaluate(scope);
    if(typeof y !== 'number' || !isFinite(y) || Math.abs(y) > 1e6) return null;
    return y;
  }catch(e){ return null; }
}

function fsGetMode(){
  var sel = fsEl('fsMode');
  return sel ? sel.value : 'explicit';
}

/* ===================== KaTeX live preview ===================== */

function fsBuildPreviewLatex(mode){
  if(mode === 'explicit'){
    return 'y = ' + (fsEl('fsExprY') ? fsEl('fsExprY').value.trim() : '');
  }
  if(mode === 'parametric'){
    var xt = fsEl('fsExprXt') ? fsEl('fsExprXt').value.trim() : '';
    var yt = fsEl('fsExprYt') ? fsEl('fsExprYt').value.trim() : '';
    return 'x(t) = ' + xt + ',\\quad y(t) = ' + yt;
  }
  if(mode === 'polar'){
    return 'r(\\theta) = ' + (fsEl('fsExprR') ? fsEl('fsExprR').value.trim() : '');
  }
  if(mode === 'implicit'){
    var expr = fsEl('fsExprImplicit') ? fsEl('fsExprImplicit').value.trim() : '';
    return expr.indexOf('=') === -1 ? expr + ' = 0' : expr;
  }
  if(mode === 'piecewise'){
    var rows = fsPieceRowsData();
    if(!rows.length) return '';
    return '\\begin{cases}' + rows.map(function(r){
      return (r.expr || '\\,') + ' & ' + (r.cond || '\\text{otherwise}');
    }).join('\\\\') + '\\end{cases}';
  }
  return '';
}

function fsUpdatePreview(){
  var box = fsEl('fsKatexPreview');
  if(!box) return;
  var latex = fsBuildPreviewLatex(fsGetMode());
  if(!latex || latex.replace(/[\s=]/g, '') === ''){ box.innerHTML = ''; return; }
  if(window.katex && typeof katex.render === 'function'){
    try{
      katex.render(latex, box, { throwOnError: false, displayMode: false });
    }catch(e){
      box.innerHTML = '';
      var span = document.createElement('span');
      span.className = 'katex-error';
      span.textContent = latex;
      box.appendChild(span);
    }
  } else {
    box.textContent = latex;
  }
}

/* ===================== piecewise rows (dynamic mini-form) ===================== */

function fsPieceRowsData(){
  var out = [];
  document.querySelectorAll('#fsPieceRows .fs-piece-row').forEach(function(row){
    var exprTa = row.querySelector('.fs-piece-expr');
    var condTa = row.querySelector('.fs-piece-cond');
    out.push({ expr: exprTa ? exprTa.value.trim() : '', cond: condTa ? condTa.value.trim() : '' });
  });
  return out;
}

function fsAddPieceRow(expr, cond){
  var wrap = fsEl('fsPieceRows');
  if(!wrap) return;
  var row = document.createElement('div');
  row.className = 'fs-piece-row';

  var exprTa = document.createElement('textarea');
  exprTa.className = 'latex-textarea fs-piece-expr';
  exprTa.spellcheck = false;
  exprTa.placeholder = 'f(x), e.g. x^2';
  exprTa.value = expr || '';
  exprTa.addEventListener('input', fsUpdatePreview);

  var condTa = document.createElement('textarea');
  condTa.className = 'latex-textarea fs-piece-cond';
  condTa.spellcheck = false;
  condTa.placeholder = 'condition, e.g. x<0';
  condTa.value = cond || '';
  condTa.addEventListener('input', fsUpdatePreview);

  var delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'cp-close';
  delBtn.title = 'Remove this piece';
  delBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
  delBtn.addEventListener('click', function(){ row.remove(); fsUpdatePreview(); });

  row.appendChild(exprTa);
  row.appendChild(condTa);
  row.appendChild(delBtn);
  wrap.appendChild(row);
}

/* ===================== CSV import (Advanced mode) ===================== */

function fsCsvShowStatus(kind, msg){
  var el = fsEl('fsCsvStatus');
  if(!el) return;
  if(!msg){ el.className = 'status'; el.textContent = ''; return; }
  el.className = 'status ' + kind;
  el.textContent = msg;
}

/* Same Papa Parse call/shape as parseRawText() in js/chart-builder/04-data.js
   (first row = header, rest = rows) - kept as its own small function here so
   the standalone studio never touches the main chart's state. */
function fsCsvParseText(raw){
  var trimmed = (raw || '').trim();
  if(!trimmed){ fsCsvShowStatus('error', 'Paste or import CSV/TSV data first.'); return; }
  var parsed = Papa.parse(trimmed, { skipEmptyLines: true });
  var rows = parsed.data;
  if(!rows || rows.length < 2){
    fsCsvShowStatus('error', 'Needs at least 1 header row and 1 data row.');
    return;
  }
  fsState.csv.header = rows[0];
  fsState.csv.rows = rows.slice(1);
  fsCsvPopulateColumnSelects();
  fsCsvShowStatus('ok', 'Parsed ' + fsState.csv.rows.length + ' rows, ' + fsState.csv.header.length + ' columns.');
}

function fsCsvPopulateColumnSelects(){
  var xSel = fsEl('fsCsvXCol'), ySel = fsEl('fsCsvYCol'), colsRow = fsEl('fsCsvColsRow');
  if(!xSel || !ySel) return;
  xSel.innerHTML = ''; ySel.innerHTML = '';
  fsState.csv.header.forEach(function(h, i){
    var label = (h && String(h).trim()) || ('Column ' + (i + 1));
    var ox = document.createElement('option'); ox.value = i; ox.textContent = label;
    xSel.appendChild(ox);
    var oy = document.createElement('option'); oy.value = i; oy.textContent = label;
    ySel.appendChild(oy);
  });
  if(ySel.options.length > 1) ySel.selectedIndex = 1;
  if(colsRow) colsRow.style.display = '';
}

function wireCsvImport(){
  var fileInput = fsEl('fsCsvFile');
  var fileBtn = fsEl('fsCsvFileBtn');
  if(fileBtn && fileInput) fileBtn.addEventListener('click', function(){ fileInput.click(); });
  if(fileInput){
    fileInput.addEventListener('change', function(e){
      var file = e.target.files[0];
      if(!file) return;
      var reader = new FileReader();
      reader.onload = function(ev){
        var text = ev.target.result;
        if(fsEl('fsCsvText')) fsEl('fsCsvText').value = text;
        fsCsvParseText(text);
      };
      reader.onerror = function(){ fsCsvShowStatus('error', 'Could not read this file.'); };
      reader.readAsText(file);
    });
  }
  var parseBtn = fsEl('fsCsvParseBtn');
  if(parseBtn) parseBtn.addEventListener('click', function(){
    fsCsvParseText(fsEl('fsCsvText') ? fsEl('fsCsvText').value : '');
  });
}

/* ===================== mode switching (show/hide the right fields) ===================== */

function fsApplyModeVisibility(){
  var mode = fsGetMode();
  document.querySelectorAll('.fs-fields').forEach(function(f){
    f.style.display = (f.getAttribute('data-mode') === mode) ? '' : 'none';
  });
  if(mode === 'piecewise' && fsEl('fsPieceRows') && !fsEl('fsPieceRows').children.length){
    fsAddPieceRow('', '');
    fsAddPieceRow('', '');
  }
  var previewBox = fsEl('fsKatexPreview');
  if(previewBox) previewBox.style.display = (mode === 'csv') ? 'none' : '';
  fsUpdateAddButtonLabel(mode);
  fsUpdatePreview();
}

/* "Plot function" doesn't read right once you're plotting imported data
   points instead of a formula, so the primary button's label follows mode. */
function fsUpdateAddButtonLabel(mode){
  var btn = fsEl('fsAddBtn');
  if(!btn) return;
  var label = mode === 'csv' ? 'Plot data' : 'Plot function';
  btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">add</span> ' + label;
}

/* ===================== trace builders, one per mode ===================== */

function fsBuildExplicitTrace(entry){
  var compiled = math.compile(fnLatexToMathJs(entry.exprY));
  var xMin = fsState.xMin, xMax = fsState.xMax;
  var span = xMax - xMin || 1;
  xMin -= span * 0.04; xMax += span * 0.04;
  var xs = [], ys = [];
  for(var i = 0; i < FS_SAMPLES; i++){
    var x = xMin + (xMax - xMin) * i / (FS_SAMPLES - 1);
    xs.push(x);
    ys.push(fsSafeEval(compiled, { x: x }));
  }
  return [{
    type: 'scatter', mode: 'lines', name: entry.label,
    x: xs, y: ys, connectgaps: false, hoverinfo: 'skip',
    line: { color: entry.color, width: 2.4 }
  }];
}

function fsBuildParametricTrace(entry){
  var xc = math.compile(fnLatexToMathJs(entry.exprXt));
  var yc = math.compile(fnLatexToMathJs(entry.exprYt));
  var tMin = entry.tMin, tMax = entry.tMax;
  var xs = [], ys = [];
  for(var i = 0; i < FS_SAMPLES; i++){
    var t = tMin + (tMax - tMin) * i / (FS_SAMPLES - 1);
    xs.push(fsSafeEval(xc, { t: t }));
    ys.push(fsSafeEval(yc, { t: t }));
  }
  return [{
    type: 'scatter', mode: 'lines', name: entry.label,
    x: xs, y: ys, connectgaps: false, hoverinfo: 'skip',
    line: { color: entry.color, width: 2.4 }
  }];
}

function fsBuildPolarTrace(entry){
  var rc = math.compile(fnLatexToMathJs(entry.exprR));
  var tMin = entry.thetaMin, tMax = entry.thetaMax;
  var xs = [], ys = [];
  for(var i = 0; i < FS_SAMPLES; i++){
    var theta = tMin + (tMax - tMin) * i / (FS_SAMPLES - 1);
    var r = fsSafeEval(rc, { theta: theta, t: theta });
    if(r === null){ xs.push(null); ys.push(null); continue; }
    xs.push(r * Math.cos(theta));
    ys.push(r * Math.sin(theta));
  }
  return [{
    type: 'scatter', mode: 'lines', name: entry.label,
    x: xs, y: ys, connectgaps: false, hoverinfo: 'skip',
    line: { color: entry.color, width: 2.4 }
  }];
}

/* f(x,y) = g(x,y) plotted as the single zero-level contour of (f - g) over
   a sampled grid - the standard trick for an implicit curve without a
   dedicated CAS/solver library. */
function fsBuildImplicitTrace(entry){
  var parts = entry.expr.split('=');
  var lhs = parts[0];
  var rhs = parts.length > 1 ? parts.slice(1).join('=') : '0';
  var lc = math.compile(fnLatexToMathJs(lhs));
  var rc = math.compile(fnLatexToMathJs(rhs));

  var xMin = fsState.xMin, xMax = fsState.xMax, yMin = fsState.yMin, yMax = fsState.yMax;
  var xSpan = (xMax - xMin) || 1, ySpan = (yMax - yMin) || 1;
  xMin -= xSpan * 0.06; xMax += xSpan * 0.06;
  yMin -= ySpan * 0.06; yMax += ySpan * 0.06;

  var n = FS_IMPLICIT_GRID;
  var xs = [], ys = [], z = [];
  for(var i = 0; i < n; i++) xs.push(xMin + (xMax - xMin) * i / (n - 1));
  for(var j = 0; j < n; j++){
    var yv = yMin + (yMax - yMin) * j / (n - 1);
    ys.push(yv);
    var row = [];
    for(i = 0; i < n; i++){
      var l = fsSafeEval(lc, { x: xs[i], y: yv });
      var r = fsSafeEval(rc, { x: xs[i], y: yv });
      row.push((l === null || r === null) ? NaN : (l - r));
    }
    z.push(row);
  }
  return [{
    type: 'contour', x: xs, y: ys, z: z,
    showscale: false, hoverinfo: 'skip', name: entry.label,
    contours: { coloring: 'lines', start: 0, end: 0, size: 1, showlabels: false },
    line: { color: entry.color, width: 2.6 },
    ncontours: 1
  }];
}

function fsBuildPiecewiseTrace(entry){
  var compiled = entry.pieces.map(function(p){
    return { fn: math.compile(fnLatexToMathJs(p.expr)), cond: math.compile(fnLatexToMathJs(p.cond)) };
  });
  var xMin = fsState.xMin, xMax = fsState.xMax;
  var span = xMax - xMin || 1;
  xMin -= span * 0.04; xMax += span * 0.04;
  var xs = [], ys = [];
  var lastPiece = -1;
  for(var i = 0; i < FS_SAMPLES; i++){
    var x = xMin + (xMax - xMin) * i / (FS_SAMPLES - 1);
    var pieceIdx = -1, y = null;
    for(var p = 0; p < compiled.length; p++){
      var ok = false;
      try{ ok = !!compiled[p].cond.evaluate({ x: x }); }catch(e){ ok = false; }
      if(ok){ pieceIdx = p; y = fsSafeEval(compiled[p].fn, { x: x }); break; }
    }
    // Insert a gap when crossing from one piece to another (or into/out of
    // "no piece matches here") so pieces don't get visually joined.
    if(pieceIdx !== lastPiece && lastPiece !== -1){ xs.push(x); ys.push(null); }
    xs.push(x); ys.push(y);
    lastPiece = pieceIdx;
  }
  return [{
    type: 'scatter', mode: 'lines', name: entry.label,
    x: xs, y: ys, connectgaps: false, hoverinfo: 'skip',
    line: { color: entry.color, width: 2.4 }
  }];
}

/* ===================== CSV data mode: regression + trace builder =====================
   "Advanced" plotting of imported field data (e.g. a vegetation index vs. AGC
   scatter). Ordinary least-squares polynomial fit via math.js's dense linear
   solver: build the design matrix X = [1, x, x^2, ... x^degree], solve the
   normal equations (X'X) c = X'y for the coefficient vector c. degree=1 is
   the familiar y = a + bx line; degree 2/3 let a curved response (common for
   saturating vegetation indices) be fit without leaving the browser. */
function fsPolyRegression(xs, ys, degree){
  var n = xs.length;
  var X = [];
  for(var i = 0; i < n; i++){
    var row = [];
    for(var d = 0; d <= degree; d++) row.push(Math.pow(xs[i], d));
    X.push(row);
  }
  var Xt = math.transpose(X);
  var XtX = math.multiply(Xt, X);
  var XtY = math.multiply(Xt, ys);
  var solved = math.lusolve(XtX, XtY);
  return solved.map(function(r){ return Array.isArray(r) ? r[0] : r; });
}

function fsPolyPredict(coeffs, x){
  var y = 0;
  for(var d = 0; d < coeffs.length; d++) y += coeffs[d] * Math.pow(x, d);
  return y;
}

/* Coefficient of determination: 1 - SS_res/SS_tot, same definition used
   throughout the regression/AGC-modeling literature (e.g. R^2 reported
   alongside RMSE for empirical biomass models). */
function fsRSquared(ys, yhat){
  var n = ys.length;
  var mean = ys.reduce(function(a, b){ return a + b; }, 0) / n;
  var ssRes = 0, ssTot = 0;
  for(var i = 0; i < n; i++){
    ssRes += Math.pow(ys[i] - yhat[i], 2);
    ssTot += Math.pow(ys[i] - mean, 2);
  }
  return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
}

function fsFmtCoef(v){
  if(!isFinite(v)) return '0';
  var av = Math.abs(v);
  if(av !== 0 && (av < 1e-3 || av >= 1e5)) return v.toExponential(3);
  return String(Math.round(v * 10000) / 10000);
}

function fsCsvEquationLabel(coeffs){
  var terms = coeffs.map(function(c, d){
    var xPart = d === 0 ? '' : (d === 1 ? 'x' : ('x^' + d));
    var sign = c >= 0 ? (d === 0 ? '' : ' + ') : ' - ';
    return sign + fsFmtCoef(Math.abs(c)) + xPart;
  });
  return 'y = ' + terms.join('');
}

function fsBuildCsvTrace(entry){
  var mode = entry.plotType || 'markers';
  var traces = [{
    type: 'scatter', mode: mode, name: entry.label,
    x: entry.xs, y: entry.ys,
    marker: { color: entry.color, size: 7 },
    line: mode.indexOf('lines') !== -1 ? { color: entry.color, width: 2 } : undefined
  }];

  if(entry.trendMode && entry.trendMode !== 'none' && entry.trendCoeffs){
    var xmin = Math.min.apply(null, entry.xs), xmax = Math.max.apply(null, entry.xs);
    var span = (xmax - xmin) || 1;
    xmin -= span * 0.03; xmax += span * 0.03;
    var N = 100, txs = [], tys = [];
    for(var i = 0; i < N; i++){
      var x = xmin + (xmax - xmin) * i / (N - 1);
      txs.push(x);
      tys.push(fsPolyPredict(entry.trendCoeffs, x));
    }
    var trendName = entry.trendEqLabel + (entry.showEq ? ('  (R\u00B2 = ' + entry.trendR2.toFixed(3) + ')') : '');
    traces.push({
      type: 'scatter', mode: 'lines', name: trendName,
      x: txs, y: tys, hoverinfo: 'skip',
      line: { color: entry.color, width: 2, dash: 'dash' }
    });
  }
  return traces;
}

var FS_TRACE_BUILDERS = {
  explicit: fsBuildExplicitTrace,
  parametric: fsBuildParametricTrace,
  polar: fsBuildPolarTrace,
  implicit: fsBuildImplicitTrace,
  piecewise: fsBuildPiecewiseTrace,
  csv: fsBuildCsvTrace
};

/* ===================== render ===================== */

function fsThemeColor(){
  try{ return getComputedStyle(document.body).color || '#1f2933'; }catch(e){ return '#1f2933'; }
}

function fsBuildAllTraces(){
  var traces = [];
  var anyErrorChanged = false;
  fsState.entries.forEach(function(entry){
    if(entry.visible === false) return;
    var builder = FS_TRACE_BUILDERS[entry.type];
    if(!builder) return;
    try{
      var built = builder(entry);
      if(entry.error) anyErrorChanged = true;
      entry.error = false;
      traces = traces.concat(built);
    }catch(e){
      if(!entry.error) anyErrorChanged = true;
      entry.error = true;
    }
  });
  if(anyErrorChanged) fsRenderList();
  return traces;
}

function renderFuncStudio(){
  var div = fsEl('funcStudioPlot');
  if(!div || typeof Plotly === 'undefined') return;

  var traces = fsBuildAllTraces();
  var gridColor = 'rgba(128,128,128,0.22)';
  var fontColor = fsThemeColor();

  var layout = {
    margin: { l: 52, r: 24, t: 20, b: 44 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    showlegend: traces.length > 0,
    legend: { orientation: 'h', y: -0.14 },
    font: { family: "'Poppins', Arial, sans-serif", size: 12, color: fontColor },
    xaxis: {
      title: 'x', zeroline: true, zerolinewidth: 1.4, zerolinecolor: gridColor,
      showgrid: fsState.showGrid, gridcolor: gridColor,
      range: fsState.autoRange ? undefined : [fsState.xMin, fsState.xMax]
    },
    yaxis: {
      title: 'y', zeroline: true, zerolinewidth: 1.4, zerolinecolor: gridColor,
      showgrid: fsState.showGrid, gridcolor: gridColor,
      range: fsState.autoRange ? undefined : [fsState.yMin, fsState.yMax],
      scaleanchor: fsState.equalAspect ? 'x' : undefined,
      scaleratio: fsState.equalAspect ? 1 : undefined
    }
  };

  var config = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'] };

  if(!fsPlotted){
    Plotly.newPlot(div, traces, layout, config);
    fsPlotted = true;
  } else {
    Plotly.react(div, traces, layout, config);
  }
}

/* Called from 10-view-switcher-init.js the moment the standalone pane is
   actually shown - the Plotly div lives inside a display:none pane before
   that, so its first render/resize has to happen after it's visible. */
function onFuncStudioViewShown(){
  renderFuncStudio();
  setTimeout(function(){
    if(typeof Plotly !== 'undefined' && fsEl('funcStudioPlot')) Plotly.Plots.resize(fsEl('funcStudioPlot'));
  }, 60);
}
window.onFuncStudioViewShown = onFuncStudioViewShown;

/* ===================== list UI (add / toggle / recolor / remove) ===================== */

var FS_MODE_LABELS = {
  explicit: 'y = f(x)', parametric: 'parametric', polar: 'polar',
  implicit: 'implicit', piecewise: 'piecewise', csv: 'CSV data'
};

function fsEntryDisplayLabel(entry){
  if(entry.type === 'explicit') return 'y = ' + entry.exprY;
  if(entry.type === 'parametric') return 'x=' + entry.exprXt + ', y=' + entry.exprYt;
  if(entry.type === 'polar') return 'r=' + entry.exprR;
  if(entry.type === 'implicit') return entry.expr;
  if(entry.type === 'piecewise') return entry.pieces.map(function(p){ return p.expr + ' if ' + p.cond; }).join('; ');
  if(entry.type === 'csv'){
    var base = entry.label;
    if(entry.trendMode && entry.trendMode !== 'none' && entry.trendEqLabel){
      base += ' - trend: ' + entry.trendEqLabel + (entry.trendR2 != null ? (' (R\u00B2=' + entry.trendR2.toFixed(3) + ')') : '');
    }
    return base;
  }
  return '';
}

function fsRenderList(){
  var wrap = fsEl('fsList');
  if(!wrap) return;
  wrap.innerHTML = '';

  if(!fsState.entries.length){
    var empty = document.createElement('div');
    empty.className = 'fn-item-empty';
    empty.textContent = 'No functions added yet.';
    wrap.appendChild(empty);
    return;
  }

  fsState.entries.forEach(function(entry){
    var item = document.createElement('div');
    item.className = 'fn-item' + (entry.error ? ' fn-item-error' : '');

    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = entry.visible !== false;
    cb.title = 'Show/hide this curve';
    cb.addEventListener('change', function(){ entry.visible = cb.checked; renderFuncStudio(); });

    var swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = entry.color;
    swatch.title = 'Click to change color';
    swatch.addEventListener('click', function(){ colorInput.click(); });

    var colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = entry.color;
    colorInput.style.display = 'none';
    colorInput.addEventListener('input', function(){
      entry.color = colorInput.value;
      swatch.style.background = entry.color;
      renderFuncStudio();
    });

    var formula = document.createElement('div');
    formula.className = 'fn-item-formula';
    formula.textContent = '[' + FS_MODE_LABELS[entry.type] + '] ' + fsEntryDisplayLabel(entry);
    formula.title = entry.error ? 'Could not evaluate this - it is hidden from the plot.' : formula.textContent;

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'cp-close';
    delBtn.title = 'Remove this function';
    delBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
    delBtn.addEventListener('click', function(){
      fsState.entries = fsState.entries.filter(function(e){ return e.id !== entry.id; });
      fsRenderList();
      renderFuncStudio();
    });

    item.appendChild(cb);
    item.appendChild(swatch);
    item.appendChild(colorInput);
    item.appendChild(formula);
    item.appendChild(delBtn);
    wrap.appendChild(item);
  });
}

/* ===================== add-from-form (validates, then pushes an entry) ===================== */

function fsAddFromForm(){
  var mode = fsGetMode();
  var color = (fsEl('fsColor') && fsEl('fsColor').value) || '#2563eb';
  var entry = { id: 'fs' + (++fsIdCounter) + '_' + Date.now(), type: mode, color: color, visible: true, error: false };

  try{
    if(mode === 'explicit'){
      var exprY = (fsEl('fsExprY').value || '').trim();
      if(!exprY) throw new Error('Type a function first, e.g. \\sin(x) or x^2.');
      var c1 = math.compile(fnLatexToMathJs(exprY));
      c1.evaluate({ x: fsState.xMin });
      entry.exprY = exprY;
      entry.label = 'y = ' + exprY;

    } else if(mode === 'parametric'){
      var xt = (fsEl('fsExprXt').value || '').trim();
      var yt = (fsEl('fsExprYt').value || '').trim();
      if(!xt || !yt) throw new Error('Enter both x(t) and y(t).');
      var tMin = parseFloat(fsEl('fsTMin').value); if(!isFinite(tMin)) tMin = 0;
      var tMax = parseFloat(fsEl('fsTMax').value); if(!isFinite(tMax)) tMax = 2 * Math.PI;
      var cx = math.compile(fnLatexToMathJs(xt)); cx.evaluate({ t: tMin });
      var cy = math.compile(fnLatexToMathJs(yt)); cy.evaluate({ t: tMin });
      entry.exprXt = xt; entry.exprYt = yt; entry.tMin = tMin; entry.tMax = tMax;
      entry.label = 'x(t)=' + xt + ', y(t)=' + yt;

    } else if(mode === 'polar'){
      var rExpr = (fsEl('fsExprR').value || '').trim();
      if(!rExpr) throw new Error('Type r(\u03B8) first, e.g. 1 + \\cos(\\theta).');
      var thMin = parseFloat(fsEl('fsThetaMin').value); if(!isFinite(thMin)) thMin = 0;
      var thMax = parseFloat(fsEl('fsThetaMax').value); if(!isFinite(thMax)) thMax = 2 * Math.PI;
      var cr = math.compile(fnLatexToMathJs(rExpr)); cr.evaluate({ theta: thMin, t: thMin });
      entry.exprR = rExpr; entry.thetaMin = thMin; entry.thetaMax = thMax;
      entry.label = 'r=' + rExpr;

    } else if(mode === 'implicit'){
      var implicitExpr = (fsEl('fsExprImplicit').value || '').trim();
      if(!implicitExpr) throw new Error('Type an equation first, e.g. x^2 + y^2 = 4.');
      var parts = implicitExpr.split('=');
      var lhs = parts[0], rhs = parts.length > 1 ? parts.slice(1).join('=') : '0';
      var cl = math.compile(fnLatexToMathJs(lhs)); cl.evaluate({ x: 0, y: 0 });
      var crh = math.compile(fnLatexToMathJs(rhs)); crh.evaluate({ x: 0, y: 0 });
      entry.expr = implicitExpr;
      entry.label = implicitExpr.indexOf('=') === -1 ? implicitExpr + ' = 0' : implicitExpr;

    } else if(mode === 'piecewise'){
      var rows = fsPieceRowsData().filter(function(r){ return r.expr && r.cond; });
      if(!rows.length) throw new Error('Add at least one piece with both a formula and a condition.');
      rows.forEach(function(r){
        var cf = math.compile(fnLatexToMathJs(r.expr)); cf.evaluate({ x: 0 });
        var cc = math.compile(fnLatexToMathJs(r.cond)); cc.evaluate({ x: 0 });
      });
      entry.pieces = rows;
      entry.label = 'piecewise (' + rows.length + ' pieces)';

    } else if(mode === 'csv'){
      if(!fsState.csv.rows.length) throw new Error('Import a CSV file or click "Parse pasted data" first.');
      var xColIdx = parseInt(fsEl('fsCsvXCol').value, 10);
      var yColIdx = parseInt(fsEl('fsCsvYCol').value, 10);
      if(!isFinite(xColIdx) || !isFinite(yColIdx)) throw new Error('Pick an X and Y column.');

      var xs = [], ys = [];
      fsState.csv.rows.forEach(function(r){
        var xv = parseFloat(r[xColIdx]), yv = parseFloat(r[yColIdx]);
        if(isFinite(xv) && isFinite(yv)){ xs.push(xv); ys.push(yv); }
      });
      if(xs.length < 2) throw new Error('Need at least 2 numeric rows for the chosen X/Y columns.');

      var xLabel = fsState.csv.header[xColIdx] || ('Column ' + (xColIdx + 1));
      var yLabel = fsState.csv.header[yColIdx] || ('Column ' + (yColIdx + 1));
      var plotType = (fsEl('fsCsvPlotType') && fsEl('fsCsvPlotType').value) || 'markers';
      var trendMode = (fsEl('fsCsvTrend') && fsEl('fsCsvTrend').value) || 'none';
      var showEq = fsEl('fsCsvShowEq') ? fsEl('fsCsvShowEq').checked : true;

      entry.xs = xs; entry.ys = ys;
      entry.xLabel = xLabel; entry.yLabel = yLabel;
      entry.plotType = plotType; entry.trendMode = trendMode; entry.showEq = showEq;
      entry.label = yLabel + ' vs ' + xLabel + ' (n=' + xs.length + ')';

      if(trendMode !== 'none'){
        var degree = trendMode === 'linear' ? 1 : (trendMode === 'poly2' ? 2 : 3);
        if(xs.length <= degree) throw new Error('Need more than ' + degree + ' data points to fit a degree-' + degree + ' trendline.');
        var coeffs = fsPolyRegression(xs, ys, degree);
        var yhat = xs.map(function(x){ return fsPolyPredict(coeffs, x); });
        entry.trendCoeffs = coeffs;
        entry.trendR2 = fsRSquared(ys, yhat);
        entry.trendEqLabel = fsCsvEquationLabel(coeffs);
      }
    }
  }catch(e){
    fsShowStatus('error', 'Could not parse: ' + (e && e.message ? e.message : 'invalid expression.'));
    return;
  }

  fsState.entries.push(entry);
  fsShowStatus(null);
  fsRenderList();
  renderFuncStudio();

  // Clear the inputs that were just used, keep the mode selected as-is.
  if(mode === 'explicit') fsEl('fsExprY').value = '';
  if(mode === 'parametric'){ fsEl('fsExprXt').value = ''; fsEl('fsExprYt').value = ''; }
  if(mode === 'polar') fsEl('fsExprR').value = '';
  if(mode === 'implicit') fsEl('fsExprImplicit').value = '';
  if(mode === 'piecewise'){ fsEl('fsPieceRows').innerHTML = ''; fsAddPieceRow(''); fsAddPieceRow(''); }
  // mode === 'csv': deliberately don't clear the imported data/column pickers -
  // it's common to plot the same dataset again with a different Y column or
  // trendline right after.
  fsUpdatePreview();
}

/* ===================== toolbar wiring: range / grid / aspect / export ===================== */

function fsSyncRangeInputsToState(){
  var xMin = parseFloat(fsEl('fsXMin').value); if(isFinite(xMin)) fsState.xMin = xMin;
  var xMax = parseFloat(fsEl('fsXMax').value); if(isFinite(xMax)) fsState.xMax = xMax;
  var yMin = parseFloat(fsEl('fsYMin').value); if(isFinite(yMin)) fsState.yMin = yMin;
  var yMax = parseFloat(fsEl('fsYMax').value); if(isFinite(yMax)) fsState.yMax = yMax;
}

function fsDownload(url, filename){
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function fsExport(format){
  var div = fsEl('funcStudioPlot');
  if(!div || typeof Plotly === 'undefined') return;
  Plotly.toImage(div, { format: format, width: 1200, height: 800, scale: format === 'png' ? 3 : 1 })
    .then(function(url){ fsDownload(url, 'function_plot.' + format); })
    .catch(function(){ fsShowStatus('error', 'Export failed - try again.'); });
}

function wireFuncStudioPanel(){
  var modeSel = fsEl('fsMode');
  if(modeSel) modeSel.addEventListener('change', fsApplyModeVisibility);

  ['fsExprY', 'fsExprXt', 'fsExprYt', 'fsExprR', 'fsExprImplicit'].forEach(function(id){
    var el = fsEl(id);
    if(el) el.addEventListener('input', fsUpdatePreview);
  });

  var addBtn = fsEl('fsAddBtn');
  if(addBtn) addBtn.addEventListener('click', fsAddFromForm);

  var addPieceBtn = fsEl('fsAddPieceRow');
  if(addPieceBtn) addPieceBtn.addEventListener('click', function(){ fsAddPieceRow('', ''); fsUpdatePreview(); });

  wireCsvImport();

  ['fsXMin', 'fsXMax', 'fsYMin', 'fsYMax'].forEach(function(id){
    var el = fsEl(id);
    if(el) el.addEventListener('change', function(){
      fsSyncRangeInputsToState();
      fsState.autoRange = false;
      var autoBtn = fsEl('fsAutoRangeBtn');
      if(autoBtn) autoBtn.classList.remove('fs-active');
      renderFuncStudio();
    });
  });

  var autoBtn = fsEl('fsAutoRangeBtn');
  if(autoBtn){
    autoBtn.classList.add('fs-active');
    autoBtn.addEventListener('click', function(){
      fsState.autoRange = !fsState.autoRange;
      autoBtn.classList.toggle('fs-active', fsState.autoRange);
      renderFuncStudio();
    });
  }

  var gridBtn = fsEl('fsGridToggle');
  if(gridBtn){
    gridBtn.classList.add('fs-active');
    gridBtn.addEventListener('click', function(){
      fsState.showGrid = !fsState.showGrid;
      gridBtn.classList.toggle('fs-active', fsState.showGrid);
      renderFuncStudio();
    });
  }

  var aspectBtn = fsEl('fsAspectToggle');
  if(aspectBtn){
    aspectBtn.addEventListener('click', function(){
      fsState.equalAspect = !fsState.equalAspect;
      aspectBtn.classList.toggle('fs-active', fsState.equalAspect);
      renderFuncStudio();
    });
  }

  var pngBtn = fsEl('fsExportPng');
  if(pngBtn) pngBtn.addEventListener('click', function(){ fsExport('png'); });

  var svgBtn = fsEl('fsExportSvg');
  if(svgBtn) svgBtn.addEventListener('click', function(){ fsExport('svg'); });

  fsApplyModeVisibility();
  fsRenderList();
}

wireFuncStudioPanel();
