/* =====================================================
   MEXA SMART — SYSTEM PENGELOLAAN DATA
   File: js/core/mexa-data-management.js
   Version: 1.0.0

   ALUR:
   SYSTEM CENTER
        ↓
   PENGHUBUNG 2
        ↓
   SYSTEM PENGELOLAAN DATA
        ↓
   MX

   Kontrak Penghubung 2:
   - receiveRegistryRecord(record)
   - receiveRegisteredUser(record)

   System ini tidak membuat koneksi Supabase sendiri.
   ===================================================== */

(function (window, document) {
  "use strict";

  const VERSION = "1.0.0";

  // Hindari inisialisasi ganda.
  if (
    window.MEXA_DATA_MANAGEMENT &&
    window.MEXA_DATA_MANAGEMENT.version === VERSION
  ) {
    console.warn(
      "[MEXA DATA MANAGEMENT] Sudah aktif."
    );
    return;
  }

  // ================================================
  // PENYIMPANAN DATA SELAMA HALAMAN AKTIF
  // ================================================

  const registryRecords = new Map();
  const registeredUsers = new Map();

  let mxReceiver = null;
  let receivedRegistry = 0;
  let receivedUsers = 0;
  let forwardedToMX = 0;
  let failed = 0;
  let lastError = null;

  // ================================================
  // EVENT SYSTEM
  // ================================================

  function emit(eventName, detail) {
    document.dispatchEvent(
      new window.CustomEvent(eventName, {
        detail: detail
      })
    );
  }

  function copyRecord(record) {
    return Object.assign({}, record);
  }

  // ================================================
  // VALIDASI DATA REGISTRY
  // ================================================

  function normalizeRegistryRecord(input) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input)
    ) {
      throw new TypeError(
        "Data Registry harus berupa objek."
      );
    }

    const name =
      typeof input.name === "string"
        ? input.name.trim().toLowerCase()
        : "";

    const title =
      typeof input.title === "string"
        ? input.title.trim()
        : "";

    if (!name) {
      throw new Error(
        "Nama sistem Registry wajib diisi."
      );
    }

    if (!title) {
      throw new Error(
        "Judul sistem Registry wajib diisi."
      );
    }

    return {
      name: name,
      title: title,
      version: input.version || VERSION,

      system_type:
        input.system_type ||
        input.type ||
        "module",

      file_path:
        input.file_path ||
        input.file ||
        null,

      position:
        Number.isInteger(input.position)
          ? input.position
          : null,

      description:
        typeof input.description === "string"
          ? input.description
          : "",

      status:
        input.status === "ready"
          ? "ready"
          : "registered",

      created_at: input.created_at || null,

      updated_at:
        input.updated_at ||
        new Date().toISOString()
    };
  }

  // ================================================
  // VALIDASI DATA PENGGUNA
  // ================================================

  function normalizeRegisteredUser(input) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input)
    ) {
      throw new TypeError(
        "Data pengguna harus berupa objek."
      );
    }

    const id =
      typeof input.id === "string"
        ? input.id.trim()
        : "";

    const email =
      typeof input.email === "string"
        ? input.email.trim().toLowerCase()
        : "";

    const displayName =
      typeof input.displayName === "string"
        ? input.displayName.trim()
        : "";

    const username =
      typeof input.username === "string"
        ? input.username.trim().toLowerCase()
        : "";

    if (!id) {
      throw new Error(
        "ID pengguna tidak tersedia."
      );
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      throw new Error(
        "Format email pengguna tidak valid."
      );
    }

    if (
      displayName.length < 2 ||
      displayName.length > 80
    ) {
      throw new Error(
        "Nama pengguna harus berisi 2–80 karakter."
      );
    }

    if (!/^[a-z0-9_.]{3,30}$/.test(username)) {
      throw new Error(
        "Format username tidak valid."
      );
    }

    // Kata sandi dan token tidak boleh diteruskan.
    return {
      id: id,
      email: email,
      displayName: displayName,
      username: username,
      createdAt: input.createdAt || null
    };
  }

  // ================================================
  // JALUR DATA MENUJU MX
  // ================================================

  async function forwardToMX(type, record) {
    const payload = {
      source: "MEXA_DATA_MANAGEMENT",
      type: type,
      version: VERSION,
      createdAt: new Date().toISOString(),
      record: copyRecord(record)
    };

    const receiver =
      mxReceiver || window.MEXA_MX;

    // Jalur langsung jika MX menyediakan API penerima.
    if (
      receiver &&
      typeof receiver.receiveManagedData === "function"
    ) {
      try {
        const result =
          await receiver.receiveManagedData(payload);

        if (result && result.accepted === true) {
          forwardedToMX += 1;

          emit("mexa:data-management:mx-forwarded", {
            type: type,
            accepted: true
          });

          return {
            confirmed: true,
            channel: "MEXA_MX.receiveManagedData"
          };
        }

        return {
          confirmed: false,
          reason:
            "MX belum memberikan konfirmasi penerimaan."
        };
      } catch (error) {
        lastError = String(
          error.message || error
        );

        failed += 1;

        console.error(
          "[MEXA DATA MANAGEMENT] Pengiriman ke MX gagal:",
          error
        );

        return {
          confirmed: false,
          reason: lastError
        };
      }
    }

    // Jalur event jika MX belum menyediakan API langsung.
    emit("mexa:mx:managed-data", payload);

    return {
      confirmed: false,
      channel: "mexa:mx:managed-data",
      reason:
        "Event dikirim; penerima MX belum terkonfirmasi."
    };
  }

  // ================================================
  // 1. MENERIMA RECORD REGISTRY DARI PENGHUBUNG 2
  // ================================================

  async function receiveRegistryRecord(input) {
    try {
      const record =
        normalizeRegistryRecord(input);

      // Update record berdasarkan nama sistem.
      registryRecords.set(record.name, record);
      receivedRegistry += 1;
      lastError = null;

      emit(
        "mexa:data-management:registry-received",
        {
          name: record.name,
          accepted: true,
          record: copyRecord(record)
        }
      );

      const mxResult = await forwardToMX(
        "registry",
        record
      );

      return {
        accepted: true,
        stored: true,
        destination: "MEXA_DATA_MANAGEMENT",
        name: record.name,
        mx: mxResult
      };
    } catch (error) {
      failed += 1;
      lastError = String(
        error.message || error
      );

      console.error(
        "[MEXA DATA MANAGEMENT] Registry ditolak:",
        error
      );

      return {
        accepted: false,
        error: lastError
      };
    }
  }

  // ================================================
  // 2. MENERIMA PENGGUNA DARI PENGHUBUNG 2
  // ================================================

  async function receiveRegisteredUser(input) {
    try {
      const record =
        normalizeRegisteredUser(input);

      // Simpan berdasarkan ID Auth pengguna.
      registeredUsers.set(record.id, record);
      receivedUsers += 1;
      lastError = null;

      emit(
        "mexa:data-management:user-received",
        {
          id: record.id,
          username: record.username,
          accepted: true
        }
      );

      const mxResult = await forwardToMX(
        "registered-user",
        record
      );

      return {
        accepted: true,
        stored: true,
        destination: "MEXA_DATA_MANAGEMENT",
        userId: record.id,
        mx: mxResult
      };
    } catch (error) {
      failed += 1;
      lastError = String(
        error.message || error
      );

      console.error(
        "[MEXA DATA MANAGEMENT] Pengguna ditolak:",
        error
      );

      return {
        accepted: false,
        error: lastError
      };
    }
  }

  // ================================================
  // 3. KONEKSI DENGAN MX
  // MX HARUS MENYEDIAKAN receiveManagedData(payload)
  // ================================================

  function connectMX(api) {
    if (
      !api ||
      typeof api.receiveManagedData !== "function"
    ) {
      throw new TypeError(
        "MX harus menyediakan " +
        "receiveManagedData(payload)."
      );
    }

    mxReceiver = api;

    emit("mexa:data-management:mx-connected", {
      connected: true
    });

    return getStatus();
  }

  // MX dapat mengumumkan bahwa penerimanya siap.
  document.addEventListener(
    "mexa:mx:ready",
    function (event) {
      const api =
        event.detail && event.detail.api
          ? event.detail.api
          : window.MEXA_MX;

      if (!api) return;

      try {
        connectMX(api);
      } catch (error) {
        lastError = String(
          error.message || error
        );

        console.error(
          "[MEXA DATA MANAGEMENT] Koneksi MX:",
          error
        );
      }
    }
  );

  // ================================================
  // 4. API BACA UNTUK MX DAN PEMERIKSAAN SISTEM
  // ================================================

  function getRegistryRecord(name) {
    const record = registryRecords.get(
      String(name || "").trim().toLowerCase()
    );

    return record ? copyRecord(record) : null;
  }

  function getRegistryRecords() {
    return Array.from(
      registryRecords.values()
    ).map(copyRecord);
  }

  function getRegisteredUser(id) {
    const record = registeredUsers.get(
      String(id || "").trim()
    );

    return record ? copyRecord(record) : null;
  }

  function getRegisteredUsers() {
    return Array.from(
      registeredUsers.values()
    ).map(copyRecord);
  }

  function getSnapshot() {
    return {
      version: VERSION,
      registry: getRegistryRecords(),
      users: getRegisteredUsers(),
      createdAt: new Date().toISOString()
    };
  }

  function getStatus() {
    return {
      name: "MEXA DATA MANAGEMENT",
      version: VERSION,
      ready: true,

      registryCount: registryRecords.size,
      usersCount: registeredUsers.size,

      receivedRegistry: receivedRegistry,
      receivedUsers: receivedUsers,
      forwardedToMX: forwardedToMX,
      failed: failed,

      mxConnected: Boolean(
        (mxReceiver || window.MEXA_MX) &&
        typeof (
          (mxReceiver || window.MEXA_MX)
            .receiveManagedData
        ) === "function"
      ),

      lastError: lastError
    };
  }

  // ================================================
  // DAFTARKAN API GLOBAL
  // ================================================

  const api = Object.freeze({
    version: VERSION,

    receiveRegistryRecord,
    receiveRegisteredUser,

    connectMX,

    getRegistryRecord,
    getRegistryRecords,
    getRegisteredUser,
    getRegisteredUsers,

    getSnapshot,
    getStatus
  });

  window.MEXA_DATA_MANAGEMENT = api;

  // Sambungkan otomatis jika MX sudah dimuat.
  if (
    window.MEXA_MX &&
    typeof window.MEXA_MX.receiveManagedData === "function"
  ) {
    try {
      connectMX(window.MEXA_MX);
    } catch (error) {
      lastError = String(
        error.message || error
      );
    }
  }

  // Beri tahu Penghubung 2 bahwa API siap.
  emit("mexa:data-management:ready", {
    version: VERSION,
    api: api
  });

  console.info(
    "[MEXA DATA MANAGEMENT] Aktif — versi " +
    VERSION
  );

})(window, document);
