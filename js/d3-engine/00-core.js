/* ==========================================================================
   Ploots D3 engine — core helpers.

   The D3 engine replaces Plotly.js chart type by chart type. Everything a
   renderer needs that is not specific to one chart lives here:

     - text measurement (canvas measureText, so layout can be computed
       before anything is drawn — margins are sized to the real labels)
     - a small rich-text renderer: <br>, <sup>, <sub>, <b>, <i> inside axis
       titles, tick labels and legend labels, the same subset Plotly
       accepted, so existing labels such as "AGC (Mg C ha<sup>-1</sup>)"
       keep working
     - number formats (value labels + axis presets)
     - marker symbols (every shape in MARKER_DEFS, 01-config.js)
     - SVG hatch patterns (every shape in HATCH_DEFS) and dash styles

   Nothing here touches the DOM outside the <svg> it is given.
   ========================================================================== */
(function () {
  "use strict";

  var PD = window.PlootsD3 = window.PlootsD3 || {};
  PD.renderers = PD.renderers || {};

  PD.handles = function (type) {
    return typeof d3 !== "undefined" && Object.prototype.hasOwnProperty.call(PD.renderers, type);
  };

  PD.ink = function () {
    return {
      text: typeof TEXT_INK !== "undefined" ? TEXT_INK : "#1a1a1a",
      shape: typeof SHAPE_INK !== "undefined" ? SHAPE_INK : "#1a1a1a",
      axis: typeof AXIS_INK !== "undefined" ? AXIS_INK : "#1a1a1a",
      grid: "#e4e2d8"
    };
  };

  /* ---------------------------------------------------------------- text */

  var measureCtx = null;
  PD.textWidth = function (str, size, family, weight) {
    str = String(str == null ? "" : str);
    if (!measureCtx) {
      try { measureCtx = document.createElement("canvas").getContext("2d"); } catch (e) { measureCtx = null; }
    }
    if (!measureCtx) return str.length * size * 0.56;
    measureCtx.font = (weight || "normal") + " " + size + "px " + (family || "sans-serif");
    return measureCtx.measureText(str).width;
  };

  // Parses the Plotly-compatible tag subset into lines of styled runs.
  function parseRich(str) {
    str = String(str == null ? "" : str);
    var lines = [[]], style = { sup: 0, sub: 0, b: 0, i: 0 };
    var re = /<(\/?)(br|sup|sub|b|i)\s*\/?>/gi, last = 0, m;
    function push(text) {
      if (!text) return;
      lines[lines.length - 1].push({
        text: decodeEntities(text), sup: style.sup > 0, sub: style.sub > 0, b: style.b > 0, i: style.i > 0
      });
    }
    while ((m = re.exec(str))) {
      push(str.slice(last, m.index));
      var tag = m[2].toLowerCase(), close = m[1] === "/";
      if (tag === "br") lines.push([]);
      else style[tag] = Math.max(0, style[tag] + (close ? -1 : 1));
      last = re.lastIndex;
    }
    push(str.slice(last));
    return lines;
  }
  function decodeEntities(s) {
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  }
  PD.parseRich = parseRich;

  // Size of a rich string: {w, h, lines}. Line height 1.2em.
  PD.richSize = function (str, size, family, weight) {
    var lines = parseRich(str), w = 0;
    lines.forEach(function (runs) {
      var lw = 0;
      runs.forEach(function (r) {
        lw += PD.textWidth(r.text, (r.sup || r.sub) ? size * 0.7 : size, family, r.b ? "bold" : weight);
      });
      w = Math.max(w, lw);
    });
    return { w: w, h: lines.length * size * 1.2, lines: lines.length };
  };

  /* Draws rich text into a <text> element appended to `parent`.
     opts: x, y, size, family, color, anchor ("start"|"middle"|"end"),
           valign ("top"|"middle"|"bottom" — where y sits relative to the
           whole block), rotate (deg), weight, cls */
  PD.richText = function (parent, str, opts) {
    var lines = parseRich(str);
    var size = opts.size || 12, lh = size * 1.2;
    var total = lines.length * lh;
    var firstBaseline;
    // Baseline of the first line so that the block is aligned per valign.
    // 0.8em is the usual ascender share of a Latin font.
    if (opts.valign === "top") firstBaseline = size * 0.8;
    else if (opts.valign === "bottom") firstBaseline = -total + size * 0.8;
    else firstBaseline = -total / 2 + size * 0.8;

    var t = parent.append("text")
      .attr("x", 0).attr("y", 0)
      .attr("font-family", opts.family || null)
      .attr("font-size", size)
      .attr("fill", opts.color || "#1a1a1a")
      .attr("text-anchor", opts.anchor || "start");
    if (opts.weight) t.attr("font-weight", opts.weight);
    if (opts.halo) {
      // Background-coloured outline behind the glyphs keeps value labels
      // readable over hatch patterns, grid lines and neighbouring marks.
      t.attr("stroke", opts.halo).attr("stroke-width", Math.max(2, size * 0.25))
        .attr("stroke-linejoin", "round").attr("paint-order", "stroke");
    }
    if (opts.cls) t.attr("class", opts.cls);
    var tf = "translate(" + (opts.x || 0) + "," + (opts.y || 0) + ")";
    if (opts.rotate) tf += " rotate(" + opts.rotate + ")";
    t.attr("transform", tf);

    lines.forEach(function (runs, li) {
      var line = t.append("tspan").attr("x", 0).attr("y", firstBaseline + li * lh);
      if (!runs.length) { line.text("\u200b"); return; }
      var shift = 0;
      runs.forEach(function (r) {
        var ts = line.append("tspan").text(r.text);
        var want = r.sup ? -size * 0.4 : r.sub ? size * 0.25 : 0;
        if (want !== shift) { ts.attr("dy", want - shift); shift = want; }
        if (r.sup || r.sub) ts.attr("font-size", size * 0.7);
        if (r.b) ts.attr("font-weight", "bold");
        if (r.i) ts.attr("font-style", "italic");
      });
    });
    return t;
  };

  /* -------------------------------------------------------------- numbers */

  PD.isNumericCategory = function (arr) {
    if (!arr || arr.length < 2) return false;
    var seen = {};
    for (var k = 0; k < arr.length; k++) {
      var s = String(arr[k] == null ? "" : arr[k]).trim();
      if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return false;
      seen[s] = 1;
    }
    return Object.keys(seen).length >= 2;
  };

  PD.finite = function (v) { return typeof v === "number" && isFinite(v); };

  // Axis tick formatter. `preset` follows AXIS_FORMAT_PRESETS
  // (22-axis-format-panel.js); `ticks` are the values being labelled.
  PD.axisFormatter = function (preset, ticks, isLog) {
    var P = (typeof AXIS_FORMAT_PRESETS !== "undefined" && AXIS_FORMAT_PRESETS[preset]) || {};
    var base;
    if (P.tickformat) {
      base = d3.format(P.tickformat);
    } else if (isLog) {
      base = function (v) {
        var a = Math.abs(v);
        return (a >= 1e5 || (a > 0 && a < 1e-3)) ? d3.format(".0e")(v) : d3.format("~g")(v);
      };
    } else {
      var step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
      var mx = d3.max(ticks, function (v) { return Math.abs(v); }) || 0;
      if (mx >= 1e6 || (mx > 0 && mx < 1e-4)) base = d3.format("~e");
      else {
        var p = step > 0 ? d3.precisionFixed(step) : 0;
        // Thousands separators only from 10 000 up, so years (2016) and
        // ordinary counts read as-is.
        base = d3.format((mx >= 1e4 ? "," : "") + "." + Math.min(p, 8) + "f");
      }
    }
    var pre = P.tickprefix || "", suf = P.ticksuffix || "";
    return function (v) { return pre + base(v).replace("−", "-") + suf; };
  };

  /* -------------------------------------------------------------- symbols */

  function poly(pts) { return "M" + pts.map(function (p) { return p[0].toFixed(2) + "," + p[1].toFixed(2); }).join("L") + "Z"; }
  function ngon(n, r, rot) {
    var pts = [];
    for (var k = 0; k < n; k++) {
      var a = rot + k * 2 * Math.PI / n;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return poly(pts);
  }
  function starPath(n, ro, ri, rot) {
    var pts = [];
    for (var k = 0; k < 2 * n; k++) {
      var a = rot + k * Math.PI / n, r = k % 2 ? ri : ro;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return poly(pts);
  }
  var UP = -Math.PI / 2;

  // Returns {d, line} — `line` symbols are drawn as strokes, not fills.
  PD.symbol = function (shape, size) {
    var r = size / 2;
    switch (shape) {
      case "square": return { d: poly([[-r * .9, -r * .9], [r * .9, -r * .9], [r * .9, r * .9], [-r * .9, r * .9]]) };
      case "diamond": return { d: poly([[0, -r * 1.3], [r * 1.3, 0], [0, r * 1.3], [-r * 1.3, 0]]) };
      case "diamond-tall": return { d: poly([[0, -r * 1.35], [r * .7, 0], [0, r * 1.35], [-r * .7, 0]]) };
      case "diamond-wide": return { d: poly([[0, -r * .7], [r * 1.35, 0], [0, r * .7], [-r * 1.35, 0]]) };
      case "triangle-up": return { d: ngon(3, r * 1.2, UP) };
      case "triangle-down": return { d: ngon(3, r * 1.2, -UP) };
      case "pentagon": return { d: ngon(5, r * 1.1, UP) };
      case "hexagon": return { d: ngon(6, r * 1.1, UP) };
      case "star": return { d: starPath(5, r * 1.3, r * .55, UP) };
      case "star-diamond": return { d: starPath(4, r * 1.3, r * .45, UP) };
      case "star-triangle-up": return { d: starPath(3, r * 1.4, r * .5, UP) };
      case "hexagram": return { d: starPath(6, r * 1.2, r * .69, UP) };
      case "cross": var t = r * .4;
        return { d: poly([[-t, -r], [t, -r], [t, -t], [r, -t], [r, t], [t, t], [t, r], [-t, r], [-t, t], [-r, t], [-r, -t], [-t, -t]]) };
      case "x": var q = r * .4 / Math.SQRT2, R = r * 1.05;
        return { d: poly([[0, -2 * q], [R - q, -R - q], [R + q, -R + q], [2 * q, 0], [R + q, R - q], [R - q, R + q], [0, 2 * q], [-R + q, R + q], [-R - q, R - q], [-2 * q, 0], [-R - q, -R + q], [-R + q, -R - q]]) };
      case "hourglass": return { d: poly([[-r, -r], [r, -r], [-r, r], [r, r]]) };
      case "bowtie": return { d: poly([[-r, -r], [r, r], [r, -r], [-r, r]]) };
      case "arrow-up": return { d: poly([[0, -r * 1.3], [r * 1.1, 0], [r * .4, 0], [r * .4, r * 1.2], [-r * .4, r * 1.2], [-r * .4, 0], [-r * 1.1, 0]]) };
      case "hash": var h = r * .45;
        return { line: true, d: "M" + (-h) + "," + (-r) + "V" + r + "M" + h + "," + (-r) + "V" + r + "M" + (-r) + "," + (-h) + "H" + r + "M" + (-r) + "," + h + "H" + r };
      case "asterisk": var a = r * .87, b = r * .5;
        return { line: true, d: "M0," + (-r) + "V" + r + "M" + (-a) + "," + (-b) + "L" + a + "," + b + "M" + (-a) + "," + b + "L" + a + "," + (-b) };
      case "y-up": return { line: true, d: "M0,0V" + r + "M0,0L" + (-r * .87) + "," + (-r * .6) + "M0,0L" + (r * .87) + "," + (-r * .6) };
      default: return { d: "M" + r + ",0A" + r + "," + r + " 0 1,1 " + (-r) + ",0A" + r + "," + r + " 0 1,1 " + r + ",0Z" };
    }
  };

  // Draws one marker into `parent` at (x,y).
  PD.drawMarker = function (parent, x, y, shape, size, color, outlineW, outlineColor) {
    var s = PD.symbol(shape, size);
    var p = parent.append("path").attr("d", s.d).attr("transform", "translate(" + x + "," + y + ")");
    if (s.line) p.attr("fill", "none").attr("stroke", color).attr("stroke-width", Math.max(1.6, outlineW || 0));
    else {
      p.attr("fill", color);
      if (outlineW > 0) p.attr("stroke", outlineColor).attr("stroke-width", outlineW);
    }
    return p;
  };

  /* ------------------------------------------------------------- patterns */

  // Plotly-compatible dash names -> SVG dasharray, scaled with line width
  // the same way Plotly does (dash length grows with max(width, 3)).
  PD.dashArray = function (dash, width) {
    var w = Math.max(width || 1, 3);
    switch (dash) {
      case "dot": return w + "," + w;
      case "dash": return (3 * w) + "," + (3 * w);
      case "longdash": return (5 * w) + "," + (5 * w);
      case "dashdot": return (3 * w) + "," + w + "," + w + "," + w;
      case "longdashdot": return (5 * w) + "," + (2 * w) + "," + w + "," + (2 * w);
      default: return null;
    }
  };

  var patternSeq = 0;
  /* Returns a fill value for a hatch shape: either the plain bg colour
     (solid shape) or url(#id) of a <pattern> added to `defs`.
     `solidity` is the fraction of the tile covered by the foreground, as in
     Plotly's marker.pattern.solidity. */
  PD.patternFill = function (defs, shape, fg, bg, size, solidity) {
    if (!shape) return bg;
    size = Math.max(3, size || 7);
    solidity = Math.min(0.95, Math.max(0.05, solidity == null ? 0.45 : solidity));
    var id = "pd-pat-" + (++patternSeq);
    var p = defs.append("pattern").attr("id", id).attr("patternUnits", "userSpaceOnUse")
      .attr("width", size).attr("height", size);
    p.append("rect").attr("width", size).attr("height", size).attr("fill", bg);
    var s = size, lw;
    function lines(d, w) {
      p.append("path").attr("d", d).attr("stroke", fg).attr("stroke-width", w).attr("fill", "none").attr("shape-rendering", "geometricPrecision");
    }
    switch (shape) {
      case "/":
        lw = s * solidity / Math.SQRT2 * 1.4;
        lines("M" + (-s / 2) + "," + (s / 2) + "L" + (s / 2) + "," + (-s / 2) + "M0," + s + "L" + s + ",0M" + (s / 2) + "," + (s * 1.5) + "L" + (s * 1.5) + "," + (s / 2), lw);
        break;
      case "\\":
        lw = s * solidity / Math.SQRT2 * 1.4;
        lines("M" + (-s / 2) + "," + (s / 2) + "L" + (s / 2) + "," + (s * 1.5) + "M0,0L" + s + "," + s + "M" + (s / 2) + "," + (-s / 2) + "L" + (s * 1.5) + "," + (s / 2), lw);
        break;
      case "x":
        lw = s * (1 - Math.sqrt(1 - solidity)) / Math.SQRT2 * 1.4;
        lines("M0,0L" + s + "," + s + "M" + (-s / 2) + "," + (s / 2) + "L" + (s / 2) + "," + (s * 1.5) + "M" + (s / 2) + "," + (-s / 2) + "L" + (s * 1.5) + "," + (s / 2) +
          "M0," + s + "L" + s + ",0M" + (-s / 2) + "," + (s / 2) + "L" + (s / 2) + "," + (-s / 2) + "M" + (s / 2) + "," + (s * 1.5) + "L" + (s * 1.5) + "," + (s / 2), lw);
        break;
      case "-":
        lines("M0," + (s / 2) + "H" + s, s * solidity);
        break;
      case "|":
        lines("M" + (s / 2) + ",0V" + s, s * solidity);
        break;
      case "+":
        lw = s * (1 - Math.sqrt(1 - solidity));
        lines("M0," + (s / 2) + "H" + s + "M" + (s / 2) + ",0V" + s, lw);
        break;
      case ".":
        p.append("circle").attr("cx", s / 2).attr("cy", s / 2).attr("r", s * Math.sqrt(solidity / Math.PI)).attr("fill", fg);
        break;
      default:
        return bg;
    }
    return "url(#" + id + ")";
  };

  /* ------------------------------------------------------------- mounting */

  // Clears the graph div (including any Plotly state) and returns a fresh
  // <svg> of the given size. Class names mirror Plotly's where other code
  // looks for them ("main-svg", "bg", "legend").
  PD.mount = function (gd, w, h, bg) {
    if (typeof Plotly !== "undefined" && gd._fullLayout) { try { Plotly.purge(gd); } catch (e) { } }
    gd.innerHTML = "";
    var svg = d3.select(gd).append("svg")
      .attr("xmlns", "http://www.w3.org/2000/svg")
      .attr("xmlns:xlink", "http://www.w3.org/1999/xlink")
      .attr("class", "main-svg ploots-d3")
      .attr("width", w).attr("height", h)
      .attr("viewBox", "0 0 " + w + " " + h)
      .style("display", "block").style("overflow", "visible");
    svg.append("defs");
    svg.append("rect").attr("class", "bg").attr("width", w).attr("height", h).attr("fill", bg);
    return svg;
  };
})();
