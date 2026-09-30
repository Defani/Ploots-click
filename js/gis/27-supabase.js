/* ==========================================================================
   GIS — Supabase / PostGIS connector (the "Supabase" panel).

   Works through Supabase's REST API (PostgREST), so the same code runs in
   the browser and in the desktop app:

   Connect   the project URL (https://<ref>.supabase.co) and an API key: the
             anon key with Row Level Security is the safe choice; a service
             role key bypasses RLS and should stay on this computer only.
             An optional user access token (JWT) is sent as the bearer.
             Everything is stored only on this computer.
   Tables    read from the project's OpenAPI description; geometry /
             geography columns are detected.
   Load      a table as a layer: PostgREST filters (e.g. status=eq.active,
             year=gte.2020), a row limit, paged 1000 rows at a time. PostGIS
             geometries come as GeoJSON; tables without one can use
             longitude / latitude columns. Layers can refresh every few
             minutes (live data, like Kobo).
   RPC       call a Postgres function (e.g. a spatial query) with JSON
             arguments; a FeatureCollection or rows with a geometry become
             a layer, anything else is shown.
   Upload    the active layer into a table (geometry sent as EWKT, SRID
             4326), in batches; a CREATE TABLE statement to copy into the
             SQL editor is offered for a new table.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var PANEL = "panel-gis-supabase", K = "ploots-supabase";
  function $(id) { return document.getElementById(id); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function toast(m) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(m); }
  function cfg() { try { return JSON.parse(localStorage.getItem(K) || "{}"); } catch (e) { return {}; } }
  function saveCfg(c) { try { localStorage.setItem(K, JSON.stringify(c)); } catch (e) { } }

  var C = cfg(), tables = null;
  function base() { return String(C.url || "").replace(/\/+$/, ""); }
  function headers(extra) {
    var h = { apikey: C.key, Authorization: "Bearer " + (C.token || C.key) };
    if (C.schema && C.schema !== "public") { h["Accept-Profile"] = C.schema; h["Content-Profile"] = C.schema; }
    return Object.assign(h, extra || {});
  }
  function req(path, opts) {
    opts = opts || {};
    return fetch(base() + path, { method: opts.method || "GET", headers: headers(opts.headers), body: opts.body }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { }
        if (!r.ok) throw new Error((j && (j.message || j.msg || j.error_description || j.hint)) || ("HTTP " + r.status));
        return { json: j, res: r };
      });
    });
  }
  function status(msg, ok) { var el = $("sbStatus"); if (!el) return; el.style.display = msg ? "" : "none"; el.className = "status " + (ok === false ? "error" : "ok"); el.textContent = msg || ""; }

  /* ------------------------------------------------------------ tables */

  function connect() {
    C.url = $("sbUrl").value.trim(); C.key = $("sbKey").value.trim(); C.token = $("sbToken").value.trim(); C.schema = $("sbSchema").value.trim() || "public";
    // https, or http for a local Supabase (supabase start: http://127.0.0.1:54321).
    if (!/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/.test(C.url) || !C.key) { status("Enter the project URL (https://…supabase.co) and an API key.", false); return; }
    saveCfg(C);
    status("Reading the tables…", true);
    req("/rest/v1/", { headers: { Accept: "application/openapi+json" } }).then(function (r) {
      var defs = (r.json && (r.json.definitions || (r.json.components && r.json.components.schemas))) || {};
      tables = Object.keys(defs).map(function (name) {
        var props = defs[name].properties || {}, cols = Object.keys(props);
        var geo = cols.filter(function (c) { var f = String(props[c].format || ""); return /geometry|geography/i.test(f); });
        var lon = cols.filter(function (c) { return /^(lon|lng|long|longitude|x)$/i.test(c); })[0], lat = cols.filter(function (c) { return /^(lat|latitude|y)$/i.test(c); })[0];
        return { name: name, cols: cols, geo: geo, lon: lon, lat: lat, desc: defs[name].description || "" };
      }).sort(function (a, b) { return (b.geo.length - a.geo.length) || a.name.localeCompare(b.name); });
      status(tables.length + " tables and views (" + tables.filter(function (t) { return t.geo.length; }).length + " with PostGIS geometry).", true);
      $("sbWork").hidden = false;
      drawTables();
    }).catch(function (e) { status(e.message + (/Failed to fetch/i.test(e.message) ? " (check the URL)" : ""), false); });
  }
  function drawTables() {
    var q = ($("sbFilterT").value || "").toLowerCase();
    $("sbTables").innerHTML = (tables || []).filter(function (t) { return !q || t.name.toLowerCase().indexOf(q) >= 0; }).map(function (t) {
      var kind = t.geo.length ? "PostGIS: " + t.geo.join(", ") : t.lon && t.lat ? "points from " + t.lon + " / " + t.lat : "table (no geometry)";
      return '<button type="button" class="sb-table' + (t.name === selName ? " active" : "") + '" data-t="' + esc(t.name) + '">' + sym(t.geo.length ? "public" : t.lon ? "scatter_plot" : "table") +
        '<span class="sb-tname">' + esc(t.name) + "<small>" + esc(kind) + " · " + t.cols.length + " columns</small></span></button>";
    }).join("") || '<div class="gis-empty">No tables.</div>';
  }
  var selName = null;
  function pick(name) {
    selName = name;
    var t = tables.filter(function (x) { return x.name === name; })[0];
    drawTables();
    $("sbLoadBox").hidden = false;
    $("sbGeom").innerHTML = t.geo.map(function (g) { return "<option>" + esc(g) + "</option>"; }).join("") + (t.lon && t.lat ? '<option value="__lonlat">' + esc(t.lon + " / " + t.lat) + "</option>" : "") + '<option value="">No geometry (table only)</option>';
    $("sbLayerName").value = name;
  }

  /* ------------------------------------------------------------- load */

  function toFeature(row, gcol, t) {
    var g = null, props = {};
    Object.keys(row).forEach(function (k) { if (k !== gcol) props[k] = row[k]; });
    if (gcol === "__lonlat") { var x = Number(row[t.lon]), y = Number(row[t.lat]); if (isFinite(x) && isFinite(y)) g = { type: "Point", coordinates: [x, y] }; }
    else if (gcol) {
      g = row[gcol];
      if (typeof g === "string") { try { g = JSON.parse(g); } catch (e) { g = fromWKT(g); } }
    }
    return { type: "Feature", properties: props, geometry: g && g.type ? g : null };
  }
  function fetchAll(table, filter, limit, onPage) {
    var rows = [], page = 1000;
    function next(from) {
      var to = Math.min(limit, from + page) - 1;
      var q = "/rest/v1/" + encodeURIComponent(table) + "?select=*" + (filter ? "&" + filter.replace(/^[?&]/, "") : "");
      return req(q, { headers: { Range: from + "-" + to, "Range-Unit": "items", Prefer: "count=exact" } }).then(function (r) {
        var got = r.json || [];
        rows = rows.concat(got);
        onPage(rows.length);
        var total = +(String(r.res.headers.get("content-range") || "").split("/")[1] || 0);
        if (got.length === to - from + 1 && rows.length < limit && (!total || rows.length < total)) return next(to + 1);
        return rows;
      });
    }
    return next(0);
  }
  function load(opts) {
    opts = opts || {};
    var t = tables.filter(function (x) { return x.name === (opts.table || selName); })[0];
    if (!t) return Promise.reject(new Error("Choose a table."));
    var gcol = opts.geom != null ? opts.geom : $("sbGeom").value, filter = opts.filter != null ? opts.filter : $("sbWhere").value.trim(), limit = opts.limit || +$("sbLimit").value || 5000;
    status("Loading " + t.name + "…", true);
    return fetchAll(t.name, filter, limit, function (n) { status("Loading " + t.name + "… " + n + " rows", true); }).then(function (rows) {
      var feats = rows.map(function (r) { return toFeature(r, gcol, t); });
      var withGeom = feats.filter(function (f) { return f.geometry; });
      if (!gcol || !withGeom.length) { showRows(rows); status(rows.length + " rows (no geometry to map).", true); return null; }
      var name = opts.name || $("sbLayerName").value.trim() || t.name, l = opts.layer;
      if (l) {
        l.data = { type: "FeatureCollection", features: withGeom };
        l.selection = new Set(); l.rev = (l.rev || 0) + 1;
        GIS.emit("data"); GIS.emit("layers");
      } else {
        GIS.enterMapMode();
        l = GIS.addVector({ type: "FeatureCollection", features: withGeom }, name);
        l.attribution = "Supabase";
        l.supabase = { table: t.name, geom: gcol, filter: filter, limit: limit };
      }
      status(withGeom.length + " features loaded" + (feats.length > withGeom.length ? " (" + (feats.length - withGeom.length) + " rows without geometry skipped)" : "") + ".", true);
      return l;
    });
  }
  function showRows(rows) {
    var cols = rows.length ? Object.keys(rows[0]) : [];
    $("sbOut").innerHTML = rows.length ? '<div class="sb-rows"><table class="gproc-table"><tr>' + cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr>" +
      rows.slice(0, 50).map(function (r) { return "<tr>" + cols.map(function (c) { var v = r[c]; return "<td>" + esc(typeof v === "object" && v !== null ? JSON.stringify(v).slice(0, 60) : v) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table></div>" +
      (rows.length > 50 ? '<p class="gfw-note">First 50 of ' + rows.length + " rows.</p>" : "") : '<p class="gfw-note">No rows.</p>';
  }

  // Live: refresh the Supabase layers of the active map every N minutes.
  var live = 0;
  function setLive(min) {
    clearInterval(live);
    if (!min) return;
    live = setInterval(function () {
      GIS.layers.filter(function (l) { return l.supabase; }).forEach(function (l) {
        load({ table: l.supabase.table, geom: l.supabase.geom, filter: l.supabase.filter, limit: l.supabase.limit, layer: l }).catch(function () { });
      });
    }, min * 60000);
  }

  /* -------------------------------------------------------------- RPC */

  function rpc() {
    var fn = $("sbFn").value.trim(), args = $("sbArgs").value.trim() || "{}";
    if (!fn) return;
    var body;
    try { JSON.parse(args); body = args; } catch (e) { status("Arguments must be JSON, e.g. {\"x\": 1}", false); return; }
    status("Calling " + fn + "…", true);
    req("/rest/v1/rpc/" + encodeURIComponent(fn), { method: "POST", headers: { "Content-Type": "application/json" }, body: body }).then(function (r) {
      var j = r.json;
      if (j && j.type === "FeatureCollection") { var l = GIS.addVector(j, fn); l.attribution = "Supabase"; status(j.features.length + " features from " + fn + ".", true); return; }
      if (Array.isArray(j) && j.length && typeof j[0] === "object") {
        var g = Object.keys(j[0]).filter(function (k) { var v = j[0][k]; return v && typeof v === "object" && v.type && v.coordinates; })[0];
        if (g) { var l2 = GIS.addVector({ type: "FeatureCollection", features: j.map(function (row) { return toFeature(row, g, {}); }).filter(function (f) { return f.geometry; }) }, fn); l2.attribution = "Supabase"; status(l2.data.features.length + " features from " + fn + ".", true); return; }
        showRows(j); status(j.length + " rows from " + fn + ".", true); return;
      }
      $("sbOut").innerHTML = '<pre class="sb-pre">' + esc(JSON.stringify(j, null, 2).slice(0, 4000)) + "</pre>";
      status(fn + " returned.", true);
    }).catch(function (e) { status(fn + ": " + e.message, false); });
  }

  /* ----------------------------------------------------------- upload */

  function toWKT(g) {
    function pt(c) { return c[0] + " " + c[1]; }
    function ring(r) { return "(" + r.map(pt).join(",") + ")"; }
    function poly(p) { return "(" + p.map(ring).join(",") + ")"; }
    var T = g.type.toUpperCase();
    if (g.type === "Point") return "POINT(" + pt(g.coordinates) + ")";
    if (g.type === "MultiPoint") return "MULTIPOINT(" + g.coordinates.map(function (c) { return "(" + pt(c) + ")"; }).join(",") + ")";
    if (g.type === "LineString") return "LINESTRING" + ring(g.coordinates);
    if (g.type === "MultiLineString") return "MULTILINESTRING(" + g.coordinates.map(ring).join(",") + ")";
    if (g.type === "Polygon") return "POLYGON" + poly(g.coordinates);
    if (g.type === "MultiPolygon") return "MULTIPOLYGON(" + g.coordinates.map(poly).join(",") + ")";
    return T;
  }
  function fromWKT(s) { return GIS.processing && GIS.processing.fromWKT ? GIS.processing.fromWKT(s) : null; }
  function sqlFor(l, table, gcol) {
    var f = GIS.fields(l), num = {};
    f.numeric.forEach(function (k) { num[k] = 1; });
    var kind = { point: "MultiPoint", line: "MultiLineString", polygon: "MultiPolygon" }[GIS.geometryKind(l)] || "Geometry";
    return "create table public." + table + " (\n  id bigint generated always as identity primary key,\n" +
      f.all.map(function (k) { return "  \"" + k.replace(/"/g, "") + "\" " + (num[k] ? "double precision" : "text"); }).join(",\n") + (f.all.length ? ",\n" : "") +
      "  " + gcol + " geometry(" + kind + ", 4326)\n);\ncreate index on public." + table + " using gist (" + gcol + ");\nalter table public." + table + " enable row level security;";
  }
  function upload() {
    var l = GIS.active(), table = $("sbUpTable").value.trim(), gcol = $("sbUpGeom").value.trim() || "geom";
    if (!l || l.kind !== "vector") { status("Choose a vector layer (Layers).", false); return; }
    if (!table) { status("Enter the table name.", false); return; }
    if (!window.confirm("Insert " + l.data.features.length + " features of \"" + l.name + "\" into " + table + "?")) return;
    var rows = l.data.features.map(function (f) {
      var r = {};
      Object.keys(f.properties || {}).forEach(function (k) { if (k.indexOf("__") !== 0) r[k] = f.properties[k]; });
      var g = f.geometry;
      // Single parts go into multi columns as multi.
      if (g && !/^Multi/.test(g.type) && $("sbUpMulti").checked) g = { type: "Multi" + g.type, coordinates: [g.coordinates] };
      r[gcol] = g ? "SRID=4326;" + toWKT(g) : null;
      return r;
    });
    var done = 0, n = 500;
    function batch(i) {
      if (i >= rows.length) { status(done + " features inserted into " + table + ".", true); return Promise.resolve(); }
      return req("/rest/v1/" + encodeURIComponent(table), { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(rows.slice(i, i + n)) })
        .then(function () { done += Math.min(n, rows.length - i); status("Inserted " + done + " / " + rows.length + "…", true); return batch(i + n); });
    }
    batch(0).catch(function (e) { status(table + ": " + e.message + (done ? " (" + done + " inserted before the error)" : ""), false); });
  }

  /* --------------------------------------------------------------- UI */

  function build() {
    if ($(PANEL)) return;
    var p = document.createElement("div");
    p.id = PANEL;
    p.className = "sidebar-panel";
    p.innerHTML =
      '<div class="sp-head"><span class="sp-title sb-title">' + (GIS.logos ? GIS.logos.html("supabase", 18) : "") + 'Supabase · PostGIS</span><button type="button" class="sp-close" title="Close panel">' + sym("keyboard_double_arrow_left") + "</button></div>" +
      '<div class="sb-body">' +
        '<label class="field-label">Project URL</label><input type="text" id="sbUrl" placeholder="https://xxxx.supabase.co" value="' + esc(C.url || "") + '">' +
        '<label class="field-label">API key (anon, with Row Level Security)</label><input type="password" id="sbKey" autocomplete="off" value="' + esc(C.key || "") + '">' +
        '<div class="num-pair"><div><label class="field-label">Schema</label><input type="text" id="sbSchema" value="' + esc(C.schema || "public") + '"></div>' +
          '<div><label class="field-label">User token (optional)</label><input type="password" id="sbToken" autocomplete="off" value="' + esc(C.token || "") + '"></div></div>' +
        '<button id="sbConnect" class="btn-primary" style="width:100%;margin-top:10px;">' + sym("link") + "Connect</button>" +
        '<p class="gfw-note">Stored only on this computer. A service role key bypasses Row Level Security; prefer the anon key.</p>' +
        '<p class="status" id="sbStatus" style="display:none;"></p>' +
        '<div id="sbWork" hidden>' +
          '<div class="gfw-sub">' + sym("table") + 'Tables</div><input type="search" id="sbFilterT" placeholder="Filter tables"><div class="sb-tables" id="sbTables"></div>' +
          '<div id="sbLoadBox" hidden>' +
            '<div class="num-pair"><div><label class="field-label">Geometry</label><select id="sbGeom"></select></div><div><label class="field-label">Max rows</label><input type="number" id="sbLimit" value="5000" min="1" max="200000" step="500"></div></div>' +
            '<label class="field-label">Filter (PostgREST, optional)</label><input type="text" id="sbWhere" placeholder="status=eq.active&year=gte.2020">' +
            '<label class="field-label">Layer name</label><input type="text" id="sbLayerName">' +
            '<button id="sbLoad" class="btn-primary" style="width:100%;margin-top:8px;">' + sym("download") + "Add as layer</button>" +
          "</div>" +
          '<label class="field-label">Refresh Supabase layers</label><select id="sbLive"><option value="0">Off</option><option value="1">Every minute</option><option value="5">Every 5 minutes</option><option value="15">Every 15 minutes</option></select>' +
          '<div class="gfw-sub">' + sym("function") + "Function (RPC)</div>" +
          '<div class="num-pair"><div><label class="field-label">Name</label><input type="text" id="sbFn" placeholder="features_in_bbox"></div><div><label class="field-label">Arguments (JSON)</label><input type="text" id="sbArgs" placeholder="{&quot;minx&quot;:106}"></div></div>' +
          '<button id="sbRpc" style="width:100%;margin-top:6px;">' + sym("play_arrow") + "Call</button>" +
          '<div class="gfw-sub">' + sym("upload") + "Upload the active layer</div>" +
          '<div class="num-pair"><div><label class="field-label">Table</label><input type="text" id="sbUpTable" placeholder="my_layer"></div><div><label class="field-label">Geometry column</label><input type="text" id="sbUpGeom" value="geom"></div></div>' +
          '<label class="check-row"><input type="checkbox" id="sbUpMulti" checked>Send single parts as Multi (for Multi… columns)</label>' +
          '<div class="anim-row"><button id="sbUp" class="btn-primary">' + sym("upload") + 'Insert rows</button><button id="sbSql">' + sym("code") + "CREATE TABLE SQL</button></div>" +
          '<div id="sbOut"></div>' +
        "</div>" +
      "</div>";
    document.querySelector(".sidebar").appendChild(p);
    p.querySelector(".sp-close").addEventListener("click", function () { window.closeSidebar(); });
    $("sbConnect").addEventListener("click", connect);
    $("sbFilterT").addEventListener("input", drawTables);
    $("sbTables").addEventListener("click", function (e) { var b = e.target.closest("[data-t]"); if (b) pick(b.dataset.t); });
    $("sbLoad").addEventListener("click", function () { load().catch(function (e) { status(e.message, false); }); });
    $("sbLive").addEventListener("change", function () { setLive(+this.value); });
    $("sbRpc").addEventListener("click", rpc);
    $("sbUp").addEventListener("click", upload);
    $("sbSql").addEventListener("click", function () {
      var l = GIS.active();
      if (!l || l.kind !== "vector") { status("Choose a vector layer (Layers).", false); return; }
      var sql = sqlFor(l, ($("sbUpTable").value.trim() || "my_layer").replace(/[^\w]/g, "_"), $("sbUpGeom").value.trim() || "geom");
      $("sbOut").innerHTML = '<pre class="sb-pre">' + esc(sql) + '</pre><button id="sbCopy" style="width:100%;">' + sym("content_copy") + "Copy (paste into Supabase ▸ SQL Editor)</button>";
      $("sbCopy").addEventListener("click", function () { navigator.clipboard.writeText(sql).then(function () { toast("SQL copied"); }); });
    });

    var nav = document.querySelector(".sidebar-nav"), rb = document.createElement("button");
    rb.className = "nav-btn nav-gis nav-sb";
    rb.setAttribute("data-panel", PANEL);
    rb.title = "Supabase / PostGIS";
    rb.innerHTML = sym("database") + '<span class="nav-lbl">PostGIS</span>';
    var after = nav.querySelector(".nav-gee") || nav.querySelector('[data-panel="panel-gis-gfw"]');
    if (after) after.after(rb); else nav.appendChild(rb);
    rb.addEventListener("click", function () { if (rb.classList.contains("active")) window.closeSidebar(); else { GIS.enterMapMode(); activateSidebarPanel(PANEL); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(build, 120); }); else setTimeout(build, 120);

  GIS.supabase = { load: load, connect: connect, toWKT: toWKT };
})();
