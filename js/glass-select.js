/* ==========================================================================
   Glass dropdowns: every single-choice <select> opens a frosted list of the
   app's own instead of the operating system's white one (which ignores the
   theme and can't be styled). The <select> stays the source of truth: the
   list reads its options and groups, and a pick sets its value and fires
   "input" and "change", so every panel keeps working unchanged. The list is
   as wide as its longest option, opens below (or above when there is no
   room) and closes on Esc, a click outside, scrolling or resizing.
   A select (or an ancestor) with data-native-select keeps the system list.
   ========================================================================== */
(function () {
  "use strict";

  var pop = null, cur = null;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function usable(sel) { return sel && !sel.multiple && !(sel.size > 1) && !sel.disabled && !sel.closest("[data-native-select]"); }
  function close() {
    if (pop) { pop.remove(); pop = null; }
    if (cur) { cur.classList.remove("gsel-open"); cur = null; }
  }
  function item(o) {
    return '<button type="button" class="gsel-opt' + (o.selected ? " on" : "") + '"' + (o.disabled ? " disabled" : "") + ' data-i="' + o.index + '">' + esc(o.textContent) + "</button>";
  }
  function open(sel) {
    close();
    if (!sel.options.length) return;
    cur = sel; sel.classList.add("gsel-open");
    var html = "";
    Array.prototype.forEach.call(sel.children, function (ch) {
      if (ch.tagName === "OPTGROUP") {
        html += '<div class="gsel-grp">' + esc(ch.label) + "</div>";
        Array.prototype.forEach.call(ch.children, function (o) { if (o.tagName === "OPTION" && !o.hidden) html += item(o); });
      } else if (ch.tagName === "OPTION" && !ch.hidden) html += item(ch);
    });
    pop = document.createElement("div");
    pop.className = "gsel-pop";
    pop.setAttribute("role", "listbox");
    pop.innerHTML = html;
    document.body.appendChild(pop);
    var r = sel.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    var w = Math.min(Math.max(r.width, pop.scrollWidth + 2), vw - 16);
    pop.style.minWidth = Math.round(r.width) + "px";
    pop.style.width = Math.round(w) + "px";
    var below = vh - r.bottom - 10, above = r.top - 10, h = Math.min(pop.scrollHeight, 340);
    var up = below < Math.min(h, 200) && above > below;
    pop.style.maxHeight = Math.max(120, Math.min(340, up ? above : below)) + "px";
    pop.style.left = Math.round(Math.max(8, Math.min(r.left, vw - w - 8))) + "px";
    if (up) pop.style.bottom = Math.round(vh - r.top + 4) + "px"; else pop.style.top = Math.round(r.bottom + 4) + "px";
    var on = pop.querySelector(".on");
    if (on) on.scrollIntoView({ block: "nearest" });
    pop.addEventListener("mousedown", function (e) { e.preventDefault(); });
    pop.addEventListener("click", function (e) {
      var b = e.target.closest(".gsel-opt");
      if (!b || b.disabled) return;
      var i = +b.dataset.i, s = cur;
      close();
      if (s.selectedIndex !== i) {
        s.selectedIndex = i;
        s.dispatchEvent(new Event("input", { bubbles: true }));
        s.dispatchEvent(new Event("change", { bubbles: true }));
      }
      s.focus();
    });
  }
  document.addEventListener("mousedown", function (e) {
    var sel = e.target && e.target.closest ? e.target.closest("select") : null;
    if (sel && usable(sel) && e.button === 0) {
      e.preventDefault();
      if (cur === sel) close(); else { sel.focus(); open(sel); }
      return;
    }
    if (pop && !pop.contains(e.target)) close();
  }, true);
  document.addEventListener("keydown", function (e) {
    if (pop) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); var s = cur; close(); if (s) s.focus(); return; }
      var opts = Array.prototype.slice.call(pop.querySelectorAll(".gsel-opt:not([disabled])"));
      var at = opts.indexOf(pop.querySelector(".gsel-opt.hi") || pop.querySelector(".gsel-opt.on"));
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        var n = Math.max(0, Math.min(opts.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
        opts.forEach(function (o) { o.classList.remove("hi"); });
        if (opts[n]) { opts[n].classList.add("hi"); opts[n].scrollIntoView({ block: "nearest" }); }
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        var hi = pop.querySelector(".gsel-opt.hi") || pop.querySelector(".gsel-opt.on");
        if (hi) hi.click(); else close();
      }
      return;
    }
    var t = document.activeElement;
    if (t && t.tagName === "SELECT" && usable(t) && (e.key === "Enter" || e.key === " " || (e.altKey && e.key === "ArrowDown"))) { e.preventDefault(); open(t); }
  }, true);
  window.addEventListener("resize", close);
  document.addEventListener("scroll", function (e) { if (pop && !pop.contains(e.target)) close(); }, true);
  window.PlootsSelect = { open: open, close: close };
})();
