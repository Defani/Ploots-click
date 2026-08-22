/* ==========================================================================
   Ploots Click — lazy loader for heavy CDN libraries.

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
              (Function Plot Studio) and MathJax (LaTeX Editor & Symbols).

     Tier 3 — loaded strictly on demand, kicked off from the exact button/tab
              that needs it (AG Grid + jStat for Data View, XLSX for Excel
              import). See the call sites in data_view.js,
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
    jstat: "https://cdnjs.cloudflare.com/ajax/libs/jstat/1.9.6/jstat.min.js",
    // Plotly's cartesian bundle (vendor/plotly-cartesian.min.js) does not
    // include the choropleth/scattergeo trace modules — those only ship in
    // the "geo" partial bundle. Same major.minor.patch as the vendored
    // cartesian build (3.7.0) so trace/layout behavior stays in sync.
    // Loaded strictly on demand the first time the Choropleth Map chart
    // type is selected — see js/chart-builder/11-choropleth.js.
    plotlygeo: "https://cdn.plot.ly/plotly-geo-3.7.0.min.js",
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
    svg2pdf: "https://cdnjs.cloudflare.com/ajax/libs/svg2pdf.js/2.2.3/svg2pdf.umd.min.js",
    // D3 engine — separate rendering path from Plotly, for chart types
    // Plotly has no trace for (hierarchical/relational charts: sunburst,
    // and more to come). Loaded strictly on demand the first time a
    // "D3 Engine" chart type is selected — see js/chart-builder/15-sunburst.js.
    d3: "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"
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
    ensureJStat: function () {
      return typeof jStat !== "undefined" ? Promise.resolve() : loadScript(CDN.jstat);
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
    // Note: unlike the other ensureX() helpers, `typeof Plotly` is always
    // "object" here (the cartesian bundle loads at boot), so this tracks
    // its own loaded flag instead of feature-testing the global.
    ensurePlotlyGeo: function () {
      return window.__plotlyGeoLoaded ? Promise.resolve() : loadScript(CDN.plotlygeo).then(function () {
        window.__plotlyGeoLoaded = true;
      });
    },
    ensureD3: function () {
      return (typeof d3 !== "undefined" && d3.hierarchy) ? Promise.resolve() : loadScript(CDN.d3);
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

  // Tier 3 (AG Grid, jStat, XLSX, marked) is intentionally NOT called here —
  // see the on-demand call sites listed in the header comment above.

  window.PlootsLazy = Lazy;
})();
