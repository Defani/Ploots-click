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
    minimal: { name: "Minimal (full-page map)", paper: [297, 210], map: [0.02, 0.02, 0.96, 0.96], minimal: true },
    tematik: { name: "Peta tematik (KLHK / BIG style, A4 portrait)", paper: [210, 297], tematik: true }
  };
  // The Indonesian thematic map sheet (as KLHK, BIG and project maps are
  // drawn): a boxed title, a large map with a D° M' S" grid outside the frame,
  // a locator inset with the north arrow at the top right, the scale bar on
  // the map, and a band of boxes below: KETERANGAN (legend), information,
  // datum and projection, Sumber (sources) and Dibuat (author, year).
  function tematik(tag) {
    var W = state.canvasWidthPx, H = state.canvasHeightPx, mm = W / 210, m = 5 * mm, ink = "#1a1a1a";
    var box = function (x, y, w, h, sw) { return tag(addRect({ left: x, top: y, width: w, height: h, strokeWidth: sw || 0.8, stroke: ink, fill: "#ffffff" })); };
    var txt = function (t, x, y, w, size, o) { return tag(addText(t, Object.assign({ left: x, top: y, width: w, fontSize: size * mm, fill: ink, lineHeight: 1.25 }, o || {}))); };
    tag(addRect({ left: m * 0.5, top: m * 0.5, width: W - m, height: H - m, strokeWidth: 1, stroke: ink }));
    // Title
    var th = 11 * mm;
    box(m, m, W - 2 * m, th, 1);
    txt("PETA JUDUL PETA DI WILAYAH KAJIAN", m + 3 * mm, m + 2.6 * mm, W - 2 * m - 6 * mm, 5.2, { fontWeight: "bold", textAlign: "center", fontFamily: font("title"), charSpacing: 20 });
    // Map, with room around it for the grid labels
    var mx = m, my = m + th + 1.5 * mm, mw = W - 2 * m, mh = H * 0.68; // the map frame keeps its own room for the grid labels
    state.chartBox.x = mx; state.chartBox.y = my; state.chartBox.w = mw; state.chartBox.h = mh;
    Object.assign(state, { mapGrid: true, mapGridType: "geo", mapGridFormat: "dmsfull", mapGridLabels: "all", mapGridLabelPos: "outside", mapGridStyle: state.mapGridStyle || "lines" });
    if (typeof syncChartBlockDom === "function") syncChartBlockDom();
    if (typeof render === "function") render();
    var c = fc();
    // The map itself, inside the room the frame keeps for the grid labels.
    var z = GIS.frameInset ? GIS.frameInset() : { l: 0, t: 0, r: 0, b: 0 }, ax = mx + z.l, ay = my + z.t, aw = mw - z.l - z.r, ah = mh - z.t - z.b;
    if (GIS.items) {
      // Locator inset with the north arrow, top right inside the map
      var iw = aw * 0.32, ih = ah * 0.30, ix = ax + aw - iw - 2.5 * mm, iy = ay + 2.5 * mm;
      var inset = GIS.items.add("inset");
      if (inset) { GIS.items.update(inset, { w: Math.round(iw), h: Math.round(ih), zoomOffset: -3 }); inset = c.getObjects().filter(function (o) { return o.gisItem === "inset"; }).pop(); place(inset, ix, iy); }
      var north = GIS.items.add("north");
      if (north) { GIS.items.update(north, { style: "arrowN", size: Math.round(12 * mm) }); north = c.getObjects().filter(function (o) { return o.gisItem === "north"; }).pop(); place(north, ix + iw - north.getScaledWidth() - 2 * mm, iy + 2 * mm); }
      txt("▭  Area yang dipetakan", ix, iy + ih + 1.5 * mm, iw, 3.2, { backgroundColor: "#ffffff" });
      // Scale bar, bottom right inside the map
      var scale = GIS.items.add("scalebar");
      if (scale) { GIS.items.update(scale, { frame: true, style: "double" }); scale = c.getObjects().filter(function (o) { return o.gisItem === "scalebar"; }).pop(); place(scale, ax + aw - scale.getScaledWidth() - 2.5 * mm, ay + ah - scale.getScaledHeight() - 2.5 * mm); }
    }
    // Bottom band
    var by = my + mh + 1.5 * mm, bh = H - m - by, bw = W - 2 * m, g = 1.5 * mm;
    var w1 = bw * 0.46, w2 = bw * 0.25, w3 = bw - w1 - w2 - 2 * g;
    box(m, by, w1, bh);
    txt("KETERANGAN", m + 3 * mm, by + 2.5 * mm, w1 - 6 * mm, 4.4, { fontWeight: "bold", fontFamily: font("title") });
    if (GIS.items) {
      var legend = GIS.items.add("legend");
      if (legend) { GIS.items.update(legend, { title: "", frame: false, background: "#ffffff", fontSize: 10, boxW: Math.round(w1 - 6 * mm), boxH: Math.round(bh - 12 * mm) }); legend = c.getObjects().filter(function (o) { return o.gisItem === "legend"; }).pop(); fit(legend, w1 - 6 * mm, bh - 12 * mm); place(legend, m + 3 * mm, by + 10 * mm); }
    }
    box(m + w1 + g, by, w2, bh);
    txt("INFORMASI", m + w1 + g + 3 * mm, by + 2.5 * mm, w2 - 6 * mm, 4.0, { fontWeight: "bold", fontFamily: font("title") });
    txt("Isi keterangan tambahan: nomor SK, kelompok tani, luas, catatan lapangan.", m + w1 + g + 3 * mm, by + 10 * mm, w2 - 6 * mm, 3.1);
    var x3 = m + w1 + w2 + 2 * g, h3a = bh * 0.27, h3c = bh * 0.2, h3b = bh - h3a - h3c - 2 * g;
    box(x3, by, w3, h3a);
    txt("Datum      : World Geodetic System 1984\nProyeksi  : Geografis (lintang/bujur)\nGrid          : Geografis (D° M′ S″)", x3 + 2.5 * mm, by + 2 * mm, w3 - 5 * mm, 2.7);
    box(x3, by + h3a + g, w3, h3b);
    var src = [];
    GIS.layers.forEach(function (l) { if (l.visible && l.kind !== "xyz") src.push(l.attribution ? l.name + " (" + l.attribution + ")" : l.name); });
    txt("Sumber:", x3 + 2.5 * mm, by + h3a + g + 1.8 * mm, w3 - 5 * mm, 3.4, { fontWeight: "bold" });
    txt(src.length ? src.map(function (s, i) { return (i + 1) + ". " + s; }).join("\n") : "1. Sumber data", x3 + 2.5 * mm, by + h3a + g + 7 * mm, w3 - 5 * mm, 2.6);
    box(x3, by + bh - h3c, w3, h3c);
    txt("Dibuat oleh: Defani Arman Alfitriansyah\nTahun : " + new Date().getFullYear(), x3 + 2.5 * mm, by + bh - h3c + 2 * mm, w3 - 5 * mm, 2.7);
  }
  function clearLayout() {
    var c = fc();
    c.getObjects().slice().forEach(function (o) { if (o.gisItem || o.cartoTpl) c.remove(o); });
  }
  // Puts the item's visible top-left corner at x, y (whatever its origin).
  function place(o, x, y) {
    if (!o) return;
    o.set({ left: x, top: y }); o.setCoords();
    var r = o.getBoundingRect(true, true);
    o.set({ left: o.left + (x - r.left), top: o.top + (y - r.top) }); o.setCoords();
    fc().fire("object:modified", { target: o });
  }
  // Scales an item down (never up) so it fits inside w × h.
  function fit(o, w, h) {
    if (!o) return;
    var r = o.getBoundingRect(true, true), k = Math.min(1, w / r.width, h / r.height);
    if (k < 1) { o.scale((o.scaleX || 1) * k); o.setCoords(); }
  }
  function applyTemplate(id) {
    var T = TEMPLATES[id], c = fc();
    if (!T || !c) return;
    var has = c.getObjects().some(function (o) { return o.gisItem || o.cartoTpl; });
    if (has && !window.confirm("Replace the current layout items (legend, scale bar, titles…) with the \"" + T.name + "\" template?")) return;
    clearLayout();
    setPage(T.paper[0], T.paper[1]);
    function tag(o) { if (o) o.cartoTpl = true; return o; }
    if (T.tematik) { tematik(tag); c.discardActiveObject(); c.requestRenderAll(); notify(); toast(T.name + " applied"); return; }
    var W = state.canvasWidthPx, H = state.canvasHeightPx, k = T.big ? 1.6 : 1;
    state.chartBox.x = T.map[0] * W; state.chartBox.y = T.map[1] * H; state.chartBox.w = T.map[2] * W; state.chartBox.h = T.map[3] * H;
    if (typeof syncChartBlockDom === "function") syncChartBlockDom();
    if (typeof render === "function") render();
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

  GIS.cartography = { MM: MM, pageMm: pageMm, applyTemplate: applyTemplate, align: align, distribute: distribute, setPage: setPage, TEMPLATES: TEMPLATES };
})();
