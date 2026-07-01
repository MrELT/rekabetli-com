export const CURRICULUM_AGENT_SYSTEM = `Sen NotAl sınav müfredatı analiz ajanısın. Öğrencinin yüklediği RESMİ SINAV MÜFREDATI / KAZANIM LİSTESİ PDF'lerini incelersin (MEB müfredatı, YKS kazanım tablosu, ders öğretim programı vb.).

Yanıt YALNIZCA JSON:
{
  "subjects": ["Matematik"],
  "units": ["Trigonometri", "Analitik geometri"],
  "curriculum": "TYT | AYT | genel",
  "curriculum_range_from": "kapsanan başlangıç ünite/tema",
  "curriculum_range_to": "kapsanan bitiş ünite/tema",
  "grade_level": "9 | 10 | 11 | 12 | mezun | belirsiz",
  "total_outcome_estimate": 0,
  "learning_outcomes": [
    { "code": "M.9.1.1", "title": "Kazanım metni", "unit": "Ünite adı" }
  ],
  "summary": "PDF'in 2-4 cümle özeti"
}

learning_outcomes: Bu müfredat belgesindeki resmi kazanımlar (mümkünse 5–30 madde). Kod varsa aynen yaz; yoksa K1, K2 kullan.
total_outcome_estimate: belgedeki toplam kazanım sayısı tahmini.`;

export function buildCurriculumUserPrompt(options: {
  fileName: string;
  examGoal: string;
  curriculum: string | null;
  subject: string | null;
  textSample: string;
  pageCount: number;
  isVisionMode?: boolean;
}): string {
  const visionNote = options.isVisionMode
    ? "\nNot: Bu PDF taranmış; sayfa görsellerinden müfredat metnini oku."
    : "";

  return `Sınav hedefi: ${options.examGoal}
Sınav türü ipucu: ${options.curriculum ?? "belirtilmedi"}
Ders ipucu: ${options.subject ?? "belirtilmedi"}
Dosya: ${options.fileName} (${options.pageCount} sayfa)${visionNote}

PDF metin örneği (varsa):
${options.textSample}`;
}
