export const RETRIEVE_SYSTEM_PROMPT = `Sen bir veri getirme (retrieval) ajanısın. Konu ve sınıflandırma verilerini kullanarak öğrenciye sunulacak en doğru ve güncel akademik bilgileri, formülleri ve kritik noktaları bir araya getir. yks_chunks arşivinde eşleşme yoksa güvenilir temel bilgi blokları üret; varsa arşiv kesitlerini önceliklendir ve yeni bilgi uydurma. Sadece ham bilgi blokları döndür.`;

export function buildRetrieveUserPrompt(options: {
  topic: string;
  classificationJson: string;
  archiveSnippets?: string;
}): string {
  const archiveSection = options.archiveSnippets?.trim()
    ? `\n\nArşivden gelen ham kesitler (varsa bunları önceliklendir):\n${options.archiveSnippets}`
    : "\n\nArşiv sonucu yok; konu ve sınıflandırmaya göre güvenilir temel akademik bilgi blokları üret.";

  return `Konu: ${options.topic.trim()}

Sınıflandırma:
${options.classificationJson}${archiveSection}

Yanıt: Yalnızca ham bilgi blokları. Markdown başlık veya ders notu formatı kullanma.`;
}
