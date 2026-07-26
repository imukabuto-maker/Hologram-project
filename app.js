/**
 * app.js
 * ---------------------------------------------------------------------------
 * Entry point aplikasi.
 *
 * Tahap 1 (mekanika UI generik):
 *   - Tema terang/gelap (persisten via Storage)
 *   - Toggle panel kiri/kanan (persisten via Storage)
 *   - Tab mode preview (Original / Interlaced / Lenticular Simulation)
 *   - Chip orientasi lensa (vertikal/horizontal) + sinkron ke <select>
 *   - Sinkronisasi dua arah slider <-> input angka untuk semua parameter
 *   - Kontrol zoom kanvas (CSS transform) & toggle grid lensa
 *   - Buka/tutup modal (Kalibrasi, Simpan Preset)
 *   - Status bar realtime untuk PixelsPerLens / PixelsPerView (Utils)
 *   - Util toast notifikasi ringan
 *
 * Tahap 2 (Upload Image, ditambahkan sekarang):
 *   - Frame Store: menyimpan daftar gambar/view yang diupload (single & multi)
 *   - Upload via klik dropzone maupun drag & drop ke area kanvas
 *   - Thumbnail per-view di panel kiri, bisa diklik untuk pratinjau
 *   - Reorder urutan view via drag & drop antar item daftar
 *   - Hapus per-frame, atau hapus semua lewat "Proyek Baru"
 *   - Render frame aktif ke #mainCanvas (mode Original) + zoom-to-fit otomatis
 *   - Sinkron otomatis "Number of Views" mengikuti jumlah frame terupload
 *   - Log Riwayat aktivitas yang sesungguhnya (tambah/hapus/urutkan/dsb)
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
    const mStatusMode = document.getElementById('mStatusMode');
    const simEmptyState = document.getElementById('simEmptyState');
    const emptyState = document.getElementById('emptyState');

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
        mStatusMode.textContent = modeLabels[mode];

        const isSim = mode === 'simulation';
        simHint.hidden = !isSim;

        if (isSim) {
          mainCanvas.hidden = true;
          emptyState.hidden = true; // simEmptyState yang mengambil alih pesan "belum ada gambar" di mode ini
          enterSimulationMode();
        } else {
          webglCanvas.hidden = true;
          simEmptyState.hidden = true;
          Preview.stop();
          mainCanvas.hidden = false;
          renderActiveFrame(); // pastikan mode Original menampilkan frame aktif lagi (mis. setelah dari simulasi)
        }

        // TODO (Tahap 4): render hasil interlace sungguhan saat mode === 'interlaced'.
        // Untuk saat ini mode Interlaced menampilkan frame aktif yang sama seperti Original.
      });
    });
  }

  /**
   * Masuk ke mode simulasi: siapkan renderer (sekali saja), muat tekstur
   * dari frame yang ada, dan mulai render loop. Bila frame < 2, tampilkan
   * pesan penuntun alih-alih kanvas kosong.
   */
  function enterSimulationMode() {
    const webglCanvas = document.getElementById('webglCanvas');
    const simEmptyState = document.getElementById('simEmptyState');
    const gyroBtn = document.getElementById('btnEnableGyro');

    Preview.ensureRenderer(webglCanvas);

    if (frames.length < 2) {
      webglCanvas.hidden = true;
      simEmptyState.hidden = false;
      return;
    }

    simEmptyState.hidden = true;
    webglCanvas.hidden = false;

    const ok = Preview.setFrames(frames.map(f => f.img));
    if (!ok) {
      simEmptyState.hidden = false;
      webglCanvas.hidden = true;
      return;
    }

    Preview.setOrientation(getLensOrientation());
    Preview.start();

    // Tombol gyro hanya relevan di perangkat yang mendukung sensor orientasi
    // (mis. iPhone). Di desktop tanpa sensor, tombol ini tetap disembunyikan.
    gyroBtn.hidden = !Preview.hasGyroSupport();
  }

  /** Bila sedang berada di mode simulasi, muat ulang tekstur (dipanggil saat frame berubah). */
  function refreshSimulationIfActive() {
    if (appEl.dataset.mode === 'simulation') enterSimulationMode();
  }

  function getLensOrientation() {
    return document.getElementById('paramLensDir').value === 'horizontal' ? 'horizontal' : 'vertical';
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

      if (appEl.dataset.mode === 'simulation') {
        Preview.setOrientation(orientation); // sumbu drag/tilt ikut berubah tanpa perlu reload tekstur
      }
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

      // 'input' event membubble ke #paramForm, jadi cukup satu listener di
      // bawah (initRangeNumberPairs -> form listener) untuk updateStatusMath.
      // Handler di sini hanya bertugas menyinkronkan nilai antar pasangan.
      rangeInput.addEventListener('input', () => {
        numberInput.value = rangeInput.value;
      });

      numberInput.addEventListener('input', () => {
        const min = parseFloat(numberInput.min);
        const max = parseFloat(numberInput.max);
        const raw = parseFloat(numberInput.value);

        if (!Number.isNaN(min) && !Number.isNaN(max) && !Number.isNaN(raw)) {
          const clamped = Utils.clamp(raw, min, max);
          rangeInput.value = String(clamped);
          // BUG FIX: sebelumnya hanya slider yang di-clamp, kotak angka
          // tetap menampilkan nilai mentah di luar batas sehingga terlihat
          // tidak sinkron dengan posisi slider. Sekarang keduanya disamakan.
          if (clamped !== raw) numberInput.value = String(clamped);
        } else if (!Number.isNaN(raw)) {
          rangeInput.value = numberInput.value;
        }
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
    document.getElementById('mStatusViewCount').textContent = String(views);
  }

  /* ============================================================ *
   * Zoom kanvas (CSS transform) & toggle grid lensa
   * Ditaruh di lingkup modul (bukan lokal ke initZoomControls) supaya
   * renderActiveFrame() (Tahap 2) bisa memicu "fit to screen" otomatis
   * begitu gambar baru selesai dimuat.
   * ============================================================ */
  let currentZoom = 1;

  function applyZoom() {
    const surface = document.getElementById('canvasSurface');
    const pct = `${Math.round(currentZoom * 100)}%`;
    surface.style.transform = `scale(${currentZoom})`;
    document.getElementById('zoomValue').textContent = pct;
    document.getElementById('statusZoom').textContent = pct;
  }

  /** Hitung skala agar seluruh kanvas pas terlihat di area canvas-scroll, lalu terapkan. */
  function zoomFitToStage() {
    const canvas = document.getElementById('mainCanvas');
    const scrollEl = document.getElementById('canvasScroll');
    if (!canvas.width || !canvas.height) {
      currentZoom = 1;
      applyZoom();
      return;
    }
    const padding = 40;
    const availW = Math.max(50, scrollEl.clientWidth - padding);
    const availH = Math.max(50, scrollEl.clientHeight - padding);
    const scale = Math.min(availW / canvas.width, availH / canvas.height, 1);
    currentZoom = Utils.clamp(Utils.roundTo(scale, 2), 0.05, 4);
    applyZoom();
  }

  function initZoomControls() {
    applyZoom();

    document.getElementById('zoomIn').addEventListener('click', () => {
      currentZoom = Utils.clamp(Utils.roundTo(currentZoom + 0.1, 2), 0.05, 4);
      applyZoom();
    });
    document.getElementById('zoomOut').addEventListener('click', () => {
      currentZoom = Utils.clamp(Utils.roundTo(currentZoom - 0.1, 2), 0.05, 4);
      applyZoom();
    });
    document.getElementById('zoomFit').addEventListener('click', zoomFitToStage);

    document.getElementById('toggleGrid').addEventListener('click', (e) => {
      const overlay = document.getElementById('lensGridOverlay');
      const active = overlay.hidden;
      overlay.hidden = !active;
      e.currentTarget.classList.toggle('is-active', active);
    });
  }

  /* ============================================================ *
   * FRAME STORE (Tahap 2 — Upload Image)
   * Menyimpan daftar gambar/view yang diupload, merender thumbnail di
   * panel kiri, menggambar frame aktif ke #mainCanvas (mode Original),
   * serta mendukung reorder via drag & drop dan penghapusan per-frame.
   * ============================================================ */
  const MAX_PREVIEW_DIM = 4000; // batas aman ukuran render preview (bukan resolusi asli)

  let frames = [];          // { id, file, name, sizeLabel, img, url, width, height }
  let activeFrameId = null;

  /** Hitung dimensi render preview (mengecilkan gambar sangat besar demi performa kanvas). */
  function computePreviewDims(w, h) {
    const scale = Math.min(1, MAX_PREVIEW_DIM / Math.max(w, h));
    return { width: Math.round(w * scale), height: Math.round(h * scale) };
  }

  function drawFrameToMainCanvas(frame) {
    const canvas = document.getElementById('mainCanvas');
    const ctx = canvas.getContext('2d');
    const { width, height } = computePreviewDims(frame.width, frame.height);
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(frame.img, 0, 0, width, height);
  }

  /** Render ulang canvas sesuai frame yang sedang aktif (atau empty state bila tidak ada). */
  function renderActiveFrame(fitToScreen) {
    const emptyState = document.getElementById('emptyState');
    const canvas = document.getElementById('mainCanvas');
    const frame = frames.find(f => f.id === activeFrameId);

    if (!frame) {
      emptyState.hidden = false;
      canvas.width = 0;
      canvas.height = 0;
      document.getElementById('statusImageDims').textContent = '—';
      document.getElementById('mStatusImageDims').textContent = '—';
      return;
    }

    emptyState.hidden = true;
    drawFrameToMainCanvas(frame);
    const dimsLabel = `${frame.width} × ${frame.height} px`;
    document.getElementById('statusImageDims').textContent = dimsLabel;
    document.getElementById('mStatusImageDims').textContent = dimsLabel;
    if (fitToScreen) requestAnimationFrame(zoomFitToStage);
  }

  /**
   * Sinkronkan field "Number of Views" agar mengikuti jumlah frame yang
   * sudah diupload (perilaku default yang wajar untuk alur interlace —
   * pengguna tetap bisa mengubahnya manual sesudahnya). Hanya berlaku bila
   * frame >= 2, karena slider Number of Views memang dibatasi minimal 2.
   */
  function syncViewCountToFrames() {
    if (frames.length < 2) return;
    const viewsInput = document.getElementById('paramViews');
    const viewsRange = document.getElementById('paramViews_range');
    const min = parseInt(viewsInput.min, 10);
    const max = parseInt(viewsInput.max, 10);
    const count = Utils.clamp(frames.length, min, max);
    viewsInput.value = String(count);
    viewsRange.value = String(count);
    updateStatusMath();
  }

  function renderFrameList() {
    const list = document.getElementById('frameList');
    const empty = document.getElementById('frameListEmpty');
    list.innerHTML = '';
    empty.hidden = frames.length > 0;

    frames.forEach((frame, index) => {
      const li = document.createElement('li');
      li.className = 'frame-item' + (frame.id === activeFrameId ? ' is-active' : '');
      li.draggable = true;
      li.dataset.frameId = frame.id;
      li.title = 'Klik untuk pratinjau · Seret untuk mengurutkan ulang';

      const img = document.createElement('img');
      img.src = frame.url;
      img.alt = frame.name;

      const meta = document.createElement('div');
      meta.className = 'frame-meta';
      const nameEl = document.createElement('div');
      nameEl.className = 'frame-name';
      nameEl.textContent = `View ${index + 1} — ${frame.name}`;
      const subEl = document.createElement('div');
      subEl.className = 'frame-sub';
      subEl.textContent = `${frame.width}×${frame.height} · ${frame.sizeLabel}`;
      meta.appendChild(nameEl);
      meta.appendChild(subEl);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'frame-remove';
      removeBtn.setAttribute('aria-label', `Hapus ${frame.name}`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFrame(frame.id);
      });

      li.appendChild(img);
      li.appendChild(meta);
      li.appendChild(removeBtn);

      li.addEventListener('click', () => {
        if (activeFrameId === frame.id) return;
        activeFrameId = frame.id;
        renderFrameList();
        renderActiveFrame(true);
      });

      // Drag & drop untuk mengurutkan ulang view (urutan = urutan sudut pandang).
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', frame.id);
        e.dataTransfer.effectAllowed = 'move';
        li.classList.add('is-dragging');
      });
      li.addEventListener('dragend', () => li.classList.remove('is-dragging'));
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        li.classList.add('drag-over');
      });
      li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('drag-over');
        const draggedId = e.dataTransfer.getData('text/plain');
        reorderFrame(draggedId, frame.id);
      });

      list.appendChild(li);
    });
  }

  function reorderFrame(fromId, toId) {
    const fromIdx = frames.findIndex(f => f.id === fromId);
    const toIdx = frames.findIndex(f => f.id === toId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const [moved] = frames.splice(fromIdx, 1);
    frames.splice(toIdx, 0, moved);
    renderFrameList();
    logHistory('Mengurutkan ulang daftar view');
    refreshSimulationIfActive();
  }

  function removeFrame(id) {
    const idx = frames.findIndex(f => f.id === id);
    if (idx === -1) return;
    const [removed] = frames.splice(idx, 1);
    URL.revokeObjectURL(removed.url);

    if (activeFrameId === id) {
      activeFrameId = frames.length ? frames[Math.min(idx, frames.length - 1)].id : null;
    }
    renderFrameList();
    renderActiveFrame();
    logHistory(`Menghapus "${removed.name}"`);
    refreshSimulationIfActive();
  }

  function clearFrames() {
    frames.forEach(f => URL.revokeObjectURL(f.url));
    frames = [];
    activeFrameId = null;
    renderFrameList();
    renderActiveFrame();
    refreshSimulationIfActive();
  }

  /** Terima FileList/array File (dari input atau drag-drop), validasi, dan tambahkan sebagai frame baru. */
  function addFrames(fileList) {
    const files = Array.from(fileList).filter(file => {
      if (!Utils.isSupportedImage(file)) {
        toast(`File "${file.name}" bukan format gambar yang didukung`, 'error');
        return false;
      }
      return true;
    });
    if (files.length === 0) return;

    const loaders = files.map(file =>
      Utils.readImageFile(file)
        .then(({ img, url }) => {
          frames.push({
            id: Utils.uid('frame'),
            file,
            name: file.name,
            sizeLabel: Utils.formatFileSize(file.size),
            img, url,
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
          return true;
        })
        .catch(() => {
          toast(`Gagal memuat gambar "${file.name}"`, 'error');
          return false;
        })
    );

    Promise.all(loaders).then(results => {
      const addedCount = results.filter(Boolean).length;
      if (addedCount === 0) return;

      if (!activeFrameId) activeFrameId = frames[frames.length - addedCount].id;

      renderFrameList();
      renderActiveFrame(true);
      syncViewCountToFrames();
      logHistory(`Menambahkan ${addedCount} gambar`);
      toast(`${addedCount} gambar berhasil ditambahkan`, 'success');
      refreshSimulationIfActive();
    });
  }

  /* ============================================================ *
   * Riwayat aktivitas
   * ============================================================ */
  let historyEntries = [];

  function logHistory(label) {
    historyEntries.unshift({ label, time: Date.now() });
    if (historyEntries.length > 50) historyEntries.length = 50;
    renderHistory();
  }

  function renderHistory() {
    const list = document.getElementById('historyList');
    const empty = document.getElementById('historyEmpty');
    list.innerHTML = '';
    empty.hidden = historyEntries.length > 0;

    historyEntries.forEach(entry => {
      const li = document.createElement('li');
      li.className = 'history-item';

      const labelEl = document.createElement('span');
      labelEl.className = 'h-label';
      labelEl.textContent = entry.label;

      const timeEl = document.createElement('span');
      timeEl.className = 'h-time';
      timeEl.textContent = Utils.formatTime(entry.time);

      li.appendChild(labelEl);
      li.appendChild(timeEl);
      list.appendChild(li);
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
   * Kontrol khusus mode Simulasi: tombol izin sensor kemiringan (gyro)
   * ============================================================ */
  function initSimulationControls() {
    document.getElementById('btnEnableGyro').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      Preview.requestGyro().then(granted => {
        if (granted) {
          toast('Sensor kemiringan aktif — miringkan perangkat untuk mengubah sudut pandang', 'success');
          btn.textContent = 'Sensor Aktif ✓';
          btn.disabled = true;
        } else {
          toast('Izin sensor kemiringan ditolak atau tidak didukung perangkat ini', 'error');
        }
      });
    });
  }

  /* ============================================================ *
   * Resize window/orientasi layar (penting untuk rotasi iPhone)
   * ============================================================ */
  function initResizeHandling() {
    const onResize = Utils.debounce(() => {
      Preview.resize();
      if (appEl.dataset.mode !== 'simulation' && frames.length) {
        zoomFitToStage();
      }
    }, 150);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
  }

  /* ============================================================ *
   * Tab bar bawah khusus mobile: berpindah antara Sumber / Kanvas / Parameter
   * ============================================================ */
  function initMobileTabbar() {
    const tabbar = document.getElementById('mobileTabbar');
    if (!tabbar) return;
    const buttons = Array.from(tabbar.querySelectorAll('.mobile-tab'));

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        appEl.dataset.mobileView = view;
        buttons.forEach(b => b.classList.toggle('is-active', b === btn));
        // Kanvas/simulasi perlu tahu ukurannya berubah begitu drawer disembunyikan/ditampilkan.
        requestAnimationFrame(() => {
          Preview.resize();
          if (appEl.dataset.mode !== 'simulation' && frames.length) zoomFitToStage();
        });
      });
    });
  }

  /* ============================================================ *
   * Dropzone: klik membuka file dialog, drag & drop memproses file
   * sungguhan (Tahap 2) melalui Frame Store di atas.
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
    single.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputSingle.click(); } });
    multi.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputMulti.click(); } });

    inputSingle.addEventListener('change', () => {
      addFrames(inputSingle.files);
      inputSingle.value = ''; // reset agar file yang sama bisa dipilih ulang nanti
    });
    inputMulti.addEventListener('change', () => {
      addFrames(inputMulti.files);
      inputMulti.value = '';
    });

    ['dragenter', 'dragover'].forEach(evt => {
      stage.addEventListener(evt, (e) => {
        e.preventDefault();
        dragOverlay.hidden = false;
      });
    });
    stage.addEventListener('dragleave', (e) => {
      e.preventDefault();
      // Hindari flicker: hanya sembunyikan bila kursor benar-benar keluar dari area stage.
      if (!stage.contains(e.relatedTarget)) dragOverlay.hidden = true;
    });
    stage.addEventListener('drop', (e) => {
      e.preventDefault();
      dragOverlay.hidden = true;
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        addFrames(e.dataTransfer.files);
      }
    });
  }

  /* ============================================================ *
   * Inisialisasi umum lain
   * ============================================================ */
  function handleNewProject() {
    if (frames.length === 0) {
      toast('Belum ada gambar untuk dihapus');
      return;
    }
    const ok = window.confirm(
      'Mulai proyek baru? Semua gambar yang sudah diupload akan dihapus dari daftar.\n\n' +
      '(Reset parameter ke default akan aktif penuh setelah Tahap 3.)'
    );
    if (!ok) return;
    clearFrames();
    logHistory('Memulai proyek baru');
    toast('Proyek baru dimulai — semua gambar dihapus', 'success');
  }

  function initMiscStubs() {
    document.getElementById('btnNewProject').addEventListener('click', handleNewProject);
    document.getElementById('btnNewProjectCompact').addEventListener('click', handleNewProject);

    document.getElementById('btnClearHistory').addEventListener('click', () => {
      historyEntries = [];
      renderHistory();
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
    initSimulationControls();
    initResizeHandling();
    initMobileTabbar();
    renderFrameList();
    renderHistory();
    updateStatusMath();

    console.info('[LenticularStudio] Tahap 2 (Upload Image) + mobile/simulasi siap. Menunggu konfirmasi untuk Tahap 3: Settings.');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
