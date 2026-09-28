
# Ploots Click

A single-page, no-backend chart builder for publication-ready figures — paste your data, style it, lay it out, and export print-quality PNG/SVG. 100% client-side, hosted free on **GitHub Pages**.

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![D3.js](https://img.shields.io/badge/D3.js-F9A03C?logo=d3dotjs&logoColor=white)
![Fabric.js](https://img.shields.io/badge/Fabric.js-5.3.0-4A9C9C)
![MathJax](https://img.shields.io/badge/MathJax_(LaTeX)-1B3E6F?logo=latex&logoColor=white)
![math.js](https://img.shields.io/badge/Math_Engine-math.js-FF6600)
![Papa Parse](https://img.shields.io/badge/CSV%2FTSV_Parsing-Papa_Parse-00A98F)
![SheetJS](https://img.shields.io/badge/Excel_Import-SheetJS-217346?logo=microsoftexcel&logoColor=white)
![AG Grid](https://img.shields.io/badge/Data_View-AG_Grid-13B5EA)
![jStat](https://img.shields.io/badge/Statistics-jStat-6E4B9E)
![Google Fonts](https://img.shields.io/badge/Google_Fonts-4285F4?logo=googlefonts&logoColor=white)
![Material Symbols](https://img.shields.io/badge/Icons-Material_Symbols-4285F4?logo=googlefonts&logoColor=white)
![Iconify](https://img.shields.io/badge/Icon_Reserve-Iconify-1769AA?logo=iconify&logoColor=white)
![Backend](https://img.shields.io/badge/Backend-None-brightgreen)
![Powered by GitHub Pages](https://img.shields.io/badge/Powered_by-GitHub_Pages-222?logo=github&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

![GitHub stars](https://img.shields.io/github/stars/Defani/Ploots-click?style=flat&color=yellow)
![GitHub last commit](https://img.shields.io/github/last-commit/Defani/Ploots-click)
![GitHub issues](https://img.shields.io/github/issues/Defani/Ploots-click)
![Website](https://img.shields.io/website?url=https%3A%2F%2Fdefani.github.io%2FPloots-click%2F&label=live%20app)

**🔗 apps: [defani.github.io/Ploots-click](https://defani.github.io/Ploots-click/)**

## Table of Contents

- [What is this?](#what-is-this)
- [Interface](#interface)
- [Features](#features)
  - [Charts](#charts)
  - [Chart gallery](#chart-gallery)
  - [Data View](#data-view)
  - [Editor: toolbars, Design panel & layers](#editor-toolbars-design-panel--layers)
  - [Page layout & annotation](#page-layout--annotation)
  - [Export](#export)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [LaTeX & Symbol Catalog](#latex--symbol-catalog)
- [Color Palettes — sources & licensing](#color-palettes--sources--licensing)
- [Fonts — sources & licensing](#fonts--sources--licensing)
- [Icons — sources & licensing](#icons--sources--licensing)
- [Page templates](#page-templates)
- [Fill patterns, dash styles & data-point markers](#fill-patterns-dash-styles--data-point-markers)
- [Layout shape library](#layout-shape-library)
- [Export details](#export-details)
- [Value label formatting](#value-label-formatting)
- [Error bars](#error-bars)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Libraries & versions](#libraries--versions)
- [Known limitations](#known-limitations)
- [Built with](#built-with)
- [License](#license)
- [Purpose & Acknowledgements](#purpose--acknowledgements)
- [Feedback & Contributions](#feedback--contributions)
- [Author](#author)

## What is this?

Ploots Click is a **client-side-only web app**: open the page (or visit the GitHub Pages link below) and everything — data parsing, chart rendering, page layout, and export — happens locally in your browser tab. Nothing you paste or upload is ever sent to a server, because there is no server. The app is just static HTML, CSS, and JavaScript, deployed straight from this repository via GitHub Pages, which is why it costs nothing to run and needs zero setup.

[⬆️ Back to Table of Contents](#table-of-contents)

## Interface

<p align="center">
  <img src="assets/screenshots/editor-light.png" alt="Ploots Click editor: chart type gallery on the left, a grouped bar chart on an A4 page, Design panel on the right" width="100%">
</p>

The editor has three columns: the **left sidebar** (Data, Canvas, Chart, Axis, Legend, Shapes, Style, LaTeX, Export), the **page canvas** in the middle with rulers and a zoom slider, and the **right panel** with the Figma-style **Design** and **Layers** tabs. A dark theme is one click away (moon icon, top right):

<p align="center">
  <img src="assets/screenshots/editor-dark.png" alt="The same editor in dark theme" width="100%">
</p>

Live app: **[defani.github.io/Ploots-click](https://defani.github.io/Ploots-click/)**

[⬆️ Back to Table of Contents](#table-of-contents)

## Features

### Charts
- **25 chart types, all drawn by one D3.js engine** (`js/d3-engine/`), so axes, ticks, legends, titles, patterns and export behave the same on every chart:

  | Group | Chart types |
  |---|---|
  | Bar | single bar, grouped bar, stacked bar (incl. 100%), lollipop, dumbbell / slope |
  | Line & Area | line, area, scatter, bubble |
  | Circular | pie, donut, radial rings (multi-track), sunburst |
  | Distribution | histogram, box plot, violin plot, ridge plot |
  | Other | heatmap, waterfall, funnel, treemap, sankey, scatter matrix |
  | Map | choropleth map, bubble map |

- **Maps** (choropleth and bubble map) are drawn with d3-geo from Natural Earth base maps served locally from `vendor/topojson/`, so they work offline. Choropleth takes ISO-3 codes or country names, a continuous or classed colour scale, several scopes (world, continents, USA) and projections, a fixed value range for comparing maps, or your own **custom GeoJSON** (e.g. Indonesian provinces).
- **Radial rings (multi-track)**: circular category plot in the style of multi-genome COG/functional-category figures. Categories become angular sectors (width ∝ average share), each series a concentric track, with outside labels that are spread apart and joined to their sector by leader lines.
- **Sunburst**: slash-delimited paths (`Vegetasi/Mangrove/Rapat`) become a hierarchy; click a segment to zoom in, click the centre to zoom back out.
- **Sankey**: rows written as `Source -> Target` become flows between nodes, with links drawn as filled ribbons.
- **Format Axis**: click an axis on the chart to open a per-axis panel: range (auto or fixed), logarithmic scale, major/minor tick spacing, tick marks and their position, number format, line width and colour.
- **Data input**: paste tab- or comma-separated data, or import **CSV/TSV/TXT** (Papa Parse, so quoted fields and embedded commas are handled), **Excel** `.xlsx`/`.xls` (SheetJS, multi-sheet), or **JSON** (array of objects or 2D array).
- **Per-series controls**: visibility, colour, label, fill pattern, marker shape, and a **secondary Y-axis** (bar/line/area/scatter).
- **Visual style modes**: Color, Color + Pattern, or Pattern (grayscale), backed by 8 hatch/fill patterns, so figures stay readable in print or black-and-white.
- **106 built-in colour palettes**, see [Color Palettes](#color-palettes--sources--licensing).
- **Typography**: 5 fonts (Cambria, Times New Roman, Arial, Poppins, Cambria Math) with separate controls for the title/subtitle and for the chart body, axes and legend.
- **Legend**: show/hide, 7 position presets, 1 to 4 columns, title, font size, border, drag it anywhere on the chart, or **detach** it into a free object on the page (pie, donut, funnel and treemap legends list their categories).
- **Value labels** with formatting (auto, integer, 1 or 2 decimals, thousands separator, percent, currency), **error bars** (percent or fixed), bar gap/width controls, outline and frame toggles.

### Chart gallery

Every chart type, rendered by the D3 engine from its built-in sample data (click an image to open it full size):

<table>
  <tr>
    <td align="center"><img src="assets/screenshots/charts/bar-single.png" width="260"><br><sub>Bar – single</sub></td>
    <td align="center"><img src="assets/screenshots/charts/bar-group.png" width="260"><br><sub>Bar – grouped</sub></td>
    <td align="center"><img src="assets/screenshots/charts/bar-stack.png" width="260"><br><sub>Bar – stacked</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/screenshots/charts/lollipop.png" width="260"><br><sub>Lollipop</sub></td>
    <td align="center"><img src="assets/screenshots/charts/dumbbell.png" width="260"><br><sub>Dumbbell / slope</sub></td>
    <td align="center"><img src="assets/screenshots/charts/line.png" width="260"><br><sub>Line</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/screenshots/charts/area.png" width="260"><br><sub>Area</sub></td>
    <td align="center"><img src="assets/screenshots/charts/scatter.png" width="260"><br><sub>Scatter</sub></td>
    <td align="center"><img src="assets/screenshots/charts/bubble.png" width="260"><br><sub>Bubble</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/screenshots/charts/pie.png" width="260"><br><sub>Pie</sub></td>
    <td align="center"><img src="assets/screenshots/charts/donut.png" width="260"><br><sub>Donut</sub></td>
    <td align="center"><img src="assets/screenshots/charts/radial-rings.png" width="260"><br><sub>Radial rings</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/screenshots/charts/sunburst.png" width="260"><br><sub>Sunburst</sub></td>
    <td align="center"><img src="assets/screenshots/charts/histogram.png" width="260"><br><sub>Histogram</sub></td>
    <td align="center"><img src="assets/screenshots/charts/box.png" width="260"><br><sub>Box plot</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/screenshots/charts/violin.png" width="260"><br><sub>Violin plot</sub></td>
    <td align="center"><img src="assets/screenshots/charts/ridge-plot.png" width="260"><br><sub>Ridge plot</sub></td>
    <td align="center"><img src="assets/screenshots/charts/heatmap.png" width="260"><br><sub>Heatmap</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/screenshots/charts/waterfall.png" width="260"><br><sub>Waterfall</sub></td>
    <td align="center"><img src="assets/screenshots/charts/funnel.png" width="260"><br><sub>Funnel</sub></td>
    <td align="center"><img src="assets/screenshots/charts/treemap.png" width="260"><br><sub>Treemap</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/screenshots/charts/sankey.png" width="260"><br><sub>Sankey</sub></td>
    <td align="center"><img src="assets/screenshots/charts/scatter-matrix.png" width="260"><br><sub>Scatter matrix</sub></td>
    <td align="center"><img src="assets/screenshots/charts/choropleth.png" width="260"><br><sub>Choropleth map</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/screenshots/charts/bubble-map.png" width="260"><br><sub>Bubble map</sub></td>
    <td></td>
    <td></td>
  </tr>
</table>

<p align="center">
  <img src="assets/screenshots/map-choropleth.png" alt="Choropleth map scoped to Europe, with the map settings panel open in the sidebar" width="100%">
  <br><sub>Map settings: base map (world or custom GeoJSON), scope, projection, continuous or classed colour, value range.</sub>
</p>

### Data View

<p align="center">
  <img src="assets/screenshots/data-view.png" alt="Data View: chart mapping shelves on the left, editable data table on the right" width="100%">
</p>

- A spreadsheet-style table (AG Grid), separate from the applied chart data: edit cells, rename columns, add rows/columns, paste from Excel or Sheets, sort and search.
- **Chart mapping shelves**: drag fields onto the X and Y axes to decide what the chart plots; fields left off both shelves are listed as unused.
- **Wide ↔ long/tidy** reshaping, **transpose**, spreadsheet **formulas** (`=SUM(A1:A5)`, `=AVERAGE(...)`, cell references) and per-column **Statistics** (jStat), with a Σ summary row.
- **Revert** discards the edits; **Apply to chart** sends the table to the chart.

### Editor: toolbars, Design panel & layers

**Canva-style floating toolbar.** Selecting text shows its format bar above the canvas (font, size, colour, bold/italic/underline/strike, case, alignment, lists, super/subscript, line spacing, opacity, effects, position), plus a small action bar next to the object (duplicate, lock, delete, more):

<p align="center">
  <img src="assets/screenshots/text-toolbar.png" alt="Selected text annotation with the floating text toolbar and the Design panel" width="100%">
</p>

**Shapes and other objects** get the same kind of floating bar (fill, stroke, dash, opacity, position). A Figma-style **size badge** (`W × H`) sits under the selection, with dashed **distance guides** to the page's left and top edges. The **Design** tab edits position, alignment to the page, rotation and flips, size (with a proportion lock), opacity, corner radius, fill, stroke and drop shadow:

<p align="center">
  <img src="assets/screenshots/object-design-panel.png" alt="Highlight rectangle selected, showing the floating object bar and the Design panel" width="100%">
</p>

**Advanced colour picker** with **solid or gradient** fills (linear/radial, angle, draggable colour stops), HSV area, hue and alpha sliders, Hex/RGB/HSL input, an eyedropper, saved swatches and the colours already used on the page:

<p align="center">
  <img src="assets/screenshots/color-picker-gradient.png" alt="Colour picker in gradient mode" width="100%">
</p>

**Layers** lists every object on the page (with thumbnails, type and font details): drag to reorder, rename, hide, lock, and group/ungroup. The chart itself always stays at the back:

<p align="center">
  <img src="assets/screenshots/layers-panel.png" alt="Layers panel with two text objects, a rectangle and the chart" width="100%">
</p>

**Sidebar panels** for the axes, style and legend:

<table>
  <tr>
    <td align="center"><img src="assets/screenshots/axis-panel.png" width="400"><br><sub>Axis</sub></td>
    <td align="center"><img src="assets/screenshots/color-style-panel.png" width="400"><br><sub>Color &amp; style</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/screenshots/legend-panel.png" width="400"><br><sub>Legend</sub></td>
    <td align="center"><img src="assets/screenshots/export-panel.png" width="400"><br><sub>Export</sub></td>
  </tr>
</table>

### Page layout & annotation
- **Full-page canvas**, separate from the chart block: position and resize the chart anywhere on the page.
- **10 built-in page templates** (A4/Letter/Legal landscape & portrait, 16:9 and 4:3 presentation, Instagram Story, social square) plus custom width/height in px, mm or cm, and a page background colour.
- **Zoom** with the slider at the bottom right, Ctrl + and Ctrl − (Ctrl 0 for 100%), or Ctrl + mouse wheel. Custom **pan scrollbars**.
- **Drafting-style rulers** on the canvas edges, unit- and zoom-aware, that also act as a source for **draggable guide lines**.
- **Layout objects** on top of the chart (Fabric.js): text boxes, 30 shapes, images and freehand drawing (pen, highlighter, marker, eraser), with lock, duplicate, delete, grouping and a right-click menu.
- **LaTeX & symbol tool**: type formulas in `$...$` and see them rendered live on the canvas with MathJax (e.g. `$R^2 = 0.95$`, `$CO_2$`), with colour, size and font controls, recent formulas, ready-made templates, and a searchable symbol/unit catalog that also works in axis labels.
- **Undo/redo** for chart settings and canvas objects alike, and a **help search** (question-mark icon) that finds any menu or setting by name.

### Export
- **PNG, JPG, SVG or PDF** from the Export panel, at **75, 100, 300 or 600 DPI**.
- PNG/JPG/PDF are a **full-page composite** of the background, the chart and every layout object, exactly as shown in the editor. PDF can be **vector** (via svg2pdf) or flattened.
- Background: follow the canvas colour, force white, or transparent (PNG).
- **Zero install**: D3.js is bundled locally; everything else loads from a CDN only when a feature first needs it. No build step, no server, no signup.

[⬆️ Back to Table of Contents](#table-of-contents)

## Architecture

Everything below happens in a single browser tab — there's no backend, no build step, and no network call other than fetching static assets (libraries from a CDN on first use, base maps from this repo).

**High-level data flow**, from raw input to exported file:

```mermaid
flowchart LR
    subgraph Input
        A1[Paste CSV/TSV text]
        A2[Import CSV/TSV/TXT file]
        A3[Import Excel .xlsx/.xls]
        A4[Import JSON]
    end

    A1 --> B
    A2 -- Papa Parse --> B
    A3 -- SheetJS --> B
    A4 --> B

    B[Data View<br/>shelves, wide/long, transpose] --> C[Chart state<br/>state.series]
    C --> D[Chart Builder<br/>render via D3.js]
    D --> E[Layout canvas<br/>Fabric.js overlay:<br/>text, shapes, LaTeX]
    E --> F{Export}
    F -- PNG / JPG / PDF, 75-600 DPI --> G1[Full-page composite<br/>chart + layout objects]
    F -- SVG --> G2[Chart only<br/>D3 SVG]
```

> GitHub renders Mermaid with raw HTML/`<img>` stripped from node labels, so logos can't sit *inside* the boxes above — this legend maps each engine to its stage instead:

| Stage | Engine |
|---|---|
| CSV/TSV parsing | ![Papa Parse](https://img.shields.io/badge/-Papa_Parse-00A98F) |
| Excel import | ![SheetJS](https://img.shields.io/badge/-SheetJS-217346?logo=microsoftexcel&logoColor=white) |
| Chart rendering | ![D3.js](https://img.shields.io/badge/-D3.js-F9A03C?logo=d3dotjs&logoColor=white) |
| Layout canvas / shapes / text | ![Fabric.js](https://img.shields.io/badge/-Fabric.js-4A9C9C) |
| LaTeX formulas on canvas | ![MathJax](https://img.shields.io/badge/-MathJax-1B3E6F?logo=latex&logoColor=white) |

**Data View: wide ↔ long/tidy and field mapping**, the step between raw parsed rows and the chart's series:

```mermaid
flowchart TD
    Raw[Raw parsed table] --> Shape{Shape}
    Shape -- Wide --> Wide[Drag fields onto the<br/>X axis and Y axis shelves]
    Shape -- Long/tidy --> Long[Pick X, Series, and Value columns]
    Wide --> Detect[Numeric columns<br/>auto-detected]
    Long --> Detect
    Detect --> Apply[Apply to chart]
    Apply --> Series[state.series<br/>drives the D3 render]
```

[⬆️ Back to Table of Contents](#table-of-contents)

## Project structure

```
.
├── index.html                     # App shell, styling, <script>/<link> tags, splash screen
├── sw.js                          # Service worker (network-first cache, so the app also opens offline)
├── manifest.json                  # Web app manifest (installable PWA)
├── js/
│   ├── lazy-loader.js             # Loads CDN libraries on first use (Fabric, Papa Parse, SheetJS, AG Grid, jsPDF, ...)
│   ├── chart-builder/             # Chart settings, data and export, in numbered load-order files
│   │   ├── 01-config.js           #   static config: fonts, canvas templates, hatch/dash/marker defs
│   │   ├── 02-state.js            #   shared state object, chart type list, sample data per chart type
│   │   ├── 03-ui-lists.js         #   populates font/template/unit pickers in the sidebar
│   │   ├── 04-data.js             #   parses pasted/imported data into series, series list UI
│   │   ├── 05-style-helpers.js    #   colour/pattern modes, value formatting, error bars
│   │   ├── 06-canvas-units.js     #   canvas size <-> unit conversion
│   │   ├── 07-render.js           #   legacy render() entry point; js/d3-engine/ wraps it and draws every chart
│   │   ├── 08-helpers-export.js   #   string/colour helpers, multi-format export panel (PNG/JPG/SVG/PDF)
│   │   ├── 09-event-wiring.js     #   wires sidebar controls (style, axes, legend, ranges, export)
│   │   ├── 10-view-switcher-init.js # Layout/Data view switcher, boots the chart on load
│   │   ├── 11-choropleth.js       #   choropleth settings (state defaults + "Peta (Choropleth)" sidebar panel)
│   │   ├── 12-radial-rings.js     #   Radial Rings registration + its SVG renderer
│   │   ├── 13-lollipop.js … 20-dumbbell.js # chart type registration + sample data (lollipop, bubble,
│   │   │                          #   sunburst, ridge plot, sankey, scatter matrix, bubble map, dumbbell)
│   ├── d3-engine/                 # The chart engine (see D3-MIGRATION.md)
│   │   ├── 00-core.js             #   PlootsD3 namespace, renderer registry, rich text, patterns, mount
│   │   ├── 01-frame.js            #   shared cartesian frame: scales, axes, ticks, gridlines, titles, legend
│   │   ├── 02-cartesian.js        #   bar (single/grouped/stacked), line, area, scatter
│   │   ├── 03-stats.js            #   pie, donut, histogram, box, violin, heatmap
│   │   ├── 04-flow.js             #   waterfall, funnel, treemap
│   │   ├── 05-special.js          #   lollipop, dumbbell, bubble, scatter matrix, sankey, ridge plot, radial rings, sunburst
│   │   ├── 06-geo.js              #   choropleth and bubble map (d3-geo, local topojson)
│   │   ├── geo-country-regex.js   #   country name -> ISO-3 matching
│   │   └── 99-integration.js      #   hooks the engine into render(), export and the Format Axis panel
│   ├── layout-editor/             # Fabric.js full-page canvas and editor UI, in numbered files
│   │   ├── 01-canvas-core.js      #   canvas setup, chart-proxy sync, stage resize
│   │   ├── 02-toolbar-text.js     #   main toolbar wiring, "Add text" tool
│   │   ├── 03-shapes.js           #   shape picker and the 30 shape geometries
│   │   ├── 04-images.js           #   "Add image" tool
│   │   ├── 05-object-actions.js   #   lock/unlock, duplicate, delete
│   │   ├── 06-context-menu.js     #   right-click menu
│   │   ├── 07-selection.js        #   selection events, which format bar to show
│   │   ├── 08-format-bars.js      #   format bars (text/shape/image/formula) wired to the active object
│   │   ├── 09-panels-helpers.js   #   colour-swatch helpers, side-panel sync
│   │   ├── 10-export-overlay.js   #   flattens all Fabric objects to a transparent PNG for export
│   │   ├── 11-sidebar-nav.js      #   left sidebar panel switching
│   │   ├── 12-theme-init.js       #   dark/light theme, final boot calls
│   │   ├── 13-axis-title-detach.js #  detach X/Y axis titles into free text
│   │   ├── 14-legend-hover.js     #   drag the chart legend on the canvas
│   │   ├── 15-legend-detach.js    #   detach the legend into a free-floating group
│   │   ├── 16-draw-tool.js        #   freehand Draw tool (pen / highlighter / marker / eraser)
│   │   ├── 17-textbox-resize.js   #   text boxes resize their width instead of stretching the text
│   │   ├── 18-chart-quickbar.js   #   floating quick controls when the chart is selected
│   │   ├── 19-axis-tick-float.js  #   "Axis Tick Line" block in the Axis tab
│   │   ├── 20-canvas-zoom.js      #   zoom slider, Ctrl +/−/0 and Ctrl+wheel zoom
│   │   ├── 21-layers-panel.js     #   Layers tab (reorder, rename, hide, lock, group)
│   │   ├── 22-axis-format-panel.js #  click an axis to open its Format Axis panel
│   │   ├── 23-canvas-pan-scrollbars.js # themed pan scrollbars
│   │   ├── 24-text-float-bar.js   #   Canva-style floating format bars above the canvas
│   │   ├── 25-design-panel.js     #   Figma-style Design tab (position, size, fill/gradient, stroke, shadow)
│   │   ├── 26-selection-hud.js    #   W × H badge and distance guides for the selection
│   │   ├── 27-object-float-bar.js #   floating bars for shapes, images, formulas, groups
│   │   └── 28-axis-controls-sync.js # keeps the Axis tab's controls and the Format Axis panel in sync
│   ├── data_view.js               # Data View: AG Grid table, wide/long reshape, transpose
│   ├── dv_shelves.js              # Data View chart-mapping shelves (drag fields onto X / Y)
│   ├── data_formulas.js           # Data View spreadsheet formulas (=SUM, =AVERAGE, ...)
│   ├── data_stats.js              # Data View column statistics (jStat)
│   ├── color_picker.js            # Colour picker: solid/gradient, HSV, eyedropper, swatches
│   ├── palettes.js                # Built-in palette catalog, grid and search
│   ├── canvas_background.js       # Page background colour
│   ├── canvas_ruler.js            # Rulers on the canvas edges + draggable guide lines
│   ├── latex_symbols.js           # LaTeX (MathJax) formulas on canvas + the symbol/unit catalog
│   ├── help_search.js             # Help search: find a menu or setting by name
│   ├── ui_sections.js             # Collapsible sidebar sections
│   ├── undo_redo.js               # Global undo/redo history
│   ├── function_plot.js           # Function Plot panel (not loaded by index.html at the moment)
│   └── standalone_function_plot.js # Function Plot Studio (not loaded; still written against Plotly)
├── vendor/
│   ├── d3-7.9.0.min.js            # D3.js 7.9.0, bundled locally
│   └── topojson/                  # Natural Earth base maps (*_110m.json) for the map chart types
├── assets/
│   ├── logo_light.png, logo_dark.png # Topbar logo marks
│   ├── palettes.png               # Palette catalog image (used in this README)
│   └── screenshots/               # README screenshots; charts/ holds one image per chart type
├── D3-MIGRATION.md                # How the Plotly -> D3 migration was done, stage by stage
├── BUGFIXES.md                    # Notes on notable bug fixes
├── LICENSE                        # MIT license
├── THIRD-PARTY-NOTICES.md         # Notices for bundled D3.js, country-regex and the topojson base maps
└── README.md
```
### LaTeX & Symbol Catalog

The formula box (`$...$`) is rendered live via **MathJax**, so any valid LaTeX math syntax works there, not just what's listed below. The **104-symbol catalog** is a curated, one-click subset for the symbols and units that come up most often in scientific figures — searchable by name or LaTeX code, and insertable directly onto the canvas without typing.

<details>
<summary><strong>Greek</strong> (34)</summary>

| Symbol | Name | LaTeX |
|:---:|---|---|
| α | alpha | `\alpha` |
| β | beta | `\beta` |
| γ | gamma | `\gamma` |
| δ | delta | `\delta` |
| ε | epsilon | `\epsilon` |
| ζ | zeta | `\zeta` |
| η | eta | `\eta` |
| θ | theta | `\theta` |
| ι | iota | `\iota` |
| κ | kappa | `\kappa` |
| λ | lambda | `\lambda` |
| μ | mu | `\mu` |
| ν | nu | `\nu` |
| ξ | xi | `\xi` |
| π | pi | `\pi` |
| ρ | rho | `\rho` |
| σ | sigma | `\sigma` |
| τ | tau | `\tau` |
| υ | upsilon | `\upsilon` |
| φ | phi | `\phi` |
| χ | chi | `\chi` |
| ψ | psi | `\psi` |
| ω | omega | `\omega` |
| Γ | Gamma | `\Gamma` |
| Δ | Delta | `\Delta` |
| Θ | Theta | `\Theta` |
| Λ | Lambda | `\Lambda` |
| Ξ | Xi | `\Xi` |
| Π | Pi | `\Pi` |
| Σ | Sigma | `\Sigma` |
| Υ | Upsilon | `\Upsilon` |
| Φ | Phi | `\Phi` |
| Ψ | Psi | `\Psi` |
| Ω | Omega | `\Omega` |
</details>

<details>
<summary><strong>Operators</strong> (26)</summary>

| Symbol | Name | LaTeX |
|:---:|---|---|
| ± | plus-minus | `\pm` |
| ∓ | minus-plus | `\mp` |
| × | times | `\times` |
| ÷ | divide | `\div` |
| · | dot product | `\cdot` |
| √ | square root | `\sqrt{}` |
| ∑ | summation | `\sum_{i=1}^{n}` |
| ∏ | product | `\prod_{i=1}^{n}` |
| ∫ | integral | `\int_{}^{}` |
| ∮ | contour integral | `\oint` |
| ∂ | partial derivative | `\partial` |
| ∇ | nabla | `\nabla` |
| ∞ | infinity | `\infty` |
| ≈ | approximately | `\approx` |
| ≠ | not equal | `\neq` |
| ≤ | less or equal | `\leq` |
| ≥ | greater or equal | `\geq` |
| ≡ | equivalent | `\equiv` |
| ∝ | proportional to | `\propto` |
| ∼ | similar to | `\sim` |
| ≅ | congruent to | `\cong` |
| ⊥ | perpendicular | `\perp` |
| ∥ | parallel | `\parallel` |
| ∠ | angle | `\angle` |
| ° | degree | `^{\circ}` |
| ′ | prime | `\prime` |
</details>

<details>
<summary><strong>Units</strong> (21)</summary>

| Symbol | Name | LaTeX |
|:---:|---|---|
| m² | square metre | `m^{2}` |
| m⁻² | per square metre | `m^{-2}` |
| km² | square kilometre | `km^{2}` |
| cm³ | cubic centimetre | `cm^{3}` |
| ha⁻¹ | per hectare | `ha^{-1}` |
| Mg ha⁻¹ | megagram per hectare | `Mg\,ha^{-1}` |
| g C m⁻² | grams carbon per m² | `g\,C\,m^{-2}` |
| g cm⁻³ | density | `g\,cm^{-3}` |
| kg m⁻³ | kg per m³ | `kg\,m^{-3}` |
| W·m⁻²·sr⁻¹·µm⁻¹ | spectral radiance | `W\,m^{-2}\,sr^{-1}\,\mu m^{-1}` |
| µm | micrometre | `\mu m` |
| nm | nanometre | `nm` |
| °C | degrees Celsius | `^{\circ}C` |
| % | percent | `\%` |
| ‰ | per mille | `\u2030` |
| R² | coefficient of determination | `R^{2}` |
| p<.05 | p-value | `p < 0.05` |
| n= | sample size | `n = ` |
| x̄ | sample mean | `\bar{x}` |
| σ | standard deviation | `\sigma` |
| ×10ⁿ | scientific notation | `\times 10^{n}` |
</details>

<details>
<summary><strong>Arrows</strong> (8)</summary>

| Symbol | Name | LaTeX |
|:---:|---|---|
| → | right arrow | `\rightarrow` |
| ← | left arrow | `\leftarrow` |
| ↔ | left-right arrow | `\leftrightarrow` |
| ⇒ | implies | `\Rightarrow` |
| ⇔ | if and only if | `\Leftrightarrow` |
| ↑ | up arrow | `\uparrow` |
| ↓ | down arrow | `\downarrow` |
| ↦ | maps to | `\mapsto` |
</details>

<details>
<summary><strong>Sets & Logic</strong> (15)</summary>

| Symbol | Name | LaTeX |
|:---:|---|---|
| ∈ | element of | `\in` |
| ∉ | not an element of | `\notin` |
| ⊂ | subset | `\subset` |
| ⊆ | subset or equal | `\subseteq` |
| ∪ | union | `\cup` |
| ∩ | intersection | `\cap` |
| ∀ | for all | `\forall` |
| ∃ | there exists | `\exists` |
| ¬ | not | `\neg` |
| ∧ | and | `\wedge` |
| ∨ | or | `\vee` |
| ∅ | empty set | `\emptyset` |
| ℝ | real numbers | `\mathbb{R}` |
| ℕ | natural numbers | `\mathbb{N}` |
| ℤ | integers | `\mathbb{Z}` |
</details>

**Quick-insert structure templates** (fraction, superscript, subscript, roots, summation/product/integral with bounds, limit, vector, overline, hat, binomial coefficient, 2×2 matrix) splice their LaTeX skeleton in at the cursor with the caret already placed where you'd start typing.

### Color Palettes — sources & licensing

**106 built-in palettes**: the original 49, 50 more (the rest of the
ColorBrewer diverging/sequential families, common Matplotlib scientific
colormaps, and the Okabe-Ito colorblind-safe set) and 7 extra custom sets.
All colors are hard-coded hex arrays baked into `palettes.js` — no palette
library is bundled or loaded at runtime.

<p align="center">
  <img src="assets/palettes.png" alt="All 106 built-in color palettes" width="800">
</p>

Two names from the original 49 were corrected to match their real source
values so the catalog doesn't carry two different names for the same
standard scale: *"Ocean Blues" → **Blues*** and *"Forest Greens" → **Greens***
(both ColorBrewer sequential palettes, recolored to the actual ColorBrewer hex
values in the process).

| Palettes | Inspired by / source | License |
|---|---|---|
| Matplotlib tab10, tab20, tab20b, tab20c | [Matplotlib](https://matplotlib.org/) default qualitative color cycles | Matplotlib license (BSD-style, PSF-based) |
| Viridis, Plasma, Inferno, Magma, Cividis | Matplotlib's perceptually-uniform colormaps (Viridis by Stéfan van der Walt & Nathaniel Smith; Cividis by Nuñez, Anderton & Renslow) | CC0 / public domain |
| Coolwarm, Twilight | Matplotlib colormaps (Coolwarm: Kenneth Moreland's diverging scale; Twilight: van der Walt & Smith) | Matplotlib license / CC0 |
| Jet, HSV, Rainbow, Cool, Hot, Copper, Bone, Pink, Spring, Summer, Autumn, Winter, Prism, Ocean, Terrain, CMRmap, Gist Rainbow, Gist Earth, Gist Stern, Gist Ncar, Nipy Spectral, Cubehelix, Gnuplot, Wistia, Turbo | Classic scientific/MATLAB-style colormaps as shipped in Matplotlib (Turbo by Anton Mikhailov / Google AI; Cubehelix by Dave Green; CMRmap by Carey Rappaport) | Matplotlib license; Turbo is Apache License 2.0 |
| ColorBrewer Set1–3, Paired, Dark2, Accent, Pastel1–2, Spectral, BrBG, PiYG, PRGn, PuOr, RdBu, RdGy, RdYlBu, RdYlGn, Blues, Greens, Oranges, Purples, Reds, BuGn, BuPu, GnBu, OrRd, PuBu, PuBuGn, PuRd, RdPu, YlGn, YlGnBu, YlOrBr, YlOrRd | [ColorBrewer](https://colorbrewer2.org/) by Cynthia Brewer (Penn State) | Apache License 2.0 |
| Seaborn Deep, Muted, Bright, Pastel, Colorblind | [Seaborn](https://seaborn.pydata.org/) default qualitative palettes | BSD 3-Clause |
| Solarized | [Solarized](https://ethanschoonover.com/solarized/) by Ethan Schoonover | MIT |
| Nord | [Nord](https://www.nordtheme.com/) by Sven Greb | MIT |
| Dracula | [Dracula Theme](https://draculatheme.com/) | MIT |
| Material Design | [Google Material Design](https://m2.material.io/design/color/) color system | CC BY 4.0 |
| Flat UI | [Flat UI Colors](https://flatuicolors.com/) | Free to use |
| Okabe-Ito | Okabe & Ito (2008), "Color Universal Design" colorblind-safe palette | Public domain / free to use |
| Mangrove (default), Forest Canopy, Ocean Depth, Sunset Clay, Autumn Harvest, Grayscale, Earth Tones, Pastel Rainbow, Neon Bright, Sunset Gradient, Ice Blues, Berry Mix, Copper & Rust, Royal Jewel Tones, Retro 80s, Monochrome Blue, Corporate Navy & Gold, Slate & Steel, Custom Palette 1–7 | Original combinations created for this project — not derived from an external named scale | — |

### Fonts — sources & licensing

Five typefaces are offered for the title/subtitle, chart body/axes/legend,
and the LaTeX/symbol tool. None of the font files themselves are bundled in
this repo — they're referenced by CSS `font-family` stacks and resolved
either from Google Fonts (loaded via CDN `<link>` in `index.html`) or from
whatever the visitor's system already has installed, with generic
serif/sans-serif fallbacks either way.

| Font | Source | License |
|---|---|---|
| Poppins | [Google Fonts](https://fonts.google.com/specimen/Poppins), loaded live from `fonts.googleapis.com`; designed by Indian Type Foundry | SIL Open Font License 1.1 |
| Cambria | Microsoft ClearType Font Collection (system font — ships with Windows/Office; falls back to Georgia) | Proprietary (Microsoft) — used via system font stack only, not redistributed |
| Times New Roman | Monotype (system font) | Proprietary (Monotype) — used via system font stack only, not redistributed |
| Arial | Monotype (system font) | Proprietary (Monotype) — used via system font stack only, not redistributed |
| Cambria Math | Microsoft (system font — ships with Windows/Office; falls back to STIX Two Math, then Latin Modern Math) | Proprietary (Microsoft); fallbacks STIX Two Math (SIL OFL 1.1) and Latin Modern Math (GUST Font License) |

Because Cambria, Times New Roman, Arial, and Cambria Math are only ever
referenced by name in a CSS font stack — never packaged as font files in this
repository — a visitor without them installed silently gets the listed
fallback (or their browser/OS default serif or sans-serif) instead.

### Icons — sources & licensing

Icons across the topbar, sidebar, and Data View ribbon come from a webfont
icon set, Iconify web components, and a few hand-drawn inline SVGs. Nothing
here is bundled as a font/icon file in the repo — Material Symbols loads live
from Google Fonts, Iconify icons are fetched on demand by the
`iconify-icon` component, and the custom SVGs are written directly in
`index.html`.

| Icon set | Used for | Source | License |
|---|---|---|---|
| Material Symbols (Rounded) | The large majority of toolbar, sidebar, and ribbon icons | [Google Fonts Icons](https://fonts.google.com/icons), loaded live via CDN `<link>` | Apache License 2.0 |
| Custom inline SVG | Chart-type thumbnails, draw-tool shape picker, sidebar nav marks, and export-format icons not covered by Material Symbols | Original artwork drawn for this project | Project license ([MIT](./LICENSE)) |
| Iconify — Material Design Icons (`mdi:`) | Chart-type tiles in the Chart panel (loaded via the `iconify-icon` web component) | [Iconify](https://iconify.design/) (aggregator — [icon-sets.iconify.design](https://icon-sets.iconify.design/)) | Apache License 2.0 (Material Design Icons); confirm per set before adding others |

### Page templates

| Template | Size | Unit |
|---|---|---|
| A4 Landscape | 297 × 210 | mm |
| A4 Portrait | 210 × 297 | mm |
| Letter Landscape | 279.4 × 215.9 | mm |
| Letter Portrait | 215.9 × 279.4 | mm |
| Legal Landscape | 355.6 × 215.9 | mm |
| Legal Portrait | 215.9 × 355.6 | mm |
| Presentation 16:9 | 1920 × 1080 | px |
| Presentation 4:3 | 1024 × 768 | px |
| Instagram Story | 1080 × 1920 | px |
| Social Square | 1080 × 1080 | px |

Custom width/height is also available in px, mm, or cm, independent of the templates above.

### Fill patterns, dash styles & data-point markers

**8 fill/hatch patterns** (drawn as SVG patterns by the D3 engine — used whenever a series' style includes patterns): solid, `/` diagonal, `\` diagonal, `x` cross, `-` horizontal lines, `|` vertical lines, `+` cross, `.` dots.

**6 line dash styles**: solid, dot, dash, longdash, dashdot, longdashdot.

**21 data-point marker shapes** for line, area, and scatter charts (drives both the plotted marker and its legend icon): Circle, Square, Diamond, Triangle up, Triangle down, Pentagon, Hexagon, Star, Star diamond, Star triangle, Hexagram, Plus (+), X, Hash (#), Asterisk (*), Arrow, Y, Hourglass, Bowtie, Diamond tall, Diamond wide.

### Layout shape library

Beyond text boxes, the Layout canvas's Shapes panel offers **30 drawable shapes** across four groups, each editable from its floating bar and the Design panel (fill or gradient, stroke, corner radius, shadow):

- **Basic shapes (14):** square, rectangle, rounded rectangle, circle, ellipse, triangle, inverted triangle, right triangle, diamond, parallelogram, trapezoid, pentagon, hexagon, octagon
- **Lines & arrows (8):** line, dashed line, arrow right, arrow left, arrow up, arrow down, double arrow, chevron
- **Stars (4):** 4-point, 5-point, 6-point, 8-point
- **Symbols (4):** cross/plus, heart, speech bubble, half circle

### Export details

- **PNG/JPG** are rendered from the chart's SVG, scaled from a 96 DPI baseline — 75/100/300/600 DPI map to a `scale` factor of `dpi / 96` (≈0.78×, 1.04×, 3.125×, 6.25×) applied to the full-page canvas size, so a 1920×1080 px page exports at 6000×3375 at 300 DPI. The file name is set in the Export panel (default `layout`).
- PNG, JPG and PDF are a **full-page composite**: background, chart, and every layout object (text, shapes, images, drawings, LaTeX formulas) flattened together exactly as shown in the editor. **Vector PDF** keeps the chart as vector graphics (jsPDF + svg2pdf); the flattened mode embeds a raster image.
- **SVG** export covers the **chart only** (the chart's own D3 SVG) — it does not include layout objects, text, or LaTeX formulas sitting on the canvas around it.
- Background: *Canvas color*, *White*, or *Transparent* (JPG has no alpha channel, so transparent becomes white).

### Value label formatting

| Option | Example (`1234.5`) |
|---|---|
| Auto | `1234.5` (rounded to 2 decimals, trailing zeros trimmed) |
| Integer | `1235` |
| 1 decimal | `1234.5` |
| 2 decimals | `1234.50` |
| Thousands separator | `1,235` |
| Percent | `1234.5%` |
| Currency | `Rp 1,235` (Indonesian Rupiah formatting, locale `id-ID`) |

### Error bars

Applied to every visible series on **bar, line, area, and scatter** charts (not available on pie/donut/heatmap/box/violin/waterfall/funnel/treemap). Two modes:
- **Percent-of-value:** the bar length is `|value × (percent / 100)|` — so a 10% setting on a value of 200 draws a ±20 error bar.
- **Fixed-amount:** every point gets the same bar length regardless of its value.

Cap width and line thickness are independently adjustable, and the error bar color can either stay black (default, matching print conventions) or follow each series' own color.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) | Undo / redo |
| Ctrl + / Ctrl − / Ctrl 0 | Zoom in / zoom out / zoom to 100% |
| Ctrl + mouse wheel | Zoom around the pointer |
| Ctrl+B / Ctrl+I / Ctrl+U | Bold / italic / underline (text selected) |
| Delete or Backspace | Remove the selected layout object |
| Ctrl+C (Data View) | Copy the selected cells |

Duplicate, lock, arrange and delete are also on the floating object bar and the right-click menu.

### Libraries & versions

| Library | Version | Loaded from |
|---|---|---|
| D3.js | bundled (v7.9.0, ISC) | local file (`vendor/d3-7.9.0.min.js`), not CDN |
| Fabric.js | 5.3.0 | cdnjs |
| MathJax | 3.2.2 (`es5/tex-svg.js`) | cdnjs |
| math.js | 12.4.3 | cdnjs — expression evaluation in Data View formulas |
| Papa Parse | 5.4.1 | cdnjs |
| SheetJS (xlsx) | 0.18.5 | cdnjs — Excel `.xlsx`/`.xls` import |
| AG Grid Community | 35.3.0 | cdnjs |
| jStat | 1.9.6 | cdnjs — Data View column statistics |
| marked | 16.3.0 | cdnjs — renders this README as HTML on the splash screen |
| jsPDF | 2.5.1 | cdnjs — PDF export |
| svg2pdf.js | 2.2.3 | cdnjs — vector charts in PDF export |
| iconify-icon | 2.1.0 | code.iconify.design — chart-type icons |

[⬆️ Back to Table of Contents](#table-of-contents)

## Known limitations

<details>
<summary>Click to expand — 6 known limitations</summary>

> [!NOTE]
> Everything runs in the browser tab — there's no server-side processing, so very large datasets or very high-DPI exports can be slow or memory-heavy depending on the device.

> [!NOTE]
> No autosave or cloud sync. Closing the tab loses unsaved work; there's no account system or server-side storage.

> [!NOTE]
> LaTeX formula history is local-only. The "recent formulas" list in the LaTeX panel is stored in the browser's localStorage, so it's per-browser and per-device, and clearing browser data clears it.

> [!NOTE]
> SVG export is chart-only — see [Export details](#export-details).

> [!NOTE]
> Radial rings charts don't support the secondary Y-axis toggle (it's a single-axis polar layout), and a map's first render shows a brief "Memuat peta…" placeholder while its base-map topojson loads from `vendor/topojson/` (then cached).

> [!NOTE]
> The Function Plot panels (`js/function_plot.js`, `js/standalone_function_plot.js`) are not loaded by the app at the moment; they still target Plotly and need porting to the D3 engine.

> [!TIP]
> All 25 chart types are fully functional and ready to use.

</details>

[⬆️ Back to Table of Contents](#table-of-contents)

## Built with

This project only exists because of the following open-source libraries and free services — a genuine thank-you to everyone who builds and maintains them:

- **[D3.js](https://d3js.org/)** — the charting engine behind every chart type (scales, axes, shapes, layouts, d3-geo maps) and the SVG/PNG rendering itself
- **[Fabric.js](http://fabricjs.com/)** — powers the full-page layout editor: draggable/resizable text, shapes, and the LaTeX objects that sit on top of the chart
- **[MathJax](https://www.mathjax.org/)** — renders LaTeX (`$...$`) typed into the formula tool as real typeset math, live, on the canvas
- **[math.js](https://mathjs.org/)** — evaluates expressions in Data View formulas
- **[Papa Parse](https://www.papaparse.com/)** — makes CSV/TSV import reliable, even with messy real-world data (quoted fields, embedded commas, escaped quotes)
- **[SheetJS](https://sheetjs.com/)** — reads Excel `.xlsx`/`.xls` files (including multi-sheet workbooks) directly in the browser
- **[AG Grid](https://www.ag-grid.com/)** (Community edition) — the editable spreadsheet-style table behind the Data View
- **[jStat](https://jstat.github.io/)** — powers the column statistics in the Data View
- **[marked](https://marked.js.org/)** — renders this README as HTML on the app's splash screen
- **[jsPDF](https://github.com/parallax/jsPDF)** and **[svg2pdf.js](https://github.com/yWorks/svg2pdf.js)** — PDF export, with the chart kept as vector graphics
- **[Google Fonts](https://fonts.google.com/)** — serves the typography options used throughout the app
- **[Material Symbols](https://fonts.google.com/icons)** — the icon set used across the toolbar and sidebar
- **[Iconify](https://iconify.design/)** — the chart-type icons (Material Design Icons)
- **[GitHub Pages](https://pages.github.com/)** — hosts this app for free, straight from the repository, with no server to maintain
- **[cdnjs / Cloudflare](https://cdnjs.com/)** — serves every CDN-loaded library above reliably to every visitor
- **[Shields.io](https://shields.io/)** — the badges at the top of this README
- Everyone who opened an issue, suggested a feature, or gave feedback on the UI — this tool is better because of that input, and it's still very much a work in progress

[⬆️ Back to Table of Contents](#table-of-contents)

## License

Released under the [MIT License](./LICENSE). Bundled third-party code
(`vendor/d3-7.9.0.min.js`, ISC) keeps its own notice — see
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

[⬆️ Back to Table of Contents](#table-of-contents)

## Purpose & Acknowledgements

This project was not built to compete with established data visualization software or commercial charting tools. Rather, its core purpose is simply to utilize available open-source technologies to make the process of creating publication-ready plots as easy, accessible, and lightweight as possible. It is especially dedicated to students and researchers who might not have coding experience or the budget to access premium software, with the hope that the features provided here can assist in their research and academic work.

Ploots Click draws heavy inspiration from the many incredible charting tools, design systems, and data communities out there. A massive thank you to all the creators of the underlying engines and open-source libraries that power this tool. A special thanks to **GitHub** for providing GitHub Pages, which makes hosting this static web app for free possible.

I am always open to feedback and suggestions. Ultimately, I am just a student utilizing a little bit of knowledge with the help of official documentation and AI tools like **Claude**, **ChatGPT** (for brainstorming), and **Gemini** to help bring this idea to life. To every developer, library maintainer, and supporter—thank you. This tool is built on the shoulders of your hard work.

[⬆️ Back to Table of Contents](#table-of-contents)

## Feedback & Contributions

Since I am always open to feedback and suggestions, if you find a bug, have a feature request, or just want to share how you use Ploots Click in your research, please feel free to open an **[Issue](https://github.com/Defani/Ploots-click/issues)** in this repository. 

You don't need to be a programmer to contribute—bug reports, design ideas, and usability feedback are incredibly valuable!

[⬆️ Back to Table of Contents](#table-of-contents)

## Author

Built by [Defani Arman Alfitriansyah](https://github.com/Defani).
