/**
 * interlace.js
 * ---------------------------------------------------------------------------
 * Mesin interlace sesungguhnya: menggabungkan N gambar (view) menjadi satu
 * gambar lenticular ter-interlace, sesuai orientasi lensa (vertikal/
 * horizontal), dengan dukungan fractional pixel, pitch correction, angle
 * correction, subpixel/center offset, start view, reverse view, mirror,
 * dan flip.
 *
 * Cara kerja singkat (untuk lensa vertikal — garis lensa berjalan vertikal,
 * sudut pandang berubah saat kepala bergerak kiri-kanan):
 *   Untuk setiap kolom piksel x pada kanvas output, kita hitung posisi x
 *   tsb di dalam satu siklus lensa (pixelsPerLens), lalu bagi siklus itu
 *   menjadi N irisan selebar pixelsPerView. Irisan ke berapa yang "kena"
 *   di situ menentukan dari view mana piksel itu diambil. Karena dihitung
 *   ulang dari posisi absolut (bukan akumulasi), fractional pixel width
 *   (pixelsPerLens yang tidak bulat) otomatis tertangani tanpa drift.
 *
 * Angle Correction diterapkan sebagai "shear": posisi dasar digeser
 * proporsional terhadap sumbu tegak lurusnya (mis. untuk lensa vertikal,
 * digeser sebesar y * tan(sudut)), mensimulasikan lembar lensa yang sedikit
 * miring terhadap arah cetak.
 *
 * Prosesnya di-chunk per beberapa baris dengan jeda ke event loop supaya
 * tidak membekukan UI/tab browser terlalu lama untuk gambar besar —
 * penting terutama di Safari iOS yang lebih agresif menganggap tab "tidak
 * merespons".
 * ---------------------------------------------------------------------------
 */
const Interlace = (() => {

  const ROWS_PER_CHUNK = 40; // jumlah baris diproses per "napas" sebelum yield ke event loop

  /**
   * Susun ulang urutan view sesuai Start View & Reverse View.
   * @param {number} n - jumlah view yang dipakai
   * @param {number} startView - 1-based
   * @param {boolean} reverseView
   * @returns {number[]} array index (0-based, merujuk ke array asli) sepanjang n
   */
  function buildViewOrder(n, startView, reverseView) {
    let order = Array.from({ length: n }, (_, i) => i);
    if (reverseView) order = order.reverse();
    const startIdx = Utils.clamp((startView || 1) - 1, 0, n - 1);
    // Rotasi array supaya dimulai dari startIdx (view mana yang jadi "index 0" siklus lensa)
    return order.map((_, i) => order[(i + startIdx) % n]);
  }

  /**
   * Skalakan & crop satu frame agar menutupi penuh ukuran output (mode
   * "cover", supaya komposisi tiap view konsisten), plus opsi mirror/flip.
   */
  function prepareSourceCanvas(frame, outW, outH, mirror, flip) {
    const c = document.createElement('canvas');
    c.width = outW;
    c.height = outH;
    const ctx = c.getContext('2d');

    const srcW = frame.width;
    const srcH = frame.height;
    const scale = Math.max(outW / srcW, outH / srcH); // "cover"
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const dx = (outW - drawW) / 2;
    const dy = (outH - drawH) / 2;

    ctx.save();
    ctx.translate(mirror ? outW : 0, flip ? outH : 0);
    ctx.scale(mirror ? -1 : 1, flip ? -1 : 1);
    ctx.drawImage(frame.img, dx, dy, drawW, drawH);
    ctx.restore();

    return c;
  }

  /**
   * Jalankan interlace penuh menghasilkan sebuah <canvas> baru siap-cetak.
   *
   * @param {Array<{img:HTMLImageElement,width:number,height:number}>} frames - urutan view APA ADANYA di panel kiri (belum diputar start/reverse; itu ditangani di sini)
   * @param {Object} params
   * @param {number} params.lpi
   * @param {number} params.outputDPI
   * @param {number} params.numberOfViews
   * @param {'vertical'|'horizontal'} params.lensDirection
   * @param {number} params.pitchCorrectionPercent
   * @param {number} params.angleCorrectionDeg
   * @param {number} params.subpixelOffsetPx
   * @param {number} params.centerOffsetPx
   * @param {number} params.startView
   * @param {boolean} params.reverseView
   * @param {boolean} params.mirror
   * @param {boolean} params.flip
   * @param {number} params.outputWidthMm
   * @param {number} params.outputHeightMm
   * @param {number} params.bleedMm
   * @param {(percent:number)=>void} [onProgress]
   * @returns {Promise<HTMLCanvasElement>}
   */
  async function run(frames, params, onProgress) {
    if (!frames || frames.length < 2) {
      throw new Error('Minimal 2 gambar/view diperlukan untuk interlace.');
    }

    const n = Utils.clamp(params.numberOfViews || frames.length, 2, frames.length);
    const order = buildViewOrder(n, params.startView, params.reverseView);
    const orderedFrames = order.map(idx => frames[idx]);

    // Ukuran kanvas output dalam piksel (termasuk bleed di kedua sisi)
    const totalWidthMm = params.outputWidthMm + params.bleedMm * 2;
    const totalHeightMm = params.outputHeightMm + params.bleedMm * 2;
    const outW = Math.max(1, Math.round(Utils.mmToPx(totalWidthMm, params.outputDPI)));
    const outH = Math.max(1, Math.round(Utils.mmToPx(totalHeightMm, params.outputDPI)));

    // PixelsPerLens dasar (sama seperti ditampilkan di status bar), dikoreksi
    // dengan Pitch Correction (%) supaya angka yang terlihat pengguna = yang
    // sungguhan dipakai untuk menginterlace.
    const pixelsPerLensNominal = params.outputDPI / params.lpi;
    const pixelsPerLens = pixelsPerLensNominal * (1 + (params.pitchCorrectionPercent || 0) / 100);
    const pixelsPerView = pixelsPerLens / n;

    if (!(pixelsPerLens > 0)) {
      throw new Error('Parameter LPI/DPI tidak valid (PixelsPerLens harus > 0).');
    }

    const angleRad = ((params.angleCorrectionDeg || 0) * Math.PI) / 180;
    const vertical = params.lensDirection !== 'horizontal';

    // Siapkan kanvas sumber tiap view (di-scale "cover" ke ukuran output +
    // mirror/flip), lalu ambil data pikselnya sekali di awal.
    const sourceDatas = orderedFrames.map(frame => {
      const c = prepareSourceCanvas(frame, outW, outH, params.mirror, params.flip);
      return c.getContext('2d').getImageData(0, 0, outW, outH).data;
    });

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const ctx = outCanvas.getContext('2d');
    const outImageData = ctx.createImageData(outW, outH);
    const out = outImageData.data;

    const offset = (params.subpixelOffsetPx || 0) + (params.centerOffsetPx || 0);

    for (let yStart = 0; yStart < outH; yStart += ROWS_PER_CHUNK) {
      const yEnd = Math.min(outH, yStart + ROWS_PER_CHUNK);

      for (let y = yStart; y < yEnd; y++) {
        for (let x = 0; x < outW; x++) {
          let posBase;
          if (vertical) {
            posBase = x + y * Math.tan(angleRad) + offset;
          } else {
            posBase = y + x * Math.tan(angleRad) + offset;
          }

          let posInLens = posBase % pixelsPerLens;
          if (posInLens < 0) posInLens += pixelsPerLens;

          let viewIdx = Math.floor(posInLens / pixelsPerView);
          if (viewIdx >= n) viewIdx = n - 1;
          if (viewIdx < 0) viewIdx = 0;

          const src = sourceDatas[viewIdx];
          const i = (y * outW + x) * 4;
          out[i] = src[i];
          out[i + 1] = src[i + 1];
          out[i + 2] = src[i + 2];
          out[i + 3] = src[i + 3];
        }
      }

      if (onProgress) onProgress(Math.round((yEnd / outH) * 100));
      // Yield ke event loop supaya UI (teks tombol, dsb) sempat update dan
      // tab tidak dianggap "tidak merespons" oleh browser.
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    ctx.putImageData(outImageData, 0, 0);
    return outCanvas;
  }

  return { run };
})();
