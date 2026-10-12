/* =====================================================
   MEXA SMART — SYSTEM CENTER
   Connector 1 → System Center → Supabase Auth
   Supabase Auth result → Center → Data Management
   ===================================================== */

(function (window, document) {
  "use strict";

  if (window.MEXA_SYSTEM_CENTER) {
    console.warn("[MEXA SYSTEM CENTER] Sudah aktif.");
    return;
  }

  const VERSION = "1.0.0";

  /*
   * GANTI DENGAN URL DAN PUBLISHABLE/ANON PUBLIC KEY
   * DARI PROYEK SUPABASE MEXA YANG BENAR.
   *
   * Jangan pernah memasukkan service_role atau secret key
   * ke JavaScript publik.
   */
  const CONFIG = Object.freeze({
    SUPABASE_URL: "https://GANTI_PROJECT_REF.supabase.co",
    SUPABASE_PUBLIC_KEY: "GANTI_DENGAN_PUBLISHABLE_ATAU_ANON_KEY"
  });

  let client = null;
  let connectionPromise = null;
  let sdkPromise = null;
  let registrationBusy = false;
  let lastError = null;
  let registrationsCompleted = 0;

  function emit(eventName, detail) {
    document.dispatchEvent(
      new window.CustomEvent(eventName, { detail })
    );
  }

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

  /*
   * SATU-SATUNYA FUNGSI PEMBUAT KONEKSI SUPABASE
   */
  async function connectSupabase() {
    if (client) return client;
    if (connectionPromise) return connectionPromise;

    connectionPromise = (async function () {
      const url = CONFIG.SUPABASE_URL.trim();
      const key = CONFIG.SUPABASE_PUBLIC_KEY.trim();

      if (
        url.includes("GANTI_PROJECT_REF") ||
        key.includes("GANTI_DENGAN")
      ) {
        throw new Error(
          "Isi URL dan Publishable/anon public key Supabase " +
          "di file mexa-system-center.js."
        );
      }

      if (!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(url)) {
        throw new Error("URL Supabase tidak valid.");
      }

      await loadSupabaseSDK();

      client = window.supabase.createClient(
        url.replace(/\/$/, ""),
        key
      );

      lastError = null;

      console.info("[MEXA SYSTEM CENTER] Supabase client siap.");

      emit("mexa:center:supabase-connected", {
        connected: true
      });

      return client;
    })().catch(error => {
      client = null;
      lastError = String(error.message || error);
      throw error;
    }).finally(() => {
      connectionPromise = null;
    });

    return connectionPromise;
  }

  function normalizeUserPayload(payload) {
    if (!payload || typeof payload !== "object") {
      throw new TypeError("Data pengguna tidak valid.");
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
      throw new Error("Nama lengkap tidak valid.");
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
      throw new Error("Kata sandi tidak memenuhi batas yang ditetapkan.");
    }

    return {
      displayName,
      username,
      email,
      password
    };
  }

  /*
   * Meneruskan HASIL AUTH ke System Pengelolaan Data.
   * Password tidak pernah diteruskan ke modul tersebut.
   *
   * Kontrak modul berikutnya:
   * MEXA_DATA_MANAGEMENT.receiveRegisteredUser(record)
   */
  async function forwardToDataManagement(record) {
    const manager = window.MEXA_DATA_MANAGEMENT;

    if (
      !manager ||
      typeof manager.receiveRegisteredUser !== "function"
    ) {
      emit("mexa:center:user-registered", {
        user: { ...record },
        managementStatus: "waiting-for-data-management"
      });

      return {
        forwarded: false,
        status: "waiting-for-data-management"
      };
    }

    const response = await manager.receiveRegisteredUser({
      ...record
    });

    if (!response || response.accepted !== true) {
      throw new Error(
        "System Pengelolaan Data belum mengonfirmasi penerimaan."
      );
    }

    return {
      forwarded: true,
      status: "delivered"
    };
  }

  /*
   * PINTU DAFTAR AKUN RESMI
   * Hanya dipanggil oleh Penghubung 1.
   */
  async function registerUser(payload) {
    if (registrationBusy) {
      throw new Error(
        "Pendaftaran lain sedang diproses."
      );
    }

    registrationBusy = true;

    try {
      const input = normalizeUserPayload(payload);
      const supabase = await connectSupabase();

      const { data, error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          data: {
            display_name: input.displayName,
            username: input.username
          }
        }
      });

      if (error) {
        throw new Error(
          "Supabase menolak pendaftaran: " + error.message
        );
      }

      if (!data || !data.user || !data.user.id) {
        throw new Error(
          "Supabase tidak mengembalikan identitas akun."
        );
      }

      /*
       * Beberapa konfigurasi dapat mengembalikan identities
       * kosong untuk alamat email yang sudah terdaftar.
       */
      if (
        Array.isArray(data.user.identities) &&
        data.user.identities.length === 0
      ) {
        throw new Error(
          "Akun dengan email tersebut mungkin sudah terdaftar. " +
          "Coba masuk atau gunakan pemulihan kata sandi."
        );
      }

      const safeUserRecord = {
        id: data.user.id,
        email: data.user.email || input.email,
        displayName: input.displayName,
        username: input.username,
        createdAt: data.user.created_at || new Date().toISOString()
      };

      /*
       * Supabase Auth sudah memberikan respons sukses.
       * Data pengguna aman diteruskan ke pengelolaan data.
       */
      let managementResult;

      try {
        managementResult =
          await forwardToDataManagement(safeUserRecord);
      } catch (error) {
        /*
         * Akun Auth mungkin sudah dibuat walaupun penerusan
         * profil gagal. Jangan menyebut akun gagal dibuat.
         */
        managementResult = {
          forwarded: false,
          status: "handoff-failed",
          error: String(error.message || error)
        };

        console.error(
          "[MEXA SYSTEM CENTER] Penerusan profil gagal:",
          error
        );
      }

      registrationsCompleted += 1;
      lastError = null;

      const confirmationRequired = !data.session;

      const message = confirmationRequired
        ? "Akun berhasil didaftarkan. Periksa email untuk konfirmasi sebelum masuk."
        : "Akun MEXA berhasil dibuat.";

      emit("mexa:center:registration-completed", {
        user: safeUserRecord,
        confirmationRequired,
        management: managementResult
      });

      return {
        accepted: true,
        accountCreated: true,
        userId: safeUserRecord.id,
        emailConfirmationRequired: confirmationRequired,
        management: managementResult,
        message
      };

    } catch (error) {
      lastError = String(error.message || error);
      throw error;
    } finally {
      registrationBusy = false;
    }
  }

  function getStatus() {
    return {
      name: "MEXA SYSTEM CENTER",
      version: VERSION,
      ready: true,
      supabaseConnected: Boolean(client),
      registrationBusy,
      registrationsCompleted,
      lastError
    };
  }

  window.MEXA_SYSTEM_CENTER = Object.freeze({
    version: VERSION,
    connectSupabase,
    registerUser,
    getStatus
  });

  console.info(
    "[MEXA SYSTEM CENTER] API pendaftaran siap."
  );

})(window, document);
