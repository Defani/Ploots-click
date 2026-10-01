/* ==========================================================================
   Intro — the launch screen, sign-in, and the About screen.

   When GIS Consultant Studio opens: a welcome, what the app is for, that it is
   Defani's private tool and not shared, the version and where the data
   lives. With js/lock.js the same screen asks for the username and
   password (or, on the very first launch, sets up the account) and stays
   until the sign-in succeeds; the app behind it stays covered.

   PlootsIntro.about() opens the screen as an About dialog with an
   Account button (username, password, auto-lock). PlootsIntro.lockScreen()
   covers the app again (Lock button, auto-lock).
   ========================================================================== */
(function () {
  "use strict";

  var VERSION = window.PLOOTS_VERSION = "1.0.0";
  var OWNER = "Defani Arman Alfitriansyah";
  var DURATION = 2400;

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function sym(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  var desktop = !!window.__TAURI__;
  function Lk() { return window.PlootsLock || null; }

  // mode: "intro" (auto-closes), "signin", "setup", "about"
  function build(mode) {
    // Launch and lock: the full-screen showcase with sign-in at the top right.
    if (mode !== "about" && window.GCSSplash) {
      return window.GCSSplash.build({
        form: mode === "signin" ? signinForm() : mode === "setup" ? setupForm() : "",
        button: mode === "setup" ? "Set up account" : mode === "signin" ? "Sign in" : "Open the app",
        owner: esc(OWNER),
        privacy: desktop ? "Runs on this computer. Your files are never uploaded." : "Runs in your browser. Your files are never uploaded.",
        version: "Version " + VERSION + (desktop ? " · Desktop" : " · Web") + " · © 2026 " + esc(OWNER)
      });
    }
    var el = document.createElement("div");
    el.className = "intro" + (mode === "about" ? " intro-about" : "");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "GIS Consultant Studio");
    el.innerHTML =
      '<div class="intro-card">' +
        (mode === "about" ? '<button type="button" class="intro-close" title="Close">' + sym("close") + "</button>" : "") +
        '<div class="intro-logo">' + (window.GCSSplash ? window.GCSSplash.logo(64) : "") + "</div>" +
        '<h1 class="intro-welcome">Welcome to GIS Consultant Studio</h1>' +
        '<p class="intro-tag">Personal GIS, data analysis, visualization and field monitoring</p>' +
        '<div class="intro-rule"></div>' +
        '<p class="intro-owner">A private tool of<b>' + esc(OWNER) + "</b></p>" +
        '<p class="intro-private">' + sym("person") + "For personal use only. Not for distribution.</p>" +
        (mode === "signin" ? signinForm() : mode === "setup" ? setupForm() : "") +
        '<p class="intro-privacy">' + sym("lock") + (desktop ? "Runs on this computer. Your files are never uploaded." : "Runs in your browser. Your files are never uploaded.") + "</p>" +
        (mode === "intro" ? '<div class="intro-bar"><i></i></div>' : "") +
        (mode === "about" && Lk() ? '<div class="intro-actions"><button type="button" data-account>' + sym("manage_accounts") + (Lk().configured() ? "Account" : "Set a password") + "</button></div>" : "") +
        '<p class="intro-ver">Version ' + VERSION + (desktop ? " · Desktop" : " · Web") + " · © 2026 " + esc(OWNER) + "</p>" +
      "</div>";
    document.body.appendChild(el);
    return el;
  }

  function field(name, label, type, auto) {
    return '<label class="intro-field"><span>' + label + '</span><input name="' + name + '" type="' + type + '" autocomplete="' + auto + '" spellcheck="false" required>' +
      (type === "password" ? '<button type="button" class="intro-eye" tabindex="-1" title="Show password">' + sym("visibility") + "</button>" : "") + "</label>";
  }
  function signinForm() {
    return '<form class="intro-form" data-form="signin" novalidate>' +
      field("user", "Username", "text", "username") + field("pass", "Password", "password", "current-password") +
      '<p class="intro-err" aria-live="polite"></p>' +
      '<button type="submit" class="btn-primary intro-submit">Sign in</button>' +
      '<button type="button" class="intro-link" data-forgot>Forgot password?</button></form>';
  }
  function setupForm() {
    return '<form class="intro-form" data-form="setup" novalidate><p class="intro-form-title">Set up your account</p>' +
      field("user", "Username", "text", "username") + field("pass", "Password (8+ characters)", "password", "new-password") + field("pass2", "Confirm password", "password", "new-password") +
      '<p class="intro-err" aria-live="polite"></p>' +
      '<button type="submit" class="btn-primary intro-submit">Create account</button>' +
      '<p class="intro-note">The password protects GIS Consultant Studio on this device. It cannot be recovered.</p></form>';
  }

  function close(el) {
    if (!el || el.classList.contains("out")) return;
    el.classList.add("out");
    document.removeEventListener("keydown", el._key, true);
    if (el.classList.contains("intro-splash") && window.PlootsHome && !document.body.classList.contains("gis-mode") && !document.body.classList.contains("agro-open")) setTimeout(function () { window.PlootsHome.show(); }, 300);
    setTimeout(function () { el.remove(); }, 450);
  }

  // Keys typed while the lock screen is up never reach the app behind it.
  function trapKeys(el) {
    el._key = function (e) { if (!el.contains(e.target) && !e.target.closest(".intro-dlg")) { e.stopPropagation(); e.preventDefault(); } };
    document.addEventListener("keydown", el._key, true);
  }

  function wireForm(el, done) {
    var form = el.querySelector(".intro-form"), err = el.querySelector(".intro-err"), btn = el.querySelector(".intro-submit");
    el.addEventListener("click", function (e) {
      var eye = e.target.closest(".intro-eye");
      if (eye) {
        var inp = eye.parentNode.querySelector("input"), show = inp.type === "password";
        inp.type = show ? "text" : "password";
        eye.innerHTML = sym(show ? "visibility_off" : "visibility");
        return;
      }
      if (e.target.closest("[data-forgot]")) forgot();
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = {};
      Array.prototype.forEach.call(form.querySelectorAll("input"), function (i) { v[i.name] = i.value; });
      err.textContent = "";
      if (form.dataset.form === "setup" && v.pass !== v.pass2) { err.textContent = "The passwords do not match."; return; }
      btn.disabled = true;
      btn.textContent = form.dataset.form === "setup" ? "Creating…" : "Checking…";
      var p = form.dataset.form === "setup" ? Lk().setup(v.user, v.pass) : Lk().verify(v.user, v.pass);
      p.then(function () {
        if (Lk().refreshButton) Lk().refreshButton();
        Lk().unlock();
        done();
      }).catch(function (x) {
        err.textContent = x.message || String(x);
        btn.disabled = false;
        btn.textContent = form.dataset.form === "setup" ? "Create account" : "Sign in";
        var pw = form.querySelector('input[name="pass"]');
        if (form.dataset.form === "signin") { pw.value = ""; pw.focus(); }
        form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake");
      });
    });
    if (!el.classList.contains("intro-splash")) setTimeout(function () { var f = form.querySelector("input"); if (f) f.focus(); }, 350);
  }

  function lockScreen() {
    return; // no account in this app
    if (document.querySelector(".intro.intro-locked:not(.out)")) return;
    var L = Lk(), el = build(L.configured() ? "signin" : "setup");
    el.classList.add("intro-locked");
    trapKeys(el);
    wireForm(el, function () { close(el); });
  }

  // No account: the app opens straight to the splash and then Home.
  function launch() { plainIntro(); }

  function plainIntro() {
    var el = build("intro");
    if (el.classList.contains("intro-splash")) {
      // Loading, the welcome, then Home on its own (a click or key goes there at once).
      el.addEventListener("click", function () { close(el); });
      el._key = function (e) { if (!/^(Shift|Control|Alt|Meta)$/.test(e.key)) close(el); };
      document.addEventListener("keydown", el._key, true);
      setTimeout(function () { close(el); }, 6200);
      return;
    }
    el._key = function (e) { if (!/^(Shift|Control|Alt|Meta)$/.test(e.key)) close(el); };
    el.addEventListener("click", function () { close(el); });
    document.addEventListener("keydown", el._key, true);
    setTimeout(function () { close(el); }, DURATION);
  }

  function about() {
    var el = build("about");
    el._key = function (e) { if (e.key === "Escape" && !document.querySelector(".gis-dlg-back")) { e.stopPropagation(); close(el); } };
    document.addEventListener("keydown", el._key, true);
    el.addEventListener("click", function (e) {
      if (e.target.closest("[data-account]")) { close(el); account(); return; }
      if (e.target === el || e.target.closest(".intro-close")) close(el);
    });
  }

  /* ---------------------------------------------------------- dialogs */

  function modal(title, body, buttons) {
    var back = document.createElement("div");
    back.className = "gis-dlg-back intro-dlg";
    back.innerHTML = '<div class="gis-dlg" role="dialog" aria-label="' + esc(title) + '"><div class="gis-dlg-head"><span>' + esc(title) + '</span><button type="button" data-close title="Close">' + sym("close") + "</button></div>" +
      '<div class="gis-dlg-body">' + body + '</div><div class="gis-dlg-foot">' +
      buttons.map(function (b) { return '<button type="button" data-btn="' + b[0] + '"' + (b[2] ? ' class="btn-primary"' : "") + ">" + esc(b[1]) + "</button>"; }).join("") + "</div></div>";
    document.body.appendChild(back);
    function close() { back.remove(); document.removeEventListener("keydown", key, true); }
    function key(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
    document.addEventListener("keydown", key, true);
    back.addEventListener("mousedown", function (e) { if (e.target === back) close(); });
    back.querySelector("[data-close]").addEventListener("click", close);
    return { el: back, close: close, q: function (s) { return back.querySelector(s); } };
  }

  function account() {
    var L = Lk(), has = L.configured();
    var body = '<div class="gis-props-grid">' +
      '<label class="field-label">Username</label><input type="text" data-a="user" value="' + esc(L.user()) + '" autocomplete="username">' +
      (has ? '<label class="field-label">Current password</label><input type="password" data-a="cur" autocomplete="current-password">' : "") +
      '<label class="field-label">New password</label><input type="password" data-a="next" autocomplete="new-password" placeholder="' + (has ? "Leave empty to keep" : "8+ characters") + '">' +
      '<label class="field-label">Confirm</label><input type="password" data-a="next2" autocomplete="new-password">' +
      '<label class="field-label">Auto-lock</label><select data-a="auto">' + [[0, "Never"], [5, "After 5 minutes"], [15, "After 15 minutes"], [30, "After 30 minutes"], [60, "After 1 hour"]].map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === L.autoLockMinutes() ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></div>" +
      '<p class="intro-err" data-err></p>';
    var d = modal(has ? "Account" : "Set a password", body, (has ? [["remove", "Remove password"]] : []).concat([["cancel", "Cancel"], ["save", "Save", true]]));
    d.el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-btn]");
      if (!b) return;
      var v = {}, err = d.q("[data-err]");
      Array.prototype.forEach.call(d.el.querySelectorAll("[data-a]"), function (i) { v[i.dataset.a] = i.value; });
      if (b.dataset.btn === "cancel") { d.close(); return; }
      err.textContent = "";
      var p;
      if (b.dataset.btn === "remove") {
        if (!confirm("Remove the password? Anyone who opens GIS Consultant Studio on this device can then use it.")) return;
        p = L.remove(v.cur);
      } else {
        if (v.next !== v.next2) { err.textContent = "The new passwords do not match."; return; }
        if (!has) p = L.setup(v.user, v.next);
        else if (v.next) p = L.changePassword(v.cur, v.user, v.next);
        else p = L.verify(L.user(), v.cur).then(function () { return L.setup(v.user, v.cur); });
        p = p.then(function () { L.setAutoLock(+v.auto); });
      }
      p.then(function () { if (L.refreshButton) L.refreshButton(); d.close(); toast(b.dataset.btn === "remove" ? "Password removed" : "Account saved"); })
        .catch(function (x) { err.textContent = x.message || String(x); });
    });
  }

  function forgot() {
    var d = modal("Forgot password",
      "<p>The password cannot be recovered. Resetting removes the account <b>and everything GIS Consultant Studio saved on this device</b>: plugins, connected folders, Kobo and chat settings. Files on disk are not touched.</p>" +
      '<label class="field-label">Type RESET to confirm</label><input type="text" data-reset spellcheck="false">',
      [["cancel", "Cancel"], ["reset", "Reset GIS Consultant Studio", true]]);
    d.el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-btn]");
      if (!b) return;
      if (b.dataset.btn === "cancel") { d.close(); return; }
      if (d.q("[data-reset]").value.trim() !== "RESET") { d.q("[data-reset]").focus(); return; }
      Lk().reset();
    });
  }

  function toast(m) { if (window.PlootsKobo && window.PlootsKobo.toast) window.PlootsKobo.toast(m); }

  window.PlootsIntro = { about: about, lockScreen: lockScreen, account: account, version: VERSION, owner: OWNER };
  if (document.body) launch(); else document.addEventListener("DOMContentLoaded", launch);
})();
