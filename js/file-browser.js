/* ==========================================================================
   Files — a folder browser, like the QGIS Browser panel.

   Connect one or more folders on this computer; they are remembered for the
   next session (the browser or desktop app asks again for permission when
   needed). Browse them as a tree, filter by name, and open a file with a
   double-click (or Enter):

     .csv .tsv .txt       chart data; in the map workspace, a CSV with
                          latitude / longitude columns becomes a point layer
     .xlsx .xls           chart data (sheet picker as usual)
     .json                GeoJSON / TopoJSON → map layer, otherwise chart data
     .geojson .topojson   map layer
     .shp                 Shapefile layer (its .dbf / .prj / .cpg are read
                          with it and hidden from the list, as in QGIS)
     .kml .kmz .gpx       field layers (Google Earth / Avenza, GPS tracks)
     .tif .tiff           raster layer
     images               placed on the page
     .zip                 a plugin is installed; a zipped shapefile, KML or
                          GPX is added to the map

   Files are opened through the app's own file inputs, so they behave
   exactly as if picked from the usual Open buttons. Nothing is copied or
   uploaded: files are read from disk when opened.

   Uses the File System Access API (Chromium, Edge, WebView2). Where it is
   missing, "Connect folder" reads a folder for this session only.
   ========================================================================== */
(function () {
  "use strict";

  var PANEL_ID = "panel-files";
  var DB_NAME = "ploots-files", STORE = "folders";
  var TYPES = {
    csv: ["table", "Table"], tsv: ["table", "Table"], txt: ["table", "Text table"], xlsx: ["table_view", "Excel"], xls: ["table_view", "Excel"],
    json: ["data_object", "JSON"], geojson: ["polyline", "GeoJSON"], topojson: ["polyline", "TopoJSON"],
    tif: ["grid_on", "GeoTIFF"], tiff: ["grid_on", "GeoTIFF"],
    png: ["image", "Image"], jpg: ["image", "Image"], jpeg: ["image", "Image"], gif: ["image", "Image"], webp: ["image", "Image"], svg: ["image", "Image"],
    shp: ["polyline", "Shapefile"], kml: ["travel_explore", "KML"], kmz: ["travel_explore", "KMZ"], gpx: ["route", "GPX track"],
    zip: ["folder_zip", "Zip (plugin or shapefile)"]
  };
  // Shapefile sidecars, hidden when their .shp is in the same folder.
  var SIDECAR = /\.(shx|dbf|prj|cpg|sbn|sbx|qix|fix|shp\.xml|qmd)$/i;
  var HIDDEN = /^(\.|~\$|Thumbs\.db$|desktop\.ini$|node_modules$|__pycache__$)/i;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function extOf(name) { var m = /\.([a-z0-9]+)$/i.exec(name); return m ? m[1].toLowerCase() : ""; }
  function size(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
  function toast(m) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(m); }
  var FSA = typeof window.showDirectoryPicker === "function";

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
        var t = d.transaction(STORE, mode), q = fn(t.objectStore(STORE));
        t.oncomplete = function () { res(q && q.result); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }

  /* ------------------------------------------------------------- model */
  // roots: [{ id, name, handle?, files?(session fallback), state: "ok"|"ask"|"gone", open: {path:true} }]
  // A node: { name, path, kind: "dir"|"file", handle?, file?, children? }

  var roots = [], selected = null, query = "", openPaths = {};
  // Which folders are expanded is remembered between sessions.
  try { openPaths = JSON.parse(localStorage.getItem("ploots-files-open") || "{}"); } catch (e) { }
  function saveOpen() { try { localStorage.setItem("ploots-files-open", JSON.stringify(openPaths)); } catch (e) { } }

  function connect() {
    if (!FSA) { $("fbPick").click(); return; }
    window.showDirectoryPicker({ mode: "read" }).then(addHandle).catch(function (e) { if (e && e.name !== "AbortError") toast("Could not open the folder: " + e.message); });
  }

  // Connect a directory handle (from the picker, or from a plugin).
  function addHandle(h) {
    return Promise.resolve().then(function () {
      var dup = roots.filter(function (r) { return r.handle && r.name === h.name; })[0];
      var addP = dup && dup.handle.isSameEntry ? dup.handle.isSameEntry(h) : Promise.resolve(false);
      return addP.then(function (same) {
        if (same) { toast(h.name + " is already connected"); return; }
        var rec = { id: "f" + Date.now().toString(36), name: h.name, handle: h, addedAt: Date.now() };
        return tx("readwrite", function (s) { return s.put(rec); }).then(function () {
          roots.push({ id: rec.id, name: rec.name, handle: h, state: "ok" });
          openPaths[rec.id + "/"] = true;
          saveOpen();
          render();
        });
      });
    });
  }

  function sessionFolder(fileList) {
    var files = Array.prototype.slice.call(fileList);
    if (!files.length) return;
    var name = (files[0].webkitRelativePath || files[0].name).split("/")[0];
    var id = "s" + Date.now().toString(36);
    roots.push({ id: id, name: name, session: true, state: "ok", tree: buildSessionTree(files) });
    openPaths[id + "/"] = true;
    render();
  }
  function buildSessionTree(files) {
    var root = { kind: "dir", children: {} };
    files.forEach(function (f) {
      var parts = (f.webkitRelativePath || f.name).split("/").slice(1), node = root;
      parts.forEach(function (p, i) {
        if (i === parts.length - 1) node.children[p] = { kind: "file", name: p, file: f };
        else node = node.children[p] = node.children[p] || { kind: "dir", name: p, children: {} };
      });
    });
    return root;
  }

  function checkPermissions() {
    return Promise.all(roots.map(function (r) {
      if (!r.handle || !r.handle.queryPermission) return null;
      return r.handle.queryPermission({ mode: "read" }).then(function (p) { r.state = p === "granted" ? "ok" : "ask"; }, function () { r.state = "gone"; });
    })).then(render);
  }
  function reconnect(r) {
    r.handle.requestPermission({ mode: "read" }).then(function (p) { r.state = p === "granted" ? "ok" : "ask"; render(); }, function () { r.state = "gone"; render(); });
  }
  function disconnect(id) {
    roots = roots.filter(function (r) { return r.id !== id; });
    tx("readwrite", function (s) { return s.delete(id); });
    render();
  }

  // Children of a directory, directories first, hidden entries skipped.
  var cache = {};
  function listDir(root, path, handle, node) {
    var key = root.id + "/" + path;
    if (cache[key]) return Promise.resolve(cache[key]);
    var p;
    if (root.session) {
      var kids = Object.keys(node.children).map(function (k) { var c = node.children[k]; return { name: k, kind: c.kind, node: c, file: c.file }; });
      p = Promise.resolve(kids);
    } else {
      p = (async function () {
        var out = [];
        for await (var entry of handle.values()) out.push({ name: entry.name, kind: entry.kind === "directory" ? "dir" : "file", handle: entry });
        return out;
      })();
    }
    return p.then(function (list) {
      var stems = {};
      list.forEach(function (e) { if (/\.shp$/i.test(e.name)) stems[e.name.slice(0, -4).toLowerCase()] = true; });
      list = list.filter(function (e) {
        if (HIDDEN.test(e.name)) return false;
        var m = SIDECAR.exec(e.name);
        return !(m && stems[e.name.slice(0, m.index).toLowerCase()]);
      })
        .sort(function (a, b) { return a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }); });
      cache[key] = list;
      return list;
    });
  }

  /* ------------------------------------------------------------ render */

  var renderToken = 0;
  function render() {
    var box = $("fbTree");
    if (!box) return;
    var token = ++renderToken;
    if (!roots.length) {
      box.innerHTML = '<div class="gis-empty">No folders connected</div>';
      return;
    }
    Promise.all(roots.map(function (r) { return renderRoot(r); })).then(function (parts) {
      if (token !== renderToken) return;
      box.innerHTML = parts.join("");
      if (selected) { var s = box.querySelector('[data-path="' + CSS.escape(selected) + '"]'); if (s) s.classList.add("sel"); }
    });
  }

  function renderRoot(r) {
    var head = '<div class="fb-root' + (r.state !== "ok" ? " off" : "") + '" data-root="' + esc(r.id) + '">' +
      '<button class="fb-tw" data-toggle="' + esc(r.id + "/") + '">' + sym(openPaths[r.id + "/"] ? "expand_more" : "chevron_right") + "</button>" +
      sym(r.session ? "folder_special" : "folder") + '<b title="' + esc(r.name) + '">' + esc(r.name) + "</b>" +
      (r.session ? '<em title="Read for this session only">session</em>' : "") +
      (r.state === "ask" ? '<button class="fb-mini fb-ask" data-reconnect="' + esc(r.id) + '">Reconnect</button>' : "") +
      '<button class="fb-mini" data-refresh="' + esc(r.id) + '" title="Refresh">' + sym("refresh") + "</button>" +
      '<button class="fb-mini" data-remove="' + esc(r.id) + '" title="Disconnect">' + sym("link_off") + "</button></div>";
    if (!openPaths[r.id + "/"] || r.state !== "ok") return Promise.resolve(head);
    return renderDir(r, "", r.handle, r.tree, 1).then(function (h) { return head + h; })
      .catch(function (e) { r.state = "gone"; return head + '<div class="fb-err">' + esc(e.message) + "</div>"; });
  }

  function matches(name) { return !query || name.toLowerCase().indexOf(query) >= 0; }

  function renderDir(r, path, handle, node, depth) {
    return listDir(r, path, handle, node).then(function (list) {
      return Promise.all(list.map(function (e) {
        var p = path + e.name + (e.kind === "dir" ? "/" : ""), key = r.id + "/" + p, pad = 'style="padding-left:' + (depth * 14 + 4) + 'px"';
        if (e.kind === "dir") {
          var open = openPaths[key] || !!query;
          var row = '<div class="fb-row fb-dir" ' + pad + ' data-toggle="' + esc(key) + '">' + sym(open ? "expand_more" : "chevron_right") + sym(open ? "folder_open" : "folder") + "<span>" + esc(e.name) + "</span></div>";
          if (!open) return query ? "" : row;
          return renderDir(r, p, e.handle, e.node, depth + 1).then(function (inner) { return query && !inner ? "" : row + inner; });
        }
        if (!matches(e.name)) return "";
        var t = TYPES[extOf(e.name)];
        return '<div class="fb-row fb-file' + (t ? "" : " unsupported") + '" ' + pad + ' tabindex="0" data-path="' + esc(key) + '" title="' + esc(p + (t ? " · " + t[1] : "")) + '">' +
          '<i class="fb-sp"></i>' + sym(t ? t[0] : "draft") + "<span>" + esc(e.name) + "</span></div>";
      })).then(function (rows) { return rows.join(""); });
    });
  }

  /* -------------------------------------------------------------- open */

  function resolve(key) {
    var id = key.split("/")[0], r = roots.filter(function (x) { return x.id === id; })[0];
    if (!r) return Promise.reject(new Error("Folder not found."));
    var parts = key.slice(id.length + 1).split("/");
    if (r.session) {
      var node = r.tree;
      parts.forEach(function (p) { node = node && node.children[p]; });
      return node && node.file ? Promise.resolve(node.file) : Promise.reject(new Error("File not found."));
    }
    var h = Promise.resolve(r.handle);
    parts.slice(0, -1).forEach(function (p) { h = h.then(function (d) { return d.getDirectoryHandle(p); }); });
    return h.then(function (d) { return d.getFileHandle(parts[parts.length - 1]); }).then(function (fh) { return fh.getFile(); });
  }

  function feed(inputId, file) {
    var inp = $(inputId);
    if (!inp) throw new Error("This part of the app is not loaded.");
    var dt = new DataTransfer();
    dt.items.add(file);
    inp.files = dt.files;
    inp.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function toChart() {
    var GIS = window.PlootsGIS;
    if (window.PlootsHome) window.PlootsHome.hide();
    if (GIS && state.chartType === GIS.TYPE && window.selectChartType) selectChartType("bar-group");
  }
  function isMap() { return document.body.classList.contains("gis-mode"); }

  function looksGeo(text) {
    try { var j = JSON.parse(text); return j && /^(FeatureCollection|Feature|Topology|Point|MultiPoint|LineString|MultiLineString|Polygon|MultiPolygon|GeometryCollection)$/.test(j.type); } catch (e) { return false; }
  }

  // A CSV with latitude / longitude columns, opened in the map workspace.
  var LAT = /^(lat|latitude|lintang|y|_?geolocation_?lat|decimallatitude)$/i, LON = /^(lon|lng|long|longitude|bujur|x|_?geolocation_?lon|decimallongitude)$/i;
  function csvToPoints(file) {
    return file.text().then(function (text) {
      return PlootsLazy.ensurePapaParse().then(function () {
        var p = Papa.parse(text.trim(), { header: true, skipEmptyLines: true, dynamicTyping: true });
        var fields = p.meta.fields || [], la = fields.filter(function (f) { return LAT.test(f.trim()); })[0], lo = fields.filter(function (f) { return LON.test(f.trim()); })[0];
        if (!la || !lo) return false;
        var feats = p.data.map(function (row) {
          var y = Number(row[la]), x = Number(row[lo]);
          if (!isFinite(x) || !isFinite(y) || Math.abs(y) > 90 || Math.abs(x) > 180) return null;
          return { type: "Feature", geometry: { type: "Point", coordinates: [x, y] }, properties: row };
        }).filter(Boolean);
        if (!feats.length) return false;
        window.PlootsGIS.addVector({ type: "FeatureCollection", features: feats }, file.name.replace(/\.[^.]+$/, ""));
        toast(feats.length + " points from " + file.name);
        return true;
      });
    });
  }

  // Files in the same folder whose name starts like `stem.` (shapefile parts).
  function siblings(key) {
    var id = key.split("/")[0], r = roots.filter(function (x) { return x.id === id; })[0];
    var rel = key.slice(id.length + 1), dir = rel.slice(0, rel.lastIndexOf("/") + 1), stem = rel.slice(dir.length).replace(/\.[^.]+$/, "").toLowerCase();
    // Read the folder directly: the tree listing hides the sidecar files.
    return dirEntries(r, dir).then(function (all) {
      return Promise.all(all.filter(function (e) { return e.kind === "file" && e.name.toLowerCase().indexOf(stem + ".") === 0; })
        .map(function (e) { return e.file ? e.file : e.handle.getFile(); }));
    });
  }
  function dirEntries(r, dir) {
    if (r.session) {
      var node = r.tree;
      dir.split("/").filter(Boolean).forEach(function (p) { node = node && node.children[p]; });
      return Promise.resolve(node ? Object.keys(node.children).map(function (k) { var c = node.children[k]; return { name: k, kind: c.kind, file: c.file }; }) : []);
    }
    var h = Promise.resolve(r.handle);
    dir.split("/").filter(Boolean).forEach(function (p) { h = h.then(function (d) { return d.getDirectoryHandle(p); }); });
    return h.then(async function (d) { var out = []; for await (var e of d.values()) out.push({ name: e.name, kind: e.kind === "directory" ? "dir" : "file", handle: e }); return out; });
  }

  function addLayers(files) {
    return window.PlootsFormats.read(files).then(function (layers) {
      window.PlootsGIS.enterMapMode();
      layers.forEach(function (x) { window.PlootsGIS.addVector(x.geojson, x.name); });
      var n = layers.reduce(function (s, x) { return s + x.geojson.features.length; }, 0);
      toast(layers.map(function (x) { return x.name; }).join(", ") + ": " + n + " feature" + (n === 1 ? "" : "s") + (layers.some(function (x) { return x.note; }) ? ". " + layers.map(function (x) { return x.note; }).filter(Boolean)[0] : ""));
    });
  }

  function openFile(file, key) {
    var ext = extOf(file.name);
    if (window.PlootsHome) window.PlootsHome.hide();
    switch (ext) {
      case "shp":
        return (key ? siblings(key) : Promise.resolve([file])).then(function (parts) { return addLayers(parts.length ? parts : [file]); });
      case "kml": case "kmz": case "gpx":
        return addLayers([file]);
      case "csv": case "tsv": case "txt":
        if (isMap() && ext !== "txt") return csvToPoints(file).then(function (done) { if (!done) { toChart(); feed("csvFile", file); } });
        toChart(); feed("csvFile", file); return;
      case "xlsx": case "xls": toChart(); feed("xlsxFile", file); return;
      case "geojson": case "topojson": feed("gisVectorFile", file); return;
      case "json":
        return file.text().then(function (t) { if (looksGeo(t)) feed("gisVectorFile", file); else { toChart(); feed("jsonFile", file); } });
      case "tif": case "tiff": feed("gisRasterFile", file); return;
      case "png": case "jpg": case "jpeg": case "gif": case "webp": case "svg":
        // Images go on the page, in either workspace.
        if (typeof addImageObjectFromFile === "function") addImageObjectFromFile(file); return;
      case "zip":
        if (!window.PlootsPlugins) throw new Error("Plugins are not loaded.");
        return file.arrayBuffer().then(window.PlootsPlugins.readZip).then(function (files) {
          if (Object.keys(files).some(function (n) { return /(^|\/)plugin\.json$/.test(n); })) return window.PlootsPlugins.installZip(file);
          return addLayers([file]);
        });
      default:
        throw new Error("Ploots Click cannot open ." + (ext || "this") + " files.");
    }
  }

  function openKey(key) {
    resolve(key).then(function (f) { return openFile(f, key); }).catch(function (e) { toast(e.message || String(e)); });
  }

  /* ------------------------------------------------------------- panel */

  function build() {
    if ($(PANEL_ID)) return;
    var p = document.createElement("div");
    p.id = PANEL_ID;
    p.className = "sidebar-panel";
    p.innerHTML =
      '<div class="sp-head"><span class="sp-title">Files</span><button type="button" class="sp-close" title="Close panel">' + sym("keyboard_double_arrow_left") + "</button></div>" +
      '<div class="fb-body">' +
        '<button id="fbConnect" class="btn-primary fb-connect">' + sym("create_new_folder") + "Connect folder</button>" +
        '<input type="file" id="fbPick" webkitdirectory multiple style="display:none">' +
        '<input type="search" id="fbSearch" placeholder="Filter files">' +
        '<div class="fb-tree" id="fbTree"></div>' +
        '<div class="fb-info" id="fbInfo"></div>' +
      "</div>";
    document.querySelector(".sidebar").appendChild(p);

    var nav = document.querySelector(".sidebar-nav"), home = nav.querySelector(".nav-home");
    var b = document.createElement("button");
    b.className = "nav-btn nav-files";
    b.setAttribute("data-panel", PANEL_ID);
    b.title = "Files";
    b.innerHTML = sym("folder_open") + '<span class="nav-lbl">Files</span>';
    if (home) home.after(b); else nav.insertBefore(b, nav.firstChild);
    b.addEventListener("click", function () {
      if (b.classList.contains("active")) { window.closeSidebar(); return; }
      activateSidebarPanel(PANEL_ID);
      checkPermissions();
    });
    p.querySelector(".sp-close").addEventListener("click", function () { window.closeSidebar(); });

    $("fbConnect").addEventListener("click", connect);
    $("fbPick").addEventListener("change", function () { sessionFolder(this.files); this.value = ""; });
    $("fbSearch").addEventListener("input", function () { query = this.value.trim().toLowerCase(); render(); });
    var tree = $("fbTree");
    tree.addEventListener("click", function (e) {
      var t;
      if ((t = e.target.closest("[data-reconnect]"))) { reconnect(roots.filter(function (r) { return r.id === t.dataset.reconnect; })[0]); return; }
      if ((t = e.target.closest("[data-refresh]"))) {
        var id = t.dataset.refresh;
        Object.keys(cache).forEach(function (k) { if (k.indexOf(id + "/") === 0) delete cache[k]; });
        render(); return;
      }
      if ((t = e.target.closest("[data-remove]"))) { disconnect(t.dataset.remove); return; }
      if ((t = e.target.closest("[data-toggle]"))) { var k = t.dataset.toggle; if (openPaths[k]) delete openPaths[k]; else openPaths[k] = true; saveOpen(); render(); return; }
      if ((t = e.target.closest("[data-path]"))) select(t);
    });
    tree.addEventListener("dblclick", function (e) { var t = e.target.closest("[data-path]"); if (t) openKey(t.dataset.path); });
    tree.addEventListener("keydown", function (e) {
      var t = e.target.closest("[data-path]");
      if (!t) return;
      if (e.key === "Enter") { e.preventDefault(); openKey(t.dataset.path); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        var all = Array.prototype.slice.call(tree.querySelectorAll("[data-path]")), i = all.indexOf(t) + (e.key === "ArrowDown" ? 1 : -1);
        if (all[i]) { all[i].focus(); select(all[i]); }
      }
    });
    render();
  }

  function select(row) {
    Array.prototype.forEach.call(document.querySelectorAll("#fbTree .sel"), function (x) { x.classList.remove("sel"); });
    row.classList.add("sel");
    var key = selected = row.dataset.path;
    var info = $("fbInfo");
    resolve(key).then(function (f) {
      var t = TYPES[extOf(f.name)];
      info.innerHTML = '<b title="' + esc(f.name) + '">' + esc(f.name) + "</b><span>" + (t ? t[1] : "Not supported") + " · " + size(f.size) + " · " + new Date(f.lastModified).toLocaleString() + "</span>" +
        '<div class="fb-prev" id="fbPrev"></div>' +
        (t ? '<button class="btn-primary" id="fbOpen">' + sym("open_in_new") + "Open</button>" : "");
      var ob = $("fbOpen");
      if (ob) ob.addEventListener("click", function () { openKey(key); });
      preview(f, key, $("fbPrev"));
    }).catch(function (e) { info.textContent = e.message; });
  }

  /* ----------------------------------------------------------- preview */
  // A look inside the selected file before it is opened: the first rows of
  // a table, a thumbnail map of a vector layer, or the image itself.

  var PREVIEW_MAX = 40 * 1024 * 1024, prevToken = 0;
  function preview(f, key, box) {
    var token = ++prevToken, ext = extOf(f.name);
    function show(html) { if (token === prevToken && box.isConnected) box.innerHTML = html; }
    if (f.size > PREVIEW_MAX) { show('<em class="fb-prev-note">Too large to preview</em>'); return; }
    show('<em class="fb-prev-note">Reading…</em>');
    var job;
    if (/^(csv|tsv|txt)$/.test(ext)) job = f.slice(0, 256 * 1024).text().then(function (s) {
      return PlootsLazy.ensurePapaParse().then(function () {
        var rows = Papa.parse(s.replace(/\n[^\n]*$/, ""), { skipEmptyLines: true, preview: 9 }).data;
        return tableHtml(rows);
      });
    });
    else if (/^xlsx?$/.test(ext)) job = PlootsLazy.ensureXLSX().then(function () { return f.arrayBuffer(); }).then(function (b) {
      var wb = XLSX.read(new Uint8Array(b), { type: "array", sheetRows: 9 }), sh = wb.Sheets[wb.SheetNames[0]];
      return tableHtml(XLSX.utils.sheet_to_json(sh, { header: 1, defval: "" })) + (wb.SheetNames.length > 1 ? '<em class="fb-prev-note">' + wb.SheetNames.length + " sheets: " + esc(wb.SheetNames.join(", ")) + "</em>" : "");
    });
    else if (/^(geojson|topojson|json)$/.test(ext)) job = f.text().then(function (s) {
      var j = JSON.parse(s);
      if (Array.isArray(j)) return tableHtml([Object.keys(j[0] || {})].concat(j.slice(0, 8).map(function (r) { return Object.keys(j[0] || {}).map(function (k) { return r[k]; }); })));
      return vectorHtml(window.PlootsGIS.normalise(j));
    });
    else if (/^(shp|kml|kmz|gpx|zip)$/.test(ext)) job = (ext === "shp" && key ? siblings(key) : Promise.resolve([f])).then(function (parts) {
      if (ext === "zip") return f.arrayBuffer().then(window.PlootsPlugins.readZip).then(function (z) {
        var m = Object.keys(z).filter(function (n) { return /(^|\/)plugin\.json$/.test(n); })[0];
        if (m) { var man = JSON.parse(new TextDecoder().decode(z[m])); return '<div class="fb-prev-plugin">' + sym(man.icon || "extension") + "<div><b>" + esc(man.name || man.id) + "</b> " + esc(man.version || "") + "<p>" + esc(man.description || "Plugin") + "</p></div></div>"; }
        return window.PlootsFormats.read([f]).then(function (ls) { return vectorHtml(ls[0].geojson, ls.length > 1 ? ls.length + " layers" : ""); });
      });
      return window.PlootsFormats.read(parts).then(function (ls) { return vectorHtml(ls[0].geojson, ls[0].note || ""); });
    });
    else if (/^(png|jpe?g|gif|webp|svg)$/.test(ext)) job = Promise.resolve().then(function () {
      var url = URL.createObjectURL(f);
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      return '<img class="fb-prev-img" src="' + url + '" alt="">';
    });
    else if (/^tiff?$/.test(ext)) job = Promise.resolve('<em class="fb-prev-note">GeoTIFF · opens as a raster layer</em>');
    else job = Promise.resolve("");
    job.then(show, function (e) { show('<em class="fb-prev-note error">' + esc(e.message || String(e)) + "</em>"); });
  }

  function tableHtml(rows) {
    if (!rows || !rows.length) return '<em class="fb-prev-note">Empty</em>';
    var cols = Math.min(6, Math.max.apply(null, rows.map(function (r) { return r.length; })));
    return '<div class="fb-prev-table"><table>' + rows.slice(0, 9).map(function (r, i) {
      var tag = i === 0 ? "th" : "td";
      return "<tr>" + r.slice(0, cols).map(function (v) { return "<" + tag + ">" + esc(v == null ? "" : String(v).slice(0, 40)) + "</" + tag + ">"; }).join("") + "</tr>";
    }).join("") + "</table></div>" + (Math.max.apply(null, rows.map(function (r) { return r.length; })) > cols ? '<em class="fb-prev-note">First ' + cols + " columns</em>" : "");
  }

  function vectorHtml(fc, note) {
    var feats = fc.features || [], W = 260, H = 150;
    var types = {};
    feats.forEach(function (x) { if (x.geometry) types[x.geometry.type.replace("Multi", "")] = (types[x.geometry.type.replace("Multi", "")] || 0) + 1; });
    var fields = Object.keys((feats[0] && feats[0].properties) || {});
    var svg = "";
    try {
      var sample = feats.length > 3000 ? feats.filter(function (x, i) { return i % Math.ceil(feats.length / 3000) === 0; }) : feats;
      var sfc = { type: "FeatureCollection", features: sample };
      // Planar lon/lat (not spherical): ring winding does not matter, so
      // polygons in either orientation draw as themselves. A single point
      // (or points on one spot) has no extent: frame ±0.01°.
      var proj = d3.geoIdentity().reflectY(true), b = d3.geoPath(proj).bounds(sfc), fitTo = sfc;
      if (b[1][0] - b[0][0] < 1e-6 && b[1][1] - b[0][1] < 1e-6) fitTo = { type: "MultiPoint", coordinates: [[b[0][0] - 0.01, -b[1][1] - 0.01], [b[0][0] + 0.01, -b[1][1] + 0.01]] };
      proj.fitExtent([[6, 6], [W - 6, H - 6]], fitTo);
      var path = d3.geoPath(proj).pointRadius(3);
      svg = '<svg class="fb-prev-map" viewBox="0 0 ' + W + " " + H + '">' + sample.map(function (x) {
        var d = path(x);
        if (!d) return "";
        var poly = /Polygon/.test(x.geometry.type), line = /LineString/.test(x.geometry.type);
        return '<path d="' + d + '" class="' + (poly ? "pg" : line ? "ln" : "pt") + '"/>';
      }).join("") + "</svg>";
    } catch (e) { svg = ""; }
    return svg + '<div class="fb-prev-meta"><b>' + feats.length.toLocaleString() + "</b> feature" + (feats.length === 1 ? "" : "s") + " · " + esc(Object.keys(types).join(", ") || "no geometry") +
      " · " + fields.length + " field" + (fields.length === 1 ? "" : "s") + (note ? "<br>" + esc(note) : "") + "</div>" +
      (fields.length ? '<div class="fb-prev-fields">' + fields.slice(0, 12).map(function (k) { return "<i>" + esc(k) + "</i>"; }).join("") + (fields.length > 12 ? "<i>+" + (fields.length - 12) + "</i>" : "") + "</div>" : "");
  }

  function boot() {
    build();
    if (!window.indexedDB) return;
    tx("readonly", function (s) { return s.getAll(); }).then(function (list) {
      (list || []).sort(function (a, b) { return a.addedAt - b.addedAt; }).forEach(function (rec) {
        roots.push({ id: rec.id, name: rec.name, handle: rec.handle, state: "ask" });
      });
      return checkPermissions();
    }).catch(function (e) { console.error("[files]", e); });
  }

  window.PlootsFiles = { connect: connect, addHandle: addHandle, open: openFile, roots: function () { return roots.map(function (r) { return { id: r.id, name: r.name, state: r.state, session: !!r.session }; }); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
