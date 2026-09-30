/* ==========================================================================
   GIS — basemap gallery (the top bar's Basemap button).

   Every basemap is a card with a thumbnail and its provider's logo,
   grouped and searchable, like GeoLibre's basemap picker.

   Thumbnails
     raster tiles   one real tile (zoom 5 over Java), loaded as an image
     vector styles, rendered once in a small off-screen map and kept in
     Mapzen terrain localStorage, one at a time while the gallery is open
     None           an empty checkerboard
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var THUMB = "ploots-bmthumb:";
  var Z = 5, X = 25, Y = 16; // over Java
  // Regional services show a tile of their own region.
  var AT = { swisstopo: [7, 66, 45], bkg: [6, 33, 21], openbasiskaart: [7, 65, 42], usgs: [5, 7, 12] };
  var AT_ID = { "gl-osm-de": [6, 33, 21], "gl-osm-ch": [7, 66, 45] };
  // Overlays are drawn over this (light gray) tile.
  var UNDER = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/";
  var W = 150, H = 92;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function cached(id) { try { return localStorage.getItem(THUMB + id); } catch (e) { return null; } }

  function tileUrl(b) {
    var u = b.tiles;
    if (b.google) u = "https://mt1.google.com/vt/lyrs=" + { roadmap: "m", satellite: "s", hybrid: "y", terrain: "p" }[b.google] + "&x={x}&y={y}&z={z}";
    var at = AT_ID[b.id] || AT[GIS.logos.ofBasemap(b)] || [Z, X, Y];
    return u ? u.replace("{z}", at[0]).replace("{x}", at[1]).replace("{y}", at[2]) : null;
  }
  function thumbHtml(b) {
    if (b.id === "none") return '<div class="bmg-thumb bmg-none"></div>';
    var t = tileUrl(b) || cached(b.id);
    if (t && b.overlay) return '<div class="bmg-thumb bmg-over" style="background-image:url(' + UNDER + Z + "/" + Y + "/" + X + ')"><img src="' + esc(t) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></div>';
    if (t) return '<div class="bmg-thumb"><img src="' + esc(t) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add(\'bmg-fail\');this.remove()"></div>';
    return '<div class="bmg-thumb bmg-pending" data-render="' + esc(b.id) + '"></div>';
  }

  // Render vector / DEM styles to a small image, one after another.
  var queue = [], busy = false;
  function renderNext() {
    if (busy || !queue.length || typeof maplibregl === "undefined") return;
    busy = true;
    var b = queue.shift(), box = document.createElement("div");
    box.style.cssText = "position:fixed;left:-9999px;top:0;width:" + W * 2 + "px;height:" + H * 2 + "px";
    document.body.appendChild(box);
    var map, done = false;
    function finish(url) {
      if (done) return;
      done = true;
      if (url) {
        try { localStorage.setItem(THUMB + b.id, url); } catch (e) { }
        Array.prototype.forEach.call(document.querySelectorAll('[data-render="' + b.id + '"]'), function (el) {
          el.classList.remove("bmg-pending"); el.removeAttribute("data-render"); el.innerHTML = '<img src="' + url + '" alt="">';
        });
      }
      try { map.remove(); } catch (e) { }
      box.remove();
      busy = false;
      renderNext();
    }
    try {
      map = new maplibregl.Map({ container: box, style: GIS.styleFor(b.id), center: [110.4, -7.2], zoom: 5.2, interactive: false, attributionControl: false, preserveDrawingBuffer: true, fadeDuration: 0 });
      map.once("idle", function () { try { finish(map.getCanvas().toDataURL("image/jpeg", 0.72)); } catch (e) { finish(null); } });
      setTimeout(function () { finish(null); }, 15000);
    } catch (e) { finish(null); }
  }
  function queueThumbs(root) {
    Array.prototype.forEach.call(root.querySelectorAll("[data-render]"), function (el) {
      var id = el.dataset.render, b = GIS.BASEMAPS.filter(function (x) { return x.id === id; })[0];
      if (b && queue.indexOf(b) < 0) queue.push(b);
    });
    renderNext();
  }

  var pop = null;
  function close() { if (pop) { pop.remove(); pop = null; } document.removeEventListener("mousedown", outside, true); }
  function outside(e) { if (pop && !pop.contains(e.target) && !(pop._anchor && pop._anchor.contains(e.target))) close(); }

  function pick(id) {
    var b = GIS.BASEMAPS.filter(function (x) { return x.id === id; })[0];
    if (b && b.overlay) {
      // An overlay is added as a tile layer on top of the other layers.
      var l = GIS.addXYZ(b.tiles, b.label, b.attr || "");
      if (GIS.move) GIS.move(l.id, 0);
      return false;
    }
    state.mapBasemap = id;
    if (typeof render === "function") render();
    if (GIS.refreshBasemap) GIS.refreshBasemap();
    if (GIS.refreshPanel) GIS.refreshPanel();
  }

  function open(anchor) {
    if (pop) { close(); return; }
    pop = document.createElement("div");
    pop.className = "bmg-pop";
    pop._anchor = anchor;
    pop.innerHTML =
      '<div class="bmg-head"><span class="bmg-title">' + sym("map") + "Basemaps</span>" +
        '<div class="bmg-search">' + sym("search") + '<input type="search" placeholder="Search basemaps or providers" spellcheck="false"></div>' +
        '<button type="button" class="bmg-key" title="Optional: your own Google Map Tiles API key">' + sym("key") + "Google key</button>" +
        '<button type="button" class="bmg-x" title="Close">' + sym("close") + "</button></div>" +
      '<div class="bmg-body"></div>';
    document.body.appendChild(pop);
    var body = pop.querySelector(".bmg-body"), q = pop.querySelector("input");

    function draw() {
      var term = q.value.trim().toLowerCase(), h = "", group = null, open = false;
      GIS.BASEMAPS.forEach(function (b) {
        var prov = GIS.logos.ofBasemap(b), plabel = GIS.logos.label(prov);
        if (term && (b.label + " " + b.group + " " + plabel).toLowerCase().indexOf(term) < 0) return;
        if (b.group !== group) {
          if (open) h += "</div>";
          group = b.group; open = true;
          h += '<div class="bmg-group">' + esc(group) + '</div><div class="bmg-grid">';
        }
        h += '<button type="button" class="bmg-card' + (b.id === state.mapBasemap ? " active" : "") + '" data-id="' + esc(b.id) + '" title="' + esc(b.label + " — " + plabel) + '">' +
          thumbHtml(b) + '<span class="bmg-logo">' + GIS.logos.html(prov, 18) + "</span>" +
          (b.overlay ? '<span class="bmg-tag" title="Added as a layer over the basemap">+ layer</span>' : "") +
          '<span class="bmg-name">' + esc(b.label) + "</span></button>";
      });
      if (open) h += "</div>";
      body.innerHTML = h || '<div class="bmg-empty">No basemaps match.</div>';
      queueThumbs(body);
    }
    draw();
    q.addEventListener("input", draw);
    q.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    pop.querySelector(".bmg-x").addEventListener("click", close);
    pop.querySelector(".bmg-key").addEventListener("click", function () { if (GIS.google) GIS.google.askKey(); });
    body.addEventListener("click", function (e) {
      var c = e.target.closest("[data-id]");
      if (!c) return;
      if (pick(c.dataset.id) === false) { close(); if (GIS.openLayersPanel) GIS.openLayersPanel(); return; }
      Array.prototype.forEach.call(body.querySelectorAll(".bmg-card"), function (x) { x.classList.toggle("active", x === c); });
    });

    var r = anchor.getBoundingClientRect(), w = Math.min(720, window.innerWidth - 16);
    pop.style.width = w + "px";
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + "px";
    pop.style.top = r.bottom + 6 + "px";
    pop.style.maxHeight = window.innerHeight - r.bottom - 16 + "px";
    var act = body.querySelector(".active");
    if (act) act.scrollIntoView({ block: "center" });
    q.focus();
    setTimeout(function () { document.addEventListener("mousedown", outside, true); }, 0);
  }

  GIS.basemapGallery = { open: open, close: close };
  window.addEventListener("resize", close);
})();
