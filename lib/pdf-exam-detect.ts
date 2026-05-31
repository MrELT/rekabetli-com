/** PDF metninin çıkmış soru / sınav kitapçığı olma ihtimali */
export function looksLikeExamPdf(text: string): boolean {
  const sample = text.slice(0, 12000);
  const lower = sample.toLowerCase();

  const keywordHits = [
    /\b(soru|problem|question)\s*[\d.:]/i,
    /\b(çıkmış|çözüm|cevap\s*anahtarı|sınav|deneme|olimpiyat)\b/i,
    /\b(tübitak|ioaa|ipho|icho|ibbo|usaa|usao)\b/i,
    /\b(exam|test\s*paper|multiple\s*choice)\b/i,
    /\bpuan\b/i,
    /\b[a-e]\)\s/i,
  ].filter((re) => re.test(sample)).length;

  const numberedItems = (sample.match(/(?:^|\n)\s*\d{1,3}[.)]\s+/gm) ?? [])
    .length;

  const hasQuestions = (sample.match(/\?/g) ?? []).length >= 2;

  return keywordHits >= 2 || numberedItems >= 4 || (keywordHits >= 1 && hasQuestions);
}

export function isExamDocumentType(typeLabel: string): boolean {
  const t = typeLabel.trim().toLowerCase();
  return (
    t.includes("çıkmış") ||
    t.includes("soru") ||
    t.includes("sınav") ||
    t.includes("exam")
  );
}

/** Sayfa başına karakter eşiği — çıkmış soru PDF'leri için daha düşük */
export function minCharsPerPageRequired(
  textSample: string,
  isExamHint?: boolean,
): number {
  if (isExamHint || looksLikeExamPdf(textSample)) {
    return 45;
  }
  return 200;
}

/** Toplam metin yeterli mi (tamamen boş/taranmış değil) */
export function hasMinimumExtractedText(
  totalChars: number,
  pageCount: number,
  isExamHint?: boolean,
): boolean {
  const exam = isExamHint ?? false;
  const minTotal = exam ? 120 : 400;
  const minPages = Math.max(pageCount, 1);
  return totalChars >= minTotal && totalChars / minPages >= (exam ? 25 : 80);
}
