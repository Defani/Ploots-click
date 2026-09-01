# Third-party notices

This project bundles one third-party file directly in the repository:
`vendor/plotly-cartesian.min.js` (Plotly.js v3.7.0, cartesian build). Its
own license notice is embedded in the file header; the full MIT license
text is reproduced below.

Every other library used by this project (Fabric.js, MathJax, KaTeX, Papa
Parse, SheetJS, AG Grid Community, Google Fonts) is loaded live from a CDN at
runtime and is never copied into this repository — see
[Libraries & versions](./README.md#libraries--versions) in the README for
their names, versions, and licenses.

## Icons

- **Material Symbols (Outlined)** — Google, Apache License 2.0. Loaded live
  from Google Fonts; no font file is bundled in this repository. See
  [Icons — sources & licensing](./README.md#icons--sources--licensing).
- **Custom inline SVGs** (chart-type thumbnails, draw-tool shapes, sidebar
  nav marks, export-format icons) — original artwork for this project,
  covered by this repo's own [MIT License](./LICENSE).
- **Iconify** (Phosphor, Solar, Tabler, Fluent System Icons) — reserved for
  future icons not covered by Material Symbols; not yet used in the current
  build. All four sets are MIT-licensed — confirm per-icon at
  [icon-sets.iconify.design](https://icon-sets.iconify.design/) before
  adding one.

## Plotly.js

```
plotly.js (cartesian - minified) v3.7.0
Copyright 2012-2026, Plotly, Inc.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
