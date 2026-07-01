import type { NotesImageLabel } from "@/lib/notes-images/types";

const REQUIRED_KEYS: (keyof NotesImageLabel)[] = [
  "topic",
  "sub_topic",
  "difficulty",
  "formula_context",
  "description",
];

export const NOTES_IMAGE_LABEL_JSON_SCHEMA = `{
  "topic": "Ana konu (ör. Trigonometri)",
  "sub_topic": "Alt konu (ör. Birim çember)",
  "difficulty": "kolay | orta | zor",
  "formula_context": "Görseldeki formüller ve semboller",
  "description": "Görselin pedagojik açıklaması"
}`;

export const VISION_LABEL_SYSTEM_PROMPT = `Sen MEB ders kitaplarındaki akademik görselleri etiketleyen bir uzmanısın.
Görseli analiz et ve yalnızca aşağıdaki JSON şemasında yanıt ver. Tüm alanlar zorunludur:
${NOTES_IMAGE_LABEL_JSON_SCHEMA}

Kurallar:
- Türkçe yaz.
- topic ve sub_topic müfredat terimleriyle uyumlu olsun.
- formula_context: görünen tüm formül ve sembolleri LaTeX benzeri netlikte yaz.
- description: öğrenciye yönelik, görselin ne anlattığını özetle.
- Yanıt YALNIZCA JSON objesi olsun.`;

function normalizeString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.trim();
}

export function parseNotesImageLabel(raw: unknown): NotesImageLabel | null {
  if (!raw || typeof raw !== "object") return null;

  const record = raw as Record<string, unknown>;
  const label: NotesImageLabel = {
    topic: normalizeString(record.topic),
    sub_topic: normalizeString(record.sub_topic),
    difficulty: normalizeString(record.difficulty, "orta"),
    formula_context: normalizeString(record.formula_context),
    description: normalizeString(record.description),
  };

  if (!label.topic || !label.description) return null;

  for (const key of REQUIRED_KEYS) {
    if (!label[key]) {
      if (key === "sub_topic" || key === "formula_context") {
        label[key] = key === "sub_topic" ? label.topic : "—";
      } else if (key === "difficulty") {
        label.difficulty = "orta";
      } else {
        return null;
      }
    }
  }

  return label;
}

export function buildLabelEmbeddingText(label: NotesImageLabel): string {
  return [
    `Konu: ${label.topic}`,
    `Alt konu: ${label.sub_topic}`,
    `Zorluk: ${label.difficulty}`,
    `Formül bağlamı: ${label.formula_context}`,
    `Açıklama: ${label.description}`,
  ].join("\n");
}
