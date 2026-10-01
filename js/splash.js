/* ==========================================================================
   Splash — what the app shows when it opens:
     1. a short loading screen with the animated logo,
     2. Defani's welcome as chat bubbles (with the sign-in form under them
        when the app is locked),
     3. then Home with its three modes.
   Light: no video, no external assets beyond the round portrait.

   GCSSplash.logo(size)   the logo mark as inline SVG (also assets/logo.svg)
   GCSSplash.build(opts)  {form, button, owner, version} -> the .intro element
   ========================================================================== */
(function () {
  "use strict";

  var MARK = '<circle cx="32" cy="32" r="31" fill="#4e8a2e"/><path d="M11 45.5 32 56l21-10.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 3"/><path d="M11 40 32 29.5 53 40 32 50.5z" fill="#5f9c3c" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/><ellipse cx="32" cy="40.5" rx="11" ry="5" fill="none" stroke="#fff" stroke-width="1.5"/><ellipse cx="32" cy="40.5" rx="5.5" ry="2.4" fill="none" stroke="#fff" stroke-width="1.5"/><path class="sp-pin" d="M32 40c-6.6-6.4-10-11.3-10-16.2a10 10 0 0 1 20 0c0 4.9-3.4 9.8-10 16.2z" fill="#fff"/><ellipse class="sp-bean" cx="32" cy="23.6" rx="4" ry="5.6" transform="rotate(28 32 23.6)" fill="#4e8a2e"/><path class="sp-bean" d="M30.4 19.2c2.2 2-0.9 5.2 1.6 9" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>';
  function logo(size, cls) { return '<svg class="gcs-logo ' + (cls || "") + '" viewBox="0 0 64 64" width="' + (size || 32) + '" height="' + (size || 32) + '" aria-hidden="true">' + MARK + "</svg>"; }

  function build(opts) {
    var el = document.createElement("div");
    el.className = "intro intro-splash";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "GIS Consultant Studio");
    el.innerHTML =
      '<div class="sp-load">' + logo(96, "sp-logo") + '<b>GIS Consultant Studio</b><div class="sp-bar"><i></i></div></div>' +
      '<div class="sp-hello">' +
        '<div class="sp-who"><img class="sp-avatar" src="assets/landing/defani.jpg" alt=""><div><b>Defani Arman</b><span>GIS Consultant Studio</span></div></div>' +
        '<div class="sp-bubbles">' +
          '<p style="--d:.2s">Hello! 👋</p>' +
          '<p style="--d:.9s">Welcome to <b>GIS Consultant Studio</b>.</p>' +
          '<p style="--d:1.7s">This is my private tool. It supports my work on the Gayo coffee landscape: field data, forest and deforestation checks, agroforestry models, and the maps and charts that come out of them.</p>' +
        "</div>" +
        '<div class="sp-act" style="--d:2.6s">' + (opts.form || '<button type="button" class="btn-primary sp-go">' + (opts.button || "Open") + "</button>") + "</div>" +
        '<p class="sp-ver">' + (opts.version || "") + "</p>" +
      "</div>";
    document.body.appendChild(el);
    // Loading, then the welcome.
    setTimeout(function () {
      el.classList.add("hello");
      setTimeout(function () { var f = el.querySelector(".intro-form input"); if (f) f.focus(); }, 2800);
    }, 1500);
    return el;
  }
  window.GCSSplash = { logo: logo, build: build };
  // Kept for code that still asks for the landing logo.
  window.GCSLanding = window.GCSLanding || { logo: logo };
})();
