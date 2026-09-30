/* ==========================================================================
   Figma-style color picker popover (#cpPanel).

   openColorPicker({
     title, hex, alpha, showAlpha, anchorBtn,
     onChange(hex, alpha),          // solid color edits (all existing callers)
     onClose(),
     allowGradient: true,           // show the Solid / Gradient switch
     gradient: {type, angle, stops:[{offset, hex, a}]},  // open in gradient mode
     onGradient(gradient)           // gradient edits
   })

   Gradients are plain objects; cpGradientToFabric / cpGradientFromFabric /
   cpGradientCss convert them for Fabric objects and CSS previews.
   ========================================================================== */

var CP_SWATCH_KEY = "simplePlotsColorSwatches";
var CP_RECENT_KEY = "simplePlotsColorRecents";
var CP_LIB_KEY = "simplePlotsColorLibSource";
var CP_RECENT_MAX = 16;
var CP_PRESETS = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#d9d9d9", "#efefef", "#ffffff",
  "#e2555a", "#e08a3c", "#e8c14a", "#8fbf4f", "#7fc2d9", "#3f8f8a", "#4e8a2e", "#c96fa8",
  "#0d3b66", "#1d3557", "#264653", "#2a9d8f", "#e9c46a", "#f4a261", "#e76f51", "#6d597a"
];

var cp = {
  open: false, h: 0, s: 0, v: 0, a: 1, showAlpha: true,
  onChange: null, onClose: null, onGradient: null, anchorBtn: null,
  format: "hex", mode: "solid", allowGradient: false,
  grad: null, sel: 0
};

function cpClamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function $cp(id) { return document.getElementById(id); }

/* ---------- color math ---------- */
function cpHexToRgb(hex) {
  hex = (hex || "").trim().replace("#", "");
  if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join("");
  if (hex.length !== 6 && hex.length !== 8) return null;
  var r = parseInt(hex.substr(0, 2), 16), g = parseInt(hex.substr(2, 2), 16), b = parseInt(hex.substr(4, 2), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  var out = { r: r, g: g, b: b };
  if (hex.length === 8) {
    var a = parseInt(hex.substr(6, 2), 16);
    if (!isNaN(a)) out.a = a / 255;
  }
  return out;
}
function cpComp(v) { var s = cpClamp(Math.round(v), 0, 255).toString(16); return s.length === 1 ? "0" + s : s; }
function cpRgbToHex(r, g, b) { return "#" + cpComp(r) + cpComp(g) + cpComp(b); }

function cpRgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6 * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  if (h < 0) h += 360;
  return { h: h, s: max === 0 ? 0 : d / max, v: max };
}
function cpHsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return { r: 255 * (r + m), g: 255 * (g + m), b: 255 * (b + m) };
}
function cpRgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0, s = 0, l = (max + min) / 2;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d) % 6 * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  if (h < 0) h += 360;
  return { h: h, s: s, l: l };
}
function cpHslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return { r: 255 * (r + m), g: 255 * (g + m), b: 255 * (b + m) };
}

// Parses "#rgb", "#rrggbb(aa)", "rgb(...)" and "rgba(...)" into {r,g,b,a}.
function cpParseColor(str) {
  if (typeof str !== "string") return null;
  var m = str.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    var p = m[1].split(",").map(function (v) { return parseFloat(v); });
    return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0, a: p.length > 3 && !isNaN(p[3]) ? p[3] : 1 };
  }
  var rgb = cpHexToRgb(str);
  if (!rgb) return null;
  if (typeof rgb.a !== "number") rgb.a = 1;
  return rgb;
}
function cpRgba(hex, a) {
  var c = cpHexToRgb(hex) || { r: 0, g: 0, b: 0 };
  return "rgba(" + Math.round(c.r) + "," + Math.round(c.g) + "," + Math.round(c.b) + "," + Math.round(cpClamp(a, 0, 1) * 1000) / 1000 + ")";
}

function cpCurrentRgb() { return cpHsvToRgb(cp.h, cp.s, cp.v); }
function cpCurrentHex() { var c = cpCurrentRgb(); return cpRgbToHex(c.r, c.g, c.b); }

function cpSetFromHex(str, alpha) {
  var rgb = cpParseColor(str);
  if (!rgb) return false;
  var hsv = cpRgbToHsv(rgb.r, rgb.g, rgb.b);
  // Keep the hue while dragging through greys/black so the thumb doesn't jump.
  if (hsv.s > 0 && hsv.v > 0) cp.h = hsv.h;
  cp.s = hsv.s; cp.v = hsv.v;
  cp.a = typeof alpha === "number" ? cpClamp(alpha, 0, 1) : rgb.a;
  return true;
}

/* ---------- gradient model <-> Fabric / CSS ---------- */
function cpDefaultGradient(hex, a) {
  return { type: "linear", angle: 90, stops: [{ offset: 0, hex: hex || "#d9d9d9", a: a == null ? 1 : a }, { offset: 1, hex: "#737373", a: 1 }] };
}
function cpSortedStops(g) {
  return g.stops.slice().sort(function (x, y) { return x.offset - y.offset; });
}
function cpGradientCss(g, forceLinear) {
  var stops = cpSortedStops(g).map(function (s) { return cpRgba(s.hex, s.a) + " " + Math.round(s.offset * 1000) / 10 + "%"; }).join(",");
  if (g.type === "radial" && !forceLinear) return "radial-gradient(circle," + stops + ")";
  return "linear-gradient(" + ((forceLinear ? 90 : g.angle + 90)) + "deg," + stops + ")";
}
// angle: 0 = left -> right, 90 = top -> bottom (Figma/CSS convention minus 90).
function cpGradientToFabric(g) {
  var coords;
  if (g.type === "radial") {
    coords = { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.5 };
  } else {
    var rad = g.angle * Math.PI / 180, dx = Math.cos(rad) / 2, dy = Math.sin(rad) / 2;
    coords = { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy };
  }
  return new fabric.Gradient({
    type: g.type === "radial" ? "radial" : "linear",
    gradientUnits: "percentage",
    coords: coords,
    colorStops: cpSortedStops(g).map(function (s) { return { offset: s.offset, color: cpRgba(s.hex, s.a) }; })
  });
}
function cpGradientFromFabric(fg, obj) {
  if (!fg || !fg.colorStops) return null;
  var stops = fg.colorStops.map(function (s) {
    var c = cpParseColor(s.color) || { r: 0, g: 0, b: 0, a: 1 };
    var op = typeof s.opacity === "number" ? s.opacity : 1;
    return { offset: cpClamp(+s.offset || 0, 0, 1), hex: cpRgbToHex(c.r, c.g, c.b), a: c.a * op };
  });
  var angle = 90;
  if (fg.type !== "radial" && fg.coords) {
    var w = 1, h = 1;
    if (fg.gradientUnits !== "percentage" && obj) { w = obj.width || 1; h = obj.height || 1; }
    var dx = ((fg.coords.x2 || 0) - (fg.coords.x1 || 0)) / w, dy = ((fg.coords.y2 || 0) - (fg.coords.y1 || 0)) / h;
    if (dx || dy) angle = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
  }
  return { type: fg.type === "radial" ? "radial" : "linear", angle: angle, stops: stops.length >= 2 ? stops : cpDefaultGradient().stops };
}
function cpColorAt(g, t) {
  var st = cpSortedStops(g);
  if (t <= st[0].offset) return { hex: st[0].hex, a: st[0].a };
  for (var i = 1; i < st.length; i++) {
    if (t <= st[i].offset) {
      var p = st[i - 1], q = st[i], k = (t - p.offset) / ((q.offset - p.offset) || 1);
      var a = cpHexToRgb(p.hex), b = cpHexToRgb(q.hex);
      return { hex: cpRgbToHex(a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k), a: p.a + (q.a - p.a) * k };
    }
  }
  var last = st[st.length - 1];
  return { hex: last.hex, a: last.a };
}

/* ---------- emit ---------- */
function cpSelStop() { return cp.grad && cp.grad.stops[cp.sel]; }

// Push the HSVA being edited into the selected stop (gradient mode).
function cpSyncIntoStop() {
  var s = cpSelStop();
  if (cp.mode === "gradient" && s) { s.hex = cpCurrentHex(); s.a = cp.a; }
}

function cpEmitChange() {
  if (cp.mode === "gradient" && cp.grad) {
    cpSyncIntoStop();
    if (typeof cp.onGradient === "function") cp.onGradient(JSON.parse(JSON.stringify(cp.grad)));
    return;
  }
  if (typeof cp.onChange === "function") cp.onChange(cpCurrentHex(), cp.showAlpha ? cp.a : 1);
}

/* ---------- drawing ---------- */
function cpDrawAll() {
  var rgb = cpCurrentRgb(), hex = cpCurrentHex();
  var pure = cpHsvToRgb(cp.h, 1, 1);
  var pureCss = "rgb(" + Math.round(pure.r) + "," + Math.round(pure.g) + "," + Math.round(pure.b) + ")";
  $cp("cpSv").style.background = "linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff," + pureCss + ")";
  var t = $cp("cpSvThumb");
  t.style.left = (cp.s * 100) + "%";
  t.style.top = ((1 - cp.v) * 100) + "%";
  t.style.background = hex;
  $cp("cpHueThumb").style.left = (cp.h / 360 * 100) + "%";
  $cp("cpHueThumb").style.background = pureCss;
  var solid = "rgb(" + Math.round(rgb.r) + "," + Math.round(rgb.g) + "," + Math.round(rgb.b) + ")";
  $cp("cpAlphaFill").style.background = "linear-gradient(to right,rgba(0,0,0,0)," + solid + ")";
  $cp("cpAlphaThumb").style.left = (cp.a * 100) + "%";
  $cp("cpAlphaThumb").style.background = cpRgba(hex, cp.a);
  var ai = $cp("cpAlphaInput");
  if (document.activeElement !== ai) ai.value = Math.round(cp.a * 100);
  cpRenderFields();
  if (cp.mode === "gradient") cpRenderGradient();
}

function cpRenderFields() {
  var row = $cp("cpFields");
  // Don't rebuild while the user is typing in one of the fields.
  if (row.contains(document.activeElement)) return;
  row.innerHTML = "";
  function field(value, onCommit, cls) {
    var input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.spellcheck = false;
    if (cls) input.className = cls;
    input.addEventListener("change", function () { onCommit(input.value); input.blur(); });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") input.blur(); });
    row.appendChild(input);
  }
  var rgb = cpCurrentRgb();
  if (cp.format === "hex") {
    field(cpCurrentHex().slice(1).toUpperCase(), function (v) {
      if (cpSetFromHex("#" + v.replace("#", ""), cp.a)) { cpEmitChange(); cpCommitRecent(); }
      cpDrawAll();
    }, "cp-hex");
  } else if (cp.format === "rgb") {
    ["r", "g", "b"].forEach(function (k) {
      field(Math.round(rgb[k]), function (v) {
        var c = { r: rgb.r, g: rgb.g, b: rgb.b };
        c[k] = cpClamp(parseInt(v, 10) || 0, 0, 255);
        cpApplyRgb(c.r, c.g, c.b);
      });
    });
  } else if (cp.format === "hsl") {
    var hsl = cpRgbToHsl(rgb.r, rgb.g, rgb.b);
    field(Math.round(hsl.h), function (v) { cpApplyHsl(parseFloat(v) || 0, hsl.s, hsl.l); });
    field(Math.round(hsl.s * 100), function (v) { cpApplyHsl(hsl.h, (parseFloat(v) || 0) / 100, hsl.l); });
    field(Math.round(hsl.l * 100), function (v) { cpApplyHsl(hsl.h, hsl.s, (parseFloat(v) || 0) / 100); });
  } else {
    field(Math.round(cp.h), function (v) { cp.h = cpClamp(parseFloat(v) || 0, 0, 360); cpEmitChange(); cpDrawAll(); });
    field(Math.round(cp.s * 100), function (v) { cp.s = cpClamp((parseFloat(v) || 0) / 100, 0, 1); cpEmitChange(); cpDrawAll(); });
    field(Math.round(cp.v * 100), function (v) { cp.v = cpClamp((parseFloat(v) || 0) / 100, 0, 1); cpEmitChange(); cpDrawAll(); });
  }
}

function cpApplyRgb(r, g, b) {
  var hsv = cpRgbToHsv(cpClamp(r, 0, 255), cpClamp(g, 0, 255), cpClamp(b, 0, 255));
  cp.h = hsv.h; cp.s = hsv.s; cp.v = hsv.v;
  cpEmitChange(); cpDrawAll();
}
function cpApplyHsl(h, s, l) {
  var rgb = cpHslToRgb(h, cpClamp(s, 0, 1), cpClamp(l, 0, 1));
  cpApplyRgb(rgb.r, rgb.g, rgb.b);
}

/* ---------- gradient UI ---------- */
function cpSelectStop(i) {
  cp.sel = i;
  var s = cpSelStop();
  if (s) cpSetFromHex(s.hex, s.a);
  cpDrawAll();
}

function cpRenderGradient() {
  var g = cp.grad;
  if (!g) return;
  $cp("cpGradType").value = g.type;
  $cp("cpAngleWrap").style.display = g.type === "linear" ? "" : "none";
  var ang = $cp("cpGradAngle");
  if (document.activeElement !== ang) ang.value = Math.round(g.angle);
  $cp("cpGradFill").style.background = cpGradientCss(g, true);

  var bar = $cp("cpGradBar");
  Array.prototype.forEach.call(bar.querySelectorAll(".cp-stop-handle"), function (h) { h.remove(); });
  g.stops.forEach(function (s, i) {
    var h = document.createElement("div");
    h.className = "cp-stop-handle" + (i === cp.sel ? " sel" : "");
    h.style.left = (s.offset * 100) + "%";
    h.innerHTML = "<span></span>";
    h.firstChild.style.background = cpRgba(s.hex, s.a);
    h.title = Math.round(s.offset * 100) + "%";
    cpBindStopDrag(h, i);
    bar.appendChild(h);
  });

  var list = $cp("cpStopList");
  if (cp.keepList || list.contains(document.activeElement)) return;
  list.innerHTML = "";
  g.stops.map(function (s, i) { return { s: s, i: i }; })
    .sort(function (x, y) { return x.s.offset - y.s.offset; })
    .forEach(function (it) {
      var s = it.s, i = it.i;
      var row = document.createElement("div");
      row.className = "cp-stop-row" + (i === cp.sel ? " sel" : "");
      row.innerHTML =
        '<label class="cp-pct cp-stop-pos"><input type="text" inputmode="numeric"><span>%</span></label>' +
        '<div class="cp-stop-color"><span class="cp-stop-chip"></span><input type="text" spellcheck="false"></div>' +
        '<label class="cp-pct"><input type="text" inputmode="numeric"><span>%</span></label>' +
        '<button type="button" class="cp-hbtn" title="Remove stop"><span class="material-symbols-outlined">remove</span></button>';
      var inputs = row.querySelectorAll("input");
      inputs[0].value = Math.round(s.offset * 100);
      inputs[1].value = s.hex.slice(1).toUpperCase();
      inputs[2].value = Math.round(s.a * 100);
      row.querySelector(".cp-stop-chip").style.background = cpRgba(s.hex, s.a);
      var rm = row.querySelector("button");
      rm.disabled = g.stops.length <= 2;
      // Select in place: rebuilding the list here would destroy the input
      // that is about to receive the click.
      row.addEventListener("mousedown", function (e) {
        if (i === cp.sel || e.target.closest("button")) return;
        cp.sel = i;
        cpSetFromHex(s.hex, s.a);
        Array.prototype.forEach.call(list.children, function (r) { r.classList.toggle("sel", r === row); });
        cp.keepList = true;
        cpDrawAll();
        cp.keepList = false;
      });
      inputs[0].addEventListener("change", function () {
        s.offset = cpClamp((parseFloat(this.value) || 0) / 100, 0, 1);
        cpEmitChange(); cpDrawAll();
      });
      inputs[1].addEventListener("change", function () {
        var rgb = cpHexToRgb(this.value);
        if (rgb) { s.hex = cpRgbToHex(rgb.r, rgb.g, rgb.b); if (i === cp.sel) cpSetFromHex(s.hex, s.a); cpEmitChange(); }
        this.blur(); cpDrawAll();
      });
      inputs[2].addEventListener("change", function () {
        s.a = cpClamp((parseFloat(this.value) || 0) / 100, 0, 1);
        if (i === cp.sel) cp.a = s.a;
        cpEmitChange(); this.blur(); cpDrawAll();
      });
      Array.prototype.forEach.call(inputs, function (inp) {
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") inp.blur(); });
      });
      rm.addEventListener("click", function (e) {
        e.stopPropagation();
        if (g.stops.length <= 2) return;
        g.stops.splice(i, 1);
        cp.sel = Math.min(cp.sel, g.stops.length - 1);
        cpSelectStop(cp.sel);
        cpEmitChange();
      });
      list.appendChild(row);
    });
}

function cpAddStopAt(t) {
  var c = cpColorAt(cp.grad, t);
  cp.grad.stops.push({ offset: t, hex: c.hex, a: c.a });
  cpSelectStop(cp.grad.stops.length - 1);
  cpEmitChange();
}

function cpBindStopDrag(h, i) {
  h.addEventListener("mousedown", function (e) {
    e.stopPropagation();
    e.preventDefault();
    if (i !== cp.sel) cpSelectStop(i);
    var bar = $cp("cpGradBar");
    function move(ev) {
      var r = bar.getBoundingClientRect();
      cp.grad.stops[i].offset = cpClamp((ev.clientX - r.left) / r.width, 0, 1);
      cpEmitChange(); cpRenderGradient();
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      cpDrawAll();
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
}

function cpSetMode(mode) {
  if (mode === "gradient" && !cp.allowGradient) mode = "solid";
  cp.mode = mode;
  var panel = $cp("cpPanel");
  panel.classList.toggle("cp-is-grad", mode === "gradient");
  Array.prototype.forEach.call(document.querySelectorAll("#cpModes .cp-mode"), function (b) {
    b.classList.toggle("active", b.getAttribute("data-mode") === mode);
  });
  if (mode === "gradient") {
    if (!cp.grad) cp.grad = cpDefaultGradient(cpCurrentHex(), cp.a);
    cpSelectStop(Math.min(cp.sel, cp.grad.stops.length - 1));
  } else {
    cpDrawAll();
  }
}

/* ---------- swatch library ---------- */
function cpLoadList(key) {
  try { var raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : []; }
  catch (e) { return []; }
}
function cpSaveList(key, list, cap) {
  try { window.localStorage.setItem(key, JSON.stringify(list.slice(0, cap))); } catch (e) { }
}
function cpPushUnique(key, color, cap) {
  var c = color.toLowerCase();
  var list = cpLoadList(key).filter(function (x) { return String(x).toLowerCase() !== c; });
  list.unshift(color);
  cpSaveList(key, list, cap);
}
function cpCommitRecent() {
  cpPushUnique(CP_RECENT_KEY, cpCurrentHex(), CP_RECENT_MAX);
  if ($cp("cpLibSource").value === "recent") cpRenderLibrary();
}
function cpAddCurrentSwatch() {
  cpPushUnique(CP_SWATCH_KEY, cpCurrentHex(), 32);
  $cp("cpLibSource").value = "saved";
  cpSaveLibSource();
  cpRenderLibrary();
}
function cpSaveLibSource() {
  try { window.localStorage.setItem(CP_LIB_KEY, $cp("cpLibSource").value); } catch (e) { }
}

// Every solid color currently used by canvas objects, the chart and the page.
function cpPageColors() {
  var seen = {}, out = [];
  function add(c) {
    if (typeof c !== "string") return;
    var p = cpParseColor(c);
    if (!p || p.a === 0) return;
    var hex = cpRgbToHex(p.r, p.g, p.b);
    if (seen[hex]) return;
    seen[hex] = 1;
    out.push(hex);
  }
  function walk(o) {
    if (!o || o.isChartProxy) return;
    add(o.fill); add(o.stroke); add(o.backgroundColor);
    if (o.fill && o.fill.colorStops) o.fill.colorStops.forEach(function (s) { add(s.color); });
    if (o._objects) o._objects.forEach(walk);
  }
  if (typeof fabricCanvas !== "undefined" && fabricCanvas) fabricCanvas.getObjects().forEach(walk);
  if (typeof state !== "undefined" && state) {
    if (state.canvasBg && state.canvasBg !== "transparent") add(state.canvasBg);
    if (Array.isArray(state.customColors)) state.customColors.forEach(add);
  }
  return out.slice(0, 40);
}

function cpRenderLibrary() {
  var src = $cp("cpLibSource").value;
  var grid = $cp("cpLibGrid");
  var list = src === "page" ? cpPageColors()
    : src === "recent" ? cpLoadList(CP_RECENT_KEY)
    : src === "saved" ? cpLoadList(CP_SWATCH_KEY)
    : CP_PRESETS;
  grid.innerHTML = "";
  if (!list.length) {
    var empty = document.createElement("div");
    empty.className = "cp-lib-empty";
    empty.textContent = src === "saved" ? "No saved colors yet — use + above to save one." : "No colors yet.";
    grid.appendChild(empty);
    return;
  }
  list.forEach(function (color) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cp-lib-item";
    btn.title = color;
    btn.innerHTML = "<span></span>";
    btn.firstChild.style.background = color;
    btn.addEventListener("click", function () {
      cpSetFromHex(color, cp.a);
      cpEmitChange(); cpCommitRecent(); cpDrawAll();
    });
    grid.appendChild(btn);
  });
}

/* ---------- drag on SV / hue / alpha ---------- */
function cpBindDrag(el, kind) {
  function move(e) {
    var r = el.getBoundingClientRect();
    var p = e.touches && e.touches[0] ? e.touches[0] : e;
    var x = cpClamp((p.clientX - r.left) / r.width, 0, 1);
    var y = cpClamp((p.clientY - r.top) / r.height, 0, 1);
    if (kind === "sv") { cp.s = x; cp.v = 1 - y; }
    else if (kind === "hue") { cp.h = x * 360; }
    else { cp.a = x; }
    cpEmitChange(); cpDrawAll();
    e.preventDefault();
  }
  function start(e) {
    move(e);
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("mouseup", end);
    window.addEventListener("touchend", end);
  }
  function end() {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("touchmove", move);
    window.removeEventListener("mouseup", end);
    window.removeEventListener("touchend", end);
    cpCommitRecent();
  }
  el.addEventListener("mousedown", start);
  el.addEventListener("touchstart", start, { passive: false });
}

/* ---------- placement ---------- */
// Figma opens the picker beside the property that triggered it: prefer the
// left of the anchor (the right-hand panels), then its right, then below.
function cpPosition() {
  var panel = $cp("cpPanel");
  var W = panel.offsetWidth, H = panel.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  var left, top;
  if (cp.anchorBtn && document.body.contains(cp.anchorBtn)) {
    var r = cp.anchorBtn.getBoundingClientRect();
    if (r.left - W - 10 >= 8) left = r.left - W - 10;
    else if (r.right + 10 + W <= vw - 8) left = r.right + 10;
    else left = cpClamp(r.left, 8, vw - W - 8);
    top = r.left - W - 10 >= 8 || r.right + 10 + W <= vw - 8 ? r.top - 12 : r.bottom + 8;
  } else {
    left = (vw - W) / 2; top = (vh - H) / 2;
  }
  panel.style.left = Math.round(cpClamp(left, 8, Math.max(8, vw - W - 8))) + "px";
  panel.style.top = Math.round(cpClamp(top, 8, Math.max(8, vh - H - 8))) + "px";
}

/* ---------- wiring ---------- */
var cpWired = false;
function cpWireOnce() {
  if (cpWired) return;
  cpWired = true;

  cpBindDrag($cp("cpSv"), "sv");
  cpBindDrag($cp("cpHue"), "hue");
  cpBindDrag($cp("cpAlpha"), "alpha");

  $cp("cpClose").addEventListener("click", closeColorPicker);
  $cp("cpBackdrop").addEventListener("mousedown", closeColorPicker);
  $cp("cpAddSwatch").addEventListener("click", cpAddCurrentSwatch);

  $cp("cpFormat").addEventListener("change", function () {
    cp.format = this.value;
    try { window.localStorage.setItem("simplePlotsColorFormat", cp.format); } catch (e) { }
    cpRenderFields();
  });
  $cp("cpAlphaInput").addEventListener("change", function () {
    cp.a = cpClamp((parseFloat(this.value) || 0) / 100, 0, 1);
    cpEmitChange(); this.blur(); cpDrawAll();
  });
  $cp("cpAlphaInput").addEventListener("keydown", function (e) { if (e.key === "Enter") this.blur(); });

  $cp("cpModes").addEventListener("click", function (e) {
    var b = e.target.closest(".cp-mode");
    if (!b) return;
    cpSetMode(b.getAttribute("data-mode"));
    cpEmitChange();
  });

  $cp("cpGradType").addEventListener("change", function () {
    cp.grad.type = this.value;
    cpEmitChange(); cpDrawAll();
  });
  $cp("cpGradAngle").addEventListener("change", function () {
    cp.grad.angle = ((parseFloat(this.value) || 0) % 360 + 360) % 360;
    cpEmitChange(); this.blur(); cpDrawAll();
  });
  $cp("cpGradFlip").addEventListener("click", function () {
    cp.grad.stops.forEach(function (s) { s.offset = 1 - s.offset; });
    cpEmitChange(); cpDrawAll();
  });
  $cp("cpGradRotate").addEventListener("click", function () {
    cp.grad.angle = (cp.grad.angle + 90) % 360;
    if (cp.grad.type !== "linear") cp.grad.type = "linear";
    cpEmitChange(); cpDrawAll();
  });
  $cp("cpGradBar").addEventListener("mousedown", function (e) {
    if (e.target.closest(".cp-stop-handle")) return;
    var r = this.getBoundingClientRect();
    cpAddStopAt(cpClamp((e.clientX - r.left) / r.width, 0, 1));
  });
  $cp("cpStopAdd").addEventListener("click", function () {
    // Add halfway into the widest gap between stops.
    var st = cpSortedStops(cp.grad), best = 0, at = 0.5;
    for (var i = 1; i < st.length; i++) {
      var gap = st[i].offset - st[i - 1].offset;
      if (gap > best) { best = gap; at = st[i - 1].offset + gap / 2; }
    }
    cpAddStopAt(at);
  });

  $cp("cpLibSource").addEventListener("change", function () { cpSaveLibSource(); cpRenderLibrary(); });

  var eyedrop = $cp("cpEyedrop");
  if (typeof window.EyeDropper === "function") {
    eyedrop.addEventListener("click", function () {
      new window.EyeDropper().open().then(function (r) {
        if (r && r.sRGBHex) { cpSetFromHex(r.sRGBHex, cp.a); cpEmitChange(); cpCommitRecent(); cpDrawAll(); }
      }).catch(function () { });
    });
  } else {
    eyedrop.disabled = true;
    eyedrop.title = "Eyedropper isn't supported in this browser";
  }

  document.addEventListener("keydown", function (e) {
    if (!cp.open) return;
    if (e.key === "Escape") closeColorPicker();
    // Delete the selected stop, unless typing in a field.
    if ((e.key === "Delete" || e.key === "Backspace") && cp.mode === "gradient" && !(e.target.closest && e.target.closest("input,select,textarea")) &&
        cp.grad.stops.length > 2) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cp.grad.stops.splice(cp.sel, 1);
      cpSelectStop(Math.max(0, cp.sel - 1));
      cpEmitChange();
    }
  }, true);
  window.addEventListener("resize", function () { if (cp.open) cpPosition(); });

  try {
    cp.format = window.localStorage.getItem("simplePlotsColorFormat") || "hex";
    var lib = window.localStorage.getItem(CP_LIB_KEY);
    if (lib) $cp("cpLibSource").value = lib;
  } catch (e) { }
  $cp("cpFormat").value = cp.format;
}

function openColorPicker(opts) {
  opts = opts || {};
  cpWireOnce();
  if (cp.open && cp.anchorBtn && cp.anchorBtn === opts.anchorBtn) { closeColorPicker(); return; }
  if (cp.open) closeColorPicker();

  cp.showAlpha = opts.showAlpha !== false;
  cp.onChange = opts.onChange || null;
  cp.onClose = opts.onClose || null;
  cp.onGradient = opts.onGradient || null;
  cp.anchorBtn = opts.anchorBtn || null;
  cp.allowGradient = !!opts.allowGradient && typeof opts.onGradient === "function";
  cp.grad = opts.gradient ? JSON.parse(JSON.stringify(opts.gradient)) : null;
  cp.sel = 0;

  cpSetFromHex(opts.hex || "#1a1a1a", typeof opts.alpha === "number" ? opts.alpha : 1);

  var panel = $cp("cpPanel");
  panel.classList.toggle("cp-no-alpha", !cp.showAlpha);
  panel.classList.toggle("cp-can-grad", cp.allowGradient);
  $cp("cpTitle").textContent = opts.title || "Color";

  if (cp.anchorBtn) cp.anchorBtn.classList.add("active");
  panel.classList.add("open");
  $cp("cpBackdrop").classList.add("open");
  cp.open = true;

  cpSetMode(cp.grad && cp.allowGradient ? "gradient" : "solid");
  cpRenderLibrary();
  cpPosition();
}

function closeColorPicker() {
  if (!cp.open) return;
  cp.open = false;
  $cp("cpPanel").classList.remove("open");
  $cp("cpBackdrop").classList.remove("open");
  if (cp.anchorBtn) cp.anchorBtn.classList.remove("active");
  if (cp.mode === "solid") cpCommitRecent();
  var onClose = cp.onClose;
  cp.anchorBtn = null; cp.onChange = null; cp.onClose = null; cp.onGradient = null;
  if (typeof onClose === "function") onClose();
}
