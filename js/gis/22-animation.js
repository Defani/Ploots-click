/* ==========================================================================
   GIS — map animation (the "Animate" panel of the Analysis view).

   Time        a vector layer and a time field (numbers such as years, or
               ISO dates such as Kobo's _submission_time); steps per value,
               day, month or year; cumulative ("up to") or one step at a
               time. The layer's filter shows the step and a large label
               on the map says which one. Like QGIS's Temporal Controller.
   GFW loss    tree cover loss year by year (js/gis/19-gfw.js).
   Camera      a tour through saved views (fly between keyframes), or an
               orbit around the map centre.
   Record      any of these as a WebM video: the map is copied frame by
               frame onto a canvas with the title and the time label, and
               recorded with MediaRecorder; the file is saved at the end.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var PANEL = "panel-gis-anim";
  function $(id) { return document.getElementById(id); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function map() { return GIS.analysis && GIS.analysis.map(); }
  function toast(m) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(m); }
  var ISO = /^\d{4}-\d{2}(-\d{2})?/;

  /* ------------------------------------------------------------- steps */

  function q(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
  function steps(l, field, unit) {
    var vals = [];
    l.data.features.forEach(function (f) { var v = f.properties[field]; if (v !== null && v !== undefined && v !== "") vals.push(v); });
    if (!vals.length) throw new Error("No values in " + field + ".");
    var isNum = vals.every(function (v) { return typeof v === "number" || isFinite(Number(v)); }), isDate = !isNum && vals.every(function (v) { return ISO.test(String(v)); });
    if (!isNum && !isDate) throw new Error(field + " is neither numbers nor ISO dates.");
    var out = [];
    if (isNum) {
      var u = Array.from(new Set(vals.map(Number))).sort(function (a, b) { return a - b; });
      u.forEach(function (v, i) { out.push({ label: String(v), lo: v, hi: v, cum: '"' + field + '" <= ' + v, one: '"' + field + '" = ' + v }); });
    } else {
      var s = vals.map(String).sort(), first = s[0].slice(0, 10), last = s[s.length - 1].slice(0, 10);
      if (unit === "value") {
        Array.from(new Set(s.map(function (x) { return x.slice(0, 10); }))).forEach(function (d) { var n = next(d, "day"); out.push({ label: d, cum: '"' + field + '" < ' + q(n), one: '"' + field + '" >= ' + q(d) + ' AND "' + field + '" < ' + q(n) }); });
      } else {
        var d = start(first, unit);
        for (var k = 0; d <= last && k < 2000; k++) {
          var n2 = next(d, unit);
          out.push({ label: unit === "year" ? d.slice(0, 4) : unit === "month" ? d.slice(0, 7) : d, cum: '"' + field + '" < ' + q(n2), one: '"' + field + '" >= ' + q(d) + ' AND "' + field + '" < ' + q(n2) });
          d = n2;
        }
      }
    }
    return out;
  }
  function start(d, unit) { return unit === "year" ? d.slice(0, 4) + "-01-01" : unit === "month" ? d.slice(0, 7) + "-01" : d.slice(0, 10); }
  function next(d, unit) {
    var t = new Date(d.slice(0, 10) + "T00:00:00Z");
    if (unit === "year") t.setUTCFullYear(t.getUTCFullYear() + 1); else if (unit === "month") t.setUTCMonth(t.getUTCMonth() + 1); else t.setUTCDate(t.getUTCDate() + 1);
    return t.toISOString().slice(0, 10);
  }

  /* ------------------------------------------------------------ player */

  var P = { kind: null, steps: [], i: 0, timer: 0, playing: false, layer: null, orig: null, label: "" };
  function label(text) {
    var host = $("gisAnalysisHost"), el = host && host.querySelector(".anim-label");
    if (!host) return;
    if (!text) { if (el) el.remove(); P.label = ""; return; }
    if (!el) { el = document.createElement("div"); el.className = "anim-label"; host.appendChild(el); }
    el.textContent = text;
    P.label = text;
  }
  function show(i) {
    P.i = Math.max(0, Math.min(P.steps.length - 1, i));
    var s = P.steps[P.i];
    if (P.kind === "time") {
      P.layer.filter = $("anMode").value === "one" ? s.one : s.cum;
      GIS.emit("style"); GIS.emit("layers");
    } else if (P.kind === "gfw") {
      GIS.gfw.addTreeCoverLoss({ y0: P.y0, y1: s.year, tcd: P.tcd });
    }
    label(($("anTitle").value ? "" : "") + s.label);
    var r = $("anPos");
    if (r) { r.max = P.steps.length - 1; r.value = P.i; }
    var c = $("anCount"); if (c) c.textContent = (P.i + 1) + " / " + P.steps.length;
  }
  function play() {
    if (!P.steps.length) return;
    P.playing = true;
    btnState();
    var ms = +$("anSpeed").value || 700;
    clearInterval(P.timer);
    if (P.i >= P.steps.length - 1) show(0);
    P.timer = setInterval(function () {
      if (P.i >= P.steps.length - 1) {
        if ($("anLoop").checked && !REC.on) { show(0); return; }
        pause();
        if (REC.on) setTimeout(stopRecord, ms);
        return;
      }
      show(P.i + 1);
    }, ms);
  }
  function pause() { P.playing = false; clearInterval(P.timer); btnState(); }
  function btnState() { var b = $("anPlay"); if (b) b.innerHTML = sym(P.playing ? "pause" : "play_arrow"); }
  function reset() {
    pause();
    if (P.kind === "time" && P.layer) { P.layer.filter = P.orig || ""; GIS.emit("style"); GIS.emit("layers"); }
    P.kind = null; P.steps = []; P.layer = null;
    label("");
    var c = $("anCount"); if (c) c.textContent = "";
  }

  function prepareTime() {
    var l = GIS.get($("anLayer").value);
    if (!l) throw new Error("Choose a layer.");
    var field = $("anField").value;
    if (P.layer !== l || P.kind !== "time") { reset(); P.orig = l.filter || ""; }
    P.kind = "time"; P.layer = l; P.steps = steps(l, field, $("anUnit").value);
    show(0);
  }
  function prepareGfw() {
    reset();
    var y0 = +$("anG0").value, y1 = +$("anG1").value;
    P.kind = "gfw"; P.y0 = Math.min(y0, y1); P.tcd = +$("anGt").value;
    P.steps = [];
    for (var y = P.y0; y <= Math.max(y0, y1); y++) P.steps.push({ year: y, label: "Tree cover loss " + P.y0 + "–" + y });
    show(0);
  }

  /* ------------------------------------------------------------ camera */

  var KEYS = [];
  function drawKeys() {
    var box = $("anKeys");
    if (!box) return;
    box.innerHTML = KEYS.length ? KEYS.map(function (k, i) {
      return '<div class="anim-key"><b>' + (i + 1) + "</b><span>" + k.center[1].toFixed(3) + ", " + k.center[0].toFixed(3) + " · z" + k.zoom.toFixed(1) + (k.pitch ? " · tilt " + Math.round(k.pitch) + "°" : "") +
        '</span><button type="button" data-go="' + i + '" title="Go">' + sym("my_location") + '</button><button type="button" data-del="' + i + '" title="Remove">' + sym("close") + "</button></div>";
    }).join("") : '<div class="anim-empty">No keyframes yet. Move the map, then “Add view”.</div>';
  }
  function tour() {
    var m = map();
    if (KEYS.length < 2) { toast("Add at least two views."); return Promise.resolve(); }
    var dur = (+$("anLeg").value || 3) * 1000, i = 0;
    m.jumpTo(KEYS[0]);
    return new Promise(function (res) {
      function leg() {
        if (++i >= KEYS.length) { res(); return; }
        label($("anTitle").value || "");
        m.flyTo(Object.assign({ duration: dur, essential: true }, KEYS[i]));
        m.once("moveend", function () { setTimeout(leg, 350); });
      }
      setTimeout(leg, 500);
    });
  }
  function orbit() {
    var m = map(), b0 = m.getBearing(), t0 = performance.now(), secs = +$("anLeg").value * 4 || 12;
    if (m.getPitch() < 30) m.easeTo({ pitch: 55, duration: 800 });
    return new Promise(function (res) {
      function f(t) {
        var k = (t - t0) / (secs * 1000);
        if (k >= 1) { m.setBearing(b0); res(); return; }
        m.setBearing(b0 + 360 * k);
        requestAnimationFrame(f);
      }
      setTimeout(function () { t0 = performance.now(); requestAnimationFrame(f); }, 850);
    });
  }

  /* ------------------------------------------------------------ record */

  var REC = { on: false };
  function startRecord() {
    var m = map();
    if (!m || typeof MediaRecorder === "undefined") { toast("Recording is not supported here."); return false; }
    var src = m.getCanvas(), c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    var g = c.getContext("2d"), dpr = src.width / src.clientWidth;
    function frame() {
      g.drawImage(src, 0, 0);
      var title = $("anTitle").value.trim();
      if (title) {
        g.font = "600 " + Math.round(22 * dpr) + "px Inter, 'Segoe UI', Arial, sans-serif";
        var w = g.measureText(title).width;
        g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(16 * dpr, 16 * dpr, w + 28 * dpr, 40 * dpr);
        g.fillStyle = "#fff"; g.fillText(title, 30 * dpr, 44 * dpr);
      }
      if (P.label) {
        g.font = "700 " + Math.round(34 * dpr) + "px Inter, 'Segoe UI', Arial, sans-serif";
        var lw = g.measureText(P.label).width;
        g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(c.width - lw - 44 * dpr, c.height - 78 * dpr, lw + 28 * dpr, 52 * dpr);
        g.fillStyle = "#fff"; g.fillText(P.label, c.width - lw - 30 * dpr, c.height - 40 * dpr);
      }
      g.font = Math.round(10 * dpr) + "px Inter, Arial, sans-serif";
      g.fillStyle = "rgba(0,0,0,.6)";
      g.fillText("Ploots Click", 12 * dpr, c.height - 10 * dpr);
    }
    frame();
    m.on("render", frame);
    var type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].filter(function (t) { return MediaRecorder.isTypeSupported(t); })[0];
    var rec = new MediaRecorder(c.captureStream(30), { mimeType: type, videoBitsPerSecond: 6e6 }), chunks = [];
    rec.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      m.off("render", frame);
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
      a.download = ($("anTitle").value.trim() || "ploots-map-animation").replace(/[^\w-]+/g, "_") + ".webm";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      toast("Animation saved");
    };
    // Keep frames coming while the map is still.
    REC.tick = setInterval(function () { m.triggerRepaint(); }, 1000 / 30);
    rec.start(250);
    REC = { on: true, rec: rec, tick: REC.tick };
    $("anRec").classList.add("on");
    return true;
  }
  function stopRecord() {
    if (!REC.on) return;
    clearInterval(REC.tick);
    REC.rec.stop();
    REC.on = false;
    var b = $("anRec"); if (b) b.classList.remove("on");
  }

  /* --------------------------------------------------------------- UI */

  function build() {
    if ($(PANEL)) return;
    var p = document.createElement("div");
    p.id = PANEL;
    p.className = "sidebar-panel";
    var y = new Date().getFullYear() - 1, years = ""; for (var i = 2001; i <= y; i++) years += "<option" + (i === 2001 ? " selected" : "") + ">" + i + "</option>";
    var years1 = years.replace(" selected", "").replace("<option>" + y + "</option>", "<option selected>" + y + "</option>");
    p.innerHTML =
      '<div class="sp-head"><span class="sp-title">Map animation</span><button type="button" class="sp-close" title="Close panel">' + sym("keyboard_double_arrow_left") + "</button></div>" +
      '<div class="anim-body">' +
        '<div class="toggle-group anim-tabs"><button data-tab="time" class="active">Time</button><button data-tab="gfw">GFW loss</button><button data-tab="cam">Camera</button></div>' +
        '<div class="anim-pane" data-pane="time">' +
          '<label class="field-label">Layer</label><select id="anLayer"></select>' +
          '<label class="field-label">Time field</label><select id="anField"></select>' +
          '<div class="num-pair"><div><label class="field-label">Step</label><select id="anUnit"><option value="value">Each value</option><option value="day">Day</option><option value="month" selected>Month</option><option value="year">Year</option></select></div>' +
            '<div><label class="field-label">Show</label><select id="anMode"><option value="cum">Up to the step</option><option value="one">Only the step</option></select></div></div>' +
          '<button id="anPrepTime" style="width:100%;margin-top:10px;">' + sym("schedule") + "Set up time steps</button>" +
        "</div>" +
        '<div class="anim-pane" data-pane="gfw" hidden>' +
          '<div class="num-pair"><div><label class="field-label">From</label><select id="anG0">' + years + '</select></div><div><label class="field-label">To</label><select id="anG1">' + years1 + "</select></div></div>" +
          '<label class="field-label">Canopy density</label><select id="anGt"><option value="10">&gt; 10%</option><option value="30" selected>&gt; 30%</option><option value="50">&gt; 50%</option><option value="75">&gt; 75%</option></select>' +
          '<button id="anPrepGfw" style="width:100%;margin-top:10px;">' + sym("forest") + "Set up loss years</button>" +
        "</div>" +
        '<div class="anim-pane" data-pane="cam" hidden>' +
          '<div id="anKeys" class="anim-keys"></div>' +
          '<div class="anim-row"><button id="anAddKey">' + sym("add_a_photo") + "Add view</button><button id=\"anClearKeys\">" + sym("delete_sweep") + "Clear</button></div>" +
          '<label class="field-label">Seconds per leg</label><input type="number" id="anLeg" value="3" min="0.5" max="30" step="0.5">' +
          '<div class="anim-row"><button id="anTour" class="btn-primary">' + sym("flight") + "Play tour</button><button id=\"anOrbit\">" + sym("360") + "Orbit</button></div>" +
        "</div>" +
        '<div class="anim-player">' +
          '<div class="anim-controls"><button id="anFirst" title="First">' + sym("skip_previous") + '</button><button id="anPrev" title="Previous">' + sym("chevron_left") + '</button>' +
            '<button id="anPlay" class="anim-play" title="Play / pause">' + sym("play_arrow") + '</button><button id="anNext" title="Next">' + sym("chevron_right") + '</button><button id="anLast" title="Last">' + sym("skip_next") + "</button>" +
            '<span id="anCount"></span></div>' +
          '<input type="range" id="anPos" min="0" max="0" value="0">' +
          '<div class="num-pair"><div><label class="field-label">Frame time (ms)</label><input type="number" id="anSpeed" value="700" min="80" max="10000" step="50"></div>' +
            '<div><label class="field-label">&nbsp;</label><label class="check-row"><input type="checkbox" id="anLoop">Loop</label></div></div>' +
          '<button id="anStop" style="width:100%;margin-top:6px;">' + sym("restart_alt") + "Stop and restore the layer</button>" +
        "</div>" +
        '<div class="gfw-sub">' + sym("videocam") + "Record video</div>" +
        '<label class="field-label">Title on the video (optional)</label><input type="text" id="anTitle" placeholder="e.g. Kobo submissions, March 2026">' +
        '<button id="anRec" class="anim-rec">' + sym("fiber_manual_record") + "Record the animation (WebM)</button>" +
        '<p class="gfw-note">Recording plays the current animation (time steps, loss years, the tour or an orbit) from the start and saves a .webm video when it ends.</p>' +
      "</div>";
    document.querySelector(".sidebar").appendChild(p);
    p.querySelector(".sp-close").addEventListener("click", function () { window.closeSidebar(); });

    var tab = "time";
    p.querySelector(".anim-tabs").addEventListener("click", function (e) {
      var t = e.target.closest("[data-tab]");
      if (!t) return;
      tab = t.dataset.tab;
      Array.prototype.forEach.call(p.querySelectorAll(".anim-tabs [data-tab]"), function (x) { x.classList.toggle("active", x === t); });
      Array.prototype.forEach.call(p.querySelectorAll(".anim-pane"), function (x) { x.hidden = x.dataset.pane !== tab; });
      p.querySelector(".anim-player").style.display = tab === "cam" ? "none" : "";
    });
    function fillLayers() {
      var s = $("anLayer"), cur = s.value, ls = GIS.layers.filter(function (l) { return l.kind === "vector"; });
      s.innerHTML = ls.map(function (l) { return '<option value="' + l.id + '">' + esc(l.name) + "</option>"; }).join("") || '<option value="">No vector layers</option>';
      if (cur && s.querySelector('option[value="' + cur + '"]')) s.value = cur;
      fillFields();
    }
    function fillFields() {
      var l = GIS.get($("anLayer").value), s = $("anField"), f = l ? GIS.fields(l).all : [];
      // Likely time fields first.
      f.sort(function (a, b) { var ta = /date|time|year|tahun|tanggal|_submission/i.test(a), tb = /date|time|year|tahun|tanggal|_submission/i.test(b); return tb - ta; });
      s.innerHTML = f.map(function (k) { return "<option>" + esc(k) + "</option>"; }).join("");
    }
    $("anLayer").addEventListener("change", fillFields);
    GIS.on("layers", function () { if (p.classList.contains("active")) fillLayers(); });
    function guard(fn) { return function () { try { fn(); } catch (e) { toast(e.message); } }; }
    $("anPrepTime").addEventListener("click", guard(prepareTime));
    $("anPrepGfw").addEventListener("click", guard(prepareGfw));
    $("anPlay").addEventListener("click", function () { if (P.playing) pause(); else play(); });
    $("anPrev").addEventListener("click", function () { pause(); show(P.i - 1); });
    $("anNext").addEventListener("click", function () { pause(); show(P.i + 1); });
    $("anFirst").addEventListener("click", function () { pause(); show(0); });
    $("anLast").addEventListener("click", function () { pause(); show(P.steps.length - 1); });
    $("anPos").addEventListener("input", function () { pause(); show(+this.value); });
    $("anStop").addEventListener("click", reset);
    $("anAddKey").addEventListener("click", function () { var m = map(); KEYS.push({ center: m.getCenter().toArray(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() }); drawKeys(); });
    $("anClearKeys").addEventListener("click", function () { KEYS = []; drawKeys(); });
    $("anKeys").addEventListener("click", function (e) {
      var g = e.target.closest("[data-go]"), d = e.target.closest("[data-del]");
      if (g) map().flyTo(KEYS[+g.dataset.go]);
      if (d) { KEYS.splice(+d.dataset.del, 1); drawKeys(); }
    });
    $("anTour").addEventListener("click", function () { tour(); });
    $("anOrbit").addEventListener("click", function () { orbit(); });
    $("anRec").addEventListener("click", function () {
      if (REC.on) { stopRecord(); pause(); return; }
      if (tab === "cam") {
        if (!startRecord()) return;
        (KEYS.length >= 2 ? tour() : orbit()).then(function () { setTimeout(stopRecord, 400); });
        return;
      }
      if (!P.steps.length) { try { if (tab === "gfw") prepareGfw(); else prepareTime(); } catch (e) { toast(e.message); return; } }
      if (!startRecord()) return;
      show(0);
      setTimeout(play, 400);
    });
    drawKeys();

    // Rail button (Analysis only).
    var nav = document.querySelector(".sidebar-nav"), rb = document.createElement("button");
    rb.className = "nav-btn nav-gis nav-anim";
    rb.setAttribute("data-panel", PANEL);
    rb.title = "Map animation";
    rb.innerHTML = sym("animation") + '<span class="nav-lbl">Animate</span>';
    var tb = nav.querySelector('[data-panel="panel-gis-toolbox"]');
    if (tb) tb.after(rb); else nav.appendChild(rb);
    rb.addEventListener("click", function () { if (rb.classList.contains("active")) window.closeSidebar(); else { GIS.enterMapMode(); fillLayers(); activateSidebarPanel(PANEL); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(build, 60); }); else setTimeout(build, 60);

  GIS.animation = { steps: steps, reset: reset };
})();
