/* =====================================================
   MEXA SMART — SYSTEM PENGELOLAAN DATA
   VERSION: 1.0.0

   PENERIMA:
   - receiveRegistryRecord(record)
   - receiveRegisteredUser(record)
   - receiveProfileRecord(record)

   PEMINTA DATA:
   - getCurrentProfile()
   - getProfileById(id)

   MX meminta data dari sini.
   Modul ini tidak membuat koneksi Supabase.
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

  const registry = new Map();
  const users = new Map();
  const profiles = new Map();

  let currentProfileId = null;
  let lastError = null;

  function copy(data) {
    return data ? { ...data } : null;
  }

  function emit(name, detail) {
    document.dispatchEvent(
      new window.CustomEvent(name, { detail })
    );
  }

  // ================================================
  // 1. MENERIMA DATA REGISTRY DARI PENGHUBUNG 2
  // ================================================

  function receiveRegistryRecord(record) {
    if (
      !record ||
      typeof record.name !== "string" ||
      !record.name.trim() ||
      typeof record.title !== "string" ||
      !record.title.trim()
    ) {
      return {
        accepted: false,
        error: "Data Registry tidak valid."
      };
    }

    const data = {
      ...record,
      name: record.name.trim().toLowerCase(),
      title: record.title.trim()
    };

    registry.set(data.name, data);

    emit("mexa:management:registry-received", {
      name: data.name
    });

    return {
      accepted: true,
      destination: "MEXA_DATA_MANAGEMENT",
      name: data.name
    };
  }

  // ================================================
  // 2. MENERIMA DATA DASAR PENGGUNA
  // Bukan pengganti data lengkap public.profiles.
  // ================================================

  function receiveRegisteredUser(record) {
    if (
      !record ||
      typeof record.id !== "string" ||
      !record.id.trim()
    ) {
      return {
        accepted: false,
        error: "ID pengguna tidak valid."
      };
    }

    const data = {
      id: record.id,
      email: record.email || "",
      displayName: record.displayName || "",
      username: record.username || "",
      createdAt: record.createdAt || null
    };

    users.set(data.id, data);

    emit("mexa:management:user-received", {
      id: data.id
    });

    return {
      accepted: true,
      destination: "MEXA_DATA_MANAGEMENT",
      userId: data.id
    };
  }

  // ================================================
  // 3. MENERIMA PROFIL LENGKAP DARI SYSTEM CENTER
  // melalui Penghubung 2.
  // Nama kolom mengikuti public.profiles.
  // ================================================

  function receiveProfileRecord(record) {
    if (
      !record ||
      typeof record !== "object" ||
      typeof record.id !== "string" ||
      !record.id.trim()
    ) {
      return {
        accepted: false,
        error: "Data profil tidak valid."
      };
    }

    const data = {
      id: record.id,
      email: record.email || "",
      display_name: record.display_name || "",
      username: record.username || "",
      avatar_url: record.avatar_url || null,
      cover_url: record.cover_url || null,
      bio: record.bio || "",
      location: record.location || "",
      website: record.website || "",
      created_at: record.created_at || null,
      updated_at: record.updated_at || null
    };

    // Simpan di memori modul selama halaman aktif.
    profiles.set(data.id, data);

    // Profil ini menjadi konteks aktif jika System Center
    // mengirim profil pengguna yang sedang login.
    currentProfileId = data.id;
    lastError = null;

    emit("mexa:management:profile-received", {
      userId: data.id
    });

    return {
      accepted: true,
      destination: "MEXA_DATA_MANAGEMENT",
      userId: data.id
    };
  }

  // ================================================
  // 4. MX MEMINTA PROFIL DARI PENGELOLAAN DATA
  // Tidak membaca Supabase secara langsung.
  // ================================================

  function getCurrentProfile() {
    if (!currentProfileId) {
      return {
        accepted: false,
        data: null,
        error:
          "Profil belum diterima dari System Center."
      };
    }

    const profile = profiles.get(currentProfileId);

    if (!profile) {
      return {
        accepted: false,
        data: null,
        error: "Data profil belum tersedia."
      };
    }

    return {
      accepted: true,
      source: "MEXA_DATA_MANAGEMENT",
      data: copy(profile)
    };
  }

  // Untuk mengambil profil berdasarkan ID tertentu.
  // Data harus sudah tersedia di memori pengelolaan.
  function getProfileById(id) {
    if (typeof id !== "string" || !id.trim()) {
      return {
        accepted: false,
        data: null,
        error: "ID profil tidak valid."
      };
    }

    const profile = profiles.get(id);

    if (!profile) {
      return {
        accepted: false,
        data: null,
        error: "Profil belum tersedia di pengelolaan data."
      };
    }

    return {
      accepted: true,
      source: "MEXA_DATA_MANAGEMENT",
      data: copy(profile)
    };
  }

  // ================================================
  // 5. STATUS SISTEM
  // ================================================

  function getStatus() {
    return {
      name: "MEXA DATA MANAGEMENT",
      version: VERSION,
      ready: true,
      registryCount: registry.size,
      userCount: users.size,
      profileCount: profiles.size,
      currentProfileLoaded: Boolean(currentProfileId),
      lastError: lastError
    };
  }

  const api = Object.freeze({
    version: VERSION,

    receiveRegistryRecord,
    receiveRegisteredUser,
    receiveProfileRecord,

    getCurrentProfile,
    getProfileById,

    getStatus
  });

  window.MEXA_DATA_MANAGEMENT = api;

  emit("mexa:data-management:ready", {
    version: VERSION,
    api: api
  });

  console.info(
    "[MEXA DATA MANAGEMENT] API siap."
  );

})(window, document);
