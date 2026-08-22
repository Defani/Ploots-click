function wireContextMenu() {
  var menu = document.getElementById("fabricCtxMenu");
  var arrangeWrap = document.getElementById("ctxArrangeWrap");

  fabricCanvas.upperCanvasEl.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    if (elementsLocked) return;
    var target = fabricCanvas.findTarget(e, false);
    if (!target || target === chartProxyObj) {
      hideCtxMenu();
      return;
    }
    var already = fabricCanvas.getActiveObjects();
    if (!already.length || already.indexOf(target) === -1) {
      fabricCanvas.setActiveObject(target);
      fabricCanvas.renderAll();
    }
    showCtxMenu(e.clientX, e.clientY);
  });

  var duplicateBtn = document.getElementById("ctxDuplicate");
  duplicateBtn && duplicateBtn.addEventListener("click", duplicateActiveObject);

  var deleteBtn = document.getElementById("ctxDelete");
  deleteBtn && deleteBtn.addEventListener("click", deleteActiveObject);

  var lockBtn = document.getElementById("ctxLock");
  lockBtn && lockBtn.addEventListener("click", toggleActiveObjectLock);

  var arrangeBtn = document.getElementById("ctxArrange");
  var arrangeCloseTimer = null;
  function openArrangeSubmenu() {
    if (arrangeCloseTimer) { clearTimeout(arrangeCloseTimer); arrangeCloseTimer = null; }
    if (arrangeWrap.classList.contains("ctx-submenu-open")) return;
    arrangeWrap.classList.add("ctx-submenu-open");
    var wrapBox = arrangeWrap.getBoundingClientRect();
    arrangeWrap.classList.toggle("ctx-submenu-left", wrapBox.right + 224 > window.innerWidth);
  }
  function closeArrangeSubmenu() {
    if (arrangeCloseTimer) clearTimeout(arrangeCloseTimer);
    arrangeCloseTimer = setTimeout(function () {
      arrangeWrap.classList.remove("ctx-submenu-open");
    }, 150);
  }
  arrangeWrap && arrangeWrap.addEventListener("mouseenter", openArrangeSubmenu);
  arrangeWrap && arrangeWrap.addEventListener("mouseleave", closeArrangeSubmenu);
  arrangeBtn && arrangeBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (arrangeWrap.classList.contains("ctx-submenu-open")) {
      if (arrangeCloseTimer) { clearTimeout(arrangeCloseTimer); arrangeCloseTimer = null; }
      arrangeWrap.classList.remove("ctx-submenu-open");
    } else {
      openArrangeSubmenu();
    }
  });

  bindCtxAction("ctxBringFront", function (o) { fabricCanvas.bringToFront(o); });
  bindCtxAction("ctxBringForward", function (o) { fabricCanvas.bringForward(o); });
  bindCtxAction("ctxSendBackward", function (o) { fabricCanvas.sendBackwards(o); });
  bindCtxAction("ctxSendBack", function (o) { fabricCanvas.sendToBack(o); });
  bindCtxAction("ctxFlipH", function (o) { o.set("flipX", !o.flipX); });
  bindCtxAction("ctxFlipV", function (o) { o.set("flipY", !o.flipY); });

  var groupBtn = document.getElementById("ctxGroup");
  groupBtn && groupBtn.addEventListener("click", function () {
    groupActiveObjects();
    hideCtxMenu();
  });

  var ungroupBtn = document.getElementById("ctxUngroup");
  ungroupBtn && ungroupBtn.addEventListener("click", function () {
    ungroupActiveObject();
    hideCtxMenu();
  });

  document.addEventListener("mousedown", function (e) {
    if (menu && !menu.contains(e.target)) hideCtxMenu();
  });
}

function bindCtxAction(id, fn) {
  var btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener("click", function () {
    var obj = fabricCanvas.getActiveObject();
    if (obj && obj !== chartProxyObj) {
      fn(obj);
      fabricCanvas.requestRenderAll();
    }
    hideCtxMenu();
  });
}

function groupActiveObjects() {
  var sel = fabricCanvas.getActiveObject();
  if (!sel || sel.type !== "activeSelection" || sel.size() < 2) return;
  var group = sel.toGroup();
  fabricCanvas.setActiveObject(group);
  fabricCanvas.requestRenderAll();
}

function ungroupActiveObject() {
  var group = fabricCanvas.getActiveObject();
  if (!group || group.type !== "group") return;
  group.toActiveSelection();
  fabricCanvas.requestRenderAll();
}

function toggleActiveObjectLock() {
  var obj = fabricCanvas.getActiveObject();
  if (!obj || obj === chartProxyObj) return;
  var locked = !obj.lockMovementX;
  obj.set({
    lockMovementX: locked,
    lockMovementY: locked,
    lockScalingX: locked,
    lockScalingY: locked,
    lockRotation: locked,
    hasControls: !locked,
    selectable: !locked
  });
  fabricCanvas.requestRenderAll();
  updateCtxMenuState(obj);
}

function updateCtxMenuState(obj) {
  var lockBtn = document.getElementById("ctxLock");
  if (lockBtn) {
    var locked = !!obj.lockMovementX;
    lockBtn.classList.toggle("ctx-item-active", locked);
    lockBtn.querySelector(".ctx-item-label").textContent = locked ? "Unlock" : "Lock";
    lockBtn.querySelector(".material-symbols-outlined").textContent = locked ? "lock" : "lock_open";
  }
  var groupBtn = document.getElementById("ctxGroup");
  var ungroupBtn = document.getElementById("ctxUngroup");
  if (groupBtn) groupBtn.disabled = !(obj.type === "activeSelection" && obj.size() >= 2);
  if (ungroupBtn) ungroupBtn.disabled = obj.type !== "group";
}

function showCtxMenu(clientX, clientY) {
  var menu = document.getElementById("fabricCtxMenu");
  if (!menu) return;
  var stage = document.getElementById("canvasStage");
  var rect = stage.getBoundingClientRect();
  var scale = parseFloat(stage.style.transform.replace("scale(", "").replace(")", "")) || 1;
  var left = (clientX - rect.left) / scale;
  var top = (clientY - rect.top) / scale;

  menu.style.left = left + "px";
  menu.style.top = top + "px";
  menu.style.display = "flex";
  var arrangeWrap = document.getElementById("ctxArrangeWrap");
  arrangeWrap && arrangeWrap.classList.remove("ctx-submenu-open", "ctx-submenu-left");
  var obj = fabricCanvas.getActiveObject();
  if (obj) updateCtxMenuState(obj);

  var menuBox = menu.getBoundingClientRect();
  var overflowRight = menuBox.right - window.innerWidth;
  var overflowBottom = menuBox.bottom - window.innerHeight;
  if (overflowRight > 0) left -= overflowRight / scale + 4;
  if (overflowBottom > 0) top -= overflowBottom / scale + 4;
  menu.style.left = Math.max(0, left) + "px";
  menu.style.top = Math.max(0, top) + "px";
}

function hideCtxMenu() {
  var menu = document.getElementById("fabricCtxMenu");
  if (menu) menu.style.display = "none";
  var arrangeWrap = document.getElementById("ctxArrangeWrap");
  arrangeWrap && arrangeWrap.classList.remove("ctx-submenu-open");
}
