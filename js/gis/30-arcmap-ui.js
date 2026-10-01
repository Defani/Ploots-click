/* ==========================================================================
   GIS — ArcMap-style frame.

   - Data view / Layout view: two small buttons at the bottom left of the
     view (in the status bar in Data view, by the zoom bar in Layout view),
     instead of the Analysis / Cartography switch in the top bar.
   - The map tools (pan, select, identify, measure, zoom, extents, terrain,
     globe) sit in the top bar in Data view, with a scale box (1:…) that
     shows the current scale and sets it when a scale is typed or picked.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  function $(id) { return document.getElementById(id); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  // On-screen scale of the Data view map (as the status bar shows it).
  function screenScale(map) {
    var c = map.getContainer(), y = c.clientHeight / 2, x = c.clientWidth / 2;
    var a = map.unproject([x - 50, y]), b = map.unproject([x + 50, y]);
    return d3.geoDistance([a.lng, a.lat], [b.lng, b.lat]) * 6371008.8 / 100 / (0.0254 / 96);
  }
  function setScreenScale(n) { var m = GIS.map(), cur = m && screenScale(m); if (cur > 0 && n > 0) m.setZoom(m.getZoom() + Math.log2(cur / n)); }
  var SCALES = [1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000];

  function seg() { return document.querySelector(".gisw-seg"); }
  function mode() { return document.body.classList.contains("gis-carto") ? "cartography" : "analysis"; }
  function go(v) { var b = seg() && seg().querySelector('[data-v="' + v + '"]'); if (b) b.click(); }

  var sw = null, tb = null, scaleIn = null;
  function build() {
    if (sw) return;
    sw = document.createElement("div");
    sw.className = "view-switch";
    sw.innerHTML = '<button type="button" data-v="analysis" title="Data view">' + sym("public") + '</button><button type="button" data-v="cartography" title="Layout view">' + sym("description") + "</button>";
    sw.addEventListener("click", function (e) { var b = e.target.closest("[data-v]"); if (b) go(b.dataset.v); });

    // Top-bar group: scale box + the map tools.
    tb = document.createElement("div");
    tb.className = "tool-group arc-tools";
    tb.innerHTML = '<label class="arc-scale" title="Map scale">1:<input type="text" list="arcScales" spellcheck="false" autocomplete="off"></label>' +
      '<datalist id="arcScales">' + SCALES.map(function (s) { return '<option value="' + s.toLocaleString("en-US") + '">'; }).join("") + "</datalist>";
    scaleIn = tb.querySelector("input");
    function setFromInput() {
      var n = parseFloat(String(scaleIn.value).replace(/[^\d.]/g, ""));
      if (n > 0) setScreenScale(n);
      scaleIn.blur();
    }
    scaleIn.addEventListener("change", setFromInput);
    scaleIn.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") setFromInput(); if (e.key === "Escape") scaleIn.blur(); });
    var center = document.querySelector(".topbar-center");
    if (center) center.insertBefore(tb, center.firstChild.nextSibling);
    place();
    new MutationObserver(place).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    setInterval(tick, 400);
  }
  // Keep the switch and tools where they belong for the current view.
  function place() {
    if (!sw) return;
    var m = mode(), inGis = document.body.classList.contains("gis-mode");
    Array.prototype.forEach.call(sw.children, function (b) { b.classList.toggle("active", b.dataset.v === m); });
    var host = m === "cartography" ? $("canvasZoomBar") : $("gisStatusBar");
    if (host && sw.parentNode !== host) host.insertBefore(sw, host.firstChild);
    sw.style.display = inGis ? "" : "none";
    tb.style.display = inGis && m === "analysis" ? "" : "none";
    // The map toolbar moves from over the map into the top bar.
    var tools = document.querySelector(".gis-map-tools-analysis");
    if (tools && inGis && m === "analysis" && tools.parentNode !== tb) { tools.classList.add("arc-map-tools"); tb.appendChild(tools); }
  }
  function tick() {
    var tools = document.querySelector(".gis-map-tools-analysis");
    if (tools && tools.parentNode !== tb && document.body.classList.contains("gis-mode") && mode() === "analysis") place();
    if (!scaleIn || document.activeElement === scaleIn || tb.style.display === "none") return;
    var m = GIS.map(), s = m && screenScale(m);
    if (s) scaleIn.value = Math.round(s).toLocaleString("en-US");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(build, 200); }); else setTimeout(build, 200);
})();
