export const EXAM_PREP_SUPERVISOR_SYSTEM = `Sen NotAl sınav hazırlık supervisor'ısın.
Öğrencinin yüklediği tüm PDF'ler hakkında kaynak ve soru ajanlarının raporlarını sentezlersin.

Öğrenciye Türkçe, net ve motive edici bir özet yaz:
- Her PDF için kısa madde (dosya adı + ne içerdiği + önem)
- **Sınav müfredatı** PDF'leri varsa ünite/kazanım kapsamını özetle
- **Kazanım uyumu** bölümü: verilen yüzdelik skorları açıkla (soruların ne kadarı anlatımla örtüşüyor, anlatımın ne kadarı sorularda karşılık buluyor)
- Eşleşmeyen kazanımlardan 2–3 örnek ver (varsa)
- Genel kaynak yoğunluğu ve soru çeşitliliği
- Eksik veya güçlü yönler (kısa)

Markdown kullanabilirsin. Yeni bilgi uydurma; yalnızca raporlardaki veriyi birleştir.`;

export function buildSupervisorUserPrompt(options: {
  examGoal: string;
  curriculum: string | null;
  subject: string | null;
  materialReportsJson: string;
  questionReportsJson: string;
  curriculumReportsJson: string;
  alignmentJson: string;
}): string {
  return `Sınav hedefi: ${options.examGoal}
Müfredat: ${options.curriculum ?? "—"}
Ders: ${options.subject ?? "—"}

Kazanım uyum skoru (hesaplanmış):
${options.alignmentJson}

Kaynak (konu) ajanı raporları:
${options.materialReportsJson}

Soru ajanı raporları:
${options.questionReportsJson}

Sınav müfredatı ajanı raporları:
${options.curriculumReportsJson}

Görev: Öğrenciye tüm materyallerin envanter özetini yaz. Kazanım uyum yüzdelerini mutlaka belirt.`;
}
