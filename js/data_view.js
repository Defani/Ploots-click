/* ==========================================================================
   Data View — spreadsheet-style table for entering/editing chart data.
   Backed by AG Grid. Features:
     - Compact, Google-Sheets-like density (slim rows/headers)
     - Column sort (ascending "min→max" / descending "max→min")
     - Basic spreadsheet formulas ( =SUM(A1:A5) etc. — see data_formulas.js )
     - fx bar showing the selected cell's address + raw content
     - AG Grid + jStat are loaded lazily on demand — prefetched the moment
       the Data View tab is opened, with a defensive re-check + spinner in
       buildDataGridUIInner() as a fallback. See js/lazy-loader.js.
   ========================================================================== */

var dv = { header: [], rows: [], shape: "wide", roles: [], longX: 0, longSeries: 1, longValue: 2, sortCol: -1, sortDir: null };

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

document.addEventListener("mouseup", function () { dvSelDragging = false; });

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
 * AG Grid + jStat are loaded eagerly via <script> tags in index.html,
 * so no runtime fetch/wait is needed here anymore.
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
    if (dvGridApi) dvGridApi.refreshCells({ force: true });
}
(function wireFxBar() {
    var input = document.getElementById("dvFxInput");
    if (!input) return;
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { dvFxBarCommit(); input.blur(); } });
    input.addEventListener("blur", dvFxBarCommit);
})();

function DataColHeader() {}

function rowIdxCellRenderer(params) {
    var wrap = document.createElement("div");
    wrap.className = "row-idx-cell";
    if (params.node.rowPinned) {
        wrap.classList.add("row-idx-stat");
        wrap.title = "Statistic (jStat) - pick which one in the ribbon";
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
            fontSize: 12,
            wrapperBorderRadius: 8,
            wrapperBorder: false,
            // Explicit row + column borders so the grid reads as a real
            // spreadsheet (visible gridlines) even before any data is typed.
            rowBorder: true,
            columnBorder: true
        });
    }
    return dvGridTheme;
}

function makeDvColumnDefs() {
    var defs = [{
        headerName: "", colId: "rowIdx", pinned: "left", width: 40,
        resizable: false, sortable: false, editable: false, suppressMovable: true,
        cellRenderer: rowIdxCellRenderer
    }];
    dv.header.forEach(function (h, c) {
        defs.push({
            colId: "c" + c, field: "c" + c,
            editable: function (p) { return !p.node.rowPinned; },
            sortable: false, resizable: true, minWidth: 110, suppressMovable: true,
            filter: "agTextColumnFilter", floatingFilter: true,
            floatingFilterComponentParams: { suppressFilterButton: true },
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
                setTimeout(function () { if (dvGridApi) dvGridApi.refreshCells({ force: true }); }, 0);
                return true;
            }
        });
    });
    return defs;
}

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
    var el = document.getElementById("dataGrid");
    if (!dv.header.length) {
        if (dvGridApi) { dvGridApi.destroy(); dvGridApi = null; }
        el.innerHTML = "";
        dvFxBarClear();
        dvSelClear();
        updateInvalidCellNotice();
        if (typeof dvRenderStatsSummary === "function") dvRenderStatsSummary();
        if (typeof dvUpdatePinnedStatRow === "function") dvUpdatePinnedStatRow();
        return;
    }
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
            headerHeight: 46,
            rowHeight: 26,
            singleClickEdit: true,
            stopEditingWhenCellsLoseFocus: true,
            suppressMovableColumns: true,
            suppressClipboardPaste: true,
            animateRows: false,
            tooltipShowDelay: 300,
            getRowId: function (p) { return String(p.data.__idx); },
            onCellFocused: function (p) {
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
                dvSelStart(p.rowIndex, col);
            },
            onCellMouseOver: function (p) {
                if (p.rowIndex == null || !p.column || p.column.getColId() === "rowIdx" || p.node.rowPinned) return;
                var col = parseInt(p.column.getColId().slice(1), 10) || 0;
                dvSelExtendTo(p.rowIndex, col);
            }
        });
        dvGridApi.__dvColCount = dv.header.length;
    }
    updateInvalidCellNotice();
    if (typeof dvRenderStatsSummary === "function") dvRenderStatsSummary();
    if (typeof dvUpdatePinnedStatRow === "function") dvUpdatePinnedStatRow();
    dvUpdateStatusBar();
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
    var wrap = document.getElementById("longPickerBar");
    if (!wrap) return;
    function field(label, current, onChange) {
        var f = document.createElement("div"); f.className = "dv-lp-field";
        var lab = document.createElement("label"); lab.className = "field-label"; lab.textContent = label;
        var sel = document.createElement("select");
        dv.header.forEach(function (h, i) {
            var opt = document.createElement("option");
            opt.value = i; opt.textContent = h || "Column " + (i + 1);
            if (i === current) opt.selected = true;
            sel.appendChild(opt);
        });
        sel.addEventListener("change", function () { onChange(parseInt(sel.value, 10)); });
        f.appendChild(lab); f.appendChild(sel); wrap.appendChild(f);
    }
    wrap.innerHTML = "";
    if (dv.shape === "long" && dv.header.length) {
        wrap.style.display = "flex";
        field("X column (category)", dv.longX, function (v) { dv.longX = v; });
        field("Series column (becomes chart columns)", dv.longSeries, function (v) { dv.longSeries = v; });
        field("Value column (numbers)", dv.longValue, function (v) { dv.longValue = v; });
    } else {
        wrap.style.display = "none";
    }
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

DataColHeader.prototype.init = function (params) {
    var c = params.colIndex;
    var el = document.createElement("div");
    el.className = "dv-header" + (dv.shape === "wide" ? (dv.roles[c] === "X" ? " role-X" : dv.roles[c] === "Y" ? " role-Y" : "") : "");

    var top = document.createElement("div");
    top.className = "dv-header-top";

    var badge = document.createElement("span");
    badge.className = "col-letter-badge";
    badge.textContent = colLetter(c);
    top.appendChild(badge);

    var name = document.createElement("input");
    name.type = "text"; name.className = "hname"; name.value = dv.header[c] || "Column " + (c + 1); name.title = "Column name";
    ["mousedown", "click", "dblclick"].forEach(function (ev) { name.addEventListener(ev, function (e) { e.stopPropagation(); }); });
    name.addEventListener("input", function () { dv.header[c] = name.value; });
    top.appendChild(name);

    var sortWrap = document.createElement("span");
    sortWrap.className = "dv-sort-wrap";
    var ascBtn = document.createElement("button");
    ascBtn.type = "button"; ascBtn.className = "dv-sort-btn" + (dv.sortCol === c && dv.sortDir === "asc" ? " active" : "");
    ascBtn.title = "Sort min \u2192 max (A\u2192Z)"; ascBtn.innerHTML = '<span class="material-symbols-outlined">arrow_upward</span>';
    ascBtn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    ascBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        dv.sortCol === c && dv.sortDir === "asc" ? dvClearSort() : sortByColumn(c, "asc");
    });
    var descBtn = document.createElement("button");
    descBtn.type = "button"; descBtn.className = "dv-sort-btn" + (dv.sortCol === c && dv.sortDir === "desc" ? " active" : "");
    descBtn.title = "Sort max \u2192 min (Z\u2192A)"; descBtn.innerHTML = '<span class="material-symbols-outlined">arrow_downward</span>';
    descBtn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    descBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        dv.sortCol === c && dv.sortDir === "desc" ? dvClearSort() : sortByColumn(c, "desc");
    });
    sortWrap.appendChild(ascBtn); sortWrap.appendChild(descBtn);
    top.appendChild(sortWrap);

    var del = document.createElement("button");
    del.type = "button"; del.className = "col-del-btn"; del.title = "Delete column";
    del.innerHTML = '<span class="material-symbols-outlined">close</span>';
    del.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    del.addEventListener("click", function (e) { e.stopPropagation(); deleteColumn(c); });
    top.appendChild(del);

    el.appendChild(top);

    if (dv.shape === "wide") {
        var sel = document.createElement("select");
        sel.title = "Column role";
        sel.addEventListener("mousedown", function (e) { e.stopPropagation(); });
        ROLE_OPTIONS_WIDE.forEach(function (r) {
            var opt = document.createElement("option");
            opt.value = r; opt.textContent = ROLE_LABEL[r];
            if (dv.roles[c] === r) opt.selected = true;
            sel.appendChild(opt);
        });
        sel.addEventListener("change", function () { dv.roles[c] = sel.value; buildDataGridUI(); });
        el.appendChild(sel);
    }
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
    var toggle = document.getElementById("dvImportToggle"), panel = document.getElementById("dvImportPanel");
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
