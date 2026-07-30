import { YKS_TOPICS, type YksTopicsExam } from "@/lib/notal/yks-topics";

export type ResolvedYksTopic = {
  exam: YksTopicsExam;
  branch: string;
  topic: string;
};

function normalize(value: string): string {
  return value
    .trim()
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr-TR");
}

function tokenOverlap(a: string, b: string): number {
  const stop = new Set([
    "ve",
    "ile",
    "temel",
    "kavramlar",
    "genel",
    "ayt",
    "tyt",
    "yds",
    "konusu",
    "konu",
  ]);
  const aTokens = normalize(a)
    .split(/[\s/():,-]+/)
    .filter((t) => t.length > 1 && !stop.has(t));
  const bTokens = normalize(b)
    .split(/[\s/():,-]+/)
    .filter((t) => t.length > 1 && !stop.has(t));
  if (!aTokens.length || !bTokens.length) return 0;
  return aTokens.filter((t) =>
    bTokens.some((bt) => bt === t || bt.includes(t) || t.includes(bt)),
  ).length;
}

export function listCatalogForExam(exam: YksTopicsExam): string {
  return YKS_TOPICS[exam].branches
    .map(
      (branch) =>
        `- ${branch.name}:\n${branch.curriculum.map((item) => `  - ${item}`).join("\n")}`,
    )
    .join("\n");
}

/**
 * Maps free-form exam/branch/topic labels onto the exact YKS curriculum entry.
 */
export function resolveYksTopicPlacement(options: {
  exam: YksTopicsExam;
  branch?: string | null;
  topic: string;
}): ResolvedYksTopic {
  const catalog = YKS_TOPICS[options.exam].branches;
  const topicNorm = normalize(options.topic);
  const branchHint = options.branch ? normalize(options.branch) : "";

  // Exact curriculum match first.
  for (const branch of catalog) {
    for (const item of branch.curriculum) {
      if (normalize(item) === topicNorm) {
        return { exam: options.exam, branch: branch.name, topic: item };
      }
    }
  }

  type Candidate = {
    branch: string;
    topic: string;
    score: number;
  };
  const candidates: Candidate[] = [];

  for (const branch of catalog) {
    const branchBonus =
      branchHint &&
      (normalize(branch.name) === branchHint ||
        normalize(branch.name).includes(branchHint) ||
        branchHint.includes(normalize(branch.name)) ||
        topicNorm.includes(normalize(branch.name)))
        ? 3
        : 0;

    for (const item of branch.curriculum) {
      const itemNorm = normalize(item);
      let score = branchBonus + tokenOverlap(options.topic, item);

      if (topicNorm.includes(itemNorm) || itemNorm.includes(topicNorm)) {
        score += 4;
      }

      // Prefer atom/periyodik when electron config / quantum model language appears.
      if (
        /atom|elektron|dizilim|kuantum|orbital|periyodik/.test(topicNorm) &&
        /atom|periyodik|elektron/.test(itemNorm)
      ) {
        score += 3;
      }

      candidates.push({ branch: branch.name, topic: item, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best && best.score > 0) {
    return {
      exam: options.exam,
      branch: best.branch,
      topic: best.topic,
    };
  }

  // Fallback: branch-only hint, first curriculum item.
  const hintedBranch =
    catalog.find(
      (branch) =>
        branchHint &&
        (normalize(branch.name) === branchHint ||
          topicNorm.includes(normalize(branch.name))),
    ) ?? catalog[0];

  return {
    exam: options.exam,
    branch: hintedBranch?.name ?? "Genel",
    topic: hintedBranch?.curriculum[0] ?? options.topic,
  };
}
