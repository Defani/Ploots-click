/* ==========================================================================
   Plugins — install, enable and write add-ons for Ploots Click.

   Works like GeoLibre plugins. A plugin is a folder (or a .zip of it) with
   a manifest and one ES module:

     plugin.json   { "id", "name", "version", "entry": "index.js",
                     "style"?: "style.css", "description"?, "author"?,
                     "icon"?: Material Symbols name }
     index.js      export default { activate(app) {…}, deactivate(app) {…} }

   The entry must be a single bundled module (relative imports are not
   resolved). Other files in the plugin (images, JSON, CSS) are reachable
   through app.assetUrl("path/in/plugin").

   Plugins are stored in IndexedDB (web and desktop app alike) and the
   enabled ones load at startup. Everything a plugin adds through `app`
   (toolbar buttons, panels, styles, listeners) is removed automatically
   when it is disabled or removed.

   The Plugins panel (rail → Plugins) installs from a .zip, a folder or a
   manifest URL, enables / disables / removes plugins, and "New plugin"
   downloads a starter plugin to edit. See PLUGINS.md for the full API.
   ========================================================================== */
(function () {
  "use strict";

  var APP_VERSION = "1.0.0";
  var API_VERSION = 1;
  var PANEL_ID = "panel-plugins";
  var DB_NAME = "ploots-plugins", STORE = "plugins";
  var MAX_FILE = 50 * 1024 * 1024;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function sym(n) { return '<span class="material-symbols-outlined">' + esc(n) + "</span>"; }
  var ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;

  /* ------------------------------------------------------------- zip */
  // Minimal reader for .zip files: stored and deflate entries, through the
  // browser's DecompressionStream. Enough for plugin archives.

  function readZip(buf) {
    var dv = new DataView(buf), n = buf.byteLength, eocd = -1;
    for (var i = n - 22; i >= Math.max(0, n - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return Promise.reject(new Error("Not a .zip file."));
    var count = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true), entries = [];
    var dec = new TextDecoder();
    for (var k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) return Promise.reject(new Error("Damaged .zip file."));
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      var nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      var name = dec.decode(new Uint8Array(buf, p + 46, nlen)).replace(/\\/g, "/");
      p += 46 + nlen + xlen + clen;
      if (/\/$/.test(name) || /(^|\/)(__MACOSX|\.DS_Store)/.test(name)) continue;
      if (usize > MAX_FILE) return Promise.reject(new Error(name + " is too large."));
      var loc = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      entries.push({ name: name, method: method, data: new Uint8Array(buf, loc, csize) });
    }
    return Promise.all(entries.map(function (e) {
      if (e.method === 0) return Promise.resolve([e.name, e.data.slice().buffer]);
      if (e.method !== 8) return Promise.reject(new Error(e.name + ": unsupported compression."));
      var ds = new DecompressionStream("deflate-raw");
      return new Response(new Blob([e.data]).stream().pipeThrough(ds)).arrayBuffer().then(function (b) { return [e.name, b]; });
    })).then(function (list) { var files = {}; list.forEach(function (x) { files[x[0]] = x[1]; }); return files; });
  }

  // Writer for "New plugin" (stored entries, no compression).
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { var c = 0xffffffff; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function writeZip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    Object.keys(files).forEach(function (name) {
      var data = typeof files[name] === "string" ? enc.encode(files[name]) : new Uint8Array(files[name]), nm = enc.encode(name), crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
      parts.push(h.buffer, nm, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, nm);
      offset += 30 + nm.length + data.length;
    });
    var csize = central.reduce(function (s, b) { return s + b.byteLength; }, 0), e = new DataView(new ArrayBuffer(22)), count = Object.keys(files).length;
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, count, true); e.setUint16(10, count, true); e.setUint32(12, csize, true); e.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [e.buffer]), { type: "application/zip" });
  }

  /* ------------------------------------------------------------ store */

  var dbP = null;
  function db() {
    if (!dbP) dbP = new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE, { keyPath: "id" }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbP;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(STORE, mode), s = t.objectStore(STORE), out = fn(s);
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  function dbAll() { return tx("readonly", function (s) { return s.getAll(); }); }
  function dbPut(rec) { return tx("readwrite", function (s) { s.put(rec); }); }
  function dbDel(id) { return tx("readwrite", function (s) { s.delete(id); }); }

  /* ---------------------------------------------------------- bundles */
  // files: { "path": ArrayBuffer }. The manifest may sit in a top folder.
  function toRecord(files, source) {
    var names = Object.keys(files), man = names.filter(function (n) { return /(^|\/)plugin\.json$/.test(n); }).sort(function (a, b) { return a.length - b.length; })[0];
    if (!man) throw new Error("plugin.json is missing.");
    var root = man.slice(0, man.length - "plugin.json".length), out = {};
    names.forEach(function (n) { if (n.indexOf(root) === 0) out[n.slice(root.length)] = files[n]; });
    var m;
    try { m = JSON.parse(new TextDecoder().decode(out["plugin.json"])); } catch (e) { throw new Error("plugin.json is not valid JSON."); }
    if (!m || !ID_RE.test(String(m.id || ""))) throw new Error("plugin.json needs an \"id\" (lowercase letters, digits, . _ -).");
    if (!m.name) m.name = m.id;
    m.entry = String(m.entry || "index.js").replace(/^\.\//, "");
    if (!out[m.entry]) throw new Error("The entry file " + m.entry + " is missing.");
    if (m.style) { m.style = String(m.style).replace(/^\.\//, ""); if (!out[m.style]) throw new Error("The style file " + m.style + " is missing."); }
    return { id: m.id, manifest: m, files: out, enabled: true, source: source, installedAt: Date.now() };
  }

  /* ----------------------------------------------------------- runtime */

  var loaded = {};       // id -> { rec, urls, module, api, cleanups, error, active }
  var records = [];      // installed records (without being loaded)
  var listeners = [];
  function changed() { listeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); renderList(); }

  function mimeOf(p) {
    var ext = (p.split(".").pop() || "").toLowerCase();
    return { js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", geojson: "application/geo+json", csv: "text/csv", txt: "text/plain", html: "text/html" }[ext] || "application/octet-stream";
  }

  function activate(rec) {
    if (loaded[rec.id] && loaded[rec.id].active) return Promise.resolve();
    var L = loaded[rec.id] = { rec: rec, urls: {}, cleanups: [], error: null, active: false };
    Object.keys(rec.files).forEach(function (p) { L.urls[p] = URL.createObjectURL(new Blob([rec.files[p]], { type: mimeOf(p) })); });
    if (rec.manifest.style) {
      var link = document.createElement("link");
      link.rel = "stylesheet"; link.href = L.urls[rec.manifest.style]; link.dataset.plugin = rec.id;
      document.head.appendChild(link);
      L.cleanups.push(function () { link.remove(); });
    }
    return import(L.urls[rec.manifest.entry]).then(function (mod) {
      var plugin = mod.default || mod.plugin || mod;
      if (!plugin || typeof plugin.activate !== "function") throw new Error("The entry module must export default { activate(app) }.");
      L.module = plugin;
      L.api = makeApi(rec, L);
      return plugin.activate(L.api);
    }).then(function () {
      L.active = true;
      changed();
    }).catch(function (e) {
      L.error = (e && e.message) || String(e);
      console.error("[plugin " + rec.id + "]", e);
      teardown(rec.id, true);
      L.error = (e && e.message) || String(e);
      changed();
    });
  }

  function teardown(id, keepError) {
    var L = loaded[id];
    if (!L) return;
    if (L.active && L.module && typeof L.module.deactivate === "function") {
      try { L.module.deactivate(L.api); } catch (e) { console.error("[plugin " + id + "] deactivate", e); }
    }
    L.dead = true;
    L.cleanups.splice(0).reverse().forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
    Object.keys(L.urls).forEach(function (p) { URL.revokeObjectURL(L.urls[p]); });
    L.active = false;
    if (!keepError) delete loaded[id];
  }

  /* --------------------------------------------------------------- API */

  function makeApi(rec, L) {
    var id = rec.id;
    function onCleanup(fn) { L.cleanups.push(fn); return fn; }
    // Callbacks stop running once the plugin is disabled or removed.
    function guard(fn) { return function () { if (L.dead) return; return fn.apply(this, arguments); }; }
    var GIS = window.PlootsGIS;
    function layerRef(ref) {
      var s = String(ref == null ? "" : ref).toLowerCase();
      return GIS.layers.filter(function (l) { return l.id.toLowerCase() === s || l.name.toLowerCase() === s; })[0] || null;
    }
    var storeKey = "ploots-plugin:" + id + ":";

    var app = {
      apiVersion: API_VERSION,
      appVersion: APP_VERSION,
      plugin: { id: id, name: rec.manifest.name, version: rec.manifest.version || "" },
      desktop: !!window.__TAURI__,
      onCleanup: onCleanup,
      assetUrl: function (p) { return L.urls[String(p).replace(/^\.\//, "")] || null; },
      log: function () { console.log.apply(console, ["[plugin " + id + "]"].concat([].slice.call(arguments))); },

      ui: {
        toast: function (msg) { toast(msg); },
        addStyle: function (css) {
          var s = document.createElement("style");
          s.dataset.plugin = id; s.textContent = String(css);
          document.head.appendChild(s);
          return onCleanup(function () { s.remove(); });
        },
        addToolbarButton: function (o) {
          o = o || {};
          var g = pluginToolGroup(), b = document.createElement("button");
          b.type = "button"; b.className = "tool-btn tb-btn"; b.title = o.title || o.label || rec.manifest.name; b.dataset.plugin = id;
          b.innerHTML = sym(o.icon || rec.manifest.icon || "extension") + (o.label ? '<span class="tb-lbl">' + esc(o.label) + "</span>" : "");
          b.addEventListener("click", guard(function (e) { if (o.onClick) o.onClick(e); }));
          g.appendChild(b);
          var remove = onCleanup(function () { b.remove(); if (!g.children.length) g.remove(); });
          return { el: b, remove: remove, setActive: function (on) { b.classList.toggle("on", !!on); } };
        },
        addPanel: function (o) {
          o = o || {};
          var pid = "panel-plugin-" + id.replace(/[^a-z0-9_-]/g, "-") + "-" + (o.id || "main");
          var p = document.createElement("div");
          p.id = pid; p.className = "sidebar-panel plugin-panel"; p.dataset.plugin = id;
          p.innerHTML = '<div class="sp-head"><span class="sp-title">' + esc(o.title || rec.manifest.name) + '</span><button type="button" class="sp-close" title="Close panel">' + sym("keyboard_double_arrow_left") + '</button></div><div class="plugin-panel-body"></div>';
          document.querySelector(".sidebar").appendChild(p);
          var nav = document.querySelector(".sidebar-nav"), mgr = nav.querySelector('[data-panel="' + PANEL_ID + '"]'), btn = document.createElement("button");
          btn.className = "nav-btn nav-plugin" + (o.mode === "map" ? " nav-plugin-map" : o.mode === "chart" ? " nav-plugin-chart" : "");
          btn.setAttribute("data-panel", pid); btn.title = o.title || rec.manifest.name;
          btn.innerHTML = sym(o.icon || rec.manifest.icon || "extension") + '<span class="nav-lbl">' + esc(o.label || o.title || rec.manifest.name) + "</span>";
          if (mgr) mgr.before(btn); else nav.appendChild(btn);
          function open() { if (o.mode === "map" && GIS) GIS.enterMapMode(); activateSidebarPanel(pid); }
          function close() { if (btn.classList.contains("active")) window.closeSidebar(); }
          btn.addEventListener("click", function () { btn.classList.contains("active") ? close() : open(); });
          p.querySelector(".sp-close").addEventListener("click", close);
          var body = p.querySelector(".plugin-panel-body");
          if (o.render) { try { o.render(body); } catch (e) { body.textContent = e.message; } }
          var remove = onCleanup(function () { close(); btn.remove(); p.remove(); });
          return { el: body, open: open, close: close, remove: remove };
        },
        dialog: function (o) {
          o = o || {};
          return new Promise(function (resolve) {
            var d = dialog(o.title || rec.manifest.name, o.html || esc(o.text || ""), o.buttons || [["ok", "OK", true]]);
            if (o.onOpen) { try { o.onOpen(d.body); } catch (e) { console.error(e); } }
            d.done(function (key) { resolve(key); });
          });
        }
      },

      map: {
        get: function () { return GIS && GIS.map ? GIS.map() : null; },
        enter: function () { if (GIS) GIS.enterMapMode(); },
        isMapMode: function () { return document.body.classList.contains("gis-mode"); },
        layers: function () { return GIS ? GIS.layers.map(function (l) { return { id: l.id, name: l.name, kind: l.kind, visible: l.visible, features: l.data ? l.data.features.length : null }; }) : []; },
        layer: function (ref) { return layerRef(ref); },
        addGeoJSON: function (name, geojson, style) {
          GIS.enterMapMode();
          var l = GIS.addVector(geojson, name || rec.manifest.name);
          if (style) { Object.assign(l.style, style); GIS.emit("style"); }
          return l.id;
        },
        addTiles: function (name, url, attribution) { GIS.enterMapMode(); return GIS.addXYZ(url, name, attribution || "").id; },
        removeLayer: function (ref) { var l = layerRef(ref); if (l) GIS.remove(l.id); return !!l; },
        zoomTo: function (ref) { var l = layerRef(ref); if (l && GIS.mapActions) GIS.mapActions.zoomToLayer(l); return !!l; },
        setView: function (v) {
          var m = app.map.get();
          if (!m || !v) return;
          if (v.bbox) m.fitBounds([[v.bbox[0], v.bbox[1]], [v.bbox[2], v.bbox[3]]], { padding: 30, duration: 0 });
          else m.jumpTo({ center: v.center, zoom: v.zoom, bearing: v.bearing, pitch: v.pitch });
        },
        basemaps: function () { return GIS.BASEMAPS.map(function (b) { return { id: b.id, label: b.label, group: b.group }; }); },
        setBasemap: function (bid) { state.mapBasemap = bid; if (typeof render === "function") render(); if (GIS.refreshPanel) GIS.refreshPanel(); },
        // Returns a function that stops this one listener.
        on: function (evt, fn) {
          var off = false;
          GIS.on("*", guard(function (arg, e) { if (!off && (evt === "*" || e === evt)) fn(arg, e); }));
          return function () { off = true; };
        }
      },

      chart: {
        state: function () { return window.state; },
        types: function () { return (window.CHART_TYPE_DEFS || []).map(function (d) { return { value: d.value, label: d.label, category: d.category }; }); },
        setType: function (v) { if (window.selectChartType) window.selectChartType(v); },
        data: function () {
          var s = window.state;
          return { categories: s.categories.slice(), series: s.seriesNames.map(function (n) { return { name: n, values: (s.seriesData[n] || []).slice() }; }) };
        },
        setData: function (header, rows) {
          if (typeof applyTable !== "function") throw new Error("The chart module is not loaded.");
          var h = header.map(String), r = rows.map(function (row) { return row.map(function (v) { return v == null ? "" : String(v); }); });
          applyTable(h, r);
          if (typeof refreshDataGrid === "function") refreshDataGrid(h, r);
        },
        setDataText: function (text) {
          var el = $("dataInput");
          if (!el || typeof parseData !== "function") throw new Error("The chart module is not loaded.");
          el.value = String(text);
          return new Promise(function (res) { parseData(res); });
        },
        render: function () { if (typeof render === "function") render(); }
      },

      canvas: {
        get: function () { return window.fabricCanvas || null; },
        addText: function (text, o) {
          var c = window.fabricCanvas;
          if (!c || !window.fabric) return null;
          var t = new fabric.IText(String(text), Object.assign({ left: 80, top: 80, fontSize: 20, fill: "#1a1a1a", fontFamily: "Inter, Arial, sans-serif" }, o || {}));
          c.add(t); c.setActiveObject(t); c.requestRenderAll();
          return t;
        },
        addImage: function (url, o) {
          var c = window.fabricCanvas;
          return new Promise(function (res, rej) {
            if (!c || !window.fabric) { rej(new Error("The canvas is not ready.")); return; }
            fabric.Image.fromURL(url, function (img) {
              if (!img) { rej(new Error("Could not load the image.")); return; }
              img.set(Object.assign({ left: 80, top: 80 }, o || {}));
              c.add(img); c.setActiveObject(img); c.requestRenderAll();
              res(img);
            }, { crossOrigin: "anonymous" });
          });
        }
      },

      storage: {
        get: function (k, dflt) { try { var v = localStorage.getItem(storeKey + k); return v === null ? dflt : JSON.parse(v); } catch (e) { return dflt; } },
        set: function (k, v) { try { localStorage.setItem(storeKey + k, JSON.stringify(v)); } catch (e) { } },
        remove: function (k) { try { localStorage.removeItem(storeKey + k); } catch (e) { } }
      },

      chat: {
        open: function () { if (window.PlootsBridge) window.PlootsBridge.open(); },
        send: function (text) { if (window.PlootsBridge) window.PlootsBridge.send(text); }
      }
    };
    Object.defineProperty(app, "kobo", { get: function () { return window.PlootsKobo ? window.PlootsKobo.api : null; } });
    return app;
  }

  function pluginToolGroup() {
    var g = document.querySelector("#mainTools .tb-plugins");
    if (g) return g;
    g = document.createElement("div");
    g.className = "tool-group tb-group tb-plugins";
    var bar = $("mainTools"), lock = bar.querySelector("#toolLock");
    var anchor = lock ? lock.closest(".tool-group") : null;
    if (anchor && anchor.parentNode === bar) bar.insertBefore(g, anchor); else bar.appendChild(g);
    return g;
  }

  /* ---------------------------------------------------------- dialogs */

  function toast(msg) {
    if (window.PlootsKobo && window.PlootsKobo.toast) { window.PlootsKobo.toast(msg); return; }
    alert(msg);
  }
  function dialog(title, body, buttons) {
    var back = document.createElement("div");
    back.className = "gis-dlg-back";
    back.innerHTML = '<div class="gis-dlg" role="dialog" aria-label="' + esc(title) + '"><div class="gis-dlg-head"><span>' + esc(title) + '</span><button type="button" data-close title="Close">' + sym("close") + "</button></div>" +
      '<div class="gis-dlg-body">' + body + '</div><div class="gis-dlg-foot">' +
      buttons.map(function (b) { return '<button type="button" data-btn="' + esc(b[0]) + '"' + (b[2] ? ' class="btn-primary"' : "") + ">" + esc(b[1]) + "</button>"; }).join("") + "</div></div>";
    document.body.appendChild(back);
    var cb = null, closed = false;
    function close(key) {
      if (closed) return;
      closed = true;
      back.remove();
      document.removeEventListener("keydown", onKey, true);
      if (cb) cb(key || null);
    }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(null); } }
    document.addEventListener("keydown", onKey, true);
    back.addEventListener("mousedown", function (e) { if (e.target === back) close(null); });
    back.querySelector("[data-close]").addEventListener("click", function () { close(null); });
    back.addEventListener("click", function (e) { var b = e.target.closest("[data-btn]"); if (b) close(b.dataset.btn); });
    return { el: back, body: back.querySelector(".gis-dlg-body"), close: close, done: function (fn) { cb = fn; } };
  }

  /* ------------------------------------------------------ install flow */

  function confirmInstall(rec) {
    var m = rec.manifest, existing = records.filter(function (r) { return r.id === rec.id; })[0];
    return new Promise(function (resolve) {
      var d = dialog("Install plugin", '<div class="pl-confirm"><div class="pl-icon">' + sym(m.icon || "extension") + "</div><div><b>" + esc(m.name) + "</b> <em>" + esc(m.version || "") + "</em>" +
        (m.author ? "<div class=\"pl-meta\">" + esc(m.author) + "</div>" : "") + (m.description ? "<p>" + esc(m.description) + "</p>" : "") +
        (existing ? '<p class="pl-note">Replaces the installed version ' + esc(existing.manifest.version || "") + ".</p>" : "") +
        '<p class="pl-warn">' + sym("shield") + "Plugins run with full access to Ploots Click and the data you open in it. Install only plugins you trust.</p></div></div>",
        [["cancel", "Cancel"], ["install", existing ? "Update" : "Install", true]]);
      d.done(function (k) { resolve(k === "install"); });
    });
  }

  function install(rec) {
    return confirmInstall(rec).then(function (ok) {
      if (!ok) return false;
      teardown(rec.id);
      return dbPut(rec).then(function () {
        records = records.filter(function (r) { return r.id !== rec.id; }).concat([rec]);
        return activate(rec).then(function () { toast(rec.manifest.name + " installed"); return true; });
      });
    });
  }
  function fail(e) { toast("Plugin: " + ((e && e.message) || e)); }

  function installZip(file) {
    return file.arrayBuffer().then(readZip).then(function (files) { return install(toRecord(files, "zip:" + file.name)); }).catch(fail);
  }
  function installFolder(fileList) {
    var files = {}, jobs = Array.prototype.map.call(fileList, function (f) {
      var p = (f.webkitRelativePath || f.name).replace(/\\/g, "/");
      if (/(^|\/)(node_modules|\.git)\//.test(p)) return null;
      return f.arrayBuffer().then(function (b) { files[p] = b; });
    });
    return Promise.all(jobs).then(function () { return install(toRecord(files, "folder")); }).catch(fail);
  }
  function installUrl(url) {
    var base = url.replace(/[^/]*$/, "");
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status + " for " + url); return r.arrayBuffer(); }).then(function (mb) {
      var m = JSON.parse(new TextDecoder().decode(mb)), want = [m.entry || "index.js"].concat(m.style ? [m.style] : []).concat(Array.isArray(m.files) ? m.files : []);
      var files = { "plugin.json": mb };
      return Promise.all(want.map(function (p) {
        p = String(p).replace(/^\.\//, "");
        return fetch(new URL(p, base).href).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status + " for " + p); return r.arrayBuffer(); }).then(function (b) { files[p] = b; });
      })).then(function () { return install(toRecord(files, "url:" + url)); });
    }).catch(fail);
  }

  function setEnabled(id, on) {
    var rec = records.filter(function (r) { return r.id === id; })[0];
    if (!rec) return;
    rec.enabled = on;
    dbPut(rec);
    if (on) activate(rec); else { teardown(id); changed(); }
  }
  function uninstall(id) {
    var rec = records.filter(function (r) { return r.id === id; })[0];
    if (!rec) return;
    var d = dialog("Remove plugin", "<p>Remove <b>" + esc(rec.manifest.name) + "</b>? Its settings stay in this browser until you clear site data.</p>", [["cancel", "Cancel"], ["remove", "Remove", true]]);
    d.done(function (k) {
      if (k !== "remove") return;
      teardown(id);
      dbDel(id).then(function () { records = records.filter(function (r) { return r.id !== id; }); changed(); });
    });
  }
  function reload(id) {
    var rec = records.filter(function (r) { return r.id === id; })[0];
    if (!rec) return;
    teardown(id);
    activate(rec);
  }
  function exportZip(id) {
    var rec = records.filter(function (r) { return r.id === id; })[0];
    if (!rec) return;
    var files = {};
    Object.keys(rec.files).forEach(function (p) { files[rec.id + "/" + p] = rec.files[p]; });
    download(writeZip(files), rec.id + "-" + (rec.manifest.version || "plugin") + ".zip");
  }
  function download(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* ------------------------------------------------------ new plugin */

  function newPlugin() {
    var d = dialog("New plugin",
      '<div class="gis-props-grid"><label class="field-label">Name</label><input type="text" data-np="name" value="My plugin">' +
      '<label class="field-label">ID</label><input type="text" data-np="id" value="my-plugin" spellcheck="false">' +
      '<label class="field-label">Author</label><input type="text" data-np="author" value="">' +
      '<label class="field-label">Icon</label><input type="text" data-np="icon" value="extension" spellcheck="false"></div>',
      [["cancel", "Cancel"], ["create", "Download starter", true]]);
    var nameEl = d.body.querySelector('[data-np="name"]'), idEl = d.body.querySelector('[data-np="id"]'), touched = false;
    idEl.addEventListener("input", function () { touched = true; });
    nameEl.addEventListener("input", function () { if (!touched) idEl.value = nameEl.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-plugin"; });
    d.done(function (k) {
      if (k !== "create") return;
      var v = {};
      Array.prototype.forEach.call(d.body.querySelectorAll("[data-np]"), function (el) { v[el.dataset.np] = el.value.trim(); });
      if (!ID_RE.test(v.id)) { toast("The ID needs lowercase letters, digits, dots, dashes or underscores."); return; }
      var files = starter(v), zipped = {};
      Object.keys(files).forEach(function (p) { zipped[v.id + "/" + p] = files[p]; });
      download(writeZip(zipped), v.id + ".zip");
    });
  }

  function starter(v) {
    var manifest = { id: v.id, name: v.name || v.id, version: "0.1.0", entry: "index.js", style: "style.css", description: "", author: v.author || "", icon: v.icon || "extension", ploots: { apiVersion: API_VERSION } };
    var js = [
      "// " + manifest.name + " — a Ploots Click plugin.",
      "// Edit this file, zip the folder, then Plugins → Install .zip (or Install folder).",
      "// Full API: PLUGINS.md in the Ploots Click repository.",
      "",
      "export default {",
      "  activate(app) {",
      "    // A panel in the left rail (mode: \"any\", \"map\" or \"chart\").",
      "    const panel = app.ui.addPanel({",
      "      title: " + JSON.stringify(manifest.name) + ",",
      "      icon: " + JSON.stringify(manifest.icon) + ",",
      "      mode: \"any\",",
      "      render(el) {",
      "        el.innerHTML = `",
      "          <p class=\"" + v.id + "-hello\">Hello from ${app.plugin.name} ${app.plugin.version}.</p>",
      "          <button type=\"button\" data-act=\"layers\">List map layers</button>",
      "          <button type=\"button\" data-act=\"text\">Add a text box</button>",
      "          <pre data-out></pre>`;",
      "        el.addEventListener(\"click\", (e) => {",
      "          const act = e.target.closest(\"[data-act]\")?.dataset.act;",
      "          const out = el.querySelector(\"[data-out]\");",
      "          if (act === \"layers\") out.textContent = JSON.stringify(app.map.layers(), null, 2);",
      "          if (act === \"text\") app.canvas.addText(\"Made with \" + app.plugin.name);",
      "        });",
      "      },",
      "    });",
      "",
      "    // A button in the top bar.",
      "    app.ui.addToolbarButton({",
      "      icon: " + JSON.stringify(manifest.icon) + ",",
      "      label: " + JSON.stringify(manifest.name) + ",",
      "      onClick: () => panel.open(),",
      "    });",
      "",
      "    // Settings that survive restarts.",
      "    const runs = app.storage.get(\"runs\", 0) + 1;",
      "    app.storage.set(\"runs\", runs);",
      "    app.log(\"activated\", runs, \"time(s)\");",
      "  },",
      "",
      "  deactivate(app) {",
      "    // Buttons, panels and styles added through app are removed for you.",
      "    app.log(\"deactivated\");",
      "  },",
      "};",
      ""
    ].join("\n");
    var css = "." + v.id + "-hello { font-weight: 600; margin: 4px 0 10px; }\n" +
      ".plugin-panel-body button { margin: 0 6px 6px 0; }\n" +
      ".plugin-panel-body pre { font-size: 11px; white-space: pre-wrap; }\n";
    var readme = "# " + manifest.name + "\n\nA Ploots Click plugin.\n\n" +
      "- `plugin.json`: id, name, version, entry, style, icon (a Material Symbols name).\n" +
      "- `index.js`: `export default { activate(app), deactivate(app) }`; one bundled ES module.\n" +
      "- `style.css`: optional styles.\n\nZip the folder and use **Plugins → Install .zip**, or **Install folder** while developing (then **Reload** after each change).\n";
    return { "plugin.json": JSON.stringify(manifest, null, 2) + "\n", "index.js": js, "style.css": css, "README.md": readme };
  }

  /* ------------------------------------------------------------- panel */

  function build() {
    if ($(PANEL_ID)) return;
    var p = document.createElement("div");
    p.id = PANEL_ID;
    p.className = "sidebar-panel";
    p.innerHTML =
      '<div class="sp-head"><span class="sp-title">Plugins</span><button type="button" class="sp-close" title="Close panel">' + sym("keyboard_double_arrow_left") + "</button></div>" +
      '<div class="pl-body">' +
        '<div class="pl-actions">' +
          '<button class="file-btn" title="Install a plugin from a .zip file">' + sym("upload_file") + '.zip<input type="file" id="plZip" accept=".zip,application/zip"></button>' +
          '<button class="file-btn" title="Install a plugin folder (for development)">' + sym("folder_open") + 'Folder<input type="file" id="plFolder" webkitdirectory multiple></button>' +
          '<button id="plUrlBtn" title="Install from a plugin.json URL">' + sym("link") + "URL</button>" +
        "</div>" +
        '<div id="plUrlWrap" style="display:none;"><input type="text" id="plUrl" placeholder="https://…/plugin.json"><button id="plUrlGo" class="btn-primary" style="width:100%;margin-top:6px;">Install</button></div>' +
        '<button id="plNew" class="pl-new">' + sym("add") + "New plugin</button>" +
        '<div class="pl-list" id="plList"></div>' +
      "</div>";
    document.querySelector(".sidebar").appendChild(p);

    var nav = document.querySelector(".sidebar-nav"), exp = nav.querySelector('[data-panel="panel-export"]');
    var b = document.createElement("button");
    b.className = "nav-btn nav-plugins";
    b.setAttribute("data-panel", PANEL_ID);
    b.title = "Plugins";
    b.innerHTML = sym("extension") + '<span class="nav-lbl">Plugins</span>';
    if (exp) exp.before(b); else nav.appendChild(b);
    b.addEventListener("click", function () { b.classList.contains("active") ? window.closeSidebar() : activateSidebarPanel(PANEL_ID); });
    p.querySelector(".sp-close").addEventListener("click", function () { window.closeSidebar(); });

    $("plZip").addEventListener("change", function () { var f = this.files[0]; this.value = ""; if (f) installZip(f); });
    $("plFolder").addEventListener("change", function () { var fl = Array.prototype.slice.call(this.files); this.value = ""; if (fl.length) installFolder(fl); });
    $("plUrlBtn").addEventListener("click", function () { var w = $("plUrlWrap"); w.style.display = w.style.display === "none" ? "" : "none"; });
    $("plUrlGo").addEventListener("click", function () { var u = $("plUrl").value.trim(); if (u) installUrl(u); });
    $("plNew").addEventListener("click", newPlugin);
    $("plList").addEventListener("click", function (e) {
      var t = e.target.closest("[data-pl]");
      if (!t) return;
      var id = t.closest("[data-id]").dataset.id, a = t.dataset.pl;
      if (a === "remove") uninstall(id); else if (a === "reload") reload(id); else if (a === "export") exportZip(id);
    });
    $("plList").addEventListener("change", function (e) {
      var t = e.target;
      if (t.dataset.toggle) setEnabled(t.dataset.toggle, t.checked);
    });
    // Drop a .zip on the panel to install it.
    p.addEventListener("dragover", function (e) { if (e.dataTransfer && Array.prototype.some.call(e.dataTransfer.items || [], function (i) { return i.kind === "file"; })) { e.preventDefault(); p.classList.add("pl-drop"); } });
    p.addEventListener("dragleave", function (e) { if (e.target === p) p.classList.remove("pl-drop"); });
    p.addEventListener("drop", function (e) {
      p.classList.remove("pl-drop");
      var f = e.dataTransfer && e.dataTransfer.files[0];
      if (f && /\.zip$/i.test(f.name)) { e.preventDefault(); installZip(f); }
    });
    renderList();
  }

  function renderList() {
    var box = $("plList");
    if (!box) return;
    if (!records.length) { box.innerHTML = '<div class="gis-empty">No plugins installed</div>'; return; }
    box.innerHTML = records.slice().sort(function (a, b) { return a.manifest.name.localeCompare(b.manifest.name); }).map(function (r) {
      var m = r.manifest, L = loaded[r.id], err = L && L.error, on = r.enabled;
      return '<div class="pl-card' + (on ? "" : " off") + (err ? " err" : "") + '" data-id="' + esc(r.id) + '">' +
        '<div class="pl-top"><div class="pl-icon">' + sym(m.icon || "extension") + '</div><div class="pl-title"><b>' + esc(m.name) + "</b><em>" + esc(m.version || "") + (m.author ? " · " + esc(m.author) : "") + "</em></div>" +
        '<label class="pl-switch" title="' + (on ? "Disable" : "Enable") + '"><input type="checkbox" data-toggle="' + esc(r.id) + '"' + (on ? " checked" : "") + "><i></i></label></div>" +
        (m.description ? '<p class="pl-desc">' + esc(m.description) + "</p>" : "") +
        (err ? '<p class="pl-error">' + sym("error") + esc(err) + "</p>" : "") +
        '<div class="pl-foot"><span>' + esc(r.id) + '</span><button data-pl="reload" title="Reload">' + sym("refresh") + '</button><button data-pl="export" title="Download as .zip">' + sym("download") + '</button><button data-pl="remove" title="Remove">' + sym("delete") + "</button></div></div>";
    }).join("");
  }

  /* -------------------------------------------------------------- boot */

  window.PlootsPlugins = {
    apiVersion: API_VERSION,
    list: function () { return records.map(function (r) { var L = loaded[r.id]; return { id: r.id, name: r.manifest.name, version: r.manifest.version, enabled: r.enabled, active: !!(L && L.active), error: L ? L.error : null }; }); },
    installZip: installZip, installUrl: installUrl, setEnabled: setEnabled, remove: function (id) { teardown(id); return dbDel(id).then(function () { records = records.filter(function (r) { return r.id !== id; }); changed(); }); },
    reload: reload, onChange: function (fn) { listeners.push(fn); }, readZip: readZip, writeZip: writeZip, starter: starter
  };

  function boot() {
    build();
    // Load after the other modules have set up their globals, and after
    // sign-in when the app is locked.
    var start = function () { setTimeout(load, 300); };
    if (window.PlootsLock) window.PlootsLock.whenUnlocked(start); else start();
    function load() {
      if (!window.indexedDB) return;
      dbAll().then(function (list) {
        records = list || [];
        renderList();
        records.filter(function (r) { return r.enabled; }).forEach(function (r) { activate(r); });
      }).catch(function (e) { console.error("[plugins]", e); });
    }
  }
  if (document.readyState === "complete") boot(); else window.addEventListener("load", boot);
})();
