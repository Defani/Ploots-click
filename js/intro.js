/* ==========================================================================
   Intro — the launch screen, and the About screen.

   Shown for a moment when Ploots Click opens: a welcome, what the app is
   for, that it is Defani's private tool and not shared, the version and
   where the data lives. A click or any key skips it. PlootsIntro.about() opens the same
   screen as an About dialog (from the Home screen), which stays until
   closed.
   ========================================================================== */
(function () {
  "use strict";

  var VERSION = window.PLOOTS_VERSION = "1.0.0";
  var OWNER = "Defani Arman Alfitriansyah";
  var DURATION = 2400;

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  var desktop = !!window.__TAURI__;

  function build(about) {
    var el = document.createElement("div");
    el.className = "intro" + (about ? " intro-about" : "");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Ploots Click");
    el.innerHTML =
      '<div class="intro-card">' +
        (about ? '<button type="button" class="intro-close" title="Close"><span class="material-symbols-outlined">close</span></button>' : "") +
        '<div class="intro-logo"><img class="brand-logo-light" src="assets/logo_mark_light.png" alt="Ploots Click"><img class="brand-logo-dark" src="assets/logo_mark_dark.png" alt="Ploots Click"></div>' +
        '<h1 class="intro-welcome">Welcome to Ploots Click</h1>' +
        '<p class="intro-tag">Personal GIS, data analysis, visualization and field monitoring</p>' +
        '<div class="intro-rule"></div>' +
        '<p class="intro-owner">A private tool of<b>' + esc(OWNER) + "</b></p>" +
        '<p class="intro-private"><span class="material-symbols-outlined">person</span>For personal use only. Not for distribution.</p>' +
        '<p class="intro-privacy"><span class="material-symbols-outlined">lock</span>' +
          (desktop ? "Runs on this computer. Your files are never uploaded." : "Runs in your browser. Your files are never uploaded.") + "</p>" +
        (about ? "" : '<div class="intro-bar"><i></i></div>') +
        '<p class="intro-ver">Version ' + VERSION + (desktop ? " · Desktop" : " · Web") + " · © 2026 " + esc(OWNER) + "</p>" +
      "</div>";
    document.body.appendChild(el);
    return el;
  }

  function close(el) {
    if (!el || el.classList.contains("out")) return;
    el.classList.add("out");
    document.removeEventListener("keydown", el._key, true);
    setTimeout(function () { el.remove(); }, 450);
  }

  function launch() {
    var el = build(false);
    el._key = function (e) { if (!/^(Shift|Control|Alt|Meta)$/.test(e.key)) close(el); };
    el.addEventListener("click", function () { close(el); });
    document.addEventListener("keydown", el._key, true);
    setTimeout(function () { close(el); }, DURATION);
  }

  function about() {
    var el = build(true);
    el._key = function (e) { if (e.key === "Escape") { e.stopPropagation(); close(el); } };
    document.addEventListener("keydown", el._key, true);
    el.addEventListener("click", function (e) { if (e.target === el || e.target.closest(".intro-close")) close(el); });
  }

  window.PlootsIntro = { about: about, version: VERSION, owner: OWNER };
  if (document.body) launch(); else document.addEventListener("DOMContentLoaded", launch);
})();
