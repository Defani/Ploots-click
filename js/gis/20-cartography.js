/* ==========================================================================
   GIS — Cartography view: the layout toolbar and layout templates.

   The Cartography view is the print layout (like QGIS's Layout Manager):
   the analysis tools (Geoprocessing, Toolbox, GFW, Catalog, Kobo, the add
   data buttons) stay in Analysis, and the page gets its own toolbar:

   Items      title, text, legend, scale bar, north arrow, inset map,
              color bar, image, frame (rectangle), line
   Arrange    align (to the page, or within a multiple selection),
              distribute, bring to front / send to back, group, lock
   Page       paper size and orientation (A5 … A0, Letter, Legal)
   Templates  ready layouts (landscape with side panel, portrait report,
              poster, minimal): page size, map frame, title block,
              legend, scale bar, north arrow and credits in one step
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  function $(id) { return document.getElementById(id); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function fc() { return window.fabricCanvas; }
  function notify() { if (typeof historyNotifyChange === "function") historyNotifyChange(); }
  function font(kind) { return (kind === "title" ? state.fontTitle : null) || state.fontBody || "Poppins"; }
  var MM = 96 / 25.4;

  /* ------------------------------------------------------------ page */

  var PAPERS = [["A5", 148, 210], ["A4", 210, 297], ["A3", 297, 420], ["A2", 420, 594], ["A1", 594, 841], ["A0", 841, 1189], ["Letter", 215.9, 279.4], ["Legal", 215.9, 355.6], ["Tabloid", 279.4, 431.8]];
  function setPage(wMm, hMm) {
    var W = $("chartWidth"), H = $("chartHeight");
    if (!W || !H) return;
    function val(mm) { var px = mm * MM; return typeof fromBaselinePx === "function" ? fromBaselinePx(Math.round(px), state.canvasUnit) : Math.round(mm); }
    W.value = val(wMm); W.dispatchEvent(new Event("input"));
    H.value = val(hMm); H.dispatchEvent(new Event("input"));
    if (typeof onCanvasSizeChanged === "function") onCanvasSizeChanged();
    if (typeof setCanvasZoom === "function") try { setCanvasZoom(null); } catch (e) { }
  }
  function pageMm() { return [Math.round(state.canvasWidthPx / MM), Math.round(state.canvasHeightPx / MM)]; }

  /* -------------------------------------------------------- arranging */

  function selected() {
    var c = fc(), o = c && c.getActiveObject();
    if (!o) return [];
    return o.type === "activeSelection" ? o.getObjects().slice() : [o];
  }
  function moveBy(o, dx, dy) {
    if (!dx && !dy) return;
    o.set({ left: o.left + dx, top: o.top + dy });
    o.setCoords();
    if (o.isChartProxy && typeof syncProxyToChart === "function") { syncProxyToChart(); if (typeof render === "function") render(); }
    fc().fire("object:modified", { target: o });
  }
  function withLoose(list, fn) {
    // Work on absolute positions: take the objects out of the selection first.
    var c = fc(), multi = list.length > 1;
    if (multi) c.discardActiveObject();
    fn();
    if (multi) c.setActiveObject(new fabric.ActiveSelection(list, { canvas: c }));
    c.requestRenderAll();
    notify();
  }
  function align(where) {
    var list = selected();
    if (!list.length) return toast("Select an item on the page first.");
    withLoose(list, function () {
      var rs = list.map(function (o) { return o.getBoundingRect(true, true); });
      var L, T, R, B;
      if (list.length === 1) { L = 0; T = 0; R = state.canvasWidthPx; B = state.canvasHeightPx; }
      else {
        L = Math.min.apply(null, rs.map(function (r) { return r.left; })); T = Math.min.apply(null, rs.map(function (r) { return r.top; }));
        R = Math.max.apply(null, rs.map(function (r) { return r.left + r.width; })); B = Math.max.apply(null, rs.map(function (r) { return r.top + r.height; }));
      }
      list.forEach(function (o, i) {
        var r = rs[i], dx = 0, dy = 0;
        if (where === "left") dx = L - r.left;
        else if (where === "center") dx = (L + R) / 2 - (r.left + r.width / 2);
        else if (where === "right") dx = R - (r.left + r.width);
        else if (where === "top") dy = T - r.top;
        else if (where === "middle") dy = (T + B) / 2 - (r.top + r.height / 2);
        else if (where === "bottom") dy = B - (r.top + r.height);
        moveBy(o, dx, dy);
      });
    });
  }
  function distribute(axis) {
    var list = selected();
    if (list.length < 3) return toast("Select three or more items to distribute.");
    withLoose(list, function () {
      var h = axis === "h", items = list.map(function (o) { return { o: o, r: o.getBoundingRect(true, true) }; });
      items.sort(function (a, b) { return h ? a.r.left - b.r.left : a.r.top - b.r.top; });
      var first = items[0].r, last = items[items.length - 1].r;
      var span = h ? last.left + last.width - first.left : last.top + last.height - first.top;
      var sizes = items.reduce(function (s, x) { return s + (h ? x.r.width : x.r.height); }, 0);
      var gap = (span - sizes) / (items.length - 1), pos = h ? first.left : first.top;
      items.forEach(function (x) {
        var cur = h ? x.r.left : x.r.top;
        if (h) moveBy(x.o, pos - cur, 0); else moveBy(x.o, 0, pos - cur);
        pos += (h ? x.r.width : x.r.height) + gap;
      });
    });
  }
  function order(dir) {
    var list = selected(), c = fc();
    if (!list.length) return toast("Select an item on the page first.");
    list.forEach(function (o) { if (dir === "front") c.bringToFront(o); else if (dir === "back") c.sendToBack(o); else if (dir === "forward") c.bringForward(o); else c.sendBackwards(o); });
    c.requestRenderAll();
    notify();
  }

  /* ------------------------------------------------------------ items */

  function addText(text, opts) {
    var c = fc();
    if (!c) return null;
    var t = new fabric.Textbox(text, Object.assign({ left: 40, top: 40, width: 360, fontSize: 18, fontFamily: font(), fill: "#1a1a1a", editable: true }, opts || {}));
    c.add(t);
    c.setActiveObject(t);
    c.requestRenderAll();
    notify();
    return t;
  }
  function addRect(opts) {
    var c = fc();
    var r = new fabric.Rect(Object.assign({ left: 60, top: 60, width: 240, height: 140, fill: "rgba(0,0,0,0)", stroke: "#1a1a1a", strokeWidth: 1.2, strokeUniform: true }, opts || {}));
    c.add(r); c.setActiveObject(r); c.requestRenderAll(); notify();
    return r;
  }
  function addLine() {
    var c = fc(), cx = state.canvasWidthPx / 2, cy = state.canvasHeightPx / 2;
    var l = new fabric.Line([cx - 120, cy, cx + 120, cy], { stroke: "#1a1a1a", strokeWidth: 1.2, strokeUniform: true });
    c.add(l); c.setActiveObject(l); c.requestRenderAll(); notify();
  }
  function addItem(v) {
    if (v === "title") return addText("Map title", { fontSize: 30, fontWeight: "bold", fontFamily: font("title"), width: 600 });
    if (v === "text") return addText("Text", { fontSize: 14 });
    if (v === "credits") return addText(credits(), { fontSize: 10, fill: "#555", width: 320, lineHeight: 1.3 });
    if (v === "frame") return addRect();
    if (v === "line") return addLine();
    if (v === "image") { var b = $("toolAddImage"); if (b) b.click(); return; }
    return GIS.items && GIS.items.add(v);
  }
  function credits() {
    var src = [];
    GIS.layers.forEach(function (l) { if (l.visible && l.attribution && src.indexOf(l.attribution) < 0) src.push(l.attribution); });
    var bm = GIS.BASEMAPS.filter(function (b) { return b.id === state.mapBasemap; })[0];
    if (bm && bm.attr) src.push("Basemap: " + bm.attr);
    return "Coordinate system: WGS 84 (EPSG:4326)\nData: " + (src.join("; ") || "—") + "\nMap by Defani Arman Alfitriansyah · " + new Date().toISOString().slice(0, 10);
  }

  /* -------------------------------------------------------- templates */

  // Boxes in fractions of the page: [x, y, w, h].
  var TEMPLATES = {
    landscape: { name: "Landscape with side panel", paper: [297, 210], map: [0.035, 0.14, 0.66, 0.81],
      title: [0.035, 0.035, 0.66], sub: [0.035, 0.095], side: [0.72, 0.14, 0.245], neat: true },
    portrait: { name: "Portrait report", paper: [210, 297], map: [0.06, 0.12, 0.88, 0.62],
      title: [0.06, 0.035, 0.88], sub: [0.06, 0.085], bottom: [0.06, 0.765, 0.88], neat: true },
    poster: { name: "Poster (A2 portrait)", paper: [420, 594], map: [0.05, 0.13, 0.9, 0.66],
      title: [0.05, 0.035, 0.9], sub: [0.05, 0.095], bottom: [0.05, 0.81, 0.9], neat: true, big: true },
    minimal: { name: "Minimal (full-page map)", paper: [297, 210], map: [0.02, 0.02, 0.96, 0.96], minimal: true }
  };
  function clearLayout() {
    var c = fc();
    c.getObjects().slice().forEach(function (o) { if (o.gisItem || o.cartoTpl) c.remove(o); });
  }
  function place(o, x, y) { if (!o) return; o.set({ left: x, top: y }); o.setCoords(); fc().fire("object:modified", { target: o }); }
  function applyTemplate(id) {
    var T = TEMPLATES[id], c = fc();
    if (!T || !c) return;
    var has = c.getObjects().some(function (o) { return o.gisItem || o.cartoTpl; });
    if (has && !window.confirm("Replace the current layout items (legend, scale bar, titles…) with the \"" + T.name + "\" template?")) return;
    clearLayout();
    setPage(T.paper[0], T.paper[1]);
    var W = state.canvasWidthPx, H = state.canvasHeightPx, k = T.big ? 1.6 : 1;
    state.chartBox.x = T.map[0] * W; state.chartBox.y = T.map[1] * H; state.chartBox.w = T.map[2] * W; state.chartBox.h = T.map[3] * H;
    if (typeof syncChartBlockDom === "function") syncChartBlockDom();
    if (typeof render === "function") render();
    function tag(o) { if (o) o.cartoTpl = true; return o; }
    if (T.neat) tag(addRect({ left: W * 0.02, top: H * 0.02, width: W * 0.96, height: H * 0.96, strokeWidth: 1.6, selectable: true }));
    if (T.title) {
      tag(addText("Map title", { left: T.title[0] * W, top: T.title[1] * H, width: T.title[2] * W, fontSize: 30 * k, fontWeight: "bold", fontFamily: font("title") }));
      tag(addText("Subtitle — area, period and theme", { left: T.sub[0] * W, top: T.sub[1] * H, width: T.title[2] * W, fontSize: 14 * k, fill: "#555" }));
    }
    var legend, scale, north;
    if (GIS.items) {
      legend = GIS.items.add("legend"); scale = GIS.items.add("scalebar"); north = GIS.items.add("north");
    }
    if (T.side) {
      var sx = T.side[0] * W, sy = T.side[1] * H, sw = T.side[2] * W;
      place(legend, sx, sy);
      if (north) place(north, sx, H * 0.66);
      if (scale) place(scale, sx + 70, H * 0.69);
      tag(addText(credits(), { left: sx, top: H * 0.8, width: sw, fontSize: 9.5, fill: "#555", lineHeight: 1.3 }));
    } else if (T.bottom) {
      var bx = T.bottom[0] * W, by = T.bottom[1] * H, bw = T.bottom[2] * W;
      place(legend, bx, by);
      if (north) place(north, bx + bw - 80 * k, by);
      if (scale) place(scale, bx + bw * 0.5, by + 10);
      tag(addText(credits(), { left: bx + bw * 0.5, top: by + 60 * k, width: bw * 0.5, fontSize: 9.5 * k, fill: "#555", lineHeight: 1.3 }));
    } else if (T.minimal) {
      var b = state.chartBox;
      if (legend) place(legend, b.x + b.w - legend.width - 20, b.y + b.h - legend.height - 20);
    }
    c.discardActiveObject();
    c.requestRenderAll();
    notify();
    toast(T.name + " applied");
  }

  /* ---------------------------------------------------------- toolbar */

  function toast(m) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(m); }
  var bar = null, pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function menu(anchor, html, onPick) {
    if (pop && pop._a === anchor) { closePop(); return; }
    closePop();
    pop = document.createElement("div");
    pop.className = "gis-ctx open carto-menu";
    pop._a = anchor;
    pop.innerHTML = html;
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(6, Math.min(window.innerWidth - pop.offsetWidth - 6, r.left)) + "px";
    pop.style.top = r.bottom + 6 + "px";
    pop.addEventListener("click", function (e) { var b = e.target.closest("[data-v]"); if (b) { closePop(); onPick(b.dataset.v); } });
  }
  function btn(act, icon, title, label) { return '<button type="button" data-act="' + act + '" title="' + title + '">' + sym(icon) + (label ? "<span>" + label + "</span>" : "") + "</button>"; }
  function build() {
    if (bar || !$("paneLayout")) return;
    bar = document.createElement("div");
    bar.className = "carto-bar";
    bar.innerHTML =
      '<div class="carto-grp">' + btn("templates", "auto_awesome_mosaic", "Layout templates", "Templates") + btn("page", "description", "Paper size and orientation", "Page") + "</div>" +
      '<div class="carto-grp">' + btn("title", "title", "Add a title") + btn("text", "text_fields", "Add text") + btn("legend", "format_list_bulleted", "Add a legend") +
        btn("scalebar", "straighten", "Add a scale bar") + btn("north", "navigation", "Add a north arrow") + btn("inset", "picture_in_picture", "Add an inset (overview) map") +
        btn("colorbar", "gradient", "Add a color bar") + btn("image", "image", "Add an image or logo") + btn("frame", "crop_square", "Add a frame") + btn("line", "horizontal_rule", "Add a line") +
        btn("credits", "info", "Add credits (sources, CRS, author, date)") + "</div>" +
      '<div class="carto-grp">' + btn("a-left", "align_horizontal_left", "Align left (to the page, or within the selection)") + btn("a-center", "align_horizontal_center", "Align centers horizontally") +
        btn("a-right", "align_horizontal_right", "Align right") + btn("a-top", "align_vertical_top", "Align top") + btn("a-middle", "align_vertical_center", "Align centers vertically") +
        btn("a-bottom", "align_vertical_bottom", "Align bottom") + btn("d-h", "horizontal_distribute", "Distribute horizontally") + btn("d-v", "vertical_distribute", "Distribute vertically") + "</div>" +
      '<div class="carto-grp">' + btn("front", "flip_to_front", "Bring to front") + btn("back", "flip_to_back", "Send to back") + btn("group", "group_work", "Group") + btn("ungroup", "workspaces", "Ungroup") + btn("lock", "lock", "Lock / unlock") + "</div>";
    $("paneLayout").appendChild(bar);
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (!b) return;
      var a = b.dataset.act;
      if (a === "templates") {
        menu(b, '<div class="gis-ctx-head">Layout templates</div>' + Object.keys(TEMPLATES).map(function (k) {
          var t = TEMPLATES[k];
          return '<button type="button" data-v="' + k + '">' + sym(k === "portrait" || k === "poster" ? "crop_portrait" : "crop_landscape") + "<span>" + t.name + " · " + (k === "poster" ? "A2" : "A4") + "</span></button>";
        }).join(""), applyTemplate);
      } else if (a === "page") {
        var cur = pageMm(), land = cur[0] > cur[1];
        menu(b, '<div class="gis-ctx-head">Paper · now ' + cur[0] + " × " + cur[1] + " mm</div>" + PAPERS.map(function (p) {
          return '<button type="button" data-v="' + p[0] + '">' + sym("description") + "<span>" + p[0] + " (" + p[1] + " × " + p[2] + " mm)</span></button>";
        }).join("") + '<div class="gis-ctx-sep"></div><button type="button" data-v="portrait">' + sym("crop_portrait") + "<span>Portrait" + (land ? "" : " ✓") + '</span></button><button type="button" data-v="landscape">' + sym("crop_landscape") + "<span>Landscape" + (land ? " ✓" : "") + "</span></button>",
        function (v) {
          var m = pageMm(), l = m[0] > m[1];
          if (v === "portrait" || v === "landscape") { var s = [Math.min(m[0], m[1]), Math.max(m[0], m[1])]; if (v === "landscape") s.reverse(); setPage(s[0], s[1]); return; }
          var p = PAPERS.filter(function (x) { return x[0] === v; })[0];
          if (p) setPage(l ? p[2] : p[1], l ? p[1] : p[2]);
        });
      } else if (/^a-/.test(a)) align(a.slice(2));
      else if (a === "d-h" || a === "d-v") distribute(a === "d-h" ? "h" : "v");
      else if (a === "front" || a === "back") order(a);
      else if (a === "group") { if (typeof groupActiveObjects === "function") groupActiveObjects(); }
      else if (a === "ungroup") { if (typeof ungroupActiveObject === "function") ungroupActiveObject(); }
      else if (a === "lock") { if (typeof toggleActiveObjectLock === "function") toggleActiveObjectLock(); }
      else addItem(a);
    });
    document.addEventListener("mousedown", function (e) { if (pop && !pop.contains(e.target) && !(pop._a && pop._a.contains(e.target))) closePop(); });
  }

  function boot() {
    build();
    // Analysis-only buttons in the top bar.
    Array.prototype.forEach.call(document.querySelectorAll("#mainTools .tb-btn"), function (b) {
      if (/Geoprocessing/.test(b.textContent)) b.classList.add("tb-ana");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 50); }); else setTimeout(boot, 50);

  GIS.cartography = { applyTemplate: applyTemplate, align: align, distribute: distribute, setPage: setPage, TEMPLATES: TEMPLATES };
})();
