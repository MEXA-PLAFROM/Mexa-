/* =====================================================
   MEXA SMART — SYSTEM CENTER
   File: js/core/mexa-system-center.js
   Version: 1.0.0

   JALUR RESMI:
   MEXA_HTML_REGISTRY
          ↓
   MEXA_CONNECTOR_1.receiveRegistry(payload)
          ↓
   MEXA_SYSTEM_CENTER.receiveRegistration(record)
          ↓
   SUPABASE: mexa_system_registry
          ↓
   HASIL PENYIMPANAN KEMBALI KE SYSTEM CENTER
          ↓
   MEXA_DATA_MANAGEMENT.receiveRegistryRecord(record)

   Hanya System Center yang memiliki koneksi Supabase.
   ===================================================== */

(function (window, document) {
  "use strict";

  if (window.MEXA_SYSTEM_CENTER) {
    console.warn("[MEXA CENTER] Sudah aktif.");
    return;
  }

  const VERSION = "1.0.0";
  const TABLE = "mexa_system_registry";

  /*
   * Isi dengan URL proyek dan Publishable/anon public key
   * Supabase milik proyek MEXA yang benar.
   *
   * Jangan pernah menggunakan service_role/secret key
   * di JavaScript yang diterbitkan ke GitHub Pages.
   */
  const CONFIG = {
    SUPABASE_URL: "https://ISI_PROJECT_REF.supabase.co",
    SUPABASE_ANON_KEY: "ISI_PUBLISHABLE_ATAU_ANON_KEY"
  };

  let client = null;
  let clientPromise = null;
  let connecting = false;
  let lastError = null;
  let successfulWrites = 0;

  // Catatan yang sudah disimpan tetapi belum diterima
  // oleh System Pengelolaan Data.
  const pendingManagement = new Map();

  /* ===================================================
     UTILITAS
     =================================================== */

  function emit(eventName, detail) {
    document.dispatchEvent(
      new window.CustomEvent(eventName, { detail })
    );
  }

  function normalizeName(name) {
    if (typeof name !== "string" || !name.trim()) {
      throw new TypeError("Nama pendaftaran tidak valid.");
    }

    return name.trim().toLowerCase();
  }

  function getManagement() {
    const manager = window.MEXA_DATA_MANAGEMENT;

    if (
      !manager ||
      typeof manager.receiveRegistryRecord !== "function"
    ) {
      return null;
    }

    return manager;
  }

  /* ===================================================
     MEMUAT SUPABASE SDK
     =================================================== */

  let sdkPromise = null;

  function loadSupabaseSDK() {
    if (
      window.supabase &&
      typeof window.supabase.createClient === "function"
    ) {
      return Promise.resolve();
    }

    if (sdkPromise) return sdkPromise;

    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");

      script.src =
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

      script.async = true;

      script.onload = function () {
        if (
          window.supabase &&
          typeof window.supabase.createClient === "function"
        ) {
          resolve();
        } else {
          reject(new Error("Supabase SDK tidak tersedia."));
        }
      };

      script.onerror = function () {
        reject(new Error("Supabase SDK gagal dimuat."));
      };

      document.head.appendChild(script);
    }).catch(error => {
      sdkPromise = null;
      throw error;
    });

    return sdkPromise;
  }

  /* ===================================================
     KONEKSI DATABASE
     Koneksi hanya dibuat di System Center.
     =================================================== */

  async function connect() {
    if (client) return client;
    if (clientPromise) return clientPromise;

    clientPromise = (async function () {
      const url = CONFIG.SUPABASE_URL.trim();
      const key = CONFIG.SUPABASE_ANON_KEY.trim();

      if (
        !url ||
        !key ||
        url.includes("ISI_PROJECT_REF") ||
        key.includes("ISI_PUBLISHABLE")
      ) {
        throw new Error(
          "Konfigurasi Supabase di System Center belum diisi."
        );
      }

      if (!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(url)) {
        throw new Error("URL Supabase tidak valid.");
      }

      connecting = true;

      try {
        await loadSupabaseSDK();

        const candidate = window.supabase.createClient(
          url.replace(/\/$/, ""),
          key,
          {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
              detectSessionInUrl: false
            }
          }
        );

        // Pastikan tabel bisa diakses sebelum menggunakannya.
        const check = await candidate
          .from(TABLE)
          .select("name")
          .limit(1);

        if (check.error) {
          throw new Error(
            "Tabel " + TABLE +
            " belum dapat diakses: " + check.error.message
          );
        }

        client = candidate;
        lastError = null;

        console.info("[MEXA CENTER] Supabase terhubung.");

        emit("mexa:center:connected", {
          table: TABLE
        });

        return client;
      } finally {
        connecting = false;
      }
    })().catch(error => {
      client = null;
      lastError = String(error.message || error);
      throw error;
    }).finally(() => {
      clientPromise = null;
    });

    return clientPromise;
  }

  /* ===================================================
     NORMALISASI PENDAFTARAN
     Format disesuaikan dengan Registry HTML.
     =================================================== */

  function normalizeRecord(input) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input)
    ) {
      throw new TypeError("Data pendaftaran harus berupa objek.");
    }

    const name = normalizeName(input.name);

    if (
      typeof input.title !== "string" ||
      !input.title.trim()
    ) {
      throw new Error(
        'Judul pendaftaran "' + name + '" tidak valid.'
      );
    }

    if (
      !Number.isInteger(input.position) ||
      input.position < 1
    ) {
      throw new Error(
        'Posisi pendaftaran "' + name + '" tidak valid.'
      );
    }

    if (
      input.file !== null &&
      input.file !== undefined &&
      typeof input.file !== "string"
    ) {
      throw new Error(
        'Jalur file "' + name + '" tidak valid.'
      );
    }

    const status = input.status === "ready"
      ? "ready"
      : "registered";

    return {
      name,
      title: input.title.trim(),
      version: input.version || VERSION,
      system_type: input.type || "module",
      file_path: input.file || null,
      position: input.position,
      description: input.description || "",
      status,
      updated_at: new Date().toISOString()
    };
  }

  /* ===================================================
     KIRIM HASIL DATABASE KE SYSTEM PENGELOLAAN DATA

     Kontrak yang disiapkan:
     MEXA_DATA_MANAGEMENT.receiveRegistryRecord(record)

     Pusat meneruskan hasil Supabase, bukan data mentah
     sebelum penyimpanan.
     =================================================== */

  async function forwardToManagement(savedRecord) {
    const manager = getManagement();

    if (!manager) {
      pendingManagement.set(savedRecord.name, savedRecord);

      return {
        forwarded: false,
        status: "waiting-for-data-management"
      };
    }

    try {
      const response = await manager.receiveRegistryRecord({
        ...savedRecord
      });

      if (
        !response ||
        response.accepted !== true
      ) {
        throw new Error(
          "System Pengelolaan Data belum mengonfirmasi penerimaan."
        );
      }

      pendingManagement.delete(savedRecord.name);

      emit("mexa:center:forwarded-to-management", {
        name: savedRecord.name
      });

      return {
        forwarded: true,
        status: "delivered"
      };
    } catch (error) {
      pendingManagement.set(savedRecord.name, savedRecord);

      console.error(
        "[MEXA CENTER] Penerusan ke pengelolaan data gagal:",
        error
      );

      return {
        forwarded: false,
        status: "pending",
        error: String(error.message || error)
      };
    }
  }

  /* ===================================================
     PENERIMA RESMI DARI PENGHUBUNG 1

     Penghubung 1 mengharapkan:
     { accepted: true, persisted: true }
     =================================================== */

  async function receiveRegistration(input) {
    const row = normalizeRecord(input);
    const supabase = await connect();

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(row, {
        onConflict: "name"
      })
      .select(
        "name,title,version,system_type,file_path," +
        "position,description,status,created_at,updated_at"
      )
      .single();

    if (error) {
      lastError = error.message;

      throw new Error(
        'Gagal menyimpan "' + row.name +
        '" ke Supabase: ' + error.message
      );
    }

    if (!data || data.name !== row.name) {
      throw new Error(
        "Supabase tidak mengembalikan hasil penyimpanan yang valid."
      );
    }

    // Di titik ini Supabase sudah mengembalikan baris tersimpan.
    successfulWrites += 1;
    lastError = null;

    console.info(
      "[MEXA CENTER] Pendaftaran berhasil disimpan:",
      data.name
    );

    emit("mexa:center:registration-saved", {
      name: data.name,
      record: data
    });

    // Teruskan record hasil database, bukan record mentah.
    const management = await forwardToManagement(data);

    return {
      accepted: true,
      persisted: true,
      name: data.name,
      record: data,
      management
    };
  }

  /* ===================================================
     SAMBUNGKAN SYSTEM PENGELOLAAN DATA

     Dapat dipanggil ketika modul pengelolaan selesai
     dimuat. Semua data dibaca kembali dari Supabase.
     =================================================== */

  async function connectDataManagement(manager) {
    if (
      !manager ||
      typeof manager.receiveRegistryRecord !== "function"
    ) {
      throw new TypeError(
        "System Pengelolaan Data harus menyediakan " +
        "receiveRegistryRecord(record)."
      );
    }

    const supabase = await connect();

    const { data, error } = await supabase
      .from(TABLE)
      .select(
        "name,title,version,system_type,file_path," +
        "position,description,status,created_at,updated_at"
      )
      .order("position", { ascending: true });

    if (error) {
      lastError = error.message;
      throw new Error(
        "Gagal mengambil Registry dari Supabase: " +
        error.message
      );
    }

    const results = [];

    for (const record of data || []) {
      try {
        const response =
          await manager.receiveRegistryRecord({ ...record });

        if (!response || response.accepted !== true) {
          throw new Error(
            "System Pengelolaan Data menolak " + record.name
          );
        }

        pendingManagement.delete(record.name);

        results.push({
          name: record.name,
          forwarded: true
        });
      } catch (error) {
        pendingManagement.set(record.name, record);

        results.push({
          name: record.name,
          forwarded: false,
          error: String(error.message || error)
        });
      }
    }

    return {
      totalFromSupabase: (data || []).length,
      results
    };
  }

  /* ===================================================
     BACA DATA TERSIMPAN
     =================================================== */

  async function listRegistrations() {
    const supabase = await connect();

    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .order("position", { ascending: true });

    if (error) {
      lastError = error.message;
      throw new Error(
        "Gagal membaca Registry: " + error.message
      );
    }

    return data || [];
  }

  function getPendingManagement() {
    return Array.from(pendingManagement.values())
      .map(record => ({ ...record }));
  }

  function getStatus() {
    return {
      name: "MEXA SYSTEM CENTER",
      version: VERSION,
      ready: true,
      connected: Boolean(client),
      connecting,
      table: TABLE,
      successfulWrites,
      pendingManagement: pendingManagement.size,
      lastError
    };
  }

  /* ===================================================
     API PUBLIK — NAMA DIKUNCI
     =================================================== */

  window.MEXA_SYSTEM_CENTER = Object.freeze({
    version: VERSION,
    connect,
    receiveRegistration,
    listRegistrations,
    connectDataManagement,
    getPendingManagement,
    getStatus
  });

  /*
   * Beri tahu Penghubung 1 bahwa API pusat tersedia.
   * Penghubung 1 akan mencoba mengirim antreannya.
   */
  emit("mexa:center:ready", {
    api: window.MEXA_SYSTEM_CENTER
  });

  /*
   * Jika System Pengelolaan Data sudah tersedia,
   * sinkronkan data yang ada di Supabase.
   */
  const existingManager = getManagement();

  if (existingManager) {
    connectDataManagement(existingManager).catch(error => {
      lastError = String(error.message || error);
      console.error("[MEXA CENTER] Sinkronisasi gagal:", error);
    });
  }

  /*
   * Bila Pengelolaan Data dimuat setelah pusat,
   * gunakan event kesiapan yang sama.
   */
  document.addEventListener(
    "mexa:data-management:ready",
    function (event) {
      const manager =
        event.detail?.api || getManagement();

      if (!manager) return;

      connectDataManagement(manager).catch(error => {
        lastError = String(error.message || error);
        console.error(
          "[MEXA CENTER] Sambungan pengelolaan gagal:",
          error
        );
      });
    }
  );

  console.info(
    "[MEXA CENTER] API penerima pendaftaran siap."
  );

})(window, document);
