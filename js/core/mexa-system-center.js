
/* ==========================================================
   MEXA SMART — SYSTEM CENTER
   VERSION: 2.0.0

   PENDAFTARAN:
   HTML REGISTRY
        ↓
   CONNECTOR 1
        ↓
   SYSTEM CENTER
        ↓
   SUPABASE AUTH

   DATA PROFIL:
   SUPABASE public.profiles
        ↓
   SYSTEM CENTER
        ↓
   CONNECTOR 2
        ↓
   DATA MANAGEMENT
        ↓
   MX

   KETENTUAN:
   - Hanya System Center membuat koneksi Supabase.
   - Password tidak diteruskan ke Data Management.
   - Profil hanya dianggap tersalurkan setelah penerima
     mengonfirmasi penerimaan.
   ========================================================== */

(function (window, document) {
  "use strict";

  if (window.MEXA_SYSTEM_CENTER) {
    console.warn(
      "[MEXA SYSTEM CENTER] Sistem sudah aktif."
    );
    return;
  }

  // ========================================================
  // 1. KONFIGURASI SUPABASE
  // ========================================================

  const VERSION = "2.0.0";

  const CONFIG = Object.freeze({
    SUPABASE_URL:
      "https://hhxygoblxshqxhkwybxq.supabase.co",

    SUPABASE_PUBLIC_KEY:
      "sb_publishable_nOvOu3SneFk0t2eSooT6uw_VbBZHQ3J"
  });

  // Jangan pernah memasukkan service_role/secret key
  // ke dalam JavaScript yang dipublikasikan.

  // ========================================================
  // 2. STATUS INTERNAL
  // ========================================================

  let client = null;
  let connectionPromise = null;
  let sdkPromise = null;
  let authSubscription = null;
  let registrationBusy = false;
  let lastError = null;

  let registrationsCompleted = 0;
  let profilesRead = 0;
  let profilesForwarded = 0;
  let profileSyncFailures = 0;

  const profileSyncPromises = new Map();

  // ========================================================
  // 3. EVENT INTERNAL
  // ========================================================

  function emit(eventName, detail) {
    document.dispatchEvent(
      new window.CustomEvent(eventName, {
        detail: detail
      })
    );
  }

  function errorMessage(error) {
    return String(
      error && error.message
        ? error.message
        : error
    );
  }

  // ========================================================
  // 4. MEMUAT SUPABASE SDK
  // ========================================================

  function loadSupabaseSDK() {
    if (
      window.supabase &&
      typeof window.supabase.createClient === "function"
    ) {
      return Promise.resolve();
    }

    if (sdkPromise) {
      return sdkPromise;
    }

    sdkPromise = new Promise(function (resolve, reject) {
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
          reject(
            new Error("Supabase SDK tidak tersedia.")
          );
        }
      };

      script.onerror = function () {
        reject(
          new Error("Supabase SDK gagal dimuat.")
        );
      };

      document.head.appendChild(script);
    }).catch(function (error) {
      sdkPromise = null;
      throw error;
    });

    return sdkPromise;
  }

  // ========================================================
  // 5. SATU-SATUNYA PEMBUAT KONEKSI SUPABASE
  // ========================================================

  async function connectSupabase() {
    if (client) {
      return client;
    }

    if (connectionPromise) {
      return connectionPromise;
    }

    connectionPromise = (async function () {
      const url = CONFIG.SUPABASE_URL.trim();
      const key = CONFIG.SUPABASE_PUBLIC_KEY.trim();

      if (
        !url ||
        url.includes("GANTI_PROJECT_REF") ||
        !key ||
        key.includes("ISI_PUBLISHABLE_KEY")
      ) {
        throw new Error(
          "Isi URL dan Publishable Key Supabase " +
          "di konfigurasi System Center."
        );
      }

      if (!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(url)) {
        throw new Error("URL Supabase tidak valid.");
      }

      await loadSupabaseSDK();

      client = window.supabase.createClient(
        url.replace(/\/$/, ""),
        key,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        }
      );

      lastError = null;

      emit("mexa:center:supabase-connected", {
        connected: true,
        version: VERSION
      });

      // Pasang pemantauan login hanya sekali.
      startAuthListener();

      console.info(
        "[MEXA SYSTEM CENTER] Koneksi Supabase siap."
      );

      return client;
    })().catch(function (error) {
      client = null;
      lastError = errorMessage(error);
      throw error;
    }).finally(function () {
      connectionPromise = null;
    });

    return connectionPromise;
  }

  // ========================================================
  // 6. VALIDASI PENDAFTARAN
  // Kompatibel dengan Connector 1 versi 1.0.0
  // ========================================================

  function normalizeUserPayload(payload) {
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    ) {
      throw new Error("Data pendaftaran tidak valid.");
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
      throw new Error("Nama lengkap harus 2–80 karakter.");
    }

    if (!/^[a-z0-9_.]{3,30}$/.test(username)) {
      throw new Error(
        "Username harus 3–30 karakter: huruf kecil, angka, titik, atau garis bawah."
      );
    }

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      throw new Error("Format email tidak valid.");
    }

    if (password.length < 8 || password.length > 72) {
      throw new Error(
        "Kata sandi harus terdiri dari 8–72 karakter."
      );
    }

    return {
      displayName: displayName,
      username: username,
      email: email,
      password: password
    };
  }

  // ========================================================
  // 7. MENGIRIM DATA PENDAFTARAN KE CONNECTOR 2
  // Password dan token tidak ikut diteruskan.
  // ========================================================

  async function forwardRegisteredUser(record) {
    const connector = window.MEXA_CONNECTOR_2;

    if (
      !connector ||
      typeof connector.forwardRegisteredUser !== "function"
    ) {
      emit("mexa:center:user-registered", {
        user: record,
        managementStatus: "connector-2-unavailable"
      });

      return {
        forwarded: false,
        status: "connector-2-unavailable"
      };
    }

    const result =
      await connector.forwardRegisteredUser(record);

    if (!result || result.accepted !== true) {
      throw new Error(
        "Penghubung 2 belum mengonfirmasi data pengguna."
      );
    }

    return {
      forwarded: true,
      status: "delivered",
      result: result
    };
  }

  // ========================================================
  // 8. API PENDAFTARAN AKUN RESMI
  // ========================================================

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
          "Identitas akun tidak diterima dari Supabase."
        );
      }

      if (
        Array.isArray(data.user.identities) &&
        data.user.identities.length === 0
      ) {
        throw new Error(
          "Email mungkin sudah terdaftar. " +
          "Coba masuk ke akun yang sudah ada."
        );
      }

      // Data aman untuk sistem berikutnya.
      const safeUserRecord = {
        id: data.user.id,
        email: data.user.email || input.email,
        displayName: input.displayName,
        username: input.username,
        createdAt:
          data.user.created_at ||
          new Date().toISOString()
      };

      // Akun Auth sudah dibuat jika sampai di sini.
      // Gagal meneruskan data tidak membatalkan akun Auth.
      let managementResult;

      try {
        managementResult =
          await forwardRegisteredUser(safeUserRecord);
      } catch (error) {
        managementResult = {
          forwarded: false,
          status: "handoff-failed",
          error: errorMessage(error)
        };

        console.error(
          "[MEXA SYSTEM CENTER] Penerusan pengguna gagal:",
          error
        );
      }

      registrationsCompleted += 1;
      lastError = null;

      const confirmationRequired = !data.session;

      const message = confirmationRequired
        ? "Akun dibuat. Periksa email untuk konfirmasi sebelum masuk."
        : "Akun MEXA berhasil dibuat.";

      emit("mexa:center:registration-completed", {
        user: safeUserRecord,
        confirmationRequired: confirmationRequired,
        management: managementResult
      });

      // Jika sesi langsung tersedia, sinkronkan profil.
      if (data.session && data.user) {
        window.setTimeout(function () {
          syncCurrentUserProfile().catch(function (error) {
            console.warn(
              "[MEXA SYSTEM CENTER] Profil belum tersinkron:",
              errorMessage(error)
            );
          });
        }, 0);
      }

      return {
        accepted: true,
        accountCreated: true,
        userId: safeUserRecord.id,
        emailConfirmationRequired: confirmationRequired,
        management: managementResult,
        message: message
      };
    } catch (error) {
      lastError = errorMessage(error);
      throw error;
    } finally {
      registrationBusy = false;
    }
  }

  // ========================================================
  // 9. MEMBACA PROFIL AKUN YANG SEDANG LOGIN
  // Koneksi tetap milik System Center.
  // ========================================================

  async function readCurrentUserProfile() {
    const supabase = await connectSupabase();

    const {
      data: authData,
      error: authError
    } = await supabase.auth.getUser();

    if (authError) {
      throw new Error(
        "Gagal memeriksa sesi login: " + authError.message
      );
    }

    const user = authData && authData.user;

    if (!user) {
      throw new Error(
        "Sesi login tidak ditemukan. Masuk ke akun MEXA dahulu."
      );
    }

    // Baca hanya profil milik akun yang sedang login.
    const {
      data: profile,
      error: profileError
    } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw new Error(
        "Gagal membaca public.profiles: " +
        profileError.message
      );
    }

    if (!profile) {
      throw new Error(
        "Baris profil belum ditemukan. " +
        "Pastikan profil dibuat setelah pendaftaran."
      );
    }

    // Whitelist kolom untuk mencegah field tak perlu
    // ikut diteruskan ke sistem berikutnya.
    const safeProfile = {
      id: profile.id,
      email: user.email || "",
      display_name: profile.display_name || "",
      username: profile.username || "",
      avatar_url: profile.avatar_url || null,
      cover_url: profile.cover_url || null,
      bio: profile.bio || "",
      location: profile.location || "",
      website: profile.website || "",
      created_at: profile.created_at || null,
      updated_at: profile.updated_at || null
    };

    profilesRead += 1;

    emit("mexa:center:profile-read", {
      userId: user.id,
      accepted: true
    });

    return safeProfile;
  }

  // ========================================================
  // 10. MENERUSKAN PROFIL MELALUI CONNECTOR 2
  // Connector 2 harus mempunyai forwardProfileRecord().
  // ========================================================

  async function forwardProfileToManagement(profile) {
    const connector = window.MEXA_CONNECTOR_2;

    if (
      !connector ||
      typeof connector.forwardProfileRecord !== "function"
    ) {
      throw new Error(
        "Penghubung 2 belum menyediakan forwardProfileRecord(). " +
        "Perbarui Penghubung 2 terlebih dahulu."
      );
    }

    const result =
      await connector.forwardProfileRecord(profile);

    if (!result || result.accepted !== true) {
      throw new Error(
        "System Pengelolaan Data belum mengonfirmasi profil."
      );
    }

    profilesForwarded += 1;

    emit("mexa:center:profile-forwarded", {
      userId: profile.id,
      accepted: true
    });

    return {
      accepted: true,
      destination: "MEXA_DATA_MANAGEMENT",
      result: result
    };
  }

  // ========================================================
  // 11. SINKRONISASI PROFIL UNTUK MX
  // Panggil setelah login atau ketika mengulang sinkronisasi.
  // ========================================================

  async function syncCurrentUserProfile() {
    const supabase = await connectSupabase();

    const {
      data: authData,
      error: authError
    } = await supabase.auth.getUser();

    if (authError) {
      throw new Error(
        "Gagal memeriksa akun login: " + authError.message
      );
    }

    const user = authData && authData.user;

    if (!user) {
      throw new Error("Belum login ke akun MEXA.");
    }

    const currentTask = profileSyncPromises.get(user.id);

    if (currentTask) {
      return currentTask;
    }

    const task = (async function () {
      try {
        const profile = await readCurrentUserProfile();

        const handoff =
          await forwardProfileToManagement(profile);

        lastError = null;

        return {
          accepted: true,
          userId: user.id,
          profile: profile,
          handoff: handoff
        };
      } catch (error) {
        profileSyncFailures += 1;
        lastError = errorMessage(error);

        emit("mexa:center:profile-sync-failed", {
          userId: user.id,
          error: lastError
        });

        throw error;
      }
    })();

    profileSyncPromises.set(user.id, task);

    try {
      return await task;
    } finally {
      if (profileSyncPromises.get(user.id) === task) {
        profileSyncPromises.delete(user.id);
      }
    }
  }

  // ========================================================
  // 12. PEMANTAUAN LOGIN
  // ========================================================

  function startAuthListener() {
    if (!client || authSubscription) {
      return;
    }

    const response = client.auth.onAuthStateChange(
      function (event, session) {
        if (
          event !== "INITIAL_SESSION" &&
          event !== "SIGNED_IN"
        ) {
          return;
        }

        if (!session || !session.user) {
          return;
        }

        // Hindari melakukan operasi database langsung
        // di dalam callback autentikasi.
        window.setTimeout(function () {
          syncCurrentUserProfile().catch(function (error) {
            console.info(
              "[MEXA SYSTEM CENTER] Sinkronisasi profil menunggu:",
              errorMessage(error)
            );
          });
        }, 0);
      }
    );

    authSubscription =
      response &&
      response.data &&
      response.data.subscription
        ? response.data.subscription
        : null;
  }

  // Retry saat penghubung atau pengelolaan siap.
  function retryProfileSync() {
    if (!client) {
      return;
    }

    window.setTimeout(function () {
      syncCurrentUserProfile().catch(function (error) {
        console.info(
          "[MEXA SYSTEM CENTER] Profil belum tersalurkan:",
          errorMessage(error)
        );
      });
    }, 0);
  }

  document.addEventListener(
    "mexa:connector-2:ready",
    retryProfileSync
  );

  document.addEventListener(
    "mexa:data-management:ready",
    retryProfileSync
  );

  // ========================================================
  // 13. STATUS SYSTEM CENTER
  // ========================================================

  function getStatus() {
    return {
      name: "MEXA SYSTEM CENTER",
      version: VERSION,
      ready: true,

      supabaseConfigured: Boolean(
        CONFIG.SUPABASE_URL &&
        CONFIG.SUPABASE_PUBLIC_KEY &&
        !CONFIG.SUPABASE_PUBLIC_KEY.includes(
          "ISI_PUBLISHABLE_KEY"
        )
      ),

      supabaseConnected: Boolean(client),
      authListenerActive: Boolean(authSubscription),
      registrationBusy: registrationBusy,

      registrationsCompleted: registrationsCompleted,
      profilesRead: profilesRead,
      profilesForwarded: profilesForwarded,
      profileSyncFailures: profileSyncFailures,

      lastError: lastError
    };
  }

  // ========================================================
  // 14. API PUBLIK
  // Nama registerUser dipertahankan untuk Connector 1.
  // ========================================================

  window.MEXA_SYSTEM_CENTER = Object.freeze({
    version: VERSION,

    connectSupabase: connectSupabase,
    registerUser: registerUser,

    readCurrentUserProfile: readCurrentUserProfile,
    syncCurrentUserProfile: syncCurrentUserProfile,

    getStatus: getStatus
  });

  console.info(
    "[MEXA SYSTEM CENTER] API siap — versi " + VERSION
  );

  // Coba membangun satu koneksi dari pusat.
  connectSupabase().catch(function (error) {
    console.warn(
      "[MEXA SYSTEM CENTER] Koneksi belum aktif:",
      errorMessage(error)
    );
  });

})(window, document);
