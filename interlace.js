/**
 * interlace.js
 * ---------------------------------------------------------------------------
 * Mesin interlace: menggabungkan N gambar (view) menjadi satu gambar
 * lenticular ter-interlace, sesuai orientasi lensa (vertikal/horizontal),
 * dengan dukungan fractional pixel dan pitch correction.
 *
 * STATUS: Belum diimplementasikan — dijadwalkan pada Tahap 4 sesuai rencana
 * pengerjaan bertahap yang diminta. File ini sengaja disiapkan lebih awal
 * (dan sudah di-include di index.html) supaya urutan <script> final tidak
 * perlu diubah lagi di tahap-tahap berikutnya.
 *
 * Rencana API publik (akan diisi pada Tahap 4):
 *   Interlace.run(images, params) -> Promise<HTMLCanvasElement>
 *   Interlace.computeColumnMap(params)  // pemetaan kolom pixel -> index view
 *   Interlace.applyFractionalPixel(...)
 *   Interlace.applyPitchCorrection(...)
 * ---------------------------------------------------------------------------
 */
const Interlace = (() => {
  return {
    // TODO (Tahap 4): implementasi mesin interlace menggunakan Canvas API,
    // memakai Utils.computeInterlaceMath() sebagai dasar perhitungan.
  };
})();
