/* ==========================================================================
   GIS — attribute table.

   A dock along the bottom of the layout view (like QGIS's attribute table)
   showing the active vector layer's features in AG Grid:
     - edit values in place (numbers stay numbers in numeric fields)
     - select rows <-> selected features on the map, both ways
     - show selected only, quick search
     - select all / invert / clear, zoom to selection
     - add a field, delete selected features
     - export GeoJSON or CSV, all features or only the selected ones
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  var dock = null, api = null, layerId = null, syncing = false, onlySelected = false;

  function $(sel) { return dock.querySelector(sel); }

  function build() {
    if (dock) return dock;
    dock = document.createElement("div");
    dock.className = "gis-attr-dock";
    dock.style.display = "none";
    dock.innerHTML =
      '<div class="gis-attr-resize" title="Drag to resize"></div>' +
      '<div class="gis-attr-bar">' +
        '<span class="material-symbols-outlined">table</span>' +
        '<select class="gis-attr-layer"></select>' +
        '<span class="gis-attr-count"></span>' +
        '<span class="gis-attr-sep"></span>' +
        '<button data-a="all" title="Select all"><span class="material-symbols-outlined">select_all</span></button>' +
        '<button data-a="invert" title="Invert selection"><span class="material-symbols-outlined">flip</span></button>' +
        '<button data-a="clear" title="Clear selection"><span class="material-symbols-outlined">deselect</span></button>' +
        '<button data-a="zoom" title="Zoom map to selection"><span class="material-symbols-outlined">center_focus_strong</span></button>' +
        '<button data-a="only" title="Show selected features only"><span class="material-symbols-outlined">filter_alt</span></button>' +
        '<span class="gis-attr-sep"></span>' +
        '<button data-a="addfield" title="Add field"><span class="material-symbols-outlined">add_column_right</span></button>' +
        '<button data-a="delete" title="Delete selected features"><span class="material-symbols-outlined">delete</span></button>' +
        '<span class="gis-attr-sep"></span>' +
        '<div class="gis-attr-export"><button data-a="export" title="Export"><span class="material-symbols-outlined">download</span>Export</button>' +
          '<div class="gis-attr-menu">' +
            '<button data-x="geojson">GeoJSON — all features</button><button data-x="geojson-sel">GeoJSON — selected</button>' +
            '<button data-x="csv">CSV — all features</button><button data-x="csv-sel">CSV — selected</button>' +
          "</div></div>" +
        '<input type="search" class="gis-attr-search" placeholder="Search">' +
        '<button data-a="close" title="Close"><span class="material-symbols-outlined">close</span></button>' +
      "</div>" +
      '<div class="gis-attr-grid"></div>';
    var pane = document.getElementById("paneLayout");
    pane.appendChild(dock);

    $(".gis-attr-layer").addEventListener("change", function () { GIS.setActive(this.value); show(this.value); });
    $(".gis-attr-search").addEventListener("input", function () { if (api) api.setGridOption("quickFilterText", this.value); });
    dock.querySelector(".gis-attr-bar").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var l = layer();
      if (b.dataset.x) { exportAs(l, b.dataset.x); dock.querySelector(".gis-attr-export").classList.remove("open"); return; }
      switch (b.dataset.a) {
        case "close": hide(); break;
        case "export": dock.querySelector(".gis-attr-export").classList.toggle("open"); break;
        case "all": if (l) { l.data.features.forEach(function (f, i) { l.selection.add(i); }); GIS.emit("selection"); } break;
        case "invert": if (l) { var s = new Set(); l.data.features.forEach(function (f, i) { if (!l.selection.has(i)) s.add(i); }); l.selection = s; GIS.emit("selection"); } break;
        case "clear": if (l) { l.selection.clear(); GIS.emit("selection"); } break;
        case "zoom": if (GIS.mapActions) GIS.mapActions.zoomToSelection(); break;
        case "only": onlySelected = !onlySelected; b.classList.toggle("active", onlySelected); if (api) api.onFilterChanged(); break;
        case "addfield": addField(l); break;
        case "delete": deleteSelected(l); break;
      }
    });
    wireResize();
    return dock;
  }

  function wireResize() {
    var handle = $(".gis-attr-resize"), startY = 0, startH = 0;
    handle.addEventListener("mousedown", function (e) {
      startY = e.clientY; startH = dock.offsetHeight;
      function mv(ev) { dock.style.height = Math.max(120, Math.min(window.innerHeight * 0.8, startH + startY - ev.clientY)) + "px"; }
      function up() { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); }
      window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
      e.preventDefault();
    });
  }

  function layer() { return GIS.get(layerId); }

  function exportAs(l, what) {
    if (!l) return;
    var sel = /-sel$/.test(what);
    if (sel && !l.selection.size) return;
    if (/^geojson/.test(what)) GIS.exportGeoJSON(l, sel); else GIS.exportCSV(l, sel);
  }

  function addField(l) {
    if (!l) return;
    var name = (window.prompt("New field name") || "").trim();
    if (!name) return;
    if (GIS.fields(l).all.indexOf(name) >= 0) return;
    l.data.features.forEach(function (f) { f.properties[name] = null; });
    l.rev = (l.rev || 0) + 1;
    GIS.emit("data");
    show(l.id);
  }

  function deleteSelected(l) {
    if (!l || !l.selection.size) return;
    if (!window.confirm("Delete " + l.selection.size + " selected feature(s)?")) return;
    l.data.features = l.data.features.filter(function (f, i) { return !l.selection.has(i); });
    l.selection.clear();
    l.rev = (l.rev || 0) + 1;
    GIS.emit("data");
    show(l.id);
  }

  function updateCount() {
    var l = layer();
    if (!dock || !l) return;
    $(".gis-attr-count").textContent = l.data.features.length + " features, " + l.selection.size + " selected";
  }

  function fillLayerSelect() {
    var sel = $(".gis-attr-layer");
    sel.innerHTML = GIS.vectors().map(function (l) { return '<option value="' + l.id + '">' + l.name.replace(/</g, "&lt;") + "</option>"; }).join("");
    if (layerId) sel.value = layerId;
  }

  function show(id) {
    build();
    var l = GIS.get(id) || GIS.vectors()[0];
    if (!l || l.kind !== "vector") { hide(); return; }
    layerId = l.id;
    dock.style.display = "";
    fillLayerSelect();
    PlootsLazy.ensureAgGrid().then(function () { renderGrid(l); });
  }

  function hide() {
    if (!dock) return;
    dock.style.display = "none";
    if (api) { api.destroy(); api = null; }
  }

  function renderGrid(l) {
    var el = $(".gis-attr-grid");
    if (api) { api.destroy(); api = null; }
    el.innerHTML = "";
    var f = GIS.fields(l), numeric = {};
    f.numeric.forEach(function (k) { numeric[k] = true; });
    var cols = f.all.map(function (k) {
      return {
        field: k, headerName: k, editable: true, sortable: true, resizable: true, filter: true, minWidth: 90,
        valueGetter: function (p) { return p.data.f.properties[k]; },
        valueSetter: function (p) {
          var v = p.newValue;
          if (numeric[k] && v !== "" && v != null && isFinite(Number(v))) v = Number(v);
          if (v === "") v = null;
          p.data.f.properties[k] = v;
          return true;
        }
      };
    });
    cols.unshift({ headerName: "#", valueGetter: function (p) { return p.data.i + 1; }, width: 70, pinned: "left", sortable: true, editable: false });
    api = agGrid.createGrid(el, {
      theme: typeof getDvGridTheme === "function" ? getDvGridTheme() : undefined,
      columnDefs: cols,
      rowData: l.data.features.map(function (feat, i) { return { i: i, f: feat }; }),
      getRowId: function (p) { return String(p.data.i); },
      rowSelection: { mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: true },
      defaultColDef: { flex: 1 },
      isExternalFilterPresent: function () { return onlySelected; },
      doesExternalFilterPass: function (node) { return l.selection.has(node.data.i); },
      onSelectionChanged: function () {
        if (syncing) return;
        l.selection = new Set(api.getSelectedRows().map(function (r) { return r.i; }));
        syncing = true;
        GIS.emit("selection");
        syncing = false;
        updateCount();
      },
      onCellValueChanged: function () {
        l.rev = (l.rev || 0) + 1;
        GIS.emit("data");
      },
      onGridReady: function () { syncSelection(); }
    });
    updateCount();
  }

  function syncSelection() {
    var l = layer();
    if (!api || !l) return;
    syncing = true;
    api.forEachNode(function (n) { n.setSelected(l.selection.has(n.data.i)); });
    syncing = false;
    if (onlySelected) api.onFilterChanged();
    updateCount();
  }

  GIS.on("selection", function () { if (!syncing) syncSelection(); else updateCount(); });
  GIS.on("layers", function () {
    if (!dock || dock.style.display === "none") return;
    if (!GIS.get(layerId)) { var v = GIS.vectors()[0]; if (v) show(v.id); else hide(); } else fillLayerSelect();
  });

  GIS.attributeTable = { show: show, hide: hide, isOpen: function () { return !!dock && dock.style.display !== "none"; } };
})();
