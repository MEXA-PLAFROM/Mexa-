/* =====================================================
   MEXA AUTH CLIENT
   Supabase connection + shared authenticated session
   ===================================================== */
(function (window) {
  "use strict";

  if (window.mexaSupabase) {
    console.info("MEXA Supabase client sudah tersedia.");
    return;
  }

  const SUPABASE_URL =
    "https://yozylignolfvkemuhfse.supabase.co";

  /*
   * GANTI NILAI DI BAWAH dengan Supabase publishable key
   * atau anon key dari proyek MEXA SOSIAL.
   *
   * Jangan pernah masukkan service_role / secret key
   * ke file JavaScript yang dikirim ke browser.
   */
  const SUPABASE_KEY = "TEMPEL_PUBLISHABLE_KEY_MEXA_DI_SINI";

  if (!window.supabase || !window.supabase.createClient) {
    console.error("Supabase SDK belum dimuat.");
    return;
  }

  if (
    !SUPABASE_KEY ||
    SUPABASE_KEY === "TEMPEL_PUBLISHABLE_KEY_MEXA_DI_SINI"
  ) {
    console.error("MEXA: isi Supabase publishable key terlebih dahulu.");
    return;
  }

  const client = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  window.mexaSupabase = client;

  console.info("MEXA Supabase client berhasil diinisialisasi.");
})(window);
