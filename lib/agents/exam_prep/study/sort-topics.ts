import type { KazanımAlignmentResult, LearningOutcome } from "@/lib/agents/exam_prep/alignment-types";
import type { StudyTopicItem } from "@/lib/agents/exam_prep/study/types";

function normalize(value: string): string {
  return value.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
}

function overlaps(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wordsA = na.split(" ").filter((w) => w.length > 4);
  return wordsA.some((word) => nb.includes(word));
}

function matchesOutcome(topic: StudyTopicItem, outcome: LearningOutcome): boolean {
  if (topic.learningOutcomes.some((o) => o.code === outcome.code)) return true;
  if (overlaps(topic.title, outcome.title)) return true;
  if (overlaps(topic.unit, outcome.unit)) return true;
  return false;
}

/** Eksik kazanımlı konuları öne alır (yüksek skor = önce çalış). */
export function scoreStudyTopicGap(
  topic: StudyTopicItem,
  alignment: KazanımAlignmentResult | null | undefined,
): number {
  if (!alignment) return 0;

  let score = 0;

  for (const outcome of alignment.unmatchedQuestionOutcomes) {
    if (matchesOutcome(topic, outcome)) score += 5;
  }

  for (const outcome of alignment.unmatchedMaterialOutcomes) {
    if (matchesOutcome(topic, outcome)) score += 3;
  }

  return score;
}

export function sortStudyTopicsByAlignment(
  topics: StudyTopicItem[],
  alignment: KazanımAlignmentResult | null | undefined,
): StudyTopicItem[] {
  if (!alignment) {
    return topics.map((topic, index) => ({ ...topic, index }));
  }

  const sorted = [...topics].sort((a, b) => {
    const gapDiff = scoreStudyTopicGap(b, alignment) - scoreStudyTopicGap(a, alignment);
    if (gapDiff !== 0) return gapDiff;
    return a.index - b.index;
  });

  return sorted.map((topic, index) => ({ ...topic, index }));
}
