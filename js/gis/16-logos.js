/* ==========================================================================
   GIS — provider logos for basemaps and the data catalog.

   Each provider shows its own site icon, loaded from the provider's domain
   (the same servers the tiles / data come from). When the icon cannot load
   (offline, or the site has none) a colored badge with the provider's
   initials shows instead, so every entry always has a mark.
   ========================================================================== */
(function () {
  "use strict";

  var GIS = window.PlootsGIS;
  // id: [label, icon URL or "", badge color, badge text]
  var P = {
    google: ["Google", "https://www.google.com/favicon.ico", "#4285f4", "G"],
    openfreemap: ["OpenFreeMap", "https://openfreemap.org/favicon.ico", "#1d7f6e", "OFM"],
    maplibre: ["MapLibre", "https://maplibre.org/favicon.ico", "#295daa", "ML"],
    esri: ["Esri", "", "#0079c1", "esri"],
    carto: ["CARTO", "", "#1f3a5f", "CARTO"],
    osm: ["OpenStreetMap", "https://www.openstreetmap.org/favicon.ico", "#7ebc6f", "OSM"],
    nasa: ["NASA", "https://www.nasa.gov/favicon.ico", "#0b3d91", "NASA"],
    eox: ["EOX", "https://eox.at/favicon.ico", "#0b4f6c", "EOX"],
    usgs: ["USGS", "", "#00264c", "USGS"],
    swisstopo: ["swisstopo", "https://www.swisstopo.admin.ch/favicon.ico", "#d52b1e", "CH"],
    bkg: ["BKG", "", "#222222", "BKG"],
    opentopomap: ["OpenTopoMap", "https://opentopomap.org/favicon.ico", "#6b8e23", "OTM"],
    cyclosm: ["CyclOSM", "", "#3d8b37", "Cy"],
    waymarked: ["Waymarked Trails", "", "#b0412e", "WMT"],
    openrailwaymap: ["OpenRailwayMap", "", "#444444", "ORM"],
    openbasiskaart: ["Openbasiskaart", "", "#e17000", "OBK"],
    gbif: ["GBIF", "https://www.gbif.org/favicon.ico", "#4e9d2d", "GBIF"],
    inat: ["iNaturalist", "https://www.inaturalist.org/favicon.ico", "#74ac00", "iNat"],
    gfw: ["Global Forest Watch", "https://www.globalforestwatch.org/favicon.ico", "#97bd3d", "GFW"],
    kemenhut: ["Kementerian Kehutanan", "https://kehutanan.go.id/favicon.ico", "#1b7a3d", "KLHK"],
    bnpb: ["BNPB", "", "#f58220", "BNPB"],
    big: ["BIG", "https://big.go.id/favicon.ico", "#0a4c8b", "BIG"],
    mapzen: ["Mapzen / AWS Terrain Tiles", "", "#d4145a", "MZ"],
    arcgis: ["ArcGIS server", "", "#0079c1", "AGS"],
    supabase: ["Supabase", "https://supabase.com/favicon/favicon-32x32.png", "#3ecf8e", "SB"],
    none: ["None", "", "#9aa1a9", "∅"]
  };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // Which provider a basemap entry belongs to.
  function ofBasemap(b) {
    var id = b.id || "", u = b.tiles || b.style || "";
    if (b.google) return "google";
    if (b.dem) return "mapzen";
    if (id === "none") return "none";
    if (/openfreemap/.test(u)) return "openfreemap";
    if (/maplibre\.org/.test(u)) return "maplibre";
    if (/arcgisonline|esri/.test(u)) return "esri";
    if (/cartocdn/.test(u)) return "carto";
    if (/gbif/.test(u)) return "gbif";
    if (/eox\.at/.test(u)) return "eox";
    if (/nasa\.gov/.test(u)) return "nasa";
    if (/nationalmap\.gov/.test(u)) return "usgs";
    if (/admin\.ch/.test(u)) return "swisstopo";
    if (/geodatenzentrum/.test(u)) return "bkg";
    if (/opentopomap/.test(u)) return "opentopomap";
    if (/cyclosm/.test(u)) return "cyclosm";
    if (/waymarkedtrails/.test(u)) return "waymarked";
    if (/openrailwaymap/.test(u)) return "openrailwaymap";
    if (/openbasiskaart/.test(u)) return "openbasiskaart";
    if (/openstreetmap|osm\.ch/.test(u)) return "osm";
    return "osm";
  }

  // <span> with the site icon over a badge; the badge shows if the icon fails.
  function html(id, size) {
    var p = P[id] || [id, "", "#8a8a8a", String(id || "?").slice(0, 3).toUpperCase()];
    size = size || 20;
    var fs = Math.max(6, Math.round(size * (p[3].length > 3 ? 0.3 : p[3].length > 2 ? 0.36 : p[3].length > 1 ? 0.44 : 0.6)));
    return '<span class="plogo" title="' + esc(p[0]) + '" style="width:' + size + "px;height:" + size + "px;background:" + p[2] + ";font-size:" + fs + 'px">' + esc(p[3]) +
      (p[1] ? '<img src="' + esc(p[1]) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : "") + "</span>";
  }

  GIS.logos = { html: html, ofBasemap: ofBasemap, label: function (id) { return (P[id] || [id])[0]; }, PROVIDERS: P };
})();
