/* ==========================================================================
   Animated thumbnails for the three Home cards, drawn from what each mode
   really shows (looping like GIFs, as SVG + CSS animation):

   Chart          the app's own sample chart: the grouped bar data (plots
                  P1-P5, four mangrove species) in the active palette, bars
                  growing in, with its legend
   Map            the sample map: the ASEAN countries from the bundled
                  TopoJSON, graduated by population on the YlGn ramp, on a
                  sea like the default basemap, with field points popping up
   Agroforestry   the simulator's 2D plot: the coffee grid (2.5 m) and the
                  lamtoro crowns (5 m, staggered) growing year by year, the
                  shade they cast, the year counter, in the simulator colours
   ========================================================================== */
(function () {
  "use strict";

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var W = 240, H = 132;

  /* ------------------------------------------------------------- chart */
  function chart() {
    var text = (window.SAMPLE_DATA_BY_TYPE && SAMPLE_DATA_BY_TYPE["bar-group"]) || "Plot\tA\tB\tC\tD\nP1\t42\t33\t59\t71\nP2\t39\t41\t63\t68\nP3\t51\t28\t50\t76\nP4\t30\t36\t55\t67\nP5\t46\t31\t60\t79";
    var rows = text.trim().split("\n").map(function (l) { return l.split("\t"); });
    var series = rows[0].slice(1), cats = rows.slice(1).map(function (r) { return r[0]; });
    var vals = rows.slice(1).map(function (r) { return r.slice(1).map(Number); });
    // Greens that sit with the app accent (#4e8a2e): the Forest Canopy palette.
    var forest = (window.PALETTES || []).filter(function (p) { return p.name === "Forest Canopy"; })[0];
    var pal = forest ? forest.colors : ["#1e4d3a", "#3d7a5c", "#6ba368", "#a4c95f"];
    var max = Math.max.apply(null, [].concat.apply([], vals)) * 1.1;
    var x0 = 26, y0 = 104, pw = W - x0 - 10, ph = 78, gw = pw / cats.length, bw = gw * 0.78 / series.length;
    var s = '<svg viewBox="0 0 ' + W + " " + H + '" class="ht ht-chart" aria-hidden="true"><rect width="' + W + '" height="' + H + '" fill="#fff"/>';
    // legend (top, like the default top-right legend)
    series.forEach(function (n, i) { s += '<rect x="' + (x0 + i * 52) + '" y="8" width="7" height="7" fill="' + pal[i % pal.length] + '"/><text x="' + (x0 + 10 + i * 52) + '" y="14.5" class="ht-t">' + esc(n.length > 11 ? n.slice(0, 10) + "…" : n) + "</text>"; });
    for (var g = 0; g <= 4; g++) { var gy = y0 - ph * g / 4; s += '<line x1="' + x0 + '" x2="' + (W - 8) + '" y1="' + gy + '" y2="' + gy + '" class="ht-gl"/><text x="' + (x0 - 4) + '" y="' + (gy + 3) + '" class="ht-t" text-anchor="end">' + Math.round(max * g / 4) + "</text>"; }
    cats.forEach(function (c, ci) {
      vals[ci].forEach(function (v, si) {
        var h = v / max * ph, x = x0 + ci * gw + gw * 0.11 + si * bw;
        s += '<rect class="ht-bar" style="--d:' + (ci * 0.18 + si * 0.06).toFixed(2) + 's" x="' + x.toFixed(1) + '" y="' + (y0 - h).toFixed(1) + '" width="' + (bw - 1).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + pal[si % pal.length] + '"/>';
      });
      s += '<text x="' + (x0 + ci * gw + gw / 2).toFixed(1) + '" y="' + (y0 + 12) + '" class="ht-t" text-anchor="middle">' + esc(c) + "</text>";
    });
    s += '<line x1="' + x0 + '" x2="' + (W - 8) + '" y1="' + y0 + '" y2="' + y0 + '" class="ht-ax"/><line x1="' + x0 + '" x2="' + x0 + '" y1="' + (y0 - ph - 4) + '" y2="' + y0 + '" class="ht-ax"/>';
    return s + "</svg>";
  }

  /* --------------------------------------------------------------- map */
  function mapSvg(fc) {
    var proj = d3.geoMercator().fitExtent([[8, 8], [W - 8, H - 8]], fc), path = d3.geoPath(proj);
    var vals = fc.features.map(function (f) { return f.properties.population_m || 0; }).sort(d3.ascending);
    var ramp = (window.PlootsGIS && PlootsGIS.sym) ? PlootsGIS.sym.rampColors("YlGn") : ["#ffffe5", "#d9f0a3", "#78c679", "#238443", "#004529"];
    var q = d3.scaleQuantile().domain(vals).range([0.1, 0.3, 0.55, 0.78, 1]);
    var interp = d3.interpolateRgbBasis(ramp);
    var s = '<svg viewBox="0 0 ' + W + " " + H + '" class="ht ht-map" aria-hidden="true"><rect width="' + W + '" height="' + H + '" fill="#dfe9dc"/>';
    fc.features.forEach(function (f, i) {
      s += '<path class="ht-cty" style="--d:' + (i * 0.25).toFixed(2) + "s;--c:" + interp(q(f.properties.population_m || 0)) + '" d="' + path(f) + '"/>';
    });
    // labels for the larger countries, as in the sample (label field: name)
    fc.features.forEach(function (f) {
      var a = path.area(f);
      if (a < 180) return;
      var c = path.centroid(f);
      s += '<text x="' + c[0].toFixed(1) + '" y="' + c[1].toFixed(1) + '" class="ht-lbl" text-anchor="middle">' + esc(f.properties.name) + "</text>";
    });
    // field points (Kobo submissions) popping up over the map
    var pts = [[106.8, -6.6], [110.4, -7.0], [98.7, 3.6], [101.7, 3.1], [114.6, 4.9], [121.0, 14.6], [100.5, 13.7], [105.8, 21.0], [119.4, -5.1], [116.1, -8.6]];
    pts.forEach(function (p, i) {
      var xy = proj(p);
      if (!xy) return;
      s += '<g transform="translate(' + xy[0].toFixed(1) + " " + xy[1].toFixed(1) + ')"><circle class="ht-pulse" style="--d:' + (0.6 + i * 0.45).toFixed(2) + 's" r="7"/><circle class="ht-pin" style="--d:' + (0.6 + i * 0.45).toFixed(2) + 's" r="2.6"/></g>';
    });
    return s + "</svg>";
  }

  /* -------------------------------------------------------------- agro */
  // Frames rendered by the simulator's own 3D view ("Eye level" camera, in a
  // coffee alley under the lamtoro) at years 1, 3 and 6, cross-fading while
  // the camera walks slowly down the row.
  function agro() {
    var s = '<div class="ht ht-agro3d">';
    [1, 3, 6].forEach(function (y, i) { s += '<img src="assets/home/agro-eye-' + y + '.jpg" alt="" style="--d:' + (i * 2) + 's" draggable="false">'; });
    [1, 3, 6].forEach(function (y, i) { s += '<span class="ht-yr3" style="--d:' + (i * 2) + 's">Year ' + y + "</span>"; });
    return s + '<span class="ht-cam">Eye level · 1.6 m</span></div>';
  }

  // Fills the thumbnails of a freshly built Home (the map one needs the sample data).
  function hydrate(root) {
    var c = root.querySelector('[data-thumb="chart"]'), a = root.querySelector('[data-thumb="agro"]'), m = root.querySelector('[data-thumb="map"]');
    if (c) c.innerHTML = chart();
    if (a) a.innerHTML = agro();
    if (m && window.PlootsGIS && PlootsGIS.loadSample && window.d3) {
      PlootsGIS.loadSample().then(function (fc) { m.innerHTML = mapSvg(fc); }).catch(function () { });
    }
  }
  function slot(k) { return '<div class="ht-slot" data-thumb="' + k + '"></div>'; }

  window.PlootsHomeThumbs = { chart: slot("chart"), map: slot("map"), agro: slot("agro"), hydrate: hydrate };
})();
