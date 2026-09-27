/* ==========================================================================
   Data View — Columns/Rows "shelves" (Tableau-style field placement).
   Drag a field pill from the tray into the Columns or Rows well to set
   what drives the chart's axes — replaces the old per-column role <select>
   and the Long-mode picker bar with a drag-and-drop equivalent.

   Wide mode:  Columns = single field -> role "X"
               Rows    = one or more fields -> role "Y"
               (everything else falls back to role "Text")
   Long mode:  Columns = single field -> dv.longX
               Color   = single field -> dv.longSeries
               Rows    = single field -> dv.longValue
   ========================================================================== */

function dvFieldIsMeasure(colIdx) {
    return isNumericColumn(dv.rows, colIdx);
}

function dvShelfFieldPill(colIdx, opts) {
    opts = opts || {};
    var pill = document.createElement("div");
    pill.className = "dv-shelf-pill" + (opts.inShelf ? " in-shelf" : "");
    pill.draggable = true;
    pill.dataset.col = colIdx;

    var badge = document.createElement("span");
    var isMeasure = dvFieldIsMeasure(colIdx);
    badge.className = "dv-shelf-pill-badge material-symbols-outlined " + (isMeasure ? "is-measure" : "is-dim");
    badge.textContent = isMeasure ? "tag" : "match_case"; // same icons as the grid headers
    badge.title = isMeasure ? "Numbers" : "Text";
    pill.appendChild(badge);

    var label = document.createElement("span");
    label.className = "dv-shelf-pill-label";
    label.textContent = dv.header[colIdx] || ("Column " + (colIdx + 1));
    pill.appendChild(label);

    if (opts.onRemove) {
        var rm = document.createElement("button");
        rm.type = "button"; rm.className = "dv-shelf-pill-remove"; rm.title = "Remove from shelf";
        rm.innerHTML = '<span class="material-symbols-outlined">close</span>';
        rm.addEventListener("mousedown", function (e) { e.stopPropagation(); });
        rm.addEventListener("click", function (e) { e.stopPropagation(); opts.onRemove(colIdx); });
        pill.appendChild(rm);
    }

    pill.addEventListener("dragstart", function (e) {
        e.dataTransfer.setData("text/plain", String(colIdx));
        e.dataTransfer.effectAllowed = "move";
        pill.classList.add("dragging");
    });
    pill.addEventListener("dragend", function () { pill.classList.remove("dragging"); });

    return pill;
}

function dvShelfDropZone(labelText, hintText, colIdxs, onDrop, onRemove, roleKey) {
    var zone = document.createElement("div");
    zone.className = "dv-shelf-zone";
    if (roleKey) zone.dataset.role = roleKey; // colors the label dot to match the grid header chips

    var lab = document.createElement("div");
    lab.className = "dv-shelf-zone-label";
    lab.textContent = labelText;
    zone.appendChild(lab);

    var box = document.createElement("div");
    box.className = "dv-shelf-zone-box";
    if (!colIdxs.length) {
        var ph = document.createElement("span");
        ph.className = "dv-shelf-zone-placeholder";
        ph.textContent = hintText;
        box.appendChild(ph);
    }
    colIdxs.forEach(function (ci) {
        box.appendChild(dvShelfFieldPill(ci, { inShelf: true, onRemove: onRemove }));
    });

    box.addEventListener("dragover", function (e) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; zone.classList.add("drag-over"); });
    box.addEventListener("dragleave", function () { zone.classList.remove("drag-over"); });
    box.addEventListener("drop", function (e) {
        e.preventDefault();
        zone.classList.remove("drag-over");
        var ci = parseInt(e.dataTransfer.getData("text/plain"), 10);
        if (!isNaN(ci)) onDrop(ci);
    });

    zone.appendChild(box);
    return zone;
}

function dvRenderShelves() {
    var host = document.getElementById("dvShelves");
    if (!host) return;
    if (!dv.header.length) { host.style.display = "none"; host.innerHTML = ""; return; }
    host.style.display = "flex";
    host.innerHTML = "";

    var row = document.createElement("div");
    row.className = "dv-shelf-row";

    var tray = document.createElement("div");
    tray.className = "dv-shelf-tray";
    var trayLabel = document.createElement("div");
    trayLabel.className = "dv-shelf-tray-label";
    trayLabel.textContent = dv.shape === "wide" ? "Unused fields" : "All fields";
    tray.appendChild(trayLabel);
    var trayPills = document.createElement("div");
    trayPills.className = "dv-shelf-tray-pills";
    tray.appendChild(trayPills);

    if (dv.shape === "wide") {
        var xIdx = dv.roles.indexOf("X");
        var yIdxs = [];
        dv.roles.forEach(function (r, i) { if (r === "Y") yIdxs.push(i); });
        var used = {};
        if (xIdx !== -1) used[xIdx] = 1;
        yIdxs.forEach(function (i) { used[i] = 1; });

        function unassign(ci) { dv.roles[ci] = "Text"; buildDataGridUI(); }

        var colsZone = dvShelfDropZone("X axis", "Drop the category field here", xIdx !== -1 ? [xIdx] : [], function (ci) {
            dv.roles.forEach(function (r, i) { if (r === "X") dv.roles[i] = "Text"; });
            dv.roles[ci] = "X";
            buildDataGridUI();
        }, unassign, "X");
        row.appendChild(colsZone);

        var rowsZone = dvShelfDropZone("Y axis", "Drop one or more number fields here", yIdxs, function (ci) {
            dv.roles[ci] = "Y";
            buildDataGridUI();
        }, unassign, "Y");
        row.appendChild(rowsZone);

        var unassigned = dv.header.map(function (h, i) { return i; }).filter(function (i) { return !used[i]; });
        if (!unassigned.length) {
            var empty = document.createElement("span");
            empty.className = "dv-shelf-tray-empty";
            empty.textContent = "Every field is on an axis";
            trayPills.appendChild(empty);
        } else {
            unassigned.forEach(function (i) { trayPills.appendChild(dvShelfFieldPill(i)); });
        }
    } else {
        var colsZone2 = dvShelfDropZone("X axis", "Drop the category field here", [dv.longX], function (ci) { dv.longX = ci; buildDataGridUI(); }, null, "X");
        var colorZone = dvShelfDropZone("Series (color)", "Drop the grouping field here", [dv.longSeries], function (ci) { dv.longSeries = ci; buildDataGridUI(); }, null, "S");
        var rowsZone2 = dvShelfDropZone("Value", "Drop the number field here", [dv.longValue], function (ci) { dv.longValue = ci; buildDataGridUI(); }, null, "Y");
        row.appendChild(colsZone2); row.appendChild(colorZone); row.appendChild(rowsZone2);

        // Long mode always needs exactly one field per shelf, so every field
        // stays available in the tray to be dragged onto a different shelf.
        dv.header.forEach(function (h, i) { trayPills.appendChild(dvShelfFieldPill(i)); });
    }

    // Dropping a shelf pill back onto the tray un-assigns it (wide mode only —
    // long-mode shelves always need a value, so there's nothing to unassign to).
    trayPills.addEventListener("dragover", function (e) { e.preventDefault(); });
    trayPills.addEventListener("drop", function (e) {
        e.preventDefault();
        if (dv.shape !== "wide") return;
        var ci = parseInt(e.dataTransfer.getData("text/plain"), 10);
        if (!isNaN(ci) && dv.roles[ci] !== "Text") { dv.roles[ci] = "Text"; buildDataGridUI(); }
    });

    host.appendChild(row);
    host.appendChild(tray);
}
