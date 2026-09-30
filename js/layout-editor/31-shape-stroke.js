/* ==========================================================================
   Shapes keep their outline width when they are stretched.

   Fabric scales an object's stroke together with the object, so a frame
   drawn with a 2 px outline and stretched to a wide rectangle ended up
   with thick sides and thin top / bottom. Every shape now draws its stroke
   at the set width whatever its scale (strokeUniform), and rectangles are
   resized for real when a drag ends (width / height instead of scale),
   which also keeps rounded corners round.
   ========================================================================== */
(function () {
  "use strict";

  var SHAPES = /^(rect|circle|ellipse|triangle|polygon|polyline|path|line)$/;

  function uniform(o) {
    if (!o || o.isChartProxy || o.gisItem) return;
    if (SHAPES.test(o.type)) o.strokeUniform = true;
    else if (o.type === "group" && o.getObjects) o.getObjects().forEach(uniform);
  }

  // A stretched rectangle becomes a rectangle of that size at scale 1.
  function bakeRect(o) {
    if (!o || o.type !== "rect" || o.group || o.gisItem || o.isChartProxy) return;
    if (Math.abs(o.scaleX - 1) < 1e-6 && Math.abs(o.scaleY - 1) < 1e-6) return;
    o.set({ width: o.width * o.scaleX, height: o.height * o.scaleY, scaleX: 1, scaleY: 1 });
    o.setCoords();
  }

  function hook() {
    var fc = window.fabricCanvas;
    if (!fc || fc._strokeHooked) return;
    fc._strokeHooked = true;
    fc.getObjects().forEach(uniform);
    fc.on("object:added", function (e) { uniform(e.target); });
    fc.on("object:modified", function (e) {
      var t = e.target;
      if (!t) return;
      if (t.type === "activeSelection") return; // members keep their own scale inside the selection
      bakeRect(t);
      fc.requestRenderAll();
    });
    fc.requestRenderAll();
  }
  document.addEventListener("ploots:canvasready", hook);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(hook, 0); }); else setTimeout(hook, 0);
})();
