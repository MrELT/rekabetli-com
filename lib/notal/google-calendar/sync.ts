import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import type { NotalPlanBlock } from "@/lib/notal/planner/types";
import {
  createPlanBlock,
  listPlanBlocksInRange,
  updatePlanBlock,
} from "@/lib/notal/planner/repository";
import {
  getAuthorizedGoogleClient,
  isUserGoogleCalendarConnected,
} from "@/lib/notal/google-calendar/oauth";

export async function deleteGoogleEventForBlock(
  userId: string,
  googleEventId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const auth = await getAuthorizedGoogleClient(userId);
    if (!auth) {
      return { ok: false, error: "google_not_connected" };
    }

    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.delete({
      calendarId: "primary",
      eventId: googleEventId,
    });
    return { ok: true };
  } catch (error) {
    console.error("[google] delete event:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "google_delete_failed",
    };
  }
}

export async function syncPlanBlockToGoogle(
  userId: string,
  block: NotalPlanBlock,
): Promise<{ googleEventId: string | null; error?: string }> {
  try {
    const auth = await getAuthorizedGoogleClient(userId);
    if (!auth) {
      return { googleEventId: null, error: "google_not_connected" };
    }

    const calendar = google.calendar({ version: "v3", auth });
    const body = {
      summary: block.title,
      description: block.notes || undefined,
      start: { dateTime: block.start_at, timeZone: "Europe/Istanbul" },
      end: { dateTime: block.end_at, timeZone: "Europe/Istanbul" },
    };

    if (block.google_event_id) {
      const updated = await calendar.events.update({
        calendarId: "primary",
        eventId: block.google_event_id,
        requestBody: body,
      });
      return { googleEventId: updated.data.id || block.google_event_id };
    }

    const created = await calendar.events.insert({
      calendarId: "primary",
      requestBody: body,
    });

    return { googleEventId: created.data.id || null };
  } catch (error) {
    console.error("[google] sync block:", error);
    return {
      googleEventId: null,
      error: error instanceof Error ? error.message : "google_sync_failed",
    };
  }
}

export async function applyGoogleSyncForBlock(
  supabase: SupabaseClient,
  userId: string,
  block: NotalPlanBlock,
): Promise<{ block: NotalPlanBlock; error?: string }> {
  const connected = await isUserGoogleCalendarConnected(userId);
  if (!connected) return { block };

  const result = await syncPlanBlockToGoogle(userId, block);
  if (result.googleEventId) {
    const updated = await updatePlanBlock(supabase, userId, block.id, {
      google_event_id: result.googleEventId,
    });
    return { block: updated || block, error: result.error };
  }

  return { block, error: result.error };
}

export async function deleteLinkedGoogleEvent(
  userId: string,
  googleEventId: string | null,
): Promise<{ error?: string }> {
  if (!googleEventId) return {};
  const connected = await isUserGoogleCalendarConnected(userId);
  if (!connected) return {};

  const result = await deleteGoogleEventForBlock(userId, googleEventId);
  return result.ok ? {} : { error: result.error };
}

type GoogleEventLike = {
  id?: string | null;
  status?: string | null;
  summary?: string | null;
  description?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
};

function googleEventToRange(event: GoogleEventLike): {
  start_at: string;
  end_at: string;
} | null {
  if (event.start?.dateTime && event.end?.dateTime) {
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (end <= start) return null;
    return { start_at: start.toISOString(), end_at: end.toISOString() };
  }

  if (event.start?.date && event.end?.date) {
    // Google all-day: end date is exclusive
    const start = new Date(`${event.start.date}T00:00:00`);
    const end = new Date(`${event.end.date}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (end <= start) {
      end.setDate(end.getDate() + 1);
    }
    return { start_at: start.toISOString(), end_at: end.toISOString() };
  }

  return null;
}

/**
 * Google primary takvimden aralıktaki etkinlikleri çeker ve NotAl bloklarına yazar.
 */
export async function importGoogleEventsInRange(options: {
  supabase: SupabaseClient;
  userId: string;
  rangeStartIso: string;
  rangeEndIso: string;
}): Promise<{
  imported: number;
  updated: number;
  skipped: number;
  error?: string;
}> {
  const auth = await getAuthorizedGoogleClient(options.userId);
  if (!auth) {
    return { imported: 0, updated: 0, skipped: 0, error: "google_not_connected" };
  }

  const calendar = google.calendar({ version: "v3", auth });
  const existing = await listPlanBlocksInRange(
    options.supabase,
    options.userId,
    options.rangeStartIso,
    options.rangeEndIso,
  );
  const byGoogleId = new Map(
    existing
      .filter((b) => b.google_event_id)
      .map((b) => [b.google_event_id as string, b]),
  );

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let pageToken: string | undefined;

  try {
    do {
      const result = await calendar.events.list({
        calendarId: "primary",
        timeMin: options.rangeStartIso,
        timeMax: options.rangeEndIso,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 100,
        pageToken,
      });

      for (const event of (result.data.items || []) as GoogleEventLike[]) {
        if (!event.id || event.status === "cancelled") {
          skipped += 1;
          continue;
        }

        const range = googleEventToRange(event);
        if (!range) {
          skipped += 1;
          continue;
        }

        const title = (event.summary || "Google etkinliği").trim().slice(0, 160);
        const notes = (event.description || "").trim().slice(0, 4000);
        const current = byGoogleId.get(event.id);

        if (current) {
          await updatePlanBlock(options.supabase, options.userId, current.id, {
            start_at: range.start_at,
            end_at: range.end_at,
            title,
            notes,
            source: "google",
            google_event_id: event.id,
          });
          updated += 1;
        } else {
          const created = await createPlanBlock(
            options.supabase,
            options.userId,
            {
              start_at: range.start_at,
              end_at: range.end_at,
              title,
              notes,
              source: "google",
              google_event_id: event.id,
            },
          );
          byGoogleId.set(event.id, created);
          imported += 1;
        }
      }

      pageToken = result.data.nextPageToken || undefined;
    } while (pageToken);
  } catch (error) {
    console.error("[google] import events:", error);
    return {
      imported,
      updated,
      skipped,
      error: error instanceof Error ? error.message : "google_import_failed",
    };
  }

  return { imported, updated, skipped };
}
