function getFabricOverlayDataUrl(scale) {
  if (!fabricCanvas) return null;
  var active = fabricCanvas.getActiveObject();
  fabricCanvas.discardActiveObject();
  if (chartProxyObj) chartProxyObj.visible = false;
  fabricCanvas.renderAll();
  var url = fabricCanvas.toDataURL({ format: "png", multiplier: scale || 1 });
  if (chartProxyObj) chartProxyObj.visible = true;
  if (active) fabricCanvas.setActiveObject(active);
  fabricCanvas.renderAll();
  return url;
}

// Vector counterpart of getFabricOverlayDataUrl — used by SVG export and
// the "Vector" PDF mode. Fabric's own toSVG() already emits a full,
// self-contained <svg> sized to the canvas (same coordinate space as the
// PNG overlay above), so this just hides the chart placeholder the same
// way, grabs the markup, and restores selection/visibility exactly like
// the raster path.
function getFabricOverlaySvgMarkup() {
  if (!fabricCanvas) return null;
  var active = fabricCanvas.getActiveObject();
  fabricCanvas.discardActiveObject();
  if (chartProxyObj) chartProxyObj.visible = false;
  fabricCanvas.renderAll();
  var svg = fabricCanvas.toSVG();
  if (chartProxyObj) chartProxyObj.visible = true;
  if (active) fabricCanvas.setActiveObject(active);
  fabricCanvas.renderAll();
  return svg;
}
