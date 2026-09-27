/* ==========================================================================
   Data View — spreadsheet-style table for entering/editing chart data.
   Backed by AG Grid. Features:
     - Compact, Google-Sheets-like density (slim rows/headers)
     - Column sort (ascending "min→max" / descending "max→min")
     - Basic spreadsheet formulas ( =SUM(A1:A5) etc. — see data_formulas.js )
     - fx bar showing the selected cell's address + raw content
     - AG Grid is loaded lazily on demand — prefetched the moment the Data
       View tab is opened, with a defensive re-check + spinner in
       buildDataGridUIInner() as a fallback. See js/lazy-loader.js.
     - Statistics use plain-JS fallback math only (see data_stats.js) — no
       jStat dependency anymore.
   ========================================================================== */

var dv = { header: [], rows: [], shape: "wide", roles: [], longX: 0, longSeries: 1, longValue: 2, sortCol: -1, sortDir: null };

/* Snapshot of dv right after the last successful import — powers "Revert
   changes", which undoes transpose/edits/sort back to what was imported. */
var dvImportSnapshot = null;

function dvSaveImportSnapshot() {
    dvImportSnapshot = {
        header: dv.header.slice(),
        rows: dv.rows.map(function (r) { return r.slice(); }),
        roles: dv.roles.slice(),
        shape: dv.shape, longX: dv.longX, longSeries: dv.longSeries, longValue: dv.longValue
    };
    var btn = document.getElementById("revertChangesBtn");
    if (btn) btn.disabled = false;
}

function dvRevertChanges() {
    if (!dvImportSnapshot) return;
    dv.header = dvImportSnapshot.header.slice();
    dv.rows = dvImportSnapshot.rows.map(function (r) { return r.slice(); });
    dv.roles = dvImportSnapshot.roles.slice();
    dv.shape = dvImportSnapshot.shape;
    dv.longX = dvImportSnapshot.longX; dv.longSeries = dvImportSnapshot.longSeries; dv.longValue = dvImportSnapshot.longValue;
    dv.sortCol = -1; dv.sortDir = null;
    var wideBtn = document.getElementById("shapeWide"), longBtn = document.getElementById("shapeLong");
    if (wideBtn) wideBtn.classList.toggle("active", dv.shape === "wide");
    if (longBtn) longBtn.classList.toggle("active", dv.shape === "long");
    buildDataGridUI();
    if (typeof historyNotifyChange === "function") historyNotifyChange();
}
(function wireRevertButton() {
    var btn = document.getElementById("revertChangesBtn");
    if (btn) btn.addEventListener("click", dvRevertChanges);
})();

function looksNumeric(v) {
    return v !== "" && v != null && !isNaN(parseFloat(v)) && isFinite(v);
}

function isNumericColumn(rows, col) {
    var numeric = 0, total = 0;
    rows.forEach(function (r) {
        if (r[col] !== undefined && r[col] !== "") { total++; if (looksNumeric(r[col])) numeric++; }
    });
    return total > 0 && numeric / total >= 0.7;
}

function isCellInvalid(col, value) {
    if (dv.shape !== "wide") return false;
    var role = dv.roles[col];
    return (role === "Y" || role === "Number") && value !== "" && value != null && !dvIsFormula(value) && !looksNumeric(value);
}

function countInvalidCells() {
    if (dv.shape !== "wide") return 0;
    var count = 0;
    dv.rows.forEach(function (row) {
        dv.header.forEach(function (h, c) { if (isCellInvalid(c, row[c])) count++; });
    });
    return count;
}

function cleanHeaderLabel(v) {
    v = (v == null ? "" : String(v)).trim();
    return v.indexOf("_") === -1 ? v : v.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
}

function colLetter(idx) {
    var out = "", n = idx + 1;
    while (n > 0) { var rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26); }
    return out;
}

function autoDetectRoles() {
    dv.roles = dv.header.map(function (h, i) { return i === 0 ? "X" : (isNumericColumn(dv.rows, i) ? "Y" : "Text"); });
    dv.longX = 0;
    var seriesIdx = dv.header.findIndex(function (h, i) { return i > 0 && !isNumericColumn(dv.rows, i); });
    var valueIdx = dv.header.findIndex(function (h, i) { return i > 0 && isNumericColumn(dv.rows, i); });
    dv.longSeries = seriesIdx >= 0 ? seriesIdx : (dv.header.length > 1 ? 1 : 0);
    dv.longValue = valueIdx >= 0 ? valueIdx : (dv.header.length > 2 ? 2 : dv.header.length - 1);
}

function refreshDataGrid(header, rows) {
    dv.header = header.map(cleanHeaderLabel);
    dv.rows = rows.map(function (r) { return r.map(function (c) { return c == null ? "" : String(c); }); });
    dv.sortCol = -1; dv.sortDir = null;
    autoDetectRoles();
    buildDataGridUI();
    dvSaveImportSnapshot();
}

function transposeMatrix() {
    var full = [dv.header].concat(dv.rows);
    var rows = full.length, cols = full[0] ? full[0].length : 0;
    var out = [];
    for (var c = 0; c < cols; c++) {
        var row = [];
        for (var r = 0; r < rows; r++) row.push(full[r][c] !== undefined ? full[r][c] : "");
        out.push(row);
    }
    dv.header = out[0] || [];
    dv.rows = out.slice(1);
    dv.sortCol = -1; dv.sortDir = null;
    autoDetectRoles();
    buildDataGridUI();
}

function setDataShape(shape) {
    dv.shape = shape;
    document.getElementById("shapeWide").classList.toggle("active", shape === "wide");
    document.getElementById("shapeLong").classList.toggle("active", shape === "long");
    buildDataGridUI();
}

document.getElementById("transposeBtn").addEventListener("click", transposeMatrix);
document.getElementById("shapeWide").addEventListener("click", function () { setDataShape("wide"); });
document.getElementById("shapeLong").addEventListener("click", function () { setDataShape("long"); });

var ROLE_OPTIONS_WIDE = ["X", "Y", "Text", "Number", "Skip"];
var ROLE_LABEL = { X: "X", Y: "Y", Text: "Text", Number: "Num", Skip: "Skip" };
var INVALID_CELL_TITLE = 'This column is type Y/Number but this value is not a number — it will be read as 0 when "Apply to chart" runs.';
var dvGridApi = null, dvGridTheme = null;

/* ---------------------------------------------------------------------- *
 * Block/range cell selection — click a cell to select it, drag to select
 * a rectangular block (like Google Sheets/Excel). Ctrl/Cmd+C copies the
 * block as TSV; Delete/Backspace clears the values in it. AG Grid
 * Community has no built-in range selection (that's an Enterprise
 * feature), so this is a small self-contained implementation on top of
 * cell mouse events + a CSS class applied via cellClassRules.
 * ---------------------------------------------------------------------- */
var dvSel = null; // { r0, c0, r1, c1 } — anchor + active corner, unordered
var dvSelDragging = false;
var dvSuppressFocusSelSync = false; // true while we're driving AG's focus ourselves (keyboard nav)
var dvEmptyGridApi = null; // decorative full-grid shown when there's no data yet

function dvSelNormalized() {
    if (!dvSel) return null;
    return {
        r0: Math.min(dvSel.r0, dvSel.r1), r1: Math.max(dvSel.r0, dvSel.r1),
        c0: Math.min(dvSel.c0, dvSel.c1), c1: Math.max(dvSel.c0, dvSel.c1)
    };
}

function dvCellInSelection(row, col) {
    var n = dvSelNormalized();
    if (!n) return false;
    return row >= n.r0 && row <= n.r1 && col >= n.c0 && col <= n.c1;
}

/* ---------------------------------------------------------------------- *
 * Status bar — Google Sheets-style "Count / Sum / Average / Min / Max"
 * strip, bottom-right, reflecting whatever is currently selected.
 * ---------------------------------------------------------------------- */
function dvFormatStatNum(n) {
    if (!isFinite(n)) return "0";
    return (Math.round(n * 100) / 100).toLocaleString();
}

function dvUpdateStatusBar() {
    var el = document.getElementById("dvStatusBar");
    if (!el) return;
    var n = dvSelNormalized();
    if (!n || (n.r0 === n.r1 && n.c0 === n.c1)) { el.style.display = "none"; el.innerHTML = ""; return; }
    var nums = [], filled = 0;
    for (var r = n.r0; r <= n.r1; r++) {
        if (!dv.rows[r]) continue;
        for (var c = n.c0; c <= n.c1; c++) {
            var v = dv.rows[r][c];
            if (v === undefined || v === "") continue;
            filled++;
            var raw = dvIsFormula(v) ? dvFormulaDisplayValue(v, r) : v;
            if (looksNumeric(raw)) nums.push(parseFloat(raw));
        }
    }
    if (!filled) { el.style.display = "none"; el.innerHTML = ""; return; }
    var parts = ["Count:" + filled];
    if (nums.length) {
        var sum = nums.reduce(function (a, b) { return a + b; }, 0);
        parts.push("Sum:" + dvFormatStatNum(sum));
        parts.push("Average:" + dvFormatStatNum(sum / nums.length));
        parts.push("Min:" + dvFormatStatNum(Math.min.apply(null, nums)));
        parts.push("Max:" + dvFormatStatNum(Math.max.apply(null, nums)));
    }
    el.style.display = "flex";
    el.innerHTML = parts.map(function (p) {
        var i = p.indexOf(":");
        return "<span>" + p.slice(0, i) + "<b>" + p.slice(i + 1) + "</b></span>";
    }).join("");
}

function dvSelClear() {
    dvSel = null;
    dvUpdateStatusBar();
    if (dvGridApi) dvGridApi.refreshCells({ force: true });
}

function dvSelStart(row, col) {
    dvSelDragging = true;
    dvSel = { r0: row, c0: col, r1: row, c1: col };
    dvUpdateStatusBar();
    if (dvGridApi) dvGridApi.refreshCells({ force: true });
}

function dvSelExtendTo(row, col) {
    if (!dvSelDragging || !dvSel) return;
    dvSel.r1 = row; dvSel.c1 = col;
    dvUpdateStatusBar();
    if (dvGridApi) dvGridApi.refreshCells({ force: true });
}

document.addEventListener("mouseup", function () {
    dvSelDragging = false;
    if (dvFxPointMode) {
        dvFxPointMode = false;
        dvFxPointDrag = null;
        var input = document.getElementById("dvFxInput");
        if (input) {
            var pos = dvFxCaret.end;
            setTimeout(function () { input.focus(); input.setSelectionRange(pos, pos); }, 0);
        }
    }
});

function dvSelDeleteContents() {
    var n = dvSelNormalized();
    if (!n) return;
    for (var r = n.r0; r <= n.r1; r++) {
        if (!dv.rows[r]) continue;
        for (var c = n.c0; c <= n.c1; c++) dv.rows[r][c] = "";
    }
    updateInvalidCellNotice();
    if (typeof dvRenderStatsSummary === "function") dvRenderStatsSummary();
    if (typeof dvUpdatePinnedStatRow === "function") dvUpdatePinnedStatRow();
    if (typeof historyNotifyChange === "function") historyNotifyChange();
    dvUpdateStatusBar();
    if (dvGridApi) dvGridApi.refreshCells({ force: true });
}

function dvSelCopyToClipboard() {
    var n = dvSelNormalized();
    if (!n || !navigator.clipboard || !navigator.clipboard.writeText) return;
    var lines = [];
    for (var r = n.r0; r <= n.r1; r++) {
        var cells = [];
        for (var c = n.c0; c <= n.c1; c++) cells.push(dv.rows[r] && dv.rows[r][c] !== undefined ? dv.rows[r][c] : "");
        lines.push(cells.join("\t"));
    }
    navigator.clipboard.writeText(lines.join("\n")).catch(function () {});
}

/* ---------------------------------------------------------------------- *
 * Keyboard navigation — plain arrow keys already move the focused cell
 * via AG Grid's built-in navigation (kept in sync with our selection
 * block below via onCellFocused). Shift+Arrow extends the block from its
 * anchor (range selection has no built-in equivalent in AG Grid
 * Community), and Ctrl/Cmd+Home jumps back to A1 — both spreadsheet
 * conventions.
 * ---------------------------------------------------------------------- */
(function wireDataGridSelectionKeys() {
    var el = document.getElementById("dataGrid");
    if (!el) return;
    document.addEventListener("keydown", function (e) {
        var paneData = document.getElementById("paneData");
        if (!paneData || !paneData.classList.contains("active") || !dvGridApi) return;
        var active = document.activeElement;
        var typing = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
        if (typing) return;

        if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C") && dvSel) {
            dvSelCopyToClipboard();
            return;
        }
        if ((e.key === "Delete" || e.key === "Backspace") && dvSel) {
            dvSelDeleteContents();
            e.preventDefault();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "Home" && dv.header.length) {
            e.preventDefault();
            dvSel = { r0: 0, c0: 0, r1: 0, c1: 0 };
            dvSuppressFocusSelSync = true;
            dvGridApi.ensureIndexVisible(0);
            dvGridApi.setFocusedCell(0, "c0");
            dvSuppressFocusSelSync = false;
            dvUpdateStatusBar();
            dvGridApi.refreshCells({ force: true });
            return;
        }
        if (e.shiftKey && dvSel && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.key) !== -1) {
            e.preventDefault();
            var maxRow = dv.rows.length - 1, maxCol = dv.header.length - 1;
            var r = dvSel.r1, c = dvSel.c1;
            if (e.key === "ArrowUp") r = Math.max(0, r - 1);
            if (e.key === "ArrowDown") r = Math.min(maxRow, r + 1);
            if (e.key === "ArrowLeft") c = Math.max(0, c - 1);
            if (e.key === "ArrowRight") c = Math.min(maxCol, c + 1);
            dvSel.r1 = r; dvSel.c1 = c;
            dvSuppressFocusSelSync = true;
            dvGridApi.ensureIndexVisible(r);
            dvGridApi.setFocusedCell(r, "c" + c);
            dvSuppressFocusSelSync = false;
            dvUpdateStatusBar();
            dvGridApi.refreshCells({ force: true });
        }
    });
})();

/* ---------------------------------------------------------------------- *
 * AG Grid is loaded lazily on demand — see js/lazy-loader.js.
 * ---------------------------------------------------------------------- */

/* ---------------------------------------------------------------------- *
 * Sorting — reorders dv.rows directly (like "Sort sheet by column" in a
 * real spreadsheet), so row indices used elsewhere (delete, formulas)
 * stay simple and correct. Fully undo-able via the app's history system.
 * ---------------------------------------------------------------------- */
function sortByColumn(colIdx, dir) {
    var numeric = isNumericColumn(dv.rows, colIdx);
    dv.rows = dv.rows.slice().sort(function (a, b) {
        var av = a[colIdx], bv = b[colIdx];
        var aEmpty = av === undefined || av === "", bEmpty = bv === undefined || bv === "";
        if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : (aEmpty ? 1 : -1);
        if (numeric) {
            var an = parseFloat(av), bn = parseFloat(bv);
            return dir === "asc" ? an - bn : bn - an;
        }
        var cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
        return dir === "asc" ? cmp : -cmp;
    });
    dv.sortCol = colIdx; dv.sortDir = dir;
    buildDataGridUI();
}

function dvClearSort() { dv.sortCol = -1; dv.sortDir = null; buildDataGridUI(); }

/* ---------------------------------------------------------------------- *
 * Global "Sort view by…" dropdown (top of Data View) — one control for
 * the whole table instead of per-column header arrows.
 * ---------------------------------------------------------------------- */
function dvRefreshSortSelect() {
    var sel = document.getElementById("dvSortSelect");
    if (!sel) return;
    var current = dv.sortCol >= 0 && dv.sortDir ? (dv.sortCol + ":" + dv.sortDir) : "";
    sel.innerHTML = "";
    var optNone = document.createElement("option");
    optNone.value = ""; optNone.textContent = "Sort view by…";
    sel.appendChild(optNone);
    dv.header.forEach(function (h, c) {
        var label = h || ("Column " + (c + 1));
        var optAsc = document.createElement("option");
        optAsc.value = c + ":asc"; optAsc.textContent = label + " (A\u2192Z)";
        var optDesc = document.createElement("option");
        optDesc.value = c + ":desc"; optDesc.textContent = label + " (Z\u2192A)";
        sel.appendChild(optAsc); sel.appendChild(optDesc);
    });
    sel.value = current;
}
(function wireSortSelect() {
    var sel = document.getElementById("dvSortSelect");
    if (!sel) return;
    sel.addEventListener("change", function () {
        if (!sel.value) { dvClearSort(); return; }
        var parts = sel.value.split(":");
        sortByColumn(parseInt(parts[0], 10), parts[1]);
    });
})();

/* ---------------------------------------------------------------------- *
 * Global search box (top of Data View) — AG Grid's built-in quick filter,
 * matching across every column's rendered value.
 * ---------------------------------------------------------------------- */
(function wireSearchBox() {
    var input = document.getElementById("dvSearchInput");
    if (!input) return;
    input.addEventListener("input", function () {
        if (dvGridApi) dvGridApi.setGridOption("quickFilterText", input.value || "");
    });
})();

/* ---------------------------------------------------------------------- *
 * "Expression" button (bottom bar) — toggles the fx/formula bar.
 * ---------------------------------------------------------------------- */
(function wireFxToggle() {
    var btn = document.getElementById("fxToggleBtn"), bar = document.getElementById("dvFxBar");
    if (!btn || !bar) return;
    btn.addEventListener("click", function () {
        var open = bar.classList.toggle("open");
        btn.classList.toggle("active", open);
    });
})();

/* ---------------------------------------------------------------------- *
 * fx bar — shows "A1"-style address + raw content of the focused cell,
 * and lets you type formulas/values into it just like a real spreadsheet.
 * ---------------------------------------------------------------------- */
function dvFxBarShow(row, col) {
    var addr = document.getElementById("dvFxAddr"), input = document.getElementById("dvFxInput");
    if (!addr || !input) return;
    addr.textContent = colLetter(col) + (row + 1);
    input.value = (dv.rows[row] && dv.rows[row][col]) || "";
    input.dataset.row = row; input.dataset.col = col;
    input.disabled = false;
}

function dvFxBarClear() {
    var addr = document.getElementById("dvFxAddr"), input = document.getElementById("dvFxInput");
    if (addr) addr.textContent = "";
    if (input) { input.value = ""; input.disabled = true; delete input.dataset.row; delete input.dataset.col; }
}

function dvFxBarCommit() {
    var input = document.getElementById("dvFxInput");
    if (!input || input.dataset.row === undefined) return;
    var row = parseInt(input.dataset.row, 10), col = parseInt(input.dataset.col, 10);
    if (!dv.rows[row]) return;
    dv.rows[row][col] = input.value;
    updateInvalidCellNotice();
    if (typeof dvRenderStatsSummary === "function") dvRenderStatsSummary();
    if (typeof dvUpdatePinnedStatRow === "function") dvUpdatePinnedStatRow();
    if (typeof historyNotifyChange === "function") historyNotifyChange();
    dvUpdateStatusBar();
    dvSyncChrome();
    if (dvGridApi) dvGridApi.refreshCells({ force: true });
}
(function wireFxBar() {
    var input = document.getElementById("dvFxInput");
    if (!input) return;
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { dvFxBarCommit(); input.blur(); } });
    input.addEventListener("blur", dvFxBarCommit);
})();

/* ---------------------------------------------------------------------- *
 * Formula "point mode" — like Excel/Sheets: while the fx bar has focus
 * and its content starts with "=", clicking (or dragging across) cells
 * in the grid inserts their address (or a range like "B2:D5") at the
 * cursor position instead of moving the grid's selection/focus.
 * ---------------------------------------------------------------------- */
var dvFxCaret = { start: 0, end: 0 }; // last known caret/selection inside the fx input
var dvFxPointMode = false;            // true while a point-mode click/drag is in progress
var dvFxPointDrag = null;             // { insStart, insEnd, anchorRow, anchorCol }

function dvFxIsArmed() {
    var input = document.getElementById("dvFxInput");
    return !!(input && document.activeElement === input && /^\s*=/.test(input.value));
}

function dvFxTrackCaret() {
    var input = document.getElementById("dvFxInput");
    if (!input || document.activeElement !== input) return;
    dvFxCaret.start = input.selectionStart || 0;
    dvFxCaret.end = input.selectionEnd || 0;
}

function dvFxInsertRef(text, replaceStart, replaceEnd) {
    var input = document.getElementById("dvFxInput");
    if (!input) return;
    var v = input.value;
    input.value = v.slice(0, replaceStart) + text + v.slice(replaceEnd);
    var caret = replaceStart + text.length;
    input.setSelectionRange(caret, caret);
    dvFxCaret.start = dvFxCaret.end = caret;
    input.classList.add("formula-armed");
}

(function wireFxCaretTracking() {
    var input = document.getElementById("dvFxInput");
    if (!input) return;
    ["keyup", "click", "select", "input"].forEach(function (ev) { input.addEventListener(ev, dvFxTrackCaret); });
    function syncArmedClass() {
        var armed = /^\s*=/.test(input.value) && document.activeElement === input;
        input.classList.toggle("formula-armed", armed);
        var grid = document.getElementById("dataGrid");
        if (grid) grid.classList.toggle("dv-point-mode", armed);
    }
    input.addEventListener("input", syncArmedClass);
    input.addEventListener("focus", syncArmedClass);
    input.addEventListener("blur", function () {
        input.classList.remove("formula-armed");
        var grid = document.getElementById("dataGrid");
        if (grid) grid.classList.remove("dv-point-mode");
    });
})();

function DataColHeader() {}

function rowIdxCellRenderer(params) {
    var wrap = document.createElement("div");
    wrap.className = "row-idx-cell";
    if (params.node.rowPinned) {
        wrap.classList.add("row-idx-stat");
        wrap.title = "Pinned statistic - pick which one in the Statistics panel";
        wrap.textContent = "Σ";
        return wrap;
    }
    var num = document.createElement("span");
    num.textContent = params.node.rowIndex + 1;
    wrap.appendChild(num);
    var del = document.createElement("button");
    del.type = "button"; del.className = "row-del-btn"; del.title = "Delete row";
    del.innerHTML = '<span class="material-symbols-outlined">close</span>';
    del.addEventListener("click", function () { deleteRow(params.node.rowIndex); });
    wrap.appendChild(del);
    return wrap;
}

function getDvGridTheme() {
    if (typeof agGrid === "undefined" || !agGrid.themeQuartz) return null;
    if (!dvGridTheme) {
        dvGridTheme = agGrid.themeQuartz.withParams({
            accentColor: "var(--accent)",
            backgroundColor: "var(--panel)",
            foregroundColor: "var(--ink)",
            borderColor: "var(--line)",
            headerBackgroundColor: "var(--panel-2)",
            headerTextColor: "var(--ink)",
            oddRowBackgroundColor: "var(--panel-2)",
            rowHoverColor: "var(--accent-soft)",
            fontFamily: "inherit",
            fontSize: 12.5,
            // Light gridlines with the card border drawn by .data-grid-wrap.
            wrapperBorderRadius: 0,
            wrapperBorder: false,
            borderColor: "var(--line)",
            rowBorder: true,
            columnBorder: true,
            headerColumnBorder: true,
            headerFontWeight: 600,
            cellHorizontalPadding: 10,
            selectedRowBackgroundColor: "var(--accent-soft)"
        });
    }
    return dvGridTheme;
}

function makeDvColumnDefs() {
    var defs = [{
        headerName: "", colId: "rowIdx", pinned: "left", width: 48,
        resizable: false, sortable: false, editable: false, suppressMovable: true,
        cellRenderer: rowIdxCellRenderer
    }];
    dv.header.forEach(function (h, c) {
        // Numbers read (and compare) better right-aligned, as in spreadsheets.
        var numeric = isNumericColumn(dv.rows, c);
        defs.push({
            colId: "c" + c, field: "c" + c,
            editable: function (p) { return !p.node.rowPinned; },
            // Wide enough for the whole name (~7.5px per char at 12.5px) plus the type icon.
            sortable: false, resizable: true, flex: 1, suppressMovable: true,
            minWidth: Math.min(280, Math.max(140, 56 + String(h || "").length * 7.5)),
            cellClass: numeric ? "dv-cell-num" : "dv-cell-text",
            headerComponent: DataColHeader,
            headerComponentParams: { colIndex: c },
            tooltipValueGetter: function (p) { return isCellInvalid(c, p.value) ? INVALID_CELL_TITLE : ""; },
            cellClassRules: {
                "cell-invalid": function (p) { return isCellInvalid(c, p.value); },
                "cell-formula": function (p) { return dvIsFormula(p.value); },
                "cell-formula-error": function (p) { return dvIsFormula(p.value) && dvFormulaDisplayValue(p.value, p.node.rowIndex) === "#ERROR!"; },
                "cell-range-selected": function (p) { return !p.node.rowPinned && dvCellInSelection(p.node.rowIndex, c); }
            },
            valueGetter: function (p) {
                if (p.node.rowPinned) return p.data ? p.data["c" + c] : "";
                var row = dv.rows[p.node.rowIndex];
                return row && row[c] !== undefined ? row[c] : "";
            },
            valueFormatter: function (p) {
                return dvIsFormula(p.value) ? dvFormulaDisplayValue(p.value, p.node.rowIndex) : p.value;
            },
            valueSetter: function (p) {
                var r = p.node.rowIndex;
                if (!dv.rows[r]) return false;
                dv.rows[r][c] = p.newValue == null ? "" : String(p.newValue);
                updateInvalidCellNotice();
                if (typeof dvRenderStatsSummary === "function") dvRenderStatsSummary();
                if (typeof dvUpdatePinnedStatRow === "function") dvUpdatePinnedStatRow();
                if (typeof historyNotifyChange === "function") historyNotifyChange();
                dvUpdateStatusBar();
                dvSyncChrome();
                setTimeout(function () { if (dvGridApi) dvGridApi.refreshCells({ force: true }); }, 0);
                return true;
            }
        });
    });
    return defs;
}

/* ---------------------------------------------------------------------- *
 * Decorative full-grid shown before any data is imported — plain lettered
 * columns (A, B, C…) and numbered rows extending to fill the pane, so an
 * empty table reads as an empty *spreadsheet* rather than a blank panel.
 * Purely visual (not wired to `dv`); it's replaced the moment real data
 * arrives via refreshDataGrid().
 * ---------------------------------------------------------------------- */
function dvRenderEmptyGrid() {
    var el = document.getElementById("dataGrid");
    if (!el || typeof agGrid === "undefined" || !agGrid.themeQuartz) return;
    if (dvEmptyGridApi) return; // already showing
    el.innerHTML = "";
    el.style.height = "100%";
    var COLS = 18, ROWS = 60;
    var colDefs = [{
        headerName: "", colId: "rowIdx", pinned: "left", width: 48,
        resizable: false, sortable: false, editable: false, suppressMovable: true,
        cellRenderer: function (p) { return String(p.node.rowIndex + 1); },
        cellClass: "row-idx-cell"
    }];
    for (var c = 0; c < COLS; c++) {
        colDefs.push({ headerName: colLetter(c), colId: "e" + c, editable: false, sortable: false, resizable: true, minWidth: 90, suppressMovable: true });
    }
    var rowData = [];
    for (var r = 0; r < ROWS; r++) rowData.push({});
    dvEmptyGridApi = agGrid.createGrid(el, {
        theme: getDvGridTheme(),
        columnDefs: colDefs,
        rowData: rowData,
        headerHeight: 32,
        rowHeight: 32,
        suppressMovableColumns: true,
        suppressClipboardPaste: true,
        animateRows: false
    });
}

/* Header line above the grid ("5 rows × 4 columns") and the empty-state card
   shown over the placeholder grid until data arrives. */
function dvSyncChrome() {
    var has = dv.header.length > 0;
    var sum = document.getElementById("dvSummary");
    if (sum) {
        var r = dv.rows.length, c = dv.header.length;
        sum.textContent = has ? r + (r === 1 ? " row" : " rows") + " × " + c + (c === 1 ? " column" : " columns") : "";
    }
    // The app starts on a blank, editable grid; while every cell is still
    // empty, float the start card under the rows instead of covering them.
    var blank = has && dv.rows.every(function (r) { return r.every(function (v) { return v === "" || v == null; }); });
    var empty = document.getElementById("dvEmptyState");
    if (empty) {
        empty.hidden = has && !blank;
        empty.classList.toggle("dv-empty--hint", blank);
    }
    var wrap = document.querySelector(".data-grid-wrap");
    if (wrap) wrap.classList.toggle("is-empty", !has || blank);
}

(function wireEmptyState() {
    function openImport(focusPaste) {
        var menu = document.getElementById("dvUploadMenu"), btn = document.getElementById("dvUploadToggle");
        if (menu && !menu.classList.contains("open") && btn) btn.click();
        if (focusPaste) setTimeout(function () { var t = document.getElementById("dataInput"); if (t) t.focus(); }, 0);
    }
    var imp = document.getElementById("dvEmptyImport"), paste = document.getElementById("dvEmptyPaste"), sample = document.getElementById("dvEmptySample");
    // Stop these clicks from reaching the menu's outside-click closer.
    [imp, paste, sample].forEach(function (b) { b && b.addEventListener("mousedown", function (e) { e.stopPropagation(); }); });
    imp && imp.addEventListener("click", function (e) { e.stopPropagation(); openImport(false); });
    paste && paste.addEventListener("click", function (e) { e.stopPropagation(); openImport(true); });
    sample && sample.addEventListener("click", function (e) {
        e.stopPropagation();
        var load = document.getElementById("loadSampleBtn"), parse = document.getElementById("parseBtn");
        if (load) load.click();
        if (parse) parse.click();
        var menu = document.getElementById("dvUploadMenu");
        if (menu) menu.classList.remove("open");
    });
})();

function buildDataGridUIInner() {
    // AG Grid is loaded lazily (see js/lazy-loader.js). It's usually already
    // in flight by the time this runs, kicked off when the Data View tab was
    // clicked (see chart-builder/10-view-switcher-init.js) — this check is
    // the defensive fallback for any other path that reaches this function
    // before that fetch resolves (e.g. a very fast programmatic call).
    if (typeof agGrid === "undefined" || !agGrid.themeQuartz) {
        var loadingEl = document.getElementById("dataGrid");
        if (loadingEl) {
            loadingEl.innerHTML = '<div class="dv-loading"><div class="dv-loading-spinner"></div><span>Loading data grid…</span></div>';
        }
        PlootsLazy.ensureAgGrid().then(buildDataGridUIInner);
        return;
    }
    renderLongPickers();
    if (typeof dvRenderShelves === "function") dvRenderShelves();
    dvSyncChrome();
    var el = document.getElementById("dataGrid");
    if (!dv.header.length) {
        if (dvGridApi) { dvGridApi.destroy(); dvGridApi = null; }
        dvFxBarClear();
        dvSelClear();
        updateInvalidCellNotice();
        if (typeof dvRenderStatsSummary === "function") dvRenderStatsSummary();
        if (typeof dvUpdatePinnedStatRow === "function") dvUpdatePinnedStatRow();
        dvRefreshSortSelect();
        dvRenderEmptyGrid();
        return;
    }
    if (dvEmptyGridApi) { dvEmptyGridApi.destroy(); dvEmptyGridApi = null; }
    var rowData = dv.rows.map(function (r, i) { return { __idx: i }; });
    if (dvSel) {
        var maxR = dv.rows.length - 1, maxC = dv.header.length - 1;
        if (dvSel.r0 > maxR || dvSel.r1 > maxR || dvSel.c0 > maxC || dvSel.c1 > maxC) dvSel = null;
    }
    el.style.height = "100%";
    if (dvGridApi && dvGridApi.__dvColCount === dv.header.length) {
        dvGridApi.setGridOption("columnDefs", makeDvColumnDefs());
        dvGridApi.setGridOption("rowData", rowData);
    } else {
        if (dvGridApi) { dvGridApi.destroy(); dvGridApi = null; }
        el.innerHTML = "";
        dvGridApi = agGrid.createGrid(el, {
            theme: getDvGridTheme(),
            columnDefs: makeDvColumnDefs(),
            rowData: rowData,
            headerHeight: 54,
            rowHeight: 32,
            singleClickEdit: true,
            stopEditingWhenCellsLoseFocus: true,
            suppressMovableColumns: true,
            suppressClipboardPaste: true,
            animateRows: false,
            tooltipShowDelay: 300,
            getRowId: function (p) { return String(p.data.__idx); },
            onCellFocused: function (p) {
                if (dvFxPointMode) return; // a formula point-mode click is driving focus; don't let it overwrite the fx bar
                if (p.rowIndex == null || !p.column || p.column.getColId() === "rowIdx") { dvFxBarClear(); return; }
                var col = parseInt(p.column.getColId().slice(1), 10) || 0;
                dvFxBarShow(p.rowIndex, col);
                if (!dvSuppressFocusSelSync && !dvSelDragging) {
                    dvSel = { r0: p.rowIndex, c0: col, r1: p.rowIndex, c1: col };
                    dvUpdateStatusBar();
                    if (dvGridApi) dvGridApi.refreshCells({ force: true });
                }
            },
            onCellMouseDown: function (p) {
                if (p.rowIndex == null || !p.column || p.column.getColId() === "rowIdx" || p.node.rowPinned) return;
                var col = parseInt(p.column.getColId().slice(1), 10) || 0;
                if (dvFxIsArmed()) {
                    if (p.event) p.event.preventDefault();
                    var ref = colLetter(col) + (p.rowIndex + 1);
                    var insStart = dvFxCaret.start, insEnd = dvFxCaret.end;
                    dvFxInsertRef(ref, insStart, insEnd);
                    dvFxPointMode = true;
                    dvFxPointDrag = { insStart: insStart, insEnd: insStart + ref.length, anchorRow: p.rowIndex, anchorCol: col };
                    var input = document.getElementById("dvFxInput");
                    var pos = dvFxCaret.end;
                    setTimeout(function () { if (input) { input.focus(); input.setSelectionRange(pos, pos); } }, 0);
                    return;
                }
                dvSelStart(p.rowIndex, col);
            },
            onCellMouseOver: function (p) {
                if (p.rowIndex == null || !p.column || p.column.getColId() === "rowIdx" || p.node.rowPinned) return;
                var col = parseInt(p.column.getColId().slice(1), 10) || 0;
                if (dvFxPointMode && dvFxPointDrag) {
                    var d = dvFxPointDrag;
                    var r0 = Math.min(d.anchorRow, p.rowIndex), r1 = Math.max(d.anchorRow, p.rowIndex);
                    var c0 = Math.min(d.anchorCol, col), c1 = Math.max(d.anchorCol, col);
                    var ref = (r0 === r1 && c0 === c1)
                        ? colLetter(c0) + (r0 + 1)
                        : colLetter(c0) + (r0 + 1) + ":" + colLetter(c1) + (r1 + 1);
                    dvFxInsertRef(ref, d.insStart, d.insEnd);
                    d.insEnd = d.insStart + ref.length;
                    return;
                }
                dvSelExtendTo(p.rowIndex, col);
            }
        });
        dvGridApi.__dvColCount = dv.header.length;
    }
    // Small tables hug their rows (Σ row right under the data, card ends
    // there); big ones scroll inside the full-height card. The blank starter
    // grid keeps full height so the start card has room below the rows.
    var wrap = el.parentNode;
    var fit = dv.rows.length <= 40 && !(wrap && wrap.classList.contains("is-empty"));
    dvGridApi.setGridOption("domLayout", fit ? "autoHeight" : "normal");
    el.style.height = fit ? "" : "100%";
    if (wrap) wrap.classList.toggle("dv-fit", fit);
    updateInvalidCellNotice();
    if (typeof dvRenderStatsSummary === "function") dvRenderStatsSummary();
    if (typeof dvUpdatePinnedStatRow === "function") dvUpdatePinnedStatRow();
    dvUpdateStatusBar();
    dvRefreshSortSelect();
}

function buildDataGridUI() {
    buildDataGridUIInner();
}

function parseClipboardBlock(text) {
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (text.slice(-1) === "\n") text = text.slice(0, -1);
    var rows = text.split("\n").map(function (r) { return r.split("\t"); });
    if (!rows.some(function (r) { return r.length > 1; }) && text.indexOf(",") !== -1) {
        var parsed = Papa.parse(text, { skipEmptyLines: true });
        if (parsed && parsed.data && parsed.data.length) rows = parsed.data;
    }
    return rows;
}

function pasteBlockAt(startRow, startCol, block) {
    if (!block.length) return;
    var neededCols = startCol + block.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var prevColCount = dv.header.length;
    while (dv.header.length < neededCols) {
        dv.header.push("Column " + (dv.header.length + 1));
        dv.rows.forEach(function (r) { r.push(""); });
    }
    var neededRows = startRow + block.length;
    while (dv.rows.length < neededRows) dv.rows.push(dv.header.map(function () { return ""; }));
    block.forEach(function (r, ri) {
        r.forEach(function (v, ci) { dv.rows[startRow + ri][startCol + ci] = v == null ? "" : String(v); });
    });
    for (var c = prevColCount; c < dv.header.length; c++) dv.roles[c] = isNumericColumn(dv.rows, c) ? "Y" : "Text";
    if (startCol === 0 && dv.header.length) dv.roles[0] = "X";
}

function updateInvalidCellNotice() {
    var el = document.getElementById("invalidCellNotice");
    if (!el) return;
    var n = countInvalidCells();
    if (n > 0) {
        el.style.display = "flex";
        el.querySelector(".notice-text").textContent = n === 1 ? "1 non-numeric cell in a Y/Number column - will be read as 0." : n + " non-numeric cells in Y/Number columns - will be read as 0.";
    } else {
        el.style.display = "none";
    }
}

function addColumn() {
    if (dv.header.length) {
        dv.header.push("Column " + (dv.header.length + 1));
        dv.rows.forEach(function (r) { r.push(""); });
    } else {
        dv.header = ["Column 1"];
        dv.rows = [[""]];
    }
    autoDetectRoles();
    buildDataGridUI();
}

function deleteColumn(idx) {
    if (dv.header.length <= 1) return;
    dv.header.splice(idx, 1);
    dv.rows.forEach(function (r) { r.splice(idx, 1); });
    autoDetectRoles();
    buildDataGridUI();
}

function addRow() {
    if (!dv.header.length) return;
    dv.rows.push(dv.header.map(function () { return ""; }));
    buildDataGridUI();
}

function deleteRow(idx) {
    dv.rows.splice(idx, 1);
    buildDataGridUI();
}

function renderLongPickers() {
    // Superseded by the Columns/Rows/Color drag-and-drop shelves
    // (js/dv_shelves.js) — kept as a no-op stub since other code still
    // calls it as part of the render pipeline.
    var wrap = document.getElementById("longPickerBar");
    if (wrap) wrap.style.display = "none";
}

function buildOutputWide() {
    var xIdx = dv.roles.indexOf("X"); if (xIdx === -1) xIdx = 0;
    var yCols = [];
    dv.roles.forEach(function (role, i) { if (role === "Y" && i !== xIdx) yCols.push(i); });
    return {
        header: [dv.header[xIdx]].concat(yCols.map(function (i) { return dv.header[i]; })),
        rows: dv.rows.map(function (row, ri) {
            var xv = row[xIdx];
            return [xv].concat(yCols.map(function (i) { return dvIsFormula(row[i]) ? dvFormulaDisplayValue(row[i], ri) : row[i]; }));
        })
    };
}

function buildOutputLong() {
    var xIdx = dv.longX, seriesIdx = dv.longSeries, valueIdx = dv.longValue;
    var xVals = [], seriesVals = [], map = {};
    dv.rows.forEach(function (row, ri) {
        var xv = row[xIdx] !== undefined ? row[xIdx] : "";
        var sv = row[seriesIdx] !== undefined ? row[seriesIdx] : "";
        var raw = row[valueIdx];
        var num = parseFloat(dvIsFormula(raw) ? dvFormulaDisplayValue(raw, ri) : raw);
        if (xVals.indexOf(xv) === -1) xVals.push(xv);
        if (seriesVals.indexOf(sv) === -1) seriesVals.push(sv);
        map[xv + "" + sv] = isNaN(num) ? "" : num;
    });
    return {
        header: [dv.header[xIdx] || "Category"].concat(seriesVals),
        rows: xVals.map(function (xv) {
            return [xv].concat(seriesVals.map(function (sv) { var v = map[xv + "" + sv]; return v === undefined ? "" : v; }));
        })
    };
}

// The chart role a column plays, for the header's meta line.
function dvColumnRole(c) {
    if (dv.shape === "long") {
        return c === dv.longX ? { key: "X", label: "X axis" }
            : c === dv.longSeries ? { key: "S", label: "Series" }
            : c === dv.longValue ? { key: "Y", label: "Value" } : null;
    }
    return dv.roles[c] === "X" ? { key: "X", label: "X axis" } : dv.roles[c] === "Y" ? { key: "Y", label: "Y axis" } : null;
}

DataColHeader.prototype.init = function (params) {
    var c = params.colIndex;
    var numeric = isNumericColumn(dv.rows, c);
    var role = dvColumnRole(c);
    var el = document.createElement("div");
    el.className = "dv-header" + (role ? " role-" + role.key : "") + (numeric ? " is-num" : "");

    var top = document.createElement("div");
    top.className = "dv-header-top";

    var type = document.createElement("span");
    type.className = "dv-type material-symbols-outlined";
    type.textContent = numeric ? "tag" : "match_case";
    type.title = numeric ? "Numbers" : "Text";
    top.appendChild(type);

    var name = document.createElement("input");
    name.type = "text"; name.className = "hname"; name.value = dv.header[c] || "Column " + (c + 1);
    name.title = name.value + " \u2014 click to rename";
    name.spellcheck = false;
    ["mousedown", "click", "dblclick"].forEach(function (ev) { name.addEventListener(ev, function (e) { e.stopPropagation(); }); });
    name.addEventListener("input", function () { dv.header[c] = name.value; });
    name.addEventListener("keydown", function (e) { if (e.key === "Enter") name.blur(); });
    name.addEventListener("change", function () { if (typeof dvRenderShelves === "function") dvRenderShelves(); });
    top.appendChild(name);

    // One button that cycles: none -> ascending -> descending -> none.
    var dir = dv.sortCol === c ? dv.sortDir : null;
    var sortBtn = document.createElement("button");
    sortBtn.type = "button";
    sortBtn.className = "dv-sort-btn" + (dir ? " active" : "");
    sortBtn.title = dir === "asc" ? "Sorted ascending \u2014 click for descending"
        : dir === "desc" ? "Sorted descending \u2014 click to clear" : "Sort ascending";
    sortBtn.innerHTML = '<span class="material-symbols-outlined">' + (dir === "asc" ? "arrow_upward" : dir === "desc" ? "arrow_downward" : "swap_vert") + "</span>";
    sortBtn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    sortBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!dir) sortByColumn(c, "asc");
        else if (dir === "asc") sortByColumn(c, "desc");
        else dvClearSort();
    });
    top.appendChild(sortBtn);

    var del = document.createElement("button");
    del.type = "button"; del.className = "col-del-btn"; del.title = "Delete column";
    del.innerHTML = '<span class="material-symbols-outlined">delete</span>';
    del.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    del.addEventListener("click", function (e) { e.stopPropagation(); deleteColumn(c); });
    top.appendChild(del);
    el.appendChild(top);

    // Meta line: spreadsheet letter (used by formulas) + the chart role.
    // Roles are assigned in the shelves (js/dv_shelves.js).
    var meta = document.createElement("div");
    meta.className = "dv-header-meta";
    var letter = document.createElement("span");
    letter.className = "col-letter-badge";
    letter.textContent = colLetter(c);
    letter.title = "Column " + colLetter(c) + " in formulas";
    meta.appendChild(letter);
    if (role) {
        var chip = document.createElement("span");
        chip.className = "dv-role-chip role-" + role.key;
        chip.textContent = role.label;
        meta.appendChild(chip);
    } else {
        var unused = document.createElement("span");
        unused.className = "dv-role-none";
        unused.textContent = "Not plotted";
        meta.appendChild(unused);
    }
    el.appendChild(meta);
    this.eGui = el;
};
DataColHeader.prototype.getGui = function () { return this.eGui; };
DataColHeader.prototype.refresh = function () { return false; };

(function wirePaste() {
    var el = document.getElementById("dataGrid");
    if (!el || el.__pasteBound) return;
    el.__pasteBound = true;
    el.addEventListener("paste", function (e) {
        var target = e.target;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
        var text = (e.clipboardData || window.clipboardData) ? (e.clipboardData || window.clipboardData).getData("text/plain") : "";
        if (!text) return;
        e.preventDefault();
        var block = parseClipboardBlock(text);
        if (!block.length) return;
        var row = 0, col = 0;
        if (dvGridApi) {
            var focused = dvGridApi.getFocusedCell();
            if (focused) {
                row = focused.rowIndex;
                var colId = focused.column.getColId();
                col = colId === "rowIdx" ? 0 : parseInt(colId.slice(1), 10) || 0;
            }
        }
        pasteBlockAt(row, col, block);
        buildDataGridUI();
        if (dvGridApi) setTimeout(function () { dvGridApi.setFocusedCell(row, "c" + col); }, 0);
    });
})();

document.getElementById("addColBtn").addEventListener("click", addColumn);
document.getElementById("addRowBtn").addEventListener("click", addRow);

(function wireImportPanel() {
    var toggle = document.getElementById("dvUploadToggle"), panel = document.getElementById("dvUploadMenu");
    if (!toggle || !panel) return;
    function close() { panel.classList.remove("open"); toggle.classList.remove("active"); }
    function afterParse() {
        var status = document.getElementById("parseStatus");
        if (!status || status.className.indexOf("error") === -1) close();
    }
    toggle.addEventListener("click", function (e) {
        e.stopPropagation();
        panel.classList.contains("open") ? close() : (panel.classList.add("open"), toggle.classList.add("active"));
    });
    panel.addEventListener("click", function (e) { e.stopPropagation(); });
    document.addEventListener("click", function (e) {
        if (panel.classList.contains("open") && e.target !== toggle && !toggle.contains(e.target) && !panel.contains(e.target)) close();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    ["csvFile", "tsvFile", "xlsxFile", "jsonFile"].forEach(function (id) {
        var input = document.getElementById(id);
        if (input) input.addEventListener("change", function () { setTimeout(afterParse, 60); });
    });
    var parseBtn = document.getElementById("parseBtn");
    if (parseBtn) parseBtn.addEventListener("click", function () { setTimeout(afterParse, 60); });
    var sampleBtn = document.getElementById("loadSampleBtn");
    if (sampleBtn) sampleBtn.addEventListener("click", function () { setTimeout(afterParse, 60); });
})();

/* ---------------------------------------------------------------------- *
 * Import buttons — each file type now has its own labeled/iconed button
 * (CSV, TSV, Excel, JSON) instead of one shared "CSV/TSV" button, each
 * wired to its own hidden <input type="file">. TSV has no dedicated
 * parser of its own — it forwards the picked file onto the #csvFile
 * input, whose handler already auto-detects the delimiter (Papa Parse).
 * ---------------------------------------------------------------------- */
(function wireImportFileButtons() {
    [["csvBtnWrap", "csvFile"], ["tsvBtnWrap", "tsvFile"], ["xlsxBtnWrap", "xlsxFile"], ["jsonBtnWrap", "jsonFile"]].forEach(function (pair) {
        var btn = document.getElementById(pair[0]), input = document.getElementById(pair[1]);
        if (btn && input) btn.addEventListener("click", function () { input.click(); });
    });
    var tsvInput = document.getElementById("tsvFile"), csvInput = document.getElementById("csvFile");
    if (tsvInput && csvInput) {
        tsvInput.addEventListener("change", function () {
            if (!tsvInput.files || !tsvInput.files[0]) return;
            var dt = new DataTransfer();
            dt.items.add(tsvInput.files[0]);
            csvInput.files = dt.files;
            csvInput.dispatchEvent(new Event("change"));
            tsvInput.value = "";
        });
    }
})();

/* ---------------------------------------------------------------------- *
 * Show an empty, gridlined spreadsheet the first time the Data View tab
 * is opened, instead of a blank pane — feels like opening a real
 * spreadsheet (Google Sheets/Excel) rather than an empty import screen.
 * ---------------------------------------------------------------------- */
(function wireDefaultBlankGrid() {
    var shown = false;
    var origSetView = window.setView;
    if (typeof origSetView !== "function") return;
    window.setView = function (view) {
        origSetView(view);
        if (view === "data" && !shown && !dv.header.length) {
            shown = true;
            var header = ["Column 1", "Column 2", "Column 3", "Column 4"];
            var rows = [];
            for (var r = 0; r < 12; r++) rows.push(header.map(function () { return ""; }));
            refreshDataGrid(header, rows);
        }
    };
})();

document.getElementById("applyDataBtn").addEventListener("click", function () {
    if (!dv.header.length) return;
    var out = dv.shape === "wide" ? buildOutputWide() : buildOutputLong();
    if (out.header.length < 2 || out.rows.length === 0) {
        var status = document.getElementById("parseStatus");
        status.className = "status error";
        status.textContent = "Pick at least one X column and one Y/series column first.";
        return;
    }
    applyTable(out.header, out.rows);
    setView("layout");
});
