import type { KazanımAlignmentResult, LearningOutcome } from "@/lib/agents/exam_prep/alignment-types";
import { sortStudyTopicsByAlignment, scoreStudyTopicGap } from "@/lib/agents/exam_prep/study/sort-topics";
import type { StudyInitInput, StudyInitResult, StudyTopicItem } from "@/lib/agents/exam_prep/study/types";
const MAX_STUDY_TOPICS = 30;

function outcomeKey(outcome: LearningOutcome): string {
  return `${outcome.code}|${outcome.title.toLowerCase().trim()}`;
}

function dedupeOutcomes(outcomes: LearningOutcome[]): LearningOutcome[] {
  const seen = new Set<string>();
  const result: LearningOutcome[] = [];

  for (const outcome of outcomes) {
    const key = outcomeKey(outcome);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(outcome);
  }

  return result;
}

function topicsFromCurriculum(
  input: StudyInitInput,
): StudyTopicItem[] {
  const outcomes = dedupeOutcomes(
    input.curriculumReports.flatMap((report) => report.learningOutcomes),
  );

  return outcomes.slice(0, MAX_STUDY_TOPICS).map((outcome, index) => ({
    index,
    title: outcome.title,
    unit: outcome.unit || "Genel",
    briefing: [
      `Resmi müfredat kazanımı: ${outcome.code} — ${outcome.title}`,
      outcome.unit ? `Ünite/tema: ${outcome.unit}` : "",
      input.subject ? `Ders: ${input.subject}` : "",
      input.examGoal ? `Sınav hedefi: ${input.examGoal}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    learningOutcomes: [outcome],
    source: "curriculum" as const,
  }));
}

function topicsFromMaterials(
  input: StudyInitInput,
): StudyTopicItem[] {
  const topicSet = new Set<string>();
  const allOutcomes = dedupeOutcomes(
    input.materialReports.flatMap((report) => report.learningOutcomes),
  );

  for (const report of input.materialReports) {
    for (const topic of report.topics) {
      const trimmed = topic.trim();
      if (trimmed) topicSet.add(trimmed);
    }
  }

  const topics = Array.from(topicSet).slice(0, MAX_STUDY_TOPICS);

  if (!topics.length) {
    const fallbackOutcomes = allOutcomes.slice(0, MAX_STUDY_TOPICS);
    return fallbackOutcomes.map((outcome, index) => ({
      index,
      title: outcome.title,
      unit: outcome.unit || "Genel",
      briefing: [
        `Konu anlatımı kazanımı: ${outcome.title}`,
        input.subject ? `Ders: ${input.subject}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      learningOutcomes: [outcome],
      source: "material" as const,
    }));
  }

  return topics.map((topic, index) => {
    const relatedOutcomes = allOutcomes.filter(
      (outcome) =>
        outcome.unit.toLowerCase().includes(topic.toLowerCase()) ||
        topic.toLowerCase().includes(outcome.unit.toLowerCase()) ||
        outcome.title.toLowerCase().includes(topic.toLowerCase().slice(0, 12)),
    );

    const outcomes =
      relatedOutcomes.length > 0
        ? relatedOutcomes.slice(0, 6)
        : [{ code: `K${index + 1}`, title: topic, unit: topic }];

    return {
      index,
      title: topic,
      unit: outcomes[0]?.unit || topic,
      briefing: [
        `Konu anlatımı odağı: ${topic}`,
        input.subject ? `Ders: ${input.subject}` : "",
        input.examGoal ? `Hedef: ${input.examGoal}` : "",
        outcomes.length
          ? `İlgili kazanımlar: ${outcomes.map((o) => o.title).join("; ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      learningOutcomes: outcomes,
      source: "material" as const,
    };
  });
}

/** Müfredat varsa kazanımlardan, yoksa konu anlatımı konularından çalışma kuyruğu oluşturur. */
export function buildStudyTopicQueue(input: StudyInitInput): StudyInitResult {
  let queueSource: StudyInitResult["queueSource"] = "fallback";
  let topics: StudyTopicItem[] = [];

  const curriculumTopics = topicsFromCurriculum(input);

  if (curriculumTopics.length) {
    queueSource = "curriculum";
    topics = curriculumTopics;
  } else {
    const materialTopics = topicsFromMaterials(input);
    if (materialTopics.length) {
      queueSource = "material";
      topics = materialTopics;
    } else {
      topics = [
        {
          index: 0,
          title: input.examGoal || "Genel tekrar",
          unit: "Genel",
          briefing: input.examGoal || "YKS sınav hazırlığı genel tekrar",
          learningOutcomes: [],
          source: "material",
        },
      ];
    }
  }

  const sorted = sortStudyTopicsByAlignment(topics, input.kazanımAlignment);
  const withGap = sorted.map((topic) => ({
    ...topic,
    gapScore: scoreStudyTopicGap(topic, input.kazanımAlignment),
  }));

  return {
    sessionId: null,
    topics: withGap,
    totalTopics: withGap.length,
    queueSource,
    sortedByAlignment: Boolean(input.kazanımAlignment),
  };
}
