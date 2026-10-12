/* =====================================================
   MEXA SMART — SYSTEM PENGHUBUNG 1
   File: js/core/mexa-connector-1.js
   Version: 1.0.0

   KONTRAK RESMI:
   MEXA_HTML_REGISTRY
        ↓ receiveRegistry(payload)
   MEXA_CONNECTOR_1
        ↓ receiveRegistration(record)
   MEXA_SYSTEM_CENTER
        ↓
   System Pengelolaan Data

   Penghubung 1 tidak membuat koneksi Supabase.
   Koneksi dan penyimpanan permanen milik System Pusat.
   ===================================================== */

(function (window, document) {
  "use strict";

  if (window.MEXA_CONNECTOR_1) {
    console.warn(
      "[MEXA CONNECTOR 1] Sistem sudah aktif."
    );
    return;
  }

  const VERSION = "1.0.0";

  // Pendaftaran yang diterima tetapi belum dikonfirmasi pusat.
  const pending = new Map();

  // Pendaftaran yang sudah dikonfirmasi tersimpan oleh pusat.
  const delivered = new Map();

  let center = null;
  let receiving = false;
  let flushPromise = null;
  let lastError = null;
  let lastPayloadAt = null;
  let totalReceived = 0;

  /* ===================================================
     UTILITAS
     =================================================== */

  function emit(eventName, detail) {
    document.dispatchEvent(
      new window.CustomEvent(eventName, { detail })
    );
  }

  function copyRecord(record) {
    return {
      ...record,
      dependencies: Array.isArray(record.dependencies)
        ? [...record.dependencies]
        : []
    };
  }

  function normalizeName(value) {
    if (
      typeof value !== "string" ||
      !value.trim()
    ) {
      throw new TypeError(
        "Nama pendaftaran tidak valid."
      );
    }

    return value.trim().toLowerCase();
  }

  function fingerprint(record) {
    return JSON.stringify({
      name: record.name,
      title: record.title,
      version: record.version,
      type: record.type,
      file: record.file ?? null,
      position: record.position,
      dependencies: record.dependencies || [],
      description: record.description || "",
      status: record.status || "registered"
    });
  }

  /* ===================================================
     VALIDASI PAYLOAD REGISTRY
     Format cocok dengan snapshot() di index.html.
     =================================================== */

  function validatePayload(payload) {
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    ) {
      throw new TypeError(
        "Payload Registry harus berupa objek."
      );
    }

    if (payload.source !== "MEXA_HTML_REGISTRY") {
      throw new Error(
        "Sumber payload bukan MEXA_HTML_REGISTRY."
      );
    }

    if (!Array.isArray(payload.registrations)) {
      throw new Error(
        "Payload tidak memiliki daftar registrations."
      );
    }

    if (
      !Number.isInteger(payload.total) ||
      payload.total !== payload.registrations.length
    ) {
      throw new Error(
        "Jumlah pendaftaran tidak sesuai dengan payload."
      );
    }

    const names = new Set();

    const registrations = payload.registrations.map(
      (input, index) => {
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input)
        ) {
          throw new Error(
            "Data pendaftaran nomor " +
            (index + 1) + " tidak valid."
          );
        }

        const name = normalizeName(input.name);

        if (names.has(name)) {
          throw new Error(
            'Nama pendaftaran duplikat: "' + name + '".'
          );
        }

        names.add(name);

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
            'Lokasi file "' + name + '" tidak valid.'
          );
        }

        if (
          input.dependencies !== undefined &&
          !Array.isArray(input.dependencies)
        ) {
          throw new Error(
            'Dependensi "' + name + '" tidak valid.'
          );
        }

        const dependencies = (
          input.dependencies || []
        ).map(normalizeName);

        return {
          ...input,
          name,
          title: input.title.trim(),
          version: input.version || VERSION,
          type: input.type || "module",
          file: input.file || null,
          position: input.position,
          dependencies,
          description: input.description || "",
          status: input.status || "registered"
        };
      }
    );

    return {
      source: "MEXA_HTML_REGISTRY",
      version: payload.version || VERSION,
      createdAt: payload.createdAt || null,
      total: registrations.length,
      registrations
    };
  }

  /* ===================================================
     MENERIMA PAYLOAD UTUH DARI HTML REGISTRY

     Fungsi ini dipanggil oleh:
     MEXA_CONNECTOR_1.receiveRegistry(payload)
     =================================================== */

  async function receiveRegistry(payload) {
    if (receiving) {
      throw new Error(
        "Penghubung 1 sedang menerima payload lain."
      );
    }

    receiving = true;

    try {
      const validated = validatePayload(payload);

      /*
       * Masukkan setiap pendaftaran ke antrean penghubung.
       * Tidak mengklaim data sudah tersimpan di database.
       */
      for (const record of validated.registrations) {
        const deliveredRecord = delivered.get(record.name);

        if (
          deliveredRecord &&
          deliveredRecord.fingerprint === fingerprint(record)
        ) {
          continue;
        }

        pending.set(record.name, copyRecord(record));
      }

      totalReceived += validated.registrations.length;
      lastPayloadAt = new Date().toISOString();
      lastError = null;

      console.info(
        "[MEXA CONNECTOR 1] Payload Registry diterima.",
        {
          total: validated.total,
          menungguPusat: pending.size
        }
      );

      emit("mexa:connector-1:received", {
        source: validated.source,
        total: validated.total,
        pending: pending.size,
        receivedAt: lastPayloadAt
      });

      /*
       * Bila pusat sudah tersedia, langsung teruskan.
       * Kalau belum, data tetap menunggu di memori penghubung.
       */
      let delivery = {
        attempted: 0,
        delivered: 0,
        pending: pending.size
      };

      if (center) {
        delivery = await flushPending();
      }

      /*
       * accepted berarti payload sudah diterima Penghubung 1,
       * bukan berarti sudah tersimpan permanen di Supabase.
       */
      return {
        accepted: true,
        received: validated.total,
        queued: pending.size,
        delivery
      };
    } catch (error) {
      lastError = String(error.message || error);

      console.error(
        "[MEXA CONNECTOR 1] Payload ditolak:",
        error
      );

      emit("mexa:connector-1:error", {
        message: lastError
      });

      throw error;
    } finally {
      receiving = false;
    }
  }

  /* ===================================================
     MENGHUBUNGKAN KE SYSTEM PUSAT

     Pusat menyediakan receiveRegistration(record).
     Pendaftaran baru ditandai terkirim setelah pusat
     mengonfirmasi persisted: true.
     =================================================== */

  async function connectCenter(systemCenter) {
    if (
      !systemCenter ||
      typeof systemCenter.receiveRegistration !== "function"
    ) {
      throw new TypeError(
        "System Pusat harus menyediakan " +
        "receiveRegistration(record)."
      );
    }

    center = systemCenter;
    lastError = null;

    console.info(
      "[MEXA CONNECTOR 1] API System Pusat ditemukan."
    );

    emit("mexa:connector-1:center-connected", {
      connected: true
    });

    return flushPending();
  }

  /* ===================================================
     TERUSKAN PENDING KE SYSTEM PUSAT
     =================================================== */

  function flushPending() {
    if (flushPromise) {
      return flushPromise;
    }

    if (!center) {
      return Promise.resolve({
        attempted: 0,
        delivered: 0,
        pending: pending.size,
        status: "waiting-for-center"
      });
    }

    flushPromise = (async function () {
      let attempted = 0;
      let saved = 0;

      try {
        for (const [name, record] of pending.entries()) {
          attempted += 1;

          try {
            const response =
              await center.receiveRegistration(
                copyRecord(record)
              );

            /*
             * Jangan menghapus antrean hanya karena fungsi
             * pusat dipanggil. Pusat wajib mengonfirmasi
             * accepted dan persisted.
             */
            if (
              !response ||
              response.accepted !== true ||
              response.persisted !== true
            ) {
              throw new Error(
                'System Pusat belum mengonfirmasi penyimpanan ' +
                'permanen untuk "' + name + '".'
              );
            }

            delivered.set(name, {
              fingerprint: fingerprint(record),
              deliveredAt: new Date().toISOString()
            });

            pending.delete(name);
            saved += 1;

            emit("mexa:connector-1:delivered", {
              name,
              persisted: true
            });

            console.info(
              "[MEXA CONNECTOR 1] Pusat mengonfirmasi:",
              name
            );
          } catch (error) {
            lastError = String(error.message || error);

            /*
             * Catatan tetap berada di antrean untuk
             * percobaan selanjutnya.
             */
            console.error(
              "[MEXA CONNECTOR 1] Pengiriman gagal:",
              name,
              error
            );
          }
        }
      } finally {
        flushPromise = null;
      }

      return {
        attempted,
        delivered: saved,
        pending: pending.size,
        status: pending.size === 0
          ? "complete"
          : "pending"
      };
    })();

    return flushPromise;
  }

  /* ===================================================
     INFORMASI STATUS
     =================================================== */

  function getPending() {
    return Array.from(pending.values()).map(copyRecord);
  }

  function getStatus() {
    return {
      name: "MEXA CONNECTOR 1",
      version: VERSION,
      ready: true,
      centerConnected: Boolean(center),
      receiving,
      pendingRegistrations: pending.size,
      deliveredRegistrations: delivered.size,
      totalReceived,
      lastPayloadAt,
      lastError
    };
  }

  /* ===================================================
     API PUBLIK — NAMA DIKUNCI UNTUK REGISTRY
     =================================================== */

  window.MEXA_CONNECTOR_1 = Object.freeze({
    version: VERSION,
    receiveRegistry,
    connectCenter,
    flushPending,
    getPending,
    getStatus
  });

  /*
   * Bila System Pusat dimuat kemudian, pusat boleh:
   * MEXA_CONNECTOR_1.connectCenter(window.MEXA_SYSTEM_CENTER)
   * atau mengirim event mexa:center:ready.
   */
  document.addEventListener(
    "mexa:center:ready",
    function (event) {
      const systemCenter =
        event.detail?.api ||
        window.MEXA_SYSTEM_CENTER;

      if (!systemCenter) return;

      connectCenter(systemCenter).catch(error => {
        lastError = String(error.message || error);
        console.error(
          "[MEXA CONNECTOR 1] Sambungan pusat gagal:",
          error
        );
      });
    }
  );

  /*
   * Jika System Pusat sudah dimuat lebih dahulu.
   */
  if (window.MEXA_SYSTEM_CENTER) {
    connectCenter(window.MEXA_SYSTEM_CENTER).catch(error => {
      lastError = String(error.message || error);
      console.error(
        "[MEXA CONNECTOR 1] Sambungan pusat gagal:",
        error
      );
    });
  }

  console.info(
    "[MEXA CONNECTOR 1] Siap menerima payload Registry."
  );

})(window, document);
