//! Native vector engine: big vector files the QGIS way.
//!
//! A shapefile is opened in place: only its record index (.shx) and each
//! record's bounding box are read, into a grid index. Nothing else is loaded.
//! The map asks for vector tiles (`gcs://…/tile/<id>/<z>/<x>/<y>.pbf`); each
//! tile reads just the records that touch it from disk, projects them to the
//! tile, simplifies them for the zoom (Douglas–Peucker, about a pixel), clips
//! them to the tile and encodes a Mapbox Vector Tile (layer "data"). Records
//! smaller than a pixel are left out of crowded tiles, as a GIS does when it
//! draws a national layer at a small scale. Reads use positional I/O, so
//! tiles are cut in parallel without sharing a file cursor.
//!
//! Formats: ESRI Shapefile (point, multipoint, polyline, polygon; with or
//! without Z/M) in geographic coordinates (WGS 84 longitude/latitude).
//! Attributes come from the .dbf on demand (UTF-8 when the .cpg says so,
//! else Latin-1).

use std::collections::HashMap;
use std::fs::File;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

pub const EXTENT: f64 = 4096.0;
const BUF: f64 = 64.0;

/* ------------------------------------------------------------------ io */

fn read_at(f: &File, buf: &mut [u8], off: u64) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        let mut done = 0usize;
        while done < buf.len() {
            let n = f.seek_read(&mut buf[done..], off + done as u64)?;
            if n == 0 {
                return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "end of file"));
            }
            done += n;
        }
        Ok(())
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        f.read_exact_at(buf, off)
    }
}

fn le_i32(b: &[u8], at: usize) -> Option<i32> {
    b.get(at..at + 4).map(|s| i32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}
fn be_i32(b: &[u8], at: usize) -> Option<i32> {
    b.get(at..at + 4).map(|s| i32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}
fn le_f64(b: &[u8], at: usize) -> Option<f64> {
    b.get(at..at + 8).map(|s| {
        let mut a = [0u8; 8];
        a.copy_from_slice(s);
        f64::from_le_bytes(a)
    })
}

/* ----------------------------------------------------------- dataset */

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Point,
    Line,
    Polygon,
}
impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Point => "point",
            Kind::Line => "line",
            Kind::Polygon => "polygon",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Field {
    pub name: String,
    typ: u8,
    len: usize,
    pos: usize,
}

struct Grid {
    x0: f64,
    y0: f64,
    cell: f64,
    nx: usize,
    ny: usize,
    cells: Vec<Vec<u32>>,
}
impl Grid {
    fn build(extent: [f64; 4], boxes: &[[f64; 4]]) -> Grid {
        let w = (extent[2] - extent[0]).max(1e-9);
        let h = (extent[3] - extent[1]).max(1e-9);
        let cell = (w.max(h) / 256.0).max(1e-6);
        let nx = ((w / cell).ceil() as usize + 1).min(1024);
        let ny = ((h / cell).ceil() as usize + 1).min(1024);
        let mut g = Grid { x0: extent[0], y0: extent[1], cell, nx, ny, cells: vec![Vec::new(); nx * ny] };
        for (i, b) in boxes.iter().enumerate() {
            if b[0].is_nan() {
                continue;
            }
            let (cx0, cy0) = g.cell_of(b[0], b[1]);
            let (cx1, cy1) = g.cell_of(b[2], b[3]);
            for cy in cy0..=cy1 {
                for cx in cx0..=cx1 {
                    g.cells[cy * g.nx + cx].push(i as u32);
                }
            }
        }
        g
    }
    fn cell_of(&self, x: f64, y: f64) -> (usize, usize) {
        let cx = ((x - self.x0) / self.cell).floor().max(0.0) as usize;
        let cy = ((y - self.y0) / self.cell).floor().max(0.0) as usize;
        (cx.min(self.nx - 1), cy.min(self.ny - 1))
    }
    fn query(&self, b: [f64; 4], boxes: &[[f64; 4]]) -> Vec<u32> {
        let (cx0, cy0) = self.cell_of(b[0], b[1]);
        let (cx1, cy1) = self.cell_of(b[2], b[3]);
        let mut out = Vec::new();
        for cy in cy0..=cy1 {
            for cx in cx0..=cx1 {
                for &i in &self.cells[cy * self.nx + cx] {
                    let r = boxes[i as usize];
                    if r[2] >= b[0] && r[0] <= b[2] && r[3] >= b[1] && r[1] <= b[3] {
                        out.push(i);
                    }
                }
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    }
}

pub struct Dataset {
    pub name: String,
    pub path: String,
    pub kind: Kind,
    shp: File,
    dbf: Option<File>,
    utf8: bool,
    recs: Vec<(u64, u32)>,
    boxes: Vec<[f64; 4]>,
    grid: Grid,
    pub extent: [f64; 4],
    hlen: u64,
    rlen: u64,
    nrec: u64,
    pub fields: Vec<Field>,
}

fn sibling(path: &Path, ext: &str) -> Option<std::path::PathBuf> {
    // .shx / .SHX / .Shx …
    for e in [ext.to_lowercase(), ext.to_uppercase()] {
        let p = path.with_extension(&e);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

pub fn open(path: &Path) -> Result<Dataset, String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if ext != "shp" {
        return Err("The native engine opens shapefiles (.shp) for now.".into());
    }
    if let Some(prj) = sibling(path, "prj") {
        let t = std::fs::read_to_string(prj).unwrap_or_default().to_uppercase();
        if t.contains("PROJCS") {
            return Err("This shapefile is in a projected coordinate system (UTM, TM-3…). Open it the normal way (it is reprojected there), or save it in WGS 84 for the native engine.".into());
        }
    }
    let shx_path = sibling(path, "shx").ok_or("The .shx index file is missing next to the .shp.")?;
    let shx = std::fs::read(&shx_path).map_err(|e| format!("Cannot read {}: {e}", shx_path.display()))?;
    if shx.len() < 100 {
        return Err("The .shx file is too short.".into());
    }
    let st = le_i32(&shx, 32).unwrap_or(0);
    let kind = match st {
        1 | 8 | 11 | 18 | 21 | 28 => Kind::Point,
        3 | 13 | 23 => Kind::Line,
        5 | 15 | 25 => Kind::Polygon,
        _ => return Err(format!("Unsupported shape type {st}.")),
    };
    let n = (shx.len() - 100) / 8;
    let mut recs = Vec::with_capacity(n);
    for i in 0..n {
        let o = be_i32(&shx, 100 + i * 8).unwrap_or(0).max(0) as u64 * 2;
        let l = be_i32(&shx, 104 + i * 8).unwrap_or(0).max(0) as u32 * 2;
        recs.push((o + 8, l));
    }
    let shp = File::open(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    // Bounding box of every record (shape type + 4 doubles, or the point).
    let mut boxes = Vec::with_capacity(n);
    let mut head = [0u8; 36];
    let mut ext4 = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    for &(off, len) in &recs {
        let mut b = [f64::NAN; 4];
        if len >= 20 && read_at(&shp, &mut head[..(len.min(36) as usize)], off).is_ok() {
            let t = le_i32(&head, 0).unwrap_or(0);
            if t == 1 || t == 11 || t == 21 {
                if let (Some(x), Some(y)) = (le_f64(&head, 4), le_f64(&head, 12)) {
                    b = [x, y, x, y];
                }
            } else if t != 0 && len >= 36 {
                if let (Some(a), Some(c), Some(d), Some(e)) = (le_f64(&head, 4), le_f64(&head, 12), le_f64(&head, 20), le_f64(&head, 28)) {
                    b = [a, c, d, e];
                }
            }
        }
        if b[0].is_finite() && b[1].is_finite() && b[2].is_finite() && b[3].is_finite() {
            ext4[0] = ext4[0].min(b[0]);
            ext4[1] = ext4[1].min(b[1]);
            ext4[2] = ext4[2].max(b[2]);
            ext4[3] = ext4[3].max(b[3]);
        } else {
            b = [f64::NAN; 4];
        }
        boxes.push(b);
    }
    if !ext4[0].is_finite() {
        return Err("The shapefile has no geometries.".into());
    }
    if ext4[0] < -180.5 || ext4[2] > 180.5 || ext4[1] < -90.5 || ext4[3] > 90.5 {
        return Err("The coordinates are not longitude/latitude. Save the shapefile in WGS 84 for the native engine, or open it the normal way.".into());
    }
    let grid = Grid::build(ext4, &boxes);
    // Attributes
    let (mut dbf, mut hlen, mut rlen, mut nrec, mut fields) = (None, 0u64, 0u64, 0u64, Vec::new());
    if let Some(dp) = sibling(path, "dbf") {
        if let Ok(f) = File::open(&dp) {
            let mut h = [0u8; 32];
            if read_at(&f, &mut h, 0).is_ok() {
                nrec = u32::from_le_bytes([h[4], h[5], h[6], h[7]]) as u64;
                hlen = u16::from_le_bytes([h[8], h[9]]) as u64;
                rlen = u16::from_le_bytes([h[10], h[11]]) as u64;
                let mut pos = 1usize;
                let mut at = 32u64;
                while at + 32 <= hlen {
                    let mut d = [0u8; 32];
                    if read_at(&f, &mut d, at).is_err() || d[0] == 0x0D {
                        break;
                    }
                    let name: String = d[..11].iter().take_while(|&&c| c != 0).map(|&c| c as char).collect();
                    let len = d[16] as usize;
                    fields.push(Field { name: name.trim().to_string(), typ: d[11], len, pos });
                    pos += len;
                    at += 32;
                }
                dbf = Some(f);
            }
        }
    }
    let utf8 = sibling(path, "cpg").map(|p| std::fs::read_to_string(p).unwrap_or_default().to_uppercase().contains("UTF")).unwrap_or(false);
    let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("layer").to_string();
    Ok(Dataset { name, path: path.display().to_string(), kind, shp, dbf, utf8, recs, boxes, grid, extent: ext4, hlen, rlen, nrec, fields })
}

impl Dataset {
    pub fn count(&self) -> usize {
        self.recs.len()
    }

    /// Parts (rings / lines / points) of record `i`, in longitude/latitude.
    pub fn geometry(&self, i: usize) -> Option<Vec<Vec<[f64; 2]>>> {
        let &(off, len) = self.recs.get(i)?;
        if len < 4 || len > 512 * 1024 * 1024 {
            return None;
        }
        let mut b = vec![0u8; len as usize];
        read_at(&self.shp, &mut b, off).ok()?;
        let t = le_i32(&b, 0)?;
        match t {
            0 => None,
            1 | 11 | 21 => Some(vec![vec![[le_f64(&b, 4)?, le_f64(&b, 12)?]]]),
            8 | 18 | 28 => {
                let np = le_i32(&b, 36)?.max(0) as usize;
                let mut pts = Vec::with_capacity(np);
                for k in 0..np {
                    pts.push([le_f64(&b, 40 + 16 * k)?, le_f64(&b, 48 + 16 * k)?]);
                }
                Some(vec![pts])
            }
            3 | 5 | 13 | 15 | 23 | 25 => {
                let nparts = le_i32(&b, 36)?.max(0) as usize;
                let npts = le_i32(&b, 40)?.max(0) as usize;
                let mut idx = Vec::with_capacity(nparts + 1);
                for k in 0..nparts {
                    idx.push(le_i32(&b, 44 + 4 * k)?.max(0) as usize);
                }
                idx.push(npts);
                let p0 = 44 + 4 * nparts;
                let mut parts = Vec::with_capacity(nparts);
                for k in 0..nparts {
                    let (a, z) = (idx[k].min(npts), idx[k + 1].min(npts));
                    let mut r = Vec::with_capacity(z.saturating_sub(a));
                    for j in a..z {
                        r.push([le_f64(&b, p0 + 16 * j)?, le_f64(&b, p0 + 16 * j + 8)?]);
                    }
                    parts.push(r);
                }
                Some(parts)
            }
            _ => None,
        }
    }

    /// Attributes of record `i` (only `only` when given).
    pub fn attributes(&self, i: usize, only: Option<&[String]>) -> Vec<(String, Value)> {
        let mut out = Vec::new();
        let f = match &self.dbf {
            Some(f) => f,
            None => return out,
        };
        if (i as u64) >= self.nrec || self.rlen == 0 {
            return out;
        }
        let mut r = vec![0u8; self.rlen as usize];
        if read_at(f, &mut r, self.hlen + i as u64 * self.rlen).is_err() {
            return out;
        }
        for fd in &self.fields {
            if let Some(o) = only {
                if !o.iter().any(|n| n == &fd.name) {
                    continue;
                }
            }
            let raw = match r.get(fd.pos..fd.pos + fd.len) {
                Some(s) => s,
                None => continue,
            };
            let text = if self.utf8 { String::from_utf8_lossy(raw).to_string() } else { raw.iter().map(|&c| c as char).collect() };
            let t = text.trim();
            if t.is_empty() {
                continue;
            }
            let v = match fd.typ {
                b'N' | b'F' => match t.parse::<f64>() {
                    Ok(n) => Value::Num(n),
                    Err(_) => continue,
                },
                _ => Value::Str(t.to_string()),
            };
            out.push((fd.name.clone(), v));
        }
        out
    }

    /// One Mapbox Vector Tile (layer "data") with the given attribute fields.
    pub fn tile(&self, z: u32, x: u32, y: u32, fields: &[String]) -> Vec<u8> {
        let (lon0, lat0, lon1, lat1) = tile_lonlat(z, x, y);
        let pad = (lon1 - lon0) * BUF / EXTENT;
        let ids = self.grid.query([lon0 - pad, lat0 - pad, lon1 + pad, lat1 + pad], &self.boxes);
        let (mx0, my0) = merc(lon0, lat1);
        let (mx1, _) = merc(lon1, lat0);
        let s = EXTENT / (mx1 - mx0);
        let to_tile = |p: [f64; 2]| -> [f64; 2] {
            let (mx, my) = merc(p[0], p[1]);
            [(mx - mx0) * s, (my0 - my) * s]
        };
        let crowded = ids.len() > 2000;
        let tol = if ids.len() > 8000 { 2.0 } else { 1.0 };
        let only = if fields.is_empty() { None } else { Some(fields) };
        let mut feats: Vec<Feat> = Vec::new();
        for i in ids {
            let i = i as usize;
            let b = self.boxes[i];
            let a0 = to_tile([b[0], b[3]]);
            let a1 = to_tile([b[2], b[1]]);
            if crowded && self.kind != Kind::Point && (a1[0] - a0[0]) < 0.75 && (a1[1] - a0[1]) < 0.75 {
                continue;
            }
            let parts = match self.geometry(i) {
                Some(p) => p,
                None => continue,
            };
            let mut out: Vec<Vec<[i32; 2]>> = Vec::new();
            match self.kind {
                Kind::Point => {
                    let mut pts = Vec::new();
                    for r in &parts {
                        for &p in r {
                            let t = to_tile(p);
                            if t[0] >= -BUF && t[0] <= EXTENT + BUF && t[1] >= -BUF && t[1] <= EXTENT + BUF {
                                pts.push([t[0].round() as i32, t[1].round() as i32]);
                            }
                        }
                    }
                    if pts.is_empty() {
                        continue;
                    }
                    out.push(pts);
                }
                Kind::Polygon => {
                    for r in &parts {
                        let t: Vec<[f64; 2]> = r.iter().map(|&p| to_tile(p)).collect();
                        let t = simplify(&t, tol);
                        let t = clip_ring(t, -BUF, EXTENT + BUF);
                        let mut q = quantize(&t);
                        if q.len() >= 2 && q.first() == q.last() {
                            q.pop();
                        }
                        if q.len() < 3 || area2(&q).abs() < 2 {
                            continue;
                        }
                        out.push(q);
                    }
                }
                Kind::Line => {
                    for r in &parts {
                        let t: Vec<[f64; 2]> = r.iter().map(|&p| to_tile(p)).collect();
                        let t = simplify(&t, tol);
                        for seg in clip_line(&t, -BUF, EXTENT + BUF) {
                            let q = quantize(&seg);
                            if q.len() >= 2 {
                                out.push(q);
                            }
                        }
                    }
                }
            }
            if out.is_empty() {
                continue;
            }
            let props = if only.is_some() { self.attributes(i, only) } else { Vec::new() };
            feats.push(Feat { id: i as u64 + 1, kind: self.kind, parts: out, props });
        }
        encode_tile("data", &feats)
    }
}

/* -------------------------------------------------------------- geometry */

pub fn merc(lon: f64, lat: f64) -> (f64, f64) {
    let lat = lat.clamp(-85.0511, 85.0511);
    (lon * 20037508.342789244 / 180.0, ((90.0 + lat) * std::f64::consts::PI / 360.0).tan().ln() * 6378137.0)
}

pub fn tile_lonlat(z: u32, x: u32, y: u32) -> (f64, f64, f64, f64) {
    let n = 2f64.powi(z as i32);
    let lat = |t: f64| (std::f64::consts::PI * (1.0 - 2.0 * t / n)).sinh().atan().to_degrees();
    (x as f64 / n * 360.0 - 180.0, lat(y as f64 + 1.0), (x as f64 + 1.0) / n * 360.0 - 180.0, lat(y as f64))
}

/// Douglas–Peucker (iterative), tolerance in tile units.
pub fn simplify(pts: &[[f64; 2]], tol: f64) -> Vec<[f64; 2]> {
    let n = pts.len();
    if n < 3 || tol <= 0.0 {
        return pts.to_vec();
    }
    let mut keep = vec![false; n];
    keep[0] = true;
    keep[n - 1] = true;
    let t2 = tol * tol;
    let mut stack = vec![(0usize, n - 1)];
    while let Some((a, b)) = stack.pop() {
        if b <= a + 1 {
            continue;
        }
        let (ax, ay, bx, by) = (pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
        let (dx, dy) = (bx - ax, by - ay);
        let dd = dx * dx + dy * dy;
        let (mut best, mut bi) = (-1.0f64, a);
        for k in a + 1..b {
            let (px, py) = (pts[k][0], pts[k][1]);
            let d = if dd == 0.0 {
                (px - ax).powi(2) + (py - ay).powi(2)
            } else {
                let u = (((px - ax) * dx + (py - ay) * dy) / dd).clamp(0.0, 1.0);
                (px - ax - u * dx).powi(2) + (py - ay - u * dy).powi(2)
            };
            if d > best {
                best = d;
                bi = k;
            }
        }
        if best > t2 {
            keep[bi] = true;
            stack.push((a, bi));
            stack.push((bi, b));
        }
    }
    pts.iter().zip(keep).filter(|(_, k)| *k).map(|(p, _)| *p).collect()
}

/// Sutherland–Hodgman against the square [lo, hi]².
pub fn clip_ring(mut pts: Vec<[f64; 2]>, lo: f64, hi: f64) -> Vec<[f64; 2]> {
    for (axis, bound, keep_lt) in [(0usize, lo, false), (0, hi, true), (1, lo, false), (1, hi, true)] {
        if pts.is_empty() {
            break;
        }
        let inside = |q: &[f64; 2]| if keep_lt { q[axis] <= bound } else { q[axis] >= bound };
        let inter = |p: &[f64; 2], q: &[f64; 2]| -> [f64; 2] {
            let t = (bound - p[axis]) / (q[axis] - p[axis]);
            let o = 1 - axis;
            let mut r = [0.0; 2];
            r[axis] = bound;
            r[o] = p[o] + t * (q[o] - p[o]);
            r
        };
        let mut out = Vec::with_capacity(pts.len() + 4);
        for i in 0..pts.len() {
            let c = pts[i];
            let p = pts[(i + pts.len() - 1) % pts.len()];
            if inside(&c) {
                if !inside(&p) {
                    out.push(inter(&p, &c));
                }
                out.push(c);
            } else if inside(&p) {
                out.push(inter(&p, &c));
            }
        }
        pts = out;
    }
    pts
}

/// A line cut to the square [lo, hi]² (Liang–Barsky per segment), in pieces.
pub fn clip_line(pts: &[[f64; 2]], lo: f64, hi: f64) -> Vec<Vec<[f64; 2]>> {
    let mut out: Vec<Vec<[f64; 2]>> = Vec::new();
    let mut cur: Vec<[f64; 2]> = Vec::new();
    for w in pts.windows(2) {
        let (p, q) = (w[0], w[1]);
        let (dx, dy) = (q[0] - p[0], q[1] - p[1]);
        let (mut t0, mut t1) = (0.0f64, 1.0f64);
        let mut ok = true;
        for (pp, qq) in [(-dx, p[0] - lo), (dx, hi - p[0]), (-dy, p[1] - lo), (dy, hi - p[1])] {
            if pp == 0.0 {
                if qq < 0.0 {
                    ok = false;
                    break;
                }
            } else {
                let r = qq / pp;
                if pp < 0.0 {
                    if r > t1 {
                        ok = false;
                        break;
                    }
                    if r > t0 {
                        t0 = r;
                    }
                } else {
                    if r < t0 {
                        ok = false;
                        break;
                    }
                    if r < t1 {
                        t1 = r;
                    }
                }
            }
        }
        if !ok {
            if cur.len() >= 2 {
                out.push(std::mem::take(&mut cur));
            }
            cur.clear();
            continue;
        }
        let a = [p[0] + t0 * dx, p[1] + t0 * dy];
        let b = [p[0] + t1 * dx, p[1] + t1 * dy];
        if cur.is_empty() || t0 > 0.0 {
            if cur.len() >= 2 {
                out.push(std::mem::take(&mut cur));
            }
            cur.clear();
            cur.push(a);
        }
        cur.push(b);
        if t1 < 1.0 {
            if cur.len() >= 2 {
                out.push(std::mem::take(&mut cur));
            }
            cur.clear();
        }
    }
    if cur.len() >= 2 {
        out.push(cur);
    }
    out
}

fn quantize(pts: &[[f64; 2]]) -> Vec<[i32; 2]> {
    let mut q: Vec<[i32; 2]> = Vec::with_capacity(pts.len());
    for p in pts {
        let v = [p[0].round().clamp(-1.0e8, 1.0e8) as i32, p[1].round().clamp(-1.0e8, 1.0e8) as i32];
        if q.last() != Some(&v) {
            q.push(v);
        }
    }
    q
}

fn area2(r: &[[i32; 2]]) -> i64 {
    let mut a = 0i64;
    for i in 0..r.len() {
        let p = r[(i + r.len() - 1) % r.len()];
        let c = r[i];
        a += p[0] as i64 * c[1] as i64 - c[0] as i64 * p[1] as i64;
    }
    a
}

/* ------------------------------------------------------------------ MVT */

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Str(String),
    Num(f64),
}

pub struct Feat {
    pub id: u64,
    pub kind: Kind,
    pub parts: Vec<Vec<[i32; 2]>>,
    pub props: Vec<(String, Value)>,
}

fn varint(out: &mut Vec<u8>, mut n: u64) {
    loop {
        let b = (n & 0x7f) as u8;
        n >>= 7;
        if n != 0 {
            out.push(b | 0x80);
        } else {
            out.push(b);
            return;
        }
    }
}
fn key(out: &mut Vec<u8>, field: u32, wire: u32) {
    varint(out, ((field << 3) | wire) as u64);
}
fn bytes_field(out: &mut Vec<u8>, field: u32, payload: &[u8]) {
    key(out, field, 2);
    varint(out, payload.len() as u64);
    out.extend_from_slice(payload);
}
fn zz(n: i32) -> u32 {
    ((n << 1) ^ (n >> 31)) as u32
}

fn geometry_commands(kind: Kind, parts: &[Vec<[i32; 2]>]) -> Vec<u32> {
    let mut out = Vec::new();
    let (mut cx, mut cy) = (0i32, 0i32);
    let cmd = |c: u32, n: u32| (n << 3) | c;
    if kind == Kind::Point {
        let pts: Vec<[i32; 2]> = parts.iter().flatten().copied().collect();
        out.push(cmd(1, pts.len() as u32));
        for p in pts {
            out.push(zz(p[0] - cx));
            out.push(zz(p[1] - cy));
            cx = p[0];
            cy = p[1];
        }
        return out;
    }
    for r in parts {
        if r.is_empty() {
            continue;
        }
        out.push(cmd(1, 1));
        out.push(zz(r[0][0] - cx));
        out.push(zz(r[0][1] - cy));
        cx = r[0][0];
        cy = r[0][1];
        let rest = &r[1..];
        out.push(cmd(2, rest.len() as u32));
        for p in rest {
            out.push(zz(p[0] - cx));
            out.push(zz(p[1] - cy));
            cx = p[0];
            cy = p[1];
        }
        if kind == Kind::Polygon {
            out.push(cmd(7, 1));
        }
    }
    out
}

pub fn encode_tile(name: &str, feats: &[Feat]) -> Vec<u8> {
    let mut keys: Vec<String> = Vec::new();
    let mut kidx: HashMap<String, u32> = HashMap::new();
    let mut vals: Vec<Value> = Vec::new();
    let mut vidx: HashMap<String, u32> = HashMap::new();
    let mut layer = Vec::new();
    key(&mut layer, 15, 0);
    varint(&mut layer, 2);
    bytes_field(&mut layer, 1, name.as_bytes());
    for f in feats {
        let mut tags = Vec::new();
        for (k, v) in &f.props {
            let ki = *kidx.entry(k.clone()).or_insert_with(|| {
                keys.push(k.clone());
                (keys.len() - 1) as u32
            });
            let vk = match v {
                Value::Str(s) => format!("s:{s}"),
                Value::Num(n) => format!("n:{}", n.to_bits()),
            };
            let vi = *vidx.entry(vk).or_insert_with(|| {
                vals.push(v.clone());
                (vals.len() - 1) as u32
            });
            varint(&mut tags, ki as u64);
            varint(&mut tags, vi as u64);
        }
        let mut geom = Vec::new();
        for c in geometry_commands(f.kind, &f.parts) {
            varint(&mut geom, c as u64);
        }
        let mut body = Vec::new();
        key(&mut body, 1, 0);
        varint(&mut body, f.id);
        bytes_field(&mut body, 2, &tags);
        key(&mut body, 3, 0);
        varint(&mut body, match f.kind { Kind::Point => 1, Kind::Line => 2, Kind::Polygon => 3 });
        bytes_field(&mut body, 4, &geom);
        bytes_field(&mut layer, 2, &body);
    }
    for k in &keys {
        bytes_field(&mut layer, 3, k.as_bytes());
    }
    for v in &vals {
        let mut vb = Vec::new();
        match v {
            Value::Str(s) => bytes_field(&mut vb, 1, s.as_bytes()),
            Value::Num(n) => {
                key(&mut vb, 3, 1);
                vb.extend_from_slice(&n.to_le_bytes());
            }
        }
        bytes_field(&mut layer, 4, &vb);
    }
    key(&mut layer, 5, 0);
    varint(&mut layer, EXTENT as u64);
    let mut tile = Vec::new();
    bytes_field(&mut tile, 3, &layer);
    tile
}

/* ---------------------------------------------------------- open files */

static NEXT: AtomicU32 = AtomicU32::new(1);
fn store() -> &'static Mutex<HashMap<u32, Arc<Dataset>>> {
    static S: OnceLock<Mutex<HashMap<u32, Arc<Dataset>>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}
pub fn get(id: u32) -> Option<Arc<Dataset>> {
    store().lock().ok()?.get(&id).cloned()
}

/// Opens a file and returns its description as JSON.
pub fn open_json(path: &str) -> Result<serde_json::Value, String> {
    let d = open(Path::new(path))?;
    let id = NEXT.fetch_add(1, Ordering::SeqCst);
    let info = serde_json::json!({
        "id": id,
        "name": d.name,
        "path": d.path,
        "kind": d.kind.name(),
        "count": d.count(),
        "bbox": d.extent,
        "fields": d.fields.iter().map(|f| f.name.clone()).collect::<Vec<_>>(),
    });
    store().lock().map_err(|e| e.to_string())?.insert(id, Arc::new(d));
    Ok(info)
}
pub fn close(id: u32) {
    if let Ok(mut s) = store().lock() {
        s.remove(&id);
    }
}
/// One feature as GeoJSON (identify, attribute lookups).
pub fn feature_json(id: u32, fid: u64) -> Result<serde_json::Value, String> {
    let d = get(id).ok_or("This native layer is closed.")?;
    let i = fid.checked_sub(1).ok_or("Bad feature id.")? as usize;
    let mut props = serde_json::Map::new();
    for (k, v) in d.attributes(i, None) {
        props.insert(k, match v { Value::Str(s) => serde_json::Value::String(s), Value::Num(n) => serde_json::json!(n) });
    }
    let parts = d.geometry(i).unwrap_or_default();
    let coords: Vec<Vec<[f64; 2]>> = parts;
    let geometry = match d.kind {
        Kind::Point => serde_json::json!({ "type": "MultiPoint", "coordinates": coords.into_iter().flatten().collect::<Vec<_>>() }),
        Kind::Line => serde_json::json!({ "type": "MultiLineString", "coordinates": coords }),
        Kind::Polygon => serde_json::json!({ "type": "Polygon", "coordinates": coords }),
    };
    Ok(serde_json::json!({ "type": "Feature", "id": fid, "properties": props, "geometry": geometry }))
}

fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    let hex = |c: u8| -> Option<u8> {
        match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            b'A'..=b'F' => Some(c - b'A' + 10),
            _ => None,
        }
    };
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(if b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// The `gcs` URI scheme: /tile/<id>/<z>/<x>/<y>.pbf?f=FIELD,FIELD
pub fn handle(uri_path: &str, query: &str) -> (u16, &'static str, Vec<u8>) {
    let seg: Vec<&str> = uri_path.trim_matches('/').split('/').collect();
    if seg.len() == 5 && seg[0] == "tile" {
        let id = seg[1].parse::<u32>().ok();
        let z = seg[2].parse::<u32>().ok();
        let x = seg[3].parse::<u32>().ok();
        let y = seg[4].split('.').next().and_then(|v| v.parse::<u32>().ok());
        if let (Some(id), Some(z), Some(x), Some(y)) = (id, z, x, y) {
            if let Some(d) = get(id) {
                let mut fields = Vec::new();
                for kv in query.split('&') {
                    if let Some(v) = kv.strip_prefix("f=") {
                        fields = pct_decode(v).split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
                    }
                }
                if z > 24 || x >= (1u32 << z.min(24)) || y >= (1u32 << z.min(24)) {
                    return (400, "text/plain", b"bad tile".to_vec());
                }
                return (200, "application/x-protobuf", d.tile(z, x, y, &fields));
            }
            return (404, "text/plain", b"layer not open".to_vec());
        }
    }
    (404, "text/plain", b"not found".to_vec())
}

/* ---------------------------------------------------------------- tests */

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // A shapefile with two squares near Takengon, written by hand.
    fn write_test_shp(dir: &Path) -> std::path::PathBuf {
        let squares = [[96.80, 4.60, 96.85, 4.65], [96.86, 4.60, 96.90, 4.64]];
        let mut shp = Vec::new();
        let mut shx = Vec::new();
        let mut recs = Vec::new();
        for (k, s) in squares.iter().enumerate() {
            let ring = [[s[0], s[1]], [s[0], s[3]], [s[2], s[3]], [s[2], s[1]], [s[0], s[1]]]; // clockwise
            let mut c = Vec::new();
            c.extend_from_slice(&5i32.to_le_bytes());
            for v in s {
                c.extend_from_slice(&v.to_le_bytes());
            }
            c.extend_from_slice(&1i32.to_le_bytes());
            c.extend_from_slice(&(ring.len() as i32).to_le_bytes());
            c.extend_from_slice(&0i32.to_le_bytes());
            for p in ring {
                c.extend_from_slice(&p[0].to_le_bytes());
                c.extend_from_slice(&p[1].to_le_bytes());
            }
            recs.push((k as i32 + 1, c));
        }
        let header = |len_words: i32| {
            let mut h = vec![0u8; 100];
            h[0..4].copy_from_slice(&9994i32.to_be_bytes());
            h[24..28].copy_from_slice(&len_words.to_be_bytes());
            h[28..32].copy_from_slice(&1000i32.to_le_bytes());
            h[32..36].copy_from_slice(&5i32.to_le_bytes());
            h
        };
        let mut body = Vec::new();
        let mut off = 50i32;
        for (n, c) in &recs {
            shx.extend_from_slice(&off.to_be_bytes());
            shx.extend_from_slice(&((c.len() / 2) as i32).to_be_bytes());
            body.extend_from_slice(&n.to_be_bytes());
            body.extend_from_slice(&((c.len() / 2) as i32).to_be_bytes());
            body.extend_from_slice(c);
            off += 4 + (c.len() / 2) as i32;
        }
        shp.extend(header(((100 + body.len()) / 2) as i32));
        shp.extend(body);
        let mut shx_all = header(((100 + shx.len()) / 2) as i32);
        shx_all.extend(shx);
        let p = dir.join("t.shp");
        File::create(&p).unwrap().write_all(&shp).unwrap();
        File::create(dir.join("t.shx")).unwrap().write_all(&shx_all).unwrap();
        // dbf with one character field NAME
        let mut dbf = vec![0u8; 32];
        dbf[0] = 3;
        dbf[4..8].copy_from_slice(&2u32.to_le_bytes());
        dbf[8..10].copy_from_slice(&65u16.to_le_bytes());
        dbf[10..12].copy_from_slice(&11u16.to_le_bytes());
        let mut fd = [0u8; 32];
        fd[..4].copy_from_slice(b"NAME");
        fd[11] = b'C';
        fd[16] = 10;
        dbf.extend_from_slice(&fd);
        dbf.push(0x0D);
        for n in ["Kebayakan", "Bebesen"] {
            dbf.push(b' ');
            let mut v = n.as_bytes().to_vec();
            v.resize(10, b' ');
            dbf.extend_from_slice(&v);
        }
        dbf.push(0x1A);
        File::create(dir.join("t.dbf")).unwrap().write_all(&dbf).unwrap();
        p
    }

    #[test]
    fn opens_and_tiles_a_shapefile() {
        let dir = std::env::temp_dir().join(format!("gcs-native-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = write_test_shp(&dir);
        let d = open(&p).expect("open");
        assert_eq!(d.count(), 2);
        assert_eq!(d.kind, Kind::Polygon);
        assert_eq!(d.fields[0].name, "NAME");
        assert_eq!(d.attributes(1, None)[0].1, Value::Str("Bebesen".into()));
        let g = d.geometry(0).unwrap();
        assert_eq!(g[0].len(), 5);
        // The tile over Takengon at z12 holds both squares with their names.
        let n = 2f64.powi(12);
        let tx = ((96.85 + 180.0) / 360.0 * n) as u32;
        let lat = 4.62f64.to_radians();
        let ty = ((1.0 - (lat.tan() + 1.0 / lat.cos()).ln() / std::f64::consts::PI) / 2.0 * n) as u32;
        let t = d.tile(12, tx, ty, &["NAME".to_string()]);
        assert!(t.len() > 40, "tile too small: {}", t.len());
        assert_eq!(t[0], 0x1a); // field 3 (layers), length-delimited
        let s = String::from_utf8_lossy(&t);
        assert!(s.contains("Kebayakan") || s.contains("Bebesen"));
        // An empty tile far away
        let e = d.tile(12, 0, 0, &[]);
        assert!(!String::from_utf8_lossy(&e).contains("Kebayakan"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn simplify_and_clip() {
        let line: Vec<[f64; 2]> = (0..100).map(|i| [i as f64, (i % 2) as f64 * 0.1]).collect();
        assert_eq!(simplify(&line, 1.0).len(), 2);
        let sq = vec![[-100.0, -100.0], [-100.0, 5000.0], [5000.0, 5000.0], [5000.0, -100.0]];
        let c = clip_ring(sq, -64.0, 4160.0);
        assert!(c.iter().all(|p| p[0] >= -64.0 && p[0] <= 4160.0 && p[1] >= -64.0 && p[1] <= 4160.0));
        let pieces = clip_line(&[[-500.0, 10.0], [5000.0, 10.0]], 0.0, 4096.0);
        assert_eq!(pieces.len(), 1);
        assert!((pieces[0][0][0] - 0.0).abs() < 1e-9 && (pieces[0][1][0] - 4096.0).abs() < 1e-9);
    }

    #[test]
    fn pct() {
        assert_eq!(pct_decode("NAMOBJ%2CWADMKC"), "NAMOBJ,WADMKC");
    }
}
