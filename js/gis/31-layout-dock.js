/* ==========================================================================
   GIS — Layout view frame, as QGIS's Layout window:

   Left    a thin tool column: select, move map content, zoom in / out /
           100 % / whole page, then the items to insert (title, text, legend,
           scale bar, north arrow, inset, picture, rectangle, ellipse, line,
           arrow). No wide panel opens on the left in this view.
   Right   a dock with tabs: Items (the list of layout items), Item
           Properties (the selected item: the Map frame settings for the
           map, text or shape settings for the rest) and Layout (paper size
           and export). It replaces the Layers / Layer styling dock here.
   The single Export button (top right) opens Layout > Export.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  function $(id) { return document.getElementById(id); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function carto() { return document.body.classList.contains("gis-carto"); }

  var dock = null, tabs = {}, homes = [], tool = null;
  var TOOLS = [
    ["select", "arrow_selector_tool", "Select and move items"], ["move", "open_with", "Move map content (pan inside the map frame)"], "-",
    ["zin", "zoom_in", "Zoom in"], ["zout", "zoom_out", "Zoom out"], ["z100", "pageview", "Zoom to 100%"], ["zfit", "fit_screen", "Zoom to the whole page"], "-",
    ["i:mapframe", "add_photo_alternate", "Add a map frame (another map)"], ["i:title", "title", "Add a title"], ["i:text", "text_fields", "Add text"], ["i:legend", "format_list_bulleted", "Add a legend"],
    ["i:scalebar", "straighten", "Add a scale bar"], ["i:north", "navigation", "Add a north arrow"], ["i:inset", "picture_in_picture", "Add an inset map"],
    ["i:image", "image", "Add a picture"], ["i:frame", "crop_square", "Add a rectangle"], ["i:ellipse", "circle", "Add an ellipse"],
    ["i:line", "horizontal_rule", "Add a line"], ["i:arrow", "arrow_right_alt", "Add an arrow"]
  ];

  function build() {
    if (dock || !$("gisDock")) return;
    // Right dock
    dock = document.createElement("aside");
    dock.id = "cartoDock"; dock.className = "carto-dock";
    dock.innerHTML = '<div class="cd-tabs"><button type="button" data-t="items">Items</button><button type="button" data-t="props" class="on">Item Properties</button><button type="button" data-t="layout">Layout</button></div>' +
      '<div class="cd-body"><div class="cd-pane" data-t="items"></div><div class="cd-pane on" data-t="props"><div class="cd-empty">Select an item on the page.</div></div><div class="cd-pane" data-t="layout"></div></div>';
    $("gisDock").after(dock);
    dock.querySelector(".cd-tabs").addEventListener("click", function (e) { var b = e.target.closest("[data-t]"); if (b) show(b.dataset.t); });
    ["items", "props", "layout"].forEach(function (k) { tabs[k] = dock.querySelector('.cd-pane[data-t="' + k + '"]'); });
    // Layout tab: paper
    var P = GIS.cartography && GIS.cartography.PAPERS || null;
    tabs.layout.innerHTML = '<div class="side-section open"><div class="side-section-head"><span class="ss-lbl">Page</span></div><div class="side-section-body">' +
      '<div class="cd-grid"><label><span>Paper</span><select id="cdPaper">' + ["A5", "A4", "A3", "A2", "A1", "A0", "Letter", "Legal", "Tabloid"].map(function (p) { return "<option>" + p + "</option>"; }).join("") + '</select></label>' +
      '<label><span>Orientation</span><select id="cdOrient"><option value="l">Landscape</option><option value="p">Portrait</option></select></label></div></div></div>' +
      '<div class="cd-export"></div>';
    var SIZES = { A5: [148, 210], A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189], Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8] };
    function applyPaper() { var s = SIZES[$("cdPaper").value], l = $("cdOrient").value === "l"; if (s && GIS.cartography) GIS.cartography.setPage(l ? s[1] : s[0], l ? s[0] : s[1]); }
    $("cdPaper").addEventListener("change", applyPaper); $("cdOrient").addEventListener("change", applyPaper);

    // Left tool column
    var nav = document.querySelector(".sidebar-nav");
    tool = document.createElement("div");
    tool.className = "lt-tools";
    tool.innerHTML = TOOLS.map(function (t) { return t === "-" ? '<span class="lt-sep"></span>' : '<button type="button" data-lt="' + t[0] + '" title="' + t[2] + '">' + sym(t[1]) + "</button>"; }).join("");
    nav.insertBefore(tool, nav.children[1] || null);
    tool.addEventListener("click", function (e) {
      var b = e.target.closest("[data-lt]"); if (!b) return;
      var k = b.dataset.lt;
      if (k === "zin" && typeof zoomStep === "function") zoomStep(1);
      else if (k === "zout" && typeof zoomStep === "function") zoomStep(-1);
      else if (k === "z100" && typeof setCanvasZoom === "function") setCanvasZoom(100);
      else if (k === "zfit" && typeof setCanvasZoom === "function") setCanvasZoom(null);
      else if (k === "move") { var mv = $("gisMoveBtn"); if (mv) mv.click(); }
      else if (k === "select") { if (window.fabricCanvas) { fabricCanvas.discardActiveObject(); fabricCanvas.requestRenderAll(); } }
      else if (k === "i:mapframe") { var ins = document.querySelector(".arc-insert button"); if (ins) ins.click(); }
      else if (k.indexOf("i:") === 0 && GIS.arcInsert) GIS.arcInsert(k.slice(2));
    });

    // The one Export button opens Layout > Export in this view.
    document.addEventListener("click", function (e) {
      var b = e.target.closest(".tb-export");
      if (!b || !carto()) return;
      e.stopPropagation(); e.preventDefault();
      show("layout");
      var ex = tabs.layout.querySelector(".cd-export"); if (ex) ex.scrollIntoView({ block: "start" });
    }, true);

    // Item Properties follows the selection.
    function follow() { if (carto()) { show("props", true); propsFor(); } }
    function hook() {
      var c = window.fabricCanvas; if (!c || c._cdHooked) return; c._cdHooked = true;
      c.on("selection:created", function () { setTimeout(follow, 0); });
      c.on("selection:updated", function () { setTimeout(follow, 0); });
      c.on("selection:cleared", function () { setTimeout(propsFor, 0); });
    }
    hook(); document.addEventListener("ploots:canvasready", hook);
    place();
    new MutationObserver(place).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
  function show(k, keep) {
    Array.prototype.forEach.call(dock.querySelectorAll(".cd-tabs [data-t]"), function (b) { b.classList.toggle("on", b.dataset.t === k); });
    Object.keys(tabs).forEach(function (t) { tabs[t].classList.toggle("on", t === k); });
  }
  function selected() { var c = window.fabricCanvas, o = c && c.getActiveObject(); return o && o.type !== "activeSelection" ? o : null; }
  function propsFor() {
    var o = selected(), isMap = o && (o === window.chartProxyObj || o.isChartProxy);
    var map = $("panel-map"), item = $("panel-gis-item"), empty = tabs.props.querySelector(".cd-empty");
    if (map) map.classList.toggle("cd-on", !!isMap);
    if (item) item.classList.toggle("cd-on", !!o && !isMap);
    if (empty) empty.style.display = o ? "none" : "";
  }
  // Move the panels into the dock in Layout view, and back out of it.
  function adopt(el, pane) { if (!el || el.parentNode === pane) return; homes.push([el, el.parentNode, el.nextSibling]); pane.appendChild(el); }
  function place() {
    if (!dock) return;
    var on = carto();
    dock.style.display = on ? "" : "none";
    tool.style.display = on ? "" : "none";
    if (on) {
      if (window.closeSidebar) try { closeSidebar(); } catch (e) { }
      adopt($("layersPanel"), tabs.items);
      adopt($("panel-map"), tabs.props);
      adopt($("panel-gis-item"), tabs.props);
      adopt($("panel-export"), tabs.layout.querySelector(".cd-export"));
      // The layout toolbar (templates, page, align, arrange) goes into the top bar: no floating bars here.
      var cb = document.querySelector(".carto-bar"), center = document.querySelector(".topbar-center"), ins = document.querySelector(".arc-insert");
      if (cb && center && cb.parentNode !== center) { cb.classList.add("in-topbar"); if (ins) ins.after(cb); else center.appendChild(cb); }
      propsFor();
    } else {
      homes.splice(0).reverse().forEach(function (h) { if (h[1]) h[1].insertBefore(h[0], h[2] && h[2].parentNode === h[1] ? h[2] : null); h[0].classList.remove("cd-on"); });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(build, 300); }); else setTimeout(build, 300);
})();
