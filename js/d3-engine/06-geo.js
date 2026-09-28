/* ==========================================================================
   Ploots D3 engine — maps.

   choropleth, bubble-map. Replaces Plotly's geo module with d3-geo.

   Base maps are the Natural Earth 110m topojson files Plotly used, served
   locally from vendor/topojson/ (loaded once, then cached); a small
   topojson decoder below turns them into GeoJSON. Location matching is the
   same as Plotly's: ISO-3 codes when every location looks like one,
   otherwise country names via the country-regex table (geo-country-regex.js).

   Behaviour kept from the Plotly version (11-choropleth.js, 19-bubble-map.js):
     - every state.choropleth* setting from the "Peta (Choropleth)" sidebar
       section: world atlas (scope + projection) or custom GeoJSON with
       featureidkey and fit-to-bounds, continuous or classed (equal
       interval / quantile) colouring, manual z range, reversed scale,
       colour for regions without data
     - white country borders, coastlines, colour bar titled with the series
       (choropleth: shown with the legend setting; bubble map: always)
     - bubble map: "Label|lat,lon" rows, bubble area proportional to value
       (largest ≈ 46px across), coloured by value, framed to the points

   Deliberate changes:
     - Colours use the same light-to-dark ramp as the heatmap (PD.heatStops)
       for both continuous and classed maps; stretching a qualitative
       palette gave neighbouring values unrelated hues.
     - Custom GeoJSON polygons are rewound when needed, so files that follow
       RFC 7946 winding no longer paint the whole globe.
   ========================================================================== */
(function () {
  "use strict";

  var PD = window.PlootsD3;
  function fin(v) { return typeof v === "number" && isFinite(v); }

  /* ------------------------------------------------------------ topojson */

  function topoFeature(topo, obj) {
    var tf = topo.transform, cache = {};
    function arc(i) {
      var j = i < 0 ? ~i : i;
      if (!cache[j]) {
        var x = 0, y = 0;
        cache[j] = topo.arcs[j].map(function (p) {
          if (!tf) return [p[0], p[1]];
          x += p[0]; y += p[1];
          return [x * tf.scale[0] + tf.translate[0], y * tf.scale[1] + tf.translate[1]];
        });
      }
      return i < 0 ? cache[j].slice().reverse() : cache[j];
    }
    function line(idxs) {
      var pts = [];
      idxs.forEach(function (i, k) { var a = arc(i); pts = pts.concat(k ? a.slice(1) : a); });
      return pts;
    }
    function point(p) { return tf ? [p[0] * tf.scale[0] + tf.translate[0], p[1] * tf.scale[1] + tf.translate[1]] : p; }
    function geom(g) {
      switch (g.type) {
        case "Polygon": return { type: "Polygon", coordinates: g.arcs.map(line) };
        case "MultiPolygon": return { type: "MultiPolygon", coordinates: g.arcs.map(function (p) { return p.map(line); }) };
        case "LineString": return { type: "LineString", coordinates: line(g.arcs) };
        case "MultiLineString": return { type: "MultiLineString", coordinates: g.arcs.map(line) };
        case "Point": return { type: "Point", coordinates: point(g.coordinates) };
        case "MultiPoint": return { type: "MultiPoint", coordinates: g.coordinates.map(point) };
        default: return null;
      }
    }
    var gs = obj.type === "GeometryCollection" ? obj.geometries : [obj];
    return {
      type: "FeatureCollection",
      features: gs.map(function (g) { return { type: "Feature", id: g.id, properties: g.properties || {}, geometry: geom(g) }; })
        .filter(function (f) { return f.geometry; })
    };
  }

  var SCOPE_FILE = { world: "world", asia: "asia", africa: "africa", europe: "europe", "north america": "north-america", "south america": "south-america", usa: "usa" };
  var atlas = {}, loading = {};

  PD.topoFeature = topoFeature; // also used by the GeoJSON map's TopoJSON import

  // Returns the decoded atlas for a scope, or null while it loads (the
  // active chart is redrawn when it arrives).
  function getAtlas(scope) {
    var name = SCOPE_FILE[scope] || "world";
    if (atlas[name]) return atlas[name];
    if (!loading[name]) {
      loading[name] = fetch(new URL("vendor/topojson/" + name + "_110m.json", document.baseURI).href)
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (topo) {
          var o = topo.objects, out = {};
          ["countries", "land", "coastlines", "subunits"].forEach(function (k) { if (o[k]) out[k] = topoFeature(topo, o[k]); });
          atlas[name] = out;
          var type = window.state && window.state.chartType;
          if ((type === "choropleth" || type === "bubble-map") && typeof PD.renderActive === "function") PD.renderActive();
        })
        .catch(function (err) {
          loading[name] = null;
          var gd = document.getElementById("plotlyDiv");
          if (gd) PD.placeholder(gd, "Gagal memuat peta dasar: " + err.message);
        });
    }
    return null;
  }

  /* ---------------------------------------------------------- locations */

  var regexCache = null;
  function isoFromName(name) {
    var table = window.PLOOTS_COUNTRY_REGEX || {};
    if (!regexCache) regexCache = Object.keys(table).map(function (k) { return { iso: k, re: new RegExp(table[k], "i") }; });
    var s = String(name == null ? "" : name).trim();
    for (var i = 0; i < regexCache.length; i++) if (regexCache[i].re.test(s)) return regexCache[i].iso;
    return null;
  }
  function looksIso3(codes) {
    return codes.length > 0 && codes.every(function (c) { return /^[A-Za-z]{3}$/.test(String(c == null ? "" : c).trim()); });
  }
  function getPath(obj, path) {
    return String(path || "id").split(".").reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  // d3-geo wants clockwise exterior rings; RFC 7946 files are the opposite.
  // A polygon whose area comes out larger than a hemisphere is inside-out.
  function rewind(f) {
    var g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return f;
    function fix(rings) {
      if (d3.geoArea({ type: "Polygon", coordinates: rings }) > 2 * Math.PI) return rings.map(function (r) { return r.slice().reverse(); });
      return rings;
    }
    var geom = g.type === "Polygon" ? { type: "Polygon", coordinates: fix(g.coordinates) } : { type: "MultiPolygon", coordinates: g.coordinates.map(fix) };
    return { type: "Feature", id: f.id, properties: f.properties, geometry: geom };
  }

  /* ------------------------------------------------------------- helpers */

  function base() {
    var st = window.state;
    return {
      st: st, W: st.chartBox.w, H: st.chartBox.h,
      font: st.fontBody, size: st.bodyFontSize || 12, ink: PD.ink(),
      bg: typeof chartBgColor === "function" ? chartBgColor() : "#fff",
      fmt: function (v) { return typeof formatValue === "function" ? formatValue(v, st.valueFormat || "auto") : String(v); },
      series: st.seriesNames.filter(function (n) { return st.seriesMeta[n].visible; })[0]
    };
  }

  function rampStops(reverse) {
    var st = window.state;
    var stops = isGrayscaleMode() ? ["#f5f5f5", "#1a1a1a"] : PD.heatStops(PALETTES[st.paletteIdx].colors);
    return reverse ? stops.slice().reverse() : stops;
  }
  function rampScale(stops, lo, hi) {
    return d3.scaleLinear().domain(stops.map(function (c, i) { return lo + (hi - lo) * i / (stops.length - 1 || 1); }))
      .range(stops).interpolate(d3.interpolateRgb).clamp(true);
  }

  // Plotly's framing for each continental scope ([lon range], [lat range]);
  // fitting to the features instead let e.g. Russia's far east (across the
  // antimeridian) pull the Europe view off-centre.
  var SCOPE_RANGE = {
    europe: [[-30, 60], [30, 85]],
    asia: [[22, 160], [-15, 55]],
    africa: [[-30, 60], [-40, 40]],
    "north america": [[-180, -45], [5, 85]],
    "south america": [[-100, -30], [-60, 15]]
  };
  // Dense outline of a lon/lat rectangle, so fitting follows the
  // projection's curvature instead of just the four corners.
  function lonLatBox(lon, lat) {
    var pts = [], k;
    for (k = 0; k <= 20; k++) {
      var x = lon[0] + (lon[1] - lon[0]) * k / 20, y = lat[0] + (lat[1] - lat[0]) * k / 20;
      pts.push([x, lat[0]], [x, lat[1]], [lon[0], y], [lon[1], y]);
    }
    return { type: "Feature", geometry: { type: "MultiPoint", coordinates: pts } };
  }

  function makeProjection(kind) {
    switch (kind) {
      case "equirectangular": return d3.geoEquirectangular();
      case "mercator": return d3.geoMercator();
      case "orthographic": return d3.geoOrthographic();
      case "conic conformal": return d3.geoConicConformal();
      case "azimuthal equal area": return d3.geoAzimuthalEqualArea();
      case "albers usa": return d3.geoAlbersUsa();
      default: return d3.geoNaturalEarth1();
    }
  }

  // Vertical colour bar: continuous gradient, or one block per class.
  function drawColorBar(svg, C, x, y, h, title, stops, lo, hi, breaks, classColors) {
    var g = svg.append("g").attr("class", "colorbar"), bw = 14, fs = Math.max(C.size - 2, 9);
    var tH = title ? PD.richSize(title, C.size, C.font).h + 6 : 0;
    if (title) PD.richText(g, title, { x: x, y: y, size: C.size, family: C.font, color: C.ink.text, valign: "top", weight: "600" });
    var y0 = y + tH, hh = Math.max(20, h - tH);
    var sc = d3.scaleLinear().domain([lo, hi]).range([y0 + hh, y0]);
    if (breaks) {
      // Equal-height blocks, labelled at their boundaries: uneven (e.g.
      // quantile) breaks would otherwise squash classes and overlap labels.
      var n = classColors.length, bh = hh / n;
      sc = function (v) { var i = breaks.indexOf(v); return y0 + hh - (i < 0 ? 0 : i) * bh; };
      classColors.forEach(function (c, i) {
        g.append("rect").attr("x", x).attr("y", y0 + hh - (i + 1) * bh).attr("width", bw).attr("height", bh).attr("fill", c);
      });
    } else {
      var id = "pd-geo-cb-" + Math.random().toString(36).slice(2, 8);
      var lg = svg.select("defs").append("linearGradient").attr("id", id).attr("x1", 0).attr("y1", 1).attr("x2", 0).attr("y2", 0);
      stops.forEach(function (c, i) { lg.append("stop").attr("offset", (i / (stops.length - 1 || 1) * 100) + "%").attr("stop-color", c); });
      g.append("rect").attr("x", x).attr("y", y0).attr("width", bw).attr("height", hh).attr("fill", "url(#" + id + ")");
    }
    g.append("rect").attr("x", x).attr("y", y0).attr("width", bw).attr("height", hh).attr("fill", "none").attr("stroke", C.ink.axis).attr("stroke-width", 0.6);
    var ticks = breaks || d3.scaleLinear().domain([lo, hi]).nice(5).ticks(5).filter(function (v) { return v >= lo && v <= hi; });
    ticks.forEach(function (v) {
      var ty = sc(v);
      g.append("line").attr("x1", x + bw).attr("x2", x + bw + 4).attr("y1", ty).attr("y2", ty).attr("stroke", C.ink.axis);
      PD.richText(g, C.fmt(v), { x: x + bw + 6, y: ty, size: fs, family: C.font, color: C.ink.text, valign: "middle" });
    });
  }
  function colorBarWidth(C, title, labels) {
    var fs = Math.max(C.size - 2, 9);
    var lw = d3.max(labels, function (t) { return PD.textWidth(t, fs, C.font); }) || 0;
    return Math.max(14 + 6 + lw, title ? PD.textWidth(title, C.size, C.font, "600") : 0) + 16;
  }

  // Land, then country borders, then coastlines.
  function drawBase(g, path, A, landColor, borders) {
    if (A.land) g.append("path").attr("d", path(A.land)).attr("fill", landColor).attr("stroke", "none");
    if (borders && A.countries) {
      g.append("path").attr("d", path({ type: "FeatureCollection", features: A.countries.features }))
        .attr("fill", "none").attr("stroke", "#ffffff").attr("stroke-width", 0.6);
    }
    if (A.coastlines) g.append("path").attr("d", path(A.coastlines)).attr("fill", "none").attr("stroke", "#cfcabb").attr("stroke-width", 0.8);
  }

  /* ========================================================== choropleth */

  function classify(vals, n, method, lo, hi) {
    n = Math.max(2, Math.min(9, Math.round(n) || 5));
    var br = [lo];
    if (method === "quantile") {
      var s = vals.slice().sort(d3.ascending);
      for (var i = 1; i < n; i++) br.push(s[Math.min(s.length - 1, Math.floor(i / n * s.length))]);
    } else for (var j = 1; j < n; j++) br.push(lo + (hi - lo) * j / n);
    br.push(hi);
    for (var k = 1; k < br.length; k++) if (br[k] <= br[k - 1]) br[k] = br[k - 1] + (hi - lo) * 1e-6 + 1e-9;
    return br;
  }

  function renderChoropleth(gd) {
    var C = base(), st = C.st;
    if (!C.series) return PD.renderBlank(gd);
    var custom = st.choroplethGeoMode === "custom";
    if (custom && !st.choroplethGeoJsonObj) {
      return PD.placeholder(gd, "Tempel atau unggah GeoJSON kustom di panel \"Peta (Choropleth)\" pada sidebar untuk merender peta ini.");
    }
    var scope = custom ? "world" : (st.choroplethScope || "world");
    var A = getAtlas(scope);
    if (!A) return PD.placeholder(gd, "Memuat peta…");

    var locs = st.categories, z = st.seriesData[C.series] || [];
    var label = st.seriesMeta[C.series].label || C.series;
    var byKey = {};
    var iso = !custom && looksIso3(locs);
    locs.forEach(function (loc, i) {
      if (!fin(z[i])) return;
      var key = custom ? String(loc).trim() : (iso ? String(loc).trim().toUpperCase() : isoFromName(loc));
      if (key != null) byKey[key] = z[i];
    });
    var features = custom
      ? (st.choroplethGeoJsonObj.features || []).map(rewind)
      : A.countries.features;
    function keyOf(f) { return custom ? String(getPath(f, st.choroplethFeatureIdKey || "id")) : f.id; }

    var vals = Object.keys(byKey).map(function (k) { return byKey[k]; });
    var lo = d3.min(vals), hi = d3.max(vals);
    if (st.choroplethZMode === "custom" && fin(st.choroplethZMin) && fin(st.choroplethZMax)) { lo = st.choroplethZMin; hi = st.choroplethZMax; }
    if (!fin(lo)) { lo = 0; hi = 1; }
    if (hi <= lo) hi = lo + 1;
    var stops = rampStops(st.choroplethReverseScale), colorOf, breaks = null, classColors = null;
    if (st.choroplethColorMode === "classed" && vals.length) {
      if (!(st.choroplethZMode === "custom" && fin(st.choroplethZMin))) lo = d3.min(vals);
      if (!(st.choroplethZMode === "custom" && fin(st.choroplethZMax))) hi = Math.max(d3.max(vals), lo + 1e-9);
      breaks = classify(vals, st.choroplethClasses, st.choroplethClassMethod, lo, hi);
      hi = breaks[breaks.length - 1];
      var ramp = rampScale(stops, 0, 1), nC = breaks.length - 1;
      classColors = d3.range(nC).map(function (i) { return ramp(nC === 1 ? 0.5 : i / (nC - 1)); });
      colorOf = function (v) {
        for (var i = 0; i < nC; i++) if (v <= breaks[i + 1]) return classColors[i];
        return classColors[nC - 1];
      };
    } else {
      var sc = rampScale(stops, lo, hi);
      colorOf = function (v) { return sc(v); };
    }

    var showBar = !!st.showLegend && vals.length;
    var barW = showBar ? colorBarWidth(C, label, (breaks || d3.scaleLinear().domain([lo, hi]).nice(5).ticks(5)).map(C.fmt)) : 0;
    var m = 15, mapW = Math.max(60, C.W - 2 * m - barW), mapH = Math.max(60, C.H - 2 * m);

    var projKind = custom ? "equirectangular" : (scope === "usa" ? "albers usa" : (st.choroplethProjection || "natural earth"));
    var proj = makeProjection(projKind);
    var fitTo;
    if (custom && st.choroplethFitBounds !== false) fitTo = { type: "FeatureCollection", features: features };
    else if (projKind === "orthographic") fitTo = { type: "Sphere" };
    else if (SCOPE_RANGE[scope]) fitTo = lonLatBox(SCOPE_RANGE[scope][0], SCOPE_RANGE[scope][1]);
    else fitTo = { type: "FeatureCollection", features: A.countries.features.filter(function (f) { return f.id !== "ATA"; }) };
    if (projKind === "orthographic" && vals.length && !custom) {
      var cts = A.countries.features.filter(function (f) { return byKey[f.id] != null && f.properties.ct; }).map(function (f) { return f.properties.ct; });
      if (cts.length) proj.rotate([-d3.mean(cts, function (c) { return c[0]; }), -d3.mean(cts, function (c) { return c[1]; })]);
    }
    proj.fitExtent([[m, m], [m + mapW, m + mapH]], fitTo);
    var path = d3.geoPath(proj);

    var svg = PD.mount(gd, C.W, C.H, C.bg);
    gd._plootsD3 = null;
    var clipId = "pd-geo-clip-" + Math.random().toString(36).slice(2, 8);
    svg.select("defs").append("clipPath").attr("id", clipId).append("rect").attr("x", m).attr("y", m).attr("width", mapW).attr("height", mapH);
    var g = svg.append("g").attr("class", "map").attr("clip-path", "url(#" + clipId + ")");
    if (projKind === "orthographic") g.append("path").attr("d", path({ type: "Sphere" })).attr("fill", "#ffffff").attr("stroke", "#cfcabb");
    var landColor = st.choroplethMissingColor || "#f0eee4";
    drawBase(g, path, A, landColor, !custom);
    var lineW = st.outlineFrame ? 1 : 0.5;
    var gf = g.append("g").attr("class", "regions");
    features.forEach(function (f) {
      var v = byKey[keyOf(f)];
      if (!custom && v == null) return; // base land already shows it
      gf.append("path").attr("d", path(f)).attr("fill", v == null ? landColor : colorOf(v))
        .attr("stroke", "#ffffff").attr("stroke-width", lineW);
    });
    if (A.coastlines && !custom) g.append("path").attr("d", path(A.coastlines)).attr("fill", "none").attr("stroke", "#cfcabb").attr("stroke-width", 0.8);
    if (showBar) drawColorBar(svg, C, C.W - m - barW + 16, m + 10, Math.min(mapH - 20, 260), label, stops, lo, hi, breaks, classColors);
  }

  /* ========================================================== bubble map */

  function parsePoint(text) {
    var raw = String(text == null ? "" : text), pipe = raw.indexOf("|");
    var label = pipe === -1 ? raw.trim() : raw.slice(0, pipe).trim();
    var nums = (pipe === -1 ? raw : raw.slice(pipe + 1)).split(",").map(function (s) { return parseFloat(String(s).trim()); });
    if (nums.length < 2 || !isFinite(nums[0]) || !isFinite(nums[1])) return null;
    return { label: label, lat: nums[0], lon: nums[1] };
  }

  function renderBubbleMap(gd) {
    var C = base(), st = C.st;
    if (!C.series) return PD.renderBlank(gd);
    var vals = st.seriesData[C.series] || [], pts = [];
    st.categories.forEach(function (t, i) {
      var p = parsePoint(t);
      if (p && fin(vals[i])) { p.v = vals[i]; pts.push(p); }
    });
    if (!pts.length) return PD.renderBlank(gd);
    var A = getAtlas("world");
    if (!A) return PD.placeholder(gd, "Memuat peta…");
    var label = st.seriesMeta[C.series].label || C.series;
    var lo = d3.min(pts, function (p) { return p.v; }), hi = d3.max(pts, function (p) { return p.v; });
    if (hi <= lo) hi = lo + 1;
    var stops = rampStops(false), color = rampScale(stops, lo, hi);
    var sizeref = 2 * d3.max(pts, function (p) { return p.v; }) / (46 * 46) || 1;
    function diam(v) { return Math.max(4, Math.sqrt(Math.max(v, 0) / sizeref)); }

    var barW = colorBarWidth(C, label, d3.scaleLinear().domain([lo, hi]).nice(5).ticks(5).map(C.fmt));
    var m = 15, mapW = Math.max(60, C.W - 2 * m - barW), mapH = Math.max(60, C.H - 2 * m);
    // Frame the points (Plotly's fitbounds: "locations"), with some context.
    var lats = pts.map(function (p) { return p.lat; }), lons = pts.map(function (p) { return p.lon; });
    var padLat = Math.max(2, (d3.max(lats) - d3.min(lats)) * 0.25), padLon = Math.max(2, (d3.max(lons) - d3.min(lons)) * 0.25);
    var bbox = { type: "Feature", geometry: { type: "MultiPoint", coordinates: [
      [d3.min(lons) - padLon, d3.min(lats) - padLat], [d3.max(lons) + padLon, d3.max(lats) + padLat]] } };
    var proj = d3.geoEquirectangular().fitExtent([[m, m], [m + mapW, m + mapH]], bbox);
    var path = d3.geoPath(proj);

    var svg = PD.mount(gd, C.W, C.H, C.bg);
    gd._plootsD3 = null;
    var clipId = "pd-geo-clip-" + Math.random().toString(36).slice(2, 8);
    svg.select("defs").append("clipPath").attr("id", clipId).append("rect").attr("x", m).attr("y", m).attr("width", mapW).attr("height", mapH);
    var g = svg.append("g").attr("class", "map").attr("clip-path", "url(#" + clipId + ")");
    drawBase(g, path, A, "#f0eee4", true);
    var gb = g.append("g").attr("class", "bubbles"), gray = isGrayscaleMode();
    pts.slice().sort(function (a, b) { return b.v - a.v; }).forEach(function (p) { // big first, small on top
      var xy = proj([p.lon, p.lat]);
      if (!xy) return;
      gb.append("circle").attr("cx", xy[0]).attr("cy", xy[1]).attr("r", diam(p.v) / 2).attr("fill", color(p.v)).attr("fill-opacity", 0.85)
        .attr("stroke", gray ? "#ffffff" : "#3a3a36").attr("stroke-width", 0.6);
    });
    drawColorBar(svg, C, C.W - m - barW + 16, m + 10, Math.min(mapH - 20, 260), label, stops, lo, hi, null, null);
  }

  PD.renderers["choropleth"] = function (gd) { return renderChoropleth(gd); };
  PD.renderers["bubble-map"] = function (gd) { return renderBubbleMap(gd); };
})();
