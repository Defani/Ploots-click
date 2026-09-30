/* ==========================================================================
   GIS — Global Forest Watch panel (left rail, "GFW").

   Layers     GFW's main layers. Tree cover loss is drawn from GFW's
              encoded tiles through a MapLibre protocol, so the years and
              the canopy density threshold filter the map live (as on
              globalforestwatch.org): blue = loss year − 2000, red =
              intensity.
   Analysis   an area (polygons of a layer, optionally only the selected
              ones, or the current map view) and:
                - Tree cover loss by year, estimated in the browser from the
                  same tiles (no key; an estimate, finer at small areas);
                - GFW Data API queries (the official numbers) with the
                  user's own free GFW API key: tree cover loss and gross
                  emissions by year, primary forest loss, tree cover extent
                  in 2000, integrated deforestation alerts and VIIRS fire
                  alerts since a date.
              Results: table, bar chart, CSV.
   Datasets   the full GFW Data API catalog (moved from the Catalog panel).

   GFW data are published under CC BY 4.0 (most layers); the attribution
   "Global Forest Watch" is kept on every layer and result. The API key is
   the user's own (globalforestwatch.org → My GFW → API keys), stored only
   on this computer and sent only to data-api.globalforestwatch.org.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var API = "https://data-api.globalforestwatch.org";
  var TILES = "https://tiles.globalforestwatch.org";
  var KEY = "ploots-gfw-api-key";
  var PANEL = "panel-gis-gfw";
  var ATTR = "Global Forest Watch (CC BY 4.0)";
  var Y0 = 2001, Y1 = new Date().getFullYear() - 1;
  var THRESHOLDS = [10, 15, 20, 25, 30, 50, 75];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function lg(id, s) { return GIS.logos ? GIS.logos.html(id, s || 16) : ""; }
  function apiKey() { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function fmt(v, d) { return (+v).toLocaleString("en-US", { maximumFractionDigits: d == null ? 1 : d }); }
  function getJSON(u) { return fetch(u).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.message || "HTTP " + r.status); return j; }); }); }

  /* ---------------------------------------------- tree cover loss tiles */

  var TCL_VERSION = "v1.13";
  function latestTcl() {
    return getJSON(API + "/dataset/umd_tree_cover_loss/latest").then(function (j) { TCL_VERSION = j.data.version; }).catch(function () { });
  }
  function tclTileUrl(z, x, y, tcd) { return TILES + "/umd_tree_cover_loss/" + TCL_VERSION + "/dynamic/" + z + "/" + x + "/" + y + ".png?implementation=tcd_" + tcd; }

  function decodeTile(img) {
    var c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    var g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    return { c: c, g: g, data: g.getImageData(0, 0, c.width, c.height) };
  }
  function loadImage(url, signal) {
    return fetch(url, { signal: signal }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); }).then(function (b) { return createImageBitmap(b); });
  }
  // gfwtcl://<tcd>/<y0>/<y1>/<z>/<x>/<y>: GFW's pink, only the chosen years.
  var protocolOn = false;
  function registerProtocol() {
    if (protocolOn || typeof maplibregl === "undefined" || !maplibregl.addProtocol) return;
    protocolOn = true;
    maplibregl.addProtocol("gfwtcl", function (params, abort) {
      var m = params.url.replace("gfwtcl://", "").split("/").map(Number);
      var tcd = m[0], y0 = m[1] - 2000, y1 = m[2] - 2000, z = m[3], x = m[4], y = m[5];
      var ctl = new AbortController();
      if (abort && abort.signal) abort.signal.addEventListener("abort", function () { ctl.abort(); });
      return loadImage(tclTileUrl(z, x, y, tcd), ctl.signal).then(function (img) {
        var t = decodeTile(img), d = t.data.data;
        for (var i = 0; i < d.length; i += 4) {
          var yr = d[i + 2], it = d[i];
          if (!it || yr < y0 || yr > y1 || !yr) { d[i + 3] = 0; continue; }
          // Brighter for recent years, like GFW's ramp.
          var k = (yr - y0) / Math.max(1, y1 - y0);
          d[i] = 220; d[i + 1] = Math.round(102 - 40 * k); d[i + 2] = Math.round(153 - 30 * k);
          d[i + 3] = Math.min(255, Math.round(it * (0.75 + 0.25 * k)));
        }
        t.g.putImageData(t.data, 0, 0);
        return new Promise(function (res) { t.c.toBlob(function (b) { res(b); }, "image/png"); });
      }).then(function (b) { return b.arrayBuffer(); }).then(function (buf) { return { data: buf }; });
    });
  }
  function tclUrl(o) { return "gfwtcl://" + o.tcd + "/" + o.y0 + "/" + o.y1 + "/{z}/{x}/{y}"; }
  function addTcl(o) {
    registerProtocol();
    var l = GIS.layers.filter(function (x) { return x.gfwTcl; })[0];
    if (l) { l.url = tclUrl(o); l.name = "Tree cover loss " + o.y0 + "–" + o.y1 + " (>" + o.tcd + "% canopy)"; GIS.emit("layers"); return l; }
    l = GIS.addXYZ(tclUrl(o), "Tree cover loss " + o.y0 + "–" + o.y1 + " (>" + o.tcd + "% canopy)", ATTR);
    l.gfwTcl = true;
    GIS.move(l.id, 0);
    return l;
  }

  // Other layers, by GFW dataset id (added through the catalog's asset lookup).
  var LAYERS = [
    ["umd_tree_cover_density_2000", "Tree cover density (2000)", "park", "Hansen/UMD canopy density in 2000."],
    ["umd_tree_cover_gain_from_height", "Tree cover gain", "trending_up", "Hansen/UMD tree cover gain 2000–2020 (from canopy height)."],
    ["umd_regional_primary_forest_2001", "Primary forests (2001)", "forest", "Humid tropical primary forest (Turubanova et al.)."],
    ["gfw_integrated_alerts", "Integrated deforestation alerts", "notification_important", "GLAD-L, GLAD-S2 and RADD alerts combined."],
    ["wur_radd_alerts", "RADD alerts (radar)", "radar", "Wageningen RADD Sentinel-1 disturbance alerts."],
    ["umd_glad_landsat_alerts", "GLAD-L alerts (Landsat)", "satellite_alt", "UMD GLAD Landsat alerts."],
    ["nasa_viirs_fire_alerts", "VIIRS fire alerts", "local_fire_department", "NASA VIIRS active fire detections."],
    ["gmw_global_mangrove_extent", "Mangrove forests", "water", "Global Mangrove Watch extent."],
    ["gfw_peatlands", "Peatlands", "grass", "GFW peatlands (compiled)."],
    ["ifl_intact_forest_landscapes", "Intact forest landscapes", "nature", "IFL 2000–2020."],
    ["wdpa_protected_areas", "Protected areas (WDPA)", "shield", "World Database on Protected Areas."],
    ["idn_forest_moratorium", "Indonesia forest moratorium", "gavel", "Indonesia's primary forest and peat moratorium (PIPPIB)."],
    ["idn_oil_palm_concessions", "Indonesia oil palm concessions", "agriculture", "Oil palm concessions (Indonesia)."]
  ];

  /* ------------------------------------------------------------- area */

  function areaFeatures(src) {
    if (src.id === "view") {
      var m = GIS.map(), b = m.getBounds();
      return [turf.bboxPolygon([b.getWest(), Math.max(-85, b.getSouth()), b.getEast(), Math.min(85, b.getNorth())])];
    }
    var l = GIS.get(src.id);
    if (!l) throw new Error("Choose an area.");
    var list = [];
    l.data.features.forEach(function (f, i) { if (f.geometry && /Polygon/.test(f.geometry.type) && (!src.sel || l.selection.has(i))) list.push(f); });
    if (!list.length) throw new Error(src.sel ? "No selected polygons in " + l.name + "." : l.name + " has no polygons.");
    return list;
  }
  function areaGeometry(list) {
    var u = list.length === 1 ? list[0] : turf.union(turf.featureCollection(list.map(function (f) { return turf.feature(f.geometry); })));
    // Keep requests small: simplify big outlines (≈ 50 m).
    var n = JSON.stringify(u.geometry).length;
    if (n > 400000) u = turf.simplify(u, { tolerance: 0.0005, highQuality: false });
    return u;
  }

  /* ---------------------------------------- estimate from the map tiles */

  function lon2x(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
  function lat2y(lat, z) { var r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z); }
  function y2lat(y, z) { var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }

  function estimateLoss(geom, o, progress, signal) {
    var bb = turf.bbox(geom), z = 12;
    // The finest zoom that needs at most 120 tiles (never coarser than 7).
    for (; z > 7; z--) {
      var nx = Math.floor(lon2x(bb[2], z)) - Math.floor(lon2x(bb[0], z)) + 1, ny = Math.floor(lat2y(bb[1], z)) - Math.floor(lat2y(bb[3], z)) + 1;
      if (nx * ny <= 120) break;
    }
    var x0 = Math.floor(lon2x(bb[0], z)), x1 = Math.floor(lon2x(bb[2], z)), ty0 = Math.floor(lat2y(bb[3], z)), ty1 = Math.floor(lat2y(bb[1], z));
    var jobs = [];
    for (var tx = x0; tx <= x1; tx++) for (var ty = ty0; ty <= ty1; ty++) jobs.push([tx, ty]);
    var byYear = {}, done = 0;
    var rings = (geom.geometry.type === "Polygon" ? [geom.geometry.coordinates] : geom.geometry.coordinates);
    function one(j) {
      var tx = j[0], ty = j[1];
      return loadImage(tclTileUrl(z, tx, ty, o.tcd), signal).then(function (img) {
        var W = img.width, S = W / 256, t = decodeTile(img), d = t.data.data;
        // Area mask: the polygon drawn in the tile's pixels.
        var mc = document.createElement("canvas"); mc.width = W; mc.height = W;
        var mg = mc.getContext("2d", { willReadFrequently: true });
        mg.fillStyle = "#000"; mg.beginPath();
        rings.forEach(function (poly) {
          poly.forEach(function (ring) {
            ring.forEach(function (c, k) {
              var px = (lon2x(c[0], z) - tx) * W, py = (lat2y(c[1], z) - ty) * W;
              if (k) mg.lineTo(px, py); else mg.moveTo(px, py);
            });
            mg.closePath();
          });
        });
        mg.fill("evenodd");
        var mask = mg.getImageData(0, 0, W, W).data;
        for (var py = 0; py < W; py++) {
          var lat = y2lat(ty + (py + 0.5) / W, z);
          var mpp = 40075016.686 * Math.cos(lat * Math.PI / 180) / (256 * S * Math.pow(2, z));
          var ha = mpp * mpp / 1e4;
          for (var px = 0; px < W; px++) {
            var i = (py * W + px) * 4;
            if (!mask[i + 3]) continue;
            var yr = d[i + 2], it = d[i];
            if (!yr || !it) continue;
            var Y = 2000 + yr;
            if (Y < o.y0 || Y > o.y1) continue;
            byYear[Y] = (byYear[Y] || 0) + ha * (it / 255);
          }
        }
      }).catch(function (e) { if (e.name === "AbortError") throw e; }).then(function () { progress(++done, jobs.length, z); });
    }
    // Six tiles at a time.
    var q = jobs.slice(), running = [];
    function next() { if (!q.length) return Promise.resolve(); return one(q.shift()).then(next); }
    for (var k = 0; k < 6; k++) running.push(next());
    return Promise.all(running).then(function () {
      var rows = [];
      for (var y = o.y0; y <= o.y1; y++) rows.push([y, byYear[y] || 0]);
      return { z: z, tiles: jobs.length, rows: rows };
    });
  }

  /* --------------------------------------------------------- Data API */

  function query(dataset, sql, geom) {
    var k = apiKey();
    if (!k) return Promise.reject(new Error("Add your GFW API key first (Analysis ▸ API key)."));
    return getJSON(API + "/dataset/" + dataset + "/latest").then(function (j) {
      var v = j.data.version;
      return fetch(API + "/dataset/" + dataset + "/" + v + "/query/json", {
        method: "POST", headers: { "Content-Type": "application/json", "x-api-key": k },
        body: JSON.stringify({ sql: sql, geometry: geom.geometry })
      }).then(function (r) {
        return r.json().then(function (x) { if (!r.ok || x.status === "failed") throw new Error(x.message || "HTTP " + r.status); return { v: v, data: x.data || [] }; });
      });
    });
  }
  var DAYS = function (n) { var d = new Date(Date.now() - n * 864e5); return d.toISOString().slice(0, 10); };
  var API_ANALYSES = [
    { id: "tcl", name: "Tree cover loss and emissions by year", run: function (g, o) {
      return query("umd_tree_cover_loss", "SELECT umd_tree_cover_loss__year, SUM(area__ha), SUM(gfw_forest_carbon_gross_emissions__Mg_CO2e) FROM results WHERE umd_tree_cover_density_2000__threshold >= " + o.tcd +
        " AND umd_tree_cover_loss__year >= " + o.y0 + " AND umd_tree_cover_loss__year <= " + o.y1 + " GROUP BY umd_tree_cover_loss__year ORDER BY umd_tree_cover_loss__year", g).then(function (r) {
        return { head: ["Year", "Loss (ha)", "Gross emissions (Mg CO₂e)"], rows: r.data.map(function (d) { return [d.umd_tree_cover_loss__year, d.area__ha, d.gfw_forest_carbon_gross_emissions__Mg_CO2e]; }), chart: 1, src: "umd_tree_cover_loss " + r.v };
      });
    } },
    { id: "primary", name: "Primary forest loss by year", run: function (g, o) {
      return query("umd_tree_cover_loss", "SELECT umd_tree_cover_loss__year, SUM(area__ha) FROM results WHERE is__umd_regional_primary_forest_2001 = 'true' AND umd_tree_cover_density_2000__threshold >= " + o.tcd +
        " AND umd_tree_cover_loss__year >= " + o.y0 + " AND umd_tree_cover_loss__year <= " + o.y1 + " GROUP BY umd_tree_cover_loss__year ORDER BY umd_tree_cover_loss__year", g).then(function (r) {
        return { head: ["Year", "Primary forest loss (ha)"], rows: r.data.map(function (d) { return [d.umd_tree_cover_loss__year, d.area__ha]; }), chart: 1, src: "umd_tree_cover_loss " + r.v };
      });
    } },
    { id: "extent", name: "Tree cover extent in 2000", run: function (g, o) {
      return query("umd_tree_cover_density_2000", "SELECT SUM(area__ha) FROM results WHERE umd_tree_cover_density_2000__threshold >= " + o.tcd, g).then(function (r) {
        var a = r.data[0] ? r.data[0].area__ha : 0;
        return { head: ["Measure", "Value"], rows: [["Tree cover 2000 (>" + o.tcd + "% canopy), ha", a], ["Area of interest, ha", turf.area(g) / 1e4], ["Share of area, %", a / (turf.area(g) / 1e4) * 100]], src: "umd_tree_cover_density_2000 " + r.v };
      });
    } },
    { id: "alerts", name: "Integrated deforestation alerts", run: function (g, o) {
      return query("gfw_integrated_alerts", "SELECT gfw_integrated_alerts__confidence, SUM(area__ha), COUNT(*) FROM results WHERE gfw_integrated_alerts__date >= '" + DAYS(o.days) + "' GROUP BY gfw_integrated_alerts__confidence", g).then(function (r) {
        return { head: ["Confidence", "Area (ha)", "Alerts"], rows: r.data.map(function (d) { return [d.gfw_integrated_alerts__confidence, d.area__ha, d.count]; }), src: "gfw_integrated_alerts " + r.v + ", since " + DAYS(o.days) };
      });
    } },
    { id: "fires", name: "VIIRS fire alerts", run: function (g, o) {
      return query("nasa_viirs_fire_alerts", "SELECT confidence__cat, COUNT(*) FROM results WHERE alert__date >= '" + DAYS(o.days) + "' GROUP BY confidence__cat", g).then(function (r) {
        return { head: ["Confidence", "Fire alerts"], rows: r.data.map(function (d) { return [{ h: "high", n: "nominal", l: "low" }[d.confidence__cat] || d.confidence__cat, d.count]; }), src: "nasa_viirs_fire_alerts " + r.v + ", since " + DAYS(o.days) };
      });
    } }
  ];

  /* -------------------------------------------------------------- UI */

  function build(before) {
    if ($(PANEL)) return;
    var p = document.createElement("div");
    p.id = PANEL;
    p.className = "sidebar-panel";
    var yearOpts = function (sel) { var h = ""; for (var y = Y0; y <= Y1; y++) h += "<option" + (y === sel ? " selected" : "") + ">" + y + "</option>"; return h; };
    var tcdOpts = THRESHOLDS.map(function (t) { return '<option value="' + t + '"' + (t === 30 ? " selected" : "") + ">&gt; " + t + "%</option>"; }).join("");
    p.innerHTML =
      '<div class="sp-head"><span class="sp-title gfw-title">' + lg("gfw", 18) + 'Global Forest Watch</span><button type="button" class="sp-close" title="Close panel">' + sym("keyboard_double_arrow_left") + "</button></div>" +
      '<div class="gfw-body">' +
        '<div class="toggle-group gfw-tabs"><button data-tab="layers" class="active">Layers</button><button data-tab="analysis">Analysis</button><button data-tab="data">Datasets</button></div>' +

        '<div class="gfw-pane" data-pane="layers">' +
          '<div class="gfw-card"><div class="gfw-card-head">' + sym("forest") + "<b>Tree cover loss</b><em>Hansen / UMD</em></div>" +
            '<div class="num-pair"><div><label class="field-label">From</label><select id="gfwY0">' + yearOpts(Y0) + '</select></div><div><label class="field-label">To</label><select id="gfwY1">' + yearOpts(Y1) + "</select></div></div>" +
            '<label class="field-label">Canopy density (2000)</label><select id="gfwTcd">' + tcdOpts + "</select>" +
            '<button id="gfwTclAdd" class="btn-primary" style="width:100%;margin-top:10px;">' + sym("add") + "Show on map</button>" +
            '<p class="gfw-note">Years and threshold filter the map live once it is added.</p></div>' +
          '<div class="gfw-list">' + LAYERS.map(function (l) {
            return '<button type="button" class="gfw-item" data-ds="' + l[0] + '" data-title="' + esc(l[1]) + '" title="' + esc(l[3]) + '">' + sym(l[2]) + '<span class="gfw-name">' + esc(l[1]) + "<small>" + esc(l[3]) + "</small></span>" + sym("add") + "</button>";
          }).join("") + "</div>" +
          '<p class="status" id="gfwLayerStatus" style="display:none;"></p>' +
        "</div>" +

        '<div class="gfw-pane" data-pane="analysis" hidden>' +
          '<label class="field-label">Area of interest</label><select id="gfwArea"></select>' +
          '<label class="check-row" id="gfwSelWrap"><input type="checkbox" id="gfwSel">Selected features only</label>' +
          '<div class="num-pair"><div><label class="field-label">From</label><select id="gfwAY0">' + yearOpts(Y0) + '</select></div><div><label class="field-label">To</label><select id="gfwAY1">' + yearOpts(Y1) + "</select></div></div>" +
          '<div class="num-pair"><div><label class="field-label">Canopy density</label><select id="gfwATcd">' + tcdOpts + '</select></div><div><label class="field-label">Alerts / fires: last</label><select id="gfwDays"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></div></div>' +
          '<div class="gfw-sub">' + sym("bolt") + "Quick estimate (no key)</div>" +
          '<button id="gfwEstimate" style="width:100%;">' + sym("insights") + "Tree cover loss by year (from map tiles)</button>" +
          '<div class="gfw-sub">' + sym("verified") + 'GFW Data API <span id="gfwKeyState"></span></div>' +
          '<div class="gfw-api">' + API_ANALYSES.map(function (a) { return '<button type="button" data-api="' + a.id + '">' + esc(a.name) + "</button>"; }).join("") + "</div>" +
          '<button id="gfwKey" class="gfw-link">' + sym("key") + "API key…</button>" +
          '<div id="gfwOut"></div>' +
        "</div>" +

        '<div class="gfw-pane" data-pane="data" hidden></div>' +
        '<p class="gfw-foot">Data: Global Forest Watch and partners, CC BY 4.0 unless stated otherwise.</p>' +
      "</div>";
    document.querySelector(".sidebar").appendChild(p);
    p.querySelector(".sp-close").addEventListener("click", function () { window.closeSidebar(); });

    // Datasets: the catalog's GFW list moves here.
    var catPane = document.querySelector('#panel-catalog .cat-pane[data-pane="gfw"]');
    if (catPane) {
      var dp = p.querySelector('[data-pane="data"]');
      while (catPane.firstChild) dp.appendChild(catPane.firstChild);
      catPane.remove();
      var tab = document.querySelector('#panel-catalog .cat-tabs [data-tab="gfw"]');
      if (tab) tab.remove();
    }

    p.querySelector(".gfw-tabs").addEventListener("click", function (e) {
      var t = e.target.closest("[data-tab]");
      if (!t) return;
      Array.prototype.forEach.call(p.querySelectorAll(".gfw-tabs [data-tab]"), function (x) { x.classList.toggle("active", x === t); });
      Array.prototype.forEach.call(p.querySelectorAll(".gfw-pane"), function (x) { x.hidden = x.dataset.pane !== t.dataset.tab; });
      if (t.dataset.tab === "data" && GIS.gfwCatalog) GIS.gfwCatalog.load();
      if (t.dataset.tab === "analysis") fillAreas();
    });

    // Layers
    function tclOpts(a, b, c) { var y0 = +$(a).value, y1 = +$(b).value; if (y0 > y1) { var s = y0; y0 = y1; y1 = s; } return { y0: y0, y1: y1, tcd: +$(c).value }; }
    $("gfwTclAdd").addEventListener("click", function () {
      GIS.enterMapMode();
      latestTcl().then(function () { addTcl(tclOpts("gfwY0", "gfwY1", "gfwTcd")); status("gfwLayerStatus", "Tree cover loss added.", true); });
    });
    ["gfwY0", "gfwY1", "gfwTcd"].forEach(function (id) {
      $(id).addEventListener("change", function () { if (GIS.layers.some(function (l) { return l.gfwTcl; })) addTcl(tclOpts("gfwY0", "gfwY1", "gfwTcd")); });
    });
    p.querySelector(".gfw-list").addEventListener("click", function (e) {
      var b = e.target.closest("[data-ds]");
      if (!b || !GIS.gfwCatalog) return;
      var st = $("gfwLayerStatus");
      // The catalog's add() reports into its own status line; mirror it here.
      var cs = $("catGfwStatus");
      GIS.gfwCatalog.add(b.dataset.ds, b.dataset.title, b);
      var n = 0, iv = setInterval(function () {
        if (cs && cs.textContent) { status("gfwLayerStatus", cs.textContent, !/could not|not a map|error|HTTP/i.test(cs.textContent)); }
        if (++n > 40 || !b.disabled) clearInterval(iv);
      }, 250);
    });

    // Analysis
    $("gfwArea").addEventListener("change", fillSel);
    $("gfwKey").addEventListener("click", askKey);
    $("gfwEstimate").addEventListener("click", runEstimate);
    p.querySelector(".gfw-api").addEventListener("click", function (e) { var b = e.target.closest("[data-api]"); if (b) runApi(b.dataset.api); });
    GIS.on("layers", function () { if (!p.querySelector('[data-pane="analysis"]').hidden) fillAreas(); });
    GIS.on("selection", fillSel);
    keyState();

    // Rail button (map workspace only).
    var nav = document.querySelector(".sidebar-nav"), rb = document.createElement("button");
    rb.className = "nav-btn nav-gis";
    rb.setAttribute("data-panel", PANEL);
    rb.title = "Global Forest Watch";
    rb.innerHTML = sym("forest") + '<span class="nav-lbl">GFW</span>';
    var cat = nav.querySelector(".nav-catalog");
    if (cat) cat.after(rb); else nav.appendChild(rb);
    rb.addEventListener("click", function () { if (rb.classList.contains("active")) window.closeSidebar(); else { GIS.enterMapMode(); activateSidebarPanel(PANEL); } });
  }

  function status(id, msg, ok) { var el = $(id); if (!el) return; el.style.display = msg ? "" : "none"; el.className = "status " + (ok === false ? "error" : "ok"); el.textContent = msg || ""; }
  function keyState() { var s = $("gfwKeyState"); if (s) s.innerHTML = apiKey() ? '<em class="ok">key set</em>' : '<em>needs your API key</em>'; }
  function askKey() {
    var v = window.prompt("Your own GFW Data API key (create one at globalforestwatch.org → My GFW, or with the Data API /auth/apikey).\n" +
      "It is stored only on this computer and sent only to data-api.globalforestwatch.org. Leave empty to remove it.", apiKey());
    if (v == null) return;
    try { if (v.trim()) localStorage.setItem(KEY, v.trim()); else localStorage.removeItem(KEY); } catch (e) { }
    keyState();
  }
  function fillAreas() {
    var s = $("gfwArea"), cur = s.value;
    var polys = GIS.layers.filter(function (l) { return l.kind === "vector" && GIS.geometryKind(l) === "polygon"; });
    s.innerHTML = '<option value="view">Current map view</option>' + polys.map(function (l) { return '<option value="' + l.id + '">' + esc(l.name) + "</option>"; }).join("");
    if (cur && s.querySelector('option[value="' + cur + '"]')) s.value = cur;
    else { var a = GIS.active(); if (a && polys.indexOf(a) >= 0) s.value = a.id; }
    fillSel();
  }
  function fillSel() {
    var s = $("gfwArea"), l = s && GIS.get(s.value), w = $("gfwSelWrap");
    if (!w) return;
    var n = l && l.selection ? l.selection.size : 0;
    w.style.display = n ? "" : "none";
    w.lastChild.textContent = "Selected features only (" + n + ")";
  }
  function opts() {
    var y0 = +$("gfwAY0").value, y1 = +$("gfwAY1").value;
    if (y0 > y1) { var t = y0; y0 = y1; y1 = t; }
    return { y0: y0, y1: y1, tcd: +$("gfwATcd").value, days: +$("gfwDays").value, area: { id: $("gfwArea").value, sel: $("gfwSel").checked } };
  }
  function areaLabel(o) { var l = GIS.get(o.area.id); return o.area.id === "view" ? "Current map view" : l.name + (o.area.sel ? " (selected)" : ""); }

  var running = null;
  function busy(msg) { $("gfwOut").innerHTML = '<div class="gfw-busy">' + sym("progress_activity") + "<span>" + esc(msg) + "</span></div>"; }
  function fail(e) { $("gfwOut").innerHTML = '<p class="status error">' + esc(e.message || e) + "</p>"; }

  function runEstimate() {
    var o = opts();
    if (running) running.abort();
    running = new AbortController();
    var sig = running.signal;
    busy("Reading tree cover loss tiles…");
    GIS.processing.ensureTurf().then(latestTcl).then(function () {
      var g = areaGeometry(areaFeatures(o.area));
      return estimateLoss(g, o, function (d, n, z) { busy("Reading tiles " + d + " / " + n + " (zoom " + z + ")…"); }, sig).then(function (r) {
        var total = r.rows.reduce(function (a, b) { return a + b[1]; }, 0);
        show({ title: "Tree cover loss (estimate)", sub: areaLabel(o) + " · >" + o.tcd + "% canopy · " + o.y0 + "–" + o.y1,
          head: ["Year", "Loss (ha)"], rows: r.rows, chart: 1,
          note: "Estimated in the browser from GFW's map tiles at zoom " + r.z + " (" + r.tiles + " tiles). Total ≈ " + fmt(total, 0) + " ha of " + fmt(turf.area(g) / 1e4, 0) + " ha. Use the Data API for official figures.",
          src: "umd_tree_cover_loss " + TCL_VERSION + " tiles" });
      });
    }).catch(function (e) { if (e.name !== "AbortError") fail(e); });
  }
  function runApi(id) {
    var a = API_ANALYSES.filter(function (x) { return x.id === id; })[0], o = opts();
    if (!apiKey()) { askKey(); if (!apiKey()) return; }
    busy(a.name + "…");
    GIS.processing.ensureTurf().then(function () {
      var g = areaGeometry(areaFeatures(o.area));
      return a.run(g, o).then(function (r) {
        r.title = a.name; r.sub = areaLabel(o) + (id === "alerts" || id === "fires" ? "" : " · >" + o.tcd + "% canopy" + (id === "extent" ? "" : " · " + o.y0 + "–" + o.y1));
        if (!r.rows.length) r.note = "No data in this area.";
        show(r);
      });
    }).catch(fail);
  }

  var last = null;
  function show(r) {
    last = r;
    var h = '<div class="gfw-res"><div class="gfw-res-head"><b>' + esc(r.title) + "</b><span>" + esc(r.sub || "") + "</span></div>";
    if (r.chart && r.rows.length) {
      var max = Math.max.apply(null, r.rows.map(function (x) { return +x[1] || 0; })) || 1, W = 100 / r.rows.length;
      h += '<svg class="gfw-chart" viewBox="0 0 100 40" preserveAspectRatio="none">' + r.rows.map(function (x, i) {
        var v = +x[1] || 0, hh = v / max * 38;
        return '<rect x="' + (i * W + W * 0.12) + '" y="' + (40 - hh) + '" width="' + W * 0.76 + '" height="' + hh + '"><title>' + x[0] + ": " + fmt(v, 1) + " ha</title></rect>";
      }).join("") + '</svg><div class="gfw-axis"><span>' + r.rows[0][0] + "</span><span>" + r.rows[r.rows.length - 1][0] + "</span></div>";
    }
    h += '<table class="gproc-table"><tr>' + r.head.map(function (c, i) { return i ? '<th style="text-align:right">' + esc(c) + "</th>" : "<th>" + esc(c) + "</th>"; }).join("") + "</tr>" +
      r.rows.map(function (x) { return "<tr>" + x.map(function (c, i) { return i ? "<td>" + (c == null ? "–" : fmt(c, 2)) + "</td>" : '<th>' + esc(c) + "</th>"; }).join("") + "</tr>"; }).join("") + "</table>";
    if (r.note) h += '<p class="gfw-note">' + esc(r.note) + "</p>";
    h += '<p class="gfw-note">Source: ' + esc(r.src || "Global Forest Watch") + " · Global Forest Watch</p>";
    h += '<button type="button" id="gfwCsv">' + sym("download") + "Download CSV</button></div>";
    $("gfwOut").innerHTML = h;
    $("gfwCsv").addEventListener("click", function () {
      var csv = [last.head].concat(last.rows).map(function (x) { return x.map(function (c) { var s = c == null ? "" : String(c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(","); }).join("\n");
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = last.title.replace(/[^\w]+/g, "_").toLowerCase() + ".csv";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
  }

  function boot() { build(); registerProtocolWhenReady(); }
  function registerProtocolWhenReady() {
    if (typeof maplibregl !== "undefined") { registerProtocol(); return; }
    var n = 0, iv = setInterval(function () { if (typeof maplibregl !== "undefined" || ++n > 120) { clearInterval(iv); registerProtocol(); } }, 500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 0); }); else setTimeout(boot, 0);

  GIS.gfw = { addTreeCoverLoss: addTcl, estimateLoss: estimateLoss, query: query };
})();
