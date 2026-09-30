/* ==========================================================================
   GIS — desktop engines (the "Offline & SQL" panel; desktop app only).

   The web version stays light; the desktop app (Tauri) gets:

   PMTiles     open a local .pmtiles file (pmtiles, BSD):
                 - a Protomaps basemap extract becomes an offline basemap in
                   five flavors, with labels from the fonts and sprites in
                   assets/basemaps-assets (no internet needed);
                 - other vector tiles become vector-tile layers, one per
                   source layer; raster tiles become a tile layer.
   DuckDB SQL  DuckDB (WASM, MIT) with the spatial extension: the layers of
               the active map as tables (geometry column "geom"), plus
               CSV, Parquet / GeoParquet and JSON files; any SQL with ST_*
               functions; a result with a GEOMETRY column becomes a layer,
               other results show as a table (CSV download).

   In the desktop build the engines are bundled (desktop/build_dist.py puts
   DuckDB, its worker, the WASM and the spatial / json / parquet extensions
   under vendor/), so both work offline. In a browser the panel is hidden;
   localStorage "ploots-desktop-engines" = "1" shows it for testing.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  // ?desktop=1 serves the desktop build's engines from a plain web server (testing desktop/dist).
  var DESKTOP = !!window.__TAURI__ || /[?&]desktop=1(&|$)/.test(location.search);
  var ENABLED = DESKTOP || (function () { try { return localStorage.getItem("ploots-desktop-engines") === "1"; } catch (e) { return false; } })();
  if (!ENABLED) return;

  var PANEL = "panel-gis-engines";
  var PMTILES_JS = "https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/dist/pmtiles.js";
  var BASEMAPS_JS = "https://cdn.jsdelivr.net/npm/@protomaps/basemaps@5.7.2/dist/basemaps.js";
  var DUCK = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0";
  // Filled in by desktop/build_dist.py (local copies); the CDN otherwise.
  var LOCAL_DUCK = DESKTOP ? "vendor/duckdb/" : null;
  function abs(p) { return new URL(p, location.href).href; }
  function $(id) { return document.getElementById(id); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function toast(m) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(m); }
  function script(url) {
    return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = url; s.onload = res; s.onerror = function () { rej(new Error("Could not load " + url)); }; document.head.appendChild(s); });
  }

  /* ---------------------------------------------------------- PMTiles */

  var pm = { protocol: null, files: {} };
  function ensurePmtiles() {
    var p = window.pmtiles ? Promise.resolve() : script(PMTILES_JS);
    return p.then(function () {
      if (!pm.protocol) {
        pm.protocol = new pmtiles.Protocol();
        maplibregl.addProtocol("pmtiles", pm.protocol.tile);
      }
    });
  }
  function safe(n) { return n.replace(/\.pmtiles$/i, "").replace(/[^\w-]+/g, "_"); }
  function openPmtiles(file) {
    return ensurePmtiles().then(function () {
      var key = safe(file.name), archive = new pmtiles.PMTiles(new pmtiles.FileSource(file));
      pm.protocol.add(archive);
      // The protocol finds the archive by its source key (the file name).
      var url = "pmtiles://" + archive.source.getKey();
      return Promise.all([archive.getHeader(), archive.getMetadata().catch(function () { return {}; })]).then(function (r) {
        var h = r[0], meta = r[1] || {}, info = { key: key, file: file.name, url: url, header: h, meta: meta };
        pm.files[key] = info;
        var vls = (meta.vector_layers || []).map(function (v) { return v.id; });
        var protomaps = vls.indexOf("earth") >= 0 && vls.indexOf("roads") >= 0;
        info.kind = h.tileType === 1 ? (protomaps ? "protomaps" : "vector") : "raster";
        info.legacy = protomaps && JSON.stringify(meta).indexOf("pmap:kind") >= 0;
        drawFiles();
        return info;
      });
    });
  }
  // Offline Protomaps basemaps: style from @protomaps/basemaps, local glyphs and sprites.
  function offlineStyle(b) {
    var info = pm.files[b.offline.key];
    if (!info || !window.protomaps_themes_base && !window.basemaps) return GIS.styleFor("none");
    var lib = window.basemaps || window.protomaps_themes_base;
    var flavor = lib.namedFlavor ? lib.namedFlavor(b.offline.flavor) : b.offline.flavor;
    return {
      version: 8,
      // Tokens are appended as text: new URL() would encode the braces.
      glyphs: abs("assets/basemaps-assets/fonts/") + "{fontstack}/{range}.pbf",
      sprite: abs("assets/basemaps-assets/sprites/v4/" + b.offline.flavor),
      sources: { protomaps: { type: "vector", url: info.url, attribution: "© OpenStreetMap contributors · Protomaps" } },
      layers: lib.layers("protomaps", flavor, { lang: "en" })
    };
  }
  function addOfflineBasemaps(info) {
    return (window.basemaps ? Promise.resolve() : script(BASEMAPS_JS)).then(function () {
      ["light", "white", "grayscale", "dark", "black"].forEach(function (f) {
        var id = "offline-" + info.key + "-" + f;
        if (GIS.BASEMAPS.some(function (b) { return b.id === id; })) return;
        var none = GIS.BASEMAPS.findIndex(function (b) { return b.id === "none"; });
        GIS.BASEMAPS.splice(none < 0 ? GIS.BASEMAPS.length : none, 0, { id: id, group: "Offline (PMTiles)", label: info.file + " — " + f, offline: { key: info.key, flavor: f }, attr: "© OpenStreetMap contributors · Protomaps" });
      });
      state.mapBasemap = "offline-" + info.key + "-light";
      if (typeof render === "function") render();
      if (GIS.refreshBasemap) GIS.refreshBasemap();
    });
  }
  function useFile(info) {
    GIS.enterMapMode();
    if (info.kind === "protomaps") return addOfflineBasemaps(info).then(function () {
      // Extracts from before Protomaps schema v4 ("pmap:kind" fields) only show land, water and some labels.
      toast(info.legacy ? info.file + " uses an older Protomaps schema: roads and buildings will not show. Cut a new extract from a current build." : info.file + ": offline basemap ready (Basemap ▸ Offline)");
    });
    if (info.kind === "vector") {
      (info.meta.vector_layers || [{ id: "" }]).forEach(function (v) { GIS.addMVT(info.url + "/{z}/{x}/{y}", v.id, info.file + " · " + v.id, "PMTiles"); });
      return Promise.resolve();
    }
    var l = GIS.addXYZ(info.url + "/{z}/{x}/{y}", info.file, "PMTiles");
    GIS.move(l.id, 0);
    return Promise.resolve();
  }
  function drawFiles() {
    var box = $("enFiles");
    if (!box) return;
    var list = Object.keys(pm.files).map(function (k) { return pm.files[k]; });
    box.innerHTML = list.length ? list.map(function (f) {
      var h = f.header, kind = f.kind === "protomaps" ? "Protomaps basemap" : f.kind === "vector" ? "vector tiles" : "raster tiles";
      return '<div class="en-file">' + sym(f.kind === "raster" ? "image" : "layers") + '<span class="sb-tname">' + esc(f.file) + "<small>" + kind + " · zoom " + h.minZoom + "–" + h.maxZoom + "</small></span>" +
        '<button type="button" data-use="' + esc(f.key) + '">' + (f.kind === "protomaps" ? "Use as basemap" : "Add") + "</button></div>";
    }).join("") : '<div class="gis-empty">No PMTiles files opened yet.</div>';
  }

  /* ----------------------------------------------------------- DuckDB */

  var D = { db: null, c: null, p: null };
  function ensureDuck() {
    if (D.p) return D.p;
    D.p = (function () {
      var modUrl = LOCAL_DUCK ? abs(LOCAL_DUCK + "duckdb.mjs") : DUCK + "/+esm";
      return import(modUrl).then(function (duckdb) {
        var bundle = LOCAL_DUCK ? { mainModule: abs(LOCAL_DUCK + "duckdb-eh.wasm"), mainWorker: abs(LOCAL_DUCK + "duckdb-browser-eh.worker.js") } : null;
        var pick = bundle ? Promise.resolve(bundle) : duckdb.selectBundle({
          mvp: { mainModule: DUCK + "/dist/duckdb-mvp.wasm", mainWorker: DUCK + "/dist/duckdb-browser-mvp.worker.js" },
          eh: { mainModule: DUCK + "/dist/duckdb-eh.wasm", mainWorker: DUCK + "/dist/duckdb-browser-eh.worker.js" }
        });
        return pick.then(function (b) {
          var wurl = LOCAL_DUCK ? b.mainWorker : URL.createObjectURL(new Blob(['importScripts("' + b.mainWorker + '");'], { type: "text/javascript" }));
          var db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(wurl));
          return db.instantiate(b.mainModule, b.pthreadWorker).then(function () { return db.connect(); }).then(function (c) {
            D.db = db; D.c = c;
            var pre = LOCAL_DUCK ? c.query("SET custom_extension_repository = '" + abs("vendor/duckdb-ext") + "'") : Promise.resolve();
            return pre.then(function () { return c.query("INSTALL spatial; LOAD spatial;"); }).then(function () { return c.query("select version() v"); });
          });
        });
      }).then(function (r) { return r.toArray()[0].v; });
    })();
    D.p.catch(function () { D.p = null; });
    return D.p;
  }
  function q(sql) { return D.c.query(sql); }
  function ident(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }
  function tableName(l) { return String(l.name).replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "layer_" + l.id; }

  function syncLayers() {
    var ls = GIS.layers.filter(function (l) { return l.kind === "vector" && l.data; }), names = [];
    return ls.reduce(function (p, l) {
      return p.then(function () {
        var name = tableName(l), file = "layer_" + l.id + ".json";
        var text = l.data.features.map(function (f) {
          var r = {};
          Object.keys(f.properties || {}).forEach(function (k) { if (k.indexOf("__") !== 0 && k !== "geom") r[k] = f.properties[k]; });
          r.__geom = JSON.stringify(f.geometry);
          return JSON.stringify(r);
        }).join("\n");
        names.push(name);
        return D.db.registerFileText(file, text).then(function () {
          return q("CREATE OR REPLACE TABLE " + ident(name) + " AS SELECT * EXCLUDE (__geom), ST_GeomFromGeoJSON(__geom) AS geom FROM read_json_auto('" + file + "', format='newline_delimited', sample_size=-1)");
        });
      });
    }, Promise.resolve()).then(function () { return names; });
  }
  function addFile(file) {
    var name = file.name.replace(/\.[^.]+$/, "").replace(/[^\w]+/g, "_").toLowerCase();
    return D.db.registerFileHandle(file.name, file, 2 /* BROWSER_FILEREADER */, true).then(function () {
      var ext = (file.name.split(".").pop() || "").toLowerCase(), src;
      if (ext === "csv" || ext === "tsv" || ext === "txt") src = "read_csv_auto('" + file.name + "')";
      else if (ext === "parquet" || ext === "geoparquet") src = "read_parquet('" + file.name + "')";
      else if (ext === "json" || ext === "ndjson") src = "read_json_auto('" + file.name + "')";
      else src = "ST_Read('" + file.name + "')"; // GeoJSON, GeoPackage, Shapefile… through GDAL
      return q("CREATE OR REPLACE VIEW " + ident(name) + " AS SELECT * FROM " + src).then(function () { return name; });
    });
  }
  function listTables() {
    return q("SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name").then(function (r) { return r.toArray().map(function (x) { return x.table_name + (x.table_type === "VIEW" ? " (file)" : ""); }); });
  }
  function run(sql) {
    sql = sql.trim().replace(/;+\s*$/, "");
    if (!sql) return Promise.resolve();
    // Statements that do not return rows run as they are.
    if (!/^\s*(select|with|from|values|table|pivot|summarize|describe|show)\b/i.test(sql)) return q(sql).then(function () { return { message: "Done." }; });
    return q("DESCRIBE " + sql).then(function (d) {
      var cols = d.toArray().map(function (x) { return { name: x.column_name, type: String(x.column_type) }; });
      var gcols = cols.filter(function (c) { return /^GEOMETRY/.test(c.type); });
      if (!gcols.length) return q(sql).then(function (r) { return { rows: r.toArray().map(function (x) { return x.toJSON ? x.toJSON() : x; }), cols: cols.map(function (c) { return c.name; }) }; });
      var g = gcols[0].name, others = cols.filter(function (c) { return !/^GEOMETRY/.test(c.type); }).map(function (c) { return ident(c.name); });
      return q("SELECT " + (others.length ? others.join(", ") + ", " : "") + "ST_AsGeoJSON(" + ident(g) + ") AS __gj FROM (" + sql + ") LIMIT 200000").then(function (r) {
        var feats = r.toArray().map(function (x) {
          var o = x.toJSON ? x.toJSON() : x, gj = o.__gj; delete o.__gj;
          Object.keys(o).forEach(function (k) { if (typeof o[k] === "bigint") o[k] = Number(o[k]); });
          return { type: "Feature", properties: o, geometry: gj ? JSON.parse(gj) : null };
        }).filter(function (f) { return f.geometry; });
        return { features: feats };
      });
    });
  }

  var EXAMPLES = [
    ["Area of every polygon (ha)", "SELECT *, ST_Area_Spheroid(ST_FlipCoordinates(geom)) / 10000 AS area_ha\nFROM my_layer"],
    ["Buffer 1 km (in metres, UTM zone 48S)", "SELECT * EXCLUDE (geom),\n  ST_Transform(ST_Buffer(ST_Transform(geom, 'EPSG:4326', 'EPSG:32748', always_xy := true), 1000), 'EPSG:32748', 'EPSG:4326', always_xy := true) AS geom\nFROM my_layer"],
    ["Count points in polygons", "SELECT p.*, count(pt.geom) AS n\nFROM polygons p LEFT JOIN points pt ON ST_Intersects(p.geom, pt.geom)\nGROUP BY ALL"],
    ["Dissolve by a field", "SELECT category, ST_Union_Agg(geom) AS geom, count(*) AS n\nFROM my_layer GROUP BY category"],
    ["Points from a CSV (lon / lat)", "SELECT *, ST_Point(lon, lat) AS geom FROM my_csv"],
    ["Summary of a table", "SUMMARIZE my_layer"]
  ];

  /* --------------------------------------------------------------- UI */

  function build() {
    if ($(PANEL)) return;
    var p = document.createElement("div");
    p.id = PANEL;
    p.className = "sidebar-panel";
    p.innerHTML =
      '<div class="sp-head"><span class="sp-title">Offline &amp; SQL</span><button type="button" class="sp-close" title="Close panel">' + sym("keyboard_double_arrow_left") + "</button></div>" +
      '<div class="sb-body">' +
        '<div class="gfw-sub" style="margin-top:0;border-top:none;padding-top:0">' + sym("offline_pin") + "Offline maps (PMTiles)</div>" +
        '<button id="enOpen" class="btn-primary" style="width:100%;">' + sym("folder_open") + 'Open a .pmtiles file</button><input type="file" id="enFile" accept=".pmtiles" hidden multiple>' +
        '<div id="enFiles" class="en-files"></div>' +
        '<p class="gfw-note">For an offline basemap, cut a Protomaps extract once while online, e.g. <code>pmtiles extract &lt;latest build from maps.protomaps.com/builds&gt; indonesia.pmtiles --bbox=94.9,-11.1,141.1,6.1</code>. Map data © OpenStreetMap contributors (ODbL).</p>' +
        '<div class="gfw-sub">' + sym("database") + 'DuckDB SQL <span id="enVer"></span></div>' +
        '<div class="anim-row"><button id="enStart">' + sym("power_settings_new") + 'Start engine</button><button id="enSync" disabled>' + sym("sync") + "Layers → tables</button></div>" +
        '<div class="anim-row"><button id="enAddFile" disabled>' + sym("upload_file") + 'Add CSV / Parquet / GeoJSON…</button></div><input type="file" id="enDbFile" hidden multiple accept=".csv,.tsv,.txt,.parquet,.geoparquet,.json,.ndjson,.geojson,.gpkg,.shp,.fgb,.kml">' +
        '<div id="enTables" class="en-tables"></div>' +
        '<select id="enEx"><option value="">Examples…</option>' + EXAMPLES.map(function (e, i) { return '<option value="' + i + '">' + esc(e[0]) + "</option>"; }).join("") + "</select>" +
        '<textarea id="enSql" spellcheck="false" placeholder="SELECT * FROM my_layer WHERE …">SELECT 1</textarea>' +
        '<div class="num-pair"><div><label class="field-label">Result layer name</label><input type="text" id="enName" value="SQL result"></div><div><label class="field-label">&nbsp;</label><button id="enRun" class="btn-primary" style="width:100%" disabled>' + sym("play_arrow") + "Run (Ctrl+Enter)</button></div></div>" +
        '<p class="status" id="enStatus" style="display:none;"></p><div id="enOut"></div>' +
      "</div>";
    document.querySelector(".sidebar").appendChild(p);
    p.querySelector(".sp-close").addEventListener("click", function () { window.closeSidebar(); });
    function status(m, ok) { var el = $("enStatus"); el.style.display = m ? "" : "none"; el.className = "status " + (ok === false ? "error" : "ok"); el.textContent = m || ""; }
    function tablesUi() { listTables().then(function (t) { $("enTables").innerHTML = t.length ? t.map(function (n) { return '<span class="en-chip">' + esc(n) + "</span>"; }).join("") : ""; }); }

    $("enOpen").addEventListener("click", function () { $("enFile").click(); });
    $("enFile").addEventListener("change", function () {
      Array.prototype.forEach.call(this.files, function (f) { openPmtiles(f).then(function (info) { toast(f.name + " opened"); if (info.kind === "protomaps") useFile(info); }).catch(function (e) { toast(f.name + ": " + e.message); }); });
      this.value = "";
    });
    $("enFiles").addEventListener("click", function (e) { var b = e.target.closest("[data-use]"); if (b) useFile(pm.files[b.dataset.use]); });
    drawFiles();

    $("enStart").addEventListener("click", function () {
      status("Starting DuckDB and the spatial extension…", true);
      ensureDuck().then(function (v) {
        $("enVer").innerHTML = '<em class="ok">' + esc(v) + " · spatial</em>";
        ["enSync", "enAddFile", "enRun"].forEach(function (id) { $(id).disabled = false; });
        return syncLayers();
      }).then(function (names) { status("Ready. Tables: " + (names.join(", ") || "none yet"), true); tablesUi(); if (names[0]) $("enSql").value = "SELECT * FROM " + names[0] + " LIMIT 100"; })
        .catch(function (e) { status("DuckDB: " + e.message, false); });
    });
    $("enSync").addEventListener("click", function () { syncLayers().then(function (n) { status(n.length + " layer table(s) refreshed.", true); tablesUi(); }).catch(function (e) { status(e.message, false); }); });
    $("enAddFile").addEventListener("click", function () { $("enDbFile").click(); });
    $("enDbFile").addEventListener("change", function () {
      Array.prototype.reduce.call(this.files, function (pr, f) { return pr.then(function () { return addFile(f).then(function (n) { status("File table: " + n, true); }); }); }, Promise.resolve())
        .then(tablesUi).catch(function (e) { status(e.message, false); });
      this.value = "";
    });
    $("enEx").addEventListener("change", function () { if (this.value !== "") $("enSql").value = EXAMPLES[+this.value][1]; this.value = ""; });
    function go() {
      status("Running…", true);
      var t0 = performance.now();
      run($("enSql").value).then(function (r) {
        var ms = Math.round(performance.now() - t0);
        if (!r) return;
        if (r.message) { status(r.message + " (" + ms + " ms)", true); tablesUi(); return; }
        if (r.features) {
          if (!r.features.length) { status("No rows with a geometry (" + ms + " ms).", true); return; }
          GIS.enterMapMode();
          var l = GIS.addVector({ type: "FeatureCollection", features: r.features }, $("enName").value.trim() || "SQL result");
          l.attribution = "DuckDB SQL";
          status(r.features.length + " features → layer \"" + l.name + "\" (" + ms + " ms).", true);
          $("enOut").innerHTML = "";
          return;
        }
        status(r.rows.length + " rows (" + ms + " ms).", true);
        $("enOut").innerHTML = '<div class="sb-rows"><table class="gproc-table"><tr>' + r.cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr>" +
          r.rows.slice(0, 200).map(function (x) { return "<tr>" + r.cols.map(function (c) { var v = x[c]; if (typeof v === "bigint") v = Number(v); return "<td>" + esc(v && typeof v === "object" ? JSON.stringify(v) : v) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table></div>" +
          '<button id="enCsv" style="width:100%;margin-top:6px;">' + sym("download") + "Download CSV</button>";
        $("enCsv").addEventListener("click", function () {
          var csv = [r.cols].concat(r.rows.map(function (x) { return r.cols.map(function (c) { var v = x[c]; if (typeof v === "bigint") v = Number(v); return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : v; }); }))
            .map(function (row) { return row.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
          var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "sql_result.csv"; a.click();
        });
      }).catch(function (e) { status(e.message, false); });
    }
    $("enRun").addEventListener("click", go);
    $("enSql").addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } });

    var nav = document.querySelector(".sidebar-nav"), rb = document.createElement("button");
    rb.className = "nav-btn nav-gis nav-engines";
    rb.setAttribute("data-panel", PANEL);
    rb.title = "Offline maps (PMTiles) and DuckDB SQL";
    rb.innerHTML = sym("storage") + '<span class="nav-lbl">Offline/SQL</span>';
    var after = nav.querySelector(".nav-sb") || nav.querySelector(".nav-gee");
    if (after) after.after(rb); else nav.appendChild(rb);
    rb.addEventListener("click", function () { if (rb.classList.contains("active")) window.closeSidebar(); else { GIS.enterMapMode(); activateSidebarPanel(PANEL); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(build, 160); }); else setTimeout(build, 160);

  GIS.offline = { style: offlineStyle, open: openPmtiles, use: useFile };
  GIS.duckdb = { start: ensureDuck, run: run, sync: syncLayers, addFile: addFile };
})();
