/* ==========================================================================
   Landing — the opening page of GIS Consultant Studio.

   1. A welcome from Defani (round portrait) says what the studio is for.
   2. The hero plays real recordings of the app as a background slideshow:
      Hansen tree cover change on the 3D globe (with a year-by-year story),
      forest areas in KLHK colours with iNaturalist elephant sightings, the
      Gayo highlands in 3D terrain with coffee land suitability and survey
      popups, enumerator routes, and the agroforestry simulator in 3D.
      Glass cards over each slide carry the real numbers and attributes.
   3. Scrolling on: why Gayo coffee agroforestry matters (with citations),
      what the studio does, and the services it connects to (real logos).
   Sign-in sits at the top right. js/intro.js builds this page for the
   launch and lock screens and wires the sign-in form inside it.

   GCSLanding.logo(size)  the logo mark as inline SVG (also assets/logo.svg)
   GCSLanding.build(opts) {form, button, owner, privacy, version} -> element
   ========================================================================== */
(function () {
  "use strict";

  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmt(v, d) { return (+v).toLocaleString("en-US", { maximumFractionDigits: d == null ? 0 : d }); }

  // Round flat mark: a map pin (GIS) holding a coffee bean over a contour
  // map sheet, with a dashed data layer beneath.
  var MARK = '<circle cx="32" cy="32" r="31" fill="#4e8a2e"/><path d="M11 45.5 32 56l21-10.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 3"/><path d="M11 40 32 29.5 53 40 32 50.5z" fill="#5f9c3c" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/><ellipse cx="32" cy="40.5" rx="11" ry="5" fill="none" stroke="#fff" stroke-width="1.5"/><ellipse cx="32" cy="40.5" rx="5.5" ry="2.4" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M32 40c-6.6-6.4-10-11.3-10-16.2a10 10 0 0 1 20 0c0 4.9-3.4 9.8-10 16.2z" fill="#fff"/><ellipse cx="32" cy="23.6" rx="4" ry="5.6" transform="rotate(28 32 23.6)" fill="#4e8a2e"/><path d="M30.4 19.2c2.2 2-0.9 5.2 1.6 9" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>';
  function logo(size) {
    return '<svg class="gcs-logo" viewBox="0 0 64 64" width="' + (size || 32) + '" height="' + (size || 32) + '" aria-hidden="true">' + MARK + "</svg>";
  }

  var BASE = "assets/landing/";
  var SI = "https://cdn.simpleicons.org/"; // brand logos in their own colours

  /* ------------------------------------------------------------ slides */
  var SLIDES = [
    { k: "hansen", video: "hansen.webm", data: "hansen.json", tag: "Forest change · 3D globe",
      title: "Tree cover change in Aceh, 2001–2024", sub: "Hansen/UMD tree cover, loss and gain (GFW) with MapBiomas Alerta" },
    { k: "forest", video: "forest.webm", data: "forest.json", tag: "Forest status · biodiversity",
      title: "Forest areas and Sumatran elephant sightings", sub: "Kawasan hutan in KLHK colours · iNaturalist observations" },
    { k: "gayo", video: "gayo.webm", data: "gayo.json", tag: "3D terrain · Gayo highlands",
      title: "Coffee land suitability on the Gayo highlands", sub: "Suitability classes, surveyed farms and enumerator routes in 3D" },
    { k: "survey", video: "survey.webm", data: "survey.json", tag: "Field data · KoboToolbox",
      title: "Enumerator routes, day by day", sub: "151 farm interviews in Bener Meriah, in the order they were collected" },
    { k: "agro", video: "agro.webm", tag: "Agroforestry simulator · 3D",
      title: "Gayo coffee under lamtoro shade", sub: "Grow the plot and walk through it; SExI-FS data in and out" }
  ];

  // The glass cards drawn over each slide, from the data saved with its recording.
  function cardsFor(s, d) {
    if (s.k === "hansen" && d) {
      return '<div class="lp-legend lp-glass"><b>Legend</b>' +
        '<i style="background:#7fae4a"></i>Tree cover 2000<br><i style="background:#e8469a"></i>Tree cover loss<br><i style="background:#4a8fe0"></i>Tree cover gain<br><i style="background:#e03b2b"></i>MapBiomas Alerta</div>' +
        '<div class="lp-year lp-glass"><span>Year</span><b data-year>2001</b><em data-loss></em><div class="lp-spark" data-spark></div><small>Tree cover loss in Aceh–Leuser (&gt;30% canopy), estimated from Hansen/UMD tiles</small></div>';
    }
    if (s.k === "forest" && d) {
      var o = (d.visible && d.visible[0]) || d.inat[0];
      return '<div class="lp-legend lp-glass"><b>Kawasan hutan (KLHK)</b>' + d.legend.map(function (l) { return '<i style="background:' + l[1] + '"></i>' + esc(l[0]); }).join("<br>") + '<br><i class="dot" style="background:#74ac00"></i>iNaturalist · Elephas maximus</div>' +
        (o ? '<a class="lp-pop lp-glass lp-inat" data-at="5.5" style="left:' + (o.x * 100).toFixed(1) + "%;top:" + (o.y * 100).toFixed(1) + '%" href="' + esc(o.url) + '" target="_blank" rel="noopener">' +
          '<img src="' + esc(o.photo) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()"><div><b>' + esc(o.common) + "</b><em>" + esc(o.taxon) + "</em><span>" + esc(o.date) + " · " + esc(o.place) + "</span><small>" + esc(o.attribution) + " · iNaturalist</small></div></a>" : "");
    }
    if (s.k === "gayo" && d) {
      return '<div class="lp-legend lp-glass"><b>Coffee land suitability</b><i style="background:#4caf50"></i>S2 · moderately suitable<br><i style="background:#f2c94c"></i>S3 · marginally suitable<br><i style="background:#e0533d"></i>N · not suitable<br><i class="dot" style="background:#4fc3f7"></i>Surveyed farms · routes</div>' +
        d.popups.map(function (p, i) {
          var rows = Object.keys(p.props).filter(function (k) { return k !== "waktu" && p.props[k] != null && p.props[k] !== ""; }).slice(0, 7);
          return '<div class="lp-pop lp-glass lp-attr lp-late' + i + '" style="left:' + (p.x * 100).toFixed(1) + "%;top:" + (p.y * 100).toFixed(1) + '%"><b>' + esc(p.title) + "</b><table>" +
            rows.map(function (k) { return "<tr><th>" + esc(k.replace(/_/g, " ")) + "</th><td>" + esc(p.props[k]) + "</td></tr>"; }).join("") + "</table></div>";
        }).join("");
    }
    if (s.k === "survey" && d) {
      var max = Math.max.apply(null, d.enumerators.map(function (e) { return e.interviews; }));
      return '<div class="lp-legend lp-glass lp-enum"><b>' + d.n + " interviews · " + fmt(d.luas_total_ha, 1) + " ha</b>" +
        d.enumerators.map(function (e) { return '<div class="lp-bar"><span><i style="background:' + e.color + '"></i>' + esc(e.name) + '</span><em><u style="width:' + (e.interviews / max * 100).toFixed(0) + "%;background:" + e.color + '"></u></em><small>' + e.interviews + " · " + fmt(e.km, 1) + " km · " + e.days + " d</small></div>"; }).join("") +
        "<p>Land before coffee: " + Object.keys(d.vegetasi_sebelum).map(function (k) { return esc(k) + " " + d.vegetasi_sebelum[k]; }).join(" · ") + "</p><p class=\"mt\">Names of enumerators and farmers are withheld.</p></div>";
    }
    return "";
  }

  /* ----------------------------------------------------------- content */
  var STORY = [
    ["173 Mg ha⁻¹", "soil organic carbon under Gayo coffee agroforestry", "Pramulya et al., 2026"],
    ["1,753 trees ha⁻¹", "with 11 overstory species; lamtoro makes up about 88% of them", "Pramulya et al., 2026"],
    ["95%", "of soil carbon variation explained by the vegetation, with species richness the strongest factor", "Pramulya et al., 2026"],
    [">99%", "of Indonesia’s coffee land is smallholder, and expansion into forest adds to Aceh’s deforestation", "BPS 2024; Margono et al. 2012, in Pramulya et al., 2026"]
  ];
  var FEATURES = [
    ["Deforestation-free checks", "Tree cover loss and gain, alerts and the 2020 cut-off for every plot, with the numbers per year: the evidence EUDR due diligence asks for.", "hansen.webm"],
    ["Forest status and biodiversity", "Forest areas by function, protected areas and species records from iNaturalist and GBIF on one map.", "forest.webm"],
    ["Field data and enumerators", "Sign in to KoboToolbox, pull the submissions, follow each enumerator’s route and check coverage day by day.", "survey.webm"],
    ["3D terrain and suitability", "Land suitability, slopes and farms on real elevation, with a popup for every farm and class.", "gayo.webm"],
    ["Agroforestry simulator", "Gayo coffee under lamtoro and other shade trees: grow the plot, read shade, yield and carbon, walk through it in 3D.", "agro.webm"],
    ["AI assistant and MCP", "Ask in plain language: the assistant reads your layers and runs the tools, and any MCP client can drive the studio.", null]
  ];
  var LOGOS = [
    ["KoboToolbox", "https://kf.kobotoolbox.org/static/favicon.png", 0], ["Supabase", SI + "supabase", 1], ["PostGIS", SI + "postgresql", 1],
    ["Google Earth Engine", SI + "googleearthengine", 1], ["Global Forest Watch", "https://www.globalforestwatch.org/favicon.ico", 0],
    ["MapBiomas", "https://mapbiomas.org/favicon.ico", 0], ["iNaturalist", "https://www.inaturalist.org/favicon.ico", 0],
    ["GBIF", "https://techdocs.gbif.org/favicon.ico", 0], ["QGIS", SI + "qgis", 1], ["DuckDB", SI + "duckdb", 1],
    ["GeoParquet", SI + "apacheparquet", 1], ["MapLibre", SI + "maplibre", 1], ["OpenStreetMap", SI + "openstreetmap", 1],
    ["Claude · MCP", SI + "claude", 1]
  ];
  var REFS = [
    "Pramulya, R., Asy’Ari, R., Pudjawati, N.H., et al. (2026). Quantifying tree species effects on soil organic carbon using machine learning algorithm: a case study in tropical agroforestry system of Gayo coffee, Indonesia. <i>Trees, Forests and People</i> 23, 101098. <a href=\"https://doi.org/10.1016/j.tfp.2025.101098\" target=\"_blank\" rel=\"noopener\">doi:10.1016/j.tfp.2025.101098</a> (CC BY 4.0).",
    "Hansen, M.C., et al. (2013). High-resolution global maps of 21st-century forest cover change. <i>Science</i> 342, 850–853. Tiles via Global Forest Watch.",
    "MapBiomas Indonesia, MapBiomas Alerta. Kawasan hutan: KLHK. iNaturalist photos under the licences credited on each card."
  ];

  function build(opts) {
    var el = document.createElement("div");
    el.className = "intro intro-landing";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "GIS Consultant Studio");
    el.innerHTML =
      '<header class="lp-top">' +
        '<div class="lp-brand">' + logo(32) + '<div><b>GIS Consultant Studio</b><span>Gayo landscape · built by Defani Arman</span></div></div>' +
        '<nav class="lp-nav"><a href="#lp-story">Story</a><a href="#lp-features">Features</a><a href="#lp-integrations">Integrations</a></nav>' +
        '<div class="lp-login">' +
          '<button type="button" class="lp-login-btn">' + sym("account_circle") + "<span>" + opts.button + "</span>" + sym("expand_more") + "</button>" +
          '<div class="lp-login-pop lp-glass">' + logo(40) + opts.form + '<p class="intro-privacy">' + sym("lock") + opts.privacy + "</p></div>" +
        "</div>" +
      "</header>" +
      '<section class="lp-hero">' +
        '<div class="lp-reel">' + SLIDES.map(function (s, i) { return '<div class="lp-slide" data-i="' + i + '"><video muted playsinline preload="' + (i ? "none" : "auto") + '" src="' + BASE + s.video + '"></video><div class="lp-cards"></div></div>'; }).join("") + "</div>" +
        '<div class="lp-shade"></div>' +
        '<div class="lp-hero-in">' +
          '<p class="lp-kicker">EUDR · Rainforest Alliance · Sustainable forest management · Sustainable farming</p>' +
          "<h1>Deforestation-free Gayo coffee,<br><em>mapped from farm to forest.</em></h1>" +
          '<p class="lp-lede">One studio for the field surveys, forest checks, maps, charts and agroforestry models behind sustainable, deforestation-free coffee from the Gayo landscape. Your files stay on your device.</p>' +
          '<div class="lp-cta"><button type="button" class="btn-primary lp-start">' + opts.button + '</button><a class="lp-ghost" href="#lp-story">Why it matters</a></div>' +
        "</div>" +
        '<div class="lp-now lp-glass"><span class="lp-now-tag"></span><b></b><small></small></div>' +
        '<div class="lp-dots">' + SLIDES.map(function (s, i) { return '<button type="button" data-go="' + i + '" title="' + esc(s.title) + '"><i></i></button>'; }).join("") + "</div>" +
      "</section>" +
      '<section class="lp-sec" id="lp-story"><div class="lp-sec-in">' +
        '<p class="lp-eyebrow">The story</p><h2>Why Gayo coffee agroforestry matters</h2>' +
        '<p class="lp-sec-lede">Gayo Arabica from the Aceh highlands is grown by smallholders under shade trees. Kept as agroforestry, these farms hold soil carbon and biodiversity and leave the forest standing; opened into the forest, they add to Aceh’s deforestation. Knowing which is which, farm by farm, is what buyers, certification and the EU Deforestation Regulation now ask for.</p>' +
        '<div class="lp-stats">' + STORY.map(function (s) { return '<div class="lp-stat lp-glass"><b>' + s[0] + "</b><p>" + s[1] + "</p><cite>" + esc(s[2]) + "</cite></div>"; }).join("") + "</div>" +
      "</div></section>" +
      '<section class="lp-sec" id="lp-features"><div class="lp-sec-in">' +
        '<p class="lp-eyebrow">What it does</p><h2>From the field to the report</h2>' +
        '<div class="lp-feats">' + FEATURES.map(function (f) {
          return '<article class="lp-feat lp-glass">' + (f[2] ? '<video muted playsinline loop preload="none" data-src="' + BASE + f[2] + '"></video>' :
            '<div class="lp-ai"><p class="q">Which surveyed farms were opened after 2020, and how much forest did they replace?</p><p class="a">Reading <u>Survei kebun kopi</u> and <u>Tree cover loss 2021–2024</u>… I added the farms that overlap loss after the cut-off as a layer, with the area in a table.</p><span>Claude · MCP</span></div>') +
            "<h3>" + f[0] + "</h3><p>" + f[1] + "</p></article>";
        }).join("") + "</div>" +
      "</div></section>" +
      '<section class="lp-sec" id="lp-integrations"><div class="lp-sec-in">' +
        '<p class="lp-eyebrow">Integrations</p><h2>Connects to the data you already use</h2>' +
        '<div class="lp-logos">' + LOGOS.map(function (l) { return '<div class="lp-logo lp-glass"><img src="' + l[1] + '" alt="" referrerpolicy="no-referrer" loading="lazy"' + ' onerror="this.remove()"><span>' + esc(l[0]) + "</span></div>"; }).join("") + "</div>" +
      "</div></section>" +
      '<footer class="lp-foot"><div class="lp-sec-in">' +
        '<div class="lp-foot-brand">' + logo(28) + "<div><b>GIS Consultant Studio</b><span>Built by " + opts.owner + " · " + opts.version + "</span></div></div>" +
        '<ol class="lp-refs">' + REFS.map(function (r) { return "<li>" + r + "</li>"; }).join("") + "</ol>" +
      "</div></footer>" +
      // Welcome from Defani, shown first.
      '<div class="lp-hello"><div class="lp-hello-card lp-glass">' +
        '<img class="lp-avatar" src="' + BASE + 'defani.jpg" alt="Defani Arman Alfitriansyah">' +
        "<h2>Hello, welcome to<br>GIS Consultant Studio</h2>" +
        "<p>I’m Defani. I built this studio to support my work on the Gayo coffee landscape: collecting field data, checking forests and deforestation, modelling agroforestry and delivering the maps and charts, all in one place.</p>" +
        '<button type="button" class="btn-primary lp-hello-go">Show me</button>' +
      "</div></div>";
    document.body.appendChild(el);

    /* slideshow */
    var slides = el.querySelectorAll(".lp-slide"), dots = el.querySelectorAll(".lp-dots button"), cur = -1, timer = null, data = {};
    var now = el.querySelector(".lp-now");
    function load(s) {
      if (!s.data || data[s.k]) return Promise.resolve(data[s.k]);
      return fetch(BASE + s.data).then(function (r) { return r.json(); }).then(function (j) { data[s.k] = j; return j; }).catch(function () { return null; });
    }
    function show(i) {
      i = (i + SLIDES.length) % SLIDES.length;
      var s = SLIDES[i], node = slides[i], v = node.querySelector("video");
      cur = i;
      clearTimeout(timer);
      Array.prototype.forEach.call(slides, function (n, j) { n.classList.toggle("on", j === i); if (j !== i) n.querySelector("video").pause(); });
      Array.prototype.forEach.call(dots, function (n, j) { n.classList.toggle("on", j === i); });
      now.querySelector(".lp-now-tag").textContent = s.tag;
      now.querySelector("b").textContent = s.title;
      now.querySelector("small").textContent = s.sub;
      now.classList.remove("in"); void now.offsetWidth; now.classList.add("in");
      node.classList.remove("ended");
      load(s).then(function (d) {
        var box = node.querySelector(".lp-cards");
        if (!box.dataset.done) { box.innerHTML = cardsFor(s, d); box.dataset.done = "1"; }
      });
      v.preload = "auto";
      try { v.currentTime = 0; } catch (e) { }
      var p = v.play(); if (p && p.catch) p.catch(function () { });
      // Each recording ends on a held view: keep it with its cards for a moment.
      v.onended = function () { node.classList.add("ended"); clearTimeout(timer); timer = setTimeout(function () { show(cur + 1); }, 4500); };
      timer = setTimeout(function () { if (cur === i) show(cur + 1); }, 24000);
      var nx = slides[(i + 1) % slides.length].querySelector("video"); nx.preload = "auto";
    }
    // Time-driven cards: the Hansen year story and popups that wait for their moment.
    (function tick() {
      if (!document.body.contains(el)) return;
      requestAnimationFrame(tick);
      if (cur < 0) return;
      var s = SLIDES[cur], node = slides[cur], v = node.querySelector("video"), t = v.currentTime, d = data[s.k];
      Array.prototype.forEach.call(node.querySelectorAll("[data-at]"), function (c) { c.classList.toggle("in", t >= +c.dataset.at || node.classList.contains("ended")); });
      if (s.k !== "hansen" || !d) return;
      var yb = node.querySelector("[data-year]");
      if (!yb) return;
      var k = Math.max(0, Math.min(d.rows.length - 1, Math.floor((t - d.yearStart) / d.yearStep)));
      node.querySelector(".lp-year").classList.toggle("in", t >= d.yearStart - 0.3 || node.classList.contains("ended"));
      if (yb.dataset.k === String(k)) return;
      yb.dataset.k = k;
      var row = d.rows[k], mx = Math.max.apply(null, d.rows.map(function (r) { return r[1]; }));
      yb.textContent = row[0];
      node.querySelector("[data-loss]").textContent = fmt(row[1]) + " ha lost" + (row[0] >= (d.alertsFrom || 9999) ? " · alerts on" : "");
      node.querySelector("[data-spark]").innerHTML = d.rows.map(function (r, j) { return '<i style="height:' + (r[1] / mx * 100).toFixed(0) + "%" + (j <= k ? "" : ";opacity:.18") + '"></i>'; }).join("");
    })();
    el.addEventListener("click", function (e) {
      var g = e.target.closest(".lp-dots [data-go]");
      if (g) show(+g.dataset.go);
      var a = e.target.closest('a[href^="#lp-"]');
      if (a) { e.preventDefault(); var t = el.querySelector(a.getAttribute("href")); if (t) t.scrollIntoView({ behavior: "smooth" }); }
    });
    // Feature videos play while in view.
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (x) { var v = x.target; if (x.isIntersecting) { if (!v.getAttribute("src")) v.src = v.dataset.src; var p = v.play(); if (p && p.catch) p.catch(function () { }); } else v.pause(); });
      }, { root: el, threshold: 0.3 });
      Array.prototype.forEach.call(el.querySelectorAll(".lp-feat video"), function (v) { io.observe(v); });
    }
    el.addEventListener("scroll", function () { el.classList.toggle("scrolled", el.scrollTop > 40); });

    /* welcome first, then the slideshow */
    var hello = el.querySelector(".lp-hello");
    function go() { if (hello.classList.contains("out")) return; hello.classList.add("out"); setTimeout(function () { hello.remove(); }, 500); if (cur < 0) show(0); }
    el.querySelector(".lp-hello-go").addEventListener("click", go);
    hello.addEventListener("click", function (e) { if (e.target === hello) go(); });
    setTimeout(go, 7000);
    load(SLIDES[0]);

    /* sign-in menu, top right */
    var login = el.querySelector(".lp-login");
    function openLogin(on) {
      if (on) go();
      login.classList.toggle("open", on);
      if (on) setTimeout(function () { var f = login.querySelector(".intro-form input"); if (f) f.focus(); }, 60);
    }
    el.querySelector(".lp-login-btn").addEventListener("click", function () { openLogin(!login.classList.contains("open")); });
    el.querySelector(".lp-start").addEventListener("click", function () { el.scrollTop = 0; openLogin(true); });
    el.addEventListener("mousedown", function (e) { if (login.classList.contains("open") && !login.contains(e.target) && !e.target.closest(".lp-start,.intro-dlg")) openLogin(false); });
    el._openLogin = openLogin;
    return el;
  }

  window.GCSLanding = { logo: logo, build: build };
})();
