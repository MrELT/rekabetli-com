import { createNotalOpenAI } from "@/lib/notal/openai-client";
import { extractOutputText } from "@/lib/notal/openai-helpers";
import type {
  CommitteeVeto,
  PlanCommitteeBrief,
  SpecialistOpinion,
  SpecialistRole,
} from "@/lib/notal/plan-committee/types";

/** Komite uzmanları: GPT-5.6 Terra (dengeli maliyet/kalite). */
export const PLAN_COMMITTEE_SPECIALIST_MODEL = "gpt-5.6-terra";

const SPECIALIST_TIMEOUT_MS = 20_000;

function withTimeoutSignal(
  parent: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  const onParentAbort = () => controller.abort();
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

function safeJsonParse(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!fenceMatch?.[1]) return null;
    try {
      return JSON.parse(fenceMatch[1]) as unknown;
    } catch {
      return null;
    }
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringList(value: unknown, max = 2): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, max);
}

function asVeto(value: unknown): CommitteeVeto {
  return value === "soft" || value === "hard" ? value : "none";
}

function emptyOpinion(role: SpecialistRole): SpecialistOpinion {
  return {
    role,
    risks: [],
    suggestions: [],
    veto: "none",
    vetoReason: "",
  };
}

function normalizeOpinion(
  role: SpecialistRole,
  raw: unknown,
): SpecialistOpinion {
  if (!raw || typeof raw !== "object") return emptyOpinion(role);
  const row = raw as Record<string, unknown>;
  return {
    role,
    risks: asStringList(row.risks, 2),
    suggestions: asStringList(row.suggestions, 2),
    veto: asVeto(row.veto),
    vetoReason: asString(row.veto_reason ?? row.vetoReason).slice(0, 160),
  };
}

function buildBriefText(brief: PlanCommitteeBrief): string {
  return `Öğrenci isteği:
${brief.request}

Öğrenci profili:
${brief.studentSummary || "Bilgi yok"}

Performans:
${brief.performanceSummary || "Deneme/hedef verisi yok"}

Mevcut takvim (yakın dönem):
${brief.calendarSummary || "Plan yok"}`;
}

async function runSpecialist(options: {
  role: SpecialistRole;
  system: string;
  brief: PlanCommitteeBrief;
  signal?: AbortSignal;
}): Promise<SpecialistOpinion> {
  const openai = createNotalOpenAI();
  const { signal, cleanup } = withTimeoutSignal(
    options.signal,
    SPECIALIST_TIMEOUT_MS,
  );

  try {
    const response = await openai.responses.create(
      {
        model: PLAN_COMMITTEE_SPECIALIST_MODEL,
        instructions: `${options.system}

Kurallar:
- Sadece JSON döndür; başka metin yazma.
- risks: en fazla 2 kısa madde
- suggestions: en fazla 2 kısa madde
- veto: "none" | "soft" | "hard"
- veto_reason: veto soft/hard ise kısa gerekçe, değilse ""
- Hard veto yalnızca gerçekten kritik durumlarda (aşırı yük/burnout veya hedefe bariz aykırı plan).
- Serbest tartışma yok; tek tur, kısa ve net ol.

JSON şema:
{"risks":["..."],"suggestions":["..."],"veto":"none","veto_reason":""}`,
        input: [
          {
            role: "user",
            content: buildBriefText(options.brief),
          },
        ],
        max_output_tokens: 400,
        reasoning: { effort: "low" },
      },
      { signal },
    );

    const parsed = safeJsonParse(extractOutputText(response));
    return normalizeOpinion(options.role, parsed);
  } catch (error) {
    console.error(`[notal] plan committee ${options.role} failed:`, error);
    return emptyOpinion(options.role);
  } finally {
    cleanup();
  }
}

export async function runPdrSpecialist(options: {
  brief: PlanCommitteeBrief;
  signal?: AbortSignal;
}): Promise<SpecialistOpinion> {
  return runSpecialist({
    role: "pdr",
    brief: options.brief,
    signal: options.signal,
    system: `Sen NotAl PDR (psikolojik danışmanlık ve rehberlik) uzmanısın.
Odak: sürdürülebilir tempo, motivasyon, dinlenme, kaygı ve aşırı yük.
Akademik net hesabı yapma; onu sınav uzmanına bırak.
Hard veto: öğrenci için açıkça sürdürülemez / burnout riski yüksek plan.`,
  });
}

export async function runExamSpecialist(options: {
  brief: PlanCommitteeBrief;
  signal?: AbortSignal;
}): Promise<SpecialistOpinion> {
  return runSpecialist({
    role: "exam",
    brief: options.brief,
    signal: options.signal,
    system: `Sen NotAl sınav uzmanısın (YKS/TYT/AYT/YDT).
Odak: hedef sıralama, deneme netleri, ders dengesi, deneme-analiz döngüsü, gerçekçi net artışı.
Motivasyon/psikolojiye girme; onu PDR'ye bırak.
Hard veto: hedefe bariz aykırı veya akademik olarak boşa giden plan.`,
  });
}
