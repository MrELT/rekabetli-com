import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPlanBlocks,
  deletePlanBlock,
  getPlanBlock,
  listPlanBlocksInRange,
  updatePlanBlock,
} from "@/lib/notal/planner/repository";
import type { NotalPlanBlockInput } from "@/lib/notal/planner/types";
import {
  applyGoogleSyncForBlock,
  deleteLinkedGoogleEvent,
} from "@/lib/notal/google-calendar/sync";
import { isUserGoogleCalendarConnected } from "@/lib/notal/google-calendar/oauth";

const MUTATION_TOOLS = new Set([
  "planner_create_blocks",
  "planner_update_block",
  "planner_delete_block",
]);

export function isPlannerMutationTool(name: string): boolean {
  return MUTATION_TOOLS.has(name);
}

export const PLANNER_TOOLS = [
  {
    type: "function" as const,
    strict: false,
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
    strict: false,
    name: "planner_create_blocks",
    description:
      "Günlük/haftalık çalışma planı için bir veya daha fazla saatlik blok oluşturur. Google Takvim bağlıysa otomatik senkronize edilir.",
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
    strict: false,
    name: "planner_update_block",
    description:
      "Mevcut bir plan bloğunu günceller. Google Takvim bağlıysa otomatik senkronize edilir.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        block_id: { type: "string" },
        start_at: { type: "string" },
        end_at: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
      },
      required: ["block_id"],
    },
  },
  {
    type: "function" as const,
    strict: false,
    name: "planner_delete_block",
    description:
      "Bir plan bloğunu siler. Google Takvim bağlıysa ilişkili etkinlik de silinir.",
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
        }

        if (!inputs.length) {
          return JSON.stringify({ ok: false, error: "no_valid_blocks" });
        }

        const created = await createPlanBlocks(
          options.supabase,
          options.userId,
          inputs,
        );

        const googleConnected = await isUserGoogleCalendarConnected(
          options.userId,
        );
        const synced: Array<{ id: string; google_event_id?: string | null; error?: string }> =
          [];

        for (const block of created) {
          if (!googleConnected) continue;
          const result = await applyGoogleSyncForBlock(
            options.supabase,
            options.userId,
            block,
          );
          synced.push({
            id: block.id,
            google_event_id: result.block.google_event_id,
            error: result.error,
          });
        }

        return JSON.stringify({
          ok: true,
          blocks: created,
          google_connected: googleConnected,
          synced,
        });
      }

      case "planner_update_block": {
        const blockId = asString(args.block_id);
        if (!blockId) {
          return JSON.stringify({ ok: false, error: "missing_block_id" });
        }
        let updated = await updatePlanBlock(
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

        const googleConnected = await isUserGoogleCalendarConnected(
          options.userId,
        );
        let syncError: string | undefined;
        if (googleConnected) {
          const result = await applyGoogleSyncForBlock(
            options.supabase,
            options.userId,
            updated,
          );
          updated = result.block;
          syncError = result.error;
        }

        return JSON.stringify({
          ok: true,
          block: updated,
          google_connected: googleConnected,
          sync_error: syncError,
        });
      }

      case "planner_delete_block": {
        const blockId = asString(args.block_id);
        if (!blockId) {
          return JSON.stringify({ ok: false, error: "missing_block_id" });
        }

        const existing = await getPlanBlock(
          options.supabase,
          options.userId,
          blockId,
        );
        if (!existing) {
          return JSON.stringify({ ok: false, error: "not_found" });
        }

        const googleDelete = await deleteLinkedGoogleEvent(
          options.userId,
          existing.google_event_id,
        );

        const deleted = await deletePlanBlock(
          options.supabase,
          options.userId,
          blockId,
        );
        return JSON.stringify({
          ok: deleted,
          deleted,
          google_delete_error: googleDelete.error,
        });
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
