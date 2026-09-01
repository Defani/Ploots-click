function applyCanvasBg() {
  var bg = (state && state.canvasBg) || "#ffffff";
  var stage = document.getElementById("canvasStage");
  if (stage) stage.style.background = bg === "transparent" ? "transparent" : bg;
  var fsCanvas = document.querySelector(".fs-canvas");
  if (fsCanvas) fsCanvas.style.background = bg === "transparent" ? "transparent" : bg;
  var swatch = document.getElementById("canvasBgSwatch");
  if (swatch) {
    swatch.style.background =
      bg === "transparent"
        ? "linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%)"
        : bg;
    swatch.style.backgroundSize = bg === "transparent" ? "8px 8px" : "";
    swatch.style.backgroundPosition = bg === "transparent" ? "0 0,0 4px,4px -4px,-4px 0" : "";
  }
  var presets = document.querySelectorAll("#canvasBgPresets .swatch-btn");
  presets.forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-bg") === bg);
  });
}

function setCanvasBg(hex) {
  state.canvasBg = hex;
  applyCanvasBg();
  if (typeof render === "function") render();
}

function wireCanvasBg() {
  var btn = document.getElementById("canvasBgBtn");
  if (btn) {
    btn.addEventListener("click", function () {
      var current = state.canvasBg === "transparent" ? "#ffffff" : state.canvasBg || "#ffffff";
      openColorPicker({
        title: "Canvas color",
        hex: current,
        alpha: 1,
        showAlpha: false,
        anchorBtn: btn,
        onChange: function (hex) {
          setCanvasBg(hex);
        },
      });
    });
  }
  var presets = document.querySelectorAll("#canvasBgPresets .swatch-btn");
  presets.forEach(function (p) {
    p.addEventListener("click", function () {
      setCanvasBg(p.getAttribute("data-bg"));
    });
  });
  applyCanvasBg();
}

wireCanvasBg();
