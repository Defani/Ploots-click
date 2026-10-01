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
    nangka: { label: "nangka", name: "Jackfruit (Artocarpus heterophyllus)", color: "#3f7a2c", dbhInit: 0.01, dbhMax: 0.6, c: 1.6, k: 0.1, hA: 1.4, hB: 0.72, hMax: 18, cwA: 1.2, cwB: 0.3, depth: 0.65, por: 0.25, lmin: 0.3, lopt: 0.85, rho: 0.6, prune: 0 },
    pinus: { label: "pinus", name: "Pine (Pinus merkusii)", color: "#2e5a3c", dbhInit: 0.02, dbhMax: 0.8, c: 1.5, k: 0.08, hA: 2.2, hB: 0.68, hMax: 35, cwA: 1.0, cwB: 0.17, depth: 0.55, por: 0.5, lmin: 0.4, lopt: 0.95, rho: 0.55, prune: 0 },
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
  function example40() {
    P.w = 22.5; P.h = 10;
    for (var i = 0; i < 9; i++) for (var j = 0; j < 4; j++) addTree("kopi", 1.25 + i * 2.5, 1.25 + j * 2.5);
    [3.75, 8.75, 13.75, 18.75].forEach(function (x, k) { addTree("lamtoro", x, k % 2 ? 7.5 : 2.5); });
    return 40;
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

  var view = "2d", tool = "select", sel = null, plantKey = "kopi", showLight = false, realistic = true, flowering = false, look3d = "real";
  // Camera presets: the whole plot from above a corner, or standing in a
  // coffee row at eye height (1.6 m), looking along the row.
  function camPreset(k) {
    if (!G3) return;
    var c = G3.cam, ctl = G3.ctl;
    if (k === "top") {
      c.position.set(P.w / 2, Math.max(P.w, P.h) * 1.15, P.h / 2 + Math.max(P.w, P.h) * 0.02);
      ctl.target.set(P.w / 2, 0, P.h / 2);
    } else if (k === "eye") {
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
  // 2D view as SExI-FS draws it: white sheet, fine pink metre grid, crowns as
  // wire meshes (outline, spokes and rings from the crown radii) in one of
  // four paint modes, stems as dots, and optional tree labels.
  var paint = "transparent", showInfo = false;
  function crownPts(t, sc, px, py, f) {
    var n = t.radii && t.radii.length > 1 ? t.radii.length : 0, pts = [], K = 48;
    for (var k = 0; k < K; k++) {
      var ang = k / K * Math.PI * 2 + (t.rot || 0) * Math.PI / 180, rr = t.r;
      if (n) { var q = (k / K * n) % n, i0 = Math.floor(q), i1 = (i0 + 1) % n; rr = t.radii[i0] + (t.radii[i1] - t.radii[i0]) * (q - i0); }
      pts.push([px + Math.cos(ang) * rr * sc * f, py - Math.sin(ang) * rr * sc * f]);
    }
    return pts;
  }
  function poly(g, pts) { g.beginPath(); pts.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath(); }
  function draw2d() {
    var cv = $("agCanvas");
    if (!cv) return;
    var box = cv.parentNode.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (box.width < 80 || box.height < 80) return; // hidden or not laid out yet
    cv.width = box.width * dpr; cv.height = box.height * dpr;
    cv.style.width = box.width + "px"; cv.style.height = box.height + "px";
    var g = cv.getContext("2d"), pad = 46, sc = Math.min((box.width - 2 * pad) / P.w, (box.height - 2 * pad) / P.h);
    var ox = (box.width - P.w * sc) / 2, oy = (box.height - P.h * sc) / 2;
    cv._tx = { sc: sc, ox: ox, oy: oy };
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, box.width, box.height);
    if (showLight) {
      var lm = lightMap(1.5);
      for (var j = 0; j < lm.ny; j++) for (var i = 0; i < lm.nx; i++) {
        var v = lm.v[j * lm.nx + i];
        g.fillStyle = "rgba(60,60,60," + ((1 - v) * 0.4).toFixed(3) + ")";
        g.fillRect(ox + i * CELL * sc, oy + (P.h - (j + 1) * CELL) * sc, CELL * sc + 0.5, CELL * sc + 0.5);
      }
    }
    // pink grid: every metre (when it reads), stronger every 10 m
    var minor = sc >= 4 ? 1 : sc >= 1.2 ? 5 : 10;
    g.lineWidth = 1;
    for (var x = 0; x <= P.w + 1e-6; x += minor) { g.strokeStyle = x % 10 === 0 ? "rgba(214,72,110,.55)" : "rgba(232,140,165,.32)"; g.beginPath(); g.moveTo(ox + x * sc + .5, oy); g.lineTo(ox + x * sc + .5, oy + P.h * sc); g.stroke(); }
    for (var y = 0; y <= P.h + 1e-6; y += minor) { g.strokeStyle = y % 10 === 0 ? "rgba(214,72,110,.55)" : "rgba(232,140,165,.32)"; g.beginPath(); g.moveTo(ox, oy + y * sc + .5); g.lineTo(ox + P.w * sc, oy + y * sc + .5); g.stroke(); }
    // lower crowns first, so the canopy lies on top
    var alive = P.trees.filter(function (t) { return t.alive; }).sort(function (a, b) { return a.h - b.h; });
    alive.forEach(function (t) {
      var s = sp(t), px = ox + t.x * sc, py = oy + (P.h - t.y) * sc, outer = crownPts(t, sc, px, py, 1);
      if (paint !== "outline") {
        poly(g, outer);
        if (paint === "opaque") g.fillStyle = hexA(s.color, 1);
        else if (paint === "transparent") g.fillStyle = hexA(s.color, 0.28);
        else { var rg = g.createRadialGradient(px - t.r * sc * .35, py - t.r * sc * .35, t.r * sc * .1, px, py, t.r * sc * 1.05); rg.addColorStop(0, shade(s.color, 0.45)); rg.addColorStop(1, shade(s.color, -0.35)); g.fillStyle = rg; }
        g.fill();
      }
      // the crown edge
      var wire = paint === "opaque" ? shade(s.color, -0.45) : paint === "shaded" ? "rgba(0,0,0,.35)" : shade(s.color, -0.15);
      g.strokeStyle = t === sel ? "#ff3d00" : wire; g.lineWidth = t === sel ? 2 : 0.8;
      poly(g, outer); g.stroke();
      g.fillStyle = "#3b2a1a"; g.beginPath(); g.arc(px, py, Math.max(1.2, t.dbh * sc / 2 + 0.8), 0, Math.PI * 2); g.fill();
    });
    if (showInfo || sel) {
      // Tallest trees first; a label that would overlap one already drawn is skipped.
      g.font = "10px Inter, Arial"; g.textBaseline = "middle";
      var placed = [];
      alive.slice().sort(function (a, b) { return (b === sel) - (a === sel) || b.h - a.h; }).forEach(function (t) {
        if (!(t === sel || showInfo)) return;
        var px = ox + t.x * sc, py = oy + (P.h - t.y) * sc, label = sp(t).label + " " + t.id + " · " + fmt(t.h, 1) + " m";
        var w = g.measureText(label).width + 8, r = [px + 4, py - 7, w, 14];
        if (t !== sel && placed.some(function (q) { return r[0] < q[0] + q[2] && q[0] < r[0] + r[2] && r[1] < q[1] + q[3] && q[1] < r[1] + r[3]; })) return;
        placed.push(r);
        g.fillStyle = "rgba(255,255,255,.9)"; g.fillRect(r[0], r[1], r[2], r[3]);
        g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 0.5; g.strokeRect(r[0], r[1], r[2], r[3]);
        g.fillStyle = "#222"; g.fillText(label, px + 8, py);
      });
    }
    g.strokeStyle = "#333"; g.lineWidth = 1.2; g.strokeRect(ox, oy, P.w * sc, P.h * sc);
    // axis labels every 10 m
    g.fillStyle = "#555"; g.font = "10px Inter, Arial"; g.textBaseline = "top"; g.textAlign = "center";
    var step = P.w > 150 ? 50 : P.w > 60 ? 20 : 10;
    for (var ax = 0; ax <= P.w; ax += step) g.fillText(ax + "", ox + ax * sc, oy + P.h * sc + 6);
    g.textAlign = "right"; g.textBaseline = "middle";
    for (var ay = 0; ay <= P.h; ay += step) g.fillText(ay + "", ox - 6, oy + (P.h - ay) * sc);
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillText(P.w + " × " + P.h + " m · " + alive.length + " trees · year " + P.year, ox, oy - 10);
  }
  function shade(c, f) {
    var h = String(c).replace("#", ""); if (h.length === 3) h = h.split("").map(function (x) { return x + x; }).join("");
    var r = parseInt(h.slice(0, 2), 16), gg = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    function m(v) { return Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)); }
    return "rgb(" + m(r) + "," + m(gg) + "," + m(b) + ")";
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
    if (look3d === "sexi") { sexi3d(grp, sc); sc.add(grp); G3.group = grp; setSun(+($("agSun") ? $("agSun").value : 9)); return; }
    if (realistic && window.PlootsAgroReal) {
      // Realistic plants (js/agro/agro-3d-real.js): instanced procedural
      // coffee bushes, lamtoro trees and broadleaf trees.
      var R3 = window.PlootsAgroReal, bySp = {};
      R3.atmosphere(sc, G3.r);
      G3.hemi.intensity = 0.85;
      // Rows for the soil-and-grass floor: the y positions of the coffee rows.
      var rowY = Array.from(new Set(P.trees.filter(function (t) { return t.alive && sp(t).crop; }).map(function (t) { return Math.round(t.y * 2) / 2; })));
      grp.add(R3.ground(P.w, P.h, P.topo ? function (x, z) { return alt(x, P.h - z); } : null, P.floor || "grass", rowY));
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
  // "Virtual forest" as SExI-FS shows it: a white world, the plot as a floating
  // slab of soil with thickness, crowns as lumpy textured volumes in varied
  // greens (shaped by radius, depth and the crown radii), thin dark stems.
  var SX = null;
  function sexiParts() {
    if (SX) return SX;
    function tex(w, h, draw) { var c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); var tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; return tx; }
    function rnd(i) { var x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); }
    var leaf = tex(256, 256, function (g, w, h) {
      g.fillStyle = "#5f8f3a"; g.fillRect(0, 0, w, h);
      var greens = ["#2f5a1f", "#3f7424", "#5a8f34", "#79a845", "#9cc25a", "#47702a", "#6d9a3c"];
      for (var i = 0; i < 2600; i++) { g.fillStyle = greens[i % greens.length]; g.globalAlpha = 0.55 + rnd(i) * 0.45; g.beginPath(); g.ellipse(rnd(i + 1) * w, rnd(i + 2) * h, 2 + rnd(i + 3) * 5, 1.2 + rnd(i + 4) * 3, rnd(i + 5) * Math.PI, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;
    });
    var soil = tex(256, 256, function (g, w, h) {
      g.fillStyle = "#8a6a43"; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 4000; i++) { g.fillStyle = ["#7a5a36", "#9a7a50", "#6d5030", "#a3865a", "#7f8a4a"][i % 5]; g.globalAlpha = 0.5; g.fillRect(rnd(i) * w, rnd(i + 9) * h, 2, 2); }
      g.globalAlpha = 1;
    });
    var strata = tex(64, 256, function (g, w, h) {
      var bands = ["#6b4a2b", "#7c5833", "#5c3f25", "#8a6740", "#4f3520", "#6e4d2d"];
      var y = 0, i = 0; while (y < h) { var bh = 18 + rnd(i) * 40; g.fillStyle = bands[i % bands.length]; g.fillRect(0, y, w, bh); y += bh; i++; }
      for (var k = 0; k < 600; k++) { g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(rnd(k) * w, rnd(k + 3) * h, 1.5, 1.5); }
    });
    // A lumpy crown: an icosphere pushed out and in by smooth noise.
    function lumpy(seed) {
      var geo = new THREE.IcosahedronGeometry(1, 3), pos = geo.attributes.position, v = new THREE.Vector3();
      for (var i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        var n = 0.10 * Math.sin(v.x * 5.1 + seed) * Math.cos(v.y * 4.3 + seed * 1.3) + 0.07 * Math.sin(v.z * 7.7 + v.x * 3.1 + seed * 2.1) + 0.04 * Math.sin(v.y * 11 + seed);
        v.multiplyScalar(1 + n); pos.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      return geo;
    }
    var stem = new THREE.CylinderGeometry(0.55, 1, 1, 6); stem.translate(0, 0.5, 0);
    function lumpyLL(seed) {
      var geo = new THREE.SphereGeometry(1, 20, 14), pos = geo.attributes.position, v = new THREE.Vector3();
      for (var i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        var n = 0.13 * Math.sin(v.x * 3.1 + seed) * Math.cos(v.z * 2.7 + seed * 1.7) + 0.08 * Math.sin(v.y * 4.3 + v.x * 2 + seed * 2.3);
        v.multiplyScalar(1 + n); pos.setXYZ(i, v.x, v.y, v.z);
      }
      return geo;
    }
    SX = { leaf: leaf, soil: soil, strata: strata, crowns: [lumpy(1.7), lumpy(4.2), lumpy(7.9)], wires: [lumpyLL(1.1), lumpyLL(3.6), lumpyLL(6.2), lumpyLL(9.4)], stem: stem,
      crownMat: new THREE.MeshLambertMaterial({ map: leaf }), stemMat: new THREE.MeshLambertMaterial({ color: 0x3a2d22 }) };
    return SX;
  }
  // SExI-FS 3D view: white world, a fine maroon grid on the plot, crowns as
  // irregular wire-mesh volumes (no texture) in bright per-species colours
  // with a faint fill, stems as thin dark lines. Seen from above by default.
  var SEXI_COLORS = ["#c63fc3", "#a9cf2e", "#4f86e0", "#2fbcc6", "#e0567d", "#8a58d6", "#e0a326"];
  function sexi3d(grp, sc) {
    var S = sexiParts();
    sc.background = new THREE.Color(0xffffff); sc.fog = null;
    G3.hemi.color.set(0xffffff); G3.hemi.groundColor.set(0xffffff); G3.hemi.intensity = 1;
    // Grid: every metre (every 2 or 5 m on big plots), following the topography.
    var step = Math.max(P.w, P.h) > 150 ? 5 : Math.max(P.w, P.h) > 60 ? 2 : 1, pts = [], N = 4;
    function seg(x0, y0, x1, y1) {
      for (var k = 0; k < N; k++) {
        var ta = k / N, tb = (k + 1) / N, xa = x0 + (x1 - x0) * ta, ya = y0 + (y1 - y0) * ta, xb = x0 + (x1 - x0) * tb, yb = y0 + (y1 - y0) * tb;
        pts.push(xa, alt(xa, ya) + 0.02, P.h - ya, xb, alt(xb, yb) + 0.02, P.h - yb);
      }
    }
    for (var x = 0; x <= P.w + 1e-6; x += step) seg(x, 0, x, P.h);
    for (var y = 0; y <= P.h + 1e-6; y += step) seg(0, y, P.w, y);
    var gg = new THREE.BufferGeometry(); gg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    grp.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x8e2240, transparent: true, opacity: 0.8 })));
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), UPV = new THREE.Vector3(0, 1, 0);
    Object.keys(P.species).forEach(function (key, si) {
      var list = P.trees.filter(function (t) { return t.alive && t.sp === key; });
      if (!list.length) return;
      var base = new THREE.Color(SEXI_COLORS[si % SEXI_COLORS.length]);
      // stems: thin dark lines from the ground to the crown
      var sp2 = [];
      list.forEach(function (t) { var z0 = alt(t.x, t.y); sp2.push(t.x, z0, P.h - t.y, t.x, z0 + t.h - t.depth * 0.5, P.h - t.y); });
      var sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.Float32BufferAttribute(sp2, 3));
      grp.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0x3a2d22 })));
      S.wires.forEach(function (geo, vi) {
        var mine = list.filter(function (t) { return t.id % S.wires.length === vi; });
        if (!mine.length) return;
        var wire = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.85 }), mine.length);
        var fill = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.16, depthWrite: false }), mine.length);
        mine.forEach(function (t, i) {
          var z0 = alt(t.x, t.y), ry = t.depth / 2, rr = t.radii && t.radii.length ? t.radii.reduce(function (a, b) { return a + b; }, 0) / t.radii.length : t.r;
          q.setFromAxisAngle(UPV, ((t.rot || 0) * Math.PI / 180) + t.id * 0.7);
          m.compose(new THREE.Vector3(t.x, z0 + t.h - ry, P.h - t.y), q, new THREE.Vector3(rr * (1 + 0.08 * Math.sin(t.id)), ry, rr * (1 + 0.08 * Math.cos(t.id * 1.3))));
          wire.setMatrixAt(i, m); fill.setMatrixAt(i, m);
          c.copy(base).offsetHSL(Math.sin(t.id * 2.3) * 0.03, 0, Math.sin(t.id * 5.1) * 0.08);
          wire.setColorAt(i, c); fill.setColorAt(i, c);
        });
        grp.add(fill, wire);
      });
    });
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

  function menu(name, items) {
    return '<div class="ag-menu"><button type="button" class="ag-menu-btn">' + name + '</button><div class="ag-menu-list">' +
      items.map(function (it) { return it === "-" ? "<hr>" : '<button type="button" data-act="' + it[0] + '"><span>' + it[1] + "</span>" + (it[2] ? "<kbd>" + it[2] + "</kbd>" : "") + "</button>"; }).join("") + "</div></div>";
  }
  function setPaint(m) {
    paint = m;
    Array.prototype.forEach.call(root.querySelectorAll("[data-paint]"), function (b) { b.classList.toggle("active", b.dataset.paint === m); });
    if (view !== "2d") setView("2d"); else draw2d();
  }
  function wireMenus() {
    var bar = root.querySelector(".ag-menubar"), open = null;
    function shut() { if (open) open.classList.remove("open"); open = null; }
    bar.addEventListener("click", function (e) {
      var b = e.target.closest(".ag-menu-btn");
      if (b) { var m = b.parentNode; if (open === m) shut(); else { shut(); m.classList.add("open"); open = m; } return; }
      var a = e.target.closest("[data-act]");
      if (!a) return;
      shut();
      var k = a.dataset.act, click = function (id) { var el = $(id); if (el) el.click(); };
      if (k === "new") newStand();
      else if (k === "open") click("agOpenP"); else if (k === "save") click("agSaveP");
      else if (k === "imp") click("agImp"); else if (k === "exp") click("agExp"); else if (k === "topo") click("agTopo"); else if (k === "csv") click("agCsv");
      else if (k === "close") close();
      else if (k === "plant") click("agPlant"); else if (k === "click") click("agTool"); else if (k === "clear") click("agClear");
      else if (k === "run") click("agRun"); else if (k === "step") click("agStep"); else if (k === "reset") click("agReset");
      else if (k === "v2d") setView("2d"); else if (k === "v3d") setView("3d");
      else if (k.indexOf("p-") === 0) setPaint(k.slice(2));
      else if (k === "info") { showInfo = !showInfo; $("agShowInfo").checked = showInfo; if (view !== "2d") setView("2d"); else draw2d(); }
      else if (k === "light") { showLight = !showLight; $("agLight").checked = showLight; if (view !== "2d") setView("2d"); else draw2d(); }
    });
    bar.addEventListener("mouseover", function (e) { var m = e.target.closest(".ag-menu"); if (open && m && m !== open) { shut(); m.classList.add("open"); open = m; } });
    document.addEventListener("mousedown", function (e) { if (open && !e.target.closest(".ag-menubar")) shut(); });
  }
  // New stand: name and size of the plot, slope, and what to plant first.
  function newStand() {
    var back = document.createElement("div");
    back.className = "ag-dlg-back";
    back.innerHTML = '<form class="ag-dlg">' +
      '<div class="ag-dlg-head"><b>New stand</b><span>Plot (stand) definition, as in SExI-FS</span></div>' +
      '<label class="field-label">Stand name</label><input name="name" value="' + esc(P && P.name || "Kopi Gayo – lamtoro") + '">' +
      '<div class="num-pair"><div><label class="field-label">Width X (m)</label><input name="w" type="number" min="10" max="400" value="100"></div><div><label class="field-label">Length Y (m)</label><input name="h" type="number" min="10" max="400" value="100"></div></div>' +
      '<div class="num-pair"><div><label class="field-label">Slope (%)</label><input name="slope" type="number" min="0" max="100" value="0"></div><div><label class="field-label">Slope faces</label><select name="aspect"><option value="0">North (Y+)</option><option value="90">East (X+)</option><option value="180">South (Y−)</option><option value="270">West (X−)</option></select></div></div>' +
      '<label class="field-label">Garden floor</label><select name="floor"><option value="grass">Grass</option><option value="soil">Bare soil</option><option value="litter">Leaf litter (serasah)</option><option value="rows">Soil under the rows, grass in the alleys</option></select>' +
      '<label class="field-label">Start with</label><select name="start"><option value="ex40">Example: 40 plants (36 coffee, 4 lamtoro), grown 5 years</option><option value="pattern">Coffee 2.5 × 2.5 m under lamtoro 5 × 5 m</option><option value="coffee">Coffee only, 2.5 × 2.5 m</option><option value="empty">An empty stand</option></select>' +
      '<p class="ag-note">Trees can be added later by pattern, by clicking, or from a SExI-FS tree file.</p>' +
      '<div class="ag-dlg-foot"><button type="button" data-cancel>Cancel</button><button type="submit" class="btn-primary">Create stand</button></div></form>';
    root.appendChild(back);
    var f = back.querySelector("form");
    setTimeout(function () { f.elements.w.focus(); f.elements.w.select(); }, 50);
    back.querySelector("[data-cancel]").addEventListener("click", function () { back.remove(); });
    back.addEventListener("mousedown", function (e) { if (e.target === back) back.remove(); });
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = f.elements, w = clamp(+v.w.value || 100, 10, 400), h = clamp(+v.h.value || 100, 10, 400), slope = clamp(+v.slope.value || 0, 0, 100) / 100, asp = +v.aspect.value;
      P = newProject(); P.name = v.name.value || P.name; P.w = w; P.h = h; P.floor = v.floor.value;
      if (slope > 0) {
        // A plane rising toward the chosen side, as SExI-FS topography points every 5 m.
        var rows = ["X Y Altitude"];
        for (var x = 0; x <= w; x += 5) for (var y = 0; y <= h; y += 5) {
          var d = asp === 0 ? y : asp === 90 ? x : asp === 180 ? h - y : w - x;
          rows.push(x + " " + y + " " + (d * slope).toFixed(2));
        }
        importTopo(rows.join("\n"));
      }
      if (v.start.value === "ex40") { example40(); crownIndices(); record(); for (var yy = 0; yy < 5; yy++) step(); }
      else if (v.start.value !== "empty") plantPattern("kopi", 2.5, 2.5, 1.25, 1.25, false);
      if (v.start.value === "pattern") plantPattern("lamtoro", 5, 5, 2.5, 2.5, true);
      crownIndices(); record(); sel = null; info(); syncInputs(); save();
      back.remove();
      toast("Stand " + w + " × " + h + " m created");
    });
  }
  function build() {
    if (root) return;
    root = document.createElement("div");
    root.className = "agro-app";
    root.innerHTML =
      '<header class="ag-head">' + sym("forest") + '<div class="ag-title"><b>Agroforestry simulator</b><span>Gayo coffee · shade trees · SExI-FS data</span></div>' +
        '<div class="ag-seg ag-views"><button data-view="2d" class="active">' + sym("grid_view") + '<span>2D plot</span></button><button data-view="3d">' + sym("view_in_ar") + "<span>3D</span></button></div>" +
        '<span class="ag-year" id="agYear">Year 0</span>' +
        '<button class="ag-close" title="Back to Home">' + sym("close") + "</button></header>" +
      '<nav class="ag-menubar">' +
        menu("File", [["new", "New stand…", "Ctrl+N"], ["open", "Open project…"], ["save", "Save project"], "-", ["imp", "Import trees (SExI-FS)…"], ["exp", "Export trees (SExI-FS)"], ["topo", "Import topography…"], "-", ["csv", "Export history (CSV)"], "-", ["close", "Close simulator"]]) +
        menu("Stand", [["plant", "Plant pattern"], ["click", "Plant by clicking"], "-", ["clear", "Remove all trees"]]) +
        menu("Simulation", [["run", "Run"], ["step", "One year"], ["reset", "Back to year 0"]]) +
        menu("View", [["v2d", "2D plot"], ["v3d", "Virtual forest (3D)"], "-", ["p-outline", "Paint: outline"], ["p-opaque", "Paint: opaque"], ["p-transparent", "Paint: transparent"], ["p-shaded", "Paint: shaded"], "-", ["info", "Show info"], ["light", "Light map"]]) +
        '<span class="ag-menu-stand" id="agStandLbl"></span>' +
      "</nav>" +
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
        '<div class="ag-float" id="agFloat2d"><div class="ag-seg ag-paint">' + ["outline", "opaque", "transparent", "shaded"].map(function (m) { return '<button type="button" data-paint="' + m + '"' + (m === paint ? ' class="active"' : "") + ">" + m.charAt(0).toUpperCase() + m.slice(1) + "</button>"; }).join("") + "</div>" +
          '<span class="ag-fsep"></span><label class="check-row"><input type="checkbox" id="agShowInfo">Show info</label><label class="check-row"><input type="checkbox" id="agLight">Light map</label></div>' +
        '<div class="ag-float" id="agFloat3d" hidden><span>' + sym("wb_sunny") + '</span><input type="range" id="agSun" min="6" max="18" step="0.25" value="9"><b id="agSunLbl">09:00</b>' +
          '<span class="ag-fsep"></span><select id="agFloor" title="Garden floor"><option value="grass">Floor: grass</option><option value="soil">Floor: soil</option><option value="litter">Floor: leaf litter</option><option value="rows">Floor: soil rows, grass alleys</option></select><span class="ag-fsep"></span><div class="ag-seg ag-look"><button type="button" data-look="real" class="active">Realistic</button><button type="button" data-look="sexi">SExI-FS</button></div><label class="check-row"><input type="checkbox" id="agFlower">Flowering</label>' +
          '<span class="ag-fsep"></span><button type="button" data-cam="top" title="From above">' + sym("crop_free") + '</button><button type="button" data-cam="over" title="Whole plot">' + sym("zoom_out_map") + '</button><button type="button" data-cam="eye" title="Eye level, in a coffee row">' + sym("directions_walk") + "</button></div>" +
        '<div class="ag-info" id="agInfo" hidden></div></main>' +
      '<aside class="ag-right"><h4>' + sym("monitoring") + 'Plot summary</h4><div id="agStats"></div>' +
        '<p class="ag-note">Growth follows SExI-FS style species parameters; yield and carbon are indicative. Calibrate with your field data.</p></aside>';
    document.body.appendChild(root);

    var saved = null; try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { }
    P = saved && saved.trees ? saved : newProject();
    if (!saved) { P.name = "Example: 40 plants"; example40(); crownIndices(); record(); for (var yy = 0; yy < 5; yy++) { step(); } setTimeout(newStand, 300); }
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
    document.addEventListener("keydown", function (e) { if (root.classList.contains("show") && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); newStand(); } });
    root.querySelector(".ag-look").addEventListener("click", function (e) {
      var b = e.target.closest("[data-look]"); if (!b) return;
      look3d = b.dataset.look; realistic = look3d === "real";
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle("active", x === b); });
      if (G3) { build3d(); if (look3d === "sexi") camPreset("top"); }
    });
    $("agFloor").addEventListener("change", function () { P.floor = this.value; save(); if (G3) build3d(); });
    root.querySelector(".ag-paint").addEventListener("click", function (e) { var b = e.target.closest("[data-paint]"); if (b) setPaint(b.dataset.paint); });
    $("agShowInfo").addEventListener("change", function () { showInfo = this.checked; draw2d(); });
    wireMenus();
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
    $("agW").value = P.w; $("agH").value = P.h; $("agFloor").value = P.floor || "grass";
    $("agStandLbl").textContent = (P.name || "Stand") + " · " + P.w + " × " + P.h + " m" + (P.topo ? " · with topography" : "");
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
