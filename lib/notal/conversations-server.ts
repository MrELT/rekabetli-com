import type { SupabaseClient } from "@supabase/supabase-js";

export type NotalConversationListItem = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type NotalStoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export function titleFromFirstMessage(content: string): string {
  const cleaned = content.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Yeni sohbet";
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}…` : cleaned;
}

export async function listNotalConversations(
  supabase: SupabaseClient,
  userId: string,
): Promise<NotalConversationListItem[]> {
  const { data, error } = await supabase
    .from("notal_conversations")
    .select("id, title, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []) as NotalConversationListItem[];
}

export async function getNotalConversationWithMessages(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<{
  conversation: NotalConversationListItem;
  messages: NotalStoredMessage[];
} | null> {
  const { data: conversation, error: convError } = await supabase
    .from("notal_conversations")
    .select("id, title, created_at, updated_at")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (convError) throw convError;
  if (!conversation) return null;

  const { data: messages, error: msgError } = await supabase
    .from("notal_messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (msgError) throw msgError;

  return {
    conversation: conversation as NotalConversationListItem,
    messages: (messages ?? []) as NotalStoredMessage[],
  };
}

export async function createNotalConversation(
  supabase: SupabaseClient,
  userId: string,
  title: string,
): Promise<NotalConversationListItem> {
  const { data, error } = await supabase
    .from("notal_conversations")
    .insert({
      user_id: userId,
      title: titleFromFirstMessage(title),
    })
    .select("id, title, created_at, updated_at")
    .single();

  if (error) throw error;
  return data as NotalConversationListItem;
}

export async function touchNotalConversation(
  supabase: SupabaseClient,
  conversationId: string,
  title?: string,
): Promise<void> {
  const payload: { updated_at: string; title?: string } = {
    updated_at: new Date().toISOString(),
  };
  if (title) payload.title = titleFromFirstMessage(title);

  const { error } = await supabase
    .from("notal_conversations")
    .update(payload)
    .eq("id", conversationId);

  if (error) throw error;
}

export async function insertNotalMessage(
  supabase: SupabaseClient,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
): Promise<NotalStoredMessage> {
  const { data, error } = await supabase
    .from("notal_messages")
    .insert({
      conversation_id: conversationId,
      role,
      content,
    })
    .select("id, role, content, created_at")
    .single();

  if (error) throw error;
  return data as NotalStoredMessage;
}

export async function deleteNotalConversation(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("notal_conversations")
    .delete()
    .eq("id", conversationId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function ensureOwnedConversation(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string | null | undefined,
  firstUserMessage: string,
): Promise<{ id: string; created: boolean }> {
  if (conversationId) {
    const { data, error } = await supabase
      .from("notal_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("conversation_not_found");
    return { id: data.id, created: false };
  }

  const created = await createNotalConversation(
    supabase,
    userId,
    firstUserMessage,
  );
  return { id: created.id, created: true };
}
