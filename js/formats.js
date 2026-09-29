/* ==========================================================================
   Formats — read field and GIS vector files into GeoJSON (WGS 84).

     Shapefile   .shp + .dbf (+ .prj, .cpg), or all of them in a .zip.
                 Points, multipoints, lines and polygons (Z / M read as XY);
                 holes are matched to their outer rings. Attributes from the
                 .dbf in the .cpg encoding (UTF-8 by default).
                 Coordinates are converted to WGS 84 when the .prj says
                 geographic, UTM, any Transverse Mercator (e.g. Indonesia
                 TM-3) or Web Mercator.
     KML / KMZ   Placemarks (Point, LineString, Polygon with holes,
                 MultiGeometry, gx:Track), name, description, ExtendedData
                 and the folder they sit in.
     GPX         Waypoints, tracks (one line per segment, with start / end
                 time and length) and routes.

   PlootsFormats.read(files) takes File objects (the parts of a shapefile
   can come together) and resolves to [{ name, geojson, note? }].

   Writers (GeoJSON in WGS 84): toShapefileZip(fc, name) -> Blob (.zip with
   one shapefile per geometry kind, UTF-8 .dbf, WGS 84 .prj), toKML(fc,
   name, colorOf?) and toGPX(fc, name) -> text.
   ========================================================================== */
(function () {
  "use strict";

  var R2D = 180 / Math.PI, D2R = Math.PI / 180;

  function baseName(n) { return String(n).replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, ""); }
  function extOf(n) { var m = /\.([a-z0-9]+)$/i.exec(n); return m ? m[1].toLowerCase() : ""; }

  /* ------------------------------------------------------ projections */

  // WKT parameters we need: GEOGCS / PROJCS, projection name, parameters, unit.
  function parsePrj(wkt) {
    if (!wkt) return { kind: "geographic", assumed: true };
    var s = String(wkt), up = s.toUpperCase();
    function param(name) { var m = new RegExp('PARAMETER\\["' + name + '"\\s*,\\s*(-?[\\d.eE+-]+)', "i").exec(s); return m ? parseFloat(m[1]) : null; }
    var unit = (function () { var all = s.match(/UNIT\["[^"]*"\s*,\s*([\d.eE+-]+)/gi); if (!all) return 1; var last = /,\s*([\d.eE+-]+)/.exec(all[all.length - 1]); return last ? parseFloat(last[1]) : 1; })();
    var ell = (function () { var m = /SPHEROID\["[^"]*"\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s); return m ? { a: parseFloat(m[1]), invf: parseFloat(m[2]) } : { a: 6378137, invf: 298.257223563 }; })();
    if (!/PROJCS/.test(up)) return { kind: "geographic" };
    if (/MERCATOR_AUXILIARY_SPHERE|POPULAR_VISUALISATION|WEB_MERCATOR|PSEUDO.MERCATOR|3857/.test(up)) return { kind: "webmercator", unit: unit };
    if (/TRANSVERSE_MERCATOR/.test(up)) {
      var utm = /UTM[_ ]ZONE[_ ](\d+)\s*([NS])?/i.exec(s);
      return {
        kind: "tm", unit: unit, a: ell.a, f: ell.invf ? 1 / ell.invf : 0,
        lon0: param("central_meridian") != null ? param("central_meridian") : utm ? (+utm[1] - 1) * 6 - 180 + 3 : 0,
        lat0: param("latitude_of_origin") || 0,
        k0: param("scale_factor") != null ? param("scale_factor") : 0.9996,
        fe: param("false_easting") != null ? param("false_easting") : 500000,
        fn: param("false_northing") != null ? param("false_northing") : utm && /S/i.test(utm[2] || "") ? 10000000 : 0
      };
    }
    var name = /PROJECTION\["([^"]+)"/i.exec(s);
    throw new Error("The projection " + (name ? name[1] : "in the .prj") + " is not supported. Reproject the layer to WGS 84 (EPSG:4326) or UTM first, e.g. in QGIS.");
  }

  // Inverse Transverse Mercator (Snyder), metres -> degrees.
  function tmInverse(p) {
    var a = p.a, f = p.f, e2 = f * (2 - f), ep2 = e2 / (1 - e2), k0 = p.k0;
    function M(phi) {
      return a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi)
        + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi) - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi));
    }
    var M0 = M(p.lat0 * D2R), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    return function (x, y) {
      x = x * p.unit - p.fe; y = y * p.unit - p.fn;
      var mu = (M0 + y / k0) / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
      var p1 = mu + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu)
        + (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu) + (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);
      var s1 = Math.sin(p1), c1 = Math.cos(p1), t1 = Math.tan(p1) * Math.tan(p1), cc = ep2 * c1 * c1;
      var n1 = a / Math.sqrt(1 - e2 * s1 * s1), r1 = a * (1 - e2) / Math.pow(1 - e2 * s1 * s1, 1.5), d = x / (n1 * k0);
      var lat = p1 - (n1 * Math.tan(p1) / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * cc - 4 * cc * cc - 9 * ep2) * Math.pow(d, 4) / 24
        + (61 + 90 * t1 + 298 * cc + 45 * t1 * t1 - 252 * ep2 - 3 * cc * cc) * Math.pow(d, 6) / 720);
      var lon = (d - (1 + 2 * t1 + cc) * Math.pow(d, 3) / 6 + (5 - 2 * cc + 28 * t1 - 3 * cc * cc + 8 * ep2 + 24 * t1 * t1) * Math.pow(d, 5) / 120) / c1;
      return [p.lon0 + lon * R2D, lat * R2D];
    };
  }
  function toLonLat(prj) {
    if (prj.kind === "geographic") return null;
    if (prj.kind === "webmercator") return function (x, y) { x *= prj.unit; y *= prj.unit; return [x / 6378137 * R2D, (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * R2D]; };
    return tmInverse(prj);
  }

  /* -------------------------------------------------------- shapefile */

  function ringArea(r) { var s = 0; for (var i = 0, n = r.length; i < n - 1; i++) s += (r[i + 1][0] - r[i][0]) * (r[i + 1][1] + r[i][1]); return s; } // > 0: clockwise
  function inRing(pt, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // Shapefile polygons: outer rings clockwise, holes counter-clockwise.
  function polygonGeometry(rings) {
    var outers = [], holes = [];
    rings.forEach(function (r) { if (r.length >= 4) (ringArea(r) >= 0 ? outers : holes).push(r); });
    if (!outers.length && holes.length) { outers = holes.map(function (h) { return h.slice().reverse(); }); holes = []; }
    var polys = outers.map(function (o) { return [o]; });
    holes.forEach(function (h) {
      var host = polys.filter(function (p) { return inRing(h[0], p[0]); })[0] || polys[0];
      if (host) host.push(h);
    });
    // GeoJSON: outer counter-clockwise, holes clockwise.
    polys = polys.map(function (p) { return p.map(function (r, i) { return i === 0 ? r.slice().reverse() : r.slice().reverse(); }); });
    return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
  }

  function readShp(buf, project) {
    var dv = new DataView(buf), out = [], pos = 100, n = buf.byteLength;
    if (dv.getInt32(0, false) !== 9994) throw new Error("Not a shapefile (.shp).");
    function pt(o) { var x = dv.getFloat64(o, true), y = dv.getFloat64(o + 8, true); return project ? project(x, y) : [x, y]; }
    while (pos + 8 <= n) {
      var len = dv.getInt32(pos + 4, false) * 2, c = pos + 8;
      pos = c + len;
      if (len < 4 || c + 4 > n) { out.push(null); continue; }
      var type = dv.getInt32(c, true), base = type % 10, g = null;
      if (type === 0) g = null;
      else if (base === 1) g = { type: "Point", coordinates: pt(c + 4) };
      else if (base === 8) {
        var np = dv.getInt32(c + 36, true), mp = [];
        for (var i = 0; i < np; i++) mp.push(pt(c + 40 + i * 16));
        g = np === 1 ? { type: "Point", coordinates: mp[0] } : { type: "MultiPoint", coordinates: mp };
      } else if (base === 3 || base === 5) {
        var parts = dv.getInt32(c + 36, true), pts = dv.getInt32(c + 40, true), idx = [], at = c + 44 + parts * 4, lines = [];
        for (var k = 0; k < parts; k++) idx.push(dv.getInt32(c + 44 + k * 4, true));
        idx.push(pts);
        for (var q = 0; q < parts; q++) {
          var line = [];
          for (var m = idx[q]; m < idx[q + 1]; m++) line.push(pt(at + m * 16));
          lines.push(line);
        }
        if (base === 3) g = lines.length === 1 ? { type: "LineString", coordinates: lines[0] } : { type: "MultiLineString", coordinates: lines };
        else g = polygonGeometry(lines);
      } else throw new Error("Shape type " + type + " is not supported.");
      out.push(g);
    }
    return out;
  }

  function readDbf(buf, encoding) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf);
    var count = dv.getUint32(4, true), headLen = dv.getUint16(8, true), recLen = dv.getUint16(10, true);
    var dec;
    try { dec = new TextDecoder(encoding || "utf-8"); } catch (e) { dec = new TextDecoder("utf-8"); }
    var fields = [], off = 32;
    while (off < headLen - 1 && u8[off] !== 0x0d) {
      var nameBytes = u8.subarray(off, off + 11), z = nameBytes.indexOf(0);
      fields.push({ name: new TextDecoder("latin1").decode(z >= 0 ? nameBytes.subarray(0, z) : nameBytes).trim(), type: String.fromCharCode(u8[off + 11]), len: u8[off + 16], dec: u8[off + 17] });
      off += 32;
    }
    var rows = [];
    for (var r = 0; r < count; r++) {
      var p = headLen + r * recLen;
      if (p + recLen > u8.length) break;
      var row = {}, at = p + 1;
      fields.forEach(function (f) {
        var raw = dec.decode(u8.subarray(at, at + f.len)).replace(/\u0000/g, "").trim();
        at += f.len;
        var v = raw;
        if (f.type === "N" || f.type === "F") v = raw === "" || /^\*+$/.test(raw) ? null : Number(raw);
        else if (f.type === "D") v = /^\d{8}$/.test(raw) ? raw.slice(0, 4) + "-" + raw.slice(4, 6) + "-" + raw.slice(6, 8) : raw || null;
        else if (f.type === "L") v = /^[YyTt]$/.test(raw) ? true : /^[NnFf]$/.test(raw) ? false : null;
        else if (raw === "") v = null;
        if (typeof v === "number" && !isFinite(v)) v = null;
        row[f.name] = v;
      });
      rows.push(row);
    }
    return rows;
  }

  // parts: { shp: ArrayBuffer, dbf?: ArrayBuffer, prj?: string, cpg?: string }
  function shapefile(parts) {
    if (!parts.shp) throw new Error("The .shp file is missing.");
    var prj = parsePrj(parts.prj), project = toLonLat(prj);
    var geoms = readShp(parts.shp, project);
    var enc = (parts.cpg || "").trim().toLowerCase();
    if (/^(ansi\s*)?1252$|latin|8859-1/.test(enc)) enc = "windows-1252";
    else if (!enc || /utf-?8/.test(enc)) enc = "utf-8";
    var rows = parts.dbf ? readDbf(parts.dbf, enc) : [];
    var feats = [];
    geoms.forEach(function (g, i) { if (g) feats.push({ type: "Feature", properties: rows[i] || {}, geometry: g }); });
    var note = null;
    if (prj.assumed) note = "No .prj file: coordinates were read as WGS 84 longitude / latitude.";
    else if (!project) {
      // Geographic .prj but values that are clearly metres.
      var f0 = feats[0] && firstCoord(feats[0].geometry);
      if (f0 && (Math.abs(f0[0]) > 180 || Math.abs(f0[1]) > 90)) throw new Error("The coordinates look projected (metres) but the .prj says geographic.");
    }
    return { geojson: { type: "FeatureCollection", features: feats }, note: note, crs: prj.kind };
  }
  function firstCoord(g) { var c = g.coordinates; while (Array.isArray(c) && Array.isArray(c[0])) c = c[0]; return c; }

  /* -------------------------------------------------------------- KML */

  function kids(el, name) { return Array.prototype.filter.call(el.children || [], function (c) { return c.localName === name; }); }
  function first(el, name) { return el.getElementsByTagNameNS("*", name)[0] || null; }
  function text(el, name) { var e = first(el, name); return e ? e.textContent.trim() : ""; }
  function coords(s) {
    return String(s || "").trim().split(/\s+/).map(function (t) { var p = t.split(",").map(Number); return p.length >= 2 && isFinite(p[0]) && isFinite(p[1]) ? [p[0], p[1]] : null; }).filter(Boolean);
  }
  function kmlGeoms(el) {
    var out = [];
    Array.prototype.forEach.call(el.children || [], function (c) {
      var n = c.localName;
      if (n === "Point") { var p = coords(text(c, "coordinates"))[0]; if (p) out.push({ type: "Point", coordinates: p }); }
      else if (n === "LineString" || n === "LinearRing") { var l = coords(text(c, "coordinates")); if (l.length > 1) out.push({ type: "LineString", coordinates: l }); }
      else if (n === "Polygon") {
        var rings = [];
        kids(c, "outerBoundaryIs").concat(kids(c, "innerBoundaryIs")).forEach(function (b) { var r = coords(text(b, "coordinates")); if (r.length > 3) rings.push(r); });
        if (rings.length) out.push({ type: "Polygon", coordinates: rings });
      } else if (n === "MultiGeometry") out = out.concat(kmlGeoms(c));
      else if (n === "Track") {
        var tc = Array.prototype.map.call(c.getElementsByTagNameNS("*", "coord"), function (e) { var v = e.textContent.trim().split(/\s+/).map(Number); return [v[0], v[1]]; });
        if (tc.length > 1) out.push({ type: "LineString", coordinates: tc });
      }
    });
    return out;
  }
  function combine(gs) {
    if (!gs.length) return null;
    if (gs.length === 1) return gs[0];
    var t = gs[0].type;
    if (gs.every(function (g) { return g.type === t; }) && t !== "GeometryCollection") return { type: "Multi" + t, coordinates: gs.map(function (g) { return g.coordinates; }) };
    return { type: "GeometryCollection", geometries: gs };
  }
  function kml(textSrc) {
    var doc = new DOMParser().parseFromString(textSrc, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("The KML file is not valid XML.");
    var feats = [];
    Array.prototype.forEach.call(doc.getElementsByTagNameNS("*", "Placemark"), function (pm) {
      var g = combine(kmlGeoms(pm));
      if (!g) return;
      var props = {};
      var nm = kids(pm, "name")[0], ds = kids(pm, "description")[0];
      if (nm) props.name = nm.textContent.trim();
      if (ds) props.description = ds.textContent.trim().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      Array.prototype.forEach.call(pm.getElementsByTagNameNS("*", "Data"), function (d) { var k = d.getAttribute("name"); if (k) props[k] = text(d, "value"); });
      Array.prototype.forEach.call(pm.getElementsByTagNameNS("*", "SimpleData"), function (d) { var k = d.getAttribute("name"); if (k) props[k] = d.textContent.trim(); });
      var folder = pm.parentNode && pm.parentNode.localName === "Folder" ? kids(pm.parentNode, "name")[0] : null;
      if (folder) props.folder = folder.textContent.trim();
      Object.keys(props).forEach(function (k) { var v = props[k]; if (v !== "" && /^-?\d+(\.\d+)?$/.test(v)) props[k] = Number(v); });
      if (g.type === "GeometryCollection") g.geometries.forEach(function (x) { feats.push({ type: "Feature", properties: Object.assign({}, props), geometry: x }); });
      else feats.push({ type: "Feature", properties: props, geometry: g });
    });
    return { type: "FeatureCollection", features: feats };
  }

  /* -------------------------------------------------------------- GPX */

  function lengthKm(line) {
    var s = 0;
    for (var i = 1; i < line.length; i++) {
      var a = line[i - 1], b = line[i], dl = (b[1] - a[1]) * D2R, dn = (b[0] - a[0]) * D2R;
      var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dn / 2) * Math.sin(dn / 2);
      s += 2 * 6371.0088 * Math.asin(Math.sqrt(h));
    }
    return Math.round(s * 1000) / 1000;
  }
  function gpx(textSrc) {
    var doc = new DOMParser().parseFromString(textSrc, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("The GPX file is not valid XML.");
    var feats = [];
    function ptOf(e) { var lat = parseFloat(e.getAttribute("lat")), lon = parseFloat(e.getAttribute("lon")); return isFinite(lat) && isFinite(lon) ? [lon, lat] : null; }
    function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
    Array.prototype.forEach.call(doc.getElementsByTagNameNS("*", "wpt"), function (w) {
      var p = ptOf(w);
      if (p) feats.push({ type: "Feature", geometry: { type: "Point", coordinates: p },
        properties: { kind: "waypoint", name: text(w, "name") || null, ele: num(text(w, "ele")), time: text(w, "time") || null, desc: text(w, "desc") || text(w, "cmt") || null, sym: text(w, "sym") || null } });
    });
    Array.prototype.forEach.call(doc.getElementsByTagNameNS("*", "trk"), function (t) {
      var name = kids(t, "name")[0];
      kids(t, "trkseg").forEach(function (seg, si) {
        var pts = Array.prototype.filter.call(seg.children, function (c) { return c.localName === "trkpt"; });
        var line = pts.map(ptOf).filter(Boolean);
        if (line.length < 2) return;
        var times = pts.map(function (p) { return text(p, "time"); }).filter(Boolean);
        feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: line },
          properties: { kind: "track", name: name ? name.textContent.trim() : null, segment: si + 1, points: line.length, length_km: lengthKm(line), start: times[0] || null, end: times[times.length - 1] || null } });
      });
    });
    Array.prototype.forEach.call(doc.getElementsByTagNameNS("*", "rte"), function (r) {
      var line = Array.prototype.filter.call(r.children, function (c) { return c.localName === "rtept"; }).map(ptOf).filter(Boolean);
      var name = kids(r, "name")[0];
      if (line.length > 1) feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { kind: "route", name: name ? name.textContent.trim() : null, points: line.length, length_km: lengthKm(line) } });
    });
    return { type: "FeatureCollection", features: feats };
  }


  /* ---------------------------------------------------------- writers */
  // GeoJSON (WGS 84) -> Shapefile (.zip), KML, GPX.

  var WGS84_PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  function xmlEsc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function kindOf(g) { var t = g && g.type ? g.type.replace("Multi", "") : ""; return t === "Point" ? "point" : t === "LineString" ? "line" : t === "Polygon" ? "polygon" : null; }

  // Parts of one geometry as flat rings / lines / points.
  function partsOf(g) {
    if (!g) return [];
    switch (g.type) {
      case "Point": return [[g.coordinates]];
      case "MultiPoint": return [g.coordinates];
      case "LineString": return [g.coordinates];
      case "MultiLineString": return g.coordinates;
      case "Polygon": return g.coordinates;
      case "MultiPolygon": return [].concat.apply([], g.coordinates);
      case "GeometryCollection": return [].concat.apply([], g.geometries.map(partsOf));
    }
    return [];
  }
  function signedArea(r) { var s = 0; for (var i = 0; i < r.length - 1; i++) s += (r[i + 1][0] - r[i][0]) * (r[i + 1][1] + r[i][1]); return s; }

  // DBF columns from the properties: numbers N, booleans L, text C (UTF-8).
  function dbfColumns(features) {
    var keys = [], info = {};
    features.forEach(function (f) {
      Object.keys(f.properties || {}).forEach(function (k) {
        if (/^__/.test(k)) return;
        if (!info[k]) { info[k] = { num: true, bool: true, len: 1, int: 1, dec: 0, any: false }; keys.push(k); }
        var v = f.properties[k], c = info[k];
        if (v === null || v === undefined || v === "") return;
        c.any = true;
        if (typeof v !== "boolean") c.bool = false;
        if (typeof v === "number" && isFinite(v)) {
          var s = String(v);
          if (/e/i.test(s)) s = v.toFixed(8);
          var d = s.indexOf(".") >= 0 ? s.length - s.indexOf(".") - 1 : 0;
          c.dec = Math.min(8, Math.max(c.dec, d));
          c.int = Math.max(c.int, String(Math.trunc(Math.abs(v))).length + (v < 0 ? 1 : 0));
        } else {
          c.num = false;
          c.len = Math.max(c.len, new TextEncoder().encode(typeof v === "object" ? JSON.stringify(v) : String(v)).length);
        }
      });
    });
    var used = {};
    return keys.map(function (k) {
      var c = info[k], name = k.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 10) || "FIELD", base = name, n = 1;
      while (used[name.toUpperCase()]) { n++; name = base.slice(0, 10 - String(n).length) + n; }
      used[name.toUpperCase()] = true;
      var type = !c.any ? "C" : c.bool ? "L" : c.num ? "N" : "C";
      var len = type === "L" ? 1 : type === "N" ? Math.min(19, c.int + (c.dec ? c.dec + 1 : 0)) : Math.min(254, Math.max(1, c.len));
      return { key: k, name: name, type: type, len: len, dec: type === "N" ? c.dec : 0 };
    });
  }

  function writeDbf(features, cols) {
    var enc = new TextEncoder(), recLen = 1 + cols.reduce(function (s, c) { return s + c.len; }, 0), headLen = 32 + 32 * cols.length + 1;
    var buf = new Uint8Array(headLen + recLen * features.length + 1), dv = new DataView(buf.buffer), d = new Date();
    buf[0] = 3; buf[1] = d.getFullYear() - 1900; buf[2] = d.getMonth() + 1; buf[3] = d.getDate();
    dv.setUint32(4, features.length, true); dv.setUint16(8, headLen, true); dv.setUint16(10, recLen, true);
    buf[29] = 0x00; // code page left to the .cpg (UTF-8)
    cols.forEach(function (c, i) {
      var o = 32 + i * 32;
      buf.set(enc.encode(c.name).slice(0, 10), o);
      buf[o + 11] = c.type.charCodeAt(0); buf[o + 16] = c.len; buf[o + 17] = c.dec;
    });
    buf[headLen - 1] = 0x0d;
    features.forEach(function (f, r) {
      var o = headLen + r * recLen;
      buf[o] = 0x20;
      var at = o + 1;
      cols.forEach(function (c) {
        var v = (f.properties || {})[c.key], s;
        if (v === null || v === undefined || v === "") s = "";
        else if (c.type === "N") s = typeof v === "number" ? (c.dec ? v.toFixed(c.dec) : String(Math.round(v))) : String(v);
        else if (c.type === "L") s = v ? "T" : "F";
        else s = typeof v === "object" ? JSON.stringify(v) : String(v);
        var bytes = enc.encode(s);
        if (bytes.length > c.len) { // cut on a character boundary
          var cut = c.len;
          while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--;
          bytes = bytes.slice(0, cut);
        }
        var cell = new Uint8Array(c.len).fill(0x20);
        if (c.type === "N") cell.set(bytes, c.len - bytes.length); else cell.set(bytes, 0);
        buf.set(cell, at);
        at += c.len;
      });
    });
    buf[buf.length - 1] = 0x1a;
    return buf.buffer;
  }

  // One geometry kind -> .shp and .shx buffers.
  function writeShp(features, kind) {
    var type = kind === "point" ? 1 : kind === "line" ? 3 : 5, recs = [], all = [];
    features.forEach(function (f) {
      var parts = partsOf(f.geometry).filter(function (p) { return p.length; });
      if (kind === "polygon") parts = parts.map(function (r, i, arr) {
        // Shapefile: outer rings clockwise, holes counter-clockwise.
        var outer = f.geometry.type === "Polygon" ? i === 0 : isOuterInMulti(f.geometry, r);
        var cw = signedArea(r) > 0;
        return outer === cw ? r : r.slice().reverse();
      });
      var pts = [].concat.apply([], parts);
      pts.forEach(function (p) { all.push(p); });
      var len;
      if (kind === "point") {
        // A multipoint feature is written as its first point.
        len = 20;
        recs.push({ len: len, write: function (dv, o) { dv.setInt32(o, 1, true); dv.setFloat64(o + 4, pts[0][0], true); dv.setFloat64(o + 12, pts[0][1], true); } });
      } else {
        len = 44 + 4 * parts.length + 16 * pts.length;
        recs.push({ len: len, write: function (dv, o) {
          var b = bbox(pts);
          dv.setInt32(o, type, true);
          dv.setFloat64(o + 4, b[0], true); dv.setFloat64(o + 12, b[1], true); dv.setFloat64(o + 20, b[2], true); dv.setFloat64(o + 28, b[3], true);
          dv.setInt32(o + 36, parts.length, true); dv.setInt32(o + 40, pts.length, true);
          var k = 0;
          parts.forEach(function (pp, i) { dv.setInt32(o + 44 + i * 4, k, true); k += pp.length; });
          var at = o + 44 + 4 * parts.length;
          pts.forEach(function (p, i) { dv.setFloat64(at + i * 16, p[0], true); dv.setFloat64(at + i * 16 + 8, p[1], true); });
        } });
      }
    });
    var total = 100 + recs.reduce(function (s, r) { return s + 8 + r.len; }, 0);
    var shp = new ArrayBuffer(total), shx = new ArrayBuffer(100 + 8 * recs.length), sv = new DataView(shp), xv = new DataView(shx), b = all.length ? bbox(all) : [0, 0, 0, 0];
    [sv, xv].forEach(function (v, i) {
      v.setInt32(0, 9994, false); v.setInt32(24, (i ? 100 + 8 * recs.length : total) / 2, false); v.setInt32(28, 1000, true); v.setInt32(32, type, true);
      v.setFloat64(36, b[0], true); v.setFloat64(44, b[1], true); v.setFloat64(52, b[2], true); v.setFloat64(60, b[3], true);
    });
    var o = 100;
    recs.forEach(function (r, i) {
      xv.setInt32(100 + i * 8, o / 2, false); xv.setInt32(104 + i * 8, r.len / 2, false);
      sv.setInt32(o, i + 1, false); sv.setInt32(o + 4, r.len / 2, false);
      r.write(sv, o + 8);
      o += 8 + r.len;
    });
    return { shp: shp, shx: shx };
  }
  function isOuterInMulti(g, ring) {
    if (g.type !== "MultiPolygon") return true;
    return g.coordinates.some(function (poly) { return poly[0] === ring; });
  }
  function bbox(pts) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    pts.forEach(function (p) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; });
    return b;
  }

  function safe(n) { return String(n || "layer").replace(/[\\/:*?"<>|]+/g, "").trim() || "layer"; }

  // A zip with one shapefile per geometry kind (points / lines / polygons).
  function toShapefileZip(fc, name) {
    if (!window.PlootsPlugins || !window.PlootsPlugins.writeZip) throw new Error("The zip writer is not loaded.");
    var groups = { point: [], line: [], polygon: [] };
    (fc.features || []).forEach(function (f) { var k = kindOf(f.geometry); if (k) groups[k].push(f); });
    var kinds = Object.keys(groups).filter(function (k) { return groups[k].length; });
    if (!kinds.length) throw new Error("No features to export.");
    var files = {}, base = safe(name);
    kinds.forEach(function (k) {
      var stem = kinds.length > 1 ? base + "_" + k + "s" : base, feats = groups[k], cols = dbfColumns(feats), s = writeShp(feats, k);
      files[stem + ".shp"] = s.shp; files[stem + ".shx"] = s.shx; files[stem + ".dbf"] = writeDbf(feats, cols);
      files[stem + ".prj"] = WGS84_PRJ; files[stem + ".cpg"] = "UTF-8";
    });
    return window.PlootsPlugins.writeZip(files);
  }

  function kmlCoords(line) { return line.map(function (p) { return +p[0].toFixed(7) + "," + +p[1].toFixed(7); }).join(" "); }
  function kmlGeom(g) {
    if (!g) return "";
    switch (g.type) {
      case "Point": return "<Point><coordinates>" + kmlCoords([g.coordinates]) + "</coordinates></Point>";
      case "LineString": return "<LineString><tessellate>1</tessellate><coordinates>" + kmlCoords(g.coordinates) + "</coordinates></LineString>";
      case "Polygon": return "<Polygon>" + g.coordinates.map(function (r, i) { return (i ? "<innerBoundaryIs>" : "<outerBoundaryIs>") + "<LinearRing><coordinates>" + kmlCoords(r) + "</coordinates></LinearRing>" + (i ? "</innerBoundaryIs>" : "</outerBoundaryIs>"); }).join("") + "</Polygon>";
      case "MultiPoint": case "MultiLineString": case "MultiPolygon":
        return "<MultiGeometry>" + g.coordinates.map(function (c) { return kmlGeom({ type: g.type.replace("Multi", ""), coordinates: c }); }).join("") + "</MultiGeometry>";
      case "GeometryCollection": return "<MultiGeometry>" + g.geometries.map(kmlGeom).join("") + "</MultiGeometry>";
    }
    return "";
  }
  function toKML(fc, name, colorOf) {
    var nameKey = pickNameKey(fc);
    var body = (fc.features || []).map(function (f, i) {
      var p = f.properties || {}, color = colorOf ? colorOf(f, i) : null, style = "";
      if (color) {
        var c = color.replace("#", ""), abgr = "ff" + c.slice(4, 6) + c.slice(2, 4) + c.slice(0, 2), fill = "99" + c.slice(4, 6) + c.slice(2, 4) + c.slice(0, 2);
        style = "<Style><IconStyle><color>" + abgr + "</color></IconStyle><LineStyle><color>" + abgr + "</color><width>2</width></LineStyle><PolyStyle><color>" + fill + "</color></PolyStyle></Style>";
      }
      var data = Object.keys(p).filter(function (k) { return !/^__/.test(k); }).map(function (k) {
        var v = p[k];
        return '<Data name="' + xmlEsc(k) + '"><value>' + xmlEsc(v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : v) + "</value></Data>";
      }).join("");
      return "<Placemark><name>" + xmlEsc(nameKey ? p[nameKey] : "#" + (i + 1)) + "</name>" + style + "<ExtendedData>" + data + "</ExtendedData>" + kmlGeom(f.geometry) + "</Placemark>";
    }).join("\n");
    return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xmlEsc(name) + "</name>\n" + body + "\n</Document></kml>\n";
  }
  function pickNameKey(fc) {
    var f = (fc.features || [])[0];
    if (!f) return null;
    var keys = Object.keys(f.properties || {});
    return keys.filter(function (k) { return /^(name|nama|label|title|judul|id)$/i.test(k); })[0] || keys.filter(function (k) { return /name|nama/i.test(k); })[0] || null;
  }

  function toGPX(fc, name) {
    var nameKey = pickNameKey(fc), wpts = [], trks = [];
    (fc.features || []).forEach(function (f, i) {
      var g = f.geometry, p = f.properties || {}, nm = xmlEsc(nameKey ? p[nameKey] : "#" + (i + 1));
      if (!g) return;
      if (g.type === "Point" || g.type === "MultiPoint") {
        (g.type === "Point" ? [g.coordinates] : g.coordinates).forEach(function (c) { wpts.push('<wpt lat="' + c[1] + '" lon="' + c[0] + '"><name>' + nm + "</name></wpt>"); });
      } else {
        var lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates
          : g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map(function (x) { return x[0]; }) : [];
        if (lines.length) trks.push("<trk><name>" + nm + "</name>" + lines.map(function (l) { return "<trkseg>" + l.map(function (c) { return '<trkpt lat="' + c[1] + '" lon="' + c[0] + '"/>'; }).join("") + "</trkseg>"; }).join("") + "</trk>");
      }
    });
    if (!wpts.length && !trks.length) throw new Error("No features to export.");
    return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Ploots Click" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>' + xmlEsc(name) + "</name></metadata>\n" + wpts.concat(trks).join("\n") + "\n</gpx>\n";
  }

  /* ------------------------------------------------------------ entry */

  function unzip(buf) {
    if (!window.PlootsPlugins || !window.PlootsPlugins.readZip) return Promise.reject(new Error("The zip reader is not loaded."));
    return window.PlootsPlugins.readZip(buf);
  }
  function td(buf) { return new TextDecoder("utf-8").decode(buf); }

  // Shapefiles among named buffers: { "dir/roads.shp": ArrayBuffer, … }.
  function shapefilesFrom(named) {
    var names = Object.keys(named), out = [];
    names.filter(function (n) { return extOf(n) === "shp"; }).forEach(function (shpName) {
      var stem = shpName.slice(0, -4).toLowerCase();
      function part(ext) { var k = names.filter(function (n) { return n.toLowerCase() === stem + "." + ext; })[0]; return k ? named[k] : null; }
      var r = shapefile({ shp: named[shpName], dbf: part("dbf"), prj: part("prj") ? td(part("prj")) : null, cpg: part("cpg") ? td(part("cpg")) : null });
      out.push({ name: baseName(shpName), geojson: r.geojson, note: r.note });
    });
    return out;
  }

  // files: File[] (a shapefile's parts may come together). Resolves to
  // [{ name, geojson, note? }].
  function read(files) {
    files = Array.prototype.slice.call(files);
    var byExt = {};
    files.forEach(function (f) { (byExt[extOf(f.name)] = byExt[extOf(f.name)] || []).push(f); });
    var jobs = [];
    if (byExt.shp) {
      jobs.push(Promise.all(files.filter(function (f) { return /^(shp|shx|dbf|prj|cpg)$/.test(extOf(f.name)); }).map(function (f) { return f.arrayBuffer().then(function (b) { return [f.name, b]; }); }))
        .then(function (list) { var named = {}; list.forEach(function (x) { named[x[0]] = x[1]; }); return shapefilesFrom(named); }));
    } else if (byExt.dbf) jobs.push(Promise.reject(new Error("Pick the .shp file together with its .dbf (and .prj).")));
    (byExt.kml || []).forEach(function (f) { jobs.push(f.text().then(function (t) { return [{ name: baseName(f.name), geojson: kml(t) }]; })); });
    (byExt.gpx || []).forEach(function (f) { jobs.push(f.text().then(function (t) { return [{ name: baseName(f.name), geojson: gpx(t) }]; })); });
    (byExt.kmz || []).forEach(function (f) {
      jobs.push(f.arrayBuffer().then(unzip).then(function (z) {
        var k = Object.keys(z).filter(function (n) { return extOf(n) === "kml"; }).sort(function (a, b) { return (/doc\.kml$/i.test(b) ? 1 : 0) - (/doc\.kml$/i.test(a) ? 1 : 0); })[0];
        if (!k) throw new Error(f.name + " has no KML inside.");
        return [{ name: baseName(f.name), geojson: kml(td(z[k])) }];
      }));
    });
    (byExt.zip || []).forEach(function (f) {
      jobs.push(f.arrayBuffer().then(unzip).then(function (z) {
        var got = shapefilesFrom(z);
        Object.keys(z).filter(function (n) { return /\.(kml|gpx|geojson)$/i.test(n); }).forEach(function (n) {
          var e = extOf(n), t = td(z[n]);
          got.push({ name: baseName(n), geojson: e === "kml" ? kml(t) : e === "gpx" ? gpx(t) : JSON.parse(t) });
        });
        if (!got.length) throw new Error(f.name + " has no shapefile, KML, GPX or GeoJSON inside.");
        return got;
      }));
    });
    return Promise.all(jobs).then(function (lists) {
      var all = [].concat.apply([], lists).filter(function (x) { return x.geojson && x.geojson.features && x.geojson.features.length; });
      if (!all.length) throw new Error("No features found.");
      return all;
    });
  }

  function canRead(name) { return /\.(shp|kml|kmz|gpx)$/i.test(name); }

  window.PlootsFormats = { read: read, canRead: canRead, kml: kml, gpx: gpx, shapefile: shapefile, parsePrj: parsePrj, shapefilesFrom: shapefilesFrom,
    toShapefileZip: toShapefileZip, toKML: toKML, toGPX: toGPX };
})();
