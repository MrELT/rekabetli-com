/**
 * Exam prep iyileştirme smoke testleri (DB/API olmadan).
 * Çalıştır: npx tsx scripts/test-exam-prep-improvements.mts
 */
import assert from "node:assert/strict";

import { buildStudyTopicQueue } from "../lib/agents/exam_prep/study/build-topic-queue.ts";
import { sortStudyTopicsByAlignment, scoreStudyTopicGap } from "../lib/agents/exam_prep/study/sort-topics.ts";
import {
  estimateExamPrepAnalysis,
  formatCostUsd,
} from "../lib/exam-prep/estimates.ts";

const alignment = {
  questionCoveragePct: 40,
  materialCoveragePct: 50,
  overallAlignmentPct: 45,
  matchedCount: 2,
  totalQuestionOutcomes: 5,
  totalMaterialOutcomes: 4,
  matchedPairs: [],
  unmatchedQuestionOutcomes: [
    { code: "S1", title: "Trigonometrik oranlar", unit: "Trigonometri" },
  ],
  unmatchedMaterialOutcomes: [
    { code: "K9", title: "Logaritma kuralları", unit: "Logaritma" },
  ],
};

const queue = buildStudyTopicQueue({
  examGoal: "TYT Matematik",
  curriculum: "TYT",
  subject: "Matematik",
  materialReports: [
    {
      pdfId: "1",
      fileName: "konu.pdf",
      agent: "materials",
      subjects: ["Matematik"],
      topics: ["Trigonometri", "Logaritma"],
      curriculum: "TYT",
      curriculumRangeFrom: "",
      curriculumRangeTo: "",
      narrativeStyle: "",
      density: "orta",
      importance: "yüksek",
      estimatedQuestionCount: 10,
      alsoHasQuestions: false,
      summary: "",
      transferredToQuestions: false,
      analysisMode: "text",
      learningOutcomes: [
        { code: "K1", title: "Trigonometrik oranlar", unit: "Trigonometri" },
        { code: "K2", title: "Logaritma kuralları", unit: "Logaritma" },
      ],
    },
  ],
  questionReports: [],
  curriculumReports: [],
  kazanımAlignment: alignment,
});

assert.equal(queue.sortedByAlignment, true);
assert.ok(queue.topics.length >= 2);

const trig = queue.topics.find((t) => t.title.includes("Trigonometri"));
const log = queue.topics.find((t) => t.title.includes("Logaritma"));
assert.ok(trig && log);
assert.ok(
  scoreStudyTopicGap(trig, alignment) >= scoreStudyTopicGap(log, alignment) ||
    trig.index <= log.index,
);

const sorted = sortStudyTopicsByAlignment(
  [
    {
      index: 0,
      title: "Logaritma",
      unit: "Logaritma",
      briefing: "",
      learningOutcomes: [],
      source: "material",
    },
    {
      index: 1,
      title: "Trigonometri",
      unit: "Trigonometri",
      briefing: "",
      learningOutcomes: [
        { code: "S1", title: "Trigonometrik oranlar", unit: "Trigonometri" },
      ],
      source: "material",
    },
  ],
  alignment,
);

assert.equal(sorted[0]?.title, "Trigonometri");

const est = estimateExamPrepAnalysis({
  materialCount: 2,
  questionCount: 1,
  curriculumCount: 0,
  visionPdfCount: 1,
});

assert.ok(est.analysisMinutes > 0);
assert.ok(est.warnings.some((w) => w.includes("10")));

assert.equal(formatCostUsd(0.005), "<$0.01");
assert.ok(formatCostUsd(0.05).startsWith("~$"));

console.log("✓ exam prep improvements smoke tests passed");
console.log(`  queue topics: ${queue.topics.length}, sorted: ${queue.sortedByAlignment}`);
console.log(`  estimate: ${est.analysisMinutes}dk ${formatCostUsd(est.analysisCostUsd)}`);
