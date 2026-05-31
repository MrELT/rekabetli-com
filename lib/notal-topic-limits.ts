/** NotAl konu girişi: kısa, odaklı başlık (ör. "Kepler kanunları"). */
export const NOTAL_MAX_TOPIC_WORDS = 20;

/** Karakter üst sınırı (aşırı uzun tek kelimeler / yapıştırma). */
export const NOTAL_MAX_TOPIC_CHARS = 280;

export function countNotalTopicWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function clampNotalTopicInput(text: string): string {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= NOTAL_MAX_TOPIC_WORDS) {
    return text.slice(0, NOTAL_MAX_TOPIC_CHARS);
  }
  return parts.slice(0, NOTAL_MAX_TOPIC_WORDS).join(" ");
}

export function notalTopicWordLimitError(): string {
  return `Konu en fazla ${NOTAL_MAX_TOPIC_WORDS} kelime olabilir.`;
}
