# Migrasi engine: Plotly.js → D3.js

Status: **selesai** — ke-25 tipe chart dirender D3 dan Plotly.js sudah dihapus dari aplikasi (±2 MB lebih ringan).

## Kenapa bertahap

Selama migrasi, `render()` mengarahkan tipe yang sudah punya renderer D3 ke
`PlootsD3`, sisanya tetap ke rantai render lama (Plotly + SVG manual). Jadi
aplikasi tetap bisa dipakai penuh di setiap tahap. Setelah semua tipe pindah,
`vendor/plotly-ploots.min.js` dihapus.

## Status per tipe

| Tipe | Engine |
|---|---|
| bar-single, bar-group, bar-stack | **D3** |
| line, area, scatter | **D3** |
| pie, donut, histogram, box, violin, heatmap | **D3** (tahap 2) |
| waterfall, funnel, treemap | **D3** (tahap 2) |
| lollipop, bubble, dumbbell, scatter-matrix, sankey | **D3** (tahap 3) |
| choropleth, bubble-map | **D3** (tahap 4, d3-geo) |
| ridge-plot | **D3** (tahap 3, sekarang memakai frame) |
| radial-rings, sunburst | SVG sendiri, didaftarkan sebagai renderer D3 (tahap 3) |

## Struktur

```
vendor/d3-7.9.0.min.js          D3 lokal (offline, tidak lewat CDN)
js/d3-engine/00-core.js          ukur teks, rich text, format angka, marker, pola hatch
js/d3-engine/01-frame.js         skala, sumbu, grid, frame, legend, perhitungan margin
js/d3-engine/02-cartesian.js     renderer bar / line / area / scatter
js/d3-engine/03-stats.js         renderer pie / donut / histogram / box / violin / heatmap
js/d3-engine/04-flow.js          renderer waterfall / funnel / treemap
js/d3-engine/05-special.js       renderer lollipop / dumbbell / bubble / scatter-matrix / sankey / ridge-plot
js/d3-engine/06-geo.js           renderer choropleth / bubble-map (d3-geo + dekoder topojson)
js/d3-engine/geo-country-regex.js  tabel nama negara -> ISO-3 (dari paket country-regex)
js/d3-engine/99-integration.js   render(), canvas kosong, export, klik sumbu
```

Renderer baru didaftarkan dengan `PlootsD3.renderers["tipe"] = function (gd) {...}`.
Begitu terdaftar, `render()`, export (PNG/JPG/SVG/PDF) dan panel Format Axis
otomatis memakainya.

## Yang sengaja dipertahankan

- Semua key `state` sama (sidebar, quick bar, Format Axis, undo/redo tidak diubah).
- Detach legend / detach judul sumbu (Fabric) tetap jalan.
- Label dengan `<sup>`, `<sub>`, `<br>`, `<b>`, `<i>` tetap dirender.
- Kategori berupa angka → sumbu X numerik untuk line/area/scatter (sama seperti auto-type Plotly).

## Perubahan perilaku

- **Trendline** di-fit terhadap nilai X asli kalau X numerik. Versi Plotly meregresikan
  terhadap nomor baris, jadi slope/intercept salah untuk X yang jaraknya tidak sama.
- **Stacked bar** menumpuk nilai positif dan negatif terpisah (diverging), tidak saling menimpa.
- **Garis spline** memakai `d3.curveMonotoneX`: tidak pernah melewati nilai data (tidak ada puncak palsu).
- **Stacked percent** sumbunya dikunci 0–100.
- **Label nilai** punya halo sewarna latar supaya terbaca di atas pola hatch dan grid,
  dan diletakkan di luar ujung error bar.
- Pemisah ribuan hanya mulai dari 10 000 (tahun seperti 2016 tidak jadi "2,016").

## Yang hilang dibanding Plotly

- Hover tooltip dan zoom/pan modebar di tipe D3 (sebelumnya pun tertutup overlay Fabric).
- Font web (Poppins) belum ikut ke export PNG — masalah yang sama sudah ada di versi Plotly.

## Catatan untuk tahap berikutnya

- Model data scatter masih berbasis kategori (kolom pertama = X). Plot seperti IRECI vs AGC
  perlu pemilihan kolom X/Y — sebaiknya dibereskan bersamaan dengan dataset store untuk multipanel.
- Frame D3 sudah menerima ukuran dan target `<svg>` per render, jadi siap dipakai untuk
  banyak chart per halaman.

## Tes yang dijalankan (Chromium headless)

- 6 tipe D3 dengan data sampel dibandingkan visual dengan versi Plotly.
- Matriks opsi: horizontal, pola warna & grayscale, value labels, error bars, stacked percent,
  stack negatif, log scale, custom range + tick step, minor grid, frame + mirror ticks,
  semua posisi legend, legend multi-kolom + judul + border, rotasi label kategori panjang,
  regresi X numerik, semua bentuk marker, rich text `<sup>`.
- Integrasi: pindah bolak-balik D3 ↔ Plotly ↔ SVG manual (tidak ada SVG sisa), 25 tipe
  dirender tanpa error, detach/reattach legend dan judul sumbu, klik sumbu membuka
  Format Axis, export SVG & PNG, undo.

## Tahap 2 — catatan

Frame mendapat tiga tambahan kecil: sumbu `hidden` (funnel tidak punya sumbu
nilai yang bermakna), `def.reserve` untuk ruang yang digambar renderer sendiri
(colorbar heatmap), dan `PD.legendFor / legendReserve / drawLegendIn` supaya
chart tanpa sumbu (pie, donut) memakai legend yang sama — termasuk drag dan
detach.

Perubahan perilaku dibanding Plotly:

- **Heatmap** selalu terang (rendah) → gelap (tinggi). Palet kualitatif dulu
  direntangkan apa adanya sehingga nilai bertetangga dapat warna yang tidak
  berhubungan; sekarang dibuat ramp dari warna pertama palet. Grayscale juga
  terang → gelap (Greys Plotly hitam → putih). Label nilai jadi putih di sel gelap.
- **Histogram**: bin dipakai bersama oleh semua seri yang ditumpuk, jadi batang
  sejajar (Plotly mem-bin tiap seri sendiri).
- **Pie/donut**: slice yang terlalu sempit untuk label di dalam mendapat label
  di luar dengan garis penunjuk; label di atas hatch memakai halo tebal.
- **Funnel**: sumbu nilai tidak digambar (lebar tahap dipusatkan di 0).

Diuji di Chromium: 15 tipe D3 dengan data sampel, mode warna / warna+pola /
pola (grayscale), outline, value labels, posisi legend, log + frame, klik sumbu
membuka Format Axis, detach/reattach legend, dan export (SVG → PNG) semua tipe.

## Tahap 3 — catatan

- **Sankey** memakai layout sendiri (kolom = jalur terpanjang dari sumber,
  tinggi = throughput, 8 putaran relaksasi) karena modul d3-sankey tidak
  termasuk dalam bundel D3.
- **Ridge plot** sekarang memakai frame, jadi Format Axis, grid, tick, font,
  dan format angka berlaku di sumbu nilainya (SVG lama mengabaikan semuanya).
  Baris teratas diberi ruang agar puncak ridge tidak terpotong.
- **Scatter matrix** menuliskan nama variabel di panel diagonal (dulu kosong).
- **Radial rings** dan **sunburst** tetap memakai SVG buatannya sendiri, tapi
  sekarang lewat jalur render/export yang sama dengan tipe D3 lain.
- Frame: band axis menerima `align` (letak padding luar).

## Tahap 4 — peta, dan Plotly dihapus

- **Choropleth** dan **bubble map** digambar dengan d3-geo. Peta dasar tetap
  file Natural Earth 110m di `vendor/topojson/` (dimuat sekali lalu di-cache);
  dekoder topojson kecil ada di `06-geo.js`. Pencocokan lokasi sama dengan
  Plotly: kode ISO-3, atau nama negara lewat tabel country-regex.
- Semua pengaturan panel "Peta (Choropleth)" dipertahankan: cakupan (dengan
  bingkai lon/lat yang sama dengan Plotly), 6 proyeksi, GeoJSON kustom +
  featureidkey + fit bounds, warna kontinu / berkelas (interval sama /
  kuantil), rentang z manual, skala terbalik, warna wilayah tanpa data.
- Perubahan: warna memakai ramp terang → gelap yang sama dengan heatmap;
  colorbar berkelas memakai blok setinggi sama; polygon GeoJSON kustom dengan
  urutan RFC 7946 otomatis dibalik (sebelumnya bisa menutupi seluruh bola
  dunia); proyeksi orthographic diputar ke pusat data.
- `vendor/plotly-ploots.min.js` dihapus. `render()` dan `renderBlankCanvas()`
  lama di `07-render.js` menjadi no-op tanpa Plotly; kode Plotly di file
  chart-builder lain tidak lagi terjangkau (dibersihkan terpisah).
- Hilang dibanding Plotly: tooltip hover dan zoom/pan modebar (sebelumnya pun
  tertutup overlay Fabric).