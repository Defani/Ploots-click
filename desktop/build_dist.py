"""Builds desktop/dist: the web app with every CDN dependency made local.

The web version loads its libraries from cdnjs / jsDelivr, its fonts from
Google Fonts and its icons from the Iconify API. The desktop app must not
depend on any of that, so this script:

  1. copies index.html, manifest.json, js/, vendor/ and the logos to dist/;
  2. downloads every cdnjs / jsDelivr / Iconify script and stylesheet the
     copied files reference into dist/vendor/offline/ and rewrites the URLs
     to those local paths;
  3. downloads the Google Fonts CSS (Poppins, Material Symbols Rounded) and
     its woff2 files, and points the <link> tags at the local copies;
  4. collects every Iconify icon name used in the code, downloads just those
     icons, and registers them with the <iconify-icon> element, so it never
     calls the Iconify API;
  5. bundles the desktop engines (js/gis/28-desktop-engines.js): DuckDB WASM
     (its ES module graph from jsDelivr, the worker and the EH build) under
     vendor/duckdb/, and the spatial, json and parquet extensions under
     vendor/duckdb-ext/<duckdb version>/wasm_eh/, so SQL works offline;
  6. fails if any CDN URL is left.

Downloads are cached in desktop/.cache, so rebuilding is quick and works
offline once the cache is filled. Python standard library only.

    python desktop/build_dist.py
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
DIST = HERE / "dist"
CACHE = HERE / ".cache"
OFFLINE = "vendor/offline"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
TEXT = {".html", ".js", ".css", ".json"}

CDN_RE = re.compile(r"https://(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|code\.iconify\.design)/[^\s\"'`)<>]+?\.(?:js|css)(?=[\"'`)\s])")
FONT_CSS_RE = re.compile(r"https://fonts\.googleapis\.com/css2\?[^\"'\s>]+")
ICON_RE = re.compile(r"[\"']([a-z][a-z0-9]*(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)[\"']")
LEFTOVER_RE = re.compile(r"https://(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|code\.iconify\.design|fonts\.googleapis\.com|fonts\.gstatic\.com|api\.iconify\.design)[^\s\"'`)<>]*")


def fetch(url: str) -> bytes:
    key = hashlib.sha1(url.encode()).hexdigest()
    hit = CACHE / key
    if hit.exists():
        return hit.read_bytes()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    CACHE.mkdir(parents=True, exist_ok=True)
    hit.write_bytes(data)
    print(f"  downloaded {url} ({len(data) // 1024} KB)")
    return data


def local_path(url: str) -> str:
    u = urllib.parse.urlsplit(url)
    return f"{OFFLINE}/{u.netloc}{u.path}"


def copy_app() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)
    for name in ("index.html", "manifest.json"):
        shutil.copy2(ROOT / name, DIST / name)
    shutil.copytree(ROOT / "js", DIST / "js")
    shutil.copytree(ROOT / "vendor", DIST / "vendor")
    shutil.copytree(ROOT / "css", DIST / "css")
    (DIST / "assets").mkdir()
    for f in (ROOT / "assets").glob("logo*"):
        shutil.copy2(f, DIST / "assets" / f.name)
    # Fonts and sprites for offline (PMTiles) basemaps.
    shutil.copytree(ROOT / "assets" / "basemaps-assets", DIST / "assets" / "basemaps-assets")
    shutil.copytree(ROOT / "assets" / "home", DIST / "assets" / "home")
    shutil.copytree(ROOT / "assets" / "landing", DIST / "assets" / "landing")


def text_files() -> list[Path]:
    return [p for p in DIST.rglob("*") if p.is_file() and p.suffix in TEXT and OFFLINE not in p.as_posix()]


def localize_cdn() -> None:
    urls: set[str] = set()
    files = text_files()
    for p in files:
        urls.update(CDN_RE.findall(p.read_text(encoding="utf-8", errors="ignore")))
    print(f"CDN files: {len(urls)}")
    for url in sorted(urls):
        target = DIST / local_path(url)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(fetch(url))
    for p in files:
        s = p.read_text(encoding="utf-8", errors="ignore")
        new = s
        for url in urls:
            new = new.replace(url, local_path(url))
        if new != s:
            p.write_text(new, encoding="utf-8")


def localize_fonts() -> None:
    index = DIST / "index.html"
    html = index.read_text(encoding="utf-8")
    fonts_dir = DIST / OFFLINE / "fonts"
    fonts_dir.mkdir(parents=True, exist_ok=True)
    for i, css_url in enumerate(sorted(set(FONT_CSS_RE.findall(html)))):
        css = fetch(css_url.replace("&amp;", "&")).decode("utf-8")
        for furl in sorted(set(re.findall(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", css))):
            name = hashlib.sha1(furl.encode()).hexdigest()[:16] + Path(urllib.parse.urlsplit(furl).path).suffix
            (fonts_dir / name).write_bytes(fetch(furl))
            css = css.replace(furl, name)
        css_name = f"fonts-{i}.css"
        (fonts_dir / css_name).write_text(css, encoding="utf-8")
        html = html.replace(css_url, f"{OFFLINE}/fonts/{css_name}")
    # Preconnect hints to Google are no longer needed.
    html = re.sub(r"\s*<link rel=\"preconnect\" href=\"https://fonts\.(?:googleapis|gstatic)\.com\"[^>]*>", "", html)
    index.write_text(html, encoding="utf-8")


def localize_icons() -> None:
    names: dict[str, set[str]] = {}
    for p in text_files():
        for prefix, name in ICON_RE.findall(p.read_text(encoding="utf-8", errors="ignore")):
            names.setdefault(prefix, set()).add(name)
    collections = []
    for prefix in sorted(names):
        url = f"https://api.iconify.design/{prefix}.json?icons=" + ",".join(sorted(names[prefix]))
        try:
            data = json.loads(fetch(url))
        except Exception:
            continue  # not an icon set (e.g. "object:modified")
        if not isinstance(data, dict) or not data.get("icons"):
            continue
        collections.append(data)
        print(f"  icons {prefix}: {len(data['icons'])}")
    js = ("/* Icons used by Ploots Click, registered locally so <iconify-icon> never calls the Iconify API. */\n"
          "(function () {\n  var sets = " + json.dumps(collections, separators=(",", ":")) + ";\n"
          "  function add() { var C = customElements.get(\"iconify-icon\"); sets.forEach(function (s) { C.addCollection(s); }); }\n"
          "  if (customElements.get(\"iconify-icon\")) add(); else customElements.whenDefined(\"iconify-icon\").then(add);\n})();\n")
    out = DIST / OFFLINE / "iconify-icons.js"
    out.write_text(js, encoding="utf-8")
    index = DIST / "index.html"
    html = index.read_text(encoding="utf-8")
    tag = re.search(r"<script src=\"vendor/offline/code\.iconify\.design/[^\"]+\"></script>", html)
    if not tag:
        sys.exit("iconify-icon script tag not found in index.html")
    html = html.replace(tag.group(0), tag.group(0) + f'\n<script src="{OFFLINE}/iconify-icons.js"></script>', 1)
    index.write_text(html, encoding="utf-8")


DUCKDB_NPM = "1.32.0"     # @duckdb/duckdb-wasm, as in js/gis/28-desktop-engines.js
DUCKDB_CORE = "v1.4.3"    # the DuckDB version inside it (select version())
DUCKDB_EXTENSIONS = ("spatial", "json", "parquet")
ESM_IMPORT_RE = re.compile(r'"/npm/([^"]+?)/\+esm"')


def localize_duckdb() -> None:
    base = f"https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@{DUCKDB_NPM}"
    out = DIST / "vendor" / "duckdb"
    out.mkdir(parents=True, exist_ok=True)
    done: set[str] = set()

    def esm(url: str, name: str) -> None:
        # jsDelivr's +esm modules import each other as "/npm/<pkg>@<v>/+esm".
        if name in done:
            return
        done.add(name)
        src = fetch(url).decode("utf-8")
        for dep in set(ESM_IMPORT_RE.findall(src)):
            local = re.sub(r"[^\w.-]+", "_", dep) + ".mjs"
            esm(f"https://cdn.jsdelivr.net/npm/{dep}/+esm", local)
            src = src.replace(f'"/npm/{dep}/+esm"', f'"./{local}"')
        src = re.sub(r"//# sourceMappingURL=\S+", "", src)
        (out / name).write_text(src, encoding="utf-8")

    esm(f"{base}/+esm", "duckdb.mjs")
    for f in ("duckdb-browser-eh.worker.js", "duckdb-eh.wasm"):
        (out / f).write_bytes(fetch(f"{base}/dist/{f}"))
    ext = DIST / "vendor" / "duckdb-ext" / DUCKDB_CORE / "wasm_eh"
    ext.mkdir(parents=True, exist_ok=True)
    for e in DUCKDB_EXTENSIONS:
        (ext / f"{e}.duckdb_extension.wasm").write_bytes(fetch(f"https://extensions.duckdb.org/{DUCKDB_CORE}/wasm_eh/{e}.duckdb_extension.wasm"))
    # The CDN base in the engine code is only used in a browser.
    eng = DIST / "js" / "gis" / "28-desktop-engines.js"
    eng.write_text(eng.read_text(encoding="utf-8").replace(base, "vendor/duckdb"), encoding="utf-8")
    size = sum(p.stat().st_size for p in (DIST / "vendor").rglob("*") if "duckdb" in p.as_posix() and p.is_file())
    print(f"  DuckDB {DUCKDB_CORE} and {', '.join(DUCKDB_EXTENSIONS)}: {size / 1e6:.1f} MB")


def check() -> None:
    left = []
    for p in text_files():
        for m in LEFTOVER_RE.findall(p.read_text(encoding="utf-8", errors="ignore")):
            left.append(f"{p.relative_to(DIST)}: {m}")
    if left:
        print("CDN URLs left in dist:\n  " + "\n  ".join(left))
        sys.exit(1)
    size = sum(p.stat().st_size for p in DIST.rglob("*") if p.is_file())
    print(f"dist ready: {DIST} ({size / 1e6:.1f} MB), no CDN URLs left")


def main() -> None:
    print("Copying the app…")
    copy_app()
    print("Making CDN libraries local…")
    localize_cdn()
    print("Making fonts local…")
    localize_fonts()
    print("Making icons local…")
    localize_icons()
    print("Bundling the desktop engines…")
    localize_duckdb()
    check()


if __name__ == "__main__":
    main()
