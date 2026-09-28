/* ==========================================================================
   GIS — raster layers (GeoTIFF).

   A GeoTIFF is read with geotiff.js (lazy, jsDelivr), downsampled to at most
   MAX_DIM pixels on its long side, coloured on a canvas and handed to
   MapLibre as an image source with four corner coordinates.

   CRS support: EPSG:4326 (resampled row-by-row into Web Mercator so it lines
   up at any latitude), EPSG:3857, and WGS 84 / UTM zones (EPSG:326xx north,
   327xx south; corners reprojected, which is accurate for the usual
   scene-sized rasters). Anything else is reported instead of being drawn in
   the wrong place.

   Rendering: single band on a colour ramp (percentile stretch by default,
   no-data transparent) or three-band RGB. The band arrays are kept so the
   style can change without re-reading the file.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var MAX_DIM = 1600;
  var GEOTIFF_URL = "https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js";

  function ensureGeoTIFF() {
    if (typeof GeoTIFF !== "undefined") return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = GEOTIFF_URL; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error("Could not load geotiff.js")); };
      document.head.appendChild(s);
    });
  }

  /* -------------------------------------------------------- projections */

  var R = 6378137;
  function merc2ll(x, y) { return [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI]; }
  function lat2mercY(lat) { var r = lat * Math.PI / 180; return R * Math.log(Math.tan(Math.PI / 4 + r / 2)); }

  // WGS 84 UTM -> lon/lat (Karney-free series, sub-metre over a zone).
  function utm2ll(x, y, zone, south) {
    var a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    x -= 500000; if (south) y -= 10000000;
    var m = y / k0, mu = m / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
    var e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    var p1 = mu + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu)
      + (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu) + (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);
    var n1 = a / Math.sqrt(1 - e2 * Math.sin(p1) * Math.sin(p1)), t1 = Math.tan(p1) * Math.tan(p1), c1 = ep2 * Math.cos(p1) * Math.cos(p1);
    var r1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(p1) * Math.sin(p1), 1.5), d = x / (n1 * k0);
    var lat = p1 - (n1 * Math.tan(p1) / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * Math.pow(d, 4) / 24
      + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * Math.pow(d, 6) / 720);
    var lon = (d - (1 + 2 * t1 + c1) * Math.pow(d, 3) / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * Math.pow(d, 5) / 120) / Math.cos(p1);
    return [(zone - 1) * 6 - 180 + 3 + lon * 180 / Math.PI, lat * 180 / Math.PI];
  }

  function epsgOf(image) {
    var k = image.getGeoKeys ? image.getGeoKeys() || {} : {};
    return k.ProjectedCSTypeGeoKey || k.GeographicTypeGeoKey || null;
  }

  function projector(epsg) {
    if (!epsg || epsg === 4326 || epsg === 4269 || epsg === 4283) return { kind: "geo", fn: function (x, y) { return [x, y]; } };
    if (epsg === 3857 || epsg === 900913 || epsg === 3785 || epsg === 102100) return { kind: "merc", fn: merc2ll };
    if (epsg >= 32601 && epsg <= 32660) return { kind: "utm", fn: function (x, y) { return utm2ll(x, y, epsg - 32600, false); } };
    if (epsg >= 32701 && epsg <= 32760) return { kind: "utm", fn: function (x, y) { return utm2ll(x, y, epsg - 32700, true); } };
    return null;
  }

  /* ----------------------------------------------------------- styling */

  function percentile(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] : 0; }
  function stats(band, nodata) {
    var step = Math.max(1, Math.floor(band.length / 200000)), vals = [];
    for (var i = 0; i < band.length; i += step) { var v = band[i]; if (isFinite(v) && v !== nodata) vals.push(v); }
    vals.sort(function (a, b) { return a - b; });
    return { p2: percentile(vals, 0.02), p98: percentile(vals, 0.98), min: vals[0], max: vals[vals.length - 1] };
  }

  // Colours the stored bands into RGBA and returns a PNG data URL.
  function paint(r) {
    var W = r.width, H = r.height, nd = r.nodata, img = new ImageData(W, H), px = img.data;
    if (r.mode === "rgb" && r.bands.length >= 3) {
      var b = r.rgb.map(function (i) { return r.bands[Math.min(i, r.bands.length - 1)]; });
      var st = b.map(function (band) { return stats(band, nd); });
      for (var i = 0; i < W * H; i++) {
        var skip = false;
        for (var c = 0; c < 3; c++) {
          var v = b[c][i];
          if (!isFinite(v) || v === nd) { skip = true; break; }
          px[i * 4 + c] = Math.max(0, Math.min(255, (v - st[c].p2) / ((st[c].p98 - st[c].p2) || 1) * 255));
        }
        px[i * 4 + 3] = skip ? 0 : 255;
      }
      r.legend = null;
    } else {
      var band = r.bands[Math.min(r.band, r.bands.length - 1)], s = stats(band, nd);
      var lo = r.auto ? s.p2 : r.min, hi = r.auto ? s.p98 : r.max;
      r.min = lo; r.max = hi; r.dataMin = s.min; r.dataMax = s.max;
      var colors = GIS.sym.rampColors(r.ramp, r.reverse), interp = d3.interpolateRgbBasis(colors), lut = [];
      // Discrete: N equal classes between min and max, one ramp colour each
      // (like matplotlib's BoundaryNorm); values outside take the end class.
      var nCls = r.classMode === "discrete" ? Math.max(2, Math.min(20, r.classes | 0 || 6)) : 0;
      var classColors = nCls ? d3.range(nCls).map(function (i) { return d3.color(interp(i / (nCls - 1))).formatHex(); }) : null;
      for (var k = 0; k < 256; k++) {
        var cc = d3.rgb(nCls ? classColors[Math.min(nCls - 1, Math.floor(k / 256 * nCls))] : interp(k / 255));
        lut.push([cc.r, cc.g, cc.b]);
      }
      for (var j = 0; j < W * H; j++) {
        var val = band[j];
        if (!isFinite(val) || val === nd) { px[j * 4 + 3] = 0; continue; }
        var t = Math.max(0, Math.min(255, Math.floor((val - lo) / ((hi - lo) || 1) * 256))), col = lut[t];
        px[j * 4] = col[0]; px[j * 4 + 1] = col[1]; px[j * 4 + 2] = col[2]; px[j * 4 + 3] = 255;
      }
      r.legend = { colors: colors, min: lo, max: hi, classColors: classColors,
        breaks: nCls ? d3.range(nCls + 1).map(function (i) { return lo + (hi - lo) * i / nCls; }) : null };
    }
    var cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    cv.getContext("2d").putImageData(img, 0, 0);
    // EPSG:4326 rasters are resampled row-by-row into Web Mercator space so
    // MapLibre's linear corner mapping lines up at every latitude.
    if (r.kind === "geo" && Math.abs(r.north - r.south) > 0.05) {
      var out = document.createElement("canvas"); out.width = W; out.height = H;
      var ctx = out.getContext("2d"), y0 = lat2mercY(r.north), y1 = lat2mercY(r.south);
      for (var row = 0; row < H; row++) {
        var my = y0 + (y1 - y0) * (row + 0.5) / H, lat = merc2ll(0, my)[1];
        var src = (r.north - lat) / (r.north - r.south) * H;
        ctx.drawImage(cv, 0, Math.max(0, Math.min(H - 1, Math.floor(src))), W, 1, 0, row, W, 1);
      }
      cv = out;
    }
    r.url = cv.toDataURL("image/png");
    r.rev = (r.rev || 0) + 1;
  }

  /* -------------------------------------------------------------- load */

  function loadGeoTIFF(buffer, name) {
    return ensureGeoTIFF().then(function () { return GeoTIFF.fromArrayBuffer(buffer); })
      .then(function (tiff) { return tiff.getImage(); })
      .then(function (image) {
        var epsg = epsgOf(image), pr = projector(epsg);
        if (!pr) throw new Error("Unsupported CRS EPSG:" + epsg + ". Use EPSG:4326, EPSG:3857 or WGS 84 / UTM.");
        var bbox = image.getBoundingBox(), w0 = image.getWidth(), h0 = image.getHeight();
        var k = Math.min(1, MAX_DIM / Math.max(w0, h0)), W = Math.max(1, Math.round(w0 * k)), H = Math.max(1, Math.round(h0 * k));
        var nodata = image.getGDALNoData ? image.getGDALNoData() : null;
        return image.readRasters({ width: W, height: H, resampleMethod: "bilinear", interleave: false }).then(function (bands) {
          var corners = [[bbox[0], bbox[3]], [bbox[2], bbox[3]], [bbox[2], bbox[1]], [bbox[0], bbox[1]]].map(function (p) { return pr.fn(p[0], p[1]); });
          var r = {
            width: W, height: H, bands: Array.prototype.slice.call(bands), nodata: nodata == null ? NaN : nodata,
            kind: pr.kind, epsg: epsg || 4326, north: corners[0][1], south: corners[3][1],
            mode: bands.length >= 3 ? "rgb" : "single", rgb: [0, 1, 2], band: 0,
            ramp: bands.length >= 3 ? "Grayscale" : "Terrain", reverse: false, auto: true, min: 0, max: 1,
            classMode: "continuous", classes: 6,
            coordinates: corners, resampling: "linear", sourceSize: [w0, h0]
          };
          paint(r);
          return GIS.addRaster(r, name);
        });
      });
  }

  GIS.raster = {
    loadGeoTIFF: loadGeoTIFF,
    restyle: function (layer) { paint(layer.raster); GIS.emit("style"); }
  };
})();
