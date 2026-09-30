/* ==========================================================================
   GIS — color ramp picker with previews, like QGIS's ramp button.

   Every <select data-ramp> in the GIS panels (graduated, heatmap, raster
   and categorized palettes) is shown as a button with the ramp drawn on it.
   Clicking opens a searchable list of every ramp, grouped (Sequential,
   Perceptual, Diverging, Terrain & special, Rainbow, and the data
   visualization palettes), each with its preview. Picking one sets the
   select and fires "change", so the panel's own handling applies it.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function colorsOf(name) {
    if (!name) return typeof PALETTES !== "undefined" && PALETTES[state.paletteIdx] ? PALETTES[state.paletteIdx].colors : [];
    return GIS.sym.rampColors(name, false);
  }
  // Continuous ramps blend; palettes for categories show their colors as blocks.
  function css(colors, blocks) {
    if (!colors.length) return "transparent";
    if (colors.length === 1) return colors[0];
    if (!blocks) return "linear-gradient(to right," + colors.join(",") + ")";
    var n = colors.length, stops = colors.map(function (c, i) { return c + " " + (i / n * 100).toFixed(2) + "% " + ((i + 1) / n * 100).toFixed(2) + "%"; });
    return "linear-gradient(to right," + stops.join(",") + ")";
  }
  function label(v, sel) {
    if (!v) { var o = sel.querySelector('option[value=""]'); return o ? o.textContent : "—"; }
    return v.replace(/^ColorBrewer /, "");
  }

  function enhance(sel) {
    if (sel._rp) return;
    sel._rp = true;
    var blocks = sel.dataset.ramp === "qual";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rp-btn";
    btn.innerHTML = '<span class="rp-bar"></span><span class="rp-name"></span><span class="material-symbols-outlined">expand_more</span>';
    function paint() {
      btn.querySelector(".rp-bar").style.background = css(colorsOf(sel.value), blocks);
      btn.querySelector(".rp-name").textContent = label(sel.value, sel);
    }
    paint();
    sel.style.display = "none";
    sel.after(btn);
    sel.addEventListener("change", paint);
    btn.addEventListener("click", function (e) { e.stopPropagation(); open(sel, btn, blocks); });
  }

  var pop = null;
  function close() { if (pop) { pop.remove(); pop = null; } document.removeEventListener("mousedown", outside, true); }
  function outside(e) { if (pop && !pop.contains(e.target) && !e.target.closest(".rp-btn")) close(); }

  function open(sel, btn, blocks) {
    if (pop && pop._sel === sel) { close(); return; }
    close();
    pop = document.createElement("div");
    pop.className = "rp-pop";
    pop._sel = sel;
    var rev = !!(sel.closest(".sidebar-panel, .gisw-dock-body") || document).querySelector('[data-bind="' + sel.dataset.bind.split(":")[0] + ':reverse"]:checked');
    pop.innerHTML = '<div class="rp-search"><span class="material-symbols-outlined">search</span><input type="search" placeholder="Search ramps" spellcheck="false"></div><div class="rp-list"></div>';
    document.body.appendChild(pop);
    var list = pop.querySelector(".rp-list"), q = pop.querySelector("input");

    function render() {
      var term = q.value.trim().toLowerCase(), h = "";
      var groups = [];
      // Options in document order, grouped by their optgroup.
      Array.prototype.forEach.call(sel.children, function (c) {
        if (c.tagName === "OPTION") groups.push({ label: "", opts: [c] });
        else groups.push({ label: c.label, opts: Array.prototype.slice.call(c.children) });
      });
      groups.forEach(function (g) {
        var rows = g.opts.filter(function (o) { return !term || o.textContent.toLowerCase().indexOf(term) >= 0; });
        if (!rows.length) return;
        if (g.label) h += '<div class="rp-group">' + esc(g.label) + "</div>";
        rows.forEach(function (o) {
          var c = colorsOf(o.value);
          if (rev && !blocks) c = c.slice().reverse();
          h += '<button type="button" class="rp-row' + (o.value === sel.value ? " active" : "") + '" data-v="' + esc(o.value) + '">' +
            '<span class="rp-bar" style="background:' + css(c, blocks || !o.value) + '"></span><span class="rp-name">' + esc(o.textContent) + "</span></button>";
        });
      });
      list.innerHTML = h || '<div class="rp-empty">No ramps match.</div>';
    }
    render();
    q.addEventListener("input", render);
    q.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    list.addEventListener("click", function (e) {
      var r = e.target.closest("[data-v]");
      if (!r) return;
      sel.value = r.dataset.v;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      close();
    });

    // Under the button, or above it when there is no room below.
    var b = btn.getBoundingClientRect(), w = Math.max(260, b.width);
    pop.style.width = w + "px";
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, b.left)) + "px";
    var below = window.innerHeight - b.bottom - 8, hgt = Math.min(420, Math.max(below, b.top - 8));
    pop.style.maxHeight = hgt + "px";
    if (below >= Math.min(300, hgt)) pop.style.top = b.bottom + 4 + "px";
    else pop.style.bottom = window.innerHeight - b.top + 4 + "px";
    var act = list.querySelector(".active");
    if (act) act.scrollIntoView({ block: "center" });
    q.focus();
    setTimeout(function () { document.addEventListener("mousedown", outside, true); }, 0);
  }

  // Panels re-render their HTML often: enhance new ramp selects as they appear.
  var queued = false;
  function scan() {
    queued = false;
    document.querySelectorAll("select[data-ramp]").forEach(enhance);
    if (pop && !document.body.contains(pop._sel)) close();
  }
  function boot() {
    scan();
    new MutationObserver(function () { if (!queued) { queued = true; requestAnimationFrame(scan); } })
      .observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", close);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
