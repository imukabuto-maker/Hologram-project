/**
 * settings.js
 * ---------------------------------------------------------------------------
 * Modul manajemen state parameter (single source of truth untuk seluruh
 * parameter interlace/lenticular yang ada di Panel Kanan).
 *
 * Menyediakan jembatan dua arah antara form HTML dan objek parameter polos
 * (plain object) — inilah yang dipakai fitur Preset (app.js) untuk:
 *   - Settings.toParamsObject()   : baca semua nilai form saat ini -> objek
 *   - Settings.fromParamsObject() : terapkan objek -> ke semua field form
 *   - Settings.resetToDefaults()  : kembalikan seluruh form ke nilai DEFAULTS
 *
 * Modul ini sengaja tidak menyimpan state sendiri (tidak ada variabel
 * internal) — form HTML itu sendiri yang menjadi "sumber kebenaran" nilai
 * saat ini, supaya tidak ada dua tempat yang bisa saling tidak sinkron.
 * ---------------------------------------------------------------------------
 */
const Settings = (() => {

  // Skema default seluruh parameter, dipakai app.js Tahap 1 untuk mengisi
  // nilai awal form (single source of truth untuk default value & id DOM).
  const DEFAULTS = {
    // Lensa & interlace
    lpi: 60,
    printerDPI: 720,
    outputDPI: 300,
    numberOfViews: 2,
    lensDirection: 'vertical', // 'vertical' | 'horizontal'

    // Kalibrasi & koreksi halus
    lensPitchMm: 0.635,
    pitchCorrectionPercent: 0,
    angleCorrectionDeg: 0,
    subpixelOffsetPx: 0,
    centerOffsetPx: 0,

    // Urutan & orientasi view
    startView: 1,
    reverseView: false,
    mirror: false,
    flip: false,

    // Output & kanvas
    outputWidthMm: 100,
    outputHeightMm: 150,
    bleedMm: 0,
    cropEnabled: false,
  };

  // Pemetaan key parameter -> id elemen input di DOM (dipakai app.js agar
  // logika baca/tulis form tidak hard-coded berulang di banyak tempat).
  const FIELD_IDS = {
    lpi: 'paramLPI',
    printerDPI: 'paramPrinterDPI',
    outputDPI: 'paramOutputDPI',
    numberOfViews: 'paramViews',
    lensDirection: 'paramLensDir',
    lensPitchMm: 'paramLensPitch',
    pitchCorrectionPercent: 'paramPitchCorrection',
    angleCorrectionDeg: 'paramAngleCorrection',
    subpixelOffsetPx: 'paramSubpixelOffset',
    centerOffsetPx: 'paramCenterOffset',
    startView: 'paramStartView',
    reverseView: 'paramReverseView',
    mirror: 'paramMirror',
    flip: 'paramFlip',
    outputWidthMm: 'paramOutputWidth',
    outputHeightMm: 'paramOutputHeight',
    bleedMm: 'paramBleed',
    cropEnabled: 'paramCropEnabled',
  };

  const RANGE_SUFFIX = '_range';

  /** Baca nilai satu field dari DOM, dengan tipe yang sesuai (boolean/number/string). */
  function getFieldValue(key) {
    const el = document.getElementById(FIELD_IDS[key]);
    if (!el) return DEFAULTS[key];

    if (el.type === 'checkbox') return el.checked;
    if (el.tagName === 'SELECT') return el.value;

    const num = parseFloat(el.value);
    return Number.isNaN(num) ? el.value : num;
  }

  /** Tulis satu nilai ke field DOM (dan slider pasangannya bila ada). */
  function setFieldValue(key, value) {
    if (value === undefined || value === null) return;
    const el = document.getElementById(FIELD_IDS[key]);
    if (!el) return;

    if (el.type === 'checkbox') {
      el.checked = !!value;
      return;
    }

    el.value = value;
    const rangeEl = document.getElementById(FIELD_IDS[key] + RANGE_SUFFIX);
    if (rangeEl) rangeEl.value = value;
  }

  /** Kumpulkan SEMUA nilai form saat ini menjadi satu objek polos (untuk disimpan sebagai preset). */
  function toParamsObject() {
    const obj = {};
    Object.keys(FIELD_IDS).forEach(key => { obj[key] = getFieldValue(key); });
    return obj;
  }

  /** Terapkan objek parameter (mis. hasil load preset) ke SEMUA field form. */
  function fromParamsObject(obj) {
    Object.keys(FIELD_IDS).forEach(key => setFieldValue(key, obj[key]));
  }

  /** Kembalikan seluruh form ke nilai default pabrik. */
  function resetToDefaults() {
    fromParamsObject(DEFAULTS);
  }

  return {
    DEFAULTS,
    FIELD_IDS,
    getFieldValue,
    setFieldValue,
    toParamsObject,
    fromParamsObject,
    resetToDefaults,
  };
})();
