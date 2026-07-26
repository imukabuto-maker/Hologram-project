/**
 * settings.js
 * ---------------------------------------------------------------------------
 * Modul manajemen state parameter (single source of truth untuk seluruh
 * parameter interlace/lenticular yang ada di Panel Kanan).
 *
 * STATUS: Kerangka (Tahap 1). Berisi skema default & id field agar app.js
 * bisa menginisialisasi UI dengan nilai yang konsisten. Logika penuh
 * (get/set reaktif, validasi antar-parameter, sinkronisasi dua arah dengan
 * form, serta koneksi ke Storage untuk preset) akan diimplementasikan pada
 * Tahap 3 sesuai rencana pengerjaan bertahap.
 *
 * Daftar tanggung jawab yang akan ditambahkan di Tahap 3:
 *   - Settings.get(key) / Settings.set(key, value)
 *   - Settings.subscribe(callback) -> dipanggil setiap ada perubahan (realtime)
 *   - Settings.toParamsObject() / Settings.fromParamsObject(obj)  (untuk preset)
 *   - Validasi silang (mis. StartView tidak boleh > NumberOfViews)
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

  return {
    DEFAULTS,
    FIELD_IDS,
    // TODO (Tahap 3): implementasi state reaktif penuh.
  };
})();
