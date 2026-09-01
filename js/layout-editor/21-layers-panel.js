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

function layerDisplayName(obj) {
  return (obj.layerName && obj.layerName.trim()) ? obj.layerName : (obj.__layerAutoLabel || "Object");
}

function refreshLayersPanel() {
  if (!fabricCanvas) return;
  var list = document.getElementById("layersList");
  var empty = document.getElementById("layersEmptyMsg");
  if (!list) return;

  var objs = fabricCanvas.getObjects().filter(function (o) { return o !== chartProxyObj; });
  if (empty) empty.style.display = objs.length ? "none" : "block";

  var typeCounts = {};
  objs.forEach(function (o) { assignLabelsRecursive(o, typeCounts); });

  list.innerHTML = "";
  objs.slice().reverse().forEach(function (o) {
    list.appendChild(buildLayerRow(o, 0, o));
  });

  if (chartProxyObj) {
    var sep = document.createElement("li");
    sep.className = "layers-sep";
    list.appendChild(sep);
    list.appendChild(buildChartRow());
  }

  updateLayersHeaderButtons();
  highlightActiveLayerRows();
}

function makeActionBtn(icon, title, handler, danger) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "layer-action-btn" + (danger ? " layer-action-danger" : "");
  btn.title = title;
  btn.innerHTML = '<span class="material-symbols-outlined">' + icon + "</span>";
  btn.addEventListener("click", handler);
  return btn;
}

function buildLayerRow(obj, depth, rootObj) {
  var li = document.createElement("li");
  li.className = "layer-row";
  li.style.paddingLeft = (6 + depth * 16) + "px";
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
  } else {
    var spacer = document.createElement("span");
    spacer.style.cssText = "width:15px;flex-shrink:0;";
    li.appendChild(spacer);
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
  } else {
    var spacer2 = document.createElement("span");
    spacer2.style.cssText = "width:16px;flex-shrink:0;";
    li.appendChild(spacer2);
  }

  var icon = document.createElement("span");
  icon.className = "layer-icon material-symbols-outlined";
  icon.textContent = baseTypeInfo(obj).icon;
  li.appendChild(icon);

  var name = document.createElement("span");
  name.className = "layer-name";
  name.textContent = layerDisplayName(obj);
  name.title = name.textContent;
  name.addEventListener("dblclick", function (e) {
    e.stopPropagation();
    startLayerRename(obj, li);
  });
  li.appendChild(name);

  var visBtn = document.createElement("button");
  visBtn.type = "button";
  visBtn.className = "layer-vis-btn";
  visBtn.title = obj.visible === false ? "Show layer" : "Hide layer";
  visBtn.innerHTML = '<span class="material-symbols-outlined">' + (obj.visible === false ? "visibility_off" : "visibility") + "</span>";
  visBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    toggleLayerVisibility(obj);
  });
  li.appendChild(visBtn);

  if (isTop) {
    var actions = document.createElement("div");
    actions.className = "layer-actions";
    actions.appendChild(makeActionBtn("arrow_upward", "Move up", function (e) { e.stopPropagation(); moveLayerObject(obj, "up"); }));
    actions.appendChild(makeActionBtn("arrow_downward", "Move down", function (e) { e.stopPropagation(); moveLayerObject(obj, "down"); }));
    actions.appendChild(makeActionBtn("content_copy", "Duplicate", function (e) { e.stopPropagation(); duplicateLayerObject(obj); }));
    actions.appendChild(makeActionBtn("delete", "Delete", function (e) { e.stopPropagation(); deleteLayerObject(obj); }, true));
    li.appendChild(actions);
  }

  li.addEventListener("click", function (e) {
    if (e.target.closest(".layer-vis-btn, .layer-expand-btn, .layer-action-btn, .layer-name-input")) return;
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

  var icon = document.createElement("span");
  icon.className = "layer-icon material-symbols-outlined";
  icon.textContent = "bar_chart";
  li.appendChild(icon);

  var name = document.createElement("span");
  name.className = "layer-name";
  name.textContent = "Chart";
  name.title = "The chart itself — click to select and resize it";
  li.appendChild(name);

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

  function commit() {
    var val = input.value.trim();
    obj.layerName = val || null;
    input.remove();
    nameEl.style.display = "";
    refreshLayersPanel();
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); input.remove(); nameEl.style.display = ""; }
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
