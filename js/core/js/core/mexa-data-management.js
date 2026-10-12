/* =====================================================
   MEXA SMART — SYSTEM PENGELOLAAN DATA
   Version: 1.0.1

   PENERIMA:
   - receiveRegistryRecord(record)
   - receiveRegisteredUser(record)

   TUJUAN:
   System Pengelolaan Data -> MX

   Catatan:
   Tidak membuat koneksi Supabase sendiri.
   Tidak menganggap data sudah sampai ke MX
   sebelum ada konfirmasi penerimaan.
   ===================================================== */

(function (window, document) {
  "use strict";

  const VERSION = "1.0.1";

  if (window.MEXA_DATA_MANAGEMENT) {
    console.warn(
      "[MEXA DATA MANAGEMENT] Sistem sudah terdaftar."
    );
    return;
  }

  const registryRecords = new Map();
  const registeredUsers = new Map();
  const pendingToMX = new Map();

  let mxReceiver = null;
  let sequence = 0;
  let receivedRegistry = 0;
  let receivedUsers = 0;
  let deliveredToMX = 0;
  let failed = 0;
  let lastError = null;

  // ---------------------------------------------------
  // EVENT INTERNAL
  // ---------------------------------------------------

  function emit(name, detail) {
    document.dispatchEvent(
      new window.CustomEvent(name, {
        detail: detail
      })
    );
  }

  function clone(record) {
    return Object.assign({}, record);
  }

  // ---------------------------------------------------
  // VALIDASI REGISTRY
  // Format mengikuti Penghubung 2
  // ---------------------------------------------------

  function normalizeRegistryRecord(input) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input)
    ) {
      throw new Error(
        "Record Registry harus berupa objek."
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

    if (!name || !title) {
      throw new Error(
        "Nama dan judul sistem wajib tersedia."
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
      updated_at: input.updated_at || null
    };
  }

  // ---------------------------------------------------
  // VALIDASI PENGGUNA
  // Hanya data aman yang diteruskan.
  // Kata sandi dan token tidak ikut disimpan.
  // ---------------------------------------------------

  function normalizeUserRecord(input) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input)
    ) {
      throw new Error(
        "Record pengguna harus berupa objek."
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
      throw new Error("ID pengguna tidak tersedia.");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Email pengguna tidak valid.");
    }

    if (
      displayName.length < 2 ||
      displayName.length > 80
    ) {
      throw new Error("Nama pengguna tidak valid.");
    }

    if (!/^[a-z0-9_.]{3,30}$/.test(username)) {
      throw new Error("Username tidak valid.");
    }

    return {
      id: id,
      email: email,
      displayName: displayName,
      username: username,
      createdAt: input.createdAt || null
    };
  }

  // ---------------------------------------------------
  // ANTREAN MENUJU MX
  // ---------------------------------------------------

  function createMXPayload(type, record) {
    sequence += 1;

    return {
      id: "mexa-data-" +
        Date.now() + "-" + sequence,

      source: "MEXA_DATA_MANAGEMENT",
      type: type,
      version: VERSION,
      createdAt: new Date().toISOString(),
      record: clone(record)
    };
  }

  async function sendToMX(payload) {
    const receiver =
      mxReceiver || window.MEXA_MX;

    // Jalur langsung hanya digunakan bila MX
    // benar-benar menyediakan API penerima.
    if (
      receiver &&
      typeof receiver.receiveManagedData === "function"
    ) {
      try {
        const result = await receiver.receiveManagedData(
          clone(payload)
        );

        if (result && result.accepted === true) {
          pendingToMX.delete(payload.id);
          deliveredToMX += 1;
          lastError = null;

          emit("mexa:data-management:mx-confirmed", {
            id: payload.id,
            type: payload.type,
            accepted: true
          });

          return {
            confirmed: true,
            destination: "MX"
          };
        }

        return {
          confirmed: false,
          queued: true,
          reason: "MX belum mengonfirmasi penerimaan."
        };
      } catch (error) {
        lastError = String(error.message || error);
        failed += 1;

        return {
          confirmed: false,
          queued: true,
          reason: lastError
        };
      }
    }

    // Belum ada API MX yang dapat dikonfirmasi.
    // Simpan dalam antrean memori dan keluarkan event
    // agar MX dapat mendengarkan jalur ini.
    emit("mexa:mx:managed-data", clone(payload));

    return {
      confirmed: false,
      queued: true,
      reason: "Penerima MX belum terhubung."
    };
  }

  async function queueForMX(type, record) {
    const payload = createMXPayload(type, record);

    pendingToMX.set(payload.id, payload);

    return await sendToMX(payload);
  }

  // ---------------------------------------------------
  // PENERIMA DARI PENGHUBUNG 2
  // ---------------------------------------------------

  async function receiveRegistryRecord(input) {
    try {
      const record = normalizeRegistryRecord(input);

      registryRecords.set(record.name, record);
      receivedRegistry += 1;
      lastError = null;

      emit("mexa:data-management:registry-received", {
        name: record.name,
        accepted: true
      });

      const mx = await queueForMX("registry", record);

      return {
        accepted: true,
        managed: true,
        destination: "MEXA_DATA_MANAGEMENT",
        name: record.name,
        mx: mx
      };
    } catch (error) {
      failed += 1;
      lastError = String(error.message || error);

      return {
        accepted: false,
        error: lastError
      };
    }
  }

  async function receiveRegisteredUser(input) {
    try {
      const record = normalizeUserRecord(input);

      registeredUsers.set(record.id, record);
      receivedUsers += 1;
      lastError = null;

      emit("mexa:data-management:user-received", {
        id: record.id,
        username: record.username,
        accepted: true
      });

      const mx = await queueForMX(
        "registered-user",
        record
      );

      return {
        accepted: true,
        managed: true,
        destination: "MEXA_DATA_MANAGEMENT",
        userId: record.id,
        mx: mx
      };
    } catch (error) {
      failed += 1;
      lastError = String(error.message || error);

      return {
        accepted: false,
        error: lastError
      };
    }
  }

  // ---------------------------------------------------
  // KONEKSI MX
  // ---------------------------------------------------

  function connectMX(api) {
    if (
      !api ||
      typeof api.receiveManagedData !== "function"
    ) {
      throw new Error(
        "MX belum menyediakan receiveManagedData(payload)."
      );
    }

    mxReceiver = api;

    emit("mexa:data-management:mx-connected", {
      connected: true
    });

    return getStatus();
  }

  async function flushMXQueue() {
    if (
      !mxReceiver ||
      typeof mxReceiver.receiveManagedData !== "function"
    ) {
      return {
        connected: false,
        sent: 0,
        pending: pendingToMX.size
      };
    }

    let sent = 0;

    for (const payload of Array.from(
      pendingToMX.values()
    )) {
      const result = await sendToMX(payload);

      if (result.confirmed) {
        sent += 1;
      }
    }

    return {
      connected: true,
      sent: sent,
      pending: pendingToMX.size
    };
  }

  // Dipakai MX bila menggunakan jalur event.
  function acknowledgeMX(id, accepted) {
    if (accepted !== true || !pendingToMX.has(id)) {
      return false;
    }

    pendingToMX.delete(id);
    deliveredToMX += 1;

    emit("mexa:data-management:mx-confirmed", {
      id: id,
      accepted: true
    });

    return true;
  }

  // ---------------------------------------------------
  // BACA DATA DAN STATUS
  // ---------------------------------------------------

  function getRegistryRecords() {
    return Array.from(
      registryRecords.values()
    ).map(clone);
  }

  function getRegisteredUsers() {
    return Array.from(
      registeredUsers.values()
    ).map(clone);
  }

  function getPendingForMX() {
    return Array.from(
      pendingToMX.values()
    ).map(clone);
  }

  function getStatus() {
    const receiver =
      mxReceiver || window.MEXA_MX;

    return {
      name: "MEXA DATA MANAGEMENT",
      version: VERSION,
      ready: true,

      registryCount: registryRecords.size,
      usersCount: registeredUsers.size,
      pendingToMX: pendingToMX.size,

      receivedRegistry: receivedRegistry,
      receivedUsers: receivedUsers,
      deliveredToMX: deliveredToMX,
      failed: failed,

      mxConnected: Boolean(
        receiver &&
        typeof receiver.receiveManagedData === "function"
      ),

      lastError: lastError
    };
  }

  // ---------------------------------------------------
  // DAFTARKAN API GLOBAL
  // Kontrak harus cocok dengan Penghubung 2
  // dan mx-space.html.
  // ---------------------------------------------------

  const api = Object.freeze({
    version: VERSION,

    receiveRegistryRecord: receiveRegistryRecord,
    receiveRegisteredUser: receiveRegisteredUser,

    connectMX: connectMX,
    flushMXQueue: flushMXQueue,
    acknowledgeMX: acknowledgeMX,

    getRegistryRecords: getRegistryRecords,
    getRegisteredUsers: getRegisteredUsers,
    getPendingForMX: getPendingForMX,
    getStatus: getStatus
  });

  window.MEXA_DATA_MANAGEMENT = api;

  // Beri tahu Penghubung 2 bahwa penerima siap.
  emit("mexa:data-management:ready", {
    version: VERSION,
    api: api
  });

  console.info(
    "[MEXA DATA MANAGEMENT] API siap — versi " +
    VERSION
  );

})(window, document);
