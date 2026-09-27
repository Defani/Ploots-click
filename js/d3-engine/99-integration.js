/* ==========================================================================
   Ploots D3 engine — integration with the rest of the app.

   Loaded after every chart-builder and layout-editor file and before
   undo_redo.js (which wraps window.render last, for history).

     1. window.render: chart types with a D3 renderer go to PlootsD3;
        everything else still goes to the previous render chain (Plotly and
        the hand-written SVG types) until it is migrated. Any D3 <svg> left
        in #plotlyDiv is removed before handing over, so Plotly never draws
        next to a stale D3 chart.
     2. renderBlankCanvas: D3 (no Plotly needed for an empty chart).
     3. Single-shot exportSvgFile / exportPngFile for D3 types. The export
        panel in 08-helpers-export.js treats D3 types as raw-SVG types via
        isRawSvgChartType(), so PNG/JPG/SVG/PDF all serialise the D3 <svg>.
     4. Format Axis click strips (22-axis-format-panel.js) read the plot
        geometry the D3 frame stores on the graph div.
   ========================================================================== */
(function () {
  "use strict";

  var PD = window.PlootsD3;
  if (!PD || typeof d3 === "undefined") {
    console.warn("Ploots: D3 engine not available, falling back to Plotly for every chart type.");
    return;
  }

  function gd() { return document.getElementById("plotlyDiv"); }

  function afterRender() {
    var st = window.state;
    st.chartRenderedW = st.chartBox.w;
    st.chartRenderedH = st.chartBox.h;
    if (typeof bindAxisLegendInteractions === "function") bindAxisLegendInteractions();
    if (typeof syncDetachedLegend === "function") syncDetachedLegend();
  }

  PD.renderActive = function () {
    var el = gd();
    if (!el) return;
    if (!window.state.categories.length) PD.renderBlank(el);
    else PD.renderers[window.state.chartType](el, window.state);
    afterRender();
  };

  var previousRender = window.render;
  window.render = function () {
    if (PD.handles(window.state.chartType)) return PD.renderActive();
    var el = gd();
    if (el) {
      var stale = el.querySelector("svg.ploots-d3");
      if (stale) { el.removeChild(stale); el._plootsD3 = null; }
    }
    return previousRender.apply(this, arguments);
  };

  window.renderBlankCanvas = function () {
    var el = gd();
    if (!el) return;
    PD.renderBlank(el);
    window.state.chartRenderedW = window.state.chartBox.w;
    window.state.chartRenderedH = window.state.chartBox.h;
  };
  // Replace the Plotly blank canvas drawn at boot.
  if (!window.state.categories.length) window.renderBlankCanvas();

  /* ---------------------------------------------------------- export */

  // Radial rings and sunburst build their own <svg> (registered as D3
  // renderers in 05-special.js), so accept any chart svg.
  function d3SvgEl() {
    var el = gd();
    return el ? (el.querySelector("svg.ploots-d3") || el.querySelector("svg")) : null;
  }

  function serialise(svgEl) {
    var xml = new XMLSerializer().serializeToString(svgEl);
    if (!/^<\?xml/.test(xml)) xml = '<?xml version="1.0" standalone="no"?>\r\n' + xml;
    return xml;
  }

  var previousExportSvg = window.exportSvgFile;
  window.exportSvgFile = function () {
    if (!PD.handles(window.state.chartType)) return previousExportSvg && previousExportSvg();
    var svgEl = d3SvgEl();
    if (!svgEl) return;
    var blob = new Blob([serialise(svgEl)], { type: "image/svg+xml;charset=utf-8" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "chart.svg"; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  var previousExportPng = window.exportPngFile;
  window.exportPngFile = function () {
    if (!PD.handles(window.state.chartType)) return previousExportPng && previousExportPng();
    var svgEl = d3SvgEl();
    if (!svgEl) return;
    var st = window.state, dpiSel = document.getElementById("dpiSelect");
    var dpi = parseInt(dpiSel && dpiSel.value) || 300, scale = dpi / 96, r = st.chartBox;
    var canvas = document.createElement("canvas");
    canvas.width = Math.round(st.canvasWidthPx * scale);
    canvas.height = Math.round(st.canvasHeightPx * scale);
    var ctx = canvas.getContext("2d");
    if (st.canvasBg !== "transparent") { ctx.fillStyle = st.canvasBg || "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    var img = new Image();
    img.onload = function () {
      ctx.drawImage(img, r.x * scale, r.y * scale, r.w * scale, r.h * scale);
      function finish() {
        var a = document.createElement("a");
        a.href = canvas.toDataURL("image/png"); a.download = "layout_" + dpi + "dpi.png"; a.click();
      }
      var overlay = typeof getFabricOverlayDataUrl === "function" ? getFabricOverlayDataUrl(scale) : null;
      if (!overlay) return finish();
      var o = new Image();
      o.onload = function () { ctx.drawImage(o, 0, 0, canvas.width, canvas.height); finish(); };
      o.src = overlay;
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(serialise(svgEl));
  };

  /* --------------------------------------------- Format Axis click strips */

  var previousStrips = window.axisFormatGetAxisStrips;
  if (typeof previousStrips === "function") {
    window.axisFormatGetAxisStrips = function () {
      var el = gd(), pane = document.getElementById("paneLayout");
      if (el && el.querySelector("svg.ploots-d3")) {
        var g = el._plootsD3;
        if (!g || !pane || !pane.classList.contains("active")) return null;
        var rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        var k = rect.width / g.width, p = g.plot;
        var L = rect.left + p.l * k, R = L + p.w * k, T = rect.top + p.t * k, B = T + p.h * k;
        return { x: { left: L, right: R, top: B, bottom: rect.bottom }, y: { left: rect.left, right: L, top: T, bottom: B } };
      }
      return previousStrips.apply(this, arguments);
    };
  }
})();
