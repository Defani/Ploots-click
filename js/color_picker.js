var CP_SWATCH_KEY = "simplePlotsColorSwatches";
var CP_RECENT_KEY = "simplePlotsColorRecents";
var CP_RECENT_MAX = 8;
var CP_PRESETS = ["#e2555a", "#e08a3c", "#e8c14a", "#8fbf4f", "#7fc2d9", "#3f8f8a", "#c96fa8"];
var cp = {
  open: false, h: 0, s: 0, v: 0, a: 1, showAlpha: true,
  onChange: null, onClose: null, anchorBtn: null,
  activeTab: "hex", dragging: null, originalRgba: "rgba(26,26,26,1)"
};

function cpClamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

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

function cpCurrentRgb() { return cpHsvToRgb(cp.h, cp.s, cp.v); }
function cpCurrentHex() { var c = cpCurrentRgb(); return cpRgbToHex(c.r, c.g, c.b); }
function cpToRgbaString() { var c = cpCurrentRgb(); return "rgba(" + Math.round(c.r) + "," + Math.round(c.g) + "," + Math.round(c.b) + "," + Math.round(cp.a * 100) / 100 + ")"; }

function cpSetFromHex(str, alpha) {
  var rgb = null;
  var m = typeof str === "string" && str.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    var parts = m[1].split(",").map(function (v) { return parseFloat(v); });
    rgb = { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0 };
    if (parts.length > 3) rgb.a = parts[3];
  } else {
    rgb = cpHexToRgb(str);
  }
  if (!rgb) return false;
  var hsv = cpRgbToHsv(rgb.r, rgb.g, rgb.b);
  cp.h = hsv.h; cp.s = hsv.s; cp.v = hsv.v;
  if (typeof alpha === "number") cp.a = cpClamp(alpha, 0, 1);
  else if (typeof rgb.a === "number") cp.a = rgb.a;
  return true;
}

var cpWheelBase = null;
function cpBuildWheelBase() {
  var size = 220;
  var off = document.createElement("canvas");
  off.width = size; off.height = size;
  var ctx = off.getContext("2d");
  var cx = size / 2, cy = size / 2, r = size / 2;
  var img = ctx.createImageData(size, size);
  var data = img.data;
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      var dx = x - cx + 0.5, dy = y - cy + 0.5;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var idx = (y * size + x) * 4;
      if (dist > r) { data[idx + 3] = 0; continue; }
      var angle = Math.atan2(dy, dx) * 180 / Math.PI; if (angle < 0) angle += 360;
      var sat = Math.min(1, dist / r);
      var rgb = cpHsvToRgb(angle, sat, 1);
      data[idx] = rgb.r; data[idx + 1] = rgb.g; data[idx + 2] = rgb.b; data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  cpWheelBase = off;
}
function cpDrawWheel() {
  var canvas = document.getElementById("cpWheelCanvas"), ctx = canvas.getContext("2d");
  var w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2, r = Math.min(cx, cy);
  if (!cpWheelBase) cpBuildWheelBase();
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(cpWheelBase, 0, 0, w, h);
  if (cp.v < 1) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "rgba(0,0,0," + (1 - cp.v) + ")";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  var thumb = document.getElementById("cpWheelThumb");
  var theta = cp.h * Math.PI / 180;
  var rr = cp.s * r;
  var tx = cx + rr * Math.cos(theta), ty = cy + rr * Math.sin(theta);
  thumb.style.left = (tx / w * 100) + "%"; thumb.style.top = (ty / h * 100) + "%";
}
function cpDrawVal() {
  var canvas = document.getElementById("cpValCanvas"), ctx = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
  var full = cpHsvToRgb(cp.h, cp.s, 1);
  var grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "rgb(0,0,0)");
  grad.addColorStop(1, "rgb(" + Math.round(full.r) + "," + Math.round(full.g) + "," + Math.round(full.b) + ")");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  document.getElementById("cpValThumb").style.left = (cp.v * 100) + "%";
}
function cpDrawAlpha() {
  var canvas = document.getElementById("cpAlphaCanvas"), ctx = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  for (var y = 0; 7 * y < h; y++) for (var x = 0; 7 * x < w; x++) {
    ctx.fillStyle = (x + y) % 2 === 0 ? "#e2e2e2" : "#ffffff";
    ctx.fillRect(7 * x, 7 * y, 7, 7);
  }
  var rgb = cpCurrentRgb();
  var grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "rgba(" + Math.round(rgb.r) + "," + Math.round(rgb.g) + "," + Math.round(rgb.b) + ",0)");
  grad.addColorStop(1, "rgba(" + Math.round(rgb.r) + "," + Math.round(rgb.g) + "," + Math.round(rgb.b) + ",1)");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  document.getElementById("cpAlphaThumb").style.left = (100 * cp.a) + "%";
}
function cpDrawAll() {
  cpDrawWheel(); cpDrawVal(); cpDrawAlpha();
  var hex = cpCurrentHex();
  var hexTop = document.getElementById("cpHexTop");
  if (document.activeElement !== hexTop) hexTop.value = hex.toUpperCase();
  document.getElementById("cpAlphaRow").style.display = cp.showAlpha ? "" : "none";
  document.getElementById("cpCompareNew").style.background = cpToRgbaString();
  cpRenderValuesRow();
}

function cpRenderValuesRow() {
  var row = document.getElementById("cpValuesRow");
  function field(label, value, onCommit) {
    var wrap = document.createElement("div"); wrap.className = "cp-val";
    var input = document.createElement("input");
    input.type = "text"; input.value = value;
    input.addEventListener("change", function () { onCommit(input.value); });
    var span = document.createElement("span"); span.textContent = label;
    wrap.appendChild(input); wrap.appendChild(span); row.appendChild(wrap);
  }
  row.innerHTML = "";
  if (cp.activeTab === "hex") {
    field("hex", cpCurrentHex().toUpperCase(), function (v) { if (cpSetFromHex(v)) { cpEmitChange(); cpCommitRecent(); } cpDrawAll(); });
    if (cp.showAlpha) field("a", Math.round(100 * cp.a), function (v) { cp.a = cpClamp((parseFloat(v) || 0) / 100, 0, 1); cpEmitChange(); cpDrawAll(); });
  } else if (cp.activeTab === "rgb") {
    var rgb = cpCurrentRgb();
    field("r", Math.round(rgb.r), function (v) { cpApplyRgb(parseInt(v) || 0, rgb.g, rgb.b); });
    field("g", Math.round(rgb.g), function (v) { cpApplyRgb(rgb.r, parseInt(v) || 0, rgb.b); });
    field("b", Math.round(rgb.b), function (v) { cpApplyRgb(rgb.r, rgb.g, parseInt(v) || 0); });
    if (cp.showAlpha) field("a", Math.round(100 * cp.a), function (v) { cp.a = cpClamp((parseFloat(v) || 0) / 100, 0, 1); cpEmitChange(); cpDrawAll(); });
  } else if (cp.activeTab === "hsv") {
    field("h", Math.round(cp.h), function (v) { cp.h = cpClamp(parseFloat(v) || 0, 0, 360); cpEmitChange(); cpDrawAll(); });
    field("s", Math.round(100 * cp.s), function (v) { cp.s = cpClamp((parseFloat(v) || 0) / 100, 0, 1); cpEmitChange(); cpDrawAll(); });
    field("v", Math.round(100 * cp.v), function (v) { cp.v = cpClamp((parseFloat(v) || 0) / 100, 0, 1); cpEmitChange(); cpDrawAll(); });
  } else if (cp.activeTab === "hsl") {
    var rgb2 = cpCurrentRgb(), hsl = cpRgbToHsl(rgb2.r, rgb2.g, rgb2.b);
    field("h", Math.round(hsl.h), function (v) { cpApplyHsl(parseFloat(v) || 0, hsl.s, hsl.l); });
    field("s", Math.round(100 * hsl.s), function (v) { cpApplyHsl(hsl.h, (parseFloat(v) || 0) / 100, hsl.l); });
    field("l", Math.round(100 * hsl.l), function (v) { cpApplyHsl(hsl.h, hsl.s, (parseFloat(v) || 0) / 100); });
  }
}

function cpApplyRgb(r, g, b) {
  var hsv = cpRgbToHsv(cpClamp(r, 0, 255), cpClamp(g, 0, 255), cpClamp(b, 0, 255));
  cp.h = hsv.h; cp.s = hsv.s; cp.v = hsv.v; cpEmitChange(); cpDrawAll();
}
function cpHslToRgbLocal(h, s, l) {
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
function cpApplyHsl(h, s, l) {
  var rgb = cpHslToRgbLocal(h, cpClamp(s, 0, 1), cpClamp(l, 0, 1));
  cpApplyRgb(rgb.r, rgb.g, rgb.b);
}
function cpEmitChange() {
  if (typeof cp.onChange === "function") cp.onChange(cpCurrentHex(), cp.showAlpha ? cp.a : 1);
}

/* ---------- persisted swatches ---------- */
function cpLoadList(key) {
  try { var raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : []; }
  catch (e) { return []; }
}
function cpSaveList(key, list, cap) {
  try { window.localStorage.setItem(key, JSON.stringify(list.slice(0, cap))); } catch (e) { }
}
function cpLoadSwatches() { return cpLoadList(CP_SWATCH_KEY); }
function cpSaveSwatches(list) { cpSaveList(CP_SWATCH_KEY, list, 16); }

function cpRenderSwatchRow(elId, list, emptyText) {
  var el = document.getElementById(elId);
  el.innerHTML = "";
  if (!list.length) {
    var empty = document.createElement("span");
    empty.className = "cp-swatch-empty"; empty.textContent = emptyText;
    el.appendChild(empty); return;
  }
  list.forEach(function (color) {
    var btn = document.createElement("button");
    btn.className = "cp-swatch-item"; btn.style.background = color; btn.title = color;
    btn.addEventListener("click", function () { cpSetFromHex(color); cpEmitChange(); cpDrawAll(); });
    el.appendChild(btn);
  });
}
function cpRenderSwatches() { cpRenderSwatchRow("cpSwatchesRow", cpLoadSwatches(), "No saved colors yet"); }
function cpAddCurrentSwatch() {
  var hex = cpCurrentHex();
  var list = cpLoadSwatches().filter(function (c) { return c.toLowerCase() !== hex.toLowerCase(); });
  list.unshift(hex); cpSaveSwatches(list); cpRenderSwatches();
}

function cpLoadRecents() { return cpLoadList(CP_RECENT_KEY); }
function cpSaveRecents(list) { cpSaveList(CP_RECENT_KEY, list, CP_RECENT_MAX); }
function cpRenderRecents() {
  var list = cpLoadRecents();
  cpRenderSwatchRow("cpRecentRow", list, "No recent colors yet");
  var countEl = document.getElementById("cpRecentCount");
  countEl.textContent = list.length ? list.length : "";
}
function cpCommitRecent() {
  var hex = cpCurrentHex();
  var list = cpLoadRecents().filter(function (c) { return c.toLowerCase() !== hex.toLowerCase(); });
  list.unshift(hex); cpSaveRecents(list); cpRenderRecents();
}

function cpRenderPresets() {
  var el = document.getElementById("cpPresetsRow");
  if (el.childElementCount) return;
  CP_PRESETS.forEach(function (color) {
    var btn = document.createElement("button");
    btn.className = "cp-preset"; btn.style.background = color; btn.title = color;
    btn.addEventListener("click", function () { cpSetFromHex(color); cpEmitChange(); cpDrawAll(); });
    el.appendChild(btn);
  });
}

/* ---------- drag interaction on SV / hue / alpha ---------- */
function cpPointFromEvent(e, el) {
  var rect = el.getBoundingClientRect();
  var p = e.touches && e.touches[0] ? e.touches[0] : e;
  return { x: cpClamp(p.clientX - rect.left, 0, rect.width), y: cpClamp(p.clientY - rect.top, 0, rect.height), w: rect.width, h: rect.height };
}
function cpBindDrag(el, kind) {
  function move(e) {
    var p = cpPointFromEvent(e, el);
    if (kind === "wheel") {
      var cx = p.w / 2, cy = p.h / 2, r = Math.min(cx, cy);
      var dx = p.x - cx, dy = p.y - cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var angle = Math.atan2(dy, dx) * 180 / Math.PI; if (angle < 0) angle += 360;
      cp.h = angle; cp.s = r ? cpClamp(dist / r, 0, 1) : 0;
    }
    else if (kind === "val") { cp.v = p.w ? p.x / p.w : 0; }
    else if (kind === "alpha") { cp.a = p.w ? p.x / p.w : 1; }
    cpEmitChange(); cpDrawAll(); e.preventDefault();
  }
  function start(e) {
    cp.dragging = kind; move(e);
    window.addEventListener("mousemove", move); window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("mouseup", end); window.addEventListener("touchend", end);
  }
  function end() {
    cp.dragging = null;
    window.removeEventListener("mousemove", move); window.removeEventListener("touchmove", move);
    window.removeEventListener("mouseup", end); window.removeEventListener("touchend", end);
    cpCommitRecent();
  }
  el.addEventListener("mousedown", start); el.addEventListener("touchstart", start, { passive: false });
}

var cpWired = false;
function cpWireOnce() {
  if (cpWired) return;
  cpWired = true;

  cpBindDrag(document.getElementById("cpWheelWrap"), "wheel");
  cpBindDrag(document.getElementById("cpValWrap"), "val");
  cpBindDrag(document.getElementById("cpAlphaWrap"), "alpha");

  document.getElementById("cpClose").addEventListener("click", closeColorPicker);
  document.getElementById("cpBackdrop").addEventListener("click", closeColorPicker);

  document.getElementById("cpHexTop").addEventListener("change", function () {
    if (cpSetFromHex(this.value)) { cpEmitChange(); cpCommitRecent(); }
    cpDrawAll();
  });

  document.getElementById("cpAddSwatch").addEventListener("click", cpAddCurrentSwatch);

  document.getElementById("cpTabs").addEventListener("click", function (e) {
    var tab = e.target.closest(".cp-tab");
    if (!tab) return;
    Array.prototype.forEach.call(document.querySelectorAll("#cpTabs .cp-tab"), function (b) { b.classList.remove("active"); });
    tab.classList.add("active");
    cp.activeTab = tab.getAttribute("data-tab");
    cpRenderValuesRow();
  });

  document.getElementById("cpClear").addEventListener("click", function () {
    if (!cp.showAlpha) return;
    cp.a = 0; cpEmitChange(); cpDrawAll();
  });

  document.getElementById("cpConfirm").addEventListener("click", function () {
    cpEmitChange(); cpCommitRecent(); closeColorPicker();
  });

  var eyedrop = document.getElementById("cpEyedrop");
  if (typeof window.EyeDropper === "function") {
    eyedrop.addEventListener("click", function () {
      new window.EyeDropper().open().then(function (r) {
        if (r && r.sRGBHex) { cpSetFromHex(r.sRGBHex); cpEmitChange(); cpDrawAll(); }
      }).catch(function () { });
    });
  } else {
    eyedrop.disabled = true;
    eyedrop.title = "Eyedropper not supported in this browser";
  }

  cpRenderPresets();

  document.addEventListener("keydown", function (e) {
    if (cp.open && e.key === "Escape") closeColorPicker();
  });
}

function openColorPicker(opts) {
  opts = opts || {};
  cpWireOnce();
  if (cp.open && cp.anchorBtn === opts.anchorBtn) { closeColorPicker(); return; }

  if (cp.anchorBtn) cp.anchorBtn.classList.remove("active");
  cp.showAlpha = opts.showAlpha !== false;
  cp.onChange = opts.onChange || null;
  cp.onClose = opts.onClose || null;
  cp.anchorBtn = opts.anchorBtn || null;
  cp.activeTab = "hex";

  cpSetFromHex(opts.hex || "#1a1a1a", typeof opts.alpha === "number" ? opts.alpha : 1);
  cp.originalRgba = cpToRgbaString();
  document.getElementById("cpCompareOld").style.background = cp.originalRgba;

  document.getElementById("cpTitle").textContent = opts.title || "Color";
  Array.prototype.forEach.call(document.querySelectorAll("#cpTabs .cp-tab"), function (b) {
    b.classList.toggle("active", b.getAttribute("data-tab") === "hex");
  });

  if (cp.anchorBtn) cp.anchorBtn.classList.add("active");
  document.getElementById("cpPanel").classList.add("open");
  document.getElementById("cpBackdrop").classList.add("open");
  cp.open = true;

  cpRenderSwatches();
  cpRenderRecents();
  cpDrawAll();
}

function closeColorPicker() {
  if (!cp.open) return;
  cp.open = false;
  document.getElementById("cpPanel").classList.remove("open");
  document.getElementById("cpBackdrop").classList.remove("open");
  if (cp.anchorBtn) cp.anchorBtn.classList.remove("active");
  var onClose = cp.onClose;
  cp.anchorBtn = null; cp.onChange = null; cp.onClose = null;
  if (typeof onClose === "function") onClose();
}
