/** Akademik içerik işleme (OpenAI Vision + sayfa render) yapılandırması */

export const ACADEMIC_INGESTION_VISION_MODEL =
  process.env.ACADEMIC_INGESTION_VISION_MODEL?.trim() ||
  process.env.NOTES_IMAGES_VISION_MODEL?.trim() ||
  "gpt-4o-mini";
export const PDF_PAGE_RENDER_SCALE = Number(
  process.env.PDF_PAGE_RENDER_SCALE ?? "2.5",
);

export const ACADEMIC_INGESTION_MAX_PAGES = Number(
  process.env.ACADEMIC_INGESTION_MAX_PAGES ?? "40",
);

export const ACADEMIC_PAGE_ANALYSIS_PROMPT = `Bu bir akademik kitap sayfası. Sayfayı analiz et ve şu JSON yapısını döndür:
{
  "summary": "Sayfanın genel özeti",
  "text_content": "Sayfadaki metinlerin rafine edilmiş hali",
  "questions": ["Sayfada geçen sorular", "Problemler"],
  "visuals": [
    {
      "type": "graph | diagram | chart | figure | table",
      "description": "Detaylı açıklama",
      "bounding_box": [xmin, ymin, xmax, ymax]
    }
  ],
  "is_academic": true,
  "is_complete": true,
  "trailing_fragment": ""
}

Kurallar:
- Yanıt YALNIZCA geçerli JSON olsun.
- is_academic: false yalnızca logo, sayfa numarası, boş sayfa, süs/dekoratif öğe veya akademik içerik taşımayan sayfalar için.
- is_complete: Sayfanın sonundaki metin veya soru cümle/paragraf ortasında bitiyorsa false. Tamamlanmışsa true.
- trailing_fragment: is_complete false ise sayfa sonundaki yarım metin/soru parçası (tamamlanmamış kısım). is_complete true ise boş string "".
- Önceki sayfadan devam eden metin verildiyse, onu bu sayfayla birleştirerek text_content ve questions üret; devam parçasını atlama.
- bounding_box: sayfa genişliği/yüksekliğine göre 0–1 arası normalize koordinatlar [xmin, ymin, xmax, ymax].
- questions: yalnızca bu sayfada TAMAMLANMIŞ soruları listele; sayfa sonunda yarım kalan soruyu questions'a ekleme, trailing_fragment'e koy.
- visuals: akademik şekil/grafik yoksa boş dizi [].
- text_content: formüller ve tanımları koruyarak Türkçe rafine metin; yarım kalan son paragrafı dahil etme (o trailing_fragment'te).
- Türkçe yaz.`;
