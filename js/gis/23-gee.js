/* ==========================================================================
   GIS — Google Earth Engine connector (the "Earth Engine" panel).

   Connect   Earth Engine needs the user's own Google Cloud project that is
             registered for Earth Engine, and one of:
               - Sign in with Google: an OAuth client ID (type "Web
                 application") from that project, with this app's address
                 as an authorised JavaScript origin;
               - an access token pasted from `gcloud auth print-access-token`
                 (valid about an hour).
             The project and client ID are remembered on this computer; a
             token only for this session. Nothing is filled in for the user.
   Recipes   one click for common datasets over the area of interest and
             dates: Sentinel-2 true color and NDVI (cloud-masked median),
             Landsat 8/9, Dynamic World, ESA WorldCover, JRC surface water,
             Hansen forest loss, SRTM hillshade, VIIRS night lights,
             Sentinel-1 VV, mangrove forests.
   Code      a small Code Editor: JavaScript with ee, Map.addLayer,
             Map.centerObject, Map.setCenter, print, and the variables aoi,
             start, end. Images become tile layers; Map.addLayer(fc,
             {asVector: true}) brings features in as a vector layer.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var EE_JS = "https://cdn.jsdelivr.net/npm/@google/earthengine@1.7.46/build/ee_api_js.js";
  var PANEL = "panel-gis-gee", K_PROJ = "ploots-gee-project", K_CLIENT = "ploots-gee-client", K_CODE = "ploots-gee-code";
  var ATTR = "Google Earth Engine";
  function $(id) { return document.getElementById(id); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function put(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { } }
  function toast(m) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(m); }

  var eeP = null, ready = false;
  function loadEE() {
    if (window.ee && ee.data) return Promise.resolve();
    if (!eeP) eeP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = EE_JS; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { eeP = null; rej(new Error("Could not load the Earth Engine library.")); };
      document.head.appendChild(s);
    });
    return eeP;
  }
  function init(project) {
    return new Promise(function (res, rej) {
      ee.initialize(null, null, function () { ready = true; res(); }, function (e) { rej(new Error(String(e && e.message || e))); }, null, project);
    });
  }
  function connect() {
    var project = $("geeProject").value.trim(), how = $("geeHow").value;
    if (!project) { status("Enter your Google Cloud project ID (registered for Earth Engine).", false); return; }
    put(K_PROJ, project);
    status("Connecting…", true);
    loadEE().then(function () {
      if (how === "token") {
        var tok = $("geeToken").value.trim();
        if (!tok) throw new Error("Paste an access token (gcloud auth print-access-token).");
        return new Promise(function (res) {
          ee.data.setAuthToken("", "Bearer", tok, 3600, [], function () { res(); }, false);
        }).then(function () { return init(project); });
      }
      var client = $("geeClient").value.trim();
      if (!client) throw new Error("Enter your OAuth client ID (Web application).");
      put(K_CLIENT, client);
      return new Promise(function (res, rej) {
        ee.data.authenticateViaOauth(client, function () { res(); }, function (e) { rej(new Error(String(e))); }, [], function () {
          ee.data.authenticateViaPopup(function () { res(); }, function (e) { rej(new Error(String(e))); });
        });
      }).then(function () { return init(project); });
    }).then(function () {
      status("Connected to Earth Engine (" + project + ").", true);
      $("geeWork").hidden = false;
    }).catch(function (e) { ready = false; status(e.message, false); });
  }
  function status(msg, ok) { var el = $("geeStatus"); el.style.display = msg ? "" : "none"; el.className = "status " + (ok === false ? "error" : "ok"); el.textContent = msg; }

  /* ------------------------------------------------------------ helpers */

  function aoiGeometry() {
    var src = $("geeArea").value;
    if (src !== "view") {
      var l = GIS.get(src), polys = [];
      if (l) l.data.features.forEach(function (f, i) { if (f.geometry && /Polygon/.test(f.geometry.type) && (!l.selection.size || l.selection.has(i))) polys.push(f.geometry); });
      if (polys.length) {
        var coords = [];
        polys.forEach(function (g) { if (g.type === "Polygon") coords.push(g.coordinates); else g.coordinates.forEach(function (p) { coords.push(p); }); });
        return ee.Geometry.MultiPolygon(coords);
      }
    }
    var b = GIS.map().getBounds();
    return ee.Geometry.Rectangle([b.getWest(), Math.max(-85, b.getSouth()), b.getEast(), Math.min(85, b.getNorth())]);
  }
  function out(text, err) {
    var o = $("geeOut");
    var line = document.createElement("div");
    line.className = err ? "err" : "";
    line.textContent = text;
    o.appendChild(line);
    o.scrollTop = o.scrollHeight;
  }
  function addLayer(obj, vis, name) {
    vis = vis || {}; name = name || "EE layer";
    if (vis.asVector) {
      out("Fetching " + name + " as features…");
      ee.FeatureCollection(obj).limit(vis.max || 5000).getInfo(function (fc, err) {
        if (err) { out(name + ": " + err, true); return; }
        try { var l = GIS.addVector(fc, name); l.attribution = ATTR; out(name + ": " + fc.features.length + " features added."); } catch (e) { out(name + ": " + e.message, true); }
      });
      return;
    }
    var img = obj;
    if (obj instanceof ee.FeatureCollection || (obj.name && /Feature/.test(obj.name()))) img = ee.FeatureCollection(obj).style({ color: vis.color || "ff5a1f", fillColor: (vis.color || "ff5a1f") + "33", width: vis.width || 1 });
    else if (obj instanceof ee.ImageCollection) img = obj.mosaic();
    var v = Object.assign({}, vis); delete v.asVector; delete v.color; delete v.width;
    ee.Image(img).getMapId(v, function (m, err) {
      if (err || !m) { out(name + ": " + (err || "no map"), true); return; }
      var url = m.urlFormat || ("https://earthengine.googleapis.com/map/" + m.mapid + "/{z}/{x}/{y}?token=" + m.token);
      var l = GIS.addXYZ(url, name, ATTR);
      GIS.move(l.id, 0);
      out(name + " added.");
    });
  }
  function centerObject(obj, zoom) {
    var g = obj && obj.geometry ? obj.geometry() : obj;
    ee.Geometry(g).bounds().getInfo(function (b, err) {
      if (err || !b) return;
      var c = b.coordinates[0], xs = c.map(function (p) { return p[0]; }), ys = c.map(function (p) { return p[1]; });
      var m = GIS.map();
      if (zoom) m.flyTo({ center: [(Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2], zoom: zoom });
      else m.fitBounds([[Math.min.apply(null, xs), Math.min.apply(null, ys)], [Math.max.apply(null, xs), Math.max.apply(null, ys)]], { padding: 40 });
    });
  }
  function printFn() {
    var args = Array.prototype.slice.call(arguments);
    args.forEach(function (a) {
      if (a && typeof a.getInfo === "function") a.getInfo(function (v, err) { out(err ? String(err) : JSON.stringify(v, null, 1).slice(0, 4000), !!err); });
      else out(typeof a === "string" ? a : JSON.stringify(a));
    });
  }
  function run(code) {
    if (!ready) { status("Connect first.", false); return; }
    $("geeOut").innerHTML = "";
    GIS.enterMapMode();
    var Map = { addLayer: addLayer, centerObject: centerObject, setCenter: function (lon, lat, z) { GIS.map().flyTo({ center: [lon, lat], zoom: z || GIS.map().getZoom() }); } };
    try {
      var fn = new Function("ee", "Map", "print", "aoi", "start", "end", code);
      fn(ee, Map, printFn, aoiGeometry(), $("geeStart").value, $("geeEnd").value);
    } catch (e) { out(e.message, true); }
  }

  /* ------------------------------------------------------------ recipes */

  var S2MASK = "function mask(i){var q=i.select('QA60');return i.updateMask(q.bitwiseAnd(1<<10).eq(0).and(q.bitwiseAnd(1<<11).eq(0))).divide(10000);}\n";
  var RECIPES = [
    ["s2rgb", "Sentinel-2 true color (median)", S2MASK + "var s2=ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(aoi).filterDate(start,end).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',40)).map(mask).median().clip(aoi);\nMap.addLayer(s2,{bands:['B4','B3','B2'],min:0,max:0.3},'Sentinel-2 RGB '+start+' – '+end);"],
    ["s2ndvi", "Sentinel-2 NDVI", S2MASK + "var s2=ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(aoi).filterDate(start,end).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',40)).map(mask).median().clip(aoi);\nvar ndvi=s2.normalizedDifference(['B8','B4']).rename('NDVI');\nMap.addLayer(ndvi,{min:-0.2,max:0.9,palette:['#8c510a','#d8b365','#f6e8c3','#c7eae5','#5ab4ac','#1a9850','#00441b']},'NDVI '+start+' – '+end);\nprint(ndvi.reduceRegion({reducer:ee.Reducer.mean(),geometry:aoi,scale:30,maxPixels:1e9}));"],
    ["landsat", "Landsat 8/9 true color", "function sc(i){return i.select('SR_B.').multiply(0.0000275).add(-0.2).updateMask(i.select('QA_PIXEL').bitwiseAnd(1<<3).eq(0));}\nvar ls=ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')).filterBounds(aoi).filterDate(start,end).map(sc).median().clip(aoi);\nMap.addLayer(ls,{bands:['SR_B4','SR_B3','SR_B2'],min:0,max:0.3},'Landsat RGB '+start+' – '+end);"],
    ["dw", "Dynamic World land cover", "var dw=ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1').filterBounds(aoi).filterDate(start,end).select('label').mode().clip(aoi);\nMap.addLayer(dw,{min:0,max:8,palette:['419bdf','397d49','88b053','7a87c6','e49635','dfc35a','c4281b','a59b8f','b39fe1']},'Dynamic World '+start+' – '+end);"],
    ["worldcover", "ESA WorldCover 2021 (10 m)", "var wc=ee.ImageCollection('ESA/WorldCover/v200').first().clip(aoi);\nMap.addLayer(wc,{bands:['Map']},'ESA WorldCover 2021');"],
    ["water", "JRC surface water occurrence", "var w=ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence').clip(aoi);\nMap.addLayer(w,{min:0,max:100,palette:['ffffff','ffbbbb','0000ff']},'Surface water occurrence (JRC)');"],
    ["hansen", "Hansen forest loss year", "var g=ee.Image('UMD/hansen/global_forest_change_2024_v1_12');\nvar loss=g.select('lossyear').selfMask().clip(aoi);\nMap.addLayer(loss,{min:1,max:24,palette:['ffff00','ff8800','ff0000']},'Forest loss year (Hansen)');"],
    ["srtm", "SRTM elevation and hillshade", "var dem=ee.Image('USGS/SRTMGL1_003').clip(aoi);\nMap.addLayer(ee.Terrain.hillshade(dem),{min:100,max:255},'SRTM hillshade');\nMap.addLayer(dem,{min:0,max:3000,palette:['006600','99cc66','ffcc66','996633','ffffff'],opacity:0.5},'SRTM elevation');"],
    ["viirs", "VIIRS night lights", "var n=ee.ImageCollection('NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG').filterDate(start,end).select('avg_rad').median().clip(aoi);\nMap.addLayer(n,{min:0,max:40,palette:['000000','3b0f70','fe9f6d','fcfdbf']},'VIIRS night lights '+start+' – '+end);"],
    ["s1", "Sentinel-1 VV (radar)", "var s1=ee.ImageCollection('COPERNICUS/S1_GRD').filterBounds(aoi).filterDate(start,end).filter(ee.Filter.listContains('transmitterReceiverPolarisation','VV')).select('VV').median().clip(aoi);\nMap.addLayer(s1,{min:-25,max:0},'Sentinel-1 VV '+start+' – '+end);"],
    ["mangrove", "Mangrove forests (Giri, 2000)", "var m=ee.ImageCollection('LANDSAT/MANGROVE_FORESTS').first().clip(aoi);\nMap.addLayer(m,{palette:['d40115']},'Mangrove forests 2000 (Giri)');"]
  ];

  /* ----------------------------------------------------------------- UI */

  function build() {
    if ($(PANEL)) return;
    var p = document.createElement("div");
    p.id = PANEL;
    p.className = "sidebar-panel";
    var today = new Date().toISOString().slice(0, 10), yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    p.innerHTML =
      '<div class="sp-head"><span class="sp-title">Google Earth Engine</span><button type="button" class="sp-close" title="Close panel">' + sym("keyboard_double_arrow_left") + "</button></div>" +
      '<div class="gee-body">' +
        '<label class="field-label">Cloud project ID</label><input type="text" id="geeProject" placeholder="my-ee-project" value="' + esc(get(K_PROJ)) + '">' +
        '<label class="field-label">Sign-in</label><select id="geeHow"><option value="oauth">Sign in with Google (OAuth client ID)</option><option value="token">Access token (gcloud)</option></select>' +
        '<div id="geeOauthWrap"><label class="field-label">OAuth client ID (Web application)</label><input type="text" id="geeClient" placeholder="…apps.googleusercontent.com" value="' + esc(get(K_CLIENT)) + '">' +
          '<p class="gfw-note">Authorised JavaScript origin: <code>' + esc(location.origin) + "</code></p></div>" +
        '<div id="geeTokenWrap" hidden><label class="field-label">Access token</label><input type="password" id="geeToken" placeholder="ya29.…" autocomplete="off">' +
          '<p class="gfw-note">From <code>gcloud auth print-access-token</code>. Kept only for this session.</p></div>' +
        '<button id="geeConnect" class="btn-primary" style="width:100%;margin-top:10px;">' + sym("link") + "Connect</button>" +
        '<p class="status" id="geeStatus" style="display:none;"></p>' +
        '<div id="geeWork" hidden>' +
          '<div class="gfw-sub">' + sym("crop_free") + "Area and dates</div>" +
          '<select id="geeArea"></select>' +
          '<div class="num-pair"><div><label class="field-label">Start</label><input type="date" id="geeStart" value="' + yearAgo + '"></div><div><label class="field-label">End</label><input type="date" id="geeEnd" value="' + today + '"></div></div>' +
          '<div class="gfw-sub">' + sym("auto_awesome") + "Recipes</div>" +
          '<div class="gee-recipes">' + RECIPES.map(function (r) { return '<button type="button" data-r="' + r[0] + '">' + esc(r[1]) + "</button>"; }).join("") + "</div>" +
          '<div class="gfw-sub">' + sym("code") + "Code</div>" +
          '<select id="geeExample"><option value="">Load an example…</option>' + RECIPES.map(function (r) { return '<option value="' + r[0] + '">' + esc(r[1]) + "</option>"; }).join("") + "</select>" +
          '<textarea id="geeCode" spellcheck="false" placeholder="// ee, Map.addLayer, Map.centerObject, print, aoi, start, end">' + esc(get(K_CODE)) + "</textarea>" +
          '<button id="geeRun" class="btn-primary" style="width:100%;margin-top:6px;">' + sym("play_arrow") + "Run (Ctrl+Enter)</button>" +
          '<div class="gee-out" id="geeOut"></div>' +
        "</div>" +
        '<p class="gfw-foot">Earth Engine use follows Google\'s Earth Engine terms for your project (non-commercial or licensed).</p>' +
      "</div>";
    document.querySelector(".sidebar").appendChild(p);
    p.querySelector(".sp-close").addEventListener("click", function () { window.closeSidebar(); });
    $("geeHow").addEventListener("change", function () { var t = this.value === "token"; $("geeTokenWrap").hidden = !t; $("geeOauthWrap").hidden = t; });
    $("geeConnect").addEventListener("click", connect);
    p.querySelector(".gee-recipes").addEventListener("click", function (e) {
      var b = e.target.closest("[data-r]");
      if (!b) return;
      var r = RECIPES.filter(function (x) { return x[0] === b.dataset.r; })[0];
      run(r[2]);
    });
    $("geeExample").addEventListener("change", function () { var r = RECIPES.filter(function (x) { return x[0] === this.value; }, this)[0]; if (r) { $("geeCode").value = r[2]; put(K_CODE, r[2]); } this.value = ""; });
    $("geeCode").addEventListener("input", function () { put(K_CODE, this.value); });
    $("geeCode").addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(this.value); }
      if (e.key === "Tab") { e.preventDefault(); var s = this.selectionStart; this.setRangeText("  ", s, this.selectionEnd, "end"); }
    });
    $("geeRun").addEventListener("click", function () { run($("geeCode").value); });
    function fillArea() {
      var s = $("geeArea"), polys = GIS.layers.filter(function (l) { return l.kind === "vector" && GIS.geometryKind(l) === "polygon"; });
      s.innerHTML = '<option value="view">Area: current map view</option>' + polys.map(function (l) { return '<option value="' + l.id + '">Area: ' + esc(l.name) + (l.selection.size ? " (selected)" : "") + "</option>"; }).join("");
    }
    GIS.on("layers", fillArea);
    fillArea();

    var nav = document.querySelector(".sidebar-nav"), rb = document.createElement("button");
    rb.className = "nav-btn nav-gis nav-gee";
    rb.setAttribute("data-panel", PANEL);
    rb.title = "Google Earth Engine";
    rb.innerHTML = sym("satellite_alt") + '<span class="nav-lbl">GEE</span>';
    var gfw = nav.querySelector('[data-panel="panel-gis-gfw"]');
    if (gfw) gfw.after(rb); else nav.appendChild(rb);
    rb.addEventListener("click", function () { if (rb.classList.contains("active")) window.closeSidebar(); else { GIS.enterMapMode(); fillArea(); activateSidebarPanel(PANEL); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(build, 80); }); else setTimeout(build, 80);

  GIS.gee = { run: run, connected: function () { return ready; } };
})();
