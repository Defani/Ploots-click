/* ==========================================================================
   GIS — Claude bridge and chat bubble.

   Connects GIS Consultant Studio to the geolibre-live MCP server (the same server as
   the GeoLibre "Live MCP Bridge" plugin), so Claude Desktop / Claude Code
   can read and drive this page and chat with you here:

     Claude  --stdio (MCP)-->  geolibre-live  <--ws://127.0.0.1:9878--  Ploots

   Ploots is the WebSocket client and speaks the plugin protocol:
     -> {type:"hello", token, plugin:{id,version}, app:{...}}
     <- {type:"welcome"} | {type:"reject", reason}
     <- {type:"request", id, method, params}
     -> {type:"response", id, ok, result | error}
   The server keeps one app connection; the newest one wins, so a GeoLibre
   window with the plugin and this page take turns rather than share it.

   Methods: ping, get_state, list_layers, get_project, get_layer_features,
   get_selection, screenshot, set_view, zoom_to_layer, set_basemap,
   add_geojson_layer, add_tile_layer, assistant_say, chat_wait, chat_inbox,
   chat_listen, show_chart and kobo_* (from 11-kobo.js). GeoLibre-only
   methods (ui_*, exec_js, activate_plugin) answer "not available".

   Chat: messages typed in the bubble queue in an outbox; Claude pulls them
   with chat_wait (listen mode, "dengar geolibre") or chat_inbox, and answers
   with assistant_say and show_chart (Plotly, loaded on first use).
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var VERSION = "1.0.0";
  var STORE = "ploots-bridge";
  var CHAT_KEY = STORE + ":chat";
  var LISTEN_GRACE = 90000;
  var MAX_ITEMS = 120;
  var PLOTLY = "https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js";

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function nowHM() { return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

  var cfg = { port: 9878, token: "", auto: false };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(STORE) || "{}")); } catch (e) { }
  function saveCfg() { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { } }

  var B = window.PlootsBridge = { state: "off", reason: "", history: [], outbox: [], waiters: [], waiting: 0, listenUntil: 0, typing: false, unread: 0 };

  /* -------------------------------------------------------- connection */

  var ws = null, retry = 0, retryTimer = 0, manualClose = false;

  function setState(s, reason) { B.state = s; B.reason = reason || ""; render(); }

  function connect() {
    clearTimeout(retryTimer);
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    manualClose = false;
    setState("connecting");
    var sock;
    try { sock = new WebSocket("ws://127.0.0.1:" + (+cfg.port || 9878)); } catch (e) { setState("off", e.message); return; }
    ws = sock;
    var welcomed = false;
    sock.onopen = function () {
      sock.send(JSON.stringify({ type: "hello", token: cfg.token || "", plugin: { id: "ploots-click", version: VERSION },
        app: { name: "GIS Consultant Studio", renderer: "maplibre", locale: navigator.language || "en", url: location.origin } }));
    };
    sock.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === "welcome") { welcomed = true; retry = 0; setState("on"); return; }
      if (msg.type === "reject") { manualClose = true; setState("rejected", msg.reason || "Rejected"); sock.close(); return; }
      if (msg.type === "request") handle(sock, msg);
    };
    sock.onclose = function (ev) {
      if (ws === sock) ws = null;
      if (B.state === "rejected") return;
      // A normal close after the welcome means another app took the bridge.
      if (welcomed && ev.code === 1000) { setState("replaced", "Another app is using the bridge."); return; }
      setState("off", welcomed ? "Disconnected" : "Bridge server not running");
      if (!manualClose && cfg.auto) {
        retry = Math.min(retry + 1, 6);
        retryTimer = setTimeout(connect, Math.min(10000, 1000 * Math.pow(1.6, retry)));
      }
    };
    sock.onerror = function () { };
  }
  function disconnect() {
    manualClose = true;
    clearTimeout(retryTimer);
    if (ws) ws.close();
    ws = null;
    setState("off");
  }
  B.connect = connect;
  B.disconnect = disconnect;

  function handle(sock, msg) {
    var fn = HANDLERS[msg.method];
    Promise.resolve().then(function () {
      if (!fn) throw new Error("Method '" + msg.method + "' is not available in GIS Consultant Studio.");
      return fn(msg.params || {});
    }).then(function (result) {
      send(sock, { type: "response", id: msg.id, ok: true, result: result === undefined ? null : result });
    }).catch(function (e) {
      send(sock, { type: "response", id: msg.id, ok: false, error: (e && e.message) || String(e) });
    });
  }
  function send(sock, obj) { if (sock.readyState === 1) sock.send(JSON.stringify(obj)); }

  /* ---------------------------------------------------------- helpers */

  function map() { return GIS.map && GIS.map(); }
  function needMap() {
    var m = map();
    if (!m) throw new Error("The map is not open. Switch GIS Consultant Studio to the Map workspace first.");
    return m;
  }
  function findLayer(ref) {
    var s = String(ref || "").trim().toLowerCase();
    var l = GIS.layers.filter(function (x) { return x.id.toLowerCase() === s; })[0] || GIS.layers.filter(function (x) { return x.name.toLowerCase() === s; })[0];
    if (!l) throw new Error("No layer '" + ref + "'. Layers: " + GIS.layers.map(function (x) { return x.name; }).join(", "));
    return l;
  }
  function layerInfo(l) {
    var o = { id: l.id, name: l.name, kind: l.kind, visible: l.visible, opacity: l.opacity };
    if (l.kind === "vector") { o.features = l.data.features.length; o.geometry = GIS.geometryKind(l); o.selected = l.selection.size; o.symbology = l.style.symbology; o.field = l.style.field || null; if (l.filter) o.filter = l.filter; }
    if (l.url) o.url = l.url;
    return o;
  }
  function camera() {
    var m = map();
    if (!m) return null;
    var c = m.getCenter(), b = m.getBounds();
    return { center: [+c.lng.toFixed(6), +c.lat.toFixed(6)], zoom: +m.getZoom().toFixed(2), bearing: +m.getBearing().toFixed(1), pitch: +m.getPitch().toFixed(1),
      bounds: [+b.getWest().toFixed(6), +b.getSouth().toFixed(6), +b.getEast().toFixed(6), +b.getNorth().toFixed(6)], scale: GIS.getScale ? Math.round(GIS.getScale()) : null };
  }
  function round(c) { return Array.isArray(c) ? c.map(round) : typeof c === "number" ? Math.round(c * 1e6) / 1e6 : c; }
  function saveView() {
    var m = map();
    if (!m) return;
    var c = m.getCenter();
    state.mapView = { center: [c.lng, c.lat], zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
  }
  function kobo() { return window.PlootsKobo && window.PlootsKobo.api; }
  function needKobo() { var k = kobo(); if (!k) throw new Error("The Kobo module is not loaded."); return k; }

  /* --------------------------------------------------------- handlers */

  var HANDLERS = {};
  HANDLERS.ping = function () { return { pong: true, app: "GIS Consultant Studio", version: VERSION }; };
  HANDLERS.get_state = function () {
    var k = kobo(), act = GIS.active && GIS.active();
    return {
      app: "GIS Consultant Studio", version: VERSION, mode: document.body.classList.contains("gis-mode") ? "map" : "chart",
      camera: camera(), basemap: state.mapBasemap, layers: GIS.layers.map(layerInfo), activeLayer: act ? act.id : null,
      koboDashboardOpen: document.body.classList.contains("kobo-dash-open"),
      kobo: k ? k.summary({ brief: true }) : null
    };
  };
  HANDLERS.list_layers = function () { return { layers: GIS.layers.map(layerInfo), basemap: state.mapBasemap }; };
  HANDLERS.get_project = function () {
    var s = {};
    Object.keys(state).forEach(function (k) { if (/^map[A-Z]/.test(k)) s[k] = state[k]; });
    return { app: "GIS Consultant Studio", map: s, layers: GIS.layers.map(layerInfo) };
  };
  HANDLERS.get_layer_features = function (p) {
    var l = findLayer(p.layer);
    if (l.kind !== "vector") throw new Error("'" + l.name + "' is not a vector layer.");
    var lim = Math.max(0, Math.min(+p.limit || 50, 5000)), off = Math.max(0, +p.offset || 0), b = GIS.bounds([Object.assign({}, l, { visible: true })]);
    return { layer: layerInfo(l), total: l.data.features.length, fields: GIS.fields(l).all, bbox: b ? [b[0][0], b[0][1], b[1][0], b[1][1]] : null, offset: off,
      features: l.data.features.slice(off, off + lim).map(function (f, i) { var o = { index: off + i, properties: f.properties }; if (p.include_geometry) o.geometry = { type: f.geometry.type, coordinates: round(f.geometry.coordinates) }; return o; }) };
  };
  HANDLERS.get_selection = function (p) {
    var lim = Math.max(0, Math.min(+p.limit || 50, 5000));
    return { selected: GIS.layers.filter(function (l) { return l.kind === "vector" && l.selection.size; }).map(function (l) {
      var idx = Array.from(l.selection).sort(function (a, b) { return a - b; });
      return { layer: l.name, layerId: l.id, count: idx.length, features: idx.slice(0, lim).map(function (i) { var f = l.data.features[i], o = { index: i, properties: f.properties }; if (p.include_geometry) o.geometry = { type: f.geometry.type, coordinates: round(f.geometry.coordinates) }; return o; }) };
    }) };
  };
  HANDLERS.screenshot = function (p) {
    var m = needMap();
    return new Promise(function (resolve) { m.once("render", function () { resolve(); }); m.triggerRepaint(); setTimeout(resolve, 800); }).then(function () {
      var src = m.getCanvas(), w = src.width, h = src.height, k = Math.min(1, (+p.max_width || 1280) / w);
      var c = document.createElement("canvas");
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      var x = c.getContext("2d");
      x.fillStyle = "#ffffff"; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(src, 0, 0, c.width, c.height);
      var fmtStr = p.format === "png" ? "image/png" : "image/jpeg";
      return { data: c.toDataURL(fmtStr, 0.85).split(",")[1], width: c.width, height: c.height, format: p.format === "png" ? "png" : "jpeg", camera: camera() };
    });
  };
  HANDLERS.set_view = function (p) {
    var m = needMap(), d = +p.duration || 0;
    if (Array.isArray(p.bbox) && p.bbox.length === 4) m.fitBounds([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { padding: 30, duration: d });
    else {
      var o = { duration: d };
      if (p.center) o.center = p.center;
      if (p.zoom != null) o.zoom = +p.zoom;
      if (p.bearing != null) o.bearing = +p.bearing;
      if (p.pitch != null) o.pitch = +p.pitch;
      d ? m.easeTo(o) : m.jumpTo(o);
    }
    return new Promise(function (r) { setTimeout(r, d + 60); }).then(function () { saveView(); return camera(); });
  };
  HANDLERS.zoom_to_layer = function (p) {
    var l = findLayer(p.layer);
    needMap();
    GIS.mapActions.zoomToLayer(l);
    return { layer: l.name, camera: camera() };
  };
  HANDLERS.set_basemap = function (p) {
    var want = String(p.style_url || p.basemap || "").trim(), low = want.toLowerCase();
    var b = GIS.BASEMAPS.filter(function (x) { return x.id === low || x.style === want || x.tiles === want || (x.style && low.indexOf("/styles/" + x.id) >= 0) || x.label.toLowerCase() === low; })[0];
    if (!b) throw new Error("Unknown basemap. Available: " + GIS.BASEMAPS.map(function (x) { return x.id; }).join(", "));
    state.mapBasemap = b.id;
    if (typeof render === "function") render();
    if (GIS.refreshPanel) GIS.refreshPanel();
    return { basemap: b.id, label: b.label };
  };
  HANDLERS.add_geojson_layer = function (p) {
    GIS.enterMapMode();
    var l = GIS.addVector(p.geojson, p.name || "Layer");
    return layerInfo(l);
  };
  HANDLERS.add_tile_layer = function (p) {
    if (!/\{z\}/.test(p.url || "")) throw new Error("The URL needs {z}, {x} and {y}.");
    GIS.enterMapMode();
    var l = GIS.addXYZ(p.url, p.name || "Tiles", p.attribution || "");
    if (p.opacity != null) { l.opacity = +p.opacity; GIS.emit("style"); }
    return layerInfo(l);
  };
  ["ui_list", "ui_click", "ui_hover", "ui_type", "ui_key", "ui_read", "exec_js", "activate_plugin"].forEach(function (m) {
    HANDLERS[m] = function () { throw new Error(m + " is a GeoLibre-only tool and is not available in GIS Consultant Studio."); };
  });
  ["summary", "fields", "rows", "aggregate", "load"].forEach(function (m) {
    HANDLERS["kobo_" + m] = function (p) { return needKobo()[m](p || {}); };
  });

  /* ------------------------------------------------------------- chat */

  function isListening() { return B.waiting > 0 || Date.now() < B.listenUntil; }
  function loadChat() {
    try {
      var d = JSON.parse(localStorage.getItem(CHAT_KEY) || "{}");
      if (Array.isArray(d.history)) B.history = d.history;
      if (Array.isArray(d.outbox)) B.outbox = d.outbox;
    } catch (e) { }
  }
  function saveChat() {
    try { localStorage.setItem(CHAT_KEY, JSON.stringify({ history: B.history.slice(-MAX_ITEMS).map(function (h) { var o = Object.assign({}, h); return o; }), outbox: B.outbox })); } catch (e) { }
  }
  function push(item) {
    B.history.push(item);
    if (B.history.length > MAX_ITEMS) B.history.splice(0, B.history.length - MAX_ITEMS);
    if (item.role !== "user" && !isOpen()) B.unread++;
    saveChat();
    render();
  }

  function context() {
    var ctx = { app: "GIS Consultant Studio" }, k = kobo();
    try {
      var cam = camera();
      if (cam) { ctx.center = cam.center; ctx.zoom = cam.zoom; ctx.bounds = cam.bounds; }
      var act = GIS.active && GIS.active();
      if (act) ctx.selectedLayer = { id: act.id, name: act.name };
      if (k && window.PlootsKobo.asset) { ctx.source = "kobo-connector"; ctx.kobo = k.summary({ brief: true }); }
    } catch (e) { }
    return ctx;
  }
  function sendUser(text) {
    text = String(text || "").trim();
    if (!text) return;
    var id = "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), time = nowHM();
    B.outbox.push({ id: id, text: text, time: time, ts: new Date().toISOString(), context: context() });
    push({ role: "user", id: id, text: text, time: time, state: "queued" });
    if (B.waiters.length) B.waiters.shift()();
  }
  B.send = sendUser;
  function drain(max) {
    var out = B.outbox.splice(0, max || 20), ids = new Set(out.map(function (m) { return m.id; }));
    B.history.forEach(function (h) { if (h.role === "user" && ids.has(h.id)) h.state = "read"; });
    if (out.length) B.typing = true;
    saveChat();
    render();
    return out;
  }

  HANDLERS.chat_wait = function (p) {
    var limit = Math.max(1, Math.min(+p.timeout_s || 45, 300)) * 1000;
    B.waiting++;
    render();
    return new Promise(function (resolve) {
      var done = false, timer;
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        B.waiters = B.waiters.filter(function (w) { return w !== finish; });
        B.waiting = Math.max(0, B.waiting - 1);
        B.listenUntil = Date.now() + LISTEN_GRACE;
        resolve({ messages: drain(p.max), listening: true, waitedMs: limit });
      }
      timer = setTimeout(finish, limit);
      if (B.outbox.length) finish(); else B.waiters.push(finish);
    });
  };
  HANDLERS.chat_inbox = function (p) {
    if (p.mark_read === false) return { messages: B.outbox.slice(0, p.max || 20), listening: isListening() };
    return { messages: drain(p.max), listening: isListening() };
  };
  HANDLERS.chat_listen = function (p) {
    if (p.listening) B.listenUntil = Date.now() + LISTEN_GRACE;
    else { B.listenUntil = 0; B.typing = false; B.waiters.slice().forEach(function (w) { w(); }); }
    if (p.note) push({ role: "system", text: String(p.note), time: nowHM() });
    render();
    return { listening: isListening(), queued: B.outbox.length };
  };
  HANDLERS.assistant_say = function (p) {
    var status = p.status || "info";
    if (["greeting", "working", "done", "info"].indexOf(status) < 0) throw new Error("status must be greeting, working, done or info.");
    var text = p.message && String(p.message).trim() ? String(p.message) :
      { greeting: "Hi! What would you like to do?", working: "On it:", done: "Done. Anything to change?", info: "" }[status];
    var tasks = Array.isArray(p.tasks) ? p.tasks.map(String) : p.task ? [String(p.task)] : [];
    var last = B.history[B.history.length - 1];
    if (p.question) {
      var lastUser = B.history.filter(function (h) { return h.role === "user"; }).pop();
      if (!lastUser || lastUser.text.trim() !== String(p.question).trim()) push({ role: "user", text: String(p.question), time: nowHM(), state: "read", via: "claude" });
      last = null;
    }
    B.typing = status === "working";
    // working -> done update the same answer: the latest "working" message
    // since the last user message, even when a chart came in between.
    if (!p.question) {
      last = null;
      for (var i = B.history.length - 1; i >= 0 && B.history[i].role !== "user"; i--) if (B.history[i].role === "bot" && B.history[i].status === "working") { last = B.history[i]; break; }
    }
    if (last) {
      last.status = status; last.text = text || last.text; if (tasks.length) last.tasks = tasks; last.time = nowHM();
      saveChat(); render();
    } else push({ role: "bot", text: text, status: status, tasks: tasks, time: nowHM() });
    if (status === "done") toast(text || "Done");
    return { shown: true, status: status, message: text, messages: B.history.length };
  };
  HANDLERS.show_chart = function (p) {
    var fig = p.figure || { data: p.data || [], layout: p.layout || {}, config: p.config || {} };
    if (!Array.isArray(fig.data) || !fig.data.length) throw new Error("A chart needs at least one trace in 'data'.");
    B.typing = false;
    push({ role: "bot", text: p.message || "", time: nowHM(), chart: { data: fig.data, layout: fig.layout || {}, config: fig.config || {}, title: p.title || "", caption: p.caption || "" } });
    return { shown: true, traces: fig.data.length };
  };

  /* --------------------------------------------------------------- UI */

  var ui = null, chartNodes = new WeakMap(), plotlyP = null;

  function ensurePlotly() {
    if (window.Plotly) return Promise.resolve();
    if (!plotlyP) plotlyP = new Promise(function (res, rej) { var s = document.createElement("script"); s.src = PLOTLY; s.onload = res; s.onerror = function () { plotlyP = null; rej(new Error("Plotly failed to load")); }; document.head.appendChild(s); });
    return plotlyP;
  }
  function chartNode(item) {
    var n = chartNodes.get(item);
    if (n) return n;
    n = document.createElement("div");
    n.className = "pb-chart";
    var c = item.chart, box = document.createElement("div");
    if (c.title) n.innerHTML = "<b>" + esc(c.title) + "</b>";
    n.appendChild(box);
    if (c.caption) n.insertAdjacentHTML("beforeend", "<em>" + esc(c.caption) + "</em>");
    var dark = document.documentElement.getAttribute("data-theme") === "dark", ink = dark ? "#eef0f2" : "#1a1a1a";
    ensurePlotly().then(function () {
      var layout = Object.assign({ height: 260, margin: { l: 44, r: 10, t: 10, b: 30 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
        font: { family: "Inter, Segoe UI, Arial, sans-serif", size: 11, color: ink }, colorway: ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#65a30d"],
        legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom" } }, c.layout || {});
      window.Plotly.newPlot(box, c.data, layout, Object.assign({ displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d"] }, c.config || {}));
    }).catch(function (e) { box.textContent = e.message; });
    chartNodes.set(item, n);
    return n;
  }

  function build() {
    if (ui) return;
    var launch = document.createElement("button");
    launch.type = "button";
    launch.className = "pb-launch";
    launch.title = "Claude";
    launch.innerHTML = sym("auto_awesome") + '<i class="pb-dot"></i><b class="pb-badge" hidden></b>';
    var card = document.createElement("div");
    card.className = "pb-chat";
    card.hidden = true;
    card.innerHTML =
      '<div class="pb-head"><div class="pb-avatar">' + sym("auto_awesome") + '</div><div class="pb-who"><b>Claude</b><span class="pb-status"></span></div>' +
        '<button data-pb="settings" title="Connection">' + sym("settings_ethernet") + '</button><button data-pb="clear" title="Clear chat">' + sym("delete_sweep") + '</button><button data-pb="close" title="Close">' + sym("close") + "</button></div>" +
      '<div class="pb-settings" hidden>' +
        '<div class="pb-set-row"><label>Port<input type="number" data-set="port" min="1" max="65535"></label><label>Token<input type="password" data-set="token" autocomplete="off"></label></div>' +
        '<label class="pb-check"><input type="checkbox" data-set="auto"> Connect automatically</label>' +
        '<div class="pb-set-row"><button data-pb="connect" class="btn-primary"></button><span class="pb-reason"></span></div>' +
      "</div>" +
      '<div class="pb-log"></div>' +
      '<div class="pb-chips"></div>' +
      '<div class="pb-compose"><textarea rows="1" placeholder="Message Claude"></textarea><button data-pb="send" title="Send">' + sym("arrow_upward") + "</button></div>";
    document.body.appendChild(launch);
    document.body.appendChild(card);
    ui = { launch: launch, card: card, log: card.querySelector(".pb-log"), input: card.querySelector("textarea"), status: card.querySelector(".pb-status"),
      settings: card.querySelector(".pb-settings"), chips: card.querySelector(".pb-chips") };

    launch.addEventListener("click", function () { card.hidden ? open() : close(); });
    card.addEventListener("click", function (e) {
      var b = e.target.closest("[data-pb]");
      if (!b) { var chip = e.target.closest("[data-chip]"); if (chip) sendUser(chip.dataset.chip); return; }
      var a = b.dataset.pb;
      if (a === "close") close();
      else if (a === "settings") ui.settings.hidden = !ui.settings.hidden;
      else if (a === "clear") { B.history = []; saveChat(); render(); }
      // Connecting by hand also turns on auto-connect for the next visit.
      else if (a === "connect") { if (B.state === "on" || B.state === "connecting") { cfg.auto = false; disconnect(); } else { cfg.auto = true; connect(); } saveCfg(); render(); }
      else if (a === "send") { sendUser(ui.input.value); ui.input.value = ""; autosize(); }
    });
    card.addEventListener("change", function (e) {
      var t = e.target, k = t.dataset && t.dataset.set;
      if (!k) return;
      cfg[k] = t.type === "checkbox" ? t.checked : t.type === "number" ? +t.value : t.value.trim();
      saveCfg();
    });
    ui.input.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendUser(ui.input.value); ui.input.value = ""; autosize(); }
    });
    ui.input.addEventListener("input", autosize);
    ["keyup", "keypress"].forEach(function (t) { ui.input.addEventListener(t, function (e) { e.stopPropagation(); }); });
    setInterval(function () { if (B.listenUntil && Date.now() > B.listenUntil && !B.waiting) render(); }, 5000);
    render();
  }
  function autosize() { var t = ui.input; t.style.height = "auto"; t.style.height = Math.min(120, t.scrollHeight) + "px"; }
  function isOpen() { return ui && !ui.card.hidden; }
  function open() {
    ui.card.hidden = false;
    B.unread = 0;
    if (!B.history.length) B.history.push({ role: "bot", text: "Hi! Ask me about the map or your Kobo survey. I read messages while listening.", status: "info", time: nowHM() });
    render();
    setTimeout(function () { ui.input.focus(); ui.log.scrollTop = ui.log.scrollHeight; }, 0);
  }
  function close() { ui.card.hidden = true; render(); }
  B.open = function () { build(); open(); };

  function toast(text) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast("Claude: " + text); }

  var lastSig = "";
  function render() {
    if (!ui) return;
    var st = B.state, on = st === "on", listening = on && isListening();
    ui.launch.dataset.state = listening ? "listening" : st;
    var badge = ui.launch.querySelector(".pb-badge");
    badge.hidden = !B.unread || isOpen();
    badge.textContent = B.unread > 9 ? "9+" : B.unread;
    ui.status.dataset.state = listening ? "listening" : st;
    ui.status.textContent = listening ? (B.typing ? "Typing…" : "Listening") :
      on ? "Connected · not listening" + (B.outbox.length ? " · " + B.outbox.length + " waiting" : "") :
      st === "connecting" ? "Connecting…" : st === "rejected" ? "Rejected: " + B.reason : st === "replaced" ? "Bridge in use by another app" : "Offline";
    var btn = ui.card.querySelector('[data-pb="connect"]');
    btn.textContent = on || st === "connecting" ? "Disconnect" : "Connect";
    ui.card.querySelector(".pb-reason").textContent = on ? "ws://127.0.0.1:" + cfg.port : B.reason;
    ui.card.querySelector('[data-set="port"]').value = cfg.port;
    var tok = ui.card.querySelector('[data-set="token"]');
    if (document.activeElement !== tok) tok.value = cfg.token || "";
    ui.card.querySelector('[data-set="auto"]').checked = !!cfg.auto;
    var koboOn = window.PlootsKobo && window.PlootsKobo.asset;
    var chips = koboOn ? ["Summarize today's submissions", "Chart submissions per enumerator per day", "Who has not submitted today?", "Which submissions have quality flags?"]
      : ["What is on the map?", "Zoom to the active layer", "Take a screenshot of the map"];
    var chipSig = chips.join("|");
    if (ui.chips.dataset.sig !== chipSig) { ui.chips.dataset.sig = chipSig; ui.chips.innerHTML = chips.map(function (c) { return '<button type="button" data-chip="' + esc(c) + '">' + esc(c) + "</button>"; }).join(""); }
    var sig = B.history.length + "|" + B.history.map(function (h) { return h.role + (h.state || "") + (h.status || "") + (h.text || "").length + (h.tasks ? h.tasks.length : 0); }).join(",") + "|" + B.typing + listening;
    if (sig === lastSig) return;
    lastSig = sig;
    var near = ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 80;
    ui.log.replaceChildren.apply(ui.log, B.history.map(item).concat(B.typing && listening ? [typingNode()] : []));
    if (near || (B.history.length && B.history[B.history.length - 1].role === "user")) ui.log.scrollTop = ui.log.scrollHeight;
  }
  function item(h) {
    var n = document.createElement("div");
    if (h.role === "system") { n.className = "pb-note"; n.textContent = h.text; return n; }
    n.className = "pb-msg " + (h.role === "user" ? "me" : "bot") + (h.status ? " s-" + h.status : "");
    var body = "";
    if (h.text) body += '<div class="pb-text">' + esc(h.text) + "</div>";
    if (h.tasks && h.tasks.length) body += '<ul class="pb-tasks">' + h.tasks.map(function (t) {
      return "<li>" + (h.status === "working" ? '<i class="pb-spin"></i>' : sym("check_circle")) + esc(t) + "</li>";
    }).join("") + "</ul>";
    body += '<div class="pb-meta">' + h.time + (h.role === "user" ? (h.via === "claude" ? " · from Claude" : h.state === "read" ? " ✓✓" : " ✓") : "") + "</div>";
    n.innerHTML = body;
    if (h.chart) n.insertBefore(chartNode(h), n.querySelector(".pb-meta"));
    return n;
  }
  function typingNode() { var n = document.createElement("div"); n.className = "pb-msg bot pb-typing"; n.innerHTML = "<i></i><i></i><i></i>"; return n; }

  /* ------------------------------------------------------------- boot */

  function boot() {
    loadChat();
    build();
    var Lk = window.PlootsLock;
    if (!Lk) { if (cfg.auto) connect(); return; }
    // Claude cannot read or drive the app while it is locked.
    Lk.whenUnlocked(function () { if (cfg.auto) connect(); });
    Lk.onLock(function () { if (ws) { manualClose = true; clearTimeout(retryTimer); ws.close(); } if (ui) ui.card.hidden = true; });
    Lk.onUnlock(function () { if (cfg.auto && !ws) connect(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
