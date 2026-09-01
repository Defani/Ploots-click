// Menu search / help panel (right side) - like RStudio's Help pane search:
// type a keyword, get a short explanation of the matching menu + a button
// that jumps straight to it in the left sidebar. Pure UI chrome, does not
// touch chart state.
(function () {
  var HELP_INDEX = [
    { title: 'Ukuran Canvas (Custom Size)', panel: 'panel-canvas', section: 'canvas-size', icon: 'aspect_ratio',
      desc: 'Atur lebar & tinggi halaman/canvas secara manual, dalam satuan px, mm, atau cm.',
      kw: 'ukuran ganti resolusi ukuran halaman width height px mm cm size canvas custom size' },
    { title: 'Template Ukuran', panel: 'panel-canvas', section: 'canvas-templates', icon: 'grid_view',
      desc: 'Pilih ukuran canvas siap pakai dari daftar template (rasio/ukuran umum).',
      kw: 'template preset ukuran siap pakai templates' },
    { title: 'Warna Canvas', panel: 'panel-canvas', section: 'canvas-color', icon: 'format_color_fill',
      desc: 'Ganti warna latar belakang halaman/canvas, termasuk opsi transparan untuk export PNG.',
      kw: 'warna background latar belakang canvas color transparan canvas color' },
    { title: 'Jenis Chart (Chart Type)', panel: 'panel-chart', section: 'chart-type', icon: 'bar_chart',
      desc: 'Ganti jenis chart yang dipakai (bar, line, pie, dsb) dan atur jarak antar bar/kategori.',
      kw: 'jenis chart tipe grafik bar line pie ganti chart bar spacing chart type' },
    { title: 'Orientasi Chart', panel: 'panel-chart', section: 'orientation', icon: 'swap_horiz',
      desc: 'Ubah arah chart menjadi vertikal atau horizontal.',
      kw: 'orientasi horizontal vertical vertikal arah chart orientation' },
    { title: 'Error Bars', panel: 'panel-chart', section: 'error-bars', icon: 'linear_scale',
      desc: 'Tampilkan garis error bar pada data: atur nilai persen/tetap, panjang cap, ketebalan, dan warnanya.',
      kw: 'error bar garis kesalahan margin nilai errorbar' },
    { title: 'Gaya Garis & Titik (Line & Scatter Style)', panel: 'panel-chart', section: 'line-scatter-style', icon: 'show_chart',
      desc: 'Atur bentuk garis (lurus/melengkung), marker, ketebalan garis, dan fill area untuk chart garis/area/scatter.',
      kw: 'garis line marker ketebalan line width area fill scatter titik dash' },
    { title: 'Rentang Sumbu (Axis Range)', panel: 'panel-axis', section: 'axis-range', icon: 'straighten',
      desc: 'Atur rentang minimum/maksimum dan interval tick sumbu X dan Y, otomatis atau manual.',
      kw: 'range sumbu axis min max interval tick step rentang' },
    { title: 'Tanda Tick (Tick Marks)', panel: 'panel-axis', section: 'tick-marks', icon: 'dashboard',
      desc: 'Tampil/sembunyikan tick mayor & minor pada sumbu X/Y, atur posisi (dalam/luar) dan panjangnya.',
      kw: 'tick garis kecil sumbu minor mayor posisi tick length tanda' },
    { title: 'Garis Grid (Grid Lines)', panel: 'panel-axis', section: 'grid-lines', icon: 'grid_4x4',
      desc: 'Tampil/sembunyikan garis bantu grid mayor dan minor pada sumbu X dan Y.',
      kw: 'grid garis bantu grid line mayor minor' },
    { title: 'Label Sumbu (Axis Labels)', panel: 'panel-axis', section: 'axis-labels', icon: 'title',
      desc: 'Atur judul sumbu X/Y, font body, ukuran font, dan pembungkusan label yang panjang.',
      kw: 'judul sumbu label axis title font wrap teks sumbu' },
    { title: 'Pengaturan Legend', panel: 'panel-legend', section: 'legend-settings', icon: 'format_list_bulleted',
      desc: 'Tampil/sembunyikan legend, atur posisi, judul, ukuran font, jumlah kolom, dan border legend.',
      kw: 'legend keterangan warna posisi legenda kolom border' },
    { title: 'Gaya Visual (Visual Style)', panel: 'panel-color', section: 'visual-style', icon: 'style',
      desc: 'Pilih apakah tiap series dibedakan dengan warna, pola (pattern), atau kombinasi keduanya.',
      kw: 'warna pattern pola visual style corak' },
    { title: 'Daftar Series', panel: 'panel-color', section: 'series', icon: 'format_list_bulleted',
      desc: 'Atur nama, warna, dan tampil/sembunyikan tiap series data satu per satu.',
      kw: 'series data warna nama tampil sembunyikan seri' },
    { title: 'Palet Warna (Color Palette)', panel: 'panel-color', section: 'color-palette', icon: 'palette',
      desc: 'Cari dan pilih skema warna/palet siap pakai untuk seluruh chart.',
      kw: 'palet warna palette color scheme cari skema' },
    { title: 'Bentuk (Shapes)', panel: 'panel-shapes', section: null, icon: 'shapes',
      desc: 'Tambahkan bentuk dasar, garis & panah, bintang, atau simbol ke canvas.',
      kw: 'bentuk shape garis panah bintang simbol kotak lingkaran' },
    { title: 'Editor LaTeX', panel: 'panel-latex', section: 'latex-editor', icon: 'functions',
      desc: 'Ketik rumus LaTeX manual untuk ditambahkan sebagai objek teks/formula di canvas.',
      kw: 'latex rumus formula matematika editor persamaan' },
    { title: 'Katalog Simbol', panel: 'panel-latex', section: 'symbol-catalog', icon: 'category',
      desc: 'Cari dan sisipkan simbol matematika (huruf Yunani, operator, dll) ke rumus atau teks.',
      kw: 'simbol symbol katalog yunani matematika cari operator' },
    { title: 'Export', panel: 'panel-export', section: null, icon: 'file_save',
      desc: 'Simpan chart sebagai PNG, JPG, SVG, atau PDF — atur resolusi (DPI), nama file, dan latar belakang.',
      kw: 'export simpan download png jpg svg pdf dpi resolusi nama file' },
    { title: 'Tampilan Data (Data View)', navBtnId: 'navDataToggle', panel: null, section: null, icon: 'database',
      desc: 'Buka tampilan tabel data (seperti spreadsheet) untuk import, edit, dan lihat statistik data.',
      kw: 'data view tabel spreadsheet import excel csv edit data statistik' }
  ];

  var panelEl, backdropEl, inputEl, listEl;
  var current = HELP_INDEX;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function render(items) {
    if (!items.length) {
      listEl.innerHTML = '<div class="hs-empty">Tidak ada menu yang cocok.<br>Coba kata kunci lain, misal "warna" atau "sumbu".</div>';
      return;
    }
    listEl.innerHTML = items.map(function (it, i) {
      return '' +
        '<div class="hs-item">' +
          '<div class="hs-item-title"><span class="material-symbols-outlined">' + it.icon + '</span>' + escapeHtml(it.title) + '</div>' +
          '<div class="hs-item-desc">' + escapeHtml(it.desc) + '</div>' +
          '<button type="button" class="hs-open-btn" data-idx="' + i + '"><span class="material-symbols-outlined">open_in_new</span>Buka menu ini</button>' +
        '</div>';
    }).join('');
    listEl._items = items;
  }

  function filterItems(query) {
    query = (query || '').trim().toLowerCase();
    if (!query) return HELP_INDEX;
    var tokens = query.split(/\s+/);
    return HELP_INDEX.filter(function (it) {
      var hay = (it.title + ' ' + it.desc + ' ' + it.kw).toLowerCase();
      return tokens.every(function (t) { return hay.indexOf(t) !== -1; });
    });
  }

  function openPanel() {
    panelEl.classList.add('open');
    backdropEl.classList.add('open');
    inputEl.value = '';
    current = HELP_INDEX;
    render(current);
    setTimeout(function () { inputEl.focus(); }, 220);
  }

  function closePanel() {
    panelEl.classList.remove('open');
    backdropEl.classList.remove('open');
  }

  function jumpTo(entry) {
    closePanel();
    // The Axis menu now lives docked in the left sidebar (panel-axis), so it
    // uses the same generic activateSidebarPanel path as every other panel.
    if (entry.navBtnId) {
      var btn = document.getElementById(entry.navBtnId);
      if (btn) btn.click();
    } else if (entry.panel) {
      if (typeof window.activateSidebarPanel === 'function') {
        window.activateSidebarPanel(entry.panel);
      } else {
        var navBtn = document.querySelector('.nav-btn[data-panel="' + entry.panel + '"]');
        if (navBtn) navBtn.click();
      }
    }
    if (entry.panel && entry.section) {
      setTimeout(function () {
        var sec = document.querySelector('#' + entry.panel + ' .side-section[data-section="' + entry.section + '"]');
        if (!sec) return;
        sec.classList.add('open');
        sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        sec.classList.add('hs-flash');
        setTimeout(function () { sec.classList.remove('hs-flash'); }, 1500);
      }, 150);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    panelEl = document.getElementById('hsPanel');
    backdropEl = document.getElementById('hsBackdrop');
    inputEl = document.getElementById('hsSearchInput');
    listEl = document.getElementById('hsList');
    if (!panelEl) return;

    var triggerBtn = document.getElementById('helpSearchBtn');
    if (triggerBtn) triggerBtn.addEventListener('click', openPanel);

    var closeBtn = document.getElementById('hsClose');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);
    backdropEl.addEventListener('click', closePanel);

    inputEl.addEventListener('input', function () {
      current = filterItems(inputEl.value);
      render(current);
    });

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.hs-open-btn');
      if (!btn) return;
      var idx = parseInt(btn.getAttribute('data-idx'), 10);
      var entry = (listEl._items || HELP_INDEX)[idx];
      if (entry) jumpTo(entry);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panelEl.classList.contains('open')) closePanel();
    });
  });
})();
