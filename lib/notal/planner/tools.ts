import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPlanBlocks,
  deletePlanBlock,
  listPlanBlocksInRange,
  updatePlanBlock,
} from "@/lib/notal/planner/repository";
import type { NotalPlanBlockInput } from "@/lib/notal/planner/types";
import { syncPlanBlockToGoogle } from "@/lib/notal/google-calendar/sync";

export const PLANNER_TOOLS = [
  {
    type: "function" as const,
    name: "planner_list_blocks",
    description:
      "Belirli bir tarih aralığındaki NotAl plan bloklarını listeler (Europe/Istanbul).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        range_start: {
          type: "string",
          description: "ISO 8601 başlangıç (dahil), örn. 2026-07-24T00:00:00+03:00",
        },
        range_end: {
          type: "string",
          description: "ISO 8601 bitiş (hariç)",
        },
      },
      required: ["range_start", "range_end"],
    },
  },
  {
    type: "function" as const,
    name: "planner_create_blocks",
    description:
      "Günlük/haftalık çalışma planı için bir veya daha fazla saatlik blok oluşturur. Saatler çakışmasın; Europe/Istanbul kullan.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        blocks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              start_at: { type: "string", description: "ISO 8601 başlangıç" },
              end_at: { type: "string", description: "ISO 8601 bitiş" },
              title: { type: "string" },
              notes: { type: "string" },
              sync_google: {
                type: "boolean",
                description:
                  "true ise Google Takvim'e de yazmayı dener (bağlıysa).",
              },
            },
            required: ["start_at", "end_at", "title"],
          },
        },
      },
      required: ["blocks"],
    },
  },
  {
    type: "function" as const,
    name: "planner_update_block",
    description: "Mevcut bir plan bloğunu günceller.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        block_id: { type: "string" },
        start_at: { type: "string" },
        end_at: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        sync_google: { type: "boolean" },
      },
      required: ["block_id"],
    },
  },
  {
    type: "function" as const,
    name: "planner_delete_block",
    description: "Bir plan bloğunu siler.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        block_id: { type: "string" },
      },
      required: ["block_id"],
    },
  },
];

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

export async function executePlannerTool(options: {
  supabase: SupabaseClient;
  userId: string;
  name: string;
  argsJson: string;
}): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(options.argsJson || "{}") as Record<string, unknown>;
  } catch {
    return JSON.stringify({ ok: false, error: "invalid_json_args" });
  }

  try {
    switch (options.name) {
      case "planner_list_blocks": {
        const rangeStart = asString(args.range_start);
        const rangeEnd = asString(args.range_end);
        if (!rangeStart || !rangeEnd) {
          return JSON.stringify({ ok: false, error: "missing_range" });
        }
        const blocks = await listPlanBlocksInRange(
          options.supabase,
          options.userId,
          rangeStart,
          rangeEnd,
        );
        return JSON.stringify({ ok: true, blocks });
      }

      case "planner_create_blocks": {
        const rawBlocks = Array.isArray(args.blocks) ? args.blocks : [];
        const inputs: NotalPlanBlockInput[] = [];
        const syncFlags: boolean[] = [];

        for (const raw of rawBlocks) {
          if (!raw || typeof raw !== "object") continue;
          const row = raw as Record<string, unknown>;
          const start_at = asString(row.start_at);
          const end_at = asString(row.end_at);
          const title = asString(row.title);
          if (!start_at || !end_at || !title) continue;
          if (new Date(end_at).getTime() <= new Date(start_at).getTime()) {
            continue;
          }
          inputs.push({
            start_at,
            end_at,
            title,
            notes: asString(row.notes) || "",
            source: "planner",
          });
          syncFlags.push(asBoolean(row.sync_google));
        }

        if (!inputs.length) {
          return JSON.stringify({ ok: false, error: "no_valid_blocks" });
        }

        const created = await createPlanBlocks(
          options.supabase,
          options.userId,
          inputs,
        );

        const synced: Array<{ id: string; google_event_id?: string | null; error?: string }> =
          [];
        for (let i = 0; i < created.length; i += 1) {
          if (!syncFlags[i]) continue;
          const result = await syncPlanBlockToGoogle(
            options.userId,
            created[i]!,
          );
          synced.push({
            id: created[i]!.id,
            google_event_id: result.googleEventId,
            error: result.error,
          });
          if (result.googleEventId) {
            await updatePlanBlock(options.supabase, options.userId, created[i]!.id, {
              google_event_id: result.googleEventId,
            });
          }
        }

        return JSON.stringify({ ok: true, blocks: created, synced });
      }

      case "planner_update_block": {
        const blockId = asString(args.block_id);
        if (!blockId) {
          return JSON.stringify({ ok: false, error: "missing_block_id" });
        }
        const updated = await updatePlanBlock(
          options.supabase,
          options.userId,
          blockId,
          {
            start_at: asString(args.start_at),
            end_at: asString(args.end_at),
            title: asString(args.title),
            notes: asString(args.notes),
          },
        );
        if (!updated) {
          return JSON.stringify({ ok: false, error: "not_found" });
        }

        let syncError: string | undefined;
        if (asBoolean(args.sync_google)) {
          const result = await syncPlanBlockToGoogle(options.userId, updated);
          syncError = result.error;
          if (result.googleEventId) {
            await updatePlanBlock(options.supabase, options.userId, blockId, {
              google_event_id: result.googleEventId,
            });
            updated.google_event_id = result.googleEventId;
          }
        }

        return JSON.stringify({ ok: true, block: updated, sync_error: syncError });
      }

      case "planner_delete_block": {
        const blockId = asString(args.block_id);
        if (!blockId) {
          return JSON.stringify({ ok: false, error: "missing_block_id" });
        }
        const deleted = await deletePlanBlock(
          options.supabase,
          options.userId,
          blockId,
        );
        return JSON.stringify({ ok: deleted, deleted });
      }

      default:
        return JSON.stringify({ ok: false, error: "unknown_tool" });
    }
  } catch (error) {
    console.error("[planner tool]", options.name, error);
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "tool_failed",
    });
  }
}
