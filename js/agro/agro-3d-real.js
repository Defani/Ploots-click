/* ==========================================================================
   Agroforestry simulator — realistic 3D plants (Three.js r147).

   Plants are built procedurally once, as a few "template" variants per
   species, then instanced for every tree of the plot and scaled to the
   simulated height and crown radius:

   Arabica coffee   an orthotropic stem with opposite, decussate
                    plagiotropic branches (longest at the bottom, slightly
                    drooping, so the bush is conical), pairs of glossy
                    elliptic leaves along each branch (younger, lighter
                    leaves at the tips), cherry clusters in the leaf axils
                    (green, yellow, red) and, when flowering, white flowers.
   Lamtoro          two to four slender grey stems forking into an open
                    crown, feathery bipinnate foliage cards and hanging
                    brown pods (Leucaena leucocephala).
   Other species    a generic broadleaf tree of the same build.

   Leaves are alpha-tested textures drawn on canvases (no image files), so
   the plants cast leaf-shaped shadows (custom depth material). Ground:
   a grass texture with bare soil patches; misty highland light and fog.
   ========================================================================== */
(function () {
  "use strict";

  // Everything below needs THREE, which loads with the 3D view: the module
  // is built on first use.
  var impl = null;
  function make() {

  /* ---------------------------------------------------------- random */
  function rng(seed) { var s = seed % 2147483647 || 1; return function () { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; }; }

  /* -------------------------------------------------------- textures */
  function canvasTex(w, h, draw) {
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    var t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }
  var TEX = {};
  function coffeeLeafTex() {
    return TEX.coffee || (TEX.coffee = canvasTex(128, 256, function (g, w, h) {
      // Elliptic, acuminate, glossy leaf with a pale midrib and veins.
      g.beginPath();
      g.moveTo(w / 2, h * 0.02);
      g.bezierCurveTo(w * 0.98, h * 0.2, w * 0.98, h * 0.72, w / 2, h * 0.98);
      g.bezierCurveTo(w * 0.02, h * 0.72, w * 0.02, h * 0.2, w / 2, h * 0.02);
      g.closePath();
      var gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, "#1c4a1f"); gr.addColorStop(0.45, "#2f6e2c"); gr.addColorStop(0.55, "#3a7d34"); gr.addColorStop(1, "#1f5222");
      g.fillStyle = gr; g.fill();
      g.save(); g.clip();
      g.fillStyle = "rgba(255,255,255,.10)"; g.fillRect(w * 0.18, 0, w * 0.22, h); // sheen
      g.strokeStyle = "rgba(190,220,150,.55)"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(w / 2, h * 0.04); g.lineTo(w / 2, h * 0.97); g.stroke();
      g.lineWidth = 1.4; g.strokeStyle = "rgba(170,210,140,.35)";
      for (var i = 1; i < 9; i++) {
        var y = h * (0.1 + i * 0.09);
        g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w * 0.75, y - 18, w * 0.93, y - 34); g.stroke();
        g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w * 0.25, y - 18, w * 0.07, y - 34); g.stroke();
      }
      g.restore();
    }));
  }
  function lamtoroLeafTex() {
    return TEX.lam || (TEX.lam = canvasTex(256, 256, function (g, w, h) {
      // Bipinnate: a rachis with pinnae, each with many tiny leaflets.
      g.strokeStyle = "#6b7a3a"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(w * 0.5, h * 0.98); g.lineTo(w * 0.5, h * 0.05); g.stroke();
      for (var p = 0; p < 7; p++) {
        var y0 = h * (0.12 + p * 0.12), side;
        for (side = -1; side <= 1; side += 2) {
          var len = w * (0.38 - Math.abs(p - 3) * 0.035), ang = side * (0.35 + p * 0.02);
          var x1 = w / 2 + Math.sin(ang) * len, y1 = y0 - Math.cos(ang) * len * 0.35;
          g.lineWidth = 1.2; g.strokeStyle = "#708040";
          g.beginPath(); g.moveTo(w / 2, y0); g.lineTo(x1, y1); g.stroke();
          for (var k = 1; k <= 12; k++) {
            var t = k / 13, cx = w / 2 + (x1 - w / 2) * t, cy = y0 + (y1 - y0) * t;
            g.fillStyle = k % 2 ? "#86b04f" : "#7aa746";
            g.save(); g.translate(cx, cy); g.rotate(ang + Math.PI / 2);
            g.beginPath(); g.ellipse(0, -5, 2.2, 5.5, 0, 0, Math.PI * 2); g.ellipse(0, 5, 2.2, 5.5, 0, 0, Math.PI * 2); g.fill();
            g.restore();
          }
        }
      }
    }));
  }
  function broadLeafTex() {
    return TEX.broad || (TEX.broad = canvasTex(128, 128, function (g, w, h) {
      for (var i = 0; i < 26; i++) {
        var x = 16 + Math.random() * (w - 32), y = 16 + Math.random() * (h - 32), a = Math.random() * Math.PI * 2;
        g.save(); g.translate(x, y); g.rotate(a);
        g.fillStyle = ["#3c7a2e", "#4b8a36", "#356c28"][i % 3];
        g.beginPath(); g.ellipse(0, 0, 6, 15, 0, 0, Math.PI * 2); g.fill(); g.restore();
      }
    }));
  }
  function grassTex() {
    var t = TEX.grass || (TEX.grass = canvasTex(512, 512, function (g, w, h) {
      g.fillStyle = "#5d7a33"; g.fillRect(0, 0, w, h);
      var r = rng(7);
      for (var i = 0; i < 14; i++) { g.fillStyle = "rgba(92,70,45," + (0.25 + r() * 0.35) + ")"; g.beginPath(); g.ellipse(r() * w, r() * h, 20 + r() * 60, 12 + r() * 40, r() * 3, 0, Math.PI * 2); g.fill(); }
      for (var j = 0; j < 9000; j++) {
        var x = r() * w, y = r() * h, l = 3 + r() * 7;
        g.strokeStyle = ["#6f9a3c", "#4f6f2a", "#86ad4b", "#5b7f31", "#3f5a22"][j % 5];
        g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - l); g.stroke();
      }
    }));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  function barkTex() {
    return TEX.bark || (TEX.bark = canvasTex(64, 256, function (g, w, h) {
      g.fillStyle = "#8b877c"; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 400; i++) { g.fillStyle = "rgba(" + (90 + Math.random() * 70 | 0) + "," + (86 + Math.random() * 60 | 0) + "," + (78 + Math.random() * 50 | 0) + ",.5)"; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 2 + Math.random() * 10); }
    }));
  }

  /* ------------------------------------------------------ geometry */
  // Collects transformed pieces into one BufferGeometry (positions,
  // normals, uvs, vertex colours).
  function Builder() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
  Builder.prototype.add = function (geo, m, color) {
    var g = geo.index ? geo.toNonIndexed() : geo, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    var nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3(), base = this.p.length / 3;
    for (var k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(m); this.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize(); this.n.push(v.x, v.y, v.z);
      this.u.push(uv ? uv.getX(k) : 0, uv ? uv.getY(k) : 0);
      this.c.push(color.r, color.g, color.b);
      this.i.push(base + k);
    }
  };
  Builder.prototype.geometry = function () {
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  };
  var UP = new THREE.Vector3(0, 1, 0);
  // Matrix for a piece from point a to point b (cylinder along +Y).
  function between(a, b, r0) {
    var d = new THREE.Vector3().subVectors(b, a), len = d.length();
    var q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
    return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r0, len, r0));
  }
  // A leaf card: a plane, stem end at the origin, pointing along `dir`.
  var LEAF = (function () { var g = new THREE.PlaneGeometry(1, 1, 1, 1); g.translate(0, 0.5, 0); return g; })();
  function leafMatrix(pos, dir, width, length, roll) {
    var q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
    q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, roll));
    return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(width, length, 1));
  }

  /* ---------------------------------------------------- coffee model */
  // Normalised to a 1.8 m plant with a 0.9 m crown radius.
  var COFFEE_H = 1.8, COFFEE_R = 0.9;
  function coffeeTemplate(seed, flowering) {
    var r = rng(seed), stems = new Builder(), leaves = new Builder(), fruit = new Builder(), flowers = new Builder();
    var cyl = new THREE.CylinderGeometry(0.6, 1, 1, 5, 1), bead = new THREE.IcosahedronGeometry(1, 0);
    var wood = new THREE.Color("#6b5236"), H = COFFEE_H;
    stems.add(cyl, between(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, H, 0), 0.025), wood);
    var node = 0;
    for (var y = 0.18; y < H - 0.05; y += 0.075 + r() * 0.02, node++) {
      var rel = y / H, maxL = 0.95 * (1 - Math.pow(rel, 1.35)) + 0.1;
      for (var side = 0; side < 2; side++) {
        var az = node * Math.PI / 2 + side * Math.PI + (r() - 0.5) * 0.4;
        var L = maxL * (0.8 + r() * 0.3), droop = -0.12 - rel * 0.1 - r() * 0.08;
        var dir = new THREE.Vector3(Math.cos(az), droop, Math.sin(az)).normalize();
        var a = new THREE.Vector3(0, y, 0), b = a.clone().addScaledVector(dir, L);
        b.y -= L * L * 0.12; // branches sag toward the tips
        stems.add(cyl, between(a, b, 0.008), wood);
        var bdir = new THREE.Vector3().subVectors(b, a), n = Math.max(4, Math.round(L / 0.05));
        for (var k = 1; k <= n; k++) {
          var t = k / (n + 0.4), p = a.clone().addScaledVector(bdir, t);
          var young = t > 0.8, size = young ? 0.65 : 1;
          var col = new THREE.Color(young ? "#9fd07a" : "#a9bea4");
          for (var s2 = -1; s2 <= 1; s2 += 2) {
            // Opposite leaves, spreading sideways and a little down.
            var side3 = new THREE.Vector3().crossVectors(bdir, UP).normalize().multiplyScalar(s2);
            var ld = side3.clone().multiplyScalar(0.85).add(bdir.clone().normalize().multiplyScalar(0.4)).add(new THREE.Vector3(0, -0.5 + r() * 0.25, 0));
            var len = (0.13 + r() * 0.06) * size, wid = len * 0.44;
            leaves.add(LEAF, leafMatrix(p, ld, wid, len, (r() - 0.5) * 0.8 + 1.1), col);
          }
          if (!young && t > 0.2 && t < 0.7 && r() < 0.35) {
            var sd = new THREE.Vector3().crossVectors(bdir, UP).normalize().multiplyScalar(r() < 0.5 ? 1 : -1).add(bdir.clone().normalize()).normalize();
            sd.y -= 0.25;
            var sl = 0.14 + r() * 0.12, se = p.clone().addScaledVector(sd, sl);
            stems.add(cyl, between(p, se, 0.005), wood);
            for (var sk = 1; sk <= 3; sk++) {
              var sp2 = p.clone().lerp(se, sk / 3.2);
              for (var ss = -1; ss <= 1; ss += 2) {
                var sdir = new THREE.Vector3().crossVectors(sd, UP).normalize().multiplyScalar(ss).add(sd.clone().multiplyScalar(0.4)).add(new THREE.Vector3(0, -0.45, 0));
                leaves.add(LEAF, leafMatrix(sp2, sdir, 0.052, 0.12 + r() * 0.04, r() * 0.8 + 1.1), new THREE.Color("#ffffff"));
              }
            }
          }
          // Cherries in the axils of the older part of the branch.
          if (!young && t > 0.15 && t < 0.75 && r() < 0.55) {
            var cnt = 3 + (r() * 7 | 0);
            for (var c = 0; c < cnt; c++) {
              var off = new THREE.Vector3((r() - 0.5) * 0.035, -0.012 - r() * 0.02, (r() - 0.5) * 0.035);
              var ripe = r(), fc = ripe < 0.45 ? "#b3261e" : ripe < 0.6 ? "#d9731f" : ripe < 0.72 ? "#c9b233" : "#5f8f32";
              fruit.add(bead, new THREE.Matrix4().compose(p.clone().add(off), new THREE.Quaternion(), new THREE.Vector3(0.0085, 0.01, 0.0085)), new THREE.Color(fc));
            }
          }
          if (flowering && !young && t > 0.1 && r() < 0.35) {
            for (var f = 0; f < 5; f++) {
              var fo = new THREE.Vector3((r() - 0.5) * 0.05, 0.005 + r() * 0.015, (r() - 0.5) * 0.05);
              flowers.add(bead, new THREE.Matrix4().compose(p.clone().add(fo), new THREE.Quaternion(), new THREE.Vector3(0.012, 0.006, 0.012)), new THREE.Color("#f6f3ea"));
            }
          }
        }
      }
    }
    // A crown of young leaves at the top.
    for (var tp = 0; tp < 10; tp++) {
      var ta = r() * Math.PI * 2;
      leaves.add(LEAF, leafMatrix(new THREE.Vector3(0, H - 0.02, 0), new THREE.Vector3(Math.cos(ta) * 0.6, 0.8, Math.sin(ta) * 0.6), 0.04, 0.1, r() * 3), new THREE.Color("#a6dc7c"));
    }
    return { stems: stems.geometry(), leaves: leaves.geometry(), fruit: fruit.geometry(), flowers: flowering ? flowers.geometry() : null, H: COFFEE_H, R: COFFEE_R };
  }

  /* --------------------------------------------------- lamtoro model */
  // Normalised to an 8 m tree with a 2.5 m crown radius.
  var LAM_H = 8, LAM_R = 2.5;
  function lamtoroTemplate(seed) {
    var r = rng(seed), stems = new Builder(), leaves = new Builder(), fruit = new Builder();
    var cyl = new THREE.CylinderGeometry(0.72, 1, 1, 6, 1), bark = new THREE.Color("#ffffff"), tips = [];
    var n = 2 + (r() * 3 | 0);
    for (var s = 0; s < n; s++) {
      var az = r() * Math.PI * 2, lean = 0.08 + r() * 0.16;
      var a = new THREE.Vector3(0, 0, 0), b = new THREE.Vector3(Math.cos(az) * lean * 4.5, 4.5 + r() * 0.8, Math.sin(az) * lean * 4.5);
      stems.add(cyl, between(a, b, 0.07 - s * 0.008), bark);
      var forks = 2 + (r() * 2 | 0);
      for (var f = 0; f < forks; f++) {
        var fa = az + (r() - 0.5) * 2.2, spread = 0.9 + r() * 1.3;
        var c = new THREE.Vector3(b.x + Math.cos(fa) * spread, LAM_H * (0.78 + r() * 0.18), b.z + Math.sin(fa) * spread);
        stems.add(cyl, between(b, c, 0.04), bark);
        // twigs
        for (var t = 0; t < 3; t++) {
          var ta = fa + (r() - 0.5) * 2, d = new THREE.Vector3(c.x + Math.cos(ta) * (0.5 + r()), c.y + 0.2 + r() * 0.6, c.z + Math.sin(ta) * (0.5 + r()));
          stems.add(cyl, between(c, d, 0.014), bark);
          tips.push(d);
        }
        tips.push(c);
      }
    }
    // Feathery foliage around the twig tips, and hanging pods.
    tips.forEach(function (p) {
      var cnt = 16 + (r() * 8 | 0);
      for (var k = 0; k < cnt; k++) {
        var off = new THREE.Vector3((r() - 0.5) * 1.9, (r() - 0.4) * 1.1, (r() - 0.5) * 1.9);
        var q = p.clone().add(off);
        var dir = new THREE.Vector3((r() - 0.5), -0.35 - r() * 0.5, (r() - 0.5));
        var tint = new THREE.Color().setHSL(0.24 + (r() - 0.5) * 0.03, 0.35 + r() * 0.1, 0.55 + r() * 0.12);
        leaves.add(LEAF, leafMatrix(q, dir, 0.55 + r() * 0.25, 0.7 + r() * 0.35, r() * 6), tint);
      }
      for (var pd = 0; pd < 3; pd++) {
        if (r() < 0.45) continue;
        var pp = p.clone().add(new THREE.Vector3((r() - 0.5) * 1.2, -0.3 - r() * 0.4, (r() - 0.5) * 1.2));
        fruit.add(new THREE.BoxGeometry(1, 1, 1), new THREE.Matrix4().compose(pp.clone().add(new THREE.Vector3(0, -0.08, 0)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(r(), 0, r()).normalize(), 0.2), new THREE.Vector3(0.018, 0.17, 0.004)), new THREE.Color(r() < 0.5 ? "#6b4a2b" : "#8a6a3a"));
      }
    });
    return { stems: stems.geometry(), leaves: leaves.geometry(), fruit: fruit.geometry(), H: LAM_H, R: LAM_R };
  }
  function broadTemplate(seed, color) {
    var r = rng(seed), stems = new Builder(), leaves = new Builder(), cyl = new THREE.CylinderGeometry(0.7, 1, 1, 6, 1);
    var top = new THREE.Vector3(0, 5, 0);
    stems.add(cyl, between(new THREE.Vector3(), top, 0.12), new THREE.Color("#ffffff"));
    for (var k = 0; k < 160; k++) {
      var u = r() * Math.PI * 2, v = Math.acos(2 * r() - 1), rr = 0.55 + r() * 0.45;
      var p = new THREE.Vector3(Math.sin(v) * Math.cos(u) * 3 * rr, 6.5 + Math.cos(v) * 2 * rr, Math.sin(v) * Math.sin(u) * 3 * rr);
      if (k % 12 === 0) stems.add(cyl, between(top, p, 0.03), new THREE.Color("#ffffff"));
      leaves.add(LEAF, leafMatrix(p, p.clone().sub(new THREE.Vector3(0, 6, 0)), 0.9, 0.9, r() * 6), new THREE.Color(color || "#ffffff"));
    }
    return { stems: stems.geometry(), leaves: leaves.geometry(), fruit: null, H: 8.5, R: 3 };
  }

  /* ------------------------------------------------------ materials */
  var MAT = null;
  function materials() {
    if (MAT) return MAT;
    function leafMat(tex, rough) {
      var m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: rough, metalness: 0 });
      var d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.45 });
      return { m: m, d: d };
    }
    MAT = {
      coffeeLeaf: leafMat(coffeeLeafTex(), 0.38),
      lamLeaf: leafMat(lamtoroLeafTex(), 0.8),
      broadLeaf: leafMat(broadLeafTex(), 0.7),
      wood: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9 }),
      bark: new THREE.MeshStandardMaterial({ map: barkTex(), vertexColors: true, roughness: 0.95 }),
      fruit: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 }),
      flower: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })
    };
    return MAT;
  }

  /* -------------------------------------------------------- scene */
  var TPL = {};
  function templates(kind, color, flowering) {
    var key = kind + (flowering ? ":f" : "") + (kind === "broad" ? ":" + color : "");
    if (TPL[key]) return TPL[key];
    var list = [];
    for (var v = 0; v < 3; v++) list.push(kind === "coffee" ? coffeeTemplate(11 + v * 31, flowering) : kind === "lamtoro" ? lamtoroTemplate(5 + v * 17) : broadTemplate(3 + v * 13, color));
    return (TPL[key] = list);
  }
  function kindOf(s) {
    if (s.crop || /kopi|coffee/i.test(s.label + " " + s.name)) return "coffee";
    if (/lamtoro|leucaena/i.test(s.label + " " + s.name)) return "lamtoro";
    return "broad";
  }

  // Level of detail: the plants nearest the camera (a budget per kind) get
  // the full procedural model; the others a light stand-in (a leafy bush or
  // an umbrella crown on a stem), which the mist hides at distance anyway.
  var BUDGET = { coffee: 320, lamtoro: 150, broad: 120 };
  var SIMPLE = null;
  function simpleParts() {
    if (SIMPLE) return SIMPLE;
    var bush = new THREE.IcosahedronGeometry(1, 1); bush.translate(0, 1, 0); bush.scale(1, 0.5, 1);
    var umb = new THREE.SphereGeometry(1, 10, 6); umb.scale(1, 0.32, 1); umb.translate(0, 1 - 0.32, 0);
    var stem = new THREE.CylinderGeometry(0.6, 1, 1, 5); stem.translate(0, 0.5, 0);
    SIMPLE = {
      bush: bush, umb: umb, stem: stem,
      coffee: new THREE.MeshStandardMaterial({ color: 0x2c5e2a, roughness: 0.7 }),
      lam: new THREE.MeshStandardMaterial({ color: 0x86a94f, roughness: 0.85, transparent: true, opacity: 0.82 }),
      broad: new THREE.MeshStandardMaterial({ color: 0x4b7d34, roughness: 0.8 }),
      bark: new THREE.MeshStandardMaterial({ color: 0x8b877c, roughness: 0.95 })
    };
    return SIMPLE;
  }
  function instanced(geo, mat, list, place, cast) {
    var im = new THREE.InstancedMesh(geo, mat, list.length), m = new THREE.Matrix4();
    list.forEach(function (t, i) { place(t, m); im.setMatrixAt(i, m); });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = !!cast; im.receiveShadow = true;
    return im;
  }

  // trees: [{x, z, base, h, r, id}] grouped by species key; opts.cam {x, z}
  // picks the detailed ones. Returns a Group.
  function plants(species, treesBySp, opts) {
    var M = materials(), S = simpleParts(), grp = new THREE.Group(), q = new THREE.Quaternion(), cam = opts.cam || { x: 0, z: 0 };
    Object.keys(treesBySp).forEach(function (k) {
      var s = species[k], list = treesBySp[k];
      if (!list.length) return;
      var kind = kindOf(s), tpls = templates(kind, s.color, opts.flowering && kind === "coffee");
      var sorted = list.slice().sort(function (a, b) { return (a.x - cam.x) * (a.x - cam.x) + (a.z - cam.z) * (a.z - cam.z) - ((b.x - cam.x) * (b.x - cam.x) + (b.z - cam.z) * (b.z - cam.z)); });
      var near = sorted.slice(0, BUDGET[kind]), far = sorted.slice(BUDGET[kind]);
      tpls.forEach(function (tp, vi) {
        var mine = near.filter(function (t) { return t.id % tpls.length === vi; });
        if (!mine.length) return;
        var parts = [["stems", kind === "coffee" ? M.wood : M.bark, null], ["leaves", kind === "coffee" ? M.coffeeLeaf.m : kind === "lamtoro" ? M.lamLeaf.m : M.broadLeaf.m, kind === "coffee" ? M.coffeeLeaf.d : kind === "lamtoro" ? M.lamLeaf.d : M.broadLeaf.d],
          ["fruit", M.fruit, null], ["flowers", M.flower, null]];
        parts.forEach(function (pt) {
          var geo = tp[pt[0]];
          if (!geo || !geo.attributes.position.count) return;
          var im = instanced(geo, pt[1], mine, function (t, m) {
            var sy = t.h / tp.H, sxz = Math.max(0.3, t.r / tp.R);
            if (pt[0] === "fruit" || pt[0] === "flowers") sxz = Math.min(sxz, sy * 1.3);
            q.setFromAxisAngle(UP, (t.id * 2.3999) % (Math.PI * 2));
            m.compose(new THREE.Vector3(t.x, t.base, t.z), q, new THREE.Vector3(sxz, sy, sxz));
          }, kind !== "coffee" && (pt[0] === "leaves" || pt[0] === "stems")); // shade trees cast; coffee receives
          if (pt[2]) im.customDepthMaterial = pt[2];
          grp.add(im);
        });
      });
      if (!far.length) return;
      q.identity();
      if (kind === "coffee") {
        grp.add(instanced(S.bush, S.coffee, far, function (t, m) { m.compose(new THREE.Vector3(t.x, t.base, t.z), q, new THREE.Vector3(t.r, t.h, t.r)); }, false));
      } else {
        grp.add(instanced(S.stem, S.bark, far, function (t, m) { m.compose(new THREE.Vector3(t.x, t.base, t.z), q, new THREE.Vector3(0.09, t.h * 0.85, 0.09)); }, true));
        grp.add(instanced(S.umb, kind === "lamtoro" ? S.lam : S.broad, far, function (t, m) { m.compose(new THREE.Vector3(t.x, t.base + t.h * 0.55, t.z), q, new THREE.Vector3(t.r, t.h * 0.45, t.r)); }, true));
      }
    });
    return grp;
  }
  function ground(w, h, heightAt) {
    var tex = grassTex().clone(); tex.needsUpdate = true; tex.repeat.set(w / 6, h / 6);
    var seg = heightAt ? 60 : 1, g = new THREE.PlaneGeometry(w, h, seg, seg);
    g.rotateX(-Math.PI / 2); g.translate(w / 2, 0, h / 2);
    if (heightAt) { var pos = g.attributes.position; for (var i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i))); g.computeVertexNormals(); }
    var m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    m.receiveShadow = true;
    return m;
  }
  function atmosphere(scene, renderer) {
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    scene.background = new THREE.Color(0xdfe4e3);
    scene.fog = new THREE.FogExp2(0xdfe4e3, 0.0045); // highland mist
  }

  return { plants: plants, ground: ground, atmosphere: atmosphere, kindOf: kindOf };
  }
  function api(name) { return function () { impl = impl || make(); return impl[name].apply(null, arguments); }; }
  window.PlootsAgroReal = { plants: api("plants"), ground: api("ground"), atmosphere: api("atmosphere"), kindOf: api("kindOf") };
})();
