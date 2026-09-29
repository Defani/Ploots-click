/* ==========================================================================
   Desktop app integration (Tauri). Does nothing in the browser.

   In the desktop app, links to web pages (the GitHub link, data sources,
   Kobo, ...) open in the default browser instead of inside the app window,
   and window.open() for http(s) URLs does the same.
   ========================================================================== */
(function () {
  "use strict";

  var T = window.__TAURI__;
  if (!T) return;
  document.documentElement.classList.add("is-desktop");

  function openExternal(url) {
    if (T.opener && T.opener.openUrl) return T.opener.openUrl(url);
    return T.core.invoke("plugin:opener|open_url", { url: url });
  }

  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.hasAttribute("download")) return;
    var href = a.getAttribute("href");
    if (!/^(https?:|mailto:)/i.test(href)) return;
    e.preventDefault();
    openExternal(a.href);
  }, true);

  var nativeOpen = window.open;
  window.open = function (url) {
    if (typeof url === "string" && /^(https?:|mailto:)/i.test(url)) { openExternal(url); return null; }
    return nativeOpen.apply(window, arguments);
  };
})();
