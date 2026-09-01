function wireTextboxResize() {
  fabricCanvas.on("object:scaling", function (opt) {
    var target = opt.target;
    if (!target || target.type !== "textbox") return;
    var corner = opt.transform && opt.transform.corner;
    if (corner !== "mt" && corner !== "mb") return;
    if (target.scaleY === 1) return;

    var minHeight = target.fontSize * (target.lineHeight || 1.16) + 2;
    var newHeight = Math.max(minHeight, target.height * target.scaleY);

    target.set({ height: newHeight, scaleY: 1 });
    target.setCoords();
  });
}
