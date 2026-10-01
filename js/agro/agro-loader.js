/* ==========================================================================
   Agroforestry loader: the simulator (js/agro/agroforestry.js, its realistic
   3D models and css/agro.css) is only fetched the first time it is opened,
   so the app starts lighter. Until then PlootsAgro is this small stand-in;
   the real module replaces it when it loads.
   ========================================================================== */
(function () {
  "use strict";
  var loading = null;
  function css(href) { return new Promise(function (res) { var l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; l.onload = l.onerror = res; document.head.appendChild(l); }); }
  function js(src) { return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(new Error("Could not load " + src)); }; document.head.appendChild(s); }); }
  function load() {
    return loading || (loading = Promise.all([css("css/agro.css"), js("js/agro/agro-3d-real.js")]).then(function () { return js("js/agro/agroforestry.js"); }));
  }
  var stub = { open: function () { return load().then(function () { if (window.PlootsAgro !== stub) window.PlootsAgro.open(); }); }, load: load };
  window.PlootsAgro = stub;
})();
