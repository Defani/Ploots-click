/* ==========================================================================
   Layers panel (right-hand floating panel over the canvas).

   Lets the user manage z-order/visibility/naming of every object on the
   Fabric canvas the same way a design tool would:
     - rename          (double-click a layer's name)
     - show/hide        (eye icon)
     - reorder           (drag the handle, or the up/down arrows)
     - duplicate / delete (hover actions)
     - group / ungroup   (multi-select with Ctrl/Cmd or Shift, header buttons)

   The chart itself is shown as a pinned, non-draggable "Chart" row at the
   bottom of the list (it's the transparent proxy object used elsewhere in
   the layout editor to let users move/resize the chart block).
   ========================================================================== */

var layersExpandedGroups = new Set();
var layersDragObj = null;
var layersIdCounter = 1;
var layersRefreshQueued = false;

function wireLayersPanel() {
  if (!fabricCanvas || fabricCanvas._layersPanelWired) return;
  fabricCanvas._layersPanelWired = true;

  // The panel is permanently open (Excel-style docked pane), so the header
  // no longer collapses/expands it on click.

  var groupBtn = document.getElementById("layersGroupBtn");
  groupBtn && groupBtn.addEventListener("click", function () {
    if (typeof groupActiveObjects === "function") groupActiveObjects();
    refreshLayersPanel();
  });

  var ungroupBtn = document.getElementById("layersUngroupBtn");
  ungroupBtn && ungroupBtn.addEventListener("click", function () {
    if (typeof ungroupActiveObject === "function") ungroupActiveObject();
    refreshLayersPanel();
  });

  fabricCanvas.on("object:added", scheduleLayersRefresh);
  fabricCanvas.on("object:removed", scheduleLayersRefresh);
  fabricCanvas.on("object:modified", scheduleLayersRefresh);
  fabricCanvas.on("selection:created", onLayersSelectionChange);
  fabricCanvas.on("selection:updated", onLayersSelectionChange);
  fabricCanvas.on("selection:cleared", onLayersSelectionChange);
  // Keep text layer names/thumbnails in step with typing.
  fabricCanvas.on("text:changed", scheduleLayersRefresh);
  fabricCanvas.on("text:editing:exited", scheduleLayersRefresh);

  wireLayerMenu();
  refreshLayersPanel();
}

function scheduleLayersRefresh() {
  if (layersRefreshQueued) return;
  layersRefreshQueued = true;
  requestAnimationFrame(function () {
    layersRefreshQueued = false;
    refreshLayersPanel();
  });
}

function onLayersSelectionChange() {
  updateLayersHeaderButtons();
  highlightActiveLayerRows();
}

function ensureLayerId(obj) {
  if (!obj.__layerId) obj.__layerId = "layer" + layersIdCounter++;
  return obj.__layerId;
}

function baseTypeInfo(obj) {
  if (obj.isMathObject) return { key: "formula", label: "Formula", icon: "functions" };
  switch (obj.type) {
    case "textbox":
    case "i-text":
    case "text":
      return { key: "text", label: "Text", icon: "title" };
    case "image":
      return { key: "image", label: "Image", icon: "image" };
    case "rect":
      return { key: "rect", label: "Rectangle", icon: "crop_square" };
    case "ellipse":
      return { key: "ellipse", label: "Ellipse", icon: "circle" };
    case "triangle":
      return { key: "triangle", label: "Triangle", icon: "change_history" };
    case "line":
      return { key: "line", label: "Line", icon: "horizontal_rule" };
    case "polygon":
    case "polyline":
      return { key: "polygon", label: "Polygon", icon: "pentagon" };
    case "path":
      return { key: "path", label: "Path", icon: "gesture" };
    case "group":
      return { key: "group", label: "Group", icon: "folder" };
    default:
      return { key: "object", label: "Object", icon: "category" };
  }
}

function assignLabelsRecursive(obj, counts) {
  var info = baseTypeInfo(obj);
  counts[info.key] = (counts[info.key] || 0) + 1;
  obj.__layerAutoLabel = info.label + " " + counts[info.key];
  if (obj.type === "group" && !obj.isMathObject && obj._objects && obj._objects.length) {
    var childCounts = {};
    obj._objects.forEach(function (child) { assignLabelsRecursive(child, childCounts); });
  }
}

function isTextLayer(obj) {
  return obj.type === "textbox" || obj.type === "i-text" || obj.type === "text";
}

// Text layers are named after their content (like Canva) unless renamed.
function layerDisplayName(obj) {
  if (obj.layerName && obj.layerName.trim()) return obj.layerName;
  if (isTextLayer(obj)) {
    var first = String(obj.text || "").split("\n")[0].replace(/^•\s*/, "").trim();
    if (first) return first.length > 48 ? first.slice(0, 48) + "…" : first;
  }
  return obj.__layerAutoLabel || "Object";
}

function layerSubLabel(obj) {
  var info = baseTypeInfo(obj);
  if (isTextLayer(obj)) {
    var font = String(obj.fontFamily || "").split(",")[0].replace(/['"]/g, "");
    return info.label + (font ? " · " + font : "") + " · " + Math.round(obj.fontSize || 0);
  }
  if (obj.type === "group" && !obj.isMathObject && obj._objects) return info.label + " · " + obj._objects.length + " items";
  return info.label;
}

// Small rendered preview of the object, like the thumbnails in Canva's
// layers list. Text gets an "Aa" swatch in its own font/color instead,
// since a scaled-down sentence is unreadable.
function buildLayerThumb(obj) {
  var box = document.createElement("span");
  box.className = "layer-thumb";
  if (isTextLayer(obj)) {
    var g = document.createElement("span");
    g.className = "layer-thumb-glyph";
    g.textContent = "Aa";
    g.style.fontFamily = obj.fontFamily || "";
    g.style.fontWeight = obj.fontWeight || "";
    g.style.fontStyle = obj.fontStyle || "";
    if (typeof obj.fill === "string" && obj.fill !== "transparent") g.style.color = obj.fill;
    else if (obj.stroke) { g.style.color = "transparent"; g.style.webkitTextStroke = "1px " + obj.stroke; }
    box.appendChild(g);
    return box;
  }
  var url = null;
  try {
    var br = obj.getBoundingRect(true, true);
    var m = Math.min(4, 88 / Math.max(br.width, 1), 68 / Math.max(br.height, 1));
    if (obj.visible !== false) url = obj.toDataURL({ format: "png", multiplier: m });
  } catch (err) { url = null; }
  if (url) {
    var img = document.createElement("img");
    img.alt = "";
    img.src = url;
    box.appendChild(img);
  } else {
    var ic = document.createElement("span");
    ic.className = "material-symbols-outlined";
    ic.textContent = baseTypeInfo(obj).icon;
    box.appendChild(ic);
  }
  return box;
}

function makeLayerTool(icon, title, on, handler) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "layer-tool" + (on ? " on" : "");
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML = '<span class="material-symbols-outlined">' + icon + "</span>";
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    handler(btn, e);
  });
  return btn;
}

function setLayerLocked(obj, locked) {
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
  refreshLayersPanel();
  if (typeof historyNotifyChange === "function") historyNotifyChange();
}

// ---- Per-layer "⋯" menu ----------------------------------------------------
var layerMenuTarget = null;

function openLayerMenu(obj, anchor) {
  var menu = document.getElementById("layerMenu");
  if (!menu) return;
  if (menu.classList.contains("open") && layerMenuTarget === obj) { closeLayerMenu(); return; }
  layerMenuTarget = obj;
  menu.classList.add("open");
  var r = anchor.getBoundingClientRect();
  var mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + "px";
  menu.style.top = (r.bottom + 4 + mh > window.innerHeight ? r.top - mh - 4 : r.bottom + 4) + "px";
}

function closeLayerMenu() {
  var menu = document.getElementById("layerMenu");
  if (menu) menu.classList.remove("open");
  layerMenuTarget = null;
}

function wireLayerMenu() {
  var menu = document.getElementById("layerMenu");
  if (!menu) return;
  menu.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-act]");
    var obj = layerMenuTarget;
    closeLayerMenu();
    if (!btn || !obj) return;
    var act = btn.getAttribute("data-act");
    if (act === "rename") {
      var row = document.querySelector('.layer-row[data-layer-id="' + obj.__layerId + '"]');
      if (row) startLayerRename(obj, row);
    } else if (act === "duplicate") duplicateLayerObject(obj);
    else if (act === "up") moveLayerObject(obj, "up");
    else if (act === "down") moveLayerObject(obj, "down");
    else if (act === "delete") deleteLayerObject(obj);
  });
  document.addEventListener("mousedown", function (e) {
    if (!e.target.closest("#layerMenu, .layer-tool-more")) closeLayerMenu();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeLayerMenu();
  });
  var body = document.querySelector(".layers-body");
  body && body.addEventListener("scroll", closeLayerMenu);
}

function refreshLayersPanel() {
  if (!fabricCanvas) return;
  var list = document.getElementById("layersList");
  var empty = document.getElementById("layersEmptyMsg");
  if (!list) return;

  var objs = fabricCanvas.getObjects().filter(function (o) { return o !== chartProxyObj; });
  if (empty) empty.style.display = objs.length ? "none" : "";
  var count = document.getElementById("layersCount");
  if (count) count.textContent = objs.length ? objs.length : "";
  // Don't rebuild under an in-progress rename; it would drop the input.
  if (list.querySelector(".layer-name-input")) return;

  var typeCounts = {};
  objs.forEach(function (o) { assignLabelsRecursive(o, typeCounts); });

  list.innerHTML = "";
  objs.slice().reverse().forEach(function (o) {
    list.appendChild(buildLayerRow(o, 0, o));
  });

  if (chartProxyObj) {
    var sep = document.createElement("li");
    sep.className = "layers-sep";
    sep.textContent = "Chart";
    list.appendChild(sep);
    list.appendChild(buildChartRow());
  }

  updateLayersHeaderButtons();
  highlightActiveLayerRows();
}

function buildLayerRow(obj, depth, rootObj) {
  var li = document.createElement("li");
  li.className = "layer-row" + (depth ? " layer-child" : "");
  li.style.paddingLeft = (4 + depth * 18) + "px";
  ensureLayerId(obj);
  li.dataset.layerId = obj.__layerId;
  if (obj.visible === false) li.classList.add("layer-hidden");

  var isTop = depth === 0;
  var canExpand = obj.type === "group" && !obj.isMathObject && obj._objects && obj._objects.length > 0;

  if (isTop) {
    var handle = document.createElement("span");
    handle.className = "layer-drag-handle material-symbols-outlined";
    handle.textContent = "drag_indicator";
    li.appendChild(handle);
    li.draggable = true;
    wireLayerDrag(li, obj);
  }

  if (canExpand) {
    var exp = document.createElement("button");
    exp.type = "button";
    exp.className = "layer-expand-btn" + (layersExpandedGroups.has(obj.__layerId) ? " expanded" : "");
    exp.innerHTML = '<span class="material-symbols-outlined">chevron_right</span>';
    exp.addEventListener("click", function (e) {
      e.stopPropagation();
      if (layersExpandedGroups.has(obj.__layerId)) layersExpandedGroups.delete(obj.__layerId);
      else layersExpandedGroups.add(obj.__layerId);
      refreshLayersPanel();
    });
    li.appendChild(exp);
  }

  li.appendChild(buildLayerThumb(obj));

  var text = document.createElement("span");
  text.className = "layer-text";
  var name = document.createElement("span");
  name.className = "layer-name";
  name.textContent = layerDisplayName(obj);
  name.title = name.textContent + " — double-click to rename";
  name.addEventListener("dblclick", function (e) {
    e.stopPropagation();
    startLayerRename(obj, li);
  });
  text.appendChild(name);
  var sub = document.createElement("span");
  sub.className = "layer-sub";
  sub.textContent = layerSubLabel(obj);
  text.appendChild(sub);
  li.appendChild(text);

  var tools = document.createElement("span");
  tools.className = "layer-tools";
  var hidden = obj.visible === false;
  tools.appendChild(makeLayerTool(hidden ? "visibility_off" : "visibility", hidden ? "Show layer" : "Hide layer", hidden, function () {
    toggleLayerVisibility(obj);
  }));
  if (isTop) {
    var locked = !!obj.lockMovementX;
    tools.appendChild(makeLayerTool(locked ? "lock" : "lock_open", locked ? "Unlock layer" : "Lock layer", locked, function () {
      // Read the live state: the lock may have changed elsewhere (mini bar,
      // context menu) since this row was built.
      setLayerLocked(obj, !obj.lockMovementX);
    }));
    var more = makeLayerTool("more_horiz", "More options", false, function (btn) { openLayerMenu(obj, btn); });
    more.classList.add("layer-tool-more");
    tools.appendChild(more);
  }
  li.appendChild(tools);

  li.addEventListener("click", function (e) {
    if (e.target.closest(".layer-tool, .layer-expand-btn, .layer-name-input")) return;
    if (!fabricCanvas) return;
    if (isTop) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        toggleMultiSelect(obj);
      } else {
        fabricCanvas.discardActiveObject();
        fabricCanvas.setActiveObject(obj);
        fabricCanvas.requestRenderAll();
      }
    } else {
      fabricCanvas.discardActiveObject();
      fabricCanvas.setActiveObject(rootObj);
      fabricCanvas.requestRenderAll();
    }
  });

  var wrapper = document.createDocumentFragment();
  wrapper.appendChild(li);

  if (canExpand && layersExpandedGroups.has(obj.__layerId)) {
    obj._objects.slice().reverse().forEach(function (child) {
      wrapper.appendChild(buildLayerRow(child, depth + 1, rootObj));
    });
  }

  return wrapper;
}

function buildChartRow() {
  var li = document.createElement("li");
  li.className = "layer-row layer-chart-row";
  li.id = "layersChartRow";

  li.style.paddingLeft = "8px";
  var thumb = document.createElement("span");
  thumb.className = "layer-thumb";
  thumb.innerHTML = '<span class="material-symbols-outlined">bar_chart</span>';
  li.appendChild(thumb);

  var text = document.createElement("span");
  text.className = "layer-text";
  text.title = "The chart itself — click to select and resize it";
  text.innerHTML = '<span class="layer-name">Chart</span>' +
    '<span class="layer-sub"><span class="material-symbols-outlined">push_pin</span>Always at the back</span>';
  li.appendChild(text);

  li.addEventListener("click", function () {
    if (!fabricCanvas || !chartProxyObj) return;
    fabricCanvas.discardActiveObject();
    fabricCanvas.setActiveObject(chartProxyObj);
    fabricCanvas.requestRenderAll();
  });

  return li;
}

function startLayerRename(obj, row) {
  var nameEl = row.querySelector(".layer-name");
  if (!nameEl || row.querySelector(".layer-name-input")) return;
  var current = layerDisplayName(obj);
  nameEl.style.display = "none";

  var input = document.createElement("input");
  input.type = "text";
  input.className = "layer-name-input";
  input.value = current;
  nameEl.insertAdjacentElement("afterend", input);
  input.focus();
  input.select();

  // Enter/Escape remove the input, which fires blur -> commit a second time.
  var done = false;
  function commit() {
    if (done) return;
    done = true;
    var val = input.value.trim();
    obj.layerName = val || null;
    input.remove();
    nameEl.style.display = "";
    refreshLayersPanel();
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); done = true; input.remove(); nameEl.style.display = ""; }
  });
  input.addEventListener("blur", commit);
  input.addEventListener("click", function (e) { e.stopPropagation(); });
  input.addEventListener("dblclick", function (e) { e.stopPropagation(); });
}

function toggleLayerVisibility(obj) {
  if (!fabricCanvas) return;
  var willHide = obj.visible !== false;
  if (willHide) {
    obj.__prevSelectable = obj.selectable;
    obj.__prevEvented = obj.evented;
    obj.visible = false;
    obj.selectable = false;
    obj.evented = false;
    var actives = fabricCanvas.getActiveObjects ? fabricCanvas.getActiveObjects() : [];
    if (actives.indexOf(obj) > -1) fabricCanvas.discardActiveObject();
  } else {
    obj.visible = true;
    obj.selectable = obj.__prevSelectable !== undefined ? obj.__prevSelectable : true;
    obj.evented = obj.__prevEvented !== undefined ? obj.__prevEvented : true;
  }
  fabricCanvas.requestRenderAll();
  refreshLayersPanel();
}

function moveLayerObject(obj, dir) {
  if (!fabricCanvas || obj === chartProxyObj) return;
  if (dir === "up") fabricCanvas.bringForward(obj);
  else fabricCanvas.sendBackwards(obj);
  fabricCanvas.requestRenderAll();
  refreshLayersPanel();
}

function duplicateLayerObject(obj) {
  if (!fabricCanvas || obj === chartProxyObj) return;
  fabricCanvas.discardActiveObject();
  fabricCanvas.setActiveObject(obj);
  if (typeof duplicateActiveObject === "function") duplicateActiveObject();
  refreshLayersPanel();
}

function deleteLayerObject(obj) {
  if (!fabricCanvas || obj === chartProxyObj) return;
  fabricCanvas.discardActiveObject();
  fabricCanvas.setActiveObject(obj);
  if (typeof deleteActiveObject === "function") deleteActiveObject();
  refreshLayersPanel();
}

function toggleMultiSelect(obj) {
  if (!fabricCanvas) return;
  var current = fabricCanvas.getActiveObjects().filter(function (o) { return o !== chartProxyObj; });
  var idx = current.indexOf(obj);
  if (idx > -1) current.splice(idx, 1);
  else current.push(obj);

  fabricCanvas.discardActiveObject();
  if (current.length === 0) {
    fabricCanvas.requestRenderAll();
    onLayersSelectionChange();
    return;
  }
  if (current.length === 1) {
    fabricCanvas.setActiveObject(current[0]);
  } else {
    fabricCanvas.setActiveObject(new fabric.ActiveSelection(current, { canvas: fabricCanvas }));
  }
  fabricCanvas.requestRenderAll();
}

function wireLayerDrag(row, obj) {
  row.addEventListener("dragstart", function (e) {
    layersDragObj = obj;
    row.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", obj.__layerId || ""); } catch (err) { /* Safari needs a no-op catch here */ }
  });
  row.addEventListener("dragend", function () {
    row.classList.remove("dragging");
    document.querySelectorAll(".layer-row").forEach(function (r) {
      r.classList.remove("drag-over-top", "drag-over-bottom");
    });
    layersDragObj = null;
  });
  row.addEventListener("dragover", function (e) {
    if (!layersDragObj || layersDragObj === obj) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    var rect = row.getBoundingClientRect();
    var before = (e.clientY - rect.top) < rect.height / 2;
    row.classList.toggle("drag-over-top", before);
    row.classList.toggle("drag-over-bottom", !before);
  });
  row.addEventListener("dragleave", function () {
    row.classList.remove("drag-over-top", "drag-over-bottom");
  });
  row.addEventListener("drop", function (e) {
    e.preventDefault();
    row.classList.remove("drag-over-top", "drag-over-bottom");
    if (!layersDragObj || layersDragObj === obj) return;
    var rect = row.getBoundingClientRect();
    var before = (e.clientY - rect.top) < rect.height / 2;
    reorderLayer(layersDragObj, obj, before);
  });
}

function reorderLayer(dragObj, targetObj, before) {
  if (!fabricCanvas) return;
  var objs = fabricCanvas.getObjects().filter(function (o) { return o !== chartProxyObj && o !== dragObj; });
  var targetIdx = objs.indexOf(targetObj);
  if (targetIdx === -1) return;
  // Bottom-to-top array; "before" = dropped above target in the (top=front)
  // list, i.e. dragObj should render in front of target.
  var insertAt = before ? targetIdx + 1 : targetIdx;
  objs.splice(insertAt, 0, dragObj);
  fabricCanvas._objects = chartProxyObj ? [chartProxyObj].concat(objs) : objs;
  fabricCanvas.requestRenderAll();
  refreshLayersPanel();
}

function highlightActiveLayerRows() {
  if (!fabricCanvas) return;
  var active = fabricCanvas.getActiveObjects ? fabricCanvas.getActiveObjects() : [];
  var activeIds = active.map(function (o) { return o.__layerId; }).filter(Boolean);
  document.querySelectorAll(".layer-row").forEach(function (row) {
    var id = row.dataset.layerId;
    var isActive = id && activeIds.indexOf(id) > -1;
    row.classList.toggle("active", !!isActive);
    row.classList.toggle("multi-selected", !!isActive && activeIds.length > 1);
  });
  var chartRow = document.getElementById("layersChartRow");
  if (chartRow) chartRow.classList.toggle("active", fabricCanvas.getActiveObject() === chartProxyObj);
}

function updateLayersHeaderButtons() {
  if (!fabricCanvas) return;
  var groupBtn = document.getElementById("layersGroupBtn");
  var ungroupBtn = document.getElementById("layersUngroupBtn");
  var active = fabricCanvas.getActiveObject();
  if (groupBtn) groupBtn.disabled = !(active && active.type === "activeSelection" && active.size && active.size() >= 2);
  if (ungroupBtn) ungroupBtn.disabled = !(active && active.type === "group");
}
