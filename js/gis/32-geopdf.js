/* ==========================================================================
   GIS — GeoPDF export of the layout.

   Adds "GeoPDF" to Layout > Export. The page is exported as the flattened
   PDF (same as PDF, flatten), then geo-registered the ISO 32000 way: the page
   gets a viewport (/VP) over the map frame with a /Measure /GEO dictionary
   (WGS 84, the frame's four corners), appended as an incremental update.
   QGIS, GDAL, Avenza Maps and Adobe read the coordinates from it.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  function $(id) { return document.getElementById(id); }
  var WKT = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]';

  function latin1(u8, from) { var s = ""; for (var i = from || 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; }
  function ascii(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; }
  function n(v) { return (Math.round(v * 1e6) / 1e6).toString(); }

  // Map frame on the page (PDF points, origin bottom-left) and its corners.
  function geoFrame() {
    var proxy = window.chartProxyObj, map = GIS.map();
    if (!proxy || !map) throw new Error("No map frame on the layout.");
    var r = proxy.getBoundingRect(true, true), k = 72 / 96, H = state.canvasHeightPx * k;
    var bbox = [r.left * k, H - (r.top + r.height) * k, (r.left + r.width) * k, H - r.top * k];
    var c = map.getContainer(), w = c.clientWidth, h = c.clientHeight;
    // Lower-left, upper-left, upper-right, lower-right (matching LPTS).
    var pts = [[0, h], [0, 0], [w, 0], [w, h]].map(function (p) { return map.unproject(p); });
    return { bbox: bbox, gpts: pts.map(function (ll) { return n(ll.lat) + " " + n(ll.lng); }).join(" ") };
  }

  function geoRegister(buf, frame) {
    var u8 = new Uint8Array(buf), tail = latin1(u8, Math.max(0, u8.length - 2048)), all = latin1(u8);
    var sx = tail.match(/startxref\s+(\d+)/g), prev = +sx[sx.length - 1].match(/\d+/)[0];
    var size = +all.match(/\/Size\s+(\d+)/g).pop().match(/\d+/)[0], root = all.match(/\/Root\s+(\d+\s+\d+\s+R)/)[1];
    var m = all.match(/(\d+) 0 obj\s*<<\s*\/Type\s*\/Page\b([\s\S]*?)>>\s*endobj/);
    if (!m) throw new Error("Could not find the PDF page.");
    var num = m[1], dict = m[2];
    var vp = "/VP [<< /Type /Viewport /Name (Map) /BBox [" + frame.bbox.map(n).join(" ") + "] /Measure << /Type /Measure /Subtype /GEO " +
      "/Bounds [0 0 0 1 1 1 1 0] /LPTS [0 0 0 1 1 1 1 0] /GPTS [" + frame.gpts + "] /GCS << /Type /GEOGCS /WKT (" + WKT + ") >> >> >>]";
    var obj = "\n" + num + " 0 obj\n<< /Type /Page" + dict + "\n" + vp + "\n>>\nendobj\n";
    var objOff = u8.length + 0, xrefOff = objOff + obj.length;
    var off = String(objOff + 1).padStart(10, "0"); // +1: the leading newline
    var xref = "xref\n" + num + " 1\n" + off + " 00000 n \ntrailer\n<< /Size " + size + " /Root " + root + " /Prev " + prev + " >>\nstartxref\n" + xrefOff + "\n%%EOF\n";
    var out = new Uint8Array(u8.length + obj.length + xref.length);
    out.set(u8, 0); out.set(ascii(obj), u8.length); out.set(ascii(xref), u8.length + obj.length);
    return out;
  }

  function exportGeoPdf() {
    var frame;
    try { frame = geoFrame(); } catch (e) { alert(e.message); return Promise.resolve(); }
    return PlootsLazy.ensureJsPDF().then(function () {
      var api = window.jspdf.jsPDF.API, orig = api.save, captured = null, name = null;
      api.save = function (fn) { captured = this.output("arraybuffer"); name = fn; return this; };
      var keep = [state.exportFormat, state.exportPdfMode];
      state.exportFormat = "pdf"; state.exportPdfMode = "flatten";
      var p = Promise.resolve(window.PlootsRunExport());
      return new Promise(function (res) {
        var t0 = Date.now();
        (function wait() {
          if (captured || Date.now() - t0 > 30000) return res();
          setTimeout(wait, 100);
        })();
      }).then(function () {
        api.save = orig; state.exportFormat = keep[0]; state.exportPdfMode = keep[1];
        if (!captured) throw new Error("The PDF could not be made.");
        var bytes = geoRegister(captured, frame);
        var a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        a.download = String(name || "layout.pdf").replace(/\.pdf$/i, "") + "_geo.pdf";
        a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      });
    }).catch(function (e) { alert("GeoPDF: " + (e && e.message || e)); });
  }

  function build() {
    var g = $("exportFormatGroup"), run = $("exportRunBtn");
    if (!g || !run || g.querySelector('[data-fmt="geopdf"]')) return;
    var b = document.createElement("button");
    b.type = "button"; b.dataset.fmt = "geopdf"; b.className = (g.querySelector("[data-fmt]") || {}).className || "";
    b.classList.remove("active");
    b.textContent = "GeoPDF"; b.title = "PDF with the map frame geo-registered (WGS 84)";
    g.appendChild(b);
    var geo = false;
    function paint() {
      Array.prototype.forEach.call(g.querySelectorAll("[data-fmt]"), function (x) { x.classList.toggle("active", geo ? x === b : x.dataset.fmt === state.exportFormat); });
      if (geo) {
        var ext = $("exportFilenameExt"); if (ext) ext.textContent = ".pdf";
        var lbl = $("exportRunLabel"); if (lbl) lbl.textContent = "Export GeoPDF at " + state.exportDpi + " DPI";
        var pm = $("exportPdfModeWrap"); if (pm) pm.style.display = "none";
        var dw = $("exportDpiWrap"); if (dw) dw.style.display = "block";
      }
    }
    b.addEventListener("click", function () { geo = true; paint(); });
    g.addEventListener("click", function (e) { var x = e.target.closest("[data-fmt]"); if (x && x !== b) { geo = false; setTimeout(paint, 0); } }, true);
    var dg = $("exportDpiGroup"); if (dg) dg.addEventListener("click", function () { if (geo) setTimeout(paint, 0); });
    run.addEventListener("click", function (e) {
      if (!geo) return;
      e.stopImmediatePropagation(); e.preventDefault();
      run.disabled = true;
      exportGeoPdf().then(function () { run.disabled = false; paint(); });
    }, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(build, 400); }); else setTimeout(build, 400);
  GIS.geopdf = { exportGeoPdf: exportGeoPdf, geoRegister: geoRegister };
})();
