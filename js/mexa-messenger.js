/* =====================================================
   MEXA MESSENGER ENGINE V1
   Menggunakan window.mexaSupabase
   ===================================================== */
(function (window) {
  "use strict";

  if (window.MEXA_MESSENGER) {
    console.warn("MEXA MESSENGER sudah aktif.");
    return;
  }

  const MAX_MESSAGE_LENGTH = 5000;

  function getClient() {
    const client = window.mexaSupabase;

    if (!client || !client.auth || !client.from) {
      throw new Error("Koneksi MEXA belum siap.");
    }

    return client;
  }

  async function getUser() {
    const { data, error } = await getClient().auth.getUser();

    if (error) throw error;
    if (!data.user) {
      throw new Error("Silakan login terlebih dahulu.");
    }

    return data.user;
  }

  async function openDirectChat(otherUserId) {
    if (!otherUserId) {
      throw new Error("ID pengguna tujuan belum tersedia.");
    }

    const client = getClient();
    await getUser();

    const { data, error } = await client.rpc(
      "mexa_open_direct_chat",
      { p_other_user: otherUserId }
    );

    if (error) throw error;
    if (!data) throw new Error("Percakapan gagal dibuat.");

    return data;
  }

  async function getMessages(conversationId, limit = 50) {
    if (!conversationId) {
      throw new Error("ID percakapan tidak tersedia.");
    }

    const client = getClient();
    await getUser();

    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));

    const { data, error } = await client
      .from("messages")
      .select("id, conversation_id, sender_id, content, reply_to, created_at, edited_at, deleted_at")
      .eq("conversation_id", conversationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(safeLimit);

    if (error) throw error;
    return data || [];
  }

  async function sendMessage(conversationId, content, replyTo = null) {
    if (!conversationId) {
      throw new Error("Pilih percakapan terlebih dahulu.");
    }

    const text = String(content || "").trim();

    if (!text) throw new Error("Pesan tidak boleh kosong.");
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new Error("Pesan maksimal 5000 karakter.");
    }

    const client = getClient();
    const user = await getUser();

    const payload = {
      conversation_id: conversationId,
      sender_id: user.id,
      content: text
    };

    if (replyTo) payload.reply_to = replyTo;

    const { data, error } = await client
      .from("messages")
      .insert(payload)
      .select("id, conversation_id, sender_id, content, reply_to, created_at")
      .single();

    if (error) throw error;

    return data;
  }

  async function getMyConversations() {
    const client = getClient();
    const user = await getUser();

    const { data: memberships, error: membershipError } = await client
      .from("conversation_members")
      .select("conversation_id, joined_at, last_read_at")
      .eq("user_id", user.id);

    if (membershipError) throw membershipError;

    const ids = (memberships || []).map(
      item => item.conversation_id
    );

    if (!ids.length) return [];

    const { data, error } = await client
      .from("conversations")
      .select("id, type, title, created_at, updated_at")
      .in("id", ids)
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async function subscribeMessages(conversationId, onMessage) {
    if (!conversationId || typeof onMessage !== "function") {
      throw new Error("Percakapan atau callback tidak valid.");
    }

    const client = getClient();
    await getUser();

    const channel = client
      .channel("mexa-chat-" + conversationId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: "conversation_id=eq." + conversationId
        },
        payload => onMessage(payload.new)
      )
      .subscribe();

    return async function unsubscribe() {
      await client.removeChannel(channel);
    };
  }

  window.MEXA_MESSENGER = Object.freeze({
    version: "1.0.0",
    getUser,
    openDirectChat,
    getMessages,
    sendMessage,
    getMyConversations,
    subscribeMessages
  });

  console.info("MEXA MESSENGER ENGINE V1 siap.");
})(window);
