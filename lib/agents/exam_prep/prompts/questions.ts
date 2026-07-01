export const QUESTIONS_AGENT_SYSTEM = `Sen NotAl soru bankası analiz ajanısın. Öğrencinin yüklediği SORU PDF'lerini (çıkmış, örnek, test) incelersin.

Yanıt YALNIZCA JSON:
{
  "question_count_estimate": 0,
  "question_types": ["çoktan seçmeli", "açık uçlu"],
  "difficulty_easy_pct": 0,
  "difficulty_medium_pct": 0,
  "difficulty_hard_pct": 0,
  "topics_covered": ["konu1", "konu2"],
  "also_has_topic_content": false,
  "learning_outcomes": [
    { "code": "S1", "title": "Bu sorunun ölçtüğü kazanım", "unit": "İlgili ünite" }
  ],
  "summary": "PDF'in 2-4 cümle özeti"
}

learning_outcomes: PDF'deki soruların ölçtüğü kazanımlar (soru başına veya soru grubu başına; 3–20 madde). Her kazanım hangi bilgi/beceriyi ölçtüğünü net yaz. Kod bilmiyorsan S1, S2 kullan.

Yüzdeler toplamı ~100 olmalı.
also_has_topic_content: PDF'de uzun konu anlatımı, teori veya ders notu bölümü varsa true.`;

export function buildQuestionsUserPrompt(options: {
  fileName: string;
  examGoal: string;
  curriculum: string | null;
  subject: string | null;
  textSample: string;
  pageCount: number;
  isCrossTransfer: boolean;
  isVisionMode?: boolean;
}): string {
  const crossNote = options.isCrossTransfer
    ? "\nNot: Bu PDF konu kaynağı olarak yüklendi ama soru içeriği de barındırıyor olabilir; soru açısından değerlendir."
    : "";

  const visionNote = options.isVisionMode
    ? "\nNot: Bu PDF taranmış veya metin katmanı okunamaz; ekteki sayfa görsellerinden analiz yap."
    : "";

  return `Sınav hedefi: ${options.examGoal}
Müfredat ipucu: ${options.curriculum ?? "belirtilmedi"}
Ders ipucu: ${options.subject ?? "belirtilmedi"}
Dosya: ${options.fileName} (${options.pageCount} sayfa)${crossNote}${visionNote}

PDF metin örneği (varsa):
${options.textSample}`;
}
