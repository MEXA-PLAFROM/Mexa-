/* =====================================================
   MEXA SMART — SYSTEM PENGHUBUNG 1
   Version: 1.0.0

   Jalur:
   HTML Registry → Penghubung 1 → System Pusat
   ===================================================== */

(function (window, document) {
  "use strict";

  if (window.MEXA_CONNECTOR_1) {
    console.warn("[MEXA] Penghubung 1 sudah aktif.");
    return;
  }

  const VERSION = "1.0.0";
  const pending = new Map();
  const delivered = new Set();

  let registryConnected = false;
  let center = null;
  let sending = false;

  function emit(name, detail) {
    document.dispatchEvent(
      new CustomEvent(name, { detail })
    );
  }

  function copyRecord(record) {
    if (!record || typeof record.name !== "string") {
      throw new Error("Data pendaftaran tidak valid.");
    }

    return { ...record };
  }

  function updateStatus() {
    let status = document.getElementById(
      "mexa-connector-1-status"
    );

    if (!status) {
      status = document.createElement("div");
      status.id = "mexa-connector-1-status";

      Object.assign(status.style, {
        margin: "12px 0",
        padding: "12px 14px",
        border: "1px solid #302544",
        borderRadius: "10px",
        background: "#151027",
        color: "#00e5ff",
        fontSize: "13px",
        lineHeight: "1.6"
      });

      const header = document.querySelector("header");

      if (header) {
        header.insertAdjacentElement("afterend", status);
      } else {
        document.body.prepend(status);
      }
    }

    status.textContent = registryConnected
      ? "Penghubung 1 terhubung ke HTML Registry · " +
        pending.size + " pendaftaran menunggu System Pusat."
      : "Penghubung 1 menunggu HTML Registry.";
  }

  /*
   * MENERIMA SATU PENDAFTARAN DARI REGISTRY
   */
  function receiveRegistration(data) {
    const record = copyRecord(data);

    pending.set(record.name, record);

    console.log(
      "[MEXA CONNECTOR 1] Pendaftaran diterima:",
      record.name
    );

    emit("mexa:connector-1:queued", {
      name: record.name,
      destination: "system-center"
    });

    updateStatus();

    return {
      name: record.name,
      status: "queued",
      destination: "system-center"
    };
  }

  /*
   * MEMBACA PENDAFTARAN AWAL REGISTRY
   */
  function connectRegistry() {
    const registry = window.MEXA_HTML_REGISTRY;

    if (!registry || typeof registry.list !== "function") {
      registryConnected = false;
      updateStatus();

      throw new Error(
        "HTML Registry belum tersedia."
      );
    }

    const registrations = registry.list();

    registrations.forEach(receiveRegistration);

    registryConnected = true;

    updateStatus();

    console.log(
      "[MEXA CONNECTOR 1] Terhubung ke Registry:",
      registrations.length,
      "pendaftaran."
    );

    emit("mexa:connector-1:ready", {
      version: VERSION,
      total: registrations.length
    });

    return getStatus();
  }

  /*
   * MENGHUBUNGKAN SYSTEM PUSAT
   *
   * System Pusat nantinya menyediakan:
   * receiveRegistration(record)
   */
  async function connectCenter(systemCenter) {
    if (
      !systemCenter ||
      typeof systemCenter.receiveRegistration !== "function"
    ) {
      throw new Error(
        "System Pusat belum menyediakan receiveRegistration()."
      );
    }

    center = systemCenter;

    return flushPending();
  }

  /*
   * MENERUSKAN ANTREAN KE SYSTEM PUSAT
   */
  async function flushPending() {
    if (!center) {
      updateStatus();

      return {
        status: "waiting-for-center",
        pending: pending.size
      };
    }

    if (sending) {
      return {
        status: "sending",
        pending: pending.size
      };
    }

    sending = true;
    const results = [];

    try {
      for (const [name, record] of pending.entries()) {
        try {
          await center.receiveRegistration(copyRecord(record));

          pending.delete(name);
          delivered.add(name);

          results.push({
            name,
            status: "delivered"
          });
        } catch (error) {
          results.push({
            name,
            status: "failed",
            error: String(error.message || error)
          });
        }
      }
    } finally {
      sending = false;
      updateStatus();
    }

    return {
      status: "completed",
      pending: pending.size,
      results
    };
  }

  function getPending() {
    return Array.from(pending.values()).map(copyRecord);
  }

  function getStatus() {
    return {
      name: "MEXA CONNECTOR 1",
      version: VERSION,
      registryConnected,
      centerConnected: Boolean(center),
      pendingRegistrations: pending.size,
      deliveredRegistrations: delivered.size
    };
  }

  window.MEXA_CONNECTOR_1 = Object.freeze({
    version: VERSION,
    receiveRegistration,
    connectRegistry,
    connectCenter,
    flushPending,
    getPending,
    getStatus
  });

  /*
   * Jalankan setelah HTML Registry tersedia.
   */
  try {
    connectRegistry();
  } catch (error) {
    console.error(
      "[MEXA CONNECTOR 1] Gagal terhubung:",
      error
    );
  }

})(window, document);
