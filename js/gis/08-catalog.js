/* ==========================================================================
   GIS — Data catalog (the "Catalog" rail panel in map mode).

   Nothing here is a hard-coded layer list: every tab reads its source live,
   so new government releases show up as soon as the agency publishes them.

   Government   Browses ArcGIS REST service directories (folders -> services
                -> layers). Built in: Kementerian Kehutanan (Planologi,
                formerly KLHK), BNPB and BIG (Ina-Geoportal); any other
                ArcGIS server can be added by URL. MapServer/ImageServer
                layers are added as tiles (export with {bbox-epsg-3857});
                queryable layers can be added as features (GeoJSON, paged),
                which gives symbology and the attribute table. "Newest first"
                sorts by the latest year in the name.
   GFW          Global Forest Watch Data API: all datasets, searchable. Each
                is added at its latest version, raster datasets as tiles
                (tiles.globalforestwatch.org dynamic PNG) and vector datasets
                as vector tiles.
   Species      GBIF occurrences and iNaturalist observations for a taxon
                (autocomplete), in the current map view or a country, with
                year, quality and count limits; fields useful for analysis
                are kept (like the QGIS "iNaturalist extractor" plugin). GBIF
                can also add its occurrence density map as tiles.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var PANEL_ID = "panel-catalog";

  var SERVERS = [
    { id: "kemenhut", label: "Kementerian Kehutanan (Planologi, ex-KLHK)", url: "https://geoportal.planologi.kehutanan.go.id/server/rest/services", attr: "Kementerian Kehutanan RI" },
    { id: "bnpb", label: "BNPB (disaster management)", url: "https://gis.bnpb.go.id/server/rest/services", attr: "BNPB" },
    { id: "big", label: "BIG / Ina-Geoportal (RBI)", url: "https://geoservices.big.go.id/rbi/rest/services", attr: "Badan Informasi Geospasial" }
  ];
  var GFW_API = "https://data-api.globalforestwatch.org";

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function getJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { if (j && j.error) throw new Error(j.error.message || "Server error"); return j; });
  }
  function status(id, msg, ok) {
    var el = $(id);
    if (!el) return;
    el.style.display = msg ? "" : "none";
    el.className = "status " + (ok === false ? "error" : "ok");
    el.textContent = msg || "";
  }
  function latestYear(s) { var m = String(s).match(/(19|20)\d\d/g); return m ? Math.max.apply(null, m.map(Number)) : 0; }
  function nice(s) { return String(s).replace(/_/g, " "); }
  function enter() { GIS.enterMapMode(); }
  // Provider logo (js/gis/16-logos.js).
  function lg(id, s) { return GIS.logos ? GIS.logos.html(id, s || 16) : ""; }

  /* ------------------------------------------------------------ panel */

  function build() {
    if ($(PANEL_ID)) return;
    var p = document.createElement("div");
    p.id = PANEL_ID;
    p.className = "sidebar-panel";
    p.innerHTML =
      '<div class="sp-head"><span class="sp-title">Data catalog</span><button type="button" class="sp-close" title="Close panel"><span class="material-symbols-outlined">keyboard_double_arrow_left</span></button></div>' +
      '<div class="cat-body">' +
        '<div class="toggle-group cat-tabs"><button data-tab="gov" class="active">Government</button><button data-tab="gfw">' + lg("gfw", 14) + 'GFW</button><button data-tab="bio">Species</button></div>' +

        '<div class="cat-pane" data-pane="gov">' +
          '<div class="cat-servers" id="catServers">' + SERVERS.map(function (s) {
            return '<button type="button" data-server="' + s.id + '"' + (s === SERVERS[0] ? ' class="active"' : "") + ">" + lg(s.id, 22) + "<span>" + esc(s.label) + "</span></button>";
          }).join("") + '<button type="button" data-server="custom">' + lg("arcgis", 22) + "<span>Other ArcGIS server…</span></button></div>" +
          '<select id="catServer" hidden>' + SERVERS.map(function (s) { return '<option value="' + s.id + '">' + esc(s.label) + "</option>"; }).join("") + '<option value="custom">Other ArcGIS server…</option></select>' +
          '<div id="catCustomWrap" style="display:none;"><input type="text" id="catCustomUrl" placeholder="https://…/arcgis/rest/services" style="margin-top:6px;"><button id="catCustomGo" style="width:100%;margin-top:6px;">Open</button></div>' +
          '<div class="cat-row"><input type="search" id="catGovFilter" placeholder="Filter"><label class="cat-check"><input type="checkbox" id="catNewest" checked>Newest first</label></div>' +
          '<div class="cat-crumbs" id="catCrumbs"></div>' +
          '<p class="status" id="catGovStatus" style="display:none;"></p>' +
          '<div class="cat-list" id="catGovList"></div>' +
        "</div>" +

        '<div class="cat-pane" data-pane="gfw" style="display:none;">' +
          '<input type="search" id="catGfwFilter" placeholder="Search 380+ datasets (e.g. tree cover loss, alerts, peat)">' +
          '<p class="status" id="catGfwStatus" style="display:none;"></p>' +
          '<div class="cat-list" id="catGfwList"></div>' +
        "</div>" +

        '<div class="cat-pane" data-pane="bio" style="display:none;">' +
          '<div class="toggle-group" style="margin-top:2px;"><button data-src="gbif" class="active">' + lg("gbif", 16) + 'GBIF</button><button data-src="inat">' + lg("inat", 16) + 'iNaturalist</button></div>' +
          '<label class="field-label">Taxon</label>' +
          '<div class="cat-ac"><input type="text" id="catTaxon" placeholder="e.g. Rhizophora, Nasalis larvatus" autocomplete="off"><div class="cat-ac-list" id="catTaxonList"></div></div>' +
          '<div class="cat-picked" id="catPicked"></div>' +
          '<label class="field-label">Area</label>' +
          '<select id="catArea"><option value="view">Current map view</option><option value="country">Country</option><option value="all">Worldwide</option></select>' +
          '<input type="text" id="catCountry" value="ID" placeholder="ISO code, e.g. ID" style="display:none;margin-top:6px;">' +
          '<div class="num-pair" style="margin-top:8px;"><div><label class="field-label" style="margin-top:0;">From year</label><input type="number" id="catYear0" placeholder="any"></div>' +
            '<div><label class="field-label" style="margin-top:0;">To year</label><input type="number" id="catYear1" placeholder="any"></div></div>' +
          '<div class="num-pair" style="margin-top:8px;"><div><label class="field-label" style="margin-top:0;">Max records</label><input type="number" id="catMax" value="1000" min="10" max="10000" step="100"></div>' +
            '<div id="catQualWrap"><label class="field-label" style="margin-top:0;">Records</label><select id="catQual"></select></div></div>' +
          '<button id="catFetch" class="btn-primary" style="width:100%;margin-top:12px;"><span class="material-symbols-outlined">download</span>Add occurrences</button>' +
          '<button id="catDensity" style="width:100%;margin-top:6px;"><span class="material-symbols-outlined">blur_on</span>Add GBIF density map</button>' +
          '<p class="status" id="catBioStatus" style="display:none;"></p>' +
        "</div>" +
      "</div>";
    document.querySelector(".sidebar").appendChild(p);
    p.querySelector(".sp-close").addEventListener("click", function () { window.closeSidebar(); });

    // Rail button, after Map.
    var nav = document.querySelector(".sidebar-nav"), mapBtn = nav.querySelector('[data-panel="panel-map"]');
    var b = document.createElement("button");
    b.className = "nav-btn nav-catalog";
    b.setAttribute("data-panel", PANEL_ID);
    b.title = "Data catalog";
    b.innerHTML = '<span class="material-symbols-outlined">travel_explore</span><span class="nav-lbl">Catalog</span>';
    if (mapBtn) mapBtn.after(b); else nav.appendChild(b);
    b.addEventListener("click", function () {
      if (b.classList.contains("active")) { window.closeSidebar(); return; }
      open();
    });

    p.querySelector(".cat-tabs").addEventListener("click", function (e) {
      var t = e.target.closest("[data-tab]");
      if (!t) return;
      Array.prototype.forEach.call(p.querySelectorAll(".cat-tabs [data-tab]"), function (x) { x.classList.toggle("active", x === t); });
      Array.prototype.forEach.call(p.querySelectorAll(".cat-pane"), function (x) { x.style.display = x.dataset.pane === t.dataset.tab ? "" : "none"; });
      if (t.dataset.tab === "gfw") loadGfw();
    });
    wireGov();
    wireGfw();
    wireBio();
  }

  function open() {
    enter();
    activateSidebarPanel(PANEL_ID);
    if (!gov.loaded) govGo(SERVERS[0], "");
  }
  GIS.openCatalog = open;

  /* ------------------------------------------------------- government */

  var gov = { server: SERVERS[0], path: "", items: [], loaded: false, service: null };

  function wireGov() {
    $("catServers").addEventListener("click", function (e) {
      var b = e.target.closest("[data-server]");
      if (!b) return;
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle("active", x === b); });
      var sel = $("catServer");
      sel.value = b.dataset.server;
      sel.dispatchEvent(new Event("change"));
    });
    $("catServer").addEventListener("change", function () {
      var custom = this.value === "custom";
      $("catCustomWrap").style.display = custom ? "" : "none";
      if (!custom) govGo(SERVERS.filter(function (s) { return s.id === this.value; }, this)[0], "");
    });
    $("catCustomGo").addEventListener("click", function () {
      var u = $("catCustomUrl").value.trim().replace(/\/+$/, "").replace(/\?.*$/, "");
      if (!/^https?:\/\/.+\/rest\/services/i.test(u)) { status("catGovStatus", "Enter an ArcGIS REST services URL (…/rest/services).", false); return; }
      var root = u.replace(/(\/rest\/services).*$/i, "$1"), sub = u.slice(root.length).replace(/^\//, "");
      govGo({ id: "custom", label: root.split("/")[2], url: root, attr: root.split("/")[2] }, sub);
    });
    $("catGovFilter").addEventListener("input", renderGov);
    $("catNewest").addEventListener("change", renderGov);
    $("catCrumbs").addEventListener("click", function (e) {
      var c = e.target.closest("[data-path]");
      if (c) govGo(gov.server, c.getAttribute("data-path"));
    });
    $("catGovList").addEventListener("click", onGovClick);
  }

  function govGo(server, path) {
    gov.server = server; gov.path = path; gov.service = null; gov.loaded = true;
    $("catGovList").innerHTML = "";
    status("catGovStatus", "Loading…", true);
    getJSON(server.url + (path ? "/" + path : "") + "?f=json").then(function (j) {
      gov.items = (j.folders || []).map(function (f) { return { kind: "folder", name: f, path: f }; })
        .concat((j.services || []).map(function (s) { return { kind: "service", name: s.name.split("/").pop(), path: s.name, type: s.type }; }))
        .filter(function (it) { return it.kind === "folder" || /MapServer|FeatureServer|ImageServer/.test(it.type); });
      status("catGovStatus", "");
      renderGov();
    }).catch(function (e) { status("catGovStatus", "Could not open " + server.label + ": " + e.message, false); });
  }

  function crumbs(extra) {
    var parts = gov.path ? gov.path.split("/") : [], h = '<a data-path="">' + esc(gov.server.label.replace(/ \(.*\)$/, "")) + "</a>";
    parts.forEach(function (p, i) { h += ' <span>›</span> <a data-path="' + esc(parts.slice(0, i + 1).join("/")) + '">' + esc(nice(p)) + "</a>"; });
    if (extra) h += ' <span>›</span> <b>' + esc(extra) + "</b>";
    $("catCrumbs").innerHTML = h;
  }

  function renderGov() {
    if (gov.service) return renderService();
    crumbs();
    var q = $("catGovFilter").value.trim().toLowerCase(), items = gov.items.filter(function (it) { return !q || it.name.toLowerCase().indexOf(q) >= 0; });
    // Collapse Map/Feature/Image servers of the same name into one row.
    var byName = {}, rows = [];
    items.forEach(function (it) {
      if (it.kind === "folder") { rows.push(it); return; }
      if (!byName[it.path]) { byName[it.path] = { kind: "service", name: it.name, path: it.path, types: [] }; rows.push(byName[it.path]); }
      byName[it.path].types.push(it.type);
    });
    if ($("catNewest").checked) rows.sort(function (a, b) { return (a.kind === b.kind ? 0 : a.kind === "folder" ? -1 : 1) || latestYear(b.name) - latestYear(a.name) || a.name.localeCompare(b.name); });
    $("catGovList").innerHTML = rows.length ? rows.map(function (r) {
      if (r.kind === "folder") return '<button class="cat-item" data-folder="' + esc(r.path) + '"><span class="material-symbols-outlined">folder</span><span class="cat-name">' + esc(nice(r.name)) + "</span>" + yearBadge(r.name) + "</button>";
      return '<button class="cat-item" data-service="' + esc(r.path) + '" data-types="' + r.types.join(",") + '"><span class="material-symbols-outlined">' + (r.types.indexOf("ImageServer") >= 0 ? "grid_on" : "layers") + '</span><span class="cat-name">' + esc(nice(r.name)) + "</span>" + yearBadge(r.name) +
        '<span class="cat-types">' + r.types.map(function (t) { return t.replace("Server", ""); }).join(" · ") + "</span></button>";
    }).join("") : '<div class="gis-empty">Nothing here</div>';
  }
  function yearBadge(name) { var y = latestYear(name); return y ? '<em class="cat-year">' + y + "</em>" : ""; }

  function onGovClick(e) {
    var f = e.target.closest("[data-folder]"), s = e.target.closest("[data-service]"), a = e.target.closest("[data-add]");
    if (a) { addGov(a.getAttribute("data-add"), a); return; }
    if (f) { govGo(gov.server, f.getAttribute("data-folder")); return; }
    if (s) openService(s.getAttribute("data-service"), s.getAttribute("data-types").split(","));
  }

  function openService(path, types) {
    var type = types.indexOf("MapServer") >= 0 ? "MapServer" : types.indexOf("ImageServer") >= 0 ? "ImageServer" : "FeatureServer";
    var url = gov.server.url + "/" + path + "/" + type;
    status("catGovStatus", "Loading service…", true);
    getJSON(url + "?f=json").then(function (j) {
      gov.service = { path: path, types: types, type: type, url: url, info: j, featureUrl: types.indexOf("FeatureServer") >= 0 ? gov.server.url + "/" + path + "/FeatureServer" : url };
      status("catGovStatus", "");
      renderService();
    }).catch(function (err) { status("catGovStatus", "Could not open the service: " + err.message, false); });
  }

  function renderService() {
    var sv = gov.service, name = nice(sv.path.split("/").pop());
    crumbs(name);
    var j = sv.info, h = '<button class="cat-back" data-path-back="1"><span class="material-symbols-outlined">arrow_back</span>Back</button>';
    if (j.serviceDescription || j.description) h += '<div class="cat-desc">' + esc(String(j.serviceDescription || j.description).replace(/<[^>]+>/g, " ").slice(0, 280)) + "</div>";
    if (sv.type !== "FeatureServer") h += '<button class="cat-add wide" data-add="service"><span class="material-symbols-outlined">add</span>Add whole service as map</button>';
    var layers = (j.layers || []).filter(function (l) { return !l.subLayerIds || !l.subLayerIds.length; });
    if (layers.length) h += '<div class="cat-sub">Layers</div>';
    layers.forEach(function (l) {
      h += '<div class="cat-layer"><span class="cat-name">' + esc(l.name) + "</span>" +
        (sv.type === "MapServer" ? '<button class="cat-add" data-add="tiles:' + l.id + '" title="Add as map tiles">Map</button>' : "") +
        '<button class="cat-add" data-add="features:' + l.id + '" title="Add as features (attribute table, symbology)">Features</button></div>';
    });
    $("catGovList").innerHTML = h;
    $("catGovList").querySelector("[data-path-back]").addEventListener("click", function () { gov.service = null; renderGov(); });
  }

  function addGov(what, btn) {
    var sv = gov.service, name = nice(sv.path.split("/").pop()), attr = gov.server.attr;
    enter();
    if (what === "service" || what.indexOf("tiles:") === 0) {
      var id = what.indexOf("tiles:") === 0 ? what.split(":")[1] : null;
      var lname = id != null ? ((sv.info.layers || []).filter(function (l) { return String(l.id) === id; })[0] || {}).name : null;
      var q = "bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image";
      var url = sv.type === "ImageServer" ? sv.url + "/exportImage?" + q : sv.url + "/export?" + q + (id != null ? "&layers=show:" + id : "");
      GIS.addXYZ(url, lname ? name + " — " + lname : name, attr);
      // Tile layers go to the bottom; move this one to the top like a data layer.
      GIS.move(GIS.layers[GIS.layers.length - 1].id, 0);
      zoomToExtent(sv.info.fullExtent || sv.info.extent);
      status("catGovStatus", "Added " + name + ".", true);
      return;
    }
    var lid = what.split(":")[1];
    var layerInfo = ((sv.info.layers || []).filter(function (l) { return String(l.id) === lid; })[0] || {});
    fetchFeatures(sv.featureUrl + "/" + lid, layerInfo.name || name, btn);
  }

  // Paged GeoJSON query (the server's maxRecordCount per page), capped.
  function fetchFeatures(layerUrl, name, btn) {
    var CAP = 20000, feats = [];
    status("catGovStatus", "Downloading features…", true);
    if (btn) btn.disabled = true;
    getJSON(layerUrl + "?f=json").then(function (info) {
      var page = Math.min(info.maxRecordCount || 1000, 2000);
      function next(offset) {
        var u = layerUrl + "/query?where=1%3D1&outFields=*&outSR=4326&geometryPrecision=6&f=geojson&resultOffset=" + offset + "&resultRecordCount=" + page;
        return getJSON(u).then(function (fc) {
          var got = (fc.features || []).filter(function (f) { return f.geometry; });
          feats = feats.concat(got);
          status("catGovStatus", "Downloading features… " + feats.length, true);
          var more = fc.exceededTransferLimit || (fc.properties && fc.properties.exceededTransferLimit) || got.length === page;
          if (more && got.length && feats.length < CAP) return next(offset + got.length);
        });
      }
      return next(0).then(function () {
        if (!feats.length) throw new Error("no features returned");
        GIS.addVector({ type: "FeatureCollection", features: feats }, name);
        var l = GIS.active(); l.attribution = gov.server.attr;
        status("catGovStatus", "Added " + feats.length + " features" + (feats.length >= CAP ? " (first " + CAP + ")" : "") + ".", true);
      });
    }).catch(function (e) { status("catGovStatus", "Could not download features: " + e.message, false); })
      .then(function () { if (btn) btn.disabled = false; });
  }

  function zoomToExtent(ext) {
    var map = GIS.map();
    if (!map || !ext || !isFinite(ext.xmin)) return;
    var wk = ext.spatialReference && (ext.spatialReference.latestWkid || ext.spatialReference.wkid);
    var sw = [ext.xmin, ext.ymin], ne = [ext.xmax, ext.ymax];
    if (wk === 3857 || wk === 102100 || wk === 102113) {
      var m2 = function (x, y) { return [x / 6378137 * 180 / Math.PI, (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI]; };
      sw = m2(ext.xmin, ext.ymin); ne = m2(ext.xmax, ext.ymax);
    } else if (wk && wk !== 4326 && wk !== 4269) return; // other CRS: leave the view
    if (Math.abs(ne[0] - sw[0]) > 300) return;
    map.fitBounds([sw, ne], { padding: 30, animate: false, bearing: map.getBearing() });
  }

  /* -------------------------------------------------------------- GFW */

  var gfw = { list: null, loading: false };

  function wireGfw() {
    $("catGfwFilter").addEventListener("input", renderGfw);
    $("catGfwList").addEventListener("click", function (e) {
      var b = e.target.closest("[data-gfw]");
      if (b) addGfw(b.getAttribute("data-gfw"), b.getAttribute("data-title"), b);
    });
  }

  function loadGfw() {
    if (gfw.list || gfw.loading) return;
    gfw.loading = true;
    status("catGfwStatus", "Loading the GFW catalog…", true);
    var all = [];
    function page(n) {
      return getJSON(GFW_API + "/datasets?page[size]=100&page[number]=" + n).then(function (j) {
        all = all.concat(j.data || []);
        if (j.meta && n < j.meta.total_pages) return page(n + 1);
      });
    }
    page(1).then(function () {
      gfw.list = all.map(function (d) {
        var m = d.metadata || {};
        return { id: d.dataset, title: m.title || nice(d.dataset), source: m.source || "", updated: d.updated_on || "" };
      }).sort(function (a, b) { return a.title.localeCompare(b.title); });
      status("catGfwStatus", "");
      renderGfw();
    }).catch(function (e) { status("catGfwStatus", "Could not load GFW: " + e.message, false); })
      .then(function () { gfw.loading = false; });
  }

  var GFW_FEATURED = /tree_cover_loss$|integrated_alerts|primary_forest|mangrove|peat|wdpa_protected|key_biodiversity|tree_cover_density_2010|burn|glad|radd|land_cover/;
  function renderGfw() {
    if (!gfw.list) return;
    var q = $("catGfwFilter").value.trim().toLowerCase();
    var rows = gfw.list.filter(function (d) { return !q || (d.title + " " + d.id + " " + d.source).toLowerCase().indexOf(q) >= 0; });
    if (!q) rows = rows.filter(function (d) { return GFW_FEATURED.test(d.id); }).concat([{ note: true }]);
    $("catGfwList").innerHTML = rows.map(function (d) {
      if (d.note) return '<div class="gis-empty">Showing featured datasets · type to search all ' + gfw.list.length + "</div>";
      return '<button class="cat-item" data-gfw="' + esc(d.id) + '" data-title="' + esc(d.title) + '"><span class="material-symbols-outlined">forest</span><span class="cat-name">' + esc(d.title) +
        '<small>' + esc(d.id) + "</small></span></button>";
    }).join("") || '<div class="gis-empty">No dataset matches</div>';
  }

  function addGfw(id, title, btn) {
    status("catGfwStatus", "Adding " + title + "…", true);
    btn.disabled = true;
    getJSON(GFW_API + "/dataset/" + id + "/latest").then(function (j) {
      var v = j.data.version;
      return getJSON(GFW_API + "/dataset/" + id + "/" + v + "/assets?page[size]=100").then(function (a) {
        var assets = a.data || [], types = assets.map(function (x) { return x.asset_type; });
        var vec = assets.filter(function (x) { return /vector tile cache/i.test(x.asset_type); });
        var rasterCache = assets.filter(function (x) { return /raster tile cache/i.test(x.asset_type) && /\{z\}/.test(x.asset_uri); })[0];
        enter();
        if (vec.length) {
          var u = (vec.filter(function (x) { return /dynamic/.test(x.asset_uri); })[0] || vec[0]).asset_uri;
          GIS.addMVT(u, id, title + " (" + v + ")", "Global Forest Watch");
        } else if (rasterCache || types.some(function (t) { return /raster tile set|cog/i.test(t); })) {
          var url = rasterCache ? rasterCache.asset_uri : "https://tiles.globalforestwatch.org/" + id + "/" + v + "/dynamic/{z}/{x}/{y}.png";
          GIS.addXYZ(url, title + " (" + v + ")", "Global Forest Watch");
          GIS.move(GIS.layers[GIS.layers.length - 1].id, 0);
        } else throw new Error("this dataset is a table, not a map layer");
        status("catGfwStatus", "Added " + title + " (" + v + ").", true);
      });
    }).catch(function (e) { status("catGfwStatus", title + ": " + e.message, false); })
      .then(function () { btn.disabled = false; });
  }

  // The GFW panel (js/gis/19-gfw.js) hosts the dataset list.
  GIS.gfwCatalog = { load: loadGfw, add: addGfw, api: GFW_API };

  /* ---------------------------------------------------------- species */

  var bio = { src: "gbif", taxon: null, timer: 0 };
  var QUAL = {
    gbif: [["HUMAN_OBSERVATION,OBSERVATION,MACHINE_OBSERVATION", "Observations"], ["PRESERVED_SPECIMEN,MATERIAL_SAMPLE,LIVING_SPECIMEN", "Specimens"], ["", "All records"]],
    inat: [["research", "Research grade"], ["research,needs_id", "Research + needs ID"], ["", "Any quality"]]
  };

  function wireBio() {
    var pane = document.querySelector('.cat-pane[data-pane="bio"]');
    pane.querySelector(".toggle-group").addEventListener("click", function (e) {
      var b = e.target.closest("[data-src]");
      if (!b) return;
      bio.src = b.dataset.src; bio.taxon = null;
      Array.prototype.forEach.call(pane.querySelectorAll("[data-src]"), function (x) { x.classList.toggle("active", x === b); });
      $("catPicked").innerHTML = ""; $("catTaxon").value = "";
      syncBio();
    });
    $("catTaxon").addEventListener("input", function () {
      clearTimeout(bio.timer);
      var q = this.value.trim();
      if (q.length < 2) { $("catTaxonList").innerHTML = ""; return; }
      bio.timer = setTimeout(function () { suggest(q); }, 250);
    });
    $("catTaxonList").addEventListener("mousedown", function (e) {
      var it = e.target.closest("[data-key]");
      if (!it) return;
      e.preventDefault();
      bio.taxon = { key: it.dataset.key, name: it.dataset.name, rank: it.dataset.rank };
      $("catTaxon").value = it.dataset.name;
      $("catTaxonList").innerHTML = "";
      $("catPicked").innerHTML = '<span class="material-symbols-outlined">check_circle</span>' + esc(it.dataset.name) + " <em>" + esc(it.dataset.rank || "") + "</em>";
    });
    $("catTaxon").addEventListener("blur", function () { setTimeout(function () { $("catTaxonList").innerHTML = ""; }, 150); });
    $("catArea").addEventListener("change", function () { $("catCountry").style.display = this.value === "country" ? "" : "none"; });
    $("catFetch").addEventListener("click", fetchOccurrences);
    $("catDensity").addEventListener("click", addDensity);
    syncBio();
  }

  function syncBio() {
    $("catQual").innerHTML = QUAL[bio.src].map(function (q) { return '<option value="' + q[0] + '">' + q[1] + "</option>"; }).join("");
    $("catDensity").style.display = bio.src === "gbif" ? "" : "none";
    // GBIF filters by ISO code, iNaturalist by place (looked up by name).
    var c = $("catCountry");
    c.placeholder = bio.src === "gbif" ? "ISO code, e.g. ID" : "Country name, e.g. Indonesia";
    c.value = bio.src === "gbif" ? "ID" : "Indonesia";
    $("catFetch").lastChild.textContent = bio.src === "gbif" ? "Add occurrences" : "Add observations";
  }

  function suggest(q) {
    var url = bio.src === "gbif"
      ? "https://api.gbif.org/v1/species/suggest?limit=10&q=" + encodeURIComponent(q)
      : "https://api.inaturalist.org/v1/taxa/autocomplete?per_page=10&q=" + encodeURIComponent(q);
    getJSON(url).then(function (j) {
      var rows = bio.src === "gbif"
        // Accepted names first; doubtful names and synonyms are labelled
        // (searching an accepted key also returns its synonyms' records).
        ? (j || []).map(function (t) {
            var st = (t.status || "").toLowerCase().replace(/_/g, " ");
            return { key: t.key, name: t.scientificName, rank: (t.rank || "").toLowerCase() + (st && st !== "accepted" ? " · " + st : ""),
              ok: st === "accepted", extra: [t.family, t.kingdom].filter(Boolean).join(" · ") };
          }).sort(function (a, b) { return (b.ok ? 1 : 0) - (a.ok ? 1 : 0); })
        : (j.results || []).map(function (t) { return { key: t.id, name: t.name, rank: t.rank, extra: [t.preferred_common_name, t.observations_count ? t.observations_count.toLocaleString("en-US") + " obs." : ""].filter(Boolean).join(" · ") }; });
      $("catTaxonList").innerHTML = rows.map(function (r) {
        return '<div class="cat-ac-item" data-key="' + r.key + '" data-name="' + esc(r.name) + '" data-rank="' + esc(r.rank) + '"><b>' + esc(r.name) + "</b> <em>" + esc(r.rank) + "</em><small>" + esc(r.extra) + "</small></div>";
      }).join("");
    }).catch(function () { $("catTaxonList").innerHTML = ""; });
  }

  function viewBox() {
    var m = GIS.map();
    if (!m) return null;
    var b = m.getBounds();
    return { w: Math.max(-180, b.getWest()), s: Math.max(-90, b.getSouth()), e: Math.min(180, b.getEast()), n: Math.min(90, b.getNorth()) };
  }

  function fetchOccurrences() {
    if (!bio.taxon) { status("catBioStatus", "Pick a taxon from the list first.", false); return; }
    enter();
    var max = Math.max(10, Math.min(10000, parseInt($("catMax").value) || 1000));
    var y0 = $("catYear0").value, y1 = $("catYear1").value, area = $("catArea").value, qual = $("catQual").value;
    var box = area === "view" ? viewBox() : null, btn = $("catFetch");
    btn.disabled = true;
    var feats = [], sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var done;
    if (bio.src === "gbif") {
      var base = "https://api.gbif.org/v1/occurrence/search?hasCoordinate=true&hasGeospatialIssue=false&taxonKey=" + bio.taxon.key;
      if (box) base += "&decimalLatitude=" + box.s + "," + box.n + "&decimalLongitude=" + box.w + "," + box.e;
      if (area === "country") base += "&country=" + encodeURIComponent($("catCountry").value.trim().toUpperCase());
      if (y0 || y1) base += "&year=" + (y0 || "1600") + "," + (y1 || new Date().getFullYear());
      if (qual) qual.split(",").forEach(function (b) { base += "&basisOfRecord=" + b; });
      var page = function (off) {
        return getJSON(base + "&limit=300&offset=" + off).then(function (j) {
          (j.results || []).forEach(function (r) {
            feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [r.decimalLongitude, r.decimalLatitude] }, properties: {
              gbifID: r.key, scientificName: r.scientificName, species: r.species || null, family: r.family || null, eventDate: r.eventDate || null,
              year: r.year || null, basisOfRecord: r.basisOfRecord, country: r.countryCode || null, locality: r.locality || null,
              recordedBy: r.recordedBy || null, institution: r.institutionCode || null, dataset: r.datasetName || null,
              uncertainty_m: r.coordinateUncertaintyInMeters || null, license: r.license || null, url: "https://www.gbif.org/occurrence/" + r.key } });
          });
          status("catBioStatus", "Downloading… " + feats.length + " / " + Math.min(max, j.count), true);
          if (!j.endOfRecords && feats.length < max && (j.results || []).length) return page(off + 300);
        });
      };
      done = page(0);
    } else {
      var ibase = "https://api.inaturalist.org/v1/observations?geo=true&per_page=200&order_by=id&order=desc&taxon_id=" + bio.taxon.key;
      if (box) ibase += "&swlat=" + box.s + "&swlng=" + box.w + "&nelat=" + box.n + "&nelng=" + box.e;
      var placeLookup = area === "country"
        ? getJSON("https://api.inaturalist.org/v1/places/autocomplete?per_page=10&q=" + encodeURIComponent($("catCountry").value.trim())).then(function (j) {
            var pl = (j.results || []).filter(function (x) { return x.admin_level === 0; })[0] || (j.results || [])[0];
            if (!pl) throw new Error("place not found");
            ibase += "&place_id=" + pl.id;
          })
        : Promise.resolve();
      if (y0) ibase += "&d1=" + y0 + "-01-01";
      if (y1) ibase += "&d2=" + y1 + "-12-31";
      if (qual) ibase += "&quality_grade=" + qual;
      var ipage = function (idBelow) {
        return getJSON(ibase + (idBelow ? "&id_below=" + idBelow : "")).then(function (j) {
          var res = j.results || [];
          res.forEach(function (o) {
            if (!o.geojson) return;
            feats.push({ type: "Feature", geometry: o.geojson, properties: {
              inatID: o.id, scientificName: o.taxon ? o.taxon.name : null, commonName: o.taxon ? o.taxon.preferred_common_name || null : null,
              observedOn: o.observed_on || null, quality: o.quality_grade, observer: o.user ? o.user.login : null, place: o.place_guess || null,
              accuracy_m: o.positional_accuracy || null, obscured: !!o.obscured, license: o.license_code || null,
              photo: o.photos && o.photos[0] ? o.photos[0].url.replace("square", "medium") : null, url: o.uri || "https://www.inaturalist.org/observations/" + o.id } });
          });
          status("catBioStatus", "Downloading… " + feats.length + " / " + Math.min(max, j.total_results), true);
          // iNaturalist asks for about one request per second.
          if (res.length === 200 && feats.length < max) return sleep(1000).then(function () { return ipage(res[res.length - 1].id); });
        });
      };
      done = placeLookup.then(function () { return ipage(null); });
    }
    done.then(function () {
      feats = feats.slice(0, max);
      if (!feats.length) { status("catBioStatus", "No records found for this search.", false); return; }
      GIS.addVector({ type: "FeatureCollection", features: feats }, bio.taxon.name + (bio.src === "gbif" ? " (GBIF)" : " (iNaturalist)"));
      var l = GIS.active();
      l.attribution = bio.src === "gbif" ? "GBIF.org" : "iNaturalist";
      Object.assign(l.style, { pointRadius: 4.5, strokeColor: "#ffffff", strokeWidth: 0.8 });
      GIS.emit("style");
      status("catBioStatus", "Added " + feats.length + " records. Cite the data source(s) when you publish.", true);
    }).catch(function (e) { status("catBioStatus", "Download failed: " + e.message, false); })
      .then(function () { btn.disabled = false; });
  }

  function addDensity() {
    if (!bio.taxon) { status("catBioStatus", "Pick a taxon from the list first.", false); return; }
    enter();
    GIS.addXYZ("https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png?srs=EPSG:3857&style=classic.poly&bin=hex&hexPerTile=48&taxonKey=" + bio.taxon.key,
      bio.taxon.name + " — GBIF density", "GBIF.org");
    GIS.move(GIS.layers[GIS.layers.length - 1].id, 0);
    status("catBioStatus", "Added the GBIF density map.", true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();
