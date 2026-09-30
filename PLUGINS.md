# Ploots Click plugins

Plugins add features to Ploots Click (web and desktop app) without changing
the app itself. They work like GeoLibre plugins: a folder with a manifest and
one JavaScript module, installed from **Plugins** in the left rail.

- [Quick start](#quick-start)
- [Plugin format](#plugin-format)
- [Installing and managing](#installing-and-managing)
- [The `app` API](#the-app-api)
- [Example: Map coordinates](#example-map-coordinates)
- [Tips](#tips)

## Quick start

1. Open **Plugins** → **New plugin**, give it a name and download the starter
   `.zip`.
2. Unzip it and edit `index.js`.
3. **Plugins** → **Folder**, pick the plugin folder. Once installed, use
   **Reload** on its card after each change.
4. Share it as a `.zip` of the folder (or with the card's download button).

## Plugin format

```text
my-plugin/
  plugin.json    manifest (required)
  index.js       the entry module (required)
  style.css      styles (optional)
  …              any other files: images, JSON, data
```

`plugin.json`:

```json
{
  "id": "my-plugin",
  "name": "My plugin",
  "version": "0.1.0",
  "entry": "index.js",
  "style": "style.css",
  "description": "What it does, in one or two sentences.",
  "author": "Your name",
  "icon": "extension",
  "ploots": { "apiVersion": 1 }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Lowercase letters, digits, `.`, `_`, `-` (2–64 characters). Installing a plugin with the same id replaces it. |
| `name` | no | Shown in the Plugins panel; defaults to the id. |
| `version` | no | Any version string. |
| `entry` | no | The module to load; defaults to `index.js`. |
| `style` | no | A stylesheet added while the plugin is enabled. |
| `icon` | no | A [Material Symbols](https://fonts.google.com/icons) name, used on the card and as the default for buttons and panels. |
| `description`, `author` | no | Shown on the card and in the install dialog. |

`index.js` is an ES module whose default export has `activate` and,
optionally, `deactivate`:

```js
export default {
  activate(app) {
    // add buttons, panels, listeners…
  },
  deactivate(app) {
    // optional: anything you created outside the app API
  },
};
```

`activate` may return a Promise. The entry must be **one bundled file**:
relative `import`s are not resolved. Keep it plain JavaScript, or bundle it
with esbuild / Rollup (`format: "esm"`). Other files in the folder are reached
with `app.assetUrl("path")`.

## Installing and managing

The **Plugins** panel installs a plugin from:

- **.zip**: a zip of the plugin folder (the manifest may sit in a top folder). You can also drop a `.zip` on the panel.
- **Folder**: a plugin folder on disk, which is handy while developing.
- **URL**: the address of a `plugin.json`. Its `entry`, `style` and any paths listed in `"files": [...]` are fetched next to it.

Each installed plugin has a card with a switch to enable or disable it, and buttons to **Reload**, **Download as .zip** and **Remove**. If `activate` throws, the error is shown on the card and the rest of the app keeps working.

Installed plugins are stored in the browser's IndexedDB; in the desktop app, in the app's own profile. Enabled plugins load at startup. Plugins have full access to the app and to the data you open in it, so install only plugins you trust.

## The `app` API

Everything a plugin adds through `app` is removed automatically when the plugin is disabled or removed. Callbacks registered through `app` stop running at the same time.

### General

| | |
| --- | --- |
| `app.apiVersion` | `1` |
| `app.appVersion` | Ploots Click version |
| `app.plugin` | `{ id, name, version }` of this plugin |
| `app.desktop` | `true` in the desktop app |
| `app.onCleanup(fn)` | Run `fn` when the plugin is disabled or removed (timers, DOM you added yourself, map listeners). |
| `app.assetUrl(path)` | A URL for a file in the plugin folder, e.g. `app.assetUrl("img/logo.png")`. |
| `app.log(...args)` | `console.log` with the plugin id. |

### `app.ui`

| | |
| --- | --- |
| `addToolbarButton({ icon, label, title, onClick })` | A button in the top bar. Returns `{ el, remove(), setActive(on) }`. |
| `addPanel({ id, title, label, icon, mode, render(el) })` | A panel in the left rail. `mode` is `"any"` (default), `"map"` (map workspace only, opens it) or `"chart"`. `render` gets the panel body element. Returns `{ el, open(), close(), remove() }`. |
| `dialog({ title, html \| text, buttons, onOpen(body) })` | A modal dialog. `buttons` is `[[key, label, primary?], …]`. Resolves to the clicked key, or `null` if closed. |
| `toast(message)` | A short notification. |
| `addStyle(css)` | Add CSS; returns a function that removes it. |

### `app.map` (map workspace)

| | |
| --- | --- |
| `get()` | The MapLibre GL map, or `null` outside the map workspace. The map is recreated when the workspace re-renders, so call `get()` again instead of keeping it. |
| `enter()`, `isMapMode()` | Switch to the map workspace, or check if it is on. |
| `layers()` | `[{ id, name, kind, visible, features }]` |
| `layer(idOrName)` | The layer object: `data` (GeoJSON), `style`, `selection`, … |
| `addGeoJSON(name, geojson, style?)` | Add a vector layer; returns its id. `style` sets symbology keys (e.g. `{ symbology: "categorized", field: "type" }`). |
| `addTiles(name, urlTemplate, attribution?)` | Add an XYZ tile layer; returns its id. |
| `removeLayer(ref)`, `zoomTo(ref)` | |
| `setView({ center, zoom, bearing, pitch } \| { bbox })` | |
| `basemaps()`, `setBasemap(id)` | |
| `on(event, fn)` | Store events: `"layers"`, `"style"`, `"data"`, `"selection"`, `"active"`, `"interactive"` or `"*"`. Returns a function that stops the listener. |

### `app.chart`

| | |
| --- | --- |
| `state()` | The chart state object (type, data, styling). |
| `types()` | `[{ value, label, category }]` |
| `setType(value)` | Switch the chart type. |
| `data()` | `{ categories, series: [{ name, values }] }` |
| `setData(header, rows)` | Replace the table, e.g. `setData(["Year", "Rice"], [["2024", 12], ["2025", 14]])`. |
| `setDataText(text)` | Parse CSV, TSV or JSON as if it had been pasted. Returns a Promise. |
| `render()` | Redraw. |

### `app.canvas` (page layout)

| | |
| --- | --- |
| `get()` | The Fabric.js canvas. |
| `addText(text, options?)` | Add a text box (Fabric `IText` options). |
| `addImage(url, options?)` | Add an image; returns a Promise. |

### Other

| | |
| --- | --- |
| `app.storage.get(key, default)`, `set(key, value)`, `remove(key)` | Settings kept per plugin (JSON values). |
| `app.kobo` | The KoboToolbox data API (`summary`, `fields`, `rows`, `aggregate`, `load`), or `null` before a form is open. |
| `app.chat.open()`, `app.chat.send(text)` | Open the Claude chat, or send a message to it. |

## Example: Map coordinates

`plugins/examples/map-coordinates/` in this repository shows the coordinates under the cursor on the map (decimal degrees, DMS or UTM), adds a top-bar button to show or hide them, remembers the choice with `app.storage`, and re-attaches when the map is recreated. Install it with **Plugins → Folder**.

## Tips

- Prefix CSS classes with your plugin id to avoid clashes.
- Put listeners on the MapLibre map, timers and DOM you create yourself in `app.onCleanup`, so disabling the plugin leaves nothing behind.
- Use `fetch` for web APIs. The desktop app has no CORS exemption for plugins; a service must allow browser requests.
- Bump `version` when you share an update; installing the same `id` replaces the old copy.
