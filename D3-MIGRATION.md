# Migrasi engine: Plotly.js → D3.js

Status: **tahap 1 selesai** — 6 dari 25 tipe chart sudah dirender D3.

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
| pie, donut, histogram, box, violin, heatmap, waterfall, funnel, treemap | Plotly (tahap 2) |
| lollipop, bubble, dumbbell, scatter-matrix, sankey | Plotly (tahap 3) |
| choropleth, bubble-map | Plotly geo (tahap 4) |
| radial-rings, sunburst, ridge-plot | SVG manual (tahap 3, dipindah ke frame D3) |

## Struktur

```
vendor/d3-7.9.0.min.js          D3 lokal (offline, tidak lewat CDN)
js/d3-engine/00-core.js          ukur teks, rich text, format angka, marker, pola hatch
js/d3-engine/01-frame.js         skala, sumbu, grid, frame, legend, perhitungan margin
js/d3-engine/02-cartesian.js     renderer bar / line / area / scatter
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
