/* Quick tooltips for icon-only buttons (top bar, tool rail, layout tools):
   the button's title shows right away under it, instead of the browser's
   slow tooltip. The title is kept for accessibility. */
(function () {
  "use strict";
  var tip = null, cur = null, SEL = ".topbar button[title], .topbar [data-tip], .sidebar-nav button[title], .lt-tools button[title], .gis-map-tools button[title], .ag-nav3d button[title], .view-switch button[title]";
  function show(el) {
    var text = el.getAttribute("data-tip") || el.getAttribute("title");
    if (!text) return;
    if (!tip) { tip = document.createElement("div"); tip.className = "gcs-tip"; document.body.appendChild(tip); }
    // Hide the native tooltip while ours is up.
    if (el.hasAttribute("title")) { el.setAttribute("data-tip", text); el.removeAttribute("title"); }
    tip.textContent = text;
    var r = el.getBoundingClientRect(), vertical = el.closest(".sidebar-nav, .lt-tools");
    tip.classList.add("on");
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var x = vertical ? r.right + 8 : Math.min(innerWidth - w - 6, Math.max(6, r.left + r.width / 2 - w / 2));
    var y = vertical ? r.top + r.height / 2 - h / 2 : (r.bottom + h + 8 > innerHeight ? r.top - h - 6 : r.bottom + 6);
    tip.style.left = x + "px"; tip.style.top = y + "px";
    cur = el;
  }
  function hide() { if (tip) tip.classList.remove("on"); cur = null; }
  document.addEventListener("mouseover", function (e) {
    var el = e.target.closest && e.target.closest(SEL);
    if (el === cur) return;
    if (el) show(el); else hide();
  });
  document.addEventListener("mousedown", hide, true);
  window.addEventListener("scroll", hide, true);
})();
