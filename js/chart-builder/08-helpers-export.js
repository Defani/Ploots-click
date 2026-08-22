function escapeHtml(t) {
  return (t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function hexToRgba(t, e) {
  if (3 === (t = t.replace("#", "")).length) t = t.split("").map(function (c) { return c + c; }).join("");
  return "rgba(" + parseInt(t.substr(0, 2), 16) + "," + parseInt(t.substr(2, 2), 16) + "," + parseInt(t.substr(4, 2), 16) + "," + e + ")";
}
function plotlyColorscaleFromPalette(t) {
  var e = t.length;
  return t.map(function (c, a) { return [a / (e - 1 || 1), c]; });
}

/* ==========================================================================
   Original single-format exporters. Kept unchanged (same names, same
   dpiSelect read) because js/chart-builder/12-radial-rings.js wraps
   window.exportSvgFile / window.exportPngFile unconditionally at load
   time to special-case its own hand-drawn SVG chart type. The new panel
   below reads a hidden #dpiSelect input to stay in sync with these.
   ========================================================================== */
function exportSvgFile() {
  var box = state.chartBox;
  Plotly.toImage(document.getElementById("plotlyDiv"), { format: "svg", width: box.w, height: box.h }).then(function (url) {
    var a = document.createElement("a");
    a.href = url;
    a.download = "chart.svg";
    a.click();
  });
}
function exportPngFile() {
  var dpi = parseInt(document.getElementById("dpiSelect").value) || 300;
  var scale = dpi / 96;
  var w = state.canvasWidthPx, h = state.canvasHeightPx, box = state.chartBox;
  Plotly.toImage(document.getElementById("plotlyDiv"), { format: "png", width: box.w, height: box.h, scale: scale }).then(function (chartUrl) {
    var canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = (typeof state !== "undefined" && state.canvasBg && "transparent" !== state.canvasBg) ? state.canvasBg : "#ffffff";
    if (!(typeof state !== "undefined" && "transparent" === state.canvasBg)) ctx.fillRect(0, 0, canvas.width, canvas.height);
    var img = new Image();
    function finish() {
      var a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = "layout_" + dpi + "dpi.png";
      a.click();
    }
    img.onload = function () {
      ctx.drawImage(img, box.x * scale, box.y * scale, box.w * scale, box.h * scale);
      if (typeof getFabricOverlayDataUrl === "function") {
        var overlayUrl = getFabricOverlayDataUrl(scale);
        if (overlayUrl) {
          var overlayImg = new Image();
          overlayImg.onload = function () { ctx.drawImage(overlayImg, 0, 0, canvas.width, canvas.height); finish(); };
          overlayImg.src = overlayUrl;
          return;
        }
      }
      finish();
    };
    img.src = chartUrl;
  });
}

/* ==========================================================================
   Multi-format export panel — PNG / JPG / SVG / PDF (vector or flattened),
   DPI 75/100/300/600, custom file name, and a background that can follow
   the canvas color, force white, or go transparent. Wired at the bottom
   of this file into #panel-export.
   ========================================================================== */
(function () {
  "use strict";

  if (!state.exportFormat) state.exportFormat = "png";
  if (!state.exportDpi) state.exportDpi = 300;
  if (!state.exportBg) state.exportBg = "canvas";
  if (!state.exportPdfMode) state.exportPdfMode = "vector";
  if (state.exportFilename === undefined) state.exportFilename = "layout";

  function sanitizeFilename(name) {
    var clean = (name || "").trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ");
    return clean || "layout";
  }

  // Resolves the export panel's background choice into either a hex color
  // or the literal string "transparent". JPG has no alpha channel, so
  // "transparent" silently falls back to white for that one format.
  function resolveExportBg() {
    var bg = state.exportBg;
    if (bg === "white") return "#ffffff";
    if (bg === "transparent") return state.exportFormat === "jpg" ? "#ffffff" : "transparent";
    return (state.canvasBg && state.canvasBg !== "transparent") ? state.canvasBg : (state.exportFormat === "jpg" ? "#ffffff" : "transparent");
  }

  // Temporarily re-renders the live chart with the export's own background
  // (instead of the canvas's on-screen background) so PNG/JPG/PDF captures
  // don't show a seam between the plot area and the exported page. Calling
  // `done()` restores the on-screen chart back to normal.
  function withChartBg(bgForChart, work) {
    var original = state.canvasBg;
    var chartBg = bgForChart === "transparent" ? "transparent" : bgForChart;
    if (chartBg === original) { work(function () {}); return; }
    state.canvasBg = chartBg;
    render();
    setTimeout(function () {
      work(function () {
        state.canvasBg = original;
        render();
      });
    }, 60);
  }

  function isRawSvgChartType() {
    return state.chartType === "radial-rings" || state.chartType === "sunburst";
  }

  function getChartRasterDataUrl(scale) {
    var box = state.chartBox;
    if (isRawSvgChartType()) {
      var el = document.getElementById("plotlyDiv");
      var svgEl = el ? el.querySelector("svg") : null;
      if (!svgEl) return Promise.reject(new Error("Nothing to export yet."));
      return new Promise(function (resolve, reject) {
        var xml = new XMLSerializer().serializeToString(svgEl);
        var svg64 = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
        var img = new Image();
        img.onload = function () {
          var c = document.createElement("canvas");
          c.width = Math.round(box.w * scale);
          c.height = Math.round(box.h * scale);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/png"));
        };
        img.onerror = reject;
        img.src = svg64;
      });
    }
    return Plotly.toImage(document.getElementById("plotlyDiv"), { format: "png", width: box.w, height: box.h, scale: scale });
  }

  function getChartSvgMarkup() {
    var box = state.chartBox;
    if (isRawSvgChartType()) {
      var el = document.getElementById("plotlyDiv");
      var svgEl = el ? el.querySelector("svg") : null;
      if (!svgEl) return Promise.reject(new Error("Nothing to export yet."));
      return Promise.resolve(new XMLSerializer().serializeToString(svgEl));
    }
    return Plotly.toImage(document.getElementById("plotlyDiv"), { format: "svg", width: box.w, height: box.h }).then(function (dataUrl) {
      var comma = dataUrl.indexOf(",");
      var payload = dataUrl.slice(comma + 1);
      return dataUrl.indexOf(";base64,") !== -1 ? atob(payload) : decodeURIComponent(payload);
    });
  }

  function innerMarkupOf(svgString) {
    var doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
    var root = doc.documentElement;
    return root ? root.innerHTML : "";
  }

  // Composes the full exported page as one <canvas> — background fill,
  // chart bitmap positioned at chartBox, Fabric overlay (text/shapes/
  // legend) on top — at the given DPI scale relative to 96dpi screen px.
  function composeExportCanvas(scale, bgColor) {
    var w = state.canvasWidthPx, h = state.canvasHeightPx, box = state.chartBox;
    return getChartRasterDataUrl(scale).then(function (chartUrl) {
      return new Promise(function (resolve, reject) {
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        var ctx = canvas.getContext("2d");
        if (bgColor !== "transparent") { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        var chartImg = new Image();
        chartImg.onload = function () {
          ctx.drawImage(chartImg, box.x * scale, box.y * scale, box.w * scale, box.h * scale);
          var overlayUrl = typeof getFabricOverlayDataUrl === "function" ? getFabricOverlayDataUrl(scale) : null;
          if (!overlayUrl) { resolve(canvas); return; }
          var overlayImg = new Image();
          overlayImg.onload = function () { ctx.drawImage(overlayImg, 0, 0, canvas.width, canvas.height); resolve(canvas); };
          overlayImg.onerror = reject;
          overlayImg.src = overlayUrl;
        };
        chartImg.onerror = reject;
        chartImg.src = chartUrl;
      });
    });
  }

  // Composes the full exported page as one flat SVG string — same layering
  // as composeExportCanvas, but every layer stays vector.
  function composeExportSvgString(bgColor) {
    var w = state.canvasWidthPx, h = state.canvasHeightPx, box = state.chartBox;
    return getChartSvgMarkup().then(function (chartSvg) {
      var fabricSvg = typeof getFabricOverlaySvgMarkup === "function" ? getFabricOverlaySvgMarkup() : "";
      var bgRect = bgColor !== "transparent" ? '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + bgColor + '"/>' : "";
      var parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">',
        bgRect,
        '<g transform="translate(' + box.x + ',' + box.y + ')">' + innerMarkupOf(chartSvg) + '</g>',
        '<g>' + innerMarkupOf(fabricSvg) + '</g>',
        '</svg>'
      ];
      return parts.join("");
    });
  }

  function downloadUrl(href, filename) {
    var a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.click();
  }
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    downloadUrl(url, filename);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function runExport() {
    var base = sanitizeFilename(state.exportFilename);
    var dpi = state.exportDpi;
    var scale = dpi / 96;
    var bg = resolveExportBg();
    var format = state.exportFormat;

    withChartBg(bg, function (done) {
      if (format === "png" || format === "jpg") {
        composeExportCanvas(scale, format === "jpg" ? (bg === "transparent" ? "#ffffff" : bg) : bg).then(function (canvas) {
          var mime = format === "jpg" ? "image/jpeg" : "image/png";
          downloadUrl(canvas.toDataURL(mime, 0.92), base + "_" + dpi + "dpi." + format);
          done();
        }).catch(function () { done(); });
        return;
      }
      if (format === "svg") {
        composeExportSvgString(bg).then(function (svgString) {
          downloadBlob(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }), base + ".svg");
          done();
        }).catch(function () { done(); });
        return;
      }
      if (format === "pdf" && state.exportPdfMode === "flatten") {
        PlootsLazy.ensureJsPDF().then(function () {
          return composeExportCanvas(scale, bg === "transparent" ? "#ffffff" : bg);
        }).then(function (canvas) {
          var ptW = state.canvasWidthPx * 72 / 96, ptH = state.canvasHeightPx * 72 / 96;
          var pdf = new window.jspdf.jsPDF({ orientation: ptW > ptH ? "landscape" : "portrait", unit: "pt", format: [ptW, ptH] });
          pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, ptW, ptH);
          pdf.save(base + "_" + dpi + "dpi.pdf");
          done();
        }).catch(function () { done(); });
        return;
      }
      if (format === "pdf" && state.exportPdfMode === "vector") {
        PlootsLazy.ensureSvg2Pdf().then(function () {
          return composeExportSvgString(bg);
        }).then(function (svgString) {
          var w = state.canvasWidthPx, h = state.canvasHeightPx;
          var ptW = w * 72 / 96, ptH = h * 72 / 96;
          var svgEl = new DOMParser().parseFromString(svgString, "image/svg+xml").documentElement;
          var pdf = new window.jspdf.jsPDF({ orientation: ptW > ptH ? "landscape" : "portrait", unit: "pt", format: [ptW, ptH] });
          return pdf.svg(svgEl, { x: 0, y: 0, width: ptW, height: ptH }).then(function () {
            pdf.save(base + "_vector.pdf");
            done();
          });
        }).catch(function () { done(); });
        return;
      }
      done();
    });
  }

  window.PlootsRunExport = runExport;

  // ---- Panel wiring ----
  var fmtGroup = document.getElementById("exportFormatGroup");
  var dpiGroup = document.getElementById("exportDpiGroup");
  var pdfModeGroup = document.getElementById("exportPdfModeGroup");
  var dpiWrap = document.getElementById("exportDpiWrap");
  var pdfModeWrap = document.getElementById("exportPdfModeWrap");
  var filenameInput = document.getElementById("exportFilename");
  var filenameExt = document.getElementById("exportFilenameExt");
  var bgGroup = document.getElementById("exportBgGroup");
  var bgNote = document.getElementById("exportBgNote");
  var runBtn = document.getElementById("exportRunBtn");
  var runLabel = document.getElementById("exportRunLabel");
  var hiddenDpiSelect = document.getElementById("dpiSelect");

  function paintExportPanel() {
    if (fmtGroup) Array.prototype.forEach.call(fmtGroup.querySelectorAll("[data-fmt]"), function (b) {
      b.classList.toggle("active", b.dataset.fmt === state.exportFormat);
    });
    if (dpiGroup) Array.prototype.forEach.call(dpiGroup.querySelectorAll("[data-dpi]"), function (b) {
      b.classList.toggle("active", parseInt(b.dataset.dpi) === state.exportDpi);
    });
    if (pdfModeGroup) Array.prototype.forEach.call(pdfModeGroup.querySelectorAll("[data-pdfmode]"), function (b) {
      b.classList.toggle("active", b.dataset.pdfmode === state.exportPdfMode);
    });
    if (dpiWrap) dpiWrap.style.display = (state.exportFormat === "svg" || (state.exportFormat === "pdf" && state.exportPdfMode === "vector")) ? "none" : "block";
    if (pdfModeWrap) pdfModeWrap.style.display = state.exportFormat === "pdf" ? "block" : "none";
    if (filenameExt) filenameExt.textContent = "." + state.exportFormat;
    if (hiddenDpiSelect) hiddenDpiSelect.value = state.exportDpi;

    var jpgActive = state.exportFormat === "jpg";
    if (bgGroup) Array.prototype.forEach.call(bgGroup.querySelectorAll("[data-bg]"), function (b) {
      b.classList.toggle("active", b.dataset.bg === state.exportBg);
      var disabled = jpgActive && b.dataset.bg === "transparent";
      b.style.opacity = disabled ? "0.45" : "1";
      b.style.cursor = disabled ? "default" : "pointer";
    });
    if (bgNote) bgNote.style.display = (jpgActive && state.exportBg === "transparent") ? "block" : "none";

    if (runLabel) {
      var label = "Export " + state.exportFormat.toUpperCase();
      if (state.exportFormat === "pdf") label += state.exportPdfMode === "vector" ? " (vector)" : " (flatten)";
      if (state.exportFormat !== "svg" && !(state.exportFormat === "pdf" && state.exportPdfMode === "vector")) label += " at " + state.exportDpi + " DPI";
      runLabel.textContent = label;
    }
  }

  if (fmtGroup) fmtGroup.querySelectorAll("[data-fmt]").forEach(function (b) {
    b.addEventListener("click", function () {
      state.exportFormat = b.dataset.fmt;
      if (state.exportFormat === "jpg" && state.exportBg === "transparent") state.exportBg = "white";
      paintExportPanel();
    });
  });
  if (dpiGroup) dpiGroup.querySelectorAll("[data-dpi]").forEach(function (b) {
    b.addEventListener("click", function () { state.exportDpi = parseInt(b.dataset.dpi); paintExportPanel(); });
  });
  if (pdfModeGroup) pdfModeGroup.querySelectorAll("[data-pdfmode]").forEach(function (b) {
    b.addEventListener("click", function () { state.exportPdfMode = b.dataset.pdfmode; paintExportPanel(); });
  });
  if (filenameInput) filenameInput.addEventListener("input", function () { state.exportFilename = filenameInput.value; });
  if (bgGroup) bgGroup.querySelectorAll("[data-bg]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (state.exportFormat === "jpg" && b.dataset.bg === "transparent") return;
      state.exportBg = b.dataset.bg;
      paintExportPanel();
    });
  });
  if (runBtn) runBtn.addEventListener("click", function () {
    runBtn.disabled = true;
    var restoreLabel = runLabel ? runLabel.textContent : "";
    if (runLabel) runLabel.textContent = "Exporting…";
    Promise.resolve(runExport()).then(function () {}).catch(function () {}).then(function () {
      setTimeout(function () { runBtn.disabled = false; paintExportPanel(); }, 400);
    });
    setTimeout(function () { runBtn.disabled = false; if (runLabel) runLabel.textContent = restoreLabel; }, 6000);
  });

  paintExportPanel();
})();
