import OpenAI from "openai";
import {
  NOTAL_SUBJECTS,
  normalizeNotalSubject,
  type NotalSubject,
} from "@/lib/notal-subjects";

const CLASSIFIER_MODEL = "gpt-4o-mini";

const SUBJECT_LIST = NOTAL_SUBJECTS.join(", ");

const SYSTEM_PROMPT = `Sen olimpiyat ve lise düzeyi akademik konuları sınıflandıran bir asistansın.
Verilen konu başlığını yalnızca şu alanlardan birine ata:
${SUBJECT_LIST}

Kurallar:
- Yanıt JSON: {"subject": "<alan adı>"}
- subject değeri listedeki ifadelerden biri olmalı; başka metin yazma.
- Astronomi ve astrofizik konuları → Astronomi
- Mekanik, elektromanyetizma, termodinamik, modern fizik → Fizik
- Analiz, cebir, kombinatorik, geometri → Matematik
- Organik/anorganik/biyokimya → Kimya
- Hücre, genetik, ekoloji, fizyoloji → Biyoloji
- Algoritma, programlama, veri yapıları → Bilgisayar Bilimi
- Hiçbiri net değilse → Diğer`;

export async function classifyNotalSubject(
  openai: OpenAI,
  topic: string,
): Promise<NotalSubject> {
  try {
    const completion = await openai.chat.completions.create({
      model: CLASSIFIER_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Konu: ${topic.trim()}` },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return "Diğer";

    const parsed = JSON.parse(raw) as { subject?: unknown };
    if (typeof parsed.subject === "string") {
      return normalizeNotalSubject(parsed.subject);
    }
  } catch (error) {
    console.warn("notal subject classify:", error);
  }

  return "Diğer";
}
