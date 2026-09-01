/* ==========================================================================
   Data View – basic spreadsheet formula engine
   Supports:  =A1+B1   =SUM(A1:A5)   =AVERAGE(B2:B9)   =MIN(...)/MAX(...)
              =COUNT(...) =PRODUCT(...) =ABS(A1) =ROUND(A1)
              Nested refs (a formula cell can reference another formula cell)
   Guards against circular references (#CIRC!) and bad expressions (#ERROR!)
   ========================================================================== */

var dvFormulaStack = [];

function dvIsFormula(raw) {
    return typeof raw === "string" && raw.trim().charAt(0) === "=";
}

function dvCellKey(row, col) {
    return row + "," + col;
}

// "AB" -> 27 (1-based), used to turn column letters into a dv.rows index
function dvColIndexFromLetters(letters) {
    letters = letters.toUpperCase();
    var n = 0;
    for (var i = 0; i < letters.length; i++) {
        n = n * 26 + (letters.charCodeAt(i) - 64);
    }
    return n - 1;
}

// "B3" -> {col:1, row:2}
function dvParseCellToken(tok) {
    var m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(tok.trim());
    if (!m) return null;
    return { col: dvColIndexFromLetters(m[1]), row: parseInt(m[2], 10) - 1 };
}

function dvGetCellRaw(row, col) {
    var r = dv.rows[row];
    return r && r[col] !== undefined ? r[col] : "";
}

// Resolves a single cell to a number, recursing into nested formulas.
// Returns NaN for blank/text/circular/broken cells (callers filter NaN out).
function dvGetCellComputedNumber(row, col) {
    var key = dvCellKey(row, col);
    if (dvFormulaStack.indexOf(key) !== -1) return NaN; // circular reference
    var raw = dvGetCellRaw(row, col);
    if (raw === "" || raw === null || raw === undefined) return NaN;
    if (dvIsFormula(raw)) {
        dvFormulaStack.push(key);
        var val = dvEvaluateFormulaExpr(raw.trim().slice(1), row);
        dvFormulaStack.pop();
        return typeof val === "number" && !isNaN(val) ? val : NaN;
    }
    return looksNumeric(raw) ? parseFloat(raw) : NaN;
}

// Collects numeric values across a range token like "A1:A5" or "A:A" (whole column)
function dvRangeValues(rangeTok) {
    var parts = rangeTok.split(":");
    var a = dvParseCellToken(parts[0].match(/\d/) ? parts[0] : parts[0] + "1");
    var bTok = parts[1] || parts[0];
    var wholeCol = !/\d/.test(parts[0]) && !/\d/.test(bTok);
    var b = wholeCol ? { col: dvColIndexFromLetters(bTok), row: dv.rows.length - 1 } : dvParseCellToken(/\d/.test(bTok) ? bTok : bTok + (dv.rows.length));
    if (!a || !b) return [];
    var r0 = Math.min(a.row, b.row), r1 = Math.max(a.row, b.row);
    var c0 = Math.min(a.col, b.col), c1 = Math.max(a.col, b.col);
    var out = [];
    for (var r = r0; r <= r1; r++) {
        for (var c = c0; c <= c1; c++) {
            var v = dvGetCellComputedNumber(r, c);
            if (!isNaN(v)) out.push(v);
        }
    }
    return out;
}

var DV_FORMULA_FUNCS = {
    SUM: function (v) { return v.reduce(function (a, b) { return a + b; }, 0); },
    AVERAGE: function (v) { return v.length ? DV_FORMULA_FUNCS.SUM(v) / v.length : 0; },
    AVG: function (v) { return DV_FORMULA_FUNCS.AVERAGE(v); },
    MIN: function (v) { return v.length ? Math.min.apply(null, v) : 0; },
    MAX: function (v) { return v.length ? Math.max.apply(null, v) : 0; },
    COUNT: function (v) { return v.length; },
    PRODUCT: function (v) { return v.reduce(function (a, b) { return a * b; }, 1); },
    ABS: function (v) { return Math.abs(v[0] || 0); },
    ROUND: function (v) { return Math.round(v[0] || 0); }
};

var DV_FUNC_CALL_RE = /\b(SUM|AVERAGE|AVG|MIN|MAX|COUNT|PRODUCT|ABS|ROUND)\(([^()]*)\)/i;
var DV_RANGE_RE = /^[A-Za-z]{1,3}\d{0,7}:[A-Za-z]{1,3}\d{0,7}$/;
var DV_REF_RE = /\$?\b([A-Za-z]{1,3})\$?(\d{1,7})\b/g;

function dvEvalFuncArgs(argStr) {
    var vals = [];
    argStr.split(",").map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (arg) {
        if (DV_RANGE_RE.test(arg)) {
            vals = vals.concat(dvRangeValues(arg));
        } else {
            var ref = dvParseCellToken(arg);
            if (ref) {
                var v = dvGetCellComputedNumber(ref.row, ref.col);
                if (!isNaN(v)) vals.push(v);
            } else {
                var n = parseFloat(arg);
                if (!isNaN(n)) vals.push(n);
            }
        }
    });
    return vals;
}

// Evaluates the part of a formula after the leading "=".
function dvEvaluateFormulaExpr(expr, currentRow) {
    try {
        var guard = 0;
        while (DV_FUNC_CALL_RE.test(expr) && guard++ < 25) {
            expr = expr.replace(DV_FUNC_CALL_RE, function (_, fname, argStr) {
                var fn = DV_FORMULA_FUNCS[fname.toUpperCase()];
                return fn ? String(fn(dvEvalFuncArgs(argStr))) : "0";
            });
        }
        expr = expr.replace(DV_REF_RE, function (m, col, row) {
            var ref = dvParseCellToken(col + row);
            if (!ref) return m;
            var v = dvGetCellComputedNumber(ref.row, ref.col);
            return isNaN(v) ? "0" : String(v);
        });
        if (!expr.trim()) return NaN;
        var result = (typeof math !== "undefined" && math.evaluate) ? math.evaluate(expr) : Function('"use strict";return (' + expr + ")")();
        return typeof result === "number" && isFinite(result) ? result : NaN;
    } catch (e) {
        return NaN;
    }
}

// Public entry point: raw cell text -> what the grid should display.
function dvFormulaDisplayValue(raw, row) {
    if (!dvIsFormula(raw)) return raw;
    dvFormulaStack = [];
    var v = dvEvaluateFormulaExpr(raw.trim().slice(1), row);
    if (isNaN(v)) return "#ERROR!";
    return typeof dvFormatStat === "function" ? dvFormatStat(v) : String(Math.round(v * 1000) / 1000);
}
