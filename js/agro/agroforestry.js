/* ==========================================================================
   Agroforestry simulator — Gayo coffee under lamtoro shade (third mode of
   the app, next to Data visualization and GIS).

   A plot (1 ha by default) of individual trees, in the spirit of ICRAF's
   SExI-FS (Spatially Explicit Individual-based Forest Simulator):

   Species      SExI-FS style parameters: Chapman-Richards DBH growth
                (dbh_max, c, k), height allometry h = α·dbh^β (dbh in cm,
                capped), crown width = A + B·dbh (cm), crown depth ratio,
                crown porosity, light sensitivity (minimum / optimum light),
                wood density. Presets: Arabica coffee (Gayo), lamtoro
                (Leucaena leucocephala), avocado, orange, petai; editable.
   Planting     row patterns (coffee 2.5 × 2.5 m, lamtoro 5 × 5 m…, with
                an offset), random, or by clicking the 2D plot.
   Data         SExI-FS tree files (tab separated: iid x y spesies dbh
                height cr_depth cr_curve cr_radius rot cp cf, cr_radius as
                "r1;r2;…"), in and out; SExI-FS topography (X Y Altitude);
                the whole project as JSON.
   Simulation   yearly steps: crown position (CP, the light a crown gets,
                from overlapping taller crowns and their porosity), the
                species light response reduces the Chapman-Richards DBH
                increment; height and crown follow the allometries; managed
                pruning heights for coffee and lamtoro; long suppression
                kills. The light map (openness at the coffee layer) is
                computed on a 2 m grid.
   Outputs      trees per ha, mean DBH / height, canopy cover, shade at the
                coffee layer, an indicative green-bean yield (peaks at about
                35 % shade), above-ground biomass and carbon (Chave et al.
                2005 moist-forest model), charts over the years, CSV.
   Views        2D vertical projection with the light map, and 3D (Three.js)
                with sun shadows, time of day, orbit, and year-by-year replay.

   Growth and yield numbers are indicative, for scenarios; calibrate the
   species parameters with field data (DBH increment regression, as in the
   SExI-FS guide) before using them for decisions.
   ========================================================================== */
(function () {
  "use strict";

  var THREE_JS = "https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js";
  var ORBIT_JS = "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js";
  var STORE = "ploots-agro-project";

  function $(id) { return document.getElementById(id); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmt(v, d) { return (+v).toLocaleString("en-US", { maximumFractionDigits: d == null ? 1 : d }); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function toast(m) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(m); }
  function script(url) { return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = url; s.onload = res; s.onerror = function () { rej(new Error("Could not load " + url)); }; document.head.appendChild(s); }); }

  /* ------------------------------------------------------------ species */
  // dbhMax in m; c, k Chapman-Richards; hA, hB with dbh in cm; hMax m;
  // cwA, cwB crown width (m) = A + B·dbh(cm); depth = crown depth / height;
  // por = crown porosity; lmin / lopt light response; rho wood density;
  // prune = managed height (m) and crMax = managed crown radius (m), as when
  // coffee is topped at ~1.8 m and lamtoro is lopped to keep 30-40 % shade.
  var PRESETS = {
    kopi: { label: "kopi", name: "Arabica coffee (Gayo)", color: "#2f6b33", dbhInit: 0.01, dbhMax: 0.12, c: 1.8, k: 0.22, hA: 0.95, hB: 0.72, hMax: 4.5, cwA: 0.45, cwB: 0.28, depth: 0.88, por: 0.25, lmin: 0.08, lopt: 0.55, rho: 0.6, prune: 1.8, crMax: 1.3, crop: true },
    lamtoro: { label: "lamtoro", name: "Lamtoro (Leucaena leucocephala)", color: "#9bc53d", dbhInit: 0.01, dbhMax: 0.35, c: 1.5, k: 0.26, hA: 1.65, hB: 0.72, hMax: 15, cwA: 1.1, cwB: 0.34, depth: 0.45, por: 0.55, lmin: 0.35, lopt: 0.9, rho: 0.64, prune: 7, crMax: 2.2 },
    alpukat: { label: "alpukat", name: "Avocado (Persea americana)", color: "#5b8c2a", dbhInit: 0.01, dbhMax: 0.45, c: 1.6, k: 0.12, hA: 1.2, hB: 0.75, hMax: 18, cwA: 1.0, cwB: 0.3, depth: 0.6, por: 0.3, lmin: 0.3, lopt: 0.85, rho: 0.55, prune: 0 },
    jeruk: { label: "jeruk", name: "Orange (Citrus sp.)", color: "#e0a526", dbhInit: 0.01, dbhMax: 0.2, c: 1.7, k: 0.18, hA: 1.0, hB: 0.72, hMax: 6, cwA: 0.6, cwB: 0.3, depth: 0.75, por: 0.3, lmin: 0.35, lopt: 0.85, rho: 0.62, prune: 0 },
    petai: { label: "petai", name: "Petai (Parkia speciosa)", color: "#2f6360", dbhInit: 0.01, dbhMax: 0.6, c: 1.5, k: 0.1, hA: 1.7, hB: 0.72, hMax: 25, cwA: 1.4, cwB: 0.32, depth: 0.45, por: 0.45, lmin: 0.35, lopt: 0.95, rho: 0.52, prune: 0 }
  };

  /* -------------------------------------------------------------- model */

  var P = null; // project
  function newProject() {
    return { name: "Kopi Gayo – lamtoro", w: 100, h: 100, year: 0, species: JSON.parse(JSON.stringify({ kopi: PRESETS.kopi, lamtoro: PRESETS.lamtoro })), trees: [], nextId: 1, topo: null, history: [], site: "Takengon, Aceh Tengah" };
  }
  function sp(t) { return P.species[t.sp]; }
  function alloc(t) {
    var s = sp(t), d = t.dbh * 100;
    var h = Math.min(s.hMax, s.hA * Math.pow(Math.max(d, 0.1), s.hB));
    if (s.prune > 0) h = Math.min(h, s.prune);
    t.h = Math.max(0.3, h);
    var r = (s.cwA + s.cwB * d) / 2;
    if (s.crMax > 0) r = Math.min(r, s.crMax); // crown pruning (lopping)
    t.r = Math.max(0.2, r);
    t.depth = Math.max(0.2, Math.min(t.h * 0.95, t.h * s.depth));
  }
  function addTree(key, x, y, dbh) {
    var s = P.species[key];
    var t = { id: P.nextId++, sp: key, x: x, y: y, dbh: dbh || s.dbhInit, age: 0, cp: 1, cf: 1, alive: true, rot: 0, stress: 0 };
    alloc(t);
    P.trees.push(t);
    return t;
  }

  function overlap(a, b, d) {
    // Area of intersection of two circles with radii a, b at distance d.
    if (d >= a + b) return 0;
    if (d <= Math.abs(a - b)) return Math.PI * Math.min(a, b) * Math.min(a, b);
    var a2 = a * a, b2 = b * b;
    var x = (d * d + a2 - b2) / (2 * d);
    return a2 * Math.acos(clamp(x / a, -1, 1)) + b2 * Math.acos(clamp((d - x) / b, -1, 1)) - 0.5 * Math.sqrt(Math.max(0, (-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b)));
  }
  // Spatial buckets (10 m) for neighbour search.
  function buckets() {
    var B = {}, S = 10;
    P.trees.forEach(function (t) { if (!t.alive) return; var k = Math.floor(t.x / S) + ":" + Math.floor(t.y / S); (B[k] = B[k] || []).push(t); });
    return { near: function (x, y, rad) { var out = [], n = Math.ceil(rad / S); var cx = Math.floor(x / S), cy = Math.floor(y / S); for (var i = -n; i <= n; i++) for (var j = -n; j <= n; j++) { var b = B[(cx + i) + ":" + (cy + j)]; if (b) out = out.concat(b); } return out; } };
  }
  function crownIndices() {
    var B = buckets();
    P.trees.forEach(function (t) {
      if (!t.alive) return;
      var trans = 1, crowd = 0, A = Math.PI * t.r * t.r, mid = t.h - t.depth / 2;
      B.near(t.x, t.y, t.r + 12).forEach(function (n) {
        if (n === t) return;
        var d = Math.hypot(n.x - t.x, n.y - t.y), ov = overlap(t.r, n.r, d);
        if (!ov) return;
        var f = Math.min(1, ov / A), base = n.h - n.depth;
        if (base >= mid) trans *= 1 - f * (1 - sp(n).por);      // light through each crown above
        else if (n.h > t.h - t.depth) crowd += f * 0.5;          // crowns side by side
      });
      t.cp = clamp(trans, 0.03, 1);
      t.cf = clamp(1 - crowd, 0.2, 1);
    });
  }
  function lightFactor(s, cp) { if (cp <= s.lmin) return 0.05; if (cp >= s.lopt) return 1; return 0.05 + 0.95 * (cp - s.lmin) / (s.lopt - s.lmin); }
  function step() {
    crownIndices();
    P.trees.forEach(function (t) {
      if (!t.alive) return;
      var s = sp(t), red = lightFactor(s, t.cp) * (0.6 + 0.4 * t.cf);
      var pot = s.c * s.k * t.dbh * (Math.pow(s.dbhMax / t.dbh, 1 / s.c) - 1);
      t.dbh = Math.min(s.dbhMax, t.dbh + Math.max(0, pot) * red);
      t.age++;
      t.stress = red < 0.08 ? t.stress + 1 : 0;
      if (t.stress >= 6) t.alive = false;       // six suppressed years
      alloc(t);
    });
    P.year++;
    crownIndices();
    record();
  }

  // Light map: openness at the coffee layer (1.5 m) on a 2 m grid.
  var CELL = 2;
  function lightMap(zRef) {
    zRef = zRef == null ? 1.5 : zRef;
    var nx = Math.ceil(P.w / CELL), ny = Math.ceil(P.h / CELL), L = new Float32Array(nx * ny).fill(1), B = buckets();
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var x = (i + 0.5) * CELL, y = (j + 0.5) * CELL, v = 1;
      B.near(x, y, 12).forEach(function (t) {
        if (t.h - t.depth < zRef) return; // only crowns above this layer shade it
        var d = Math.hypot(t.x - x, t.y - y);
        if (d < t.r) v *= sp(t).por + (1 - sp(t).por) * (d / t.r) * 0.25;
      });
      L[j * nx + i] = v;
    }
    return { nx: nx, ny: ny, v: L };
  }

  function stats() {
    var ha = P.w * P.h / 1e4, by = {}, alive = P.trees.filter(function (t) { return t.alive; });
    Object.keys(P.species).forEach(function (k) { by[k] = { n: 0, dbh: 0, h: 0, agb: 0 }; });
    var crownArea = 0;
    alive.forEach(function (t) {
      var s = sp(t), b = by[t.sp], d = t.dbh * 100;
      b.n++; b.dbh += d; b.h += t.h;
      // Chave et al. (2005) moist forest with height: AGB = 0.0509 ρ D² H (kg).
      b.agb += 0.0509 * s.rho * d * d * t.h;
      crownArea += Math.PI * t.r * t.r;
    });
    Object.keys(by).forEach(function (k) { var b = by[k]; if (b.n) { b.dbh /= b.n; b.h /= b.n; } });
    var lm = lightMap(1.5), mean = 0;
    for (var i = 0; i < lm.v.length; i++) mean += lm.v[i];
    mean /= lm.v.length || 1;
    // Coffee yield (green bean, kg/ha, indicative): mature trees (≥ 3 years,
    // dbh ≥ 2.5 cm) × a light response peaking near 65 % light (35 % shade).
    var yieldKg = 0;
    alive.forEach(function (t) {
      var s = sp(t);
      if (!s.crop || t.age < 3 || t.dbh < 0.025) return;
      var L = t.cp, f = clamp(1 - Math.pow((L - 0.65) / 0.6, 2), 0.05, 1);
      yieldKg += 0.42 * f * Math.min(1, t.dbh / 0.05);
    });
    var agb = Object.keys(by).reduce(function (a, k) { return a + by[k].agb; }, 0);
    return { ha: ha, by: by, trees: alive.length, cover: Math.min(1, crownArea / (P.w * P.h)), light: mean, shade: 1 - mean, yieldHa: yieldKg / ha, agbHa: agb / 1000 / ha, cHa: agb * 0.47 / 1000 / ha };
  }
  function record() {
    var s = stats();
    P.history = P.history.filter(function (h) { return h.year < P.year; });
    P.history.push({ year: P.year, trees: s.trees, cover: s.cover, shade: s.shade, yieldHa: s.yieldHa, cHa: s.cHa, snap: P.trees.map(function (t) { return [t.id, t.alive ? 1 : 0, +t.dbh.toFixed(5)]; }) });
  }
  function restore(year) {
    var h = P.history.filter(function (x) { return x.year === year; })[0];
    if (!h) return;
    var m = {};
    h.snap.forEach(function (s) { m[s[0]] = s; });
    P.trees = P.trees.filter(function (t) { return m[t.id]; });
    P.trees.forEach(function (t) { var s = m[t.id]; t.alive = !!s[1]; t.dbh = s[2]; alloc(t); });
    P.year = year;
    crownIndices();
  }

  /* ------------------------------------------------------------ planting */

  function plantPattern(key, sx, sy, ox, oy, stagger) {
    var n = 0;
    for (var y = oy, row = 0; y < P.h; y += sy, row++) {
      for (var x = ox + (stagger && row % 2 ? sx / 2 : 0); x < P.w; x += sx) {
        // Keep a planting distance from trees already there (0.8 m).
        if (P.trees.some(function (t) { return t.alive && Math.abs(t.x - x) < 0.8 && Math.abs(t.y - y) < 0.8; })) continue;
        addTree(key, +x.toFixed(2), +y.toFixed(2)); n++;
      }
    }
    return n;
  }
  function plantRandom(key, n, seed) {
    var s = seed || 42;
    function rnd() { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }
    for (var i = 0; i < n; i++) addTree(key, +(rnd() * P.w).toFixed(2), +(rnd() * P.h).toFixed(2));
  }

  /* --------------------------------------------------------- SExI-FS I/O */

  function parseSexi(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); }), head = lines[0].trim().toLowerCase().split(/\t|\s{2,}|\s/), out = [];
    var hasHead = head.indexOf("x") >= 0 && (head.indexOf("dbh") >= 0 || head.indexOf("spesies") >= 0 || head.indexOf("species") >= 0);
    var cols = hasHead ? head : ["iid", "x", "y", "spesies", "dbh", "height", "cr_depth", "cr_curve", "cr_radius", "rot", "cp", "cf"];
    lines.slice(hasHead ? 1 : 0).forEach(function (l) {
      var v = l.trim().split(/\t|\s+/), r = {};
      cols.forEach(function (c, i) { r[c] = v[i]; });
      out.push(r);
    });
    return out;
  }
  function importSexi(text) {
    var rows = parseSexi(text), added = 0, newSp = [];
    rows.forEach(function (r) {
      var label = String(r.spesies || r.species || "tree").toLowerCase(), key = matchSpecies(label);
      if (!key) {
        key = label.replace(/[^\w]+/g, "_");
        P.species[key] = Object.assign({}, PRESETS.alpukat, { label: label, name: label, color: "hsl(" + (Object.keys(P.species).length * 67 % 360) + ",45%,42%)", prune: 0 });
        newSp.push(label);
      }
      var t = addTree(key, +r.x, +r.y, Math.max(0.005, +r.dbh || 0.01));
      if (+r.height > 0) t.h = +r.height;
      var radii = String(r.cr_radius || "").split(";").map(Number).filter(function (x) { return x > 0; });
      if (radii.length) { t.r = radii.reduce(function (a, b) { return a + b; }, 0) / radii.length; t.radii = radii; }
      if (+r.cr_depth > 0) t.depth = +r.cr_depth;
      if (+r.cr_curve > 0) t.curve = +r.cr_curve;
      t.rot = +r.rot || 0;
      if (r.cp != null) t.cp = +r.cp;
      if (r.cf != null) t.cf = +r.cf;
      t.imported = true;
      added++;
    });
    var mx = 0, my = 0;
    P.trees.forEach(function (t) { mx = Math.max(mx, t.x + t.r); my = Math.max(my, t.y + t.r); });
    if (mx > P.w || my > P.h) { P.w = Math.ceil(mx / 10) * 10; P.h = Math.ceil(my / 10) * 10; }
    return { added: added, newSpecies: newSp };
  }
  function matchSpecies(label) {
    var l = label.toLowerCase();
    var keys = Object.keys(P.species);
    for (var i = 0; i < keys.length; i++) { var s = P.species[keys[i]]; if (s.label.toLowerCase() === l) return keys[i]; }
    if (/kopi|coffee|coffea/.test(l)) return ensureSp("kopi");
    if (/lamtoro|leucaena|petai.?cina/.test(l)) return ensureSp("lamtoro");
    if (/alpukat|avocado|persea/.test(l)) return ensureSp("alpukat");
    if (/jeruk|citrus|orange/.test(l)) return ensureSp("jeruk");
    if (/petai|parkia/.test(l)) return ensureSp("petai");
    return null;
  }
  function ensureSp(k) { if (!P.species[k]) P.species[k] = JSON.parse(JSON.stringify(PRESETS[k])); return k; }
  function exportSexi() {
    var rows = ["iid\tx\ty\tspesies\tdbh\theight\tcr_depth\tcr_curve\tcr_radius\trot\tcp\tcf"];
    P.trees.filter(function (t) { return t.alive; }).forEach(function (t) {
      rows.push([t.id, t.x, t.y, sp(t).label, t.dbh.toFixed(5), t.h.toFixed(2), t.depth.toFixed(2), (t.curve || t.depth * 0.6).toFixed(2), (t.radii || [t.r]).map(function (r) { return r.toFixed(2); }).join(";"), t.rot || 0, t.cp.toFixed(3), t.cf.toFixed(3)].join("\t"));
    });
    return rows.join("\n") + "\n";
  }
  function importTopo(text) {
    var pts = text.split(/\r?\n/).slice(1).map(function (l) { return l.trim().split(/[\t,; ]+/).map(Number); }).filter(function (v) { return v.length >= 3 && v.every(isFinite); });
    if (!pts.length) throw new Error("No X Y Altitude rows.");
    var xs = Array.from(new Set(pts.map(function (p) { return p[0]; }))).sort(function (a, b) { return a - b; });
    var ys = Array.from(new Set(pts.map(function (p) { return p[1]; }))).sort(function (a, b) { return a - b; });
    var z = {}; pts.forEach(function (p) { z[p[0] + ":" + p[1]] = p[2]; });
    P.topo = { xs: xs, ys: ys, z: z, min: Math.min.apply(null, pts.map(function (p) { return p[2]; })) };
    return pts.length;
  }
  // Bilinear, as in SExI-FS.
  function alt(x, y) {
    var T = P.topo;
    if (!T) return 0;
    function idx(a, v) { var i = 0; while (i < a.length - 2 && a[i + 1] < v) i++; return i; }
    var i = idx(T.xs, x), j = idx(T.ys, y), x1 = T.xs[i], x2 = T.xs[i + 1] != null ? T.xs[i + 1] : x1, y1 = T.ys[j], y2 = T.ys[j + 1] != null ? T.ys[j + 1] : y1;
    function Z(a, b) { var v = T.z[a + ":" + b]; return v == null ? T.min : v; }
    var a = x2 === x1 ? 0 : clamp((x - x1) / (x2 - x1), 0, 1), b = y2 === y1 ? 0 : clamp((y - y1) / (y2 - y1), 0, 1);
    return ((1 - a) * (1 - b) * Z(x1, y1) + a * (1 - b) * Z(x2, y1) + a * b * Z(x2, y2) + (1 - a) * b * Z(x1, y2)) - T.min;
  }

  /* --------------------------------------------------------------- 2D */

  var view = "2d", tool = "select", sel = null, plantKey = "kopi", showLight = true, realistic = true, flowering = false;
  // Camera presets: the whole plot from above a corner, or standing in a
  // coffee row at eye height (1.6 m), looking along the row.
  function camPreset(k) {
    if (!G3) return;
    var c = G3.cam, ctl = G3.ctl;
    if (k === "eye") {
      // In the alley between two coffee rows (plants at 1.25 + 2.5 k).
      var x = Math.min(P.w - 1, 2.5 * Math.round(P.w / 5)), z0 = P.h - 2;
      c.position.set(x, 1.6 + alt(x, 3), z0);
      ctl.target.set(x, 1.4 + alt(x, P.h / 2), z0 - 20);
    } else {
      c.position.set(-P.w * 0.25, Math.max(P.w, P.h) * 0.55, P.h * 1.25);
      ctl.target.set(P.w / 2, 0, P.h / 2);
    }
    ctl.update();
    if (realistic) rebuildPlants();
    G3.dirty = true;
  }
  function draw2d() {
    var cv = $("agCanvas");
    if (!cv) return;
    var box = cv.parentNode.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (box.width < 80 || box.height < 80) return; // hidden or not laid out yet
    cv.width = box.width * dpr; cv.height = box.height * dpr;
    cv.style.width = box.width + "px"; cv.style.height = box.height + "px";
    var g = cv.getContext("2d"), pad = 40, sc = Math.min((box.width - 2 * pad) / P.w, (box.height - 2 * pad) / P.h);
    var ox = (box.width - P.w * sc) / 2, oy = (box.height - P.h * sc) / 2;
    cv._tx = { sc: sc, ox: ox, oy: oy };
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, box.width, box.height);
    g.fillStyle = "#e9e3d3"; g.fillRect(ox, oy, P.w * sc, P.h * sc);
    if (showLight) {
      var lm = lightMap(1.5);
      for (var j = 0; j < lm.ny; j++) for (var i = 0; i < lm.nx; i++) {
        var v = lm.v[j * lm.nx + i];
        g.fillStyle = "rgba(20,40,30," + ((1 - v) * 0.55).toFixed(3) + ")";
        g.fillRect(ox + i * CELL * sc, oy + (P.h - (j + 1) * CELL) * sc, CELL * sc + 0.5, CELL * sc + 0.5);
      }
    }
    // grid every 10 m
    g.strokeStyle = "rgba(0,0,0,.07)"; g.lineWidth = 1;
    for (var x = 0; x <= P.w; x += 10) { g.beginPath(); g.moveTo(ox + x * sc, oy); g.lineTo(ox + x * sc, oy + P.h * sc); g.stroke(); }
    for (var y = 0; y <= P.h; y += 10) { g.beginPath(); g.moveTo(ox, oy + y * sc); g.lineTo(ox + P.w * sc, oy + y * sc); g.stroke(); }
    // lower crowns first
    P.trees.filter(function (t) { return t.alive; }).sort(function (a, b) { return a.h - b.h; }).forEach(function (t) {
      var s = sp(t), px = ox + t.x * sc, py = oy + (P.h - t.y) * sc;
      g.beginPath();
      if (t.radii && t.radii.length > 1) {
        var n = t.radii.length;
        for (var k = 0; k <= 36; k++) { var ang = k / 36 * Math.PI * 2 + (t.rot || 0) * Math.PI / 180, f = (k / 36 * n) % n, i0 = Math.floor(f), i1 = (i0 + 1) % n, rr = t.radii[i0] + (t.radii[i1] - t.radii[i0]) * (f - i0); var qx = px + Math.cos(ang) * rr * sc, qy = py - Math.sin(ang) * rr * sc; if (k) g.lineTo(qx, qy); else g.moveTo(qx, qy); }
      } else g.arc(px, py, t.r * sc, 0, Math.PI * 2);
      g.fillStyle = hexA(s.color, 0.55 - s.por * 0.3); g.fill();
      g.strokeStyle = t === sel ? "#ff5a1f" : hexA(s.color, 0.95); g.lineWidth = t === sel ? 2.2 : 0.8; g.stroke();
      g.fillStyle = "#4a3620"; g.beginPath(); g.arc(px, py, Math.max(1, t.dbh * 100 * sc / 200 + 0.8), 0, Math.PI * 2); g.fill();
    });
    g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 1.2; g.strokeRect(ox, oy, P.w * sc, P.h * sc);
    g.fillStyle = "rgba(0,0,0,.55)"; g.font = "11px Inter, Arial"; g.fillText("0", ox - 10, oy + P.h * sc + 12); g.fillText(P.w + " m", ox + P.w * sc - 20, oy + P.h * sc + 14); g.fillText(P.h + " m", ox - 34, oy + 4);
  }
  function hexA(c, a) {
    if (/^hsl/.test(c)) return c.replace("hsl(", "hsla(").replace(")", "," + a + ")");
    var h = c.replace("#", ""); if (h.length === 3) h = h.split("").map(function (x) { return x + x; }).join("");
    return "rgba(" + parseInt(h.slice(0, 2), 16) + "," + parseInt(h.slice(2, 4), 16) + "," + parseInt(h.slice(4, 6), 16) + "," + a + ")";
  }
  function at2d(e) {
    var cv = $("agCanvas"), r = cv.getBoundingClientRect(), T = cv._tx;
    return { x: (e.clientX - r.left - T.ox) / T.sc, y: P.h - (e.clientY - r.top - T.oy) / T.sc };
  }

  /* --------------------------------------------------------------- 3D */

  var G3 = null;
  function ensure3d() {
    if (window.THREE && THREE.OrbitControls) return Promise.resolve();
    return (window.THREE ? Promise.resolve() : script(THREE_JS)).then(function () { return script(ORBIT_JS); });
  }
  function build3d() {
    var host = $("agView3d"), W = host.clientWidth, H = host.clientHeight;
    if (!G3) {
      var r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      r.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
      r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
      host.appendChild(r.domElement);
      var scene = new THREE.Scene();
      scene.background = new THREE.Color(0xcfe3ee);
      scene.fog = new THREE.Fog(0xcfe3ee, 180, 420);
      var cam = new THREE.PerspectiveCamera(45, W / H, 0.5, 2000);
      var ctl = new THREE.OrbitControls(cam, r.domElement);
      ctl.enableDamping = true; ctl.maxPolarAngle = Math.PI * 0.49;
      var hemi = new THREE.HemisphereLight(0xeaf4ff, 0x6b5a3a, 0.55);
      var sun = new THREE.DirectionalLight(0xfff3dd, 1.0);
      sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
      scene.add(hemi, sun, sun.target);
      G3 = { r: r, scene: scene, cam: cam, ctl: ctl, sun: sun, hemi: hemi, group: null };
      // Render only when something changed (camera moving, scene rebuilt).
      (function loop() {
        if (!G3) return;
        requestAnimationFrame(loop);
        if (view !== "3d") return;
        var moved = G3.ctl.update();
        if (moved || G3.dirty) { G3.r.render(G3.scene, G3.cam); G3.dirty = false; }
      })();
      // After a move, the nearest plants get the detailed models.
      ctl.addEventListener("end", function () { if (realistic && G3.lodAt && G3.cam.position.distanceTo(G3.lodAt) > 6) rebuildPlants(); });
      cam.position.set(-P.w * 0.25, Math.max(P.w, P.h) * 0.55, P.h * 1.25); ctl.target.set(P.w / 2, 0, P.h / 2);
    }
    G3.r.setSize(W, H); G3.cam.aspect = W / H; G3.cam.updateProjectionMatrix(); G3.dirty = true; G3.bySp = null; G3.plants = null;
    if (G3.group) { G3.scene.remove(G3.group); G3.group.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }
    var grp = new THREE.Group(), sc = G3.scene;
    if (realistic && window.PlootsAgroReal) {
      // Realistic plants (js/agro/agro-3d-real.js): instanced procedural
      // coffee bushes, lamtoro trees and broadleaf trees.
      var R3 = window.PlootsAgroReal, bySp = {};
      R3.atmosphere(sc, G3.r);
      G3.hemi.intensity = 0.85;
      grp.add(R3.ground(P.w, P.h, P.topo ? function (x, z) { return alt(x, P.h - z); } : null));
      Object.keys(P.species).forEach(function (k) {
        bySp[k] = P.trees.filter(function (t) { return t.alive && t.sp === k; }).map(function (t) {
          return { id: t.id, x: t.x, z: P.h - t.y, base: alt(t.x, t.y), h: t.h, r: t.r };
        });
      });
      G3.bySp = bySp;
      sc.add(grp); G3.group = grp;
      rebuildPlants();
      setSun(+($("agSun") ? $("agSun").value : 9));
      return;
    }
    sc.background = new THREE.Color(0xcfe3ee); sc.fog = new THREE.Fog(0xcfe3ee, 180, 420); G3.hemi.intensity = 0.55;
    // Ground (with topography when loaded).
    var seg = P.topo ? 50 : 1, gg = new THREE.PlaneGeometry(P.w, P.h, seg, seg);
    gg.rotateX(-Math.PI / 2); gg.translate(P.w / 2, 0, P.h / 2);
    if (P.topo) { var pos = gg.attributes.position; for (var i = 0; i < pos.count; i++) pos.setY(i, alt(pos.getX(i), P.h - pos.getZ(i))); gg.computeVertexNormals(); }
    var ground = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ color: 0x7d6a45 }));
    ground.receiveShadow = true; grp.add(ground);
    // Trees: one instanced trunk and crown mesh per species.
    Object.keys(P.species).forEach(function (k) {
      var s = P.species[k], list = P.trees.filter(function (t) { return t.alive && t.sp === k; });
      if (!list.length) return;
      var trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.7, 1, 6), new THREE.MeshLambertMaterial({ color: 0x5b4330 }), list.length);
      var coffee = s.crop;
      // Coffee: a dense rounded bush; shade trees: a flat, airy umbrella.
      var cg = new THREE.SphereGeometry(1, coffee ? 10 : 14, coffee ? 8 : 6);
      var crown = new THREE.InstancedMesh(cg, new THREE.MeshLambertMaterial({ color: new THREE.Color(s.color), transparent: s.por > 0.4, opacity: s.por > 0.4 ? 1 - s.por * 0.45 : 1 }), list.length);
      trunk.castShadow = crown.castShadow = true; crown.receiveShadow = true;
      var m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(s.color);
      list.forEach(function (t, i) {
        var z0 = alt(t.x, t.y), X = t.x, Z = P.h - t.y, d = Math.max(0.03, t.dbh), base = t.h - t.depth;
        var th = coffee ? Math.max(0.2, base + 0.3) : Math.max(0.5, t.h - sy);
        m.compose(new THREE.Vector3(X, z0 + th / 2, Z), q, new THREE.Vector3(Math.max(d, coffee ? 0.04 : 0.12), th, Math.max(d, coffee ? 0.04 : 0.12)));
        trunk.setMatrixAt(i, m);
        var sy = coffee ? t.depth / 2 : Math.max(0.5, t.depth * 0.32);
        var cy = coffee ? z0 + base + t.depth / 2 : z0 + t.h - sy;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (t.rot || 0) * Math.PI / 180);
        m.compose(new THREE.Vector3(X, cy, Z), q, new THREE.Vector3(t.r, sy, t.r));
        crown.setMatrixAt(i, m);
        crown.setColorAt(i, c.clone().offsetHSL(0, 0, (Math.sin(t.id * 12.9898) * 0.5) * 0.08));
        q.identity();
      });
      grp.add(trunk, crown);
    });
    sc.add(grp); G3.group = grp;
    setSun(+($("agSun") ? $("agSun").value : 9));
  }
  function rebuildPlants() {
    if (!G3 || !G3.bySp) return;
    if (G3.plants) { G3.group.remove(G3.plants); G3.plants.traverse(function (o) { if (o.isInstancedMesh) o.dispose(); }); }
    var c = G3.cam.position, t = G3.ctl.target;
    // Detail around what the camera looks at when high up, around the camera at eye level.
    var at = c.y > 12 ? { x: t.x, z: t.z } : { x: c.x, z: c.z };
    G3.plants = window.PlootsAgroReal.plants(P.species, G3.bySp, { flowering: flowering, cam: at });
    G3.group.add(G3.plants);
    G3.lodAt = c.clone();
    G3.dirty = true;
  }
  // Sun for Takengon (4.6° N) at the given hour, simple solar geometry.
  function setSun(hour) {
    if (!G3) return;
    var lat = 4.6 * Math.PI / 180, decl = 0, H = (hour - 12) * 15 * Math.PI / 180;
    var el = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H));
    var az = Math.atan2(-Math.sin(H), Math.tan(decl) * Math.cos(lat) - Math.sin(lat) * Math.cos(H));
    var R = 160, cx = P.w / 2, cz = P.h / 2;
    G3.sun.position.set(cx + R * Math.cos(el) * Math.sin(az), Math.max(8, R * Math.sin(el)), cz - R * Math.cos(el) * Math.cos(az));
    G3.sun.target.position.set(cx, 0, cz);
    var S = Math.max(P.w, P.h) * 0.75, cam = G3.sun.shadow.camera;
    cam.left = -S; cam.right = S; cam.top = S; cam.bottom = -S; cam.near = 1; cam.far = 500; cam.updateProjectionMatrix();
    G3.sun.intensity = el > 0 ? 0.4 + 0.8 * Math.sin(el) : 0.1;
    G3.dirty = true;
  }

  /* --------------------------------------------------------------- UI */

  var root = null;
  function redraw() { if (view === "2d") draw2d(); else if (G3) build3d(); drawStats(); }
  function drawStats() {
    var s = stats(), el = $("agStats");
    if (!el) return;
    var sp_ = Object.keys(s.by).map(function (k) { var b = s.by[k], S = P.species[k]; return b.n ? '<div class="ag-sp"><i style="background:' + S.color + '"></i><b>' + esc(S.name) + "</b><span>" + fmt(b.n / s.ha, 0) + " /ha · DBH " + fmt(b.dbh, 1) + " cm · " + fmt(b.h, 1) + " m</span></div>" : ""; }).join("");
    el.innerHTML =
      '<div class="ag-kpis">' +
        kpi("Year", P.year) + kpi("Trees / ha", fmt(s.trees / s.ha, 0)) + kpi("Canopy cover", fmt(s.cover * 100, 0) + "%") +
        kpi("Shade at coffee", fmt(s.shade * 100, 0) + "%") + kpi("Coffee (green bean)", fmt(s.yieldHa, 0) + " kg/ha") + kpi("Carbon (AGB)", fmt(s.cHa, 1) + " tC/ha") +
      "</div>" + sp_ + chart();
    $("agYear").textContent = "Year " + P.year;
  }
  function kpi(l, v) { return '<div class="ag-kpi"><span>' + l + "</span><b>" + v + "</b></div>"; }
  function chart() {
    var H = P.history;
    if (H.length < 2) return '<p class="ag-note">Run the simulation to see the trends.</p>';
    function line(key, color, max) {
      var mx = max || Math.max.apply(null, H.map(function (h) { return h[key]; })) || 1;
      return '<polyline fill="none" stroke="' + color + '" stroke-width="1.6" points="' + H.map(function (h, i) { return (i / (H.length - 1) * 100).toFixed(1) + "," + (40 - h[key] / mx * 38).toFixed(1); }).join(" ") + '"/>';
    }
    return '<div class="ag-chart"><svg viewBox="0 0 100 42" preserveAspectRatio="none">' + line("yieldHa", "#8a5a2b") + line("shade", "#2f6360", 1) + line("cHa", "#3f9d4a") + "</svg>" +
      '<div class="ag-legend"><span style="--c:#8a5a2b">Coffee yield</span><span style="--c:#2f6360">Shade</span><span style="--c:#3f9d4a">Carbon</span></div>' +
      '<div class="gfw-axis"><span>Year ' + H[0].year + "</span><span>Year " + H[H.length - 1].year + "</span></div></div>";
  }
  function speciesForm() {
    var keys = Object.keys(P.species);
    $("agSpecies").innerHTML = keys.map(function (k) {
      var s = P.species[k];
      function n(f, label, step) { return '<label><span>' + label + '</span><input type="number" step="' + (step || "any") + '" data-sp="' + k + '" data-f="' + f + '" value="' + s[f] + '"></label>'; }
      return '<details class="ag-spec"><summary><i style="background:' + s.color + '"></i>' + esc(s.name) + '<em>' + esc(s.label) + "</em></summary><div class=\"ag-grid\">" +
        n("dbhMax", "DBH max (m)") + n("c", "Chapman c") + n("k", "Chapman k") + n("hA", "Height α") + n("hB", "Height β") + n("hMax", "Height max (m)") +
        n("cwA", "Crown A") + n("cwB", "Crown B") + n("depth", "Crown depth / h") + n("por", "Porosity") + n("lmin", "Light min") + n("lopt", "Light optimum") + n("rho", "Wood density") + n("prune", "Prune at (m, 0 = no)") + n("crMax", "Crown radius max (m)") +
        '<label><span>Colour</span><input type="color" data-sp="' + k + '" data-f="color" value="' + (/^#/.test(s.color) ? s.color : "#777777") + '"></label></div></details>';
    }).join("");
    $("agPlantSp").innerHTML = $("agPatSp").innerHTML = $("agPatSp2").innerHTML = keys.map(function (k) { return '<option value="' + k + '">' + esc(P.species[k].name) + "</option>"; }).join("");
    $("agPatSp2").value = keys.indexOf("lamtoro") >= 0 ? "lamtoro" : keys[1] || keys[0];
    $("agPlantSp").value = plantKey in P.species ? plantKey : keys[0];
  }
  function download(name, text, type) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
    a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(Object.assign({}, P, { history: P.history.slice(-60) }))); } catch (e) { } }

  function build() {
    if (root) return;
    root = document.createElement("div");
    root.className = "agro-app";
    root.innerHTML =
      '<header class="ag-head">' + sym("forest") + '<div class="ag-title"><b>Agroforestry simulator</b><span>Gayo coffee · shade trees · SExI-FS data</span></div>' +
        '<div class="ag-seg ag-views"><button data-view="2d" class="active">' + sym("grid_view") + '<span>2D plot</span></button><button data-view="3d">' + sym("view_in_ar") + "<span>3D</span></button></div>" +
        '<span class="ag-year" id="agYear">Year 0</span>' +
        '<button class="ag-close" title="Back to Home">' + sym("close") + "</button></header>" +
      '<aside class="ag-left">' +
        '<section><h4>' + sym("crop_free") + 'Plot</h4><div class="num-pair"><div><label class="field-label">Width (m)</label><input type="number" id="agW" min="10" max="400"></div><div><label class="field-label">Length (m)</label><input type="number" id="agH" min="10" max="400"></div></div></section>' +
        '<section><h4>' + sym("grass") + 'Planting</h4>' +
          '<label class="field-label">Main crop</label><select id="agPatSp"></select>' +
          '<div class="num-pair"><div><label class="field-label">Spacing x (m)</label><input type="number" id="agSx" value="2.5" step="0.1"></div><div><label class="field-label">Spacing y (m)</label><input type="number" id="agSy" value="2.5" step="0.1"></div></div>' +
          '<label class="field-label">Shade tree</label><select id="agPatSp2"></select>' +
          '<div class="num-pair"><div><label class="field-label">Spacing x (m)</label><input type="number" id="agSx2" value="5" step="0.5"></div><div><label class="field-label">Spacing y (m)</label><input type="number" id="agSy2" value="5" step="0.5"></div></div>' +
          '<label class="check-row"><input type="checkbox" id="agStagger" checked>Shade trees staggered (quincunx)</label>' +
          '<div class="anim-row"><button id="agPlant" class="btn-primary">' + sym("park") + 'Plant pattern</button><button id="agClear">' + sym("delete_sweep") + "Clear</button></div>" +
          '<div class="num-pair"><div><label class="field-label">Click to plant</label><select id="agPlantSp"></select></div><div><label class="field-label">&nbsp;</label><button id="agTool">' + sym("ads_click") + "Plant by clicking</button></div></div>" +
        "</section>" +
        '<section><h4>' + sym("content_cut") + 'Management and simulation</h4>' +
          '<div class="num-pair"><div><label class="field-label">Prune coffee at (m)</label><input type="number" id="agPruneC" step="0.1"></div><div><label class="field-label">Prune shade at (m)</label><input type="number" id="agPruneS" step="0.5"></div></div>' +
          '<div class="num-pair"><div><label class="field-label">Years</label><input type="number" id="agYears" value="10" min="1" max="100"></div><div><label class="field-label">&nbsp;</label><button id="agRun" class="btn-primary">' + sym("play_arrow") + "Run</button></div></div>" +
          '<label class="field-label">Replay</label><input type="range" id="agReplay" min="0" max="0" value="0">' +
          '<div class="anim-row"><button id="agStep">' + sym("skip_next") + 'One year</button><button id="agReset">' + sym("restart_alt") + "Back to year 0</button></div>" +
        "</section>" +
        '<section><h4>' + sym("swap_vert") + 'Data (SExI-FS)</h4>' +
          '<div class="anim-row"><button id="agImp">' + sym("upload_file") + 'Import trees</button><button id="agExp">' + sym("download") + "Export trees</button></div>" +
          '<div class="anim-row"><button id="agTopo">' + sym("landscape") + 'Topography</button><button id="agCsv">' + sym("table") + "History CSV</button></div>" +
          '<div class="anim-row"><button id="agSaveP">' + sym("save") + 'Save project</button><button id="agOpenP">' + sym("folder_open") + "Open project</button></div>" +
          '<input type="file" id="agFile" hidden accept=".txt,.tsv,.csv,.dat"><input type="file" id="agTopoFile" hidden accept=".txt,.tsv,.csv,.dat"><input type="file" id="agProjFile" hidden accept=".json">' +
          '<p class="ag-note">Tree files: <code>iid x y spesies dbh height cr_depth cr_curve cr_radius rot cp cf</code> (tab separated, DBH in m, crown radii "r1;r2"). Topography: <code>X Y Altitude</code>.</p>' +
        "</section>" +
        '<section><h4>' + sym("eco") + "Species</h4><div id=\"agSpecies\"></div>" +
          '<select id="agAddSp"><option value="">Add a species…</option>' + Object.keys(PRESETS).map(function (k) { return '<option value="' + k + '">' + esc(PRESETS[k].name) + "</option>"; }).join("") + "</select></section>" +
      "</aside>" +
      '<main class="ag-main"><div class="ag-view" id="agView2d"><canvas id="agCanvas"></canvas></div><div class="ag-view" id="agView3d" hidden></div>' +
        '<div class="ag-float" id="agFloat2d"><label class="check-row"><input type="checkbox" id="agLight" checked>Light map (coffee layer)</label></div>' +
        '<div class="ag-float" id="agFloat3d" hidden><span>' + sym("wb_sunny") + '</span><input type="range" id="agSun" min="6" max="18" step="0.25" value="9"><b id="agSunLbl">09:00</b>' +
          '<span class="ag-fsep"></span><label class="check-row"><input type="checkbox" id="agReal" checked>Realistic</label><label class="check-row"><input type="checkbox" id="agFlower">Flowering</label>' +
          '<span class="ag-fsep"></span><button type="button" data-cam="over" title="Whole plot">' + sym("zoom_out_map") + '</button><button type="button" data-cam="eye" title="Eye level, in a coffee row">' + sym("directions_walk") + "</button></div>" +
        '<div class="ag-info" id="agInfo" hidden></div></main>' +
      '<aside class="ag-right"><h4>' + sym("monitoring") + 'Plot summary</h4><div id="agStats"></div>' +
        '<p class="ag-note">Growth follows SExI-FS style species parameters; yield and carbon are indicative. Calibrate with your field data.</p></aside>';
    document.body.appendChild(root);

    var saved = null; try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { }
    P = saved && saved.trees ? saved : newProject();
    if (!saved) { plantPattern("kopi", 2.5, 2.5, 1.25, 1.25, false); plantPattern("lamtoro", 5, 5, 2.5, 2.5, true); crownIndices(); record(); }
    syncInputs();

    root.querySelector(".ag-close").addEventListener("click", close);
    root.querySelector(".ag-views").addEventListener("click", function (e) { var b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); });
    $("agW").addEventListener("change", function () { P.w = clamp(+this.value || 100, 10, 400); redraw(); save(); });
    $("agH").addEventListener("change", function () { P.h = clamp(+this.value || 100, 10, 400); redraw(); save(); });
    $("agPlant").addEventListener("click", function () {
      var a = plantPattern($("agPatSp").value, +$("agSx").value || 2.5, +$("agSy").value || 2.5, (+$("agSx").value || 2.5) / 2, (+$("agSy").value || 2.5) / 2, false);
      var sx2 = +$("agSx2").value, sy2 = +$("agSy2").value, b = sx2 > 0 && sy2 > 0 ? plantPattern($("agPatSp2").value, sx2, sy2, sx2 / 2, sy2 / 2, $("agStagger").checked) : 0;
      crownIndices(); record(); redraw(); save(); toast(a + " + " + b + " trees planted");
    });
    $("agClear").addEventListener("click", function () { if (!window.confirm("Remove every tree from the plot?")) return; P.trees = []; P.year = 0; P.history = []; record(); redraw(); save(); });
    $("agTool").addEventListener("click", function () { tool = tool === "plant" ? "select" : "plant"; this.classList.toggle("active", tool === "plant"); $("agCanvas").style.cursor = tool === "plant" ? "crosshair" : ""; });
    $("agPlantSp").addEventListener("change", function () { plantKey = this.value; });
    $("agPruneC").addEventListener("change", function () { var k = cropKey(); if (k) { P.species[k].prune = +this.value || 0; P.trees.forEach(alloc); redraw(); save(); } });
    $("agPruneS").addEventListener("change", function () { var k = $("agPatSp2").value; if (P.species[k]) { P.species[k].prune = +this.value || 0; P.trees.forEach(alloc); redraw(); save(); } });
    $("agRun").addEventListener("click", function () {
      var n = clamp(+$("agYears").value || 10, 1, 100), i = 0, btn = this;
      btn.disabled = true;
      (function next() {
        if (i++ >= n) { btn.disabled = false; syncReplay(); save(); return; }
        step(); redraw();
        setTimeout(next, view === "3d" ? 120 : 60);
      })();
    });
    $("agStep").addEventListener("click", function () { step(); redraw(); syncReplay(); save(); });
    $("agReset").addEventListener("click", function () { restore(0); redraw(); syncReplay(); });
    $("agReplay").addEventListener("input", function () { restore(+this.value); redraw(); });
    $("agLight").addEventListener("change", function () { showLight = this.checked; draw2d(); });
    $("agReal").addEventListener("change", function () { realistic = this.checked; if (G3) build3d(); });
    $("agFlower").addEventListener("change", function () { flowering = this.checked; if (G3) build3d(); });
    $("agFloat3d").addEventListener("click", function (e) { var b = e.target.closest("[data-cam]"); if (b) camPreset(b.dataset.cam); });
    $("agSun").addEventListener("input", function () { var h = +this.value; $("agSunLbl").textContent = String(Math.floor(h)).padStart(2, "0") + ":" + String(Math.round((h % 1) * 60)).padStart(2, "0"); setSun(h); });
    $("agImp").addEventListener("click", function () { $("agFile").click(); });
    $("agFile").addEventListener("change", function () {
      var f = this.files[0]; this.value = "";
      if (!f) return;
      f.text().then(function (t) {
        var replace = P.trees.length && window.confirm("Replace the trees on the plot with the imported ones? (Cancel adds them.)");
        if (replace) { P.trees = []; P.history = []; P.year = 0; }
        var r = importSexi(t);
        crownIndices(); record(); syncInputs(); redraw(); save();
        toast(r.added + " trees imported" + (r.newSpecies.length ? " · new species: " + r.newSpecies.join(", ") : ""));
      });
    });
    $("agExp").addEventListener("click", function () { download((P.name || "plot").replace(/[^\w]+/g, "_") + "_year" + P.year + ".txt", exportSexi()); });
    $("agTopo").addEventListener("click", function () { $("agTopoFile").click(); });
    $("agTopoFile").addEventListener("change", function () { var f = this.files[0]; this.value = ""; if (f) f.text().then(function (t) { try { toast(importTopo(t) + " altitude points"); redraw(); save(); } catch (e) { toast(e.message); } }); });
    $("agCsv").addEventListener("click", function () {
      var rows = ["year,trees,canopy_cover,shade_coffee,coffee_kg_ha,carbon_tC_ha"].concat(P.history.map(function (h) { return [h.year, h.trees, h.cover.toFixed(3), h.shade.toFixed(3), h.yieldHa.toFixed(1), h.cHa.toFixed(2)].join(","); }));
      download("agroforestry_history.csv", rows.join("\n"), "text/csv");
    });
    $("agSaveP").addEventListener("click", function () { download((P.name || "agroforestry").replace(/[^\w]+/g, "_") + ".json", JSON.stringify(P), "application/json"); });
    $("agOpenP").addEventListener("click", function () { $("agProjFile").click(); });
    $("agProjFile").addEventListener("change", function () { var f = this.files[0]; this.value = ""; if (f) f.text().then(function (t) { try { P = JSON.parse(t); syncInputs(); redraw(); save(); } catch (e) { toast("Not a project file."); } }); });
    $("agAddSp").addEventListener("change", function () { if (this.value) { ensureSp(this.value); syncInputs(); save(); } this.value = ""; });
    $("agSpecies").addEventListener("change", function (e) {
      var el = e.target.closest("[data-sp]");
      if (!el) return;
      var s = P.species[el.dataset.sp];
      s[el.dataset.f] = el.type === "color" ? el.value : +el.value;
      P.trees.forEach(alloc); crownIndices(); redraw(); save();
      if (el.dataset.f === "color") speciesForm();
    });
    var cv = $("agCanvas");
    cv.addEventListener("click", function (e) {
      var p = at2d(e);
      if (p.x < 0 || p.y < 0 || p.x > P.w || p.y > P.h) return;
      if (tool === "plant") { addTree(plantKey, +p.x.toFixed(2), +p.y.toFixed(2)); crownIndices(); record(); draw2d(); drawStats(); save(); return; }
      sel = null;
      P.trees.forEach(function (t) { if (t.alive && Math.hypot(t.x - p.x, t.y - p.y) < Math.max(0.6, t.r) && (!sel || t.h > sel.h)) sel = t; });
      info(); draw2d();
    });
    document.addEventListener("keydown", function (e) {
      if (!root.classList.contains("show") || !sel || e.target.closest("input,select,textarea")) return;
      if (e.key === "Delete" || e.key === "Backspace") { sel.alive = false; sel = null; info(); crownIndices(); redraw(); save(); }
    });
    window.addEventListener("resize", function () { if (root.classList.contains("show")) redraw(); });
  }
  function cropKey() { return Object.keys(P.species).filter(function (k) { return P.species[k].crop; })[0]; }
  function info() {
    var el = $("agInfo");
    if (!sel) { el.hidden = true; return; }
    var s = sp(sel);
    el.hidden = false;
    el.innerHTML = "<b>" + esc(s.name) + " #" + sel.id + "</b>" + "<span>x " + fmt(sel.x, 1) + " · y " + fmt(sel.y, 1) + " m</span><span>DBH " + fmt(sel.dbh * 100, 1) + " cm · height " + fmt(sel.h, 1) + " m</span>" +
      "<span>Crown radius " + fmt(sel.r, 2) + " m · depth " + fmt(sel.depth, 1) + " m</span><span>Light (CP) " + fmt(sel.cp, 2) + " · crown form " + fmt(sel.cf, 2) + " · age " + sel.age + "</span><em>Delete removes this tree</em>";
  }
  function syncInputs() {
    $("agW").value = P.w; $("agH").value = P.h;
    speciesForm();
    var ck = cropKey(); $("agPruneC").value = ck ? P.species[ck].prune : "";
    var sk = $("agPatSp2").value; $("agPruneS").value = P.species[sk] ? P.species[sk].prune : "";
    syncReplay();
    redraw();
  }
  function syncReplay() { var r = $("agReplay"), ys = P.history.map(function (h) { return h.year; }); r.min = Math.min.apply(null, ys.concat([0])); r.max = Math.max.apply(null, ys.concat([0])); r.value = P.year; }
  function setView(v) {
    view = v;
    Array.prototype.forEach.call(root.querySelectorAll(".ag-views [data-view]"), function (b) { b.classList.toggle("active", b.dataset.view === v); });
    $("agView2d").hidden = v !== "2d"; $("agView3d").hidden = v !== "3d";
    $("agFloat2d").hidden = v !== "2d"; $("agFloat3d").hidden = v !== "3d";
    if (v === "3d") ensure3d().then(build3d).catch(function (e) { toast(e.message); setView("2d"); });
    else draw2d();
  }
  function open() {
    build();
    root.classList.add("show");
    document.body.classList.add("agro-open");
    requestAnimationFrame(redraw);
  }
  function close() {
    root.classList.remove("show");
    document.body.classList.remove("agro-open");
    if (window.PlootsHome) window.PlootsHome.show();
  }

  // Milliseconds per 3D frame (render + GPU finish), for tuning.
  function bench(n) {
    if (!G3) return null;
    var gl = G3.r.getContext(), t0 = performance.now();
    var px = new Uint8Array(4);
    for (var i = 0; i < (n || 10); i++) { G3.r.render(G3.scene, G3.cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return (performance.now() - t0) / (n || 10);
  }
  window.PlootsAgro = { bench: bench, open: open, close: close, importSexi: function (t) { var r = importSexi(t); crownIndices(); record(); redraw(); return r; }, exportSexi: function () { return exportSexi(); }, step: function () { step(); redraw(); }, stats: function () { return stats(); }, project: function () { return P; }, setView: function (v) { setView(v); }, camPreset: function (k) { camPreset(k); }, goYear: function (y) { restore(y); redraw(); }, renderer: function () { return G3 && G3.r; }, view3d: function () { return G3; } };
})();
