/* =====================================================
   MEXA SMART — SYSTEM PENGELOLAAN DATA
   File: js/core/mexa-data-management.js
   Version: 1.0.0

   JALUR RESMI:
   MEXA SYSTEM CENTER
          ↓
   MEXA CONNECTOR 2
          ↓
   MEXA DATA MANAGEMENT
          ↓
   MODUL YANG MEMBUTUHKAN DATA

   Kontrak Penghubung 2:
   - receiveRegistryRecord(record)
   - receiveRegisteredUser(record)

   System ini tidak membuat koneksi Supabase sendiri.
   ===================================================== */

(function (window, document) {
  "use strict";

  if (window.MEXA_DATA_MANAGEMENT) {
    console.warn(
      "[MEXA DATA MANAGEMENT] Sudah aktif."
    );
    return;
  }

  const VERSION = "1.0.0";

  const registryRecords = new Map();
  const usersById = new Map();
  const userIdByUsername = new Map();

  let registryReceived = 0;
  let usersReceived = 0;
  let lastError = null;

  /* ===================================================
     UTILITAS
     =================================================== */

  function emit(eventName, detail) {
    document.dispatchEvent(
      new window.CustomEvent(eventName, { detail })
    );
  }

  function normalizeName(value) {
    if (
      typeof value !== "string" ||
      !value.trim()
    ) {
      throw new TypeError(
        "Nama data harus berupa teks yang valid."
      );
    }

    return value.trim().toLowerCase();
  }

  function copy(record) {
    return { ...record };
  }

  function reportError(error) {
    lastError = String(
      error && error.message
        ? error.message
        : error
    );

    console.error(
      "[MEXA DATA MANAGEMENT]",
      lastError
    );

    return lastError;
  }

  /* ===================================================
     1. MENERIMA DATA REGISTRY DARI PENGHUBUNG 2
     =================================================== */

  function receiveRegistryRecord(input) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input)
    ) {
      throw new TypeError(
        "Data Registry harus berupa objek."
      );
    }

    const name = normalizeName(input.name);

    if (
      typeof input.title !== "string" ||
      !input.title.trim()
    ) {
      throw new Error(
        'Judul Registry "' + name + '" tidak valid.'
      );
    }

    const position = Number.isInteger(input.position)
      ? input.position
      : null;

    if (position !== null && position < 1) {
      throw new Error(
        'Posisi Registry "' + name + '" tidak valid.'
      );
    }

    const file = input.file_path !== undefined
      ? input.file_path
      : input.file;

    if (
      file !== null &&
      file !== undefined &&
      typeof file !== "string"
    ) {
      throw new Error(
        'Lokasi file Registry "' + name + '" tidak valid.'
      );
    }

    const previous = registryRecords.get(name);

    /*
     * Hanya field Registry yang diizinkan disimpan.
     * Input tambahan tidak otomatis dipercaya.
     */
    const record = Object.freeze({
      name,
      title: input.title.trim(),
      version:
        typeof input.version === "string"
          ? input.version
          : VERSION,
      type:
        typeof input.system_type === "string"
          ? input.system_type
          : typeof input.type === "string"
            ? input.type
            : "module",
      file: file || null,
      position,
      description:
        typeof input.description === "string"
          ? input.description
          : "",
      status:
        input.status === "ready"
          ? "ready"
          : "registered",
      createdAt:
        previous?.createdAt ||
        input.created_at ||
        new Date().toISOString(),
      updatedAt:
        input.updated_at ||
        new Date().toISOString()
    });

    registryRecords.set(name, record);

    registryReceived += 1;
    lastError = null;

    emit("mexa:data-management:registry-record-received", {
      record: copy(record)
    });

    console.info(
      "[MEXA DATA MANAGEMENT] Registry diterima:",
      name
    );

    return {
      accepted: true,
      name,
      stored: true,
      storage: "memory"
    };
  }

  /* ===================================================
     2. MENERIMA DATA PENGGUNA DARI PENGHUBUNG 2

     Password dan token autentikasi tidak diterima.
     Identitas akun dibuat oleh Supabase Auth di System
     Center. Fungsi ini hanya mengelola data aman.
     =================================================== */

  function receiveRegisteredUser(input) {
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
        "ID pengguna dari System Pusat tidak tersedia."
      );
    }

    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      throw new Error(
        "Email pengguna tidak valid."
      );
    }

    if (
      displayName.length < 2 ||
      displayName.length > 80
    ) {
      throw new Error(
        "Nama lengkap pengguna tidak valid."
      );
    }

    if (!/^[a-z0-9_.]{3,30}$/.test(username)) {
      throw new Error(
        "Format username pengguna tidak valid."
      );
    }

    const previous = usersById.get(id);

    /*
     * Tolak username yang sudah terikat ke akun berbeda.
     */
    const existingUserId = userIdByUsername.get(username);

    if (existingUserId && existingUserId !== id) {
      throw new Error(
        'Username "' + username +
        '" sudah terdaftar pada akun lain.'
      );
    }

    const oldUsername = previous?.username;

    if (
      oldUsername &&
      oldUsername !== username
    ) {
      userIdByUsername.delete(oldUsername);
    }

    /*
     * Daftar field dibuat secara eksplisit.
     * Password, access token, dan refresh token tidak disimpan.
     */
    const record = Object.freeze({
      id,
      email,
      displayName,
      username,
      createdAt:
        typeof input.createdAt === "string"
          ? input.createdAt
          : previous?.createdAt ||
            new Date().toISOString(),
      receivedAt: new Date().toISOString()
    });

    usersById.set(id, record);
    userIdByUsername.set(username, id);

    usersReceived += 1;
    lastError = null;

    emit("mexa:data-management:user-received", {
      user: copy(record)
    });

    console.info(
      "[MEXA DATA MANAGEMENT] Data pengguna diterima:",
      {
        id: record.id,
        username: record.username
      }
    );

    return {
      accepted: true,
      userId: record.id,
      username: record.username,
      stored: true,
      storage: "memory"
    };
  }

  /* ===================================================
     3. MENYEDIAKAN DATA REGISTRY UNTUK MODUL
     =================================================== */

  function getRegistryRecord(name) {
    const record = registryRecords.get(
      normalizeName(name)
    );

    return record ? copy(record) : null;
  }

  function listRegistryRecords() {
    return Array.from(registryRecords.values())
      .map(copy)
      .sort((a, b) => {
        return (a.position ?? Infinity) -
          (b.position ?? Infinity);
      });
  }

  /* ===================================================
     4. MENYEDIAKAN DATA PENGGUNA UNTUK MODUL
     =================================================== */

  function getUserById(id) {
    if (typeof id !== "string" || !id.trim()) {
      return null;
    }

    const user = usersById.get(id.trim());

    return user ? copy(user) : null;
  }

  function getUserByUsername(username) {
    const normalized = normalizeName(username);
    const id = userIdByUsername.get(normalized);

    if (!id) return null;

    const user = usersById.get(id);

    return user ? copy(user) : null;
  }

  function listUsers() {
    return Array.from(usersById.values())
      .map(copy);
  }

  /* ===================================================
     5. STATUS SYSTEM
     =================================================== */

  function getStatus() {
    return {
      name: "MEXA DATA MANAGEMENT",
      version: VERSION,
      ready: true,
      registryRecordsInMemory: registryRecords.size,
      usersInMemory: usersById.size,
      registryReceived,
      usersReceived,
      storage: "memory",
      lastError
    };
  }

  /* ===================================================
     6. API RESMI MEXA DATA MANAGEMENT
     =================================================== */

  const api = Object.freeze({
    version: VERSION,

    // Fungsi penerima yang wajib cocok dengan Connector 2.
    receiveRegistryRecord,
    receiveRegisteredUser,

    // API pembaca untuk modul berikutnya.
    getRegistryRecord,
    listRegistryRecords,
    getUserById,
    getUserByUsername,
    listUsers,

    getStatus
  });

  window.MEXA_DATA_MANAGEMENT = api;

  console.info(
    "[MEXA DATA MANAGEMENT] API siap.",
    getStatus()
  );

  /*
   * Beri tahu System Center dan Connector 2
   * bahwa penerima data sudah tersedia.
   */
  emit("mexa:data-management:ready", {
    api
  });

})(window, document);
