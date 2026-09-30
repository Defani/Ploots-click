/* ==========================================================================
   Fonts installed on this computer, in every font list (body font, text
   format bar, LaTeX), grouped as "On this computer".

   1. Without asking: a list of common Windows / Office / Google fonts is
      checked by measuring text (a font that is not installed falls back
      and measures like the fallback), so only installed ones are listed.
   2. "Add all system fonts…" at the end of each list uses the Local Font
      Access API (queryLocalFonts), which lists every installed family
      after the browser asks for permission. The families are remembered
      on this computer, so the permission is needed once.
   ========================================================================== */
(function () {
  "use strict";

  var KEY = "ploots-local-fonts";
  var COMMON = ["Segoe UI", "Segoe UI Semibold", "Segoe UI Light", "Segoe Print", "Segoe Script", "Calibri", "Calibri Light", "Cambria", "Candara", "Consolas", "Constantia", "Corbel",
    "Georgia", "Verdana", "Tahoma", "Trebuchet MS", "Garamond", "Book Antiqua", "Palatino Linotype", "Century Gothic", "Century Schoolbook", "Franklin Gothic Medium", "Gill Sans MT",
    "Lucida Sans", "Lucida Console", "Lucida Bright", "Bahnschrift", "Courier New", "Comic Sans MS", "Impact", "Arial Narrow", "Arial Black", "Rockwell", "Tw Cen MT", "Gadugi",
    "Leelawadee UI", "Nirmala UI", "Sitka Text", "Sylfaen", "Microsoft Sans Serif", "Aptos", "Aptos Display", "Grandview", "Seaford", "Tenorite", "Skeena",
    "Roboto", "Roboto Condensed", "Open Sans", "Lato", "Montserrat", "Source Sans Pro", "Source Sans 3", "Noto Sans", "Noto Serif", "Inter", "Nunito", "Raleway", "Merriweather",
    "PT Sans", "PT Serif", "Ubuntu", "Fira Sans", "Work Sans", "IBM Plex Sans", "IBM Plex Serif", "JetBrains Mono", "EB Garamond", "Libre Baskerville", "Playfair Display"];

  function fallbackOf(name) { return /mono|console|courier|consolas/i.test(name) ? "monospace" : /serif|georgia|garamond|cambria|constantia|antiqua|palatino|schoolbook|merriweather|baskerville|playfair|rockwell|sitka|lucida bright/i.test(name) && !/sans/i.test(name) ? "serif" : "sans-serif"; }
  // Installed = measures differently from all three generic fallbacks.
  var cv = document.createElement("canvas").getContext("2d"), SAMPLE = "mmmmmmmmmmlli WQ@#0123456789 ÅÉ";
  var base = {};
  ["monospace", "serif", "sans-serif"].forEach(function (g) { cv.font = "72px " + g; base[g] = cv.measureText(SAMPLE).width; });
  function installed(name) {
    return ["monospace", "serif", "sans-serif"].some(function (g) { cv.font = "72px '" + name + "', " + g; return cv.measureText(SAMPLE).width !== base[g]; });
  }
  function known() { return (window.FONTS || []).map(function (f) { return String(f.label).toLowerCase(); }); }
  function stored() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }

  var extra = [];
  function add(names) {
    var have = known().concat(extra.map(function (f) { return f.label.toLowerCase(); }));
    names.forEach(function (n) {
      if (!n || have.indexOf(n.toLowerCase()) >= 0) return;
      have.push(n.toLowerCase());
      extra.push({ label: n, value: "'" + n.replace(/'/g, "") + "', " + fallbackOf(n), local: true });
    });
    extra.sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  // Rebuild each font <select>: the built-in fonts, then "On this computer".
  var SELECTS = ["fontBodySelect", "fmtFont", "latexFontSelect"];
  function refresh() {
    SELECTS.forEach(function (id) {
      var s = document.getElementById(id);
      if (!s || !window.FONTS) return;
      var cur = s.value;
      Array.prototype.slice.call(s.querySelectorAll("optgroup[data-local], option[data-more]")).forEach(function (o) { o.remove(); });
      if (extra.length) {
        var g = document.createElement("optgroup");
        g.label = "On this computer (" + extra.length + ")";
        g.dataset.local = "1";
        extra.forEach(function (f) { var o = document.createElement("option"); o.value = f.value; o.textContent = f.label; o.style.fontFamily = f.value; g.appendChild(o); });
        s.appendChild(g);
      }
      if ("queryLocalFonts" in window) {
        var m = document.createElement("option");
        m.value = "__more_fonts__"; m.dataset.more = "1"; m.textContent = "Add all system fonts…";
        s.appendChild(m);
      }
      if (cur) s.value = cur;
      if (!s._lfWired) {
        s._lfWired = true;
        s.addEventListener("change", function (e) {
          if (s.value !== "__more_fonts__") return;
          e.stopImmediatePropagation();
          s.value = cur || (window.FONTS[0] && window.FONTS[0].value);
          queryAll();
        }, true);
      }
    });
  }
  function queryAll() {
    if (!("queryLocalFonts" in window)) return;
    window.queryLocalFonts().then(function (list) {
      var fams = Array.from(new Set(list.map(function (f) { return f.family; })));
      try { localStorage.setItem(KEY, JSON.stringify(fams)); } catch (e) { }
      add(fams);
      refresh();
      if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(fams.length + " system font families added");
    }).catch(function (e) {
      if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast("System fonts: " + (e.message || "permission refused"));
    });
  }

  function boot() {
    add(COMMON.filter(installed));
    add(stored());
    refresh();
    // The format bar fills its list late; fill again when it appears.
    setTimeout(refresh, 1500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 200); }); else setTimeout(boot, 200);

  window.PlootsFonts = { refresh: refresh, queryAll: queryAll, list: function () { return extra.slice(); } };
})();
