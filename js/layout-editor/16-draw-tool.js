// Pen tool (vector paths, like Figma / Illustrator).
//
// With the tool on, the page canvas stops selecting objects and each click
// adds an anchor to a new path:
//   click            corner point
//   click + drag     smooth point; the drag sets its handles (mirrored)
//   click 1st point  closes the path (filled if "Fill closed shapes" is on)
//   Enter / dbl-click finishes an open path
//   Backspace        removes the last point
//   Esc              finishes the path in progress, or leaves the tool
// The result is an ordinary Fabric path: move, scale, recolour and layer it
// like any shape. Stroke colour, width, opacity and fill live in the tool's
// popover (the same element the old freehand brush used).
var penSettings = { color: "#1a1a1a", width: 2, opacity: 1, fill: false };
var pen = { active: false, pts: [], dragging: false, preview: null, cursor: null };

function penHexToRgba(hex, a) {
  hex = (hex || "#000000").replace("#", "");
  if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join("");
  return "rgba(" + parseInt(hex.substr(0, 2), 16) + "," + parseInt(hex.substr(2, 2), 16) + "," + parseInt(hex.substr(4, 2), 16) + "," + a + ")";
}

function penPathData(pts, closed, cursor) {
  if (!pts.length) return "";
  var d = "M " + pts[0].x + " " + pts[0].y;
  function seg(a, b) {
    var c1 = a.hout || a, c2 = b.hin || b;
    d += " C " + c1.x + " " + c1.y + " " + c2.x + " " + c2.y + " " + b.x + " " + b.y;
  }
  for (var i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
  if (cursor) seg(pts[pts.length - 1], { x: cursor.x, y: cursor.y });
  if (closed) { seg(pts[pts.length - 1], pts[0]); d += " Z"; }
  return d;
}

function penClearPreview() {
  if (pen.preview && fabricCanvas) {
    var prev = window.historyRestoring;
    window.historyRestoring = true;
    pen.preview.forEach(function (o) { fabricCanvas.remove(o); });
    window.historyRestoring = prev;
  }
  pen.preview = null;
}

function penDrawPreview() {
  if (!fabricCanvas) return;
  var prevFlag = window.historyRestoring;
  window.historyRestoring = true;
  penClearPreview();
  window.historyRestoring = true;
  var objs = [], z = fabricCanvas.getZoom ? fabricCanvas.getZoom() : 1;
  var d = penPathData(pen.pts, false, pen.dragging ? null : pen.cursor);
  if (d) objs.push(new fabric.Path(d, { fill: "", stroke: penHexToRgba(penSettings.color, penSettings.opacity), strokeWidth: penSettings.width, strokeLineCap: "round", strokeLineJoin: "round", objectCaching: false }));
  pen.pts.forEach(function (p, i) {
    if (p.hin) objs.push(new fabric.Line([p.hin.x, p.hin.y, p.hout.x, p.hout.y], { stroke: "#4e8a2e", strokeWidth: 1 / z }));
    [p.hin, p.hout].forEach(function (h) { if (h) objs.push(new fabric.Circle({ left: h.x, top: h.y, radius: 3 / z, originX: "center", originY: "center", fill: "#fff", stroke: "#4e8a2e", strokeWidth: 1 / z })); });
    objs.push(new fabric.Rect({ left: p.x, top: p.y, width: (i === 0 ? 9 : 7) / z, height: (i === 0 ? 9 : 7) / z, originX: "center", originY: "center", fill: i === 0 ? "#4e8a2e" : "#fff", stroke: "#4e8a2e", strokeWidth: 1 / z }));
  });
  objs.forEach(function (o) { o.set({ selectable: false, evented: false, excludeFromExport: true, penPreview: true }); fabricCanvas.add(o); });
  pen.preview = objs;
  window.historyRestoring = prevFlag;
  fabricCanvas.requestRenderAll();
}

function penFinish(closed) {
  var pts = pen.pts;
  penClearPreview();
  pen.pts = []; pen.dragging = false;
  if (!fabricCanvas || pts.length < 2) { fabricCanvas && fabricCanvas.requestRenderAll(); return; }
  var path = new fabric.Path(penPathData(pts, closed), {
    fill: closed && penSettings.fill ? penHexToRgba(penSettings.color, 0.25) : "",
    stroke: penSettings.color, strokeWidth: penSettings.width, opacity: penSettings.opacity,
    strokeLineCap: "round", strokeLineJoin: "round", strokeUniform: true
  });
  path.layerName = "Path";
  fabricCanvas.add(path);
  fabricCanvas.requestRenderAll();
  if (typeof historyNotifyChange === "function") historyNotifyChange();
}

function penPointer(opt) { var p = fabricCanvas.getPointer(opt.e); return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }; }

function penOnDown(opt) {
  if (!pen.active) return;
  var p = penPointer(opt), z = fabricCanvas.getZoom ? fabricCanvas.getZoom() : 1;
  if (pen.pts.length >= 2) {
    var f = pen.pts[0];
    if (Math.hypot(p.x - f.x, p.y - f.y) < 8 / z) { penFinish(true); return; }
  }
  pen.pts.push({ x: p.x, y: p.y, hin: null, hout: null });
  pen.dragging = true;
  penDrawPreview();
}
function penOnMove(opt) {
  if (!pen.active) return;
  var p = penPointer(opt);
  pen.cursor = p;
  if (pen.dragging && pen.pts.length) {
    var a = pen.pts[pen.pts.length - 1];
    if (Math.hypot(p.x - a.x, p.y - a.y) > 2) { a.hout = { x: p.x, y: p.y }; a.hin = { x: 2 * a.x - p.x, y: 2 * a.y - p.y }; }
  }
  if (pen.pts.length) penDrawPreview();
}
function penOnUp() { pen.dragging = false; }

function penKey(e) {
  if (!pen.active) return;
  var tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.key === "Enter") { e.preventDefault(); penFinish(false); }
  else if (e.key === "Escape") { e.preventDefault(); if (pen.pts.length) penFinish(false); else drawClosePopover(); }
  else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); e.stopPropagation(); pen.pts.pop(); penDrawPreview(); }
}

function drawSyncPopoverUI() {
  var t = document.getElementById("drawThickness"), tv = document.getElementById("drawThicknessVal");
  var o = document.getElementById("drawOpacity"), ov = document.getElementById("drawOpacityVal");
  var sw = document.getElementById("drawColorSwatch"), fl = document.getElementById("penFill");
  if (t) t.value = penSettings.width;
  if (tv) tv.textContent = penSettings.width + "px";
  if (o) o.value = penSettings.opacity;
  if (ov) ov.textContent = Math.round(penSettings.opacity * 100) + "%";
  if (sw) sw.style.background = penSettings.color;
  if (fl) fl.checked = penSettings.fill;
}

function drawOpenPopover() {
  var pop = document.getElementById("drawPopover"), btn = document.getElementById("toolDraw");
  if (typeof window.setView === "function") window.setView("layout");
  if (pop) pop.classList.add("open");
  if (btn) btn.classList.add("active");
  if (typeof positionFloatingPopover === "function") positionFloatingPopover(btn, pop);
  pen.active = true; pen.pts = [];
  if (fabricCanvas) {
    fabricCanvas.discardActiveObject();
    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = false;
    fabricCanvas.skipTargetFind = true;
    fabricCanvas.defaultCursor = "crosshair";
    fabricCanvas.hoverCursor = "crosshair";
    fabricCanvas.requestRenderAll();
  }
  drawSyncPopoverUI();
}

function drawClosePopover() {
  var pop = document.getElementById("drawPopover"), btn = document.getElementById("toolDraw");
  if (pen.active && pen.pts.length) penFinish(false);
  pen.active = false;
  penClearPreview();
  if (pop) pop.classList.remove("open");
  if (btn) btn.classList.remove("active");
  if (fabricCanvas) {
    fabricCanvas.selection = true;
    fabricCanvas.skipTargetFind = false;
    fabricCanvas.defaultCursor = "default";
    fabricCanvas.hoverCursor = "move";
    fabricCanvas.requestRenderAll();
  }
}

function wireDrawTool() {
  var btn = document.getElementById("toolDraw");
  if (btn) btn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (pen.active) drawClosePopover(); else drawOpenPopover();
  });
  var done = document.getElementById("drawDoneBtn");
  if (done) done.addEventListener("click", drawClosePopover);
  var t = document.getElementById("drawThickness");
  if (t) t.addEventListener("input", function () { penSettings.width = parseFloat(this.value) || 1; drawSyncPopoverUI(); penDrawPreview(); });
  var o = document.getElementById("drawOpacity");
  if (o) o.addEventListener("input", function () { penSettings.opacity = parseFloat(this.value) || 1; drawSyncPopoverUI(); penDrawPreview(); });
  var fl = document.getElementById("penFill");
  if (fl) fl.addEventListener("change", function () { penSettings.fill = this.checked; });
  var cbtn = document.getElementById("drawColorBtn");
  if (cbtn) cbtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (typeof openColorPicker !== "function") return;
    openColorPicker({ title: "Stroke color", hex: penSettings.color, alpha: 1, showAlpha: false, anchorBtn: cbtn,
      onChange: function (hex) { penSettings.color = hex; drawSyncPopoverUI(); penDrawPreview(); } });
  });
  document.addEventListener("keydown", penKey, true);
  function hook() {
    if (!window.fabricCanvas || fabricCanvas._penHooked) return;
    fabricCanvas._penHooked = true;
    fabricCanvas.on("mouse:down", penOnDown);
    fabricCanvas.on("mouse:move", penOnMove);
    fabricCanvas.on("mouse:up", penOnUp);
    // A double-click finishes the path, but only when both clicks landed on
    // the same spot (browsers also report two quick clicks far apart as a
    // dblclick, which must not eat the second anchor).
    fabricCanvas.on("mouse:dblclick", function () {
      var n = pen.pts.length;
      if (!pen.active || n < 2) return;
      var a = pen.pts[n - 1], b = pen.pts[n - 2], z = fabricCanvas.getZoom ? fabricCanvas.getZoom() : 1;
      if (Math.hypot(a.x - b.x, a.y - b.y) > 6 / z) return;
      pen.pts.pop();
      penFinish(false);
    });
  }
  hook();
  document.addEventListener("ploots:canvasready", hook);

  // Leaving the layout view closes the tool.
  var setView = window.setView;
  if (typeof setView === "function") window.setView = function (v) { if (v !== "layout") drawClosePopover(); return setView.apply(this, arguments); };
  drawSyncPopoverUI();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireDrawTool); else wireDrawTool();
