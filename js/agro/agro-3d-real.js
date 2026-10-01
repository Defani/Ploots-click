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
      // Arabica: broad elliptic blade, short acuminate tip, wavy margin,
      // deep glossy green with a sunken pale midrib and arching veins.
      g.beginPath();
      g.moveTo(w / 2, h * 0.015);
      for (var i = 0; i <= 24; i++) { var y = i / 24, half = Math.sin(Math.pow(y, 0.8) * Math.PI) * 0.47 * (y < 0.12 ? y / 0.12 * 0.6 + 0.4 : 1); var wav = 1 + 0.035 * Math.sin(y * 40); g.lineTo(w / 2 + half * w * wav, h * (0.015 + y * 0.97)); }
      for (var j = 24; j >= 0; j--) { var y2 = j / 24, half2 = Math.sin(Math.pow(y2, 0.8) * Math.PI) * 0.47 * (y2 < 0.12 ? y2 / 0.12 * 0.6 + 0.4 : 1); var wav2 = 1 + 0.035 * Math.sin(y2 * 40 + 1.3); g.lineTo(w / 2 - half2 * w * wav2, h * (0.015 + y2 * 0.97)); }
      g.closePath();
      var gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, "#1f5a22"); gr.addColorStop(0.42, "#2f7a2e"); gr.addColorStop(0.5, "#3b8a36"); gr.addColorStop(0.58, "#2f7a2e"); gr.addColorStop(1, "#215c24");
      g.fillStyle = gr; g.fill();
      g.save(); g.clip();
      var sh = g.createLinearGradient(0, 0, w, h); sh.addColorStop(0, "rgba(255,255,255,0)"); sh.addColorStop(0.45, "rgba(255,255,255,.16)"); sh.addColorStop(0.6, "rgba(255,255,255,0)");
      g.fillStyle = sh; g.fillRect(0, 0, w, h); // wax sheen
      g.strokeStyle = "rgba(170,205,120,.6)"; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(w / 2, h * 0.04); g.lineTo(w / 2, h * 0.97); g.stroke();
      g.lineWidth = 1.2; g.strokeStyle = "rgba(150,195,110,.32)";
      for (var k = 1; k < 10; k++) {
        var vy = h * (0.12 + k * 0.08);
        g.beginPath(); g.moveTo(w / 2, vy); g.quadraticCurveTo(w * 0.78, vy - 14, w * 0.9, vy - 34); g.stroke();
        g.beginPath(); g.moveTo(w / 2, vy); g.quadraticCurveTo(w * 0.22, vy - 14, w * 0.1, vy - 34); g.stroke();
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
    // Lamtoro bark: brown-grey with fine vertical fissures and paler flecks.
    return TEX.bark || (TEX.bark = canvasTex(64, 256, function (g, w, h) {
      var gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, "#6f6250"); gr.addColorStop(0.5, "#8d7f6a"); gr.addColorStop(1, "#6a5d4b");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      var r = rng(31);
      for (var i = 0; i < 140; i++) { var x = r() * w; g.strokeStyle = "rgba(55,45,35," + (0.3 + r() * 0.4) + ")"; g.lineWidth = 0.6 + r(); g.beginPath(); g.moveTo(x, r() * h); g.lineTo(x + (r() - .5) * 2, r() * h); g.stroke(); }
      for (var j = 0; j < 500; j++) { g.fillStyle = "rgba(" + (170 + r() * 40 | 0) + "," + (150 + r() * 30 | 0) + "," + (120 + r() * 30 | 0) + ",.35)"; g.fillRect(r() * w, r() * h, 1 + r() * 2, 2 + r() * 6); }
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
  var LEAF_FOLD = (function () {
    var g = new THREE.PlaneGeometry(1, 1, 2, 5); g.translate(0, 0.5, 0);
    var p = g.attributes.position;
    for (var i = 0; i < p.count; i++) { var x = p.getX(i), y = p.getY(i); p.setZ(i, Math.abs(x) * 0.14 - y * y * 0.16); }
    g.computeVertexNormals();
    return g;
  })();
  // Coffee blades: the fold and curl scale with the blade, not in metres.
  function leafMatrixF(pos, dir, width, length, roll) { var m = leafMatrix(pos, dir, width, length, roll); m.scale(new THREE.Vector3(1, 1, length)); return m; }
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
    var wood = new THREE.Color("#4e4134"), H = COFFEE_H;
    var nStem = 2;
    for (var s = 0; s < nStem; s++) {
      var sa = s * Math.PI + r() * 0.6, lean = 0.05 + r() * 0.05, top = new THREE.Vector3(Math.cos(sa) * lean * H, H * (0.94 + r() * 0.06), Math.sin(sa) * lean * H);
      var base = new THREE.Vector3(Math.cos(sa) * 0.03, 0, Math.sin(sa) * 0.03);
      stems.add(cyl, between(base, top, 0.022), wood);
      var node = 0;
      for (var y = 0.14; y < top.y - 0.03; y += 0.06 + r() * 0.02, node++) {
        var rel = y / H;
        // Hedge-like: nearly the same reach from the ground up, rounding off near the top.
        var maxL = 0.8 * Math.sqrt(Math.max(0, 1 - Math.pow(rel / 1.02, 2.4))) + 0.07; // beehive: wide skirt, rounded top
        var c = new THREE.Vector3().lerpVectors(base, top, (y - base.y) / (top.y - base.y));
        for (var side = 0; side < 2; side++) {
          var az = node * Math.PI / 2 + side * Math.PI + s * 0.8 + (r() - 0.5) * 0.5;
          var L = maxL * (0.82 + r() * 0.28), droop = -0.02 - rel * 0.06 - r() * 0.05;
          var dir = new THREE.Vector3(Math.cos(az), droop, Math.sin(az)).normalize();
          var a2 = c.clone(), mid = a2.clone().addScaledVector(dir, L * 0.5), b2 = a2.clone().addScaledVector(dir, L);
          mid.y -= L * L * 0.05; b2.y -= L * L * 0.16; // plagiotropic branches arch down toward the tips
          stems.add(cyl, between(a2, mid, 0.006), wood); stems.add(cyl, between(mid, b2, 0.004), wood);
          var n = Math.max(4, Math.round(L / 0.045));
          for (var k = 1; k <= n; k++) {
            var tt = k / (n + 0.3), p = tt < 0.5 ? a2.clone().lerp(mid, tt * 2) : mid.clone().lerp(b2, (tt - 0.5) * 2);
            var bdir = tt < 0.5 ? new THREE.Vector3().subVectors(mid, a2) : new THREE.Vector3().subVectors(b2, mid);
            var young = tt > 0.82, size = young ? 0.7 : 1;
            var col = young ? new THREE.Color().setHSL(0.24, 0.75, 0.82) : new THREE.Color().setHSL(0.3 + (r() - 0.5) * 0.04, 0.22, 0.6 + r() * 0.2);
            for (var s2 = -1; s2 <= 1; s2 += 2) {
              if (!young && r() < 0.15) continue; // a few fallen leaves leave gaps
              // Opposite pairs, held out to the side and hanging a little, never in neat rows.
              var side3 = new THREE.Vector3().crossVectors(bdir, UP).normalize().multiplyScalar(s2);
              var ld = side3.clone().add(bdir.clone().normalize().multiplyScalar(0.2 + r() * 0.2)).add(new THREE.Vector3((r() - 0.5) * 0.4, -0.18 + r() * 0.26, (r() - 0.5) * 0.4));
              var len = (0.18 + r() * 0.08) * size, wid = len * 0.45;
              leaves.add(LEAF_FOLD, leafMatrixF(p, ld, wid, len, Math.PI / 2 + (r() - 0.5) * 0.7), col); // blade faces up
            }
            // Cherries clustered in the axils along the older wood.
            if (!young && tt > 0.12 && tt < 0.72 && r() < 0.3) {
              var cnt = 3 + (r() * 6 | 0);
              for (var cc = 0; cc < cnt; cc++) {
                var ang = cc / cnt * Math.PI * 2, off = new THREE.Vector3(Math.cos(ang) * 0.016, -0.008 - r() * 0.01, Math.sin(ang) * 0.016);
                var ripe = r(), fc = ripe < 0.2 ? "#a8201c" : ripe < 0.3 ? "#c9471f" : ripe < 0.4 ? "#b5a032" : ripe < 0.75 ? "#4f8a2c" : "#3d7424";
                fruit.add(bead, new THREE.Matrix4().compose(p.clone().add(off), new THREE.Quaternion(), new THREE.Vector3(0.0075, 0.009, 0.0075)), new THREE.Color(fc));
              }
            }
            if (flowering && !young && tt > 0.1 && r() < 0.4) {
              for (var f = 0; f < 6; f++) {
                var fo = new THREE.Vector3((r() - 0.5) * 0.04, 0.004 + r() * 0.012, (r() - 0.5) * 0.04);
                flowers.add(bead, new THREE.Matrix4().compose(p.clone().add(fo), new THREE.Quaternion(), new THREE.Vector3(0.011, 0.006, 0.011)), new THREE.Color("#f6f3ea"));
              }
            }
          }
        }
      }
      // Young light-green flush at the top of each stem.
      for (var tp = 0; tp < 8; tp++) {
        var ta = r() * Math.PI * 2;
        leaves.add(LEAF_FOLD, leafMatrixF(top.clone().add(new THREE.Vector3(0, -0.04, 0)), new THREE.Vector3(Math.cos(ta), -0.15, Math.sin(ta)), 0.05, 0.11, Math.PI / 2 + (r() - 0.5) * 0.6), new THREE.Color().setHSL(0.26, 0.6, 0.7));
      }
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
      for (var pd = 0; pd < 5; pd++) {
        if (r() < 0.35) continue;
        var pp = p.clone().add(new THREE.Vector3((r() - 0.5) * 1.2, -0.3 - r() * 0.4, (r() - 0.5) * 1.2));
        // Flat pods, reddish brown when ripe, green when young.
        fruit.add(new THREE.BoxGeometry(1, 1, 1), new THREE.Matrix4().compose(pp.clone().add(new THREE.Vector3(0, -0.1, 0)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(r(), 0, r()).normalize(), 0.25), new THREE.Vector3(0.022, 0.19, 0.004)), new THREE.Color(["#7a3f2a", "#8a4a30", "#6b5a2e", "#5f7a34"][r() * 4 | 0]));
      }
      // Pom-pom flower heads, creamy white.
      if (r() < 0.5) fruit.add(new THREE.IcosahedronGeometry(1, 1), new THREE.Matrix4().compose(p.clone().add(new THREE.Vector3((r() - .5) * .8, .1, (r() - .5) * .8)), new THREE.Quaternion(), new THREE.Vector3(0.025, 0.025, 0.025)), new THREE.Color("#f1ead2"));
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
      coffeeLeaf: (function () { var l = leafMat(coffeeLeafTex(), 0.32); l.m = new THREE.MeshPhysicalMaterial({ map: coffeeLeafTex(), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.34, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.35 }); return l; })(),
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
            if (kind === "coffee") sxz = Math.min(sxz, 1.05);
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
  // Garden floor: grass, bare soil, leaf litter (serasah), or soil rows with
  // grass alleys between them.
  function soilTex() {
    var t = TEX.soil || (TEX.soil = canvasTex(512, 512, function (g, w, h) {
      g.fillStyle = "#5b4430"; g.fillRect(0, 0, w, h);
      var r = rng(19);
      for (var i = 0; i < 60; i++) { g.fillStyle = "rgba(" + (70 + r() * 40 | 0) + "," + (50 + r() * 30 | 0) + "," + (32 + r() * 20 | 0) + ",.5)"; g.beginPath(); g.ellipse(r() * w, r() * h, 10 + r() * 50, 6 + r() * 30, r() * 3, 0, Math.PI * 2); g.fill(); }
      for (var j = 0; j < 7000; j++) { g.fillStyle = ["#4a3624", "#6e543a", "#3c2c1e", "#7b6146", "#584230"][j % 5]; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); }
      for (var k = 0; k < 120; k++) { g.strokeStyle = "rgba(120,100,70,.5)"; g.lineWidth = 1; var x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - .5) * 20, y + (r() - .5) * 20); g.stroke(); } // twigs
    }));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  function litterTex() {
    var t = TEX.litter || (TEX.litter = canvasTex(512, 512, function (g, w, h) {
      g.fillStyle = "#4b3a28"; g.fillRect(0, 0, w, h);
      var r = rng(23), cols = ["#7a5a32", "#8f6b3a", "#5f4529", "#a07c45", "#6b5a2e", "#4f5a2a", "#8a7440"];
      for (var i = 0; i < 1400; i++) {
        var x = r() * w, y = r() * h, a = r() * Math.PI * 2, L = 8 + r() * 18;
        g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = cols[i % cols.length]; g.globalAlpha = 0.85;
        g.beginPath(); g.ellipse(0, 0, L * 0.38, L, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = "rgba(40,28,16,.45)"; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, -L); g.lineTo(0, L); g.stroke();
        g.restore();
      }
      g.globalAlpha = 1;
    }));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  // Soil under the coffee rows and grass in the alleys: blended by a mask
  // made from the row spacing.
  function rowsTex(w, h, rowY) {
    var px = 8, c = document.createElement("canvas"); c.width = Math.max(64, Math.round(w * px)); c.height = Math.max(64, Math.round(h * px));
    var g = c.getContext("2d"), grass = grassTex().image, soil = soilTex().image;
    var pg = g.createPattern(grass, "repeat"), ps = g.createPattern(soil, "repeat");
    g.save(); g.scale(0.35, 0.35); g.fillStyle = pg; g.fillRect(0, 0, c.width / 0.35, c.height / 0.35); g.restore();
    g.save(); g.scale(0.35, 0.35); g.fillStyle = ps;
    rowY.forEach(function (y) { var yy = (h - y) * px / 0.35, band = 1.3 * px / 0.35; g.beginPath(); for (var x = 0; x <= c.width / 0.35; x += 12) { var j = Math.sin(x * 0.05 + y) * 6; g.lineTo(x, yy - band / 2 + j); } for (var x2 = c.width / 0.35; x2 >= 0; x2 -= 12) { var j2 = Math.cos(x2 * 0.04 + y) * 6; g.lineTo(x2, yy + band / 2 + j2); } g.closePath(); g.fill(); });
    g.restore();
    var tx = new THREE.CanvasTexture(c); tx.encoding = THREE.sRGBEncoding; tx.anisotropy = 4;
    return tx;
  }
  function ground(w, h, heightAt, type, rowY) {
    type = type || "grass";
    var tex;
    if (type === "rows" && rowY && rowY.length) tex = rowsTex(w, h, rowY);
    else { tex = (type === "soil" ? soilTex() : type === "litter" ? litterTex() : grassTex()).clone(); tex.needsUpdate = true; tex.repeat.set(w / 6, h / 6); }
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
