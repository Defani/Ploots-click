/* ==========================================================================
   GIS — Item properties for the Cartography layout (as in QGIS / ArcGIS).

   Selecting an item on the page opens its properties in the sidebar instead
   of floating format bars:
     Map frame   the Map frame panel (view, grid, frame, layout items)
     Text        text, font, size, style, colour, alignment, background, halo
     Shape       fill, outline colour / width / style, corner radius
   and for every item: position and size in millimetres, rotation, opacity,
   lock. The chart-builder tools (Canvas, Design, Shapes, LaTeX) are hidden
   in this mode; the layout object list is shown as "Items".
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS, PANEL = "panel-gis-item", MM = 96 / 25.4;
  function $(id) { return document.getElementById(id); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fc() { return window.fabricCanvas; }
  function carto() { return document.body.classList.contains("gis-carto"); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function hex(c) {
    if (!c || c === "transparent") return "#000000";
    if (/^#[0-9a-f]{6}$/i.test(c)) return c;
    if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + c.slice(1).split("").map(function (x) { return x + x; }).join("");
    var m = String(c).match(/rgba?\(([^)]+)\)/);
    if (m) { var p = m[1].split(",").map(function (x) { return parseFloat(x); }); return "#" + p.slice(0, 3).map(function (v) { return ("0" + Math.round(v).toString(16)).slice(-2); }).join(""); }
    return "#000000";
  }
  var TEXT = /^(textbox|i-text|text)$/, SHAPE = /^(rect|ellipse|circle|triangle|polygon|polyline|path|line)$/;
  var FONTS = ["Inter", "Poppins", "Roboto", "Open Sans", "Lato", "Montserrat", "Source Sans 3", "Noto Sans", "Arial", "Helvetica", "Times New Roman", "Georgia", "Garamond", "Courier New"];

  var cur = null;
  function kindOf(o) {
    if (!o) return "";
    if (o === window.chartProxyObj || o.isChartProxy) return "map";
    if (TEXT.test(o.type)) return "text";
    if (SHAPE.test(o.type)) return "shape";
    if (o.type === "image") return "image";
    return "item";
  }
  function row(label, html) { return '<label class="ip-row"><span>' + label + "</span>" + html + "</label>"; }
  function num(k, v, step, min) { return '<input type="number" data-k="' + k + '" value="' + v + '" step="' + (step || 0.1) + '"' + (min != null ? ' min="' + min + '"' : "") + ">"; }
  function color(k, v) { return '<input type="color" data-k="' + k + '" value="' + hex(v) + '">'; }
  function section(title, body) { return '<div class="side-section open"><div class="side-section-head"><span class="ss-lbl">' + title + "</span></div><div class=\"side-section-body\">" + body + "</div></div>"; }

  function render() {
    var box = $("gisItemBody");
    if (!box) return;
    var o = cur, k = kindOf(o);
    if (!o) { box.innerHTML = '<p class="ip-empty">No item selected.</p>'; return; }
    var b = o.getBoundingRect(true, true), html = "";
    html += section("Position and size",
      '<div class="ip-grid">' + row("X (mm)", num("x", r1(b.left / MM))) + row("Y (mm)", num("y", r1(b.top / MM))) +
      row("Width (mm)", num("w", r1(b.width / MM), 0.1, 1)) + row("Height (mm)", num("h", r1(b.height / MM), 0.1, 1)) +
      row("Rotation (°)", num("angle", Math.round(o.angle || 0), 1)) + row("Opacity (%)", num("opacity", Math.round((o.opacity == null ? 1 : o.opacity) * 100), 5, 0)) + "</div>" +
      '<label class="check-row"><input type="checkbox" data-k="lock"' + (o.lockMovementX ? " checked" : "") + ">Lock position</label>");
    if (k === "text") {
      var fam = o.fontFamily || "Inter";
      html += section("Text",
        '<textarea data-k="text" rows="3">' + esc(o.text) + "</textarea>" +
        '<div class="ip-grid">' + row("Font", '<select data-k="fontFamily">' + FONTS.concat(FONTS.indexOf(fam) < 0 ? [fam] : []).map(function (f) { return '<option' + (f === fam ? " selected" : "") + ">" + esc(f) + "</option>"; }).join("") + "</select>") +
        row("Size (pt)", num("fontSize", Math.round((o.fontSize || 12) * 0.75 * 10) / 10, 0.5, 1)) +
        row("Colour", color("fill", o.fill)) +
        row("Line spacing", num("lineHeight", r1(o.lineHeight || 1.16), 0.05, 0.5)) + "</div>" +
        '<div class="ip-btns">' +
          '<button type="button" data-t="bold" class="' + (String(o.fontWeight) === "bold" || +o.fontWeight >= 600 ? "on" : "") + '" title="Bold">' + sym("format_bold") + "</button>" +
          '<button type="button" data-t="italic" class="' + (o.fontStyle === "italic" ? "on" : "") + '" title="Italic">' + sym("format_italic") + "</button>" +
          '<button type="button" data-t="underline" class="' + (o.underline ? "on" : "") + '" title="Underline">' + sym("format_underlined") + "</button>" +
          '<span class="ip-sep"></span>' +
          ["left", "center", "right"].map(function (a) { return '<button type="button" data-align="' + a + '" class="' + ((o.textAlign || "left") === a ? "on" : "") + '" title="Align ' + a + '">' + sym("format_align_" + a) + "</button>"; }).join("") +
        "</div>");
      html += section("Background and halo",
        '<label class="check-row"><input type="checkbox" data-k="bgOn"' + (o.backgroundColor ? " checked" : "") + ">Background</label>" +
        '<div class="ip-grid">' + row("Background", color("backgroundColor", o.backgroundColor || "#ffffff")) + row("Halo colour", color("stroke", o.stroke || "#ffffff")) +
        row("Halo width", num("haloW", r1(o.paintFirst === "stroke" ? o.strokeWidth || 0 : 0), 0.5, 0)) + "</div>");
    }
    if (k === "shape") {
      var noFill = !o.fill || o.fill === "transparent" || o.fill === "rgba(0,0,0,0)";
      var dash = o.strokeDashArray && o.strokeDashArray.length ? (o.strokeDashArray[0] <= o.strokeWidth ? "dot" : "dash") : "solid";
      html += section("Fill",
        (o.type === "line" || o.type === "polyline" ? "" : '<label class="check-row"><input type="checkbox" data-k="fillOn"' + (noFill ? "" : " checked") + ">Fill</label>" + '<div class="ip-grid">' + row("Colour", color("fillColor", noFill ? "#ffffff" : o.fill)) + "</div>"));
      html += section("Outline",
        '<div class="ip-grid">' + row("Colour", color("stroke", o.stroke || "#000000")) + row("Width (pt)", num("strokeWidth", r1((o.strokeWidth || 0) * 0.75), 0.25, 0)) +
        row("Style", '<select data-k="dash"><option value="solid"' + (dash === "solid" ? " selected" : "") + '>Solid</option><option value="dash"' + (dash === "dash" ? " selected" : "") + '>Dashed</option><option value="dot"' + (dash === "dot" ? " selected" : "") + ">Dotted</option></select>") +
        (o.type === "rect" ? row("Corner radius (mm)", num("rx", r1((o.rx || 0) / MM), 0.5, 0)) : "") + "</div>");
    }
    if (k === "image" || k === "item") html += "";
    box.innerHTML = html;
  }

  function apply(k, v, el) {
    var o = cur, c = fc();
    if (!o || !c) return;
    var b = o.getBoundingRect(true, true);
    if (k === "x") o.set({ left: o.left + (v * MM - b.left) });
    else if (k === "y") o.set({ top: o.top + (v * MM - b.top) });
    else if (k === "w" && v > 0) o.set({ scaleX: o.scaleX * (v * MM / b.width) });
    else if (k === "h" && v > 0) o.set({ scaleY: o.scaleY * (v * MM / b.height) });
    else if (k === "angle") o.rotate(v);
    else if (k === "opacity") o.set({ opacity: Math.max(0, Math.min(1, v / 100)) });
    else if (k === "lock") o.set({ lockMovementX: el.checked, lockMovementY: el.checked, lockScalingX: el.checked, lockScalingY: el.checked, lockRotation: el.checked });
    else if (k === "text") o.set({ text: el.value });
    else if (k === "fontFamily") o.set({ fontFamily: el.value });
    else if (k === "fontSize" && v > 0) o.set({ fontSize: v / 0.75 });
    else if (k === "fill" || k === "stroke") o.set(k, el.value);
    else if (k === "lineHeight" && v > 0) o.set({ lineHeight: v });
    else if (k === "bgOn") o.set({ backgroundColor: el.checked ? (el.closest(".side-section-body").querySelector('[data-k="backgroundColor"]').value) : "" });
    else if (k === "backgroundColor") { if (o.backgroundColor) o.set({ backgroundColor: el.value }); }
    else if (k === "haloW") o.set({ strokeWidth: v, paintFirst: v > 0 ? "stroke" : "fill", stroke: v > 0 ? (o.stroke || "#ffffff") : o.stroke, strokeLineJoin: "round" });
    else if (k === "fillOn") o.set({ fill: el.checked ? el.closest(".side-section-body").querySelector('[data-k="fillColor"]').value : "transparent" });
    else if (k === "fillColor") { if (o.fill && o.fill !== "transparent") o.set({ fill: el.value }); }
    else if (k === "strokeWidth") o.set({ strokeWidth: v / 0.75 });
    else if (k === "dash") o.set({ strokeDashArray: el.value === "dash" ? [6 * (o.strokeWidth || 1), 4 * (o.strokeWidth || 1)] : el.value === "dot" ? [o.strokeWidth || 1, 3 * (o.strokeWidth || 1)] : null });
    else if (k === "rx") o.set({ rx: v * MM, ry: v * MM });
    if (o.type === "textbox" && o.initDimensions) o.initDimensions();
    o.setCoords(); c.requestRenderAll();
    c.fire("object:modified", { target: o });
    if (typeof historyNotifyChange === "function") historyNotifyChange();
  }

  function build() {
    if ($(PANEL)) return;
    var p = document.createElement("div");
    p.id = PANEL; p.className = "sidebar-panel";
    p.innerHTML = '<div class="sp-head"><span class="sp-title">Item properties</span><button type="button" class="sp-close" title="Close panel">' + sym("keyboard_double_arrow_left") + '</button></div><div id="gisItemBody"></div>';
    document.querySelector(".sidebar").appendChild(p);
    p.querySelector(".sp-close").addEventListener("click", function () { window.closeSidebar(); });
    var body = $("gisItemBody");
    body.addEventListener("change", function (e) { var el = e.target.closest("[data-k]"); if (el) apply(el.dataset.k, parseFloat(el.value), el); });
    body.addEventListener("input", function (e) { var el = e.target.closest('[data-k="text"],[type=color]'); if (el) apply(el.dataset.k, NaN, el); });
    body.addEventListener("keydown", function (e) { e.stopPropagation(); });
    body.addEventListener("click", function (e) {
      var b = e.target.closest("[data-t],[data-align]"), o = cur;
      if (!b || !o) return;
      if (b.dataset.align) o.set({ textAlign: b.dataset.align });
      else if (b.dataset.t === "bold") o.set({ fontWeight: String(o.fontWeight) === "bold" || +o.fontWeight >= 600 ? "normal" : "bold" });
      else if (b.dataset.t === "italic") o.set({ fontStyle: o.fontStyle === "italic" ? "normal" : "italic" });
      else if (b.dataset.t === "underline") o.set({ underline: !o.underline });
      o.setCoords(); fc().requestRenderAll(); fc().fire("object:modified", { target: o });
      render();
    });

    // Rail button, Cartography only.
    var nav = document.querySelector(".sidebar-nav"), rb = document.createElement("button");
    rb.className = "nav-btn nav-carto"; rb.setAttribute("data-panel", PANEL); rb.title = "Item properties";
    rb.innerHTML = sym("tune") + '<span class="nav-lbl">Item</span>';
    var mapBtn = nav.querySelector('[data-panel="panel-map"]');
    if (mapBtn) mapBtn.after(rb); else nav.appendChild(rb);
    rb.addEventListener("click", function () { if (rb.classList.contains("active")) window.closeSidebar(); else { activateSidebarPanel(PANEL); render(); } });

    // Chart-builder rail tools stay in Chart mode; the object list is "Items".
    Array.prototype.forEach.call(nav.querySelectorAll(".nav-btn"), function (b) {
      var p = b.dataset.panel || "", t = (b.title || "").trim();
      if (/^panel-(canvas|shapes|latex)$/.test(p) || t === "Design") b.classList.add("nav-chart-only");
      if (t === "Layers" && !b.classList.contains("nav-gis")) { b.classList.add("nav-items"); var l = b.querySelector(".nav-lbl, span:not(.material-symbols-outlined)"); if (l) l.dataset.chartLabel = l.textContent; }
    });
  }

  function onSelect() {
    if (!carto()) return;
    var c = fc(), o = c && c.getActiveObject();
    cur = o && o.type !== "activeSelection" ? o : null;
    var k = kindOf(cur);
    if (k === "map") { activateSidebarPanel("panel-map"); return; }
    if (cur) { activateSidebarPanel(PANEL); render(); }
  }
  function hook() {
    var c = fc();
    if (!c || c._gisItemHooked) return;
    c._gisItemHooked = true;
    c.on("selection:created", function () { setTimeout(onSelect, 0); });
    c.on("selection:updated", function () { setTimeout(onSelect, 0); });
    c.on("selection:cleared", function () { cur = null; if (carto()) render(); });
    c.on("object:modified", function (e) { if (carto() && e.target === cur && document.activeElement && !$("gisItemBody").contains(document.activeElement)) render(); });
  }
  function init() { build(); hook(); }
  document.addEventListener("ploots:canvasready", hook);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(init, 120); }); else setTimeout(init, 120);
})();
