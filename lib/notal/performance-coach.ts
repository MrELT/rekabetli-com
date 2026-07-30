import {
  createNotalOpenAI,
} from "@/lib/notal/openai-client";
import { extractOutputText } from "@/lib/notal/openai-helpers";
import {
  formatAverageNets,
  formatGapNets,
  type PerformanceProgress,
} from "@/lib/notal/performance-progress";

/** Ucuz motivasyon cümlesi modeli. */
export const PERFORMANCE_COACH_MODEL = "gpt-4o-mini";

function fallbackCoachLine(progress: PerformanceProgress): string {
  const p = progress.successPercent;
  if (p >= 95) {
    return "Hedefinin kapısındasın; netlerin uçuyor, temposunu koru.";
  }
  if (p >= 80) {
    return "Yolun çoğunu tamamladın; hedefine neredeyse yaklaştın, pes etme.";
  }
  if (p >= 60) {
    return "İyi bir ivmedesin; kalan netler için düzenli deneme ve analiz şart.";
  }
  if (p >= 40) {
    return "Temelin oluşuyor; her denemede küçük artış seni hedefe yaklaştırır.";
  }
  return "Başlangıç sağlam; sabırla net artır, hedef uzak değil.";
}

function buildCoachPrompt(progress: PerformanceProgress): string {
  return `Öğrenci YKS hazırlanıyor.
Alan: ${progress.area}
Hedef sıralama: ${progress.targetRank}
Hedef netler: TYT ~${progress.target.tytNet}${
    progress.target.aytNet !== null ? ` · AYT ~${progress.target.aytNet}` : ""
  }${
    progress.target.ydtNet !== null ? ` · YDT ~${progress.target.ydtNet}` : ""
  }
Ortalama (${progress.sampleLabel}): ${formatAverageNets(progress)}
Hedefe kalan: ${formatGapNets(progress)}
Başarı oranı: %${progress.successPercent}

Tek cümle yaz: samimi, motive edici, abartısız Türkçe. Örnek ton: "Yolun çoğunu tamamladın, netlerin uçuyor." veya "Hedefine neredeyse yaklaştın, pes etme."
Sadece cümleyi döndür; tırnak, emoji, madde yok. En fazla 18 kelime.`;
}

/**
 * Hedef vs deneme ortalamasına göre kısa motivasyon cümlesi üretir.
 */
export async function generatePerformanceCoachLine(
  progress: PerformanceProgress,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const openai = createNotalOpenAI();
    const response = await openai.responses.create(
      {
        model: PERFORMANCE_COACH_MODEL,
        input: [
          {
            role: "system",
            content:
              "YKS koçusun. Kısa, sıcak, gerçekçi bir motivasyon cümlesi yazarsın.",
          },
          {
            role: "user",
            content: buildCoachPrompt(progress),
          },
        ],
        max_output_tokens: 60,
      },
      signal ? { signal } : undefined,
    );

    const text = extractOutputText(response)
      .replace(/^["“]|["”]$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (text && text.length <= 160) return text;
  } catch (error) {
    console.error("[notal] performance coach failed:", error);
  }

  return fallbackCoachLine(progress);
}
