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

  /** Unduh Blob sebagai file, lewat elemen <a download> sementara. */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Beri jeda sebelum revoke supaya proses download sempat dimulai di semua browser.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Bungkus HTMLCanvasElement.toBlob dalam Promise agar bisa dipakai dengan async/await. */
  function canvasToBlob(canvas, type = 'image/png', quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('canvas.toBlob mengembalikan null'));
      }, type, quality);
    });
  }

  /* ---------------------------------------------------------------------
   * Pembuat file .zip minimal (metode STORE / tanpa kompresi).
   * Sengaja ditulis manual (bukan library eksternal) untuk mematuhi batasan
   * "hanya vanilla JS" — cukup untuk mengemas beberapa PNG hasil export.
   * ------------------------------------------------------------------- */
  let _crcTable = null;
  function getCrcTable() {
    if (_crcTable) return _crcTable;
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    _crcTable = table;
    return table;
  }

  function crc32(bytes) {
    const table = getCrcTable();
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const time = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((date.getSeconds() >> 1) & 0x1F);
    const dateVal = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0xF) << 5) | (date.getDate() & 0x1F);
    return { time, dateVal };
  }

  /**
   * Buat file .zip (tanpa kompresi) dari daftar entri { name, blob }.
   * Mengembalikan Promise<Blob> bertipe application/zip.
   */
  async function createZip(entries) {
    const encoder = new TextEncoder();
    const { time, dateVal } = dosDateTime();
    const fileParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const data = new Uint8Array(await entry.blob.arrayBuffer());
      const crc = crc32(data);
      const size = data.length;

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0, true);
      lh.setUint16(8, 0, true);   // 0 = STORE (tanpa kompresi)
      lh.setUint16(10, time, true);
      lh.setUint16(12, dateVal, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);
      lh.setUint32(22, size, true);
      lh.setUint16(26, nameBytes.length, true);
      lh.setUint16(28, 0, true);
      fileParts.push(new Uint8Array(lh.buffer), nameBytes, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true);
      ch.setUint16(14, dateVal, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true);
      ch.setUint32(24, size, true);
      ch.setUint16(28, nameBytes.length, true);
      ch.setUint16(30, 0, true);
      ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true);
      ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true);
      ch.setUint32(42, offset, true);
      centralParts.push(new Uint8Array(ch.buffer), nameBytes);

      offset += lh.buffer.byteLength + nameBytes.length + size;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const centralOffset = offset;

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, centralOffset, true);
    end.setUint16(20, 0, true);

    return new Blob([...fileParts, ...centralParts, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  /* ---------------------------------------------------------------------
   * Sisipkan metadata DPI fisik (chunk pHYs) ke dalam file PNG.
   *
   * MASALAH: HTMLCanvasElement.toBlob('image/png') TIDAK PERNAH menuliskan
   * informasi DPI ke dalam file PNG-nya — hasilnya cuma piksel mentah tanpa
   * "ukuran fisik yang dimaksud". Akibatnya, saat file itu dibuka software
   * cetak, ada dua skenario yang SAMA-SAMA bisa merusak akurasi cetak
   * lenticular:
   *   1. Dicetak "Actual Size"/100% tanpa tahu DPI aslinya -> banyak
   *      software menebak 72 atau 96 DPI, sehingga ukuran fisik hasil cetak
   *      jauh lebih besar dari yang dimaksud.
   *   2. Dicetak "Fit to Page" -> gambar di-scale paksa oleh driver cetak,
   *      merusak presisi jarak antar-pixel yang sudah dihitung pas dengan
   *      pitch lensa fisik (PixelsPerLens/PixelsPerView).
   *
   * FIX: sisipkan chunk pHYs standar PNG (pixels-per-meter) tepat setelah
   * IHDR. Software yang menghormati metadata ini (Photoshop, banyak print
   * dialog desktop, dsb) akan otomatis tahu ukuran fisik yang benar saat
   * mencetak di "Actual Size". ini TIDAK menggantikan kebutuhan mengatur
   * print dialog ke "Actual Size / No Scaling" — itu tetap wajib dicek
   * manual, karena mode "Fit to Page" akan mengabaikan metadata ini juga.
   * ------------------------------------------------------------------- */
  async function addPngPhysicalDpi(blob, dpi) {
    const buf = new Uint8Array(await blob.arrayBuffer());

    const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < 8; i++) {
      if (buf[i] !== PNG_SIG[i]) return blob; // bukan PNG valid, kembalikan apa adanya (aman, tidak error)
    }

    // Baca panjang data IHDR langsung dari file (selalu chunk pertama setelah signature).
    const ihdrLength = new DataView(buf.buffer, buf.byteOffset + 8, 4).getUint32(0, false);
    const ihdrEnd = 8 + 4 + 4 + ihdrLength + 4; // signature + length + type + data + crc

    const pixelsPerMeter = Math.round(dpi / 0.0254); // 1 inch = 0.0254 meter

    const typeAndData = new Uint8Array(13); // 4 byte type "pHYs" + 9 byte data
    typeAndData.set([0x70, 0x48, 0x59, 0x73], 0); // "pHYs"
    const dv = new DataView(typeAndData.buffer);
    dv.setUint32(4, pixelsPerMeter, false); // pixels per unit, X
    dv.setUint32(8, pixelsPerMeter, false); // pixels per unit, Y
    dv.setUint8(12, 1); // unit specifier: 1 = meter

    const crc = crc32(typeAndData);

    const chunk = new Uint8Array(4 + 13 + 4);
    new DataView(chunk.buffer).setUint32(0, 9, false); // panjang data (9 byte)
    chunk.set(typeAndData, 4);
    new DataView(chunk.buffer).setUint32(4 + 13, crc, false);

    const result = new Uint8Array(buf.length + chunk.length);
    result.set(buf.subarray(0, ihdrEnd), 0);
    result.set(chunk, ihdrEnd);
    result.set(buf.subarray(ihdrEnd), ihdrEnd + chunk.length);

    return new Blob([result], { type: 'image/png' });
  }

  return {
    clamp, lerp, roundTo, formatNumber,
    debounce, throttle, uid,
    mmToPx, pxToMm,
    formatFileSize, formatTime,
    computeInterlaceMath, applyPitchCorrection,
    readImageFile, isSupportedImage,
    downloadBlob, canvasToBlob, createZip, addPngPhysicalDpi,
  };
})();
