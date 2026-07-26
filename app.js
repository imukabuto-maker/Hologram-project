/**
 * app.js
 * ---------------------------------------------------------------------------
 * Entry point aplikasi. Pada Tahap 1 ini bertanggung jawab atas mekanika
 * UI generik agar seluruh layout "hidup" dan bisa dites di browser:
 *   - Tema terang/gelap (persisten via Storage)
 *   - Toggle panel kiri/kanan (persisten via Storage)
 *   - Tab mode preview (Original / Interlaced / Lenticular Simulation)
 *   - Chip orientasi lensa (vertikal/horizontal) + sinkron ke <select>
 *   - Sinkronisasi dua arah slider <-> input angka untuk semua parameter
 *   - Kontrol zoom kanvas (CSS transform) & toggle grid lensa
 *   - Buka/tutup modal (Kalibrasi, Simpan Preset)
 *   - Dropzone: klik & drag-visual (pemrosesan file sesungguhnya = Tahap 2)
 *   - Status bar realtime untuk PixelsPerLens / PixelsPerView (Utils)
 *   - Util toast notifikasi ringan
 *
 * Fungsi-fungsi yang secara eksplisit dijadwalkan untuk tahap berikutnya
 * ditandai dengan komentar TODO dan, bila relevan, menampilkan toast info
 * agar jelas bagi penguji bahwa itu belum aktif — bukan tombol mati tanpa
 * penjelasan.
 * ---------------------------------------------------------------------------
 */
(() => {
  'use strict';

  /* ============================================================ *
   * Referensi DOM
   * ============================================================ */
  const appEl = document.getElementById('app');
  const workspaceEl = document.getElementById('workspace');

  /* ============================================================ *
   * Toast notifikasi
   * ============================================================ */
  function toast(message, type = 'info', duration = 2600) {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = `toast${type !== 'info' ? ` toast-${type}` : ''}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      el.style.transition = 'all 180ms ease';
      setTimeout(() => el.remove(), 200);
    }, duration);
  }

  /* ============================================================ *
   * Tema terang / gelap
   * ============================================================ */
  function initTheme() {
    const saved = Storage.getTheme();
    setTheme(saved, false);

    document.getElementById('toggleTheme').addEventListener('click', () => {
      const next = appEl.classList.contains('theme-light') ? 'dark' : 'light';
      setTheme(next, true);
    });
  }

  function setTheme(theme, announce) {
    appEl.classList.toggle('theme-light', theme === 'light');
    Storage.setTheme(theme);
    if (announce) toast(`Tema diganti ke ${theme === 'light' ? 'terang' : 'gelap'}`, 'success');
  }

  /* ============================================================ *
   * Toggle panel kiri / kanan (persisten)
   * ============================================================ */
  function initPanelToggles() {
    const state = Storage.getPanelState();
    applyPanelState(state);

    document.getElementById('toggleLeftPanel').addEventListener('click', () => {
      const s = Storage.getPanelState();
      s.left = !s.left;
      Storage.setPanelState(s);
      applyPanelState(s);
    });

    document.getElementById('toggleRightPanel').addEventListener('click', () => {
      const s = Storage.getPanelState();
      s.right = !s.right;
      Storage.setPanelState(s);
      applyPanelState(s);
    });
  }

  function applyPanelState(state) {
    workspaceEl.classList.toggle('no-left', !state.left);
    workspaceEl.classList.toggle('no-right', !state.right);
    document.getElementById('toggleLeftPanel').classList.toggle('is-active', state.left);
    document.getElementById('toggleRightPanel').classList.toggle('is-active', state.right);
  }

  /* ============================================================ *
   * Tab mode preview (Original / Interlaced / Simulation)
   * ============================================================ */
  function initModeTabs() {
    const tabs = Array.from(document.querySelectorAll('.mode-tab'));
    const mainCanvas = document.getElementById('mainCanvas');
    const webglCanvas = document.getElementById('webglCanvas');
    const simHint = document.getElementById('simHint');
    const statusMode = document.getElementById('statusMode');

    const modeLabels = {
      original: 'Original',
      interlaced: 'Interlaced',
      simulation: 'Lenticular Simulation',
    };

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.mode;
        tabs.forEach(t => {
          t.classList.toggle('is-active', t === tab);
          t.setAttribute('aria-selected', String(t === tab));
        });
        appEl.dataset.mode = mode;
        statusMode.textContent = modeLabels[mode];

        const isSim = mode === 'simulation';
        mainCanvas.hidden = isSim;
        webglCanvas.hidden = !isSim;
        simHint.hidden = !isSim;

        // TODO (Tahap 5): panggil Preview.initSimulation() saat mode === 'simulation'
        // dan Preview.renderOriginal()/renderInterlaced() untuk dua mode lainnya.
      });
    });
  }

  /* ============================================================ *
   * Chip orientasi lensa (toolbar) — sinkron dengan <select> di panel kanan
   * ============================================================ */
  function initLensOrientation() {
    const chips = Array.from(document.querySelectorAll('#lensOrientationToggle .chip'));
    const select = document.getElementById('paramLensDir');
    const gridOverlay = document.getElementById('lensGridOverlay');

    function apply(orientation, fromChip) {
      chips.forEach(c => c.classList.toggle('is-active', c.dataset.orientation === orientation));
      select.value = orientation;
      gridOverlay.classList.toggle('horizontal', orientation === 'horizontal');
      updateStatusMath();
    }

    chips.forEach(chip => {
      chip.addEventListener('click', () => apply(chip.dataset.orientation, true));
    });
    select.addEventListener('change', () => apply(select.value, false));
  }

  /* ============================================================ *
   * Sinkronisasi generik slider <-> input angka untuk semua parameter
   * ============================================================ */
  function initRangeNumberPairs() {
    const numberInputs = Array.from(document.querySelectorAll('.input-number'));

    numberInputs.forEach(numberInput => {
      const rangeInput = document.getElementById(`${numberInput.id}_range`);
      if (!rangeInput) return; // beberapa field angka tidak punya pasangan slider

      const sync = (source, target) => {
        target.value = source.value;
        updateStatusMath();
      };

      rangeInput.addEventListener('input', () => sync(rangeInput, numberInput));
      numberInput.addEventListener('input', () => {
        const min = parseFloat(numberInput.min);
        const max = parseFloat(numberInput.max);
        if (!Number.isNaN(min) && !Number.isNaN(max)) {
          const clamped = Utils.clamp(parseFloat(numberInput.value || '0'), min, max);
          rangeInput.value = String(clamped);
        } else {
          rangeInput.value = numberInput.value;
        }
        updateStatusMath();
      });
    });

    // Field angka tanpa slider tetap perlu memicu update status (mis. views bila diketik langsung)
    document.getElementById('paramForm').addEventListener('input', updateStatusMath);
  }

  /* ============================================================ *
   * Status bar realtime: PixelsPerLens & PixelsPerView
   * (memakai rumus murni dari Utils — belum menyentuh gambar/canvas)
   * ============================================================ */
  function updateStatusMath() {
    const dpi = parseFloat(document.getElementById('paramOutputDPI').value) || 0;
    const lpi = parseFloat(document.getElementById('paramLPI').value) || 1;
    const views = parseInt(document.getElementById('paramViews').value, 10) || 1;

    const result = Utils.computeInterlaceMath({ dpi, lpi, views });

    document.getElementById('statusPixelsPerLens').textContent =
      Utils.formatNumber(result.pixelsPerLens, 3, ' px');
    document.getElementById('statusPixelsPerView').textContent =
      Utils.formatNumber(result.pixelsPerView, 4, ' px');
    document.getElementById('statusViewCount').textContent = String(views);
  }

  /* ============================================================ *
   * Zoom kanvas (CSS transform sederhana) & toggle grid lensa
   * ============================================================ */
  function initZoomControls() {
    const surface = document.getElementById('canvasSurface');
    const zoomValue = document.getElementById('zoomValue');
    const statusZoom = document.getElementById('statusZoom');
    let zoom = 1;

    function applyZoom() {
      surface.style.transform = `scale(${zoom})`;
      const pct = `${Math.round(zoom * 100)}%`;
      zoomValue.textContent = pct;
      statusZoom.textContent = pct;
    }

    document.getElementById('zoomIn').addEventListener('click', () => {
      zoom = Utils.clamp(Utils.roundTo(zoom + 0.1, 2), 0.1, 4);
      applyZoom();
    });
    document.getElementById('zoomOut').addEventListener('click', () => {
      zoom = Utils.clamp(Utils.roundTo(zoom - 0.1, 2), 0.1, 4);
      applyZoom();
    });
    document.getElementById('zoomFit').addEventListener('click', () => {
      zoom = 1; // TODO (Tahap 5): hitung fit-to-screen sesungguhnya berbasis ukuran gambar asli
      applyZoom();
      toast('Fit-to-screen akan dihitung otomatis setelah gambar dimuat (Tahap 5)');
    });

    document.getElementById('toggleGrid').addEventListener('click', (e) => {
      const overlay = document.getElementById('lensGridOverlay');
      const active = overlay.hidden;
      overlay.hidden = !active;
      e.currentTarget.classList.toggle('is-active', active);
    });
  }

  /* ============================================================ *
   * Modal: Kalibrasi & Simpan Preset (buka/tutup saja di Tahap 1)
   * ============================================================ */
  function initModals() {
    bindModal('modalCalibration', 'btnCalibration', 'closeCalibrationModal');
    document.getElementById('btnOpenCalibrationWizard').addEventListener('click', () => {
      openModal('modalCalibration');
    });

    bindModal('modalSavePreset', 'btnSavePreset', 'closeSavePresetModal');
    document.getElementById('cancelSavePreset').addEventListener('click', () => closeModal('modalSavePreset'));
    document.getElementById('confirmSavePreset').addEventListener('click', () => {
      const name = document.getElementById('presetNameInput').value.trim();
      if (!name) {
        toast('Nama preset tidak boleh kosong', 'error');
        return;
      }
      // TODO (Tahap 3): kumpulkan seluruh nilai form via Settings, lalu Storage.savePreset(name, values)
      toast(`Penyimpanan preset "${name}" akan aktif penuh setelah Tahap 3`);
      closeModal('modalSavePreset');
    });

    document.getElementById('wizardNext').addEventListener('click', () => {
      toast('Wizard kalibrasi akan diimplementasikan pada Tahap 6');
    });
  }

  function bindModal(modalId, openBtnId, closeBtnId) {
    document.getElementById(openBtnId).addEventListener('click', () => openModal(modalId));
    document.getElementById(closeBtnId).addEventListener('click', () => closeModal(modalId));
    document.getElementById(modalId).addEventListener('click', (e) => {
      if (e.target.id === modalId) closeModal(modalId); // klik area gelap = tutup
    });
  }

  function openModal(id) { document.getElementById(id).hidden = false; }
  function closeModal(id) { document.getElementById(id).hidden = true; }

  /* ============================================================ *
   * Dropzone: klik membuka file dialog + feedback visual drag-over.
   * Pembacaan & rendering file sesungguhnya menyusul di Tahap 2.
   * ============================================================ */
  function initDropzones() {
    const single = document.getElementById('dropzoneSingle');
    const inputSingle = document.getElementById('inputSingleImage');
    const multi = document.getElementById('dropzoneMulti');
    const inputMulti = document.getElementById('inputMultiImage');
    const stage = document.getElementById('canvasStage');
    const dragOverlay = document.getElementById('dragOverlay');

    single.addEventListener('click', () => inputSingle.click());
    multi.addEventListener('click', () => inputMulti.click());
    single.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') inputSingle.click(); });
    multi.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') inputMulti.click(); });

    inputSingle.addEventListener('change', () => {
      // TODO (Tahap 2): baca file via Utils.readImageFile, render ke mainCanvas, isi frameList
      toast(`${inputSingle.files.length} file dipilih — pemrosesan gambar aktif di Tahap 2`);
    });
    inputMulti.addEventListener('change', () => {
      toast(`${inputMulti.files.length} file dipilih — pemrosesan gambar aktif di Tahap 2`);
    });

    ['dragenter', 'dragover'].forEach(evt => {
      stage.addEventListener(evt, (e) => {
        e.preventDefault();
        dragOverlay.hidden = false;
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      stage.addEventListener(evt, (e) => {
        e.preventDefault();
        if (evt === 'drop') {
          toast(`${e.dataTransfer.files.length} file di-drop — pemrosesan gambar aktif di Tahap 2`);
        }
        dragOverlay.hidden = true;
      });
    });
  }

  /* ============================================================ *
   * Inisialisasi umum lain (tombol yang belum fungsional penuh)
   * ============================================================ */
  function initMiscStubs() {
    document.getElementById('btnNewProject').addEventListener('click', () => {
      toast('Proyek baru akan menghapus semua frame & mengembalikan parameter default (aktif setelah Tahap 3)');
    });
    document.getElementById('btnClearHistory').addEventListener('click', () => {
      toast('Riwayat aktivitas akan disambungkan pada tahap-tahap berikutnya');
    });
    document.getElementById('btnLoadPreset').addEventListener('click', () => {
      toast('Memuat preset akan aktif penuh setelah Tahap 3');
    });
    document.getElementById('btnDeletePreset').addEventListener('click', () => {
      toast('Menghapus preset akan aktif penuh setelah Tahap 3');
    });
  }

  /* ============================================================ *
   * Boot
   * ============================================================ */
  function init() {
    if (!Storage.isAvailable()) {
      toast('localStorage tidak tersedia di browser ini — preset & preferensi tidak akan tersimpan', 'error', 4000);
    }
    initTheme();
    initPanelToggles();
    initModeTabs();
    initLensOrientation();
    initRangeNumberPairs();
    initZoomControls();
    initModals();
    initDropzones();
    initMiscStubs();
    updateStatusMath();

    console.info('[LenticularStudio] Tahap 1 (UI) siap. Menunggu konfirmasi untuk Tahap 2: Upload Image.');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
