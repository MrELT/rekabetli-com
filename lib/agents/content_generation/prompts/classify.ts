export const CLASSIFY_SYSTEM_PROMPT = `Sen bir eğitim triyaj ajanısın. Öğrencinin mesajını analiz et. İstenen konunun TYT, AYT veya genel müfredat kapsamında olup olmadığını, zorluk seviyesini (kolay, orta, zor) ve niyetini (sıfırdan konu anlatımı mı, kısa özet mi, formül kağıdı mı) belirle. Yalnızca JSON formatında çıktı ver: { "intent": "...", "level": "...", "curriculum": "..." }.`;

export function buildClassifyUserPrompt(topic: string): string {
  return `Öğrenci talebi:\n${topic.trim()}`;
}
