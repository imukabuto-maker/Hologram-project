/**
 * app.js
 * ---------------------------------------------------------------------------
 * Entry point aplikasi. Ringkasan status fitur saat ini:
 *
 *   - UI generik: tema, panel kiri/kanan, tab mode, modal, toast, zoom kanvas
 *   - Upload gambar (single & multi, klik atau drag-drop), daftar view dengan
 *     thumbnail, reorder drag & drop, hapus per-frame
 *   - Settings/Preset: simpan/muat/hapus preset parameter ke localStorage
 *     (lihat settings.js untuk Settings.toParamsObject/fromParamsObject)
 *   - Interlace Engine (interlace.js): tab "Interlaced" menampilkan pratinjau
 *     interlace REALTIME (resolusi diturunkan) setiap parameter berubah;
 *     Export "PNG (Interlaced)" memakai resolusi penuh sesuai form
 *   - Simulasi lenticular interaktif (preview.js, Three.js): drag/tilt untuk
 *     mengubah sudut pandang, pinch/scroll zoom, gyroscope iOS
 *   - Wizard Kalibrasi 4 langkah, tersimpan via Storage.setCalibration
 *   - Export: Original PNG, Semua View (ZIP, dibuat manual tanpa library),
 *     PNG Interlaced
 *   - Tampilan mobile (iPhone): tab bar bawah Sumber/Kanvas/Parameter,
 *     safe-area, target sentuh diperbesar
 *
 * Fungsi yang memang sengaja belum dikerjakan (bukan bug) ditandai TODO.
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
        updateCropVisibility(); // pastikan overlay crop tersembunyi kecuali di mode Original
        updateBeforeAfterVisibility();
        if (mode !== 'interlaced' && beforeAfterActive) showBeforeAfterOriginal(false);

        if (isSim) {
          mainCanvas.hidden = true;
          emptyState.hidden = true; // simEmptyState yang mengambil alih pesan "belum ada gambar" di mode ini
          // BUG FIX: #canvasSurface dipakai bersama oleh kanvas 2D & WebGL.
          // transform:scale() dari zoom mode 2D (dihitung utk resolusi foto
          // asli, bisa sekecil ~17%) tetap menempel dan ikut mengecilkan
          // kanvas WebGL, padahal Three.js sudah punya zoom sendiri
          // (zoomFactor di preview.js) — hasilnya gambar simulasi tampak
          // kecil meski logikanya sendiri sudah benar. Reset di sini.
          document.getElementById('canvasSurface').style.transform = 'none';
          enterSimulationMode();
        } else {
          webglCanvas.hidden = true;
          Preview.stop();
          mainCanvas.hidden = false;
          applyZoom(); // terapkan ulang transform zoom 2D (mis. setelah balik dari mode Simulasi yang di-reset ke 'none')

          if (mode === 'interlaced') {
            emptyState.hidden = true; // simEmptyState yang mengambil alih pesan bila frame belum cukup
            renderInterlacedOrMessage();
          } else {
            simEmptyState.hidden = true;
            renderActiveFrame(); // pastikan mode Original menampilkan frame aktif lagi (mis. setelah dari simulasi)
          }
        }
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
      setInsufficientFramesMessage(
        'Simulasi butuh minimal 2 gambar',
        'Upload minimal 2 gambar/view dari panel kiri untuk mengaktifkan simulasi lenticular interaktif.'
      );
      return;
    }

    simEmptyState.hidden = true;
    webglCanvas.hidden = false;

    const ok = Preview.setFrames(frames);
    if (!ok) {
      setInsufficientFramesMessage(
        'Simulasi butuh minimal 2 gambar',
        'Upload minimal 2 gambar/view dari panel kiri untuk mengaktifkan simulasi lenticular interaktif.'
      );
      webglCanvas.hidden = true;
      return;
    }

    Preview.setOrientation(getLensOrientation());
    Preview.start();

    // Tombol gyro hanya relevan di perangkat yang mendukung sensor orientasi
    // (mis. iPhone). Di desktop tanpa sensor, tombol ini tetap disembunyikan.
    gyroBtn.hidden = !Preview.hasGyroSupport();
  }

  /** Setel judul+teks pesan "frame belum cukup" (elemen ini dipakai bersama oleh mode Simulasi & Interlaced). */
  function setInsufficientFramesMessage(title, body) {
    const simEmptyState = document.getElementById('simEmptyState');
    simEmptyState.querySelector('h3').textContent = title;
    simEmptyState.querySelector('p').textContent = body;
    simEmptyState.hidden = false;
  }

  /**
   * Tampilkan pratinjau interlace REALTIME di tab "Interlaced" — inilah yang
   * membuat perubahan parameter (LPI, Pitch Correction, Angle Correction,
   * Subpixel/Center Offset, Views, Start View, Reverse, Mirror, Flip) benar-
   * benar terlihat efeknya di layar, bukan cuma dipakai diam-diam saat export.
   * Dijalankan di resolusi rendah (DPI diturunkan) supaya terasa ringan.
   */
  let interlacedPreviewToken = 0; // membatalkan hasil render yang sudah usang bila parameter berubah lagi dengan cepat

  async function renderInterlacedPreview() {
    const mainCanvas = document.getElementById('mainCanvas');
    const myToken = ++interlacedPreviewToken;

    try {
      const params = collectInterlaceParamsFromForm();
      // Preview cepat: DPI diturunkan drastis (tetap proporsional) supaya realtime terasa ringan di HP.
      const previewParams = { ...params, outputDPI: Math.min(params.outputDPI, 96) };

      const resultCanvas = await Interlace.run(frames, previewParams);
      if (myToken !== interlacedPreviewToken) return; // parameter sudah berubah lagi, buang hasil basi ini

      const ctx = mainCanvas.getContext('2d');
      mainCanvas.width = resultCanvas.width;
      mainCanvas.height = resultCanvas.height;
      ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
      ctx.drawImage(resultCanvas, 0, 0);

      const dimsLabel = `${resultCanvas.width} × ${resultCanvas.height} px (pratinjau)`;
      document.getElementById('statusImageDims').textContent = dimsLabel;
      document.getElementById('mStatusImageDims').textContent = dimsLabel;
      requestAnimationFrame(() => zoomFitToStage(true));
    } catch (err) {
      console.error(err);
      toast('Gagal membuat pratinjau interlace', 'error');
    }
  }

  /** Panggil ini setiap kali masuk tab Interlaced ATAU parameter/frame berubah saat tab itu aktif. */
  function renderInterlacedOrMessage() {
    if (frames.length < 2) {
      setInsufficientFramesMessage(
        'Butuh minimal 2 gambar',
        'Upload minimal 2 gambar/view untuk melihat pratinjau hasil interlace secara realtime.'
      );
      document.getElementById('mainCanvas').width = 0;
      document.getElementById('mainCanvas').height = 0;
      return;
    }
    document.getElementById('simEmptyState').hidden = true;
    renderInterlacedPreview();
  }

  /** Bila sedang di tab Interlaced, refresh pratinjaunya (dipanggil saat parameter/frame berubah). */
  function refreshInterlacedPreviewIfActive() {
    if (appEl.dataset.mode === 'interlaced') renderInterlacedOrMessage();
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
  function applyLensOrientation(orientation) {
    const chips = Array.from(document.querySelectorAll('#lensOrientationToggle .chip'));
    const select = document.getElementById('paramLensDir');
    const gridOverlay = document.getElementById('lensGridOverlay');

    chips.forEach(c => c.classList.toggle('is-active', c.dataset.orientation === orientation));
    select.value = orientation;
    gridOverlay.classList.toggle('horizontal', orientation === 'horizontal');
    updateStatusMath();

    if (appEl.dataset.mode === 'simulation') {
      Preview.setOrientation(orientation); // sumbu drag/tilt ikut berubah tanpa perlu reload tekstur
    }
    refreshInterlacedPreviewIfActive();
  }

  function initLensOrientation() {
    const chips = Array.from(document.querySelectorAll('#lensOrientationToggle .chip'));
    const select = document.getElementById('paramLensDir');

    chips.forEach(chip => {
      chip.addEventListener('click', () => applyLensOrientation(chip.dataset.orientation));
    });
    select.addEventListener('change', () => applyLensOrientation(select.value));
  }

  /* ============================================================ *
   * Sinkronisasi generik slider <-> input angka untuk semua parameter
   * ============================================================ */
  function initRangeNumberPairs() {
    const numberInputs = Array.from(document.querySelectorAll('.input-number'));

    /** Rapikan nilai ke batas min/max saat blur — dipakai field dgn ATAU tanpa slider. */
    function clampOnBlur(numberInput, rangeInput) {
      const min = parseFloat(numberInput.min);
      const max = parseFloat(numberInput.max);
      let raw = parseFloat(numberInput.value);
      if (Number.isNaN(raw)) raw = (rangeInput && parseFloat(rangeInput.value)) || min || 0;
      const clamped = (!Number.isNaN(min) && !Number.isNaN(max)) ? Utils.clamp(raw, min, max) : raw;
      numberInput.value = String(clamped);
      if (rangeInput) rangeInput.value = String(clamped);
      updateStatusMath();
    }

    numberInputs.forEach(numberInput => {
      const rangeInput = document.getElementById(`${numberInput.id}_range`);

      if (!rangeInput) {
        // Field tanpa slider (mis. Start View, Output Width/Height, Bleed):
        // tidak ada apa pun untuk disinkronkan saat mengetik, cukup validasi saat blur.
        numberInput.addEventListener('blur', () => clampOnBlur(numberInput, null));
        return;
      }

      // 'input' event membubble ke #paramForm, jadi cukup satu listener di
      // bawah (initRangeNumberPairs -> form listener) untuk updateStatusMath.
      rangeInput.addEventListener('input', () => {
        numberInput.value = rangeInput.value;
      });

      // Saat mengetik: hanya slider yang mengikuti (feedback visual real-time).
      // Kotak angka SENGAJA tidak dipaksa berubah di sini — supaya pengguna
      // tetap bisa mengetik nilai sementara di luar batas (mis. mengetik "7"
      // dulu sebelum melanjutkan jadi "75", padahal batas minimum adalah 10).
      numberInput.addEventListener('input', () => {
        const min = parseFloat(numberInput.min);
        const max = parseFloat(numberInput.max);
        const raw = parseFloat(numberInput.value);
        if (Number.isNaN(raw)) return; // field kosong / baru mengetik "-" dsb: biarkan dulu
        const clamped = (!Number.isNaN(min) && !Number.isNaN(max)) ? Utils.clamp(raw, min, max) : raw;
        rangeInput.value = String(clamped);
      });

      // Baru dirapikan ke batas valid setelah pengguna selesai mengetik
      // (meninggalkan field), bukan di setiap ketukan tombol.
      numberInput.addEventListener('blur', () => clampOnBlur(numberInput, rangeInput));
    });

    // Field angka tanpa slider tetap perlu memicu update status (mis. views bila diketik langsung)
    document.getElementById('paramForm').addEventListener('input', updateStatusMath);
    document.getElementById('paramForm').addEventListener('input', Utils.debounce(refreshInterlacedPreviewIfActive, 250));
  }

  /**
   * Peringatan kualitas — cek dua hal yang paling sering bikin hasil cetak
   * lenticular pecah/buram tapi baru ketahuan SETELAH dicetak:
   *   1. PixelsPerView terlalu kecil (kurang dari beberapa piksel per view
   *      di dalam satu lensa) -> potensi bergaris/pecah warna.
   *   2. Resolusi asli gambar lebih kecil dari yang dibutuhkan untuk
   *      menutupi ukuran output -> gambar terpaksa diperbesar -> buram.
   * Ini hanya perkiraan/rule of thumb, bukan jaminan mutlak.
   */
  function updateQualityWarning() {
    const badge = document.getElementById('qualityWarning');
    if (frames.length < 2) { badge.hidden = true; return; }

    const dpi = parseFloat(document.getElementById('paramOutputDPI').value) || 0;
    const lpi = parseFloat(document.getElementById('paramLPI').value) || 1;
    const views = parseInt(document.getElementById('paramViews').value, 10) || 1;
    const pitchCorrection = parseFloat(document.getElementById('paramPitchCorrection').value) || 0;
    const outputWidthMm = parseFloat(document.getElementById('paramOutputWidth').value) || 100;
    const outputHeightMm = parseFloat(document.getElementById('paramOutputHeight').value) || 150;
    const bleedMm = parseFloat(document.getElementById('paramBleed').value) || 0;
    const cropOn = document.getElementById('paramCropEnabled').checked;

    const base = Utils.computeInterlaceMath({ dpi, lpi, views });
    const pixelsPerView = base.pixelsPerView * (1 + pitchCorrection / 100);

    const messages = [];
    let level = null; // null | 'warn' | 'error'

    if (pixelsPerView < 2) {
      level = 'error';
      messages.push(`PixelsPerView cuma ${Utils.roundTo(pixelsPerView, 2)}px — sangat rendah, hasil berisiko bergaris/pecah warna. Naikkan Output DPI, atau kurangi Jumlah View/LPI.`);
    } else if (pixelsPerView < 4) {
      level = 'warn';
      messages.push(`PixelsPerView ${Utils.roundTo(pixelsPerView, 2)}px — agak rendah, detail halus mungkin kurang tajam.`);
    }

    // Perkiraan resolusi sumber vs kebutuhan output (memperhitungkan crop bila aktif)
    const totalWidthMm = outputWidthMm + bleedMm * 2;
    const totalHeightMm = outputHeightMm + bleedMm * 2;
    const outW = Utils.mmToPx(totalWidthMm, dpi);
    const outH = Utils.mmToPx(totalHeightMm, dpi);

    let lowResCount = 0;
    frames.forEach(f => {
      const cw = cropOn ? cropRect.width * f.width : f.width;
      const ch = cropOn ? cropRect.height * f.height : f.height;
      const neededScale = Math.max(outW / cw, outH / ch);
      if (neededScale > 1.15) lowResCount++; // diperbesar >15% dianggap berisiko buram
    });
    if (lowResCount > 0) {
      level = 'error';
      messages.push(`${lowResCount} dari ${frames.length} gambar beresolusi lebih kecil dari kebutuhan ukuran output ini — akan diperbesar melebihi resolusi asli (berisiko buram).`);
    }

    if (!level) {
      badge.hidden = true;
      return;
    }

    badge.hidden = false;
    badge.className = `quality-badge quality-${level}`;
    badge.textContent = `⚠ ${messages.join(' ')}`;
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
    updateQualityWarning();
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

  /**
   * Hitung skala agar seluruh kanvas pas terlihat di area canvas-scroll, lalu terapkan.
   * @param {boolean} [allowUpscale=false] - true untuk kanvas pratinjau yang sengaja
   *   dibuat kecil (mis. pratinjau Interlaced dengan DPI diturunkan) sehingga BOLEH
   *   diperbesar melebihi 100%. Default false supaya foto asli (mode Original) tidak
   *   diperbesar melebihi resolusi native-nya (akan terlihat pecah/blur bila dipaksa).
   */
  function zoomFitToStage(allowUpscale) {
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
    const rawScale = Math.min(availW / canvas.width, availH / canvas.height);
    const scale = allowUpscale ? rawScale : Math.min(rawScale, 1);
    currentZoom = Utils.clamp(Utils.roundTo(scale, 2), 0.05, 8);
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

  let frames = [];          // { id, file, name, sizeLabel, img, url, width, height, offsetX, offsetY }
  let activeFrameId = null;

  // Area crop tunggal, diterapkan seragam ke semua view (koordinat relatif
  // 0..1 terhadap gambar, bukan piksel absolut — supaya tidak peduli
  // resolusi asli tiap gambar). {x,y} = pojok kiri-atas area crop.
  let cropRect = { x: 0, y: 0, width: 1, height: 1 };

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
      updateCropVisibility();
      return;
    }

    emptyState.hidden = true;
    drawFrameToMainCanvas(frame);
    const dimsLabel = `${frame.width} × ${frame.height} px`;
    document.getElementById('statusImageDims').textContent = dimsLabel;
    document.getElementById('mStatusImageDims').textContent = dimsLabel;
    updateCropVisibility();
    renderCropOverlay();
    if (fitToScreen) requestAnimationFrame(zoomFitToStage);
  }

  /* ============================================================ *
   * CROP TOOL
   * Satu area crop (cropRect, koordinat relatif 0..1) diterapkan seragam
   * ke SEMUA view saat interlace. Diedit lewat kotak overlay di kanvas
   * mode Original (drag badan kotak = pindah, drag sudut = ubah ukuran).
   * ============================================================ */

  /** Tampilkan/sembunyikan overlay crop sesuai checkbox, mode aktif, dan ada-tidaknya frame. */
  function updateCropVisibility() {
    const overlay = document.getElementById('cropOverlay');
    const hint = document.getElementById('cropHint');
    const resetBtn = document.getElementById('btnResetCrop');
    const checkbox = document.getElementById('paramCropEnabled');

    const show = checkbox.checked && appEl.dataset.mode === 'original' && frames.length > 0;
    overlay.hidden = !show;
    hint.hidden = !show;
    resetBtn.disabled = !checkbox.checked;
  }

  /** Posisikan kotak crop (#cropBox) sesuai cropRect saat ini & ukuran kanvas aktif. */
  function renderCropOverlay() {
    const box = document.getElementById('cropBox');
    const canvas = document.getElementById('mainCanvas');
    if (!canvas.width || !canvas.height) return;
    box.style.left = `${cropRect.x * canvas.width}px`;
    box.style.top = `${cropRect.y * canvas.height}px`;
    box.style.width = `${cropRect.width * canvas.width}px`;
    box.style.height = `${cropRect.height * canvas.height}px`;
  }

  function initCropTool() {
    const checkbox = document.getElementById('paramCropEnabled');
    const resetBtn = document.getElementById('btnResetCrop');
    const box = document.getElementById('cropBox');
    const CROP_MIN_SIZE = 0.05; // area crop tidak boleh lebih kecil dari 5% gambar

    checkbox.addEventListener('change', () => {
      updateCropVisibility();
      refreshInterlacedPreviewIfActive();
      updateQualityWarning();
    });

    resetBtn.addEventListener('click', () => {
      cropRect = { x: 0, y: 0, width: 1, height: 1 };
      renderCropOverlay();
      refreshInterlacedPreviewIfActive();
      updateQualityWarning();
      logHistory('Area crop direset ke gambar penuh');
      toast('Area crop direset', 'success');
    });

    let dragMode = null; // 'move' | 'nw' | 'ne' | 'sw' | 'se'
    let dragStartClient = null; // {x,y} posisi pointer client saat drag mulai
    let rectStart = null;       // salinan cropRect saat drag mulai

    function beginDrag(mode, e) {
      dragMode = mode;
      dragStartClient = { x: e.clientX, y: e.clientY };
      rectStart = { ...cropRect };
      e.preventDefault();
      e.stopPropagation();
    }

    box.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('crop-handle')) return; // biar handle yang menangani sendiri
      box.setPointerCapture(e.pointerId);
      beginDrag('move', e);
    });

    box.querySelectorAll('.crop-handle').forEach(handle => {
      handle.addEventListener('pointerdown', (e) => {
        handle.setPointerCapture(e.pointerId);
        beginDrag(handle.dataset.handle, e);
      });
    });

    document.addEventListener('pointermove', (e) => {
      if (!dragMode) return;
      const canvas = document.getElementById('mainCanvas');
      if (!canvas.width || !canvas.height) return;

      // currentZoom = skala CSS transform pada #canvasSurface. Pointer
      // bergerak di ruang layar (screen px), harus dibagi zoom dulu supaya
      // dapat delta yang benar di ruang piksel kanvas asli.
      const dxPx = (e.clientX - dragStartClient.x) / currentZoom;
      const dyPx = (e.clientY - dragStartClient.y) / currentZoom;
      const dxNorm = dxPx / canvas.width;
      const dyNorm = dyPx / canvas.height;

      if (dragMode === 'move') {
        const x = Utils.clamp(rectStart.x + dxNorm, 0, 1 - rectStart.width);
        const y = Utils.clamp(rectStart.y + dyNorm, 0, 1 - rectStart.height);
        cropRect = { ...rectStart, x, y };
      } else {
        let { x, y, width, height } = rectStart;

        if (dragMode === 'nw' || dragMode === 'sw') {
          const newX = Utils.clamp(rectStart.x + dxNorm, 0, rectStart.x + rectStart.width - CROP_MIN_SIZE);
          width = rectStart.width - (newX - rectStart.x);
          x = newX;
        }
        if (dragMode === 'ne' || dragMode === 'se') {
          width = Utils.clamp(rectStart.width + dxNorm, CROP_MIN_SIZE, 1 - rectStart.x);
        }
        if (dragMode === 'nw' || dragMode === 'ne') {
          const newY = Utils.clamp(rectStart.y + dyNorm, 0, rectStart.y + rectStart.height - CROP_MIN_SIZE);
          height = rectStart.height - (newY - rectStart.y);
          y = newY;
        }
        if (dragMode === 'sw' || dragMode === 'se') {
          height = Utils.clamp(rectStart.height + dyNorm, CROP_MIN_SIZE, 1 - rectStart.y);
        }

        cropRect = { x, y, width, height };
      }

      renderCropOverlay();
    });

    function endDrag() {
      if (!dragMode) return;
      dragMode = null;
      refreshInterlacedPreviewIfActive();
      refreshSimulationIfActive();
      updateQualityWarning();
    }
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);

    updateCropVisibility();
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

  const ALIGN_STEP = 0.01;   // 1% dari lebar/tinggi per klik
  const ALIGN_LIMIT = 0.25;  // batas maksimum pergeseran (25%), supaya konten tidak hilang dari kanvas

  /** Format label "X +2% · Y -1%" dari offset sebuah frame. */
  function formatOffsetLabel(frame) {
    const xPct = Math.round(frame.offsetX * 100);
    const yPct = Math.round(frame.offsetY * 100);
    return `X ${xPct >= 0 ? '+' : ''}${xPct}% · Y ${yPct >= 0 ? '+' : ''}${yPct}%`;
  }

  /** Geser posisi alignment sebuah frame, lalu refresh pratinjau yang relevan. */
  function nudgeFrameOffset(frame, dx, dy) {
    frame.offsetX = Utils.clamp(Utils.roundTo(frame.offsetX + dx, 3), -ALIGN_LIMIT, ALIGN_LIMIT);
    frame.offsetY = Utils.clamp(Utils.roundTo(frame.offsetY + dy, 3), -ALIGN_LIMIT, ALIGN_LIMIT);
    logHistory(`Menyesuaikan posisi "${frame.name}"`);
    refreshInterlacedPreviewIfActive();
    refreshSimulationIfActive();
  }

  /** Reset posisi alignment sebuah frame ke tengah (0,0). */
  function resetFrameOffset(frame) {
    frame.offsetX = 0;
    frame.offsetY = 0;
    logHistory(`Reset posisi "${frame.name}"`);
    refreshInterlacedPreviewIfActive();
    refreshSimulationIfActive();
  }

  /** Bangun panel nudge posisi (alignment) untuk satu frame — dipakai di dalam frame-item (desktop). */
  function buildAlignPanel(frame) {
    const panel = document.createElement('div');
    panel.className = 'frame-align-panel';

    const valueEl = document.createElement('span');
    valueEl.className = 'frame-align-value';
    const updateValueLabel = () => { valueEl.textContent = formatOffsetLabel(frame); };
    updateValueLabel();

    function makeBtn(label, dx, dy, cls) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `align-btn ${cls}`;
      b.innerHTML = label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        nudgeFrameOffset(frame, dx, dy);
        updateValueLabel();
      });
      return b;
    }

    const btnUp = makeBtn('&uarr;', 0, -ALIGN_STEP, 'align-up');
    const btnDown = makeBtn('&darr;', 0, ALIGN_STEP, 'align-down');
    const btnLeft = makeBtn('&larr;', -ALIGN_STEP, 0, 'align-left');
    const btnRight = makeBtn('&rarr;', ALIGN_STEP, 0, 'align-right');

    const btnReset = document.createElement('button');
    btnReset.type = 'button';
    btnReset.className = 'align-btn align-reset';
    btnReset.innerHTML = '&#8635;';
    btnReset.title = 'Reset posisi view ini';
    btnReset.addEventListener('click', (e) => {
      e.stopPropagation();
      resetFrameOffset(frame);
      updateValueLabel();
    });

    panel.appendChild(btnUp);
    panel.appendChild(btnLeft);
    panel.appendChild(btnReset);
    panel.appendChild(btnRight);
    panel.appendChild(btnDown);
    panel.appendChild(valueEl);

    return panel;
  }

  /* ============================================================ *
   * FRAME BROWSER (mobile) — navigasi kiri/kanan pengganti daftar
   * thumbnail. Menampilkan SATU view (mengikuti activeFrameId, sumber
   * kebenaran yang sama dipakai panel Original) + kontrol alignment
   * langsung di bawahnya, memakai fungsi nudge/reset yang sama dengan
   * panel desktop di atas.
   * ============================================================ */
  function renderFrameBrowser() {
    const browser = document.getElementById('frameBrowser');
    if (!browser) return;

    if (frames.length === 0) {
      browser.hidden = true;
      return;
    }

    let idx = frames.findIndex(f => f.id === activeFrameId);
    if (idx === -1) { idx = 0; activeFrameId = frames[0].id; }
    const frame = frames[idx];

    browser.hidden = false;
    document.getElementById('frameBrowserLabel').textContent = `View ${idx + 1} / ${frames.length}`;
    document.getElementById('frameBrowserSub').textContent = `${frame.width}×${frame.height} · ${frame.sizeLabel}`;
    document.getElementById('frameBrowserAlignValue').textContent = formatOffsetLabel(frame);
    document.getElementById('frameBrowserPrev').disabled = idx === 0;
    document.getElementById('frameBrowserNext').disabled = idx === frames.length - 1;
  }

  /** Pindah frame aktif ke index tertentu (dipanggil oleh tombol prev/next). */
  function browseToFrameIndex(idx) {
    if (frames.length === 0) return;
    const clamped = Utils.clamp(idx, 0, frames.length - 1);
    const frame = frames[clamped];
    if (!frame || activeFrameId === frame.id) return;
    activeFrameId = frame.id;
    renderFrameBrowser();
    refreshCurrentModeView(true);
  }

  function initFrameBrowser() {
    document.getElementById('frameBrowserPrev').addEventListener('click', () => {
      const idx = frames.findIndex(f => f.id === activeFrameId);
      browseToFrameIndex(idx - 1);
    });
    document.getElementById('frameBrowserNext').addEventListener('click', () => {
      const idx = frames.findIndex(f => f.id === activeFrameId);
      browseToFrameIndex(idx + 1);
    });
    document.getElementById('frameBrowserRemove').addEventListener('click', () => {
      if (activeFrameId) removeFrame(activeFrameId);
    });

    const dirMap = {
      up: [0, -ALIGN_STEP], down: [0, ALIGN_STEP],
      left: [-ALIGN_STEP, 0], right: [ALIGN_STEP, 0],
    };
    document.querySelectorAll('.frame-browser-align [data-fb-dir]').forEach(btn => {
      btn.addEventListener('click', () => {
        const frame = frames.find(f => f.id === activeFrameId);
        if (!frame) return;
        const dir = btn.dataset.fbDir;
        if (dir === 'reset') resetFrameOffset(frame);
        else {
          const [dx, dy] = dirMap[dir];
          nudgeFrameOffset(frame, dx, dy);
        }
        renderFrameBrowser();
      });
    });
  }

  function renderFrameList() {
    const list = document.getElementById('frameList');
    const empty = document.getElementById('frameListEmpty');
    list.innerHTML = '';
    empty.hidden = frames.length > 0;
    updateExportButtonsState();
    updateQualityWarning();
    updateBeforeAfterVisibility();
    renderFrameBrowser();

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

      const alignBtn = document.createElement('button');
      alignBtn.type = 'button';
      alignBtn.className = 'frame-align-btn';
      alignBtn.setAttribute('aria-label', `Sesuaikan posisi ${frame.name}`);
      alignBtn.title = 'Sesuaikan posisi (alignment) — untuk view yang tidak sejajar dengan view lain';
      // Ikon crosshair digambar via CSS (::before/::after di style.css) —
      // sengaja tidak pakai SVG manual supaya dijamin selalu tampil benar.
      alignBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        li.classList.toggle('is-aligning');
      });

      const actions = document.createElement('div');
      actions.className = 'frame-actions';
      actions.appendChild(alignBtn);
      actions.appendChild(removeBtn);

      li.appendChild(img);
      li.appendChild(meta);
      li.appendChild(actions);
      li.appendChild(buildAlignPanel(frame));

      li.addEventListener('click', () => {
        if (activeFrameId === frame.id) return;
        activeFrameId = frame.id;
        renderFrameList();
        refreshCurrentModeView(true);
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
    refreshCurrentModeView();
  }

  /**
   * Refresh tampilan sesuai TAB MODE yang sedang aktif — bukan selalu
   * renderActiveFrame(). BUG FIX: sebelumnya menambah/hapus/klik frame
   * selalu memanggil renderActiveFrame() (mode Original) apa adanya, tanpa
   * peduli user sedang berada di tab Interlaced — akibatnya gambar mentah
   * sempat "berkedip" menimpa hasil interlace sebelum ditimpa lagi oleh
   * refreshInterlacedPreviewIfActive(), plus zoom-fit terpanggil dua kali
   * dengan aturan upscale yang berbeda (jadi terasa "lompat").
   */
  function refreshCurrentModeView(fitToScreen) {
    const mode = appEl.dataset.mode;
    if (mode === 'simulation') {
      refreshSimulationIfActive();
    } else if (mode === 'interlaced') {
      refreshInterlacedPreviewIfActive();
    } else {
      renderActiveFrame(fitToScreen);
    }
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
    logHistory(`Menghapus "${removed.name}"`);
    refreshCurrentModeView();
  }

  function clearFrames() {
    frames.forEach(f => URL.revokeObjectURL(f.url));
    frames = [];
    activeFrameId = null;
    renderFrameList();
    refreshCurrentModeView();
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
            offsetX: 0, // pergeseran alignment (fraksi lebar, -0.25..0.25)
            offsetY: 0, // pergeseran alignment (fraksi tinggi, -0.25..0.25)
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
      syncViewCountToFrames();
      logHistory(`Menambahkan ${addedCount} gambar`);
      toast(`${addedCount} gambar berhasil ditambahkan`, 'success');
      refreshCurrentModeView(true);
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
   * EXPORT
   * Ketiga tombol export sudah berfungsi penuh. "Export PNG (Interlaced)"
   * otomatis nonaktif (disabled) hanya bila frame belum cukup (<2 gambar),
   * karena Interlace.run() butuh minimal 2 view untuk menginterlace.
   * ============================================================ */
  function updateExportButtonsState() {
    const hasFrames = frames.length > 0;
    const hasEnoughForInterlace = frames.length >= 2;

    document.getElementById('btnExportOriginal').disabled = !hasFrames;
    document.getElementById('btnExportViewsZip').disabled = !hasFrames;

    const interlaceBtn = document.getElementById('btnExportPNG');
    const hint = document.getElementById('exportInterlacedHint');
    interlaceBtn.disabled = !hasEnoughForInterlace;
    interlaceBtn.title = hasEnoughForInterlace ? '' : 'Upload minimal 2 gambar/view untuk mengaktifkan';
    hint.textContent = hasEnoughForInterlace
      ? 'Hasil sudah di-interlace sesuai parameter Lensa, Kalibrasi & Urutan View di panel kanan.'
      : 'Upload minimal 2 gambar/view untuk mengaktifkan export interlaced.';
  }

  /** Gambar ulang satu frame ke kanvas sementara pada RESOLUSI ASLI (bukan versi preview yang di-downscale). */
  function renderFrameAtFullResolution(frame) {
    const c = document.createElement('canvas');
    c.width = frame.width;
    c.height = frame.height;
    c.getContext('2d').drawImage(frame.img, 0, 0, frame.width, frame.height);
    return c;
  }

  async function exportActiveFrameAsPNG() {
    const frame = frames.find(f => f.id === activeFrameId) || frames[0];
    if (!frame) {
      toast('Belum ada gambar untuk diexport', 'error');
      return;
    }

    const btn = document.getElementById('btnExportOriginal');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Mengekspor…';

    try {
      const fullCanvas = renderFrameAtFullResolution(frame);
      const blob = await Utils.canvasToBlob(fullCanvas, 'image/png');
      const safeName = frame.name.replace(/\.[^.]+$/, '') || 'gambar';
      Utils.downloadBlob(blob, `${safeName}-original.png`);
      logHistory(`Export Original PNG: ${frame.name}`);
      toast('PNG berhasil diunduh', 'success');
    } catch (err) {
      console.error(err);
      toast('Gagal mengekspor PNG', 'error');
    } finally {
      btn.textContent = originalLabel;
      updateExportButtonsState();
    }
  }

  async function exportAllViewsZip() {
    if (frames.length === 0) {
      toast('Belum ada gambar untuk diexport', 'error');
      return;
    }

    const btn = document.getElementById('btnExportViewsZip');
    const originalLabel = btn.textContent;
    btn.disabled = true;

    try {
      const entries = [];
      for (let i = 0; i < frames.length; i++) {
        btn.textContent = `Menyiapkan ${i + 1}/${frames.length}…`;
        const frame = frames[i];
        const fullCanvas = renderFrameAtFullResolution(frame);
        const blob = await Utils.canvasToBlob(fullCanvas, 'image/png');
        entries.push({ name: `view-${String(i + 1).padStart(2, '0')}.png`, blob });
      }
      const zipBlob = await Utils.createZip(entries);
      Utils.downloadBlob(zipBlob, 'lenticular-views.zip');
      logHistory(`Export ${entries.length} view sebagai ZIP`);
      toast(`ZIP berisi ${entries.length} gambar berhasil diunduh`, 'success');
    } catch (err) {
      console.error(err);
      toast('Gagal membuat file ZIP', 'error');
    } finally {
      btn.textContent = originalLabel;
      updateExportButtonsState();
    }
  }

  function initExportControls() {
    document.getElementById('btnExportOriginal').addEventListener('click', exportActiveFrameAsPNG);
    document.getElementById('btnExportViewsZip').addEventListener('click', exportAllViewsZip);
    document.getElementById('btnExportPNG').addEventListener('click', exportInterlacedPNG);
  }

  /** Kumpulkan seluruh parameter dari form panel kanan menjadi satu objek untuk Interlace.run(). */
  function collectInterlaceParamsFromForm() {
    return {
      lpi: parseFloat(document.getElementById('paramLPI').value) || 60,
      outputDPI: parseFloat(document.getElementById('paramOutputDPI').value) || 300,
      numberOfViews: parseInt(document.getElementById('paramViews').value, 10) || frames.length,
      lensDirection: document.getElementById('paramLensDir').value,
      pitchCorrectionPercent: parseFloat(document.getElementById('paramPitchCorrection').value) || 0,
      angleCorrectionDeg: parseFloat(document.getElementById('paramAngleCorrection').value) || 0,
      subpixelOffsetPx: parseFloat(document.getElementById('paramSubpixelOffset').value) || 0,
      centerOffsetPx: parseFloat(document.getElementById('paramCenterOffset').value) || 0,
      startView: parseInt(document.getElementById('paramStartView').value, 10) || 1,
      reverseView: document.getElementById('paramReverseView').checked,
      mirror: document.getElementById('paramMirror').checked,
      flip: document.getElementById('paramFlip').checked,
      outputWidthMm: parseFloat(document.getElementById('paramOutputWidth').value) || 100,
      outputHeightMm: parseFloat(document.getElementById('paramOutputHeight').value) || 150,
      bleedMm: parseFloat(document.getElementById('paramBleed').value) || 0,
      cropEnabled: document.getElementById('paramCropEnabled').checked,
      cropRect: { ...cropRect },
    };
  }

  async function exportInterlacedPNG() {
    if (frames.length < 2) {
      toast('Upload minimal 2 gambar/view untuk export interlaced', 'error');
      return;
    }

    const btn = document.getElementById('btnExportPNG');
    const originalLabel = btn.textContent;
    btn.disabled = true;

    try {
      const params = collectInterlaceParamsFromForm();
      btn.textContent = 'Meng-interlace… 0%';

      const resultCanvas = await Interlace.run(frames, params, (pct) => {
        btn.textContent = `Meng-interlace… ${pct}%`;
      });

      btn.textContent = 'Menyiapkan file…';
      let blob = await Utils.canvasToBlob(resultCanvas, 'image/png');
      blob = await Utils.addPngPhysicalDpi(blob, params.outputDPI); // sisipkan info DPI fisik ke file PNG
      Utils.downloadBlob(blob, 'lenticular-interlaced.png');

      logHistory(`Export Interlaced PNG (${params.numberOfViews} view, ${resultCanvas.width}×${resultCanvas.height}px)`);
      toast('PNG hasil interlace berhasil diunduh', 'success');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Gagal membuat interlace', 'error');
    } finally {
      btn.textContent = originalLabel;
      updateExportButtonsState();
    }
  }

  /* ============================================================ *
   * Modal: Kalibrasi & Simpan Preset
   * ============================================================ */
  function initModals() {
    bindModal('modalCalibration', 'btnCalibration', 'closeCalibrationModal');
    document.getElementById('btnOpenCalibrationWizard').addEventListener('click', () => {
      wizardStep = 1;
      openModal('modalCalibration');
      renderWizardStep();
    });

    bindModal('modalSavePreset', 'btnSavePreset', 'closeSavePresetModal');
    document.getElementById('cancelSavePreset').addEventListener('click', () => closeModal('modalSavePreset'));
    document.getElementById('confirmSavePreset').addEventListener('click', () => {
      const name = document.getElementById('presetNameInput').value.trim();
      if (!name) {
        toast('Nama preset tidak boleh kosong', 'error');
        return;
      }

      const existing = Storage.listPresets();
      if (existing[name]) {
        const overwrite = window.confirm(`Preset "${name}" sudah ada. Timpa dengan pengaturan saat ini?`);
        if (!overwrite) return;
      }

      const values = Settings.toParamsObject();
      values.cropRect = { ...cropRect };
      Storage.savePreset(name, values);
      refreshPresetDropdown(name);
      logHistory(`Preset "${name}" disimpan`);
      toast(`Preset "${name}" berhasil disimpan`, 'success');
      document.getElementById('presetNameInput').value = '';
      closeModal('modalSavePreset');
    });

    document.getElementById('wizardNext').addEventListener('click', handleWizardNext);
    document.getElementById('wizardBack').addEventListener('click', handleWizardBack);
  }

  /* ============================================================ *
   * WIZARD KALIBRASI
   * 4 langkah: (1) generate strip uji cetak, (2) input strip yang paling
   * tajam menurut pengguna, (3) hitung Pitch Correction dari pilihan itu,
   * (4) terapkan ke parameter & simpan ke Storage untuk dipakai lagi nanti.
   * ============================================================ */
  const WIZARD_STRIP_COUNT = 11;   // ganjil, supaya ada titik tengah (0% koreksi)
  const WIZARD_STEP_PERCENT = 0.5; // besar langkah koreksi antar-strip (%)

  let wizardStep = 1;
  let wizardSelectedStrip = Math.ceil(WIZARD_STRIP_COUNT / 2); // default: strip tengah (0%)
  let wizardComputedCorrection = 0;

  function wizardCorrectionForStrip(stripNumber) {
    const centerIdx = (WIZARD_STRIP_COUNT - 1) / 2;
    return Utils.roundTo((stripNumber - 1 - centerIdx) * WIZARD_STEP_PERCENT, 2);
  }

  /** Gambar pola uji: beberapa "strip" garis halus dengan pitch sedikit berbeda per strip. */
  function drawCalibrationStrip(canvas) {
    const lensPitchMm = parseFloat(document.getElementById('paramLensPitch').value) || 0.635;
    const dpi = parseFloat(document.getElementById('paramOutputDPI').value) || 300;

    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const labelH = 32;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    const bandWidth = w / WIZARD_STRIP_COUNT;

    for (let i = 0; i < WIZARD_STRIP_COUNT; i++) {
      const correctionPct = wizardCorrectionForStrip(i + 1);
      const correctedPitchMm = Utils.applyPitchCorrection(lensPitchMm, correctionPct);
      const pitchPx = Math.max(2, Utils.mmToPx(correctedPitchMm, dpi));
      const bandX = i * bandWidth;

      ctx.save();
      ctx.beginPath();
      ctx.rect(bandX, 0, bandWidth, h - labelH);
      ctx.clip();
      ctx.strokeStyle = '#14161c';
      ctx.lineWidth = Math.max(1, pitchPx * 0.22);
      for (let x = bandX; x < bandX + bandWidth; x += pitchPx) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h - labelH);
        ctx.stroke();
      }
      ctx.restore();

      const isCenter = (i + 1) === Math.ceil(WIZARD_STRIP_COUNT / 2);
      ctx.fillStyle = isCenter ? '#38d0d6' : '#3a3f4c';
      ctx.fillRect(bandX, h - labelH, bandWidth - 1, labelH);

      ctx.fillStyle = isCenter ? '#0d0f13' : '#e8eaef';
      ctx.textAlign = 'center';
      ctx.font = 'bold 13px "IBM Plex Mono", monospace';
      ctx.fillText(String(i + 1), bandX + bandWidth / 2, h - 17);
      ctx.font = '9px "IBM Plex Mono", monospace';
      ctx.fillText(`${correctionPct >= 0 ? '+' : ''}${correctionPct.toFixed(1)}%`, bandX + bandWidth / 2, h - 5);
    }
  }

  function renderWizardStep() {
    document.querySelectorAll('#wizardSteps li').forEach(li => {
      li.classList.toggle('is-active', Number(li.dataset.step) === wizardStep);
    });
    document.getElementById('wizardBack').disabled = wizardStep === 1;
    document.getElementById('wizardNext').textContent = wizardStep === 4 ? 'Terapkan & Simpan' : 'Lanjut →';

    const panel = document.getElementById('wizardPanel');
    panel.innerHTML = '';

    if (wizardStep === 1) panel.appendChild(buildWizardStep1());
    else if (wizardStep === 2) panel.appendChild(buildWizardStep2());
    else if (wizardStep === 3) panel.appendChild(buildWizardStep3());
    else panel.appendChild(buildWizardStep4());
  }

  function buildWizardStep1() {
    const wrap = document.createElement('div');

    const info = document.createElement('p');
    info.className = 'empty-hint';
    info.style.textAlign = 'left';
    info.textContent = 'Cetak pola di bawah ini pada printer & bahan yang sama dengan proyek lenticular Anda, lalu tempelkan lembar lensa lenticular fisik di atasnya. Perhatikan strip nomor berapa yang garisnya terlihat paling tajam/hitam pekat (bukan buram/pudar).';

    const canvas = document.createElement('canvas');
    canvas.width = 860;
    canvas.height = 200;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.borderRadius = '6px';
    canvas.style.border = '1px solid var(--border-subtle)';
    drawCalibrationStrip(canvas);

    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';
    const btnDownload = document.createElement('button');
    btnDownload.type = 'button';
    btnDownload.className = 'btn btn-secondary';
    btnDownload.textContent = 'Unduh Strip (PNG)';
    btnDownload.addEventListener('click', () => {
      canvas.toBlob(blob => Utils.downloadBlob(blob, 'kalibrasi-strip-lenticular.png'));
    });
    btnRow.appendChild(btnDownload);

    wrap.appendChild(info);
    wrap.appendChild(canvas);
    wrap.appendChild(btnRow);
    return wrap;
  }

  function buildWizardStep2() {
    const wrap = document.createElement('div');

    const info = document.createElement('p');
    info.className = 'empty-hint';
    info.style.textAlign = 'left';
    info.textContent = 'Masukkan nomor strip yang tadi terlihat paling tajam di bawah lensa lenticular fisik Anda.';

    const row = document.createElement('div');
    row.className = 'field-row';
    const label = document.createElement('label');
    label.setAttribute('for', 'wizardStripInput');
    label.textContent = `Nomor strip paling tajam (1–${WIZARD_STRIP_COUNT})`;
    const input = document.createElement('input');
    input.type = 'number';
    input.id = 'wizardStripInput';
    input.className = 'input-number';
    input.style.width = '100%';
    input.min = '1';
    input.max = String(WIZARD_STRIP_COUNT);
    input.step = '1';
    input.value = String(wizardSelectedStrip);

    const preview = document.createElement('p');
    preview.className = 'empty-hint';
    preview.style.textAlign = 'left';
    const updatePreview = () => {
      const v = Utils.clamp(parseInt(input.value, 10) || wizardSelectedStrip, 1, WIZARD_STRIP_COUNT);
      preview.textContent = `≈ Pitch Correction ${wizardCorrectionForStrip(v) >= 0 ? '+' : ''}${wizardCorrectionForStrip(v)}%`;
    };
    input.addEventListener('input', updatePreview);
    updatePreview();

    row.appendChild(label);
    row.appendChild(input);
    wrap.appendChild(info);
    wrap.appendChild(row);
    wrap.appendChild(preview);
    return wrap;
  }

  function buildWizardStep3() {
    // Ambil nilai dari step 2 sebelum menampilkan hasil hitung.
    const input = document.getElementById('wizardStripInput');
    if (input) {
      wizardSelectedStrip = Utils.clamp(parseInt(input.value, 10) || wizardSelectedStrip, 1, WIZARD_STRIP_COUNT);
    }
    wizardComputedCorrection = wizardCorrectionForStrip(wizardSelectedStrip);

    const lensPitchMm = parseFloat(document.getElementById('paramLensPitch').value) || 0.635;
    const correctedPitch = Utils.applyPitchCorrection(lensPitchMm, wizardComputedCorrection);

    const wrap = document.createElement('div');
    const info = document.createElement('p');
    info.className = 'empty-hint';
    info.style.textAlign = 'left';
    info.textContent = `Berdasarkan strip #${wizardSelectedStrip} yang dipilih:`;

    const table = document.createElement('div');
    table.style.display = 'flex';
    table.style.flexDirection = 'column';
    table.style.gap = '8px';

    const rows = [
      ['Pitch Correction', `${wizardComputedCorrection >= 0 ? '+' : ''}${wizardComputedCorrection}%`],
      ['Lens Pitch semula', `${Utils.roundTo(lensPitchMm, 3)} mm`],
      ['Lens Pitch terkoreksi', `${Utils.roundTo(correctedPitch, 3)} mm`],
    ];
    rows.forEach(([k, v]) => {
      const r = document.createElement('div');
      r.className = 'field-row toggle-row';
      const kEl = document.createElement('span');
      kEl.textContent = k;
      kEl.style.color = 'var(--text-secondary)';
      const vEl = document.createElement('span');
      vEl.textContent = v;
      vEl.style.fontFamily = 'var(--font-mono)';
      vEl.style.color = 'var(--accent-cyan)';
      r.appendChild(kEl);
      r.appendChild(vEl);
      table.appendChild(r);
    });

    wrap.appendChild(info);
    wrap.appendChild(table);
    return wrap;
  }

  function buildWizardStep4() {
    const wrap = document.createElement('div');
    const info = document.createElement('p');
    info.className = 'empty-hint';
    info.style.textAlign = 'left';
    info.textContent = `Klik "Terapkan & Simpan" untuk mengisi Pitch Correction (${wizardComputedCorrection >= 0 ? '+' : ''}${wizardComputedCorrection}%) ke parameter, dan menyimpan kalibrasi ini agar bisa dipakai lagi di sesi berikutnya.`;
    wrap.appendChild(info);
    return wrap;
  }

  function handleWizardNext() {
    if (wizardStep < 4) {
      wizardStep++;
      renderWizardStep();
      return;
    }
    // Step 4: terapkan hasil & simpan
    const pcInput = document.getElementById('paramPitchCorrection');
    const pcRange = document.getElementById('paramPitchCorrection_range');
    const clamped = Utils.clamp(wizardComputedCorrection, parseFloat(pcInput.min), parseFloat(pcInput.max));
    pcInput.value = String(clamped);
    pcRange.value = String(clamped);
    updateStatusMath();

    const lensPitchMm = parseFloat(document.getElementById('paramLensPitch').value) || 0.635;
    Storage.setCalibration({ lensPitchMm, pitchCorrectionPercent: clamped, savedAt: Date.now() });

    logHistory(`Kalibrasi disimpan (Pitch Correction ${clamped >= 0 ? '+' : ''}${clamped}%)`);
    toast('Kalibrasi diterapkan ke Pitch Correction & disimpan', 'success');

    closeModal('modalCalibration');
    wizardStep = 1;
  }

  function handleWizardBack() {
    if (wizardStep === 1) return;
    wizardStep--;
    renderWizardStep();
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
        zoomFitToStage(appEl.dataset.mode === 'interlaced');
      }
    }, 150);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
  }

  /* ============================================================ *
   * MOBILE: gesture di kanvas (pinch-zoom mode 2D, double-tap = fit,
   * long-press = before/after) — kanvas sekarang STICKY di halaman yang
   * discroll biasa (bukan lagi drawer mengambang).
   * ============================================================ */

  /** Tampilkan/sembunyikan tombol Before/After — hanya relevan di tab
   *  Interlaced (membandingkan hasil interlace vs gambar asli). */
  function updateBeforeAfterVisibility() {
    const btn = document.getElementById('btnBeforeAfter');
    if (!btn) return;
    btn.hidden = !(appEl.dataset.mode === 'interlaced' && frames.length >= 2);
  }

  let beforeAfterActive = false;
  function showBeforeAfterOriginal(show) {
    const badge = document.getElementById('beforeAfterBadge');
    const btn = document.getElementById('btnBeforeAfter');
    if (show === beforeAfterActive) return;
    beforeAfterActive = show;
    badge.hidden = !show;
    btn.classList.toggle('is-active', show);

    if (show) {
      const frame = frames.find(f => f.id === activeFrameId) || frames[0];
      if (frame) drawFrameToMainCanvas(frame);
    } else if (appEl.dataset.mode === 'interlaced') {
      renderInterlacedOrMessage();
    }
  }

  function initBeforeAfterButton() {
    document.getElementById('btnBeforeAfter').addEventListener('click', () => {
      showBeforeAfterOriginal(!beforeAfterActive);
    });
  }

  /** Gesture di area kanvas: pinch-zoom (mode 2D), double-tap = fit, long-press = before/after. */
  function initCanvasGestures() {
    const stage = document.getElementById('canvasStage');
    const activePointers = new Map();
    let longPressTimer = null;
    let longPressTriggered = false;
    let singleStart = null;
    let pinchStartDist = null;
    let pinchStartZoom = null;
    let lastTapTime = 0;
    let lastTapPos = null;

    function clearLongPress() {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }

    stage.addEventListener('pointerdown', (e) => {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 1) {
        singleStart = { x: e.clientX, y: e.clientY };
        if (appEl.dataset.mode === 'interlaced') {
          clearLongPress();
          longPressTriggered = false;
          longPressTimer = setTimeout(() => {
            longPressTriggered = true;
            showBeforeAfterOriginal(true);
          }, 450);
        }
      } else if (activePointers.size === 2) {
        clearLongPress(); // 2 jari = niat pinch, bukan long-press
        if (longPressTriggered) { showBeforeAfterOriginal(false); longPressTriggered = false; }
        if (appEl.dataset.mode !== 'simulation') {
          const pts = Array.from(activePointers.values());
          pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          pinchStartZoom = currentZoom;
        }
      }
    });

    stage.addEventListener('pointermove', (e) => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 1 && singleStart && !longPressTriggered) {
        const dist = Math.hypot(e.clientX - singleStart.x, e.clientY - singleStart.y);
        if (dist > 12) clearLongPress(); // gerak terlalu jauh, batalkan niat long-press (mungkin scroll/pan)
      } else if (activePointers.size === 2 && pinchStartDist && appEl.dataset.mode !== 'simulation') {
        const pts = Array.from(activePointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        currentZoom = Utils.clamp(Utils.roundTo(pinchStartZoom * (dist / pinchStartDist), 2), 0.05, 8);
        applyZoom();
      }
    });

    function endPointer(e) {
      activePointers.delete(e.pointerId);
      clearLongPress();

      if (longPressTriggered) {
        showBeforeAfterOriginal(false);
        longPressTriggered = false;
        singleStart = null;
        return; // jangan dihitung sebagai tap setelah long-press
      }
      if (activePointers.size < 2) { pinchStartDist = null; pinchStartZoom = null; }

      if (activePointers.size === 0 && singleStart) {
        const now = Date.now();
        if (lastTapPos && now - lastTapTime < 300 && Math.hypot(e.clientX - lastTapPos.x, e.clientY - lastTapPos.y) < 30) {
          if (appEl.dataset.mode !== 'simulation' && frames.length) {
            zoomFitToStage(appEl.dataset.mode === 'interlaced');
          }
          lastTapTime = 0; lastTapPos = null;
        } else {
          lastTapTime = now;
          lastTapPos = { x: e.clientX, y: e.clientY };
        }
        singleStart = null;
      }
    }
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
  }

  /**
   * Swipe gesture untuk buka/tutup drawer & bottom sheet. Dibuka lewat
   * SWIPE DARI TEPI LAYAR (bukan swipe di mana saja) — supaya tidak
   * bentrok dengan gesture lain di kanvas (pinch-zoom, pan, drag crop/
   * alignment). Menutup drawer yang sedang terbuka bisa dari mana saja
   * di dalam drawer itu sendiri (swipe ke arah "keluar" atau swipe turun).
   */
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
      'Mulai proyek baru? Semua gambar akan dihapus dan parameter akan kembali ke nilai default.'
    );
    if (!ok) return;
    clearFrames();
    Settings.resetToDefaults();
    cropRect = { x: 0, y: 0, width: 1, height: 1 };
    updateCropVisibility();
    applyLensOrientation(Settings.DEFAULTS.lensDirection); // sinkronkan chip & grid overlay juga
    updateStatusMath();
    refreshInterlacedPreviewIfActive();
    logHistory('Memulai proyek baru (parameter direset ke default)');
    toast('Proyek baru dimulai — gambar dihapus & parameter direset', 'success');
  }

  function initMiscStubs() {
    document.getElementById('btnNewProject').addEventListener('click', handleNewProject);
    document.getElementById('btnNewProjectCompact').addEventListener('click', handleNewProject);

    document.getElementById('btnClearHistory').addEventListener('click', () => {
      historyEntries = [];
      renderHistory();
    });

    document.getElementById('btnLoadPreset').addEventListener('click', () => {
      const select = document.getElementById('presetSelect');
      const name = select.value;
      if (!name) {
        toast('Pilih preset yang ingin dimuat terlebih dahulu', 'error');
        return;
      }
      const values = Storage.loadPreset(name);
      if (!values) {
        toast(`Preset "${name}" tidak ditemukan`, 'error');
        return;
      }

      Settings.fromParamsObject(values);
      cropRect = values.cropRect
        ? { ...values.cropRect }
        : { x: 0, y: 0, width: 1, height: 1 }; // preset lama (sebelum fitur crop ada) -> default penuh
      updateCropVisibility();
      renderCropOverlay();
      applyLensOrientation(values.lensDirection || Settings.DEFAULTS.lensDirection); // sinkronkan chip & grid overlay
      updateStatusMath();
      refreshSimulationIfActive();
      refreshInterlacedPreviewIfActive();
      logHistory(`Preset "${name}" dimuat`);
      toast(`Preset "${name}" diterapkan`, 'success');
    });

    document.getElementById('btnDeletePreset').addEventListener('click', () => {
      const select = document.getElementById('presetSelect');
      const name = select.value;
      if (!name) {
        toast('Pilih preset yang ingin dihapus terlebih dahulu', 'error');
        return;
      }
      const ok = window.confirm(`Hapus preset "${name}"? Tindakan ini tidak bisa dibatalkan.`);
      if (!ok) return;

      Storage.deletePreset(name);
      refreshPresetDropdown();
      logHistory(`Preset "${name}" dihapus`);
      toast(`Preset "${name}" dihapus`, 'success');
    });
  }

  /** Isi ulang dropdown #presetSelect dari daftar preset tersimpan di Storage. */
  function refreshPresetDropdown(selectName) {
    const select = document.getElementById('presetSelect');
    const names = Object.keys(Storage.listPresets());
    select.innerHTML = '';

    if (names.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— Belum ada preset —';
      select.appendChild(opt);
      return;
    }

    names.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });

    if (selectName && names.includes(selectName)) select.value = selectName;
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
    initCropTool();
    initModals();
    initDropzones();
    initMiscStubs();
    initSimulationControls();
    initExportControls();
    initResizeHandling();
    initCanvasGestures();
    initBeforeAfterButton();
    initFrameBrowser();
    refreshPresetDropdown();
    renderFrameList();
    renderHistory();
    updateStatusMath();

    console.info('[LenticularStudio] Tahap 2 (Upload) + Tahap 3 (Settings/Preset) + mobile/simulasi siap.');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
