"use client";

import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useState,
} from "react";
import { createNotalAuthBrowserClient } from "@/lib/notal/auth-browser";
import NotalCalendar from "@/components/notal/NotalCalendar";
import {
  getFilteredYksTopics,
  type YksTopicsExam,
} from "@/lib/notal/yks-topics";
import type {
  NotalStudentProfile,
  NotalTrialExam,
  YksExam,
} from "@/lib/notal/student-context";
import type { StudentChoicePrompt } from "@/lib/notal/student-prompts";
import type { NotalQuestionSolution } from "@/lib/notal/question-solver/agent";
import type { NotalKnowledgeCard } from "@/lib/notal/insight/agent";
import SolutionRichText from "@/components/notal/SolutionRichText";
import NotalTrialAnalysisPanel from "@/components/notal/NotalTrialAnalysisPanel";
import type { NotalTrialAnalysis } from "@/lib/notal/trial-analysis";
import {
  estimateTargetNets,
  formatTargetNetSummary,
} from "@/lib/notal/target-nets";
import {
  computePerformanceProgress,
  formatAverageNets,
  formatGapNets,
} from "@/lib/notal/performance-progress";
import {
  fileToPendingAttachment,
  formatStoredMessageContent,
  MAX_CHAT_ATTACHMENTS,
  toAttachmentInput,
  type ChatMessageAttachmentView,
  type PendingChatAttachment,
} from "@/lib/notal/chat-attachments";

type ChatRole = "user" | "assistant" | "system";
type AppView = "asistan" | "takvim" | "yks" | "tyt" | "ayt" | "yds";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  attachments?: ChatMessageAttachmentView[];
};

type ConversationItem = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

const LAST_CONVERSATION_STORAGE_KEY = "notal_last_conversation_id";

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function friendlyError(code: string): string {
  switch (code) {
    case "auth_required":
      return "Oturum gerekli. Yeniden giriş yap.";
    case "openai_not_configured":
      return "OpenAI API anahtarı tanımlı değil (.env → OPENAI_API_KEY).";
    case "invalid_messages":
      return "Mesaj gönderilemedi.";
    case "conversation_not_found":
      return "Sohbet bulunamadı.";
    case "persist_failed":
      return "Sohbet kaydedilemedi.";
    case "list_failed":
      return "Sohbet listesi yüklenemedi.";
    case "aborted":
      return "İstek iptal edildi.";
    default:
      return "Yanıt alınamadı. Biraz sonra tekrar dene.";
  }
}

async function getAccessToken(): Promise<string | null> {
  const supabase = createNotalAuthBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function authFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error("auth_required");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(path, { ...init, headers });
}

const COMPOSE_INPUT_MAX_HEIGHT = 120;

function formatTrialExamSummary(exam: NotalTrialExam): string {
  const parts: string[] = [];
  if (exam.tytNet !== null) parts.push(`TYT ${exam.tytNet}`);
  if (exam.aytNet !== null) parts.push(`AYT ${exam.aytNet}`);
  if (exam.ydsNet !== null) parts.push(`YDS ${exam.ydsNet}`);
  return parts.join(" · ") || "Net bilgisi yok";
}

function stripAttachmentFooter(content: string): string {
  return content.replace(/\n\n\[Ek: [^\]]+\]$/, "").trim();
}

function normalizeTopic(value: string): string {
  return value
    .trim()
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr-TR");
}

function solutionMatchesTopic(
  solution: NotalQuestionSolution,
  exam: YksTopicsExam,
  branchName: string,
  curriculumItem: string,
): boolean {
  if (solution.exam !== exam) return false;
  if (normalizeTopic(solution.branch) !== normalizeTopic(branchName)) {
    return false;
  }
  return normalizeTopic(solution.topic) === normalizeTopic(curriculumItem);
}

function solutionBelongsToBranch(
  solution: NotalQuestionSolution,
  exam: YksTopicsExam,
  branchName: string,
): boolean {
  return (
    solution.exam === exam &&
    normalizeTopic(solution.branch) === normalizeTopic(branchName)
  );
}

function looksLikeRichSolution(text: string): boolean {
  return (
    /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/.test(text) ||
    /^\s*(?:[-*•]\s*)?(?:\*\*)?[A-Ea-e](?:\*\*)?\s*[:.)]/m.test(text) ||
    /\*\*[^*]+\*\*/.test(text)
  );
}

export default function NotalApp() {
  const [activeView, setActiveView] = useState<AppView>("asistan");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [yksExam, setYksExam] = useState<YksExam | null>(null);
  const [studentContext, setStudentContext] = useState<NotalStudentProfile | null>(
    null,
  );
  const [selectedTopicByExam, setSelectedTopicByExam] = useState<
    Record<YksTopicsExam, number>
  >({
    TYT: 0,
    AYT: 0,
    YDS: 0,
  });
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [choicePrompt, setChoicePrompt] = useState<StudentChoicePrompt | null>(
    null,
  );
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingChatAttachment[]
  >([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [questionSolutions, setQuestionSolutions] = useState<
    NotalQuestionSolution[]
  >([]);
  const [knowledgeCards, setKnowledgeCards] = useState<NotalKnowledgeCard[]>(
    [],
  );
  const [activeQuestionSolutionId, setActiveQuestionSolutionId] = useState<
    string | null
  >(null);
  const [activeKnowledgeCardId, setActiveKnowledgeCardId] = useState<
    string | null
  >(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasRestoredConversationRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "takvim") {
      setActiveView("takvim");
      return;
    }
    if (params.get("view") === "yks") {
      setActiveView("yks");
      return;
    }
    if (params.get("view") === "tyt") {
      setActiveView("tyt");
      return;
    }
    if (params.get("view") === "ayt") {
      setActiveView("ayt");
      return;
    }
    if (params.get("view") === "yds") {
      setActiveView("yds");
    }
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const response = await authFetch("/api/notal/conversations");
      if (!response.ok) return;
      const payload = (await response.json()) as {
        conversations?: ConversationItem[];
      };
      setConversations(payload.conversations ?? []);
    } catch {
      /* ignore list errors in UI shell */
    } finally {
      setLoadingList(false);
    }
  }, []);

  const refreshStudentContext = useCallback(async () => {
    try {
      const response = await authFetch("/api/notal/student-context");
      if (!response.ok) return;
      const payload = (await response.json()) as {
        context?: NotalStudentProfile;
      };
      if (payload.context) {
        setStudentContext(payload.context);
        const analyses = payload.context.trialAnalyses ?? [];
        const solutionsFromAnalyses = analyses.flatMap((item) =>
          item.solutions.map(
            (sol): NotalQuestionSolution => ({
              id: sol.id,
              exam: sol.exam,
              branch: sol.branch,
              topic: sol.topic,
              question: sol.question,
              solution: sol.solution,
              finalAnswer: sol.finalAnswer,
            }),
          ),
        );
        const cardsFromAnalyses = analyses.flatMap((item) =>
          item.knowledgeCards.map(
            (card): NotalKnowledgeCard => ({
              id: card.id,
              exam: card.exam,
              branch: card.branch,
              topic: card.topic,
              title: card.title,
              summary: card.summary,
              keyPoints: card.keyPoints,
              formula: card.formula,
              trap: card.trap,
              sourceSolutionId: card.sourceSolutionId,
            }),
          ),
        );
        if (solutionsFromAnalyses.length) {
          setQuestionSolutions((prev) => {
            const ids = new Set(prev.map((s) => s.id));
            const merged = [
              ...solutionsFromAnalyses.filter((s) => !ids.has(s.id)),
              ...prev,
            ];
            return merged.slice(0, 40);
          });
        }
        if (cardsFromAnalyses.length) {
          setKnowledgeCards((prev) => {
            const ids = new Set(prev.map((c) => c.id));
            const merged = [
              ...cardsFromAnalyses.filter((c) => !ids.has(c.id)),
              ...prev,
            ];
            return merged.slice(0, 40);
          });
        }
      }
    } catch {
      /* ignore context errors in UI shell */
    }
  }, []);

  function mergeTrialAnalysisIntoUi(
    analysis: NotalTrialAnalysis,
    profile?: NotalStudentProfile | null,
  ) {
    if (profile) {
      setStudentContext(profile);
    } else {
      setStudentContext((prev) => {
        if (!prev) {
          return {
            classLevel: null,
            educationLevel: null,
            yksArea: null,
            enabledExams: ["TYT", "AYT"],
            targetRank: null,
            trialExams: [
              {
                name: analysis.name,
                takenAt: analysis.takenAt,
                tytNet: analysis.tytNet,
                aytNet: analysis.aytNet,
                ydsNet: analysis.ydsNet,
              },
            ],
            trialAnalyses: [analysis],
            performanceCoachLine: null,
          };
        }
        return {
          ...prev,
          trialAnalyses: [
            analysis,
            ...prev.trialAnalyses.filter((item) => item.id !== analysis.id),
          ].slice(0, 12),
          trialExams: [
            {
              name: analysis.name,
              takenAt: analysis.takenAt,
              tytNet: analysis.tytNet,
              aytNet: analysis.aytNet,
              ydsNet: analysis.ydsNet,
            },
            ...prev.trialExams,
          ].slice(0, 3),
        };
      });
    }

    if (analysis.solutions.length) {
      setQuestionSolutions((prev) => {
        const ids = new Set(prev.map((s) => s.id));
        const incoming = analysis.solutions
          .filter((s) => !ids.has(s.id))
          .map(
            (sol): NotalQuestionSolution => ({
              id: sol.id,
              exam: sol.exam,
              branch: sol.branch,
              topic: sol.topic,
              question: sol.question,
              solution: sol.solution,
              finalAnswer: sol.finalAnswer,
            }),
          );
        return [...incoming, ...prev].slice(0, 40);
      });
    }

    if (analysis.knowledgeCards.length) {
      setKnowledgeCards((prev) => {
        const ids = new Set(prev.map((c) => c.id));
        const incoming = analysis.knowledgeCards
          .filter((c) => !ids.has(c.id))
          .map(
            (card): NotalKnowledgeCard => ({
              id: card.id,
              exam: card.exam,
              branch: card.branch,
              topic: card.topic,
              title: card.title,
              summary: card.summary,
              keyPoints: card.keyPoints,
              formula: card.formula,
              trap: card.trap,
              sourceSolutionId: card.sourceSolutionId,
            }),
          );
        return [...incoming, ...prev].slice(0, 40);
      });
    }
  }

  useEffect(() => {
    void refreshConversations();
    void refreshStudentContext();
  }, [refreshConversations, refreshStudentContext]);

  const yksAreaDetected = studentContext?.yksArea ?? null;
  const ydsEnabled = studentContext?.enabledExams.includes("YDS") ?? false;
  const targetNetEstimate = estimateTargetNets(
    studentContext?.targetRank,
    yksAreaDetected,
  );
  const performanceProgress = studentContext
    ? computePerformanceProgress(studentContext)
    : null;

  const enabledExams = useMemo<YksExam[]>(() => {
    if (studentContext?.enabledExams?.length) return studentContext.enabledExams;
    return ["TYT", "AYT"];
  }, [studentContext]);

  useEffect(() => {
    if (activeView !== "asistan") return;
    // Kullanıcının YKS alanını henüz tespit edemediysek (yksAreaDetected null),
    // yanlış bir varsayılan seçmek yerine boş bırakıyoruz.
    if (!yksAreaDetected) return;
    if (!yksExam || !enabledExams.includes(yksExam)) {
      setYksExam(enabledExams[0] ?? null);
    }
  }, [enabledExams, yksAreaDetected, yksExam]);

  useEffect(() => {
    setSelectedTopicByExam({ TYT: 0, AYT: 0, YDS: 0 });
  }, [yksAreaDetected, ydsEnabled]);

  const scrollChatToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "auto",
      });
    });
  }, []);

  const activeQuestionSolution = useMemo(() => {
    if (!activeQuestionSolutionId) return null;
    return (
      questionSolutions.find((s) => s.id === activeQuestionSolutionId) ??
      null
    );
  }, [questionSolutions, activeQuestionSolutionId]);

  const activeKnowledgeCard = useMemo(() => {
    if (!activeKnowledgeCardId) return null;
    return knowledgeCards.find((c) => c.id === activeKnowledgeCardId) ?? null;
  }, [knowledgeCards, activeKnowledgeCardId]);

  const resizeComposeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, COMPOSE_INPUT_MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY =
      el.scrollHeight > COMPOSE_INPUT_MAX_HEIGHT ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    if (conversationId) {
      sessionStorage.setItem(LAST_CONVERSATION_STORAGE_KEY, conversationId);
    }
  }, [conversationId]);

  useEffect(() => {
    inputRef.current?.focus();
    resizeComposeInput();
    return () => {
      abortRef.current?.abort();
    };
  }, [resizeComposeInput]);

  useEffect(() => {
    resizeComposeInput();
  }, [draft, resizeComposeInput]);

  function closeSidebar() {
    setSidebarOpen(false);
  }

  function startNewChat() {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setDraft("");
    setChoicePrompt(null);
    setPendingAttachments([]);
    setAttachmentError("");
    setQuestionSolutions([]);
    setKnowledgeCards([]);
    setActiveQuestionSolutionId(null);
    setActiveKnowledgeCardId(null);
    setSending(false);
    sessionStorage.removeItem(LAST_CONVERSATION_STORAGE_KEY);
    closeSidebar();
    inputRef.current?.focus();
  }

  async function openConversation(id: string) {
    if (sending || id === conversationId) {
      closeSidebar();
      return;
    }

    setLoadingThread(true);
    closeSidebar();
    try {
      const response = await authFetch(`/api/notal/conversations/${id}`);
      if (!response.ok) {
        setMessages([
          {
            id: createId(),
            role: "system",
            content: friendlyError(
              response.status === 404 ? "conversation_not_found" : "list_failed",
            ),
          },
        ]);
        return;
      }

      const payload = (await response.json()) as {
        conversation: ConversationItem;
        messages: Array<{
          id: string;
          role: "user" | "assistant";
          content: string;
        }>;
      };

      setConversationId(payload.conversation.id);
      setQuestionSolutions([]);
      setKnowledgeCards([]);
      setActiveQuestionSolutionId(null);
      setActiveKnowledgeCardId(null);
      setChoicePrompt(null);
      setMessages(
        payload.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
        })),
      );
    } catch {
      setMessages([
        {
          id: createId(),
          role: "system",
          content: friendlyError("orchestrator_error"),
        },
      ]);
    } finally {
      setLoadingThread(false);
      inputRef.current?.focus();
      requestAnimationFrame(() => {
        scrollChatToBottom();
        requestAnimationFrame(scrollChatToBottom);
      });
    }
  }

  useEffect(() => {
    if (loadingList || hasRestoredConversationRef.current) return;
    hasRestoredConversationRef.current = true;

    const lastId = sessionStorage.getItem(LAST_CONVERSATION_STORAGE_KEY);
    if (!lastId || conversationId || messages.length > 0) return;

    void openConversation(lastId);
  }, [loadingList, conversationId, messages.length]);

  async function removeConversation(id: string) {
    try {
      const response = await authFetch(`/api/notal/conversations/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) return;
      setConversations((prev) => prev.filter((item) => item.id !== id));
      if (conversationId === id) {
        startNewChat();
      }
    } catch {
      /* ignore */
    }
  }

  async function sendUserMessage(
    text: string,
    attachments: PendingChatAttachment[] = [],
  ) {
    const trimmed = text.trim();
    if ((!trimmed && !attachments.length) || sending || loadingThread) return;

    setChoicePrompt(null);
    const attachmentInputs = attachments.map(toAttachmentInput);
    const storedContent = formatStoredMessageContent(trimmed, attachments);
    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: storedContent,
      attachments: attachments.map((item) => ({
        name: item.name,
        kind: item.kind,
        previewUrl: item.kind === "image" ? item.previewUrl : undefined,
      })),
    };
    const assistantId = createId();
    const historyForApi = [
      ...messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      {
        role: "user" as const,
        content: trimmed,
        ...(attachmentInputs.length ? { attachments: attachmentInputs } : {}),
      },
    ];

    setSending(true);
    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await authFetch("/api/notal/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: historyForApi,
          conversationId,
          yksExam,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        let code = "orchestrator_error";
        try {
          const payload = (await response.json()) as { error?: string };
          if (payload.error) code = payload.error;
        } catch {
          /* ignore */
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, role: "system", content: friendlyError(code) }
              : m,
          ),
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assembled = "";
      let activeConversationId = conversationId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const line = chunk
            .split("\n")
            .map((part) => part.trim())
            .find((part) => part.startsWith("data:"));
          if (!line) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;

          let event: {
            type?: string;
            text?: string;
            message?: string;
            name?: string;
            conversationId?: string;
            conversationCreated?: boolean;
            context?: NotalStudentProfile;
            prompt?: StudentChoicePrompt;
            solution?: NotalQuestionSolution;
            card?: NotalKnowledgeCard;
          };
          try {
            event = JSON.parse(raw) as typeof event;
          } catch {
            continue;
          }

          if (event.type === "meta" && event.conversationId) {
            activeConversationId = event.conversationId;
            setConversationId(event.conversationId);
            if (event.conversationCreated) {
              setConversations((prev) => {
                if (prev.some((item) => item.id === event.conversationId)) {
                  return prev;
                }
                const now = new Date().toISOString();
                return [
                  {
                    id: event.conversationId!,
                    title:
                      text.length > 60 ? `${text.slice(0, 57)}…` : text,
                    created_at: now,
                    updated_at: now,
                  },
                  ...prev,
                ];
              });
            }
          } else if (event.type === "calendar_changed") {
            window.dispatchEvent(new Event("notal-calendar-refresh"));
          } else if (event.type === "student_context_changed" && event.context) {
            setStudentContext(event.context);
          } else if (event.type === "choice_prompt" && event.prompt) {
            setChoicePrompt(event.prompt);
          } else if (
            event.type === "question_solution_ready" &&
            event.solution
          ) {
            const solution = event.solution;
            setQuestionSolutions((prev) => {
              const next = [solution, ...prev];
              return next.slice(0, 30);
            });
            setSelectedTopicByExam((prev) => {
              const branches = getFilteredYksTopics(
                solution.exam,
                yksAreaDetected,
                { ydsEnabled },
              ).branches;
              const idx = branches.findIndex(
                (branch) =>
                  normalizeTopic(branch.name) ===
                  normalizeTopic(solution.branch),
              );
              if (idx < 0) return prev;
              return { ...prev, [solution.exam]: idx };
            });
          } else if (event.type === "knowledge_card_ready" && event.card) {
            setKnowledgeCards((prev) => {
              const next = [event.card!, ...prev];
              return next.slice(0, 40);
            });
          } else if (event.type === "delta" && event.text) {
            assembled += event.text;
            const snapshot = assembled;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: snapshot } : m,
              ),
            );
          } else if (event.type === "error") {
            const msg = friendlyError(event.message || "orchestrator_error");
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      role: assembled ? "assistant" : "system",
                      content: assembled || msg,
                    }
                  : m,
              ),
            );
          } else if (event.type === "done" && event.conversationId) {
            activeConversationId = event.conversationId;
            setConversationId(event.conversationId);
            void refreshStudentContext();
          }
        }
      }

      if (!assembled) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  role: "system",
                  content: "Boş yanıt geldi. Tekrar dener misin?",
                }
              : m,
          ),
        );
      }

      if (activeConversationId) {
        void refreshConversations();
        void refreshStudentContext();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const code =
        error instanceof Error && error.message === "auth_required"
          ? "auth_required"
          : "orchestrator_error";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, role: "system", content: friendlyError(code) }
            : m,
        ),
      );
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if ((!text && !pendingAttachments.length) || sending || loadingThread) {
      return;
    }

    const attachments = [...pendingAttachments];
    setDraft("");
    setPendingAttachments([]);
    setAttachmentError("");
    await sendUserMessage(text, attachments);
  }

  async function handleAttachmentSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    setAttachmentError("");
    const next = [...pendingAttachments];

    for (const file of files) {
      if (next.length >= MAX_CHAT_ATTACHMENTS) {
        setAttachmentError(`En fazla ${MAX_CHAT_ATTACHMENTS} dosya ekleyebilirsin.`);
        break;
      }
      try {
        next.push(await fileToPendingAttachment(file));
      } catch (error) {
        setAttachmentError(
          error instanceof Error ? error.message : "Dosya eklenemedi.",
        );
      }
    }

    setPendingAttachments(next);
    inputRef.current?.focus();
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((prev) => prev.filter((item) => item.id !== id));
    setAttachmentError("");
  }

  function submitChoice(value: string) {
    void sendUserMessage(value);
  }

  function choicePromptTitle(prompt: StudentChoicePrompt): string {
    if (prompt.message) return prompt.message;
    switch (prompt.questionType) {
      case "class_level":
        return "Sınıfını seç";
      case "yks_area":
        return "YKS alanını seç";
      case "exam_target":
        return "Sınav hedefini seç";
      default:
        return "Bir seçenek seç";
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function renderTopicsDashboard(
    exam: YksTopicsExam,
    title: string,
    subtitle: string,
  ) {
    const branches = getFilteredYksTopics(exam, yksAreaDetected, {
      ydsEnabled,
    }).branches;
    const selectedIndexRaw = selectedTopicByExam[exam] ?? 0;
    const selectedIndex =
      selectedIndexRaw >= 0 && selectedIndexRaw < branches.length
        ? selectedIndexRaw
        : 0;
    const selectedBranch = branches[selectedIndex] ?? branches[0];
    const examCards = knowledgeCards
      .filter((card) => card.exam === exam)
      .slice(0, 12);

    return (
      <section className="notal-chat notal-chat--dashboard" aria-label={title}>
        <div className="notal-chat-header">
          <h1 className="notal-chat-title">{title}</h1>
          <p className="notal-chat-subtitle">{subtitle}</p>
        </div>

        <div className="notal-exam-panels">
          <section className="notal-yks-topics" aria-label={`Konular · ${exam}`}>
            <h2 className="notal-yks-topics-title">Konular · {exam}</h2>
            {branches.length === 0 ? (
              <p className="notal-yks-topics-empty">
                Bu sınav için alanına uygun konu listesi bulunmuyor.
              </p>
            ) : (
            <div className="notal-yks-topics-layout">
              <section className="notal-yks-topic-detail desktop-only">
                <h3 className="notal-yks-branch-title">{selectedBranch?.name}</h3>
                <ul className="notal-yks-curriculum">
                  {selectedBranch?.curriculum.map((item) => {
                    const matchedSolutions = questionSolutions
                      .filter((s) =>
                        solutionMatchesTopic(
                          s,
                          exam,
                          selectedBranch.name,
                          item,
                        ),
                      )
                      .slice(0, 5);

                    return (
                      <li key={item}>
                        <div className="notal-topic-row">
                          <span className="notal-topic-name">{item}</span>
                        </div>

                        {matchedSolutions.length ? (
                          <div className="notal-topic-solutions">
                            {matchedSolutions.map((sol, idx) => (
                              <button
                                key={sol.id}
                                type="button"
                                className="notal-topic-solution-btn"
                                onClick={() => setActiveQuestionSolutionId(sol.id)}
                              >
                                {idx === 0 ? "Çözümü gör" : `Çözüm ${idx + 1}`}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {selectedBranch
                  ? (() => {
                      const branchSolutions = questionSolutions
                        .filter((s) =>
                          solutionBelongsToBranch(s, exam, selectedBranch.name),
                        )
                        .slice(0, 8);
                      if (!branchSolutions.length) return null;
                      return (
                        <div className="notal-branch-solutions">
                          <p className="notal-branch-solutions-title">
                            Bu branştaki çözülen sorular
                          </p>
                          <div className="notal-topic-solutions">
                            {branchSolutions.map((sol) => (
                              <button
                                key={`branch-${sol.id}`}
                                type="button"
                                className="notal-topic-solution-btn"
                                onClick={() => setActiveQuestionSolutionId(sol.id)}
                              >
                                {sol.topic}
                                {sol.finalAnswer ? ` · ${sol.finalAnswer}` : ""}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()
                  : null}
              </section>

              <div className="notal-yks-topic-list">
                {branches.map((branch, idx) => {
                  const selected = idx === selectedIndex;
                  return (
                    <article
                      key={branch.name}
                      className={`notal-yks-branch-row${selected ? " is-selected" : ""}`}
                    >
                      <button
                        type="button"
                        className="notal-yks-branch-trigger"
                        onClick={() =>
                          setSelectedTopicByExam((prev) => ({
                            ...prev,
                            [exam]: idx,
                          }))
                        }
                      >
                        <span>{branch.name}</span>
                        <span className="notal-yks-branch-chevron" aria-hidden="true">
                          {selected ? "▾" : "▸"}
                        </span>
                      </button>

                      <section className={`notal-yks-topic-detail mobile-only${selected ? " is-open" : ""}`}>
                        <ul className="notal-yks-curriculum">
                          {branch.curriculum.map((item) => {
                            const matchedSolutions = questionSolutions
                              .filter((s) =>
                                solutionMatchesTopic(s, exam, branch.name, item),
                              )
                              .slice(0, 5);

                            return (
                              <li key={item}>
                                <div className="notal-topic-row">
                                  <span className="notal-topic-name">{item}</span>
                                </div>

                                {matchedSolutions.length ? (
                                  <div className="notal-topic-solutions">
                                    {matchedSolutions.map((sol, idx) => (
                                      <button
                                        key={sol.id}
                                        type="button"
                                        className="notal-topic-solution-btn"
                                        onClick={() =>
                                          setActiveQuestionSolutionId(sol.id)
                                        }
                                      >
                                        {idx === 0 ? "Çözümü gör" : `Çözüm ${idx + 1}`}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    </article>
                  );
                })}
              </div>
            </div>
            )}
          </section>

          <section className="notal-knowledge-panel" aria-label="Bilgi kartları">
            <h2 className="notal-yks-topics-title">Bilgi Kartları</h2>
            {examCards.length === 0 ? (
              <p className="notal-yks-topics-empty">
                Henüz bilgi kartı yok. Asistanım&apos;da bir soru çözdürdüğünde
                buraya özet kartlar eklenir.
              </p>
            ) : (
              <div className="notal-knowledge-grid">
                {examCards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    className="notal-knowledge-card"
                    onClick={() => setActiveKnowledgeCardId(card.id)}
                  >
                    <span className="notal-knowledge-card-meta">
                      {card.branch} · {card.topic}
                    </span>
                    <strong className="notal-knowledge-card-title">
                      {card.title}
                    </strong>
                    <div className="notal-knowledge-card-summary">
                      <SolutionRichText
                        className="notal-rich-text notal-rich-text--compact"
                        text={card.summary}
                      />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    );
  }

  return (
    <div className={`notal-page${sidebarOpen ? " is-sidebar-open" : ""}`}>
      <header className="notal-topnav">
        <a className="notal-brand" href="/">
          <img
            src="/assets/rekabetli.png"
            alt="Rekabetli"
            className="notal-brand-logo"
          />
        </a>
        <div className="notal-topnav-actions">
          <a className="notal-home-btn" href="/" aria-label="Ana sayfa">
            <span aria-hidden="true">⌂</span>
            <span>Ana Sayfa</span>
          </a>
        </div>
      </header>

      <div className="notal-shell">
        <button
          type="button"
          className="notal-mobile-toggle"
          aria-expanded={sidebarOpen}
          aria-controls="notal-sidebar"
          onClick={() => setSidebarOpen((open) => !open)}
        >
          Menü
        </button>

        <button
          type="button"
          className="notal-sidebar-backdrop"
          aria-label="Menüyü kapat"
          tabIndex={sidebarOpen ? 0 : -1}
          onClick={closeSidebar}
        />

        <aside
          id="notal-sidebar"
          className="notal-sidebar"
          aria-label="NotAl menüsü"
        >
          <p className="notal-sidebar-title">NotAl</p>
          <nav className="notal-nav">
            <button
              type="button"
              className={`notal-nav-btn${activeView === "asistan" ? " is-active" : ""}`}
              aria-current={activeView === "asistan" ? "page" : undefined}
              onClick={() => {
                setActiveView("asistan");
                closeSidebar();
              }}
            >
              Asistanım
            </button>
            <button
              type="button"
              className={`notal-nav-btn${activeView === "takvim" ? " is-active" : ""}`}
              aria-current={activeView === "takvim" ? "page" : undefined}
              onClick={() => {
                setActiveView("takvim");
                closeSidebar();
              }}
            >
              Takvim
            </button>

            <button
              type="button"
              className={`notal-nav-btn${activeView === "yks" ? " is-active" : ""}`}
              aria-current={activeView === "yks" ? "page" : undefined}
              onClick={() => {
                setActiveView("yks");
                setYksExam(null);
                closeSidebar();
              }}
            >
              YKS
            </button>
            <div className="notal-yks-subnav" aria-label="YKS alt menü">
              <button
                type="button"
                className={`notal-yks-subnav-btn${
                  activeView === "tyt" ? " is-active" : ""
                }`}
                aria-current={activeView === "tyt" ? "page" : undefined}
                onClick={() => {
                  setActiveView("tyt");
                  setYksExam("TYT");
                  closeSidebar();
                }}
              >
                TYT
              </button>
              <button
                type="button"
                className={`notal-yks-subnav-btn${
                  activeView === "ayt" ? " is-active" : ""
                }`}
                aria-current={activeView === "ayt" ? "page" : undefined}
                onClick={() => {
                  setActiveView("ayt");
                  setYksExam("AYT");
                  closeSidebar();
                }}
              >
                AYT
              </button>
              {ydsEnabled ? (
                <button
                  type="button"
                  className={`notal-yks-subnav-btn${
                    activeView === "yds" ? " is-active" : ""
                  }`}
                  aria-current={activeView === "yds" ? "page" : undefined}
                  onClick={() => {
                    setActiveView("yds");
                    setYksExam("YDS");
                    closeSidebar();
                  }}
                >
                  YDS
                </button>
              ) : null}
            </div>

            {activeView === "asistan" ? (
              <>
                <button
                  type="button"
                  className="notal-new-chat-btn"
                  onClick={startNewChat}
                  disabled={sending}
                >
                  + Yeni sohbet
                </button>

                <div className="notal-conv-list" aria-label="Sohbet geçmişi">
                  {loadingList ? (
                    <p className="notal-conv-empty">Sohbetler yükleniyor…</p>
                  ) : conversations.length === 0 ? (
                    <p className="notal-conv-empty">Henüz kayıtlı sohbet yok.</p>
                  ) : (
                    conversations.map((item) => {
                      const active = item.id === conversationId;
                      return (
                        <div
                          key={item.id}
                          className={`notal-conv-item${active ? " is-active" : ""}`}
                        >
                          <button
                            type="button"
                            className="notal-conv-open"
                            onClick={() => void openConversation(item.id)}
                            disabled={sending || loadingThread}
                            title={item.title}
                          >
                            {item.title}
                          </button>
                          <button
                            type="button"
                            className="notal-conv-delete"
                            aria-label="Sohbeti sil"
                            disabled={sending}
                            onClick={() => void removeConversation(item.id)}
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              null
            )}
          </nav>
        </aside>

        <div className="notal-content">
          {activeView === "takvim" ? (
            <div className="notal-chat notal-chat--calendar">
              <NotalCalendar authFetch={authFetch} />
            </div>
          ) : activeView === "yks" ? (
            <section className="notal-chat notal-chat--dashboard" aria-label="YKS">
              <div className="notal-chat-header">
                <h1 className="notal-chat-title">YKS</h1>
                <p className="notal-chat-subtitle">
                  TYT ve AYT performans panellerine buradan geçebilirsin.
                </p>
              </div>
              <div className="notal-yks-overview-grid">
                <article className="notal-yks-overview-card">
                  <h2 className="notal-yks-overview-title">Hedef</h2>
                  <p className="notal-yks-overview-value">
                    {studentContext?.targetRank ?? "Henüz belirlenmedi"}
                  </p>
                  {targetNetEstimate ? (
                    <>
                      <p className="notal-yks-overview-nets">
                        {formatTargetNetSummary(targetNetEstimate)}
                      </p>
                      <p className="notal-yks-overview-hint">
                        {targetNetEstimate.area} ·{" "}
                        {targetNetEstimate.referenceYear} verisine göre yaklaşık
                        hedef netler
                      </p>
                    </>
                  ) : studentContext?.targetRank && !yksAreaDetected ? (
                    <p className="notal-yks-overview-hint">
                      Alanını (Sayısal / EA / Sözel / Dil) Asistanım&apos;da
                      paylaş; ortalama hedef netleri göstereceğiz.
                    </p>
                  ) : (
                    <p className="notal-yks-overview-hint">
                      Hedef sıralamanı Asistanım&apos;da paylaşabilirsin.
                    </p>
                  )}
                </article>
                <article className="notal-yks-overview-card">
                  <h2 className="notal-yks-overview-title">Performans</h2>
                  {performanceProgress ? (
                    <div className="notal-yks-performance-stats">
                      <p className="notal-yks-overview-nets">
                        Ort. ({performanceProgress.sampleLabel}):{" "}
                        {formatAverageNets(performanceProgress)}
                      </p>
                      <p className="notal-yks-overview-hint">
                        Hedefe kalan: {formatGapNets(performanceProgress)}
                      </p>
                      <p className="notal-yks-performance-success">
                        Başarı %{performanceProgress.successPercent}
                      </p>
                      {studentContext?.performanceCoachLine ? (
                        <p className="notal-yks-performance-coach">
                          {studentContext.performanceCoachLine}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {studentContext?.trialExams?.length ? (
                    <ul className="notal-yks-trial-list">
                      {studentContext.trialExams.map((exam, index) => (
                        <li key={`${exam.name}-${index}`}>
                          <strong>{exam.name}</strong>
                          <span>{formatTrialExamSummary(exam)}</span>
                          {exam.takenAt ? (
                            <small>{exam.takenAt}</small>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <>
                      <p className="notal-yks-overview-value">
                        Henüz deneme neti yok
                      </p>
                      <p className="notal-yks-overview-hint">
                        Son deneme netlerini Asistanım&apos;a yazabilir veya
                        aşağıdaki Deneme Analizi ile ekleyebilirsin.
                      </p>
                    </>
                  )}
                </article>
              </div>
              <div className="notal-yks-dashboard-grid">
                <button
                  type="button"
                  className="notal-yks-dashboard-card"
                  onClick={() => {
                    setActiveView("tyt");
                    setYksExam("TYT");
                  }}
                >
                  <strong>TYT</strong>
                  <span>Ortalama net, deneme trendi ve konu ilerlemesi</span>
                </button>
                <button
                  type="button"
                  className="notal-yks-dashboard-card"
                  onClick={() => {
                    setActiveView("ayt");
                    setYksExam("AYT");
                  }}
                >
                  <strong>AYT</strong>
                  <span>Branş bazlı netler, hedef durum ve eksik konular</span>
                </button>
                {ydsEnabled ? (
                  <button
                    type="button"
                    className="notal-yks-dashboard-card"
                    onClick={() => {
                      setActiveView("yds");
                      setYksExam("YDS");
                    }}
                  >
                    <strong>YDS</strong>
                    <span>Kelime, grammar ve reading performansı</span>
                  </button>
                ) : null}
              </div>

              <NotalTrialAnalysisPanel
                analyses={studentContext?.trialAnalyses ?? []}
                yksArea={yksAreaDetected}
                ydsEnabled={ydsEnabled}
                enabledExams={enabledExams}
                authFetch={authFetch}
                onCreated={(analysis, context) => {
                  mergeTrialAnalysisIntoUi(analysis, context);
                }}
                onOpenSolution={(solutionId, analysis) => {
                  mergeTrialAnalysisIntoUi(analysis);
                  setActiveQuestionSolutionId(solutionId);
                }}
                onOpenCard={(cardId, analysis) => {
                  mergeTrialAnalysisIntoUi(analysis);
                  setActiveKnowledgeCardId(cardId);
                }}
              />
            </section>
          ) : activeView === "tyt" ? (
            renderTopicsDashboard(
              "TYT",
              "TYT Dashboard",
              "Konular altında tüm branş ve müfredat başlıkları.",
            )
          ) : activeView === "ayt" ? (
            renderTopicsDashboard(
              "AYT",
              "AYT Dashboard",
              "Konular altında tüm branş ve müfredat başlıkları.",
            )
          ) : activeView === "yds" ? (
            renderTopicsDashboard(
              "YDS",
              "YDS Dashboard",
              "Konular altında tüm branş ve müfredat başlıkları.",
            )
          ) : (
            <section className="notal-chat notal-chat--asistan" aria-label="Asistanım">
            <div className="notal-chat-header">
              <h1 className="notal-chat-title">Asistanım</h1>
              <p className="notal-chat-subtitle">
                Orchestrator plan işlerini Planner'a devreder — örn. “yarın için 3 saatlik çalışma planı yap”
              </p>
            </div>

            <div ref={listRef} className="notal-chat-messages" role="log">
              {loadingThread ? (
                <div className="notal-chat-empty">
                  <p className="notal-chat-empty-text">Sohbet yükleniyor…</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="notal-chat-empty">
                  <p className="notal-chat-empty-title">Sohbete başla</p>
                  <p className="notal-chat-empty-text">
                    İlk mesajın yeni bir sohbet oluşturur. Geçmiş solda görünür.
                  </p>
                </div>
              ) : (
                messages.map((message) => (
                  <article
                    key={message.id}
                    className={`notal-bubble notal-bubble--${message.role}${
                      message.role === "assistant" &&
                      sending &&
                      message.content === ""
                        ? " is-pending"
                        : ""
                    }`}
                  >
                    <p className="notal-bubble-role">
                      {message.role === "user"
                        ? "Sen"
                        : message.role === "assistant"
                          ? "NotAl"
                          : "Sistem"}
                    </p>
                    {message.attachments?.length ? (
                      <div className="notal-bubble-attachments">
                        {message.attachments.map((attachment) => (
                          <div
                            key={`${message.id}-${attachment.name}`}
                            className="notal-bubble-attachment"
                          >
                            {attachment.kind === "image" && attachment.previewUrl ? (
                              <img
                                src={attachment.previewUrl}
                                alt={attachment.name}
                                className="notal-bubble-attachment-image"
                              />
                            ) : (
                              <div className="notal-bubble-attachment-file">
                                <span aria-hidden="true">PDF</span>
                                <strong>{attachment.name}</strong>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {message.role === "assistant" &&
                    looksLikeRichSolution(message.content) ? (
                      <SolutionRichText
                        className="notal-rich-text notal-rich-text--bubble"
                        text={
                          stripAttachmentFooter(message.content) ||
                          (sending ? "…" : "")
                        }
                      />
                    ) : (
                      <p className="notal-bubble-text">
                        {stripAttachmentFooter(message.content) ||
                          (message.role === "assistant" && sending ? "…" : "")}
                      </p>
                    )}
                  </article>
                ))
              )}
            </div>

            <div
              className={`notal-compose-dock${choicePrompt ? " has-choice" : ""}`}
            >
              {choicePrompt ? (
                <div className="notal-choice-prompt" role="group" aria-label="Hızlı seçim">
                  <p className="notal-choice-prompt-title">
                    {choicePromptTitle(choicePrompt)}
                  </p>
                  <div className="notal-choice-options">
                    {choicePrompt.options.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className="notal-choice-btn"
                        onClick={() => submitChoice(option.value)}
                        disabled={sending || loadingThread}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <form className="notal-compose" onSubmit={handleSubmit}>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="sr-only"
                  accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                  multiple
                  onChange={(event) => {
                    void handleAttachmentSelect(event);
                  }}
                  disabled={sending || loadingThread}
                />

                {pendingAttachments.length ? (
                  <div className="notal-compose-attachments">
                    {pendingAttachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="notal-compose-attachment"
                      >
                        {attachment.kind === "image" ? (
                          <img
                            src={attachment.previewUrl}
                            alt={attachment.name}
                            className="notal-compose-attachment-thumb"
                          />
                        ) : (
                          <div className="notal-compose-attachment-pdf">
                            <span aria-hidden="true">PDF</span>
                          </div>
                        )}
                        <span className="notal-compose-attachment-name">
                          {attachment.name}
                        </span>
                        <button
                          type="button"
                          className="notal-compose-attachment-remove"
                          onClick={() => removePendingAttachment(attachment.id)}
                          disabled={sending || loadingThread}
                          aria-label={`${attachment.name} dosyasını kaldır`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                {attachmentError ? (
                  <p className="notal-compose-attachment-error">{attachmentError}</p>
                ) : null}

                <div className="notal-compose-row">
                  <button
                    type="button"
                    className="notal-compose-attach"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={
                      sending ||
                      loadingThread ||
                      pendingAttachments.length >= MAX_CHAT_ATTACHMENTS
                    }
                    aria-label="Görsel veya PDF ekle"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                    </svg>
                  </button>
                  <label className="sr-only" htmlFor="notal-compose-input">
                    Mesajın
                  </label>
                  <textarea
                    id="notal-compose-input"
                    ref={inputRef}
                    className="notal-compose-input"
                    rows={1}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Mesajını yaz… (Enter gönder, Shift+Enter satır)"
                    maxLength={4000}
                    disabled={sending || loadingThread}
                  />
                  <button
                    type="submit"
                    className="notal-compose-send"
                    disabled={
                      sending ||
                      loadingThread ||
                      (!draft.trim() && !pendingAttachments.length)
                    }
                    aria-label={sending ? "Gönderiliyor" : "Gönder"}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                    </svg>
                  </button>
                </div>
              </form>
            </div>
          </section>
          )}
      {activeQuestionSolution ? (
        <div className="notal-solution-modal" role="dialog" aria-modal="true">
          <div className="notal-solution-modal-backdrop" />
          <div className="notal-solution-modal-card">
            <div className="notal-solution-modal-header">
              <div>
                <div className="notal-solution-modal-title">
                  {activeQuestionSolution.exam} · {activeQuestionSolution.branch}{" "}
                  · {activeQuestionSolution.topic}
                </div>
                <div className="notal-solution-modal-subtitle">
                  Soru çözümü
                </div>
              </div>
              <button
                type="button"
                className="notal-solution-modal-close"
                onClick={() => setActiveQuestionSolutionId(null)}
                aria-label="Kapat"
              >
                ×
              </button>
            </div>

            <div className="notal-solution-modal-body">
              <div className="notal-solution-block">
                <div className="notal-solution-block-title">Soru</div>
                <SolutionRichText
                  className="notal-rich-text notal-rich-text--question"
                  text={activeQuestionSolution.question}
                />
              </div>

              <div className="notal-solution-block">
                <div className="notal-solution-block-title">Çözüm</div>
                <SolutionRichText text={activeQuestionSolution.solution} />
                {activeQuestionSolution.finalAnswer ? (
                  <div className="notal-rich-answer notal-rich-answer--final">
                    Doğru cevap: {activeQuestionSolution.finalAnswer}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeKnowledgeCard ? (
        <div className="notal-solution-modal" role="dialog" aria-modal="true">
          <div
            className="notal-solution-modal-backdrop"
            onClick={() => setActiveKnowledgeCardId(null)}
          />
          <div className="notal-solution-modal-card">
            <div className="notal-solution-modal-header">
              <div>
                <div className="notal-solution-modal-title">
                  {activeKnowledgeCard.title}
                </div>
                <div className="notal-solution-modal-subtitle">
                  {activeKnowledgeCard.exam} · {activeKnowledgeCard.branch} ·{" "}
                  {activeKnowledgeCard.topic}
                </div>
              </div>
              <button
                type="button"
                className="notal-solution-modal-close"
                onClick={() => setActiveKnowledgeCardId(null)}
                aria-label="Kapat"
              >
                ×
              </button>
            </div>

            <div className="notal-solution-modal-body">
              <div className="notal-solution-block">
                <div className="notal-solution-block-title">Özet</div>
                <SolutionRichText text={activeKnowledgeCard.summary} />
              </div>

              {activeKnowledgeCard.keyPoints.length ? (
                <div className="notal-solution-block">
                  <div className="notal-solution-block-title">Ana noktalar</div>
                  <ul className="notal-knowledge-points">
                    {activeKnowledgeCard.keyPoints.map((point) => (
                      <li key={point}>
                        <SolutionRichText text={point} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {activeKnowledgeCard.formula ? (
                <div className="notal-solution-block">
                  <div className="notal-solution-block-title">Formül</div>
                  <SolutionRichText text={activeKnowledgeCard.formula} />
                </div>
              ) : null}

              {activeKnowledgeCard.trap ? (
                <div className="notal-solution-block">
                  <div className="notal-solution-block-title">Tuzak</div>
                  <div className="notal-knowledge-trap">
                    <SolutionRichText text={activeKnowledgeCard.trap} />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
        </div>
      </div>
    </div>
  );
}
