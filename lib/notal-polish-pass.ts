import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

const POLISH_SYSTEM_PROMPT = `Sen Rekabetli NotAl için ikincil kalite kontrol editörüsün. Görevin: verilen akademik notu İÇERİĞİ KISALTMA veya ÖZETLEME YAPMADAN yalnızca biçim ve LaTeX açısından mükemmelleştirmek.

ZORUNLU DÜZELTMELER:
1. PDF/RAG artığı çöp metinleri SİL: tek harfli dikey satırlar, anlamsız parçalar (olank, u, ¨), yalnız "$" satırları, dağınık "\\c" parçaları.
2. LaTeX (rehype-katex uyumlu):
   - Satır içi: $R$ (boşluksuz, tek $)
   - Blok: $$ ayrı satırda açılır, formül ortada, $$ ayrı satırda kapanır
   - ASLA: $ $ $ $, $$formül$$ tek satırda
   - YANLIŞ: U_{\\text{eff}}=...\\rho^2 Burada \\Omegasistemin... (formül ile Burada AYNI SATIRDA, $ YOK)
   - YANLIŞ: \\mathbf{r}=\\mathbf{r}_1-\\mathbf{r}_2 şeklinde tanımlanır. veya m_1\\ddot{\\mathbf{r}}_1=... m_2\\ddot{...} Bu iki denklemi (ham LaTeX, $ yok)
   - YANLIŞ: r harflerinin her biri ayrı satırda (dikey PDF çöpü) — bunları $|r|=r$ gibi tek satırda düzelt
   - YANLIŞ: \\mathbf{M}=\\mathbf{T}(d)\\mathbf{L}(f) cümle içinde $ yok — DOĞRU: $\\mathbf{M}=\\mathbf{T}(d)\\mathbf{L}(f)$
   - DOĞRU: önce $$ bloğu, sonra **Semboller:** listesi: "- **Ω** — açıklama" (Unicode harf; "$\\Omega$:" yazma). Her Newton denklemi ayrı $$ bloğu; Türkçe ayrı paragrafta.
3. Bozuk formülleri matematiksel bağlamdan anlayıp sıfırdan doğru LaTeX ile yaz; ham PDF dizilimini kopyalama.
4. Markdown başlıkları (##, ###), listeler ve blockquote yapısını koru; paragrafları okunaklı bırak.

YASAK: "İşte düzeltilmiş metin", açıklama veya önsöz ekleme. Yalnızca düzeltilmiş notun tamamını döndür.`;

function usesMaxCompletionTokens(model: string): boolean {
  return /^gpt-5|^o\d/i.test(model);
}

function buildPolishChatOptions(
  model: string,
  maxOutput: number,
): ChatCompletionCreateParamsNonStreaming {
  const base: ChatCompletionCreateParamsNonStreaming = {
    model,
    temperature: 0.2,
    messages: [],
  };

  if (usesMaxCompletionTokens(model)) {
    return { ...base, max_completion_tokens: maxOutput };
  }
  return { ...base, max_tokens: maxOutput };
}

/**
 * İlk taslak üzerinden ikincil LLM geçişi: LaTeX + Markdown kalite kontrolü.
 */
export async function polishNotAlDraft(
  openai: OpenAI,
  model: string,
  topic: string,
  draft: string,
): Promise<string> {
  const maxOutput = Math.min(
    Math.max(draft.length + 800, 2000),
    8192,
  );

  const completion = await openai.chat.completions.create({
    ...buildPolishChatOptions(model, maxOutput),
    messages: [
      { role: "system", content: POLISH_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Konu: ${topic}

Aşağıdaki notu ikincil kontrolden geçir. İçeriği koru; yalnızca çöp metinleri temizle ve LaTeX/Markdown'ı kusursuz hale getir:

---
${draft}
---`,
      },
    ],
  });

  const polished = completion.choices[0]?.message?.content?.trim();
  return polished || draft;
}
