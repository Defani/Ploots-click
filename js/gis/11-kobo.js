/* ==========================================================================
   GIS — KoboToolbox connector and monitoring dashboard.

   Panel ("Kobo" in the rail, map mode): server, API token, access path
   (local proxy or direct), form list, auto-refresh, field mapping and QC
   thresholds.

   Dashboard (full-screen, tabs):
     Overview     KPIs, submissions per day stacked by enumerator, an
                  enumerator × day matrix (who submitted what, each day),
                  today's status per enumerator and a live feed.
     Enumerators  per-enumerator recap: totals, active days, average per day,
                  interview duration, GPS coverage and accuracy, distance
                  walked, QC flags.
     Recap        every question: choice counts, numeric statistics and a
                  histogram; a per-village table.
     Route        animated routes per enumerator for one day, on its own map:
                  play / pause / speed / timeline, arrival bubbles and feed.
                  New submissions animate in while the dashboard refreshes.
     Data         the submissions table, search, CSV export, add to the map.

   Why a proxy: the Kobo API only answers CORS requests from its own sites,
   so a browser page cannot read it directly. tools/kobo_proxy.py forwards
   read-only API calls with the token (see README). "Direct" works for a
   self-hosted Kobo that allows this site's origin. The desktop app has a
   built-in access path (the kobo_get command in desktop/src-tauri), so it
   needs no proxy.

   window.PlootsKobo.api mirrors the GeoLibre Kobo Connector data API
   (summary, fields, rows, aggregate, load), so Claude can answer from the
   real submissions through the MCP bridge (10-bridge.js).
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var PANEL_ID = "panel-kobo";
  var DESKTOP = !!(window.__TAURI__ && window.__TAURI__.core);
  var STORE = "ploots-kobo";
  var SERVERS = [
    ["https://kf.kobotoolbox.org", "Global (kf.kobotoolbox.org)"],
    ["https://eu.kobotoolbox.org", "EU (eu.kobotoolbox.org)"],
    ["https://kobo.humanitarianresponse.info", "Humanitarian (OCHA)"],
    ["https://demo.kobo.local", "Demo form (proxy with --demo)"],
    ["custom", "Other server…"]
  ];
  var PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#65a30d", "#7c3aed", "#b45309", "#0f766e", "#be123c"];
  var HINTS = {
    enumerator: ["nama_enumerator", "enumerator", "nama_surveyor", "surveyor", "interviewer", "enumerator_name"],
    name: ["a1_nama", "nama_petani", "nama_responden", "nama_pemilik", "respondent_name", "farmer_name", "name"],
    desa: ["kampung", "desa", "gampong", "village", "kelurahan"],
    luas: ["a14_luas_hektar", "luas_hektar", "luas_lahan", "luas", "area_ha", "farm_area"],
    date: ["tgl_survei", "tanggal_wawancara", "tanggal", "survey_date", "interview_date", "today"]
  };
  var META = { start: 1, end: 1, today: 1, deviceid: 1, username: 1, phonenumber: 1, audit: 1 };
  var SKIP = { begin_group: 1, end_group: 1, begin_repeat: 1, end_repeat: 1, note: 1, start: 1, end: 1, today: 1, deviceid: 1, username: 1,
    phonenumber: 1, subscriberid: 1, simserial: 1, audit: 1, geopoint: 1, geoshape: 1, geotrace: 1, image: 1, audio: 1, video: 1, file: 1, calculate: 1 };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function fmt(n, d) { return n == null || !isFinite(n) ? "—" : (+n).toLocaleString("en-US", { maximumFractionDigits: d == null ? 0 : d }); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function localDate(t) { var d = new Date(t); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function hm(t) { var d = new Date(t); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function today() { return localDate(Date.now()); }
  function addDays(day, n) { var d = new Date(day + "T12:00:00"); d.setDate(d.getDate() + n); return localDate(d.getTime()); }
  function dayLabel(day) { var d = new Date(day + "T12:00:00"); return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
  function ago(t) {
    var s = Math.max(0, (Date.now() - t) / 1000);
    return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago";
  }
  // Kobo sends _submission_time in UTC without a zone; start/end carry one.
  function parseTime(v) {
    if (v == null || v === "") return null;
    var s = String(v);
    if (/^\d{4}-\d\d-\d\dT[\d:.]+$/.test(s)) s += "Z";
    var t = Date.parse(s);
    return isFinite(t) ? t : null;
  }
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var n = Number(String(v).replace(",", ".").trim());
    return isFinite(n) ? n : null;
  }
  function haversine(a, b) {
    var R = 6371008.8, r = Math.PI / 180, dl = (b[1] - a[1]) * r, dn = (b[0] - a[0]) * r;
    var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dn / 2) * Math.sin(dn / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ------------------------------------------------------------ state */

  var K = window.PlootsKobo = {
    cfg: loadCfg(),
    token: "",
    assets: [],
    asset: null,          // { uid, name, content }
    questions: new Map(), // name -> { name, type, label, list, xpath }
    choices: {},          // list -> { code: label }
    rows: [],             // flattened submissions, each with .__ (analysis)
    fm: {},               // field mapping in use
    filter: { from: "", to: "", enumerator: "" },
    lastFetch: 0,
    lastNew: [],
    busy: false,
    listeners: []
  };
  K.on = function (fn) { K.listeners.push(fn); };
  function emit(evt) { K.listeners.forEach(function (fn) { try { fn(evt); } catch (e) { console.error(e); } }); }

  function loadCfg() {
    var c = { server: SERVERS[0][0], custom: "", access: "proxy", proxy: "http://127.0.0.1:8767", remember: false, refreshMin: 5,
      map: {}, minDur: 10, maxAcc: 20, assetUid: "" };
    try { Object.assign(c, JSON.parse(localStorage.getItem(STORE) || "{}")); } catch (e) { }
    if (DESKTOP && !c.accessChosen) c.access = "app";
    if (!DESKTOP && c.access === "app") c.access = "proxy";
    return c;
  }
  function saveCfg() {
    try {
      localStorage.setItem(STORE, JSON.stringify(K.cfg));
      if (K.cfg.remember && K.token) localStorage.setItem(STORE + ":token", K.token);
      else localStorage.removeItem(STORE + ":token");
    } catch (e) { }
  }
  try { K.token = localStorage.getItem(STORE + ":token") || ""; } catch (e) { }
  function server() { return (K.cfg.server === "custom" ? K.cfg.custom : K.cfg.server).replace(/\/+$/, ""); }

  /* -------------------------------------------------------------- API */

  function request(url) {
    var p;
    // Desktop app: the request is made natively (no CORS, no proxy). The
    // demo form only exists in the Python proxy.
    if (K.cfg.access === "app" && DESKTOP && !/\/\/demo\.kobo\.local\//.test(url)) {
      return window.__TAURI__.core.invoke("kobo_get", { url: url, token: K.token || null }).then(function (r) {
        var j = {};
        try { j = JSON.parse(r.body || "{}"); } catch (e) { }
        if (r.status === 401 || r.status === 403 && !j.detail) throw new Error("The server rejected the API token.");
        if (r.status < 200 || r.status >= 300) throw new Error(j.detail || "HTTP " + r.status);
        return j;
      }, function (e) { throw new Error(String(e && e.message || e)); });
    }
    if (K.cfg.access === "proxy" || K.cfg.access === "app") {
      var base = K.cfg.proxy.replace(/\/+$/, "");
      p = fetch(base + "/kobo?url=" + encodeURIComponent(url), { headers: K.token ? { "X-Kobo-Token": K.token } : {} })
        .catch(function () { throw new Error("The Kobo proxy at " + base + " is not running. Start it with: python tools/kobo_proxy.py"); });
    } else {
      p = fetch(url, { headers: K.token ? { Authorization: "Token " + K.token } : {} })
        .catch(function () { throw new Error("The Kobo server refused a direct browser request (CORS). Use the local proxy."); });
    }
    return p.then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 || r.status === 403 && !j.detail) throw new Error("The server rejected the API token.");
        if (!r.ok) throw new Error(j.detail || "HTTP " + r.status);
        return j;
      });
    });
  }
  function apiUrl(path, q) {
    var qs = Object.keys(q || {}).map(function (k) { return k + "=" + encodeURIComponent(typeof q[k] === "object" ? JSON.stringify(q[k]) : q[k]); }).join("&");
    return server() + path + (qs ? "?" + qs : "");
  }
  K.checkProxy = function () {
    return fetch(K.cfg.proxy.replace(/\/+$/, "") + "/health").then(function (r) { return r.json(); });
  };

  K.connect = function () {
    setBusy(true, "Connecting…");
    return request(apiUrl("/api/v2/assets/", { format: "json", asset_type: "survey", limit: 300 })).then(function (j) {
      K.connected = true;
      K.assets = (j.results || []).filter(function (a) { return a.asset_type === "survey" || !a.asset_type; })
        .sort(function (a, b) { return String(b.date_modified || "").localeCompare(String(a.date_modified || "")); });
      setBusy(false, K.assets.length + " form" + (K.assets.length === 1 ? "" : "s"), true);
      saveCfg();
      emit("assets");
      return K.assets;
    }).catch(function (e) { setBusy(false, e.message, false); throw e; });
  };

  K.openAsset = function (uid) {
    setBusy(true, "Reading the form…");
    return request(apiUrl("/api/v2/assets/" + uid + "/", { format: "json" })).then(function (a) {
      K.asset = { uid: a.uid, name: a.name, content: a.content || {} };
      K.cfg.assetUid = a.uid;
      readForm(a.content || {});
      K.rows = [];
      saveCfg();
      return K.fetch(true);
    }).catch(function (e) { setBusy(false, e.message, false); throw e; });
  };

  function label(l) { return Array.isArray(l) ? (l.filter(Boolean)[0] || "") : (l || ""); }
  function readForm(content) {
    K.questions = new Map();
    K.choices = {};
    (content.choices || []).forEach(function (c) { (K.choices[c.list_name] = K.choices[c.list_name] || {})[c.name] = label(c.label) || c.name; });
    (content.survey || []).forEach(function (q) {
      if (!q.name || /^end_/.test(q.type)) return;
      var type = String(q.type || "").split(" ")[0];
      K.questions.set(q.name, { name: q.name, type: type, label: label(q.label) || q.name, list: q.select_from_list_name || (String(q.type).split(" ")[1] || null), xpath: q.$xpath || q.name });
    });
    K.fm = autoMap();
  }
  function autoMap() {
    var q = K.questions, m = K.cfg.map[K.asset && K.asset.uid] || {};
    function first(list) { return list.filter(function (n) { return q.has(n); })[0] || null; }
    var geos = Array.from(q.values()).filter(function (x) { return x.type === "geopoint"; }).map(function (x) { return x.name; });
    return {
      enumerator: m.enumerator !== undefined ? m.enumerator : first(HINTS.enumerator) || "",
      name: m.name !== undefined ? m.name : first(HINTS.name) || "",
      desa: m.desa !== undefined ? m.desa : first(HINTS.desa) || "",
      luas: m.luas !== undefined ? m.luas : first(HINTS.luas) || "",
      date: m.date !== undefined ? m.date : first(HINTS.date) || "",
      geo: m.geo !== undefined ? m.geo : geos[0] || ""
    };
  }
  K.setMapping = function (key, field) {
    if (!K.asset) return;
    var all = K.cfg.map[K.asset.uid] = K.cfg.map[K.asset.uid] || {};
    all[key] = field;
    K.fm = autoMap();
    saveCfg();
    K.rows.forEach(analyze);
    emit("data");
  };

  // All submissions on the first fetch; after that only new ones (by
  // submission time), merged by _id.
  K.fetch = function (full) {
    if (!K.asset) return Promise.reject(new Error("Choose a form first."));
    if (K.busy && !full) return Promise.resolve([]);
    var since = null;
    if (!full && K.rows.length) since = K.rows.reduce(function (m, r) { return r._submission_time > m ? r._submission_time : m; }, "");
    var q = { format: "json", limit: 1000, sort: { _submission_time: 1 } };
    if (since) q.query = { _submission_time: { $gte: since } };
    setBusy(true, full ? "Loading submissions…" : "Checking for new submissions…");
    var got = [];
    function page(url) {
      return request(url).then(function (j) {
        got = got.concat(j.results || []);
        if (full) setBusy(true, "Loading submissions… " + fmt(got.length) + (j.count ? " of " + fmt(j.count) : ""));
        if (j.next && got.length < 50000) return page(j.next);
      });
    }
    return page(apiUrl("/api/v2/assets/" + K.asset.uid + "/data/", q)).then(function () {
      var byId = new Map(K.rows.map(function (r) { return [String(r._id), r]; })), fresh = [];
      got.forEach(function (raw) {
        var r = flatten(raw), id = String(r._id);
        if (!byId.has(id)) fresh.push(r);
        byId.set(id, r);
        analyze(r);
      });
      K.rows = Array.from(byId.values()).sort(function (a, b) { return a.__.t - b.__.t; });
      K.lastFetch = Date.now();
      K.lastNew = full ? [] : fresh;
      if (full && !K.filter.from) initFilter();
      setBusy(false, fmt(K.rows.length) + " submissions" + (fresh.length && !full ? " · " + fresh.length + " new" : ""), true);
      emit(full ? "data" : "refresh");
      return fresh;
    }).catch(function (e) { setBusy(false, e.message, false); throw e; });
  };

  function initFilter() {
    var days = K.rows.map(function (r) { return r.__.day; }).filter(Boolean).sort();
    K.filter.to = today() > (days[days.length - 1] || "") ? today() : days[days.length - 1];
    K.filter.from = days.length ? (days[0] > addDays(K.filter.to, -29) ? days[0] : addDays(K.filter.to, -13)) : addDays(today(), -13);
  }

  function flatten(raw) {
    var o = {};
    Object.keys(raw).forEach(function (k) {
      var key = k.charAt(0) === "_" ? k : k.split("/").pop();
      o[key] = raw[k];
    });
    return o;
  }

  function display(rec, name) {
    var q = K.questions.get(name), v = rec[name];
    if (v === undefined || v === null || v === "") return "";
    if (q && q.list && K.choices[q.list]) {
      var ch = K.choices[q.list];
      if (q.type === "select_multiple") return String(v).split(/\s+/).map(function (c) { return ch[c] || c; }).join(", ");
      return ch[v] || v;
    }
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  K.display = display;
  K.label = function (name) { var q = K.questions.get(name); return q ? q.label : name; };

  function parseGeo(rec) {
    var g = K.fm.geo ? rec[K.fm.geo] : null;
    if (typeof g === "string" && g.trim()) {
      var p = g.trim().split(/\s+/).map(Number);
      if (isFinite(p[0]) && isFinite(p[1]) && !(p[0] === 0 && p[1] === 0)) return { lat: p[0], lon: p[1], acc: isFinite(p[3]) ? p[3] : null };
    }
    var gl = rec._geolocation;
    if (Array.isArray(gl) && gl[0] != null && gl[1] != null) return { lat: +gl[0], lon: +gl[1], acc: null };
    return null;
  }
  function areaHa(rec) {
    var f = K.fm.luas;
    if (!f) return null;
    var v = num(rec[f]);
    if (v === null) return null;
    if (/rante/i.test(f)) return v * 0.04;
    if (/m2|meter/i.test(f)) return v / 10000;
    return v;
  }

  // Everything the dashboard needs about one submission, computed once.
  function analyze(r) {
    var fm = K.fm, a = {};
    var who = fm.enumerator ? display(r, fm.enumerator) : "";
    a.enumerator = (who || r._submitted_by || "(unknown)").trim().replace(/\s+/g, " ");
    a.desa = fm.desa ? display(r, fm.desa) : "";
    a.name = fm.name ? display(r, fm.name) : "";
    a.t = parseTime(r._submission_time) || 0;
    a.start = parseTime(r.start);
    a.end = parseTime(r.end);
    a.dur = a.start && a.end ? (a.end - a.start) / 60000 : null;
    var d = fm.date && r[fm.date] ? String(r[fm.date]).slice(0, 10) : "";
    a.day = /^\d{4}-\d\d-\d\d$/.test(d) ? d : localDate(a.start || a.t);
    a.subDay = localDate(a.t);
    a.at = a.end || a.t; // when the interview happened (route order)
    var g = parseGeo(r);
    a.lon = g ? g.lon : null; a.lat = g ? g.lat : null; a.acc = g ? g.acc : null;
    a.luas = areaHa(r);
    var v = r._validation_status;
    a.valid = v && typeof v === "object" ? v.label || "" : v || "";
    a.flags = [];
    if (a.dur !== null && a.dur < K.cfg.minDur) a.flags.push("Short interview (" + fmt(a.dur, 1) + " min)");
    if (a.dur !== null && a.dur > 240) a.flags.push("Long interview (" + fmt(a.dur / 60, 1) + " h)");
    if (!g) a.flags.push("No GPS");
    else if (a.acc !== null && K.cfg.maxAcc > 0 && a.acc > K.cfg.maxAcc) a.flags.push("GPS accuracy " + fmt(a.acc, 1) + " m");
    r.__ = a;
    return a;
  }
  K.reanalyze = function () { K.rows.forEach(analyze); emit("data"); };

  function filtered() {
    var f = K.filter;
    return K.rows.filter(function (r) {
      var a = r.__;
      return (!f.from || a.day >= f.from) && (!f.to || a.day <= f.to) && (!f.enumerator || a.enumerator === f.enumerator);
    });
  }
  K.filtered = filtered;
  function enumerators(rows) {
    var s = new Map();
    (rows || K.rows).forEach(function (r) { s.set(r.__.enumerator, (s.get(r.__.enumerator) || 0) + 1); });
    return Array.from(s.keys()).sort(function (a, b) { return a.localeCompare(b, undefined, { sensitivity: "base" }); });
  }
  K.colorOf = function (name) {
    var list = enumerators();
    return PALETTE[Math.max(0, list.indexOf(name)) % PALETTE.length];
  };

  /* ------------------------------------------------------ auto refresh */

  var timer = 0;
  function schedule() {
    clearInterval(timer);
    if (K.cfg.refreshMin > 0 && K.asset) timer = setInterval(function () { K.fetch(false).then(notifyNew).catch(function () { }); }, K.cfg.refreshMin * 60000);
  }
  function notifyNew(fresh) {
    if (!fresh || !fresh.length) return;
    var by = {};
    fresh.forEach(function (r) { by[r.__.enumerator] = (by[r.__.enumerator] || 0) + 1; });
    toast(fresh.length + " new submission" + (fresh.length === 1 ? "" : "s") + ": " + Object.keys(by).map(function (k) { return k + " (" + by[k] + ")"; }).join(", "));
  }

  /* ------------------------------------------------------------ panel */

  var statusMsg = "", statusOk = null;
  function setBusy(on, msg, ok) {
    K.busy = on;
    statusMsg = msg || "";
    statusOk = on ? null : ok;
    var el = $("koboStatus");
    if (el) { el.textContent = statusMsg; el.className = "kobo-status" + (on ? " busy" : ok === false ? " error" : ok ? " ok" : ""); el.style.display = statusMsg ? "" : "none"; }
    var ds = document.querySelector(".kd-status");
    if (ds) { ds.textContent = on ? statusMsg : updatedText(); ds.classList.toggle("busy", on); }
  }
  function updatedText() { return K.lastFetch ? "Updated " + hm(K.lastFetch) + (K.cfg.refreshMin ? " · every " + K.cfg.refreshMin + " min" : "") : ""; }

  function field(lbl, ctl) { return '<label class="field-label">' + lbl + "</label>" + ctl; }
  function opts(list, v) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join(""); }

  function build() {
    if ($(PANEL_ID)) return;
    var p = document.createElement("div");
    p.id = PANEL_ID;
    p.className = "sidebar-panel";
    p.innerHTML =
      '<div class="sp-head"><span class="sp-title">KoboToolbox</span><button type="button" class="sp-close" title="Close panel"><span class="material-symbols-outlined">keyboard_double_arrow_left</span></button></div>' +
      '<div class="kobo-body">' +
        '<div class="kobo-sec">' +
          field("Server", '<select id="koboServer">' + opts(SERVERS, K.cfg.server) + "</select>") +
          '<input type="text" id="koboCustom" placeholder="https://kobo.example.org" value="' + esc(K.cfg.custom) + '" style="margin-top:6px;' + (K.cfg.server === "custom" ? "" : "display:none") + '">' +
          field("API token", '<input type="password" id="koboToken" autocomplete="off" spellcheck="false" value="' + esc(K.token) + '">') +
          '<label class="check-row kobo-check"><input type="checkbox" id="koboRemember"' + (K.cfg.remember ? " checked" : "") + "> Remember on this device</label>" +
          '<div class="num-pair" style="margin-top:8px;"><div>' + field("Access", '<select id="koboAccess">' + opts((DESKTOP ? [["app", "Built-in"]] : []).concat([["proxy", "Local proxy"], ["direct", "Direct"]]), K.cfg.access) + "</select>") + "</div>" +
            '<div id="koboProxyWrap"' + (K.cfg.access === "proxy" ? "" : ' style="display:none"') + ">" + field('Proxy <i class="kobo-dot" id="koboProxyDot"></i>', '<input type="text" id="koboProxy" value="' + esc(K.cfg.proxy) + '">') + "</div></div>" +
          '<button id="koboConnect" class="btn-primary kobo-wide">' + sym("link") + "Connect</button>" +
          '<p class="kobo-status" id="koboStatus" style="display:none;"></p>' +
        "</div>" +
        '<div class="kobo-sec"><div class="kobo-sec-title">Forms</div><div class="kobo-forms" id="koboForms"></div></div>' +
        '<div class="kobo-sec" id="koboActive"></div>' +
      "</div>";
    document.querySelector(".sidebar").appendChild(p);

    var nav = document.querySelector(".sidebar-nav"), after = nav.querySelector(".nav-catalog") || nav.querySelector('[data-panel="panel-map"]');
    var b = document.createElement("button");
    b.className = "nav-btn nav-kobo";
    b.setAttribute("data-panel", PANEL_ID);
    b.title = "KoboToolbox";
    b.innerHTML = sym("fact_check") + '<span class="nav-lbl">Kobo</span>';
    if (after) after.after(b); else nav.appendChild(b);
    b.addEventListener("click", function () {
      if (b.classList.contains("active")) { window.closeSidebar(); return; }
      GIS.enterMapMode();
      activateSidebarPanel(PANEL_ID);
      pingProxy();
    });
    p.querySelector(".sp-close").addEventListener("click", function () { window.closeSidebar(); });
    wire(p);
    renderForms();
    renderActive();
  }

  function pingProxy() {
    var dot = $("koboProxyDot");
    if (!dot || K.cfg.access !== "proxy") return;
    dot.className = "kobo-dot";
    K.checkProxy().then(function (h) { dot.className = "kobo-dot on"; dot.title = "Proxy " + h.version + (h.demo ? " · demo form on" : ""); })
      .catch(function () { dot.className = "kobo-dot off"; dot.title = "Proxy not running"; });
  }

  function wire(p) {
    $("koboServer").addEventListener("change", function () { K.cfg.server = this.value; $("koboCustom").style.display = this.value === "custom" ? "" : "none"; saveCfg(); });
    $("koboCustom").addEventListener("change", function () { K.cfg.custom = this.value.trim(); saveCfg(); });
    $("koboToken").addEventListener("change", function () { K.token = this.value.trim(); saveCfg(); });
    $("koboRemember").addEventListener("change", function () { K.cfg.remember = this.checked; saveCfg(); });
    $("koboAccess").addEventListener("change", function () { K.cfg.access = this.value; K.cfg.accessChosen = true; $("koboProxyWrap").style.display = this.value === "proxy" ? "" : "none"; saveCfg(); pingProxy(); });
    $("koboProxy").addEventListener("change", function () { K.cfg.proxy = this.value.trim() || "http://127.0.0.1:8767"; saveCfg(); pingProxy(); });
    $("koboConnect").addEventListener("click", function () { K.token = $("koboToken").value.trim(); saveCfg(); K.connect().catch(function () { }); });
    $("koboForms").addEventListener("click", function (e) {
      var it = e.target.closest("[data-uid]");
      if (it) K.openAsset(it.dataset.uid).then(function () { renderActive(); schedule(); }).catch(function () { });
    });
    $("koboActive").addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (!b) return;
      var a = b.dataset.act;
      if (a === "dash") openDashboard();
      else if (a === "refresh") K.fetch(false).then(notifyNew).catch(function () { });
      else if (a === "reload") K.fetch(true).catch(function () { });
      else if (a === "map") addToMap();
    });
    $("koboActive").addEventListener("change", function (e) {
      var t = e.target;
      if (t.dataset.map) K.setMapping(t.dataset.map, t.value);
      else if (t.id === "koboRefresh") { K.cfg.refreshMin = +t.value; saveCfg(); schedule(); }
      else if (t.id === "koboMinDur") { K.cfg.minDur = +t.value || 0; saveCfg(); K.reanalyze(); }
      else if (t.id === "koboMaxAcc") { K.cfg.maxAcc = +t.value || 0; saveCfg(); K.reanalyze(); }
    });
  }

  function renderForms() {
    var box = $("koboForms");
    if (!box) return;
    if (!K.assets.length) { box.innerHTML = '<div class="gis-empty">' + (K.connected ? "No forms" : "Not connected") + "</div>"; return; }
    box.innerHTML = K.assets.map(function (a) {
      var n = a.deployment__submission_count;
      return '<button type="button" class="kobo-form' + (K.asset && K.asset.uid === a.uid ? " active" : "") + '" data-uid="' + esc(a.uid) + '">' + sym(a.has_deployment === false ? "draft" : "assignment") +
        '<span class="kobo-form-name">' + esc(a.name) + "</span><em>" + (n == null ? "" : fmt(n)) + "</em></button>";
    }).join("");
  }

  function renderActive() {
    var box = $("koboActive");
    if (!box) return;
    if (!K.asset) { box.innerHTML = ""; return; }
    var fields = [["", "—"]].concat(Array.from(K.questions.values()).filter(function (q) { return !/^(begin_|end_)/.test(q.type); }).map(function (q) { return [q.name, q.label + " (" + q.name + ")"]; }));
    var geos = [["", "—"]].concat(Array.from(K.questions.values()).filter(function (q) { return q.type === "geopoint"; }).map(function (q) { return [q.name, q.label]; }));
    var m = K.fm;
    box.innerHTML =
      '<div class="kobo-sec-title">' + esc(K.asset.name) + "</div>" +
      '<button data-act="dash" class="btn-primary kobo-wide">' + sym("monitoring") + "Open dashboard</button>" +
      '<div class="kobo-row"><button data-act="refresh">' + sym("sync") + "Refresh</button><button data-act=\"map\">" + sym("add_location_alt") + "Add to map</button></div>" +
      field("Auto refresh", '<select id="koboRefresh">' + opts([[0, "Off"], [1, "Every minute"], [2, "Every 2 minutes"], [5, "Every 5 minutes"], [10, "Every 10 minutes"], [15, "Every 15 minutes"], [30, "Every 30 minutes"]], K.cfg.refreshMin) + "</select>") +
      '<div class="kobo-sec-title" style="margin-top:14px;">Fields</div>' +
      [["enumerator", "Enumerator"], ["name", "Respondent"], ["desa", "Village"], ["luas", "Area (ha)"], ["date", "Survey date"]].map(function (x) {
        return field(x[1], '<select data-map="' + x[0] + '">' + opts(fields, m[x[0]]) + "</select>");
      }).join("") + field("Location", '<select data-map="geo">' + opts(geos, m.geo) + "</select>") +
      '<div class="kobo-sec-title" style="margin-top:14px;">Quality checks</div>' +
      '<div class="num-pair"><div>' + field("Min. interview (min)", '<input type="number" id="koboMinDur" min="0" step="1" value="' + K.cfg.minDur + '">') + "</div><div>" +
      field("Max. GPS accuracy (m)", '<input type="number" id="koboMaxAcc" min="0" step="1" value="' + K.cfg.maxAcc + '">') + "</div></div>";
  }

  K.on(function (evt) { if (evt === "assets") renderForms(); if (evt === "data") { renderForms(); renderActive(); } });

  /* ------------------------------------------------------- add to map */

  function toFeatures(rows) {
    var names = Array.from(K.questions.values()).filter(function (q) { return !SKIP[q.type]; }).map(function (q) { return q.name; });
    return rows.filter(function (r) { return r.__.lon !== null; }).map(function (r) {
      var a = r.__, p = { _id: r._id, enumerator: a.enumerator, village: a.desa, survey_date: a.day, submitted: new Date(a.t).toISOString(),
        duration_min: a.dur === null ? null : Math.round(a.dur * 10) / 10, gps_accuracy_m: a.acc, area_ha: a.luas, qc_flags: a.flags.join("; ") };
      names.forEach(function (n) {
        if (p[n] !== undefined) return;
        var q = K.questions.get(n), v = q.list ? display(r, n) : r[n];
        p[n] = q.type === "integer" || q.type === "decimal" ? num(v) : v === undefined ? null : v;
      });
      return { type: "Feature", geometry: { type: "Point", coordinates: [a.lon, a.lat] }, properties: p };
    });
  }
  function addToMap(rows, name) {
    rows = rows || filtered();
    var feats = toFeatures(rows);
    if (!feats.length) { toast("No submissions with a location in the current filter."); return; }
    GIS.enterMapMode();
    var l = GIS.addVector({ type: "FeatureCollection", features: feats }, name || K.asset.name);
    l.attribution = "KoboToolbox";
    l.style.symbology = "categorized";
    l.style.field = "enumerator";
    l.style.catColors = {};
    enumerators().forEach(function (e) { l.style.catColors[e] = K.colorOf(e); });
    l.style.pointRadius = 5;
    GIS.emit("style");
    return l;
  }
  function addRoutesToMap(day) {
    var groups = routeGroups(day), feats = groups.filter(function (g) { return g.events.length > 1; }).map(function (g) {
      return { type: "Feature", geometry: { type: "LineString", coordinates: g.events.map(function (e) { return [e.lon, e.lat]; }) },
        properties: { enumerator: g.label, date: day, stops: g.events.length, km: Math.round(g.km * 100) / 100, start: hm(g.events[0].t), end: hm(g.events[g.events.length - 1].t) } };
    });
    if (!feats.length) { toast("No routes for " + day + "."); return; }
    GIS.enterMapMode();
    var l = GIS.addVector({ type: "FeatureCollection", features: feats }, "Routes " + day);
    l.style.symbology = "categorized"; l.style.field = "enumerator"; l.style.catColors = {}; l.style.lineWidth = 2.5;
    groups.forEach(function (g) { l.style.catColors[g.label] = g.color; });
    GIS.emit("style");
  }
  K.addToMap = addToMap;

  /* ------------------------------------------------------------ toast */

  function toast(msg) {
    var t = document.createElement("div");
    t.className = "kobo-toast";
    t.innerHTML = sym("notifications_active") + "<span>" + esc(msg) + "</span>";
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("show"); }, 10);
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 300); }, 5200);
  }
  K.toast = toast;

  /* -------------------------------------------------------- dashboard */

  var D = null; // { el, tab }

  function openDashboard() {
    if (!K.asset) return;
    if (!D) buildDashboard();
    D.el.hidden = false;
    document.body.classList.add("kobo-dash-open");
    if (window.PlootsHome) window.PlootsHome.hide();
    renderDashboard();
    if (window.closeSidebar) window.closeSidebar();
  }
  K.openDashboard = openDashboard;
  function closeDashboard() {
    if (!D) return;
    D.el.hidden = true;
    document.body.classList.remove("kobo-dash-open");
    routePause();
  }

  var TABS = [["overview", "Overview", "space_dashboard"], ["enum", "Enumerators", "badge"], ["recap", "Recap", "bar_chart"], ["route", "Route", "route"], ["data", "Data", "table"]];

  function buildDashboard() {
    var el = document.createElement("div");
    el.className = "kd";
    el.hidden = true;
    el.innerHTML =
      '<div class="kd-head">' +
        '<div class="kd-title"><span class="kd-live" title="Auto refresh"></span><div><b id="kdName"></b><span class="kd-status"></span></div></div>' +
        '<div class="kd-filters">' +
          '<label>From <input type="date" id="kdFrom"></label><label>To <input type="date" id="kdTo"></label>' +
          '<select id="kdEnum"></select>' +
          '<div class="kd-quick"><button data-range="0">Today</button><button data-range="6">7 days</button><button data-range="29">30 days</button><button data-range="all">All</button></div>' +
        "</div>" +
        '<div class="kd-actions"><button data-kd="refresh" title="Refresh now">' + sym("sync") + '</button><button data-kd="map" title="Add to map">' + sym("add_location_alt") + '</button><button data-kd="close" title="Close">' + sym("close") + "</button></div>" +
      "</div>" +
      '<div class="kd-tabs">' + TABS.map(function (t) { return '<button data-tab="' + t[0] + '">' + sym(t[2]) + t[1] + "</button>"; }).join("") + "</div>" +
      '<div class="kd-body">' + TABS.map(function (t) { return '<div class="kd-pane" data-pane="' + t[0] + '"></div>'; }).join("") + "</div>";
    (document.getElementById("paneLayout") || document.body).appendChild(el);
    D = { el: el, tab: "overview" };
    el.querySelector(".kd-tabs").addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (b) { D.tab = b.dataset.tab; renderDashboard(); } });
    el.querySelector(".kd-actions").addEventListener("click", function (e) {
      var b = e.target.closest("[data-kd]");
      if (!b) return;
      if (b.dataset.kd === "close") closeDashboard();
      else if (b.dataset.kd === "refresh") K.fetch(false).then(notifyNew).catch(function () { });
      else if (b.dataset.kd === "map") { addToMap(); closeDashboard(); }
    });
    $("kdFrom").addEventListener("change", function () { K.filter.from = this.value; renderDashboard(); });
    $("kdTo").addEventListener("change", function () { K.filter.to = this.value; renderDashboard(); });
    $("kdEnum").addEventListener("change", function () { K.filter.enumerator = this.value; renderDashboard(); });
    el.querySelector(".kd-quick").addEventListener("click", function (e) {
      var b = e.target.closest("[data-range]");
      if (!b) return;
      var r = b.dataset.range, days = K.rows.map(function (x) { return x.__.day; }).sort();
      K.filter.to = today();
      K.filter.from = r === "all" ? (days[0] || today()) : addDays(today(), -(+r));
      renderDashboard();
    });
    el.addEventListener("keydown", function (e) { if (e.key === "Escape" && !e.target.closest("input,textarea,select")) closeDashboard(); });
  }

  function renderDashboard() {
    if (!D || D.el.hidden) return;
    $("kdName").textContent = K.asset ? K.asset.name : "";
    $("kdFrom").value = K.filter.from; $("kdTo").value = K.filter.to;
    var list = enumerators();
    $("kdEnum").innerHTML = '<option value="">All enumerators</option>' + list.map(function (n) { return '<option' + (n === K.filter.enumerator ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("");
    D.el.querySelector(".kd-live").classList.toggle("on", K.cfg.refreshMin > 0);
    var st = D.el.querySelector(".kd-status");
    if (!K.busy) st.textContent = updatedText();
    Array.prototype.forEach.call(D.el.querySelectorAll(".kd-tabs button"), function (b) { b.classList.toggle("active", b.dataset.tab === D.tab); });
    Array.prototype.forEach.call(D.el.querySelectorAll(".kd-pane"), function (p) { p.hidden = p.dataset.pane !== D.tab; });
    var pane = D.el.querySelector('[data-pane="' + D.tab + '"]');
    ({ overview: renderOverview, enum: renderEnum, recap: renderRecap, route: renderRoute, data: renderData })[D.tab](pane);
  }
  K.on(function (evt) {
    if (!D || D.el.hidden) return;
    if (evt === "refresh" && D.tab === "route") { routeRebuild(true); renderDashboardHead(); return; }
    renderDashboard();
  });
  function renderDashboardHead() { var st = D.el.querySelector(".kd-status"); if (st && !K.busy) st.textContent = updatedText(); }

  function days(from, to) { var out = [], d = from; while (d <= to && out.length < 400) { out.push(d); d = addDays(d, 1); } return out; }
  function card(title, body, cls) { return '<section class="kd-card' + (cls ? " " + cls : "") + '"><h3>' + title + "</h3>" + body + "</section>"; }

  /* overview */
  function renderOverview(pane) {
    var rows = filtered(), td = today(), tRows = K.rows.filter(function (r) { return r.__.day === td && (!K.filter.enumerator || r.__.enumerator === K.filter.enumerator); });
    var yRows = K.rows.filter(function (r) { return r.__.day === addDays(td, -1) && (!K.filter.enumerator || r.__.enumerator === K.filter.enumerator); });
    var all = enumerators(), activeToday = enumerators(tRows);
    var dset = new Set(rows.map(function (r) { return r.__.day; }));
    var perEnumDay = rows.length / Math.max(1, dset.size) / Math.max(1, enumerators(rows).length);
    var area = rows.reduce(function (s, r) { return s + (r.__.luas || 0); }, 0), hasArea = rows.some(function (r) { return r.__.luas !== null; });
    var last = K.rows[K.rows.length - 1];
    var flags = rows.filter(function (r) { return r.__.flags.length; }).length;
    var delta = tRows.length - yRows.length;
    var kpi = function (label, value, sub, cls) { return '<div class="kd-kpi' + (cls ? " " + cls : "") + '"><span>' + label + "</span><b>" + value + "</b><em>" + (sub || "") + "</em></div>"; };
    var h = '<div class="kd-kpis">' +
      kpi("Submissions", fmt(rows.length), dayLabel(K.filter.from) + " – " + dayLabel(K.filter.to)) +
      kpi("Today", fmt(tRows.length), (delta >= 0 ? "+" : "") + delta + " vs yesterday", delta >= 0 ? "up" : "down") +
      kpi("Active today", activeToday.length + " / " + all.length, "enumerators") +
      kpi("Per enumerator-day", fmt(perEnumDay, 1), "average") +
      (hasArea ? kpi("Area surveyed", fmt(area, 1) + " ha", fmt(rows.filter(function (r) { return r.__.luas !== null; }).length) + " farms") : "") +
      kpi("Quality flags", fmt(flags), rows.length ? fmt(flags / rows.length * 100, 0) + "% of submissions" : "", flags ? "warn" : "") +
      kpi("Last submission", last ? ago(last.__.t) : "—", last ? esc(last.__.enumerator) + " · " + hm(last.__.t) : "") +
      "</div>";
    h += '<div class="kd-grid">' + card("Submissions per day", '<div class="kd-chart" id="kdDaily"></div><div class="kd-legend" id="kdDailyLegend"></div>', "wide") +
      card("Today", todayList(tRows, all)) + "</div>";
    h += '<div class="kd-grid">' + card("Enumerator × day", matrix(rows), "wide") + card("Latest submissions", feed(K.rows.slice(-30).reverse())) + "</div>";
    pane.innerHTML = h;
    dailyChart($("kdDaily"), rows);
  }

  function todayList(tRows, all) {
    var by = {};
    tRows.forEach(function (r) { var e = r.__.enumerator; (by[e] = by[e] || []).push(r); });
    var list = (K.filter.enumerator ? [K.filter.enumerator] : all).map(function (e) {
      var rs = by[e] || [], lastT = rs.length ? rs[rs.length - 1].__.t : null;
      var state = !rs.length ? "none" : Date.now() - lastT < 3600000 ? "live" : "idle";
      return { e: e, n: rs.length, last: lastT, state: state };
    }).sort(function (a, b) { return b.n - a.n || a.e.localeCompare(b.e); });
    return '<div class="kd-today">' + list.map(function (x) {
      return '<div class="kd-today-row"><i class="kd-state ' + x.state + '"></i><span class="kd-sw" style="background:' + K.colorOf(x.e) + '"></span><b>' + esc(x.e) + "</b>" +
        '<em>' + (x.last ? "last " + hm(x.last) : "no submission yet") + "</em><strong>" + x.n + "</strong></div>";
    }).join("") + "</div>";
  }

  function matrix(rows) {
    var ds = days(K.filter.from, K.filter.to).slice(-21), list = enumerators(rows.length ? rows : K.rows), td = today();
    if (K.filter.enumerator) list = [K.filter.enumerator];
    var c = {}, max = 1;
    rows.forEach(function (r) { var k = r.__.enumerator + "|" + r.__.day; c[k] = (c[k] || 0) + 1; max = Math.max(max, c[k]); });
    var h = '<div class="kd-matrix-wrap"><table class="kd-matrix"><thead><tr><th></th>' + ds.map(function (d) {
      return "<th" + (d === td ? ' class="today"' : "") + ' title="' + d + '">' + dayLabel(d).replace(" ", "<br>") + "</th>";
    }).join("") + "<th>Total</th></tr></thead><tbody>";
    list.forEach(function (e) {
      var tot = 0;
      h += '<tr><th><span class="kd-sw" style="background:' + K.colorOf(e) + '"></span>' + esc(e) + "</th>" + ds.map(function (d) {
        var n = c[e + "|" + d] || 0;
        tot += n;
        var bg = n ? "rgba(37,99,235," + (0.12 + 0.78 * n / max).toFixed(2) + ")" : "";
        return '<td class="' + (d === td ? "today" : "") + (n ? "" : " zero") + '"' + (bg ? ' style="background:' + bg + ";color:" + (n / max > 0.55 ? "#fff" : "inherit") + '"' : "") + ' title="' + esc(e) + " · " + d + ": " + n + '">' + (n || "·") + "</td>";
      }).join("") + "<td class=\"tot\">" + tot + "</td></tr>";
    });
    var totals = ds.map(function (d) { return list.reduce(function (s, e) { return s + (c[e + "|" + d] || 0); }, 0); });
    h += '<tr class="kd-sum"><th>All</th>' + totals.map(function (n, i) { return "<td" + (ds[i] === td ? ' class="today"' : "") + ">" + n + "</td>"; }).join("") + "<td class=\"tot\">" + totals.reduce(function (a, b) { return a + b; }, 0) + "</td></tr>";
    return h + "</tbody></table></div>";
  }

  function feed(rows) {
    if (!rows.length) return '<div class="gis-empty">No submissions</div>';
    var fresh = new Set(K.lastNew.map(function (r) { return String(r._id); }));
    return '<div class="kd-feed">' + rows.map(function (r) {
      var a = r.__;
      return '<div class="kd-feed-row' + (fresh.has(String(r._id)) ? " new" : "") + '"><span class="kd-sw" style="background:' + K.colorOf(a.enumerator) + '"></span>' +
        "<div><b>" + esc(a.enumerator) + "</b><span>" + esc([a.name, a.desa].filter(Boolean).join(" · ") || "#" + r._id) + "</span></div>" +
        "<em>" + (a.day === today() ? hm(a.t) : dayLabel(a.subDay) + " " + hm(a.t)) + (a.flags.length ? ' <i class="kd-flag" title="' + esc(a.flags.join("; ")) + '">!</i>' : "") + "</em></div>";
    }).join("") + "</div>";
  }

  function dailyChart(el, rows) {
    if (!el) return;
    var ds = days(K.filter.from, K.filter.to), list = enumerators(rows);
    var W = el.clientWidth || 600, H = 230, m = { t: 10, r: 8, b: 26, l: 30 };
    var data = ds.map(function (d) { var o = { day: d }; list.forEach(function (e) { o[e] = 0; }); return o; });
    var idx = {}; ds.forEach(function (d, i) { idx[d] = i; });
    rows.forEach(function (r) { var i = idx[r.__.day]; if (i !== undefined) data[i][r.__.enumerator]++; });
    var stack = d3.stack().keys(list)(data);
    var x = d3.scaleBand().domain(ds).range([m.l, W - m.r]).padding(0.18);
    var ymax = d3.max(data, function (o) { return list.reduce(function (s, e) { return s + o[e]; }, 0); }) || 1;
    var y = d3.scaleLinear().domain([0, ymax]).nice().range([H - m.b, m.t]);
    var svg = d3.select(el).append("svg").attr("width", W).attr("height", H).attr("class", "kd-svg");
    svg.append("g").attr("class", "kd-grid-y").selectAll("line").data(y.ticks(4)).join("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y).attr("y2", y);
    svg.append("g").selectAll("text").data(y.ticks(4)).join("text").attr("class", "kd-axis").attr("x", m.l - 6).attr("y", y).attr("dy", "0.32em").attr("text-anchor", "end").text(function (d) { return d; });
    svg.append("g").selectAll("g").data(stack).join("g").attr("fill", function (s) { return K.colorOf(s.key); })
      .selectAll("rect").data(function (s) { return s.map(function (v) { v.key = s.key; return v; }); }).join("rect")
      .attr("x", function (v) { return x(v.data.day); }).attr("width", x.bandwidth()).attr("y", function (v) { return y(v[1]); })
      .attr("height", function (v) { return Math.max(0, y(v[0]) - y(v[1])); }).attr("rx", 1.5)
      .append("title").text(function (v) { return v.key + " · " + v.data.day + ": " + (v[1] - v[0]); });
    var every = Math.ceil(ds.length / Math.max(1, Math.floor((W - m.l) / 46)));
    svg.append("g").selectAll("text").data(ds.filter(function (d, i) { return i % every === 0; })).join("text").attr("class", "kd-axis")
      .attr("x", function (d) { return x(d) + x.bandwidth() / 2; }).attr("y", H - 8).attr("text-anchor", "middle").text(dayLabel);
    var lg = $("kdDailyLegend");
    if (lg) lg.innerHTML = list.map(function (e) { return '<span><i style="background:' + K.colorOf(e) + '"></i>' + esc(e) + "</span>"; }).join("");
  }

  /* enumerators */
  function enumStats(rows) {
    var by = new Map(), td = today();
    rows.forEach(function (r) { var e = r.__.enumerator; if (!by.has(e)) by.set(e, []); by.get(e).push(r); });
    return Array.from(by.entries()).map(function (kv) {
      var rs = kv[1], ds = new Set(rs.map(function (r) { return r.__.day; }));
      var durs = rs.map(function (r) { return r.__.dur; }).filter(function (v) { return v !== null; }).sort(d3.ascending);
      var accs = rs.map(function (r) { return r.__.acc; }).filter(function (v) { return v !== null; }).sort(d3.ascending);
      var km = 0;
      Array.from(ds).forEach(function (d) {
        var pts = rs.filter(function (r) { return r.__.day === d && r.__.lon !== null; }).sort(function (a, b) { return a.__.at - b.__.at; });
        for (var i = 1; i < pts.length; i++) km += haversine([pts[i - 1].__.lon, pts[i - 1].__.lat], [pts[i].__.lon, pts[i].__.lat]) / 1000;
      });
      return { e: kv[0], n: rs.length, today: rs.filter(function (r) { return r.__.day === td; }).length, days: ds.size, perDay: rs.length / Math.max(1, ds.size),
        dur: durs.length ? d3.median(durs) : null, gps: rs.filter(function (r) { return r.__.lon !== null; }).length / rs.length * 100,
        acc: accs.length ? d3.median(accs) : null, km: km, area: rs.reduce(function (s, r) { return s + (r.__.luas || 0); }, 0),
        flags: rs.filter(function (r) { return r.__.flags.length; }).length, last: rs[rs.length - 1].__.t };
    }).sort(function (a, b) { return b.n - a.n; });
  }
  function renderEnum(pane) {
    var st = enumStats(filtered()), maxN = d3.max(st, function (s) { return s.n; }) || 1;
    var hasArea = K.rows.some(function (r) { return r.__.luas !== null; });
    pane.innerHTML = card("Enumerators", '<div class="kd-table-wrap"><table class="kd-table"><thead><tr><th>Enumerator</th><th>Submissions</th><th>Today</th><th>Active days</th><th>Per day</th><th>Median interview</th><th>GPS</th><th>Median accuracy</th><th>Distance</th>' + (hasArea ? "<th>Area</th>" : "") + "<th>Flags</th><th>Last</th></tr></thead><tbody>" +
      st.map(function (s) {
        return '<tr><th><span class="kd-sw" style="background:' + K.colorOf(s.e) + '"></span>' + esc(s.e) + "</th>" +
          '<td><div class="kd-bar"><i style="width:' + (s.n / maxN * 100).toFixed(1) + "%;background:" + K.colorOf(s.e) + '"></i><span>' + fmt(s.n) + "</span></div></td>" +
          "<td>" + s.today + "</td><td>" + s.days + "</td><td>" + fmt(s.perDay, 1) + "</td><td>" + (s.dur === null ? "—" : fmt(s.dur, 0) + " min") + "</td>" +
          '<td class="' + (s.gps < 95 ? "warn" : "") + '">' + fmt(s.gps, 0) + "%</td><td class=\"" + (s.acc !== null && K.cfg.maxAcc && s.acc > K.cfg.maxAcc ? "warn" : "") + "\">" + (s.acc === null ? "—" : fmt(s.acc, 1) + " m") + "</td>" +
          "<td>" + fmt(s.km, 1) + " km</td>" + (hasArea ? "<td>" + fmt(s.area, 1) + " ha</td>" : "") +
          '<td class="' + (s.flags ? "warn" : "") + '">' + s.flags + "</td><td>" + ago(s.last) + "</td></tr>";
      }).join("") + "</tbody></table></div>") +
      card("Quality flags", flagList(filtered()));
  }
  function flagList(rows) {
    var fl = rows.filter(function (r) { return r.__.flags.length; }).slice(-200).reverse();
    if (!fl.length) return '<div class="gis-empty">No flags</div>';
    return '<div class="kd-table-wrap"><table class="kd-table"><thead><tr><th>Submitted</th><th>Enumerator</th><th>Respondent</th><th>Village</th><th>Flags</th></tr></thead><tbody>' +
      fl.map(function (r) { var a = r.__; return "<tr><td>" + dayLabel(a.subDay) + " " + hm(a.t) + "</td><td>" + esc(a.enumerator) + "</td><td>" + esc(a.name) + "</td><td>" + esc(a.desa) + '</td><td class="warn">' + esc(a.flags.join("; ")) + "</td></tr>"; }).join("") +
      "</tbody></table></div>";
  }

  /* recap */
  function renderRecap(pane) {
    var rows = filtered(), cards = [];
    if (K.fm.desa) {
      var byV = d3.rollups(rows, function (rs) { return { n: rs.length, area: d3.sum(rs, function (r) { return r.__.luas || 0; }), enums: new Set(rs.map(function (r) { return r.__.enumerator; })).size }; }, function (r) { return r.__.desa || "(blank)"; })
        .sort(function (a, b) { return b[1].n - a[1].n; });
      cards.push(card("By " + esc(K.label(K.fm.desa).toLowerCase()), '<table class="kd-table"><thead><tr><th></th><th>Submissions</th>' + (K.fm.luas ? "<th>Area (ha)</th>" : "") + "<th>Enumerators</th></tr></thead><tbody>" +
        byV.map(function (v) { return "<tr><th>" + esc(v[0]) + "</th><td>" + v[1].n + "</td>" + (K.fm.luas ? "<td>" + fmt(v[1].area, 1) + "</td>" : "") + "<td>" + v[1].enums + "</td></tr>"; }).join("") + "</tbody></table>"));
    }
    Array.from(K.questions.values()).forEach(function (q) {
      if (SKIP[q.type] || /^(begin|end)_/.test(q.type) || q.name === K.fm.enumerator) return;
      if (q.type === "select_one" || q.type === "select_multiple") {
        var c = new Map(), answered = 0;
        rows.forEach(function (r) {
          var v = r[q.name];
          if (v === undefined || v === null || v === "") return;
          answered++;
          (q.type === "select_multiple" ? String(v).split(/\s+/) : [String(v)]).forEach(function (code) { var l = (K.choices[q.list] || {})[code] || code; c.set(l, (c.get(l) || 0) + 1); });
        });
        var list = Array.from(c.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 12), max = list.length ? list[0][1] : 1;
        cards.push(card(esc(q.label), '<div class="kd-meta">' + fmt(answered) + " answered" + (q.type === "select_multiple" ? " · multiple choice" : "") + "</div>" +
          '<div class="kd-bars">' + list.map(function (x) {
            return '<div class="kd-hbar"><span title="' + esc(x[0]) + '">' + esc(x[0]) + '</span><div><i style="width:' + (x[1] / max * 100).toFixed(1) + '%"></i></div><b>' + x[1] + "</b><em>" + fmt(x[1] / Math.max(1, answered) * 100, 0) + "%</em></div>";
          }).join("") + "</div>"));
      } else if (q.type === "integer" || q.type === "decimal") {
        var vals = rows.map(function (r) { return num(r[q.name]); }).filter(function (v) { return v !== null; }).sort(d3.ascending);
        if (!vals.length) return;
        var bins = d3.bin().thresholds(12)(vals), bmax = d3.max(bins, function (b) { return b.length; }) || 1;
        // Years (e.g. the year a farm was opened) read without separators, and have no sum.
        var year = vals[0] >= 1800 && vals[vals.length - 1] <= 2200 && vals.every(function (v) { return v === Math.round(v); });
        var f = year ? function (v, d) { return v == null || !isFinite(v) ? "—" : String(d ? Math.round(v * 10) / 10 : Math.round(v)); } : fmt;
        cards.push(card(esc(q.label), '<div class="kd-stats"><span>n <b>' + fmt(vals.length) + "</b></span><span>mean <b>" + f(d3.mean(vals), 2) + "</b></span><span>median <b>" + f(d3.median(vals), 2) +
          "</b></span><span>min <b>" + f(vals[0], 2) + "</b></span><span>max <b>" + f(vals[vals.length - 1], 2) + "</b></span>" + (year ? "" : "<span>sum <b>" + fmt(d3.sum(vals), 1) + "</b></span>") + "</div>" +
          '<div class="kd-hist">' + bins.map(function (b) { return '<i style="height:' + (b.length / bmax * 100).toFixed(1) + '%" title="' + f(b.x0, 2) + "–" + f(b.x1, 2) + ": " + b.length + '"></i>'; }).join("") + "</div>" +
          '<div class="kd-hist-ax"><span>' + f(bins[0].x0, 1) + "</span><span>" + f(bins[bins.length - 1].x1, 1) + "</span></div>"));
      }
    });
    pane.innerHTML = '<div class="kd-cards">' + (cards.join("") || '<div class="gis-empty">No questions to summarise</div>') + "</div>";
  }

  /* data */
  var dataQuery = "";
  function renderData(pane) {
    var rows = filtered().slice().reverse(), q = dataQuery.toLowerCase();
    if (q) rows = rows.filter(function (r) { return JSON.stringify(r).toLowerCase().indexOf(q) >= 0 || (r.__.enumerator + " " + r.__.desa).toLowerCase().indexOf(q) >= 0; });
    var cols = Array.from(K.questions.values()).filter(function (x) { return !SKIP[x.type] && !/^(begin|end)_/.test(x.type) && x.name !== K.fm.enumerator; }).slice(0, 14);
    pane.innerHTML = '<div class="kd-data-bar"><input type="search" id="kdSearch" placeholder="Search" value="' + esc(dataQuery) + '"><span>' + fmt(rows.length) + " submissions" + (rows.length > 500 ? " · first 500 shown" : "") + "</span>" +
      '<button data-dx="csv">' + sym("download") + "CSV</button><button data-dx=\"map\">" + sym("add_location_alt") + "Add to map</button></div>" +
      '<div class="kd-table-wrap tall"><table class="kd-table"><thead><tr><th>Submitted</th><th>Enumerator</th>' + cols.map(function (c) { return "<th title=\"" + esc(c.name) + "\">" + esc(c.label) + "</th>"; }).join("") + "<th>Minutes</th><th>GPS (m)</th><th>Flags</th></tr></thead><tbody>" +
      rows.slice(0, 500).map(function (r) {
        var a = r.__;
        return "<tr><td>" + dayLabel(a.subDay) + " " + hm(a.t) + "</td><td>" + esc(a.enumerator) + "</td>" + cols.map(function (c) { return "<td>" + esc(display(r, c.name)) + "</td>"; }).join("") +
          "<td>" + (a.dur === null ? "" : fmt(a.dur, 0)) + "</td><td>" + (a.acc === null ? "" : fmt(a.acc, 1)) + '</td><td class="warn">' + esc(a.flags.join("; ")) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    var s = $("kdSearch");
    s.addEventListener("input", function () { dataQuery = this.value; var pos = this.selectionStart; renderData(pane); var n = $("kdSearch"); n.focus(); n.setSelectionRange(pos, pos); });
    pane.querySelector(".kd-data-bar").addEventListener("click", function (e) {
      var b = e.target.closest("[data-dx]");
      if (!b) return;
      if (b.dataset.dx === "map") { addToMap(rows); closeDashboard(); }
      else exportCsv(rows);
    });
  }
  function exportCsv(rows) {
    var names = Array.from(K.questions.values()).filter(function (x) { return !/^(begin|end)_/.test(x.type); }).map(function (x) { return x.name; });
    var head = ["_id", "_submission_time", "enumerator", "survey_date", "duration_min", "latitude", "longitude", "gps_accuracy_m", "qc_flags"].concat(names);
    var lines = [head].concat(rows.map(function (r) {
      var a = r.__;
      return [r._id, r._submission_time, a.enumerator, a.day, a.dur === null ? "" : Math.round(a.dur * 10) / 10, a.lat, a.lon, a.acc, a.flags.join("; ")].concat(names.map(function (n) { return display(r, n); }));
    }));
    var csv = lines.map(function (l) { return l.map(function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
    GIS.download("﻿" + csv, (K.asset.name || "kobo").replace(/[\\/:*?"<>|]+/g, "") + ".csv", "text/csv");
  }

  /* --------------------------------------------------------- route */
  // One day's submissions per enumerator, in interview order, drawn as a
  // growing line with a moving pin; a bubble pops up at each arrival.

  var R = { day: "", T: 0, t0: 0, t1: 0, start: 0, playing: false, speed: 600, groups: [], events: [], hidden: new Set(), map: null, raf: 0, last: 0, bubbles: [], feed: [], fitted: "" };

  function routeGroups(day) {
    var ev = K.rows.filter(function (r) { return r.__.day === day && r.__.lon !== null && (!K.filter.enumerator || r.__.enumerator === K.filter.enumerator); })
      .map(function (r) { var a = r.__; return { id: r._id, e: a.enumerator, t: a.at, lon: a.lon, lat: a.lat, name: a.name, desa: a.desa, flags: a.flags.length }; })
      .sort(function (a, b) { return a.t - b.t; });
    var gm = new Map();
    ev.forEach(function (e) { if (!gm.has(e.e)) gm.set(e.e, { label: e.e, events: [] }); gm.get(e.e).events.push(e); });
    return Array.from(gm.values()).sort(function (a, b) { return a.label.localeCompare(b.label); }).map(function (g) {
      g.color = K.colorOf(g.label);
      g.km = 0;
      g.events.forEach(function (e, i) { e.seq = i + 1; e.color = g.color; if (i) g.km += haversine([g.events[i - 1].lon, g.events[i - 1].lat], [e.lon, e.lat]) / 1000; });
      return g;
    });
  }

  function renderRoute(pane) {
    if (!pane.querySelector(".kr")) {
      pane.innerHTML =
        '<div class="kr"><div class="kr-map" id="krMap"></div>' +
          '<div class="kr-side"><div class="kr-ctl">' +
            '<select id="krDay"></select>' +
            '<div class="kr-play"><button id="krPlay" class="btn-primary" title="Play">' + sym("play_arrow") + '</button><button id="krRestart" title="From the start">' + sym("replay") + '</button>' +
            '<select id="krSpeed" title="Speed">' + opts([[120, "2 min / s"], [300, "5 min / s"], [600, "10 min / s"], [1800, "30 min / s"], [3600, "1 h / s"]], R.speed) + "</select>" +
            '<b id="krClock">--:--</b></div>' +
            '<input type="range" id="krSlider" min="0" max="1000" value="1000">' +
            '<div class="kr-actions"><button id="krFit">' + sym("fit_screen") + "Fit</button><button id=\"krAdd\">" + sym("add_location_alt") + "Add routes to map</button></div>" +
          '</div><div class="kr-enums" id="krEnums"></div><div class="kr-feed" id="krFeed"></div></div></div>';
      $("krDay").addEventListener("change", function () { R.day = this.value; routeRebuild(false); });
      $("krPlay").addEventListener("click", function () { R.playing ? routePause() : routePlay(); });
      $("krRestart").addEventListener("click", function () { R.T = R.start; R.feed = []; clearBubbles(); routePlay(); });
      $("krSpeed").addEventListener("change", function () { R.speed = +this.value; });
      $("krSlider").addEventListener("input", function () { routePause(); R.T = R.start + (R.t1 - R.start) * this.value / 1000; R.feed = feedUntil(R.T); clearBubbles(); routeDraw(); renderFeed(); });
      $("krFit").addEventListener("click", function () { routeFit(); });
      $("krAdd").addEventListener("click", function () { addRoutesToMap(R.day); closeDashboard(); });
      $("krEnums").addEventListener("click", function (e) {
        var b = e.target.closest("[data-g]");
        if (!b) return;
        if (R.hidden.has(b.dataset.g)) R.hidden.delete(b.dataset.g); else R.hidden.add(b.dataset.g);
        routeDraw(); renderEnums();
      });
    }
    var ds = Array.from(new Set(K.rows.filter(function (r) { return r.__.lon !== null; }).map(function (r) { return r.__.day; }))).sort().reverse();
    if (!R.day || ds.indexOf(R.day) < 0) R.day = ds.indexOf(today()) >= 0 ? today() : ds[0] || today();
    $("krDay").innerHTML = ds.map(function (d) { return '<option value="' + d + '"' + (d === R.day ? " selected" : "") + ">" + (d === today() ? "Today, " : "") + new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) + "</option>"; }).join("");
    PlootsLazy.ensureMapLibre().then(function () {
      if (!R.map) {
        R.map = new maplibregl.Map({ container: "krMap", style: GIS.styleFor(state.mapBasemap || "positron"), center: [0, 0], zoom: 1, attributionControl: { compact: true } });
        R.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        R.map.on("load", function () { routeRebuild(false); });
        R.map.on("style.load", function () { R.layersReady = false; routeDraw(); });
      } else { R.map.resize(); routeRebuild(false); }
    });
  }

  function routeRebuild(fromRefresh) {
    var prevT1 = R.t1, atEnd = R.events.length && R.T >= R.t1 - 1, sameDay = R.builtDay === R.day;
    R.groups = routeGroups(R.day);
    R.events = [];
    R.groups.forEach(function (g) { R.events = R.events.concat(g.events); });
    R.events.sort(function (a, b) { return a.t - b.t; });
    if (R.events.length) {
      R.t0 = R.events[0].t;
      R.t1 = Math.max(R.events[R.events.length - 1].t, R.t0 + 60000);
      R.start = R.t0 - Math.max(60000, (R.t1 - R.t0) * 0.03);
    } else R.t0 = R.t1 = R.start = 0;
    if (!sameDay) { R.builtDay = R.day; R.T = R.t1; R.feed = feedUntil(R.T); routePause(); clearBubbles(); }
    else if (fromRefresh && atEnd && R.t1 > prevT1) { R.T = prevT1; routePlay(); }  // new arrivals animate in
    else if (R.T > R.t1 || !R.T) R.T = R.t1;
    routeDraw();
    renderEnums();
    renderFeed();
    if (R.fitted !== R.day) { R.fitted = R.day; routeFit(); }
  }
  function feedUntil(T) { return R.events.filter(function (e) { return e.t <= T; }).slice(-40).reverse(); }

  function ensurePins() {
    var map = R.map;
    PALETTE.forEach(function (col, i) {
      var id = "kr-pin-" + i;
      if (map.hasImage(id)) return;
      var s = 64, c = document.createElement("canvas"); c.width = c.height = s;
      var x = c.getContext("2d"), cx = s / 2, cy = s * 0.38, r = s * 0.28;
      x.beginPath(); x.moveTo(cx, s * 0.94); x.quadraticCurveTo(s * 0.12, s * 0.5, cx - r, cy); x.arc(cx, cy, r, Math.PI, 0); x.quadraticCurveTo(s * 0.88, s * 0.5, cx, s * 0.94); x.closePath();
      x.fillStyle = col; x.fill(); x.lineWidth = s * 0.06; x.strokeStyle = "#fff"; x.stroke();
      x.beginPath(); x.arc(cx, cy, r * 0.42, 0, Math.PI * 2); x.fillStyle = "#fff"; x.fill();
      map.addImage(id, x.getImageData(0, 0, s, s), { pixelRatio: 2 });
    });
  }
  function routeFrame(T) {
    var feats = [];
    R.groups.forEach(function (g) {
      if (R.hidden.has(g.label)) return;
      var ev = g.events, n = 0;
      while (n < ev.length && ev[n].t <= T) n++;
      if (!n) return;
      var coords = ev.slice(0, n).map(function (e) { return [e.lon, e.lat]; }), head = coords[n - 1], moving = 0;
      if (n < ev.length && T > ev[n - 1].t) {
        var a = ev[n - 1], b = ev[n], f = (T - a.t) / Math.max(1, b.t - a.t);
        head = [a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f];
        coords.push(head);
        moving = 1;
      }
      if (coords.length > 1) feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { kind: "line", color: g.color } });
      for (var i = 0; i < n; i++) feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [ev[i].lon, ev[i].lat] }, properties: { kind: "node", color: g.color, seq: ev[i].seq, flag: ev[i].flags ? 1 : 0 } });
      feats.push({ type: "Feature", geometry: { type: "Point", coordinates: head }, properties: { kind: "head", color: g.color, pin: "kr-pin-" + (PALETTE.indexOf(g.color) < 0 ? 0 : PALETTE.indexOf(g.color)), moving: moving } });
    });
    return { type: "FeatureCollection", features: feats };
  }
  function routeDraw() {
    var map = R.map;
    if (!map || !map.style || !map.style._loaded) return;
    ensurePins();
    var data = routeFrame(R.T);
    if (map.getSource("kr")) map.getSource("kr").setData(data);
    else {
      map.addSource("kr", { type: "geojson", data: data });
      map.addLayer({ id: "kr-line-casing", type: "line", source: "kr", filter: ["==", ["get", "kind"], "line"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.85 } });
      map.addLayer({ id: "kr-line", type: "line", source: "kr", filter: ["==", ["get", "kind"], "line"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3 } });
      map.addLayer({ id: "kr-node", type: "circle", source: "kr", filter: ["==", ["get", "kind"], "node"], paint: { "circle-radius": 5.5, "circle-color": "#ffffff", "circle-stroke-color": ["case", ["==", ["get", "flag"], 1], "#f59e0b", ["get", "color"]], "circle-stroke-width": 2.2 } });
      map.addLayer({ id: "kr-seq", type: "symbol", source: "kr", filter: ["==", ["get", "kind"], "node"], layout: { "text-field": ["to-string", ["get", "seq"]], "text-size": 8.5, "text-font": ["Noto Sans Bold"], "text-allow-overlap": true }, paint: { "text-color": "#1a1a1a" } });
      map.addLayer({ id: "kr-head", type: "symbol", source: "kr", filter: ["==", ["get", "kind"], "head"], layout: { "icon-image": ["get", "pin"], "icon-anchor": "bottom", "icon-allow-overlap": true, "icon-size": 1.15 } });
    }
    var clock = $("krClock"), slider = $("krSlider");
    if (clock) clock.textContent = R.events.length ? hm(R.T) : "--:--";
    if (slider && R.t1 > R.start) slider.value = Math.round((R.T - R.start) / (R.t1 - R.start) * 1000);
    var pb = $("krPlay");
    if (pb) pb.innerHTML = sym(R.playing ? "pause" : "play_arrow");
  }
  function routeFit() {
    if (!R.map || !R.events.length) return;
    var xs = R.events.map(function (e) { return e.lon; }), ys = R.events.map(function (e) { return e.lat; });
    R.map.fitBounds([[d3.min(xs), d3.min(ys)], [d3.max(xs), d3.max(ys)]], { padding: 60, maxZoom: 16, duration: 0 });
  }
  function routePlay() {
    if (!R.events.length) return;
    if (R.T >= R.t1) { R.T = R.start; R.feed = []; clearBubbles(); }
    R.playing = true;
    R.last = performance.now();
    cancelAnimationFrame(R.raf);
    R.raf = requestAnimationFrame(tick);
    routeDraw();
  }
  function routePause() { R.playing = false; cancelAnimationFrame(R.raf); if (R.map) routeDraw(); }
  function tick(now) {
    if (!R.playing) return;
    var dt = Math.min(0.1, (now - R.last) / 1000), prev = R.T;
    R.last = now;
    R.T = Math.min(R.t1, R.T + dt * R.speed * 1000);
    R.events.forEach(function (e) { if (e.t > prev && e.t <= R.T && !R.hidden.has(e.e)) arrive(e); });
    routeDraw();
    if (R.T >= R.t1) { routePause(); return; }
    R.raf = requestAnimationFrame(tick);
  }
  function arrive(e) {
    R.feed.unshift(e);
    R.feed = R.feed.slice(0, 40);
    renderFeed();
    if (!R.map) return;
    var el = document.createElement("div");
    el.className = "kr-bubble";
    el.style.setProperty("--c", e.color);
    el.innerHTML = "<b>" + esc(e.e) + "</b><span>" + hm(e.t) + " · #" + e.seq + "</span>" + (e.name || e.desa ? "<em>" + esc([e.name, e.desa].filter(Boolean).join(" · ")) + "</em>" : "");
    var mk = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -30] }).setLngLat([e.lon, e.lat]).addTo(R.map);
    R.bubbles.push(mk);
    if (R.bubbles.length > 6) R.bubbles.shift().remove();
    setTimeout(function () { el.classList.add("out"); setTimeout(function () { mk.remove(); R.bubbles = R.bubbles.filter(function (b) { return b !== mk; }); }, 400); }, Math.max(1600, 3200));
  }
  function clearBubbles() { R.bubbles.forEach(function (b) { b.remove(); }); R.bubbles = []; }
  function renderEnums() {
    var box = $("krEnums");
    if (!box) return;
    box.innerHTML = R.groups.map(function (g) {
      return '<button data-g="' + esc(g.label) + '" class="' + (R.hidden.has(g.label) ? "off" : "") + '"><i style="background:' + g.color + '"></i><b>' + esc(g.label) + "</b><em>" + g.events.length + " · " + fmt(g.km, 1) + " km · " + hm(g.events[0].t) + "–" + hm(g.events[g.events.length - 1].t) + "</em></button>";
    }).join("") || '<div class="gis-empty">No located submissions on this day</div>';
  }
  function renderFeed() {
    var box = $("krFeed");
    if (!box) return;
    box.innerHTML = R.feed.map(function (e) {
      return '<div class="kd-feed-row"><span class="kd-sw" style="background:' + e.color + '"></span><div><b>' + esc(e.e) + " · #" + e.seq + "</b><span>" + esc([e.name, e.desa].filter(Boolean).join(" · ")) + "</span></div><em>" + hm(e.t) + "</em></div>";
    }).join("");
  }

  /* ------------------------------------------------------- data API */
  // Same contract as the GeoLibre Kobo Connector (window.__geolibreKobo),
  // served to Claude through the MCP bridge.

  var DERIVED = {
    _enumerator: "Enumerator name (label)", _desa: "Village (label)", _tanggal: "Survey date (dashboard basis)",
    _submission_date: "Date submitted to the server", _luas_ha: "Farm area in hectares", _validasi: "Kobo validation status", _durasi_menit: "Interview length (minutes)"
  };
  function aiValue(r, name, labels) {
    var a = r.__;
    switch (name) {
      case "_enumerator": return a.enumerator;
      case "_desa": return a.desa || null;
      case "_tanggal": return a.day;
      case "_submission_date": return a.subDay;
      case "_luas_ha": return a.luas;
      case "_validasi": return a.valid || null;
      case "_durasi_menit": return a.dur === null ? null : Math.round(a.dur * 10) / 10;
    }
    if (labels) { var s = display(r, name); return s === "" ? null : s; }
    return r[name] === undefined ? null : r[name];
  }
  function match(val, want) {
    if (Array.isArray(want)) return want.some(function (w) { return match(val, w); });
    if (want && typeof want === "object") {
      var n = num(val), s = String(val == null ? "" : val);
      if ("contains" in want && s.toLowerCase().indexOf(String(want.contains).toLowerCase()) < 0) return false;
      if ("gte" in want && !(n !== null ? n >= Number(want.gte) : s >= String(want.gte))) return false;
      if ("lte" in want && !(n !== null ? n <= Number(want.lte) : s <= String(want.lte))) return false;
      if ("gt" in want && !(n !== null && n > Number(want.gt))) return false;
      if ("lt" in want && !(n !== null && n < Number(want.lt))) return false;
      if ("ne" in want && s.trim().toLowerCase() === String(want.ne).trim().toLowerCase()) return false;
      if ("empty" in want && !!want.empty !== (val == null || String(val).trim() === "")) return false;
      return true;
    }
    return String(val == null ? "" : val).trim().toLowerCase() === String(want == null ? "" : want).trim().toLowerCase();
  }
  function dataset(source) {
    var src = source || "loaded", recs;
    if (src === "today") recs = K.rows.filter(function (r) { return r.__.day === today(); });
    else if (src === "visible") recs = filtered();
    else { src = "loaded"; recs = K.rows; }
    return { source: src, recs: recs };
  }
  function need(recs) {
    if (!K.asset) throw new Error("Ploots Kobo is not connected to a form. Open the Kobo panel, connect and pick a form.");
    if (!recs.length) throw new Error("No submissions in this dataset.");
  }
  function filterRecs(recs, where, q) {
    var out = recs;
    if (where && typeof where === "object") out = out.filter(function (r) {
      return Object.keys(where).every(function (k) { return match(aiValue(r, k, false), where[k]) || match(aiValue(r, k, true), where[k]); });
    });
    if (q) { var needle = String(q).toLowerCase(); out = out.filter(function (r) { return JSON.stringify(r).toLowerCase().indexOf(needle) >= 0; }); }
    return out;
  }
  function counts(recs, fn) {
    var m = new Map();
    recs.forEach(function (r) { var k = fn(r) || "(blank)"; m.set(k, (m.get(k) || 0) + 1); });
    return Array.from(m.entries()).sort(function (a, b) { return b[1] - a[1]; }).map(function (x) { return { key: x[0], n: x[1] }; });
  }
  K.api = {
    version: "1.0.0",
    summary: function (p) {
      p = p || {};
      var base = { app: "Ploots Click", connected: !!K.asset, form: K.asset ? K.asset.name : null, assetUid: K.asset ? K.asset.uid : null,
        loadedSubmissions: K.rows.length, dashboardFilter: Object.assign({}, K.filter), today: today(), updated: K.lastFetch ? new Date(K.lastFetch).toISOString() : null,
        autoRefreshMinutes: K.cfg.refreshMin, fieldMap: Object.assign({}, K.fm), derivedFields: Object.keys(DERIVED), qc: { minInterviewMin: K.cfg.minDur, maxGpsAccuracyM: K.cfg.maxAcc } };
      if (p.brief || !K.asset) return base;
      var ds = dataset(p.source), recs = ds.recs, luas = recs.map(function (r) { return r.__.luas; }).filter(function (v) { return v !== null; });
      var dsSorted = recs.map(function (r) { return r.__.day; }).sort();
      return Object.assign(base, {
        dataset: ds.source, records: recs.length,
        perEnumerator: counts(recs, function (r) { return r.__.enumerator; }),
        perDesa: K.fm.desa ? counts(recs, function (r) { return r.__.desa; }).slice(0, 60) : null,
        perTanggal: counts(recs, function (r) { return r.__.day; }).sort(function (a, b) { return String(a.key).localeCompare(String(b.key)); }),
        enumeratorsToday: counts(K.rows.filter(function (r) { return r.__.day === today(); }), function (r) { return r.__.enumerator; }),
        enumeratorsWithoutSubmissionToday: enumerators().filter(function (e) { return !K.rows.some(function (r) { return r.__.day === today() && r.__.enumerator === e; }); }),
        luasHa: luas.length ? { total: Math.round(d3.sum(luas) * 100) / 100, n: luas.length, mean: Math.round(d3.mean(luas) * 1000) / 1000 } : null,
        qcFlagged: recs.filter(function (r) { return r.__.flags.length; }).length,
        dateSpan: dsSorted.length ? { first: dsSorted[0], last: dsSorted[dsSorted.length - 1] } : null
      });
    },
    fields: function (p) {
      p = p || {};
      var withChoices = p.with_choices !== false;
      return {
        form: K.asset ? K.asset.name : null, derived: DERIVED,
        fields: Array.from(K.questions.values()).filter(function (q) { return !/^(begin|end)_/.test(q.type); }).map(function (q) {
          var it = { name: q.name, label: q.label, type: q.type };
          if (q.list && K.choices[q.list]) { var ks = Object.keys(K.choices[q.list]); it.choiceCount = ks.length; if (withChoices && ks.length <= 40) it.choices = K.choices[q.list]; }
          return it;
        })
      };
    },
    rows: function (p) {
      p = p || {};
      var ds = dataset(p.source);
      need(ds.recs);
      var list = filterRecs(ds.recs, p.where, p.q);
      if (p.sort_by) {
        var dir = p.descending ? -1 : 1;
        list = list.slice().sort(function (a, b) {
          var va = aiValue(a, p.sort_by, false), vb = aiValue(b, p.sort_by, false), na = num(va), nb = num(vb);
          return (na !== null && nb !== null ? na - nb : String(va == null ? "" : va).localeCompare(String(vb == null ? "" : vb), undefined, { numeric: true })) * dir;
        });
      }
      var cols = Array.isArray(p.fields) && p.fields.length ? p.fields : ["_id", "_enumerator", K.fm.name, "_desa", "_luas_ha", "_tanggal", "_durasi_menit", "_submission_time"].filter(Boolean);
      var n = Math.max(0, Math.min(+p.limit || 50, 2000)), start = Math.max(0, +p.offset || 0), labels = p.labels !== false;
      return { dataset: ds.source, total: ds.recs.length, matched: list.length, offset: start, fields: cols,
        rows: list.slice(start, start + n).map(function (r) { var o = {}; cols.forEach(function (c) { o[c] = c === "_id" || c === "_submission_time" ? r[c] : aiValue(r, c, labels); }); return o; }) };
    },
    aggregate: function (p) {
      p = p || {};
      var ds = dataset(p.source);
      need(ds.recs);
      var list = filterRecs(ds.recs, p.where, p.q), keys = (Array.isArray(p.by) ? p.by : [p.by || "_enumerator"]).filter(Boolean);
      var op = p.op || "count", value = p.value || null, labels = p.labels !== false, pivot = p.pivot || null;
      if (["count", "sum", "mean", "min", "max", "median", "count_distinct"].indexOf(op) < 0) throw new Error("op must be count, sum, mean, min, max, median or count_distinct.");
      if (op !== "count" && !value) throw new Error("op '" + op + "' needs 'value'.");
      var groups = new Map();
      list.forEach(function (r) {
        var kv = keys.map(function (k) { var v = aiValue(r, k, labels); return v == null || v === "" ? "(blank)" : String(v); });
        var pv = pivot ? String(aiValue(r, pivot, labels) == null ? "(blank)" : aiValue(r, pivot, labels)) : null;
        var id = JSON.stringify([kv, pv]), g = groups.get(id);
        if (!g) { g = { key: kv, pivot: pv, n: 0, vals: [], set: new Set() }; groups.set(id, g); }
        g.n++;
        if (value) {
          var raw = aiValue(r, value, op === "count_distinct" ? labels : false);
          if (op === "count_distinct") { if (raw != null && raw !== "") g.set.add(String(raw)); }
          else { var nv = num(raw); if (nv !== null) g.vals.push(nv); }
        }
      });
      var out = Array.from(groups.values()).map(function (g) {
        var v = op === "count" ? g.n : op === "count_distinct" ? g.set.size : !g.vals.length ? null :
          op === "sum" ? d3.sum(g.vals) : op === "mean" ? d3.mean(g.vals) : op === "min" ? d3.min(g.vals) : op === "max" ? d3.max(g.vals) : d3.median(g.vals);
        var row = { key: keys.length === 1 ? g.key[0] : g.key, n: g.n, value: v === null ? null : Math.round(v * 1e4) / 1e4 };
        if (pivot) row.pivot = g.pivot;
        return row;
      });
      if (p.sort === "key") out.sort(function (a, b) { return String(a.key).localeCompare(String(b.key), undefined, { numeric: true }) || String(a.pivot || "").localeCompare(String(b.pivot || "")); });
      else if (p.sort === "asc") out.sort(function (a, b) { return (a.value == null ? -Infinity : a.value) - (b.value == null ? -Infinity : b.value); });
      else out.sort(function (a, b) { return (b.value == null ? -Infinity : b.value) - (a.value == null ? -Infinity : a.value); });
      var total = out.length;
      return { dataset: ds.source, total: ds.recs.length, matched: list.length, by: keys, pivot: pivot, op: op, value: value, groups: total, result: out.slice(0, Math.min(+p.top || 500, 500)) };
    },
    load: function (p) {
      p = p || {};
      if (!K.asset) return Promise.reject(new Error("Ploots Kobo is not connected to a form."));
      if (p.from_date) K.filter.from = p.from_date;
      if (p.to_date) K.filter.to = p.to_date;
      return K.fetch(!K.rows.length).then(function () { return K.api.summary({ brief: true }); });
    },
    openDashboard: function () { openDashboard(); return true; }
  };

  /* ------------------------------------------------------------- boot */

  function boot() {
    build();
    // Re-open the last form after a reload when the token is remembered.
    if ((K.token || /demo\.kobo\.local/.test(server())) && K.cfg.assetUid) {
      K.connect().then(function () {
        if (K.assets.some(function (a) { return a.uid === K.cfg.assetUid; })) return K.openAsset(K.cfg.assetUid).then(function () { renderActive(); schedule(); });
      }).catch(function () { });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
