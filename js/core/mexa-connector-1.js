/* =====================================================
   MEXA SMART — CONNECTOR 1
   Registry → Connector 1 → System Center
   ===================================================== */

(function (window) {
  "use strict";

  if (window.MEXA_CONNECTOR_1) {
    console.warn("[MEXA CONNECTOR 1] Sudah aktif.");
    return;
  }

  const VERSION = "1.0.0";
  let busy = false;

  function validatePayload(payload) {
    if (!payload || typeof payload !== "object") {
      throw new TypeError("Data pendaftaran tidak valid.");
    }

    const displayName =
      typeof payload.displayName === "string"
        ? payload.displayName.trim()
        : "";

    const username =
      typeof payload.username === "string"
        ? payload.username.trim().toLowerCase()
        : "";

    const email =
      typeof payload.email === "string"
        ? payload.email.trim().toLowerCase()
        : "";

    const password =
      typeof payload.password === "string"
        ? payload.password
        : "";

    if (displayName.length < 2 || displayName.length > 80) {
      throw new Error("Nama lengkap harus terdiri dari 2–80 karakter.");
    }

    if (!/^[a-z0-9_.]{3,30}$/.test(username)) {
      throw new Error("Format username tidak valid.");
    }

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      throw new Error("Format email tidak valid.");
    }

    if (password.length < 8 || password.length > 72) {
      throw new Error("Kata sandi harus terdiri dari 8–72 karakter.");
    }

    return {
      displayName,
      username,
      email,
      password
    };
  }

  /*
   * KONTRAK:
   * MEXA_HTML_REGISTRY.registerUser(payload)
   *          ↓
   * MEXA_CONNECTOR_1.registerUser(payload)
   *          ↓
   * MEXA_SYSTEM_CENTER.registerUser(payload)
   */
  async function registerUser(payload) {
    if (busy) {
      throw new Error(
        "Permintaan pendaftaran sedang diproses."
      );
    }

    const center = window.MEXA_SYSTEM_CENTER;

    if (
      !center ||
      typeof center.registerUser !== "function"
    ) {
      throw new Error(
        "MEXA SYSTEM CENTER belum dimuat."
      );
    }

    const data = validatePayload(payload);

    busy = true;

    try {
      const result = await center.registerUser(data);

      if (!result || result.accepted !== true) {
        throw new Error(
          "System Pusat belum mengonfirmasi pendaftaran."
        );
      }

      console.info(
        "[MEXA CONNECTOR 1] Hasil diterima dari System Center."
      );

      return result;
    } finally {
      busy = false;
    }
  }

  window.MEXA_CONNECTOR_1 = Object.freeze({
    version: VERSION,
    registerUser
  });

  console.info("[MEXA CONNECTOR 1] Siap.");

})(window);
