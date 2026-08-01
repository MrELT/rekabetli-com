import {
  createNotalOpenAI,
} from "@/lib/notal/openai-client";
import { extractOutputText } from "@/lib/notal/openai-helpers";
import {
  formatAverageNets,
  formatGapNets,
  type PerformanceProgress,
} from "@/lib/notal/performance-progress";

/** Kısa ve gerçekçi performans değerlendirmesi modeli. */
export const PERFORMANCE_COACH_MODEL = "gpt-4o-mini";

function fallbackCoachLine(progress: PerformanceProgress): string {
  const p = progress.successPercent;
  if (p >= 95) {
    return "Hedef net bandına çok yakınsın; mevcut çalışma düzenini koruyup eksiklerini kapat.";
  }
  if (p >= 80) {
    return "Hedefe yaklaşmış olsan da kalan netler için yanlışlarını düzenli analiz etmelisin.";
  }
  if (p >= 60) {
    return "Hedefle aranda belirgin bir fark var; zayıf konulara göre çalışma planını güncellemelisin.";
  }
  if (p >= 40) {
    return "Mevcut netler hedefin için yetersiz; çalışma süreni ve planını yeniden değerlendirmelisin.";
  }
  return "Hedefle arandaki fark büyük; daha yoğun ve sürdürülebilir yeni bir çalışma planı oluşturmalısın.";
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

Tek cümlelik dürüst bir performans değerlendirmesi yaz:
- Önceliğin öğrenciyi iyi hissettirmek değil, veriye göre gerçekçi yönlendirmek olsun.
- Bu veriler yalnızca mevcut ortalamayı gösteriyor; önceki dönemle karşılaştırma olmadığı için "ilerliyorsun", "ivme kazandın" veya "geriliyorsun" deme.
- Hedefle fark belirginse açıkça daha çok çalışması, zayıf konularını analiz etmesi ya da yeni bir plan oluşturması gerektiğini söyleyebilirsin.
- Hedefe yakınsa bunu ölçülü biçimde belirt; "netlerin uçuyor" gibi abartılı övgüler kullanma.
- Yalnızca bir deneme varsa kesin yargı yerine verinin sınırlı olduğunu gözet.
Sadece cümleyi döndür; tırnak, emoji, madde yok. En fazla 18 kelime.`;
}

/**
 * Hedef vs deneme ortalamasına göre kısa performans değerlendirmesi üretir.
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
              "YKS koçusun. Veriye dayalı, kısa ve dürüst performans değerlendirmesi yazarsın; gerektiğinde yapıcı biçimde eleştirirsin.",
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
