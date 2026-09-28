/* ==========================================================================
   Radial Rings (multi-track polar chart) — registers the "Radial Rings"
   chart type, styled after circular multi-genome COG/category plots
   (concentric tracks, one per series, split into angular sectors by
   category, sector width ~ average share, bar length within the sector ~
   that series' share of the category's max).

   renderRadialRings() draws plain SVG into #plotlyDiv; the D3 engine
   (js/d3-engine/05-special.js, wrapLegacy) calls it, so render dispatch and
   SVG/PNG export are handled there. Uses the same data model as every other
   chart type (state.categories / state.seriesNames / state.seriesData).
   ========================================================================== */
(function () {
  "use strict";

  var RADIAL_TYPE = "radial-rings";

  if (typeof CHART_TYPE_DEFS !== "undefined") {
    CHART_TYPE_DEFS.push({ category: "Circular", value: RADIAL_TYPE, label: "Radial Rings (multi-track)", icon: "mdi:chart-donut-variant" });
  }
  if (typeof SAMPLE_DATA_BY_TYPE !== "undefined") {
    SAMPLE_DATA_BY_TYPE[RADIAL_TYPE] = "Category\tSpecies A\tSpecies B\tSpecies C\nEnergy metabolism\t8.1\t7.4\t8.6\nTranscription\t6.5\t7.0\t6.1\nTranslation & ribosome\t8.0\t8.3\t7.7\nReplication & repair\t3.6\t3.9\t3.3\nMembrane transport\t6.7\t6.2\t7.1\nCell motility\t3.5\t3.1\t3.8\nCell defense\t3.2\t2.9\t3.4\nLipid metabolism\t4.2\t4.5\t3.9\nCarbohydrate metabolism\t6.8\t6.3\t7.2\nUnknown function\t21.6\t20.8\t22.3\nUnclassified\t8.6\t9.0\t8.2";
  }
  if (typeof buildChartTypeGrid === "function") buildChartTypeGrid();
  if (typeof syncChartTypeGridActive === "function") syncChartTypeGridActive();

  function esc(s) {
    return (s == null ? "" : String(s)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Lighten a hex/rgb color a bit for inner tracks so overlapping-looking
  // rings of the same category read as distinct without a second palette.
  function shadeColor(hex, idx, n) {
    if (!hex) return hex;
    hex = String(hex).replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join("");
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "#" + hex;
    var r = parseInt(hex.substr(0, 2), 16), g = parseInt(hex.substr(2, 2), 16), b = parseInt(hex.substr(4, 2), 16);
    var t = n > 1 ? idx / (n - 1) : 0;
    var amt = 0.3 * t;
    r = Math.round(r + (255 - r) * amt);
    g = Math.round(g + (255 - g) * amt);
    b = Math.round(b + (255 - b) * amt);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function renderRadialRings() {
    var box = state.chartBox, w = box.w, h = box.h;
    var el = document.getElementById("plotlyDiv");
    if (!el) return;

    var cats = state.categories;
    var seriesAll = state.seriesNames.filter(function (n) { return state.seriesMeta[n].visible; });
    if (!cats.length || !seriesAll.length) { if (typeof renderBlankCanvas === "function") renderBlankCanvas(); return; }

    var colors = PALETTES[state.paletteIdx].colors;
    var gray = typeof isGrayscaleMode === "function" && isGrayscaleMode();
    var catColor = cats.map(function (_, i) { return gray ? grayForIndex(i) : colors[i % colors.length]; });

    var avg = cats.map(function (c, ci) {
      var s = 0;
      seriesAll.forEach(function (sn) { s += state.seriesData[sn][ci] || 0; });
      return s / seriesAll.length;
    });
    var maxv = cats.map(function (c, ci) {
      var m = 0;
      seriesAll.forEach(function (sn) { m = Math.max(m, state.seriesData[sn][ci] || 0); });
      return m > 0 ? m : 1;
    });
    var totalAvg = avg.reduce(function (a, b) { return a + b; }, 0) || 1;

    var showLegend = state.showLegend;
    var legendW = showLegend ? Math.min(200, Math.max(120, w * 0.24)) : 0;
    var plotW = w - legendW;
    var cx = plotW / 2, cy = h / 2;
    var fontFam = state.fontBody;
    var bodySize = state.bodyFontSize || 12;
    var fmt = function (v) { return typeof formatValue === "function" ? formatValue(v, state.valueFormat || "auto") : String(Math.round(v * 10) / 10); };
    var labelSize = Math.max(bodySize - 1, 9);
    var labelTexts = cats.map(function (c, ci) { return String(c == null ? "" : c) + (state.showValues ? "  " + fmt(avg[ci]) + "%" : ""); });
    var measure = document.createElement("canvas").getContext("2d");
    measure.font = labelSize + "px " + fontFam;
    var maxLabelW = d3.max(labelTexts, function (s) { return measure.measureText(s).width; }) || 0;
    // Leave room for the outside labels: the widest one sideways, one line
    // above and below.
    var maxRadius = Math.max(20, Math.min(plotW / 2 - maxLabelW - 20, h / 2 - labelSize - 16, Math.min(plotW, h) * 0.42));
    var innerHole = maxRadius * 0.22;
    var nRings = seriesAll.length;
    var ringGap = 1.4;
    var ringBand = (maxRadius - innerHole) / nRings;
    var ringThickness = Math.max(ringBand - ringGap, 1);
    var gapDeg = cats.length > 1 ? 1.6 : 0;

    function pt(r, deg) {
      var rad = (deg - 90) * Math.PI / 180;
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    }
    function arcPath(r0, r1, a0, a1) {
      var large = (a1 - a0) > 180 ? 1 : 0;
      var p0 = pt(r1, a0), p1 = pt(r1, a1), p2 = pt(r0, a1), p3 = pt(r0, a0);
      return "M " + p0[0].toFixed(2) + " " + p0[1].toFixed(2) +
        " A " + r1.toFixed(2) + " " + r1.toFixed(2) + " 0 " + large + " 1 " + p1[0].toFixed(2) + " " + p1[1].toFixed(2) +
        " L " + p2[0].toFixed(2) + " " + p2[1].toFixed(2) +
        " A " + r0.toFixed(2) + " " + r0.toFixed(2) + " 0 " + large + " 0 " + p3[0].toFixed(2) + " " + p3[1].toFixed(2) + " Z";
    }

    var angle = 0;
    var catAngles = [];
    cats.forEach(function (c, ci) {
      var sweep = Math.max((avg[ci] / totalAvg) * (360 - cats.length * gapDeg), 0);
      var a0 = angle + gapDeg / 2, a1 = angle + sweep - gapDeg / 2;
      if (a1 < a0) a1 = a0;
      catAngles.push({ start: a0, end: a1, mid: (a0 + a1) / 2 });
      angle += sweep;
    });

    var svg = [];
    svg.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" font-family="' + esc(fontFam) + '">');
    var bgFill = typeof chartBgColor === "function" ? chartBgColor() : "#ffffff";
    if (bgFill !== "rgba(0,0,0,0)") {
      svg.push('<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + bgFill + '"/>');
    }

    var idBandInner = maxRadius + 1, idBandOuter = maxRadius + 4;
    var labelR = maxRadius + 11;
    var outlineOn = !!state.outlineMarker;
    var labels = [];

    cats.forEach(function (c, ci) {
      var A = catAngles[ci];
      if (A.end <= A.start) return;

      svg.push('<path d="' + arcPath(idBandInner, idBandOuter, A.start, A.end) + '" fill="' + catColor[ci] + '" opacity="0.9"/>');

      for (var si = 0; si < nRings; si++) {
        var sn = seriesAll[si];
        var val = state.seriesData[sn][ci] || 0;
        var frac = val / maxv[ci];
        if (frac <= 0) continue;
        var sectorWidth = A.end - A.start;
        var barWidth = sectorWidth * frac;
        var a0 = A.mid - barWidth / 2, a1 = A.mid + barWidth / 2;
        var rOuter = maxRadius - si * ringBand;
        var rInner = rOuter - ringThickness;
        var fillC = gray ? grayForIndex(ci) : shadeColor(catColor[ci], si, nRings);
        svg.push('<path d="' + arcPath(rInner, rOuter, a0, a1) + '" fill="' + fillC + '" stroke="' + (outlineOn ? "#ffffff" : "none") + '" stroke-width="0.5"/>');
      }

      labels.push({ ci: ci, mid: A.mid });
    });

    // Outside labels. Angles run clockwise from 12 o'clock, so 0-180 is the
    // right half (text grows rightwards) and 180-360 the left half. On each
    // side labels are pushed apart vertically so small neighbouring sectors
    // don't overprint, with a leader line bending to the moved label.
    var lineH = labelSize + 3;
    [true, false].forEach(function (rightSide) {
      var side = labels.filter(function (l) { var n = ((l.mid % 360) + 360) % 360; return (n < 180) === rightSide; });
      side.forEach(function (l) { var p = pt(labelR, l.mid); l.x = p[0]; l.y = p[1]; });
      side.sort(function (a, b) { return a.y - b.y; });
      for (var i = 0; i < side.length; i++) {
        var minY = i ? side[i - 1].y + lineH : lineH / 2;
        if (side[i].y < minY) side[i].y = minY;
      }
      for (var j = side.length - 1; j >= 0; j--) {
        var maxY = j === side.length - 1 ? h - lineH / 2 : side[j + 1].y - lineH;
        if (side[j].y > maxY) side[j].y = maxY;
      }
      side.forEach(function (l) {
        var g0 = pt(idBandOuter + 1, l.mid), g1 = pt(labelR - 2, l.mid);
        var tx = l.x + (rightSide ? 3 : -3);
        svg.push('<polyline points="' + g0[0].toFixed(2) + "," + g0[1].toFixed(2) + " " + g1[0].toFixed(2) + "," + g1[1].toFixed(2) + " " + (tx + (rightSide ? -2 : 2)).toFixed(2) + "," + l.y.toFixed(2) + '" fill="none" stroke="#9a9587" stroke-width="0.7" stroke-dasharray="2,2"/>');
        svg.push('<text x="' + tx.toFixed(2) + '" y="' + l.y.toFixed(2) + '" text-anchor="' + (rightSide ? "start" : "end") + '" dominant-baseline="middle" font-size="' + labelSize + '" fill="#1a1a1a">' + esc(labelTexts[l.ci]) + "</text>");
      });
    });

    if (showLegend) {
      var lx = plotW + 14, lfs = state.legendFontSize || 12;
      var yy = 18;
      svg.push('<text x="' + lx + '" y="' + yy + '" font-size="' + Math.max(lfs, 11) + '" font-weight="700" fill="#1a1a1a">' + esc(state.legendTitle || "Categories") + "</text>");
      yy += 18;
      cats.forEach(function (c, ci) {
        svg.push('<rect x="' + lx + '" y="' + (yy - 9) + '" width="10" height="10" fill="' + catColor[ci] + '"/>');
        svg.push('<text x="' + (lx + 15) + '" y="' + yy + '" font-size="' + Math.max(lfs - 2, 9) + '" fill="#1a1a1a">' + esc(c) + "</text>");
        yy += 16;
      });
      if (nRings > 1) {
        yy += 8;
        svg.push('<text x="' + lx + '" y="' + yy + '" font-size="' + Math.max(lfs - 1, 10) + '" font-weight="700" fill="#1a1a1a">Outer &#8594; inner track</text>');
        yy += 14;
        seriesAll.forEach(function (sn, si) {
          var lbl = state.seriesMeta[sn].label || sn;
          svg.push('<text x="' + lx + '" y="' + yy + '" font-size="' + Math.max(lfs - 3, 8) + '" fill="#3a3a36">' + (si + 1) + ". " + esc(lbl) + "</text>");
          yy += 13;
        });
      }
    }

    svg.push("</svg>");
    el.innerHTML = svg.join("");
    state.chartRenderedW = w;
    state.chartRenderedH = h;
  }

  window.renderRadialRings = renderRadialRings;
})();
