/* ==========================================================================
   GIS Consultant Studio — lazy loader for heavy CDN libraries.

   Previously all 8 of these loaded blocking in <head> on every visit, even
   for panels the user never opens. This file replaces that with 3 tiers:

     Tier 1 — fired immediately, in parallel with HTML parsing (does NOT
              block first paint, but starts the network request right away).
              Reserved for libs needed almost instantly: Fabric.js backs the
              layout canvas, which is the default view; Papa Parse backs the
              core "paste your data" flow described in the README.

     Tier 2 — fired once the browser reports it's idle after first paint, so
              it never competes with Tier 1 or the initial render. Reserved
              for libs used often, but not in the first frame: math.js
              (Data View formulas) and MathJax (LaTeX Editor & Symbols).

     Tier 3 — loaded strictly on demand, kicked off from the exact button/tab
              that needs it (AG Grid for Data View, XLSX for Excel import).
              jStat has been removed — Data View statistics now always use
              the plain-JS fallback math baked into data_stats.js, no CDN
              fetch involved. See the call sites in data_view.js,
              chart-builder/10-view-switcher-init.js and
              chart-builder/04-data.js.

   Every ensureX() function is idempotent and safe to call from multiple
   places at once (in-flight requests are deduped, already-loaded libs
   resolve instantly) — so "prefetch on intent" (e.g. on tab click) and a
   defensive check at the point of use (e.g. right before agGrid.createGrid)
   can both call the same function with no double-loading and no race.
   ========================================================================== */
(function () {
  "use strict";

  var CDN = {
    fabric: "https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js",
    papaparse: "https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js",
    mathjs: "https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.3/math.min.js",
    mathjax: "https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg.js",
    xlsx: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
    aggrid: "https://cdnjs.cloudflare.com/ajax/libs/ag-grid/35.3.0/ag-grid-community.min.js",
    // marked isn't referenced anywhere in the current js/*.js (it was dead
    // weight in the old <head> tags — nothing ever called marked(...)).
    // Left registered so a future splash/about screen can call
    // PlootsLazy.ensureMarked() instead of adding a new blocking tag.
    marked: "https://cdnjs.cloudflare.com/ajax/libs/marked/16.3.0/lib/marked.umd.min.js",
    // PDF export (panel-export "PDF" format). jsPDF alone covers the
    // "Flatten" raster mode (addImage of a composed PNG). svg2pdf.js is
    // only needed for the "Vector" mode — it patches jsPDF.API with a
    // .svg() method that walks an <svg> DOM tree into real PDF vector
    // instructions, so it must load strictly after jspdf itself.
    jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
    svg2pdf: "https://cdn.jsdelivr.net/npm/svg2pdf.js@2.2.3/dist/svg2pdf.umd.min.js",
    // D3 fallback: vendor/d3-7.9.0.min.js is loaded eagerly by index.html,
    // so this CDN copy is only fetched if that local file failed to load.
    d3: "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js",
    // GeoJSON Map chart type (js/d3-engine/07-maplibre.js), on demand.
    maplibre: "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.9.0/maplibre-gl.js",
    maplibreCss: "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.9.0/maplibre-gl.css"
  };

  var pending = {};

  function loadScript(url) {
    if (pending[url]) return pending[url];
    pending[url] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        delete pending[url]; // allow a retry on the next call
        reject(new Error("Ploots: failed to load " + url));
      };
      document.head.appendChild(s);
    });
    return pending[url];
  }

  function loadCss(url) {
    if (pending[url]) return pending[url];
    pending[url] = new Promise(function (resolve) {
      var l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = url;
      l.onload = l.onerror = function () { resolve(); }; // unstyled popups are not fatal
      document.head.appendChild(l);
    });
    return pending[url];
  }

  var Lazy = {
    ensureFabric: function () {
      return typeof fabric !== "undefined" ? Promise.resolve() : loadScript(CDN.fabric);
    },
    ensurePapaParse: function () {
      return typeof Papa !== "undefined" ? Promise.resolve() : loadScript(CDN.papaparse);
    },
    ensureMathJs: function () {
      return typeof math !== "undefined" ? Promise.resolve() : loadScript(CDN.mathjs);
    },
    ensureMathJax: function () {
      return (typeof MathJax !== "undefined" && MathJax.tex2svg) ? Promise.resolve() : loadScript(CDN.mathjax);
    },
    ensureXLSX: function () {
      return typeof XLSX !== "undefined" ? Promise.resolve() : loadScript(CDN.xlsx);
    },
    ensureAgGrid: function () {
      return (typeof agGrid !== "undefined" && agGrid.themeQuartz) ? Promise.resolve() : loadScript(CDN.aggrid);
    },
    ensureMarked: function () {
      return typeof marked !== "undefined" ? Promise.resolve() : loadScript(CDN.marked);
    },
    ensureJsPDF: function () {
      return (window.jspdf && window.jspdf.jsPDF) ? Promise.resolve() : loadScript(CDN.jspdf);
    },
    ensureSvg2Pdf: function () {
      return Lazy.ensureJsPDF().then(function () {
        return (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.svg)
          ? Promise.resolve() : loadScript(CDN.svg2pdf);
      });
    },
    ensureD3: function () {
      return (typeof d3 !== "undefined" && d3.hierarchy) ? Promise.resolve() : loadScript(CDN.d3);
    },
    ensureMapLibre: function () {
      loadCss(CDN.maplibreCss);
      return typeof maplibregl !== "undefined" ? Promise.resolve() : loadScript(CDN.maplibre);
    }
  };

  function whenIdle(fn, timeout) {
    if ("requestIdleCallback" in window) requestIdleCallback(fn, { timeout: timeout || 2000 });
    else setTimeout(fn, timeout || 1200);
  }

  // --- Tier 1: fire now (parallel fetch, does not block parsing/render) ---
  Lazy.ensureFabric();
  Lazy.ensurePapaParse();

  // --- Tier 2: fire once idle, so it never competes with Tier 1 ---
  whenIdle(function () { Lazy.ensureMathJs(); }, 2000);
  whenIdle(function () { Lazy.ensureMathJax(); }, 3000);

  // Tier 3 (AG Grid, XLSX, marked) is intentionally NOT called here —
  // see the on-demand call sites listed in the header comment above.

  window.PlootsLazy = Lazy;
})();
