export type StudentChoiceQuestionType =
  | "class_level"
  | "yks_area"
  | "exam_target"
  | "custom";

export type StudentChoiceOption = {
  label: string;
  value: string;
};

export type StudentChoicePrompt = {
  questionType: StudentChoiceQuestionType;
  options: StudentChoiceOption[];
  message?: string;
};

export const STUDENT_CHOICE_PRESETS: Record<
  Exclude<StudentChoiceQuestionType, "custom">,
  StudentChoiceOption[]
> = {
  class_level: [
    { label: "9. Sınıf", value: "9. Sınıf" },
    { label: "10. Sınıf", value: "10. Sınıf" },
    { label: "11. Sınıf", value: "11. Sınıf" },
    { label: "12. Sınıf", value: "12. Sınıf" },
    { label: "Mezun", value: "Mezun" },
  ],
  yks_area: [
    { label: "Sayısal", value: "Sayısal" },
    { label: "Eşit Ağırlık", value: "Eşit Ağırlık" },
    { label: "Sözel", value: "Sözel" },
    { label: "Dil", value: "Dil" },
  ],
  exam_target: [
    { label: "TYT", value: "TYT" },
    { label: "AYT", value: "AYT" },
    { label: "YDS", value: "YDS" },
  ],
};

function parseCustomOptions(value: unknown): StudentChoiceOption[] {
  if (!Array.isArray(value)) return [];

  const result: StudentChoiceOption[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      const text = item.trim();
      result.push({ label: text, value: text });
      continue;
    }

    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = typeof row.label === "string" ? row.label.trim() : "";
    const optionValue =
      typeof row.value === "string" ? row.value.trim() : label;
    if (!label && !optionValue) continue;
    result.push({
      label: label || optionValue,
      value: optionValue || label,
    });
  }

  return result.slice(0, 10);
}

export function resolveStudentChoicePrompt(
  questionType: unknown,
  message?: string,
  customOptions?: unknown,
): StudentChoicePrompt | null {
  const trimmedMessage = message?.trim() || undefined;

  if (questionType === "custom") {
    const options = parseCustomOptions(customOptions);
    if (options.length < 2) return null;
    return {
      questionType: "custom",
      options,
      message: trimmedMessage,
    };
  }

  if (
    questionType === "class_level" ||
    questionType === "yks_area" ||
    questionType === "exam_target"
  ) {
    return {
      questionType,
      options: STUDENT_CHOICE_PRESETS[questionType],
      message: trimmedMessage,
    };
  }

  return null;
}
