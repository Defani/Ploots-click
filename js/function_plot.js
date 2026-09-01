/* ===================== FUNCTION PLOT =====================
   Sidebar panel (#panel-plot) that lets the user type one or more
   functions y = f(x) using a practical LaTeX-like subset (\frac, \sqrt,
   \sin/\cos/..., ^, \pi, \cdot, \ln/\log, implicit multiplication like
   "2x"), evaluated numerically with math.js.

   Each added function is kept in state.functionPlots and drawn as a real
   extra trace on the CHART'S OWN Plotly axes (see buildFunctionPlotTraces()
   below, called from 07-render.js for line/area/scatter charts) - not as a
   separate floating object on the Layout canvas. This means a plotted
   function always stays lined up with the actual data: it re-samples
   itself every render() call, so editing the data, resizing the chart, or
   changing the axis range all keep the curve in sync automatically.

   Kept as its OWN sidebar panel/menu (#panel-plot), separate from
   "LaTeX Editor & Symbols" (#panel-latex): that panel only typesets a
   formula as static text/symbols, it never evaluates anything. This panel
   is for actually plotting a function's curve from a formula.

   This is not a full LaTeX parser or CAS - only expressions that reduce to
   a single-variable numeric function of x can be plotted. Things like
   \int, \sum, \lim, or matrices can still be *typeset* in the LaTeX Editor
   panel, they just can't be evaluated into a curve here.

   Only meaningful on chart types with a continuous-ish cartesian X axis -
   line, area, scatter (the same set buildRegressionTrace() in
   05-style-helpers.js already targets). Depends on math.js (loaded in
   index.html) to evaluate the expression; degrades gracefully (returns no
   traces / shows a hint) if math.js isn't ready yet or the chart type
   doesn't support it. */

var FN_PLOT_CHART_TYPES = ['line', 'area', 'scatter'];
var FN_PLOT_SAMPLES = 300;
var fnPlotIdCounter = 0;

/* Callable math.js function/constant names - used below to tell "sin(" (a
   function call, leave alone) apart from "x(" or "2(" (implicit
   multiplication, needs a "*" inserted). */
var FN_KNOWN_NAMES = [
  'sin','cos','tan','cot','sec','csc',
  'asin','acos','atan','acot','asec','acsc',
  'sinh','cosh','tanh','coth','sech','csch',
  'sqrt','nthRoot','log','log10','log2','abs','exp','floor','ceil','round','sign'
];

function fnPlotGetInput(){ return document.getElementById('plotFnInput'); }

function showFnPlotStatus(kind, msg){
  var el = document.getElementById('plotStatus');
  if(!el) return;
  if(!msg){ el.className = 'status'; el.textContent = ''; return; }
  el.className = 'status ' + kind;
  el.textContent = msg;
}

/* ===================== LaTeX-ish -> math.js expression translation ===================== */

/* str[openIdx] must be '{'. Returns the balanced-brace content and the
   index right after the closing '}' (best-effort if unterminated). */
function fnExtractBraceGroup(str, openIdx){
  var depth = 0;
  for(var i = openIdx; i < str.length; i++){
    if(str[i] === '{') depth++;
    else if(str[i] === '}'){
      depth--;
      if(depth === 0) return { content: str.slice(openIdx + 1, i), next: i + 1 };
    }
  }
  return { content: str.slice(openIdx + 1), next: str.length };
}

/* Replaces every "\cmd{A}" occurrence with wrap(A). Any nested commands
   inside A are left untouched here - they get picked up on the next full
   pass over the string by the caller (e.g. \frac inside a \sqrt). */
function fnReplaceBraceCommand(str, cmd, wrap){
  var out = '';
  var guard = 0;
  while(guard++ < 200){
    var idx = str.indexOf(cmd);
    if(idx === -1) break;
    var braceIdx = idx + cmd.length;
    if(str[braceIdx] !== '{'){
      // Not actually followed by a group - move past this occurrence only.
      out += str.slice(0, idx + cmd.length);
      str = str.slice(idx + cmd.length);
      continue;
    }
    var grp = fnExtractBraceGroup(str, braceIdx);
    out += str.slice(0, idx) + wrap(grp.content);
    str = str.slice(grp.next);
  }
  return out + str;
}

function fnLatexToMathJs(src){
  var s = src.trim();

  s = s.replace(/\\left|\\right/g, '');

  // \frac{a}{b} -> ((a)/(b))  - two consecutive brace groups
  var guard = 0;
  while(s.indexOf('\\frac{') !== -1 && guard++ < 100){
    var idx = s.indexOf('\\frac{');
    var g1 = fnExtractBraceGroup(s, idx + 5);
    var restTrimmed = s.slice(g1.next).replace(/^\s+/, '');
    if(restTrimmed[0] !== '{') break; // malformed \frac - bail, let the parser surface an error
    var g2start = s.indexOf('{', g1.next);
    var g2 = fnExtractBraceGroup(s, g2start);
    s = s.slice(0, idx) + '((' + g1.content + ')/(' + g2.content + '))' + s.slice(g2.next);
  }

  // \sqrt[n]{a} -> nthRoot((a),(n))
  guard = 0;
  while(s.indexOf('\\sqrt[') !== -1 && guard++ < 100){
    var i2 = s.indexOf('\\sqrt[');
    var closeBr = s.indexOf(']', i2);
    if(closeBr === -1) break;
    var n = s.slice(i2 + 6, closeBr);
    if(s[closeBr + 1] !== '{') break;
    var g = fnExtractBraceGroup(s, closeBr + 1);
    s = s.slice(0, i2) + 'nthRoot((' + g.content + '),(' + n + '))' + s.slice(g.next);
  }

  // \sqrt{a} -> sqrt((a))
  s = fnReplaceBraceCommand(s, '\\sqrt', function(a){ return 'sqrt((' + a + '))'; });

  // \log_{b}{x} / \log_{b}(x) -> log((x),(b));  \log_b(x) (bare subscript) -> same
  s = s.replace(/\\log_\{([^{}]+)\}\s*\{([^{}]+)\}/g, function(_, b, x){ return 'log((' + x + '),(' + b + '))'; });
  s = s.replace(/\\log_\{([^{}]+)\}\s*\(([^()]+)\)/g, function(_, b, x){ return 'log((' + x + '),(' + b + '))'; });
  s = s.replace(/\\log_(\w+)\s*\(([^()]*)\)/g, function(_, b, x){ return 'log((' + x + '),(' + b + '))'; });

  // Named functions: strip the backslash, translate the handful math.js
  // spells differently. Plain \log (no subscript) is treated as log base 10,
  // the common textbook convention; \ln is natural log.
  var FN_MAP = {
    'sin':'sin', 'cos':'cos', 'tan':'tan', 'cot':'cot', 'sec':'sec', 'csc':'csc',
    'arcsin':'asin', 'arccos':'acos', 'arctan':'atan',
    'sinh':'sinh', 'cosh':'cosh', 'tanh':'tanh',
    'ln':'log', 'exp':'exp', 'abs':'abs', 'floor':'floor', 'ceil':'ceil', 'round':'round',
    'log':'log10'
  };
  Object.keys(FN_MAP).forEach(function(k){
    s = s.replace(new RegExp('\\\\' + k + '(?![a-zA-Z])', 'g'), FN_MAP[k]);
  });

  s = s.replace(/\\pi(?![a-zA-Z])/g, 'pi');
  // \theta -> theta: kept as a plain variable name (not evaluated by
  // math.js as a constant) so the Function Plot Studio's polar mode
  // (r(theta)) can bind it via compiled.evaluate({ theta: ... }). Must run
  // before the catch-all backslash-command stripper below, or the whole
  // "\theta" token (backslash *and* the variable name) would be deleted.
  s = s.replace(/\\theta(?![a-zA-Z])/g, 'theta');
  s = s.replace(/\\cdot/g, '*');
  s = s.replace(/\\times/g, '*');
  s = s.replace(/\\div/g, '/');

  // Any remaining {...} groups (leftover exponent braces, etc.) become (...)
  s = s.split('{').join('(').split('}').join(')');

  // Drop stray backslashes from anything else unrecognized (e.g. spacing
  // commands like \, or \;) - best effort, lets the rest of the text through.
  s = s.replace(/\\[a-zA-Z]+/g, '').replace(/\\/g, '');

  // Implicit multiplication: "2x" -> "2*x", "3(" -> "3*(", ")(" -> ")*(",
  // ")2" -> ")*2", ")x" -> ")*x". Known function names (e.g. "log10(",
  // "sin(") are protected first so a digit inside the name itself (the
  // "10" in "log10") never gets mistaken for implicit multiplication.
  var fnProtected = [];
  s = s.replace(/([a-zA-Z][a-zA-Z0-9]*)\(/g, function(m, name){
    if(FN_KNOWN_NAMES.indexOf(name) === -1) return m;
    fnProtected.push(name);
    return '\u0001' + (fnProtected.length - 1) + '\u0002(';
  });

  s = s.replace(/(\d)\s*([a-zA-Z(])/g, '$1*$2');
  s = s.replace(/\)\s*([a-zA-Z0-9(])/g, ')*$1');
  // Whatever letter-run + "(" is left at this point is NOT a known function
  // (those were already protected above), so it's always a bare variable
  // next to parentheses, e.g. "x(x+1)" -> "x*(x+1)".
  s = s.replace(/([a-zA-Z][a-zA-Z0-9]*)\(/g, function(m, name){ return name + '*('; });

  s = s.replace(/\u0001(\d+)\u0002/g, function(_, idx){ return fnProtected[parseInt(idx, 10)]; });

  return s.trim();
}

/* ===================== Chart-integrated trace building ===================== */

/* If every current chart category parses as a finite number, returns that
   parsed array (so the function can be sampled continuously across the
   actual numeric axis range). Returns null for category-style axes (e.g.
   month names) - callers fall back to evaluating at each category's index
   instead, the same way buildRegressionTrace() (05-style-helpers.js)
   already handles non-numeric X. */
function fnPlotNumericCategories(){
  if(!state.categories || !state.categories.length) return null;
  var nums = state.categories.map(function(c){ return parseFloat(c); });
  var allFinite = nums.every(function(n){ return isFinite(n); });
  return allFinite ? nums : null;
}

/* Builds one Plotly trace per visible, valid function in state.functionPlots,
   sampled against the CURRENT chart's actual X domain - continuous samples
   for a numeric axis, or one evaluation per category tick for a category
   axis. Called from 07-render.js inside the line/area and scatter cases
   only (FN_PLOT_CHART_TYPES). Also updates each entry's `.error` flag live,
   which renderFnPlotList() reads to show an inline error state. */
function buildFunctionPlotTraces(bodyFont, bodySize, legendGroup){
  if(FN_PLOT_CHART_TYPES.indexOf(state.chartType) === -1) return [];
  if(typeof math === 'undefined') return [];
  var list = state.functionPlots || [];
  if(!list.length) return [];

  var numericX = fnPlotNumericCategories();
  var traces = [];
  var anyErrorChanged = false;

  list.forEach(function(fp){
    if(fp.visible === false || !fp.expr || !fp.expr.trim()){ return; }

    var compiled;
    try{
      compiled = math.compile(fnLatexToMathJs(fp.expr));
      // Sanity check with a representative x - surfaces obvious errors
      // (unknown symbols, bad syntax) without waiting on a full sample pass.
      var probeX = numericX ? numericX[0] : 0;
      compiled.evaluate({ x: probeX });
    }catch(e){
      if(!fp.error) anyErrorChanged = true;
      fp.error = true;
      return;
    }
    if(fp.error) anyErrorChanged = true;
    fp.error = false;

    var xs = [], ys = [];
    if(numericX){
      var xMin = Math.min.apply(null, numericX);
      var xMax = Math.max.apply(null, numericX);
      if(xMin === xMax){ xMin -= 1; xMax += 1; }
      var span = xMax - xMin;
      // Sample a touch beyond the data's own range so the curve doesn't
      // visibly stop short of the chart's auto-fit axis padding.
      xMin -= span * 0.04; xMax += span * 0.04;
      for(var i = 0; i < FN_PLOT_SAMPLES; i++){
        var x = xMin + (xMax - xMin) * i / (FN_PLOT_SAMPLES - 1);
        xs.push(x);
        ys.push(fnPlotSafeEval(compiled, x));
      }
    } else {
      // Category axis (e.g. month names): evaluate once per existing tick,
      // at its index position, so the curve lands exactly on each category
      // the same way the regression trend line already does.
      state.categories.forEach(function(cat, idx){
        xs.push(cat);
        ys.push(fnPlotSafeEval(compiled, idx));
      });
    }

    traces.push({
      type: 'scatter', mode: 'lines',
      name: 'f(x) = ' + fp.expr,
      x: xs, y: ys,
      line: { color: fp.color || '#e11d48', width: 2.2, dash: 'solid', shape: numericX ? 'linear' : 'spline' },
      connectgaps: false,
      hoverinfo: 'skip',
      legend: legendGroup || 'legend'
    });
  });

  if(anyErrorChanged && typeof renderFnPlotList === 'function') renderFnPlotList();
  return traces;
}

function fnPlotSafeEval(compiled, x){
  try{
    var y = compiled.evaluate({ x: x });
    if(typeof y !== 'number' || !isFinite(y) || Math.abs(y) > 1e6) return null; // gap, not a runaway spike
    return y;
  }catch(e){ return null; }
}

/* ===================== Panel UI: add / list / remove ===================== */

function fnPlotIsChartTypeSupported(){
  return FN_PLOT_CHART_TYPES.indexOf(state.chartType) !== -1;
}

/* Called on init and whenever chart type changes (09-event-wiring.js) - the
   panel body is unusable on chart types with no continuous X axis to draw
   on (bar, pie, heatmap, etc.), so it's swapped for an explanatory hint
   instead of silently doing nothing. */
function updateFnPlotVisibility(){
  var hint = document.getElementById('fnPlotUnsupportedHint');
  var body = document.getElementById('fnPlotBody');
  var supported = fnPlotIsChartTypeSupported();
  if(hint) hint.style.display = supported ? 'none' : '';
  if(body) body.style.display = supported ? '' : 'none';
}

function renderFnPlotList(){
  var wrap = document.getElementById('fnPlotList');
  if(!wrap) return;
  wrap.innerHTML = '';

  var list = state.functionPlots || [];
  if(!list.length){
    var empty = document.createElement('div');
    empty.className = 'fn-item-empty';
    empty.textContent = 'No functions added yet.';
    wrap.appendChild(empty);
    return;
  }

  list.forEach(function(fp){
    var item = document.createElement('div');
    item.className = 'fn-item' + (fp.error ? ' fn-item-error' : '');

    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = fp.visible !== false;
    cb.title = 'Show/hide this curve on the chart';
    cb.addEventListener('change', function(){ fp.visible = cb.checked; render(); });

    var swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = fp.color;
    swatch.title = 'Click to change color';
    swatch.addEventListener('click', function(){ colorInput.click(); });

    var colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = fp.color;
    colorInput.style.display = 'none';
    colorInput.addEventListener('input', function(){
      fp.color = colorInput.value;
      swatch.style.background = fp.color;
      render();
    });

    var formula = document.createElement('div');
    formula.className = 'fn-item-formula';
    formula.textContent = 'f(x) = ' + fp.expr;
    formula.title = fp.error
      ? 'Could not evaluate this expression - it is hidden from the chart.'
      : fp.expr;

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'cp-close';
    delBtn.title = 'Remove this function';
    delBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
    delBtn.addEventListener('click', function(){
      state.functionPlots = state.functionPlots.filter(function(x){ return x.id !== fp.id; });
      renderFnPlotList();
      render();
    });

    item.appendChild(cb);
    item.appendChild(swatch);
    item.appendChild(colorInput);
    item.appendChild(formula);
    item.appendChild(delBtn);
    wrap.appendChild(item);
  });
}

function fnPlotAddFromInput(){
  var ta = fnPlotGetInput();
  var colorEl = document.getElementById('plotFnColor');
  if(!ta) return;
  var expr = ta.value.trim();
  if(!expr){
    showFnPlotStatus('error', 'Type a function first, e.g. \\sin(x) or x^2.');
    return;
  }
  // Fail fast on obviously invalid input, with the current chart's actual
  // X domain used for the probe point (falls back to 0 for category axes).
  try{
    var compiled = math.compile(fnLatexToMathJs(expr));
    var numericX = fnPlotNumericCategories();
    compiled.evaluate({ x: numericX ? numericX[0] : 0 });
  }catch(e){
    showFnPlotStatus('error', 'Could not parse: ' + (e && e.message ? e.message : 'invalid expression.'));
    return;
  }
  state.functionPlots.push({
    id: 'fn' + (++fnPlotIdCounter) + '_' + Date.now(),
    expr: expr,
    color: (colorEl && colorEl.value) || '#e11d48',
    visible: true,
    error: false
  });
  ta.value = '';
  showFnPlotStatus(null);
  renderFnPlotList();
  render();
}

/* ===================== UI wiring ===================== */

function wireFnPlotPanel(){
  var addBtn = document.getElementById('plotFnAdd');
  if(addBtn) addBtn.addEventListener('click', fnPlotAddFromInput);

  var ta = fnPlotGetInput();
  if(ta){
    ta.addEventListener('keydown', function(e){
      // Enter adds the function (Shift+Enter still allows a literal newline,
      // though a single-line formula is the expected case).
      if(e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        fnPlotAddFromInput();
      }
    });
  }

  updateFnPlotVisibility();
  renderFnPlotList();
}

wireFnPlotPanel();
