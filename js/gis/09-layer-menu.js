/* ==========================================================================
   GIS — layer context menu and dialogs (QGIS / ArcGIS style).

   Right-click a layer (or its ⋮ button) in the Layers list:
     Zoom to layer / selection, Open attribute table, Layer styling,
     Filter…, Select by expression…, select all / invert / clear,
     Show in legend, Show feature count, Show labels,
     Rename, Duplicate, Move to top / bottom, Export, Properties…, Remove.

   Dialogs:
     GIS.exprDialog(layer, "filter" | "select")  expression builder with
                                                 fields, values and a live
                                                 match count
     GIS.fieldCalculator(layer)                  new or existing field from
                                                 an expression
     GIS.layerProperties(layer)                  information, legend name,
                                                 opacity, scale range
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function fmtInt(n) { return Math.round(n).toLocaleString("en-US"); }

  /* ------------------------------------------------------------- menu */

  var menu = document.createElement("div");
  menu.className = "gis-ctx";
  document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(menu); });
  if (document.body) document.body.appendChild(menu);

  function closeMenu() { menu.classList.remove("open"); }
  document.addEventListener("mousedown", function (e) { if (!menu.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });
  window.addEventListener("resize", closeMenu);

  function row(act, icon, label, opts) {
    opts = opts || {};
    return '<button type="button" data-act="' + act + '"' + (opts.disabled ? " disabled" : "") + (opts.danger ? ' class="danger"' : "") + ">" +
      (opts.check !== undefined ? '<span class="material-symbols-outlined gis-ctx-check">' + (opts.check ? "check_box" : "check_box_outline_blank") + "</span>" : sym(icon)) +
      "<span>" + esc(label) + "</span></button>";
  }
  var SEP = '<div class="gis-ctx-sep"></div>';

  function openLayerMenu(id, x, y) {
    var l = GIS.get(id);
    if (!l) return;
    GIS.setActive(id);
    var vec = l.kind === "vector", i = GIS.layers.indexOf(l), n = GIS.layers.length;
    var h = '<div class="gis-ctx-head">' + esc(l.name) + "</div>";
    if (l.kind !== "xyz" && l.kind !== "mvt") h += row("zoom", "zoom_in_map", "Zoom to layer");
    if (vec) h += row("zoomsel", "center_focus_strong", "Zoom to selection", { disabled: !l.selection.size });
    if (vec) h += row("table", "table", "Open attribute table");
    h += row("style", "palette", "Layer styling");
    if (vec) {
      h += SEP + row("filter", "filter_alt", l.filter ? "Edit filter…" : "Filter…");
      if (l.filter) h += row("unfilter", "filter_alt_off", "Clear filter");
      h += row("selexpr", "rule", "Select by expression…");
      h += row("selall", "select_all", "Select all features") + row("invert", "flip", "Invert selection") + row("clearsel", "deselect", "Clear selection", { disabled: !l.selection.size });
      h += row("calc", "calculate", "Field calculator…");
    }
    h += SEP;
    if (l.kind !== "xyz") h += row("legend", "", "Show in legend", { check: l.legend !== false });
    if (vec) {
      h += row("count", "", "Show feature count", { check: !!l.showCount });
      h += row("labels", "", "Show labels", { check: GIS.sym.hasLabels(l) });
    }
    h += SEP + row("rename", "edit", "Rename…") + row("dup", "content_copy", "Duplicate layer");
    h += row("top", "vertical_align_top", "Move to top", { disabled: i === 0 }) + row("bottom", "vertical_align_bottom", "Move to bottom", { disabled: i === n - 1 });
    if (vec) h += SEP + row("xgeo", "download", "Export GeoJSON") + row("xgeosel", "download", "Export selected features", { disabled: !l.selection.size }) + row("xcsv", "download", "Export CSV");
    h += SEP + row("props", "tune", "Properties…") + row("remove", "delete", "Remove layer", { danger: true });
    menu.innerHTML = h;
    menu.classList.add("open");
    var w = menu.offsetWidth, hh = menu.offsetHeight;
    menu.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, x)) + "px";
    menu.style.top = Math.max(6, Math.min(window.innerHeight - hh - 6, y)) + "px";
    menu.onclick = function (e) {
      var b = e.target.closest("button[data-act]");
      if (!b || b.disabled) return;
      closeMenu();
      run(l, b.dataset.act);
    };
  }
  GIS.layerMenu = openLayerMenu;

  function run(l, act) {
    var A = GIS.mapActions;
    switch (act) {
      case "zoom": if (A) A.zoomToLayer(l); break;
      case "zoomsel": if (A) A.zoomToSelection(); break;
      case "table": GIS.attributeTable.show(l.id); break;
      case "style": openStyling(); break;
      case "filter": exprDialog(l, "filter"); break;
      case "unfilter": l.filter = ""; GIS.emit("style"); GIS.emit("layers"); break;
      case "selexpr": exprDialog(l, "select"); break;
      case "selall": l.data.features.forEach(function (f, i) { l.selection.add(i); }); GIS.emit("selection"); break;
      case "invert": var s = new Set(); l.data.features.forEach(function (f, i) { if (!l.selection.has(i)) s.add(i); }); l.selection = s; GIS.emit("selection"); break;
      case "clearsel": l.selection.clear(); GIS.emit("selection"); break;
      case "calc": fieldCalculator(l); break;
      case "legend": l.legend = l.legend === false; GIS.emit("style"); GIS.emit("layers"); break;
      case "count": l.showCount = !l.showCount; GIS.emit("layers"); break;
      case "labels": toggleLabels(l); break;
      case "rename": var nm = (window.prompt("Layer name", l.name) || "").trim(); if (nm) { l.name = nm; GIS.emit("layers"); } break;
      case "dup": GIS.duplicate(l.id); break;
      case "top": GIS.move(l.id, 0); break;
      case "bottom": GIS.move(l.id, GIS.layers.length - 1); break;
      case "xgeo": GIS.exportGeoJSON(l, false); break;
      case "xgeosel": GIS.exportGeoJSON(l, true); break;
      case "xcsv": GIS.exportCSV(l, false); break;
      case "props": layerProperties(l); break;
      case "remove": GIS.remove(l.id); break;
    }
  }

  function openStyling() {
    if (GIS.enterMapMode) GIS.enterMapMode();
    if (typeof activateSidebarPanel === "function") activateSidebarPanel("panel-map");
    var sec = document.querySelector('#panel-map [data-section="gisStyle"]');
    if (!sec) return;
    sec.classList.add("open");
    setTimeout(function () { sec.scrollIntoView({ block: "start", behavior: "smooth" }); }, 30);
  }
  GIS.openStyling = openStyling;

  // Labels on: keep the last field, or guess a name-like one.
  function toggleLabels(l) {
    GIS.ensureStyle(l);
    var s = l.style;
    if (GIS.sym.hasLabels(l)) { s._lastLabel = s.labelField; s._lastTemplate = s.labelTemplate; s.labelField = ""; s.labelTemplate = ""; }
    else {
      var f = GIS.fields(l).all;
      s.labelTemplate = s._lastTemplate || "";
      s.labelField = s._lastLabel || f.filter(function (k) { return /^(name|nama|label|title|judul)/i.test(k); })[0] || f[0] || "";
    }
    GIS.emit("style");
    if (GIS.refreshPanel) GIS.refreshPanel();
  }

  /* ----------------------------------------------------------- dialog */

  function dialog(title, body, buttons, wide) {
    var back = document.createElement("div");
    back.className = "gis-dlg-back";
    back.innerHTML = '<div class="gis-dlg' + (wide ? " wide" : "") + '" role="dialog" aria-label="' + esc(title) + '">' +
      '<div class="gis-dlg-head"><span>' + esc(title) + '</span><button type="button" data-close title="Close">' + sym("close") + "</button></div>" +
      '<div class="gis-dlg-body">' + body + "</div>" +
      '<div class="gis-dlg-foot">' + buttons.map(function (b) { return '<button type="button" data-btn="' + b[0] + '"' + (b[2] ? ' class="btn-primary"' : "") + ">" + esc(b[1]) + "</button>"; }).join("") + "</div></div>";
    document.body.appendChild(back);
    function close() { back.remove(); document.removeEventListener("keydown", key, true); }
    function key(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
    document.addEventListener("keydown", key, true);
    back.addEventListener("mousedown", function (e) { if (e.target === back) close(); });
    back.querySelector("[data-close]").addEventListener("click", close);
    return { el: back, close: close, q: function (s) { return back.querySelector(s); } };
  }

  /* ------------------------------------------------ expression builder */

  var OPS = ["=", "!=", "<", ">", "<=", ">=", "AND", "OR", "NOT", "LIKE", "IN ( )", "IS NULL", "( )", "%", "+", "-", "*", "/", "||"];

  function uniqueValues(l, field, limit) {
    var seen = new Map();
    l.data.features.forEach(function (f) { var v = f.properties[field]; if (v !== null && v !== undefined && v !== "" && typeof v !== "object") seen.set(String(v), v); });
    var vals = Array.from(seen.values());
    var numeric = vals.every(function (v) { return typeof v === "number" || isFinite(Number(v)); });
    vals.sort(numeric ? function (a, b) { return Number(a) - Number(b); } : function (a, b) { return String(a).localeCompare(String(b)); });
    return { values: vals.slice(0, limit || 500), numeric: numeric, total: vals.length };
  }
  function literal(v, numeric) { return numeric && isFinite(Number(v)) ? String(v) : "'" + String(v).replace(/'/g, "''") + "'"; }

  // The shared builder: field list, value list, operators, text box and a
  // live "N of M features" count.
  function builderHtml(l, expr) {
    var fields = GIS.fields(l).all;
    return '<div class="gis-expr">' +
      '<div class="gis-expr-col"><div class="gis-expr-lbl">Fields</div><div class="gis-expr-list" data-fields>' +
        fields.map(function (k) { return '<button type="button" data-field="' + esc(k) + '">' + esc(k) + "</button>"; }).join("") + "</div></div>" +
      '<div class="gis-expr-col"><div class="gis-expr-lbl">Values <em data-vcount></em></div><div class="gis-expr-list" data-values></div></div>' +
      "</div>" +
      '<div class="gis-expr-ops">' + OPS.map(function (o) { return '<button type="button" data-op="' + esc(o) + '">' + esc(o) + "</button>"; }).join("") + "</div>" +
      '<textarea class="gis-expr-text" spellcheck="false" placeholder="&quot;field&quot; = \'value\'">' + esc(expr || "") + "</textarea>" +
      '<div class="gis-expr-status" data-status></div>';
  }
  function wireBuilder(d, l, evalMode) {
    var ta = d.q(".gis-expr-text"), status = d.q("[data-status]");
    function insert(s) {
      var a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
      var pad = a > 0 && !/\s$/.test(v.slice(0, a)) ? " " : "";
      ta.value = v.slice(0, a) + pad + s + v.slice(b);
      var pos = a + pad.length + s.length;
      if (/\( \)$/.test(s)) pos -= 2;
      ta.focus(); ta.setSelectionRange(pos, pos);
      check();
    }
    function check() {
      var src = ta.value.trim();
      if (!src) { status.textContent = ""; status.className = "gis-expr-status"; return null; }
      try {
        var fn = GIS.expr.compile(src);
        if (evalMode === "value") {
          var f0 = l.data.features[0], v0 = f0 ? fn(f0.properties) : null;
          status.textContent = "Preview (feature 1): " + (v0 === undefined ? "NULL" : typeof v0 === "number" && !isFinite(v0) ? "NULL" : String(v0));
        } else {
          var n = 0;
          l.data.features.forEach(function (f) { try { if (fn(f.properties)) n++; } catch (e) { } });
          status.textContent = fmtInt(n) + " of " + fmtInt(l.data.features.length) + " features match";
        }
        status.className = "gis-expr-status ok";
        return fn;
      } catch (e) {
        status.textContent = e.message;
        status.className = "gis-expr-status error";
        return null;
      }
    }
    d.q("[data-fields]").addEventListener("click", function (e) {
      var b = e.target.closest("[data-field]");
      if (!b) return;
      Array.prototype.forEach.call(d.el.querySelectorAll("[data-field]"), function (x) { x.classList.toggle("active", x === b); });
      var u = uniqueValues(l, b.dataset.field, 500);
      insert('"' + b.dataset.field + '"');
      d.q("[data-vcount]").textContent = u.total > u.values.length ? "(first " + u.values.length + " of " + fmtInt(u.total) + ")" : "(" + u.total + ")";
      d.q("[data-values]").innerHTML = u.values.map(function (v) { return '<button type="button" data-value="' + esc(literal(v, u.numeric)) + '">' + esc(v) + "</button>"; }).join("") || '<div class="gis-expr-hint">No values</div>';
    });
    d.q("[data-values]").addEventListener("click", function (e) { var b = e.target.closest("[data-value]"); if (b) insert(b.dataset.value); });
    d.q(".gis-expr-ops").addEventListener("click", function (e) { var b = e.target.closest("[data-op]"); if (b) insert(b.dataset.op); });
    ta.addEventListener("input", check);
    check();
    return { check: check, text: function () { return ta.value.trim(); } };
  }

  function exprDialog(l, mode) {
    if (!l || l.kind !== "vector") return;
    var isFilter = mode === "filter";
    var body = builderHtml(l, isFilter ? l.filter : "");
    if (!isFilter) body += '<label class="field-label">Selection</label><select data-mode><option value="new">Create new selection</option><option value="add">Add to current selection</option><option value="remove">Remove from current selection</option><option value="within">Filter current selection</option></select>';
    var d = dialog((isFilter ? "Filter — " : "Select by expression — ") + l.name, body,
      isFilter ? [["clear", "Clear"], ["cancel", "Cancel"], ["ok", "OK", true]] : [["zoom", "Zoom to selection"], ["close", "Close"], ["ok", "Select features", true]], true);
    var b = wireBuilder(d, l);
    d.el.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-btn]");
      if (!btn) return;
      var k = btn.dataset.btn;
      if (k === "cancel" || k === "close") { d.close(); return; }
      if (k === "clear") { l.filter = ""; GIS.emit("style"); GIS.emit("layers"); d.close(); return; }
      if (k === "zoom") { if (GIS.mapActions) GIS.mapActions.zoomToSelection(); return; }
      var src = b.text();
      if (isFilter) {
        if (src && !b.check()) return;
        l.filter = src;
        GIS.emit("style"); GIS.emit("layers");
        d.close();
        return;
      }
      if (!src || !b.check()) return;
      var n = GIS.selectWhere(l, src, d.q("[data-mode]").value);
      d.q("[data-status]").textContent = fmtInt(n) + " feature" + (n === 1 ? "" : "s") + " selected";
    });
  }
  GIS.exprDialog = exprDialog;

  /* ---------------------------------------------------- field calculator */

  function fieldCalculator(l) {
    if (!l || l.kind !== "vector") return;
    var fields = GIS.fields(l).all;
    var body =
      '<div class="gis-calc-top">' +
        '<div><label class="check-row"><input type="radio" name="gcalc" value="new" checked> Create a new field</label>' +
          '<input type="text" data-new placeholder="Field name"><select data-type><option value="number">Decimal number</option><option value="integer">Whole number</option><option value="text">Text</option></select></div>' +
        '<div><label class="check-row"><input type="radio" name="gcalc" value="update"' + (fields.length ? "" : " disabled") + "> Update existing field</label>" +
          "<select data-existing>" + fields.map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + "</option>"; }).join("") + "</select>" +
          '<label class="check-row"><input type="checkbox" data-selonly' + (l.selection.size ? "" : " disabled") + "> Only selected features (" + l.selection.size + ")</label></div>" +
      "</div>" + builderHtml(l, "");
    var d = dialog("Field calculator — " + l.name, body, [["cancel", "Cancel"], ["ok", "OK", true]], true);
    var b = wireBuilder(d, l, "value");
    d.el.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-btn]");
      if (!btn) return;
      if (btn.dataset.btn === "cancel") { d.close(); return; }
      var fn = b.check(), status = d.q("[data-status]");
      if (!fn) { if (!b.text()) { status.textContent = "Enter an expression"; status.className = "gis-expr-status error"; } return; }
      var isNew = d.el.querySelector('input[name="gcalc"]:checked').value === "new";
      var name = isNew ? d.q("[data-new]").value.trim() : d.q("[data-existing]").value, type = d.q("[data-type]").value;
      if (!name) { status.textContent = "Enter a field name"; status.className = "gis-expr-status error"; return; }
      var only = d.q("[data-selonly]").checked;
      l.data.features.forEach(function (f, i) {
        if (only && !l.selection.has(i)) { if (isNew && !(name in f.properties)) f.properties[name] = null; return; }
        var v;
        try { v = fn(f.properties); } catch (err) { v = null; }
        if (typeof v === "number" && !isFinite(v)) v = null;
        if (isNew && v !== null && v !== undefined) v = type === "text" ? String(v) : type === "integer" ? Math.round(Number(v)) : Number(v);
        if (typeof v === "number" && !isFinite(v)) v = null;
        f.properties[name] = v === undefined ? null : v;
      });
      l.rev = (l.rev || 0) + 1;
      GIS.emit("data");
      if (GIS.attributeTable.isOpen()) GIS.attributeTable.show(l.id);
      d.close();
    });
  }
  GIS.fieldCalculator = fieldCalculator;

  /* ---------------------------------------------------- layer properties */

  function geomSummary(l) {
    var c = {};
    l.data.features.forEach(function (f) { c[f.geometry.type] = (c[f.geometry.type] || 0) + 1; });
    return Object.keys(c).map(function (k) { return k + " (" + fmtInt(c[k]) + ")"; }).join(", ");
  }
  function extentText(l) {
    var b = l.kind === "vector" || l.kind === "raster" ? GIS.bounds([Object.assign({}, l, { visible: true })]) : null;
    if (!b) return "—";
    function r(v) { return (+v).toFixed(5); }
    return r(b[0][0]) + ", " + r(b[0][1]) + " : " + r(b[1][0]) + ", " + r(b[1][1]);
  }

  function layerProperties(l) {
    var info = [["Type", { vector: "Vector (GeoJSON)", raster: "Raster (GeoTIFF)", xyz: "Raster tiles (XYZ)", mvt: "Vector tiles" }[l.kind]]];
    if (l.kind === "vector") {
      var f = GIS.fields(l);
      info.push(["Features", fmtInt(l.data.features.length) + (l.filter ? " (filter: " + fmtInt((GIS.filterMask(l) || []).filter(Boolean).length) + " shown)" : "")]);
      info.push(["Geometry", geomSummary(l)]);
      info.push(["Fields", f.all.length + " (" + f.numeric.length + " numeric)"]);
      info.push(["CRS", "EPSG:4326 — WGS 84"]);
      info.push(["Extent", extentText(l)]);
      if (l.selection.size) info.push(["Selected", fmtInt(l.selection.size)]);
    } else if (l.kind === "raster") {
      var r = l.raster;
      info.push(["Size", r.sourceSize[0] + " × " + r.sourceSize[1] + " px, " + r.bands.length + " band(s)"]);
      info.push(["Source CRS", "EPSG:" + r.epsg]);
      info.push(["Extent", extentText(l)]);
    } else {
      info.push(["Source", '<span class="gis-props-url">' + esc(l.url) + "</span>"]);
      if (l.sourceLayer) info.push(["Source layer", esc(l.sourceLayer)]);
    }
    var cur = GIS.getScale ? GIS.getScale() : 0;
    var body =
      '<div class="gis-props-grid">' +
        '<label class="field-label">Name</label><input type="text" data-p="name" value="' + esc(l.name) + '">' +
        '<label class="field-label">Legend name</label><input type="text" data-p="legendName" value="' + esc(l.legendName || "") + '" placeholder="Same as the layer name">' +
        '<label class="field-label">Attribution</label><input type="text" data-p="attribution" value="' + esc(l.attribution || "") + '" placeholder="© Source">' +
      "</div>" +
      '<div class="gis-props-sec">Information</div><table class="gis-props-info">' +
        info.map(function (x) { return "<tr><th>" + x[0] + "</th><td>" + (/^</.test(x[1]) ? x[1] : esc(x[1])) + "</td></tr>"; }).join("") + "</table>" +
      '<div class="gis-props-sec">Rendering</div>' +
      '<label class="field-label">Opacity</label><input type="range" data-p="opacity" min="0" max="1" step="0.05" value="' + l.opacity + '">' +
      '<label class="check-row"><input type="checkbox" data-p="legend"' + (l.legend !== false ? " checked" : "") + "> Show in legend</label>" +
      '<label class="check-row"><input type="checkbox" data-scale' + (l.minScale > 0 || l.maxScale > 0 ? " checked" : "") + "> Scale dependent visibility</label>" +
      '<div class="gis-props-scale">' +
        '<div><label class="field-label">Minimum (most zoomed out) 1:</label><input type="number" min="0" step="1" data-p="minScale" value="' + (l.minScale || "") + '" placeholder="None"><button type="button" data-cur="minScale">Current</button></div>' +
        '<div><label class="field-label">Maximum (most zoomed in) 1:</label><input type="number" min="0" step="1" data-p="maxScale" value="' + (l.maxScale || "") + '" placeholder="None"><button type="button" data-cur="maxScale">Current</button></div>' +
        '<div class="gis-meta">Current map scale 1:' + (cur ? fmtInt(cur) : "—") + "</div>" +
      "</div>";
    var d = dialog("Layer properties — " + l.name, body, [["cancel", "Cancel"], ["apply", "Apply"], ["ok", "OK", true]]);
    function syncScale() { d.q(".gis-props-scale").style.display = d.q("[data-scale]").checked ? "" : "none"; }
    d.q("[data-scale]").addEventListener("change", syncScale);
    syncScale();
    function apply() {
      Array.prototype.forEach.call(d.el.querySelectorAll("[data-p]"), function (el) {
        var k = el.dataset.p;
        if (el.type === "checkbox") l[k] = el.checked;
        else if (el.type === "range") l[k] = parseFloat(el.value);
        else if (el.type === "number") l[k] = d.q("[data-scale]").checked ? Math.max(0, parseFloat(el.value) || 0) : 0;
        else if (k === "name") l.name = el.value.trim() || l.name;
        else l[k] = el.value.trim();
      });
      if (l.minScale > 0 && l.maxScale > 0 && l.maxScale > l.minScale) { var t = l.minScale; l.minScale = l.maxScale; l.maxScale = t; }
      GIS.emit("style"); GIS.emit("layers");
    }
    d.el.addEventListener("click", function (e) {
      var c = e.target.closest("[data-cur]");
      if (c) { var s = GIS.getScale(); if (s) d.q('[data-p="' + c.dataset.cur + '"]').value = Math.round(s); return; }
      var btn = e.target.closest("[data-btn]");
      if (!btn) return;
      if (btn.dataset.btn !== "cancel") apply();
      if (btn.dataset.btn !== "apply") d.close();
    });
  }
  GIS.layerProperties = layerProperties;
})();
