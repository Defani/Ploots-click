#!/usr/bin/env python3
"""Local proxy that lets Ploots Click read the KoboToolbox API from a browser.

The KoboToolbox API only sends CORS headers to its own origins, so a web page
cannot call it directly. This proxy runs on your computer, forwards read-only
requests to the Kobo API with your token, and adds the CORS headers the
browser needs. It uses only the Python standard library.

    python tools/kobo_proxy.py                 # http://127.0.0.1:8767
    python tools/kobo_proxy.py --port 9000
    python tools/kobo_proxy.py --allow-host kobo.example.org   # self-hosted Kobo
    python tools/kobo_proxy.py --demo          # also serve a demo form (no account needed)

Ploots calls  GET /kobo?url=<full Kobo API URL>  with the token in the
X-Kobo-Token header. Only GET requests to /api/v2/ on the Kobo hosts are
forwarded; the proxy listens on 127.0.0.1 only and never stores the token.

Signing in with a username and password: POST /kobo-token with the JSON
{"server", "username", "password"}; the proxy asks the server's /token/
endpoint (Basic auth) and returns {"token": …}. Nothing is logged or kept.

The demo form ("Coffee farmer baseline (demo)") is generated on the fly:
five enumerators walking between farms near Takengon, Aceh Tengah, over the
last ten days. Today's submissions appear as the day goes on, so the
monitoring dashboard's auto-refresh has something to pick up.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import random
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.0.0"
KOBO_HOSTS = {"kf.kobotoolbox.org", "eu.kobotoolbox.org", "kobo.humanitarianresponse.info"}
DEMO_HOST = "demo.kobo.local"
DEMO_UID = "aDemoKopiGayo2026"
TIMEOUT = 120


# --------------------------------------------------------------------------- demo


ENUMERATORS = [("ilyas", "Ilyas"), ("rahmah", "Rahmah"), ("fadli", "Fadli"), ("sari", "Sari"), ("munawar", "Munawar")]
VILLAGES = [  # name, lon, lat
    ("bebesen", "Bebesen", 96.828, 4.636), ("kebayakan", "Kebayakan", 96.861, 4.648),
    ("pegasing", "Pegasing", 96.790, 4.598), ("bies", "Bies", 96.760, 4.573),
    ("silih_nara", "Silih Nara", 96.737, 4.662), ("atu_lintang", "Atu Lintang", 96.927, 4.531),
]
COFFEE = [("arabika", "Arabica"), ("robusta", "Robusta"), ("campuran", "Mixed")]
CERTS = [("organik", "Organic"), ("fairtrade", "Fairtrade"), ("rainforest", "Rainforest Alliance"), ("tidak_ada", "None")]
FARMER_FIRST = ["Abdul", "Aman", "Ina", "Win", "Reje", "Syarif", "Nurlela", "Zulkifli", "Rahmat", "Fatimah", "Ilham", "Juwita", "Kamal", "Mahmud", "Salbiah", "Teuku"]
FARMER_LAST = ["Gayo", "Linge", "Bukit", "Cibro", "Munte", "Tebe", "Ranto", "Kala"]
WIB = dt.timezone(dt.timedelta(hours=7))


def demo_asset() -> dict:
    def lab(s: str) -> list[str]:
        return [s]

    survey = [
        {"type": "start", "name": "start", "$xpath": "start"},
        {"type": "end", "name": "end", "$xpath": "end"},
        {"type": "today", "name": "today", "$xpath": "today"},
        {"type": "begin_group", "name": "grp_a", "label": lab("A. Identity"), "$xpath": "grp_a"},
        {"type": "select_one", "name": "nama_enumerator", "label": lab("Enumerator"), "select_from_list_name": "enum", "$xpath": "grp_a/nama_enumerator"},
        {"type": "date", "name": "tgl_survei", "label": lab("Survey date"), "$xpath": "grp_a/tgl_survei"},
        {"type": "select_one", "name": "kampung", "label": lab("Village"), "select_from_list_name": "desa", "$xpath": "grp_a/kampung"},
        {"type": "text", "name": "a1_nama", "label": lab("Farmer name"), "$xpath": "grp_a/a1_nama"},
        {"type": "integer", "name": "a2_umur", "label": lab("Age"), "$xpath": "grp_a/a2_umur"},
        {"type": "end_group", "name": "grp_a"},
        {"type": "begin_group", "name": "grp_b", "label": lab("B. Farm"), "$xpath": "grp_b"},
        {"type": "decimal", "name": "a14_luas_hektar", "label": lab("Farm area (ha)"), "$xpath": "grp_b/a14_luas_hektar"},
        {"type": "integer", "name": "b1_tahun_buka", "label": lab("Year the farm was opened"), "$xpath": "grp_b/b1_tahun_buka"},
        {"type": "select_one", "name": "jenis_kopi", "label": lab("Coffee type"), "select_from_list_name": "kopi", "$xpath": "grp_b/jenis_kopi"},
        {"type": "select_multiple", "name": "sertifikasi", "label": lab("Certification"), "select_from_list_name": "cert", "$xpath": "grp_b/sertifikasi"},
        {"type": "decimal", "name": "produksi_kg", "label": lab("Production last year (kg)"), "$xpath": "grp_b/produksi_kg"},
        {"type": "geopoint", "name": "geo1_titik_koordinat", "label": lab("Farm location"), "$xpath": "grp_b/geo1_titik_koordinat"},
        {"type": "end_group", "name": "grp_b"},
    ]
    choices = []
    for list_name, items in (("enum", ENUMERATORS), ("desa", [(v[0], v[1]) for v in VILLAGES]), ("kopi", COFFEE), ("cert", CERTS)):
        choices += [{"list_name": list_name, "name": n, "label": lab(l)} for n, l in items]
    return {
        "uid": DEMO_UID, "name": "Coffee farmer baseline (demo)", "asset_type": "survey", "has_deployment": True,
        "deployment__active": True, "deployment__submission_count": len(demo_rows()),
        "date_modified": dt.datetime.now(dt.timezone.utc).isoformat(),
        "content": {"survey": survey, "choices": choices}, "summary": {"languages": ["English"]},
    }


def _iso_utc(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def _iso_local(t: dt.datetime) -> str:
    return t.isoformat(timespec="milliseconds")


def demo_rows() -> list[dict]:
    """Ten days of submissions; today's only up to the current time."""
    now = dt.datetime.now(WIB)
    rows, rid = [], 100000
    for back in range(9, -1, -1):
        day = (now - dt.timedelta(days=back)).date()
        rnd = random.Random(day.toordinal())
        for ei, (ecode, ename) in enumerate(ENUMERATORS):
            if rnd.random() < 0.12:  # day off
                continue
            vil = VILLAGES[(ei + day.toordinal()) % len(VILLAGES)]
            lon, lat = vil[2] + rnd.uniform(-0.01, 0.01), vil[3] + rnd.uniform(-0.01, 0.01)
            heading = rnd.uniform(0, 2 * math.pi)
            t = dt.datetime.combine(day, dt.time(8, rnd.randint(0, 40)), WIB)
            for k in range(rnd.randint(3, 8)):
                heading += rnd.uniform(-0.9, 0.9)
                step = rnd.uniform(0.002, 0.007)
                lon += step * math.cos(heading)
                lat += step * math.sin(heading)
                dur = rnd.randint(18, 55)
                start = t + dt.timedelta(minutes=rnd.randint(4, 25))
                end = start + dt.timedelta(minutes=dur)
                t = end
                if end > now:
                    break
                sent = end + dt.timedelta(minutes=rnd.choice([1, 2, 3, 5, 40]))
                if sent > now:
                    break
                rid += 1
                acc = rnd.choice([3.9, 4.5, 5.0, 6.2, 8.0, 12.0, 35.0])
                has_geo = rnd.random() > 0.03
                area = round(rnd.lognormvariate(-0.3, 0.6), 2)
                certs = [c[0] for c in CERTS[:3] if rnd.random() < 0.3] or ["tidak_ada"]
                row = {
                    "_id": rid, "_uuid": f"demo-{rid}", "__version__": "v1",
                    "start": _iso_local(start), "end": _iso_local(end), "today": day.isoformat(),
                    "grp_a/nama_enumerator": ecode, "grp_a/tgl_survei": day.isoformat(), "grp_a/kampung": vil[0],
                    "grp_a/a1_nama": f"{rnd.choice(FARMER_FIRST)} {rnd.choice(FARMER_LAST)}",
                    "grp_a/a2_umur": str(rnd.randint(24, 71)),
                    "grp_b/a14_luas_hektar": str(area), "grp_b/b1_tahun_buka": str(rnd.randint(1985, 2024)),
                    "grp_b/jenis_kopi": rnd.choices([c[0] for c in COFFEE], [0.78, 0.07, 0.15])[0],
                    "grp_b/sertifikasi": " ".join(certs),
                    "grp_b/produksi_kg": str(round(area * rnd.uniform(500, 1200))),
                    "_submission_time": _iso_utc(sent), "_submitted_by": ecode,
                    "_validation_status": {}, "_attachments": [], "_status": "submitted_via_web",
                }
                if has_geo:
                    row["grp_b/geo1_titik_koordinat"] = f"{lat:.6f} {lon:.6f} 1210.0 {acc}"
                    row["_geolocation"] = [round(lat, 6), round(lon, 6)]
                else:
                    row["_geolocation"] = [None, None]
                rows.append(row)
    rows.sort(key=lambda r: r["_submission_time"])
    return rows


def demo_response(path: str, query: dict[str, list[str]]) -> tuple[int, dict]:
    parts = [p for p in path.split("/") if p]
    # /api/v2/assets/  |  /api/v2/assets/<uid>/  |  /api/v2/assets/<uid>/data/
    if parts[:3] != ["api", "v2", "assets"]:
        return 404, {"detail": "Not found."}
    if len(parts) == 3:
        a = demo_asset()
        a.pop("content")
        return 200, {"count": 1, "next": None, "previous": None, "results": [a]}
    if parts[3] != DEMO_UID:
        return 404, {"detail": "Not found."}
    if len(parts) == 4:
        return 200, demo_asset()
    if len(parts) == 5 and parts[4] == "data":
        rows = demo_rows()
        q = query.get("query", [""])[0]
        if q:
            try:
                cond = json.loads(q).get("_submission_time", {})
                lo, hi = cond.get("$gte"), cond.get("$lt")
                rows = [r for r in rows if (not lo or r["_submission_time"] >= lo) and (not hi or r["_submission_time"] < hi)]
            except (ValueError, AttributeError):
                return 400, {"detail": "Bad query."}
        start = int(query.get("start", ["0"])[0] or 0)
        limit = int(query.get("limit", ["1000"])[0] or 1000)
        page = rows[start:start + limit]
        nxt = f"https://{DEMO_HOST}/api/v2/assets/{DEMO_UID}/data/?start={start + limit}&limit={limit}" if start + limit < len(rows) else None
        return 200, {"count": len(rows), "next": nxt, "previous": None, "results": page}
    return 404, {"detail": "Not found."}


# -------------------------------------------------------------------------- proxy


class Handler(BaseHTTPRequestHandler):
    server_version = f"ploots-kobo-proxy/{VERSION}"
    demo = False
    allowed = set(KOBO_HOSTS)

    def log_message(self, fmt: str, *args) -> None:  # quieter log, never the token
        sys.stderr.write("[kobo-proxy] " + (fmt % args) + "\n")

    def _cors(self) -> None:
        origin = self.headers.get("Origin")
        self.send_header("Access-Control-Allow-Origin", origin or "*")
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "X-Kobo-Token, Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")

    def _json(self, code: int, obj: object) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:
        if urllib.parse.urlsplit(self.path).path != "/kobo-token":
            self._json(404, {"detail": "Use POST /kobo-token"})
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(min(n, 65536)) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._json(400, {"detail": "Send JSON: server, username, password."})
            return
        server = str(body.get("server", "")).rstrip("/")
        user, pw = str(body.get("username", "")), str(body.get("password", ""))
        t = urllib.parse.urlsplit(server)
        if t.hostname == DEMO_HOST and self.demo:
            self._json(200, {"token": "demo"})
            return
        if t.scheme not in ("https", "http") or t.hostname not in self.allowed:
            self._json(403, {"detail": f"Host {t.hostname} is not allowed. Start the proxy with --allow-host {t.hostname}."})
            return
        if not user or not pw:
            self._json(400, {"detail": "Username and password are required."})
            return
        import base64
        auth = base64.b64encode(f"{user}:{pw}".encode("utf-8")).decode("ascii")
        req = urllib.request.Request(f"{t.scheme}://{t.netloc}/token/?format=json",
                                     headers={"Accept": "application/json", "User-Agent": self.server_version, "Authorization": "Basic " + auth})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                code, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            code, raw = e.code, e.read()
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            self._json(502, {"detail": f"Could not reach {t.hostname}: {e}"})
            return
        try:
            obj = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            obj = {"detail": "Unexpected reply from the server."}
        # Only the token goes back to the page.
        self._json(code, {"token": obj.get("token")} if code == 200 else {"detail": obj.get("detail", "Sign-in failed.")})

    def do_GET(self) -> None:
        u = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/health":
            self._json(200, {"ok": True, "app": "ploots-kobo-proxy", "version": VERSION, "demo": self.demo,
                             "demoUrl": f"https://{DEMO_HOST}" if self.demo else None})
            return
        if u.path != "/kobo":
            self._json(404, {"detail": "Use /kobo?url=… or /health"})
            return
        target = q.get("url", [""])[0]
        t = urllib.parse.urlsplit(target)
        if t.scheme not in ("https", "http") or not t.path.startswith("/api/v2/"):
            self._json(400, {"detail": "Only Kobo API v2 URLs (…/api/v2/…) are forwarded."})
            return
        if t.hostname == DEMO_HOST:
            if not self.demo:
                self._json(404, {"detail": "Demo form is off. Start the proxy with --demo."})
                return
            code, obj = demo_response(t.path, urllib.parse.parse_qs(t.query))
            self._json(code, obj)
            return
        if t.hostname not in self.allowed:
            self._json(403, {"detail": f"Host {t.hostname} is not allowed. Start the proxy with --allow-host {t.hostname}."})
            return
        token = self.headers.get("X-Kobo-Token", "").strip()
        req = urllib.request.Request(target, headers={"Accept": "application/json", "User-Agent": self.server_version})
        if token:
            req.add_header("Authorization", "Token " + token)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                body, code = r.read(), r.status
        except urllib.error.HTTPError as e:
            body, code = e.read(), e.code
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            self._json(502, {"detail": f"Could not reach {t.hostname}: {e}"})
            return
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Local KoboToolbox API proxy for Ploots Click.")
    p.add_argument("--port", type=int, default=8767)
    p.add_argument("--allow-host", action="append", default=[], help="Extra Kobo server host name (self-hosted Kobo).")
    p.add_argument("--demo", action="store_true", help="Also serve a generated demo form.")
    a = p.parse_args(argv)
    Handler.demo = a.demo
    Handler.allowed = set(KOBO_HOSTS) | {h.strip().lower() for h in a.allow_host if h.strip()}
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"[kobo-proxy] listening on http://127.0.0.1:{a.port}" + (" (demo form on)" if a.demo else ""), file=sys.stderr, flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
