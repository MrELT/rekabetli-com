import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotalDifficulty } from "@/lib/notal-difficulty";
import type { NotalNoteListItem, SavedNotalNote } from "@/lib/notal-subjects";
import type { CreditIdentity } from "@/lib/notal-credits-server";

interface NoteRow {
  id: string;
  user_id: string | null;
  visitor_id: string | null;
  title: string;
  subject: string;
  depth: string;
  content: string;
  created_at: string;
}

function matchesIdentity(row: NoteRow, identity: CreditIdentity): boolean {
  if (identity.userId) {
    return row.user_id === identity.userId;
  }

  if (identity.visitorId) {
    return row.visitor_id === identity.visitorId;
  }

  return false;
}

function rowToListItem(row: NoteRow): NotalNoteListItem {
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    depth: row.depth,
    created_at: row.created_at,
  };
}

function rowToNote(row: NoteRow): SavedNotalNote {
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    depth: row.depth,
    content: row.content,
    created_at: row.created_at,
  };
}

function notesTable(supabase: SupabaseClient) {
  return supabase.from("notal_saved_notes");
}

export async function saveNotalNote(
  supabase: SupabaseClient,
  identity: CreditIdentity,
  params: {
    title: string;
    subject: string;
    depth: NotalDifficulty;
    content: string;
  },
): Promise<SavedNotalNote> {
  const { data, error } = await notesTable(supabase)
    .insert({
      user_id: identity.userId,
      visitor_id: identity.userId ? null : identity.visitorId,
      title: params.title.slice(0, 200),
      subject: params.subject.slice(0, 80),
      depth: params.depth,
      content: params.content,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("Not kaydedilemedi.");
  }

  return rowToNote(data as NoteRow);
}

export async function listNotalNotes(
  supabase: SupabaseClient,
  identity: CreditIdentity,
): Promise<NotalNoteListItem[]> {
  let query = notesTable(supabase)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (identity.userId) {
    query = query.eq("user_id", identity.userId);
  } else if (identity.visitorId) {
    query = query.eq("visitor_id", identity.visitorId);
  } else {
    return [];
  }

  const { data, error } = await query;

  if (error) throw error;
  return ((data ?? []) as NoteRow[]).map(rowToListItem);
}

export async function getNotalNoteById(
  supabase: SupabaseClient,
  noteId: string,
  identity?: CreditIdentity,
): Promise<SavedNotalNote | null> {
  const { data, error } = await notesTable(supabase)
    .select("*")
    .eq("id", noteId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as NoteRow;
  if (identity && !matchesIdentity(row, identity)) {
    return null;
  }

  return rowToNote(row);
}
