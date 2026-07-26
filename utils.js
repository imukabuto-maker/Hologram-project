/**
 * utils.js
 * ---------------------------------------------------------------------------
 * Kumpulan fungsi utilitas murni (tidak bergantung DOM kecuali disebutkan).
 * Dipakai bersama oleh settings.js, interlace.js, preview.js, storage.js,
 * dan app.js. Semua fungsi di sini dibungkus dalam namespace global `Utils`
 * agar tidak mencemari scope global dan mudah dipakai lintas file <script>.
 * ---------------------------------------------------------------------------
 */
const Utils = (() => {

  /** Batasi nilai numerik ke dalam rentang [min, max]. */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /** Interpolasi linear antara a dan b sebesar t (0..1). */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /** Bulatkan angka ke n desimal, mengembalikan Number (bukan string). */
  function roundTo(value, decimals = 2) {
    const f = Math.pow(10, decimals);
    return Math.round((value + Number.EPSILON) * f) / f;
  }

  /** Format angka untuk ditampilkan di UI (mis. status bar), dengan satuan opsional. */
  function formatNumber(value, decimals = 2, unit = '') {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return `${roundTo(value, decimals)}${unit}`;
  }

  /** Debounce: jalankan fn hanya setelah tidak dipanggil lagi selama `wait` ms. */
  function debounce(fn, wait = 150) {
    let t = null;
    return function debounced(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /** Throttle: batasi fn agar berjalan maksimal sekali per `limit` ms. */
  function throttle(fn, limit = 100) {
    let waiting = false;
    return function throttled(...args) {
      if (waiting) return;
      fn.apply(this, args);
      waiting = true;
      setTimeout(() => { waiting = false; }, limit);
    };
  }

  /** Buat ID unik sederhana (cukup untuk key localStorage / DOM, bukan kriptografis). */
  function uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Konversi milimeter ke pixel pada DPI tertentu. 1 inch = 25.4 mm. */
  function mmToPx(mm, dpi) {
    return (mm / 25.4) * dpi;
  }

  /** Konversi pixel ke milimeter pada DPI tertentu. */
  function pxToMm(px, dpi) {
    return (px / dpi) * 25.4;
  }

  /** Format ukuran file (bytes) menjadi string terbaca manusia. */
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${roundTo(bytes / Math.pow(1024, i), 1)} ${units[i]}`;
  }

  /** Format timestamp (ms) menjadi jam:menit:detik lokal, untuk log riwayat. */
  function formatTime(ts = Date.now()) {
    const d = new Date(ts);
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  /**
   * Inti rumus interlace engine (lihat spesifikasi):
   *   PixelsPerLens = DPI / LPI
   *   PixelsPerView = PixelsPerLens / NumberOfViews
   *
   * dpi   : Output DPI yang dipakai saat mencetak (bukan printer DPI mentah)
   * lpi   : Lines Per Inch dari lensa lenticular
   * views : jumlah total view/sudut pandang
   *
   * Mengembalikan objek berisi kedua nilai turunan tsb, dibulatkan untuk
   * ditampilkan tapi juga menyediakan versi presisi penuh (rawX) untuk
   * dipakai oleh interlace.js pada Tahap 4.
   */
  function computeInterlaceMath({ dpi, lpi, views }) {
    const pixelsPerLens = dpi / lpi;
    const pixelsPerView = pixelsPerLens / views;
    return {
      pixelsPerLens,
      pixelsPerView,
      pixelsPerLensRounded: roundTo(pixelsPerLens, 3),
      pixelsPerViewRounded: roundTo(pixelsPerView, 4),
    };
  }

  /** Terapkan pitch correction (%) ke lens pitch dasar (mm). */
  function applyPitchCorrection(lensPitchMm, correctionPercent) {
    return lensPitchMm * (1 + correctionPercent / 100);
  }

  /** Baca File (image) menjadi HTMLImageElement via Promise. */
  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url, file });
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  /** Cek apakah tipe file adalah gambar yang didukung. */
  function isSupportedImage(file) {
    return /^image\/(png|jpe?g|webp|bmp|gif)$/i.test(file.type);
  }

  return {
    clamp, lerp, roundTo, formatNumber,
    debounce, throttle, uid,
    mmToPx, pxToMm,
    formatFileSize, formatTime,
    computeInterlaceMath, applyPitchCorrection,
    readImageFile, isSupportedImage,
  };
})();
