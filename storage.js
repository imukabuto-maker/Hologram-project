/**
 * storage.js
 * ---------------------------------------------------------------------------
 * Wrapper generik di atas window.localStorage.
 *
 * Sudah fungsional penuh pada Tahap 1 untuk keperluan dasar (tema aplikasi,
 * visibilitas panel, dsb). Fungsi khusus preset lenticular (savePreset,
 * loadPreset, deletePreset, listPresets) juga sudah disiapkan di sini karena
 * murni operasi penyimpanan generik — namun *pemanggilannya* dari form
 * parameter (mengumpulkan seluruh nilai parameter) baru akan disambungkan
 * penuh setelah settings.js selesai pada Tahap 3.
 * ---------------------------------------------------------------------------
 */
const Storage = (() => {

  const NS = 'lenticularStudio'; // namespace agar tidak bentrok dengan app lain
  const KEYS = {
    theme: `${NS}:theme`,
    panelState: `${NS}:panelState`,
    presets: `${NS}:presets`,       // { [presetName]: paramsObject }
    calibration: `${NS}:calibration`, // hasil wizard kalibrasi tersimpan
  };

  function isAvailable() {
    try {
      const testKey = `${NS}:__test__`;
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  }

  function get(key, fallback = null) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[Storage] Gagal membaca key', key, e);
      return fallback;
    }
  }

  function set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[Storage] Gagal menyimpan key', key, e);
      return false;
    }
  }

  function remove(key) {
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---- Preferensi UI (fungsional di Tahap 1) --------------------------------
  function getTheme() { return get(KEYS.theme, 'dark'); }
  function setTheme(theme) { return set(KEYS.theme, theme); }

  function getPanelState() { return get(KEYS.panelState, { left: true, right: true }); }
  function setPanelState(state) { return set(KEYS.panelState, state); }

  // ---- Preset (disambungkan penuh ke UI pada Tahap 3) ------------------------
  function listPresets() {
    return get(KEYS.presets, {});
  }

  function savePreset(name, paramsObject) {
    const all = listPresets();
    all[name] = paramsObject;
    return set(KEYS.presets, all);
  }

  function loadPreset(name) {
    const all = listPresets();
    return all[name] || null;
  }

  function deletePreset(name) {
    const all = listPresets();
    delete all[name];
    return set(KEYS.presets, all);
  }

  // ---- Kalibrasi (disambungkan penuh pada Tahap 6) ---------------------------
  function getCalibration() { return get(KEYS.calibration, null); }
  function setCalibration(data) { return set(KEYS.calibration, data); }

  return {
    KEYS, isAvailable, get, set, remove,
    getTheme, setTheme,
    getPanelState, setPanelState,
    listPresets, savePreset, loadPreset, deletePreset,
    getCalibration, setCalibration,
  };
})();
