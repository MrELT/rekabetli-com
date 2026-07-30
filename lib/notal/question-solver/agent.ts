import {
  createNotalOpenAI,
  NOTAL_ORCHESTRATOR_MODEL,
} from "@/lib/notal/openai-client";
import { extractOutputText } from "@/lib/notal/openai-helpers";
import {
  buildOrchestratorUserContent,
  type NotalChatAttachmentInput,
} from "@/lib/notal/chat-attachments";
import type { YksTopicsExam } from "@/lib/notal/yks-topics";
import {
  listCatalogForExam,
  resolveYksTopicPlacement,
} from "@/lib/notal/question-solver/topic-match";

export const NOTAL_QUESTION_SOLVER_MODEL = "gpt-5.6-luna";

export type NotalQuestionSolution = {
  id: string;
  exam: YksTopicsExam;
  branch: string;
  topic: string;
  question: string;
  solution: string;
  finalAnswer?: string;
};

function createLocalId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeJsonParse(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!fenceMatch?.[1]) return null;
    try {
      return JSON.parse(fenceMatch[1]) as unknown;
    } catch {
      return null;
    }
  }
}

export async function runQuestionSolverAgent(options: {
  exam: YksTopicsExam;
  topic: string;
  question: string;
  branch?: string | null;
  attachments?: NotalChatAttachmentInput[];
  signal?: AbortSignal;
}): Promise<NotalQuestionSolution> {
  const openai = createNotalOpenAI();
  const model = NOTAL_QUESTION_SOLVER_MODEL || NOTAL_ORCHESTRATOR_MODEL;
  const catalog = listCatalogForExam(options.exam);
  const attachments = options.attachments ?? [];

  const prompt = `
Sen NotAl soru çözme ajanısın (GPT-5.6 Luna).
Görevin YKS sorusunu OKUYUP ÇÖZMEK. Orchestrator değil, SEN çözersin.

Görevin:
- Verilen soruyu (metin ve/veya görsel/PDF) oku.
- Çözümü adım adım, anlaşılır ve sınav diline uygun şekilde yaz.
- Sonunda net bir finalAnswer ver (örn. "D").

ÇIKTI:
- Tek bir JSON nesnesi döndür.
- Anahtarlar: exam, branch, topic, question, solution, finalAnswer.
  - exam: "TYT" | "AYT" | "YDS"
  - branch: Aşağıdaki katalogdan BİREBİR branş adı (örn. "Kimya")
  - topic: Aşağıdaki katalogdan BİREBİR müfredat başlığı (örn. "Atom ve periyodik sistem")
  - question: Sorunun metni (görselden okuduysan yaz)
  - solution: Okunabilir çözüm metni
  - finalAnswer: Son cevap (örn. "D")

solution yazım kuralları (çok önemli):
- Markdown kalınlık (**...**) KULLANMA. Seçenekleri vurgulamak için ** kullanma.
- Seçenekleri şu satır formatında yaz: "A: ..." , "B: ..." (her seçenek ayrı satır)
- Formül, elektron dizilimi, üslü ifadeler ve matematiksel eşitlikleri LaTeX ile yaz ($...$ veya $$...$$).
- Örnek: $$1s^2 2s^2 2p^6 3s^2 3p^6 4s^2 3d^2$$
- Son satırda "Doğru cevap: D" gibi kısa bir sonuç yaz.

Katalog (${options.exam}):
${catalog}
  `.trim();

  const questionText = [
    prompt,
    "",
    "Girdi:",
    `- exam: ${options.exam}`,
    `- branch_hint: ${options.branch ?? ""}`,
    `- topic_hint: ${options.topic}`,
    "- question:",
    options.question || "(Soru ekte; görsel/PDF'den oku.)",
  ].join("\n");

  const content = buildOrchestratorUserContent(questionText, attachments);

  const response = await openai.responses.create(
    {
      model,
      instructions:
        "Sen GPT-5.6 Luna soru çözme ajanısın. Sadece JSON döndür. Türkçe çözüm üret. branch ve topic katalogdan birebir seçilsin.",
      input: [
        {
          role: "user",
          content,
        },
      ] as never,
      reasoning: { effort: "medium" },
    },
    options.signal ? { signal: options.signal } : undefined,
  );

  const text = extractOutputText(response as never);
  const parsed = safeJsonParse(text);

  const fallbackPlacement = resolveYksTopicPlacement({
    exam: options.exam,
    branch: options.branch,
    topic: options.topic,
  });

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("solution" in parsed) ||
    !("question" in parsed)
  ) {
    return {
      id: createLocalId(),
      exam: fallbackPlacement.exam,
      branch: fallbackPlacement.branch,
      topic: fallbackPlacement.topic,
      question: options.question,
      solution: text || options.question,
      finalAnswer: "",
    };
  }

  const obj = parsed as Record<string, unknown>;
  const exam =
    obj.exam === "TYT" || obj.exam === "AYT" || obj.exam === "YDS"
      ? obj.exam
      : options.exam;

  const rawBranch =
    typeof obj.branch === "string" && obj.branch.trim()
      ? obj.branch.trim()
      : options.branch ?? "";
  const rawTopic =
    typeof obj.topic === "string" && obj.topic.trim()
      ? obj.topic.trim()
      : options.topic;

  const placement = resolveYksTopicPlacement({
    exam,
    branch: rawBranch,
    topic: rawTopic,
  });

  const question =
    typeof obj.question === "string" && obj.question.trim()
      ? obj.question.trim()
      : options.question;

  const solution =
    typeof obj.solution === "string" && obj.solution.trim()
      ? obj.solution.trim()
      : text || options.question;

  const finalAnswer =
    typeof obj.finalAnswer === "string" ? obj.finalAnswer.trim() : "";

  return {
    id: createLocalId(),
    exam: placement.exam,
    branch: placement.branch,
    topic: placement.topic,
    question,
    solution,
    finalAnswer,
  };
}

export function formatQuestionSolverChatReply(
  solution: NotalQuestionSolution,
): string {
  const lines = [
    `Soru çözüm ajanı (GPT-5.6 Luna)`,
    `${solution.exam} · ${solution.branch} · ${solution.topic}`,
    "",
    solution.solution.trim(),
  ];
  if (solution.finalAnswer) {
    lines.push("", `Doğru cevap: ${solution.finalAnswer}`);
  }
  lines.push(
    "",
    `Konuya eklendi. Bilgi kartı ${solution.exam} sayfasında.`,
  );
  return lines.join("\n");
}
