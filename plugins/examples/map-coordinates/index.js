// Map coordinates — example GIS Consultant Studio plugin.
//
// Shows the coordinates under the cursor in a small box on the map, in
// decimal degrees, degrees-minutes-seconds and UTM. A right-click on the
// map copies the current format. A top-bar button turns the box on and off;
// the choice is remembered with app.storage.

const FORMATS = ["decimal", "dms", "utm"];

function dms(v, pos, neg) {
  const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
  return `${d}°${String(m).padStart(2, "0")}′${s.toFixed(1).padStart(4, "0")}″${v >= 0 ? pos : neg}`;
}

// WGS 84 -> UTM (Krüger series, accurate to well under a metre).
function utm(lon, lat) {
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const r = Math.PI / 180, phi = lat * r, lam0 = ((zone - 1) * 6 - 180 + 3) * r;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lon * r - lam0);
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let y = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (lat < 0) y += 10000000;
  return `${zone}${lat >= 0 ? "N" : "S"} ${Math.round(x).toLocaleString("en-US")} E ${Math.round(y).toLocaleString("en-US")} N`;
}

function text(fmt, ll) {
  if (fmt === "dms") return `${dms(ll.lat, "N", "S")}  ${dms(ll.lng, "E", "W")}`;
  if (fmt === "utm") return utm(ll.lng, ll.lat);
  return `${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`;
}

export default {
  activate(app) {
    let on = app.storage.get("visible", true);
    let fmt = app.storage.get("format", "decimal");
    let map = null, box = null, last = null;

    const onMove = (e) => { last = e.lngLat; render(); };
    const onCopy = (e) => {
      const t = text(fmt, e.lngLat);
      navigator.clipboard?.writeText(t).then(() => app.ui.toast(`Copied ${t}`), () => {});
    };
    const onOut = () => { last = null; render(); };

    function render() {
      if (!box) return;
      box.hidden = !on;
      box.querySelector("b").textContent = last ? text(fmt, last) : "—";
      box.querySelector("button").textContent = { decimal: "DD", dms: "DMS", utm: "UTM" }[fmt];
    }

    // The map is recreated when the workspace re-renders, so re-attach
    // whenever the instance changes.
    function attach() {
      const m = app.map.get();
      if (m === map) return;
      detach();
      map = m;
      if (!map) return;
      box = document.createElement("div");
      box.className = "mapcoords-box";
      box.innerHTML = '<b>—</b><button type="button" title="Change format"></button>';
      box.querySelector("button").addEventListener("click", (e) => {
        e.stopPropagation();
        fmt = FORMATS[(FORMATS.indexOf(fmt) + 1) % FORMATS.length];
        app.storage.set("format", fmt);
        render();
      });
      map.getContainer().appendChild(box);
      map.on("mousemove", onMove);
      map.on("contextmenu", onCopy);
      map.getCanvas().addEventListener("mouseleave", onOut);
      render();
    }
    function detach() {
      if (map) {
        map.off("mousemove", onMove);
        map.off("contextmenu", onCopy);
        map.getCanvas().removeEventListener("mouseleave", onOut);
      }
      box?.remove();
      box = null;
      map = null;
    }

    const btn = app.ui.addToolbarButton({
      icon: "my_location",
      label: "Coordinates",
      title: "Show coordinates under the cursor",
      onClick() {
        on = !on;
        app.storage.set("visible", on);
        btn.setActive(on);
        render();
      },
    });
    btn.setActive(on);

    const timer = setInterval(attach, 1000);
    app.map.on("*", attach);
    attach();
    app.onCleanup(() => { clearInterval(timer); detach(); });
  },
};
