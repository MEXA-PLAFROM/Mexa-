/* =====================================================
   MEXA SMART — SYSTEM PENGHUBUNG 2
   File: js/core/mexa-connector-2.js
   Version: 1.0.0

   JALUR:
   MEXA SYSTEM CENTER
          ↓
   MEXA CONNECTOR 2
          ↓
   MEXA DATA MANAGEMENT

   Kontrak penerima:
   - receiveRegistryRecord(record)
   - receiveRegisteredUser(record)

   Tidak membuat koneksi Supabase.
   Tidak mengklaim sukses tanpa konfirmasi penerima.
   ===================================================== */

(function (window, document) {
  "use strict";

  if (window.MEXA_CONNECTOR_2) {
    console.warn("[MEXA CONNECTOR 2] Sudah aktif.");
    return;
  }

  const VERSION = "1.0.0";

  let management = null;
  let forwarding = 0;
  let forwardedRegistry = 0;
  let forwardedUsers = 0;
  let failed = 0;
  let lastError = null;

  function emit(eventName, detail) {
    document.dispatchEvent(
      new window.CustomEvent(eventName, { detail })
    );
  }

  function getManagement() {
    const manager = window.MEXA_DATA_MANAGEMENT;

    if (
      manager &&
      typeof manager.receiveRegistryRecord === "function" &&
      typeof manager.receiveRegisteredUser === "function"
    ) {
      management = manager;
      return manager;
    }

    if (management) {
      return management;
    }

    throw new Error(
      "MEXA DATA MANAGEMENT belum siap atau kontraknya belum cocok."
    );
  }

  function validateRegistryRecord(record) {
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record)
    ) {
      throw new TypeError(
        "Data Registry harus berupa objek."
      );
    }

    if (
      typeof record.name !== "string" ||
      !record.name.trim()
    ) {
      throw new Error(
        "Nama sistem dalam data Registry tidak valid."
      );
    }

    if (
      typeof record.title !== "string" ||
      !record.title.trim()
    ) {
      throw new Error(
        "Judul sistem dalam data Registry tidak valid."
      );
    }

    return {
      name: record.name.trim().toLowerCase(),
      title: record.title.trim(),
      version: record.version || VERSION,
      system_type: record.system_type || record.type || "module",
      file_path: record.file_path || record.file || null,
      position: Number.isInteger(record.position)
        ? record.position
        : null,
      description: typeof record.description === "string"
        ? record.description
        : "",
      status: record.status === "ready"
        ? "ready"
        : "registered",
      created_at: record.created_at || null,
      updated_at: record.updated_at || null
    };
  }

  function validateUserRecord(record) {
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record)
    ) {
      throw new TypeError(
        "Data pengguna harus berupa objek."
      );
    }

    const id =
      typeof record.id === "string" ? record.id.trim() : "";

    const email =
      typeof record.email === "string"
        ? record.email.trim().toLowerCase()
        : "";

    const displayName =
      typeof record.displayName === "string"
        ? record.displayName.trim()
        : "";

    const username =
      typeof record.username === "string"
        ? record.username.trim().toLowerCase()
        : "";

    if (!id) {
      throw new Error("ID pengguna tidak tersedia.");
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Email pengguna tidak valid.");
    }

    if (displayName.length < 2 || displayName.length > 80) {
      throw new Error("Nama pengguna tidak valid.");
    }

    if (!/^[a-z0-9_.]{3,30}$/.test(username)) {
      throw new Error("Username pengguna tidak valid.");
    }

    /*
     * Hanya field yang diperlukan yang diteruskan.
     * Kata sandi dan token autentikasi tidak ikut dikirim.
     */
    return {
      id,
      email,
      displayName,
      username,
      createdAt: record.createdAt || null
    };
  }

  async function forwardRegistryRecord(input) {
    forwarding += 1;

    try {
      const manager = getManagement();
      const record = validateRegistryRecord(input);

      const result = await manager.receiveRegistryRecord(record);

      if (!result || result.accepted !== true) {
        throw new Error(
          "System Pengelolaan Data belum mengonfirmasi penerimaan Registry."
        );
      }

      forwardedRegistry += 1;
      lastError = null;

      emit("mexa:connector-2:registry-forwarded", {
        name: record.name,
        accepted: true
      });

      return {
        accepted: true,
        name: record.name,
        destination: "MEXA_DATA_MANAGEMENT",
        result
      };
    } catch (error) {
      failed += 1;
      lastError = String(error.message || error);

      console.error(
        "[MEXA CONNECTOR 2] Pengiriman Registry gagal:",
        error
      );

      throw error;
    } finally {
      forwarding -= 1;
    }
  }

  async function forwardRegisteredUser(input) {
    forwarding += 1;

    try {
      const manager = getManagement();
      const record = validateUserRecord(input);

      const result = await manager.receiveRegisteredUser(record);

      if (!result || result.accepted !== true) {
        throw new Error(
          "System Pengelolaan Data belum mengonfirmasi penerimaan pengguna."
        );
      }

      forwardedUsers += 1;
      lastError = null;

      emit("mexa:connector-2:user-forwarded", {
        id: record.id,
        username: record.username,
        accepted: true
      });

      return {
        accepted: true,
        userId: record.id,
        destination: "MEXA_DATA_MANAGEMENT",
        result
      };
    } catch (error) {
      failed += 1;
      lastError = String(error.message || error);

      console.error(
        "[MEXA CONNECTOR 2] Pengiriman pengguna gagal:",
        error
      );

      throw error;
    } finally {
      forwarding -= 1;
    }
  }

  function connectManagement(api) {
    if (
      !api ||
      typeof api.receiveRegistryRecord !== "function" ||
      typeof api.receiveRegisteredUser !== "function"
    ) {
      throw new TypeError(
        "System Pengelolaan Data harus menyediakan " +
        "receiveRegistryRecord(record) dan " +
        "receiveRegisteredUser(record)."
      );
    }

    management = api;

    console.info(
      "[MEXA CONNECTOR 2] System Pengelolaan Data terhubung."
    );

    emit("mexa:connector-2:ready", {
      version: VERSION
    });

    return getStatus();
  }

  function getStatus() {
    return {
      name: "MEXA CONNECTOR 2",
      version: VERSION,
      ready: true,
      managementConnected: Boolean(
        management &&
        typeof management.receiveRegistryRecord === "function" &&
        typeof management.receiveRegisteredUser === "function"
      ),
      forwarding,
      forwardedRegistry,
      forwardedUsers,
      failed,
      lastError
    };
  }

  window.MEXA_CONNECTOR_2 = Object.freeze({
    version: VERSION,
    connectManagement,
    forwardRegistryRecord,
    forwardRegisteredUser,
    getStatus
  });

  /*
   * Sambungkan otomatis jika Pengelolaan Data
   * sudah tersedia atau memberi event siap.
   */
  if (window.MEXA_DATA_MANAGEMENT) {
    try {
      connectManagement(window.MEXA_DATA_MANAGEMENT);
    } catch (error) {
      lastError = String(error.message || error);
      console.error("[MEXA CONNECTOR 2]", error);
    }
  }

  document.addEventListener(
    "mexa:data-management:ready",
    function (event) {
      const api = event.detail?.api ||
        window.MEXA_DATA_MANAGEMENT;

      if (!api) return;

      try {
        connectManagement(api);
      } catch (error) {
        lastError = String(error.message || error);
        console.error("[MEXA CONNECTOR 2]", error);
      }
    }
  );

  console.info(
    "[MEXA CONNECTOR 2] Siap."
  );

})(window, document);
