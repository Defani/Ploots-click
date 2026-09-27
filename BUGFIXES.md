# Bug fixes — 2026-09-23

Verified in headless Chromium (Playwright): all 25 chart types render with
sample data and with blank cells, SVG + PNG export works for every type, map
chart types survive repeated switching, 0 console errors from app code.

1. **Missing Plotly traces.** `vendor/plotly-cartesian.min.js` lacked
   waterfall, funnel, treemap, sankey and splom — waterfall/funnel silently
   fell back to a scatter plot, the other three rendered empty. Replaced with
   `vendor/plotly-ploots.min.js`, a custom Plotly 3.7.0 build
   (`npm run custom-bundle -- --out ploots-geo --traces bar,box,contour,heatmap,histogram,histogram2d,histogram2dcontour,image,pie,scatter,scatterternary,violin,waterfall,funnel,treemap,sankey,splom,choropleth,scattergeo`).
2. **Choropleth / Bubble Map blank on second visit, and cartesian charts
   broken after leaving a map before it finished loading.** Caused by swapping
   `window.Plotly` between two bundles. The geo traces are now in the single
   bundle; all swap logic removed. Base-map topojson is served locally from
   `vendor/topojson/` (offline-capable, no cdn.plot.ly dependency).
3. **"Loading map…" placeholder left permanently inside `#plotlyDiv`.**
   Removed before plotting; Plotly state is purged before placeholders.
4. **Phantom axis clicks on sunburst / radial rings / ridge plot.** Raw-SVG
   renderers now `Plotly.purge()` the div first, and
   `axisFormatGetAxisStrips()` requires a live cartesian subplot.
5. **Number parsing corrupted data.** Decimal-comma values were truncated
   (`0,52` → 0, `182,4` → 182) and empty cells became 0. Numeric columns are
   now normalised (decimal comma, thousands separators) and empty/non-numeric
   cells become gaps (`null`); the status line reports how many. Regression,
   error bars, lollipop stems, dumbbell connectors, ridge KDE, sankey,
   bubble map and splom skip missing values instead of treating them as 0.
6. **`isFinite(null) === true`.** 36 checks on nullable `state.*` values used
   global `isFinite`, so unset values counted as 0 (e.g. the Axis Tick quick
   slider showed "0px", tick width ignored the axis line width, a half-filled
   custom range sent `null` to Plotly). Now `Number.isFinite`.
7. **Service worker.** Was cache-first for index.html with a fixed cache name
   (returning users never got updates; 18 scripts missing from precache) and
   cached opaque CDN responses (possible permanent error caching). Now
   network-first for the app shell, cache-first only for version-pinned CDN
   files fetched in CORS mode, only 2xx responses cached, cache `v2`.
8. Minor: empty data now clears the canvas for every custom chart type;
   duplicate `borderColor` key in the Data View grid theme removed.

Not changed: `js/function_plot.js` and `js/standalone_function_plot.js` are
still present but not loaded by index.html (the Function Plot panel is
empty) — left as-is pending a decision to restore or delete that feature.

## Follow-up — axis line thickness

- Default axis line thickness is now **1 px** (was 1.6).
- X and Y always share one thickness for both the axis line and the tick
  marks. All three controls — Display › Axis line, Format Axis › Line width
  (X + Y), and Quick Adjust › Line thickness — call
  `setAxisLineThickness()` (js/layout-editor/19-axis-tick-float.js), which
  stores the value in `state.axisLineWidth`, clears the per-axis overrides and
  keeps the other two controls in sync.
