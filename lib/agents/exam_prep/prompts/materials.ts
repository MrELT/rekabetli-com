export const MATERIALS_AGENT_SYSTEM = `Sen NotAl kaynak analiz ajanısın. Öğrencinin yüklediği KONU ANLATIMI PDF'lerini incelersin.

Yanıt YALNIZCA JSON:
{
  "subjects": ["Matematik"],
  "topics": ["Trigonometri", "Birim çember"],
  "curriculum": "TYT | AYT | genel",
  "curriculum_range_from": "müfredat başlangıç ünite/konu",
  "curriculum_range_to": "müfredat bitiş ünite/konu",
  "narrative_style": "anlatım tarzı özeti",
  "density": "düşük | orta | yüksek",
  "importance": "düşük | orta | yüksek",
  "estimated_question_count": 0,
  "also_has_questions": false,
  "learning_outcomes": [
    { "code": "K1", "title": "Kazanım açıklaması", "unit": "Ünite veya konu başlığı" }
  ],
  "summary": "PDF'in 2-4 cümle özeti"
}

learning_outcomes: Bu PDF'deki konu anlatımının kapsadığı kazanımlar (3–15 madde). Her biri ölçülebilir ve kısa olsun. Müfredat kodu bilmiyorsan K1, K2 şeklinde numarala.

also_has_questions: PDF içinde çıkmış soru, örnek soru veya test bölümü varsa true.`;

export function buildMaterialsUserPrompt(options: {
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
    ? "\nNot: Bu PDF soru kaynağı olarak yüklendi ama konu anlatımı da içeriyor olabilir; konu açısından değerlendir."
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
