/**
 * preview.js
 * ---------------------------------------------------------------------------
 * Simulasi lenticular interaktif menggunakan Three.js (WebGL).
 *
 * Pendekatan: alih-alih menginterlace pixel sungguhan (itu tugas
 * interlace.js untuk file cetak, Tahap 4), simulasi di layar cukup
 * melakukan *blend* halus antar-tekstur (gambar/view) berdasarkan "posisi
 * pandang" (uViewPos) yang dikendalikan oleh:
 *   - drag / touch 1 jari  -> mengubah sudut pandang (rotate)
 *   - device tilt (gyroscope, khusus iOS/Android yang mendukung)
 *   - scroll wheel / pinch 2 jari -> zoom
 *   - shift+drag (desktop) / geser 2 jari (mobile) -> pan
 *
 * Renderer WebGL sengaja dibuat SEKALI dan dipakai ulang (bukan dibuat
 * ulang setiap pindah tab mode) karena Safari iOS membatasi jumlah konteks
 * WebGL aktif secara bersamaan — kalau renderer baru dibuat setiap kali
 * masuk mode simulasi, setelah beberapa kali gonta-ganti tab, konteks bisa
 * habis dan kanvas jadi putih/rusak. Karena itu API-nya start()/stop()
 * (pause/resume render loop), bukan init()/destroy() penuh.
 * ---------------------------------------------------------------------------
 */
const Preview = (() => {

  const MAX_SHADER_VIEWS = 8; // batas praktis jumlah sampler2D pada fragment shader
  const MAX_TILT_DEG = 30;    // rentang tilt (drag maupun gyro) yang dipetakan ke seluruh rentang view
  const MAX_ROTATE_DEG = 18;  // rotasi visual mesh maksimum, untuk kesan "kartu dimiringkan"

  let renderer = null;
  let scene = null;
  let camera = null;
  let mesh = null;
  let material = null;
  let canvasEl = null;

  let textures = [];
  let numViews = 0;
  let planeAspect = 1;

  let orientationMode = 'vertical'; // 'vertical' lensa -> drag horizontal; 'horizontal' lensa -> drag vertikal
  let viewPos = 0;        // posisi pandang aktual yang dirender (0..numViews-1)
  let viewPosTarget = 0;  // target posisi pandang (di-lerp ke viewPos supaya halus)
  let zoomDistance = 2.4; // jarak kamera dasar (semakin kecil = semakin zoom)
  let zoomIsCustom = false; // true setelah pengguna pinch/scroll manual (mencegah auto-refit menimpanya)
  let panX = 0, panY = 0;

  let running = false;
  let rafId = null;

  let gyroActive = false;
  let gyroBaseline = null; // kalibrasi nol otomatis saat gyro pertama aktif

  // ---- Pointer/gesture state --------------------------------------------
  const pointers = new Map(); // pointerId -> {x,y}
  let dragMode = null;        // 'rotate' | 'pan' | 'pinch' | null
  let lastSingle = null;      // {x,y} posisi pointer tunggal sebelumnya
  let lastPinchDist = null;
  let lastPanMid = null;

  /* ============================================================ *
   * Setup renderer/scene (sekali saja, dipakai ulang seterusnya)
   * ============================================================ */
  function ensureRenderer(canvas) {
    if (renderer) return;
    canvasEl = canvas;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, zoomDistance);
    scene.add(camera);

    attachInputHandlers(canvas);
  }

  /* ============================================================ *
   * Bangun ulang shader + tekstur ketika jumlah/isi frame berubah
   * ============================================================ */
  function buildShaderMaterial(n) {
    n = Math.max(2, Math.min(n, MAX_SHADER_VIEWS));

    const samplerDecls = Array.from({ length: n }, (_, i) => `uniform sampler2D uTex${i};`).join('\n');
    const pickChain = Array.from({ length: n }, (_, i) => `if (idx == ${i}) return texture2D(uTex${i}, uv);`).join('\n        ');

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      precision mediump float;
      varying vec2 vUv;
      ${samplerDecls}
      uniform float uViewPos;
      uniform float uNumViews;

      vec4 pickTex(int idx, vec2 uv) {
        ${pickChain}
        return texture2D(uTex0, uv);
      }

      void main() {
        float clampedPos = clamp(uViewPos, 0.0, uNumViews - 1.0);
        float f = floor(clampedPos);
        int idxA = int(f);
        int idxB = int(min(f + 1.0, uNumViews - 1.0));
        float t = clampedPos - f;
        vec4 colA = pickTex(idxA, vUv);
        vec4 colB = pickTex(idxB, vUv);
        gl_FragColor = mix(colA, colB, t);
      }
    `;

    const uniforms = {
      uViewPos: { value: 0 },
      uNumViews: { value: n },
    };
    for (let i = 0; i < n; i++) uniforms[`uTex${i}`] = { value: textures[i] || textures[textures.length - 1] };

    return new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true });
  }

  function disposeSceneContents() {
    if (mesh) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh = null;
    }
    if (material) {
      material.dispose();
      material = null;
    }
    textures.forEach(t => t.dispose());
    textures = [];
  }

  /**
   * Set/replace daftar gambar (HTMLImageElement) yang dipakai simulasi.
   * Dipanggil setiap kali frame ditambah/dihapus/diurutkan ulang saat mode
   * simulasi sedang aktif, atau saat pertama kali masuk mode simulasi.
   * Mengembalikan true bila berhasil dibangun (>=2 gambar valid).
   */
  function setFrames(images) {
    if (!renderer) return false; // ensureRenderer belum dipanggil
    disposeSceneContents();

    numViews = Math.min(images.length, MAX_SHADER_VIEWS);
    if (numViews < 2) return false; // caller (app.js) menampilkan pesan "butuh minimal 2 gambar"

    textures = images.slice(0, numViews).map(img => {
      const tex = new THREE.Texture(img);
      tex.needsUpdate = true;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      return tex;
    });

    const first = images[0];
    planeAspect = (first.naturalWidth || first.width || 1) / (first.naturalHeight || first.height || 1);

    material = buildShaderMaterial(numViews);
    const geometry = new THREE.PlaneGeometry(planeAspect, 1);
    mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    viewPos = 0;
    viewPosTarget = 0;
    panX = 0; panY = 0;
    zoomIsCustom = false;
    updateCameraAspectFromCanvas(); // BUG FIX: pastikan aspect rasio sudah benar SEBELUM menghitung fit
    fitCameraToPlane();
    return true;
  }

  /** Perbarui aspect rasio kamera dari ukuran kanvas yang sesungguhnya saat ini. */
  function updateCameraAspectFromCanvas() {
    if (!camera || !canvasEl) return;
    const w = canvasEl.clientWidth || 1;
    const h = canvasEl.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /**
   * Hitung jarak kamera agar plane memenuhi area kanvas dengan rapi.
   * BUG FIX: sebelumnya hanya menghitung fit berdasarkan TINGGI plane
   * ditambah margin 35% — pada kanvas yang tidak persegi (hampir selalu
   * terjadi di HP), ini membuat gambar tampak jauh lebih kecil dari yang
   * seharusnya. Sekarang dihitung jarak yang dibutuhkan untuk memenuhi
   * LEBAR dan TINGGI plane masing-masing, lalu diambil yang lebih besar
   * (supaya gambar landscape maupun portrait tetap pas tanpa terpotong),
   * dengan margin yang jauh lebih realistis (4%, bukan 35%).
   */
  function fitCameraToPlane() {
    if (!camera) return;
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const camAspect = camera.aspect || 1;

    const distForHeight = (1 / 2) / Math.tan(fovRad / 2);
    const distForWidth = (planeAspect / 2) / (Math.tan(fovRad / 2) * camAspect);

    zoomDistance = Math.max(distForHeight, distForWidth) * 1.04;
    camera.position.set(panX, panY, zoomDistance);
    camera.lookAt(0, 0, 0);
  }

  function setOrientation(mode) {
    orientationMode = mode === 'horizontal' ? 'horizontal' : 'vertical';
  }

  function hasEnoughFrames() { return numViews >= 2; }

  /* ============================================================ *
   * Render loop
   * ============================================================ */
  function tick() {
    if (!running) return;

    // Smoothing halus menuju target posisi pandang (kesan lensa yang "meluncur")
    viewPos += (viewPosTarget - viewPos) * 0.18;

    if (material) material.uniforms.uViewPos.value = viewPos;

    if (mesh && numViews > 1) {
      const t = viewPos / (numViews - 1); // 0..1
      const angle = THREE.MathUtils.lerp(-MAX_ROTATE_DEG, MAX_ROTATE_DEG, t);
      if (orientationMode === 'vertical') {
        mesh.rotation.y = THREE.MathUtils.degToRad(angle);
        mesh.rotation.x = 0;
      } else {
        mesh.rotation.x = THREE.MathUtils.degToRad(-angle);
        mesh.rotation.y = 0;
      }
    }

    if (camera) {
      camera.position.x = panX;
      camera.position.y = panY;
      camera.position.z = zoomDistance;
      camera.lookAt(0, 0, 0);
    }

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  }

  function resize() {
    if (!renderer || !canvasEl) return;
    const w = canvasEl.clientWidth || 1;
    const h = canvasEl.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    updateCameraAspectFromCanvas();
    // Auto-refit mengikuti perubahan ukuran layar (mis. rotasi iPhone) —
    // tapi HANYA selama pengguna belum melakukan zoom manual sendiri,
    // supaya tidak menimpa pinch/scroll zoom yang sedang dipakai pengguna.
    if (!zoomIsCustom && mesh) fitCameraToPlane();
  }

  function start() {
    if (!renderer) return;
    running = true;
    resize();
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  /* ============================================================ *
   * Input: drag (mouse+touch via Pointer Events), pinch-zoom, pan
   * ============================================================ */
  function viewPosFromDelta(deltaPx, axisSizePx) {
    const degrees = (deltaPx / Math.max(1, axisSizePx)) * MAX_TILT_DEG * 2;
    return degrees / MAX_TILT_DEG; // -N..N (belum diklem, diklem di applyNormalizedPos)
  }

  function applyNormalizedPos(norm) {
    // norm: -1..1  ->  0..(numViews-1)
    const clamped = Utils.clamp(norm, -1, 1);
    const t = (clamped + 1) / 2;
    viewPosTarget = t * (numViews - 1);
  }

  function currentNormalizedPos() {
    if (numViews < 2) return 0;
    return (viewPosTarget / (numViews - 1)) * 2 - 1;
  }

  function attachInputHandlers(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 1) {
        dragMode = e.shiftKey ? 'pan' : 'rotate';
        lastSingle = { x: e.clientX, y: e.clientY };
      } else if (pointers.size === 2) {
        dragMode = 'pinch';
        const pts = Array.from(pointers.values());
        lastPinchDist = distance(pts[0], pts[1]);
        lastPanMid = midpoint(pts[0], pts[1]);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId) || !hasEnoughFrames()) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (dragMode === 'rotate' && pointers.size === 1 && lastSingle) {
        gyroActive = false; // interaksi manual menonaktifkan sementara kontrol gyro
        const dx = e.clientX - lastSingle.x;
        const dy = e.clientY - lastSingle.y;
        const rect = canvas.getBoundingClientRect();
        const delta = orientationMode === 'vertical' ? dx : dy;
        const axisSize = orientationMode === 'vertical' ? rect.width : rect.height;
        const norm = currentNormalizedPos() + viewPosFromDelta(delta, axisSize);
        applyNormalizedPos(norm);
        lastSingle = { x: e.clientX, y: e.clientY };
      } else if (dragMode === 'pan' && pointers.size === 1 && lastSingle) {
        const dx = e.clientX - lastSingle.x;
        const dy = e.clientY - lastSingle.y;
        panX = Utils.clamp(panX - dx * 0.003, -1, 1);
        panY = Utils.clamp(panY + dy * 0.003, -1, 1);
        lastSingle = { x: e.clientX, y: e.clientY };
      } else if (dragMode === 'pinch' && pointers.size === 2) {
        const pts = Array.from(pointers.values());
        const dist = distance(pts[0], pts[1]);
        const mid = midpoint(pts[0], pts[1]);
        if (lastPinchDist) {
          const scaleDelta = dist / lastPinchDist;
          zoomDistance = Utils.clamp(zoomDistance / scaleDelta, 0.5, 12);
          zoomIsCustom = true;
        }
        if (lastPanMid) {
          panX = Utils.clamp(panX - (mid.x - lastPanMid.x) * 0.004, -1, 1);
          panY = Utils.clamp(panY + (mid.y - lastPanMid.y) * 0.004, -1, 1);
        }
        lastPinchDist = dist;
        lastPanMid = mid;
      }
    });

    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        dragMode = null;
        lastSingle = null;
        lastPinchDist = null;
        lastPanMid = null;
      } else if (pointers.size === 1) {
        dragMode = 'rotate';
        const remaining = Array.from(pointers.values())[0];
        lastSingle = { x: remaining.x, y: remaining.y };
        lastPinchDist = null;
        lastPanMid = null;
      }
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', (e) => {
      if (e.buttons === 0) endPointer(e);
    });

    // Scroll wheel = zoom (desktop)
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomDistance = Utils.clamp(zoomDistance * (1 + e.deltaY * 0.001), 0.5, 12);
      zoomIsCustom = true;
    }, { passive: false });
  }

  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  /* ============================================================ *
   * Gyroscope (khusus iOS: butuh izin lewat gesture pengguna)
   * ============================================================ */
  function needsGyroPermission() {
    return typeof window.DeviceOrientationEvent !== 'undefined'
      && typeof window.DeviceOrientationEvent.requestPermission === 'function';
  }

  function hasGyroSupport() {
    return typeof window.DeviceOrientationEvent !== 'undefined';
  }

  function handleOrientation(e) {
    if (dragMode || !hasEnoughFrames()) return; // sedang disentuh manual, gyro tidak mengintervensi
    const raw = orientationMode === 'vertical' ? e.gamma : e.beta;
    if (raw === null || raw === undefined) return;

    if (gyroBaseline === null) gyroBaseline = raw; // kalibrasi nol otomatis di posisi awal pegang HP
    const relative = raw - gyroBaseline;
    const norm = relative / MAX_TILT_DEG;
    applyNormalizedPos(norm);
  }

  /** Minta izin sensor orientasi (wajib dipanggil dari dalam event klik pengguna di iOS 13+). */
  function requestGyro() {
    if (needsGyroPermission()) {
      return window.DeviceOrientationEvent.requestPermission().then(state => {
        if (state === 'granted') {
          gyroBaseline = null;
          gyroActive = true;
          window.addEventListener('deviceorientation', handleOrientation);
          return true;
        }
        return false;
      }).catch(() => false);
    }
    if (hasGyroSupport()) {
      gyroBaseline = null;
      gyroActive = true;
      window.addEventListener('deviceorientation', handleOrientation);
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  return {
    ensureRenderer,
    setFrames,
    setOrientation,
    hasEnoughFrames,
    start,
    stop,
    resize,
    requestGyro,
    hasGyroSupport,
    needsGyroPermission,
  };
})();
