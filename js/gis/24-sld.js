/* ==========================================================================
   GIS — export a layer's style as SLD (OGC Styled Layer Descriptor 1.1 / SE),
   which QGIS (Layer Properties ▸ Style ▸ Load Style), GeoServer and
   ArcGIS Pro can read.

   Single symbol, categorized (one rule per value) and graduated (one rule
   per class, with the class breaks as filters) styles are written with
   fill, fill opacity, outline color / width / dash, line width and dash,
   point size, and labels (TextSymbolizer) when the layer has them.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  function x(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]; }); }
  var DASH = { dash: "4 2.5", dot: "1 2", dashdot: "4 2 1 2" };
  function css(name, v) { return '<se:SvgParameter name="' + name + '">' + x(v) + "</se:SvgParameter>"; }
  function hex(c) { var d = typeof d3 !== "undefined" && d3.color(c); return d ? d.formatHex() : c; }

  function symbolizers(kind, s, color) {
    var so = s.strokeOpacity != null ? s.strokeOpacity : 1;
    if (kind === "polygon") {
      var h = '<se:PolygonSymbolizer><se:Fill>' + css("fill", hex(color)) + css("fill-opacity", s.fillOpacity) + "</se:Fill>";
      if (s.strokeWidth > 0) h += "<se:Stroke>" + css("stroke", hex(s.strokeColor)) + css("stroke-width", s.strokeWidth) + css("stroke-opacity", so) + css("stroke-linejoin", s.strokeJoin || "round") + (DASH[s.strokeDash] ? css("stroke-dasharray", DASH[s.strokeDash]) : "") + "</se:Stroke>";
      return h + "</se:PolygonSymbolizer>";
    }
    if (kind === "line") {
      var l = "";
      if (s.lineCasing && s.strokeWidth > 0) l += "<se:LineSymbolizer><se:Stroke>" + css("stroke", hex(s.strokeColor)) + css("stroke-width", s.lineWidth + 2 * s.strokeWidth) + css("stroke-opacity", so) + css("stroke-linecap", "round") + "</se:Stroke></se:LineSymbolizer>";
      return l + "<se:LineSymbolizer><se:Stroke>" + css("stroke", hex(color)) + css("stroke-width", s.lineWidth) + css("stroke-linecap", "round") + css("stroke-linejoin", "round") + (DASH[s.lineDash] ? css("stroke-dasharray", DASH[s.lineDash]) : "") + "</se:Stroke></se:LineSymbolizer>";
    }
    return "<se:PointSymbolizer><se:Graphic><se:Mark><se:WellKnownName>circle</se:WellKnownName><se:Fill>" + css("fill", hex(color)) + css("fill-opacity", Math.max(0.05, s.fillOpacity)) + "</se:Fill>" +
      (s.strokeWidth > 0 ? "<se:Stroke>" + css("stroke", hex(s.strokeColor)) + css("stroke-width", s.strokeWidth) + "</se:Stroke>" : "") + "</se:Mark><se:Size>" + (2 * s.pointRadius) + "</se:Size></se:Graphic></se:PointSymbolizer>";
  }
  function label(s) {
    if (!s.labelField) return "";
    return "<se:TextSymbolizer><se:Label><ogc:PropertyName>" + x(s.labelField) + "</ogc:PropertyName></se:Label><se:Font>" + css("font-family", "Noto Sans") + css("font-size", s.labelSize || 12) +
      (s.labelFont === "bold" ? css("font-weight", "bold") : s.labelFont === "italic" ? css("font-style", "italic") : "") + "</se:Font>" +
      "<se:Halo><se:Radius>" + (s.labelHaloWidth || 1) + "</se:Radius><se:Fill>" + css("fill", hex(s.labelHaloColor || "#ffffff")) + "</se:Fill></se:Halo><se:Fill>" + css("fill", hex(s.labelColor || "#1a1a1a")) + "</se:Fill></se:TextSymbolizer>";
  }
  function rule(name, title, filter, body) {
    return "<se:Rule><se:Name>" + x(name) + "</se:Name><se:Description><se:Title>" + x(title) + "</se:Title></se:Description>" + (filter || "") + body + "</se:Rule>";
  }
  function prop(f) { return "<ogc:PropertyName>" + x(f) + "</ogc:PropertyName>"; }
  function lit(v) { return "<ogc:Literal>" + x(v) + "</ogc:Literal>"; }

  function toSLD(l) {
    if (!l || l.kind !== "vector") throw new Error("SLD export is for vector layers.");
    GIS.ensureStyle(l);
    var s = l.style, kind = GIS.geometryKind(l), rules = "";
    var joined = s.field === GIS.TABLE_FIELD;
    if (s.symbology === "categorized" && s.field && !joined) {
      GIS.sym.categories(l).forEach(function (c) {
        rules += rule(c.value, c.value, "<ogc:Filter><ogc:PropertyIsEqualTo>" + prop(s.field) + lit(c.value) + "</ogc:PropertyIsEqualTo></ogc:Filter>", symbolizers(kind, s, c.color));
      });
    } else if (s.symbology === "graduated" && s.field && !joined) {
      var cls = GIS.sym.classes(l), edges = [cls.lo].concat(cls.breaks).concat([cls.hi]);
      cls.colors.forEach(function (c, i) {
        var lo = edges[i], hi = edges[i + 1], last = i === cls.colors.length - 1;
        var f = "<ogc:Filter><ogc:And><ogc:PropertyIsGreaterThanOrEqualTo>" + prop(s.field) + lit(lo) + "</ogc:PropertyIsGreaterThanOrEqualTo>" +
          (last ? "<ogc:PropertyIsLessThanOrEqualTo>" : "<ogc:PropertyIsLessThan>") + prop(s.field) + lit(hi) + (last ? "</ogc:PropertyIsLessThanOrEqualTo>" : "</ogc:PropertyIsLessThan>") + "</ogc:And></ogc:Filter>";
        rules += rule(cls.labels[i], cls.labels[i], f, symbolizers(kind, s, c));
      });
    } else {
      rules += rule("Single symbol", l.legendName || l.name, "", symbolizers(kind, s, s.singleColor));
    }
    if (s.labelField) rules += rule("Labels", "Labels", "", label(s));
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<StyledLayerDescriptor version="1.1.0" xmlns="http://www.opengis.net/sld" xmlns:se="http://www.opengis.net/se" xmlns:ogc="http://www.opengis.net/ogc" ' +
      'xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.1.0/StyledLayerDescriptor.xsd">\n' +
      "  <NamedLayer><se:Name>" + x(l.name) + "</se:Name><UserStyle><se:Name>" + x(l.name) + "</se:Name><se:FeatureTypeStyle>\n    " +
      rules.replace(/<se:Rule>/g, "\n    <se:Rule>") + "\n  </se:FeatureTypeStyle></UserStyle></NamedLayer>\n</StyledLayerDescriptor>\n";
  }

  GIS.exportSLD = function (l) {
    var xml = toSLD(l), a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([xml], { type: "application/vnd.ogc.sld+xml" }));
    a.download = String(l.name).replace(/[^\w-]+/g, "_") + ".sld";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  };
  GIS.toSLD = toSLD;
})();
